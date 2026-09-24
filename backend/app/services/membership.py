from __future__ import annotations

import secrets
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import MembershipRedeemCode, UsageCounter, User, UserMembership
from app.schemas.membership import (
    MembershipFeatures,
    MembershipInfo,
    MembershipPlanFeatureList,
    MembershipPlanQuota,
    MembershipPlanResponse,
    MembershipQuotaUsage,
)
from app.services.notification import create_notification

PLAN_FREE = "free"
PLAN_VIP_MONTHLY = "vip_monthly"
DEFAULT_PLAN_CODE = PLAN_FREE
FREE_PLAN_NAME = "免费版"
VIP_PLAN_NAME = "VIP 月卡"

FREE_TEMPLATE_IDS = {
    "default",
    "review_writing",
    "paper_reproduction",
    "writing_citation",
    "blank",
}

QUOTA_SELECTION_EXPLAIN_DAILY = "selection_explain_daily"
ALL_QUOTA_KEYS = (
    QUOTA_SELECTION_EXPLAIN_DAILY,
)
DAILY_QUOTAS = {
    QUOTA_SELECTION_EXPLAIN_DAILY,
}
MONTHLY_QUOTAS: set[str] = set()

MEMBERSHIP_SOURCE_ADMIN = "admin_assign"
MEMBERSHIP_SOURCE_REDEEM = "redeem_code"

ACTION_KIND_OPEN_MEMBERSHIP = "open-membership"
SOURCE_KIND_MEMBERSHIP = "membership"


@dataclass(frozen=True)
class PlanConfig:
    code: str
    name: str
    price_label: str
    description: str
    quotas: dict[str, int]
    can_export_notes: bool
    can_use_all_templates: bool
    priority_level: str
    badge_tone: str
    allowed_template_ids: set[str]
    is_vip: bool


