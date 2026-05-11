from __future__ import annotations

import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Annotation,
    Folder,
    Paper,
    PaperFullTranslation,
    PaperNotebook,
    PaperNoteBlock,
    PaperNoteNode,
    PaperSummary,
    ReadingRecord,
    ResearchMatrixRun,
    ResearchMatrixRunPaper,
)
from app.services.paper_summary import (
    REVIEW_STRUCTURED_FIELD_ORDER,
    apply_review_field_updates,
    get_review_summary_content,
    is_summary_stale,
    parse_compound_list,
    run_paper_summary_task,
)

MATRIX_FIELDS = [
    ("research_question", "研究问题"),
    ("core_metrics", "核心变量/指标"),
    ("method_route", "方法路线"),
    ("data_sample", "数据与样本"),
    ("main_findings", "核心发现"),
    ("innovations", "创新点"),
    ("limitations", "局限与风险"),
    ("review_role", "综述定位"),
    ("comparison_tags", "可对比标签"),
]

RUN_STAGE_LABELS = {
    "idle": "待生成",
    "queued": "已加入队列",
    "preparing_reviews": "准备综述卡片",
    "generating_reviews": "生成单篇综述",
    "building_matrix": "整理矩阵和草稿",
    "completed": "已完成",
    "failed": "生成失败",
}

LIST_FIELDS = {"core_metrics", "innovations", "limitations", "comparison_tags"}
RUN_ONLY_FIELDS = {"review_role", "batch_note"}
STRUCTURED_FIELD_SET = set(REVIEW_STRUCTURED_FIELD_ORDER)

SUMMARY_LABELS = {
    "overview": "整篇总结",
    "annotations": "标注总结",
    "review": "综述卡片",
    "reproduction": "复现总结",
    "meeting": "组会稿",
}

RESOURCE_LABELS = {
    "summary": "总结",
    "translation": "翻译",
    "annotations": "标注",
    "notes": "笔记",
}


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def ensure_unique_paper_ids(paper_ids: list[int]) -> list[int]:
    seen: set[int] = set()
    result: list[int] = []
    for paper_id in paper_ids:
        value = int(paper_id)
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result[:50]


def compact_text(value: Any, limit: int = 220) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def extract_year(paper: Paper) -> str:
    import re

    values = [paper.creation_date, paper.modification_date, paper.subject, paper.keywords]
    for value in values:
        match = re.search(r"\b(19|20)\d{2}\b", str(value or ""))
        if match:
            return match.group(0)
    return ""


def join_list(value: Any, *, limit: int = 8) -> str:
    return " / ".join(parse_compound_list(value, limit=limit))


def build_empty_row(
    paper: Paper,
    folder_name: str,
    *,
    review_role: str = "",
    batch_note: str = "",
    review_stale: bool = False,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "paper_id": paper.id,
        "title": paper.title or paper.file_name,
        "file_name": paper.file_name,
        "folder_name": folder_name,
        "author": paper.author or "",
        "year": extract_year(paper),
        "summary_updated_at": None,
        "is_stale": review_stale,
        "review_role": compact_text(review_role, 180),
        "batch_note": compact_text(batch_note, 260),
        "preview": "",
        "highlights": [],
    }
    for field_key, _label in MATRIX_FIELDS:
        if field_key not in row:
            row[field_key] = ""
    return row


