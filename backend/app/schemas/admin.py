from __future__ import annotations

from pydantic import BaseModel, Field


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


class AdminOverviewResponse(BaseModel):
    stats: AdminOverviewStats
    recent_users: list["AdminUserSummary"] = []
    recent_papers: list["AdminPaperSummary"] = []


class AdminUserSummary(BaseModel):
    id: int
    uid: str
    nickname: str
    phone: str
    email: str | None = None
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
    users: list[AdminUserSummary]


class AdminUserDetailResponse(BaseModel):
    user: AdminUserSummary


class AdminUserUpdateRequest(BaseModel):
    status: str | None = Field(default=None, pattern="^(active|disabled)$")
    is_admin: bool | None = None
    education_verified: bool | None = None
    force_logout: bool | None = None
    temporary_password: str | None = Field(default=None, min_length=8, max_length=128)


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
