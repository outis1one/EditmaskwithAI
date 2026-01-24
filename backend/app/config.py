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
    ai_provider: str = "mock"  # Options: openai, stability, replicate, mock

    # Provider API Keys
    openai_api_key: str = ""
    stability_api_key: str = ""
    replicate_api_key: str = ""

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
