/**
 * ColorWheel.tsx — Ring-style HSV colour picker (Lightkey-inspired)
 *
 * Canvas layout (180×180, cx=cy=90, r_outer=86, r_inner=68, r_gap=70):
 *
 *   ┌──────────────────────────────────┐
 *   │    [   hue ring r=70–86   ]      │  ← outer ring: angle=hue, sat=1, val=1
 *   │  [   inner disk  r<68    ]       │  ← inner disk: sat = dist/68, val=1
 *   │       white centre               │
 *   └──────────────────────────────────┘
 *
 * Interaction zones:
 *   dist > 70  → change HUE only (drag along ring)
 *   dist < 68  → change SATURATION only (drag radially in disk)
 *
 * A single cursor dot sits on the ring at the current hue angle.
 * A second smaller dot sits in the disk at the current saturation.
 */

import React, { useCallback, useEffect, useRef } from 'react';

const SIZE = 180;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUTER = 86;   // outer edge of hue ring
const R_INNER_RING = 70;   // inner edge of hue ring / outer edge of gap
const R_DISK = 66;    // inner disk radius

// ── Colour helpers ────────────────────────────────────────────────────────────

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hi = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (hi) {
    case 0: [r, g, b] = [v, t, p]; break;
    case 1: [r, g, b] = [q, v, p]; break;
    case 2: [r, g, b] = [p, v, t]; break;
    case 3: [r, g, b] = [p, q, v]; break;
    case 4: [r, g, b] = [t, p, v]; break;
    case 5: [r, g, b] = [v, p, q]; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [h * 360, s, v];
}

// ── Canvas painter ────────────────────────────────────────────────────────────

function paintWheel(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(SIZE, SIZE);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - CX, dy = y - CY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let r = 0, g = 0, b = 0, a = 0;

      if (dist >= R_INNER_RING && dist <= R_OUTER) {
        // Hue ring — full sat/val, hue from angle
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
        [r, g, b] = hsvToRgb(angle, 1, 1);
        a = 255;
      } else if (dist < R_DISK) {
        // Inner disk — kept transparent; we'll paint it dynamically via a separate method
        // For now paint white-to-transparent so it looks clean at rest
        a = 0;
      }

      const i = (y * SIZE + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Full-rainbow disk: angle → hue, radius → saturation, white at centre.
 * Painted once on mount — no hue dependency, so no repainting needed.
 */
function paintDisk(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - CX, dy = y - CY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > R_DISK) continue;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
      const sat = dist / R_DISK;
      const [r, g, b] = hsvToRgb(angle, sat, 1);
      const i = (y * SIZE + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  r: number;
  g: number;
  b: number;
  onChange: (r: number, g: number, b: number) => void;
}

export default function ColorWheel({ r, g, b, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Offscreen canvas holds the static hue ring (painted once, never changes)
  const ringCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef<'ring' | 'disk' | null>(null);

  const [hue, sat] = rgbToHsv(r, g, b);

  // On mount: paint disk (full rainbow) then overlay hue ring. Both are static —
  // no repaint needed when the selected colour changes (only cursors move).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Disk: full rainbow painted directly onto the visible canvas
    paintDisk(canvas);
    // Ring: painted onto an offscreen canvas, then composited on top
    const offscreen = document.createElement('canvas');
    offscreen.width = SIZE;
    offscreen.height = SIZE;
    paintWheel(offscreen);
    ringCanvasRef.current = offscreen;
    canvas.getContext('2d')!.drawImage(offscreen, 0, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCoords = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const dx = x - CX, dy = y - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 180 + 360) % 360;
    return { dist, angle, dx, dy };
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { dist } = getCoords(e.currentTarget, e.clientX, e.clientY);
      if (dist >= R_INNER_RING && dist <= R_OUTER + 4) {
        dragging.current = 'ring';
      } else if (dist < R_DISK + 4) {
        dragging.current = 'disk';
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      handlePointerMove(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, g, b, onChange]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragging.current) return;
      const { dist, angle } = getCoords(e.currentTarget, e.clientX, e.clientY);
      const [currentH, currentS, currentV] = rgbToHsv(r, g, b);

      if (dragging.current === 'ring') {
        // Ring: change hue only, preserve sat and val
        const [nr, ng, nb] = hsvToRgb(angle, currentS, currentV > 0.05 ? currentV : 1);
        onChange(nr, ng, nb);
      } else {
        // Disk: pick hue from angle AND saturation from distance
        const newSat = Math.min(1, dist / R_DISK);
        const newHue = angle;
        const [nr, ng, nb] = hsvToRgb(newHue, newSat, currentV > 0.05 ? currentV : 1);
        onChange(nr, ng, nb);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, g, b, onChange]
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  // Cursor dot positions
  // Ring cursor: on ring at hue angle
  const hueRad = ((hue - 180) * Math.PI) / 180;
  const ringR = (R_INNER_RING + R_OUTER) / 2;
  const ringCursorX = CX + Math.cos(hueRad) * ringR;
  const ringCursorY = CY + Math.sin(hueRad) * ringR;

  // Disk cursor: at saturation distance along hue angle
  const diskCursorX = CX + Math.cos(hueRad) * sat * R_DISK;
  const diskCursorY = CY + Math.sin(hueRad) * sat * R_DISK;

  const currentHex = `rgb(${r},${g},${b})`;

  return (
    <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{ display: 'block', cursor: 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Ring cursor (hue position) */}
      <div
        style={{
          position: 'absolute',
          width: 12,
          height: 12,
          borderRadius: '50%',
          border: '2px solid #fff',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.8)',
          background: currentHex,
          transform: 'translate(-50%,-50%)',
          left: ringCursorX,
          top: ringCursorY,
          pointerEvents: 'none',
        }}
      />

      {/* Disk cursor (saturation position) */}
      <div
        style={{
          position: 'absolute',
          width: 8,
          height: 8,
          borderRadius: '50%',
          border: '1.5px solid rgba(255,255,255,0.8)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          background: 'transparent',
          transform: 'translate(-50%,-50%)',
          left: diskCursorX,
          top: diskCursorY,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
