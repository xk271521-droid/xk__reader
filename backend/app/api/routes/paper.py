from __future__ import annotations

import json
import re
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from time import time_ns
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, update as sql_update
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import AiProvider, Folder, Paper, PaperFullTranslation, User
from app.schemas.paper import (
    FolderCreate,
    FullTranslationResponse,
    FullTranslationStartRequest,
    FolderResponse,
    FolderUpdate,
    PaperMetadata,
    PaperResponse,
    PaperUpdate,
)
from app.services.crypto import decrypt_api_key
from app.services.translate import translate_title

router = APIRouter(prefix="/papers", tags=["papers"])

ALLOWED_PDF_TYPES = {"application/pdf"}


def build_folder_response(folder: Folder) -> FolderResponse:
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        created_at=folder.created_at.isoformat() if folder.created_at else None,
    )


def build_paper_response(paper: Paper) -> PaperResponse:
    return PaperResponse(
        id=paper.id,
        folder_id=paper.folder_id,
        file_name=paper.file_name,
        file_size=paper.file_size,
        title=paper.title or "",
        translated_title=paper.translated_title,
        author=paper.author,
        subject=paper.subject,
        keywords=paper.keywords,
        creator=paper.creator,
        producer=paper.producer,
        creation_date=paper.creation_date,
        modification_date=paper.modification_date,
        doi=paper.doi,
        page_count=paper.page_count,
        last_viewed_at=paper.last_viewed_at.isoformat() if paper.last_viewed_at else None,
        created_at=paper.created_at.isoformat() if paper.created_at else None,
    )


def build_full_translation_response(item: PaperFullTranslation | None) -> FullTranslationResponse:
    if not item:
        return FullTranslationResponse()
    pending_blocks_count = sum(
        1
        for page in (item.pages_json or [])
        for block in (page.get("blocks") or [])
        if block.get("status") == "pending"
    )
    failed_blocks_count = sum(
        1
        for page in (item.pages_json or [])
        for block in (page.get("blocks") or [])
        if block.get("status") == "failed"
    )
    return FullTranslationResponse(
        status=item.status if item.status in {"idle", "running", "completed", "error", "cancelled"} else "idle",
        source_hash=item.source_hash or "",
        pages=item.pages_json or [],
        completed_units=item.completed_units or 0,
        total_units=item.total_units or 0,
        error_message=item.error_message,
        provider_id=item.provider_id,
        parse_mode=getattr(item, "parse_mode", "auto") or "auto",
        parse_engine=getattr(item, "parse_engine", "local") or "local",
        parse_summary=getattr(item, "parse_summary", None) or {},
        translation_engine=getattr(item, "translation_engine", "ai") or "ai",
        termbase_version=getattr(item, "termbase_version", "") or "",
        failed_blocks_count=failed_blocks_count + pending_blocks_count,
        pending_blocks_count=pending_blocks_count,
    )


COPY_BLOCK_TYPES = {"formula", "image", "table", "page_meta"}
COPY_BLOCK_KINDS = {"footer", "caption"}


def normalize_block_type(block: dict) -> str:
    kind = str(block.get("kind") or "paragraph").strip() or "paragraph"
    block_type = str(block.get("type") or "").strip() or "text"
    text = str(block.get("source_text") or "").strip()
    if kind == "caption":
        block_type = "caption"
    if re.search(r"^(fig\.|figure|table)\s*\d+", text, re.I):
        block_type = "caption"
    if re.search(r"[∑∫√≈≤≥∞α-ωΑ-Ω]|\\[a-zA-Z]+|\$[^$]+\$", text):
        block_type = "formula"
    block["type"] = block_type
    return block_type


def should_copy_block(block: dict) -> bool:
    block_type = normalize_block_type(block)
    kind = str(block.get("kind") or "").strip()
    return bool(
        block.get("skip_translate")
        or block_type in COPY_BLOCK_TYPES
        or kind in COPY_BLOCK_KINDS
        or str(block.get("translate_policy") or "") in {"copy", "skip"}
    )


def normalize_translation_pages(pages: list[dict]) -> list[dict]:
    normalized = deepcopy(pages or [])
    for page in normalized:
        for block in page.get("blocks") or []:
            normalize_block_type(block)
            if should_copy_block(block):
                block["translate_policy"] = "copy"
                block["status"] = "copied"
                block["translated_text"] = block.get("source_text", "")
            else:
                block["translate_policy"] = "translate"
                block["status"] = block.get("status") if block.get("status") in {"translated", "failed"} else "pending"
                block["translated_text"] = block.get("translated_text", "")
    return normalized


