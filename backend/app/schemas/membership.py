from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


MembershipPlanCode = Literal["free", "vip_monthly"]
MembershipStatus = Literal["inactive", "active", "expired", "cancelled"]
MembershipBadgeTone = Literal["muted", "gold"]
MembershipPriorityLevel = Literal["free", "vip"]
QuotaPeriodType = Literal["daily", "monthly"]
QuotaKey = Literal[
    "selection_explain_daily",
    "selection_context_daily",
    "summary_card_monthly",
    "matrix_run_monthly",
]


class MembershipQuotaUsage(BaseModel):
    quota_key: QuotaKey
    period_type: QuotaPeriodType
    period_key: str
    used: int = 0
    limit: int = 0
    remaining: int = 0
    reset_at: datetime | None = None


class MembershipFeatures(BaseModel):
    can_export_notes: bool = False
    can_use_all_templates: bool = False
    priority_level: MembershipPriorityLevel = "free"


class MembershipInfo(BaseModel):
    plan_code: MembershipPlanCode = "free"
    plan_name: str = "免费版"
    is_vip: bool = False
    status: MembershipStatus = "inactive"
    started_at: datetime | None = None
    expires_at: datetime | None = None
    badge_tone: MembershipBadgeTone = "muted"


class MembershipPlanQuota(BaseModel):
    quota_key: QuotaKey
    period_type: QuotaPeriodType
    limit: int


class MembershipPlanFeatureList(BaseModel):
    can_export_notes: bool = False
    can_use_all_templates: bool = False
    priority_level: MembershipPriorityLevel = "free"
    allowed_template_ids: list[str] = Field(default_factory=list)


class MembershipPlanResponse(BaseModel):
    code: MembershipPlanCode
    name: str
    price_label: str
    description: str
    quotas: list[MembershipPlanQuota] = Field(default_factory=list)
    features: MembershipPlanFeatureList


class MembershipPlansResponse(BaseModel):
    plans: list[MembershipPlanResponse] = Field(default_factory=list)
    default_plan_code: MembershipPlanCode = "free"


class MembershipMeResponse(BaseModel):
    membership: MembershipInfo
    usage: dict[QuotaKey, MembershipQuotaUsage]
    features: MembershipFeatures


class MembershipRedeemRequest(BaseModel):
    code: str = Field(min_length=4, max_length=64)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("兑换码不能为空。")
        return normalized


class MembershipRedeemResponse(BaseModel):
    membership: MembershipInfo
    usage: dict[QuotaKey, MembershipQuotaUsage]
    features: MembershipFeatures
    message: str = "VIP 已开通"


class AdminMembershipAssignRequest(BaseModel):
    plan_code: MembershipPlanCode = "vip_monthly"
    duration_days: int = Field(default=30, ge=1, le=3650)
    note: str = Field(default="", max_length=500)
    stack_on_existing: bool = True

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str) -> str:
        return " ".join((value or "").split()).strip()


class AdminMembershipCancelRequest(BaseModel):
    note: str = Field(default="", max_length=500)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str) -> str:
        return " ".join((value or "").split()).strip()


class AdminRedeemCodeCreateRequest(BaseModel):
    plan_code: MembershipPlanCode = "vip_monthly"
    quantity: int = Field(default=1, ge=1, le=200)
    duration_days: int = Field(default=30, ge=1, le=3650)
    batch_label: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=500)

    @field_validator("batch_label", "note")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return " ".join((value or "").split()).strip()


class AdminRedeemCodeUpdateRequest(BaseModel):
    status: Literal["active", "disabled", "redeemed", "expired"] | None = None
    batch_label: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    expires_at: datetime | None = None

    @field_validator("batch_label", "note")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()).strip()


class AdminRedeemCodeItem(BaseModel):
    id: int
    code: str
    code_prefix: str = ""
    plan_code: MembershipPlanCode
    duration_days: int
    status: str
    created_by: int | None = None
    redeemed_by: int | None = None
    redeemed_by_name: str = ""
    redeemed_by_uid: str = ""
    redeemed_by_phone: str = ""
    redeemed_by_email: str = ""
    redeemed_at: datetime | None = None
    expires_at: datetime | None = None
    batch_label: str = ""
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminRedeemCodeListResponse(BaseModel):
    items: list[AdminRedeemCodeItem] = Field(default_factory=list)


class AdminRedeemCodeCreateResponse(BaseModel):
    items: list[AdminRedeemCodeItem] = Field(default_factory=list)
