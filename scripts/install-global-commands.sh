#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "This script needs root to write /usr/local/bin"
  echo "Run: sudo bash scripts/install-global-commands.sh"
  exit 1
fi

install -m 755 "$ROOT_DIR/scripts/maxpush" /usr/local/bin/maxpush
install -m 755 "$ROOT_DIR/scripts/maxdeploy" /usr/local/bin/maxdeploy

echo "Installed commands:"
echo "- /usr/local/bin/maxpush"
echo "- /usr/local/bin/maxdeploy"
echo
echo "Usage (inside repo):"
echo "  maxpush \"commit message\""
echo "  maxdeploy"