def count_translatable_units(pages: list[dict]) -> int:
    return sum(
        1
        for page in pages or []
        for block in page.get("blocks") or []
        if not should_copy_block(block) and str(block.get("source_text") or "").strip()
    )


def get_translation_source_hash(pages: list[dict]) -> str:
    payload = []
    for page in pages or []:
        payload.append({
            "page_number": page.get("page_number"),
            "width": page.get("width"),
            "height": page.get("height"),
            "blocks": [
                {
                    "id": block.get("id"),
                    "source_text": block.get("source_text"),
                    "bbox": block.get("bbox"),
                    "skip_translate": block.get("skip_translate"),
                }
                for block in page.get("blocks") or []
            ],
        })
    return sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def build_translation_cache_key(parse_mode: str, parse_engine: str, local_hash: str, translation_engine: str = "ai", termbase_version: str = "") -> str:
    return f"{parse_mode}:{parse_engine}:{translation_engine}:{termbase_version}:{local_hash}"


def is_completed_translation_cache_hit(
    item: PaperFullTranslation | None,
    *,
    parse_mode: str,
    local_hash: str,
    translation_engine: str = "ai",
    termbase_version: str = "",
) -> bool:
    if not item or item.status != "completed":
        return False
    if any(
        block.get("status") in {"pending", "failed"}
        for page in (item.pages_json or [])
        for block in (page.get("blocks") or [])
    ):
        return False
    source_hash = item.source_hash or ""
    if source_hash == local_hash:
        return True
    if source_hash == build_translation_cache_key(parse_mode, "local", local_hash, translation_engine, termbase_version):
        return True
    legacy_prefix = f"{parse_mode}:local:"
    if source_hash == f"{legacy_prefix}{local_hash}":
        return True
    if parse_mode == "auto" and source_hash.startswith(f"auto:aliyun:{translation_engine}:{termbase_version}:"):
        return True
    if parse_mode == "aliyun" and source_hash.startswith(f"aliyun:aliyun:{translation_engine}:{termbase_version}:"):
        return True
    return False


def load_active_provider(db: Session, provider_id: int | None = None) -> AiProvider | None:
    provider = None
    if provider_id:
        provider = db.scalar(
            select(AiProvider).where(
                AiProvider.id == provider_id,
                AiProvider.is_active.is_(True),
            )
        )
    if provider:
        return provider
    return db.scalar(
        select(AiProvider)
        .where(AiProvider.is_active.is_(True))
        .order_by(AiProvider.sort_order)
        .limit(1)
    )


def contains_cjk_text(text: str) -> bool:
    return any("\u3400" <= char <= "\u9fff" for char in text or "")


def is_allowed_untranslated_block(block: dict, text: str) -> bool:
    import re

    value = str(text or "").strip()
    if block.get("skip_translate"):
        return True
    if not value:
        return False
    if re.match(r"^(https?://|doi:|www\.)", value, re.I):
        return True
    if re.match(r"^[\d\s()[\].,;:/\\+\-=<>%°]+$", value):
        return True
    return False


def get_download_translation_text(block: dict) -> str:
    translated = str(block.get("translated_text") or "").strip()
    source = str(block.get("source_text") or "").strip()
    if block.get("status") == "failed":
        return f"[未译] {source}" if source else ""
    if translated and (contains_cjk_text(translated) or is_allowed_untranslated_block(block, translated)):
        return translated
    if source and is_allowed_untranslated_block(block, source):
        return source
    if translated:
        return f"[未译] {translated}"
    if source:
        return f"[未译] {source}"
    return ""


def detect_local_parse_quality(pages: list[dict]) -> dict:
    total_pages = len(pages or [])
    blocks = [block for page in pages or [] for block in page.get("blocks") or []]
    source_texts = [str(block.get("source_text") or "").strip() for block in blocks if str(block.get("source_text") or "").strip()]
    all_text = "\n".join(source_texts)
    text_chars = len(re.sub(r"\s+", "", all_text))
    mojibake_hits = len(re.findall(r"[锟�]|[鐚€畬殏炕璇戞枃鍙傝€冩憳鎽樿]{2,}", all_text))
    tiny_blocks = sum(1 for text in source_texts if len(text) <= 3)
    avg_chars_per_page = text_chars / max(1, total_pages)
    tiny_ratio = tiny_blocks / max(1, len(source_texts))
    reasons = []
    if text_chars < max(80, total_pages * 120):
        reasons.append("文本过少，可能是扫描件或图片型 PDF")
    if avg_chars_per_page < 180:
        reasons.append("平均每页文字过少")
    if mojibake_hits >= 2:
        reasons.append("检测到明显乱码")
    if tiny_ratio > 0.35 and len(source_texts) > 30:
        reasons.append("文本块过碎，版式可能较复杂")
    return {
        "total_pages": total_pages,
        "total_blocks": len(blocks),
        "text_chars": text_chars,
        "avg_chars_per_page": round(avg_chars_per_page, 1),
        "tiny_block_ratio": round(tiny_ratio, 3),
        "mojibake_hits": mojibake_hits,
        "needs_cloud": bool(reasons),
        "reasons": reasons,
    }


