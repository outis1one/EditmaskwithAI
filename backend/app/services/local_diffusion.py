"""
Local GPU diffusion provider — HuggingFace Diffusers backend.

Implements the RemoteAIProvider interface so all existing routes work unchanged.
Models are lazy-loaded on first request and cached in memory.
VRAM-aware: picks the right model and memory optimisations per GPU tier.

Requires: diffusers, transformers, accelerate, safetensors (requirements.gpu.txt)
"""
from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from io import BytesIO
from typing import Optional

from PIL import Image

from app.services.gpu_detect import get_cached_gpu_info, get_model_ids
from app.services.remote_provider import RemoteAIProvider

# ── Download / load state tracking ──────────────────────────────────────────

_states: dict[str, dict] = {}
_states_lock = threading.Lock()


def _set_state(key: str, **kw):
    with _states_lock:
        _states.setdefault(key, {}).update(kw)


def get_all_model_states() -> list[dict]:
    with _states_lock:
        return list(_states.values())


# ── Pipeline cache with LRU eviction ─────────────────────────────────────────

class _PipelineCache:
    """Keep at most `maxsize` loaded pipelines; evicts LRU when full."""

    def __init__(self, maxsize: int = 2):
        self._cache: OrderedDict[str, object] = OrderedDict()
        self._maxsize = maxsize
        self._lock = asyncio.Lock()

    async def get(self, key: str):
        async with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
            return None

    async def put(self, key: str, pipe: object):
        async with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            else:
                if len(self._cache) >= self._maxsize:
                    evicted_key, evicted_pipe = self._cache.popitem(last=False)
                    _offload_pipe(evicted_pipe, evicted_key)
                self._cache[key] = pipe


def _offload_pipe(pipe, key: str):
    """Move pipeline to CPU and free GPU memory."""
    try:
        import torch
        pipe.to("cpu")
        torch.cuda.empty_cache()
        print(f"[local_gpu] Evicted pipeline '{key}' from GPU cache")
    except Exception:
        pass


# ── Provider ─────────────────────────────────────────────────────────────────