PLAN_CONFIGS: dict[str, PlanConfig] = {
    PLAN_FREE: PlanConfig(
        code=PLAN_FREE,
        name=FREE_PLAN_NAME,
        price_label="0元",
        description="适合日常阅读、基础标注和基础笔记。",
        quotas={
            QUOTA_SELECTION_EXPLAIN_DAILY: 100,
        },
        can_export_notes=False,
        can_use_all_templates=False,
        priority_level="free",
        badge_tone="muted",
        allowed_template_ids=FREE_TEMPLATE_IDS,
        is_vip=False,
    ),
    PLAN_VIP_MONTHLY: PlanConfig(
        code=PLAN_VIP_MONTHLY,
        name=VIP_PLAN_NAME,
        price_label="10元 / 月",
        description="适合高频论文阅读、全文翻译和笔记导出场景。",
        quotas={
            QUOTA_SELECTION_EXPLAIN_DAILY: 300,
        },
        can_export_notes=True,
        can_use_all_templates=True,
        priority_level="vip",
        badge_tone="gold",
        allowed_template_ids=set(),
        is_vip=True,
    ),
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_plan_config(plan_code: str | None) -> PlanConfig:
    return PLAN_CONFIGS.get(str(plan_code or "").strip(), PLAN_CONFIGS[DEFAULT_PLAN_CODE])


def _normalize_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def build_membership_info(active_membership: UserMembership | None, *, now: datetime | None = None) -> MembershipInfo:
    current = _normalize_utc(now) or now_utc()
    membership = active_membership
    if membership:
        expires_at = _normalize_utc(membership.expires_at)
        status_value = str(membership.status or "active")
        if expires_at and expires_at <= current:
            status_value = "expired"
        config = get_plan_config(membership.plan_code)
        return MembershipInfo(
            plan_code=config.code,
            plan_name=config.name,
            is_vip=config.is_vip and status_value == "active",
            status=status_value if status_value in {"inactive", "active", "expired", "cancelled"} else "inactive",
            started_at=_normalize_utc(membership.started_at),
            expires_at=expires_at,
            badge_tone=config.badge_tone if config.is_vip and status_value == "active" else "muted",
        )

    config = get_plan_config(DEFAULT_PLAN_CODE)
    return MembershipInfo(
        plan_code=config.code,
        plan_name=config.name,
        is_vip=False,
        status="inactive",
        started_at=None,
        expires_at=None,
        badge_tone="muted",
    )

def build_membership_features(plan_code: str | None) -> MembershipFeatures:
    config = get_plan_config(plan_code)
    return MembershipFeatures(
        can_export_notes=config.can_export_notes,
        can_use_all_templates=config.can_use_all_templates,
        priority_level=config.priority_level,
    )


def build_plan_response(plan_code: str) -> MembershipPlanResponse:
    config = get_plan_config(plan_code)
    return MembershipPlanResponse(
        code=config.code,
        name=config.name,
        price_label=config.price_label,
        description=config.description,
        quotas=[
            MembershipPlanQuota(
                quota_key=quota_key,  # type: ignore[arg-type]
                period_type="daily" if quota_key in DAILY_QUOTAS else "monthly",
                limit=limit,
            )
            for quota_key, limit in config.quotas.items()
        ],
        features=MembershipPlanFeatureList(
            can_export_notes=config.can_export_notes,
            can_use_all_templates=config.can_use_all_templates,
            priority_level=config.priority_level,  # type: ignore[arg-type]
            allowed_template_ids=sorted(config.allowed_template_ids),
        ),
    )


def get_active_membership(db: Session, user_id: int, *, now: datetime | None = None) -> UserMembership | None:
    current = _normalize_utc(now) or now_utc()
    rows = db.scalars(
        select(UserMembership)
        .where(UserMembership.user_id == user_id)
        .order_by(UserMembership.expires_at.desc(), UserMembership.id.desc())
    ).all()
    for row in rows:
        expires_at = _normalize_utc(row.expires_at)
        status_value = str(row.status or "active")
        if status_value == "cancelled":
            continue
        if expires_at and expires_at > current and status_value == "active":
            return row
    return None


def get_effective_plan_code(db: Session, user_id: int, *, now: datetime | None = None) -> str:
    membership = get_active_membership(db, user_id, now=now)
    if membership:
        return get_plan_config(membership.plan_code).code
    return DEFAULT_PLAN_CODE


def is_template_allowed_for_user(db: Session, user_id: int, template_id: str) -> bool:
    normalized_template_id = str(template_id or "").strip()
    if not normalized_template_id or normalized_template_id.startswith("custom"):
        return True
    config = get_plan_config(get_effective_plan_code(db, user_id))
    return config.can_use_all_templates or normalized_template_id in config.allowed_template_ids


def _quota_period_type(quota_key: str) -> str:
    return "daily" if quota_key in DAILY_QUOTAS else "monthly"


def build_period_key(quota_key: str, *, current_time: datetime | None = None) -> str:
    dt = _normalize_utc(current_time) or now_utc()
    if quota_key in DAILY_QUOTAS:
        return dt.strftime("%Y-%m-%d")
    return dt.strftime("%Y-%m")


def build_quota_reset_at(quota_key: str, *, current_time: datetime | None = None) -> datetime:
    dt = _normalize_utc(current_time) or now_utc()
    if quota_key in DAILY_QUOTAS:
        next_day = (dt + timedelta(days=1)).date()
        return datetime(next_day.year, next_day.month, next_day.day, tzinfo=timezone.utc)
    year = dt.year + (1 if dt.month == 12 else 0)
    month = 1 if dt.month == 12 else dt.month + 1
    return datetime(year, month, 1, tzinfo=timezone.utc)


def get_quota_limit_for_plan(plan_code: str | None, quota_key: str) -> int:
    config = get_plan_config(plan_code)
    return int(config.quotas.get(quota_key, 0))


def get_usage_counter(db: Session, user_id: int, quota_key: str, period_key: str) -> UsageCounter | None:
    return db.scalar(
        select(UsageCounter).where(
            UsageCounter.user_id == user_id,
            UsageCounter.quota_key == quota_key,
            UsageCounter.period_key == period_key,
        )
    )


def get_usage_snapshot_for_user(
    db: Session,
    user_id: int,
    *,
    plan_code: str | None = None,
    current_time: datetime | None = None,
) -> dict[str, MembershipQuotaUsage]:
    current = _normalize_utc(current_time) or now_utc()
    effective_plan_code = plan_code or get_effective_plan_code(db, user_id, now=current)
    snapshots: dict[str, MembershipQuotaUsage] = {}
    for quota_key in ALL_QUOTA_KEYS:
        period_key = build_period_key(quota_key, current_time=current)
        counter = get_usage_counter(db, user_id, quota_key, period_key)
        used = int(counter.used_count or 0) if counter else 0
        limit = get_quota_limit_for_plan(effective_plan_code, quota_key)
        remaining = max(0, limit - used)
        snapshots[quota_key] = MembershipQuotaUsage(
            quota_key=quota_key,  # type: ignore[arg-type]
            period_type=_quota_period_type(quota_key),  # type: ignore[arg-type]
            period_key=period_key,
            used=used,
            limit=limit,
            remaining=remaining,
            reset_at=build_quota_reset_at(quota_key, current_time=current),
        )
    return snapshots


def build_membership_payload(db: Session, user_id: int) -> dict[str, Any]:
    membership = get_active_membership(db, user_id)
    membership_info = build_membership_info(membership)
    usage = get_usage_snapshot_for_user(db, user_id, plan_code=membership_info.plan_code)
    features = build_membership_features(membership_info.plan_code)
    return {
        "membership": membership_info,
        "usage": usage,
        "features": features,
    }


def _membership_error_detail(*, quota_key: str, message: str, plan_code: str, usage: MembershipQuotaUsage) -> dict[str, Any]:
    return {
        "code": "membership_quota_exceeded",
        "message": message,
        "quota_key": quota_key,
        "plan_code": plan_code,
        "usage": usage.model_dump(mode="json"),
        "action_kind": ACTION_KIND_OPEN_MEMBERSHIP,
    }


def _membership_feature_locked_detail(*, feature_key: str, message: str, plan_code: str) -> dict[str, Any]:
    return {
        "code": "membership_feature_locked",
        "message": message,
        "feature_key": feature_key,
        "plan_code": plan_code,
        "action_kind": ACTION_KIND_OPEN_MEMBERSHIP,
    }


def ensure_template_allowed_for_user(db: Session, user_id: int, template_id: str) -> None:
    normalized_template_id = str(template_id or "").strip()
    if is_template_allowed_for_user(db, user_id, normalized_template_id):
        return
    plan_code = get_effective_plan_code(db, user_id)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=_membership_feature_locked_detail(
            feature_key="template_access",
            message="该模板仅限 VIP 使用，开通 VIP 后即可解锁全部笔记模板。",
            plan_code=plan_code,
        ),
    )


