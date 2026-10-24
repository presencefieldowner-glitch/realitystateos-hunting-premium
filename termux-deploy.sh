#!/data/data/com.termux/files/usr/bin/bash
# RealityStateOS Hunting Premium — Termux setup and local deployment
# Usage:
#   bash termux-deploy.sh /sdcard/Download/realitystateos-hunting-premium.zip
#   bash termux-deploy.sh   (run inside an already-extracted project directory)

set -Eeuo pipefail
IFS=$'\n\t'

APP_NAME='realitystateos-hunting-premium'
DEFAULT_PORT='3000'
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
info(){ printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn(){ printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
fail(){ printf "${RED}[x]${RESET} %s\n" "$*" >&2; exit 1; }
trap 'rc=$?; printf "\n${RED}[x] Setup stopped (exit %s) at line %s.${RESET}\n" "$rc" "$LINENO" >&2; exit "$rc"' ERR

printf '\nRealityStateOS Hunting Premium — Termux Installer\n'
printf '%s\n' '--------------------------------------------------'

# Termux-only guard; don't attempt apt commands on a standard Linux host.
if [[ "${PREFIX:-}" != */com.termux/files/usr ]]; then
  warn 'This script is designed for Termux on Android.'
  read -r -p 'Continue anyway (you must install bash, unzip, openssl, and Node.js 20+ yourself)? [y/N] ' go
  [[ "$go" == 'y' || "$go" == 'Y' ]] || exit 1
fi

# Locate or unpack project. If already inside the project, reuse it.
PROJECT_DIR=''
if [[ -f "$(pwd)/package.json" && -f "$(pwd)/server.js" ]]; then
  PROJECT_DIR="$(pwd)"
  info "Using existing project directory: $PROJECT_DIR"
else
  ZIP_PATH="${1:-}"
  if [[ -z "$ZIP_PATH" ]]; then
    for candidate in \
      "$HOME/storage/downloads/${APP_NAME}.zip" \
      "$HOME/storage/downloads/realitystateos-hunting-premium.zip" \
      "$HOME/Download/${APP_NAME}.zip" \
      "$(pwd)/realitystateos-hunting-premium.zip" \
      "$(pwd)/${APP_NAME}.zip"; do
      if [[ -f "$candidate" ]]; then ZIP_PATH="$candidate"; break; fi
    done
  fi
  if [[ -z "$ZIP_PATH" || ! -f "$ZIP_PATH" ]]; then
    printf '\nCould not find the project ZIP automatically.\n'
    read -r -p 'Enter full path to realitystateos-hunting-premium.zip: ' ZIP_PATH
  fi
  [[ -f "$ZIP_PATH" ]] || fail "ZIP not found: $ZIP_PATH"

  WORK_DIR="$HOME/$APP_NAME"
  mkdir -p "$WORK_DIR"
  command -v unzip >/dev/null 2>&1 || {
    if command -v pkg >/dev/null 2>&1; then pkg install -y unzip; else fail 'unzip is missing; install it first.'; fi
  }
  info "Extracting project archive into $WORK_DIR"
  unzip -oq "$ZIP_PATH" -d "$WORK_DIR"
  if [[ -f "$WORK_DIR/package.json" && -f "$WORK_DIR/server.js" ]]; then
    PROJECT_DIR="$WORK_DIR"
  else
    # Handle ZIPs that contain a top-level project folder.
    FOUND_SERVER="$(find "$WORK_DIR" -mindepth 2 -maxdepth 4 -type f -name server.js -print -quit)"
    [[ -n "$FOUND_SERVER" ]] || fail 'Could not locate server.js in the extracted archive.'
    PROJECT_DIR="$(dirname "$FOUND_SERVER")"
  fi
fi

cd "$PROJECT_DIR"
[[ -f package.json && -f server.js && -f .env.example ]] || fail 'Project files are incomplete (package.json, server.js, or .env.example missing).'

# Install Termux packages.
if command -v pkg >/dev/null 2>&1; then
  info 'Updating Termux package lists and installing runtime tools…'
  pkg update -y
  pkg install -y nodejs-lts git openssl unzip
fi

command -v node >/dev/null 2>&1 || fail 'Node.js is unavailable. Install it with: pkg install nodejs-lts'
command -v npm >/dev/null 2>&1 || fail 'npm is unavailable. Reinstall Node.js with: pkg install nodejs-lts'
command -v openssl >/dev/null 2>&1 || fail 'OpenSSL is unavailable. Install it with: pkg install openssl'
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 20 )) || fail "Node.js 20+ is required; found $(node --version). Try: pkg install nodejs-lts"
info "Node.js $(node --version) and npm $(npm --version) detected."

