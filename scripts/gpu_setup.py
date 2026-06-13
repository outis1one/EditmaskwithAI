#!/usr/bin/env python3
"""
GPU setup script — runs at container startup.
Detects GPU, logs capabilities and any warnings, reports the model tier.
Non-fatal: failures just print a warning and startup continues.
"""
import os
import sys


def main():
    print("Detecting GPU…")

    backend = "cpu"
    device_name = "CPU"
    vram_gb = 0.0
    compute_cap = ""
    tier = "minimal"

    try:
        import torch

        if torch.cuda.is_available():
            backend = "cuda"
            props = torch.cuda.get_device_properties(0)
            device_name = props.name
            vram_gb = props.total_memory / (1024 ** 3)
            compute_cap = f"{props.major}.{props.minor}"
            use_fp16 = props.major >= 6

            if vram_gb >= 16:
                tier = "ultra"
            elif vram_gb >= 8:
                tier = "high"
            elif vram_gb >= 4:
                tier = "medium"
            elif vram_gb >= 2:
                tier = "legacy"
            else:
                tier = "minimal"

            fp16_str = "fp16" if use_fp16 else "fp32 (CC<6.0)"
            print(f"✓ CUDA GPU : {device_name}")
            print(f"  VRAM     : {vram_gb:.1f} GB")
            print(f"  Compute  : {compute_cap}  ({fp16_str})")
            print(f"  Tier     : {tier}")

            # Per-tier model summary
            tier_info = {
                "ultra":   "SDXL inpaint + SDXL base (best quality, needs ≥16 GB)",
                "high":    "SDXL inpaint + SDXL base (needs ≥8 GB)",
                "medium":  "SD 2.x inpaint + SD 2.1 (needs ≥4 GB fp16)",
                "legacy":  "SD 1.5 inpaint + SD 1.5 base (2–4 GB — older GPU mode)",
                "minimal": "SD 1.5 + sequential CPU offload (<2 GB — very slow)",
            }
            print(f"  Models   : {tier_info.get(tier, 'SD 1.5')}")

            if not use_fp16:
                print(
                    "  ⚠ GPU compute capability is below 6.0 (Pascal). "
                    "fp32 will be used, doubling VRAM requirements. "
                    "A GTX 1000-series or newer GPU would enable fp16."
                )
            if tier in ("minimal", "legacy"):
                print(
                    "  ⚠ Low VRAM: sequential CPU offload will be enabled. "
                    "Expect 2–5 minutes per image on a legacy GPU."
                )

        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            backend = "mps"
            device_name = "Apple Silicon"
            print("✓ Apple Silicon MPS GPU detected")
            print("  Note: fp32 used (fp16 less stable on MPS)")

        else:
            print("⚠ No GPU detected — AI_PROVIDER=local_gpu will run on CPU.")
            print("  Expect 5–20 minutes per image. Consider using a remote provider instead.")

    except ImportError:
        print("⚠ PyTorch not installed — GPU detection skipped")
        return

    provider = os.environ.get("AI_PROVIDER", "").lower()
    if provider != "local_gpu":
        print(f"  AI_PROVIDER={provider!r} — local GPU inference not active, skipping prefetch")
        return

    auto_dl = os.environ.get("AUTO_DOWNLOAD_MODELS", "true").lower()
    if auto_dl == "true":
        print("")
        print("  AUTO_DOWNLOAD_MODELS=true — model weights will download in the background.")
        print("  First request after download completes will load model into GPU (~20-60s).")
        print("  Pre-download now : POST /api/gpu/prefetch")
        print("  Check progress  : GET  /api/gpu/prefetch-status")
    else:
        print("  AUTO_DOWNLOAD_MODELS=false — models will download on first request.")


if __name__ == "__main__":
    main()
