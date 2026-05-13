from __future__ import annotations

import json
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
from app.services.paper_summary import (
    REVIEW_STRUCTURED_FIELD_ORDER,
    apply_review_field_updates,
    build_summary_response_payload,
    call_text_completion,
    get_review_summary_content,
    is_summary_stale,
    load_available_provider,
    parse_json_object,
    parse_compound_list,
    run_paper_summary_task,
    summary_title,
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
    "quotable_sentences": "可直接引用句",
    "final_integrated_review": "综述终稿整合",
}


REVIEW_SECTION_HINTS = {
    "research_question": ("研究问题", "对象"),
    "core_metrics": ("关键变量", "指标"),
    "method_route": ("方法路线", "方法"),
    "data_sample": ("数据与样本", "样本", "数据"),
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


def citation_item(*, paper_title: str, source_card_type: str, page: int | None = None) -> dict[str, Any]:
    return {
        "paper_title": paper_title,
        "source_card_type": source_card_type,
        "page": page,
    }


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
        body = compact_text(section.get("body") or "", 520)
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
        return {"fields": {}, "sections": []}
    review = get_review_summary_content(content)
    return {
        "fields": dict(review.get("structured_fields") or {}),
        "sections": list(review.get("narrative_sections") or review.get("sections") or []),
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
        text = compact_text(item, 200)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result[:limit]


def join_sentences(parts: list[str], *, limit: int = 520) -> str:
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


def dedupe_citations(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        key = f"{item.get('paper_title')}::{item.get('source_card_type')}::{item.get('page') or ''}"
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
    fallback: bool = True,
) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for section in sections:
        page = first_page_from_evidence(list(section.get("evidence") or []))
        citations.append(citation_item(paper_title=paper_title, source_card_type=source_card_type, page=page))
    if not citations and fallback:
        citations.append(citation_item(paper_title=paper_title, source_card_type=source_card_type))
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
        "review_role": compact_text(run_paper.review_role or "", 180),
        "reproduction_sections": reproduction_sections,
        "reproduction_missing_items": extract_summary_missing_items(summary_bundle.get("reproduction")),
    }


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
        overview_text = join_sentences([section.get("body") or "" for section in background_sections], limit=360)
        research_question = compact_text(review_fields.get("research_question"), 220)
        if overview_text:
            parts.append(f"《{paper_title}》的研究背景与问题主线可概括为：{overview_text}")
            citations.extend(citations_from_sections(paper_title, "overview", background_sections))
        if research_question:
            parts.append(f"从综述卡片提炼的研究问题是：{research_question}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "research_question")))

    elif section_key == "research_status":
        status_sections = find_sections_by_hints(overview_sections, OVERVIEW_STATUS_HINTS, limit=2)
        findings = compact_text(review_fields.get("main_findings"), 240)
        review_role = compact_text(bundle.get("review_role"), 140)
        overview_text = join_sentences([section.get("body") or "" for section in status_sections], limit=360)
        if findings:
            parts.append(f"从当前批次的研究现状看，《{paper_title}》给出的主要结论是：{findings}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "main_findings")))
        if overview_text:
            parts.append(f"整篇总结补充的研究主线包括：{overview_text}")
            citations.extend(citations_from_sections(paper_title, "overview", status_sections))
        if review_role:
            parts.append(f"在本批综述写作中，这篇论文更适合作为“{review_role}”使用。")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "main_findings")))

    elif section_key == "core_innovations":
        innovations = normalize_text_list(review_fields.get("innovations"), limit=5)
        method_route = compact_text(review_fields.get("method_route"), 220)
        if innovations:
            parts.append(f"《{paper_title}》可直接提炼的创新点包括：{'；'.join(innovations[:3])}。")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "innovations")))
        if method_route:
            parts.append(f"这些创新主要落在以下方法路线：{method_route}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "method_route")))

    elif section_key == "method_compare":
        method_route = compact_text(review_fields.get("method_route"), 240)
        core_metrics = normalize_text_list(review_fields.get("core_metrics"), limit=5)
        if method_route:
            parts.append(f"《{paper_title}》采用的方法路线是：{method_route}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "method_route")))
        if core_metrics:
            parts.append(f"用于比较的方法抓手主要包括：{'；'.join(core_metrics[:4])}。")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "core_metrics")))

    elif section_key == "result_analysis":
        findings = compact_text(review_fields.get("main_findings"), 220)
        data_sample = compact_text(review_fields.get("data_sample"), 220)
        result_sections = find_sections_by_hints(reproduction_sections, REPRO_RESULT_HINTS, limit=2)
        reproduction_text = join_sentences([section.get("body") or "" for section in result_sections], limit=340)
        if findings:
            parts.append(f"从结果上看，《{paper_title}》的核心发现是：{findings}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "main_findings")))
        if data_sample:
            parts.append(f"它使用的数据与样本信息为：{data_sample}")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "data_sample")))
        if reproduction_text:
            parts.append(f"复现总结补充的实验、指标或参数硬信息包括：{reproduction_text}")
            citations.extend(citations_from_sections(paper_title, "reproduction", result_sections))

    elif section_key == "limitations_future":
        limitations = normalize_text_list(review_fields.get("limitations"), limit=5)
        limit_sections = find_sections_by_hints(reproduction_sections, REPRO_LIMIT_HINTS, limit=2)
        reproduction_text = join_sentences([section.get("body") or "" for section in limit_sections], limit=320)
        if limitations:
            parts.append(f"这篇论文当前可见的局限或风险包括：{'；'.join(limitations[:3])}。")
            citations.extend(citations_from_sections(paper_title, "review", review_sections_for_field(review_sections, "limitations")))
        if reproduction_text:
            parts.append(f"从复现视角看，仍需回查的信息或工程难点包括：{reproduction_text}")
            citations.extend(citations_from_sections(paper_title, "reproduction", limit_sections))
        if reproduction_missing_items:
            parts.append(f"复现总结明确标出的缺失信息有：{'；'.join(reproduction_missing_items[:4])}。")
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
                        "paper_title": paper_title,
                        "page": page,
                        "quote": quote,
                        "source_card_type": summary_type,
                        "usage_note": quote_usage_note(summary_type, heading),
                    })
                    if len(items) >= 16:
                        return items
    return items


