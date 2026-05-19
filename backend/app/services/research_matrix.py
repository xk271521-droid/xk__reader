from __future__ import annotations

import json
import os
import re
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
from app.services.crypto import decrypt_api_key
from app.services.notification import compact_notification_text, create_notification
from app.services.paper_summary import (
    REVIEW_STRUCTURED_FIELD_ORDER,
    apply_review_field_updates,
    build_summary_response_payload,
    call_text_completion,
    get_review_summary_content,
    is_summary_stale,
    load_available_provider,
    normalize_summary_terminal_state,
    parse_json_object,
    parse_compound_list,
    run_paper_summary_task,
    summary_title,
)

MATRIX_FIELDS = [
    ("research_question", "研究问题"),
    ("method_route", "方法路线"),
    ("main_findings", "核心发现"),
    ("innovations", "创新点"),
    ("limitations", "局限与风险"),
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

LIST_FIELDS = {"innovations", "limitations"}
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

WORKER_HEARTBEAT_TIMEOUT_SECONDS = 90
WORKER_HEARTBEAT_INTERVAL_SECONDS = 5
WORKER_MAX_RETRIES = 2


INSIGHT_STATUS_LABELS = {
    "idle": "等待生成",
    "running": "正在整理",
    "completed": "已完成",
    "stale": "需要刷新",
    "failed": "整理失败",
}

INSIGHT_FIELD_KEYS = [
    "research_question",
    "method_route",
    "main_findings",
    "innovations",
    "limitations",
]


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


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


def mark_run_worker_started(db: Session, run: ResearchMatrixRun) -> None:
    run.worker_status = "running"
    run.worker_started_at = utcnow()
    run.worker_heartbeat_at = run.worker_started_at
    run.worker_pid = os.getpid()
    run.last_worker_error = None
    db.add(run)
    db.commit()
    db.refresh(run)


def heartbeat_run_worker(db: Session, run: ResearchMatrixRun) -> None:
    run.worker_status = "running"
    run.worker_heartbeat_at = utcnow()
    if not run.worker_started_at:
        run.worker_started_at = run.worker_heartbeat_at
    if not run.worker_pid:
        run.worker_pid = os.getpid()
    db.add(run)
    db.commit()
    db.refresh(run)


def mark_run_worker_finished(db: Session, run: ResearchMatrixRun) -> None:
    run.worker_status = "completed"
    run.worker_heartbeat_at = utcnow()
    run.worker_pid = None
    run.last_worker_error = None
    db.add(run)
    db.commit()
    db.refresh(run)


def mark_run_worker_failed(db: Session, run: ResearchMatrixRun, message: str) -> None:
    run.worker_status = "failed"
    run.worker_heartbeat_at = utcnow()
    run.worker_pid = None
    run.last_worker_error = compact_text(message, 600)
    run.worker_retry_count = int(run.worker_retry_count or 0) + 1
    db.add(run)
    db.commit()
    db.refresh(run)


def is_run_worker_stale(run: ResearchMatrixRun) -> bool:
    heartbeat = normalize_utc_datetime(run.worker_heartbeat_at)
    if not heartbeat:
        return False
    now = normalize_utc_datetime(utcnow())
    if not now:
        return False
    return (now - heartbeat).total_seconds() > WORKER_HEARTBEAT_TIMEOUT_SECONDS


def normalize_run_runtime_state(db: Session, run: ResearchMatrixRun) -> ResearchMatrixRun:
    if run.status not in {"queued", "running"}:
        return run
    if not is_run_worker_stale(run):
        return run
    if int(run.worker_retry_count or 0) >= WORKER_MAX_RETRIES:
        run.status = "failed"
        run.stage = "failed"
        run.error_message = compact_text(
            run.last_worker_error or "批次生成中断且已达到最大自动重试次数，请手动继续补齐。",
            600,
        )
        mark_run_worker_failed(db, run, run.error_message or "批次生成失败")
        refreshed = load_run_with_papers(db, run.id)
        return refreshed or run
    run.status = "queued"
    run.stage = "queued"
    run.error_message = None
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


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
    field_blocks = {
        str(block.get("key") or ""): block
        for block in (review_content.get("review_field_blocks") or [])
        if isinstance(block, dict)
    }

    def block_summary(field_key: str, fallback: Any, *, limit: int = 260) -> str:
        block = field_blocks.get(field_key) or {}
        summary_text = str(block.get("summary") or "").strip()
        if summary_text:
            return compact_text(summary_text, limit)
        return compact_text(fallback, limit)

    row = build_empty_row(
        paper,
        folder_name,
        review_role=review_role,
        batch_note=batch_note,
        review_stale=review_stale,
    )
    row["summary_updated_at"] = iso(review.updated_at)
    row["research_question"] = block_summary("research_question", structured.get("research_question"))
    row["method_route"] = block_summary("method_route", structured.get("method_route"))
    row["main_findings"] = block_summary("main_findings", structured.get("main_findings"))
    row["innovations"] = block_summary("innovations", join_list(structured.get("innovations")), limit=220)
    row["limitations"] = block_summary("limitations", join_list(structured.get("limitations")), limit=220)
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
            PaperSummary.summary_type.in_(["overview", "review", "reproduction"]),
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
        "dashboard": {},
    }


def build_rule_drafts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ready_rows = [
        row for row in rows
        if row.get("research_question") or row.get("method_route") or row.get("main_findings")
    ]
    if not ready_rows:
        return build_empty_drafts_payload("当前批次还缺少可复用的综述证据，后续补齐后这里会自动整理成长文稿草稿。")

    source_titles = [row.get("title", "") for row in ready_rows[:8] if row.get("title")]
    background = "；".join([row.get("research_question") for row in ready_rows[:4] if row.get("research_question")])
    findings = "；".join([row.get("main_findings") for row in ready_rows[:4] if row.get("main_findings")])
    methods = "；".join([row.get("method_route") for row in ready_rows[:4] if row.get("method_route")])
    limits = "；".join([row.get("limitations") for row in ready_rows[:4] if row.get("limitations")])
    innovations = "；".join([row.get("innovations") for row in ready_rows[:4] if row.get("innovations")])

    drafts = build_empty_drafts_payload("当前批次的证据仍偏薄，建议把它当作可继续润色的底稿。")
    section_content = {
        "research_background": background or findings,
        "research_status": findings or background,
        "core_innovations": innovations,
        "method_compare": methods,
        "result_analysis": findings,
        "limitations_future": limits,
    }
    for key, content in section_content.items():
        normalized = compact_text(content or "当前还缺少足够内容，建议先补齐对应单篇卡片。", 1200)
        drafts[key]["content"] = normalized
        drafts[key]["paragraphs"] = [
            paragraph_item(
                normalized,
                [citation_item(paper_title=title, source_card_type="review") for title in source_titles[:3]],
                "weak",
            )
        ]
        drafts[key]["source_titles"] = source_titles
        drafts[key]["copy_ready"] = True

    drafts["quotable_sentences"]["content"] = "当前规则回退稿不直接拼接引用句，请优先查看新证据链结构。"
    drafts["quotable_sentences"]["source_titles"] = source_titles
    drafts["final_integrated_review"]["content"] = "\n\n".join([
        section_content[key]
        for key in [
            "research_background",
            "research_status",
            "core_innovations",
            "method_compare",
            "result_analysis",
            "limitations_future",
        ]
        if section_content[key]
    ])
    drafts["final_integrated_review"]["paragraphs"] = [
        paragraph_item(
            compact_text(drafts["final_integrated_review"]["content"] or "当前还没有足够内容形成整合综述。", 1600),
            [citation_item(paper_title=title, source_card_type="review") for title in source_titles[:4]],
            "weak",
        )
    ]
    drafts["final_integrated_review"]["source_titles"] = source_titles
    drafts["final_integrated_review"]["copy_ready"] = True
    drafts["final_integrated_review"]["ai_generated"] = False
    drafts["final_integrated_review"]["fallback_used"] = True
    return drafts


DRAFT_REQUIRED_SUMMARY_TYPES = ("overview", "review", "reproduction")
GROUPING_MODES = ("topic_first", "method_first")
DRAFT_STAGE_LABELS = {
    "idle": "待准备",
    "preparing_sources": "准备来源卡片",
    "generating_sources": "整理来源卡片",
    "building_drafts": "生成分块草稿",
    "integrating_review": "整合综述终稿",
    "completed": "已完成",
    "failed": "部分来源失败",
}
DRAFT_SECTION_ORDER = [
    "research_background",
    "research_status",
    "core_innovations",
    "method_compare",
    "result_analysis",
    "limitations_future",
    "quotable_sentences",
    "final_integrated_review",
]
DRAFT_SECTION_TITLES = {
    "research_background": "研究背景",
    "research_status": "研究现状",
    "core_innovations": "核心创新点",
    "method_compare": "方法对比",
    "result_analysis": "实验结果分析",
    "limitations_future": "局限与未来方向",
    "review_outline": "综述大纲",
    "topic_diagnostic": "主题一致性诊断",
    "quotable_sentences": "可直接引用句",
    "final_integrated_review": "综述终稿整合",
}


REVIEW_SECTION_HINTS = {
    "background_motivation": ("研究背景", "背景", "动机"),
    "research_question": ("研究问题", "对象"),
    "method_route": ("方法路线", "方法"),
    "data_experiment": ("数据", "样本", "实验设置", "数据与实验设置"),
    "baselines_metrics": ("基线", "对比", "评价指标", "对比基线与评价指标"),
    "main_findings": ("核心发现", "结论"),
    "innovations": ("创新点",),
    "limitations": ("局限", "风险"),
}
OVERVIEW_BACKGROUND_HINTS = ("研究问题", "背景", "动机")
OVERVIEW_STATUS_HINTS = ("核心方法", "主要结论", "创新点", "后续追问", "实验设计")
REPRO_RESULT_HINTS = ("模型结构", "数据集", "预处理", "训练", "推理", "评价指标", "关键公式")
REPRO_LIMIT_HINTS = ("缺失信息", "环境依赖", "训练", "推理")


def empty_draft_section(key: str, content: str = "当前还没有足够证据生成这一节。") -> dict[str, Any]:
    return {
        "key": key,
        "title": DRAFT_SECTION_TITLES.get(key, key),
        "paragraphs": [],
        "items": [],
        "content": content,
        "source_titles": [],
        "copy_ready": False,
        "ai_generated": False,
        "fallback_used": False,
    }


def mark_draft_section_pending(
    section: dict[str, Any],
    message: str,
    *,
    source_titles: list[str] | None = None,
) -> dict[str, Any]:
    section["paragraphs"] = []
    section["items"] = []
    section["content"] = compact_text(message, 1200)
    section["source_titles"] = list(source_titles or [])
    section["copy_ready"] = False
    section["ai_generated"] = False
    section["fallback_used"] = True
    return section


def build_empty_drafts_payload(message: str) -> dict[str, Any]:
    return {key: empty_draft_section(key, message) for key in DRAFT_SECTION_ORDER}


def draft_status_payload(
    *,
    status: str = "idle",
    stage: str = "idle",
    progress: int = 0,
    ready_count: int = 0,
    total_count: int = 0,
    failed_count: int = 0,
    error_message: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "stage": stage,
        "stage_label": DRAFT_STAGE_LABELS.get(stage, stage),
        "progress_percent": int(max(0, min(100, progress))),
        "ready_count": int(max(0, ready_count)),
        "total_count": int(max(0, total_count)),
        "failed_count": int(max(0, failed_count)),
        "error_message": error_message,
    }


def ensure_draft_state(config_json: dict[str, Any] | None) -> dict[str, Any]:
    config = dict(config_json or {})
    state = dict(config.get("draft_state") or {})
    normalized = draft_status_payload(
        status=str(state.get("status") or "idle"),
        stage=str(state.get("stage") or "idle"),
        progress=int(state.get("progress_percent") or 0),
        ready_count=int(state.get("ready_count") or 0),
        total_count=int(state.get("total_count") or 0),
        failed_count=int(state.get("failed_count") or 0),
        error_message=state.get("error_message"),
    )
    config["draft_state"] = normalized
    return config


def set_run_draft_state(run: ResearchMatrixRun, **kwargs: Any) -> None:
    config = ensure_draft_state(run.config_json if isinstance(run.config_json, dict) else {})
    current = dict(config.get("draft_state") or {})
    current.update(
        draft_status_payload(
            status=str(kwargs.get("status", current.get("status", "idle"))),
            stage=str(kwargs.get("stage", current.get("stage", "idle"))),
            progress=int(kwargs.get("progress", current.get("progress_percent", 0))),
            ready_count=int(kwargs.get("ready_count", current.get("ready_count", 0))),
            total_count=int(kwargs.get("total_count", current.get("total_count", 0))),
            failed_count=int(kwargs.get("failed_count", current.get("failed_count", 0))),
            error_message=kwargs.get("error_message", current.get("error_message")),
        )
    )
    config["draft_state"] = current
    run.config_json = config


def apply_draft_payload_to_run(
    run: ResearchMatrixRun,
    drafts_payload: dict[str, Any],
    draft_state: dict[str, Any],
) -> None:
    run.drafts_snapshot = drafts_payload
    set_run_draft_state(
        run,
        status=draft_state["status"],
        stage=draft_state["stage"],
        progress=draft_state["progress_percent"],
        ready_count=draft_state["ready_count"],
        total_count=draft_state["total_count"],
        failed_count=draft_state["failed_count"],
        error_message=draft_state["error_message"],
    )


def ensure_insight_state(config: dict[str, Any] | None) -> dict[str, Any]:
    current = dict(config or {})
    state = dict(current.get("insights_state") or {})
    status = str(state.get("status") or "idle")
    current["insights_state"] = {
        "status": status,
        "stage_label": INSIGHT_STATUS_LABELS.get(status, status),
        "updated_at": state.get("updated_at"),
        "error_message": state.get("error_message"),
        "stale": bool(state.get("stale")) if status != "completed" else False,
    }
    return current


def set_run_insight_state(
    run: ResearchMatrixRun,
    *,
    status: str,
    stale: bool = False,
    error_message: str | None = None,
    updated_at: str | None = None,
) -> None:
    config = ensure_insight_state(run.config_json if isinstance(run.config_json, dict) else {})
    config["insights_state"] = {
        "status": status,
        "stage_label": INSIGHT_STATUS_LABELS.get(status, status),
        "updated_at": updated_at,
        "error_message": compact_text(error_message, 600) if error_message else None,
        "stale": bool(stale),
    }
    run.config_json = config


def serialize_insight_state(run: ResearchMatrixRun) -> dict[str, Any]:
    config = ensure_insight_state(run.config_json if isinstance(run.config_json, dict) else {})
    state = dict(config.get("insights_state") or {})
    payload = dict((run.dashboard_snapshot or {}).get("insights") or {})
    text_fragments = [
        *list(payload.get("consensus") or []),
        *list(payload.get("differences") or []),
        *list(payload.get("gaps") or []),
    ]
    if any("?" in str(item or "") for item in text_fragments):
        clean_payload = build_fallback_insights(insight_source_rows(run))
        dashboard = dict(run.dashboard_snapshot or {})
        dashboard["insights"] = clean_payload
        run.dashboard_snapshot = dashboard
        payload = clean_payload
        set_run_insight_state(run, status="completed", stale=False, error_message=None, updated_at=iso(utcnow()))
    return {
        "insights": {
            "status": state.get("status", "idle"),
            "stage_label": state.get("stage_label", INSIGHT_STATUS_LABELS["idle"]),
            "updated_at": state.get("updated_at"),
            "stale": bool(state.get("stale")),
            "consensus": list(payload.get("consensus") or []),
            "differences": list(payload.get("differences") or []),
            "gaps": list(payload.get("gaps") or []),
            "error_message": state.get("error_message"),
        }
    }


