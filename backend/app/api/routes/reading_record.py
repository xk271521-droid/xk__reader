from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Annotation, Folder, InkAnnotation, Paper, PaperFullTranslation, PaperNoteBlock, PaperNoteNode, PaperNotebook, PaperSummary, ReadingRecord, ShapeAnnotation, User
from app.schemas.reading_record import (
    ReadingDashboardResponse,
    ReadingRecordCreate,
    ReadingRecordDurationUpdate,
    ReadingRecordResponse,
    ReadingRecordSyncPayload,
    ReadingStatsResponse,
)

router = APIRouter(prefix="/reading-records", tags=["reading-records"])

CHINA_TZ = timezone(timedelta(hours=8))
THIRTY_DAYS = timedelta(days=30)
ReadingDashboardTimeframe = Literal["week", "month", "year", "total"]

TIMEFRAME_PERIOD_LABELS: dict[ReadingDashboardTimeframe, str] = {
    "week": "本周",
    "month": "本月",
    "year": "今年",
    "total": "累计",
}

TIMEFRAME_SPOKEN_LABELS: dict[ReadingDashboardTimeframe, str] = {
    "week": "这周",
    "month": "这个月",
    "year": "今年",
    "total": "到目前为止",
}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_china() -> datetime:
    return datetime.now(CHINA_TZ)


