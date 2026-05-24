from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


FeedbackCategory = str
FeedbackStatus = str

VALID_FEEDBACK_CATEGORIES = {"bug", "feature", "question", "other"}
VALID_FEEDBACK_STATUSES = {"open", "in_progress", "resolved", "closed"}


class FeedbackCreateRequest(BaseModel):
    category: FeedbackCategory = Field(default="bug")
    title: str = Field(min_length=2, max_length=160)
    content: str = Field(min_length=10, max_length=5000)
    contact: str | None = Field(default=None, max_length=120)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in VALID_FEEDBACK_CATEGORIES:
            raise ValueError("不支持的问题类型。")
        return normalized

    @field_validator("title", "content")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        normalized = " ".join(value.split()).strip()
        if not normalized:
            raise ValueError("字段不能为空。")
        return normalized

    @field_validator("contact")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split()).strip()
        return normalized or None


class FeedbackItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: FeedbackCategory
    title: str
    content: str
    contact: str | None = None
    screenshot_url: str | None = None
    status: FeedbackStatus
    admin_note: str = ""
    created_at: str | None = None
    updated_at: str | None = None
    resolved_at: str | None = None


class FeedbackListResponse(BaseModel):
    items: list[FeedbackItemResponse] = Field(default_factory=list)


class AdminFeedbackSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    uid: str
    nickname: str
    phone: str
    category: FeedbackCategory
    title: str
    content: str
    contact: str | None = None
    screenshot_url: str | None = None
    status: FeedbackStatus
    admin_note: str = ""
    created_at: str | None = None
    updated_at: str | None = None
    resolved_at: str | None = None


class AdminFeedbackListResponse(BaseModel):
    items: list[AdminFeedbackSummary] = Field(default_factory=list)
    page: int = 1
    page_size: int = 12
    total: int = 0
    total_pages: int = 1


class AdminFeedbackUpdateRequest(BaseModel):
    status: FeedbackStatus | None = Field(default=None)
    admin_note: str | None = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in VALID_FEEDBACK_STATUSES:
            raise ValueError("不支持的处理状态。")
        return normalized

    @field_validator("admin_note")
    @classmethod
    def normalize_admin_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()
