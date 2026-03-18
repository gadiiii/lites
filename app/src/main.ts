/**
 * main.ts — Electron main process for lites
 *
 * Responsibilities:
 * - Import and run the lites server (embedded, no child process)
 * - Create a small status window (shows URL, status, controls)
 * - Create a system tray icon with context menu
 * - IPC handlers: get-status, launch-browser, scan-usb
 * - Clean shutdown on quit (blackout → flush → close)
 */

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServerStatus {
  state: 'starting' | 'running' | 'stopped' | 'error';
  serverUrl: string;
  lanUrls: string[];
  port: number;
  error?: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let shutdownFn: (() => Promise<void>) | null = null;

const status: ServerStatus = {
  state: 'starting',
  serverUrl: '',
  lanUrls: [],
  port: 3000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function broadcastStatus(): void {
  mainWindow?.webContents.send('status-change', status);
}

function buildTrayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: 'lites',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: status.state === 'running'
        ? `Running on port ${status.port}`
        : status.state === 'starting'
          ? 'Starting…'
          : 'Server stopped',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show / Hide Window',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Launch GUI',
      enabled: status.state === 'running',
      click: () => {
        if (status.serverUrl) shell.openExternal(status.serverUrl);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit lites',
      accelerator: process.platform === 'darwin' ? 'Cmd+Q' : undefined,
      click: () => app.quit(),
    },
  ]);
}

function refreshTrayMenu(): void {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    resizable: false,
    title: 'lites',
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'window', 'index.html'));

  // Hide instead of close — keep server running in tray
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray(): void {
  // Use a simple template image (falls back to text if not found)
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-template.png');
  let icon: Electron.NativeImage;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(true);
  } else {
    // Fallback: create a tiny programmatic icon
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('lites DMX Controller');
  tray.setContextMenu(buildTrayMenu());

  // Left-click / double-click on tray → show/hide window
  // On Windows 'click' fires; on Linux 'double-click' is more reliable
  const toggleWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  tray.on('click', toggleWindow);
  tray.on('double-click', toggleWindow);
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

function registerIpc(): void {
  ipcMain.handle('get-status', () => status);

  ipcMain.handle('launch-browser', async () => {
    if (status.serverUrl) await shell.openExternal(status.serverUrl);
  });

  ipcMain.handle('scan-usb', async () => {
    if (status.state !== 'running') {
      return { ports: [], recommended: [], error: 'Server not running yet' };
    }
    try {
      const res = await fetch(`http://localhost:${status.port}/api/ports`);
      return await res.json();
    } catch (err) {
      return { ports: [], recommended: [], error: String(err) };
    }
  });

  ipcMain.handle('hide-window', () => {
    mainWindow?.hide();
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Hide from dock — tray-only app
  if (app.dock) app.dock.hide();

  registerIpc();
  createWindow();
  createTray();

  // ── Boot the server ────────────────────────────────────────────────────────
  try {
    // In packaged app, server module lives in extraResources/server/index.js
    // In dev, we import directly from the workspace
    let startServer: (overrides?: { port?: number; serialPort?: string }) => Promise<{
      port: number;
      serverUrl: string;
      lanUrls: string[];
      shutdown: () => Promise<void>;
    }>;

    if (app.isPackaged) {
      // Tell the server where to find show.json (extraResources/data/)
      process.env.SHOW_FILE = path.join(process.resourcesPath, 'data', 'show.json');

      // Server is an esbuild bundle in extraResources/server/.
      // ws, zod, @lites/shared are inlined; serialport is in extraResources/node_modules/
      // so require('serialport') resolves one directory up from the bundle. ✓
      const serverPath = path.join(process.resourcesPath, 'server', 'bundle.cjs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ startServer } = require(serverPath));
    } else {
      // Dev: import from the server workspace dist
      const serverDist = path.resolve(__dirname, '..', '..', 'server', 'dist', 'index.js');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ startServer } = require(serverDist));
    }

    const instance = await startServer();
    shutdownFn = instance.shutdown;

    Object.assign(status, {
      state: 'running',
      serverUrl: instance.serverUrl,
      lanUrls: instance.lanUrls,
      port: instance.port,
    });
  } catch (err) {
    Object.assign(status, {
      state: 'error',
      error: String(err),
    });
    console.error('[App] Failed to start server:', err);
  }

  broadcastStatus();
  refreshTrayMenu();
});

// Mark app as quitting so window.close() doesn't just hide
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', async (e) => {
  if (shutdownFn) {
    e.preventDefault();
    try {
      await shutdownFn();
    } catch (err) {
      console.error('[App] Shutdown error:', err);
    } finally {
      shutdownFn = null;
      app.quit();
    }
  }
});

// macOS: re-open window when clicking dock icon (though dock is hidden)
app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
