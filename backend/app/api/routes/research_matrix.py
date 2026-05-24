from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import PaperSummary, ResearchMatrixRun, User
from app.schemas.research_matrix import (
    ResearchDashboardResponse,
    ResearchMatrixCreateRequest,
    ResearchMatrixDraftSectionRewriteRequest,
    ResearchMatrixGenerateMissingRequest,
    ResearchMatrixGenerateMissingResponse,
    ResearchMatrixGroupingModeUpdateRequest,
    ResearchMatrixOutlineUpdateRequest,
    ResearchMatrixPrepareDraftSourcesRequest,
    ResearchMatrixRefreshRequest,
    ResearchMatrixRetryPaperRequest,
    ResearchMatrixRunListResponse,
    ResearchMatrixRunPaperUpdateRequest,
    ResearchMatrixRunResponse,
    ResearchMatrixRunUpdateRequest,
)
from app.services.paper_summary import is_summary_stale, spawn_paper_summary_worker
from app.services.membership import (
    QUOTA_MATRIX_RUN_MONTHLY,
    consume_quota,
    should_start_matrix_immediately,
    should_start_summary_immediately,
)
from app.services.research_matrix import (
    DELETED_SOURCE_PAPER_MESSAGE,
    DRAFT_REQUIRED_SUMMARY_TYPES,
    RUN_STAGE_LABELS,
    WORKER_MAX_RETRIES,
    build_dashboard_snapshot,
    build_run_source_state_map,
    create_matrix_run,
    ensure_unique_paper_ids,
    get_owned_papers,
    inspect_run_source_state,
    is_run_worker_stale,
    normalize_run_runtime_state,
    prepare_missing_run_draft_sources,
    rename_matrix_run,
    refresh_run_insights,
    retry_pending_run,
    rewrite_matrix_run_draft_section,
    run_dependencies_ready,
    serialize_run_detail,
    serialize_run_list_item,
    serialize_draft_state,
    spawn_matrix_run_worker,
    sync_run_draft_snapshot,
    sync_run_draft_progress,
    sync_run_matrix_snapshot,
    update_run_progress,
    update_matrix_run_grouping_mode,
    update_matrix_run_outline,
    update_matrix_run_paper,
    utcnow,
)

router = APIRouter(prefix="/research-matrix", tags=["research-matrix"])


def _spawn_matrix_run_task(run_id: int, provider_id: int | None = None) -> None:
    spawn_matrix_run_worker(run_id, provider_id)


def _ensure_matrix_worker_started(
    db: Session,
    run: ResearchMatrixRun,
    provider_id: int | None = None,
) -> ResearchMatrixRun:
    run = normalize_run_runtime_state(db, run)
    if run.status not in {"queued", "running"}:
        return run
    if run.status == "running" and run.worker_status == "running" and run.worker_heartbeat_at and not is_run_worker_stale(run):
        return run
    if not run_dependencies_ready(db, run):
        summary_ids = prepare_missing_run_draft_sources(
            db,
            run,
            provider_id=provider_id,
            summary_types=DRAFT_REQUIRED_SUMMARY_TYPES,
        )
        for summary_id in summary_ids:
            spawn_paper_summary_worker(summary_id, provider_id)
        refreshed = db.get(ResearchMatrixRun, run.id)
        return refreshed or run
    if run.status == "queued" and not should_start_matrix_immediately(db, run.user_id):
        return run
    if run.status == "queued":
        run.status = "running"
    if not run.stage or run.stage in {"idle", "queued"}:
        run.stage = "building_matrix" if run.total_count and run.ready_count >= run.total_count else "preparing_reviews"
    run.error_message = None
    now = utcnow()
    run.worker_status = "running"
    run.worker_started_at = now
    run.worker_heartbeat_at = now
    run.worker_pid = None
    run.last_worker_error = None
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        _spawn_matrix_run_task(run.id, provider_id)
    except Exception as exc:
        run.status = "queued"
        run.stage = "queued"
        run.worker_status = "failed"
        run.worker_pid = None
        run.last_worker_error = f"启动矩阵 worker 失败：{exc}"
        db.add(run)
        db.commit()
        raise HTTPException(status_code=500, detail="启动文献矩阵后台任务失败，请稍后重试") from exc
    return run


def resume_stale_matrix_runs() -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        runs = db.scalars(
            select(ResearchMatrixRun).options(selectinload(ResearchMatrixRun.papers)).where(
                ResearchMatrixRun.status.in_(["queued", "running"])
            )
        ).all()
        for run in runs:
            if run.status == "queued":
                _ensure_matrix_worker_started(db, run, None)
                continue
            if run.worker_status != "running" or not run.worker_heartbeat_at or is_run_worker_stale(run):
                if int(run.worker_retry_count or 0) > WORKER_MAX_RETRIES:
                    continue
                _ensure_matrix_worker_started(db, run, None)
    finally:
        db.close()