def build_row_from_review_summary(
    paper: Paper,
    folder_name: str,
    review: PaperSummary | None,
    *,
    review_role: str = "",
    batch_note: str = "",
    review_stale: bool = False,
) -> dict[str, Any]:
    if not review or review.status != "generated":
        return build_empty_row(
            paper,
            folder_name,
            review_role=review_role,
            batch_note=batch_note,
            review_stale=review_stale,
        )
    review_content = get_review_summary_content(review.content_json if isinstance(review.content_json, dict) else {})
    structured = dict(review_content.get("structured_fields") or {})
    row = build_empty_row(
        paper,
        folder_name,
        review_role=review_role,
        batch_note=batch_note,
        review_stale=review_stale,
    )
    row["summary_updated_at"] = iso(review.updated_at)
    row["research_question"] = compact_text(structured.get("research_question"), 260)
    row["core_metrics"] = compact_text(join_list(structured.get("core_metrics")), 180)
    row["method_route"] = compact_text(structured.get("method_route"), 260)
    row["data_sample"] = compact_text(structured.get("data_sample"), 220)
    row["main_findings"] = compact_text(structured.get("main_findings"), 260)
    row["innovations"] = compact_text(join_list(structured.get("innovations")), 220)
    row["limitations"] = compact_text(join_list(structured.get("limitations")), 220)
    row["comparison_tags"] = compact_text(join_list(structured.get("comparison_tags")), 160)
    row["preview"] = compact_text(review_content.get("preview"), 180)
    row["highlights"] = [compact_text(item, 120) for item in (review_content.get("highlights") or [])[:4]]
    return row


def get_owned_papers(db: Session, user_id: int, paper_ids: list[int]) -> list[Paper]:
    ids = ensure_unique_paper_ids(paper_ids)
    if not ids:
        return []
    papers = db.scalars(
        select(Paper)
        .options(selectinload(Paper.folder))
        .where(
            Paper.user_id == user_id,
            Paper.deleted_at.is_(None),
            Paper.id.in_(ids),
        )
    ).all()
    by_id = {paper.id: paper for paper in papers}
    return [by_id[paper_id] for paper_id in ids if paper_id in by_id]


def get_summaries_by_paper(
    db: Session,
    user_id: int,
    paper_ids: list[int],
) -> dict[tuple[int, str], PaperSummary]:
    if not paper_ids:
        return {}
    rows = db.scalars(
        select(PaperSummary).where(
            PaperSummary.user_id == user_id,
            PaperSummary.paper_id.in_(paper_ids),
            PaperSummary.summary_type.in_(["review", "reproduction"]),
        )
    ).all()
    return {(row.paper_id, row.summary_type): row for row in rows}


def summary_ready(db: Session, paper: Paper, review: PaperSummary | None) -> bool:
    return bool(review and review.status == "generated" and not is_summary_stale(db, paper, review))


def build_matrix_payload(
    db: Session,
    user_id: int,
    paper_ids: list[int],
    *,
    include_reproduction: bool = True,
    run_overrides: dict[int, dict[str, str]] | None = None,
) -> dict[str, Any]:
    papers = get_owned_papers(db, user_id, paper_ids)
    summaries = get_summaries_by_paper(db, user_id, [paper.id for paper in papers])
    rows: list[dict[str, Any]] = []
    run_papers: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    stale: list[dict[str, Any]] = []

    run_overrides = run_overrides or {}
    for index, paper in enumerate(papers):
        folder_name = paper.folder.name if paper.folder else "未分类"
        review = summaries.get((paper.id, "review"))
        override = run_overrides.get(paper.id, {})
        is_missing = not summary_ready(db, paper, review)
        is_stale = bool(review and is_summary_stale(db, paper, review))
        if is_missing:
            missing.append({"paper_id": paper.id, "title": paper.title or paper.file_name})
        if is_stale:
            stale.append({"paper_id": paper.id, "title": paper.title or paper.file_name})
        row = build_row_from_review_summary(
            paper,
            folder_name,
            review,
            review_role=override.get("review_role", ""),
            batch_note=override.get("batch_note", ""),
            review_stale=is_stale,
        )
        rows.append(row)
        run_papers.append({
            "paper": paper,
            "sort_order": index,
            "folder_name": folder_name,
            "review": review,
            "is_missing": is_missing,
            "is_stale": is_stale,
            "row": row,
        })

    dashboard = build_dashboard_snapshot(db, user_id, rows, missing, stale)
    matrix = {
        "fields": [{"key": key, "label": label} for key, label in MATRIX_FIELDS],
        "rows": rows,
        "missing": missing,
        "stale": stale,
        "ready_count": max(0, len(rows) - len(missing)),
        "paper_count": len(rows),
    }
    return {
        "papers": papers,
        "run_papers": run_papers,
        "matrix": matrix,
        "drafts": build_rule_drafts(rows),
        "dashboard": dashboard,
    }


