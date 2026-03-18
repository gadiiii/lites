/**
 * renderer.js — Status window script
 * Uses window.lites API exposed by preload.ts via contextBridge.
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const banner     = document.getElementById('statusBanner');
const urlSection = document.getElementById('urlSection');
const urlLink    = document.getElementById('urlLink');
const urlHint    = document.getElementById('urlHint');
const btnLaunch  = document.getElementById('btnLaunch');
const usbSection = document.getElementById('usbSection');

// ── Status rendering ──────────────────────────────────────────────────────────

function applyStatus(s) {
  const labels = { starting: 'Starting…', running: '● Running', stopped: '● Stopped', error: '⚠ Error' };
  banner.className = `status-banner ${s.state}`;
  banner.textContent = labels[s.state] || s.state;

  if (s.state === 'running' && s.serverUrl) {
    urlSection.style.display = 'block';
    urlLink.textContent = s.serverUrl;
    urlLink.href = s.serverUrl;
    urlHint.textContent = s.lanUrls.length > 1
      ? `+ ${s.lanUrls.length - 1} more address${s.lanUrls.length > 2 ? 'es' : ''}`
      : 'Click to open in browser';
    btnLaunch.disabled = false;
  } else if (s.state === 'error' && s.error) {
    urlSection.style.display = 'block';
    urlLink.textContent = s.error;
    urlLink.href = '#';
    urlHint.textContent = '';
    btnLaunch.disabled = true;
  } else {
    urlSection.style.display = 'none';
    btnLaunch.disabled = true;
  }
}

// ── USB scan ──────────────────────────────────────────────────────────────────

async function scanUsb() {
  usbSection.innerHTML = '<div class="usb-empty">Scanning…</div>';

  let result;
  try {
    result = await window.lites.scanUsb();
  } catch (err) {
    usbSection.innerHTML = `<div class="usb-empty" style="color:#e74c3c">Error: ${err}</div>`;
    return;
  }

  if (result.error) {
    usbSection.innerHTML = `<div class="usb-empty" style="color:#e74c3c">Error: ${result.error}</div>`;
    return;
  }

  if (!result.ports || result.ports.length === 0) {
    usbSection.innerHTML = '<div class="usb-empty">No serial ports found</div>';
    return;
  }

  const recPaths = new Set((result.recommended || []).map(r => r.path));

  usbSection.innerHTML = result.ports.map(p => {
    const rec = recPaths.has(p.path);
    const label = p.manufacturer ? `${p.path} — ${p.manufacturer}` : p.path;
    return `<div class="usb-port ${rec ? 'recommended' : ''}">
      <div class="usb-dot ${rec ? 'recommended' : ''}"></div>
      <span>${label}${rec ? ' ✓' : ''}</span>
    </div>`;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const s = await window.lites.getStatus();
    applyStatus(s);
    window.lites.onStatusChange(applyStatus);
  } catch (err) {
    console.error('Renderer init error:', err);
  }
})();
