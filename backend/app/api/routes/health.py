from fastapi import APIRouter

from app.core.config import settings


router = APIRouter()


@router.get("/health")
def healthcheck() -> dict[str, bool | str]:
    return {
        "status": "ok",
        "ai_enabled": settings.ai_enabled,
    }