def build_rule_drafts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ready_rows = [
        row for row in rows
        if row.get("research_question") or row.get("method_route") or row.get("main_findings")
    ]
    source_titles = [row.get("title", "") for row in ready_rows[:8] if row.get("title")]
    if not ready_rows:
        empty = "当前批次还缺少稳定的单篇综述卡片，完成后这里会自动整理跨论文草稿。"
        return {
            "related_work": {"title": "研究现状", "content": empty, "source_titles": []},
            "method_compare": {"title": "方法对比", "content": empty, "source_titles": []},
            "limitations": {"title": "局限与机会", "content": empty, "source_titles": []},
        }

    topics = [row.get("research_question") for row in ready_rows if row.get("research_question")]
    methods = [row.get("method_route") for row in ready_rows if row.get("method_route")]
    findings = [row.get("main_findings") for row in ready_rows if row.get("main_findings")]
    limits = [row.get("limitations") for row in ready_rows if row.get("limitations")]
    roles = [row.get("review_role") for row in ready_rows if row.get("review_role")]

    return {
        "related_work": {
            "title": "研究现状",
            "content": compact_text(
                "这一批论文主要围绕 "
                + "；".join(topics[:4])
                + " 展开。已有研究比较稳定的共识包括 "
                + "；".join(findings[:3])
                + "。写综述时可优先按问题域、数据场景和关键指标组织段落。",
                900,
            ),
            "source_titles": source_titles,
        },
        "method_compare": {
            "title": "方法对比",
            "content": compact_text(
                "从方法路径看，这批论文重点可比较的方案包括 "
                + "；".join(methods[:6])
                + "。如果需要组织综述，可按方法类别、使用数据、核心指标和适用场景做横向并列。",
                900,
            ),
            "source_titles": source_titles,
        },
        "limitations": {
            "title": "局限与机会",
            "content": compact_text(
                "可以继续深挖的切入点主要来自这些局限与风险："
                + "；".join(limits[:6])
                + ("。当前批次里你已经把部分论文定位为 " + "、".join(roles[:4]) if roles else "")
                + "。建议优先回查数据口径、实验边界和方法假设的一致性。",
                900,
            ),
            "source_titles": source_titles,
        },
    }


