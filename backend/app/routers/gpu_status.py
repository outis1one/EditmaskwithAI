"""
GPU status and model management endpoints.
All under /api/gpu prefix.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import asyncio

router = APIRouter(prefix="/api/gpu", tags=["gpu"])


@router.get("/status")
async def gpu_status():
    """
    Return GPU capabilities, VRAM, tier, and per-model download/ready state.
    Frontend polls this to show GPU badge and tool availability.
    """
    from app.services.gpu_detect import get_cached_gpu_info, get_model_ids
    from app.services.local_diffusion import get_all_model_states

    info = get_cached_gpu_info()
    model_ids = get_model_ids(info.tier)

    return {
        "backend": info.backend,
        "device_name": info.device_name,
        "vram_gb": info.vram_gb,
        "compute_capability": info.compute_capability,
        "tier": info.tier,
        "fp16": info.fp16,
        "warnings": info.warnings,
        "capabilities": info.capabilities,
        "models": {
            op: {"model_id": mid, "available": mid is not None}
            for op, mid in model_ids.items()
        },
        "pipeline_states": get_all_model_states(),
    }


class PrefetchRequest(BaseModel):
    operations: Optional[List[str]] = None


@router.post("/prefetch")
async def prefetch_models(req: PrefetchRequest = PrefetchRequest()):
    """
    Kick off background model downloads for the requested operations.
    Returns immediately; poll /api/gpu/prefetch-status for progress.
    Default: prefetch inpaint, txt2img, img2img.
    """
    ops = req.operations or ["inpaint", "txt2img", "img2img"]
    valid = {"inpaint", "txt2img", "img2img", "outpaint", "upscale"}
    ops = [op for op in ops if op in valid]

    from app.services.local_diffusion import get_local_diffusion_provider
    provider = get_local_diffusion_provider()

    async def _prefetch():
        for op in ops:
            try:
                await provider._get_pipeline(op)
                print(f"[gpu] Prefetch complete: {op}")
            except Exception as exc:
                print(f"[gpu] Prefetch failed for {op}: {exc}")

    asyncio.create_task(_prefetch())
    return {"status": "prefetch_started", "operations": ops}


@router.get("/prefetch-status")
async def prefetch_status():
    """Poll model download / load progress."""
    from app.services.local_diffusion import get_all_model_states
    return {"models": get_all_model_states()}
