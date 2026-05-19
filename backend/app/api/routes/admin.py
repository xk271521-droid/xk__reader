from __future__ import annotations

import math
from datetime import datetime, timedelta
from pathlib import Path
from time import time_ns
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.core.config import settings
from app.db.session import get_db
from app.models import AiProvider, Paper, ReadingRecord, User, UserProfile
from app.schemas.admin import (
    AdminOverviewResponse,
    AdminOverviewStats,
    AdminOverviewTrendPoint,
    AdminPaperListResponse,
    AdminPaperSummary,
    AdminUserDetailResponse,
    AdminUserListResponse,
    AdminUserSummary,
    AdminUserUpdateRequest,
)
from app.services.security import hash_password
from app.services.upload_mirror import mirror_upload_file, remove_mirrored_upload

router = APIRouter(prefix="/admin", tags=["admin"])

ALLOWED_AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _empty_metrics_snapshot() -> dict[str, int | str | None]:
    return {
        "import_count": 0,
        "latest_imported_at": None,
        "reading_record_count": 0,
        "reading_duration_seconds": 0,
        "latest_reading_at": None,
    }


def _build_user_metrics(
    db: Session,
    user_ids: list[int] | None = None,
) -> dict[int, dict[str, int | str | None]]:
    normalized_user_ids = [int(user_id) for user_id in user_ids or [] if user_id is not None]

    paper_stmt = (
        select(
            Paper.user_id,
            func.count(Paper.id),
            func.max(Paper.created_at),
        )
        .group_by(Paper.user_id)
    )
    reading_stmt = (
        select(
            ReadingRecord.user_id,
            func.count(ReadingRecord.id),
            func.coalesce(func.sum(ReadingRecord.duration_seconds), 0),
            func.max(ReadingRecord.opened_at),
        )
        .group_by(ReadingRecord.user_id)
    )

    if normalized_user_ids:
        paper_stmt = paper_stmt.where(Paper.user_id.in_(normalized_user_ids))
        reading_stmt = reading_stmt.where(ReadingRecord.user_id.in_(normalized_user_ids))

    paper_rows = db.execute(paper_stmt).all()
    reading_rows = db.execute(reading_stmt).all()

    metrics: dict[int, dict[str, int | str | None]] = {
        user_id: _empty_metrics_snapshot() for user_id in normalized_user_ids
    }
    for user_id, import_count, latest_imported_at in paper_rows:
        bucket = metrics.setdefault(int(user_id), _empty_metrics_snapshot())
        bucket["import_count"] = int(import_count or 0)
        bucket["latest_imported_at"] = _serialize_datetime(latest_imported_at)
    for user_id, reading_count, reading_duration, latest_reading_at in reading_rows:
        bucket = metrics.setdefault(int(user_id), _empty_metrics_snapshot())
        bucket["reading_record_count"] = int(reading_count or 0)
        bucket["reading_duration_seconds"] = int(reading_duration or 0)
        bucket["latest_reading_at"] = _serialize_datetime(latest_reading_at)
    return metrics


def _build_user_summary(user: User, metrics: dict[str, int | str | None] | None = None) -> AdminUserSummary:
    profile = user.profile
    snapshot = metrics or {}
    return AdminUserSummary(
        id=user.id,
        uid=user.uid,
        nickname=profile.nickname if profile else user.uid,
        avatar_url=_normalize_avatar_url(profile.avatar_url) if profile else None,
        phone=user.phone,
        email=user.email,
        education=profile.education if profile else "",
        organization=profile.organization if profile else "",
        occupation=profile.occupation if profile else "",
        discipline=profile.discipline if profile else "",
        status=user.status,
        is_admin=user.is_admin,
        education_verified=bool(profile.education_verified) if profile else False,
        paper_count=int(snapshot.get("import_count") or 0),
        import_count=int(snapshot.get("import_count") or 0),
        latest_imported_at=(
            snapshot.get("latest_imported_at")
            if isinstance(snapshot.get("latest_imported_at"), str) or snapshot.get("latest_imported_at") is None
            else None
        ),
        reading_record_count=int(snapshot.get("reading_record_count") or 0),
        reading_duration_seconds=int(snapshot.get("reading_duration_seconds") or 0),
        latest_reading_at=(
            snapshot.get("latest_reading_at")
            if isinstance(snapshot.get("latest_reading_at"), str) or snapshot.get("latest_reading_at") is None
            else None
        ),
        created_at=_serialize_datetime(user.created_at),
        last_login_at=_serialize_datetime(user.last_login_at),
    )