class LocalDiffusionProvider(RemoteAIProvider):
    """
    HuggingFace Diffusers local inference.
    All operations run in a thread pool to avoid blocking the event loop.
    """

    def __init__(self, max_cached_pipelines: int = 2):
        self._cache = _PipelineCache(maxsize=max_cached_pipelines)
        self._load_locks: dict[str, asyncio.Lock] = {}
        self._meta_lock = asyncio.Lock()

    # ── Internal helpers ──────────────────────────────────────────────────────

    @property
    def _info(self):
        return get_cached_gpu_info()

    @property
    def _device(self) -> str:
        return self._info.backend

    def _torch_dtype(self):
        import torch
        return torch.float16 if self._info.fp16 else torch.float32

    async def _lock_for(self, key: str) -> asyncio.Lock:
        async with self._meta_lock:
            if key not in self._load_locks:
                self._load_locks[key] = asyncio.Lock()
            return self._load_locks[key]

    def _load_pipeline_sync(self, pipe_type: str) -> object:
        """Synchronous model load — runs in thread pool so HF download progress works."""
        import torch
        from diffusers import (
            StableDiffusionInpaintPipeline,
            StableDiffusionXLInpaintPipeline,
            StableDiffusionPipeline,
            StableDiffusionXLPipeline,
            StableDiffusionImg2ImgPipeline,
            StableDiffusionXLImg2ImgPipeline,
            StableDiffusionUpscalePipeline,
        )

        info = self._info
        tier = info.tier
        device = self._device
        dtype = self._torch_dtype()
        model_ids = get_model_ids(tier)

        # Determine canonical operation key for inpaint-based ops
        op_key = "inpaint" if pipe_type in ("inpaint", "outpaint") else pipe_type
        model_id = model_ids.get(op_key)

        # Allow config-level model override
        try:
            from app.config import settings
            override_map = {
                "inpaint":  settings.hf_model_inpaint,
                "outpaint": settings.hf_model_inpaint,
                "txt2img":  settings.hf_model_txt2img,
                "img2img":  settings.hf_model_img2img,
            }
            override = override_map.get(pipe_type, "")
            if override:
                model_id = override
        except Exception:
            pass

        if not model_id:
            raise RuntimeError(
                f"No model configured for '{pipe_type}' on tier '{tier}'. "
                f"GPU may not have enough VRAM for this operation."
            )

        is_xl = "xl" in model_id.lower()
        _set_state(pipe_type, pipeline=pipe_type, model_id=model_id,
                   state="downloading", progress=0.0,
                   message=f"Downloading {model_id}…", error="")

        try:
            # Apply HuggingFace token if configured (needed for gated models)
            try:
                from app.config import settings
                if settings.hf_token:
                    import huggingface_hub
                    huggingface_hub.login(token=settings.hf_token, add_to_git_credential=False)
            except Exception:
                pass

            kwargs: dict = {"torch_dtype": dtype}
            if not is_xl:
                # Disable safety checker — we're editing existing images, not generating NSFW
                kwargs["safety_checker"] = None
                kwargs["requires_safety_checker"] = False

            if pipe_type == "inpaint" or pipe_type == "outpaint":
                cls = StableDiffusionXLInpaintPipeline if is_xl else StableDiffusionInpaintPipeline
            elif pipe_type == "txt2img":
                cls = StableDiffusionXLPipeline if is_xl else StableDiffusionPipeline
            elif pipe_type == "img2img":
                cls = StableDiffusionXLImg2ImgPipeline if is_xl else StableDiffusionImg2ImgPipeline
            elif pipe_type == "upscale":
                model_id = model_ids.get("upscale")
                if not model_id:
                    raise RuntimeError("Diffusion upscale model not available for this GPU tier.")
                cls = StableDiffusionUpscalePipeline
            else:
                raise ValueError(f"Unknown pipeline type: {pipe_type}")

            pipe = cls.from_pretrained(model_id, **kwargs)

            # Memory optimisations — applied based on VRAM tier:
            #   minimal/legacy: full aggressive offloading (sequential CPU offload)
            #   medium:         attention slicing + VAE slicing
            #   high/ultra:     VAE slicing only (VRAM is plentiful)
            try:
                pipe.enable_vae_slicing()
            except Exception:
                pass

            if tier in ("minimal", "legacy", "medium"):
                try:
                    pipe.enable_attention_slicing(1)  # slice_size=1 = most aggressive
                except Exception:
                    pass

            if tier in ("minimal", "legacy"):
                # Sequential CPU offload keeps only the active layer on GPU — very low VRAM
                # but adds overhead per-step. Skip .to(device) when this is active.
                if device == "cuda":
                    try:
                        pipe.enable_sequential_cpu_offload()
                    except Exception:
                        # Fallback: model stays on CPU entirely
                        pass
                elif device == "cpu":
                    pass  # already on CPU
                else:
                    pipe = pipe.to(device)
            else:
                pipe = pipe.to(device)

            _set_state(pipe_type, state="ready", progress=100.0, message="Ready")
            return pipe

        except Exception as exc:
            _set_state(pipe_type, state="failed", error=str(exc), message="Load failed")
            raise

    async def _get_pipeline(self, pipe_type: str) -> object:
        cached = await self._cache.get(pipe_type)
        if cached is not None:
            return cached

        lock = await self._lock_for(pipe_type)
        async with lock:
            # Re-check after acquiring per-key lock
            cached = await self._cache.get(pipe_type)
            if cached is not None:
                return cached

            loop = asyncio.get_event_loop()
            pipe = await loop.run_in_executor(None, self._load_pipeline_sync, pipe_type)
            await self._cache.put(pipe_type, pipe)
            return pipe

    # ── RemoteAIProvider interface ────────────────────────────────────────────

    async def inpaint(self, image_bytes: bytes, mask_bytes: bytes, prompt: str, params: dict) -> bytes:
        pipe = await self._get_pipeline("inpaint")
        info = self._info

        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        mask = Image.open(BytesIO(mask_bytes)).convert("L")
        orig_size = img.size

        target = 1024 if info.tier in ("ultra", "high") else 512
        img_r, mask_r = _resize_pair(img, mask, target)


        steps = int(params.get("steps", 30))
        cfg = float(params.get("cfg_scale", 7.5))
        neg = params.get("negative_prompt", "") or None

        def _run():
            result = pipe(
                prompt=prompt,
                negative_prompt=neg,
                image=img_r,
                mask_image=mask_r,
                num_inference_steps=steps,
                guidance_scale=cfg,
            ).images[0]
            return result.resize(orig_size, Image.LANCZOS)

        loop = asyncio.get_event_loop()
        result_img = await loop.run_in_executor(None, _run)
        return _to_png(result_img)

    async def txt2img(self, prompt: str, width: int, height: int, params: dict) -> bytes:
        pipe = await self._get_pipeline("txt2img")
        info = self._info

        max_dim = 1024 if info.tier in ("ultra", "high") else (768 if info.tier == "medium" else 512)
        w = min(width, max_dim) // 8 * 8
        h = min(height, max_dim) // 8 * 8

        steps = int(params.get("steps", 30))
        cfg = float(params.get("cfg_scale", 7.5))
        neg = params.get("negative_prompt", "") or None
        seed = int(params.get("seed", 0))

        device = self._device

        def _run():
            import torch
            gen = torch.Generator(device=device).manual_seed(seed) if seed else None
            return pipe(
                prompt=prompt,
                negative_prompt=neg,
                width=w,
                height=h,
                num_inference_steps=steps,
                guidance_scale=cfg,
                generator=gen,
            ).images[0]

        loop = asyncio.get_event_loop()
        result_img = await loop.run_in_executor(None, _run)
        return _to_png(result_img)

    async def img2img(self, image_bytes: bytes, prompt: str, strength: float, params: dict) -> bytes:
        pipe = await self._get_pipeline("img2img")
        info = self._info

        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        orig_size = img.size
        target = 1024 if info.tier in ("ultra", "high") else (768 if info.tier == "medium" else 512)
        img_r = _resize_square(img, target)

        steps = int(params.get("steps", 30))
        cfg = float(params.get("cfg_scale", 7.5))
        neg = params.get("negative_prompt", "") or None

        def _run():
            result = pipe(
                prompt=prompt,
                negative_prompt=neg,
                image=img_r,
                strength=strength,
                num_inference_steps=steps,
                guidance_scale=cfg,
            ).images[0]
            return result.resize(orig_size, Image.LANCZOS)

        loop = asyncio.get_event_loop()
        result_img = await loop.run_in_executor(None, _run)
        return _to_png(result_img)

    async def outpaint(self, image_bytes: bytes, direction: str, size: int, prompt: str) -> bytes:
        from PIL import ImageDraw

        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        w, h = img.size

        if direction == "right":
            new_size = (w + size, h)
            paste_at = (0, 0)
            mask_box = (w, 0, w + size, h)
        elif direction == "left":
            new_size = (w + size, h)
            paste_at = (size, 0)
            mask_box = (0, 0, size, h)
        elif direction == "bottom":
            new_size = (w, h + size)
            paste_at = (0, 0)
            mask_box = (0, h, w, h + size)
        else:  # top
            new_size = (w, h + size)
            paste_at = (0, size)
            mask_box = (0, 0, w, size)

        expanded = Image.new("RGB", new_size, (127, 127, 127))
        expanded.paste(img, paste_at)

        mask = Image.new("L", new_size, 0)
        draw = ImageDraw.Draw(mask)
        draw.rectangle(mask_box, fill=255)

        params: dict = {}
        fill_prompt = prompt or "seamless natural continuation of the scene"
        result = await self.inpaint(
            _to_png(expanded), _to_png(mask), fill_prompt, params
        )
        return result

    async def health(self) -> bool:
        return True

    def capabilities(self) -> list[str]:
        return self._info.capabilities


