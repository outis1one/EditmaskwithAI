#!/bin/bash
# =============================================================================
# AI Photo Edit - Container Startup Script
# =============================================================================
# This script runs when the container starts. It:
# 1. Downloads sample eye images if the catalog is empty
# 2. Ensures all directories exist
# 3. Starts the FastAPI server
# =============================================================================

set -e

echo "=========================================="
echo "AI Photo Edit - Starting Up"
echo "=========================================="

# Ensure data directories exist
mkdir -p /app/data/projects
mkdir -p /app/data/patches
mkdir -p /app/data/models

# Check if eye catalog needs to be populated
echo "Checking eye catalog..."
PATCHES_COUNT=$(find /app/data/patches -maxdepth 1 -type d | wc -l)

if [ "$PATCHES_COUNT" -le 1 ]; then
    echo "Eye catalog is empty. Downloading sample eyes..."
    python /scripts/download_sample_eyes.py || echo "Warning: Could not download sample eyes (non-fatal)"
else
    echo "Eye catalog has content, skipping download."
fi

echo ""
echo "Checking SAM model (Smart Select)..."
echo "------------------------------------------"
if [ -f "/app/data/models/sam_model.pth" ] || \
   [ -f "/app/data/models/sam_vit_b_01ec64.pth" ] || \
   [ -f "/app/data/models/sam_vit_l_0b3195.pth" ] || \
   [ -f "/app/data/models/sam_vit_h_4b8939.pth" ]; then
    echo "✓ SAM model found - Smart Select will use local AI (free, offline)"
else
    echo ""
    echo "⚠ SAM model not found"
    echo ""
    echo "  Smart Select will use Replicate API (requires REPLICATE_API_KEY)"
    echo ""
    echo "  To enable FREE offline Smart Select, run:"
    echo "    docker exec -it ai-photo-edit-backend python /scripts/download_sam_model.py"
    echo ""
    echo "  Model sizes: vit_b (375MB), vit_l (1.2GB), vit_h (2.5GB)"
    echo "  The model persists across container rebuilds."
    echo ""
fi

echo ""
echo "=========================================="
echo "Starting FastAPI server..."
echo "=========================================="

# Start the server
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