def _build_paper_summary(paper: Paper) -> AdminPaperSummary:
    owner = paper.user
    profile = owner.profile if owner else None
    return AdminPaperSummary(
        id=paper.id,
        title=(paper.title or "").strip() or paper.file_name,
        file_name=paper.file_name,
        owner_uid=owner.uid if owner else "",
        owner_nickname=profile.nickname if profile else (owner.uid if owner else ""),
        page_count=paper.page_count or 0,
        is_trashed=paper.deleted_at is not None,
        created_at=_serialize_datetime(paper.created_at),
        last_viewed_at=_serialize_datetime(paper.last_viewed_at),
    )


def _build_activity_trend(
    db: Session,
    start_at: datetime,
    days: int = 30,
) -> list[AdminOverviewTrendPoint]:
    user_rows = db.execute(
        select(func.date(User.created_at), func.count(User.id))
        .where(User.created_at >= start_at)
        .group_by(func.date(User.created_at))
    ).all()
    paper_rows = db.execute(
        select(func.date(Paper.created_at), func.count(Paper.id))
        .where(Paper.created_at >= start_at)
        .group_by(func.date(Paper.created_at))
    ).all()

    registrations_by_day = {
        str(date_value): int(count or 0)
        for date_value, count in user_rows
        if date_value is not None
    }
    imports_by_day = {
        str(date_value): int(count or 0)
        for date_value, count in paper_rows
        if date_value is not None
    }

    points: list[AdminOverviewTrendPoint] = []
    for offset in range(days):
        current_day = start_at + timedelta(days=offset)
        key = current_day.date().isoformat()
        points.append(
            AdminOverviewTrendPoint(
                date=current_day.strftime("%m-%d"),
                registrations=registrations_by_day.get(key, 0),
                imports=imports_by_day.get(key, 0),
            )
        )
    return points


def _validate_admin_password_strength(password: str) -> None:
    has_upper = any(char.isupper() for char in password)
    has_lower = any(char.islower() for char in password)
    has_digit = any(char.isdigit() for char in password)
    if len(password) < 8 or sum((has_upper, has_lower, has_digit)) < 2:
        raise HTTPException(
            status_code=400,
            detail="临时密码至少 8 位，且需要包含字母和数字中的两种组合。",
        )


def _parse_date_filter(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="日期筛选格式必须为 YYYY-MM-DD。") from exc


def _resolve_old_avatar_path(avatar_url: str | None) -> Path | None:
    if not avatar_url:
        return None

    file_name = Path(avatar_url).name
    if not file_name:
        return None

    avatar_path = Path(settings.avatar_upload_dir) / file_name
    avatar_root = Path(settings.avatar_upload_dir).resolve()
    try:
        resolved = avatar_path.resolve()
    except OSError:
        return None
    if avatar_root not in resolved.parents:
        return None
    return resolved


def _build_avatar_public_url(file_name: str) -> str:
    return f"/uploads/avatars/{file_name}"


def _normalize_avatar_url(avatar_url: str | None) -> str | None:
    if not avatar_url:
        return None
    file_name = Path(avatar_url).name
    if not file_name:
        return avatar_url
    return _build_avatar_public_url(file_name)


