#!/bin/bash
# =============================================================================
# AI Photo Edit - Container Startup Script
# =============================================================================
# This script runs when the container starts. It:
# 1. Initializes the database
# 2. Downloads SAM model automatically (can be disabled with AUTO_DOWNLOAD_SAM=false)
# 3. Downloads sample eye images if the catalog is empty
# 4. Starts the FastAPI server
# =============================================================================

set -e

echo "=========================================="
echo "AI Photo Edit - Starting Up"
echo "=========================================="

# Ensure data directories exist
mkdir -p /app/data/projects
mkdir -p /app/data/patches
mkdir -p /app/data/models
mkdir -p /app/data/patch_library

# Initialize database FIRST (before eye import)
echo ""
echo "Initializing database..."
echo "------------------------------------------"
cd /app && python /scripts/init_database.py || echo "Warning: Database init failed (non-fatal)"

# Check and download SAM model automatically
echo ""
echo "Checking SAM model (Smart Select)..."
echo "------------------------------------------"
if [ -f "/app/data/models/sam_model.pth" ] || \
   [ -f "/app/data/models/sam_vit_b_01ec64.pth" ] || \
   [ -f "/app/data/models/sam_vit_l_0b3195.pth" ] || \
   [ -f "/app/data/models/sam_vit_h_4b8939.pth" ]; then
    echo "✓ SAM model found - Smart Select will use local AI (free, offline)"
else
    # Auto-download SAM unless explicitly disabled
    AUTO_DOWNLOAD_SAM="${AUTO_DOWNLOAD_SAM:-true}"
    if [ "$AUTO_DOWNLOAD_SAM" = "true" ]; then
        echo "SAM model not found. Downloading automatically..."
        echo "(This is a one-time ~375MB download that persists across rebuilds)"
        echo ""
        python /scripts/download_sam_model.py vit_b || {
            echo ""
            echo "⚠ SAM download failed (non-fatal)"
            echo "  Smart Select will fall back to Replicate API (requires REPLICATE_API_KEY)"
            echo "  To retry later: docker exec -it ai-photo-edit-backend python /scripts/download_sam_model.py"
        }
    else
        echo ""
        echo "⚠ SAM model not found (AUTO_DOWNLOAD_SAM=false)"
        echo ""
        echo "  Smart Select will use Replicate API (requires REPLICATE_API_KEY)"
        echo ""
        echo "  To enable FREE offline Smart Select, run:"
        echo "    docker exec -it ai-photo-edit-backend python /scripts/download_sam_model.py"
        echo ""
    fi
fi

# Check if eye catalog needs to be populated
echo ""
echo "Checking eye catalog..."
echo "------------------------------------------"
PATCHES_COUNT=$(find /app/data/patches -maxdepth 1 -type d 2>/dev/null | wc -l)
DB_PATCHES_COUNT=$(sqlite3 /app/data/ai_photo_edit.db "SELECT COUNT(*) FROM patches;" 2>/dev/null || echo "0")

if [ "$DB_PATCHES_COUNT" = "0" ] || [ "$PATCHES_COUNT" -le 1 ]; then
    echo "Eye catalog is empty. Downloading sample eyes..."
    cd /app && python /scripts/download_sample_eyes.py || echo "Warning: Could not download sample eyes (non-fatal)"
else
    echo "✓ Eye catalog has $DB_PATCHES_COUNT patches"
fi

echo ""
echo "=========================================="
echo "Starting FastAPI server..."
echo "=========================================="

# Start the server
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
