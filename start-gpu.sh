#!/usr/bin/env bash
# start-gpu.sh — start the GPU container with Docker DNS fixed.
#
# The iptables rule restores Docker's default outbound DNS behaviour.
# It does NOT affect container isolation (namespaces, filesystems, etc.).
# The rule is lost on reboot, so this script re-applies it each time.
#
# Usage:
#   ./start-gpu.sh              # start (detached, with build)
#   ./start-gpu.sh --build      # force rebuild
#   ./start-gpu.sh logs -f      # tail logs
#   ./start-gpu.sh down         # stop and remove container

set -euo pipefail

# Apply DNS fix on Linux hosts that have iptables.
# Skipped silently on macOS and Windows (WSL without iptables).
if command -v iptables &>/dev/null && command -v sudo &>/dev/null; then
    if ! sudo iptables -C DOCKER-USER -p udp --dport 53 -j ACCEPT 2>/dev/null; then
        sudo iptables -I DOCKER-USER -p udp --dport 53 -j ACCEPT
        echo "[start-gpu] Docker DNS fix applied (iptables DOCKER-USER)"
    else
        echo "[start-gpu] Docker DNS rule already present — skipping"
    fi
fi

# Default: start detached with build. Pass any args to override.
if [ $# -eq 0 ]; then
    exec docker compose -f docker-compose.gpu.yml up -d --build
else
    exec docker compose -f docker-compose.gpu.yml "$@"
fi
