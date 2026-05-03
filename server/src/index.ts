/**
 * index.ts — Server entry point
 *
 * Boot sequence:
 *   1.  Load config (env vars / .env file)
 *   2.  Load show state from disk
 *   3.  Create DMX output driver (pluggable: ENTTEC USB, Art-Net, sACN, Null)
 *   4.  Init DMX engine + open output driver
 *   5.  Init patch + hydrate universe
 *   6.  Init effects engine + register tick processor
 *   7.  Init cuelist engine + register tick processor
 *   8.  Init timeline engine + register tick processor
 *   9.  Init MIDI engine
 *  10.  Init OSC server
 *  11.  Create HTTP server (serves client/dist in production)
 *  12.  Attach WebSocket server
 *  13.  Find a free port and start listening
 *  14.  Print LAN access URLs
 *  15.  Start DMX tick loop
 *
 * Exported `startServer()` is used by the Electron app wrapper.
 * CLI self-execution is preserved for `npm start` / `node dist/index.js`.
 */

import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from './config.js';
import { DmxEngine } from './dmxEngine.js';
import { Patch } from './patch.js';
import { Persistence } from './persistence.js';
import { EffectsEngine } from './effectsEngine.js';
import { CuelistEngine } from './cuelistEngine.js';
import { TimelineEngine } from './timelineEngine.js';
import { MidiEngine } from './midi.js';
import { OscServer } from './osc.js';
import { WsServer } from './websocket.js';
import { Auth } from './auth.js';
import { searchFixtures, fetchFixture } from './oflProxy.js';
import { createOutput } from './output/factory.js';

// ── Port discovery ────────────────────────────────────────────────────────────

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.listen(port, '0.0.0.0', () => {
        probe.close(() => resolve(true));
      });
      probe.on('error', () => resolve(false));
    });
    if (free) return port;
  }
  throw new Error(`No free port found in range ${start}–${start + 19}`);
}

// ── LAN IP helpers ────────────────────────────────────────────────────────────

function getLanIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ── HTTP request handler helpers ──────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

// ── startServer ───────────────────────────────────────────────────────────────

export interface ServerInstance {
  port: number;
  serverUrl: string;
  lanUrls: string[];
  shutdown: () => Promise<void>;
}

