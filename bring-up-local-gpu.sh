#!/usr/bin/env bash
# bring-up-local-gpu.sh — start the GPU container.
#
# Run this each time you want to start the app.
# Run ./install-local-gpu.sh once first on a new machine.
#
# Usage:
#   ./bring-up-local-gpu.sh              # start (detached, rebuild if needed)
#   ./bring-up-local-gpu.sh --no-build   # start without rebuilding
#   ./bring-up-local-gpu.sh down         # stop and remove container
#   ./bring-up-local-gpu.sh logs -f      # tail logs
#
# Force pip layer rebuild (e.g. after requirements change):
#   BUILDID=$(date +%s) ./bring-up-local-gpu.sh

set -euo pipefail

if [ $# -eq 0 ]; then
    exec docker compose -f docker-compose.gpu.yml up -d --build
else
    exec docker compose -f docker-compose.gpu.yml "$@"
fi
