from abc import ABC, abstractmethod
from typing import Optional
import httpx
import base64
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
        full_image_bytes: Optional[bytes] = None
    ) -> bytes:
        """
        Edit an image patch using AI

        Args:
            patch_image_bytes: The cropped patch to edit
            mask_image_bytes: Binary mask (same size as patch)
            prompt: Text description of desired changes
            mode: "A" (patch only) or "B" (patch + full image reference)
            full_image_bytes: Full image for context (mode B only)

        Returns:
            Regenerated patch as bytes
        """
        pass


class OpenAIProvider(AIProvider):
    """OpenAI DALL-E based image editing"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.openai.com/v1"

    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None
    ) -> bytes:
        """Edit image using OpenAI DALL-E"""

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
    """Stability AI based image editing"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.stability.ai/v1"

    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None
    ) -> bytes:
        """Edit image using Stability AI"""

        async with httpx.AsyncClient(timeout=60.0) as client:
            files = {
                'init_image': ('image.png', patch_image_bytes, 'image/png'),
                'mask_image': ('mask.png', mask_image_bytes, 'image/png'),
            }

            data = {
                'text_prompts[0][text]': prompt,
                'text_prompts[0][weight]': '1.0',
                'cfg_scale': '7',
                'samples': '1',
                'steps': '30',
            }

            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Accept': 'application/json'
            }

            response = await client.post(
                f"{self.base_url}/generation/stable-diffusion-xl-1024-v1-0/image-to-image/masking",
                files=files,
                data=data,
                headers=headers
            )

            response.raise_for_status()
            result = response.json()

            # Decode base64 image
            image_data = result['artifacts'][0]['base64']
            return base64.b64decode(image_data)


class MockAIProvider(AIProvider):
    """Mock provider for testing (returns original patch)"""

    async def edit_image(
        self,
        patch_image_bytes: bytes,
        mask_image_bytes: bytes,
        prompt: str,
        mode: str,
        full_image_bytes: Optional[bytes] = None
    ) -> bytes:
        """Return the original patch (for testing)"""
        return patch_image_bytes


def get_ai_provider() -> AIProvider:
    """Factory function to get the configured AI provider"""

    provider_name = settings.ai_provider.lower()

    if provider_name == "openai":
        if not settings.openai_api_key:
            raise ValueError("OpenAI API key not configured")
        return OpenAIProvider(settings.openai_api_key)

    elif provider_name == "stability":
        if not settings.stability_api_key:
            raise ValueError("Stability AI API key not configured")
        return StabilityAIProvider(settings.stability_api_key)

    elif provider_name == "mock":
        return MockAIProvider()

    else:
        raise ValueError(f"Unknown AI provider: {provider_name}")
