from __future__ import annotations

import re
import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Paper, PaperAiOutline
from app.schemas.paper_ai_outline import PaperAiOutlineContent
from app.services.ai_provider_manager import resolve_user_provider
from app.services.crypto import decrypt_api_key
from app.services.paper_context import extract_paper_full_text, resolve_paper_file


PAPER_AI_OUTLINE_PROMPT_VERSION = "v1"
PAPER_AI_NATIVE_OUTLINE_PROMPT_VERSION = "native-titles-v1"
RUNNING_AI_OUTLINE_STALE_AFTER = timedelta(minutes=15)
_PAGE_MARKER_RE = re.compile(r"\[第\s+(\d+)\s+页\]")


def _clean_text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split()).strip()[:limit].rstrip()


def paper_source_fingerprint(file_url: str) -> str:
    """Detect a changed PDF cheaply before deciding to reuse a generated outline."""
    file_path = resolve_paper_file(file_url)
    if not file_path:
        return ""
    try:
        stat = Path(file_path).stat()
    except OSError:
        return ""
    payload = f"{Path(file_path).name}:{stat.st_size}:{stat.st_mtime_ns}"
    return sha256(payload.encode("utf-8")).hexdigest()


def _normalize_items(value: Any, *, depth: int = 0, max_page: int | None = None) -> list[dict[str, Any]]:
    if depth >= 3 or not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, int | None]] = set()
    for entry in value:
        if not isinstance(entry, dict):
            continue
        title_cn = _clean_text(entry.get("title_cn"), 180)
        title_en = _clean_text(entry.get("title_en"), 240)
        if not title_cn and not title_en:
            continue
        try:
            page = int(entry.get("page")) if entry.get("page") is not None else None
        except (TypeError, ValueError):
            page = None
        if page is not None and (page < 1 or (max_page is not None and page > max_page)):
            page = None
        key = ((title_en or title_cn).casefold(), page)
        if key in seen:
            continue
        seen.add(key)
        normalized.append({
            "title_cn": title_cn or title_en,
            "title_en": title_en,
            "page": page,
            "children": _normalize_items(entry.get("children"), depth=depth + 1, max_page=max_page),
        })
        if len(normalized) == 40:
            break
    return normalized


def normalize_paper_ai_outline(value: dict[str, Any] | None, *, full_text: str = "") -> dict[str, Any]:
    """Keep the model output small, page-safe and renderable as a three-level tree."""
    markers = [int(page) for page in _PAGE_MARKER_RE.findall(full_text)]
    max_page = max(markers) if markers else None
    raw = value if isinstance(value, dict) else {}
    content = {"items": _normalize_items(raw.get("items"), max_page=max_page)}
    return PaperAiOutlineContent.model_validate(content).model_dump()


def _normalize_native_items(value: Any, *, depth: int = 0) -> list[dict[str, Any]]:
    """Preserve a PDF bookmark tree while making its source labels explicit English fields."""
    if depth >= 3 or not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        title_en = _clean_text(entry.get("title_en") or entry.get("title_cn"), 240)
        children = _normalize_native_items(entry.get("children"), depth=depth + 1)
        if not title_en and not children:
            continue
        try:
            page = int(entry.get("page")) if entry.get("page") is not None else None
        except (TypeError, ValueError):
            page = None
        normalized.append({
            "title_cn": "",
            "title_en": title_en,
            "page": page if page and page > 0 else None,
            "children": children,
        })
        if len(normalized) == 40:
            break
    return normalized


def normalize_native_paper_outline(value: Any) -> dict[str, Any]:
    raw = value.model_dump() if isinstance(value, PaperAiOutlineContent) else value
    raw_items = raw.get("items") if isinstance(raw, dict) else raw
    return PaperAiOutlineContent.model_validate({"items": _normalize_native_items(raw_items)}).model_dump()