def ensure_notes_export_allowed(db: Session, user_id: int) -> None:
    plan_code = get_effective_plan_code(db, user_id)
    config = get_plan_config(plan_code)
    if config.can_export_notes:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=_membership_feature_locked_detail(
            feature_key="notes_export",
            message="笔记与标注导出仅限 VIP 使用，开通 VIP 后即可导出。",
            plan_code=plan_code,
        ),
    )


def ensure_quota_available(
    db: Session,
    *,
    user_id: int,
    quota_key: str,
    amount: int = 1,
    current_time: datetime | None = None,
) -> MembershipQuotaUsage:
    current = _normalize_utc(current_time) or now_utc()
    plan_code = get_effective_plan_code(db, user_id, now=current)
    usage = get_usage_snapshot_for_user(db, user_id, plan_code=plan_code, current_time=current)[quota_key]
    if usage.remaining < amount:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_membership_error_detail(
                quota_key=quota_key,
                message="当前功能额度已用完，开通 VIP 可继续使用。",
                plan_code=plan_code,
                usage=usage,
            ),
        )
    return usage


def consume_quota(
    db: Session,
    *,
    user_id: int,
    quota_key: str,
    amount: int = 1,
    current_time: datetime | None = None,
) -> MembershipQuotaUsage:
    current = _normalize_utc(current_time) or now_utc()
    plan_code = get_effective_plan_code(db, user_id, now=current)
    ensure_quota_available(db, user_id=user_id, quota_key=quota_key, amount=amount, current_time=current)
    period_key = build_period_key(quota_key, current_time=current)
    limit = get_quota_limit_for_plan(plan_code, quota_key)
    counter = get_usage_counter(db, user_id, quota_key, period_key)
    if not counter:
        counter = UsageCounter(
            user_id=user_id,
            quota_key=quota_key,
            period_key=period_key,
            used_count=0,
        )
        db.add(counter)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            counter = get_usage_counter(db, user_id, quota_key, period_key)
            if not counter:
                raise

    result = db.execute(
        update(UsageCounter)
        .where(
            UsageCounter.id == counter.id,
            UsageCounter.used_count <= max(0, limit - amount),
        )
        .values(used_count=UsageCounter.used_count + amount)
    )
    if result.rowcount != 1:
        db.rollback()
        latest_usage = get_usage_snapshot_for_user(db, user_id, plan_code=plan_code, current_time=current)[quota_key]
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_membership_error_detail(
                quota_key=quota_key,
                message="当前功能额度已用完，开通 VIP 可继续使用。",
                plan_code=plan_code,
                usage=latest_usage,
            ),
        )

    db.commit()
    return get_usage_snapshot_for_user(db, user_id, plan_code=plan_code, current_time=current)[quota_key]


