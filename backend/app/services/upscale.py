"""
Upscale service — auto-detects best available method and runs it.

Priority (auto mode):
  1. Real-ESRGAN PyTorch + CUDA GPU       — fastest, best quality
  2. Real-ESRGAN PyTorch + Apple MPS       — fast on Apple Silicon
  3. Real-ESRGAN NCNN Vulkan binary        — fast on any GPU (Intel/AMD/integrated)
  4. Real-ESRGAN PyTorch CPU               — works, slow (warn user)
  5. Lanczos                               — always available, instant

Capability probe is run once at first call and cached.
"""

import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Optional

from PIL import Image

# ── Capability detection ──────────────────────────────────────────────────────

_caps: Optional[dict] = None


def probe_upscale_capabilities() -> dict:
    """
    Detect what upscaling hardware and software is available.
    Result is cached after first call.
    """
    global _caps
    if _caps is not None:
        return _caps

    caps = {
        "lanczos": True,
        "realesrgan_pytorch": False,
        "realesrgan_pytorch_device": None,   # "cuda" | "mps" | "cpu"
        "realesrgan_ncnn": False,
        "realesrgan_ncnn_path": None,
        "recommended": "lanczos",
        "recommended_label": "Lanczos (no AI upscaler found)",
        "methods": ["lanczos"],
    }

    # ── PyTorch path ──────────────────────────────────────────────────────────
    pytorch_device = None
    try:
        import torch
        if torch.cuda.is_available():
            pytorch_device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            pytorch_device = "mps"
        else:
            pytorch_device = "cpu"
    except ImportError:
        pass

    if pytorch_device:
        try:
            import realesrgan        # noqa: F401
            from basicsr.archs.rrdbnet_arch import RRDBNet  # noqa: F401
            caps["realesrgan_pytorch"] = True
            caps["realesrgan_pytorch_device"] = pytorch_device
            caps["methods"].append("realesrgan_pytorch")
        except ImportError:
            pass

    # ── NCNN Vulkan binary ────────────────────────────────────────────────────
    ncnn_path = _find_ncnn_binary()
    if ncnn_path:
        caps["realesrgan_ncnn"] = True
        caps["realesrgan_ncnn_path"] = str(ncnn_path)
        caps["methods"].append("realesrgan_ncnn")

    # ── Pick recommended ──────────────────────────────────────────────────────
    if caps["realesrgan_pytorch"] and pytorch_device in ("cuda", "mps"):
        device_label = "CUDA GPU" if pytorch_device == "cuda" else "Apple Silicon"
        caps["recommended"] = "realesrgan_pytorch"
        caps["recommended_label"] = f"Real-ESRGAN ({device_label})"
    elif caps["realesrgan_ncnn"]:
        caps["recommended"] = "realesrgan_ncnn"
        caps["recommended_label"] = "Real-ESRGAN NCNN (Vulkan)"
    elif caps["realesrgan_pytorch"] and pytorch_device == "cpu":
        caps["recommended"] = "realesrgan_pytorch"
        caps["recommended_label"] = "Real-ESRGAN (CPU — may be slow)"
    else:
        caps["recommended"] = "lanczos"
        caps["recommended_label"] = "Lanczos (install Real-ESRGAN for AI quality)"

    _caps = caps
    return caps


def _find_ncnn_binary() -> Optional[Path]:
    """Find realesrgan-ncnn-vulkan binary on the system."""
    # Check PATH first
    found = shutil.which("realesrgan-ncnn-vulkan")
    if found:
        return Path(found)

    # Check known install locations
    candidates = [
        Path("/app/data/models/realesrgan/realesrgan-ncnn-vulkan"),
        Path("/usr/local/bin/realesrgan-ncnn-vulkan"),
        Path.home() / ".local/bin/realesrgan-ncnn-vulkan",
        # Windows
        Path(r"C:/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan.exe"),
        # macOS Homebrew
        Path("/opt/homebrew/bin/realesrgan-ncnn-vulkan"),
        Path("/usr/local/bin/realesrgan-ncnn-vulkan"),
    ]
    for p in candidates:
        if p.exists() and os.access(p, os.X_OK):
            return p

    return None


def invalidate_caps_cache():
    """Call after installing new software so next probe picks it up."""
    global _caps
    _caps = None


# ── Upscale implementations ───────────────────────────────────────────────────

