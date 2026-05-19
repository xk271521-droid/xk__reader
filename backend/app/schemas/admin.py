from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.auth import EMAIL_PATTERN, PHONE_PATTERN


class AdminOverviewStats(BaseModel):
    total_users: int = 0
    active_users: int = 0
    admin_users: int = 0
    total_papers: int = 0
    active_papers: int = 0
    trashed_papers: int = 0
    total_providers: int = 0
    system_providers: int = 0
    user_providers: int = 0


class AdminOverviewTrendPoint(BaseModel):
    date: str
    registrations: int = 0
    imports: int = 0


class AdminOverviewResponse(BaseModel):
    stats: AdminOverviewStats
    activity_trend: list[AdminOverviewTrendPoint] = []
    recent_users: list["AdminUserSummary"] = []
    recent_papers: list["AdminPaperSummary"] = []


class AdminUserSummary(BaseModel):
    id: int
    uid: str
    nickname: str
    avatar_url: str | None = None
    phone: str
    email: str | None = None
    education: str = ""
    organization: str = ""
    occupation: str = ""
    discipline: str = ""
    status: str
    is_admin: bool
    education_verified: bool
    paper_count: int = 0
    import_count: int = 0
    latest_imported_at: str | None = None
    reading_record_count: int = 0
    reading_duration_seconds: int = 0
    latest_reading_at: str | None = None
    created_at: str | None = None
    last_login_at: str | None = None


class AdminUserListResponse(BaseModel):
    items: list[AdminUserSummary]
    page: int = 1
    page_size: int = 12
    total: int = 0
    total_pages: int = 1


class AdminUserDetailResponse(BaseModel):
    user: AdminUserSummary


class AdminUserUpdateRequest(BaseModel):
    status: str | None = Field(default=None, pattern="^(active|disabled)$")
    is_admin: bool | None = None
    education_verified: bool | None = None
    force_logout: bool | None = None
    temporary_password: str | None = Field(default=None, min_length=8, max_length=128)
    nickname: str | None = Field(default=None, min_length=2, max_length=80)
    phone: str | None = Field(default=None, min_length=11, max_length=20)
    email: str | None = Field(default=None, max_length=255)
    education: str | None = Field(default=None, min_length=1, max_length=50)
    occupation: str | None = Field(default=None, min_length=1, max_length=50)
    organization: str | None = Field(default=None, min_length=1, max_length=120)
    discipline: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("nickname", "education", "occupation", "organization", "discipline")
    @classmethod
    def strip_text_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空。")
        return normalized

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("手机号格式不正确。")
        return normalized

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        return normalized or None

    @model_validator(mode="after")
    def validate_email(self) -> "AdminUserUpdateRequest":
        if self.email and not EMAIL_PATTERN.fullmatch(self.email):
            raise ValueError("邮箱格式不正确。")
        return self


class AdminPaperSummary(BaseModel):
    id: int
    title: str
    file_name: str
    owner_uid: str
    owner_nickname: str
    page_count: int = 0
    is_trashed: bool = False
    created_at: str | None = None
    last_viewed_at: str | None = None


class AdminPaperListResponse(BaseModel):
    papers: list[AdminPaperSummary]
