from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Paper, ReadingRecord, User
from app.schemas.reading_record import (
    ReadingRecordCreate,
    ReadingRecordResponse,
    ReadingRecordSyncPayload,
    ReadingStatsResponse,
)

router = APIRouter(prefix="/reading-records", tags=["reading-records"])

CHINA_TZ = timezone(timedelta(hours=8))
THIRTY_DAYS = timedelta(days=30)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_china() -> datetime:
    return datetime.now(CHINA_TZ)


def _week_start_china() -> datetime:
    """Monday 00:00 in China timezone."""
    now = _now_china()
    monday = now - timedelta(days=now.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def _classify_period(opened_at: datetime) -> str:
    """Classify a datetime into morning/afternoon/evening in China timezone."""
    # Ensure timezone-aware: if naive, assume UTC
    if opened_at.tzinfo is None:
        opened_at = opened_at.replace(tzinfo=timezone.utc)
    local_hour = opened_at.astimezone(CHINA_TZ).hour
    if 6 <= local_hour < 12:
        return "morning"
    if 12 <= local_hour < 18:
        return "afternoon"
    return "evening"


def _build_record_response(record: ReadingRecord) -> ReadingRecordResponse:
    paper = record.paper
    folder_name = ""
    if paper and paper.folder:
        folder_name = paper.folder.name
    return ReadingRecordResponse(
        id=record.id,
        paper_id=record.paper_id,
        file_name=paper.file_name if paper else "",
        title=paper.title or paper.file_name if paper else "",
        author=paper.author or "",
        folder_name=folder_name,
        opened_at=record.opened_at.isoformat(),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def record_reading(
    payload: ReadingRecordCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    # Validate paper belongs to user
    paper = db.scalar(
        select(Paper).where(
            Paper.id == payload.paper_id,
            Paper.user_id == current_user.id,
        )
    )
    if not paper:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="论文不存在。",
        )

    opened_at = payload.opened_at or _now_utc()

    record = ReadingRecord(
        user_id=current_user.id,
        paper_id=payload.paper_id,
        opened_at=opened_at,
    )
    db.add(record)

    # Update paper.last_viewed_at
    paper.last_viewed_at = opened_at

    # Clean records older than 30 days
    cutoff = _now_utc() - THIRTY_DAYS
    db.execute(
        delete(ReadingRecord).where(ReadingRecord.opened_at < cutoff)
    )

    db.commit()

    return {"id": record.id, "message": "ok"}


@router.get("/stats", response_model=ReadingStatsResponse)
def get_reading_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    week_start = _week_start_china().astimezone(timezone.utc)
    cutoff = _now_utc() - THIRTY_DAYS

    # Weekly opens count
    weekly_opens = db.scalar(
        select(func.count(ReadingRecord.id)).where(
            ReadingRecord.user_id == current_user.id,
            ReadingRecord.opened_at >= week_start,
        )
    ) or 0

    # Weekly distinct papers
    weekly_distinct = db.scalar(
        select(func.count(func.distinct(ReadingRecord.paper_id))).where(
            ReadingRecord.user_id == current_user.id,
            ReadingRecord.opened_at >= week_start,
        )
    ) or 0

    # All records within 30 days for time distribution and sync
    recent_records_query = (
        select(ReadingRecord)
        .where(
            ReadingRecord.user_id == current_user.id,
            ReadingRecord.opened_at >= cutoff,
        )
        .order_by(ReadingRecord.opened_at.desc())
        .limit(200)
    )
    recent_records = db.scalars(recent_records_query).all()

    # Time distribution
    time_dist = {"morning": 0, "afternoon": 0, "evening": 0}
    for record in recent_records:
        period = _classify_period(record.opened_at)
        time_dist[period] += 1

    # Dominant period
    dominant = max(time_dist, key=time_dist.get) if recent_records else None
    if dominant and time_dist[dominant] == 0:
        dominant = None

    return ReadingStatsResponse(
        weekly_opens=weekly_opens,
        weekly_distinct_papers=weekly_distinct,
        time_distribution=time_dist,
        dominant_period=dominant,
        recent_records=[_build_record_response(r) for r in recent_records],
    )


@router.post("/sync")
def sync_reading_records(
    payload: ReadingRecordSyncPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    user_paper_ids = {
        row[0]
        for row in db.execute(
            select(Paper.id).where(Paper.user_id == current_user.id)
        ).all()
    }

    synced = 0
    skipped = 0
    cutoff = _now_utc() - THIRTY_DAYS

    for item in payload.records:
        # Validate paper belongs to user
        if item.paper_id not in user_paper_ids:
            skipped += 1
            continue

        opened_at = item.opened_at or _now_utc()

        # Skip records older than 30 days
        if opened_at < cutoff:
            skipped += 1
            continue

        # Check for duplicate: same paper_id + opened_at within ±2 seconds
        dup_window_start = opened_at - timedelta(seconds=2)
        dup_window_end = opened_at + timedelta(seconds=2)
        existing = db.scalar(
            select(func.count(ReadingRecord.id)).where(
                ReadingRecord.user_id == current_user.id,
                ReadingRecord.paper_id == item.paper_id,
                ReadingRecord.opened_at >= dup_window_start,
                ReadingRecord.opened_at <= dup_window_end,
            )
        )
        if existing and existing > 0:
            skipped += 1
            continue

        db.add(
            ReadingRecord(
                user_id=current_user.id,
                paper_id=item.paper_id,
                opened_at=opened_at,
            )
        )
        synced += 1

    db.commit()

    return {"synced_count": synced, "skipped_count": skipped}