def _load_run(db: Session, run_id: int, user_id: int) -> ResearchMatrixRun:
    run = db.scalar(
        select(ResearchMatrixRun)
        .options(selectinload(ResearchMatrixRun.papers))
        .where(
            ResearchMatrixRun.id == run_id,
            ResearchMatrixRun.user_id == user_id,
        )
    )
    if not run:
        raise HTTPException(status_code=404, detail="文献矩阵记录不存在")
    return run


def _raise_if_run_source_deleted(db: Session, run: ResearchMatrixRun, user_id: int) -> None:
    source_state = inspect_run_source_state(db, run, user_id)
    if source_state["has_deleted_papers"]:
        raise HTTPException(status_code=409, detail=DELETED_SOURCE_PAPER_MESSAGE)


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _serialize_run_status(run: ResearchMatrixRun) -> dict:
    stage = run.stage or "idle"
    config = run.config_json if isinstance(run.config_json, dict) else {}
    grouping_mode = str(config.get("grouping_mode") or "topic_first")
    return {
        "id": run.id,
        "title": run.title,
        "status": run.status,
        "stage": stage,
        "stage_label": RUN_STAGE_LABELS.get(stage, stage),
        "paper_count": run.paper_count,
        "version": run.version,
        "refreshed_from_id": run.refreshed_from_id,
        "progress_percent": int(run.progress_percent or 0),
        "ready_count": int(run.ready_count or 0),
        "total_count": int(run.total_count or run.paper_count or 0),
        "failed_count": int(run.failed_count or 0),
        "error_message": run.error_message,
        "created_at": _iso(run.created_at),
        "updated_at": _iso(run.updated_at),
        "grouping_mode": grouping_mode,
        "grouping_modes": [grouping_mode],
        "worker_status": run.worker_status or "idle",
        "worker_started_at": _iso(run.worker_started_at),
        "worker_heartbeat_at": _iso(run.worker_heartbeat_at),
        "worker_retry_count": int(run.worker_retry_count or 0),
        "last_worker_error": run.last_worker_error,
        **serialize_draft_state(run),
    }


