from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AiProvider, Annotation, Paper, PaperFullTranslation, PaperSummary
from app.schemas.paper_summary import normalize_summary_content
from app.services.ai_provider_manager import resolve_user_provider
from app.services.crypto import decrypt_api_key
from app.services.notification import compact_notification_text, create_notification


SUMMARY_TYPES: dict[str, dict[str, Any]] = {
    "overview": {
        "title": "整篇总结",
        "target_words": "1800-2600",
        "section_chars": "220-420",
        "intent": "帮助研究生第一次读懂论文主线，快速抓住问题、方法、实验、结论和不足。",
        "sections": ["研究问题", "背景动机", "核心方法", "实验设计", "主要结论", "创新点", "不足与局限", "后续追问"],
        "focus": "全文结构、摘要、引言、方法、实验、结论、局限。",
    },
    "annotations": {
        "title": "我的标注总结",
        "target_words": "按标注数量动态生成，通常 800-1600",
        "section_chars": "160-320",
        "intent": "只围绕用户自己标注过的内容做主题聚类和复盘，帮助用户看清自己关注了什么。",
        "sections": ["标注主题聚类", "方法相关重点", "结果相关重点", "用户关注点", "遗漏提醒", "后续追问"],
        "focus": "用户标注文本、标注页码、标注前后文；不要把全文总结伪装成标注总结。",
    },
    "review": {
        "title": "文献综述卡片",
        "target_words": "1300-1900",
        "section_chars": "180-360",
        "intent": "产出可直接进入文献矩阵、比较导读和后续综述写作的结构化单篇卡片。",
        "sections": ["研究背景与动机", "研究问题", "方法路线", "数据与实验设置", "对比基线与评价指标", "核心发现", "创新点", "局限与风险"],
        "focus": "优先抽取可横向比较、可回查原文、可直接支撑后续综述写作的事实点，而不是泛泛摘要。",
        "extra_rules": "每个核心字段都要尽量写细，优先拆成 2-4 个事实点；非列表字段可用中文分号分隔子点；必须补齐研究背景、实验设置、基线与指标，避免后续综述只有方法和结论没有证据。",
    },
    "reproduction": {
        "title": "复现总结",
        "target_words": "1800-3200",
        "section_chars": "240-520",
        "intent": "给后续实验复现和代码阅读准备工程向清单，明确哪些信息文中没有说明。",
        "sections": ["模型结构", "数据集", "预处理", "训练/推理参数", "评价指标", "环境依赖", "关键公式逻辑", "缺失信息清单"],
        "focus": "方法、实验、表格、公式、参数、数据集、评价指标、环境；没找到就写文中未说明。",
    },
    "meeting": {
        "title": "组会汇报稿",
        "target_words": "1600-2600",
        "section_chars": "220-450",
        "intent": "生成研究生组会能直接讲的口语化稿子，按讲述顺序组织。",
        "sections": ["一分钟简介", "研究背景", "核心创新点", "方法流程", "实验结果", "局限", "对自己课题的启发", "下周计划建议"],
        "focus": "先大纲后讲述，语言自然，能直接开口讲 3-5 分钟。",
    },
}

STAGE_LABELS = {
    "idle": "等待生成",
    "extracting_context": "提取全文",
    "chunking": "分块分析",
    "analyzing_structure": "分析结构",
    "generating_summary": "生成总结",
    "checking_coverage": "校验结果",
    "completed": "完成",
    "failed": "生成失败",
}

ANNOTATION_TYPE_LABELS = {
    "highlight": "高亮",
    "underline": "下划线",
    "wavy_underline": "波浪线",
}
REVIEW_STRUCTURED_FIELD_ORDER = [
    "background_motivation",
    "research_question",
    "method_route",
    "data_experiment",
    "baselines_metrics",
    "main_findings",
    "innovations",
    "limitations",
]

REVIEW_FIELD_TO_SECTION = {
    "background_motivation": "研究背景与动机",
    "research_question": "研究问题与对象",
    "method_route": "方法路线",
    "data_experiment": "数据与实验设置",
    "baselines_metrics": "对比基线与评价指标",
    "main_findings": "核心发现",
    "innovations": "创新点",
    "limitations": "局限与风险",
}

REVIEW_SECTION_ALIASES = {
    "background_motivation": ["研究背景与动机", "背景动机", "研究背景", "背景", "动机"],
    "research_question": ["研究问题与对象", "研究问题", "对象"],
    "method_route": ["方法路线", "方法与模型", "方法", "模型"],
    "data_experiment": ["数据与实验设置", "数据与样本", "实验设置", "数据", "样本", "实验"],
    "baselines_metrics": ["对比基线与评价指标", "对比基线", "评价指标", "基线", "指标"],
    "main_findings": ["核心发现", "核心结论与发现", "核心结论", "发现"],
    "innovations": ["创新点", "创新点与局限性", "创新"],
    "limitations": ["局限与风险", "创新点与局限性", "局限", "不足", "风险"],
}


@dataclass
class PageText:
    page: int
    text: str


SUMMARY_RUNNING_STALE_SECONDS = 180
LLM_CALL_MAX_ATTEMPTS = 3
LLM_JSON_MAX_ATTEMPTS = 2
LLM_RETRY_BACKOFF_SECONDS = (1.0, 2.2, 4.0)
DB_OPERATIONAL_RETRY_CODES = {2006, 2013}


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def is_summary_running_stale(item: PaperSummary | None, *, now: datetime | None = None) -> bool:
    if not item or item.status != "running":
        return False
    updated_at = _normalize_datetime(item.updated_at)
    if updated_at is None:
        return False
    current = _normalize_datetime(now or datetime.now(updated_at.tzinfo))
    if current is None:
        return False
    return (current - updated_at) > timedelta(seconds=SUMMARY_RUNNING_STALE_SECONDS)


def mark_summary_interrupted(db: Session, item: PaperSummary, message: str = "生成任务已中断，请重试。") -> PaperSummary:
    item.status = "failed" if not item.content_json else "generated"
    item.stage = "failed"
    item.error_message = message
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def is_retryable_db_operational_error(exc: Exception) -> bool:
    if not isinstance(exc, OperationalError):
        return False
    original = getattr(exc, "orig", None)
    error_code = None
    if original is not None and getattr(original, "args", None):
        error_code = original.args[0]
    message = str(original or exc).lower()
    return (
        error_code in DB_OPERATIONAL_RETRY_CODES
        or "server has gone away" in message
        or "lost connection to mysql server during query" in message
        or "connection was killed" in message
    )


def normalize_summary_terminal_state(db: Session, item: PaperSummary | None) -> PaperSummary | None:
    if not item:
        return None
    if item.stage == "completed" and int(item.progress or 0) >= 100 and item.status != "generated":
        item.status = "generated"
        item.error_message = None
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


def get_review_summary_content(content: dict[str, Any] | None) -> dict[str, Any]:
    normalized = normalize_summary_content(content, "review", summary_title("review"))
    structured = normalize_review_structured_fields(
        normalized.get("structured_fields"),
        normalized.get("narrative_sections") or normalized.get("sections"),
    )
    narrative_sections = normalize_review_narrative_sections(
        normalized.get("narrative_sections") or normalized.get("sections"),
        structured,
    )
    evidence_map = update_review_section_evidence_map(narrative_sections)
    normalized["structured_fields"] = structured
    normalized["review_field_blocks"] = build_review_field_blocks(structured, evidence_map)
    normalized["narrative_sections"] = narrative_sections
    normalized["sections"] = narrative_sections
    normalized.setdefault("structured_field_meta", {})
    return normalized


def section_lookup(sections: list[dict[str, Any]], aliases: list[str]) -> dict[str, Any] | None:
    alias_set = [str(alias).strip().lower() for alias in aliases if str(alias).strip()]
    for section in sections:
        heading = str(section.get("heading") or "").strip().lower()
        if any(alias in heading for alias in alias_set):
            return section
    return None


def parse_compound_list(value: Any, *, limit: int = 6) -> list[str]:
    if isinstance(value, list):
        items = [clean_text(str(item)) for item in value]
        return [item[:220] for item in items if item][:limit]
    text = clean_text(str(value or ""))
    if not text:
        return []
    parts = [
        part.strip(" \t-•·;；,，/|")
        for part in re.split(r"[\n;；,，/|]+", text)
    ]
    items = [part for part in parts if part]
    if items:
        return items[:limit]
    return [text[:220]]