def fallback_integrated_review(drafts: dict[str, Any]) -> dict[str, Any]:
    paragraphs: list[dict[str, Any]] = []
    for section_key in DRAFT_SECTION_ORDER[:6]:
        paragraphs.extend(list(drafts.get(section_key, {}).get("paragraphs") or []))
    paragraphs = paragraphs[:10]
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


def build_ai_integrated_review(db: Session, run: ResearchMatrixRun, drafts: dict[str, Any]) -> dict[str, Any]:
    fallback = fallback_integrated_review(drafts)
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

    quote_items = list((drafts.get("quotable_sentences") or {}).get("items") or [])[:6]
    prompt = f"""
你是一个严谨的中文学术综述助手。请把给定的分块草稿整合成一份可直接复制的“综述终稿整合”。

硬性规则：
1. 只能使用输入里已经出现的事实、判断和限定语，不能新增事实。
2. 每段都必须引用 source_refs，source_refs 只能引用输入里的段落 id。
3. 如果引用到任何 weak 段落，输出段落的 confidence 必须为 weak，且语气必须降调，明确保留不确定性。
4. 不要重复“见上文”“本节”等元话语，不要输出 Markdown。
5. 输出 4-8 段，优先组织成连续的单列综述正文。
6. 若输入证据不足，请照样整合，但不要把弱证据写成确定结论。
7. 输出必须是 JSON，不要代码块。

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
            max_tokens=2200,
        )
        payload = parse_json_object(raw)
    except Exception:
        return fallback

    source_by_id = {item["id"]: item for item in source_paragraphs}
    paragraphs: list[dict[str, Any]] = []
    for item in list(payload.get("paragraphs") or [])[:10]:
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

    if not paragraphs:
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


def build_structured_drafts_from_sources(
    db: Session,
    run: ResearchMatrixRun,
    source_map: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    paper_title_by_id = {item.paper_id: item.title_snapshot for item in run.papers if item.paper_id}
    drafts: dict[str, Any] = {}
    for key in DRAFT_SECTION_ORDER:
        drafts[key] = empty_draft_section(key)
    bundles = [
        build_paper_draft_bundle(run_paper, source_map.get(run_paper.paper_id, {}))
        for run_paper in run.papers
        if run_paper.paper_id
    ]

    for key in [
        "research_background",
        "research_status",
        "core_innovations",
        "method_compare",
        "result_analysis",
        "limitations_future",
    ]:
        paragraphs = [paragraph for bundle in bundles if (paragraph := build_section_paragraph(bundle, key))]
        drafts[key]["paragraphs"] = paragraphs
        drafts[key]["copy_ready"] = bool(paragraphs)
        drafts[key]["content"] = "\n\n".join(item.get("text") or "" for item in paragraphs)
        drafts[key]["source_titles"] = collect_source_titles_from_paragraphs(paragraphs)
        drafts[key]["ai_generated"] = False

    quotable_items = collect_quotable_items(source_map, paper_title_by_id)
    drafts["quotable_sentences"]["items"] = quotable_items
    drafts["quotable_sentences"]["copy_ready"] = bool(quotable_items)
    drafts["quotable_sentences"]["content"] = "\n".join(
        f"{item['paper_title']} p.{item['page']}：{item['quote']}"
        for item in quotable_items
    )
    drafts["quotable_sentences"]["source_titles"] = [item["paper_title"] for item in quotable_items[:8] if item.get("paper_title")]
    drafts["quotable_sentences"]["ai_generated"] = False
    drafts["final_integrated_review"] = build_ai_integrated_review(db, run, drafts)
    return drafts


def build_run_drafts_payload(db: Session, run: ResearchMatrixRun) -> tuple[dict[str, Any], dict[str, Any], list[tuple[int, str]]]:
    source_map, counters = build_draft_source_map(db, run)
    missing = collect_missing_draft_sources(source_map)
    total_count = counters["total_count"]
    ready_count = counters["ready_count"]
    failed_count = counters["failed_count"]
    running_count = counters.get("running_count", 0)
    progress = round((ready_count / total_count) * 100) if total_count else 0

    if ready_count == 0:
        message = build_draft_pending_message(run, source_map)
        status = "failed" if failed_count else ("running" if running_count else "idle")
        stage = "generating_sources" if running_count or total_count else "preparing_sources"
        payload = build_empty_drafts_payload(message)
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

    drafts = build_structured_drafts_from_sources(db, run, source_map)
    status = "completed"
    stage = "completed"
    error_message = None
    if running_count:
        status = "running"
        stage = "generating_sources"
    elif failed_count:
        status = "failed"
        stage = "building_drafts"
        error_message = build_draft_pending_message(run, source_map)
    state = draft_status_payload(
        status=status,
        stage=stage,
        progress=progress if progress else 100,
        ready_count=ready_count,
        total_count=total_count,
        failed_count=failed_count,
        error_message=error_message,
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
    run.dashboard_snapshot = build_dashboard_snapshot(db, user_id, matrix["rows"], matrix["missing"], matrix["stale"])


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
    run.progress_percent = round((ready / total) * 100) if total else 0


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
    all_review_ready = all(summary_ready(db, paper, summaries.get((paper.id, "review"))) for paper in papers)
    all_draft_sources_ready = all(draft_sources_ready(db, paper, summaries) for paper in papers)
    all_ready = all_review_ready and all_draft_sources_ready
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
    set_run_draft_state(
        run,
        status="running",
        stage="generating_sources",
        progress=int(run.progress_percent or 0),
        ready_count=0,
        total_count=len(run.papers) * len(DRAFT_REQUIRED_SUMMARY_TYPES),
        failed_count=0,
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

            review = ensure_summary_ready_for_run(
                db,
                run=run,
                run_paper=run_paper,
                paper=paper,
                summary_type="review",
                provider_id=provider_id,
            )
            if not review:
                return
            db.expire_all()
            run = load_run_with_papers(db, run_id)
            if not run:
                return
            run_paper = next(item for item in run.papers if item.paper_id == paper.id)

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
            set_run_draft_state(
                run,
                status="running",
                stage="preparing_sources",
                progress=int(run.progress_percent or 0),
                ready_count=0,
                total_count=len(run.papers) * len(DRAFT_REQUIRED_SUMMARY_TYPES),
                failed_count=0,
                error_message=None,
            )
            db.commit()
            rebuild_run_snapshots(db, run, run.user_id)
            run = load_run_with_papers(db, run_id)
            if not run:
                return

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
                    continue
                for summary_type in ("overview", "reproduction"):
                    ensure_summary_ready_for_run(
                        db,
                        run=run,
                        run_paper=run_paper,
                        paper=paper,
                        summary_type=summary_type,
                        provider_id=provider_id,
                    )
                    db.expire_all()
                    run = load_run_with_papers(db, run_id)
                    if not run:
                        return
                    run_paper = next(item for item in run.papers if item.paper_id == paper.id)
                    sync_run_draft_snapshot(db, run)
                    run = load_run_with_papers(db, run_id)
                    if not run:
                        return

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
    drafts_payload, draft_state, _missing = build_run_drafts_payload(db, run)
    apply_draft_payload_to_run(run, drafts_payload, draft_state)
    run.dashboard_snapshot = build_dashboard_snapshot(db, user_id, matrix["rows"], matrix["missing"], matrix["stale"])
    run.status = "completed"
    run.stage = "completed" if draft_state["status"] == "completed" else "building_matrix"
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


def rename_matrix_run(db: Session, run: ResearchMatrixRun, *, title: str) -> ResearchMatrixRun:
    next_title = (title or "").strip()[:160]
    run.title = next_title or "未命名批次"
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


def serialize_run_list_item(db: Session, run: ResearchMatrixRun, user_id: int) -> dict[str, Any]:
    missing_count = sum(1 for item in run.papers if item.is_missing)
    stale_count = sum(1 for item in run.papers if item.is_stale)
    source_state = inspect_run_source_state(db, run, user_id)
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
    }


def serialize_run_detail(db: Session, run: ResearchMatrixRun, user_id: int) -> dict[str, Any]:
    base = serialize_run_list_item(db, run, user_id)
    draft_state = serialize_draft_state(run)
    return {
        **base,
        **draft_state,
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
        "refresh_available": base["has_updates"] and not base["has_deleted_papers"],
    }