def build_dashboard_snapshot(
    db: Session,
    user_id: int,
    matrix_rows: list[dict[str, Any]] | None = None,
    missing: list[dict[str, Any]] | None = None,
    stale: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    matrix_rows = matrix_rows or []
    missing = missing or []
    stale = stale or []
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=6)
    reading_rows = db.execute(
        select(func.date(ReadingRecord.opened_at), func.count(ReadingRecord.id))
        .join(Paper, Paper.id == ReadingRecord.paper_id)
        .where(
            ReadingRecord.user_id == user_id,
            ReadingRecord.opened_at >= seven_days_ago,
            Paper.deleted_at.is_(None),
        )
        .group_by(func.date(ReadingRecord.opened_at))
    ).all()
    reading_map = {str(day): int(count or 0) for day, count in reading_rows}
    reading_trend = []
    for offset in range(6, -1, -1):
        day = (now - timedelta(days=offset)).date().isoformat()
        reading_trend.append({"day": day[5:], "opens": reading_map.get(day, 0)})

    paper_ids = [row[0] for row in db.execute(
        select(Paper.id).where(Paper.user_id == user_id, Paper.deleted_at.is_(None))
    ).all()]
    total_papers = len(paper_ids)
    summary_counts = Counter()
    if paper_ids:
        for summary_type, count in db.execute(
            select(PaperSummary.summary_type, func.count(PaperSummary.id))
            .where(
                PaperSummary.user_id == user_id,
                PaperSummary.paper_id.in_(paper_ids),
                PaperSummary.status == "generated",
            )
            .group_by(PaperSummary.summary_type)
        ).all():
            summary_counts[str(summary_type)] = int(count or 0)

    summary_total = sum(summary_counts.values())
    translation_count = db.scalar(
        select(func.count(PaperFullTranslation.id))
        .join(Paper, Paper.id == PaperFullTranslation.paper_id)
        .where(
            Paper.user_id == user_id,
            Paper.deleted_at.is_(None),
            PaperFullTranslation.status == "completed",
        )
    ) or 0
    annotation_count = db.scalar(
        select(func.count(Annotation.id))
        .join(Paper, Paper.id == Annotation.paper_id)
        .where(Annotation.user_id == user_id, Paper.deleted_at.is_(None))
    ) or 0
    note_count = db.scalar(
        select(func.count(PaperNoteBlock.id))
        .join(PaperNoteNode, PaperNoteNode.id == PaperNoteBlock.node_id)
        .join(PaperNotebook, PaperNotebook.id == PaperNoteNode.notebook_id)
        .join(Paper, Paper.id == PaperNotebook.paper_id)
        .where(PaperNotebook.user_id == user_id, Paper.deleted_at.is_(None))
    ) or 0

    folder_activity = []
    for folder_name, count in db.execute(
        select(Folder.name, func.count(Paper.id))
        .join(Paper, Paper.folder_id == Folder.id)
        .where(Paper.user_id == user_id, Paper.deleted_at.is_(None))
        .group_by(Folder.name)
        .order_by(func.count(Paper.id).desc())
        .limit(6)
    ).all():
        folder_activity.append({"name": folder_name or "未分类", "papers": int(count or 0)})

    ready_count = max(0, len(matrix_rows) - len(missing))
    readiness = round((ready_count / len(matrix_rows)) * 100) if matrix_rows else 0
    return {
        "reading_trend": reading_trend,
        "resource_mix": [
            {"name": RESOURCE_LABELS["summary"], "value": summary_total},
            {"name": RESOURCE_LABELS["translation"], "value": int(translation_count or 0)},
            {"name": RESOURCE_LABELS["annotations"], "value": int(annotation_count or 0)},
            {"name": RESOURCE_LABELS["notes"], "value": int(note_count or 0)},
        ],
        "summary_coverage": [
            {
                "type": key,
                "label": label,
                "count": summary_counts.get(key, 0),
                "rate": round((summary_counts.get(key, 0) / total_papers) * 100) if total_papers else 0,
            }
            for key, label in SUMMARY_LABELS.items()
        ],
        "folder_activity": folder_activity,
        "matrix_readiness": {
            "ready_count": ready_count,
            "missing_count": len(missing),
            "stale_count": len(stale),
            "paper_count": len(matrix_rows),
            "rate": readiness,
        },
        "totals": {
            "paper_count": total_papers,
            "summary_count": summary_total,
            "translation_count": int(translation_count or 0),
            "annotation_count": int(annotation_count or 0),
            "note_count": int(note_count or 0),
        },
    }


def default_run_title(papers: list[Paper]) -> str:
    if not papers:
        return "未命名文献矩阵"
    first = papers[0].title or papers[0].file_name
    if len(papers) == 1:
        return first[:80]
    return f"{first[:42]} 等 {len(papers)} 篇"


def load_run_with_papers(db: Session, run_id: int) -> ResearchMatrixRun | None:
    return db.scalar(
        select(ResearchMatrixRun)
        .options(selectinload(ResearchMatrixRun.papers))
        .where(ResearchMatrixRun.id == run_id)
    )


def update_run_progress(run: ResearchMatrixRun) -> None:
    total = len(run.papers)
    ready = sum(1 for item in run.papers if item.summary_status == "generated" and not item.is_missing)
    failed = sum(1 for item in run.papers if item.summary_status == "failed")
    run.total_count = total
    run.paper_count = total
    run.ready_count = ready
    run.failed_count = failed
    run.progress_percent = round((ready / total) * 100) if total else 0