def insight_source_rows(run: ResearchMatrixRun) -> list[dict[str, Any]]:
    rows = []
    for item in sorted(run.papers, key=lambda value: value.sort_order):
        row = dict(item.row_snapshot or {})
        if not row:
            continue
        if not any(row.get(key) for key in INSIGHT_FIELD_KEYS):
            continue
        rows.append(row)
    return rows


def join_non_empty(parts: list[str]) -> str:
    return "；".join([part for part in parts if str(part or "").strip()])


def build_fallback_insights(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "consensus": ["当前批次还没有足够内容形成稳定共识，建议先补齐论文矩阵中的关键字段。"],
            "differences": ["当前批次还没有抽出明确差异，建议优先核对研究问题、方法路线和核心发现。"],
            "gaps": ["当前批次还没有整理出明确研究空白，可在补齐局限与风险后再归纳。"],
        }

    question_values = [compact_text(row.get("research_question"), 220) for row in rows if row.get("research_question")]
    method_values = [compact_text(row.get("method_route"), 220) for row in rows if row.get("method_route")]
    finding_values = [compact_text(row.get("main_findings"), 220) for row in rows if row.get("main_findings")]
    innovation_values = [compact_text(row.get("innovations"), 220) for row in rows if row.get("innovations")]
    limitation_values = [compact_text(row.get("limitations"), 220) for row in rows if row.get("limitations")]

    consensus = []
    if question_values:
        consensus.append(f"这批论文的研究问题主要集中在：{join_non_empty(question_values[:3])}。")
    if method_values:
        consensus.append(f"方法路线层面，当前样本主要围绕：{join_non_empty(method_values[:3])}。")
    if finding_values:
        consensus.append(f"核心发现层面，已经能归纳出：{join_non_empty(finding_values[:3])}。")

    differences = []
    if len(method_values) > 1:
        differences.append(f"方法选择上仍存在明显分化，主要表现为：{join_non_empty(method_values[:4])}。")
    if len(innovation_values) > 1:
        differences.append(f"创新点分布并不一致，当前主要差异集中在：{join_non_empty(innovation_values[:4])}。")
    if len(finding_values) > 1:
        differences.append(f"不同论文在结果表述和结论强调上也有差别，集中体现在：{join_non_empty(finding_values[:4])}。")

    gaps = []
    if limitation_values:
        gaps.append(f"现有研究暴露出的共性局限主要包括：{join_non_empty(limitation_values[:4])}。")
    gaps.append("后续写作中可以继续追问样本规模、实验边界、适用场景和泛化能力是否充分说明。")

    return {
        "consensus": consensus[:3] or ["当前批次的显性共识还不够强，建议先回到矩阵核对研究问题和核心发现。"],
        "differences": differences[:3] or ["当前差异点还不够集中，建议补充更多方法与结果描述后再比较。"],
        "gaps": gaps[:3],
    }


def build_run_insights_payload(db: Session, run: ResearchMatrixRun) -> dict[str, Any]:
    rows = insight_source_rows(run)
    fallback = build_fallback_insights(rows)
    return fallback


def sync_run_insights_snapshot(db: Session, run: ResearchMatrixRun) -> None:
    set_run_insight_state(run, status="running", stale=False, error_message=None)
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        insights = build_run_insights_payload(db, run)
        dashboard = dict(run.dashboard_snapshot or {})
        dashboard["insights"] = insights
        run.dashboard_snapshot = dashboard
        set_run_insight_state(run, status="completed", stale=False, error_message=None, updated_at=iso(utcnow()))
        db.add(run)
        db.commit()
        db.refresh(run)
    except Exception as exc:
        set_run_insight_state(run, status="failed", stale=False, error_message=f"比较导读整理失败：{exc}")
        db.add(run)
        db.commit()
        db.refresh(run)


def mark_run_insights_stale(db: Session, run: ResearchMatrixRun) -> None:
    current = dict((run.dashboard_snapshot or {}).get("insights") or {})
    dashboard = dict(run.dashboard_snapshot or {})
    dashboard["insights"] = current
    run.dashboard_snapshot = dashboard
    set_run_insight_state(
        run,
        status="stale" if current else "idle",
        stale=bool(current),
        error_message=None,
        updated_at=iso(utcnow()) if current else None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)


def refresh_run_insights(db: Session, run: ResearchMatrixRun) -> ResearchMatrixRun:
    if run.status != "completed":
        raise ValueError("run_not_completed")
    sync_run_insights_snapshot(db, run)
    refreshed = load_run_with_papers(db, run.id)
    if not refreshed:
        raise ValueError("run_missing")
    return refreshed


def serialize_draft_state(run: ResearchMatrixRun) -> dict[str, Any]:
    config = ensure_draft_state(run.config_json if isinstance(run.config_json, dict) else {})
    state = dict(config.get("draft_state") or {})
    return {
        "draft_status": state.get("status", "idle"),
        "draft_stage": state.get("stage", "idle"),
        "draft_stage_label": state.get("stage_label", DRAFT_STAGE_LABELS["idle"]),
        "draft_progress_percent": int(state.get("progress_percent", 0) or 0),
        "draft_ready_count": int(state.get("ready_count", 0) or 0),
        "draft_total_count": int(state.get("total_count", 0) or 0),
        "draft_failed_count": int(state.get("failed_count", 0) or 0),
        "draft_error_message": state.get("error_message"),
    }


def build_draft_source_map(db: Session, run: ResearchMatrixRun) -> tuple[dict[int, dict[str, Any]], dict[str, int]]:
    paper_ids = [item.paper_id for item in run.papers if item.paper_id]
    summaries = db.scalars(
        select(PaperSummary).where(
            PaperSummary.user_id == run.user_id,
            PaperSummary.paper_id.in_(paper_ids),
            PaperSummary.summary_type.in_(list(DRAFT_REQUIRED_SUMMARY_TYPES)),
        )
    ).all() if paper_ids else []
    summary_map = {(item.paper_id, item.summary_type): item for item in summaries}
    source_map: dict[int, dict[str, Any]] = {}
    ready_count = 0
    failed_count = 0
    running_count = 0
    total_count = len(paper_ids) * len(DRAFT_REQUIRED_SUMMARY_TYPES)
    for item in run.papers:
        if not item.paper_id:
            continue
        per_paper: dict[str, Any] = {}
        for summary_type in DRAFT_REQUIRED_SUMMARY_TYPES:
            summary = summary_map.get((item.paper_id, summary_type))
            payload = build_summary_response_payload(summary, summary_type)
            per_paper[summary_type] = payload
            if payload.get("status") == "generated":
                ready_count += 1
            elif payload.get("status") == "failed":
                failed_count += 1
            elif payload.get("status") == "running":
                running_count += 1
        source_map[item.paper_id] = per_paper
    return source_map, {
        "ready_count": ready_count,
        "failed_count": failed_count,
        "running_count": running_count,
        "total_count": total_count,
    }


def draft_progress_from_counters(counters: dict[str, int]) -> dict[str, int]:
    total_count = int(counters.get("total_count", 0) or 0)
    ready_count = int(counters.get("ready_count", 0) or 0)
    failed_count = int(counters.get("failed_count", 0) or 0)
    running_count = int(counters.get("running_count", 0) or 0)
    progress = round((ready_count / total_count) * 100) if total_count else 0
    return {
        "ready_count": ready_count,
        "failed_count": failed_count,
        "running_count": running_count,
        "total_count": total_count,
        "progress": progress,
    }


def sync_run_draft_progress(db: Session, run: ResearchMatrixRun) -> None:
    source_map, counters = build_draft_source_map(db, run)
    missing = collect_missing_draft_sources(source_map)
    progress_meta = draft_progress_from_counters(counters)
    status = "failed" if progress_meta["failed_count"] else ("completed" if not missing else "running")
    stage = "completed" if not missing else "generating_sources"
    error_message = build_draft_pending_message(run, source_map) if progress_meta["failed_count"] else None
    set_run_draft_state(
        run,
        status=status,
        stage=stage,
        progress=progress_meta["progress"],
        ready_count=progress_meta["ready_count"],
        total_count=progress_meta["total_count"],
        failed_count=progress_meta["failed_count"],
        error_message=error_message,
    )
    db.add(run)
    db.commit()
    db.refresh(run)


def collect_missing_draft_sources(source_map: dict[int, dict[str, Any]]) -> list[tuple[int, str]]:
    missing: list[tuple[int, str]] = []
    for paper_id, payload in source_map.items():
        for summary_type in DRAFT_REQUIRED_SUMMARY_TYPES:
            state = payload.get(summary_type) or {}
            if state.get("status") != "generated":
                missing.append((paper_id, summary_type))
    return missing


def build_draft_pending_message(run: ResearchMatrixRun, source_map: dict[int, dict[str, Any]]) -> str:
    missing_labels: list[str] = []
    for run_paper in run.papers:
        if not run_paper.paper_id:
            continue
        states = source_map.get(run_paper.paper_id) or {}
        missing_types = [
            summary_type
            for summary_type in DRAFT_REQUIRED_SUMMARY_TYPES
            if (states.get(summary_type) or {}).get("status") != "generated"
        ]
        if not missing_types:
            continue
        labels = [summary_title(summary_type) for summary_type in missing_types]
        missing_labels.append(f"{run_paper.title_snapshot}（缺少：{'、'.join(labels)}）")
    if not missing_labels:
        return "当前来源卡片仍在准备中。"
    return "以下来源卡片尚未齐备，当前会先基于已就绪证据生成可用草稿：" + "；".join(missing_labels[:4])


def paragraph_item(
    text: str,
    citations: list[dict[str, Any]] | None = None,
    confidence: str = "supported",
) -> dict[str, Any]:
    return {
        "text": compact_text(text, 1200),
        "citations": citations or [],
        "confidence": confidence,
    }


def citation_item(
    *,
    paper_id: int | None = None,
    paper_title: str,
    source_card_type: str,
    page: int | None = None,
    quote: str = "",
    start_char: int | None = None,
    end_char: int | None = None,
    source_section: str = "",
) -> dict[str, Any]:
    payload = {
        "paper_id": paper_id,
        "paper_title": paper_title,
        "source_card_type": source_card_type,
        "page": page,
    }
    if quote:
        payload["quote"] = quote
    if start_char is not None:
        payload["start_char"] = start_char
    if end_char is not None:
        payload["end_char"] = end_char
    if source_section:
        payload["source_section"] = source_section
    return payload


def summary_content_payload(state: dict[str, Any] | None) -> dict[str, Any]:
    payload = state or {}
    return dict(payload.get("summary") or {}) if payload.get("status") == "generated" else {}


def extract_summary_sections(state: dict[str, Any] | None) -> list[dict[str, Any]]:
    content = summary_content_payload(state)
    sections = content.get("sections") or content.get("narrative_sections") or []
    if not isinstance(sections, list):
        return []
    result: list[dict[str, Any]] = []
    for section in sections[:12]:
        if not isinstance(section, dict):
            continue
        body = compact_text(section.get("body") or "", 780)
        if not body:
            continue
        result.append(
            {
                "heading": str(section.get("heading") or ""),
                "body": body,
                "evidence": list(section.get("evidence") or []),
            }
        )
    return result


def extract_summary_preview(state: dict[str, Any] | None) -> str:
    content = summary_content_payload(state)
    return compact_text(content.get("preview") or state.get("preview") or "", 220) if state else ""


def extract_review_bundle(state: dict[str, Any] | None) -> dict[str, Any]:
    content = summary_content_payload(state)
    if not content:
        return {"fields": {}, "sections": [], "blocks": []}
    review = get_review_summary_content(content)
    structured_fields = dict(review.get("structured_fields") or {})
    field_blocks = [
        block for block in (review.get("review_field_blocks") or [])
        if isinstance(block, dict)
    ]
    block_map = {
        str(block.get("key") or ""): block
        for block in field_blocks
        if str(block.get("key") or "").strip()
    }
    for field_key, block in block_map.items():
        summary_text = compact_text(block.get("summary") or "", 420)
        if summary_text:
            structured_fields[field_key] = summary_text
    return {
        "fields": structured_fields,
        "sections": list(review.get("narrative_sections") or review.get("sections") or []),
        "blocks": field_blocks,
    }


def extract_summary_missing_items(state: dict[str, Any] | None) -> list[str]:
    content = summary_content_payload(state)
    value = content.get("missing_items") if isinstance(content, dict) else []
    if not isinstance(value, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = compact_text(item, 180)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result[:6]


def normalize_text_list(value: Any, *, limit: int = 6) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in parse_compound_list(value, limit=limit):
        text = compact_text(item, 280)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result[:limit]


def tokenize_topic_text(value: Any) -> list[str]:
    text = " ".join(str(value or "").split()).lower()
    if not text:
        return []
    raw_tokens = re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9_-]{2,}", text)
    stopwords = {
        "研究", "方法", "结果", "数据", "模型", "实验", "分析", "问题", "工作", "文献", "论文",
        "以及", "相关", "基于", "一种", "进行", "采用", "通过", "对于", "现有", "main", "findings",
        "method", "route", "research", "question", "study", "using", "based", "approach",
    }
    canonical_map = {
        "convolutional": "cnn",
        "convolution": "cnn",
        "convolutional_neural_network": "cnn",
        "convolutional-neural-network": "cnn",
        "cnn-based": "cnn",
        "cnn_gwo": "cnn",
        "gwo-cnn": "cnn",
        "卷积神经网络": "cnn",
        "卷积网络": "cnn",
        "深度卷积网络": "cnn",
        "multi-modal": "multimodal",
        "multi_modal": "multimodal",
        "multimodal": "multimodal",
        "多模态": "multimodal",
    }
    tokens: list[str] = []
    seen: set[str] = set()
    for token in raw_tokens:
        token = canonical_map.get(token, token)
        if token in stopwords or len(token) < 2:
            continue
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    priority = ["cnn", "multimodal"]
    ordered = [token for token in priority if token in tokens]
    ordered.extend(token for token in tokens if token not in ordered)
    return ordered[:24]


def summarize_bundle_topics(bundle: dict[str, Any]) -> dict[str, Any]:
    topic_tokens: list[str] = []
    for value in [
        bundle["review_fields"].get("background_motivation"),
        bundle["review_fields"].get("research_question"),
        bundle["review_fields"].get("method_route"),
        bundle["review_fields"].get("baselines_metrics"),
        bundle["review_fields"].get("main_findings"),
        bundle["overview_preview"],
    ]:
        topic_tokens.extend(tokenize_topic_text(value))
    deduped: list[str] = []
    seen: set[str] = set()
    for token in topic_tokens:
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    method_text = " ".join(
        str(value or "")
        for value in [
            bundle["review_fields"].get("background_motivation"),
            bundle["review_fields"].get("research_question"),
            bundle["review_fields"].get("method_route"),
            bundle["review_fields"].get("baselines_metrics"),
            bundle["overview_preview"],
        ]
    ).lower()
    anchors: list[str] = []
    if any(flag in method_text for flag in ["cnn", "convolution", "卷积"]):
        anchors.append("cnn")
    if any(flag in method_text for flag in ["multimodal", "multi-modal", "multi modal", "多模态"]):
        anchors.append("multimodal")
    ordered = anchors + [token for token in deduped if token not in anchors]
    return {
        "paper_title": bundle["paper_title"],
        "tokens": ordered[:16],
        "method_text": method_text,
    }