def _to_png_bytes(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def upscale_lanczos(image: Image.Image, scale: float) -> tuple[bytes, str]:
    """Pure Pillow Lanczos — instant, always available."""
    new_w = round(image.width * scale)
    new_h = round(image.height * scale)
    result = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    return _to_png_bytes(result), "lanczos"


def upscale_realesrgan_pytorch(image: Image.Image, scale: float) -> tuple[bytes, str]:
    """
    Real-ESRGAN via PyTorch.
    Uses CUDA > MPS > CPU automatically based on what's available.
    Scale factors: any float — upscales to nearest 2x or 4x model, then resizes to exact target.
    """
    import torch
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer

    caps = probe_upscale_capabilities()
    device = caps.get("realesrgan_pytorch_device", "cpu")

    # Choose model: x2 for scale <= 2.5, x4 otherwise
    model_scale = 2 if scale <= 2.5 else 4
    model = RRDBNet(
        num_in_ch=3, num_out_ch=3, num_feat=64,
        num_block=23, num_grow_ch=32, scale=model_scale
    )

    # Model path: check local cache first, then let RealESRGANer auto-download
    model_dir = Path("/app/data/models/realesrgan")
    model_dir.mkdir(parents=True, exist_ok=True)
    model_name = f"RealESRGAN_x{model_scale}plus.pth"
    model_path = model_dir / model_name
    if not model_path.exists():
        model_path = None  # RealESRGANer will download to its default cache

    upsampler = RealESRGANer(
        scale=model_scale,
        model_path=str(model_path) if model_path else None,
        model=model,
        tile=512,
        tile_pad=10,
        pre_pad=0,
        half=(device == "cuda"),  # fp16 only on CUDA
        device=torch.device(device),
    )

    import numpy as np
    img_bgr = np.array(image)[:, :, ::-1].copy()  # RGB→BGR
    enhanced, _ = upsampler.enhance(img_bgr, outscale=scale)
    result = Image.fromarray(enhanced[:, :, ::-1])  # BGR→RGB

    label = f"realesrgan_pytorch_{device}"
    return _to_png_bytes(result), label


def upscale_realesrgan_ncnn(image: Image.Image, scale: float) -> tuple[bytes, str]:
    """
    Real-ESRGAN via NCNN Vulkan binary — works on any GPU (Intel/AMD/integrated/Apple).
    Runs as subprocess with temp file I/O.
    """
    caps = probe_upscale_capabilities()
    binary = caps.get("realesrgan_ncnn_path")
    if not binary:
        raise RuntimeError("realesrgan-ncnn-vulkan binary not found")

    # NCNN only supports integer scales (2, 3, 4) natively
    # For non-integer scales: upscale to nearest integer, then resize to exact target
    model_scale = 4 if scale > 2.5 else 2
    target_w = round(image.width * scale)
    target_h = round(image.height * scale)

    with tempfile.TemporaryDirectory() as tmpdir:
        in_path  = Path(tmpdir) / "input.png"
        out_path = Path(tmpdir) / "output.png"

        image.save(in_path, format="PNG")

        # Model name for NCNN (bundled with binary)
        model_name = f"realesrgan-x{model_scale}plus"

        cmd = [
            binary,
            "-i", str(in_path),
            "-o", str(out_path),
            "-s", str(model_scale),
            "-n", model_name,
            "-f", "png",
        ]

        result_proc = subprocess.run(
            cmd, capture_output=True, timeout=300
        )
        if result_proc.returncode != 0:
            raise RuntimeError(
                f"realesrgan-ncnn-vulkan failed: {result_proc.stderr.decode()}"
            )

        result = Image.open(out_path).convert("RGB")

        # Resize to exact target if scale was non-integer
        if result.width != target_w or result.height != target_h:
            result = result.resize((target_w, target_h), Image.Resampling.LANCZOS)

    return _to_png_bytes(result), "realesrgan_ncnn"


# ── Public entry point ────────────────────────────────────────────────────────

def upscale_sync(image: Image.Image, scale: float, method: str = "auto") -> tuple[bytes, str]:
    """
    Upscale image synchronously. Call via run_in_executor from async context.

    method values:
      "auto"               — pick best available automatically
      "realesrgan_pytorch" — force PyTorch path
      "realesrgan_ncnn"    — force NCNN binary path
      "lanczos"            — force Lanczos

    Returns (png_bytes, method_used_label).
    """
    caps = probe_upscale_capabilities()

    if method == "auto":
        method = caps["recommended"]

    if method == "realesrgan_pytorch":
        if caps["realesrgan_pytorch"]:
            try:
                return upscale_realesrgan_pytorch(image, scale)
            except Exception as e:
                print(f"Real-ESRGAN PyTorch failed, falling back: {e}")
        # Fall through to next best
        if caps["realesrgan_ncnn"]:
            try:
                return upscale_realesrgan_ncnn(image, scale)
            except Exception as e:
                print(f"Real-ESRGAN NCNN fallback failed: {e}")
        return upscale_lanczos(image, scale)

    if method == "realesrgan_ncnn":
        if caps["realesrgan_ncnn"]:
            try:
                return upscale_realesrgan_ncnn(image, scale)
            except Exception as e:
                print(f"Real-ESRGAN NCNN failed, falling back: {e}")
        # Fall through
        if caps["realesrgan_pytorch"]:
            try:
                return upscale_realesrgan_pytorch(image, scale)
            except Exception as e:
                print(f"Real-ESRGAN PyTorch fallback failed: {e}")
        return upscale_lanczos(image, scale)

    # Default / lanczos
    return upscale_lanczos(image, scale)


async def upscale_image(image: Image.Image, scale: float, method: str = "auto") -> tuple[bytes, str]:
    """Async wrapper — runs upscale in thread pool to avoid blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, upscale_sync, image, scale, method)
