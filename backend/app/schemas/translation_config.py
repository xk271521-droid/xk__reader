from __future__ import annotations

from pydantic import BaseModel, Field


class TranslationConfigResponse(BaseModel):
    provider: str = "baidu"
    app_id: str = ""
    has_secret_key: bool = False
    is_configured: bool = False
    updated_at: str | None = None


class TranslationConfigUpdate(BaseModel):
    app_id: str = Field(..., min_length=1, max_length=128)
    # Existing users may change the APP ID without re-entering the encrypted
    # secret. New configurations still require it in the route handler.
    secret_key: str | None = Field(default=None, max_length=512)


class BaiduTranslationTestRequest(BaseModel):
    app_id: str | None = Field(default=None, max_length=128)
    secret_key: str | None = Field(default=None, max_length=512)
    text: str = Field(default="Hello", min_length=1, max_length=200)


class BaiduTranslationTestResponse(BaseModel):
    success: bool
    result: str = ""
    error_message: str | None = None
