from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite:///./data/ai_photo_edit.db"

    # Security
    secret_key: str = "your-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # AI Provider
    # Local: blank or "mock" — always available, no config needed
    # Remote (set ONE): openai | invokeai | comfyui | replicate | stability
    ai_provider: str = "mock"

    # Provider API Keys
    openai_api_key: str = ""
    openai_model: str = "dall-e-3"
    stability_api_key: str = ""
    replicate_api_key: str = ""

    # InvokeAI (self-hosted)
    invokeai_url: str = ""
    invokeai_default_model: str = "flux-dev"

    # ComfyUI (self-hosted)
    comfyui_url: str = ""
    comfyui_default_model: str = "v1-5-pruned-emaonly.ckpt"

    # Model Selection (optional, provider-specific)
    stability_model: str = "sdxl"  # Options: sdxl, sd15, sd21
    replicate_model: str = "sdxl-inpaint"  # Options: sdxl-inpaint, lama, realistic-vision

    # Allow per-edit model override
    allow_model_override: bool = True

    # File Storage
    data_dir: str = "./data"
    max_upload_size_mb: int = 50

    # CORS
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
