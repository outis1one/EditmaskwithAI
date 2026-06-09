"""
Print / frame tools — frame fit and upscale.
All endpoints under /api/print prefix.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal
import base64
import asyncio
from io import BytesIO
from PIL import Image
import numpy as np

router = APIRouter(prefix="/api/print", tags=["print-tools"])

# ── Frame size catalogue (inches) ──────────────────────────────────────────
FRAME_SIZES = {
    "4x6":   (4, 6),
    "5x7":   (5, 7),
    "8x10":  (8, 10),
    "11x14": (11, 14),
    "16x20": (16, 20),
    "20x24": (20, 24),
    "24x36": (24, 36),
    # Square
    "4x4":   (4, 4),
    "8x8":   (8, 8),
    "12x12": (12, 12),
}


def _encode(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _decode(b64: str) -> bytes:
    return base64.b64decode(b64)


def _to_png(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Request models ─────────────────────────────────────────────────────────

class FrameFitRequest(BaseModel):
    image: str                              # base64 PNG/JPEG
    frame: str                              # e.g. "8x10"
    orientation: Literal["auto", "portrait", "landscape"] = "auto"
    mode: Literal["crop", "extend", "smart"] = "smart"
    dpi: int = 300
    # For extend mode: prompt passed to outpaint
    prompt: Optional[str] = ""
    # Smart mode threshold: extend if gap fraction < this, else crop
    smart_threshold: float = 0.15


class UpscaleRequest(BaseModel):
    image: str                              # base64
    scale: float = 2.0                      # 1.5, 2, 3, 4
    # auto = pick best available; lanczos = always works; realesrgan_pytorch / realesrgan_ncnn = explicit
    method: str = "auto"


# ── Frame sizes endpoint ───────────────────────────────────────────────────

@router.get("/frame-sizes")
def list_frame_sizes():
    """Return the catalogue of supported frame sizes."""
    return {
        "sizes": list(FRAME_SIZES.keys()),
        "catalogue": {k: {"inches": v, "pixels_300dpi": (v[0]*300, v[1]*300)}
                      for k, v in FRAME_SIZES.items()},
    }


# ── Frame fit ──────────────────────────────────────────────────────────────

@router.post("/frame-fit")
async def frame_fit(req: FrameFitRequest):
    """
    Fit an image to a print frame size.

    Modes:
      crop   — center-crop to frame aspect ratio, then scale to print resolution.
      extend — scale to fill one dimension, outpaint the gap with AI.
      smart  — extend if gap < smart_threshold of frame dimension, else crop.

    Returns the fitted image plus a summary of what was done.
    """
    if req.frame not in FRAME_SIZES:
        raise HTTPException(status_code=400,
                            detail=f"Unknown frame '{req.frame}'. Valid: {list(FRAME_SIZES.keys())}")
    if not (72 <= req.dpi <= 600):
        raise HTTPException(status_code=400, detail="dpi must be 72–600")

    try:
        image = Image.open(BytesIO(_decode(req.image))).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {e}")

    fw, fh = FRAME_SIZES[req.frame]  # frame inches (w, h in portrait)

    # Resolve orientation
    img_w, img_h = image.size
    img_landscape = img_w >= img_h
    frame_landscape = fw >= fh

    if req.orientation == "landscape":
        fw, fh = max(fw, fh), min(fw, fh)
    elif req.orientation == "portrait":
        fw, fh = min(fw, fh), max(fw, fh)
    else:  # auto — match image orientation
        if img_landscape and not frame_landscape:
            fw, fh = fh, fw  # rotate frame to landscape
        elif not img_landscape and frame_landscape:
            fw, fh = fh, fw  # rotate frame to portrait

    target_w = fw * req.dpi
    target_h = fh * req.dpi
    target_ratio = target_w / target_h
    img_ratio    = img_w / img_h

    # Determine actual mode
    mode = req.mode
    if mode == "smart":
        # Scale image to fill the frame — compute gap fraction
        if img_ratio > target_ratio:
            # Image wider → fits on height, gap on width
            scaled_h = target_h
            scaled_w = round(target_h * img_ratio)
            gap_frac = (scaled_w - target_w) / target_w  # positive = overflow (crop)
        else:
            scaled_w = target_w
            scaled_h = round(target_w / img_ratio)
            gap_frac = (scaled_h - target_h) / target_h

        # gap_frac > 0 means we'd need to crop; < 0 means we'd need to extend
        if gap_frac < 0:
            # Need to extend — use extend if gap is small enough
            mode = "extend" if abs(gap_frac) <= req.smart_threshold else "crop"
        else:
            mode = "crop"

    if mode == "crop":
        result, summary = _crop_fit(image, target_w, target_h)
    else:  # extend
        result, summary = await _extend_fit(image, target_w, target_h, req.prompt or "")

    return {
        "result": _encode(_to_png(result)),
        "mode_used": mode,
        "frame": req.frame,
        "orientation": "landscape" if fw > fh else "portrait",
        "output_pixels": {"width": result.width, "height": result.height},
        "output_inches": {"width": fw, "height": fh},
        "dpi": req.dpi,
        "summary": summary,
    }


def _crop_fit(image: Image.Image, target_w: int, target_h: int):
    """Center-crop image to target aspect ratio, then Lanczos scale to target size."""
    img_w, img_h = image.size
    target_ratio = target_w / target_h
    img_ratio = img_w / img_h

    if img_ratio > target_ratio:
        # Wider than target — crop sides
        new_w = round(img_h * target_ratio)
        x0 = (img_w - new_w) // 2
        cropped = image.crop((x0, 0, x0 + new_w, img_h))
    else:
        # Taller than target — crop top/bottom
        new_h = round(img_w / target_ratio)
        y0 = (img_h - new_h) // 2
        cropped = image.crop((0, y0, img_w, y0 + new_h))

    result = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)
    summary = (
        f"Cropped from {img_w}×{img_h} to {cropped.width}×{cropped.height}, "
        f"scaled to {target_w}×{target_h}"
    )
    return result, summary


async def _extend_fit(image: Image.Image, target_w: int, target_h: int, prompt: str):
    """
    Scale image to fill one dimension exactly, then outpaint the gap with AI.
    Falls back to content-aware mirror fill if no remote provider configured.
    """
    from app.services.remote_provider import get_remote_provider

    img_w, img_h = image.size
    target_ratio = target_w / target_h
    img_ratio = img_w / img_h

    if img_ratio > target_ratio:
        # Image wider — scale to target width, extend height
        scale = target_w / img_w
        scaled_w = target_w
        scaled_h = round(img_h * scale)
        gap_dir = "height"
        gap_top = (target_h - scaled_h) // 2
        gap_bottom = target_h - scaled_h - gap_top
    else:
        # Image taller — scale to target height, extend width
        scale = target_h / img_h
        scaled_h = target_h
        scaled_w = round(img_w * scale)
        gap_dir = "width"
        gap_left = (target_w - scaled_w) // 2
        gap_right = target_w - scaled_w - gap_left

    scaled = image.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

    # Place scaled image on canvas
    canvas = Image.new("RGB", (target_w, target_h), (128, 128, 128))
    if gap_dir == "height":
        canvas.paste(scaled, (0, gap_top))
        # Build mask: top and bottom strips are white (to inpaint)
        mask = Image.new("L", (target_w, target_h), 0)
        if gap_top > 0:
            mask.paste(Image.new("L", (target_w, gap_top), 255), (0, 0))
        if gap_bottom > 0:
            mask.paste(Image.new("L", (target_w, gap_bottom), 255), (0, target_h - gap_bottom))
    else:
        canvas.paste(scaled, (gap_left, 0))
        mask = Image.new("L", (target_w, target_h), 0)
        if gap_left > 0:
            mask.paste(Image.new("L", (gap_left, target_h), 255), (0, 0))
        if gap_right > 0:
            mask.paste(Image.new("L", (gap_right, target_h), 255), (target_w - gap_right, 0))

    # Try AI inpaint
    provider = get_remote_provider("inpaint")
    if provider:
        try:
            canvas_bytes = _to_png(canvas)
            mask_bytes = _to_png(mask)
            fill_prompt = prompt or "seamlessly continue the image, natural extension"
            result_bytes = await provider.inpaint(canvas_bytes, mask_bytes, fill_prompt, {})
            result = Image.open(BytesIO(result_bytes)).convert("RGB")
            summary = (
                f"Scaled {img_w}×{img_h} → {scaled_w}×{scaled_h}, "
                f"AI-extended {gap_dir} to {target_w}×{target_h}"
            )
            return result, summary
        except Exception as e:
            print(f"AI extend failed, using mirror fill: {e}")

    # Fallback: mirror-fill the gap (looks decent for backgrounds/landscapes)
    result = _mirror_fill(canvas, mask, scaled, gap_dir,
                          gap_top if gap_dir == "height" else gap_left,
                          gap_bottom if gap_dir == "height" else gap_right,
                          target_w, target_h)
    summary = (
        f"Scaled {img_w}×{img_h} → {scaled_w}×{scaled_h}, "
        f"mirror-filled {gap_dir} to {target_w}×{target_h} (no AI provider)"
    )
    return result, summary


def _mirror_fill(canvas, mask, scaled, gap_dir, gap_a, gap_b, target_w, target_h):
    """Fill gaps by reflecting the nearest edge strip."""
    result = canvas.copy()
    if gap_dir == "height":
        if gap_a > 0:
            strip = scaled.crop((0, 0, scaled.width, min(gap_a * 2, scaled.height)))
            strip = strip.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            strip = strip.resize((target_w, gap_a), Image.Resampling.LANCZOS)
            result.paste(strip, (0, 0))
        if gap_b > 0:
            strip = scaled.crop((0, max(0, scaled.height - gap_b * 2), scaled.width, scaled.height))
            strip = strip.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            strip = strip.resize((target_w, gap_b), Image.Resampling.LANCZOS)
            result.paste(strip, (0, target_h - gap_b))
    else:
        if gap_a > 0:
            strip = scaled.crop((0, 0, min(gap_a * 2, scaled.width), scaled.height))
            strip = strip.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            strip = strip.resize((gap_a, target_h), Image.Resampling.LANCZOS)
            result.paste(strip, (0, 0))
        if gap_b > 0:
            strip = scaled.crop((max(0, scaled.width - gap_b * 2), 0, scaled.width, scaled.height))
            strip = strip.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            strip = strip.resize((gap_b, target_h), Image.Resampling.LANCZOS)
            result.paste(strip, (target_w - gap_b, 0))
    return result


# ── Upscale ────────────────────────────────────────────────────────────────

@router.post("/upscale/refresh-caps")
def upscale_refresh_caps():
    """Bust the capability cache (call after installing Real-ESRGAN without restarting)."""
    from app.services.upscale import invalidate_caps_cache, probe_upscale_capabilities
    invalidate_caps_cache()
    return probe_upscale_capabilities()


@router.get("/upscale/available")
def upscale_available():
    """
    Return capability probe: which upscale methods are available,
    which device will be used, and which method is recommended.
    Frontend uses this to populate the method selector.
    """
    from app.services.upscale import probe_upscale_capabilities
    caps = probe_upscale_capabilities()
    return caps


@router.post("/upscale")
async def upscale(req: UpscaleRequest):
    """
    Upscale image.  method values:
      auto                — pick best available (recommended)
      realesrgan_pytorch  — Real-ESRGAN via PyTorch (CUDA/MPS/CPU)
      realesrgan_ncnn     — Real-ESRGAN NCNN Vulkan binary
      lanczos             — always available, instant
    Any AI method falls back to the next best if unavailable.
    """
    if not (1.1 <= req.scale <= 8.0):
        raise HTTPException(status_code=400, detail="scale must be 1.1–8.0")

    valid_methods = {"auto", "realesrgan_pytorch", "realesrgan_ncnn", "lanczos"}
    if req.method not in valid_methods:
        raise HTTPException(status_code=400,
                            detail=f"method must be one of {sorted(valid_methods)}")

    try:
        image = Image.open(BytesIO(_decode(req.image))).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {e}")

    orig_w, orig_h = image.size

    try:
        from app.services.upscale import upscale_image
        result_bytes, method_used = await upscale_image(image, req.scale, req.method)
        result = Image.open(BytesIO(result_bytes))
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "result": _encode(result_bytes),
        "method": method_used,
        "original": {"width": orig_w, "height": orig_h},
        "output":   {"width": result.width, "height": result.height},
        "scale":    req.scale,
    }