def overlap_score(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    common = len(left & right)
    return common / max(1, min(len(left), len(right)))


def merge_topic_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    merged_tokens: list[str] = []
    seen_tokens: set[str] = set()
    for row in rows:
        for token in row.get("tokens") or []:
            normalized = str(token or "").strip()
            if not normalized or normalized in seen_tokens:
                continue
            seen_tokens.add(normalized)
            merged_tokens.append(normalized)
    return {
        "rows": list(rows),
        "tokens": set(merged_tokens),
    }


def max_review_group_count(paper_count: int) -> int:
    if paper_count <= 8:
        return 2
    if paper_count <= 18:
        return 3
    if paper_count <= 36:
        return 4
    return 5


def compress_topic_groups(
    groups: list[dict[str, Any]],
    *,
    paper_count: int,
) -> list[dict[str, Any]]:
    if not groups:
        return []
    if paper_count <= 4:
        merged_rows = [row for group in groups for row in group.get("rows") or []]
        return [merge_topic_rows(merged_rows)] if merged_rows else []

    max_groups = max_review_group_count(paper_count)
    min_group_size = 2

    ordered = sorted(groups, key=lambda group: len(group.get("rows") or []), reverse=True)
    major_groups = [group for group in ordered if len(group.get("rows") or []) >= min_group_size]
    minor_groups = [group for group in ordered if len(group.get("rows") or []) < min_group_size]

    if not major_groups:
        merged_rows = [row for group in ordered for row in group.get("rows") or []]
        return [merge_topic_rows(merged_rows)] if merged_rows else []

    keep_groups = [
        {
            "rows": list(group.get("rows") or []),
            "tokens": set(group.get("tokens") or set()),
        }
        for group in major_groups[:max_groups]
    ]
    overflow_groups = major_groups[max_groups:] + minor_groups

    for group in overflow_groups:
        if not keep_groups:
            keep_groups.append(merge_topic_rows(list(group.get("rows") or [])))
            continue
        best_target = max(
            keep_groups,
            key=lambda candidate: overlap_score(set(group.get("tokens") or set()), set(candidate.get("tokens") or set())),
        )
        best_target["rows"].extend(list(group.get("rows") or []))
        best_target["tokens"].update(set(group.get("tokens") or set()))

    return sorted(keep_groups, key=lambda group: len(group.get("rows") or []), reverse=True)


def normalize_topic_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    method_priority = {
        "cnn": 0,
        "multimodal": 1,
        "transformer": 2,
        "rnn": 3,
        "lstm": 4,
        "gcn": 5,
        "gnn": 6,
        "gan": 7,
        "unet": 8,
    }
    normalized_groups: list[dict[str, Any]] = []
    for index, group in enumerate(groups, start=1):
        token_counts: dict[str, int] = {}
        for row in group.get("rows") or []:
            for token in set(row.get("tokens") or []):
                normalized = str(token or "").strip()
                if not normalized:
                    continue
                token_counts[normalized] = token_counts.get(normalized, 0) + 1
        ranked_tokens = [
            token
            for token, _count in sorted(
                token_counts.items(),
                key=lambda item: (-item[1], method_priority.get(item[0], 99), item[0]),
            )
        ]
        repeated_tokens = [token for token in ranked_tokens if token_counts.get(token, 0) >= 2]
        token_examples = (repeated_tokens or ranked_tokens)[:3]
        label = " / ".join(token_examples) if token_examples else f"主题 {index}"
        normalized_groups.append(
            {
                "label": label,
                "paper_titles": [row["paper_title"] for row in group.get("rows") or [] if row.get("paper_title")],
                "topic_tokens": token_examples,
            }
        )
    return normalized_groups


def analyze_bundle_cohesion(bundles: list[dict[str, Any]], *, grouping_mode: str = "topic_first") -> dict[str, Any]:
    topic_rows = [summarize_bundle_topics(bundle) for bundle in bundles]
    if len(topic_rows) <= 1:
        return {
            "is_cohesive": True,
            "mode": "single_topic",
            "message": "",
            "groups": [
                {
                    "label": "当前主题",
                    "paper_titles": [row["paper_title"] for row in topic_rows if row["paper_title"]],
                }
            ],
        }

    all_tokens = [set(row["tokens"]) for row in topic_rows]
    if grouping_mode == "method_first" and all_tokens:
        common_tokens = set.intersection(*all_tokens)
        if common_tokens & {"cnn", "multimodal", "transformer", "rnn", "lstm", "gcn", "gan"}:
            shared = next(iter(common_tokens & {"cnn", "multimodal", "transformer", "rnn", "lstm", "gcn", "gan"}))
            label_map = {
                "cnn": "CNN 相关研究",
                "multimodal": "多模态相关研究",
                "transformer": "Transformer 相关研究",
                "rnn": "RNN 相关研究",
                "lstm": "LSTM 相关研究",
                "gcn": "GCN 相关研究",
                "gan": "GAN 相关研究",
            }
            label = label_map.get(shared, f"{shared.upper()} 相关研究")
            return {
                "is_cohesive": True,
                "mode": "shared_method_anchor",
                "message": "",
                "groups": [
                    {
                        "label": label,
                        "paper_titles": [row["paper_title"] for row in topic_rows if row["paper_title"]],
                        "topic_tokens": sorted(common_tokens)[:4],
                    }
                ],
            }

    groups: list[dict[str, Any]] = []
    threshold = 0.18 if grouping_mode == "method_first" else 0.24
    for row in topic_rows:
        tokens = set(row["tokens"])
        matched = None
        best_score = 0.0
        for group in groups:
            score = overlap_score(tokens, group["tokens"])
            if score > best_score:
                best_score = score
                matched = group
        if matched and best_score >= threshold:
            matched["rows"].append(row)
            matched["tokens"].update(tokens)
        else:
            groups.append(
                {
                    "rows": [row],
                    "tokens": set(tokens),
                }
            )

    compressed_groups = compress_topic_groups(groups, paper_count=len(topic_rows))
    normalized_groups = normalize_topic_groups(compressed_groups)

    largest_group = max((len(group["paper_titles"]) for group in normalized_groups), default=0)
    group_count = len(normalized_groups)
    dominant_ratio = largest_group / max(1, len(topic_rows))
    cohesive = (
        len(topic_rows) <= 4
        or group_count == 1
        or (group_count == 2 and dominant_ratio >= 0.7)
    )
    if cohesive:
        return {
            "is_cohesive": True,
            "mode": "single_topic",
            "message": "",
            "groups": normalized_groups,
        }

    group_summaries = [
        f"{group['label']}：{'、'.join(group['paper_titles'][:3])}"
        for group in normalized_groups[:3]
    ]
    return {
        "is_cohesive": False,
        "mode": "multi_topic",
        "message": (
            "当前批次论文的共同主题较弱，更适合按子主题分别整理，而不是硬生成单一综述："
            if grouping_mode != "method_first"
            else "当前批次论文按方法路线看仍有明显分化，建议先分组整理："
        ) + "；".join(group_summaries),
        "groups": normalized_groups,
    }


def infer_outline_points(section_key: str, groups: list[dict[str, Any]]) -> list[str]:
    labels = [group["label"] for group in groups[:3] if group.get("label")]
    if section_key == "research_background":
        return [
            "交代该批文献共同关注的问题域与研究动机",
            "说明现有研究为何在这些主题上持续展开",
            *( [f"可结合主题簇：{'、'.join(labels)}"] if labels else [] ),
        ]
    if section_key == "research_status":
        return [
            "按研究路线或任务目标归纳现有工作版图",
            "指出当前文献的主要共识与阶段性分化",
            *( [f"优先比较主题簇之间的差异：{'、'.join(labels)}"] if labels else [] ),
        ]
    if section_key == "core_innovations":
        return [
            "总结各主题簇最突出的创新切入点",
            "区分方法创新、数据创新与任务设定创新",
        ]
    if section_key == "method_compare":
        return [
            "按方法路线对比技术路径、输入特征与评估抓手",
            "突出不同主题簇之间可比与不可比之处",
        ]
    if section_key == "result_analysis":
        return [
            "总结不同研究在实验结果上的一致结论与差异表现",
            "说明这些结果是否受数据、场景或评价口径影响",
        ]
    if section_key == "limitations_future":
        return [
            "归纳现有工作的共性局限",
            "提炼后续研究可进入的空白点与扩展方向",
        ]
    return []


def build_outline_section(
    key: str,
    title: str,
    paragraphs: list[dict[str, Any]],
    groups: list[dict[str, Any]],
) -> dict[str, Any]:
    source_titles = collect_source_titles_from_paragraphs(paragraphs)
    summary = compact_text(" ".join(paragraph.get("text") or "" for paragraph in paragraphs), 420)
    return {
        "key": key,
        "title": title,
        "goal": {
            "research_background": "交代研究背景与问题缘起",
            "research_status": "梳理现有研究版图与进展",
            "core_innovations": "概括主要创新方向",
            "method_compare": "比较不同方法路线",
            "result_analysis": "总结结果表现与证据差异",
            "limitations_future": "提炼局限与未来方向",
        }.get(key, title),
        "summary": summary,
        "points": infer_outline_points(key, groups),
        "source_titles": source_titles[:8],
        "support_count": len(source_titles),
    }


def build_outline_insights(drafts: dict[str, Any]) -> dict[str, list[str]]:
    method_section = drafts.get("method_compare") or {}
    result_section = drafts.get("result_analysis") or {}
    limit_section = drafts.get("limitations_future") or {}
    innovation_section = drafts.get("core_innovations") or {}

    consensus: list[str] = []
    divergence: list[str] = []
    gaps: list[str] = []

    method_paragraphs = list(method_section.get("paragraphs") or [])
    result_paragraphs = list(result_section.get("paragraphs") or [])
    limit_paragraphs = list(limit_section.get("paragraphs") or [])
    innovation_paragraphs = list(innovation_section.get("paragraphs") or [])

    if method_paragraphs:
        consensus.append("现有工作已经能够围绕方法路线形成可比框架，可优先按技术路径组织相关工作。")
    if result_paragraphs:
        consensus.append("实验结果层面已经积累出一批可归纳的结论，可在综述中单独整理共识判断。")
    if len(method_paragraphs) > 1 or len(innovation_paragraphs) > 1:
        divergence.append("不同论文在方法抓手与创新切入点上存在明显分化，适合用“路线 A / 路线 B”方式展开对比。")
    if len(result_paragraphs) > 1:
        divergence.append("不同研究的结果表述并不完全一致，正文中应强调比较口径和适用场景，而不是简单并列结论。")
    if limit_paragraphs:
        gaps.append("现有文献已经暴露出一批共性局限，后续写作可把这些局限转化为研究空白或选题切入点。")
    else:
        gaps.append("当前局限信息仍偏少，正式成文前建议回原文补足研究边界、数据限制和实验条件。")
    if not consensus:
        consensus.append("当前批次的显性共识还不够强，建议先用文献矩阵核对方法路线和核心发现后再写共识段。")
    if not divergence:
        divergence.append("当前批次尚未抽出足够多的差异点，可补充更多方法或结果字段后再强化分歧分析。")
    return {
        "consensus": consensus[:3],
        "divergence": divergence[:3],
        "gaps": gaps[:3],
    }


def build_review_outline(
    drafts: dict[str, Any],
    cohesion: dict[str, Any],
    *,
    grouping_mode: str = "topic_first",
) -> dict[str, Any]:
    groups = cohesion.get("groups") or []
    sections: list[dict[str, Any]] = []
    for key in DRAFT_SECTION_ORDER[:6]:
        draft = drafts.get(key) or {}
        paragraphs = list(draft.get("paragraphs") or [])
        if not paragraphs:
            continue
        sections.append(
            build_outline_section(
                key,
                draft.get("title") or DRAFT_SECTION_TITLES.get(key, key),
                paragraphs,
                groups,
            )
        )
    grouped_outlines: list[dict[str, Any]] = []
    for index, group in enumerate(groups, start=1):
        paper_titles = list(group.get("paper_titles") or [])
        group_sections: list[dict[str, Any]] = []
        for section in sections:
            support_titles = [title for title in list(section.get("source_titles") or []) if title in paper_titles]
            if not support_titles:
                continue
            group_sections.append(
                {
                    **section,
                    "source_titles": support_titles[:8],
                    "support_count": len(support_titles),
                }
            )
        grouped_outlines.append(
            {
                "group_id": f"group_{index}",
                "label": group.get("label") or f"主题 {index}",
                "paper_titles": paper_titles,
                "section_count": len(group_sections),
                "sections": group_sections,
            }
        )
    intro = (
        "当前批次主题较集中，可先按以下大纲组织综述写作。"
        if cohesion.get("is_cohesive", True)
        else "当前批次更适合先按主题分组，再分别按以下大纲整理各组小综述。"
    )
    insights = build_outline_insights(drafts)
    return {
        "key": "review_outline",
        "title": DRAFT_SECTION_TITLES["review_outline"],
        "grouping_mode": grouping_mode,
        "paragraphs": [paragraph_item(intro, [], "weak")],
        "items": [],
        "content": intro,
        "source_titles": [],
        "copy_ready": bool(sections),
        "ai_generated": False,
        "fallback_used": False,
        "outline_sections": sections,
        "topic_groups": groups,
        "grouped_outlines": grouped_outlines,
        "consensus_points": insights["consensus"],
        "divergence_points": insights["divergence"],
        "gap_points": insights["gaps"],
        "diagnostic": not cohesion.get("is_cohesive", True),
    }


def join_sentences(parts: list[str], *, limit: int = 760) -> str:
    items: list[str] = []
    seen: set[str] = set()
    for part in parts:
        text = " ".join(str(part or "").split()).strip("；。 ")
        if not text or text in seen:
            continue
        seen.add(text)
        items.append(text)
    if not items:
        return ""
    content = "；".join(items)
    if content[-1] not in "。！？":
        content += "。"
    return compact_text(content, limit)


def find_sections_by_hints(
    sections: list[dict[str, Any]],
    hints: tuple[str, ...],
    *,
    limit: int = 2,
) -> list[dict[str, Any]]:
    matched: list[dict[str, Any]] = []
    for section in sections:
        heading = str(section.get("heading") or "")
        if any(hint in heading for hint in hints):
            matched.append(section)
        if len(matched) >= limit:
            return matched
    for section in sections:
        body = str(section.get("body") or "")
        if any(hint in body for hint in hints):
            matched.append(section)
        if len(matched) >= limit:
            break
    return matched[:limit]


def review_sections_for_field(review_sections: list[dict[str, Any]], field_key: str) -> list[dict[str, Any]]:
    return find_sections_by_hints(review_sections, REVIEW_SECTION_HINTS.get(field_key, (field_key,)), limit=2)


def first_page_from_evidence(evidence: list[dict[str, Any]] | None) -> int | None:
    if not evidence:
        return None
    for item in evidence:
        page = item.get("page")
        if page in {None, ""}:
            continue
        try:
            page_number = int(page)
        except (TypeError, ValueError):
            continue
        if page_number > 0:
            return page_number
    return None


def first_evidence_anchor(evidence: list[dict[str, Any]] | None) -> dict[str, Any]:
    if not evidence:
        return {}
    for item in evidence:
        if not isinstance(item, dict):
            continue
        page = item.get("page") or item.get("page_number")
        if page in {None, ""}:
            continue
        try:
            page_number = int(page)
        except (TypeError, ValueError):
            continue
        if page_number <= 0:
            continue
        return {
            "page": page_number,
            "quote": compact_text(
                item.get("quote") or item.get("quote_text") or item.get("source_quote") or "",
                260,
            ),
            "start_char": item.get("start_char"),
            "end_char": item.get("end_char"),
            "source_section": compact_text(
                item.get("source_section") or item.get("section") or "",
                160,
            ),
        }
    return {}


def dedupe_citations(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        key = (
            f"{item.get('paper_id') or ''}::{item.get('paper_title')}::"
            f"{item.get('source_card_type')}::{item.get('page') or ''}::"
            f"{item.get('start_char') or ''}:{item.get('end_char') or ''}::"
            f"{compact_text(item.get('quote') or '', 80)}"
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def citations_from_sections(
    paper_title: str,
    source_card_type: str,
    sections: list[dict[str, Any]],
    *,
    paper_id: int | None = None,
    fallback: bool = True,
) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for section in sections:
        anchor = first_evidence_anchor(list(section.get("evidence") or []))
        citations.append(
            citation_item(
                paper_id=paper_id,
                paper_title=paper_title,
                source_card_type=source_card_type,
                page=anchor.get("page"),
                quote=anchor.get("quote") or "",
                start_char=anchor.get("start_char"),
                end_char=anchor.get("end_char"),
                source_section=anchor.get("source_section") or str(section.get("heading") or ""),
            )
        )
    if not citations and fallback:
        citations.append(
            citation_item(
                paper_id=paper_id,
                paper_title=paper_title,
                source_card_type=source_card_type,
            )
        )
    return dedupe_citations(citations)


def merge_citation_groups(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for group in groups:
        merged.extend(group)
    return dedupe_citations(merged)


def paragraph_confidence(citations: list[dict[str, Any]]) -> str:
    return "supported" if any(item.get("page") for item in citations) else "weak"


def collect_source_titles_from_paragraphs(paragraphs: list[dict[str, Any]]) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()
    for paragraph in paragraphs:
        for citation in paragraph.get("citations") or []:
            title = str(citation.get("paper_title") or "").strip()
            if not title or title in seen:
                continue
            seen.add(title)
            titles.append(title)
    return titles


def build_paper_draft_bundle(run_paper: ResearchMatrixRunPaper, summary_bundle: dict[str, Any]) -> dict[str, Any]:
    overview_sections = extract_summary_sections(summary_bundle.get("overview"))
    review_bundle = extract_review_bundle(summary_bundle.get("review"))
    reproduction_sections = extract_summary_sections(summary_bundle.get("reproduction"))
    return {
        "paper_id": run_paper.paper_id,
        "paper_title": run_paper.title_snapshot,
        "overview_preview": extract_summary_preview(summary_bundle.get("overview")),
        "overview_sections": overview_sections,
        "review_fields": dict(review_bundle.get("fields") or {}),
        "review_sections": list(review_bundle.get("sections") or []),
        "review_field_blocks": list(review_bundle.get("blocks") or []),
        "review_role": compact_text(run_paper.review_role or "", 180),
        "reproduction_sections": reproduction_sections,
        "reproduction_missing_items": extract_summary_missing_items(summary_bundle.get("reproduction")),
    }


def first_positive_page(values: list[Any] | None) -> int | None:
    for value in list(values or []):
        if value in {None, ""}:
            continue
        try:
            page_number = int(value)
        except (TypeError, ValueError):
            continue
        if page_number > 0:
            return page_number
    return None


def review_field_block_items(review_field_blocks: list[dict[str, Any]], field_key: str, *, limit: int = 6) -> list[dict[str, Any]]:
    for block in review_field_blocks:
        if str(block.get("key") or "").strip() != field_key:
            continue
        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in list(block.get("items") or []):
            if not isinstance(item, dict):
                continue
            text = compact_text(item.get("text") or "", 360)
            if not text or text in seen:
                continue
            seen.add(text)
            results.append(
                {
                    "text": text,
                    "page": first_positive_page(item.get("source_pages") or []),
                    "quote": compact_text(item.get("source_quote") or "", 240),
                    "source_section": compact_text(item.get("source_section") or "", 180),
                    "start_char": item.get("start_char"),
                    "end_char": item.get("end_char"),
                }
            )
            if len(results) >= limit:
                break
        return results
    return []


def append_review_block_entries(
    entries: list[dict[str, Any]],
    bundle: dict[str, Any],
    field_key: str,
    *,
    limit: int = 4,
) -> None:
    paper_title = bundle["paper_title"]
    paper_id = bundle.get("paper_id")
    for item in review_field_block_items(bundle.get("review_field_blocks") or [], field_key, limit=limit):
        append_section_entry(
            entries,
            text=item.get("text") or "",
            paper_title=paper_title,
            citations=[
                citation_item(
                    paper_id=paper_id,
                    paper_title=paper_title,
                    source_card_type="review",
                    page=item.get("page"),
                    quote=item.get("quote") or "",
                    start_char=item.get("start_char"),
                    end_char=item.get("end_char"),
                    source_section=item.get("source_section") or field_key,
                )
            ],
        )


def append_section_entry(
    entries: list[dict[str, Any]],
    *,
    text: str,
    paper_title: str,
    citations: list[dict[str, Any]] | None = None,
) -> None:
    normalized = " ".join(str(text or "").split()).strip("；。;，, ")
    if not normalized:
        return
    entries.append(
        {
            "text": compact_text(normalized, 420),
            "paper_title": paper_title,
            "citations": dedupe_citations(list(citations or [])),
        }
    )


def group_section_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        key = str(entry.get("text") or "").strip().lower()
        if not key:
            continue
        group = grouped.get(key)
        if not group:
            group = {
                "text": entry["text"],
                "titles": [],
                "citations": [],
                "index": index,
            }
            grouped[key] = group
            ordered.append(group)
        title = str(entry.get("paper_title") or "").strip()
        if title and title not in group["titles"]:
            group["titles"].append(title)
        group["citations"] = dedupe_citations(group["citations"] + list(entry.get("citations") or []))
    ordered.sort(key=lambda item: (-len(item["titles"]), item["index"]))
    for item in ordered:
        item.pop("index", None)
    return ordered


def build_grouped_review_paragraph(
    prefix: str,
    groups: list[dict[str, Any]],
    *,
    limit: int = 4,
    text_limit: int = 820,
) -> dict[str, Any] | None:
    selected = list(groups[:limit])
    if not selected:
        return None
    clauses: list[str] = []
    citations: list[dict[str, Any]] = []
    for group in selected:
        clause = str(group.get("text") or "").strip("；。;，, ")
        if not clause:
            continue
        clauses.append(clause)
        citations.extend(list(group.get("citations") or []))
    if not clauses:
        return None
    merged_citations = dedupe_citations(citations)
    text = compact_text(f"{prefix}{'；'.join(clauses)}。", text_limit)
    return paragraph_item(text, merged_citations, paragraph_confidence(merged_citations))
def extend_paragraphs(target: list[dict[str, Any]], *paragraphs: dict[str, Any] | None) -> None:
    for paragraph in paragraphs:
        if paragraph:
            target.append(paragraph)


def build_grouped_review_paragraph_series(
    groups: list[dict[str, Any]],
    prefixes: list[str],
    *,
    chunk_size: int = 4,
    max_paragraphs: int = 2,
    text_limit: int = 820,
) -> list[dict[str, Any]]:
    paragraphs: list[dict[str, Any]] = []
    if not groups:
        return paragraphs
    chunks = [groups[index:index + chunk_size] for index in range(0, len(groups), chunk_size)]
    for index, chunk in enumerate(chunks[:max_paragraphs]):
        prefix = prefixes[min(index, len(prefixes) - 1)] if prefixes else ""
        paragraph = build_grouped_review_paragraph(prefix, chunk, limit=chunk_size, text_limit=text_limit)
        if paragraph:
            paragraphs.append(paragraph)
    return paragraphs


def citation_has_anchor(citation: dict[str, Any]) -> bool:
    return bool(citation.get("page") and compact_text(citation.get("quote") or "", 80))


def review_field_label(field_key: str) -> str:
    labels = {
        "research_question": "Research Question",
        "method_route": "Method Route",
        "main_findings": "Main Findings",
        "innovations": "Innovations",
        "data_experiment": "Data and Experiment",
        "baselines_metrics": "Baselines and Metrics",
        "limitations": "Limitations",
        "reproduction_missing_items": "Missing Reproduction Details",
        "cross_paper_conflict": "Cross-paper Conflict",
    }
    return labels.get(field_key, field_key)


def bundle_field_is_sparse(bundle: dict[str, Any], field_key: str) -> bool:
    value = bundle.get("review_fields", {}).get(field_key)
    if field_key in {"innovations", "limitations"}:
        return not normalize_text_list(value, limit=6)
    return not compact_text(value or "", 120)


def collect_usage_counts(drafts: dict[str, Any]) -> Counter[str]:
    usage: Counter[str] = Counter()
    weighted_sections = {
        "research_background": 1,
        "research_status": 2,
        "core_innovations": 2,
        "method_compare": 2,
        "result_analysis": 3,
        "limitations_future": 2,
        "final_integrated_review": 4,
    }
    for section_key, weight in weighted_sections.items():
        section = drafts.get(section_key) or {}
        for paragraph in list(section.get("paragraphs") or []):
            titles = {
                str(citation.get("paper_title") or "").strip()
                for citation in list(paragraph.get("citations") or [])
                if str(citation.get("paper_title") or "").strip()
            }
            for title in titles:
                usage[title] += weight
    outline = drafts.get("review_outline") or {}
    for section in list(outline.get("outline_sections") or []):
        for title in list(section.get("source_titles") or [])[:6]:
            normalized = str(title or "").strip()
            if normalized:
                usage[normalized] += 1
    return usage


def collect_weak_title_counts(drafts: dict[str, Any]) -> Counter[str]:
    weak_counts: Counter[str] = Counter()
    for section_key in [*DRAFT_SECTION_ORDER[:6], "final_integrated_review"]:
        section = drafts.get(section_key) or {}
        for paragraph in list(section.get("paragraphs") or []):
            has_weak_signal = (
                str(paragraph.get("confidence") or "") == "weak"
                or any(not citation_has_anchor(citation) for citation in list(paragraph.get("citations") or []))
            )
            if not has_weak_signal:
                continue
            titles = {
                str(citation.get("paper_title") or "").strip()
                for citation in list(paragraph.get("citations") or [])
                if str(citation.get("paper_title") or "").strip()
            }
            for title in titles:
                weak_counts[title] += 1
    return weak_counts


def collect_conflict_titles(bundles: list[dict[str, Any]], usage_counts: Counter[str]) -> set[str]:
    findings_by_title: dict[str, set[str]] = {}
    for bundle in bundles:
        title = str(bundle.get("paper_title") or "").strip()
        findings = compact_text(bundle.get("review_fields", {}).get("main_findings") or "", 320)
        if not title or not findings:
            continue
        findings_by_title[title] = set(tokenize_topic_text(findings)[:8])
    titles = [title for title in findings_by_title if usage_counts.get(title, 0) >= 2]
    conflict_titles: set[str] = set()
    for index, left in enumerate(titles):
        left_tokens = findings_by_title.get(left) or set()
        if not left_tokens:
            continue
        for right in titles[index + 1:]:
            right_tokens = findings_by_title.get(right) or set()
            if not right_tokens:
                continue
            if len(left_tokens & right_tokens) == 0:
                conflict_titles.add(left)
                conflict_titles.add(right)
    return conflict_titles


def build_priority_item(
    *,
    bundle: dict[str, Any],
    field_key: str,
    score: int,
    usage_count: int,
    signals: list[str],
    reason_summary: str,
    citations: list[dict[str, Any]],
    focus_text: str = "",
) -> dict[str, Any]:
    priority_score = int(max(score, len(signals) + 1))
    if priority_score >= 10:
        priority_level = "high"
    elif priority_score >= 6:
        priority_level = "medium"
    else:
        priority_level = "low"
    field_label = review_field_label(field_key)
    top_citation = list(citations or [])[:3]
    lead = top_citation[0] if top_citation else {}
    return {
        "paper_id": bundle.get("paper_id"),
        "paper_title": str(bundle.get("paper_title") or "").strip(),
        "field_key": field_key,
        "field_label": field_label,
        "priority_score": priority_score,
        "priority_level": priority_level,
        "usage_count": usage_count,
        "signals": signals[:6],
        "reason_summary": compact_text(reason_summary, 220),
        "focus_text": compact_text(focus_text, 240),
        "citations": top_citation,
        "recommended_action": f"Revisit original text for {field_label} and verify page anchors, source quote, and scope.",
        "quote": compact_text(focus_text or reason_summary, 240),
        "usage_note": compact_text(f"{field_label} | {priority_level} priority", 120),
        "page": lead.get("page"),
        "source_card_type": lead.get("source_card_type") or "review",
        "start_char": lead.get("start_char"),
        "end_char": lead.get("end_char"),
    }


def dedupe_priority_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in sorted(
        items,
        key=lambda current: (
            -int(current.get("priority_score") or 0),
            -int(current.get("usage_count") or 0),
            str(current.get("paper_title") or ""),
            str(current.get("field_key") or ""),
        ),
    ):
        key = (str(item.get("paper_title") or ""), str(item.get("field_key") or ""))
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    return ordered


def ensure_section_paragraph_depth(
    paragraphs: list[dict[str, Any]],
    bundles: list[dict[str, Any]],
    section_key: str,
    *,
    target_count: int = 3,
) -> list[dict[str, Any]]:
    if len(paragraphs) >= target_count:
        return paragraphs
    seen = {
        str(item.get("text") or "").strip().lower()
        for item in paragraphs
        if str(item.get("text") or "").strip()
    }
    for bundle in bundles:
        if len(paragraphs) >= target_count:
            break
        candidate = build_section_paragraph(bundle, section_key)
        if not candidate:
            continue
        key = str(candidate.get("text") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        paragraphs.append(candidate)
    return paragraphs

def build_evidence_priority_queue(bundles: list[dict[str, Any]], drafts: dict[str, Any]) -> dict[str, Any]:
    usage_counts = collect_usage_counts(drafts)
    weak_title_counts = collect_weak_title_counts(drafts)
    conflict_titles = collect_conflict_titles(bundles, usage_counts)
    items: list[dict[str, Any]] = []

    for bundle in bundles:
        paper_title = str(bundle.get("paper_title") or "").strip()
        if not paper_title:
            continue
        paper_id = bundle.get("paper_id")
        usage_count = int(usage_counts.get(paper_title, 0) or 0)
        weak_count = int(weak_title_counts.get(paper_title, 0) or 0)
        review_sections = bundle.get("review_sections") or []
        reproduction_sections = bundle.get("reproduction_sections") or []

        missing_items = list(bundle.get("reproduction_missing_items") or [])[:4]
        if missing_items:
            limit_sections = find_sections_by_hints(reproduction_sections, REPRO_LIMIT_HINTS, limit=3)
            items.append(
                build_priority_item(
                    bundle=bundle,
                    field_key="reproduction_missing_items",
                    score=6 + len(missing_items) + min(usage_count, 3) + min(weak_count, 2),
                    usage_count=usage_count,
                    signals=["missing_items_not_empty", *( ["high_usage"] if usage_count >= 4 else [] ), *( ["weak_draft"] if weak_count else [] )],
                    reason_summary=f"{len(missing_items)} missing reproduction details still affect comparison or citation.",
                    citations=citations_from_sections(paper_title, "reproduction", limit_sections),
                    focus_text="; ".join(missing_items),
                )
            )

        for field_key in [
            "research_question",
            "method_route",
            "main_findings",
            "innovations",
            "data_experiment",
            "baselines_metrics",
            "limitations",
        ]:
            block_items = review_field_block_items(bundle.get("review_field_blocks") or [], field_key, limit=8)
            anchor_missing_items = [item for item in block_items if not item.get("page") or not compact_text(item.get("quote") or "", 60)]
            sparse = field_key in {"data_experiment", "baselines_metrics", "limitations"} and bundle_field_is_sparse(bundle, field_key)
            weak_signal = weak_count > 0 and field_key in {"main_findings", "data_experiment", "baselines_metrics", "limitations"}
            conflict_signal = field_key == "main_findings" and paper_title in conflict_titles
            if not any([anchor_missing_items, sparse, weak_signal, conflict_signal]):
                continue

            signals: list[str] = []
            score = min(usage_count, 4)
            if anchor_missing_items:
                signals.append("missing_page_or_quote")
                score += 3
            if sparse:
                signals.append("sparse_field")
                score += 3
            if weak_signal:
                signals.append("weak_draft")
                score += min(weak_count, 2)
            if conflict_signal:
                signals.append("cross_paper_conflict")
                score += 3
            if usage_count >= 4:
                signals.append("high_usage")
                score += 2

            candidate_citations = [
                citation_item(
                    paper_id=paper_id,
                    paper_title=paper_title,
                    source_card_type="review",
                    page=item.get("page"),
                    quote=item.get("quote") or "",
                    start_char=item.get("start_char"),
                    end_char=item.get("end_char"),
                    source_section=item.get("source_section") or field_key,
                )
                for item in anchor_missing_items[:3]
            ]
            if not candidate_citations:
                candidate_citations = citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, field_key),
                )

            field_value = bundle.get("review_fields", {}).get(field_key)
            focus_candidates = normalize_text_list(field_value, limit=2) if isinstance(field_value, list) else [compact_text(field_value or "", 180)]
            items.append(
                build_priority_item(
                    bundle=bundle,
                    field_key=field_key,
                    score=score,
                    usage_count=usage_count,
                    signals=signals,
                    reason_summary="This field is weak, thin, conflicting, or repeatedly reused in the draft chain.",
                    citations=candidate_citations,
                    focus_text="; ".join([item for item in focus_candidates if item]),
                )
            )

    deduped_items = dedupe_priority_items(items)[:12]
    content = "\n".join(
        f"{index}. {item['paper_title']} | {item['field_label']} | {item['reason_summary']}"
        for index, item in enumerate(deduped_items, start=1)
    )
    return {
        "key": "evidence_priority_queue",
        "title": "Priority Revisit Queue",
        "paragraphs": [],
        "items": deduped_items,
        "content": content or "No high-risk revisit items detected.",
        "source_titles": [item["paper_title"] for item in deduped_items[:8] if item.get("paper_title")],
        "copy_ready": bool(deduped_items),
        "ai_generated": False,
        "fallback_used": False,
    }
def build_review_section_paragraphs(bundles: list[dict[str, Any]], section_key: str) -> list[dict[str, Any]]:
    paragraphs: list[dict[str, Any]] = []

    if section_key == "research_background":
        question_entries: list[dict[str, Any]] = []
        background_entries: list[dict[str, Any]] = []
        for bundle in bundles:
            paper_title = bundle["paper_title"]
            review_sections = bundle["review_sections"]
            overview_sections = bundle["overview_sections"]
            append_section_entry(
                question_entries,
                text=compact_text(bundle["review_fields"].get("research_question"), 320),
                paper_title=paper_title,
                citations=citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, "research_question"),
                ),
            )
            append_review_block_entries(question_entries, bundle, "research_question")
            append_review_block_entries(background_entries, bundle, "background_motivation")
            background_sections = find_sections_by_hints(overview_sections, OVERVIEW_BACKGROUND_HINTS, limit=3)
            append_section_entry(
                background_entries,
                text=join_sentences([section.get("body") or "" for section in background_sections], limit=420),
                paper_title=paper_title,
                citations=citations_from_sections(paper_title, "overview", background_sections),
            )
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(question_entries),
            [
                "本批文献的研究背景主要围绕以下问题展开：",
                "这些问题在研究目标上还可以进一步归为相近的几类：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(background_entries),
            [
                "从问题动机和应用场景看，相关研究大致延伸出以下主线：",
                "这些背景动机和应用语境也可以视为下一步方法分化的前提：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))

    elif section_key == "research_status":
        method_entries: list[dict[str, Any]] = []
        finding_entries: list[dict[str, Any]] = []
        for bundle in bundles:
            paper_title = bundle["paper_title"]
            review_sections = bundle["review_sections"]
            append_section_entry(
                method_entries,
                text=compact_text(bundle["review_fields"].get("method_route"), 320),
                paper_title=paper_title,
                citations=citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, "method_route"),
                ),
            )
            append_review_block_entries(method_entries, bundle, "method_route")
            append_section_entry(
                finding_entries,
                text=compact_text(bundle["review_fields"].get("main_findings"), 320),
                paper_title=paper_title,
                citations=citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, "main_findings"),
                ),
            )
            append_review_block_entries(finding_entries, bundle, "main_findings")
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(method_entries),
            [
                "从现有研究路径看，相关工作大致可以归为以下几类：",
                "如果按技术路线再细分，这些研究还可以继续拆出几类较稳定的方向：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(finding_entries),
            [
                "就当前文献给出的结论而言，已有研究主要呈现出以下共识或差异：",
                "在这些结论之中，部分文献呈现出相对稳定的判断，部分则仍有明显分化：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))

    elif section_key == "core_innovations":
        innovation_entries: list[dict[str, Any]] = []
        method_entries: list[dict[str, Any]] = []
        for bundle in bundles:
            paper_title = bundle["paper_title"]
            review_sections = bundle["review_sections"]
            for item in normalize_text_list(bundle["review_fields"].get("innovations"), limit=5):
                append_section_entry(
                    innovation_entries,
                    text=item,
                    paper_title=paper_title,
                    citations=citations_from_sections(
                        paper_title,
                        "review",
                        review_sections_for_field(review_sections, "innovations"),
                    ),
                )
            append_review_block_entries(innovation_entries, bundle, "innovations", limit=5)
            append_section_entry(
                method_entries,
                text=compact_text(bundle["review_fields"].get("method_route"), 320),
                paper_title=paper_title,
                citations=citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, "method_route"),
                ),
            )
            append_review_block_entries(method_entries, bundle, "method_route")
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(innovation_entries),
            [
                "综合现有文献，核心创新主要体现在：",
                "如果再按创新类型细分，这些工作大致可以分成几种全然不同的切入点：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(method_entries),
            [
                "这些创新通常依托以下技术路线展开：",
                "从方法支撑关系看，创新点之间并不是平行堆叠，而是各自依托不同的技术基底：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))

    elif section_key == "method_compare":
        method_entries: list[dict[str, Any]] = []
        metric_entries: list[dict[str, Any]] = []
        for bundle in bundles:
            paper_title = bundle["paper_title"]
            review_sections = bundle["review_sections"]
            append_section_entry(
                method_entries,
                text=compact_text(bundle["review_fields"].get("method_route"), 320),
                paper_title=paper_title,
                citations=citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, "method_route"),
                ),
            )
            append_review_block_entries(method_entries, bundle, "method_route", limit=5)
            for item in normalize_text_list(bundle["review_fields"].get("baselines_metrics"), limit=5):
                append_section_entry(
                    metric_entries,
                    text=item,
                    paper_title=paper_title,
                    citations=citations_from_sections(
                        paper_title,
                        "review",
                        review_sections_for_field(review_sections, "baselines_metrics"),
                    ),
                )
            append_review_block_entries(metric_entries, bundle, "baselines_metrics", limit=5)
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(method_entries),
            [
                "方法对比上，现有工作主要采用以下路线：",
                "如果从细化的路线构成看，各类方法在输入、模型或决策抓手上还存在进一步差分：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(metric_entries),
            [
                "用于比较的方法抓手和评价指标主要集中在：",
                "这些比较口径也决定了后续结论是否真正具有可比性：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))
    elif section_key == "result_analysis":
        finding_entries: list[dict[str, Any]] = []
        evaluation_entries: list[dict[str, Any]] = []
        for bundle in bundles:
            paper_title = bundle["paper_title"]
            review_sections = bundle["review_sections"]
            reproduction_sections = bundle["reproduction_sections"]
            append_section_entry(
                finding_entries,
                text=compact_text(bundle["review_fields"].get("main_findings"), 320),
                paper_title=paper_title,
                citations=citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, "main_findings"),
                ),
            )
            append_review_block_entries(finding_entries, bundle, "main_findings", limit=5)
            append_section_entry(
                evaluation_entries,
                text=compact_text(bundle["review_fields"].get("data_experiment"), 320),
                paper_title=paper_title,
                citations=citations_from_sections(
                    paper_title,
                    "review",
                    review_sections_for_field(review_sections, "data_experiment"),
                ),
            )
            append_review_block_entries(evaluation_entries, bundle, "data_experiment", limit=5)
            result_sections = find_sections_by_hints(reproduction_sections, REPRO_RESULT_HINTS, limit=3)
            append_section_entry(
                evaluation_entries,
                text=join_sentences([section.get("body") or "" for section in result_sections], limit=420),
                paper_title=paper_title,
                citations=citations_from_sections(paper_title, "reproduction", result_sections),
            )
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(finding_entries),
            [
                "从实验结果看，现有文献主要支持以下判断：",
                "如果把这些结果按证据类型拆开，还可以看到一批比较集中的判断：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(evaluation_entries),
            [
                "在数据、样本与评估设置上，常见安排包括：",
                "而正是这些数据和评估口径的差异，决定了后续结论是否最终具有可比性：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))

    elif section_key == "limitations_future":
        limitation_entries: list[dict[str, Any]] = []
        future_entries: list[dict[str, Any]] = []
        for bundle in bundles:
            paper_title = bundle["paper_title"]
            review_sections = bundle["review_sections"]
            reproduction_sections = bundle["reproduction_sections"]
            for item in normalize_text_list(bundle["review_fields"].get("limitations"), limit=5):
                append_section_entry(
                    limitation_entries,
                    text=item,
                    paper_title=paper_title,
                    citations=citations_from_sections(
                        paper_title,
                        "review",
                        review_sections_for_field(review_sections, "limitations"),
                    ),
                )
            append_review_block_entries(limitation_entries, bundle, "limitations", limit=5)
            limit_sections = find_sections_by_hints(reproduction_sections, REPRO_LIMIT_HINTS, limit=3)
            append_section_entry(
                future_entries,
                text=join_sentences([section.get("body") or "" for section in limit_sections], limit=420),
                paper_title=paper_title,
                citations=citations_from_sections(paper_title, "reproduction", limit_sections),
            )
            for item in list(bundle.get("reproduction_missing_items") or [])[:4]:
                append_section_entry(
                    future_entries,
                    text=item,
                    paper_title=paper_title,
                    citations=citations_from_sections(paper_title, "reproduction", limit_sections),
                )
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(limitation_entries),
            [
                "现有研究的共性局限主要集中在：",
                "如果从研究边界和证据完整度看，这些局限还可以细化为几类：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))
        paragraphs.extend(build_grouped_review_paragraph_series(
            group_section_entries(future_entries),
            [
                "从后续研究与复现需求看，仍值得继续补齐的方向包括：",
                "这些未补齐的细节也可以直接转化为后续写作中的研究空白或回查卡点：",
            ],
            chunk_size=3,
            max_paragraphs=2,
        ))

    return paragraphs


def build_section_paragraph(bundle: dict[str, Any], section_key: str) -> dict[str, Any] | None:
    paper_title = bundle["paper_title"]
    overview_sections = bundle["overview_sections"]
    review_fields = bundle["review_fields"]
    review_sections = bundle["review_sections"]
    reproduction_sections = bundle["reproduction_sections"]
    reproduction_missing_items = bundle["reproduction_missing_items"]

    parts: list[str] = []
    citations: list[dict[str, Any]] = []

    if section_key == "research_background":
        background_sections = find_sections_by_hints(overview_sections, OVERVIEW_BACKGROUND_HINTS, limit=2)
        overview_text = join_sentences([section.get("body") or "" for section in background_sections], limit=520)
        research_question = compact_text(review_fields.get("research_question"), 320)
        if overview_text:
            parts.append(f"研究背景与问题主线可概括为：{overview_text}")
            citations.extend(citations_from_sections(paper_title, "overview", background_sections))
        if research_question:
            parts.append(f"当前研究主要围绕以下问题展开：{research_question}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "research_question")))

    elif section_key == "research_status":
        status_sections = find_sections_by_hints(overview_sections, OVERVIEW_STATUS_HINTS, limit=2)
        findings = compact_text(review_fields.get("main_findings"), 320)
        overview_text = join_sentences([section.get("body") or "" for section in status_sections], limit=520)
        if findings:
            parts.append(f"从当前批次的研究现状看，主要结论包括：{findings}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "main_findings")))
        if overview_text:
            parts.append(f"相关研究主线大致包括：{overview_text}")
            citations.extend(citations_from_sections(paper_title, "overview", status_sections))

    elif section_key == "core_innovations":
        innovations = normalize_text_list(review_fields.get("innovations"), limit=5)
        method_route = compact_text(review_fields.get("method_route"), 320)
        if innovations:
            parts.append(f"可直接提炼的创新点包括：{'；'.join(innovations[:3])}。")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "innovations")))
        if method_route:
            parts.append(f"这些创新主要落在以下方法路线：{method_route}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "method_route")))

    elif section_key == "method_compare":
        method_route = compact_text(review_fields.get("method_route"), 320)
        baselines_metrics = normalize_text_list(review_fields.get("baselines_metrics"), limit=5)
        if method_route:
            parts.append(f"现有工作采用的方法路线包括：{method_route}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "method_route")))
        if baselines_metrics:
            parts.append(f"用于比较的基线、评价指标或消融设置主要包括：{'；'.join(baselines_metrics[:4])}。")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "baselines_metrics")))

    elif section_key == "result_analysis":
        findings = compact_text(review_fields.get("main_findings"), 320)
        data_experiment = compact_text(review_fields.get("data_experiment"), 320)
        result_sections = find_sections_by_hints(reproduction_sections, REPRO_RESULT_HINTS, limit=2)
        reproduction_text = join_sentences([section.get("body") or "" for section in result_sections], limit=520)
        if findings:
            parts.append(f"从结果上看，当前文献支持的核心发现包括：{findings}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "main_findings")))
        if data_experiment:
            parts.append(f"常见的数据、样本与实验设置信息包括：{data_experiment}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "data_experiment")))
        if reproduction_text:
            parts.append(f"实验、指标或参数层面的补充信息包括：{reproduction_text}")
            citations.extend(citations_from_sections(paper_title, "reproduction", result_sections))

    elif section_key == "limitations_future":
        limitations = normalize_text_list(review_fields.get("limitations"), limit=5)
        limit_sections = find_sections_by_hints(reproduction_sections, REPRO_LIMIT_HINTS, limit=2)
        reproduction_text = join_sentences([section.get("body") or "" for section in limit_sections], limit=520)
        if limitations:
            parts.append(f"当前可见的局限或风险包括：{'；'.join(limitations[:3])}。")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "limitations")))
        if reproduction_text:
            parts.append(f"从复现视角看，仍需回查的信息或工程难点包括：{reproduction_text}")
            citations.extend(citations_from_sections(paper_title, "reproduction", limit_sections))
        if reproduction_missing_items:
            parts.append(f"仍待补足的关键信息包括：{'；'.join(reproduction_missing_items[:4])}。")
            citations.extend(citations_from_sections(paper_title, "reproduction", limit_sections))

    text = join_sentences(parts)
    merged_citations = dedupe_citations(citations)
    if not text:
        return None
    if not merged_citations:
        merged_citations = [citation_item(paper_title=paper_title, source_card_type="review")]
    return paragraph_item(text, merged_citations, paragraph_confidence(merged_citations))