export async function startServer(overrides?: { port?: number; serialPort?: string }): Promise<ServerInstance> {
  console.log('[Boot] Starting lites v2 server…');
  if (config.adminPassword) {
    console.log('[Boot] Auth: ENABLED');
  } else {
    console.log('[Boot] Auth: DISABLED (set ADMIN_PASSWORD in .env to enable)');
  }

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const auth = new Auth(config.adminPassword);

  // ── 2. Load show ─────────────────────────────────────────────────────────────
  const persistence = new Persistence(config.showFilePath);
  const showState = await persistence.load();

  // ── 3. Create output driver ───────────────────────────────────────────────────
  const savedDriverCfg = showState.outputDriverConfig;
  const driverCfg = {
    ...savedDriverCfg,
    // CLI override takes precedence over saved config
    ...(overrides?.serialPort ? { serialPort: overrides.serialPort } : {}),
  };
  // Env var OUTPUT_DRIVER overrides saved driver type
  if (config.outputDriver !== 'enttec-usb' || !savedDriverCfg.driver) {
    driverCfg.driver = config.outputDriver;
  }
  const output = createOutput(driverCfg);

  // ── 4. Init DMX engine ───────────────────────────────────────────────────────
  const engine = new DmxEngine(config.dmxFps, output);
  await engine.openOutput();

  // ── 5. Init patch + hydrate universe ─────────────────────────────────────────
  const patch = new Patch(engine);
  patch.init(showState);
  engine.setMasterDimmer(showState.masterDimmer ?? 255);

  // ── 6. Init effects engine ───────────────────────────────────────────────────
  const effectsEngine = new EffectsEngine(patch);
  effectsEngine.init(showState.effectInstances ?? []);
  engine.registerTickProcessor((now) => effectsEngine.tick(now));

  // Need forward reference for wsServer used in engine callbacks
  let wsServer: WsServer;

  // ── 7. Init cuelist engine ────────────────────────────────────────────────────
  const cuelistEngine = new CuelistEngine(patch, (_cuelists, _playback) => {
    wsServer?.broadcastCuelistUpdate();
  });
  cuelistEngine.init(showState.cuelists ?? {});
  engine.registerTickProcessor((now) => cuelistEngine.tick(now));

  // ── 8. Init timeline engine ───────────────────────────────────────────────────
  const timelineEngine = new TimelineEngine(patch, (_timelines, _playback) => {
    wsServer?.broadcastTimelinesUpdate();
  });
  timelineEngine.init(showState.timelines ?? {});
  engine.registerTickProcessor((now) => timelineEngine.tick(now));

  // ── 9. Init MIDI engine ───────────────────────────────────────────────────────
  const midiEngine = new MidiEngine(
    showState.midiMappings ?? [],
    patch,
    (mappings) => wsServer?.broadcastMidiMappings(mappings),
    (ports, activePort) => wsServer?.broadcastMidiPorts(ports, activePort),
    (mappingId) => wsServer?.broadcastMidiLearn(mappingId)
  );
  await midiEngine.init();

  // Wire action callbacks for MIDI targets
  midiEngine.registerPresetCallback((presetId) => wsServer?.recallPresetById(presetId));
  midiEngine.registerBlackoutCallback(() => wsServer?.toggleBlackout());
  midiEngine.registerCueGoCallback((cuelistId) => cuelistEngine.go(cuelistId));

  // ── 10. Init OSC server ───────────────────────────────────────────────────────
  const oscServer = new OscServer(showState.oscConfig ?? { enabled: false, port: config.oscPort }, patch);
  oscServer.registerPresetCallback((presetId) => wsServer?.recallPresetById(presetId));
  oscServer.registerBlackoutCallback(() => wsServer?.toggleBlackout());
  oscServer.registerMasterDimmerCallback((v) => {
    engine.setMasterDimmer(v);
    wsServer?.broadcastMasterDimmer(v);
  });
  oscServer.registerCueGoCallback((cuelistId) => cuelistEngine.go(cuelistId));
  await oscServer.start();

  // ── 11. HTTP server ───────────────────────────────────────────────────────────
  const clientDist = path.resolve(__dirname, 'public');

  const httpServer = http.createServer(async (req, res) => {
    const urlPath = req.url ?? '/';
    const url = new URL(urlPath, 'http://x');
    const pathname = url.pathname;

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      try {
        const body = await readBody(req);
        const { password } = JSON.parse(body) as { password: string };
        const token = auth.login(password ?? '');
        if (token) {
          sendJson(res, 200, { token });
        } else {
          sendJson(res, 401, { error: 'Invalid password' });
        }
      } catch {
        sendJson(res, 400, { error: 'Bad request' });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/auth/check') {
      const token = (req.headers['authorization'] ?? '').replace('Bearer ', '');
      sendJson(res, auth.isValid(token) ? 200 : 401, { ok: auth.isValid(token), authEnabled: auth.enabled });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/ports') {
      try {
        const { SerialPort } = await import('serialport');
        const ports = await SerialPort.list();
        const recommended = ports.filter((p) => {
          const vid = (p.vendorId ?? '').toLowerCase();
          const mfr = (p.manufacturer ?? '').toLowerCase();
          const pt  = (p.path ?? '').toLowerCase();
          return (
            vid === '0403' ||
            pt.includes('usbserial') ||
            mfr.includes('enttec') ||
            mfr.includes('ftdi') ||
            mfr.includes('dmx')
          );
        });

        if (process.platform === 'linux') {
          for (const p of recommended as (typeof recommended[0] & { permissionError?: boolean })[]) {
            try {
              fs.accessSync(p.path, fs.constants.R_OK | fs.constants.W_OK);
            } catch {
              p.permissionError = true;
            }
          }
        }

        sendJson(res, 200, { ports, recommended });
      } catch (e) {
        sendJson(res, 500, { ports: [], recommended: [], error: String(e) });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/ofl/search') {
      const q = url.searchParams.get('q') ?? '';
      try {
        const results = await searchFixtures(q);
        sendJson(res, 200, results);
      } catch (e) {
        sendJson(res, 500, { error: String(e) });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/shutdown') {
      sendJson(res, 200, { ok: true, message: 'Server shutting down…' });
      setTimeout(() => {
        shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
      }, 200);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/system-shutdown') {
      if (process.env.ALLOW_SYSTEM_SHUTDOWN !== 'true') {
        sendJson(res, 403, { error: 'System shutdown not enabled. Set ALLOW_SYSTEM_SHUTDOWN=true in .env to enable.' });
        return;
      }
      sendJson(res, 200, { ok: true, message: 'System shutting down…' });
      setTimeout(async () => {
        await shutdown();
        const { exec } = await import('child_process');
        const cmd = process.platform === 'win32' ? 'shutdown /s /t 3' : 'shutdown -h now';
        exec(cmd, (err) => {
          if (err) console.error('[Boot] System shutdown command failed:', err.message);
          process.exit(0);
        });
      }, 200);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/ofl/fixture') {
      const key = url.searchParams.get('key') ?? '';
      if (!key) { sendJson(res, 400, { error: 'Missing key' }); return; }
      try {
        const profile = await fetchFixture(key);
        if (profile) {
          sendJson(res, 200, profile);
        } else {
          sendJson(res, 404, { error: 'Fixture not found' });
        }
      } catch (e) {
        sendJson(res, 500, { error: String(e) });
      }
      return;
    }

    if (!fs.existsSync(clientDist)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('lites server running.\nRun "npm run build" to build the client.\n');
      return;
    }

    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js':   'application/javascript',
      '.css':  'text/css',
      '.svg':  'image/svg+xml',
      '.png':  'image/png',
      '.ico':  'image/x-icon',
      '.woff2':'font/woff2',
      '.json': 'application/json',
    };

    const serveSimple = pathname === '/simple' || pathname === '/simple/';
    let filePath: string;
    if (serveSimple) {
      filePath = path.join(clientDist, 'simple.html');
    } else {
      const stripped = pathname === '/' || !path.extname(pathname) ? '/index.html' : pathname;
      filePath = path.join(clientDist, stripped);
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        fs.readFile(path.join(clientDist, 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); res.end('Not found'); }
          else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); }
        });
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
      res.end(data);
    });
  });

  // ── 12. WebSocket server ──────────────────────────────────────────────────────
  wsServer = new WsServer(
    httpServer, engine, patch, persistence,
    effectsEngine, cuelistEngine, timelineEngine, midiEngine, oscServer,
    showState, auth
  );

  // ── 13. Find free port + listen ───────────────────────────────────────────────
  const startPort = overrides?.port ?? config.wsPort;
  const port = await findFreePort(startPort);
  if (port !== startPort) {
    console.warn(`[Boot] Port ${startPort} is in use, using ${port} instead.`);
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(port, '0.0.0.0', () => resolve());
  });

  console.log(`[Boot] HTTP + WS server listening on port ${port}`);
  const lanIps = getLanIps();
  const lanUrls: string[] = [];
  if (lanIps.length > 0) {
    console.log('[Boot] Access on your network:');
    lanIps.forEach(ip => {
      console.log(`[Boot]   Admin:     http://${ip}:${port}`);
      console.log(`[Boot]   Performer: http://${ip}:${port}/simple`);
      lanUrls.push(`http://${ip}:${port}`);
    });
  } else {
    console.log(`[Boot]   http://localhost:${port}`);
  }

  // ── 14. Start DMX tick ────────────────────────────────────────────────────────
  engine.startTick();

  // ── 15. Shutdown function ─────────────────────────────────────────────────────
  let shutdown!: () => Promise<void>;
  shutdown = async (): Promise<void> => {
    console.log('[Boot] Shutting down…');
    engine.close();
    midiEngine.close();
    await oscServer.stop();
    await persistence.flush();
    await wsServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    console.log('[Boot] Goodbye.');
  };

  const serverUrl = lanUrls[0] ?? `http://localhost:${port}`;
  return { port, serverUrl, lanUrls, shutdown };
}

// ── CLI self-execution ────────────────────────────────────────────────────────

if (require.main === module) {
  startServer()
    .then(({ shutdown }) => {
      const exit = (signal: string) => {
        console.log(`\n[Boot] Received ${signal}.`);
        shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.on('SIGINT',  () => exit('SIGINT'));
      process.on('SIGTERM', () => exit('SIGTERM'));
    })
    .catch((err) => {
      console.error('[Boot] Fatal error:', err);
      process.exit(1);
    });
}