@router.get("/dashboard", response_model=ResearchDashboardResponse)
def get_research_dashboard(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchDashboardResponse:
    return ResearchDashboardResponse(**build_dashboard_snapshot(db, current_user.id))


@router.get("/runs", response_model=ResearchMatrixRunListResponse)
def list_matrix_runs(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunListResponse:
    runs = db.scalars(
        select(ResearchMatrixRun)
        .options(selectinload(ResearchMatrixRun.papers))
        .where(ResearchMatrixRun.user_id == current_user.id)
        .order_by(ResearchMatrixRun.created_at.desc(), ResearchMatrixRun.id.desc())
        .limit(80)
    ).all()
    for run in runs:
        if run.status in {"queued", "running"}:
            _ensure_matrix_worker_started(db, run, None)
    runs = db.scalars(
        select(ResearchMatrixRun)
        .options(selectinload(ResearchMatrixRun.papers))
        .where(ResearchMatrixRun.user_id == current_user.id)
        .order_by(ResearchMatrixRun.created_at.desc(), ResearchMatrixRun.id.desc())
        .limit(80)
    ).all()
    source_state_map = build_run_source_state_map(db, runs, current_user.id)
    return ResearchMatrixRunListResponse(
        runs=[
            serialize_run_list_item(
                db,
                run,
                current_user.id,
                source_state=source_state_map.get(run.id),
            )
            for run in runs
        ]
    )


@router.get("/runs/status", response_model=ResearchMatrixRunListResponse)
def list_matrix_run_statuses(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunListResponse:
    runs = db.scalars(
        select(ResearchMatrixRun)
        .where(ResearchMatrixRun.user_id == current_user.id)
        .order_by(ResearchMatrixRun.created_at.desc(), ResearchMatrixRun.id.desc())
        .limit(80)
    ).all()
    return ResearchMatrixRunListResponse(runs=[_serialize_run_status(run) for run in runs])


@router.post("/runs", response_model=ResearchMatrixRunResponse, status_code=status.HTTP_201_CREATED)
def create_matrix_run_endpoint(
    payload: ResearchMatrixCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    paper_ids = ensure_unique_paper_ids(payload.paper_ids)
    papers = get_owned_papers(db, current_user.id, paper_ids)
    if not papers:
        raise HTTPException(status_code=404, detail="没有可用的文献")
    consume_quota(
        db,
        user_id=current_user.id,
        quota_key=QUOTA_MATRIX_RUN_MONTHLY,
    )
    try:
        run = create_matrix_run(
            db,
            current_user.id,
            [paper.id for paper in papers],
            title=payload.title,
            include_reproduction=payload.include_reproduction,
            grouping_mode=payload.grouping_mode,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="没有可用的文献") from None
    run = _load_run(db, run.id, current_user.id)
    for summary_id in prepare_missing_run_draft_sources(
        db,
        run,
        provider_id=payload.provider_id,
        summary_types=DRAFT_REQUIRED_SUMMARY_TYPES,
    ):
        spawn_paper_summary_worker(summary_id, payload.provider_id)
    sync_run_draft_progress(db, run)
    run = _ensure_matrix_worker_started(db, run, payload.provider_id)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, run, current_user.id))


@router.get("/runs/{run_id}", response_model=ResearchMatrixRunResponse)
def get_matrix_run(
    run_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    draft_state = (run.config_json or {}).get("draft_state") if isinstance(run.config_json, dict) else {}
    if (draft_state or {}).get("status") != "completed":
        sync_run_draft_progress(db, run)
        run = _load_run(db, run_id, current_user.id)
        refreshed_draft_state = (run.config_json or {}).get("draft_state") if isinstance(run.config_json, dict) else {}
        if (refreshed_draft_state or {}).get("status") == "completed":
            sync_run_draft_snapshot(db, run)
            run = _load_run(db, run_id, current_user.id)
    if run.status in {"queued", "running"} and run.ready_count >= run.total_count and run.total_count:
        sync_run_matrix_snapshot(db, run, current_user.id)
        run = _load_run(db, run_id, current_user.id)
        source_state = (run.config_json or {}).get("draft_state") if isinstance(run.config_json, dict) else {}
        if (source_state or {}).get("status") == "completed":
            run.status = "completed"
            run.stage = "completed"
            run.progress_percent = 100
            run.error_message = None
            db.add(run)
            db.commit()
            db.refresh(run)
    if run.status in {"queued", "running"}:
        run = _ensure_matrix_worker_started(db, run, None)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, run, current_user.id))


@router.patch("/runs/{run_id}", response_model=ResearchMatrixRunResponse)
def update_matrix_run(
    run_id: int,
    payload: ResearchMatrixRunUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    run = rename_matrix_run(db, run, title=payload.title)
    run = _load_run(db, run.id, current_user.id)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, run, current_user.id))


@router.patch("/runs/{run_id}/grouping-mode", response_model=ResearchMatrixRunResponse)
def update_matrix_run_grouping_mode_endpoint(
    run_id: int,
    payload: ResearchMatrixGroupingModeUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    try:
        updated = update_matrix_run_grouping_mode(
            db,
            run,
            user_id=current_user.id,
            grouping_mode=payload.grouping_mode,
        )
    except ValueError as exc:
        mapping = {
            "run_not_completed": (409, "当前批次尚未完成，暂不能切换生成模式"),
            "run_missing": (404, "文献矩阵记录不存在"),
        }
        status_code, detail = mapping.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=status_code, detail=detail) from None
    return ResearchMatrixRunResponse(**serialize_run_detail(db, updated, current_user.id))


@router.patch("/runs/{run_id}/papers/{paper_id}", response_model=ResearchMatrixRunResponse)
def update_matrix_run_paper_endpoint(
    run_id: int,
    paper_id: int,
    payload: ResearchMatrixRunPaperUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    try:
        updated = update_matrix_run_paper(
            db,
            run,
            paper_id=paper_id,
            user_id=current_user.id,
            paper_field_updates=payload.paper_field_updates,
            run_field_updates=payload.run_field_updates,
        )
    except ValueError as exc:
        mapping = {
            "paper_source_deleted": (409, DELETED_SOURCE_PAPER_MESSAGE),
            "run_not_completed": (409, "当前批次尚未完成，暂不能编辑"),
            "paper_not_found": (404, "当前批次中没有这篇论文"),
            "invalid_paper_fields": (400, "没有可保存的单篇综述字段"),
            "summary_not_ready": (409, "单篇综述卡片尚未准备好"),
            "run_missing": (404, "文献矩阵记录不存在"),
        }
        status_code, detail = mapping.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=status_code, detail=detail) from None
    return ResearchMatrixRunResponse(**serialize_run_detail(db, updated, current_user.id))