def create_initial_run(
    db: Session,
    user_id: int,
    papers: list[Paper],
    *,
    title: str = "",
    include_reproduction: bool = True,
    refreshed_from_id: int | None = None,
) -> ResearchMatrixRun:
    paper_ids = [paper.id for paper in papers]
    summaries = get_summaries_by_paper(db, user_id, paper_ids)
    all_ready = all(summary_ready(db, paper, summaries.get((paper.id, "review"))) for paper in papers)
    version = 1
    if refreshed_from_id:
        previous = db.get(ResearchMatrixRun, refreshed_from_id)
        if previous and previous.user_id == user_id:
            version = max(1, int(previous.version or 1) + 1)
    run = ResearchMatrixRun(
        user_id=user_id,
        title=title.strip() or default_run_title(papers),
        status="completed" if all_ready else "queued",
        stage="completed" if all_ready else "queued",
        paper_count=len(papers),
        total_count=len(papers),
        ready_count=0,
        failed_count=0,
        progress_percent=0,
        matrix_snapshot={},
        drafts_snapshot={},
        dashboard_snapshot={},
        config_json={"include_reproduction": include_reproduction},
        version=version,
        refreshed_from_id=refreshed_from_id,
    )
    db.add(run)
    db.flush()
    for index, paper in enumerate(papers):
        review = summaries.get((paper.id, "review"))
        folder_name = paper.folder.name if paper.folder else "未分类"
        ready = summary_ready(db, paper, review)
        stale = bool(review and is_summary_stale(db, paper, review))
        row = build_row_from_review_summary(
            paper,
            folder_name,
            review if ready else None,
            review_stale=stale,
        )
        db.add(
            ResearchMatrixRunPaper(
                run_id=run.id,
                paper_id=paper.id,
                sort_order=index,
                title_snapshot=paper.title or paper.file_name,
                file_name_snapshot=paper.file_name,
                folder_name_snapshot=folder_name,
                summary_updated_at=iso(review.updated_at) if review and ready else "",
                summary_source_hash=review.source_hash if review and ready else "",
                summary_status="generated" if ready else (review.status if review else "missing"),
                is_missing=not ready,
                is_stale=stale,
                review_role="",
                batch_note="",
                row_snapshot=row,
            )
        )
    db.flush()
    update_run_progress(run)
    if all_ready:
        rebuild_run_snapshots(db, run, user_id)
    else:
        db.commit()
        db.refresh(run)
    return run


def wait_for_summary_to_finish(summary_id: int, *, timeout_seconds: int = 900, interval_seconds: int = 2) -> str:
    from app.db.session import SessionLocal

    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        probe_db = SessionLocal()
        try:
            summary = probe_db.get(PaperSummary, summary_id)
            if not summary:
                return "missing"
            if summary.status != "running":
                return summary.status
        finally:
            probe_db.close()
        time.sleep(interval_seconds)
    return "running"


