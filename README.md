# lites — Local DMX Web Controller

A real-time DMX512 lighting controller with a web UI. The Node.js server drives an **ENTTEC DMX USB Pro** interface; the React frontend provides a Lightkey-inspired stage view accessible from any device on your local network.

```
┌──────────────────────────────────────────────────────┐
│  Browser (any device)                                │
│  React + Konva stage  ←──WebSocket──→  Node server   │
│                                            │         │
│                                       ENTTEC USB Pro │
│                                            │         │
│                                       DMX fixtures   │
└──────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |

---

## Quick Start

```bash
# 1. Clone / enter the project
cd lites

# 2. Install all dependencies (root + shared + server + client)
npm install

# 3. Copy and configure the environment file
cp .env.example .env
# Edit .env and set SERIAL_PORT to your ENTTEC device path (see below)

# 4. Start both server and client in development mode
npm run dev
```

Open **http://localhost:5173** in your browser.

> **No hardware?** The server runs fine without an ENTTEC device attached — it will log a warning and continue in headless mode. All UI controls still work and state is persisted.

---

## Serial Port Configuration

### macOS

The ENTTEC DMX USB Pro appears as a USB-serial device:

```bash
ls /dev/tty.usbserial*
# e.g. /dev/tty.usbserial-EN231234
```

Set in `.env`:
```
SERIAL_PORT=/dev/tty.usbserial-EN231234
```

macOS 12+ includes the FTDI driver built-in; no extra drivers needed.

### Linux (including Raspberry Pi)

The device appears as `/dev/ttyUSB0` (or `ttyUSB1` if other USB-serial devices are connected):

```bash
ls /dev/ttyUSB*
dmesg | grep ttyUSB   # confirm device name after plugging in
```

**Grant your user access to the serial port:**

```bash
sudo usermod -a -G dialout $USER
# Log out and back in (or reboot) for the group change to take effect
```

**Optional — persistent udev rule** (so the device always gets a predictable name):

```bash
# Find the idVendor and idProduct
udevadm info -a /dev/ttyUSB0 | grep -E 'idVendor|idProduct'
# ENTTEC Pro: idVendor=="0403", idProduct=="6001"

# Create rule
sudo tee /etc/udev/rules.d/99-enttec-dmx.rules <<'EOF'
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", \
  SYMLINK+="ttyDMX", GROUP="dialout", MODE="0664"
EOF

sudo udevadm control --reload-rules && sudo udevadm trigger
# Device now also available as /dev/ttyDMX
```

Set in `.env`:
```
SERIAL_PORT=/dev/ttyUSB0
```

### Windows

The device appears as a COM port (e.g. `COM3`). Check **Device Manager → Ports (COM & LPT)** after plugging in.

You may need to install the FTDI VCP driver from https://ftdichip.com/drivers/vcp-drivers/

Set in `.env`:
```
SERIAL_PORT=COM3
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERIAL_PORT` | `/dev/ttyUSB0` | Path to the ENTTEC DMX USB Pro serial device |
| `DMX_FPS` | `40` | DMX output frame rate (max ~44 for the Pro) |
| `WS_PORT` | `3000` | HTTP + WebSocket listen port |
| `SHOW_FILE` | `../data/show.json` | Path to the show data file (relative to `server/`) |

---

## Production Build

```bash
# Build everything (shared → server → client into server/dist/public)
npm run build

# Start the production server (serves the UI + WebSocket on one port)
npm start
# Open http://localhost:3000
```

---

## Project Structure

```
lites/
├── data/show.json          # Patch, profiles, and fixture positions (auto-saved)
├── shared/src/protocol.ts  # WebSocket message types (used by both server + client)
├── server/src/
│   ├── index.ts            # Entry point / boot sequence
│   ├── config.ts           # Env-based configuration
│   ├── dmxEngine.ts        # DMX universe buffer + ENTTEC serial output
│   ├── patch.ts            # Fixture/profile registry, universe write path
│   ├── websocket.ts        # WebSocket server + message routing
│   └── persistence.ts      # Debounced atomic show.json persistence
└── client/src/
    ├── store/useShowStore.ts   # Zustand store (fixture params, positions)
    ├── ws/useWebSocket.ts      # WS hook with rAF throttle
    └── components/
        ├── StageView.tsx       # Konva canvas stage
        ├── FixtureCircle.tsx   # Draggable fixture node
        ├── ControlPanel.tsx    # Right panel: dimmer + color wheel
        ├── ColorWheel.tsx      # HSV canvas color picker
        ├── DimmerSlider.tsx
        ├── BlackoutButton.tsx  # Latching blackout toggle
        └── StatusBar.tsx       # Connection indicator
```

---

## ENTTEC DMX USB Pro Protocol

The server implements the ENTTEC USB Pro API directly (no third-party DMX library) using `serialport`:

```
Frame (518 bytes):
  0x7E  — Start of message
  0x06  — Label: "Send DMX Packet Request"
  0x01  — Data length LSB (513 = 0x0201)
  0x02  — Data length MSB
  0x00  — DMX start code (always 0 for standard DMX512)
  [512] — Channel values, channels 1–512
  0xE7  — End of message
```

Serial settings: **57600 baud, 8 data bits, 2 stop bits, no parity**.
The Pro's FTDI microcontroller generates the DMX break and mark-after-break timing internally.

---

## Adding Fixtures

Edit `data/show.json` while the server is stopped (or restart after editing):

```json
"fixtures": {
  "moving1": {
    "id": "moving1",
    "name": "Moving Head 1",
    "address": 28,
    "profileId": "RGB_D"
  }
},
"fixtureParams": {
  "moving1": { "dimmer": 0, "red": 0, "green": 0, "blue": 0 }
},
"fixturePositions": {
  "moving1": { "x": 200, "y": 150 }
}
```

To add a new profile (e.g. a 5-channel fixture with strobe):

```json
"profiles": {
  "RGBD_S": {
    "id": "RGBD_S",
    "name": "RGB + Dimmer + Strobe",
    "channelCount": 5,
    "params": { "dimmer": 0, "red": 1, "green": 2, "blue": 3, "strobe": 4 }
  }
}
```

---

## Keyboard Shortcuts (planned)

| Key | Action |
|-----|--------|
| `Esc` | Deselect fixture |
| `Space` | Toggle blackout |

---

## Raspberry Pi Deployment Tips

- Use Node 20 LTS: `nvm install 20`
- `npm install` will build the serialport native binary; ensure `build-essential` and `python3` are installed: `sudo apt install build-essential python3`
- Run as a systemd service for auto-start on boot:

```ini
[Unit]
Description=lites DMX Controller
After=network.target

[Service]
WorkingDirectory=/home/pi/lites
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
User=pi
Environment=SERIAL_PORT=/dev/ttyUSB0

[Install]
WantedBy=multi-user.target
```
