from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.api.deps import get_user_from_access_token
from app.db.session import SessionLocal
from app.models import Notification, User
from app.services.notification import get_unread_notification_count


router = APIRouter(prefix="/events", tags=["events"])

SSE_POLL_SECONDS = 3
SSE_HEARTBEAT_SECONDS = 21


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _sse_message(event: str, data: dict[str, Any], event_id: int | None = None) -> str:
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    payload = json.dumps(data, ensure_ascii=False, default=_json_default)
    for line in payload.splitlines() or ["{}"]:
        lines.append(f"data: {line}")
    return "\n".join(lines) + "\n\n"


def _latest_notification_snapshot(user_id: int) -> dict[str, Any]:
    db = SessionLocal()
    try:
        latest = db.scalar(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(1)
        )
        return {
            "latest_notification_id": int(latest.id) if latest else None,
            "latest_created_at": latest.created_at if latest else None,
            "unread_count": get_unread_notification_count(db, user_id),
            "source_kind": latest.source_kind if latest else "",
            "event_kind": latest.event_kind if latest else "",
            "action_kind": latest.action_kind if latest else "",
        }
    finally:
        db.close()


@router.get("/stream")
async def stream_events(
    request: Request,
    token: Annotated[str, Query(min_length=1)],
    last_event_id: Annotated[int | None, Query(alias="last_event_id")] = None,
    last_event_id_header: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    auth_db = SessionLocal()
    try:
        current_user: User = get_user_from_access_token(token, auth_db)
        user_id = int(current_user.id)
    finally:
        auth_db.close()
    initial_snapshot = _latest_notification_snapshot(user_id)
    initial_latest_id = int(initial_snapshot.get("latest_notification_id") or 0)
    try:
        header_event_id = int(last_event_id_header or 0)
    except ValueError:
        header_event_id = 0
    last_seen_id = max(0, int(last_event_id or header_event_id or initial_latest_id))

    async def event_generator():
        nonlocal last_seen_id
        heartbeat_after = 0
        yield _sse_message(
            "connected",
            {
                "latest_notification_id": initial_latest_id or None,
                "unread_count": initial_snapshot.get("unread_count", 0),
            },
        )

        while True:
            if await request.is_disconnected():
                break
            await asyncio.sleep(SSE_POLL_SECONDS)
            heartbeat_after += SSE_POLL_SECONDS
            snapshot = _latest_notification_snapshot(user_id)
            latest_id = int(snapshot.get("latest_notification_id") or 0)
            if latest_id > last_seen_id:
                last_seen_id = latest_id
                heartbeat_after = 0
                yield _sse_message("notification", snapshot, event_id=latest_id)
            elif heartbeat_after >= SSE_HEARTBEAT_SECONDS:
                heartbeat_after = 0
                yield _sse_message("heartbeat", {"ok": True})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
