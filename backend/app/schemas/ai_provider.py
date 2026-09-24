from __future__ import annotations

from pydantic import BaseModel, Field


class AiProviderCreate(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=1, max_length=500)
    api_key: str = Field(min_length=1, max_length=500)
    model: str = Field(min_length=1, max_length=100)


class AiProviderUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    api_key: str | None = Field(default=None, min_length=1, max_length=500)
    model: str | None = Field(default=None, min_length=1, max_length=100)
    is_active: bool | None = None


class AiProviderTestRequest(BaseModel):
    """Connection test input. Values are transient and never persisted here."""

    provider_id: int | None = Field(default=None, ge=1)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=100)


class AiProviderTestResponse(BaseModel):
    success: bool
    message: str


class AiProviderResponse(BaseModel):
    id: int
    label: str
    base_url: str
    api_key_masked: str
    model: str
    is_active: bool
    is_system: bool = False
    sort_order: int


class AiProviderListResponse(BaseModel):
    providers: list[AiProviderResponse]
