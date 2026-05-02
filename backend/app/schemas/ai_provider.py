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


class SummarizeRequest(BaseModel):
    text: str = Field(min_length=100, max_length=50000)
    provider_id: int = Field(ge=1)


class SummarizeResponse(BaseModel):
    summary: str