def _coerce_status_for_membership(row: UserMembership, *, current: datetime | None = None) -> str:
    now_value = _normalize_utc(current) or now_utc()
    expires_at = _normalize_utc(row.expires_at)
    if str(row.status or "") == "cancelled":
        return "cancelled"
    if expires_at and expires_at <= now_value:
        return "expired"
    return "active"


def assign_membership(
    db: Session,
    *,
    user_id: int,
    plan_code: str,
    duration_days: int,
    activated_by: int | None,
    activation_source: str,
    note: str = "",
    stack_on_existing: bool = True,
    commit: bool = True,
) -> UserMembership:
    config = get_plan_config(plan_code)
    current = now_utc()
    active = get_active_membership(db, user_id, now=current)
    started_at = current
    if active and stack_on_existing:
        started_at = _normalize_utc(active.expires_at) or current
    expires_at = started_at + timedelta(days=int(duration_days))
    membership = UserMembership(
        user_id=user_id,
        plan_code=config.code,
        status="active",
        started_at=current,
        expires_at=expires_at,
        activated_by=activated_by,
        activation_source=activation_source,
        notes=note or None,
    )
    db.add(membership)
    if commit:
        db.commit()
        db.refresh(membership)
    else:
        db.flush()
    return membership


def cancel_active_membership(
    db: Session,
    *,
    user_id: int,
    activated_by: int | None,
    note: str = "",
) -> UserMembership | None:
    active = get_active_membership(db, user_id)
    if not active:
        return None
    active.status = "cancelled"
    active.notes = "\n".join([value for value in [active.notes or "", note] if value]).strip() or None
    active.activated_by = activated_by
    db.add(active)
    db.commit()
    db.refresh(active)
    return active


def normalize_redeem_code_prefix(value: str = "") -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "-", str(value or "").strip().upper())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized[:16]


def split_redeem_code_prefix(code_value: str = "") -> tuple[str, str]:
    normalized = str(code_value or "").strip().upper()
    if "-" not in normalized:
        return "", normalized
    prefix, suffix = normalized.split("-", 1)
    return prefix, suffix


def resolve_redeem_code_status(item: MembershipRedeemCode, *, current_time: datetime | None = None) -> str:
    current = _normalize_utc(current_time) or now_utc()
    status_value = str(item.status or "").strip().lower() or "active"
    if status_value == "redeemed":
        return "redeemed"
    expires_at = _normalize_utc(item.expires_at)
    if expires_at and expires_at <= current:
        return "expired"
    return status_value


def generate_redeem_code_value(prefix: str = "") -> str:
    suffix = secrets.token_hex(4).upper()
    normalized_prefix = normalize_redeem_code_prefix(prefix)
    if not normalized_prefix:
        return suffix
    return f"{normalized_prefix}-{suffix}"


def create_redeem_codes(
    db: Session,
    *,
    plan_code: str,
    quantity: int,
    duration_days: int,
    created_by: int | None,
    batch_label: str = "",
    note: str = "",
) -> list[MembershipRedeemCode]:
    config = get_plan_config(plan_code)
    items: list[MembershipRedeemCode] = []
    seen_codes: set[str] = set()
    prefix = normalize_redeem_code_prefix(batch_label)
    while len(items) < quantity:
        code = generate_redeem_code_value(prefix)
        if code in seen_codes or db.scalar(select(MembershipRedeemCode.id).where(MembershipRedeemCode.code == code)):
            continue
        seen_codes.add(code)
        items.append(
            MembershipRedeemCode(
                code=code,
                plan_code=config.code,
                duration_days=duration_days,
                status="active",
                created_by=created_by,
                batch_label=batch_label,
                notes=note or None,
            )
        )
    for item in items:
        db.add(item)
    db.commit()
    for item in items:
        db.refresh(item)
    return items


