#!/usr/bin/env bash
# scripts/tailscale-check.sh  (Linux / macOS version of tailscale-check.ps1)
#   bash scripts/tailscale-check.sh server-laptop [count]
# Direct path = "pong ... via <ip>:<port>". Relayed = "pong ... via DERP(xxx)".
set -uo pipefail
SERVER="${1:?usage: tailscale-check.sh <server name or 100.x ip> [count]}"
COUNT="${2:-10}"

echo "== This laptop: $(tailscale ip -4 | head -n1)"
echo; echo "== tailscale netcheck"
tailscale netcheck 2>&1 | grep -E 'UDP:|IPv4:|MappingVariesByDestIP|Nearest DERP|PortMapping'
echo; echo "== tailscale ping $SERVER"
OUT="$(tailscale ping -c "$COUNT" "$SERVER" 2>&1)"
echo "$OUT"
LAST="$(echo "$OUT" | grep 'pong from' | tail -n1)"
echo; echo "== Verdict"
if [ -z "$LAST" ]; then echo "NO ANSWER: check 'tailscale status' on both machines"; exit 2
elif echo "$LAST" | grep -q 'via DERP'; then echo "RELAYED via DERP: UDP is tunnelled over TCP (see docs/TAILSCALE.md)"; exit 3
else echo "DIRECT path: good for both versions"; exit 0
fi
