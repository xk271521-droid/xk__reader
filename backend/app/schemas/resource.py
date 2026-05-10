from __future__ import annotations

from pydantic import BaseModel, Field


class ResourceLayoutPayload(BaseModel):
    resource_type: str = Field(min_length=1, max_length=64)
    x_pct: float = Field(ge=0, le=100)
    y_pct: float = Field(ge=0, le=100)
    rotation_deg: float = Field(default=0, ge=-30, le=30)


class ResourceLayoutResponse(BaseModel):
    resource_type: str
    x_pct: float
    y_pct: float
    rotation_deg: float