@router.get("/overview", response_model=AdminOverviewResponse)
def get_admin_overview(
    _admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminOverviewResponse:
    now = datetime.now()
    recent_users_start = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
    activity_trend_start = (now - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)

    total_users = db.scalar(select(func.count(User.id))) or 0
    active_users = db.scalar(select(func.count(User.id)).where(User.status == "active")) or 0
    admin_users = db.scalar(select(func.count(User.id)).where(User.is_admin.is_(True))) or 0
    total_papers = db.scalar(select(func.count(Paper.id))) or 0
    active_papers = db.scalar(select(func.count(Paper.id)).where(Paper.deleted_at.is_(None))) or 0
    trashed_papers = db.scalar(select(func.count(Paper.id)).where(Paper.deleted_at.is_not(None))) or 0
    total_providers = db.scalar(select(func.count(AiProvider.id))) or 0
    system_providers = db.scalar(select(func.count(AiProvider.id)).where(AiProvider.user_id.is_(None))) or 0
    user_providers = total_providers - system_providers

    recent_users = db.scalars(
        select(User)
        .options(selectinload(User.profile))
        .where(User.created_at >= recent_users_start)
        .order_by(User.created_at.desc(), User.id.desc())
        .limit(8)
    ).all()
    metrics_map = _build_user_metrics(db)
    recent_papers = db.scalars(
        select(Paper)
        .options(selectinload(Paper.user).selectinload(User.profile))
        .order_by(Paper.created_at.desc(), Paper.id.desc())
        .limit(6)
    ).all()

    return AdminOverviewResponse(
        stats=AdminOverviewStats(
            total_users=total_users,
            active_users=active_users,
            admin_users=admin_users,
            total_papers=total_papers,
            active_papers=active_papers,
            trashed_papers=trashed_papers,
            total_providers=total_providers,
            system_providers=system_providers,
            user_providers=user_providers,
        ),
        activity_trend=_build_activity_trend(db, activity_trend_start, days=30),
        recent_users=[_build_user_summary(user, metrics_map.get(user.id)) for user in recent_users],
        recent_papers=[_build_paper_summary(paper) for paper in recent_papers],
    )


@router.get("/users", response_model=AdminUserListResponse)
def list_admin_users(
    _admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=100),
    q: str = Query(default=""),
    status: str = Query(default=""),
    is_admin: str = Query(default=""),
    education_verified: str = Query(default=""),
    created_from: str = Query(default=""),
    created_to: str = Query(default=""),
) -> AdminUserListResponse:
    conditions = []
    query_text = q.strip()
    if query_text:
        pattern = f"%{query_text}%"
        conditions.append(
            or_(
                User.phone.like(pattern),
                User.uid.like(pattern),
                User.email.like(pattern),
                User.profile.has(UserProfile.nickname.like(pattern)),
            )
        )
    if status in {"active", "disabled"}:
        conditions.append(User.status == status)
    if is_admin in {"true", "false"}:
        conditions.append(User.is_admin.is_(is_admin == "true"))
    if education_verified in {"true", "false"}:
        conditions.append(User.profile.has(UserProfile.education_verified.is_(education_verified == "true")))
    if created_from:
        parsed = _parse_date_filter(created_from)
        if parsed:
            conditions.append(User.created_at >= parsed)
    if created_to:
        parsed = _parse_date_filter(created_to)
        if parsed:
            conditions.append(User.created_at < (parsed + timedelta(days=1)))

    base_stmt = select(User).options(selectinload(User.profile))
    count_stmt = select(func.count(User.id))
    if conditions:
        filter_clause = and_(*conditions)
        base_stmt = base_stmt.where(filter_clause)
        count_stmt = count_stmt.where(filter_clause)

    total = int(db.scalar(count_stmt) or 0)
    total_pages = max(1, math.ceil(total / page_size)) if total else 1

    stmt = (
        base_stmt
        .order_by(User.created_at.desc(), User.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    users = db.scalars(stmt).all()
    metrics_map = _build_user_metrics(db, [user.id for user in users])
    return AdminUserListResponse(
        items=[_build_user_summary(user, metrics_map.get(user.id)) for user in users],
        page=page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetailResponse)
def get_admin_user_detail(
    user_id: int,
    _admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserDetailResponse:
    user = db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id)
    )
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在。")

    metrics_map = _build_user_metrics(db, [user.id])
    return AdminUserDetailResponse(user=_build_user_summary(user, metrics_map.get(user.id)))


@router.patch("/users/{user_id}", response_model=AdminUserSummary)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdateRequest,
    current_admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserSummary:
    user = db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id)
    )
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在。")

    profile = user.profile
    if profile is None:
        raise HTTPException(status_code=500, detail="用户资料缺失，请稍后再试。")

    provided_fields = payload.model_fields_set

    if "phone" in provided_fields and payload.phone is not None and payload.phone != user.phone:
        existing_phone_user = db.scalar(select(User.id).where(User.phone == payload.phone, User.id != user.id))
        if existing_phone_user:
            raise HTTPException(status_code=400, detail="该手机号已被其他账号使用。")
        user.phone = payload.phone

    if "email" in provided_fields and payload.email != user.email:
        if payload.email is not None:
            existing_email_user = db.scalar(select(User.id).where(User.email == payload.email, User.id != user.id))
            if existing_email_user:
                raise HTTPException(status_code=400, detail="该邮箱已被其他账号使用。")
        user.email = payload.email

    if "nickname" in provided_fields and payload.nickname is not None:
        profile.nickname = payload.nickname
    if "education" in provided_fields and payload.education is not None:
        profile.education = payload.education
    if "occupation" in provided_fields and payload.occupation is not None:
        profile.occupation = payload.occupation
    if "organization" in provided_fields and payload.organization is not None:
        profile.organization = payload.organization
    if "discipline" in provided_fields and payload.discipline is not None:
        profile.discipline = payload.discipline

    rotate_token = False

    if payload.status is not None and payload.status != user.status:
        if user.id == current_admin.id and payload.status == "disabled":
            raise HTTPException(status_code=400, detail="不能停用当前登录管理员自己的账号。")
        user.status = payload.status
        rotate_token = True
    if payload.is_admin is not None:
        if user.id == current_admin.id and payload.is_admin is False:
            raise HTTPException(status_code=400, detail="不能移除当前登录管理员自己的管理员权限。")
        user.is_admin = payload.is_admin
    if payload.education_verified is not None:
        profile.education_verified = payload.education_verified
        db.add(profile)
    if payload.temporary_password:
        sanitized_password = payload.temporary_password.strip()
        _validate_admin_password_strength(sanitized_password)
        user.password_hash = hash_password(sanitized_password)
        rotate_token = True
    if payload.force_logout:
        rotate_token = True

    if rotate_token:
        user.token_version = int(user.token_version or 0) + 1

    db.add(user)
    db.add(profile)
    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="账号更新失败，请稍后重试。") from exc
    db.refresh(user, attribute_names=["profile"])

    metrics_map = _build_user_metrics(db, [user.id])
    return _build_user_summary(user, metrics_map.get(user.id))


