#!/usr/bin/env bash
# Newswall — local static server.
# A real HTTP server is needed: from file:// YouTube embeds get a "null" origin
# and are refused.
set -euo pipefail
PORT="${1:-8080}"
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

echo "(Ctrl-C to stop)"
command -v open >/dev/null && (sleep 1 && open "http://localhost:${PORT}") &
exec python3 scripts/serve.py "${PORT}"
