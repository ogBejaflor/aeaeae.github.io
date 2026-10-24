#!/bin/bash
# Double-click to open the æ admin. Keep this window open while you edit.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js isn't installed yet."
  echo "  Download the LTS version from https://nodejs.org, install it,"
  echo "  then double-click start.command again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  Setting up (first time only)…"
  npm install --no-audit --no-fund || { read -n 1 -s -r -p "  Setup failed. Press any key to close."; exit 1; }
fi

node server.js --open