def run_matrix_run_task(run_id: int, provider_id: int | None = None) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        run = load_run_with_papers(db, run_id)
        if not run:
            return
        run.status = "running"
        run.stage = "preparing_reviews"
        run.error_message = None
        update_run_progress(run)
        db.commit()

        for run_paper in run.papers:
            if not run_paper.paper_id:
                continue
            paper = db.scalar(
                select(Paper).options(selectinload(Paper.folder)).where(
                    Paper.id == run_paper.paper_id,
                    Paper.user_id == run.user_id,
                    Paper.deleted_at.is_(None),
                )
            )
            if not paper:
                run_paper.summary_status = "failed"
                run_paper.is_missing = True
                run_paper.row_snapshot = run_paper.row_snapshot or {}
                continue

            review = db.scalar(
                select(PaperSummary).where(
                    PaperSummary.paper_id == paper.id,
                    PaperSummary.user_id == run.user_id,
                    PaperSummary.summary_type == "review",
                )
            )

            if review and review.status == "running":
                wait_for_summary_to_finish(review.id)
                db.expire_all()
                run = load_run_with_papers(db, run_id)
                if not run:
                    return
                run_paper = next(item for item in run.papers if item.paper_id == paper.id)
                review = db.scalar(
                    select(PaperSummary).where(
                        PaperSummary.paper_id == paper.id,
                        PaperSummary.user_id == run.user_id,
                        PaperSummary.summary_type == "review",
                    )
                )

            if not summary_ready(db, paper, review):
                if not review:
                    review = PaperSummary(
                        paper_id=paper.id,
                        user_id=run.user_id,
                        summary_type="review",
                        content_json={},
                    )
                review.status = "running"
                review.stage = "extracting_context"
                review.progress = 3
                review.provider_id = provider_id
                review.error_message = None
                db.add(review)
                db.commit()
                db.refresh(review)

                run.status = "running"
                run.stage = "generating_reviews"
                run_paper.summary_status = "running"
                run_paper.is_missing = True
                run_paper.row_snapshot = build_empty_row(
                    paper,
                    paper.folder.name if paper.folder else "未分类",
                    review_role=run_paper.review_role or "",
                    batch_note=run_paper.batch_note or "",
                )
                update_run_progress(run)
                db.commit()

                run_paper_summary_task(review.id, provider_id)
                db.expire_all()
                run = load_run_with_papers(db, run_id)
                if not run:
                    return
                run_paper = next(item for item in run.papers if item.paper_id == paper.id)
                review = db.scalar(
                    select(PaperSummary).where(
                        PaperSummary.paper_id == paper.id,
                        PaperSummary.user_id == run.user_id,
                        PaperSummary.summary_type == "review",
                    )
                )

            ready = summary_ready(db, paper, review)
            row = build_row_from_review_summary(
                paper,
                paper.folder.name if paper.folder else "未分类",
                review if ready else None,
                review_role=run_paper.review_role or "",
                batch_note=run_paper.batch_note or "",
                review_stale=bool(review and is_summary_stale(db, paper, review)),
            )
            run_paper.summary_updated_at = iso(review.updated_at) if review and ready else ""
            run_paper.summary_source_hash = review.source_hash if review and ready else ""
            run_paper.summary_status = review.status if review else "missing"
            run_paper.is_missing = not ready
            run_paper.is_stale = bool(review and is_summary_stale(db, paper, review))
            run_paper.row_snapshot = row
            update_run_progress(run)
            db.commit()

        db.refresh(run)
        run = load_run_with_papers(db, run_id)
        if not run:
            return
        if all(item.summary_status == "generated" and not item.is_missing for item in run.papers):
            run.stage = "building_matrix"
            db.commit()
            rebuild_run_snapshots(db, run, run.user_id)
            return

        failed_titles = [item.title_snapshot for item in run.papers if item.summary_status != "generated" or item.is_missing]
        run.status = "failed"
        run.stage = "failed"
        run.error_message = (
            f"仍有 {len(failed_titles)} 篇论文未形成可复用的综述卡片："
            + "；".join(failed_titles[:4])
        )
        update_run_progress(run)
        db.commit()
    finally:
        db.close()


