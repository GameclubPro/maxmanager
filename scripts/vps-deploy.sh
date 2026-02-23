#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: not a git repository"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "[vps] pull latest from origin/$BRANCH"
git fetch origin
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[vps] warning: local uncommitted changes detected; skip pull"
  exit 1
fi
git pull --ff-only origin "$BRANCH"

echo "[vps] install dependencies"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "[vps] build"
npm run build

echo "[vps] restart service"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe max-moderation-bot >/dev/null 2>&1; then
    pm2 restart max-moderation-bot
  else
    pm2 start dist/index.js --name max-moderation-bot
  fi
  pm2 save
else
  echo "[vps] pm2 not found; starting in foreground"
  npm start
fi

echo "[vps] done"