def blocks_from_markdown(markdown: str, page_width: float = 595.0, page_height: float = 842.0) -> list[dict]:
    blocks = []
    current: list[str] = []

    def flush() -> None:
        if not current:
            return
        text = " ".join(line.strip() for line in current if line.strip()).strip()
        current.clear()
        if not text:
            return
        index = len(blocks) + 1
        is_heading = text.startswith("#")
        cleaned = re.sub(r"^#+\s*", "", text).strip()
        kind = "heading" if is_heading else "paragraph"
        blocks.append({
            "id": f"p1-a{index}",
            "kind": kind,
            "type": "text",
            "source_text": cleaned,
            "translated_text": "",
            "bbox": [48, 64 + (index - 1) * 28, page_width - 48, 90 + (index - 1) * 28],
            "font_size": 15 if is_heading else 12,
            "font_weight": 700 if is_heading else 400,
            "align": "left",
            "skip_translate": False,
            "translate_policy": "translate",
            "status": "pending",
        })

    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if stripped.startswith(("![](", "![", "<img")):
            flush()
            index = len(blocks) + 1
            blocks.append({
                "id": f"p1-img{index}",
                "kind": "caption",
                "type": "image",
                "source_text": "图片/图表（已保留原文区域）",
                "translated_text": "图片/图表（已保留原文区域）",
                "bbox": [48, 64 + (index - 1) * 28, page_width - 48, 120 + (index - 1) * 28],
                "font_size": 12,
                "font_weight": 400,
                "align": "left",
                "skip_translate": True,
                "translate_policy": "copy",
                "status": "copied",
            })
            continue
        if stripped.startswith("|"):
            flush()
            index = len(blocks) + 1
            blocks.append({
                "id": f"p1-table{index}",
                "kind": "caption",
                "type": "table",
                "source_text": stripped,
                "translated_text": stripped,
                "bbox": [48, 64 + (index - 1) * 28, page_width - 48, 112 + (index - 1) * 28],
                "font_size": 12,
                "font_weight": 400,
                "align": "left",
                "skip_translate": True,
                "translate_policy": "copy",
                "status": "copied",
            })
            continue
        current.append(stripped)
    flush()
    return blocks


def pages_from_aliyun_result(result: dict, fallback_pages: list[dict]) -> list[dict]:
    markdown = str(result.get("markdown") or "").strip()
    if not markdown:
        return fallback_pages
    first_page = fallback_pages[0] if fallback_pages else {}
    width = float(first_page.get("width") or 595)
    height = float(first_page.get("height") or 842)
    blocks = blocks_from_markdown(markdown, width, height)
    return [{
        "page_number": 1,
        "width": width,
        "height": max(height, 120 + len(blocks) * 34),
        "blocks": blocks,
    }]


def maybe_enhance_pages_with_aliyun(paper: Paper, pages: list[dict], parse_mode: str) -> tuple[list[dict], str, dict]:
    quality = detect_local_parse_quality(pages)
    requested = parse_mode == "aliyun"
    forbidden = parse_mode == "local"
    summary = {
        "mode": parse_mode,
        "local_pages": len(pages or []),
        "aliyun_pages": 0,
        "quality": quality,
        "aliyun_available": settings.aliyun_docmind_available,
    }
    if forbidden:
        summary["decision"] = "local_forced"
        return pages, "local", summary
    if not requested and not quality["needs_cloud"]:
        summary["decision"] = "local_quality_ok"
        return pages, "local", summary
    if not settings.aliyun_docmind_available:
        summary["decision"] = "aliyun_unavailable"
        summary["warning"] = "阿里云文档智能未启用，已使用本地解析。"
        return pages, "local", summary

    actual_file = _resolve_paper_file(paper.file_path)
    if not actual_file or not actual_file.exists():
        summary["decision"] = "paper_file_missing"
        summary["warning"] = "论文文件已丢失，无法调用阿里云解析。"
        return pages, "local", summary

    try:
        from app.services.docmind import parse_document_with_aliyun

        result = parse_document_with_aliyun(actual_file, high_precision=requested)
        enhanced_pages = normalize_translation_pages(pages_from_aliyun_result(result, pages))
        summary["decision"] = "aliyun_used"
        summary["aliyun_pages"] = len(enhanced_pages)
        summary["job_id"] = result.get("job_id")
        return enhanced_pages, "aliyun", summary
    except Exception as exc:
        summary["decision"] = "aliyun_failed_fallback_local"
        summary["warning"] = str(exc)[:300]
        return pages, "local", summary


