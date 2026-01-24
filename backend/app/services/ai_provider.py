from abc import ABC, abstractmethod
from typing import Optional, Dict
import httpx
import base64
import asyncio
from io import BytesIO
from app.config import settings


class AIProvider(ABC):
    """Abstract base class for AI providers"""

    @abstractmethod
    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None,
        model: Optional[str] = None
    ) -> bytes:
        """
        Edit an image patch using AI

        Args:
            patch_image_bytes: The cropped patch to edit
            mask_image_bytes: Binary mask (same size as patch)
            prompt: Text description of desired changes
            mode: "A" (patch only) or "B" (patch + full image reference)
            full_image_bytes: Full image for context (mode B only)
            model: Optional specific model to use

        Returns:
            Regenerated patch as bytes
        """
        pass


class OpenAIProvider(AIProvider):
    """OpenAI DALL-E 2 based image editing (NOTE: Lower quality than DALL-E 3)"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.openai.com/v1"

    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None,
        model: Optional[str] = None
    ) -> bytes:
        """Edit image using OpenAI DALL-E 2 (NOTE: Uses older model, lower quality)"""

        async with httpx.AsyncClient(timeout=60.0) as client:
            files = {
                'image': ('image.png', patch_image_bytes, 'image/png'),
                'mask': ('mask.png', mask_image_bytes, 'image/png'),
            }

            data = {
                'prompt': prompt,
                'n': 1,
                'size': '1024x1024'  # Will be adjusted based on input
            }

            headers = {
                'Authorization': f'Bearer {self.api_key}'
            }

            response = await client.post(
                f"{self.base_url}/images/edits",
                files=files,
                data=data,
                headers=headers
            )

            response.raise_for_status()
            result = response.json()

            # Download the generated image
            image_url = result['data'][0]['url']
            image_response = await client.get(image_url)
            image_response.raise_for_status()

            return image_response.content


class StabilityAIProvider(AIProvider):
    """Stability AI based image editing (SDXL Inpainting)"""

    # Available Stability AI engines
    MODELS = {
        'sdxl': 'stable-diffusion-xl-1024-v1-0',
        'sd15': 'stable-diffusion-v1-5',
        'sd21': 'stable-diffusion-512-v2-1',
    }

    def __init__(self, api_key: str, default_model: str = 'sdxl'):
        self.api_key = api_key
        self.base_url = "https://api.stability.ai/v1"
        self.default_model = default_model

    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None,
        model: Optional[str] = None
    ) -> bytes:
        """Edit image using Stability AI SDXL Inpainting"""

        # Select model
        model_key = model or self.default_model
        engine_id = self.MODELS.get(model_key, self.MODELS['sdxl'])

        async with httpx.AsyncClient(timeout=120.0) as client:
            files = {
                'init_image': ('image.png', patch_image_bytes, 'image/png'),
                'mask_image': ('mask.png', mask_image_bytes, 'image/png'),
            }

            # Optimized parameters for better quality
            data = {
                'text_prompts[0][text]': prompt,
                'text_prompts[0][weight]': '1.0',
                'cfg_scale': '8',  # Increased for better prompt adherence
                'samples': '1',
                'steps': '40',  # Increased for better quality
                'mask_source': 'MASK_IMAGE_WHITE',  # White areas are inpainted
            }

            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Accept': 'application/json'
            }

            response = await client.post(
                f"{self.base_url}/generation/{engine_id}/image-to-image/masking",
                files=files,
                data=data,
                headers=headers
            )

            response.raise_for_status()
            result = response.json()

            # Decode base64 image
            image_data = result['artifacts'][0]['base64']
            return base64.b64decode(image_data)


class ReplicateProvider(AIProvider):
    """Replicate API with multiple model support"""

    # Available Replicate models for inpainting
    MODELS = {
        # SDXL Inpainting - Best general purpose
        'sdxl-inpaint': {
            'version': 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
            'use_case': 'General purpose, high quality',
            'cost': '~$0.025/image',
            'best_for': ['general', 'landscapes', 'objects', 'textures']
        },
        # LaMa - Best for object removal
        'lama': {
            'version': 'andreasjansson/lama:7f4a2e3c95ab83c1d66ea26a66c27f93b64a2e5a3c5f7f4f4f4f4f4f4f4f4f4f',
            'use_case': 'Object removal and cleanup',
            'cost': '~$0.002/image',
            'best_for': ['removal', 'cleanup', 'erase']
        },
        # Realistic Vision - Best for human features (faces, bodies, hands)
        'realistic-vision': {
            'version': 'stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf',
            'use_case': 'Human features, realistic photos',
            'cost': '~$0.020/image',
            'best_for': ['face', 'body', 'hands', 'portrait', 'person', 'human']
        },
    }

    def __init__(self, api_key: str, default_model: str = 'sdxl-inpaint'):
        self.api_key = api_key
        self.base_url = "https://api.replicate.com/v1"
        self.default_model = default_model

    def _select_model_from_prompt(self, prompt: str) -> str:
        """Auto-select best model based on prompt keywords"""
        prompt_lower = prompt.lower()

        # Check for removal/cleanup keywords
        if any(word in prompt_lower for word in ['remove', 'erase', 'delete', 'cleanup']):
            return 'lama'

        # Check for human feature keywords
        if any(word in prompt_lower for word in ['hand', 'face', 'body', 'person', 'portrait', 'skin']):
            return 'realistic-vision'

        # Default to SDXL for general purpose
        return 'sdxl-inpaint'

    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None,
        model: Optional[str] = None
    ) -> bytes:
        """Edit image using Replicate with auto model selection"""

        # Auto-select model if not specified
        if not model:
            model = self._select_model_from_prompt(prompt)

        model_config = self.MODELS.get(model, self.MODELS['sdxl-inpaint'])

        # Convert bytes to base64 for Replicate API
        patch_b64 = base64.b64encode(patch_image_bytes).decode('utf-8')
        mask_b64 = base64.b64encode(mask_image_bytes).decode('utf-8')

        async with httpx.AsyncClient(timeout=120.0) as client:
            # Create prediction
            prediction_data = {
                "version": model_config['version'],
                "input": {
                    "image": f"data:image/png;base64,{patch_b64}",
                    "mask": f"data:image/png;base64,{mask_b64}",
                    "prompt": prompt,
                    "num_outputs": 1,
                    "guidance_scale": 7.5,
                    "num_inference_steps": 50,
                }
            }

            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }

            # Start prediction
            response = await client.post(
                f"{self.base_url}/predictions",
                json=prediction_data,
                headers=headers
            )
            response.raise_for_status()
            prediction = response.json()

            # Poll for completion
            prediction_url = prediction['urls']['get']
            max_attempts = 60  # 2 minutes max
            attempt = 0

            while attempt < max_attempts:
                await asyncio.sleep(2)  # Wait 2 seconds between polls

                status_response = await client.get(prediction_url, headers=headers)
                status_response.raise_for_status()
                status_data = status_response.json()

                if status_data['status'] == 'succeeded':
                    # Download result image
                    output_url = status_data['output'][0]
                    image_response = await client.get(output_url)
                    image_response.raise_for_status()
                    return image_response.content

                elif status_data['status'] == 'failed':
                    raise Exception(f"Replicate prediction failed: {status_data.get('error')}")

                attempt += 1

            raise Exception("Replicate prediction timed out")


class MockAIProvider(AIProvider):
    """Mock provider for testing (returns original patch)"""

    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None,
        model: Optional[str] = None
    ) -> bytes:
        """Return the original patch (for testing)"""
        return patch_image_bytes


def get_ai_provider(provider_name: Optional[str] = None, model: Optional[str] = None) -> AIProvider:
    """
    Factory function to get the configured AI provider

    Args:
        provider_name: Override default provider from settings
        model: Specific model to use (provider-dependent)

    Returns:
        AIProvider instance
    """

    provider = provider_name or settings.ai_provider
    provider = provider.lower()

    if provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("OpenAI API key not configured")
        return OpenAIProvider(settings.openai_api_key)

    elif provider == "stability":
        if not settings.stability_api_key:
            raise ValueError("Stability AI API key not configured")
        default_model = model or getattr(settings, 'stability_model', 'sdxl')
        return StabilityAIProvider(settings.stability_api_key, default_model=default_model)

    elif provider == "replicate":
        if not settings.replicate_api_key:
            raise ValueError("Replicate API key not configured")
        default_model = model or getattr(settings, 'replicate_model', 'sdxl-inpaint')
        return ReplicateProvider(settings.replicate_api_key, default_model=default_model)

    elif provider == "mock":
        return MockAIProvider()

    else:
        raise ValueError(f"Unknown AI provider: {provider}")
