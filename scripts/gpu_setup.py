#!/usr/bin/env python3
"""
GPU setup script — runs at container startup.
Detects GPU, logs capabilities, triggers background model prefetch when
AI_PROVIDER=local_gpu and AUTO_DOWNLOAD_MODELS=true.
Non-fatal: any failure just prints a warning.
"""
import os
import sys


def main():
    print("Detecting GPU…")

    backend = "cpu"
    device_name = "CPU"
    vram_gb = 0.0

    try:
        import torch

        if torch.cuda.is_available():
            backend = "cuda"
            props = torch.cuda.get_device_properties(0)
            device_name = props.name
            vram_gb = props.total_memory / (1024 ** 3)
            print(f"✓ CUDA GPU: {device_name} ({vram_gb:.1f} GB VRAM)")
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            backend = "mps"
            device_name = "Apple Silicon"
            print("✓ Apple Silicon MPS GPU detected")
        else:
            print("⚠ No GPU detected — AI_PROVIDER=local_gpu will use CPU (inference will be slow)")

    except ImportError:
        print("⚠ PyTorch not installed — GPU detection skipped")
        return

    provider = os.environ.get("AI_PROVIDER", "").lower()
    if provider != "local_gpu":
        print(f"  AI_PROVIDER={provider!r} — local GPU inference not active")
        return

    auto_dl = os.environ.get("AUTO_DOWNLOAD_MODELS", "true").lower()
    if auto_dl != "true":
        print("  AUTO_DOWNLOAD_MODELS=false — skipping model prefetch")
        print("  Models will download on first request and cache to ~/.cache/huggingface")
        return

    # Determine tier for a helpful startup message
    if vram_gb >= 16:
        tier, models_hint = "ultra", "SDXL (best quality)"
    elif vram_gb >= 8:
        tier, models_hint = "high", "SDXL"
    elif vram_gb >= 4:
        tier, models_hint = "medium", "Stable Diffusion 2.x"
    else:
        tier, models_hint = "low", "Stable Diffusion 2.x (small)"

    print(f"  GPU tier: {tier} → will use {models_hint} models")
    print("  Models will auto-download on first request (~2–7 GB per pipeline).")
    print("  To pre-download now: POST /api/gpu/prefetch")
    print("  Check progress at:   GET  /api/gpu/prefetch-status")


if __name__ == "__main__":
    main()