def run_full_translation_task(translation_id: int, provider_id: int | None) -> None:
    from app.db.session import SessionLocal
    from app.services.llm import translate_full_text_blocks
    from app.services.machine_translation import get_translation_engine, translate_with_tencent_mt
    from app.services.termbase import load_termbase

    db = SessionLocal()
    try:
        item = db.get(PaperFullTranslation, translation_id)
        if not item:
            return
        if item.status == "cancelled":
            return

        translation_engine = get_translation_engine()
        provider = load_active_provider(db, provider_id)
        if translation_engine == "ai" and not provider:
            item.status = "error"
            item.error_message = "没有可用的 AI 厂商，请先在 AI 配置中启用一个。"
            db.add(item)
            db.commit()
            return

        terms, termbase_version = load_termbase()
        item.provider_id = provider.id if provider else None
        item.translation_engine = translation_engine
        item.termbase_version = termbase_version
        item.status = "running"
        item.error_message = None
        db.add(item)
        db.commit()

        api_key = decrypt_api_key(provider.encrypted_api_key) if provider else ""
        pages = deepcopy(item.pages_json or [])
        completed = 0
        cancelled = False
        batch: list[dict[str, str]] = []
        block_refs: list[dict] = []

        def refresh_cancel_state() -> bool:
            nonlocal item
            item = db.get(PaperFullTranslation, translation_id)
            return not item or item.status == "cancelled"

        def flush_batch() -> None:
            nonlocal completed, batch, block_refs, item, pages, cancelled
            if not batch:
                return
            if refresh_cancel_state():
                cancelled = True
                batch = []
                block_refs = []
                return
            translated: dict[str, str] = {}
            if translation_engine == "tencent_mt":
                try:
                    translated = translate_with_tencent_mt(items=batch, terms=terms)
                except Exception:
                    translated = {}
            missing_batch = [entry for entry in batch if entry.get("id") not in translated]
            if missing_batch and provider:
                translated.update(
                    translate_full_text_blocks(
                        base_url=provider.base_url,
                        api_key=api_key,
                        model=provider.model,
                        items=missing_batch,
                    )
                )
            if refresh_cancel_state():
                cancelled = True
                batch = []
                block_refs = []
                return
            for block in block_refs:
                translated_text = str(translated.get(block.get("id")) or "").strip()
                if translated_text and (contains_cjk_text(translated_text) or is_allowed_untranslated_block(block, translated_text)):
                    block["translated_text"] = translated_text
                    block["status"] = "translated"
                    block["translation_engine"] = translation_engine
                else:
                    block["translated_text"] = ""
                    block["status"] = "failed"
                    block["translation_engine"] = translation_engine
            completed += len(batch)
            item = db.get(PaperFullTranslation, translation_id)
            if not item:
                return
            if item.status == "cancelled":
                cancelled = True
                batch = []
                block_refs = []
                return
            item.pages_json = pages
            flag_modified(item, "pages_json")
            item.completed_units = completed
            item.status = "running"
            db.add(item)
            db.commit()
            batch = []
            block_refs = []

        for page in pages:
            for block in page.get("blocks") or []:
                if cancelled:
                    break
                source_text = str(block.get("source_text") or "").strip()
                if should_copy_block(block) or not source_text:
                    block["translated_text"] = source_text
                    block["translate_policy"] = "copy"
                    block["status"] = "copied"
                    continue
                batch.append({"id": block.get("id", ""), "text": source_text})
                block_refs.append(block)
                if len(batch) >= 5:
                    flush_batch()
            if cancelled:
                break
        if not cancelled:
            flush_batch()

        item = db.get(PaperFullTranslation, translation_id)
        if item:
            if item.status == "cancelled" or cancelled:
                item.pages_json = pages
                flag_modified(item, "pages_json")
                item.status = "cancelled"
                item.error_message = item.error_message or "已取消全文翻译。"
            else:
                item.pages_json = pages
                flag_modified(item, "pages_json")
                item.completed_units = item.total_units
                item.status = "completed"
                item.error_message = None
            db.add(item)
            db.commit()
    except Exception as exc:
        item = db.get(PaperFullTranslation, translation_id)
        if item:
            item.status = "error"
            item.error_message = str(exc)[:500]
            db.add(item)
            db.commit()
    finally:
        db.close()


