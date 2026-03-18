/**
 * preload.ts — contextBridge for the status window renderer
 *
 * Exposes a safe, typed `window.lites` API to the renderer.
 * No direct Node/Electron access from the renderer — everything
 * goes through IPC via this bridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

interface ScanResult {
  ports: SerialPortInfo[];
  recommended: SerialPortInfo[];
  error?: string;
}

interface ServerStatus {
  state: 'starting' | 'running' | 'stopped' | 'error';
  serverUrl: string;
  lanUrls: string[];
  port: number;
  error?: string;
}

contextBridge.exposeInMainWorld('lites', {
  /** Get current server status */
  getStatus: (): Promise<ServerStatus> =>
    ipcRenderer.invoke('get-status'),

  /** Open the admin UI in the system browser */
  launchBrowser: (): Promise<void> =>
    ipcRenderer.invoke('launch-browser'),

  /** Scan for ENTTEC/serial USB devices */
  scanUsb: (): Promise<ScanResult> =>
    ipcRenderer.invoke('scan-usb'),

  /** Hide the status window (keep server running in tray) */
  hideWindow: (): Promise<void> =>
    ipcRenderer.invoke('hide-window'),

  /** Subscribe to status change events from the main process */
  onStatusChange: (callback: (status: ServerStatus) => void): void => {
    ipcRenderer.on('status-change', (_event, s: ServerStatus) => callback(s));
  },
});
