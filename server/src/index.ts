/**
 * index.ts — Server entry point
 *
 * Boot sequence:
 *   1.  Load config (env vars / .env file)
 *   2.  Load show state from disk
 *   3.  Initialise DMX engine
 *   4.  Open ENTTEC serial port (non-fatal if missing)
 *   5.  Init patch + hydrate universe
 *   6.  Init effects engine + register tick processor
 *   7.  Init cuelist engine + register tick processor
 *   8.  Create HTTP server (serves client/dist in production)
 *   9.  Attach WebSocket server
 *  10.  Find a free port and start listening
 *  11.  Print LAN access URLs
 *  12.  Start DMX tick loop
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
import { WsServer } from './websocket.js';
import { Auth } from './auth.js';
import { searchFixtures, fetchFixture } from './oflProxy.js';

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
  /** First LAN IP + port, e.g. "http://192.168.1.42:3000". Falls back to localhost. */
  serverUrl: string;
  /** All LAN URLs for display */
  lanUrls: string[];
  /** Clean shutdown: blackout → flush show → close WS → close HTTP */
  shutdown: () => Promise<void>;
}

export async function startServer(overrides?: { port?: number; serialPort?: string }): Promise<ServerInstance> {
  console.log('[Boot] Starting lites server…');
  console.log(`[Boot] Config: fps=${config.dmxFps}, serial=${overrides?.serialPort ?? config.serialPort}`);
  if (config.adminPassword) {
    console.log('[Boot] Auth: ENABLED (ADMIN_PASSWORD is set)');
  } else {
    console.log('[Boot] Auth: DISABLED (set ADMIN_PASSWORD in .env to enable)');
  }

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const auth = new Auth(config.adminPassword);

  // ── 2. Load show ─────────────────────────────────────────────────────────────
  const persistence = new Persistence(config.showFilePath);
  const showState = await persistence.load();

  // ── 3. Init DMX engine ───────────────────────────────────────────────────────
  const engine = new DmxEngine(config.dmxFps);
  await engine.open(overrides?.serialPort ?? config.serialPort);

  // ── 4. Init patch + hydrate universe ─────────────────────────────────────────
  const patch = new Patch(engine);
  patch.init(showState);
  engine.setMasterDimmer(showState.masterDimmer ?? 255);

  // ── 5. Init effects engine ───────────────────────────────────────────────────
  const effectsEngine = new EffectsEngine(patch);
  effectsEngine.init(showState.effectInstances ?? []);
  engine.registerTickProcessor((now) => effectsEngine.tick(now));

  // ── 6. Init cuelist engine ───────────────────────────────────────────────────
  // shutdown is declared here (before httpServer) so the API handler can reference it.
  // It is assigned below after all dependencies are ready.
  let shutdown!: () => Promise<void>;
  let wsServer: WsServer;
  const cuelistEngine = new CuelistEngine(patch, (_cuelists, _playback) => {
    wsServer?.broadcastCuelistUpdate();
  });
  cuelistEngine.init(showState.cuelists ?? {});
  engine.registerTickProcessor((now) => cuelistEngine.tick(now));

  // ── 7. HTTP server ───────────────────────────────────────────────────────────
  const clientDist = path.resolve(__dirname, 'public');

  const httpServer = http.createServer(async (req, res) => {
    const urlPath = req.url ?? '/';
    const url = new URL(urlPath, 'http://x');
    const pathname = url.pathname;

    // ── API: Auth ─────────────────────────────────────────────────────────────
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

    // ── API: Auth check ───────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/api/auth/check') {
      const token = (req.headers['authorization'] ?? '').replace('Bearer ', '');
      sendJson(res, auth.isValid(token) ? 200 : 401, { ok: auth.isValid(token), authEnabled: auth.enabled });
      return;
    }

    // ── API: List serial ports (for Electron scan-usb) ───────────────────────
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

        // On Linux, check if each recommended port is actually accessible
        // (users must be in the 'dialout' group to open /dev/ttyUSB* devices)
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

    // ── API: OFL Search ───────────────────────────────────────────────────────
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

    // ── API: Shutdown server ──────────────────────────────────────────────────
    // Zeros all DMX channels, flushes show state, then exits.
    if (req.method === 'POST' && pathname === '/api/shutdown') {
      sendJson(res, 200, { ok: true, message: 'Server shutting down…' });
      setTimeout(() => {
        shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
      }, 200);
      return;
    }

    // ── API: System (OS) shutdown ─────────────────────────────────────────────
    // Disabled unless ALLOW_SYSTEM_SHUTDOWN=true is set in the environment.
    // Zeros DMX then runs the OS shutdown command (platform-specific).
    if (req.method === 'POST' && pathname === '/api/system-shutdown') {
      if (process.env.ALLOW_SYSTEM_SHUTDOWN !== 'true') {
        sendJson(res, 403, { error: 'System shutdown not enabled. Set ALLOW_SYSTEM_SHUTDOWN=true in .env to enable.' });
        return;
      }
      sendJson(res, 200, { ok: true, message: 'System shutting down…' });
      setTimeout(async () => {
        await shutdown();
        const { exec } = await import('child_process');
        const cmd = process.platform === 'win32'
          ? 'shutdown /s /t 3'
          : 'shutdown -h now';
        exec(cmd, (err) => {
          if (err) console.error('[Boot] System shutdown command failed:', err.message);
          process.exit(0);
        });
      }, 200);
      return;
    }

    // ── API: OFL Fixture ──────────────────────────────────────────────────────
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

    // ── Static file serving ───────────────────────────────────────────────────
    if (!fs.existsSync(clientDist)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(
        'lites server running.\n' +
        'Run "npm run build" to build the client, or use "npm run dev" for development.\n'
      );
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

    // /simple → serve simple.html
    const serveSimple = pathname === '/simple' || pathname === '/simple/';
    let filePath: string;
    if (serveSimple) {
      filePath = path.join(clientDist, 'simple.html');
    } else {
      const stripped = pathname === '/' || !path.extname(pathname)
        ? '/index.html'
        : pathname;
      filePath = path.join(clientDist, stripped);
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback for any unresolved route → index.html
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

  // ── 8. WebSocket server ───────────────────────────────────────────────────────
  wsServer = new WsServer(
    httpServer, engine, patch, persistence,
    effectsEngine, cuelistEngine, showState, auth
  );

  // ── 9. Find free port + listen ────────────────────────────────────────────────
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

  // ── 10. Start DMX tick ────────────────────────────────────────────────────────
  engine.startTick();

  // ── 11. Shutdown function (no process.exit — caller decides) ──────────────────
  // NOTE: `shutdown` was declared above (let shutdown!) so the HTTP handler can call it.
  shutdown = async (): Promise<void> => {
    console.log('[Boot] Shutting down…');
    engine.close();          // stops tick, sends blackout frame, closes serial
    await persistence.flush();
    await wsServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    console.log('[Boot] HTTP server closed. Goodbye.');
  };

  const serverUrl = lanUrls[0] ?? `http://localhost:${port}`;
  return { port, serverUrl, lanUrls, shutdown };
}

// ── CLI self-execution ────────────────────────────────────────────────────────
// Runs when invoked directly: `node dist/index.js` or `npm start`

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
