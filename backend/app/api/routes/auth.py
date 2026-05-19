from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from time import time_ns
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import Folder, User, UserAgreement, UserProfile
from app.schemas.auth import (
    AuthResponse,
    CaptchaChallengeResponse,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SendResetCodeRequest,
    SendVerificationCodeRequest,
    SendVerificationCodeResponse,
    UpdateProfileRequest,
    UserResponse,
)
from app.services.auth_guard import auth_guard
from app.services.ai_provider_manager import ensure_user_default_providers
from app.services.security import create_access_token, create_uid, hash_password, verify_password
from app.services.upload_mirror import mirror_upload_file, remove_mirrored_upload
from app.services.verification import (
    EMAIL_CHANNEL,
    REGISTER_PURPOSE,
    RESET_PASSWORD_PURPOSE,
    SMS_CHANNEL,
    issue_verification_code,
    verify_code,
)


router = APIRouter(prefix="/auth")

ALLOWED_AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def normalize_account_key(value: str) -> str:
    account = value.strip()
    return account.lower() if "@" in account else account


def resolve_account_channel(value: str) -> str:
    return EMAIL_CHANNEL if "@" in value else SMS_CHANNEL


def normalize_captcha_scene(value: str) -> str:
    return "register" if value == "signup" else value


def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码至少需要 8 位。",
        )

    has_upper = any(char.isupper() for char in password)
    has_lower = any(char.islower() for char in password)
    has_digit = any(char.isdigit() for char in password)
    if sum((has_upper, has_lower, has_digit)) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码需至少包含字母和数字中的两类组合。",
        )


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
        avatar_url=normalize_avatar_url(profile.avatar_url),
        phone=user.phone,
        email=user.email,
        education=profile.education,
        occupation=profile.occupation,
        organization=profile.organization,
        discipline=profile.discipline,
        education_verified=profile.education_verified,
        is_admin=user.is_admin,
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


def build_avatar_public_url(file_name: str) -> str:
    return f"/uploads/avatars/{file_name}"


def normalize_avatar_url(avatar_url: str | None) -> str | None:
    if not avatar_url:
        return None
    file_name = Path(avatar_url).name
    if not file_name:
        return avatar_url
    return build_avatar_public_url(file_name)


def find_user_by_account(db: Session, account: str) -> User | None:
    normalized_account = normalize_account_key(account)
    lookup_field = User.email if "@" in normalized_account else User.phone
    return db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(lookup_field == normalized_account)
    )


@router.get("/captcha", response_model=CaptchaChallengeResponse)
def get_captcha(
    scene: Annotated[str, Query(pattern="^(login|register|signup|reset)$")],
) -> CaptchaChallengeResponse:
    challenge = auth_guard.create_challenge(normalize_captcha_scene(scene))
    return CaptchaChallengeResponse(**challenge)


@router.post("/register/send-code", response_model=SendVerificationCodeResponse)
def send_register_code(
    request: Request,
    payload: SendVerificationCodeRequest,
    db: Annotated[Session, Depends(get_db)],
) -> SendVerificationCodeResponse:
    client_ip = get_client_ip(request)
    auth_guard.ensure_request_allowed("register", client_ip, account_keys=[payload.target])
    auth_guard.verify_challenge("register", payload.captcha_id, payload.captcha_code)

    if payload.channel == SMS_CHANNEL:
        existing_user = db.scalar(select(User.id).where(User.phone == payload.target))
        if existing_user:
            raise HTTPException(status_code=409, detail="该手机号已注册。")
    elif payload.channel == EMAIL_CHANNEL:
        existing_user = db.scalar(select(User.id).where(User.email == payload.target.lower()))
        if existing_user:
            raise HTTPException(status_code=409, detail="该邮箱已注册。")

    cooldown = issue_verification_code(
        db,
        channel=payload.channel,
        purpose=REGISTER_PURPOSE,
        target=payload.target,
        request_ip=client_ip,
    )
    return SendVerificationCodeResponse(cooldown_seconds=cooldown)


@router.post("/password/send-code", response_model=SendVerificationCodeResponse)
def send_reset_code(
    request: Request,
    payload: SendResetCodeRequest,
    db: Annotated[Session, Depends(get_db)],
) -> SendVerificationCodeResponse:
    client_ip = get_client_ip(request)
    normalized_account = normalize_account_key(payload.account)
    auth_guard.ensure_request_allowed("login", client_ip, account_keys=[normalized_account])
    auth_guard.verify_challenge("reset", payload.captcha_id, payload.captcha_code)

    user = find_user_by_account(db, normalized_account)
    if not user:
        raise HTTPException(status_code=404, detail="账号不存在。")

    channel = resolve_account_channel(normalized_account)
    cooldown = issue_verification_code(
        db,
        channel=channel,
        purpose=RESET_PASSWORD_PURPOSE,
        target=normalized_account,
        request_ip=client_ip,
    )
    return SendVerificationCodeResponse(cooldown_seconds=cooldown)


