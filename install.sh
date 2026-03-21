#!/usr/bin/env bash
# lites — Linux install script
# Usage: bash install.sh [--service]
#   --service   also install a systemd service that starts lites on boot

set -e

REPO="https://github.com/gadiiii/lites.git"
INSTALL_DIR="$HOME/lites"
SERVICE=false

for arg in "$@"; do
  [[ "$arg" == "--service" ]] && SERVICE=true
done

# ── Colours ───────────────────────────────────────────────────────────────────
R="\033[0;31m"; G="\033[0;32m"; Y="\033[0;33m"; B="\033[0;34m"; N="\033[0m"
info()    { echo -e "${B}[lites]${N} $*"; }
success() { echo -e "${G}[lites]${N} $*"; }
warn()    { echo -e "${Y}[lites]${N} $*"; }
error()   { echo -e "${R}[lites]${N} $*"; exit 1; }

echo ""
echo -e "${B}  lites DMX controller — Linux installer${N}"
echo "  ────────────────────────────────────────"
echo ""

# ── 1. Build tools ────────────────────────────────────────────────────────────
info "Checking build tools (needed for serialport native module)…"
if ! dpkg -l build-essential python3 git curl 2>/dev/null | grep -q "^ii" 2>/dev/null; then
  if command -v apt-get &>/dev/null; then
    info "Installing build-essential, python3, git, curl via apt…"
    sudo apt-get update -qq
    sudo apt-get install -y build-essential python3 git curl
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y gcc gcc-c++ make python3 git curl
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm base-devel python git curl
  else
    warn "Could not detect package manager. Make sure gcc, make, python3, git, and curl are installed."
  fi
fi
success "Build tools ready."

# ── 2. Node.js ────────────────────────────────────────────────────────────────
info "Checking Node.js…"
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VER" -lt 20 ]]; then
    warn "Node.js $NODE_VER found but lites requires ≥ 20. Upgrading via nvm…"
    NEED_NVM=true
  else
    success "Node.js $(node --version) found."
    NEED_NVM=false
  fi
else
  info "Node.js not found. Installing via nvm…"
  NEED_NVM=true
fi

if [[ "$NEED_NVM" == true ]]; then
  if ! command -v nvm &>/dev/null; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    # shellcheck disable=SC1090
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  fi
  nvm install 20
  nvm use 20
  success "Node.js $(node --version) ready."
fi

# ── 3. Clone / update repo ────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "lites already cloned at $INSTALL_DIR — pulling latest…"
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning lites into $INSTALL_DIR…"
  git clone "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── 4. Install dependencies ───────────────────────────────────────────────────
info "Installing npm dependencies (this builds the serialport native module)…"
npm install
success "Dependencies installed."

# ── 5. Build ──────────────────────────────────────────────────────────────────
info "Building shared + server + client…"
npm run build
success "Build complete."

# ── 6. Configure serial port ──────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

DETECTED_PORT=""
for p in /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyACM0; do
  if [[ -e "$p" ]]; then
    DETECTED_PORT="$p"
    break
  fi
done

if [[ -n "$DETECTED_PORT" ]]; then
  sed -i "s|^SERIAL_PORT=.*|SERIAL_PORT=$DETECTED_PORT|" .env
  success "Detected ENTTEC device at $DETECTED_PORT — written to .env"
else
  warn "No USB serial device found yet. Edit .env and set SERIAL_PORT after plugging in the ENTTEC device."
fi

# ── 7. USB / dialout permissions ──────────────────────────────────────────────
if ! groups "$USER" | grep -q dialout; then
  info "Adding $USER to the dialout group (required to open serial ports)…"
  sudo usermod -aG dialout "$USER"
  warn "You must log out and back in (or reboot) for the group change to take effect."
  NEEDS_RELOGIN=true
else
  success "User $USER is already in the dialout group."
  NEEDS_RELOGIN=false
fi

# ── 8. Systemd service (optional) ─────────────────────────────────────────────
if [[ "$SERVICE" == true ]]; then
  SERVICE_FILE="/etc/systemd/system/lites.service"
  NODE_BIN=$(command -v node)
  info "Installing systemd service…"
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=lites DMX Controller
After=network.target

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN server/dist/index.js
Restart=on-failure
RestartSec=5
User=$USER
EnvironmentFile=$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable lites
  sudo systemctl start lites
  success "lites service installed and started."
  info "Service commands:"
  echo "    sudo systemctl status lites"
  echo "    sudo systemctl restart lites"
  echo "    journalctl -u lites -f"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
success "Installation complete!"
echo ""
if [[ "$SERVICE" == true ]]; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo -e "  lites is running as a system service."
  echo -e "  Open ${B}http://${LAN_IP:-localhost}:3000${N} in any browser on your network."
else
  echo -e "  To start lites:"
  echo -e "    ${B}cd $INSTALL_DIR && npm start${N}"
  echo -e "  Then open ${B}http://localhost:3000${N} in your browser."
fi
if [[ "$NEEDS_RELOGIN" == true ]]; then
  echo ""
  warn "Remember: log out and back in before using the ENTTEC USB device."
fi
echo ""
