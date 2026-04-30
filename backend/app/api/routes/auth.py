from __future__ import annotations

from pathlib import Path
from time import time_ns
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import User, UserAgreement, UserProfile
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    UpdateProfileRequest,
    UserResponse,
)
from app.services.security import create_access_token, create_uid, hash_password, verify_password


router = APIRouter(prefix="/auth")

ALLOWED_AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def generate_unique_uid(db: Session) -> str:
    uid = create_uid()
    while db.scalar(select(User.id).where(User.uid == uid)):
        uid = create_uid()
    return uid


def build_user_response(user: User) -> UserResponse:
    profile = user.profile
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="用户资料缺失，请联系管理员。",
        )

    return UserResponse(
        uid=user.uid,
        nickname=profile.nickname,
        avatar_url=profile.avatar_url,
        phone=user.phone,
        email=user.email,
        education=profile.education,
        occupation=profile.occupation,
        organization=profile.organization,
        discipline=profile.discipline,
        education_verified=profile.education_verified,
    )


def resolve_old_avatar_path(avatar_url: str | None) -> Path | None:
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


@router.post("/register", response_model=AuthResponse)
def register(
    payload: RegisterRequest,
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    existing_user = db.scalar(
        select(User).where(
            or_(User.phone == payload.phone, User.email == payload.email)
        )
    )
    if existing_user:
        if existing_user.phone == payload.phone:
            raise HTTPException(status_code=409, detail="该手机号已注册。")
        raise HTTPException(status_code=409, detail="该邮箱已注册。")

    user = User(
        uid=generate_unique_uid(db),
        phone=payload.phone,
        email=payload.email,
        password_hash=hash_password(payload.password),
        status="active",
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.flush()

    profile = UserProfile(
        user_id=user.id,
        nickname=payload.nickname,
        education=payload.education,
        occupation=payload.occupation,
        organization=payload.organization,
        discipline=payload.discipline,
        education_verified=False,
    )
    agreement = UserAgreement(
        user_id=user.id,
        agreement_type="terms_and_privacy",
    )

    db.add(profile)
    db.add(agreement)
    db.commit()

    created_user = db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user.id)
    )
    if not created_user:
        raise HTTPException(status_code=500, detail="注册成功但读取用户信息失败。")

    return AuthResponse(
        access_token=create_access_token(created_user.uid),
        user=build_user_response(created_user),
    )


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    normalized_account = payload.account.lower() if "@" in payload.account else payload.account
    lookup_field = User.email if "@" in normalized_account else User.phone

    user = db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(lookup_field == normalized_account)
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号或密码错误。",
        )

    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="该账号暂时不可用。",
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user, attribute_names=["profile"])

    return AuthResponse(
        access_token=create_access_token(user.uid),
        user=build_user_response(user),
    )


@router.get("/me", response_model=UserResponse)
def me(current_user: Annotated[User, Depends(get_current_user)]) -> UserResponse:
    return build_user_response(current_user)


@router.patch("/me", response_model=UserResponse)
def update_me(
    payload: UpdateProfileRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    profile = current_user.profile
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="用户资料缺失，请联系管理员。",
        )

    profile.nickname = payload.nickname
    profile.education = payload.education
    profile.occupation = payload.occupation
    profile.organization = payload.organization
    profile.discipline = payload.discipline

    db.add(profile)
    db.commit()
    db.refresh(current_user, attribute_names=["profile"])
    return build_user_response(current_user)


@router.post("/me/avatar", response_model=UserResponse)
async def upload_avatar(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    avatar: UploadFile = File(...),
) -> UserResponse:
    profile = current_user.profile
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="用户资料缺失，请联系管理员。",
        )

    if avatar.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像仅支持 JPG、PNG 或 WEBP 格式。",
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
    file_name = f"{current_user.uid}_{time_ns() // 1_000_000}{suffix}"
    avatar_dir = Path(settings.avatar_upload_dir)
    avatar_dir.mkdir(parents=True, exist_ok=True)
    new_avatar_path = avatar_dir / file_name
    new_avatar_path.write_bytes(content)

    old_avatar_path = resolve_old_avatar_path(profile.avatar_url)
    profile.avatar_url = str(request.url_for("uploads", path=f"avatars/{file_name}"))

    db.add(profile)
    db.commit()
    db.refresh(current_user, attribute_names=["profile"])

    if old_avatar_path and old_avatar_path.exists() and old_avatar_path != new_avatar_path:
        try:
            old_avatar_path.unlink()
        except OSError:
            pass

    return build_user_response(current_user)