# ── Folders ──────────────────────────────────────────────


@router.get("/folders", response_model=list[FolderResponse])
def list_folders(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[FolderResponse]:
    folders = db.scalars(
        select(Folder).where(Folder.user_id == current_user.id).order_by(Folder.id)
    ).all()

    # 确保老用户也有"未分类"文件夹
    if not any(f.name == "未分类" for f in folders):
        uncategorized = Folder(user_id=current_user.id, name="未分类")
        db.add(uncategorized)
        db.commit()
        db.refresh(uncategorized)
        folders = [uncategorized] + list(folders)

    return [build_folder_response(f) for f in folders]


@router.post("/folders", response_model=FolderResponse)
def create_folder(
    payload: FolderCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FolderResponse:
    existing = db.scalar(
        select(Folder).where(
            Folder.user_id == current_user.id,
            Folder.name == payload.name,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="已有同名文件夹。")

    folder = Folder(user_id=current_user.id, name=payload.name)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return build_folder_response(folder)


@router.patch("/folders/{folder_id}", response_model=FolderResponse)
def rename_folder(
    folder_id: int,
    payload: FolderUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FolderResponse:
    folder = db.scalar(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在。")

    if folder.name == "未分类":
        raise HTTPException(status_code=403, detail="未分类文件夹不可修改。")

    # 检查同名
    if payload.name != folder.name:
        existing = db.scalar(
            select(Folder).where(
                Folder.user_id == current_user.id,
                Folder.name == payload.name,
            )
        )
        if existing:
            raise HTTPException(status_code=409, detail="已有同名文件夹。")

    folder.name = payload.name
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return build_folder_response(folder)


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_folder(
    folder_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    folder = db.scalar(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在。")

    if folder.name == "未分类":
        raise HTTPException(status_code=403, detail="未分类文件夹不可删除。")

    # 将该文件夹下的论文移到用户的"未分类"文件夹
    uncategorized = db.scalar(
        select(Folder).where(
            Folder.user_id == current_user.id,
            Folder.name == "未分类",
        )
    )
    if uncategorized:
        db.execute(
            sql_update(Paper).where(Paper.folder_id == folder_id).values(folder_id=uncategorized.id)
        )

    db.delete(folder)
    db.commit()


# ── Papers ───────────────────────────────────────────────


@router.get("/references")
def get_references(doi: str = ""):
    """通过多个 API 获取参考文献"""
    if not doi:
        return {"references": [], "source": ""}

    from urllib.request import Request, urlopen
    from urllib.parse import quote

    def try_crossref():
        url = f"https://api.crossref.org/works/{doi}"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        raw = (data.get("message") or {}).get("reference") or []
        if not raw:
            return None
        refs = []
        for r in raw:
            refs.append({
                "title": r.get("article-title") or r.get("unstructured") or "",
                "authors": r.get("author", ""),
                "year": r.get("year"),
                "journal": r.get("journal-title", ""),
                "doi": r.get("DOI", ""),
            })
        return (refs, f"Crossref ({len(raw)} 条)")

    def try_semantic_scholar():
        url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=paperId"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        paper_id = __import__("json").loads(resp.read()).get("paperId")
        if not paper_id:
            return None
        url2 = f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}/references?limit=1000&fields=title,authors,year,journal,externalIds"
        req2 = Request(url2, headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=8)
        data = __import__("json").loads(resp2.read())
        raw = data.get("data") or []
        if not raw:
            return None
        refs = []
        for r in raw:
            p = r.get("citedPaper") or {}
            authors = p.get("authors") or []
            author_str = ", ".join(a.get("name", "") for a in authors[:3])
            if len(authors) > 3:
                author_str += " et al."
            refs.append({
                "title": p.get("title", ""),
                "authors": author_str,
                "year": p.get("year"),
                "journal": (p.get("journal") or {}).get("name") if p.get("journal") else "",
                "doi": (p.get("externalIds") or {}).get("DOI", ""),
            })
        return (refs, f"Semantic Scholar ({len(raw)} 条)")

    def try_openalex():
        import ssl
        ctx = ssl._create_unverified_context()
        url = f"https://api.openalex.org/works/doi:{doi}"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        ref_ids = data.get("referenced_works") or []
        if not ref_ids:
            return None
        batch = ref_ids[:50]
        batch_str = "|".join(b.rsplit("/", 1)[-1] for b in batch)
        url2 = "https://api.openalex.org/works?filter=" + quote("openalex_id:" + batch_str) + "&per_page=100"
        req2 = Request(url2, headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=10)
        data2 = __import__("json").loads(resp2.read())
        refs = []
        for r in data2.get("results") or []:
            refs.append({
                "title": r.get("title", ""),
                "authors": ", ".join(
                    (a.get("author") or {}).get("display_name", "")
                    for a in (r.get("authorships") or [])[:3]
                ),
                "year": r.get("publication_year"),
                "journal": ((r.get("primary_location") or {}).get("source") or {}).get("display_name", ""),
                "doi": (r.get("doi") or "").replace("https://doi.org/", ""),
            })
        return (refs, f"OpenAlex ({len(raw)} 条)")

    for fn in (try_crossref, try_semantic_scholar, try_openalex):
        try:
            result = fn()
            if result:
                return {"references": result[0], "source": result[1]}
        except Exception:
            continue

    return {"references": [], "source": "所有来源均无数据"}


@router.get("/citations")
def get_citations(doi: str = ""):
    """获取引用该论文的其他论文"""
    if not doi:
        return {"citations": [], "source": ""}

    from urllib.request import Request, urlopen
    from urllib.parse import quote

    def try_openalex():
        import ssl
        ctx = ssl._create_unverified_context()
        url = f"https://api.openalex.org/works/doi:{doi}"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        count = data.get("cited_by_count", 0)
        oid = data.get("id", "").rsplit("/", 1)[-1]
        if not oid:
            return None
        req2 = Request("https://api.openalex.org/works?filter=" + quote("cites:" + oid) + "&per_page=100", headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=10)
        data2 = __import__("json").loads(resp2.read())
        refs = []
        for r in data2.get("results") or []:
            refs.append({
                "title": r.get("title", ""),
                "authors": ", ".join(
                    a.get("author", {}).get("display_name", "")
                    for a in (r.get("authorships") or [])[:3]
                ),
                "year": r.get("publication_year"),
                "journal": (r.get("primary_location") or {}).get("source", {}).get("display_name", ""),
                "doi": r.get("doi", "").replace("https://doi.org/", ""),
            })
        return (refs, f"OpenAlex (共被引 {count} 次)")

    def try_semantic_scholar():
        url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=paperId,citationCount"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        paper_id = data.get("paperId")
        count = data.get("citationCount", 0)
        if not paper_id:
            return None
        url2 = f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}/citations?limit=100&fields=title,authors,year,journal,externalIds"
        req2 = Request(url2, headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=8)
        raw = __import__("json").loads(resp2.read()).get("data") or []
        if not raw:
            return None
        refs = []
        for r in raw:
            p = r.get("citingPaper") or {}
            authors = p.get("authors") or []
            author_str = ", ".join(a.get("name", "") for a in authors[:3])
            if len(authors) > 3:
                author_str += " et al."
            refs.append({
                "title": p.get("title", ""),
                "authors": author_str,
                "year": p.get("year"),
                "journal": (p.get("journal") or {}).get("name") if p.get("journal") else "",
                "doi": (p.get("externalIds") or {}).get("DOI", ""),
            })
        return (refs, f"Semantic Scholar (共被引 {count} 次)")

    for name, fn in [("S2", try_semantic_scholar), ("OA", try_openalex)]:
        try:
            result = fn()
            if result:
                return {"citations": result[0], "source": result[1]}
        except Exception as e:
            import traceback
            traceback.print_exc()

    return {"citations": [], "source": "暂无引用数据"}


@router.get("", response_model=list[PaperResponse])
def list_papers(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    folder_id: int | None = None,
) -> list[PaperResponse]:
    query = select(Paper).where(Paper.user_id == current_user.id)
    if folder_id is not None:
        query = query.where(Paper.folder_id == folder_id)
    papers = db.scalars(query.order_by(Paper.last_viewed_at.desc(), Paper.created_at.desc())).all()
    return [build_paper_response(p) for p in papers]


@router.post("", response_model=PaperResponse)
async def upload_paper(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    metadata_json: str = Form(""),
    folder_id: int | None = Form(None),
):
    if file.content_type not in ALLOWED_PDF_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 PDF 格式。")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空。")

    # 解析 metadata（前端传的 JSON 字符串）
    meta = PaperMetadata()
    if metadata_json.strip():
        try:
            import json
            meta_data = json.loads(metadata_json)
            meta = PaperMetadata(**meta_data)
        except Exception:
            pass

    # 确定目标文件夹
    target_folder_id = folder_id if folder_id is not None else _get_uncategorized_id(db, current_user.id)
    if target_folder_id is not None:
        target = db.scalar(
            select(Folder).where(Folder.id == target_folder_id, Folder.user_id == current_user.id)
        )
        if not target:
            target_folder_id = _get_uncategorized_id(db, current_user.id)

    # 保存文件到磁盘
    papers_dir = Path(settings.papers_upload_dir)
    papers_dir.mkdir(parents=True, exist_ok=True)

    suffix = ".pdf"
    file_name_on_disk = f"{current_user.uid}_{time_ns() // 1_000_000}{suffix}"
    file_path = papers_dir / file_name_on_disk
    file_path.write_bytes(content)

    file_url = f"/uploads/papers/{file_name_on_disk}"

    paper = Paper(
        user_id=current_user.id,
        folder_id=target_folder_id,
        file_name=file.filename or "untitled.pdf",
        file_path=file_url,
        file_size=f"{len(content)}",
        title=meta.title or (file.filename or "").replace(".pdf", ""),
        author=meta.author,
        subject=meta.subject,
        keywords=meta.keywords,
        creator=meta.creator,
        producer=meta.producer,
        creation_date=meta.creation_date,
        modification_date=meta.modification_date,
        doi=meta.doi,
        page_count=meta.page_count,
        last_viewed_at=datetime.now(timezone.utc),
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)

    # 自动翻译标题为中文
    discipline = current_user.profile.discipline if current_user.profile else ""
    try:
        translated = translate_title(paper.title, discipline)
        with open("translate_debug.log", "a", encoding="utf-8") as f:
            f.write(f"title={paper.title}\ndiscipline={discipline}\ntranslated={translated}\n---\n")
    except Exception as e:
        with open("translate_debug.log", "a", encoding="utf-8") as f:
            f.write(f"ERROR: {e}\n---\n")
        translated = None
    if translated:
        paper.translated_title = translated
        db.add(paper)
        db.commit()
        db.refresh(paper)

    return build_paper_response(paper)


@router.get("/{paper_id}/full-translation", response_model=FullTranslationResponse)
def get_full_translation(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FullTranslationResponse:
    paper = db.scalar(select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id))
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")
    item = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper_id))
    return build_full_translation_response(item)


@router.post("/{paper_id}/full-translation/start", response_model=FullTranslationResponse)
def start_full_translation(
    paper_id: int,
    payload: FullTranslationStartRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FullTranslationResponse:
    paper = db.scalar(select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id))
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    from app.services.machine_translation import get_translation_engine
    from app.services.termbase import load_termbase

    translation_engine = get_translation_engine()
    _terms, termbase_version = load_termbase()
    item = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper_id))
    local_pages = normalize_translation_pages([page.model_dump() for page in payload.pages])
    local_hash = payload.source_hash or get_translation_source_hash(local_pages)
    if is_completed_translation_cache_hit(
        item,
        parse_mode=payload.parse_mode,
        local_hash=local_hash,
        translation_engine=translation_engine,
        termbase_version=termbase_version,
    ):
        return build_full_translation_response(item)
    if item and item.status == "running" and item.source_hash.endswith(local_hash):
        return build_full_translation_response(item)

    pages, parse_engine, parse_summary = maybe_enhance_pages_with_aliyun(paper, local_pages, payload.parse_mode)
    parsed_hash = get_translation_source_hash(pages)
    source_hash = build_translation_cache_key(
        payload.parse_mode,
        parse_engine,
        local_hash if parse_engine == "local" else parsed_hash,
        translation_engine,
        termbase_version,
    )
    total_units = count_translatable_units(pages)
    if total_units <= 0:
        raise HTTPException(status_code=400, detail="没有可翻译的正文内容。")

    if not item:
        item = PaperFullTranslation(paper_id=paper_id)

    item.provider_id = payload.provider_id
    item.source_hash = source_hash
    item.parse_mode = payload.parse_mode
    item.parse_engine = parse_engine
    item.parse_summary = parse_summary
    item.translation_engine = translation_engine
    item.termbase_version = termbase_version
    item.status = "running"
    item.pages_json = pages
    item.completed_units = 0
    item.total_units = total_units
    item.error_message = None
    db.add(item)
    db.commit()
    db.refresh(item)

    background_tasks.add_task(run_full_translation_task, item.id, payload.provider_id)
    return build_full_translation_response(item)