@router.post("/runs/{run_id}/papers/{paper_id}/retry-review", response_model=ResearchMatrixRunResponse)
def retry_matrix_run_paper_review(
    run_id: int,
    paper_id: int,
    payload: ResearchMatrixRetryPaperRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    target = next((item for item in run.papers if item.paper_id == paper_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="当前批次里没有这篇论文")
    papers = get_owned_papers(db, current_user.id, [paper_id])
    if not papers:
        raise HTTPException(status_code=404, detail="原论文不存在或已删除")
    paper = papers[0]

    summary = db.scalar(
        select(PaperSummary).where(
            PaperSummary.paper_id == paper_id,
            PaperSummary.user_id == current_user.id,
            PaperSummary.summary_type == "review",
        )
    )
    if summary and summary.status == "running":
        target.summary_status = "running"
        target.is_missing = True
        target.is_stale = False
        db.add(target)
        sync_run_matrix_snapshot(db, run, current_user.id)
        update_run_progress(run)
        db.add(run)
        db.commit()
        refreshed = _load_run(db, run_id, current_user.id)
        return ResearchMatrixRunResponse(**serialize_run_detail(db, refreshed, current_user.id))

    if summary and summary.status == "generated" and not is_summary_stale(db, paper, summary):
        target.summary_status = "generated"
        target.summary_updated_at = _iso(summary.updated_at) or ""
        target.summary_source_hash = summary.source_hash or ""
        target.is_missing = False
        target.is_stale = False
        db.add(target)
        sync_run_matrix_snapshot(db, run, current_user.id)
        update_run_progress(run)
        db.add(run)
        db.commit()
        refreshed = _load_run(db, run_id, current_user.id)
        return ResearchMatrixRunResponse(**serialize_run_detail(db, refreshed, current_user.id))

    if not summary:
        summary = PaperSummary(
            paper_id=paper_id,
            user_id=current_user.id,
            summary_type="review",
            content_json={},
        )
    should_start_now = should_start_summary_immediately(db, current_user.id)
    summary.status = "running" if should_start_now else "queued"
    summary.stage = "extracting_context" if should_start_now else "queued"
    summary.progress = 3 if should_start_now else 0
    summary.provider_id = payload.provider_id
    summary.error_message = None
    db.add(summary)
    db.flush()

    target.summary_status = summary.status
    target.summary_updated_at = _iso(summary.updated_at) or ""
    target.summary_source_hash = summary.source_hash or ""
    target.is_missing = True
    target.is_stale = False
    db.add(target)
    sync_run_matrix_snapshot(db, run, current_user.id)
    update_run_progress(run)
    db.add(run)
    db.commit()

    if should_start_now:
        spawn_paper_summary_worker(summary.id, payload.provider_id)

    refreshed = _load_run(db, run_id, current_user.id)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, refreshed, current_user.id))


@router.patch("/runs/{run_id}/outline", response_model=ResearchMatrixRunResponse)
def update_matrix_run_outline_endpoint(
    run_id: int,
    payload: ResearchMatrixOutlineUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    try:
        updated = update_matrix_run_outline(
            db,
            run,
            outline_sections=payload.outline_sections,
        )
    except ValueError as exc:
        mapping = {
            "run_not_completed": (409, "当前批次尚未完成，暂不能编辑大纲"),
            "outline_missing": (400, "没有可保存的大纲内容"),
            "run_missing": (404, "文献矩阵记录不存在"),
        }
        status_code, detail = mapping.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=status_code, detail=detail) from None
    return ResearchMatrixRunResponse(**serialize_run_detail(db, updated, current_user.id))


@router.post("/runs/{run_id}/drafts:rewrite-section", response_model=ResearchMatrixRunResponse)
def rewrite_matrix_run_draft_section_endpoint(
    run_id: int,
    payload: ResearchMatrixDraftSectionRewriteRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    try:
        updated = rewrite_matrix_run_draft_section(
            db,
            run,
            section_key=payload.section_key,
        )
    except ValueError as exc:
        mapping = {
            "run_not_completed": (409, "当前批次尚未完成，暂不能重写草稿"),
            "draft_section_invalid": (400, "无效的草稿章节"),
            "draft_section_missing": (404, "当前批次里没有这节草稿"),
            "draft_sources_missing": (409, "当前草稿来源还没齐，暂时不能重写"),
            "run_missing": (404, "文献矩阵记录不存在"),
        }
        status_code, detail = mapping.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=status_code, detail=detail) from None
    return ResearchMatrixRunResponse(**serialize_run_detail(db, updated, current_user.id))


