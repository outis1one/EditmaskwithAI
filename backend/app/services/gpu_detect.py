"""
GPU detection and capability tiering.
Detects CUDA (NVIDIA/AMD-ROCm), MPS (Apple Silicon), or CPU fallback.
Called once at startup; result is cached for the process lifetime.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from typing import Optional


# Model IDs per VRAM tier — all publicly available on HuggingFace, no auth needed.
# SDXL variants are used for high/ultra; SD 2.x for medium/low (smaller VRAM footprint).
_MODEL_TIERS: dict[str, dict[str, str]] = {
    "ultra": {   # ≥16 GB VRAM
        "inpaint":  "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
        "txt2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "img2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "upscale":  "stabilityai/stable-diffusion-x4-upscaler",
    },
    "high": {    # 8–16 GB VRAM
        "inpaint":  "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
        "txt2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "img2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "upscale":  "stabilityai/stable-diffusion-x4-upscaler",
    },
    "medium": {  # 4–8 GB VRAM
        "inpaint":  "stabilityai/stable-diffusion-2-inpainting",
        "txt2img":  "stabilityai/stable-diffusion-2-1",
        "img2img":  "stabilityai/stable-diffusion-2-1",
        "upscale":  None,
    },
    "low": {     # <4 GB or CPU
        "inpaint":  "stabilityai/stable-diffusion-2-inpainting",
        "txt2img":  "stabilityai/stable-diffusion-2-1-base",
        "img2img":  "stabilityai/stable-diffusion-2-1-base",
        "upscale":  None,
    },
}


@dataclass
class GpuInfo:
    backend: str                               # cuda | mps | cpu
    device_name: str = "CPU"
    vram_gb: float = 0.0
    tier: str = "low"                          # ultra | high | medium | low
    fp16: bool = False
    capabilities: list[str] = field(default_factory=list)


def detect_gpu() -> GpuInfo:
    """Detect available compute backend, VRAM, and assign a capability tier."""
    try:
        import torch

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            vram_gb = props.total_memory / (1024 ** 3)
            tier = _vram_to_tier(vram_gb)
            return GpuInfo(
                backend="cuda",
                device_name=props.name,
                vram_gb=round(vram_gb, 1),
                tier=tier,
                fp16=True,
                capabilities=_caps_for_tier(tier),
            )

        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            vram_gb = _apple_usable_gb()
            tier = _vram_to_tier(vram_gb)
            return GpuInfo(
                backend="mps",
                device_name="Apple Silicon",
                vram_gb=round(vram_gb, 1),
                tier=tier,
                fp16=False,  # MPS is more stable with fp32
                capabilities=_caps_for_tier(tier),
            )

    except ImportError:
        pass

    return GpuInfo(
        backend="cpu",
        device_name="CPU (no GPU detected)",
        vram_gb=0.0,
        tier="low",
        fp16=False,
        capabilities=["txt2img", "inpaint", "img2img", "outpaint"],
    )


def _vram_to_tier(vram_gb: float) -> str:
    if vram_gb >= 16:
        return "ultra"
    if vram_gb >= 8:
        return "high"
    if vram_gb >= 4:
        return "medium"
    return "low"


def _apple_usable_gb() -> float:
    """Estimate GPU-usable unified memory on Apple Silicon (≈ half of total RAM)."""
    try:
        r = subprocess.run(
            ["sysctl", "-n", "hw.memsize"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0:
            return int(r.stdout.strip()) / (1024 ** 3) / 2
    except Exception:
        pass
    return 8.0


def _caps_for_tier(tier: str) -> list[str]:
    base = ["txt2img", "inpaint", "img2img", "outpaint"]
    if tier in ("ultra", "high"):
        return base + ["upscale_diffusion"]
    return base


def get_model_ids(tier: str) -> dict[str, Optional[str]]:
    """Return the model-ID map for a given tier."""
    return dict(_MODEL_TIERS.get(tier, _MODEL_TIERS["low"]))


# Process-level singleton — detect once, reuse everywhere.
_cached: Optional[GpuInfo] = None


def get_cached_gpu_info() -> GpuInfo:
    global _cached
    if _cached is None:
        _cached = detect_gpu()
    return _cached
