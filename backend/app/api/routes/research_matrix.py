from __future__ import annotations

from typing import Annotated

import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import PaperSummary, ResearchMatrixRun, User
from app.schemas.research_matrix import (
    ResearchDashboardResponse,
    ResearchMatrixCreateRequest,
    ResearchMatrixGenerateMissingRequest,
    ResearchMatrixGenerateMissingResponse,
    ResearchMatrixRefreshRequest,
    ResearchMatrixRunListResponse,
    ResearchMatrixRunPaperUpdateRequest,
    ResearchMatrixRunResponse,
    ResearchMatrixRunUpdateRequest,
)
from app.services.paper_summary import is_summary_stale, run_paper_summary_task
from app.services.research_matrix import (
    DELETED_SOURCE_PAPER_MESSAGE,
    WORKER_MAX_RETRIES,
    build_dashboard_snapshot,
    create_matrix_run,
    ensure_unique_paper_ids,
    get_owned_papers,
    inspect_run_source_state,
    is_run_worker_stale,
    rename_matrix_run,
    retry_pending_run,
    run_matrix_run_task,
    serialize_run_detail,
    serialize_run_list_item,
    update_matrix_run_paper,
)

router = APIRouter(prefix="/research-matrix", tags=["research-matrix"])


def _spawn_matrix_run_task(run_id: int, provider_id: int | None = None) -> None:
    backend_root = Path(__file__).resolve().parents[3]
    args = [sys.executable, "-m", "app.services.research_matrix_worker", str(run_id)]
    if provider_id is not None:
        args.append(str(provider_id))
    subprocess.Popen(
        args,
        cwd=str(backend_root),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


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
            if run.status == "queued" or is_run_worker_stale(run):
                if int(run.worker_retry_count or 0) > WORKER_MAX_RETRIES:
                    continue
                _spawn_matrix_run_task(run.id, None)
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
    return ResearchMatrixRunListResponse(
        runs=[serialize_run_list_item(db, run, current_user.id) for run in runs]
    )


@router.post("/runs", response_model=ResearchMatrixRunResponse, status_code=status.HTTP_201_CREATED)
def create_matrix_run_endpoint(
    payload: ResearchMatrixCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    paper_ids = ensure_unique_paper_ids(payload.paper_ids)
    papers = get_owned_papers(db, current_user.id, paper_ids)
    if not papers:
        raise HTTPException(status_code=404, detail="没有可用的文献")
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
    if run.status in {"queued", "running"}:
        _spawn_matrix_run_task(run.id, payload.provider_id)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, run, current_user.id))


@router.get("/runs/{run_id}", response_model=ResearchMatrixRunResponse)
def get_matrix_run(
    run_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
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


@router.post("/runs/{run_id}/refresh", response_model=ResearchMatrixRunResponse, status_code=status.HTTP_201_CREATED)
def refresh_matrix_run(
    run_id: int,
    payload: ResearchMatrixRefreshRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    paper_ids = [item.paper_id for item in run.papers if item.paper_id]
    if not paper_ids:
        raise HTTPException(status_code=400, detail="当前矩阵没有可刷新的文献")
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
    if refreshed.status in {"queued", "running"}:
        _spawn_matrix_run_task(refreshed.id, payload.provider_id)
    return ResearchMatrixRunResponse(**serialize_run_detail(db, refreshed, current_user.id))


@router.post("/runs/{run_id}/retry-pending", response_model=ResearchMatrixRunResponse)
def retry_pending_matrix_run(
    run_id: int,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ResearchMatrixRunResponse:
    run = _load_run(db, run_id, current_user.id)
    _raise_if_run_source_deleted(db, run, current_user.id)
    run = retry_pending_run(db, run)
    _spawn_matrix_run_task(run.id, None)
    run = _load_run(db, run.id, current_user.id)
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
    background_tasks: BackgroundTasks,
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
        item.status = "running"
        item.stage = "extracting_context"
        item.progress = 3
        item.provider_id = payload.provider_id
        item.error_message = None
        db.add(item)
        db.flush()
        background_tasks.add_task(run_paper_summary_task, item.id, payload.provider_id)
        started += 1
    db.commit()
    return ResearchMatrixGenerateMissingResponse(
        started_count=started,
        skipped_count=skipped,
        running_count=running,
    )
