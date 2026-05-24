from __future__ import annotations

from datetime import timezone
from pathlib import Path
from time import time_ns
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import FeedbackTicket, Notification, User
from app.schemas.feedback import FeedbackCreateRequest, FeedbackItemResponse, FeedbackListResponse
from app.services.notification import compact_notification_text
from app.services.upload_mirror import mirror_upload_file

router = APIRouter(prefix="/feedback", tags=["feedback"])

ALLOWED_FEEDBACK_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _serialize_datetime(value) -> str | None:
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is None:
        return value.replace(tzinfo=timezone.utc).isoformat()
    return value.isoformat()


def _build_feedback_item(item: FeedbackTicket) -> FeedbackItemResponse:
    return FeedbackItemResponse(
        id=item.id,
        category=item.category,
        title=item.title,
        content=item.content,
        contact=item.contact,
        screenshot_url=item.screenshot_url,
        status=item.status,
        admin_note=item.admin_note or "",
        created_at=_serialize_datetime(item.created_at),
        updated_at=_serialize_datetime(item.updated_at),
        resolved_at=_serialize_datetime(item.resolved_at),
    )


def _build_feedback_image_public_url(file_name: str) -> str:
    return f"/uploads/feedback/{file_name}"


def _normalize_upload_url(value: str | None) -> str | None:
    if not value:
        return None
    file_name = Path(value).name
    if not file_name:
        return value
    return _build_feedback_image_public_url(file_name)


async def _save_feedback_screenshot(upload: UploadFile | None, uid: str) -> str | None:
    if upload is None:
        return None

    if upload.content_type not in ALLOWED_FEEDBACK_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="反馈截图仅支持 JPG、PNG 和 WEBP 格式。",
        )

    content = await upload.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传的截图文件为空，请重新选择。",
        )

    if len(content) > settings.feedback_image_max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="反馈截图不能超过 4MB。",
        )

    suffix = ALLOWED_FEEDBACK_IMAGE_TYPES[upload.content_type]
    file_name = f"{uid}_{time_ns() // 1_000_000}{suffix}"
    feedback_dir = Path(settings.feedback_image_upload_dir)
    feedback_dir.mkdir(parents=True, exist_ok=True)
    local_path = feedback_dir / file_name
    local_path.write_bytes(content)
    mirror_upload_file(local_path, f"feedback/{file_name}")
    return _build_feedback_image_public_url(file_name)


@router.post("", response_model=FeedbackItemResponse, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    category: Annotated[str, Form(...)],
    title: Annotated[str, Form(...)],
    content: Annotated[str, Form(...)],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    contact: Annotated[str | None, Form()] = None,
    screenshot: UploadFile | None = File(default=None),
) -> FeedbackItemResponse:
    try:
        payload = FeedbackCreateRequest(
            category=category,
            title=title,
            content=content,
            contact=contact,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    screenshot_url = await _save_feedback_screenshot(screenshot, current_user.uid)

    item = FeedbackTicket(
        user_id=current_user.id,
        category=payload.category,
        title=payload.title,
        content=payload.content,
        contact=payload.contact,
        screenshot_url=screenshot_url,
        status="open",
        admin_note="",
    )
    db.add(item)
    db.flush()

    admin_ids = db.scalars(
        select(User.id).where(
            User.is_admin.is_(True),
            User.status == "active",
        )
    ).all()
    summary_text = compact_notification_text(item.title, 90)
    actor_text = compact_notification_text(current_user.uid, 40)
    for admin_id in admin_ids:
        db.add(
            Notification(
                user_id=int(admin_id),
                source_kind="admin_broadcast",
                source_id=int(item.id),
                event_kind="broadcast",
                title="新问题反馈",
                message=compact_notification_text(f"{actor_text} 提交了反馈：{summary_text}", 320),
                action_kind="none",
                action_payload={
                    "feedback_id": int(item.id),
                    "feedback_category": item.category,
                },
            )
        )
    db.commit()
    db.refresh(item)
    return _build_feedback_item(item)


@router.get("", response_model=FeedbackListResponse)
def list_my_feedback(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FeedbackListResponse:
    items = db.scalars(
        select(FeedbackTicket)
        .where(FeedbackTicket.user_id == current_user.id)
        .order_by(FeedbackTicket.created_at.desc(), FeedbackTicket.id.desc())
        .limit(50)
    ).all()
    return FeedbackListResponse(items=[_build_feedback_item(item) for item in items])