def slugify_review_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")


def derive_evidence_id(field_key: str, evidence: dict[str, Any] | None) -> str:
    source = evidence or {}
    page = source.get("page") or "x"
    quote = clean_text(source.get("quote") or "")[:48]
    digest = hashlib.sha1(f"{field_key}:{page}:{quote}".encode("utf-8", errors="ignore")).hexdigest()[:12]
    return f"rev-{slugify_review_key(field_key)}-{digest}"


def normalize_review_field_items(field_key: str, values: list[str], evidence_map: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    evidences = evidence_map.get(field_key, [])
    for index, value in enumerate(values[:6], start=1):
        text = clean_text(value)[:320]
        if not text:
            continue
        evidence = evidences[min(index - 1, len(evidences) - 1)] if evidences else {}
        source_page = evidence.get("page")
        normalized.append({
            "id": f"{slugify_review_key(field_key)}-{index}",
            "text": text,
            "source_pages": [int(source_page)] if isinstance(source_page, int) and source_page > 0 else [],
            "source_section": REVIEW_FIELD_TO_SECTION.get(field_key, field_key),
            "source_quote": clean_text(evidence.get("quote") or "")[:260],
            "start_char": evidence.get("start_char"),
            "end_char": evidence.get("end_char"),
            "evidence_ids": [derive_evidence_id(field_key, evidence)] if evidence else [],
            "confidence": "high" if evidence else "medium",
            "edited_by_user": False,
        })
    return normalized


def build_review_field_blocks(structured_fields: dict[str, Any], evidence_map: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    block_titles = {
        "background_motivation": "研究背景与动机",
        "research_question": "研究问题",
        "method_route": "方法路线",
        "data_experiment": "数据与实验设置",
        "baselines_metrics": "对比基线与评价指标",
        "main_findings": "核心发现",
        "innovations": "创新点",
        "limitations": "局限与风险",
    }
    blocks: list[dict[str, Any]] = []
    for field_key, title in block_titles.items():
        raw_value = structured_fields.get(field_key)
        values = parse_compound_list(raw_value, limit=6)
        items = normalize_review_field_items(field_key, values, evidence_map)
        summary = "；".join([item["text"] for item in items[:3]])[:420]
        blocks.append({
            "key": field_key,
            "title": title,
            "role": "review_core",
            "summary": summary,
            "items": items,
        })
    return blocks


def split_innovation_and_limitations(text: str) -> tuple[list[str], list[str]]:
    cleaned = clean_text(text)
    if not cleaned:
        return [], []
    pieces = re.split(r"(?<=[。；;])\s*", cleaned)
    innovations: list[str] = []
    limitations: list[str] = []
    for piece in pieces:
        item = piece.strip(" 。；;")
        if not item:
            continue
        lowered = item.lower()
        if (
            item.startswith(("但", "但是", "然而"))
            or any(token in lowered for token in ["局限", "不足", "风险", "缺点", "限制", "未说明", "依赖", "有限"])
        ):
            limitations.append(item)
        else:
            innovations.append(item)
    if not innovations:
        innovations = [cleaned]
    return innovations[:4], limitations[:4]


def normalize_review_structured_fields(value: Any, sections_value: Any = None) -> dict[str, Any]:
    sections = sections_value if isinstance(sections_value, list) else []
    raw = value if isinstance(value, dict) else {}
    combined_text = ""
    combined_section = section_lookup(sections, REVIEW_SECTION_ALIASES["limitations"])
    if combined_section:
        combined_text = str(combined_section.get("body") or "")
    innovations, limitations = split_innovation_and_limitations(combined_text)
    structured = {
        "background_motivation": clean_text(raw.get("background_motivation") or (section_lookup(sections, REVIEW_SECTION_ALIASES["background_motivation"]) or {}).get("body") or "")[:420],
        "research_question": clean_text(raw.get("research_question") or (section_lookup(sections, REVIEW_SECTION_ALIASES["research_question"]) or {}).get("body") or "")[:360],
        "method_route": clean_text(raw.get("method_route") or (section_lookup(sections, REVIEW_SECTION_ALIASES["method_route"]) or {}).get("body") or "")[:420],
        "data_experiment": clean_text(raw.get("data_experiment") or (section_lookup(sections, REVIEW_SECTION_ALIASES["data_experiment"]) or {}).get("body") or "")[:420],
        "baselines_metrics": clean_text(raw.get("baselines_metrics") or (section_lookup(sections, REVIEW_SECTION_ALIASES["baselines_metrics"]) or {}).get("body") or "")[:420],
        "main_findings": clean_text(raw.get("main_findings") or (section_lookup(sections, REVIEW_SECTION_ALIASES["main_findings"]) or {}).get("body") or "")[:420],
        "innovations": parse_compound_list(raw.get("innovations") or innovations),
        "limitations": parse_compound_list(raw.get("limitations") or limitations),
    }
    return structured


def format_structured_field_text(field_key: str, structured_fields: dict[str, Any]) -> str:
    value = structured_fields.get(field_key)
    if field_key in {"innovations", "limitations"}:
        return "；".join(parse_compound_list(value, limit=8))
    return clean_text(str(value or ""))


def update_review_section_evidence_map(sections: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    mapping: dict[str, list[dict[str, Any]]] = {}
    for field_key, aliases in REVIEW_SECTION_ALIASES.items():
        section = section_lookup(sections, aliases)
        if section and isinstance(section.get("evidence"), list):
            mapping[field_key] = section.get("evidence") or []
    return mapping


def normalize_review_narrative_sections(value: Any, structured_fields: dict[str, Any]) -> list[dict[str, Any]]:
    sections = value if isinstance(value, list) else []
    evidence_map = update_review_section_evidence_map(sections)
    normalized: list[dict[str, Any]] = []
    for field_key in REVIEW_STRUCTURED_FIELD_ORDER:
        body = format_structured_field_text(field_key, structured_fields)
        if not body:
            continue
        normalized.append({
            "heading": REVIEW_FIELD_TO_SECTION[field_key],
            "body": body,
            "keywords": parse_compound_list(structured_fields.get(field_key), limit=4) if field_key in {"innovations", "limitations"} else [],
            "evidence": evidence_map.get(field_key, []),
        })
    return normalized


def merge_manual_review_fields(existing_content: dict[str, Any] | None, next_content: dict[str, Any]) -> dict[str, Any]:
    if not existing_content:
        next_content.setdefault("structured_field_meta", {})
        return next_content
    existing_review = get_review_summary_content(existing_content)
    meta = existing_review.get("structured_field_meta") if isinstance(existing_review.get("structured_field_meta"), dict) else {}
    merged = dict(next_content)
    merged_fields = dict(merged.get("structured_fields") or {})
    existing_fields = dict(existing_review.get("structured_fields") or {})
    for field_key, field_meta in meta.items():
        if not isinstance(field_meta, dict) or not field_meta.get("is_manual"):
            continue
        if field_key in existing_fields:
            merged_fields[field_key] = existing_fields[field_key]
    merged["structured_fields"] = merged_fields
    merged["structured_field_meta"] = meta
    merged_sections = normalize_review_narrative_sections(merged.get("narrative_sections") or merged.get("sections"), merged_fields)
    merged["review_field_blocks"] = build_review_field_blocks(merged_fields, update_review_section_evidence_map(merged_sections))
    merged["narrative_sections"] = merged_sections
    merged["sections"] = merged_sections
    return merged


def mark_review_fields_manual(content: dict[str, Any], field_keys: list[str]) -> dict[str, Any]:
    normalized = get_review_summary_content(content)
    meta = dict(normalized.get("structured_field_meta") or {})
    for field_key in field_keys:
        meta[field_key] = {
            "is_manual": True,
        }
    normalized["structured_field_meta"] = meta
    return normalized


def apply_review_field_updates(content: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    normalized = get_review_summary_content(content)
    structured = dict(normalized.get("structured_fields") or {})
    changed_keys: list[str] = []
    for field_key, raw_value in updates.items():
        if field_key not in REVIEW_STRUCTURED_FIELD_ORDER:
            continue
        changed_keys.append(field_key)
        if field_key in {"innovations", "limitations"}:
            structured[field_key] = parse_compound_list(raw_value, limit=8)
        else:
            structured[field_key] = clean_text(str(raw_value or ""))[:420]
    normalized["structured_fields"] = structured
    sections = normalize_review_narrative_sections(normalized.get("narrative_sections") or normalized.get("sections"), structured)
    normalized["review_field_blocks"] = build_review_field_blocks(structured, update_review_section_evidence_map(sections))
    normalized["narrative_sections"] = sections
    normalized["sections"] = sections
    return mark_review_fields_manual(normalized, changed_keys)


def summary_title(summary_type: str) -> str:
    return SUMMARY_TYPES.get(summary_type, SUMMARY_TYPES["overview"])["title"]


def load_available_provider(db: Session, user_id: int, provider_id: int | None = None) -> AiProvider | None:
    return resolve_user_provider(
        db,
        user_id,
        provider_id,
        require_active=True,
        fallback_to_active=True,
    )


def build_summary_response_payload(
    item: PaperSummary | None,
    summary_type: str,
    *,
    is_stale: bool = False,
    stale_message: str | None = None,
) -> dict[str, Any]:
    title = summary_title(summary_type)
    if not item:
        return {
            "type": summary_type,
            "title": title,
            "status": "idle",
            "stage": "idle",
            "progress": 0,
            "preview": "",
            "summary": None,
            "is_stale": False,
            "error_message": None,
            "updated_at": None,
            "model": "",
        }
    content = normalize_summary_content(item.content_json, summary_type, title)
    if summary_type == "review":
        content = get_review_summary_content(content)
    preview = str(content.get("preview") or "")
    if is_stale and item.status != "running":
        message = stale_message or "来源内容已变化，请重新生成。"
        return {
            "type": summary_type,
            "title": title,
            "status": item.status if item.status == "generated" else "idle",
            "stage": item.stage or "idle",
            "progress": int(item.progress or 0) if item.status == "generated" else 0,
            "preview": preview or message,
            "summary": content if item.status == "generated" and content else None,
            "is_stale": True,
            "error_message": message,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            "model": item.model or "",
        }
    return {
        "type": summary_type,
        "title": title,
        "status": item.status,
        "stage": item.stage or "idle",
        "progress": int(item.progress or 0),
        "preview": preview,
        "summary": content if item.status == "generated" and content else None,
        "is_stale": False,
        "error_message": item.error_message,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "model": item.model or "",
    }


def update_summary_progress(summary_id: int, *, stage: str, progress: int, status: str = "running", error: str | None = None) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        item = db.get(PaperSummary, summary_id)
        if not item:
            return
        if item.status == "generated" and (item.stage == "completed" or int(item.progress or 0) >= 100):
            return
        item.status = status
        item.stage = stage
        item.progress = max(0, min(100, int(progress)))
        if error is not None:
            item.error_message = error
        elif status == "running":
            item.error_message = None
        db.add(item)
        db.commit()
    finally:
        db.close()


def run_paper_summary_task(summary_id: int, provider_id: int | None = None) -> None:
    from app.db.session import SessionLocal

    try:
        for task_attempt in range(1, LLM_CALL_MAX_ATTEMPTS + 1):
            db = SessionLocal()
            try:
                item = db.get(PaperSummary, summary_id)
                if not item:
                    return
                paper = db.scalar(select(Paper).where(Paper.id == item.paper_id, Paper.user_id == item.user_id))
                if not paper:
                    _mark_failed(db, item, "论文不存在或已被删除")
                    return

                provider = load_available_provider(db, item.user_id, provider_id)
                if not provider:
                    _mark_failed(db, item, "缺少可用 AI 服务，请先配置 AI 提供商")
                    return

                item.provider_id = provider.id
                item.model = provider.model
                item.error_message = None
                db.add(item)
                db.commit()

                annotations = load_annotation_context(db, paper.id, item.user_id)
                update_summary_progress(summary_id, stage="extracting_context", progress=10)

                if item.summary_type == "annotations":
                    source_hash = compute_source_hash(paper, item.summary_type, [], annotations)
                    if len(annotations) < 3:
                        content = build_sparse_annotation_summary(item.summary_type, annotations)
                        content = normalize_generated_summary(content, item.summary_type, [], annotations, existing_content=item.content_json)
                        _mark_generated(db, item, content, source_hash, provider)
                        return

                    api_key = decrypt_api_key(provider.encrypted_api_key)
                    update_summary_progress(summary_id, stage="analyzing_structure", progress=48)
                    fact_sheet = build_annotation_fact_sheet(paper, annotations)

                    update_summary_progress(summary_id, stage="generating_summary", progress=72)
                    content = generate_typed_summary(
                        base_url=provider.base_url,
                        api_key=api_key,
                        model=provider.model,
                        summary_type=item.summary_type,
                        paper=paper,
                        pages=[],
                        fact_sheet=fact_sheet,
                        annotations=annotations,
                    )

                    update_summary_progress(summary_id, stage="checking_coverage", progress=90)
                    content = normalize_generated_summary(content, item.summary_type, [], annotations, existing_content=item.content_json)
                    _mark_generated(db, item, content, source_hash, provider)
                    return

                pages = extract_paper_pages(db, paper)
                if item.summary_type != "annotations" and total_chars(pages) < 100:
                    _mark_failed(db, item, "未能提取到足够的 PDF 正文，请检查原文是否可解析")
                    return

                source_hash = compute_source_hash(paper, item.summary_type, pages, annotations)
                api_key = decrypt_api_key(provider.encrypted_api_key)
                update_summary_progress(summary_id, stage="chunking", progress=22)
                chunk_digests = build_chunk_digests(
                    base_url=provider.base_url,
                    api_key=api_key,
                    model=provider.model,
                    paper=paper,
                    pages=pages,
                    summary_id=summary_id,
                )

                update_summary_progress(summary_id, stage="analyzing_structure", progress=50)
                fact_sheet = build_fact_sheet(
                    base_url=provider.base_url,
                    api_key=api_key,
                    model=provider.model,
                    paper=paper,
                    pages=pages,
                    chunk_digests=chunk_digests,
                    annotations=annotations,
                )

                update_summary_progress(summary_id, stage="generating_summary", progress=72)
                content = generate_typed_summary(
                    base_url=provider.base_url,
                    api_key=api_key,
                    model=provider.model,
                    summary_type=item.summary_type,
                    paper=paper,
                    pages=pages,
                    fact_sheet=fact_sheet,
                    annotations=annotations,
                )

                update_summary_progress(summary_id, stage="checking_coverage", progress=90)
                content = normalize_generated_summary(content, item.summary_type, pages, annotations, existing_content=item.content_json)
                _mark_generated(db, item, content, source_hash, provider)
                return
            except Exception as exc:
                if task_attempt >= LLM_CALL_MAX_ATTEMPTS:
                    raise
                retry_stage = "generating_summary"
                retry_progress = 0
                if not is_retryable_db_operational_error(exc):
                    fresh = db.get(PaperSummary, summary_id)
                    if fresh:
                        retry_stage = fresh.stage or retry_stage
                        retry_progress = int(fresh.progress or 0)
                try:
                    update_summary_progress(
                        summary_id,
                        stage=retry_stage,
                        progress=retry_progress,
                        status="running",
                        error=f"自动重试中：{task_attempt}/{LLM_CALL_MAX_ATTEMPTS}，{exc}",
                    )
                except OperationalError:
                    pass
                sleep_before_retry(task_attempt)
            finally:
                db.close()
    except Exception as exc:
        db = SessionLocal()
        try:
            fresh = db.get(PaperSummary, summary_id)
            if fresh:
                _mark_failed(db, fresh, f"生成失败：{exc}")
        finally:
            db.close()


def _mark_generated(db: Session, item: PaperSummary, content: dict[str, Any], source_hash: str, provider: AiProvider) -> None:
    item.status = "generated"
    item.stage = "completed"
    item.progress = 100
    item.source_hash = source_hash
    item.provider_id = provider.id
    item.model = provider.model
    item.content_json = content
    item.error_message = None
    db.add(item)
    db.commit()
    paper = db.get(Paper, item.paper_id)
    create_notification(
        db,
        user_id=item.user_id,
        source_kind="paper_summary",
        source_id=int(item.id),
        event_kind="completed",
        title=f"{summary_title(item.summary_type)} 已完成",
        message=f"{compact_notification_text((paper.title if paper else '') or '当前论文', 80)} · {summary_title(item.summary_type)}",
        action_kind="open-summary",
        action_payload={"paper_id": item.paper_id, "summary_type": item.summary_type},
    )


def _mark_failed(db: Session, item: PaperSummary, message: str) -> None:
    next_status = "failed" if not item.content_json else "generated"
    item.status = next_status
    item.stage = "failed"
    item.progress = max(0, min(100, int(item.progress or 0)))
    item.error_message = message
    db.add(item)
    db.commit()
    if next_status == "failed":
        paper = db.get(Paper, item.paper_id)
        create_notification(
            db,
            user_id=item.user_id,
            source_kind="paper_summary",
            source_id=int(item.id),
            event_kind="failed",
            title=f"{summary_title(item.summary_type)} 失败",
            message=f"{compact_notification_text((paper.title if paper else '') or '当前论文', 80)} · {compact_notification_text(message, 120)}",
            action_kind="open-summary",
            action_payload={"paper_id": item.paper_id, "summary_type": item.summary_type},
        )


def extract_paper_pages(db: Session, paper: Paper) -> list[PageText]:
    pages = extract_pages_with_pymupdf(paper.file_path)
    if pages:
        return pages

    translation = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper.id))
    fallback: list[PageText] = []
    for page in translation.pages_json if translation else []:
        page_number = int(page.get("page_number") or len(fallback) + 1)
        blocks = page.get("blocks") or []
        text = clean_text("\n".join(str(block.get("source_text") or "") for block in blocks))
        if text:
            fallback.append(PageText(page=page_number, text=text))
    return fallback


def extract_pages_with_pymupdf(file_url: str) -> list[PageText]:
    path = resolve_paper_file(file_url)
    if not path or not path.exists():
        return []
    try:
        import fitz  # PyMuPDF
    except Exception:
        return []

    pages: list[PageText] = []
    try:
        with fitz.open(path) as document:
            for index, page in enumerate(document, start=1):
                text = clean_text(page.get_text("text") or "")
                if text:
                    pages.append(PageText(page=index, text=text))
    except Exception:
        return []
    return pages


def resolve_paper_file(file_url: str) -> Path | None:
    if not file_url:
        return None
    file_name = Path(file_url).name
    if not file_name:
        return None
    root = Path(settings.papers_upload_dir).resolve()
    candidate = root / file_name
    try:
        resolved = candidate.resolve()
    except OSError:
        return None
    if root not in resolved.parents:
        return None
    return resolved


def load_annotation_context(db: Session, paper_id: int, user_id: int) -> list[dict[str, Any]]:
    annotations = db.scalars(
        select(Annotation)
        .where(Annotation.paper_id == paper_id, Annotation.user_id == user_id)
        .order_by(Annotation.page_number, Annotation.start_char, Annotation.id)
    ).all()
    return [
        {
            "id": annotation.id,
            "page": annotation.page_number,
            "start_char": annotation.start_char,
            "end_char": annotation.end_char,
            "type": annotation.type,
            "color": annotation.color or "",
            "quote": clean_text(annotation.quote_text)[:1200],
        }
        for annotation in annotations
        if clean_text(annotation.quote_text)
    ]


def total_chars(pages: list[PageText]) -> int:
    return sum(len(page.text) for page in pages)


def compute_source_hash(paper: Paper, summary_type: str, pages: list[PageText], annotations: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    digest.update(str(paper.id).encode("utf-8"))
    digest.update(summary_type.encode("utf-8"))
    if summary_type == "annotations":
        for annotation in annotations:
            digest.update(json.dumps(annotation, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()
    digest.update(str(paper.updated_at or "").encode("utf-8"))
    for page in pages:
        digest.update(str(page.page).encode("utf-8"))
        digest.update(page.text.encode("utf-8", errors="ignore"))
    return digest.hexdigest()


def _annotation_snapshot_from_context(annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    snapshot: list[dict[str, Any]] = []
    for annotation in annotations:
        quote = clean_text(annotation.get("quote") or "")[:800]
        if not quote:
            continue
        snapshot.append(
            {
                "id": annotation.get("id"),
                "type": str(annotation.get("type") or "highlight"),
                "page": annotation.get("page"),
                "start_char": annotation.get("start_char"),
                "end_char": annotation.get("end_char"),
                "color": str(annotation.get("color") or ""),
                "quote": quote,
            }
        )
    return sorted(
        snapshot,
        key=lambda item: (
            str(item.get("type") or ""),
            int(item.get("page") or 0),
            int(item.get("start_char") or 0),
            int(item.get("id") or 0),
        ),
    )


def _annotation_snapshot_from_summary(item: PaperSummary) -> list[dict[str, Any]] | None:
    content = item.content_json if isinstance(item.content_json, dict) else {}
    groups = content.get("annotation_groups")
    if not isinstance(groups, list):
        return None
    snapshot: list[dict[str, Any]] = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        annotation_type = str(group.get("type") or "highlight")
        items = group.get("items")
        if not isinstance(items, list):
            continue
        for annotation in items:
            if not isinstance(annotation, dict):
                continue
            quote = clean_text(annotation.get("quote") or "")[:800]
            if not quote:
                continue
            snapshot.append(
                {
                    "id": annotation.get("id"),
                    "type": annotation_type,
                    "page": annotation.get("page"),
                    "start_char": annotation.get("start_char"),
                    "end_char": annotation.get("end_char"),
                    "color": str(annotation.get("color") or ""),
                    "quote": quote,
                }
            )
    return sorted(
        snapshot,
        key=lambda item: (
            str(item.get("type") or ""),
            int(item.get("page") or 0),
            int(item.get("start_char") or 0),
            int(item.get("id") or 0),
        ),
    )


def is_summary_stale(db: Session, paper: Paper, item: PaperSummary | None) -> bool:
    if not item or item.status == "running":
        return False
    if item.summary_type == "annotations":
        annotations = load_annotation_context(db, paper.id, item.user_id)
        saved_snapshot = _annotation_snapshot_from_summary(item)
        if not item.source_hash:
            if saved_snapshot is not None:
                return saved_snapshot != _annotation_snapshot_from_context(annotations)
            return False
        current_hash = compute_source_hash(paper, item.summary_type, [], annotations)
        if current_hash == item.source_hash:
            return False
        if saved_snapshot is not None:
            return saved_snapshot != _annotation_snapshot_from_context(annotations)
        return current_hash != item.source_hash
    return False


def stale_summary_message(summary_type: str) -> str:
    if summary_type == "annotations":
        return "标注已变化，请重新生成标注总结。"
    return "论文来源已变化，请重新生成。"


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def build_chunk_digests(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper: Paper,
    pages: list[PageText],
    summary_id: int,
) -> list[str]:
    chunks = split_pages_into_chunks(pages, max_chars=15000, max_chunks=12)
    if not chunks:
        return []
    if len(chunks) == 1 and len(chunks[0]) < 18000:
        return [chunks[0]]

    digests: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        progress = 24 + int(index / max(1, len(chunks)) * 20)
        update_summary_progress(summary_id, stage="chunking", progress=progress)
        prompt = f"""你是严谨的中文学术阅读助手，请把下面这一段论文内容压缩成可供后续综述使用的事实摘要。

要求：
1. 保留研究问题、方法、实验设置、结果、局限等事实信息。
2. 不要引入原文没有出现的新判断。
3. 尽量保留页码、数据集、指标、模型名称和关键数值。
4. 输出 500-800 字中文摘要。

论文标题：{paper.title or paper.file_name}
分块：{index}/{len(chunks)}
正文：
{chunk}"""
        for attempt in range(1, LLM_CALL_MAX_ATTEMPTS + 1):
            try:
                digests.append(call_text_completion(base_url=base_url, api_key=api_key, model=model, prompt=prompt, max_tokens=1800))
                break
            except Exception as exc:
                if attempt >= LLM_CALL_MAX_ATTEMPTS:
                    raise
                update_summary_progress(
                    summary_id,
                    stage="chunking",
                    progress=max(progress, 24),
                    error=f"分块 {index} 生成失败，自动重试 {attempt}/{LLM_CALL_MAX_ATTEMPTS}：{exc}",
                )
                sleep_before_retry(attempt)
    return digests


def split_pages_into_chunks(pages: list[PageText], *, max_chars: int, max_chunks: int) -> list[str]:
    all_chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for page in pages:
        page_text = f"[第 {page.page} 页]\n{page.text}\n"
        if current and current_len + len(page_text) > max_chars:
            all_chunks.append("\n".join(current))
            current = []
            current_len = 0
        current.append(page_text)
        current_len += len(page_text)
    if current:
        all_chunks.append("\n".join(current))
    if len(all_chunks) <= max_chunks:
        return all_chunks
    if max_chunks <= 4:
        return all_chunks[:max_chunks]

    selected_indices = {0, 1, len(all_chunks) - 2, len(all_chunks) - 1}
    remaining_slots = max_chunks - len(selected_indices)
    middle_start = 2
    middle_end = len(all_chunks) - 2
    if remaining_slots > 0 and middle_end > middle_start:
        step = (middle_end - middle_start) / remaining_slots
        for offset in range(remaining_slots):
            selected_indices.add(min(middle_end - 1, middle_start + int(round(offset * step))))
    return [all_chunks[index] for index in sorted(selected_indices)[:max_chunks]]


def build_fact_sheet(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper: Paper,
    pages: list[PageText],
    chunk_digests: list[str],
    annotations: list[dict[str, Any]],
) -> str:
    excerpts = build_priority_excerpts(pages, max_chars=24000)
    annotation_text = format_annotations(annotations, limit=20)
    prompt = f"""你是严谨的中文学术阅读助手，请根据论文摘要片段、重点原文和用户标注整理一份事实底稿。

请覆盖：
- 研究背景与动机
- 研究问题
- 方法路线
- 数据与实验设置
- 对比基线与评价指标
- 核心发现
- 创新点
- 局限与风险

要求：
1. 只使用输入中出现的信息。
2. 保留页码、模型名、数据集、指标和关键数值。
3. 用中文输出，条理清楚。

论文标题：{paper.title or paper.file_name}
作者：{paper.author or "未知"}
关键词：{paper.keywords or "未知"}

分块摘要：
{chr(10).join(chunk_digests)}

重点原文：
{excerpts}

用户标注：
{annotation_text or "暂无标注"}"""
    last_error: Exception | None = None
    for attempt in range(1, LLM_CALL_MAX_ATTEMPTS + 1):
        try:
            return call_text_completion(base_url=base_url, api_key=api_key, model=model, prompt=prompt, max_tokens=5000)
        except Exception as exc:
            last_error = exc
            if attempt >= LLM_CALL_MAX_ATTEMPTS:
                raise
            sleep_before_retry(attempt)
    raise last_error or RuntimeError("build_fact_sheet_failed")


def generate_typed_summary(
    *,
    base_url: str,
    api_key: str,
    model: str,
    summary_type: str,
    paper: Paper,
    pages: list[PageText],
    fact_sheet: str,
    annotations: list[dict[str, Any]],
) -> dict[str, Any]:
    config = SUMMARY_TYPES[summary_type]
    excerpts = build_priority_excerpts(pages, max_chars=16000)
    annotation_text = format_annotations(annotations, limit=60 if summary_type == "annotations" else 12)
    if summary_type == "review":
        prompt = f"""你正在为研究生阅读器生成“{config["title"]}”。

目标：{config["intent"]}
建议字数：{config["target_words"]} 中文字。
每个正文小节建议长度：{config["section_chars"]} 中文字符。
重点上下文：{config["focus"]}
必须包含的小节：{", ".join(config["sections"])}
补充规则：{config.get("extra_rules", "按该板块用途输出具体、有证据、可复用的内容。")}

这不是普通摘要，而是后续综述写作的数据底座。请严格遵守：
1. 必须围绕 8 个核心字段输出，字段名必须与 JSON 模板完全一致。
2. `structured_fields` 是后续矩阵和比较导读的直接输入，必须尽量写细。除 `innovations`、`limitations` 外，其余字段使用 1 段高密度中文字符串；如果有多个要点，请用中文分号“；”分隔 2-4 个事实点。
3. `innovations` 和 `limitations` 必须分别输出 2-4 条短事实点数组；没有足够依据时宁可少写，也不要脑补。
4. `sections` 是给用户阅读的展开版正文，必须与 8 个核心字段一一对应，heading 必须分别是：研究背景与动机、研究问题、方法路线、数据与实验设置、对比基线与评价指标、核心发现、创新点、局限与风险。
5. 每个 section.body 都要写清楚对象、方法/设置、结果/含义，不要空泛，也不要只抄标题。
6. evidence 只能逐字摘自【关键页摘录】或【用户标注】，尽量给 3-8 条候选；系统会二次核验，匹配不到原文的证据会被删除。
7. highlights 只保留 3 条最关键结论，20-60 个中文字符即可。
8. missing_items 只列会影响比较、复现或综述引用的具体缺失信息，例如数据规模、基线细节、评价指标定义、显著性、实验边界、局限说明；没有就返回空数组。
9. followup_questions 必须是可以指导继续回查全文或继续写综述的高价值问题，避免泛泛而谈。
10. assistant_panels 仍然输出“证据判断、研究价值、下一步行动”三类，每类 2-4 条，内容要具体到方法、数据、结果或写作用途。
11. 输出必须是 JSON，不要 Markdown，不要代码块。

JSON 结构：
{{
  "type": "review",
  "title": "{config["title"]}",
  "preview": "120 字以内总览",
  "highlights": ["最重要结论 1", "最重要结论 2", "最重要结论 3"],
  "structured_fields": {{
    "background_motivation": "研究背景与动机，必要时用中文分号分隔 2-4 个事实点",
    "research_question": "研究问题与对象，必要时用中文分号分隔 2-4 个事实点",
    "method_route": "方法路线与关键机制，必要时用中文分号分隔 2-4 个事实点",
    "data_experiment": "数据来源、样本规模、实验设置，必要时用中文分号分隔 2-4 个事实点",
    "baselines_metrics": "对比基线、评价指标、消融或统计口径，必要时用中文分号分隔 2-4 个事实点",
    "main_findings": "核心发现与关键结果，必要时用中文分号分隔 2-4 个事实点",
    "innovations": ["创新点 1", "创新点 2"],
    "limitations": ["局限或风险 1", "局限或风险 2"]
  }},
  "sections": [
    {{"heading": "研究背景与动机", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}},
    {{"heading": "研究问题", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}},
    {{"heading": "方法路线", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}},
    {{"heading": "数据与实验设置", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}},
    {{"heading": "对比基线与评价指标", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}},
    {{"heading": "核心发现", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}},
    {{"heading": "创新点", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}},
    {{"heading": "局限与风险", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}}
  ],
  "assistant_panels": [
    {{"title": "证据判断", "intent": "帮用户判断结论是否可靠", "items": ["回查关键结果表与实验设置，确认核心发现是否被充分支撑"]}},
    {{"title": "研究价值", "intent": "帮用户判断这篇文献如何进入综述", "items": ["说明这篇论文在比较矩阵、方法综述或局限讨论里适合承担什么角色"]}},
    {{"title": "下一步行动", "intent": "给用户可执行动作", "items": ["指出下一步应继续回查哪类证据，或适合与哪类论文做横向比较"]}}
  ],
  "missing_items": ["文中未说明但会影响比较或引用的具体缺失信息"],
  "followup_questions": ["指导继续回查全文、补证据或推进综述写作的问题"],
  "source_note": "本总结依据..."
}}

论文标题：{paper.title or paper.file_name}

【论文事实底稿】
{fact_sheet}

【关键页摘录】
{excerpts}

【用户标注】
{annotation_text or "暂无用户标注。"}"""
    else:
        prompt = f"""你正在为研究生阅读器生成“{config["title"]}”。

目标：{config["intent"]}
建议字数：{config["target_words"]} 中文字。
每个正文小节建议长度：{config["section_chars"]} 中文字符。
重点上下文：{config["focus"]}
必须包含的小节：{", ".join(config["sections"])}
补充规则：{config.get("extra_rules", "按该板块用途输出具体、有证据、可复用的内容。")}

质量要求：
1. 五个板块的写法必须不同，本次只生成“{config["title"]}”。
2. highlights 是顶部速览，每条只保留一个清晰结论，20-60 个中文字符即可。
3. section.body 才是正式总结，必须有信息密度：写清对象、方法/证据、结果/含义，不能只写标题式短语。
4. 每个 section.body 按本板块建议长度展开，通常写 2-4 个短段或分点；如果一个点内容太多，拆成多个 section，不要压缩成一句话。
5. keywords 用 2-6 个短标签，突出术语、数据集、指标、创新点、局限。
6. evidence 只能逐字摘自【关键页摘录】或【用户标注】，尽量给 3-8 条候选；系统会二次核验，匹配不到原文的证据会被删除。
7. missing_items 只列“具体缺失但会影响理解、复现、验证或综述引用”的信息，例如样本区间、变量定义、数据来源、参数、显著性、稳健性、实验环境、页码证据；如果只是泛泛的后续研究问题，不要放入 missing_items；没有具体缺失就返回空数组 []。
8. followup_questions 必须是可直接拿去问 AI 或指导用户回查原文的高价值问题，写清楚“围绕什么对象、为了什么目的、希望得到什么输出”；禁止输出“XX 如何影响 YY？”这种泛泛问题。
9. assistant_panels 是研究助手价值，不是摘要复述；必须给出“证据判断、研究价值、下一步行动”三类，每类 2-4 条，条目要具体到变量、页码、模型、数据、引用场景或复现动作。
10. annotations 类型只能围绕用户当前仍存在的标注，不要把全文总结冒充标注总结；必须按高亮、下划线、波浪线分别复盘。
11. 输出必须是 JSON，不要 Markdown，不要代码块。

JSON 结构：
{{
  "type": "{summary_type}",
  "title": "{config["title"]}",
  "preview": "120 字以内总览",
  "highlights": ["最重要结论 1", "最重要结论 2", "最重要结论 3"],
  "sections": [
    {{"heading": "研究问题", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}}
  ],
  "assistant_panels": [
    {{"title": "证据判断", "intent": "帮用户判断结论是否可靠", "items": ["回查结果表中长期/短期系数和显著性，确认核心结论是否被数据支持"]}},
    {{"title": "研究价值", "intent": "帮用户判断这篇文献怎么被使用", "items": ["可作为特定区域 FDI 决定因素研究的变量选择参考"]}},
    {{"title": "下一步行动", "intent": "给用户可执行动作", "items": ["先记录被解释变量和核心解释变量口径，再与另一篇 FDI 文献做变量对比"]}}
  ],
  "missing_items": ["文中未说明样本时间窗口，影响判断结论适用范围"],
  "followup_questions": ["请结合论文模型和结果表，解释绿色政策变量通过哪些机制影响 FDI，并区分短期与长期效应"],
  "source_note": "本总结依据..."
}}

论文标题：{paper.title or paper.file_name}

【论文事实底稿】
{fact_sheet}

【关键页摘录】
{excerpts}

【用户标注】
{annotation_text or "暂无用户标注。"}"""
    last_error: Exception | None = None
    for attempt in range(1, LLM_JSON_MAX_ATTEMPTS + 1):
        try:
            raw = ''
            for call_attempt in range(1, LLM_CALL_MAX_ATTEMPTS + 1):
                try:
                    raw = call_text_completion(base_url=base_url, api_key=api_key, model=model, prompt=prompt, max_tokens=7600)
                    break
                except Exception as exc:
                    last_error = exc
                    if call_attempt >= LLM_CALL_MAX_ATTEMPTS:
                        raise
                    sleep_before_retry(call_attempt)
            return parse_json_object(raw)
        except Exception as exc:
            last_error = exc
            if attempt >= LLM_JSON_MAX_ATTEMPTS:
                raise
            sleep_before_retry(attempt)
    raise last_error or RuntimeError("generate_typed_summary_failed")


def build_priority_excerpts(pages: list[PageText], *, max_chars: int) -> str:
    if not pages:
        return ""
    scored: list[tuple[int, PageText]] = []
    for page in pages:
        text_lower = page.text.lower()
        score = 0
        for keyword in (
            "abstract", "introduction", "method", "approach", "experiment", "evaluation",
            "result", "discussion", "conclusion", "limitation", "dataset", "ablation",
            "摘要", "引言", "方法", "实验", "结果", "结论", "局限", "数据集", "消融",
        ):
            if keyword in text_lower:
                score += 2
        if page.page <= 2 or page.page >= max(1, pages[-1].page - 1):
            score += 3
        scored.append((score, page))

    selected: list[PageText] = []
    seen: set[int] = set()
    for _score, page in sorted(scored, key=lambda item: item[0], reverse=True):
        if page.page in seen:
            continue
        selected.append(page)
        seen.add(page.page)
        if len(selected) >= 14:
            break
    selected.sort(key=lambda item: item.page)

    parts: list[str] = []
    used = 0
    for page in selected:
        remain = max_chars - used
        if remain <= 0:
            break
        snippet = page.text[: min(2200, remain)]
        parts.append(f"[第 {page.page} 页]\n{snippet}")
        used += len(snippet)
    return "\n\n".join(parts)


def sleep_before_retry(attempt: int) -> None:
    index = max(0, min(attempt - 1, len(LLM_RETRY_BACKOFF_SECONDS) - 1))
    time.sleep(LLM_RETRY_BACKOFF_SECONDS[index])


def format_annotations(annotations: list[dict[str, Any]], *, limit: int) -> str:
    rows = []
    for index, annotation in enumerate(annotations[:limit], start=1):
        label = ANNOTATION_TYPE_LABELS.get(str(annotation.get("type") or "highlight"), "标注")
        rows.append(f"{index}. 第 {annotation.get('page') or '?'} 页｜{label}｜{annotation.get('quote')}")
    return "\n".join(rows)


def build_annotation_fact_sheet(paper: Paper, annotations: list[dict[str, Any]]) -> str:
    groups = build_annotation_groups(annotations)
    lines = [
        f"论文标题：{paper.title or paper.file_name}",
        f"当前有效标注总数：{len(annotations)}",
        "标注总结只能基于以下当前仍存在的用户标注，不允许补写全文内容。",
    ]
    for group in groups:
        lines.append(f"\n【{group['label']}：{group['count']} 条】")
        if not group["items"]:
            lines.append("暂无。")
            continue
        for item in group["items"][:80]:
            lines.append(f"{item['index']}. 第 {item.get('page') or '?'} 页：{item.get('quote') or ''}")
    return "\n".join(lines)


def call_text_completion(*, base_url: str, api_key: str, model: str, prompt: str, max_tokens: int) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=180.0)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "你是严谨、具体、善于做研究生论文阅读总结的中文学术助手。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.25,
        max_tokens=max_tokens,
    )
    content = response.choices[0].message.content
    return content.strip() if content else ""


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = str(text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise ValueError("模型返回内容不是有效 JSON。")


def normalize_generated_summary(
    content: dict[str, Any],
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
    *,
    existing_content: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = SUMMARY_TYPES[summary_type]
    missing_items = normalize_string_list(content.get("missing_items"), 8)
    followup_questions = normalize_string_list(content.get("followup_questions"), 6)
    annotation_groups = build_annotation_groups(annotations) if summary_type == "annotations" else []
    normalized = {
        "type": summary_type,
        "title": str(content.get("title") or config["title"]),
        "preview": str(content.get("preview") or "")[:220],
        "highlights": normalize_string_list(content.get("highlights"), 3),
        "sections": normalize_sections(content.get("sections"), config["sections"], summary_type, pages, annotations),
        "annotation_groups": annotation_groups,
        "assistant_panels": normalize_assistant_panels(content.get("assistant_panels"), summary_type),
        "missing_items": filter_missing_items(missing_items),
        "followup_questions": filter_followup_questions(followup_questions),
        "source_note": str(content.get("source_note") or f"依据 {len(pages)} 页论文文本生成，来源依据已由系统核验。"),
    }
    if summary_type == "review":
        normalized["structured_fields"] = normalize_review_structured_fields(
            content.get("structured_fields"),
            content.get("sections"),
        )
        normalized["review_field_blocks"] = list(content.get("review_field_blocks") or [])
    if summary_type == "annotations":
        normalized["source_note"] = f"依据当前 {len(annotations)} 条用户标注生成，标注清单默认折叠展示，来源依据已由系统核验。"
    if not normalized["highlights"] and normalized["sections"]:
        normalized["highlights"] = [section["body"][:80] for section in normalized["sections"][:3]]
    if not normalized["preview"] and normalized["highlights"]:
        normalized["preview"] = "；".join(normalized["highlights"])[:180]
    if summary_type == "review":
        normalized = merge_manual_review_fields(existing_content, get_review_summary_content(normalized))
    return normalized


def normalize_sections(
    value: Any,
    required_headings: list[str],
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sections = value if isinstance(value, list) else []
    normalized: list[dict[str, Any]] = []
    for index, section in enumerate(sections[:12]):
        if not isinstance(section, dict):
            continue
        heading = str(section.get("heading") or required_headings[min(index, len(required_headings) - 1)])
        body = str(section.get("body") or "").strip()
        if not body:
            continue
        evidence_value = section.get("evidence") if isinstance(section.get("evidence"), list) else []
        evidence = build_verified_section_evidence(
            section={**section, "heading": heading, "body": body},
            section_index=index,
            evidence_value=evidence_value,
            summary_type=summary_type,
            pages=pages,
            annotations=annotations,
        )
        normalized.append({
            "heading": heading,
            "body": body,
            "keywords": normalize_string_list(section.get("keywords"), 6),
            "evidence": evidence,
        })
    return normalized


def build_annotation_groups(annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, Any]]] = {key: [] for key in ANNOTATION_TYPE_LABELS}
    for annotation in annotations:
        annotation_type = str(annotation.get("type") or "highlight")
        if annotation_type not in buckets:
            annotation_type = "highlight"
        buckets[annotation_type].append(annotation)

    groups: list[dict[str, Any]] = []
    for annotation_type, label in ANNOTATION_TYPE_LABELS.items():
        items: list[dict[str, Any]] = []
        sorted_annotations = sorted(
            buckets[annotation_type],
            key=lambda item: (int(item.get("page") or 0), int(item.get("start_char") or 0), int(item.get("id") or 0)),
        )
        for index, annotation in enumerate(sorted_annotations, start=1):
            quote = clean_text(annotation.get("quote") or "")
            if not quote:
                continue
            items.append(
                {
                    "id": annotation.get("id"),
                    "index": index,
                    "page": annotation.get("page"),
                    "quote": quote[:800],
                    "color": str(annotation.get("color") or ""),
                    "start_char": annotation.get("start_char"),
                    "end_char": annotation.get("end_char"),
                }
            )
        groups.append(
            {
                "type": annotation_type,
                "label": label,
                "count": len(items),
                "items": items,
            }
        )
    return groups


def build_verified_section_evidence(
    *,
    section: dict[str, Any],
    section_index: int,
    evidence_value: list[Any],
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in evidence_value[:8]:
        verified = verify_evidence_item(item, summary_type=summary_type, pages=pages, annotations=annotations)
        if not verified:
            continue
        key = evidence_key(verified)
        if key in seen:
            continue
        evidence.append(verified)
        seen.add(key)
        if len(evidence) >= 8:
            return evidence

    target_count = 8
    candidates = retrieve_evidence_candidates(
        section=section,
        section_index=section_index,
        summary_type=summary_type,
        pages=pages,
        annotations=annotations,
    )
    for candidate in candidates:
        key = evidence_key(candidate)
        if key in seen:
            continue
        evidence.append(candidate)
        seen.add(key)
        if len(evidence) >= target_count:
            break
    return evidence[:8]


def verify_evidence_item(
    item: Any,
    *,
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if isinstance(item, str):
        raw = {"quote": item}
    elif isinstance(item, dict):
        raw = item
    else:
        return None

    quote = clean_text(raw.get("quote") or "")
    if len(quote) < 12:
        return None
    source_type = str(raw.get("source_type") or ("annotation" if summary_type == "annotations" else "paper"))
    annotation_id = raw.get("annotation_id")

    if source_type == "annotation" or summary_type == "annotations":
        for annotation in annotations:
            annotation_quote = clean_text(annotation.get("quote") or "")
            if annotation_id and annotation.get("id") != annotation_id:
                continue
            if normalized_match(quote, annotation_quote):
                return {
                    "page": annotation.get("page"),
                    "quote": quote[:260],
                    "source_type": "annotation",
                    "annotation_id": annotation.get("id"),
                    "start_char": annotation.get("start_char"),
                    "end_char": annotation.get("end_char"),
                }
        return None

    page_number = normalize_page_number(raw.get("page"))
    pages_to_scan = [page for page in pages if page.page == page_number] if page_number else pages
    for page in pages_to_scan:
        match_range = find_quote_char_range(page.text, quote)
        if match_range:
            return {
                "page": page.page,
                "quote": quote[:260],
                "source_type": "paper",
                "start_char": match_range[0],
                "end_char": match_range[1],
            }
    return None


def retrieve_evidence_candidates(
    *,
    section: dict[str, Any],
    section_index: int,
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    terms = extract_evidence_terms(section)
    if summary_type == "annotations":
        candidates: list[tuple[int, int, dict[str, Any]]] = []
        for order, annotation in enumerate(annotations):
            quote = clean_text(annotation.get("quote") or "")
            if len(quote) < 12:
                continue
            score = score_text_for_terms(quote, terms)
            candidates.append(
                (
                    score,
                    -order,
                    {
                        "page": annotation.get("page"),
                        "quote": quote[:260],
                        "source_type": "annotation",
                        "annotation_id": annotation.get("id"),
                        "start_char": annotation.get("start_char"),
                        "end_char": annotation.get("end_char"),
                    },
                )
            )
        return [item for _score, _order, item in sorted(candidates, key=lambda row: (row[0], row[1]), reverse=True)]

    scored: list[tuple[int, int, dict[str, Any]]] = []
    for page in pages:
        for snippet_index, snippet in enumerate(split_source_snippets(page.text)):
            score = score_text_for_terms(snippet, terms)
            if score <= 0:
                continue
            match_range = find_quote_char_range(page.text, snippet)
            scored.append((
                score,
                -snippet_index,
                {
                    "page": page.page,
                    "quote": snippet[:260],
                    "source_type": "paper",
                    "start_char": match_range[0] if match_range else None,
                    "end_char": match_range[1] if match_range else None,
                },
            ))

    if scored:
        return [item for _score, _order, item in sorted(scored, key=lambda row: (row[0], row[1]), reverse=True)]

    fallback_pages = select_priority_pages_for_evidence(pages)
    if not fallback_pages:
        return []
    offset = section_index % len(fallback_pages)
    ordered_pages = fallback_pages[offset:] + fallback_pages[:offset]
    fallback: list[dict[str, Any]] = []
    for page in ordered_pages:
        for snippet in split_source_snippets(page.text)[:2]:
            if len(snippet) >= 30:
                match_range = find_quote_char_range(page.text, snippet)
                fallback.append({
                    "page": page.page,
                    "quote": snippet[:260],
                    "source_type": "paper",
                    "start_char": match_range[0] if match_range else None,
                    "end_char": match_range[1] if match_range else None,
                })
        if len(fallback) >= 4:
            break
    return fallback


def normalize_page_number(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def evidence_key(item: dict[str, Any]) -> str:
    return f"{item.get('source_type')}:{item.get('annotation_id') or ''}:{item.get('page') or ''}:{compact_text(item.get('quote') or '')[:80]}"


def normalized_match(needle: str, haystack: str) -> bool:
    compact_needle = compact_text(needle)
    compact_haystack = compact_text(haystack)
    if not compact_needle or not compact_haystack:
        return False
    if compact_needle in compact_haystack:
        return True
    return len(compact_needle) >= 80 and compact_needle[:80] in compact_haystack


def find_quote_char_range(haystack: str, needle: str) -> tuple[int, int] | None:
    source = str(haystack or "")
    target = clean_text(needle)
    if not source or len(target) < 8:
        return None
    direct_index = source.find(target)
    if direct_index >= 0:
        return direct_index, direct_index + len(target)
    compact_source = compact_text(source)
    compact_target = compact_text(target)
    if not compact_source or not compact_target:
        return None
    compact_index = compact_source.find(compact_target)
    if compact_index < 0:
        shortened = compact_target[:80] if len(compact_target) >= 80 else compact_target
        compact_index = compact_source.find(shortened) if len(shortened) >= 8 else -1
        if compact_index < 0:
            return None
        compact_target = shortened

    source_pointer = 0
    compact_pointer = 0
    start_char: int | None = None
    end_char: int | None = None
    while source_pointer < len(source):
        char = source[source_pointer]
        compact_char = compact_text(char)
        if compact_char:
            for piece in compact_char:
                if compact_pointer == compact_index and start_char is None:
                    start_char = source_pointer
                if compact_index <= compact_pointer < compact_index + len(compact_target):
                    end_char = source_pointer + 1
                compact_pointer += 1
        source_pointer += 1
        if end_char is not None and compact_pointer >= compact_index + len(compact_target):
            break
    if start_char is None or end_char is None or end_char <= start_char:
        return None
    return start_char, end_char


def compact_text(value: str) -> str:
    return re.sub(r"\W+", "", str(value or "").lower(), flags=re.UNICODE)


def extract_evidence_terms(section: dict[str, Any]) -> list[str]:
    keyword_text = " ".join(str(item) for item in section.get("keywords") or [])
    raw = clean_text(f"{section.get('heading') or ''} {keyword_text} {section.get('body') or ''}")
    terms = set()
    for word in re.findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", raw):
        terms.add(word.lower())
    for word in re.findall(r"[\u4e00-\u9fff]{2,8}", raw):
        terms.add(word)
    return list(terms)[:32]


def score_text_for_terms(text: str, terms: list[str]) -> int:
    if not terms:
        return 0
    compact = compact_text(text)
    score = 0
    for term in terms:
        if compact_text(term) in compact:
            score += 1
    return score


def split_source_snippets(text: str) -> list[str]:
    cleaned = clean_text(text)
    if not cleaned:
        return []
    sentences = [part.strip() for part in re.split(r"(?<=[。！？.!?；;])\s+", cleaned) if part.strip()]
    if len(sentences) <= 1:
        return [cleaned[index : index + 220].strip() for index in range(0, min(len(cleaned), 1200), 220) if cleaned[index : index + 220].strip()]

    snippets: list[str] = []
    buffer = ""
    for sentence in sentences:
        next_buffer = f"{buffer} {sentence}".strip() if buffer else sentence
        if len(next_buffer) < 120:
            buffer = next_buffer
            continue
        snippets.append(next_buffer[:260])
        buffer = ""
        if len(snippets) >= 24:
            break
    if buffer and len(snippets) < 24:
        snippets.append(buffer[:260])
    return snippets


def select_priority_pages_for_evidence(pages: list[PageText]) -> list[PageText]:
    if not pages:
        return []
    scored: list[tuple[int, PageText]] = []
    for page in pages:
        text_lower = page.text.lower()
        score = 0
        for keyword in (
            "abstract", "introduction", "method", "experiment", "result", "conclusion", "limitation",
            "摘要", "引言", "方法", "实验", "结果", "结论", "局限",
        ):
            if keyword in text_lower:
                score += 2
        if page.page <= 2 or page.page >= max(1, pages[-1].page - 1):
            score += 3
        scored.append((score, page))
    selected = [page for _score, page in sorted(scored, key=lambda item: item[0], reverse=True)[:10]]
    return sorted(selected, key=lambda page: page.page)


def normalize_string_list(value: Any, limit: int) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()][:limit]
    if isinstance(value, str) and value.strip():
        return [value.strip()[:160]]
    return []


def normalize_assistant_panels(value: Any, summary_type: str) -> list[dict[str, Any]]:
    defaults = {
        "overview": [
            ("证据判断", "判断论文结论是否值得信任"),
            ("研究价值", "判断这篇论文对选题、综述或方法有什么用"),
            ("下一步行动", "给出继续深读和回查的动作"),
        ],
        "annotations": [
            ("关注点复盘", "判断用户标注集中在哪些主题"),
            ("遗漏提醒", "提示还值得补标的论文部分"),
            ("下一步行动", "把标注转成可复习、可追问的任务"),
        ],
        "review": [
            ("证据判断", "判断变量、模型和结论是否足以支撑综述引用"),
            ("引用价值", "说明这篇文献适合放进综述的哪类论证"),
            ("下一步行动", "指导用户做多篇文献横向对比"),
        ],
        "reproduction": [
            ("复现风险", "判断哪些信息会卡住复现"),
            ("工程价值", "说明哪些方法或设置值得迁移到代码实现"),
            ("最小复现步骤", "给出从数据到结果的起步动作"),
        ],
        "meeting": [
            ("讨论价值", "判断哪些点适合在组会上展开讨论"),
            ("表达重点", "提示讲述时应突出什么"),
            ("下一步行动", "把汇报落到后续阅读或实验计划"),
        ],
    }
    panels = value if isinstance(value, list) else []
    normalized: list[dict[str, Any]] = []
    for index, panel in enumerate(panels[:4]):
        if not isinstance(panel, dict):
            continue
        title = str(panel.get("title") or "").strip()
        intent = str(panel.get("intent") or "").strip()
        items = normalize_string_list(panel.get("items"), 4)
        items = [item for item in items if len(item) >= 12]
        if not title or not items:
            continue
        normalized.append({"title": title[:24], "intent": intent[:80], "items": items})
    existing_titles = {panel["title"] for panel in normalized}
    for title, intent in defaults.get(summary_type, defaults["overview"]):
        if title not in existing_titles and len(normalized) < 3:
            normalized.append({"title": title, "intent": intent, "items": []})
    return normalized[:3]


def filter_missing_items(items: list[str]) -> list[str]:
    markers = (
        "未说明", "未交代", "未给出", "未报告", "未明确", "缺少", "缺失",
        "不清楚", "无法判断", "无法确认", "需要回查", "需回查", "没有说明",
    )
    filtered: list[str] = []
    for item in items:
        text = item.strip()
        if not text:
            continue
        if any(marker in text for marker in markers):
            filtered.append(text)
    return filtered[:6]


def filter_followup_questions(items: list[str]) -> list[str]:
    banned_patterns = (
        "如何影响",
        "有什么影响",
        "具体影响",
        "情况如何",
    )
    filtered: list[str] = []
    for item in items:
        text = item.strip()
        if len(text) < 12:
            continue
        if any(pattern in text and len(text) < 28 for pattern in banned_patterns):
            continue
        filtered.append(text)
    return filtered[:4]


def build_sparse_annotation_summary(summary_type: str, annotations: list[dict[str, Any]]) -> dict[str, Any]:
    config = SUMMARY_TYPES[summary_type]
    count = len(annotations)
    quotes = [
        {
            "page": item.get("page"),
            "quote": str(item.get("quote") or "")[:220],
            "source_type": "annotation",
            "annotation_id": item.get("id"),
            "start_char": item.get("start_char"),
            "end_char": item.get("end_char"),
        }
        for item in annotations
    ]
    if count == 0:
        body = ""
        highlights: list[str] = []
        sections: list[dict[str, Any]] = []
        missing_items: list[str] = []
    else:
        body = f"当前只有 {count} 条标注，适合做轻量复盘，还不足以形成稳定主题聚类。下面先保留这些标注的共同线索。"
        highlights = [f"已有 {count} 条标注，可继续补充方法、实验和局限相关内容。"]
        sections = [
            {
                "heading": "标注数量较少",
                "body": body,
                "keywords": ["当前标注", "轻量复盘"],
                "evidence": quotes,
            }
        ]
        missing_items = ["当前标注不足 3 条，暂不生成完整主题聚类。"]
    return {
        "type": summary_type,
        "title": config["title"],
        "preview": highlights[0] if highlights else "当前没有高亮、下划线或波浪线标注。",
        "highlights": highlights,
        "sections": sections,
        "annotation_groups": build_annotation_groups(annotations),
        "assistant_panels": [
            {
                "title": "下一步行动",
                "intent": "先补充阅读痕迹，再生成更有价值的标注复盘。",
                "items": ["继续标注方法、实验结果、局限和你想引用的句子，至少积累 3 条后再重新生成。"] if count else [],
            }
        ],
        "missing_items": missing_items,
        "followup_questions": ["我还应该标注哪些段落，才能形成更完整的阅读复盘？"] if count else [],
        "source_note": f"依据当前 {count} 条用户标注生成。",
    }
