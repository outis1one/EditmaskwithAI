"""
AI tools router — LaMa inpaint, background removal, remote generation, config.
All endpoints are under /api prefix.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import base64
import asyncio

from app.services.local_inpaint import (
    lama_inpaint, opencv_inpaint, lama_available, gpu_available, rembg_available,
)

router = APIRouter(prefix="/api", tags=["ai-tools"])


# ─── Request / response models ───────────────────────────────────────────────

class EraseRequest(BaseModel):
    image: str  # base64
    mask: str   # base64


class InpaintRemoteRequest(BaseModel):
    image: str
    mask: str
    prompt: str
    negative_prompt: Optional[str] = ""
    steps: Optional[int] = 30
    cfg_scale: Optional[float] = 7.5
    model: Optional[str] = None


class Txt2ImgRequest(BaseModel):
    prompt: str
    width: Optional[int] = 1024
    height: Optional[int] = 1024
    negative_prompt: Optional[str] = ""
    steps: Optional[int] = 30
    cfg_scale: Optional[float] = 7.5
    model: Optional[str] = None
    seed: Optional[int] = 0


class Img2ImgRequest(BaseModel):
    image: str
    prompt: str
    strength: Optional[float] = 0.75
    negative_prompt: Optional[str] = ""
    steps: Optional[int] = 30
    cfg_scale: Optional[float] = 7.5
    model: Optional[str] = None


class OutpaintRequest(BaseModel):
    image: str
    direction: str  # left | right | top | bottom
    size: Optional[int] = 256
    prompt: Optional[str] = ""


class BgRemoveRequest(BaseModel):
    image: str


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _decode(b64: str) -> bytes:
    return base64.b64decode(b64)


def _encode(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _require_remote(operation: str = None):
    from app.services.remote_provider import get_remote_provider
    provider = get_remote_provider(operation)
    if provider is None:
        op_hint = f"AI_PROVIDER_{operation.upper()} or " if operation else ""
        raise HTTPException(
            status_code=503,
            detail=f"No remote AI provider configured for '{operation or 'default'}'. "
                   f"Set {op_hint}AI_PROVIDER in .env (openai / invokeai / comfyui)."
        )
    return provider


# ─── Local inpaint endpoints ─────────────────────────────────────────────────

@router.post("/erase")
async def erase(req: EraseRequest):
    """
    Magic eraser: remove object / fill region using LaMa (local, no API key needed).
    Falls back to OpenCV if LaMa not installed.
    """
    try:
        image_bytes = _decode(req.image)
        mask_bytes = _decode(req.mask)

        if lama_available():
            result = await asyncio.get_event_loop().run_in_executor(
                None, lama_inpaint, image_bytes, mask_bytes
            )
            method = "lama"
        else:
            result = await asyncio.get_event_loop().run_in_executor(
                None, opencv_inpaint, image_bytes, mask_bytes
            )
            method = "opencv"

        return {"result": _encode(result), "method": method}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inpaint/lama")
async def inpaint_lama(req: EraseRequest):
    """LaMa structural inpainting."""
    if not lama_available():
        raise HTTPException(status_code=503, detail="simple-lama-inpainting not installed.")
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lama_inpaint, _decode(req.image), _decode(req.mask)
        )
        return {"result": _encode(result)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inpaint/fast")
async def inpaint_fast(req: EraseRequest):
    """OpenCV fast inpainting (CPU, milliseconds)."""
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, opencv_inpaint, _decode(req.image), _decode(req.mask)
        )
        return {"result": _encode(result)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/background/remove")
async def background_remove(req: BgRemoveRequest):
    """Remove background — rembg if available, else U2Net."""
    try:
        image_bytes = _decode(req.image)

        # Try rembg first
        if rembg_available():
            from app.services.local_inpaint import remove_background_rembg
            result = await asyncio.get_event_loop().run_in_executor(
                None, remove_background_rembg, image_bytes
            )
            return {"result": _encode(result), "method": "rembg"}

        # Fall back to U2Net (existing implementation)
        from PIL import Image
        from io import BytesIO as _BytesIO
        img = Image.open(_BytesIO(image_bytes)).convert("RGB")
        from app.routers.tools import _remove_background_u2net
        result = await _remove_background_u2net(img)
        return {"result": _encode(result), "method": "u2net"}

    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ─── Remote provider endpoints ───────────────────────────────────────────────

@router.post("/inpaint/remote")
async def inpaint_remote(req: InpaintRemoteRequest):
    """Inpaint via configured remote provider (InvokeAI / ComfyUI / OpenAI)."""
    provider = _require_remote("inpaint")
    try:
        params = {
            "negative_prompt": req.negative_prompt or "",
            "steps": req.steps,
            "cfg_scale": req.cfg_scale,
        }
        if req.model:
            params["model"] = req.model
        result = await provider.inpaint(_decode(req.image), _decode(req.mask), req.prompt, params)
        return {"result": _encode(result)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate/txt2img")
async def txt2img(req: Txt2ImgRequest):
    """Text-to-image via configured remote provider."""
    provider = _require_remote("txt2img")
    try:
        params = {
            "negative_prompt": req.negative_prompt or "",
            "steps": req.steps,
            "cfg_scale": req.cfg_scale,
            "seed": req.seed or 0,
        }
        if req.model:
            params["model"] = req.model
        result = await provider.txt2img(req.prompt, req.width, req.height, params)
        return {"result": _encode(result)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate/img2img")
async def img2img(req: Img2ImgRequest):
    """Image-to-image via configured remote provider."""
    provider = _require_remote("img2img")
    try:
        params = {
            "negative_prompt": req.negative_prompt or "",
            "steps": req.steps,
            "cfg_scale": req.cfg_scale,
        }
        if req.model:
            params["model"] = req.model
        result = await provider.img2img(_decode(req.image), req.prompt, req.strength, params)
        return {"result": _encode(result)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate/outpaint")
async def outpaint(req: OutpaintRequest):
    """Expand canvas in given direction via remote provider."""
    provider = _require_remote("outpaint")
    if req.direction not in ("left", "right", "top", "bottom"):
        raise HTTPException(status_code=400, detail="direction must be left/right/top/bottom")
    try:
        result = await provider.outpaint(_decode(req.image), req.direction, req.size, req.prompt or "")
        return {"result": _encode(result)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ─── Config / capabilities ────────────────────────────────────────────────────

class ConfigUpdateRequest(BaseModel):
    ai_provider: Optional[str] = None
    # Per-operation overrides (blank = use default)
    ai_provider_inpaint: Optional[str] = None
    ai_provider_txt2img: Optional[str] = None
    ai_provider_img2img: Optional[str] = None
    ai_provider_outpaint: Optional[str] = None
    # Credentials / URLs
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    invokeai_url: Optional[str] = None
    invokeai_default_model: Optional[str] = None
    comfyui_url: Optional[str] = None
    comfyui_default_model: Optional[str] = None
    replicate_api_key: Optional[str] = None
    stability_api_key: Optional[str] = None


@router.post("/config")
async def update_config(req: ConfigUpdateRequest):
    """
    Apply runtime provider settings (no restart needed).
    Values are applied to the live settings object in-process.
    They do NOT persist across restarts — set them in .env for permanence.
    """
    from app.config import settings

    _str_fields = [
        "ai_provider", "ai_provider_inpaint", "ai_provider_txt2img",
        "ai_provider_img2img", "ai_provider_outpaint",
        "openai_api_key", "openai_model",
        "invokeai_url", "invokeai_default_model",
        "comfyui_url", "comfyui_default_model",
        "replicate_api_key", "stability_api_key",
    ]
    for field in _str_fields:
        val = getattr(req, field, None)
        if val is not None:
            setattr(settings, field, val)

    return {
        "status": "ok",
        "ai_provider": settings.ai_provider,
        "overrides": {
            "inpaint":  settings.ai_provider_inpaint  or None,
            "txt2img":  settings.ai_provider_txt2img  or None,
            "img2img":  settings.ai_provider_img2img  or None,
            "outpaint": settings.ai_provider_outpaint or None,
        }
    }


async def _check_provider(operation: str) -> dict:
    """Health-check the provider for a specific operation."""
    from app.services.remote_provider import get_remote_provider
    try:
        p = get_remote_provider(operation)
        if p is None:
            return {"provider": None, "healthy": False}
        healthy = await asyncio.wait_for(p.health(), timeout=5.0)
        return {"provider": p.__class__.__name__.replace("Provider", "").lower(), "healthy": healthy}
    except Exception:
        return {"provider": None, "healthy": False}


@router.get("/config")
async def get_config():
    """
    Return capability flags so the frontend can show/hide tools.
    Includes per-operation provider assignments and health status.
    """
    from app.config import settings

    # Run health checks for each operation concurrently
    ops = ["inpaint", "txt2img", "img2img", "outpaint"]
    results = await asyncio.gather(*[_check_provider(op) for op in ops])
    op_status = dict(zip(ops, results))

    # Default provider for display (used when no per-op override)
    default_name = (settings.ai_provider or "").lower() or None

    return {
        "local": {
            "lama": lama_available(),
            "rembg": rembg_available(),
            "opencv": True,
            "gpu_detected": gpu_available(),
        },
        "remote": {
            "default_provider": default_name,
            # Legacy field kept for backwards compat with badge/capabilities checks
            "provider": default_name,
            "healthy": any(v["healthy"] for v in op_status.values()),
            "operations": op_status,
            "overrides": {
                "inpaint":  settings.ai_provider_inpaint  or None,
                "txt2img":  settings.ai_provider_txt2img  or None,
                "img2img":  settings.ai_provider_img2img  or None,
                "outpaint": settings.ai_provider_outpaint or None,
            },
        }
    }


# ─── SAM (Segment Anything) ──────────────────────────────────────────────────

class SegmentPointRequest(BaseModel):
    image: str                          # base64 PNG/JPEG
    points: list[list[int]]             # [[x, y], ...]  original image coords
    labels: list[int]                   # 1=include, 0=exclude — same length as points


@router.post("/segment/point")
async def segment_point(req: SegmentPointRequest):
    """
    Run SAM point-prompt segmentation.
    Returns a binary mask PNG (white = selected area).
    Auto-downloads the SAM ViT-B model (~375 MB) on first call.
    """
    if not req.points:
        raise HTTPException(status_code=400, detail="At least one point required.")
    if len(req.points) != len(req.labels):
        raise HTTPException(status_code=400, detail="points and labels must have the same length.")

    try:
        image_bytes = base64.b64decode(req.image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {e}")

    from app.services.sam_service import predict_points, get_install_status
    try:
        mask_bytes = await predict_points(
            image_bytes,
            [tuple(p) for p in req.points],
            req.labels,
        )
        return {
            "mask": base64.b64encode(mask_bytes).decode(),
            "sam_install": get_install_status(),
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/segment/install-status")
def segment_install_status():
    """Poll SAM model download progress."""
    from app.services.sam_service import get_install_status, sam_model_available
    status = get_install_status()
    status["model_ready"] = sam_model_available()
    return status


@router.post("/segment/install")
async def segment_install():
    """Trigger SAM model download explicitly (also auto-triggered on first /segment/point call)."""
    from app.services.sam_service import ensure_sam_installed, get_install_status
    asyncio.create_task(ensure_sam_installed())
    return get_install_status()


# ─── Enhance ─────────────────────────────────────────────────────────────────

import io as _io
import numpy as _np
import cv2 as _cv2
from PIL import Image as _Image

class EnhanceRequest(BaseModel):
    image: str          # base64
    strength: float = 1.0


def _enhance_image(image_bytes: bytes, strength: float) -> bytes:
    """
    Apply a chain of non-AI image enhancements, each blended with `strength` (0–1).

    Steps:
      1. Auto white balance (gray-world)
      2. CLAHE on L channel of LAB colorspace
      3. Auto saturation boost in HSV (×1.15, clamped)
      4. Mild unsharp mask (gaussian sigma=1.0, delta weight=0.3)
    """
    strength = max(0.0, min(1.0, float(strength)))

    # Decode to RGB numpy array
    pil = _Image.open(_io.BytesIO(image_bytes)).convert("RGB")
    orig = _np.array(pil, dtype=_np.float32)  # H×W×3, float [0,255]

    img = orig.copy()

    # ── Step 1: Auto white balance (gray-world) ──────────────────────────────
    mean_r = img[:, :, 0].mean()
    mean_g = img[:, :, 1].mean()
    mean_b = img[:, :, 2].mean()
    overall_mean = (mean_r + mean_g + mean_b) / 3.0

    def _scale(channel, channel_mean):
        if channel_mean == 0:
            return channel
        return channel * (overall_mean / channel_mean)

    wb = img.copy()
    wb[:, :, 0] = _np.clip(_scale(img[:, :, 0], mean_r), 0, 255)
    wb[:, :, 1] = _np.clip(_scale(img[:, :, 1], mean_g), 0, 255)
    wb[:, :, 2] = _np.clip(_scale(img[:, :, 2], mean_b), 0, 255)

    img = (orig + strength * (wb - orig)).clip(0, 255)

    # ── Step 2: CLAHE on L channel (LAB) ────────────────────────────────────
    img_u8 = img.astype(_np.uint8)
    lab = _cv2.cvtColor(img_u8, _cv2.COLOR_RGB2LAB)
    clahe = _cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_orig = lab[:, :, 0].copy()
    lab[:, :, 0] = clahe.apply(l_orig)
    # Blend L channel back using strength
    lab_blended = lab.copy()
    lab_blended[:, :, 0] = (l_orig + strength * (lab[:, :, 0].astype(_np.float32) - l_orig.astype(_np.float32))).clip(0, 255).astype(_np.uint8)
    img = _cv2.cvtColor(lab_blended, _cv2.COLOR_LAB2RGB).astype(_np.float32)

    # ── Step 3: Auto saturation boost (HSV, ×1.15) ──────────────────────────
    img_u8 = img.astype(_np.uint8)
    hsv = _cv2.cvtColor(img_u8, _cv2.COLOR_RGB2HSV).astype(_np.float32)
    s_orig = hsv[:, :, 1].copy()
    s_boosted = _np.clip(s_orig * 1.15, 0, 255)
    hsv[:, :, 1] = s_orig + strength * (s_boosted - s_orig)
    hsv = hsv.clip(0, 255).astype(_np.uint8)
    img = _cv2.cvtColor(hsv, _cv2.COLOR_HSV2RGB).astype(_np.float32)

    # ── Step 4: Mild unsharp mask (sigma=1.0, delta weight=0.3) ─────────────
    img_u8 = img.astype(_np.uint8)
    blurred = _cv2.GaussianBlur(img_u8, (0, 0), sigmaX=1.0)
    sharpness_delta = img_u8.astype(_np.float32) - blurred.astype(_np.float32)
    sharpened = img_u8.astype(_np.float32) + 0.3 * sharpness_delta * strength
    img = sharpened.clip(0, 255)

    # Encode result as PNG
    result_pil = _Image.fromarray(img.astype(_np.uint8), mode="RGB")
    buf = _io.BytesIO()
    result_pil.save(buf, format="PNG")
    return buf.getvalue()


@router.post("/enhance")
async def enhance(req: EnhanceRequest):
    """
    Non-AI image enhancement: auto white balance, CLAHE, saturation boost,
    and unsharp mask. Each step is blended proportionally to `strength` (0–1).
    """
    try:
        image_bytes = _decode(req.image)
        result = await asyncio.get_event_loop().run_in_executor(
            None, _enhance_image, image_bytes, req.strength
        )
        return {"result": _encode(result)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ─── Extract colors ───────────────────────────────────────────────────────────

class ExtractColorsRequest(BaseModel):
    image: str      # base64
    count: int = 6


def _extract_colors(image_bytes: bytes, count: int) -> list[str]:
    """
    Resize image to 150×150, k-means cluster pixels into `count` groups
    using pure numpy (no sklearn dependency), return hex strings by frequency.
    """
    import numpy as np
    from PIL import Image
    from io import BytesIO

    count = max(1, min(count, 32))

    pil    = Image.open(BytesIO(image_bytes)).convert("RGB").resize((150, 150))
    pixels = np.array(pil, dtype=np.float32).reshape(-1, 3)  # (22500, 3)
    n      = len(pixels)

    # Initialise centers with k-means++ seeding
    rng     = np.random.default_rng(42)
    centers = [pixels[rng.integers(n)]]
    for _ in range(count - 1):
        dists = np.min([np.sum((pixels - c) ** 2, axis=1) for c in centers], axis=0)
        probs = dists / dists.sum()
        centers.append(pixels[rng.choice(n, p=probs)])
    centers = np.array(centers)

    labels = np.zeros(n, dtype=np.int32)
    for _ in range(20):                         # max 20 iterations
        # Assign each pixel to nearest center
        dists  = np.sum((pixels[:, None] - centers[None]) ** 2, axis=2)  # (n, k)
        new_labels = np.argmin(dists, axis=1)
        if np.all(new_labels == labels):
            break
        labels = new_labels
        # Recompute centers
        for k in range(count):
            mask = labels == k
            if mask.any():
                centers[k] = pixels[mask].mean(axis=0)

    counts = np.bincount(labels, minlength=count)
    order  = np.argsort(-counts)

    return [
        "#{:02x}{:02x}{:02x}".format(*centers[i].astype(int).clip(0, 255))
        for i in order
    ]


@router.post("/extract-colors")
async def extract_colors(req: ExtractColorsRequest):
    """
    Extract dominant colors from an image using k-means clustering.
    Returns hex color strings sorted by frequency (most dominant first).
    """
    try:
        image_bytes = _decode(req.image)
        colors = await asyncio.get_event_loop().run_in_executor(
            None, _extract_colors, image_bytes, req.count
        )
        return {"colors": colors}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
