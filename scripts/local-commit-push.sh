#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: not a git repository"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
COMMIT_MSG="${*:-Update project $(date '+%Y-%m-%d %H:%M:%S')}"

echo "[local] branch: $BRANCH"
echo "[local] stage files"
git add -A

if git diff --cached --quiet; then
  echo "[local] no staged changes, nothing to commit"
else
  echo "[local] commit: $COMMIT_MSG"
  git commit -m "$COMMIT_MSG"
fi

echo "[local] push to origin/$BRANCH"
git push origin "$BRANCH"

echo "[local] done"