def list_redeem_codes(db: Session) -> list[MembershipRedeemCode]:
    return db.scalars(
        select(MembershipRedeemCode).order_by(MembershipRedeemCode.created_at.desc(), MembershipRedeemCode.id.desc())
    ).all()


def update_redeem_code(
    db: Session,
    *,
    code_id: int,
    status_value: str | None = None,
    batch_label: str | None = None,
    note: str | None = None,
    expires_at: datetime | None = None,
) -> MembershipRedeemCode | None:
    item = db.get(MembershipRedeemCode, code_id)
    if not item:
        return None
    if status_value is not None:
        item.status = status_value
    if batch_label is not None:
        item.batch_label = batch_label
    if note is not None:
        item.notes = note or None
    if expires_at is not None:
        item.expires_at = expires_at
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def redeem_code(
    db: Session,
    *,
    user_id: int,
    code_value: str,
) -> tuple[UserMembership, MembershipRedeemCode]:
    current = now_utc()
    code = db.scalar(
        select(MembershipRedeemCode).where(MembershipRedeemCode.code == code_value.strip().upper())
    )
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在。")
    if str(code.status or "") != "active":
        raise HTTPException(status_code=400, detail="兑换码当前不可用。")
    if code.expires_at and (_normalize_utc(code.expires_at) or current) <= current:
        code.status = "expired"
        db.add(code)
        db.commit()
        raise HTTPException(status_code=400, detail="兑换码已过期。")
    if code.redeemed_by:
        raise HTTPException(status_code=400, detail="兑换码已被使用。")

    result = db.execute(
        update(MembershipRedeemCode)
        .where(
            MembershipRedeemCode.id == code.id,
            MembershipRedeemCode.status == "active",
            MembershipRedeemCode.redeemed_by.is_(None),
            or_(MembershipRedeemCode.expires_at.is_(None), MembershipRedeemCode.expires_at > current),
        )
        .values(
            status="redeemed",
            redeemed_by=user_id,
            redeemed_at=current,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=400, detail="兑换码已被使用或已过期。")

    try:
        membership = assign_membership(
            db,
            user_id=user_id,
            plan_code=code.plan_code,
            duration_days=int(code.duration_days or 30),
            activated_by=None,
            activation_source=MEMBERSHIP_SOURCE_REDEEM,
            note=code.notes or "",
            stack_on_existing=True,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(membership)
    db.refresh(code)
    return membership, code


def serialize_redeem_code(item: MembershipRedeemCode) -> dict[str, Any]:
    code_prefix, _ = split_redeem_code_prefix(item.code)
    return {
        "id": item.id,
        "code": item.code,
        "code_prefix": code_prefix,
        "plan_code": get_plan_config(item.plan_code).code,
        "duration_days": int(item.duration_days or 0),
        "status": resolve_redeem_code_status(item),
        "created_by": item.created_by,
        "redeemed_by": item.redeemed_by,
        "redeemed_at": _normalize_utc(item.redeemed_at),
        "expires_at": _normalize_utc(item.expires_at),
        "batch_label": item.batch_label or "",
        "notes": item.notes,
        "created_at": _normalize_utc(item.created_at),
        "updated_at": _normalize_utc(item.updated_at),
    }


def create_membership_notification(
    db: Session,
    *,
    user_id: int,
    event_kind: str,
    title: str,
    message: str,
    payload: dict[str, Any] | None = None,
) -> None:
    create_notification(
        db,
        user_id=user_id,
        source_kind=SOURCE_KIND_MEMBERSHIP,
        source_id=int(user_id),
        event_kind=event_kind,
        title=title,
        message=message,
        action_kind=ACTION_KIND_OPEN_MEMBERSHIP,
        action_payload=dict(payload or {}),
    )
