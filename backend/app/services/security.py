from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from app.core.config import settings


password_hasher = PasswordHash.recommended()


def create_uid() -> str:
    return ''.join(str(random.randint(0, 9)) for _ in range(10))


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hasher.verify(password, hashed_password)


def hash_verification_code(channel: str, purpose: str, target: str, code: str) -> str:
    payload = f"{channel}:{purpose}:{target.strip().lower()}:{code.strip()}:{settings.secret_key}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def create_access_token(subject: str, token_version: int = 0) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": subject, "exp": expires_at, "tv": int(token_version or 0)}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, str | int] | None:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        return None

    subject = payload.get("sub")
    if not isinstance(subject, str):
        return None
    token_version = payload.get("tv", 0)
    if not isinstance(token_version, int):
        token_version = 0
    return {"sub": subject, "tv": token_version}
