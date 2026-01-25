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

echo "=========================================="
echo "Starting FastAPI server..."
echo "=========================================="

# Start the server
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