def rebuild_run_snapshots(db: Session, run: ResearchMatrixRun, user_id: int) -> None:
    overrides = {
        item.paper_id: {
            "review_role": item.review_role or "",
            "batch_note": item.batch_note or "",
        }
        for item in run.papers
        if item.paper_id
    }
    payload = build_matrix_payload(
        db,
        user_id,
        [item.paper_id for item in run.papers if item.paper_id],
        include_reproduction=bool((run.config_json or {}).get("include_reproduction", True)),
        run_overrides=overrides,
    )
    rows_by_paper_id = {item["paper"].id: item for item in payload["run_papers"]}
    for run_paper in run.papers:
        if not run_paper.paper_id:
            continue
        current = rows_by_paper_id.get(run_paper.paper_id)
        if not current:
            continue
        review = current["review"]
        row = dict(current["row"])
        row["review_role"] = compact_text(run_paper.review_role or "", 180)
        row["batch_note"] = compact_text(run_paper.batch_note or "", 260)
        run_paper.title_snapshot = current["paper"].title or current["paper"].file_name
        run_paper.file_name_snapshot = current["paper"].file_name
        run_paper.folder_name_snapshot = current["folder_name"]
        run_paper.summary_updated_at = iso(review.updated_at) if review and current["review"] and not current["is_missing"] else ""
        run_paper.summary_source_hash = review.source_hash if review and current["review"] and not current["is_missing"] else ""
        run_paper.summary_status = review.status if review else "missing"
        run_paper.is_missing = current["is_missing"]
        run_paper.is_stale = current["is_stale"]
        run_paper.row_snapshot = row

    matrix = dict(payload["matrix"])
    matrix["rows"] = [
        {
            **dict(run_paper.row_snapshot or {}),
            "review_role": compact_text(run_paper.review_role or "", 180),
            "batch_note": compact_text(run_paper.batch_note or "", 260),
        }
        for run_paper in sorted(run.papers, key=lambda item: item.sort_order)
    ]
    matrix["missing"] = [
        {"paper_id": item.paper_id, "title": item.title_snapshot}
        for item in run.papers if item.is_missing
    ]
    matrix["stale"] = [
        {"paper_id": item.paper_id, "title": item.title_snapshot}
        for item in run.papers if item.is_stale
    ]
    matrix["ready_count"] = sum(1 for item in run.papers if item.summary_status == "generated" and not item.is_missing)
    matrix["paper_count"] = len(run.papers)

    run.matrix_snapshot = matrix
    run.drafts_snapshot = build_rule_drafts(matrix["rows"])
    run.dashboard_snapshot = build_dashboard_snapshot(db, user_id, matrix["rows"], matrix["missing"], matrix["stale"])
    run.status = "completed"
    run.stage = "completed"
    run.error_message = None
    update_run_progress(run)
    run.progress_percent = 100 if run.total_count else 0
    db.add(run)
    db.commit()
    db.refresh(run)


def create_matrix_run(
    db: Session,
    user_id: int,
    paper_ids: list[int],
    *,
    title: str = "",
    include_reproduction: bool = True,
    refreshed_from_id: int | None = None,
) -> ResearchMatrixRun:
    papers = get_owned_papers(db, user_id, paper_ids)
    if not papers:
        raise ValueError("no papers")
    return create_initial_run(
        db,
        user_id,
        papers,
        title=title,
        include_reproduction=include_reproduction,
        refreshed_from_id=refreshed_from_id,
    )


def retry_pending_run(db: Session, run: ResearchMatrixRun) -> ResearchMatrixRun:
    run.status = "queued"
    run.stage = "queued"
    run.error_message = None
    update_run_progress(run)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def update_matrix_run_paper(
    db: Session,
    run: ResearchMatrixRun,
    *,
    paper_id: int,
    user_id: int,
    paper_field_updates: dict[str, Any] | None = None,
    run_field_updates: dict[str, Any] | None = None,
) -> ResearchMatrixRun:
    if run.status != "completed":
        raise ValueError("run_not_completed")
    target = next((item for item in run.papers if item.paper_id == paper_id), None)
    if not target:
        raise ValueError("paper_not_found")

    changed_summary = None
    if paper_field_updates:
        allowed_updates = {key: value for key, value in paper_field_updates.items() if key in STRUCTURED_FIELD_SET}
        if not allowed_updates:
            raise ValueError("invalid_paper_fields")
        summary = db.scalar(
            select(PaperSummary).where(
                PaperSummary.paper_id == paper_id,
                PaperSummary.user_id == user_id,
                PaperSummary.summary_type == "review",
            )
        )
        if not summary or summary.status != "generated":
            raise ValueError("summary_not_ready")
        summary.content_json = apply_review_field_updates(summary.content_json if isinstance(summary.content_json, dict) else {}, allowed_updates)
        summary.status = "generated"
        summary.stage = "completed"
        summary.progress = 100
        summary.error_message = None
        db.add(summary)
        db.commit()
        db.refresh(summary)
        changed_summary = summary

    if run_field_updates:
        if "review_role" in run_field_updates:
            target.review_role = compact_text(run_field_updates.get("review_role"), 180)
        if "batch_note" in run_field_updates:
            target.batch_note = compact_text(run_field_updates.get("batch_note"), 600)
        db.add(target)
        db.commit()

    if changed_summary:
        target.summary_updated_at = iso(changed_summary.updated_at) or ""
        target.summary_source_hash = changed_summary.source_hash or ""
        target.summary_status = changed_summary.status
        target.is_missing = False
        target.is_stale = False

    run = load_run_with_papers(db, run.id)
    if not run:
        raise ValueError("run_missing")
    rebuild_run_snapshots(db, run, user_id)
    refreshed = load_run_with_papers(db, run.id)
    if not refreshed:
        raise ValueError("run_missing")
    return refreshed


