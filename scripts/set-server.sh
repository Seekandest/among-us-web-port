#!/usr/bin/env bash
# scripts/set-server.sh
# Tells THIS client laptop where the game server is, by writing frontend/server.json.
#   bash scripts/set-server.sh 100.101.102.103          # an IP (Tailscale 100.x, ZeroTier, LAN)
#   bash scripts/set-server.sh --tailscale server-laptop  # look the IP up in the tailnet
# Priority when the client starts: --server flag > GAME_SERVER env variable > server.json > 127.0.0.1
set -euo pipefail
TCP_PORT="${TCP_PORT:-5000}"
UDP_PORT="${UDP_PORT:-5001}"

if [ "${1:-}" = "--tailscale" ]; then
    IP="$(tailscale ip -4 "${2:?machine name}" | head -n1)"
else
    IP="${1:?usage: set-server.sh <ip> | --tailscale <machine name>}"
fi

FILE="$(cd "$(dirname "$0")/.." && pwd)/frontend/server.json"
printf '{\n    "server": "%s",\n    "tcpPort": %s,\n    "udpPort": %s\n}\n' "$IP" "$TCP_PORT" "$UDP_PORT" > "$FILE"
echo "Wrote $FILE:"
cat "$FILE"
echo "Now: cd frontend && npm run tcp   (or npm run udp)"
