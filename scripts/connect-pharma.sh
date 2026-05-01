#!/usr/bin/env bash
# Run on your LOCAL laptop to tunnel the API Manufacturing Schedule app
# from the devpod to your local browser.
#
#   chmod +x scripts/connect-pharma.sh
#   ./scripts/connect-pharma.sh
#
# Then open http://localhost:5173 in your browser.

set -euo pipefail

DEVPOD="${DEVPOD_HOST:-sairamc-go-fallback}"
PORT="${PORT:-5173}"

echo "🔌  Tunneling localhost:${PORT}  →  ${DEVPOD}:${PORT}"
echo "   (open http://localhost:${PORT} in your browser)"
echo "   Press Ctrl+C to disconnect."
echo

# -N : no remote shell
# -o ServerAliveInterval=30 : keep the link alive across NAT/firewalls
exec ssh -N \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -L "${PORT}:localhost:${PORT}" \
  "${DEVPOD}"