def _week_start_china() -> datetime:
    """Monday 00:00 in China timezone."""
    now = _now_china()
    monday = now - timedelta(days=now.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def _month_start_china(now: datetime | None = None) -> datetime:
    current = now or _now_china()
    return current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _year_start_china(now: datetime | None = None) -> datetime:
    current = now or _now_china()
    return current.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


def _as_china(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(CHINA_TZ)


def _shift_months(value: datetime, delta: int) -> datetime:
    month_index = value.year * 12 + (value.month - 1) + delta
    year, month_zero = divmod(month_index, 12)
    return value.replace(
        year=year,
        month=month_zero + 1,
        day=1,
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )


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
        duration_seconds=int(record.duration_seconds or 0),
    )


def _period_label(period: str) -> str:
    labels = {
        "morning": "上午",
        "afternoon": "下午",
        "evening": "夜间",
    }
    return labels.get(period, period)


def _safe_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


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
            Paper.deleted_at.is_(None),
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
        duration_seconds=max(0, int(payload.duration_seconds or 0)),
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


@router.patch("/{record_id}/duration")
def update_reading_duration(
    record_id: int,
    payload: ReadingRecordDurationUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.scalar(
        select(ReadingRecord).where(
            ReadingRecord.id == record_id,
            ReadingRecord.user_id == current_user.id,
        )
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="阅读记录不存在。",
        )

    record.duration_seconds = max(0, int(payload.duration_seconds or 0))
    db.add(record)
    db.commit()
    return {"id": record.id, "duration_seconds": record.duration_seconds}


@router.get("/stats", response_model=ReadingStatsResponse)
def get_reading_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    week_start = _week_start_china().astimezone(timezone.utc)
    cutoff = _now_utc() - THIRTY_DAYS

    # Weekly opens count
    weekly_opens = db.scalar(
        select(func.count(ReadingRecord.id)).join(Paper, Paper.id == ReadingRecord.paper_id).where(
            ReadingRecord.user_id == current_user.id,
            ReadingRecord.opened_at >= week_start,
            Paper.deleted_at.is_(None),
        )
    ) or 0

    # Weekly distinct papers
    weekly_distinct = db.scalar(
        select(func.count(func.distinct(ReadingRecord.paper_id))).join(Paper, Paper.id == ReadingRecord.paper_id).where(
            ReadingRecord.user_id == current_user.id,
            ReadingRecord.opened_at >= week_start,
            Paper.deleted_at.is_(None),
        )
    ) or 0

    # All records within 30 days for time distribution and sync
    recent_records_query = (
        select(ReadingRecord)
        .join(Paper, Paper.id == ReadingRecord.paper_id)
        .where(
            ReadingRecord.user_id == current_user.id,
            ReadingRecord.opened_at >= cutoff,
            Paper.deleted_at.is_(None),
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


@router.get("/dashboard", response_model=ReadingDashboardResponse)
def get_reading_dashboard(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    timeframe: Annotated[ReadingDashboardTimeframe, Query()] = "month",
):
    now_utc = _now_utc()
    now_china = _now_china()
    month_start_china = _month_start_china(now_china)
    year_start_china = _year_start_china(now_china)
    week_start_china = _week_start_china()
    month_start_utc = month_start_china.astimezone(timezone.utc)
    year_start_utc = year_start_china.astimezone(timezone.utc)
    week_start_utc = week_start_china.astimezone(timezone.utc)

    timeframe_start_china_map: dict[ReadingDashboardTimeframe, datetime | None] = {
        "week": week_start_china,
        "month": month_start_china,
        "year": year_start_china,
        "total": None,
    }
    timeframe_start_utc_map: dict[ReadingDashboardTimeframe, datetime | None] = {
        "week": week_start_utc,
        "month": month_start_utc,
        "year": year_start_utc,
        "total": None,
    }
    timeframe_start_china = timeframe_start_china_map[timeframe]
    timeframe_start_utc = timeframe_start_utc_map[timeframe]
    timeframe_label = TIMEFRAME_PERIOD_LABELS[timeframe]
    timeframe_spoken_label = TIMEFRAME_SPOKEN_LABELS[timeframe]

    papers = db.scalars(
        select(Paper)
        .where(Paper.user_id == current_user.id, Paper.deleted_at.is_(None))
        .order_by(Paper.created_at.desc())
    ).all()
    paper_ids = [paper.id for paper in papers]
    paper_by_id = {paper.id: paper for paper in papers}
    total_papers = len(papers)

    if paper_ids:
        folder_rows = db.execute(
            select(Folder.id, Folder.name)
            .where(Folder.id.in_({paper.folder_id for paper in papers if paper.folder_id}))
        ).all()
        folder_name_by_id = {int(folder_id): name or "未分类" for folder_id, name in folder_rows}
    else:
        folder_name_by_id = {}

    reading_rows = db.scalars(
        select(ReadingRecord)
        .join(Paper, Paper.id == ReadingRecord.paper_id)
        .where(
            ReadingRecord.user_id == current_user.id,
            Paper.deleted_at.is_(None),
        )
        .order_by(ReadingRecord.opened_at.desc())
    ).all()

    scoped_reading_rows = [
        row for row in reading_rows
        if timeframe_start_utc is None or (_as_utc(row.opened_at) or now_utc) >= timeframe_start_utc
    ]
    scoped_opens = len(scoped_reading_rows)
    scoped_read_papers = len({row.paper_id for row in scoped_reading_rows})
    total_read_papers = len({row.paper_id for row in reading_rows})
    scoped_duration_seconds = sum(max(0, int(row.duration_seconds or 0)) for row in scoped_reading_rows)
    scoped_duration_minutes = round(scoped_duration_seconds / 60)
    scoped_duration_hours = round(scoped_duration_seconds / 3600, 1) if scoped_duration_seconds else 0

    daily_reading_map: dict[str, int] = {}
    for row in scoped_reading_rows:
        opened_at = _as_china(row.opened_at) or now_china
        day_key = opened_at.date().isoformat()
        daily_reading_map[day_key] = daily_reading_map.get(day_key, 0) + 1

    reading_trend = []
    if timeframe == "week":
        for offset in range(7):
            current_day = (week_start_china + timedelta(days=offset)).date()
            reading_trend.append({
                "day": current_day.strftime("%m-%d"),
                "opens": daily_reading_map.get(current_day.isoformat(), 0),
            })
    elif timeframe == "month":
        for day in range(1, now_china.day + 1):
            current_day = month_start_china.replace(day=day).date()
            reading_trend.append({
                "day": f"{day:02d}",
                "opens": daily_reading_map.get(current_day.isoformat(), 0),
            })
    elif timeframe == "year":
        month_cursor = year_start_china
        while month_cursor <= now_china:
            next_month = _shift_months(month_cursor, 1)
            count = sum(
                opens for date_key, opens in daily_reading_map.items()
                if month_cursor.date() <= datetime.fromisoformat(date_key).date() < next_month.date()
            )
            reading_trend.append({
                "day": f"{month_cursor.month:02d}月",
                "opens": count,
            })
            month_cursor = next_month
    else:
        month_bucket_map: dict[str, int] = {}
        oldest_reading = _as_china(scoped_reading_rows[-1].opened_at) if scoped_reading_rows else None
        bucket_start = (oldest_reading or now_china).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        current_bucket = bucket_start
        while current_bucket <= now_china:
            month_bucket_map[current_bucket.strftime("%Y-%m")] = 0
            current_bucket = _shift_months(current_bucket, 1)
        for date_key, opens in daily_reading_map.items():
            day = datetime.fromisoformat(date_key)
            bucket_key = day.strftime("%Y-%m")
            month_bucket_map[bucket_key] = month_bucket_map.get(bucket_key, 0) + opens
        reading_trend = [
            {"day": bucket_key[2:].replace("-", "/"), "opens": count}
            for bucket_key, count in month_bucket_map.items()
        ]

    scoped_imported_papers = [
        paper for paper in papers
        if timeframe_start_utc is None or (_as_utc(paper.created_at) or now_utc) >= timeframe_start_utc
    ]
    scoped_imports = len(scoped_imported_papers)
    import_trend_map: dict[str, int] = {}
    for paper in scoped_imported_papers:
        created_at = _as_china(paper.created_at) or now_china
        day_key = created_at.date().isoformat()
        import_trend_map[day_key] = import_trend_map.get(day_key, 0) + 1

    import_trend = []
    if timeframe == "week":
        for offset in range(7):
            current_day = (week_start_china + timedelta(days=offset)).date()
            import_trend.append({
                "day": current_day.strftime("%m-%d"),
                "imports": import_trend_map.get(current_day.isoformat(), 0),
            })
    elif timeframe == "month":
        for day in range(1, now_china.day + 1):
            current_day = month_start_china.replace(day=day).date()
            import_trend.append({
                "day": f"{day:02d}",
                "imports": import_trend_map.get(current_day.isoformat(), 0),
            })
    elif timeframe == "year":
        month_cursor = year_start_china
        while month_cursor <= now_china:
            next_month = _shift_months(month_cursor, 1)
            count = sum(
                imports for date_key, imports in import_trend_map.items()
                if month_cursor.date() <= datetime.fromisoformat(date_key).date() < next_month.date()
            )
            import_trend.append({
                "day": f"{month_cursor.month:02d}月",
                "imports": count,
            })
            month_cursor = next_month
    else:
        month_bucket_map: dict[str, int] = {}
        oldest_import = _as_china(scoped_imported_papers[-1].created_at) if scoped_imported_papers else None
        bucket_start = (oldest_import or now_china).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        current_bucket = bucket_start
        while current_bucket <= now_china:
            month_bucket_map[current_bucket.strftime("%Y-%m")] = 0
            current_bucket = _shift_months(current_bucket, 1)
        for date_key, imports in import_trend_map.items():
            day = datetime.fromisoformat(date_key)
            bucket_key = day.strftime("%Y-%m")
            month_bucket_map[bucket_key] = month_bucket_map.get(bucket_key, 0) + imports
        import_trend = [
            {"day": bucket_key[2:].replace("-", "/"), "imports": count}
            for bucket_key, count in month_bucket_map.items()
        ]

    time_distribution_map = {"morning": 0, "afternoon": 0, "evening": 0}
    for row in scoped_reading_rows:
        time_distribution_map[_classify_period(row.opened_at)] += 1
    dominant_period = max(time_distribution_map, key=time_distribution_map.get) if scoped_reading_rows else None
    if dominant_period and time_distribution_map[dominant_period] == 0:
        dominant_period = None
    time_distribution = [
        {"period": key, "label": _period_label(key), "value": value}
        for key, value in time_distribution_map.items()
    ]

    paper_ids_with_activity = {row.paper_id for row in scoped_reading_rows}
    folder_distribution_map: dict[str, int] = {}
    for paper in papers:
        if timeframe != "total" and paper.id not in paper_ids_with_activity:
            continue
        folder_name = folder_name_by_id.get(int(paper.folder_id), "未分类")
        folder_distribution_map[folder_name] = folder_distribution_map.get(folder_name, 0) + 1
    folder_distribution = [
        {"name": name, "value": count}
        for name, count in sorted(folder_distribution_map.items(), key=lambda item: (-item[1], item[0]))[:6]
    ]

    text_annotation_query = select(func.count(Annotation.id)).where(Annotation.user_id == current_user.id)
    if timeframe_start_utc is not None:
        text_annotation_query = text_annotation_query.where(Annotation.created_at >= timeframe_start_utc)
    text_annotation_count = db.scalar(text_annotation_query) or 0

    ink_annotation_query = select(func.count(InkAnnotation.id)).where(InkAnnotation.user_id == current_user.id)
    if timeframe_start_utc is not None:
        ink_annotation_query = ink_annotation_query.where(InkAnnotation.created_at >= timeframe_start_utc)
    ink_annotation_count = db.scalar(ink_annotation_query) or 0
    shape_annotation_query = select(func.count(ShapeAnnotation.id)).where(ShapeAnnotation.user_id == current_user.id)
    if timeframe_start_utc is not None:
        shape_annotation_query = shape_annotation_query.where(ShapeAnnotation.created_at >= timeframe_start_utc)
    shape_annotation_count = db.scalar(shape_annotation_query) or 0
    annotation_count = int(text_annotation_count or 0) + int(ink_annotation_count or 0) + int(shape_annotation_count or 0)

    note_rows = db.execute(
        select(
            PaperNotebook.paper_id,
            func.count(func.distinct(PaperNotebook.id)),
            func.count(PaperNoteBlock.id),
            func.max(func.coalesce(PaperNoteBlock.updated_at, PaperNoteNode.updated_at, PaperNotebook.updated_at)),
        )
        .join(PaperNoteNode, PaperNoteNode.notebook_id == PaperNotebook.id, isouter=True)
        .join(PaperNoteBlock, PaperNoteBlock.node_id == PaperNoteNode.id, isouter=True)
        .where(PaperNotebook.user_id == current_user.id)
        .where(PaperNotebook.paper_id.in_(paper_ids))
        .group_by(PaperNotebook.paper_id)
    ).all()

    note_blocks_total = 0
    papers_with_notes = 0
    note_block_count_by_paper: dict[int, int] = {}
    for paper_id, notebook_count, block_count, latest_note_activity in note_rows:
        notebooks = int(notebook_count or 0)
        blocks = int(block_count or 0)
        if notebooks <= 0:
            continue
        if timeframe_start_utc is not None:
            latest_note_activity = _as_utc(latest_note_activity)
            if latest_note_activity is None or latest_note_activity < timeframe_start_utc:
                continue
        papers_with_notes += 1
        display_count = blocks or notebooks
        note_blocks_total += display_count
        note_block_count_by_paper[int(paper_id)] = display_count

    summary_query = select(func.count(PaperSummary.id)).where(
        PaperSummary.user_id == current_user.id,
        PaperSummary.status == "generated",
    )
    if timeframe_start_utc is not None:
        summary_query = summary_query.where(PaperSummary.updated_at >= timeframe_start_utc)
    summary_count = db.scalar(summary_query) or 0

    translation_query = select(func.count(PaperFullTranslation.id))
    translation_query = translation_query.join(Paper, Paper.id == PaperFullTranslation.paper_id).where(
        Paper.user_id == current_user.id,
        Paper.deleted_at.is_(None),
        PaperFullTranslation.status == "completed",
    )
    if timeframe_start_utc is not None:
        translation_query = translation_query.where(PaperFullTranslation.updated_at >= timeframe_start_utc)
    translation_count = db.scalar(
        translation_query
    ) or 0

    resource_distribution = [
        {"name": "摘要", "value": int(summary_count or 0)},
        {"name": "笔记", "value": int(note_blocks_total or 0)},
        {"name": "标注", "value": int(annotation_count or 0)},
        {"name": "翻译", "value": int(translation_count or 0)},
    ]

    recent_readings = []
    seen_recent_paper_ids: set[int] = set()
    for row in scoped_reading_rows:
        if row.paper_id in seen_recent_paper_ids:
            continue
        paper = paper_by_id.get(row.paper_id)
        if not paper:
            continue
        seen_recent_paper_ids.add(row.paper_id)
        recent_readings.append({
            "paper_id": row.paper_id,
            "title": paper.title or paper.file_name,
            "file_name": paper.file_name,
            "folder_name": folder_name_by_id.get(int(paper.folder_id), "未分类"),
            "opened_at": _safe_iso(row.opened_at),
        })
        if len(recent_readings) >= 5:
            break

    recent_imports = [
        {
            "paper_id": paper.id,
            "title": paper.title or paper.file_name,
            "file_name": paper.file_name,
            "folder_name": folder_name_by_id.get(int(paper.folder_id), "未分类"),
            "created_at": _safe_iso(paper.created_at),
        }
        for paper in scoped_imported_papers[:5]
    ]

    read_count_by_paper: dict[int, int] = {}
    for row in scoped_reading_rows:
        read_count_by_paper[row.paper_id] = read_count_by_paper.get(row.paper_id, 0) + 1

    spotlight_papers = []
    ranked_papers = sorted(
        {paper_id for paper_id in paper_ids if read_count_by_paper.get(paper_id, 0) or note_block_count_by_paper.get(paper_id, 0)},
        key=lambda paper_id: (
            -(read_count_by_paper.get(paper_id, 0) * 3 + note_block_count_by_paper.get(paper_id, 0)),
            paper_by_id[paper_id].title or paper_by_id[paper_id].file_name,
        ),
    )
    for paper_id in ranked_papers[:4]:
        paper = paper_by_id.get(paper_id)
        if not paper:
            continue
        spotlight_papers.append({
            "paper_id": paper_id,
            "title": paper.title or paper.file_name,
            "folder_name": folder_name_by_id.get(int(paper.folder_id), "未分类"),
            "reads": read_count_by_paper.get(paper_id, 0),
            "notes": note_block_count_by_paper.get(paper_id, 0),
            "last_viewed_at": _safe_iso(paper.last_viewed_at),
        })

    active_days = sum(1 for item in reading_trend if int(item["opens"]) > 0)
    annotation_density = round(annotation_count / total_papers, 1) if total_papers else 0
    note_density = round(note_blocks_total / total_papers, 1) if total_papers else 0
    read_rate = round((total_read_papers / total_papers) * 100) if total_papers else 0

    insight_cards = [
        {
            "id": "read-rate",
            "title": "阅读覆盖率",
            "value": read_rate,
            "unit": "%",
            "description": f"{total_read_papers} / {total_papers} 篇文献已有阅读记录",
            "tone": "violet",
        },
        {
            "id": "note-density",
            "title": "笔记沉淀密度",
            "value": note_density,
            "unit": "条/篇",
            "description": f"平均每篇文献沉淀 {note_density} 条笔记内容",
            "tone": "emerald",
        },
        {
            "id": "annotation-density",
            "title": "标注活跃度",
            "value": annotation_density,
            "unit": "条/篇",
            "description": f"文字高亮与手写标注合计 {annotation_count} 条",
            "tone": "amber",
        },
        {
            "id": "active-days",
            "title": "月内活跃天数",
            "value": active_days,
            "unit": "天",
            "description": "本月出现阅读行为的自然日数量",
            "tone": "sky",
        },
    ]

    return ReadingDashboardResponse(
        overview={
            "total_papers": total_papers,
            "monthly_imports": scoped_imports,
            "monthly_opens": scoped_opens,
            "monthly_read_papers": scoped_read_papers,
            "monthly_duration_seconds": scoped_duration_seconds,
            "monthly_duration_minutes": scoped_duration_minutes,
            "monthly_duration_hours": scoped_duration_hours,
            "papers_with_notes": papers_with_notes,
            "note_blocks_total": note_blocks_total,
            "annotation_count": annotation_count,
            "dominant_period": dominant_period,
            "dominant_period_label": _period_label(dominant_period) if dominant_period else None,
            "latest_reading_at": recent_readings[0]["opened_at"] if recent_readings else None,
            "timeframe": timeframe,
            "timeframe_label": timeframe_label,
            "timeframe_spoken_label": timeframe_spoken_label,
        },
        reading_trend=reading_trend,
        import_trend=import_trend,
        time_distribution=time_distribution,
        folder_distribution=folder_distribution,
        resource_distribution=resource_distribution,
        recent_readings=recent_readings,
        recent_imports=recent_imports,
        spotlight_papers=spotlight_papers,
        insight_cards=insight_cards,
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
            select(Paper.id).where(Paper.user_id == current_user.id, Paper.deleted_at.is_(None))
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
                duration_seconds=max(0, int(item.duration_seconds or 0)),
            )
        )
        synced += 1

    db.commit()

    return {"synced_count": synced, "skipped_count": skipped}