# Preserve an existing configuration; create one only when absent.
if [[ ! -f .env ]]; then
  cp .env.example .env
  info 'Created .env from .env.example.'
else
  warn 'Existing .env found; it will be preserved.'
fi

# Generate a strong download-token secret only if the template/secret is missing.
if ! grep -qE '^DOWNLOAD_TOKEN_SECRET=.{32,}$' .env || grep -q 'replace_with_64_hex_char_random_secret' .env; then
  TOKEN_SECRET="$(openssl rand -hex 32)"
  if grep -q '^DOWNLOAD_TOKEN_SECRET=' .env; then
    sed "s|^DOWNLOAD_TOKEN_SECRET=.*|DOWNLOAD_TOKEN_SECRET=$TOKEN_SECRET|" .env > .env.tmp
    mv .env.tmp .env
  else
    printf '\nDOWNLOAD_TOKEN_SECRET=%s\n' "$TOKEN_SECRET" >> .env
  fi
  unset TOKEN_SECRET
  info 'Generated a new 256-bit download-token secret.'
fi
chmod 600 .env

# Configure sandbox credentials without echoing the client secret.
if grep -q 'replace_with_sandbox_client_id' .env || grep -q 'replace_with_sandbox_client_secret' .env; then
  printf '\nPayPal Sandbox configuration\n'
  printf '%s\n' 'Get test credentials from https://developer.paypal.com/dashboard/ → Apps & Credentials → Sandbox.'
  read -r -p 'Enter Sandbox Client ID (blank to configure later): ' PP_ID
  if [[ -n "$PP_ID" ]]; then
    read -r -s -p 'Enter Sandbox Client Secret (input hidden): ' PP_SECRET; printf '\n'
    [[ -n "$PP_SECRET" ]] || fail 'Client Secret cannot be empty when Client ID is provided.'
    # Use a temporary Node script so credentials containing shell metacharacters are safely escaped.
    PP_ID_VALUE="$PP_ID" PP_SECRET_VALUE="$PP_SECRET" node --input-type=module <<'NODE'
import fs from 'node:fs';
const file = '.env';
let s = fs.readFileSync(file, 'utf8');
const quote = v => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '')}"`;
s = s.replace(/^PAYPAL_ENV=.*$/m, 'PAYPAL_ENV=sandbox');
s = s.replace(/^PAYPAL_CLIENT_ID=.*$/m, `PAYPAL_CLIENT_ID=${quote(process.env.PP_ID_VALUE ?? '')}`);
s = s.replace(/^PAYPAL_CLIENT_SECRET=.*$/m, `PAYPAL_CLIENT_SECRET=${quote(process.env.PP_SECRET_VALUE ?? '')}`);
fs.writeFileSync(file, s, { mode: 0o600 });
NODE
    unset PP_ID PP_SECRET
    info 'Sandbox credentials saved to .env (not displayed).'
  else
    unset PP_ID
    warn 'PayPal credentials skipped. The storefront may load, but checkout will not work until configured.'
  fi
else
  info 'PayPal credentials appear configured; preserving existing values.'
fi

# Make sure production mode is not accidentally selected for local development.
if grep -q '^NODE_ENV=' .env; then
  sed 's/^NODE_ENV=.*/NODE_ENV=development/' .env > .env.tmp && mv .env.tmp .env
else
  printf '\nNODE_ENV=development\n' >> .env
fi
if ! grep -q '^BASE_URL=' .env; then printf '\nBASE_URL=http://localhost:3000\n' >> .env; fi

info 'Installing npm dependencies…'
npm install --no-audit --no-fund

info 'Checking JavaScript syntax…'
node --check server.js
if [[ -f public/app.js ]]; then node --check public/app.js; fi

printf '\nSetup checks passed.\n'
printf 'Project: %s\n' "$PROJECT_DIR"
printf 'Store URL: http://127.0.0.1:%s\n' "$DEFAULT_PORT"
printf '\nImportant: local startup is not public hosting. Keep this terminal session open.\n'
printf '%s\n' 'Before live sales: complete sandbox payment tests, configure HTTPS hosting, set BASE_URL, and use live PayPal credentials only after verification.'
printf '\n'
read -r -p 'Start the storefront now? [Y/n] ' START_NOW
if [[ -z "$START_NOW" || "$START_NOW" == 'y' || "$START_NOW" == 'Y' ]]; then
  info 'Starting RealityStateOS Hunting storefront. Press Ctrl+C to stop.'
  exec npm run dev
else
  info 'Setup complete. Start later with: cd "$PROJECT_DIR" && npm run dev'
fi
