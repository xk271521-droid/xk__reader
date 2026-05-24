from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import User
from app.services.task_monitor import build_task_health_snapshot


router = APIRouter()


@router.get("/health")
def healthcheck(db: Annotated[Session, Depends(get_db)]) -> dict[str, bool | str]:
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        "ai_enabled": settings.ai_enabled,
    }


@router.get("/health/detail")
def health_detail(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="只有管理员可以查看系统健康详情。")
    db.execute(text("SELECT 1"))
    task_snapshot = build_task_health_snapshot(db)
    return {
        "status": task_snapshot.get("status", "ok"),
        "database": "ok",
        "features": {
            "ai_enabled": settings.ai_enabled,
            "oss_available": settings.oss_available,
            "aliyun_docmind_available": settings.aliyun_docmind_available,
            "tencent_mt_available": settings.tencent_mt_available,
            "smtp_available": settings.smtp_available,
        },
        "tasks": task_snapshot,
    }
