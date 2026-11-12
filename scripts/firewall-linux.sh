#!/usr/bin/env bash
# scripts/firewall-linux.sh
# Opens the game ports on the SERVER (Linux, ufw). Run once:
#   sudo bash scripts/firewall-linux.sh              # allow on every interface
#   sudo bash scripts/firewall-linux.sh tailscale0   # allow only on the Tailscale interface
#   sudo bash scripts/firewall-linux.sh zt+          # only on ZeroTier interfaces (ztxxxxxxxx)
# Clients need no rule: they only make outgoing connections.
set -euo pipefail
TCP_PORT="${TCP_PORT:-5000}"
UDP_PORT="${UDP_PORT:-5001}"
IFACE="${1:-}"

if ! command -v ufw >/dev/null; then
    echo "ufw is not installed (sudo apt install ufw). With plain iptables:"
    echo "  sudo iptables -A INPUT -p tcp --dport $TCP_PORT -j ACCEPT"
    echo "  sudo iptables -A INPUT -p udp --dport $UDP_PORT -j ACCEPT"
    exit 1
fi

if [ -n "$IFACE" ]; then
    ufw allow in on "$IFACE" to any port "$TCP_PORT" proto tcp
    ufw allow in on "$IFACE" to any port "$UDP_PORT" proto udp
else
    ufw allow "$TCP_PORT/tcp"
    ufw allow "$UDP_PORT/udp"
fi
# Keep SSH reachable before turning the firewall on.
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw --force enable
ufw status verbose