def run_has_updates(db: Session, run: ResearchMatrixRun, user_id: int) -> bool:
    if run.status in {"queued", "running"}:
        return False
    paper_ids = [item.paper_id for item in run.papers if item.paper_id]
    if not paper_ids:
        return False
    papers = {paper.id: paper for paper in get_owned_papers(db, user_id, paper_ids)}
    summaries = get_summaries_by_paper(db, user_id, paper_ids)
    for item in run.papers:
        if not item.paper_id:
            continue
        paper = papers.get(item.paper_id)
        if not paper:
            return True
        current = summaries.get((item.paper_id, "review"))
        if not current:
            if not item.is_missing:
                return True
            continue
        if current.status != item.summary_status:
            return True
        if (iso(current.updated_at) or "") != (item.summary_updated_at or ""):
            return True
        if is_summary_stale(db, paper, current) != bool(item.is_stale):
            return True
    return False


def serialize_run_list_item(db: Session, run: ResearchMatrixRun, user_id: int) -> dict[str, Any]:
    missing_count = sum(1 for item in run.papers if item.is_missing)
    stale_count = sum(1 for item in run.papers if item.is_stale)
    return {
        "id": run.id,
        "title": run.title,
        "status": run.status,
        "stage": run.stage or "idle",
        "stage_label": RUN_STAGE_LABELS.get(run.stage or "idle", run.stage or "idle"),
        "paper_count": run.paper_count,
        "version": run.version,
        "refreshed_from_id": run.refreshed_from_id,
        "has_updates": run_has_updates(db, run, user_id),
        "missing_count": missing_count,
        "stale_count": stale_count,
        "progress_percent": int(run.progress_percent or 0),
        "ready_count": int(run.ready_count or 0),
        "total_count": int(run.total_count or run.paper_count or 0),
        "failed_count": int(run.failed_count or 0),
        "error_message": run.error_message,
        "created_at": iso(run.created_at),
        "updated_at": iso(run.updated_at),
    }


def serialize_run_detail(db: Session, run: ResearchMatrixRun, user_id: int) -> dict[str, Any]:
    base = serialize_run_list_item(db, run, user_id)
    return {
        **base,
        "matrix": run.matrix_snapshot or {},
        "drafts": run.drafts_snapshot or {},
        "dashboard": run.dashboard_snapshot or {},
        "papers": [
            {
                "paper_id": item.paper_id,
                "title": item.title_snapshot,
                "file_name": item.file_name_snapshot,
                "folder_name": item.folder_name_snapshot,
                "summary_status": item.summary_status,
                "summary_updated_at": item.summary_updated_at,
                "is_missing": item.is_missing,
                "is_stale": item.is_stale,
                "review_role": item.review_role or "",
                "batch_note": item.batch_note or "",
                "row": item.row_snapshot or {},
            }
            for item in run.papers
        ],
        "refresh_available": base["has_updates"],
    }