@router.post("/password/reset")
def reset_password(
    request: Request,
    payload: ResetPasswordRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    client_ip = get_client_ip(request)
    normalized_account = normalize_account_key(payload.account)
    auth_guard.ensure_request_allowed("login", client_ip, account_keys=[normalized_account])
    auth_guard.verify_challenge("reset", payload.captcha_id, payload.captcha_code)
    validate_password_strength(payload.password)

    user = find_user_by_account(db, normalized_account)
    if not user:
        raise HTTPException(status_code=404, detail="账号不存在。")

    verify_code(
        db,
        channel=resolve_account_channel(normalized_account),
        purpose=RESET_PASSWORD_PURPOSE,
        target=normalized_account,
        code=payload.verification_code,
    )

    user.password_hash = hash_password(payload.password)
    db.add(user)
    db.commit()
    auth_guard.record_success("login", account_keys=[normalized_account])
    return {"message": "密码重置成功，请使用新密码登录。"}


@router.post("/register", response_model=AuthResponse)
def register(
    request: Request,
    payload: RegisterRequest,
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    client_ip = get_client_ip(request)
    account_keys = [payload.phone]
    if payload.email:
        account_keys.append(payload.email)

    auth_guard.ensure_request_allowed("register", client_ip, account_keys=account_keys)
    validate_password_strength(payload.password)

    verify_code(
        db,
        channel=SMS_CHANNEL,
        purpose=REGISTER_PURPOSE,
        target=payload.phone,
        code=payload.phone_verification_code,
    )
    if payload.email and payload.email_verification_code:
        verify_code(
            db,
            channel=EMAIL_CHANNEL,
            purpose=REGISTER_PURPOSE,
            target=payload.email,
            code=payload.email_verification_code,
        )

    if payload.email:
        existing_user = db.scalar(
            select(User).where(
                or_(User.phone == payload.phone, User.email == payload.email)
            )
        )
    else:
        existing_user = db.scalar(select(User).where(User.phone == payload.phone))

    if existing_user:
        auth_guard.record_failure("register", client_ip, account_keys=account_keys)
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
    db.add(Folder(user_id=user.id, name="未分类"))
    db.commit()
    ensure_user_default_providers(db, user.id, commit=True)

    created_user = db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user.id)
    )
    if not created_user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="注册成功，但读取用户信息失败。",
        )

    auth_guard.record_success("register", account_keys=account_keys)
    return AuthResponse(
        access_token=create_access_token(created_user.uid, created_user.token_version),
        user=build_user_response(created_user),
    )


@router.post("/login", response_model=AuthResponse)
def login(
    request: Request,
    payload: LoginRequest,
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    client_ip = get_client_ip(request)
    normalized_account = normalize_account_key(payload.account)
    auth_guard.ensure_request_allowed("login", client_ip, account_keys=[normalized_account])
    auth_guard.verify_challenge("login", payload.captcha_id, payload.captcha_code)

    user = find_user_by_account(db, normalized_account)
    if not user or not verify_password(payload.password, user.password_hash):
        auth_guard.record_failure("login", client_ip, account_keys=[normalized_account])
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号或密码错误。",
        )

    if user.status != "active":
        auth_guard.record_failure("login", client_ip, account_keys=[normalized_account])
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="该账号当前不可用。",
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    ensure_user_default_providers(db, user.id, commit=True)
    db.refresh(user, attribute_names=["profile"])

    auth_guard.record_success("login", account_keys=[normalized_account])
    return AuthResponse(
        access_token=create_access_token(user.uid, user.token_version),
        user=build_user_response(user),
    )


@router.get("/me", response_model=UserResponse)
def me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    ensure_user_default_providers(db, current_user.id, commit=True)
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
    file_name = f"{current_user.uid}_{time_ns() // 1_000_000}{suffix}"
    avatar_dir = Path(settings.avatar_upload_dir)
    avatar_dir.mkdir(parents=True, exist_ok=True)
    new_avatar_path = avatar_dir / file_name
    new_avatar_path.write_bytes(content)
    mirror_upload_file(new_avatar_path, f"avatars/{file_name}")

    old_avatar_path = resolve_old_avatar_path(profile.avatar_url)
    profile.avatar_url = build_avatar_public_url(file_name)

    db.add(profile)
    db.commit()
    db.refresh(current_user, attribute_names=["profile"])

    if old_avatar_path and old_avatar_path.exists() and old_avatar_path != new_avatar_path:
        try:
            old_avatar_path.unlink()
            remove_mirrored_upload(f"avatars/{old_avatar_path.name}")
        except OSError:
            pass

    return build_user_response(current_user)