# ── Image helpers ─────────────────────────────────────────────────────────────

def _resize_pair(
    img: Image.Image, mask: Image.Image, target: int
) -> tuple[Image.Image, Image.Image]:
    """Resize image and mask so the longest side equals target, divisible by 8."""
    w, h = img.size
    scale = target / max(w, h)
    new_w = max(8, int(w * scale) // 8 * 8)
    new_h = max(8, int(h * scale) // 8 * 8)
    return (
        img.resize((new_w, new_h), Image.LANCZOS),
        mask.resize((new_w, new_h), Image.NEAREST),
    )


def _resize_square(img: Image.Image, target: int) -> Image.Image:
    w, h = img.size
    scale = target / max(w, h)
    new_w = max(8, int(w * scale) // 8 * 8)
    new_h = max(8, int(h * scale) // 8 * 8)
    return img.resize((new_w, new_h), Image.LANCZOS)


def _to_png(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Singleton ─────────────────────────────────────────────────────────────────

_provider: Optional[LocalDiffusionProvider] = None


def get_local_diffusion_provider(max_pipelines: int = 2) -> LocalDiffusionProvider:
    global _provider
    if _provider is None:
        _provider = LocalDiffusionProvider(max_cached_pipelines=max_pipelines)
    return _provider


async def prefetch_model_files() -> None:
    """
    Download model weight files to the HuggingFace disk cache without loading
    them into GPU memory.  Run as a background task at container startup so the
    first user request loads from disk (fast) rather than the internet (slow).
    """
    from app.services.gpu_detect import get_cached_gpu_info, get_model_ids

    info = get_cached_gpu_info()
    model_ids = get_model_ids(info.tier)

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("[local_gpu] huggingface_hub not installed — skipping model prefetch")
        return

    loop = asyncio.get_event_loop()

    # Override model IDs from config if provided
    try:
        from app.config import settings
        overrides = {
            "inpaint": settings.hf_model_inpaint,
            "txt2img": settings.hf_model_txt2img,
            "img2img": settings.hf_model_img2img,
        }
        for op, override in overrides.items():
            if override:
                model_ids[op] = override
    except Exception:
        pass

    seen: set[str] = set()
    for op, mid in model_ids.items():
        if not mid or mid in seen:
            continue
        seen.add(mid)

        _set_state(op, pipeline=op, model_id=mid, state="downloading",
                   progress=0.0, message=f"Downloading {mid}…", error="")
        print(f"[local_gpu] Prefetching model files: {mid}")

        def _dl(repo_id: str = mid):
            snapshot_download(
                repo_id=repo_id,
                # Skip TF/Flax/MsgPack variants — we only need PyTorch / safetensors
                ignore_patterns=["*.msgpack", "flax_*", "tf_*", "rust_model*"],
            )

        try:
            await loop.run_in_executor(None, _dl)
            _set_state(op, state="cached", progress=100.0,
                       message="Files cached — will load into GPU on first request")
            print(f"[local_gpu] ✓ Cached: {mid}")
        except Exception as exc:
            _set_state(op, state="download_failed", error=str(exc),
                       message="Download failed — will retry on first request")
            print(f"[local_gpu] Prefetch failed for {mid}: {exc}")