@router.post("/{paper_id}/full-translation/retry", response_model=FullTranslationResponse)
def retry_full_translation(
    paper_id: int,
    payload: FullTranslationStartRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FullTranslationResponse:
    item = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper_id))
    if item:
        db.delete(item)
        db.commit()
    return start_full_translation(paper_id, payload, background_tasks, current_user, db)


@router.post("/{paper_id}/full-translation/cancel", response_model=FullTranslationResponse)
def cancel_full_translation(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FullTranslationResponse:
    paper = db.scalar(select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id))
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")
    item = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper_id))
    if not item:
        return FullTranslationResponse()
    if item.status == "running":
        item.status = "cancelled"
        item.error_message = "已取消全文翻译。"
        db.add(item)
        db.commit()
        db.refresh(item)
    return build_full_translation_response(item)


@router.get("/{paper_id}/full-translation/stream", response_model=FullTranslationResponse)
def stream_full_translation(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FullTranslationResponse:
    # v1 uses lightweight polling with the stream-shaped endpoint name.
    paper = db.scalar(select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id))
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")
    item = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper_id))
    return build_full_translation_response(item)


@router.get("/{paper_id}/full-translation/download")
def download_full_translation(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    paper = db.scalar(select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id))
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")
    item = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper_id))
    if not item or item.status != "completed":
        raise HTTPException(status_code=404, detail="全文翻译尚未完成。")

    chunks: list[str] = []
    for page in item.pages_json or []:
        chunks.append(f"\n\n# 第 {page.get('page_number')} 页\n")
        for block in page.get("blocks") or []:
            text = get_download_translation_text(block)
            if text:
                chunks.append(text)
    content = "\n\n".join(chunks).strip()
    filename = (paper.title or paper.file_name or "translation").replace("/", " ").replace("\\", " ").strip()
    headers = {"Content-Disposition": f'attachment; filename="{filename[:80]}-translation.md"'}
    return PlainTextResponse(content, media_type="text/markdown; charset=utf-8", headers=headers)


