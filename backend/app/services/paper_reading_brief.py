from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AiProvider, Paper, PaperReadingBrief
from app.schemas.paper_reading_brief import PaperReadingBriefContent
from app.services.ai_provider_manager import resolve_user_provider
from app.services.crypto import decrypt_api_key
from app.services.paper_context import extract_paper_full_text

PAPER_READING_BRIEF_PROMPT_VERSION = "v2"
RUNNING_BRIEF_STALE_AFTER = timedelta(minutes=15)
_SECTION_KEYS = (
    "background_and_pain_points",
    "research_objective",
    "core_methods_or_models",
    "results_and_comparisons",
    "conclusions_and_contributions",
    "limitations_and_boundaries",
)


def _clean_text(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split()).strip()
    return text[:limit].rstrip()


def _clean_pages(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    pages: list[int] = []
    for item in value:
        try:
            page = int(item)
        except (TypeError, ValueError):
            continue
        if page > 0 and page not in pages:
            pages.append(page)
        if len(pages) == 6:
            break
    return pages


def _clean_figures(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    figures: list[str] = []
    for item in value:
        figure = _clean_text(item, 40)
        if figure and figure not in figures:
            figures.append(figure)
        if len(figures) == 4:
            break
    return figures


def _clean_basis(value: Any) -> str:
    basis = str(value or "paper_explicit").strip().lower()
    if basis in {"paper_explicit", "paper_inference", "general_knowledge"}:
        return basis
    return "paper_explicit"


def _normalize_evidence(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = {"text": value}
    value = value if isinstance(value, dict) else {}
    return {
        "text": _clean_text(value.get("text"), 900) or "原文未明确说明。",
        "pages": _clean_pages(value.get("pages")),
        "figures": _clean_figures(value.get("figures")),
        "basis": _clean_basis(value.get("basis")),
    }


def _normalize_evidence_list(value: Any, *, limit: int = 5) -> list[dict[str, Any]]:
    entries = value if isinstance(value, list) else []
    normalized: list[dict[str, Any]] = []
    for entry in entries:
        item = _normalize_evidence(entry)
        if item["text"] not in {existing["text"] for existing in normalized}:
            normalized.append(item)
        if len(normalized) == limit:
            break
    return normalized or [_normalize_evidence({})]


def _normalize_terms(value: Any) -> list[dict[str, Any]]:
    terms = value if isinstance(value, list) else []
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in terms:
        if not isinstance(entry, dict):
            continue
        term = _clean_text(entry.get("term"), 160)
        standard = _clean_text(entry.get("standard_explanation"), 600)
        plain = _clean_text(entry.get("plain_explanation"), 600)
        key = term.lower()
        if not term or not standard or not plain or key in seen:
            continue
        normalized.append(
            {
                "term": term,
                "chinese_name": _clean_text(entry.get("chinese_name"), 160),
                "abbreviation": _clean_text(entry.get("abbreviation"), 80),
                "standard_explanation": standard,
                "plain_explanation": plain,
                "paper_role": _clean_text(entry.get("paper_role"), 360) or "原文未明确说明。",
                "pages": _clean_pages(entry.get("pages")),
                "figures": _clean_figures(entry.get("figures")),
                "basis": _clean_basis(entry.get("basis")),
            }
        )
        seen.add(key)
        if len(normalized) == 20:
            break
    return normalized


def normalize_paper_reading_brief(value: dict[str, Any] | None) -> dict[str, Any]:
    """Keep a resilient, display-safe eight-section contract despite model variation."""
    raw = value if isinstance(value, dict) else {}
    content: dict[str, Any] = {
        "one_sentence_conclusion": _normalize_evidence(raw.get("one_sentence_conclusion")),
        "key_terms": _normalize_terms(raw.get("key_terms")),
        "source_note": _clean_text(raw.get("source_note"), 240),
    }
    for key in _SECTION_KEYS:
        content[key] = _normalize_evidence_list(raw.get(key))
    return PaperReadingBriefContent.model_validate(content).model_dump()


def build_reading_brief_response(item: PaperReadingBrief | None) -> dict[str, Any]:
    if not item:
        return {
            "status": "idle",
            "stage": "idle",
            "progress": 0,
            "brief": None,
            "error_message": None,
            "updated_at": None,
            "model": "",
        }
    brief = None
    if item.status == "completed":
        brief = PaperReadingBriefContent.model_validate(
            normalize_paper_reading_brief(item.content_json)
        )
    return {
        "status": item.status if item.status in {"idle", "queued", "running", "completed", "failed"} else "failed",
        "stage": item.stage or "idle",
        "progress": max(0, min(100, int(item.progress or 0))),
        "brief": brief,
        "error_message": item.error_message,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "model": item.model or "",
    }


def mark_running_brief_stale(item: PaperReadingBrief) -> bool:
    if item.status not in {"queued", "running"}:
        return False
    updated_at = item.updated_at or item.created_at
    if not updated_at:
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - updated_at <= RUNNING_BRIEF_STALE_AFTER:
        return False
    item.status = "failed"
    item.stage = "failed"
    item.error_message = "生成进程已中断，请重试。"
    return True


def _mark_failed(db: Session, item: PaperReadingBrief, message: str) -> None:
    item.status = "failed"
    item.stage = "failed"
    item.error_message = _clean_text(message, 500) or "文献速读生成失败。"
    db.add(item)
    db.commit()


def run_paper_reading_brief_task(brief_id: int, provider_id: int | None = None) -> None:
    """Create one durable quick-read result in an isolated worker process."""
    from app.db.session import SessionLocal
    from app.services.llm import generate_paper_reading_brief

    db = SessionLocal()
    try:
        item = db.get(PaperReadingBrief, brief_id)
        if not item or item.status == "completed":
            return

        item.status = "running"
        item.stage = "extracting_full_text"
        item.progress = 12
        item.error_message = None
        db.add(item)
        db.commit()

        paper = db.scalar(
            select(Paper).where(
                Paper.id == item.paper_id,
                Paper.user_id == item.user_id,
                Paper.deleted_at.is_(None),
            )
        )
        if not paper:
            _mark_failed(db, item, "论文不存在或已被删除。")
            return

        full_text = extract_paper_full_text(paper.file_path)
        if len(full_text.strip()) < 100:
            _mark_failed(db, item, "未能提取到足够的 PDF 正文，暂时无法生成文献速读。")
            return

        provider = resolve_user_provider(
            db,
            item.user_id,
            provider_id,
            require_active=True,
            fallback_to_active=True,
        )
        if not provider:
            _mark_failed(db, item, "没有可用的 AI 厂商，请先在 AI 配置中启用一个。")
            return

        api_key = decrypt_api_key(provider.encrypted_api_key)
        if not api_key:
            _mark_failed(db, item, "当前 AI 厂商缺少有效密钥。")
            return

        item.provider_id = provider.id
        item.model = provider.model
        item.stage = "generating_brief"
        item.progress = 45
        db.add(item)
        db.commit()

        generated = generate_paper_reading_brief(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            paper_title=paper.title or paper.file_name,
            full_text=full_text,
        )
        if not generated:
            _mark_failed(db, item, "AI 未返回可解析的文献速读结构。")
            return

        item.stage = "checking_coverage"
        item.progress = 90
        db.add(item)
        db.commit()

        item.content_json = normalize_paper_reading_brief(generated)
        item.source_hash = sha256(full_text.encode("utf-8", errors="ignore")).hexdigest()
        item.prompt_version = PAPER_READING_BRIEF_PROMPT_VERSION
        item.status = "completed"
        item.stage = "completed"
        item.progress = 100
        item.error_message = None
        db.add(item)
        db.commit()
    except Exception as exc:
        item = db.get(PaperReadingBrief, brief_id)
        if item and item.status != "completed":
            _mark_failed(db, item, f"生成失败：{exc}")
    finally:
        db.close()