@router.post("/runs/{run_id}/drafts:prepare-sources", response_model=ResearchMatrixRunResponse)
def prepare_matrix_run_draft_sources_endpoint(
    run_id: int,
    payload: ResearchMatrixPrepareDraftSourcesRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    summary_ids = prepare_missing_run_draft_sources(
        db,
        run,
        provider_id=payload.provider_id,
        summary_types=tuple(payload.summary_types or DRAFT_REQUIRED_SUMMARY_TYPES),
    )
    for summary_id in summary_ids:
        spawn_paper_summary_worker(summary_id, payload.provider_id)
    refreshed = _load_run(db, run_id, current_user.id)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, refreshed, current_user.id))


@router.post("/runs/{run_id}/insights:refresh", response_model=ResearchMatrixRunResponse)
def refresh_matrix_run_insights(
    run_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    try:
        refreshed = refresh_run_insights(db, run)
    except ValueError as exc:
        mapping = {
            "run_not_completed": (409, "当前批次尚未完成，暂不能刷新比较导读"),
            "run_missing": (404, "当前批次不存在"),
        }
        status_code, detail = mapping.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=status_code, detail=detail) from None
    return ResearchMatrixRunResponse(**serialize_run_detail(db, refreshed, current_user.id))


@router.post("/runs/{run_id}/refresh", response_model=ResearchMatrixRunResponse, status_code=status.HTTP_201_CREATED)
def refresh_matrix_run(
    run_id: int,
    payload: ResearchMatrixRefreshRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    paper_ids = [item.paper_id for item in run.papers if item.paper_id]
    if not paper_ids:
        raise HTTPException(status_code=400, detail="当前矩阵没有可刷新的文献")
    consume_quota(
        db,
        user_id=current_user.id,
        quota_key=QUOTA_MATRIX_RUN_MONTHLY,
    )
    refreshed = create_matrix_run(
        db,
        current_user.id,
        paper_ids,
        title=payload.title or f"{run.title} - 新版本",
        include_reproduction=bool((run.config_json or {}).get("include_reproduction", True)),
        grouping_mode=str(payload.grouping_mode or (run.config_json or {}).get("grouping_mode") or "topic_first"),
        refreshed_from_id=run.id,
    )
    refreshed = _load_run(db, refreshed.id, current_user.id)
    refreshed = _ensure_matrix_worker_started(db, refreshed, payload.provider_id)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, refreshed, current_user.id))


@router.post("/runs/{run_id}/retry-pending", response_model=ResearchMatrixRunResponse)
def retry_pending_matrix_run(
    run_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    run = retry_pending_run(db, run)
    run = _ensure_matrix_worker_started(db, run, None)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, run, current_user.id))


@router.delete("/runs/{run_id}")
def delete_matrix_run(
    run_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, bool]:
    run = _load_run(db, run_id, current_user.id)
    db.delete(run)
    db.commit()
    return {"ok": True}


@router.post("/generate-missing", response_model=ResearchMatrixGenerateMissingResponse)
def generate_missing_reviews(
    payload: ResearchMatrixGenerateMissingRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixGenerateMissingResponse:
    paper_ids = ensure_unique_paper_ids(payload.paper_ids)
    papers = get_owned_papers(db, current_user.id, paper_ids)
    if not papers:
        raise HTTPException(status_code=404, detail="没有可用的文献")

    started = 0
    skipped = 0
    running = 0
    summary_ids_to_spawn: list[int] = []
    for paper in papers:
        item = db.scalar(
            select(PaperSummary).where(
                PaperSummary.paper_id == paper.id,
                PaperSummary.user_id == current_user.id,
                PaperSummary.summary_type == "review",
            )
        )
        if item and item.status == "running":
            running += 1
            continue
        if item and item.status == "generated" and not is_summary_stale(db, paper, item):
            skipped += 1
            continue
        if not item:
            item = PaperSummary(
                paper_id=paper.id,
                user_id=current_user.id,
                summary_type="review",
                content_json={},
            )
        should_start_now = should_start_summary_immediately(db, current_user.id)
        item.status = "running" if should_start_now else "queued"
        item.stage = "extracting_context" if should_start_now else "queued"
        item.progress = 3 if should_start_now else 0
        item.provider_id = payload.provider_id
        item.error_message = None
        db.add(item)
        db.flush()
        if should_start_now:
            summary_ids_to_spawn.append(int(item.id))
        started += 1
    db.commit()
    for summary_id in summary_ids_to_spawn:
        spawn_paper_summary_worker(summary_id, payload.provider_id)
    return ResearchMatrixGenerateMissingResponse(
        started_count=started,
        skipped_count=skipped,
        running_count=running,
    )