@router.get("/{paper_id}", response_model=PaperResponse)
def get_paper(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperResponse:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")
    return build_paper_response(paper)


@router.get("/{paper_id}/file")
async def get_paper_file(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    actual_file = _resolve_paper_file(paper.file_path)
    if not actual_file or not actual_file.exists():
        raise HTTPException(status_code=404, detail="论文文件已丢失。")

    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(actual_file),
        filename=paper.file_name,
        media_type="application/pdf",
    )


@router.patch("/{paper_id}", response_model=PaperResponse)
def update_paper(
    paper_id: int,
    payload: PaperUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperResponse:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    if payload.folder_id is not None:
        # 验证目标文件夹属于当前用户
        target = db.scalar(
            select(Folder).where(Folder.id == payload.folder_id, Folder.user_id == current_user.id)
        )
        if not target:
            raise HTTPException(status_code=400, detail="目标文件夹不存在。")
        paper.folder_id = payload.folder_id

    if payload.last_viewed_at:
        paper.last_viewed_at = datetime.now(timezone.utc)

    if payload.title is not None:
        paper.title = payload.title
    if payload.translated_title is not None:
        paper.translated_title = payload.translated_title
    if payload.author is not None:
        paper.author = payload.author
    if payload.subject is not None:
        paper.subject = payload.subject
    if payload.keywords is not None:
        paper.keywords = payload.keywords
    if payload.doi is not None:
        paper.doi = payload.doi
    if payload.page_count is not None:
        paper.page_count = payload.page_count

    db.add(paper)
    db.commit()
    db.refresh(paper)
    return build_paper_response(paper)


@router.delete("/{paper_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_paper(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    # 删除磁盘文件
    actual_file = _resolve_paper_file(paper.file_path)
    if actual_file and actual_file.exists():
        try:
            actual_file.unlink()
        except OSError:
            pass

    db.delete(paper)
    db.commit()


# ── References / Citations ────────────────────────────────


# ── Helpers ──────────────────────────────────────────────


def _get_uncategorized_id(db: Session, user_id: int) -> int:
    folder = db.scalar(
        select(Folder).where(Folder.user_id == user_id, Folder.name == "未分类")
    )
    if folder:
        return folder.id
    # 兜底：如果不存在则创建
    new_folder = Folder(user_id=user_id, name="未分类")
    db.add(new_folder)
    db.flush()
    return new_folder.id


def _resolve_paper_file(file_url: str) -> Path | None:
    """从 URL 路径解析出实际的磁盘文件路径"""
    if not file_url:
        return None
    file_name = Path(file_url).name
    if not file_name:
        return None
    candidate = Path(settings.papers_upload_dir) / file_name
    root = Path(settings.papers_upload_dir).resolve()
    try:
        resolved = candidate.resolve()
    except OSError:
        return None
    if root not in resolved.parents:
        return None
    return resolved
