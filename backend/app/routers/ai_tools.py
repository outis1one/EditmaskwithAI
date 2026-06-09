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


def _require_remote():
    from app.services.remote_provider import get_remote_provider
    provider = get_remote_provider()
    if provider is None:
        raise HTTPException(
            status_code=503,
            detail="No remote AI provider configured. Set AI_PROVIDER in .env (openai / invokeai / comfyui)."
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
    provider = _require_remote()
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
    provider = _require_remote()
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
    provider = _require_remote()
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
    provider = _require_remote()
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

    if req.ai_provider is not None:
        settings.ai_provider = req.ai_provider
    if req.openai_api_key:
        settings.openai_api_key = req.openai_api_key
    if req.openai_model:
        settings.openai_model = req.openai_model
    if req.invokeai_url is not None:
        settings.invokeai_url = req.invokeai_url
    if req.invokeai_default_model:
        settings.invokeai_default_model = req.invokeai_default_model
    if req.comfyui_url is not None:
        settings.comfyui_url = req.comfyui_url
    if req.comfyui_default_model:
        settings.comfyui_default_model = req.comfyui_default_model
    if req.replicate_api_key:
        settings.replicate_api_key = req.replicate_api_key
    if req.stability_api_key:
        settings.stability_api_key = req.stability_api_key

    return {"status": "ok", "ai_provider": settings.ai_provider}


@router.get("/config")
async def get_config():
    """
    Return capability flags so the frontend can show/hide tools.
    Frontend reads this on load.
    """
    from app.services.remote_provider import get_remote_provider
    from app.config import settings

    remote_caps: list[str] = []
    remote_healthy = False
    provider_name = (settings.ai_provider or "").lower()

    if provider_name in ("openai", "invokeai", "comfyui"):
        try:
            provider = get_remote_provider()
            if provider:
                remote_caps = provider.capabilities()
                remote_healthy = await asyncio.wait_for(provider.health(), timeout=5.0)
        except Exception:
            remote_healthy = False

    return {
        "local": {
            "lama": lama_available(),
            "rembg": rembg_available(),
            "opencv": True,
            "gpu_detected": gpu_available(),
        },
        "remote": {
            "provider": provider_name or None,
            "capabilities": remote_caps,
            "healthy": remote_healthy,
        }
    }
