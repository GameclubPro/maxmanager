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

if [ ! -f .env ]; then
  echo "[vps] .env not found in $ROOT_DIR"
  echo "[vps] create it first: cp .env.example .env"
  exit 1
fi

BOT_TOKEN_LINE="$(grep '^BOT_TOKEN=' .env || true)"
if [ -z "$BOT_TOKEN_LINE" ] || [ "$BOT_TOKEN_LINE" = "BOT_TOKEN=" ] || [ "$BOT_TOKEN_LINE" = "BOT_TOKEN=replace_me" ]; then
  echo "[vps] BOT_TOKEN is missing in .env"
  exit 1
fi

echo "[vps] restart service"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe max-moderation-bot >/dev/null 2>&1; then
    pm2 restart max-moderation-bot --update-env
  else
    pm2 start dist/index.js --name max-moderation-bot --cwd "$ROOT_DIR"
  fi
  pm2 save
else
  echo "[vps] pm2 not found; starting in foreground"
  npm start
fi

echo "[vps] done"
