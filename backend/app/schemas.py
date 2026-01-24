from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime


# User schemas
class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


# Project schemas
class ProjectCreate(BaseModel):
    name: str


class ProjectResponse(BaseModel):
    id: int
    user_id: int
    name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Edit schemas
class EditRequest(BaseModel):
    prompt: str
    mode: str = "A"  # "A" or "B"
    selection_type: str  # "rectangle", "ellipse", "lasso"
    bbox: Dict[str, int]  # {x, y, width, height}
    feather_px: int = 0
    selection_data: Optional[Dict[str, Any]] = None


class EditResponse(BaseModel):
    id: int
    project_id: int
    created_at: datetime
    mode: str
    prompt: str
    selection_type: str
    bbox_json: str
    feather_px: int
    ai_provider: str
    status: str
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


# Image upload
class UploadResponse(BaseModel):
    project_id: int
    original_url: str
    current_url: str


# Generic responses
class StatusResponse(BaseModel):
    status: str
    message: Optional[str] = None
    data: Optional[Any] = None
