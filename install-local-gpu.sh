#!/usr/bin/env bash
# install-local-gpu.sh — one-time setup for local GPU inference.
#
# Run this once on a new machine. It:
#   1. Installs the NVIDIA container toolkit (so Docker can use the GPU)
#   2. Installs a systemd service that permanently fixes Docker container DNS
#      (allows containers to resolve hostnames — does not touch ufw)
#   3. Restarts Docker so both changes take effect
#   4. Verifies the GPU is accessible inside Docker
#
# After this, use ./bring-up-local-gpu.sh each time to start the app.

set -euo pipefail

# ── Must run as root (or via sudo) ───────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    exec sudo bash "$0" "$@"
fi

echo "=================================================="
echo "  EditmaskwithAI — Local GPU one-time setup"
echo "=================================================="
echo ""

# ── 1. NVIDIA container toolkit ──────────────────────────────────────────────
if command -v nvidia-ctk &>/dev/null; then
    echo "✓ nvidia-container-toolkit already installed — skipping"
else
    echo "Installing nvidia-container-toolkit..."
    . /etc/os-release
    case "$ID" in
        ubuntu|debian)
            curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
                | gpg --dearmor -o /usr/share/keyrings/nvidia-ctk.gpg
            curl -fsSL "https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list" \
                | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-ctk.gpg] https://#g' \
                | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
            apt-get update -qq
            apt-get install -y nvidia-container-toolkit
            ;;
        rhel|fedora|rocky|centos|almalinux)
            dnf install -y nvidia-container-toolkit
            ;;
        *)
            echo "⚠ Unrecognised distro ($ID). Install nvidia-container-toolkit manually."
            echo "  See: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
            ;;
    esac
fi

nvidia-ctk runtime configure --runtime=docker

# ── 2. Permanent Docker DNS fix via systemd ───────────────────────────────────
# Adds a rule to the DOCKER-USER iptables chain so containers can resolve
# hostnames. Runs after docker.service on every boot. Does NOT touch ufw.
echo ""
echo "Installing docker-dns-fix systemd service..."

cat > /etc/systemd/system/docker-dns-fix.service << 'EOF'
[Unit]
Description=Allow Docker containers to resolve DNS (DOCKER-USER iptables rule)
After=docker.service
Requires=docker.service
BindsTo=docker.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c \
  'iptables -C DOCKER-USER -p udp --dport 53 -j ACCEPT 2>/dev/null || \
   iptables -I DOCKER-USER -p udp --dport 53 -j ACCEPT'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable docker-dns-fix.service
echo "✓ docker-dns-fix.service installed and enabled"

# ── 3. Restart Docker ─────────────────────────────────────────────────────────
echo ""
echo "Restarting Docker..."
systemctl restart docker
sleep 2
echo "✓ Docker restarted"

# ── 4. Apply DNS rule now (don't wait for next boot) ─────────────────────────
systemctl start docker-dns-fix.service
echo "✓ DNS fix applied"

# ── 5. Verify GPU access ─────────────────────────────────────────────────────
echo ""
echo "Verifying GPU access inside Docker..."
if docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi &>/dev/null; then
    echo "✓ GPU is accessible inside Docker"
else
    echo "⚠ GPU check failed. Is the NVIDIA driver installed on the host?"
    echo "  Check: nvidia-smi"
    echo "  Minimum driver version: 525"
fi

echo ""
echo "=================================================="
echo "  Setup complete."
echo "  Start the app with:  ./bring-up-local-gpu.sh"
echo "=================================================="