def native_paper_outline_hash(outline: dict[str, Any]) -> str:
    canonical = json.dumps(outline, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def merge_native_outline_translations(
    outline: dict[str, Any],
    translations: dict[str, str],
    *,
    path: str = "",
) -> dict[str, Any]:
    """Attach AI Chinese explanations without allowing a model to alter native page links or English labels."""
    merged: list[dict[str, Any]] = []
    for index, entry in enumerate(outline.get("items") or []):
        item_path = f"{path}.{index}" if path else str(index)
        title_en = _clean_text(entry.get("title_en"), 240)
        children = merge_native_outline_translations(
            {"items": entry.get("children") or []},
            translations,
            path=item_path,
        )["items"]
        merged.append({
            "title_cn": _clean_text(translations.get(item_path), 180),
            "title_en": title_en,
            "page": entry.get("page"),
            "children": children,
        })
    return PaperAiOutlineContent.model_validate({"items": merged}).model_dump()


def native_outline_has_missing_translations(outline: dict[str, Any]) -> bool:
    for item in outline.get("items") or []:
        if item.get("title_en") and not item.get("title_cn"):
            return True
        if native_outline_has_missing_translations({"items": item.get("children") or []}):
            return True
    return False


def build_paper_ai_outline_response(item: PaperAiOutline | None) -> dict[str, Any]:
    if not item:
        return {
            "status": "idle",
            "stage": "idle",
            "progress": 0,
            "outline": None,
            "error_message": None,
            "updated_at": None,
            "model": "",
        }
    outline = None
    if item.status == "completed":
        outline = PaperAiOutlineContent.model_validate(item.content_json or {})
    return {
        "status": item.status if item.status in {"idle", "queued", "running", "completed", "failed"} else "failed",
        "stage": item.stage or "idle",
        "progress": max(0, min(100, int(item.progress or 0))),
        "outline": outline,
        "error_message": item.error_message,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "model": item.model or "",
        "mode": "native_titles" if item.prompt_version == PAPER_AI_NATIVE_OUTLINE_PROMPT_VERSION else "generated",
    }


def mark_running_ai_outline_stale(item: PaperAiOutline) -> bool:
    if item.status not in {"queued", "running"}:
        return False
    updated_at = item.updated_at or item.created_at
    if not updated_at:
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - updated_at <= RUNNING_AI_OUTLINE_STALE_AFTER:
        return False
    item.status = "failed"
    item.stage = "failed"
    item.error_message = "目录生成进程已中断，请重试。"
    return True


def _mark_failed(db: Session, item: PaperAiOutline, message: str) -> None:
    item.status = "failed"
    item.stage = "failed"
    item.error_message = _clean_text(message, 500) or "AI 目录生成失败。"
    db.add(item)
    db.commit()


def run_paper_ai_outline_task(outline_id: int, provider_id: int | None = None) -> None:
    """Create one cached bilingual outline in an isolated process."""
    from app.db.session import SessionLocal
    from app.services.llm import generate_paper_ai_outline, translate_native_outline_titles

    db = SessionLocal()
    try:
        item = db.get(PaperAiOutline, outline_id)
        if not item or item.status == "completed":
            return
        native_outline = normalize_native_paper_outline((item.content_json or {}).get("_native_outline"))
        has_native_outline = bool(native_outline["items"])
        item.status = "running"
        item.stage = "preparing_native_titles" if has_native_outline else "extracting_full_text"
        item.progress = 12
        item.error_message = None
        db.add(item)
        db.commit()

        paper = db.scalar(select(Paper).where(
            Paper.id == item.paper_id,
            Paper.user_id == item.user_id,
            Paper.deleted_at.is_(None),
        ))
        if not paper:
            _mark_failed(db, item, "论文不存在或已被删除。")
            return

        provider = resolve_user_provider(db, item.user_id, provider_id, require_active=True, fallback_to_active=True)
        if not provider:
            _mark_failed(db, item, "没有可用的 AI 厂商，请先在 AI 配置中启用一个。")
            return
        api_key = decrypt_api_key(provider.encrypted_api_key)
        if not api_key:
            _mark_failed(db, item, "当前 AI 厂商缺少有效密钥。")
            return

        item.provider_id = provider.id
        item.model = provider.model
        item.stage = "translating_native_titles" if has_native_outline else "generating_outline"
        item.progress = 45
        db.add(item)
        db.commit()

        if has_native_outline:
            translations = translate_native_outline_titles(
                base_url=provider.base_url,
                api_key=api_key,
                model=provider.model,
                paper_title=paper.title or paper.file_name,
                outline=native_outline,
            )
            outline = merge_native_outline_translations(native_outline, translations)
            if native_outline_has_missing_translations(outline):
                _mark_failed(db, item, "AI 未完整返回原生目录的中文释义，请重试。")
                return
            item.stage = "checking_native_titles"
            source_hash = native_paper_outline_hash(native_outline)
            prompt_version = PAPER_AI_NATIVE_OUTLINE_PROMPT_VERSION
        else:
            full_text = extract_paper_full_text(paper.file_path)
            if len(full_text.strip()) < 100:
                _mark_failed(db, item, "未能提取到足够的 PDF 正文，暂时无法生成目录。")
                return
            generated = generate_paper_ai_outline(
                base_url=provider.base_url,
                api_key=api_key,
                model=provider.model,
                paper_title=paper.title or paper.file_name,
                full_text=full_text,
            )
            outline = normalize_paper_ai_outline(generated, full_text=full_text)
            if not outline["items"]:
                _mark_failed(db, item, "AI 未返回可用的带页码目录，请重试或使用缩略图浏览。")
                return
            item.stage = "checking_page_references"
            source_hash = sha256(full_text.encode("utf-8", errors="ignore")).hexdigest()
            prompt_version = PAPER_AI_OUTLINE_PROMPT_VERSION

        item.progress = 90
        db.add(item)
        db.commit()

        item.content_json = outline
        item.source_fingerprint = paper_source_fingerprint(paper.file_path)
        item.source_hash = source_hash
        item.prompt_version = prompt_version
        item.status = "completed"
        item.stage = "completed"
        item.progress = 100
        item.error_message = None
        db.add(item)
        db.commit()
    except Exception as exc:
        item = db.get(PaperAiOutline, outline_id)
        if item and item.status != "completed":
            _mark_failed(db, item, f"目录生成失败：{exc}")
    finally:
        db.close()
