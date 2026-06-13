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
#
# Tier selection by VRAM:
#   ultra  ≥16 GB → SDXL (best quality)
#   high   8–16 GB → SDXL
#   medium 4–8 GB → SD 2.x
#   legacy 2–4 GB → SD 1.5 (older / budget GPUs like GTX 970/1060/RX 580)
#   minimal <2 GB → SD 1.5 with heavy memory offloading (very slow, but functional)
#
# SD 1.5 uses ~1.7 GB VRAM in fp16; SD 2.x uses ~3.5 GB; SDXL uses ~6.5 GB.
_MODEL_TIERS: dict[str, dict[str, str]] = {
    "ultra": {
        "inpaint":  "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
        "txt2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "img2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "upscale":  "stabilityai/stable-diffusion-x4-upscaler",
    },
    "high": {
        "inpaint":  "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
        "txt2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "img2img":  "stabilityai/stable-diffusion-xl-base-1.0",
        "upscale":  "stabilityai/stable-diffusion-x4-upscaler",
    },
    "medium": {
        "inpaint":  "stabilityai/stable-diffusion-2-inpainting",
        "txt2img":  "stabilityai/stable-diffusion-2-1",
        "img2img":  "stabilityai/stable-diffusion-2-1",
        "upscale":  None,
    },
    # GTX 970 / GTX 1060 6 GB / RX 580 / etc. — 2–4 GB VRAM
    "legacy": {
        "inpaint":  "runwayml/stable-diffusion-inpainting",
        "txt2img":  "stable-diffusion-v1-5/stable-diffusion-v1-5",
        "img2img":  "stable-diffusion-v1-5/stable-diffusion-v1-5",
        "upscale":  None,
    },
    # Very old / integrated GPUs with <2 GB — runs but slowly; warns user.
    "minimal": {
        "inpaint":  "runwayml/stable-diffusion-inpainting",
        "txt2img":  "stable-diffusion-v1-5/stable-diffusion-v1-5",
        "img2img":  "stable-diffusion-v1-5/stable-diffusion-v1-5",
        "upscale":  None,
    },
}


@dataclass
class GpuInfo:
    backend: str                               # cuda | mps | cpu
    device_name: str = "CPU"
    vram_gb: float = 0.0
    compute_capability: str = ""               # e.g. "8.6" for RTX 3070
    tier: str = "legacy"                       # ultra | high | medium | legacy | minimal
    fp16: bool = False
    warnings: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)


def detect_gpu() -> GpuInfo:
    """Detect available compute backend, VRAM, compute capability, and assign tier."""
    try:
        import torch

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            vram_gb = props.total_memory / (1024 ** 3)
            cc = f"{props.major}.{props.minor}"
            # fp16 inference is reliable on Pascal (6.0) and newer.
            # Maxwell (5.x) technically works but is slower in fp16 than fp32 on some ops.
            use_fp16 = props.major >= 6
            tier = _vram_to_tier(vram_gb)
            warnings = _make_warnings(tier, vram_gb, cc, use_fp16)
            return GpuInfo(
                backend="cuda",
                device_name=props.name,
                vram_gb=round(vram_gb, 1),
                compute_capability=cc,
                tier=tier,
                fp16=use_fp16,
                warnings=warnings,
                capabilities=_caps_for_tier(tier),
            )

        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            vram_gb = _apple_usable_gb()
            tier = _vram_to_tier(vram_gb)
            return GpuInfo(
                backend="mps",
                device_name="Apple Silicon",
                vram_gb=round(vram_gb, 1),
                compute_capability="mps",
                tier=tier,
                fp16=False,  # MPS diffusion is more stable with fp32
                capabilities=_caps_for_tier(tier),
            )

    except ImportError:
        pass

    return GpuInfo(
        backend="cpu",
        device_name="CPU (no GPU detected)",
        vram_gb=0.0,
        tier="minimal",
        fp16=False,
        warnings=["No GPU found — running on CPU. Inference will be very slow (minutes per image)."],
        capabilities=["txt2img", "inpaint", "img2img", "outpaint"],
    )


def _vram_to_tier(vram_gb: float) -> str:
    if vram_gb >= 16:
        return "ultra"
    if vram_gb >= 8:
        return "high"
    if vram_gb >= 4:
        return "medium"
    if vram_gb >= 2:
        return "legacy"
    return "minimal"


def _make_warnings(tier: str, vram_gb: float, cc: str, fp16: bool) -> list[str]:
    """Generate human-readable warnings for suboptimal GPU configurations."""
    warns = []
    if tier == "minimal":
        warns.append(
            f"Very low VRAM ({vram_gb:.1f} GB) — inference will be slow and may OOM. "
            "Sequential CPU offloading will be enabled automatically."
        )
    elif tier == "legacy":
        warns.append(
            f"Limited VRAM ({vram_gb:.1f} GB) — using SD 1.5 models (smaller, lower quality "
            "than SD 2.x/SDXL). Still fully functional."
        )
    if not fp16:
        warns.append(
            f"GPU compute capability {cc} is below 6.0 — using fp32 (doubles VRAM use). "
            "Consider upgrading to a Pascal-era (GTX 1000) or newer GPU for fp16 support."
        )
    return warns


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
    return dict(_MODEL_TIERS.get(tier, _MODEL_TIERS["legacy"]))


# Process-level singleton — detect once, reuse everywhere.
_cached: Optional[GpuInfo] = None


def get_cached_gpu_info() -> GpuInfo:
    global _cached
    if _cached is None:
        _cached = detect_gpu()
    return _cached