def quote_usage_note(source_card_type: str, heading: str) -> str:
    normalized_heading = heading or "相关段落"
    if source_card_type == "overview":
        return f"适合支撑“{normalized_heading}”中的背景或结论表述。"
    if source_card_type == "review":
        return f"适合支撑“{normalized_heading}”中的综述判断。"
    return f"适合支撑“{normalized_heading}”中的实验或复现细节。"


def collect_quotable_items(source_map: dict[int, dict[str, Any]], paper_title_by_id: dict[int, str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for paper_id, summary_bundle in source_map.items():
        paper_title = paper_title_by_id.get(paper_id, "")
        for summary_type in DRAFT_REQUIRED_SUMMARY_TYPES:
            sections = extract_summary_sections(summary_bundle.get(summary_type))
            for section in sections:
                heading = str(section.get("heading") or "")
                for evidence in section.get("evidence") or []:
                    quote = compact_text((evidence or {}).get("quote") or "", 260)
                    page = (evidence or {}).get("page")
                    if not quote or page in {None, ""}:
                        continue
                    key = f"{paper_id}:{summary_type}:{page}:{quote[:80]}"
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append({
                        "paper_id": paper_id,
                        "paper_title": paper_title,
                        "page": page,
                        "quote": quote,
                        "source_card_type": summary_type,
                        "start_char": (evidence or {}).get("start_char"),
                        "end_char": (evidence or {}).get("end_char"),
                        "source_section": compact_text(heading, 160),
                        "usage_note": quote_usage_note(summary_type, heading),
                    })
                    if len(items) >= 24:
                        return items
    return items


def fallback_integrated_review(drafts: dict[str, Any]) -> dict[str, Any]:
    paragraphs: list[dict[str, Any]] = []
    for section_key in DRAFT_SECTION_ORDER[:6]:
        paragraphs.extend(list(drafts.get(section_key, {}).get("paragraphs") or []))
    source_titles = collect_source_titles_from_paragraphs(paragraphs)
    return {
        "key": "final_integrated_review",
        "title": DRAFT_SECTION_TITLES["final_integrated_review"],
        "paragraphs": paragraphs,
        "items": [],
        "content": "\n\n".join(paragraph.get("text") or "" for paragraph in paragraphs),
        "source_titles": source_titles,
        "copy_ready": bool(paragraphs),
        "ai_generated": False,
        "fallback_used": True,
    }


def structured_integrated_review(drafts: dict[str, Any]) -> dict[str, Any]:
    paragraphs: list[dict[str, Any]] = []
    section_leads = {
        "research_background": "从研究背景与问题缘起看，",
        "research_status": "进一步梳理现有研究版图可以发现，",
        "core_innovations": "就核心创新而言，现有工作已经形成若干较明确的切入方向，",
        "method_compare": "如果转向方法比较层面，相关研究之间的差异主要体现在以下方面，",
        "result_analysis": "从结果与证据层面继续归纳，可以看到已有研究的判断并非完全平行，",
        "limitations_future": "最后回到局限与未来方向，现有文献暴露出的缺口与后续可补足的部分主要集中在，",
    }
    for section_key in DRAFT_SECTION_ORDER[:6]:
        section = drafts.get(section_key) or {}
        section_paragraphs = list(section.get("paragraphs") or [])
        if not section_paragraphs:
            continue
        for index, paragraph in enumerate(section_paragraphs, start=1):
            text = str(paragraph.get("text") or "").strip()
            if not text:
                continue
            if index == 1:
                lead = section_leads.get(section_key, "")
                if lead and not text.startswith(lead):
                    text = f"{lead}{text}"
            paragraphs.append(
                paragraph_item(
                    text,
                    list(paragraph.get("citations") or []),
                    paragraph.get("confidence") or "weak",
                )
            )
    source_titles = collect_source_titles_from_paragraphs(paragraphs)
    return {
        "key": "final_integrated_review",
        "title": DRAFT_SECTION_TITLES["final_integrated_review"],
        "paragraphs": paragraphs,
        "items": [],
        "content": "\n\n".join(paragraph.get("text") or "" for paragraph in paragraphs),
        "source_titles": source_titles,
        "copy_ready": bool(paragraphs),
        "ai_generated": False,
        "fallback_used": True,
        "structured_fallback": True,
    }


def build_ai_integrated_review(db: Session, run: ResearchMatrixRun, drafts: dict[str, Any]) -> dict[str, Any]:
    fallback = structured_integrated_review(drafts)
    source_paragraphs: list[dict[str, Any]] = []
    for section_key in DRAFT_SECTION_ORDER[:6]:
        section = drafts.get(section_key) or {}
        for index, paragraph in enumerate(section.get("paragraphs") or [], start=1):
            source_paragraphs.append(
                {
                    "id": f"{section_key}-{index}",
                    "section": section.get("title") or DRAFT_SECTION_TITLES.get(section_key, section_key),
                    "text": paragraph.get("text") or "",
                    "confidence": paragraph.get("confidence") or "weak",
                    "citations": paragraph.get("citations") or [],
                }
            )
    if not source_paragraphs:
        return fallback

    provider = load_available_provider(db, run.user_id, None)
    if not provider:
        return fallback

    quote_items = list((drafts.get("quotable_sentences") or {}).get("items") or [])[:18]
    prompt = f"""
你是一个严谨的中文学术综述助手。请把给定的分块草稿整合成一份真正像“文献综述正文”的终稿，而不是逐篇论文摘要拼接。

硬性规则：
1. 只能使用输入里已经出现的事实、判断和限定语，不能新增事实。
2. 每段都必须引用 source_refs，source_refs 只能引用输入里的段落 id。
3. 如果引用到任何 weak 段落，输出段落的 confidence 必须为 weak，且语气必须降调，明确保留不确定性。
4. 不要重复“见上文”“本节”等元话语，不要输出 Markdown。
5. 输出 8-14 段，优先组织成连续的综述正文，段落之间应体现“研究主题、方法分化、结果差异、局限与趋势”的归纳关系。
6. 不要按“某篇论文提出了……”逐篇串讲；优先使用“现有研究”“相关工作”“一类方法”“另一类研究”这类综述口吻，只有在确有必要区分证据来源时才点论文名举例。
7. 若输入证据不足，请照样整合，但不要把弱证据写成确定结论。
8. 输出必须是 JSON，不要代码块。

输出格式：
{{
  "paragraphs": [
    {{
      "text": "整合后的段落正文",
      "source_refs": ["research_background-1", "method_compare-2"],
      "confidence": "supported"
    }}
  ]
}}

输入段落：
{json.dumps(source_paragraphs, ensure_ascii=False)}

可引用原句：
{json.dumps(quote_items, ensure_ascii=False)}
""".strip()

    try:
        api_key = decrypt_api_key(provider.encrypted_api_key)
        raw = call_text_completion(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            prompt=prompt,
            max_tokens=5200,
        )
        payload = parse_json_object(raw)
    except Exception:
        return fallback

    source_by_id = {item["id"]: item for item in source_paragraphs}
    paragraphs: list[dict[str, Any]] = []
    for item in list(payload.get("paragraphs") or [])[:20]:
        if not isinstance(item, dict):
            continue
        text = compact_text(item.get("text") or "", 1200)
        source_refs = [ref for ref in item.get("source_refs") or [] if ref in source_by_id]
        if not text or not source_refs:
            continue
        citation_groups = [source_by_id[ref]["citations"] for ref in source_refs]
        citations = merge_citation_groups(*citation_groups)
        confidence = "weak" if str(item.get("confidence") or "") == "weak" else "supported"
        if any(source_by_id[ref]["confidence"] == "weak" for ref in source_refs):
            confidence = "weak"
        paragraphs.append(paragraph_item(text, citations, confidence))

    total_chars = sum(len(paragraph.get("text") or "") for paragraph in paragraphs)
    if not paragraphs or len(paragraphs) < 10 or total_chars < 1800:
        return fallback

    return {
        "key": "final_integrated_review",
        "title": DRAFT_SECTION_TITLES["final_integrated_review"],
        "paragraphs": paragraphs,
        "items": [],
        "content": "\n\n".join(paragraph.get("text") or "" for paragraph in paragraphs),
        "source_titles": collect_source_titles_from_paragraphs(paragraphs),
        "copy_ready": True,
        "ai_generated": True,
        "fallback_used": False,
    }


def populate_structured_review_sections(
    drafts: dict[str, Any],
    bundles: list[dict[str, Any]],
) -> None:
    for key in [
        "research_background",
        "research_status",
        "core_innovations",
        "method_compare",
        "result_analysis",
        "limitations_future",
    ]:
        paragraphs = build_review_section_paragraphs(bundles, key)
        if not paragraphs:
            paragraphs = [paragraph for bundle in bundles if (paragraph := build_section_paragraph(bundle, key))]
        paragraphs = ensure_section_paragraph_depth(paragraphs, bundles, key, target_count=3)
        drafts[key]["paragraphs"] = paragraphs
        drafts[key]["copy_ready"] = bool(paragraphs)
        drafts[key]["content"] = "\n\n".join(item.get("text") or "" for item in paragraphs)
        drafts[key]["source_titles"] = collect_source_titles_from_paragraphs(paragraphs)
        drafts[key]["ai_generated"] = False


def filter_source_map_by_titles(
    source_map: dict[int, dict[str, Any]],
    paper_title_by_id: dict[int, str],
    allowed_titles: set[str],
) -> dict[int, dict[str, Any]]:
    if not allowed_titles:
        return {}
    return {
        paper_id: payload
        for paper_id, payload in source_map.items()
        if paper_title_by_id.get(paper_id) in allowed_titles
    }


def build_topic_diagnostic_section(
    cohesion: dict[str, Any],
    bundles: list[dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    group_lines = [
        f"{group['label']}：{'、'.join(group['paper_titles'][:4])}"
        for group in cohesion["groups"][:4]
    ]
    guidance = "\n".join(group_lines)
    return {
        "key": "topic_diagnostic",
        "title": "主题一致性诊断",
        "paragraphs": [
            paragraph_item(
                cohesion["message"],
                [],
                "weak",
            ),
            paragraph_item(
                f"建议按以下子主题分别整理小综述：{guidance}",
                [],
                "weak",
            ),
        ],
        "items": [],
        "content": f"{cohesion['message']}\n\n建议按以下子主题分别整理小综述：\n{guidance}",
        "source_titles": [bundle["paper_title"] for bundle in bundles[:8] if bundle.get("paper_title")],
        "copy_ready": True,
        "ai_generated": False,
        "fallback_used": False,
        "diagnostic": True,
    }, guidance


def build_structured_drafts_for_bundles(
    db: Session,
    run: ResearchMatrixRun,
    bundles: list[dict[str, Any]],
    source_map: dict[int, dict[str, Any]],
    paper_title_by_id: dict[int, str],
    *,
    allow_ai_integrated_review: bool = True,
    grouping_mode: str = "topic_first",
) -> tuple[dict[str, Any], dict[str, Any]]:
    drafts: dict[str, Any] = {}
    for key in DRAFT_SECTION_ORDER:
        drafts[key] = empty_draft_section(key)

    cohesion = analyze_bundle_cohesion(bundles, grouping_mode=grouping_mode)
    populate_structured_review_sections(drafts, bundles)

    if not cohesion["is_cohesive"]:
        drafts["topic_diagnostic"], guidance = build_topic_diagnostic_section(cohesion, bundles)
        drafts["review_outline"] = build_review_outline(drafts, cohesion, grouping_mode=grouping_mode)
        drafts["evidence_priority_queue"] = {
            "key": "evidence_priority_queue",
            "title": "Priority Revisit Queue",
            "paragraphs": [],
            "items": [],
            "content": "Current batch is better handled as grouped mini-reviews first.",
            "source_titles": [],
            "copy_ready": False,
            "ai_generated": False,
            "fallback_used": False,
        }
        drafts["final_integrated_review"] = {
            "key": "final_integrated_review",
            "title": DRAFT_SECTION_TITLES["final_integrated_review"],
            "paragraphs": [
                paragraph_item(
                    "当前批次论文缺少足够稳定的共同主题，不建议直接合成为单一综述正文。更合理的做法是先按子主题拆分，再分别生成小综述。",
                    [],
                    "weak",
                )
            ],
            "items": [],
            "content": f"当前批次论文缺少足够稳定的共同主题，不建议直接合成为单一综述正文。\n\n建议拆分主题：\n{guidance}",
            "source_titles": [bundle["paper_title"] for bundle in bundles[:8] if bundle.get("paper_title")],
            "copy_ready": True,
            "ai_generated": False,
            "fallback_used": False,
            "diagnostic": True,
        }
        return drafts, cohesion

    drafts["evidence_priority_queue"] = build_evidence_priority_queue(bundles, drafts)
    quotable_items = collect_quotable_items(source_map, paper_title_by_id)
    drafts["quotable_sentences"]["items"] = quotable_items
    drafts["quotable_sentences"]["copy_ready"] = bool(quotable_items)
    drafts["quotable_sentences"]["content"] = "\n".join(
        f"{item['paper_title']} p.{item['page']}：{item['quote']}"
        for item in quotable_items
    )
    drafts["quotable_sentences"]["source_titles"] = [item["paper_title"] for item in quotable_items[:8] if item.get("paper_title")]
    drafts["quotable_sentences"]["ai_generated"] = False
    drafts["review_outline"] = build_review_outline(drafts, cohesion, grouping_mode=grouping_mode)
    drafts["final_integrated_review"] = build_ai_integrated_review(db, run, drafts) if allow_ai_integrated_review else fallback_integrated_review(drafts)
    return drafts, cohesion


def build_structured_drafts_from_sources(
    db: Session,
    run: ResearchMatrixRun,
    source_map: dict[int, dict[str, Any]],
    *,
    allow_ai_integrated_review: bool = True,
    grouping_mode: str | None = None,
) -> dict[str, Any]:
    paper_title_by_id = {item.paper_id: item.title_snapshot for item in run.papers if item.paper_id}
    selected_grouping_mode = str(grouping_mode or (run.config_json or {}).get("grouping_mode") or "topic_first")
    bundles = [
        build_paper_draft_bundle(run_paper, source_map.get(run_paper.paper_id, {}))
        for run_paper in run.papers
        if run_paper.paper_id
    ]
    drafts, cohesion = build_structured_drafts_for_bundles(
        db,
        run,
        bundles,
        source_map,
        paper_title_by_id,
        allow_ai_integrated_review=allow_ai_integrated_review,
        grouping_mode=selected_grouping_mode,
    )
    if not cohesion["is_cohesive"]:
        grouped_outlines: list[dict[str, Any]] = []
        for index, group in enumerate(cohesion["groups"], start=1):
            group_titles = set(group.get("paper_titles") or [])
            if not group_titles:
                continue
            group_bundles = [bundle for bundle in bundles if bundle.get("paper_title") in group_titles]
            if not group_bundles:
                continue
            group_source_map = filter_source_map_by_titles(source_map, paper_title_by_id, group_titles)
            group_drafts, group_cohesion = build_structured_drafts_for_bundles(
                db,
                run,
                group_bundles,
                group_source_map,
                paper_title_by_id,
                allow_ai_integrated_review=False,
                grouping_mode=selected_grouping_mode,
            )
            group_outline = dict(group_drafts.get("review_outline") or {})
            grouped_outlines.append(
                {
                    "group_id": f"group_{index}",
                    "label": group.get("label") or f"主题 {index}",
                    "paper_titles": list(group.get("paper_titles") or []),
                    "section_count": len(list(group_outline.get("outline_sections") or [])),
                    "sections": list(group_outline.get("outline_sections") or []),
                    "review_outline": group_outline,
                    "drafts": {
                        key: value
                        for key, value in group_drafts.items()
                        if key in DRAFT_SECTION_ORDER or key == "topic_diagnostic"
                    },
                    "diagnostic": not group_cohesion.get("is_cohesive", True),
                }
            )
        review_outline = dict(drafts.get("review_outline") or {})
        review_outline["grouped_outlines"] = grouped_outlines
        drafts["review_outline"] = review_outline
    return drafts


def apply_pending_messages_to_drafts(
    run: ResearchMatrixRun,
    drafts: dict[str, Any],
    source_map: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    pending_message = build_draft_pending_message(run, source_map)
    pending_titles: list[str] = []
    seen_titles: set[str] = set()
    for run_paper in run.papers:
        if not run_paper.paper_id:
            continue
        states = source_map.get(run_paper.paper_id) or {}
        is_ready = all(
            (states.get(summary_type) or {}).get("status") == "generated"
            for summary_type in DRAFT_REQUIRED_SUMMARY_TYPES
        )
        if is_ready:
            continue
        title = str(run_paper.title_snapshot or "").strip()
        if not title or title in seen_titles:
            continue
        seen_titles.add(title)
        pending_titles.append(title)

    for key in DRAFT_SECTION_ORDER[:6]:
        section = drafts.get(key) or empty_draft_section(key)
        if section.get("paragraphs"):
            section["fallback_used"] = False
            drafts[key] = section
            continue
        drafts[key] = mark_draft_section_pending(section, pending_message, source_titles=pending_titles[:4])

    quotable = drafts.get("quotable_sentences") or empty_draft_section("quotable_sentences")
    if not (quotable.get("items") or []):
        drafts["quotable_sentences"] = mark_draft_section_pending(
            quotable,
            "当前可直接引用句仍在整理中，待来源卡片补齐后会自动补充页码与引用语句。",
            source_titles=pending_titles[:4],
        )

    final_section = drafts.get("final_integrated_review") or empty_draft_section("final_integrated_review")
    if not (final_section.get("paragraphs") or []):
        fallback_content = final_section.get("content") or pending_message
        drafts["final_integrated_review"] = mark_draft_section_pending(
            final_section,
            fallback_content,
            source_titles=pending_titles[:4],
        )

    return drafts


def build_mode_variant_snapshot(
    variants: dict[str, dict[str, Any]],
    *,
    preferred_mode: str,
) -> dict[str, Any]:
    available_modes = [mode for mode in GROUPING_MODES if isinstance(variants.get(mode), dict)]
    active_mode = preferred_mode if preferred_mode in available_modes else (available_modes[0] if available_modes else "topic_first")
    return {
        "active_mode": active_mode,
        "available_modes": available_modes,
        "modes": variants,
    }


def unpack_mode_variant_snapshot(
    snapshot: dict[str, Any] | None,
    *,
    preferred_mode: str,
) -> tuple[dict[str, dict[str, Any]], list[str], str]:
    if isinstance(snapshot, dict) and isinstance(snapshot.get("modes"), dict):
        raw_variants = snapshot.get("modes") or {}
        variants = {
            mode: payload
            for mode, payload in raw_variants.items()
            if isinstance(payload, dict)
        }
        available_modes = [mode for mode in GROUPING_MODES if mode in variants]
        active_mode = str(snapshot.get("active_mode") or preferred_mode or "topic_first")
        if active_mode not in available_modes and available_modes:
            active_mode = available_modes[0]
        return variants, available_modes, active_mode

    legacy_payload = snapshot if isinstance(snapshot, dict) else {}
    mode = str(preferred_mode or "topic_first")
    return ({mode: legacy_payload} if legacy_payload else {}), ([mode] if legacy_payload else []), mode


def build_run_drafts_payload(
    db: Session,
    run: ResearchMatrixRun,
    *,
    allow_ai_integrated_review: bool = True,
) -> tuple[dict[str, Any], dict[str, Any], list[tuple[int, str]]]:
    source_map, counters = build_draft_source_map(db, run)
    missing = collect_missing_draft_sources(source_map)
    progress_meta = draft_progress_from_counters(counters)
    total_count = progress_meta["total_count"]
    ready_count = progress_meta["ready_count"]
    failed_count = progress_meta["failed_count"]
    running_count = progress_meta["running_count"]
    progress = progress_meta["progress"]
    preferred_mode = str((run.config_json or {}).get("grouping_mode") or "topic_first")

    if missing:
        message = build_draft_pending_message(run, source_map)
        variants = {
            mode: apply_pending_messages_to_drafts(
                run,
                build_structured_drafts_from_sources(
                    db,
                    run,
                    source_map,
                    allow_ai_integrated_review=allow_ai_integrated_review,
                    grouping_mode=mode,
                ),
                source_map,
            )
            for mode in GROUPING_MODES
        }
        payload = build_mode_variant_snapshot(variants, preferred_mode=preferred_mode)
        status = "failed" if failed_count else ("running" if running_count or ready_count or run.status in {"queued", "running"} else "idle")
        stage = "generating_sources" if running_count or ready_count or run.status in {"queued", "running"} else "preparing_sources"
        state = draft_status_payload(
            status=status,
            stage=stage,
            progress=progress,
            ready_count=ready_count,
            total_count=total_count,
            failed_count=failed_count,
            error_message=message if status == "failed" else None,
        )
        return payload, state, missing

    variants = {
        mode: build_structured_drafts_from_sources(
            db,
            run,
            source_map,
            allow_ai_integrated_review=allow_ai_integrated_review,
            grouping_mode=mode,
        )
        for mode in GROUPING_MODES
    }
    drafts = build_mode_variant_snapshot(variants, preferred_mode=preferred_mode)
    state = draft_status_payload(
        status="completed",
        stage="completed",
        progress=100,
        ready_count=ready_count,
        total_count=total_count,
        failed_count=failed_count,
        error_message=None,
    )
    return drafts, state, []


def sync_run_draft_snapshot(db: Session, run: ResearchMatrixRun) -> None:
    drafts_payload, draft_state, _missing = build_run_drafts_payload(db, run)
    apply_draft_payload_to_run(run, drafts_payload, draft_state)
    db.add(run)
    db.commit()
    db.refresh(run)


def sync_run_matrix_snapshot(db: Session, run: ResearchMatrixRun, user_id: int) -> None:
    matrix = {
        "fields": [{"key": key, "label": label} for key, label in MATRIX_FIELDS],
        "rows": [
            {
                **dict(run_paper.row_snapshot or {}),
                "review_role": compact_text(run_paper.review_role or "", 180),
                "batch_note": compact_text(run_paper.batch_note or "", 260),
            }
            for run_paper in sorted(run.papers, key=lambda item: item.sort_order)
        ],
        "missing": [
            {"paper_id": item.paper_id, "title": item.title_snapshot}
            for item in run.papers if item.is_missing
        ],
        "stale": [
            {"paper_id": item.paper_id, "title": item.title_snapshot}
            for item in run.papers if item.is_stale
        ],
        "ready_count": sum(1 for item in run.papers if item.summary_status == "generated" and not item.is_missing),
        "paper_count": len(run.papers),
    }
    run.matrix_snapshot = matrix


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
    return "未命名批次"


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
    if not total:
        run.progress_percent = 0
        return
    if run.status == "completed" and ready >= total:
        run.progress_percent = 100
        return
    review_progress = round((ready / total) * 80)
    if ready >= total and (run.stage or "") == "building_matrix":
        run.progress_percent = 90
        return
    # Keep some headroom for final matrix assembly so the user can see that
    # "review cards are ready" and "matrix is ready" are two different stages.
    run.progress_percent = min(89, review_progress)


def draft_sources_ready(
    db: Session,
    paper: Paper,
    summaries: dict[tuple[int, str], PaperSummary],
) -> bool:
    for summary_type in DRAFT_REQUIRED_SUMMARY_TYPES:
        item = summaries.get((paper.id, summary_type))
        if not item or item.status != "generated" or is_summary_stale(db, paper, item):
            return False
    return True


def prepare_missing_run_draft_sources(
    db: Session,
    run: ResearchMatrixRun,
    *,
    provider_id: int | None = None,
    summary_types: tuple[str, ...] = ("overview", "reproduction"),
) -> list[int]:
    summary_type_set = set(summary_types)
    if not summary_type_set:
        return []

    paper_ids = [item.paper_id for item in run.papers if item.paper_id]
    if not paper_ids:
        return []
    papers = {
        paper.id: paper
        for paper in get_owned_papers(db, run.user_id, paper_ids)
    }
    summaries = get_summaries_by_paper(db, run.user_id, paper_ids)
    queued_summary_ids: list[int] = []

    for run_paper in run.papers:
        if not run_paper.paper_id:
            continue
        paper = papers.get(run_paper.paper_id)
        if not paper:
            continue
        for summary_type in DRAFT_REQUIRED_SUMMARY_TYPES:
            if summary_type not in summary_type_set:
                continue
            summary = normalize_summary_terminal_state(
                db,
                summaries.get((run_paper.paper_id, summary_type)),
            )
            if summary and summary.status == "running":
                continue
            if summary and summary.status == "generated" and not is_summary_stale(db, paper, summary):
                continue
            if not summary:
                summary = PaperSummary(
                    paper_id=paper.id,
                    user_id=run.user_id,
                    summary_type=summary_type,
                    content_json={},
                )
            summary.status = "running"
            summary.stage = "extracting_context"
            summary.progress = 3
            summary.provider_id = provider_id
            summary.error_message = None
            db.add(summary)
            db.flush()
            queued_summary_ids.append(int(summary.id))
    if queued_summary_ids:
        db.commit()
        db.refresh(run)
        source_map, counters = build_draft_source_map(db, run)
        progress_meta = draft_progress_from_counters(counters)
        set_run_draft_state(
            run,
            status="running",
            stage="generating_sources",
            progress=progress_meta["progress"],
            ready_count=progress_meta["ready_count"],
            total_count=progress_meta["total_count"],
            failed_count=progress_meta["failed_count"],
            error_message=None,
        )
        db.add(run)
        db.commit()
        db.refresh(run)
    return queued_summary_ids


def create_initial_run(
    db: Session,
    user_id: int,
    papers: list[Paper],
    *,
    title: str = "",
    include_reproduction: bool = True,
    config_json: dict[str, Any] | None = None,
    refreshed_from_id: int | None = None,
) -> ResearchMatrixRun:
    paper_ids = [paper.id for paper in papers]
    summaries = get_summaries_by_paper(db, user_id, paper_ids)
    all_review_ready = all(summary_ready(db, paper, summaries.get((paper.id, "review"))) for paper in papers)
    version = 1
    if refreshed_from_id:
        previous = db.get(ResearchMatrixRun, refreshed_from_id)
        if previous and previous.user_id == user_id:
            version = max(1, int(previous.version or 1) + 1)
    next_config = {"include_reproduction": include_reproduction, **dict(config_json or {})}
    run = ResearchMatrixRun(
        user_id=user_id,
        title=title.strip() or default_run_title(papers),
        status="queued",
        stage="queued",
        paper_count=len(papers),
        total_count=len(papers),
        ready_count=0,
        failed_count=0,
        progress_percent=0,
        matrix_snapshot={},
        drafts_snapshot={},
        dashboard_snapshot={},
        config_json=next_config,
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
    sync_run_matrix_snapshot(db, run, user_id)
    if all_review_ready:
        run.status = "queued"
        run.stage = "building_matrix"
        run.error_message = None
        update_run_progress(run)
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


def ensure_summary_ready_for_run(
    db: Session,
    *,
    run: ResearchMatrixRun,
    run_paper: ResearchMatrixRunPaper,
    paper: Paper,
    summary_type: str,
    provider_id: int | None,
) -> PaperSummary | None:
    summary = db.scalar(
        select(PaperSummary).where(
            PaperSummary.paper_id == paper.id,
            PaperSummary.user_id == run.user_id,
            PaperSummary.summary_type == summary_type,
        )
    )
    summary = normalize_summary_terminal_state(db, summary)

    if summary and summary.status == "running":
        wait_for_summary_to_finish(summary.id)
        db.expire_all()
        refreshed_run = load_run_with_papers(db, run.id)
        if not refreshed_run:
            return None
        summary = db.scalar(
            select(PaperSummary).where(
                PaperSummary.paper_id == paper.id,
                PaperSummary.user_id == run.user_id,
                PaperSummary.summary_type == summary_type,
            )
        )
        summary = normalize_summary_terminal_state(db, summary)

    if summary and summary.status == "generated" and not is_summary_stale(db, paper, summary):
        return summary

    if not summary:
        summary = PaperSummary(
            paper_id=paper.id,
            user_id=run.user_id,
            summary_type=summary_type,
            content_json={},
        )
    summary.status = "running"
    summary.stage = "extracting_context"
    summary.progress = 3
    summary.provider_id = provider_id
    summary.error_message = None
    db.add(summary)
    db.commit()
    db.refresh(summary)

    run.status = "running"
    run.stage = "generating_reviews" if summary_type == "review" else "building_matrix"
    if summary_type == "review":
        run_paper.summary_status = "running"
        run_paper.is_missing = True
        run_paper.row_snapshot = build_empty_row(
            paper,
            paper.folder.name if paper.folder else "未分类",
            review_role=run_paper.review_role or "",
            batch_note=run_paper.batch_note or "",
        )
        update_run_progress(run)
    draft_counters = draft_progress_from_counters(build_draft_source_map(db, run)[1])
    set_run_draft_state(
        run,
        status="running",
        stage="generating_sources",
        progress=draft_counters["progress"],
        ready_count=draft_counters["ready_count"],
        total_count=draft_counters["total_count"],
        failed_count=draft_counters["failed_count"],
        error_message=None,
    )
    db.commit()

    run_paper_summary_task(summary.id, provider_id)
    db.expire_all()
    return db.scalar(
        select(PaperSummary).where(
            PaperSummary.paper_id == paper.id,
            PaperSummary.user_id == run.user_id,
            PaperSummary.summary_type == summary_type,
        )
    )


def run_matrix_run_task(run_id: int, provider_id: int | None = None) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        run = load_run_with_papers(db, run_id)
        if not run:
            return
        mark_run_worker_started(db, run)
        run.status = "running"
        run.stage = "preparing_reviews"
        run.error_message = None
        update_run_progress(run)
        db.commit()

        required_summary_types = ("review", "overview", "reproduction")
        for run_paper in run.papers:
            heartbeat_run_worker(db, run)
            run = load_run_with_papers(db, run_id)
            if not run:
                return
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

            summaries_by_type: dict[str, PaperSummary | None] = {}
            for summary_type in required_summary_types:
                summary = ensure_summary_ready_for_run(
                    db,
                    run=run,
                    run_paper=run_paper,
                    paper=paper,
                    summary_type=summary_type,
                    provider_id=provider_id,
                )
                if not summary:
                    return
                summaries_by_type[summary_type] = summary
            db.expire_all()
            run = load_run_with_papers(db, run_id)
            if not run:
                return
            run_paper = next(item for item in run.papers if item.paper_id == paper.id)
            review = summaries_by_type.get("review")

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
        source_map, _counters = build_draft_source_map(db, run)
        draft_missing = collect_missing_draft_sources(source_map)
        if all(item.summary_status == "generated" and not item.is_missing for item in run.papers) and not draft_missing:
            run.stage = "building_matrix"
            run.error_message = None
            db.commit()
            sync_run_matrix_snapshot(db, run, run.user_id)
            run = load_run_with_papers(db, run_id)
            if not run:
                return
            run.drafts_snapshot = {}
            run.status = "completed"
            run.stage = "completed"
            run.error_message = None
            update_run_progress(run)
            run.progress_percent = 100 if run.total_count else 0
            db.add(run)
            db.commit()
            run = load_run_with_papers(db, run_id)
            if run:
                sync_run_insights_snapshot(db, run)
                run = load_run_with_papers(db, run_id)
            if run:
                mark_run_worker_finished(db, run)
                create_notification(
                    db,
                    user_id=run.user_id,
                    source_kind="research_matrix",
                    source_id=int(run.id),
                    event_kind="completed",
                    title=f"{compact_notification_text(run.title or '文献矩阵', 80)} 已完成",
                    message=compact_notification_text(run.title or "当前矩阵批次", 120),
                    action_kind="open-matrix",
                    action_payload={"run_id": run.id},
                )
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
        create_notification(
            db,
            user_id=run.user_id,
            source_kind="research_matrix",
            source_id=int(run.id),
            event_kind="failed",
            title=f"{compact_notification_text(run.title or '文献矩阵', 80)} 失败",
            message=compact_notification_text(run.error_message or "批次生成失败", 120),
            action_kind="open-matrix",
            action_payload={"run_id": run.id},
        )
        mark_run_worker_failed(db, run, run.error_message or "批次生成失败")
    except Exception as exc:
        run = load_run_with_papers(db, run_id)
        if run:
            mark_run_worker_failed(db, run, f"批次生成异常：{exc}")
        raise
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
    drafts_payload, draft_state, _missing = build_run_drafts_payload(db, run)
    apply_draft_payload_to_run(run, drafts_payload, draft_state)
    run.status = "completed"
    run.stage = "completed"
    run.error_message = None
    update_run_progress(run)
    run.progress_percent = 100 if run.total_count else 0
    db.add(run)
    db.commit()
    db.refresh(run)


def refresh_run_dashboard_snapshot(db: Session, run: ResearchMatrixRun, user_id: int) -> None:
    matrix = run.matrix_snapshot or {}
    rows = list(matrix.get("rows") or [])
    missing = list(matrix.get("missing") or [])
    stale = list(matrix.get("stale") or [])
    run.dashboard_snapshot = build_dashboard_snapshot(db, user_id, rows, missing, stale)
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
    grouping_mode: str = "topic_first",
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
        config_json={"grouping_mode": grouping_mode},
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


def rename_matrix_run(db: Session, run: ResearchMatrixRun, *, title: str) -> ResearchMatrixRun:
    next_title = (title or "").strip()[:160]
    run.title = next_title or "未命名批次"
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def update_matrix_run_grouping_mode(
    db: Session,
    run: ResearchMatrixRun,
    *,
    user_id: int,
    grouping_mode: str,
) -> ResearchMatrixRun:
    if run.status != "completed":
        raise ValueError("run_not_completed")
    next_mode = str(grouping_mode or "topic_first")
    config = dict(run.config_json or {})
    current_mode = str(config.get("grouping_mode") or "topic_first")
    if current_mode == next_mode:
        refreshed = load_run_with_papers(db, run.id)
        if not refreshed:
            raise ValueError("run_missing")
        return refreshed
    config["grouping_mode"] = next_mode
    run.config_json = config
    db.add(run)
    db.commit()
    refreshed = load_run_with_papers(db, run.id)
    if not refreshed:
        raise ValueError("run_missing")
    rebuild_run_snapshots(db, refreshed, user_id)
    rebuilt = load_run_with_papers(db, run.id)
    if not rebuilt:
        raise ValueError("run_missing")
    return rebuilt


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
        paper = db.scalar(
            select(Paper).where(
                Paper.id == paper_id,
                Paper.user_id == user_id,
                Paper.deleted_at.is_(None),
            )
        )
        if not paper:
            raise ValueError("paper_source_deleted")
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
    if refreshed:
        mark_run_insights_stale(db, refreshed)
        refreshed = load_run_with_papers(db, run.id)
    if not refreshed:
        raise ValueError("run_missing")
    return refreshed


def update_matrix_run_outline(
    db: Session,
    run: ResearchMatrixRun,
    *,
    outline_sections: list[dict[str, Any]] | None = None,
) -> ResearchMatrixRun:
    if run.status != "completed":
        raise ValueError("run_not_completed")
    if outline_sections is None:
        raise ValueError("outline_missing")

    drafts_snapshot = dict(run.drafts_snapshot or {})
    variants, available_modes, active_mode = unpack_mode_variant_snapshot(
        drafts_snapshot,
        preferred_mode=str((run.config_json or {}).get("grouping_mode") or "topic_first"),
    )
    target_mode = str((run.config_json or {}).get("grouping_mode") or active_mode or "topic_first")
    selected = dict(variants.get(target_mode) or drafts_snapshot or {})
    outline = dict(selected.get("review_outline") or {})
    outline["outline_sections"] = list(outline_sections or [])
    selected["review_outline"] = outline
    variants[target_mode] = selected
    run.drafts_snapshot = {
        "active_mode": target_mode,
        "modes": variants,
    }
    db.add(run)
    db.commit()
    refreshed = load_run_with_papers(db, run.id)
    if not refreshed:
        raise ValueError("run_missing")
    return refreshed


def rewrite_matrix_run_draft_section(
    db: Session,
    run: ResearchMatrixRun,
    *,
    section_key: str,
) -> ResearchMatrixRun:
    if run.status != "completed":
        raise ValueError("run_not_completed")
    target_section = str(section_key or "").strip()
    if target_section not in DRAFT_SECTION_ORDER:
        raise ValueError("draft_section_invalid")

    source_map, _counters = build_draft_source_map(db, run)
    missing = collect_missing_draft_sources(source_map)
    if missing:
        raise ValueError("draft_sources_missing")

    preferred_mode = str((run.config_json or {}).get("grouping_mode") or "topic_first")
    variants, _available_modes, active_mode = unpack_mode_variant_snapshot(
        run.drafts_snapshot or {},
        preferred_mode=preferred_mode,
    )
    target_mode = preferred_mode or active_mode or "topic_first"
    regenerated = build_structured_drafts_from_sources(
        db,
        run,
        source_map,
        allow_ai_integrated_review=True,
        grouping_mode=target_mode,
    )
    if target_section not in regenerated:
        raise ValueError("draft_section_missing")

    selected = dict(variants.get(target_mode) or {})
    selected[target_section] = regenerated[target_section]
    if regenerated.get("quotable_sentences"):
        selected["quotable_sentences"] = regenerated["quotable_sentences"]
    if target_section in DRAFT_SECTION_ORDER[:6] or target_section in {"quotable_sentences", "final_integrated_review"}:
        if regenerated.get("final_integrated_review"):
            selected["final_integrated_review"] = regenerated["final_integrated_review"]
    variants[target_mode] = selected
    run.drafts_snapshot = build_mode_variant_snapshot(variants, preferred_mode=target_mode)
    db.add(run)
    db.commit()
    refreshed = load_run_with_papers(db, run.id)
    if not refreshed:
        raise ValueError("run_missing")
    return refreshed


DELETED_SOURCE_PAPER_MESSAGE = "该批次关联的原论文已删除，请重新导入后新建批次。"


def inspect_run_source_state(db: Session, run: ResearchMatrixRun, user_id: int) -> dict[str, Any]:
    paper_ids = [item.paper_id for item in run.papers if item.paper_id]
    if not paper_ids:
        return {
            "has_deleted_papers": False,
            "deleted_paper_count": 0,
            "deleted_paper_message": None,
            "has_updates": False,
        }

    papers = {paper.id: paper for paper in get_owned_papers(db, user_id, paper_ids)}
    deleted_items = [item for item in run.papers if item.paper_id and item.paper_id not in papers]
    has_deleted_papers = bool(deleted_items)
    deleted_paper_message = DELETED_SOURCE_PAPER_MESSAGE if has_deleted_papers else None

    if run.status in {"queued", "running"} or has_deleted_papers:
        return {
            "has_deleted_papers": has_deleted_papers,
            "deleted_paper_count": len(deleted_items),
            "deleted_paper_message": deleted_paper_message,
            "has_updates": False,
        }

    summaries = get_summaries_by_paper(db, user_id, paper_ids)
    has_updates = False
    for item in run.papers:
        if not item.paper_id:
            continue
        paper = papers.get(item.paper_id)
        if not paper:
            continue
        current = summaries.get((item.paper_id, "review"))
        if not current:
            if not item.is_missing:
                has_updates = True
                break
            continue
        if current.status != item.summary_status:
            has_updates = True
            break
        if (iso(current.updated_at) or "") != (item.summary_updated_at or ""):
            has_updates = True
            break
        if is_summary_stale(db, paper, current) != bool(item.is_stale):
            has_updates = True
            break

    return {
        "has_deleted_papers": False,
        "deleted_paper_count": 0,
        "deleted_paper_message": None,
        "has_updates": has_updates,
    }


def build_run_source_state_map(
    db: Session,
    runs: list[ResearchMatrixRun],
    user_id: int,
) -> dict[int, dict[str, Any]]:
    if not runs:
        return {}

    all_paper_ids: list[int] = []
    seen_paper_ids: set[int] = set()
    for run in runs:
        for item in run.papers:
            if not item.paper_id or item.paper_id in seen_paper_ids:
                continue
            seen_paper_ids.add(item.paper_id)
            all_paper_ids.append(item.paper_id)

    papers = {paper.id: paper for paper in get_owned_papers(db, user_id, all_paper_ids)}
    summaries = get_summaries_by_paper(db, user_id, all_paper_ids)
    states: dict[int, dict[str, Any]] = {}

    for run in runs:
        paper_ids = [item.paper_id for item in run.papers if item.paper_id]
        if not paper_ids:
            states[run.id] = {
                "has_deleted_papers": False,
                "deleted_paper_count": 0,
                "deleted_paper_message": None,
                "has_updates": False,
            }
            continue

        deleted_items = [item for item in run.papers if item.paper_id and item.paper_id not in papers]
        has_deleted_papers = bool(deleted_items)
        deleted_paper_message = DELETED_SOURCE_PAPER_MESSAGE if has_deleted_papers else None

        if run.status in {"queued", "running"} or has_deleted_papers:
            states[run.id] = {
                "has_deleted_papers": has_deleted_papers,
                "deleted_paper_count": len(deleted_items),
                "deleted_paper_message": deleted_paper_message,
                "has_updates": False,
            }
            continue

        has_updates = False
        for item in run.papers:
            if not item.paper_id:
                continue
            paper = papers.get(item.paper_id)
            if not paper:
                continue
            current = summaries.get((item.paper_id, "review"))
            if not current:
                if not item.is_missing:
                    has_updates = True
                    break
                continue
            if current.status != item.summary_status:
                has_updates = True
                break
            if (iso(current.updated_at) or "") != (item.summary_updated_at or ""):
                has_updates = True
                break
            if is_summary_stale(db, paper, current) != bool(item.is_stale):
                has_updates = True
                break

        states[run.id] = {
            "has_deleted_papers": False,
            "deleted_paper_count": 0,
            "deleted_paper_message": None,
            "has_updates": has_updates,
        }

    return states


def serialize_run_list_item(
    db: Session,
    run: ResearchMatrixRun,
    user_id: int,
    source_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    run = normalize_run_runtime_state(db, run)
    missing_count = sum(1 for item in run.papers if item.is_missing)
    stale_count = sum(1 for item in run.papers if item.is_stale)
    source_state = source_state or inspect_run_source_state(db, run, user_id)
    draft_state = serialize_draft_state(run)
    preferred_mode = str((run.config_json or {}).get("grouping_mode") or "topic_first")
    _variants, available_modes, _active_mode = unpack_mode_variant_snapshot(run.drafts_snapshot or {}, preferred_mode=preferred_mode)
    return {
        "id": run.id,
        "title": run.title,
        "status": run.status,
        "stage": run.stage or "idle",
        "stage_label": RUN_STAGE_LABELS.get(run.stage or "idle", run.stage or "idle"),
        "paper_count": run.paper_count,
        "version": run.version,
        "refreshed_from_id": run.refreshed_from_id,
        "has_updates": source_state["has_updates"],
        "has_deleted_papers": source_state["has_deleted_papers"],
        "deleted_paper_count": source_state["deleted_paper_count"],
        "deleted_paper_message": source_state["deleted_paper_message"],
        "missing_count": missing_count,
        "stale_count": stale_count,
        "progress_percent": int(run.progress_percent or 0),
        "ready_count": int(run.ready_count or 0),
        "total_count": int(run.total_count or run.paper_count or 0),
        "failed_count": int(run.failed_count or 0),
        "error_message": run.error_message,
        "created_at": iso(run.created_at),
        "updated_at": iso(run.updated_at),
        "grouping_mode": preferred_mode,
        "grouping_modes": available_modes or [preferred_mode],
        "worker_status": run.worker_status or "idle",
        "worker_started_at": iso(run.worker_started_at),
        "worker_heartbeat_at": iso(run.worker_heartbeat_at),
        "worker_retry_count": int(run.worker_retry_count or 0),
        "last_worker_error": run.last_worker_error,
        **draft_state,
        **serialize_insight_state(run),
    }


def run_needs_draft_snapshot_self_heal(run: ResearchMatrixRun, *, preferred_mode: str) -> bool:
    if run.status != "completed":
        return False
    draft_state = serialize_draft_state(run)
    if int(draft_state.get("draft_progress_percent", 0) or 0) < 100:
        return False
    variants, _available_modes, active_mode = unpack_mode_variant_snapshot(
        run.drafts_snapshot or {},
        preferred_mode=preferred_mode,
    )
    selected_drafts = variants.get(preferred_mode) or variants.get(active_mode) or (
        run.drafts_snapshot if isinstance(run.drafts_snapshot, dict) else {}
    )
    if not isinstance(selected_drafts, dict) or not selected_drafts:
        return True
    outline = selected_drafts.get("review_outline")
    if not isinstance(outline, dict):
        return True
    has_outline_content = bool(outline.get("outline_sections")) or bool(outline.get("content")) or bool(outline.get("topic_groups"))
    if not has_outline_content:
        return True
    integrated = selected_drafts.get("final_integrated_review")
    if not isinstance(integrated, dict):
        return True
    has_integrated_content = bool(integrated.get("paragraphs")) or bool(integrated.get("content")) or bool(integrated.get("copy_ready"))
    return not has_integrated_content


def serialize_run_detail(db: Session, run: ResearchMatrixRun, user_id: int) -> dict[str, Any]:
    run = normalize_run_runtime_state(db, run)
    preferred_mode = str((run.config_json or {}).get("grouping_mode") or "topic_first")
    if run_needs_draft_snapshot_self_heal(run, preferred_mode=preferred_mode):
        sync_run_draft_snapshot(db, run)
        refreshed = load_run_with_papers(db, run.id)
        run = refreshed or run
    base = serialize_run_list_item(db, run, user_id)
    draft_state = serialize_draft_state(run)
    drafts_snapshot = run.drafts_snapshot or {}
    variants, available_modes, active_mode = unpack_mode_variant_snapshot(
        drafts_snapshot,
        preferred_mode=base["grouping_mode"],
    )
    selected_drafts = variants.get(base["grouping_mode"]) or variants.get(active_mode) or drafts_snapshot
    dashboard_snapshot = run.dashboard_snapshot or {}
    if not dashboard_snapshot and run.status == "completed":
        dashboard_snapshot = build_dashboard_snapshot(
            db,
            user_id,
            list((run.matrix_snapshot or {}).get("rows") or []),
            list((run.matrix_snapshot or {}).get("missing") or []),
            list((run.matrix_snapshot or {}).get("stale") or []),
        )
        run.dashboard_snapshot = dashboard_snapshot
        db.add(run)
        db.commit()
        db.refresh(run)
    return {
        **base,
        **draft_state,
        "matrix": run.matrix_snapshot or {},
        "drafts": selected_drafts if isinstance(selected_drafts, dict) else {},
        "draft_variants": variants,
        "grouping_modes": available_modes or base.get("grouping_modes") or [base["grouping_mode"]],
        "dashboard": dashboard_snapshot,
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
        "refresh_available": base["has_updates"] and not base["has_deleted_papers"],
        **serialize_insight_state(run),
    }
