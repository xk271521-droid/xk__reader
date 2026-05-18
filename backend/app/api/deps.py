from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models import User
from app.services.security import decode_access_token


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="登录状态已失效，请重新登录。",
    )

    token_payload = decode_access_token(token)
    if not token_payload:
        raise unauthorized
    uid = str(token_payload["sub"])
    token_version = int(token_payload.get("tv", 0))

    user = db.scalar(
        select(User)
        .options(selectinload(User.profile))
        .where(User.uid == uid)
    )
    if not user or user.status != "active" or int(user.token_version or 0) != token_version:
        raise unauthorized

    return user


def get_current_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账号没有管理权限。",
        )
    return current_user