@router.post("/users/{user_id}/avatar", response_model=AdminUserSummary)
async def upload_admin_user_avatar(
    user_id: int,
    request: Request,
    _admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    avatar: UploadFile = File(...),
) -> AdminUserSummary:
    user = db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id)
    )
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在。")

    profile = user.profile
    if profile is None:
        raise HTTPException(status_code=500, detail="用户资料缺失，请稍后再试。")

    if avatar.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像仅支持 JPG、PNG 和 WEBP 格式。",
        )

    content = await avatar.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传文件为空，请重新选择头像。",
        )

    if len(content) > settings.avatar_max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像不能超过 2MB。",
        )

    suffix = ALLOWED_AVATAR_TYPES[avatar.content_type]
    file_name = f"{user.uid}_{time_ns() // 1_000_000}{suffix}"
    avatar_dir = Path(settings.avatar_upload_dir)
    avatar_dir.mkdir(parents=True, exist_ok=True)
    new_avatar_path = avatar_dir / file_name
    new_avatar_path.write_bytes(content)
    mirror_upload_file(new_avatar_path, f"avatars/{file_name}")

    old_avatar_path = _resolve_old_avatar_path(profile.avatar_url)
    profile.avatar_url = _build_avatar_public_url(file_name)

    db.add(profile)
    db.commit()
    db.refresh(user, attribute_names=["profile"])

    if old_avatar_path and old_avatar_path.exists() and old_avatar_path != new_avatar_path:
        try:
            old_avatar_path.unlink()
            remove_mirrored_upload(f"avatars/{old_avatar_path.name}")
        except OSError:
            pass

    metrics_map = _build_user_metrics(db, [user.id])
    return _build_user_summary(user, metrics_map.get(user.id))


@router.get("/papers", response_model=AdminPaperListResponse)
def list_admin_papers(
    _admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminPaperListResponse:
    papers = db.scalars(
        select(Paper)
        .options(selectinload(Paper.user).selectinload(User.profile))
        .order_by(Paper.created_at.desc(), Paper.id.desc())
        .limit(200)
    ).all()
    return AdminPaperListResponse(papers=[_build_paper_summary(paper) for paper in papers])
