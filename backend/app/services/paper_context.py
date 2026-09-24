from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re

from app.core.config import settings
from app.services.oss_storage import download_file, paper_object_key


def resolve_paper_file(file_url: str) -> Path | None:
    """Resolve an owned paper URL to its local PDF, downloading from OSS when needed."""
    file_name = Path(file_url or "").name
    if not file_name:
        return None

    upload_root = Path(settings.papers_upload_dir).resolve()
    try:
        resolved = (upload_root / file_name).resolve()
    except OSError:
        return None
    if upload_root not in resolved.parents:
        return None

    if not resolved.exists():
        download_file(paper_object_key(file_url), resolved)
    return resolved if resolved.exists() else None


@lru_cache(maxsize=8)
def _extract_pdf_text_cached(path: str, file_size: int, modified_ns: int) -> str:
    # Size and modification time are part of the key so replacing a PDF cannot
    # accidentally reuse stale full-text context.
    del file_size, modified_ns
    import fitz

    page_blocks: list[str] = []
    with fitz.open(path) as document:
        for page_number, page in enumerate(document, start=1):
            text = page.get_text("text", sort=True) or ""
            text = re.sub(r"[ \t]+\n", "\n", text)
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
            if text:
                page_blocks.append(f"[第 {page_number} 页]\n{text}")
    return "\n\n".join(page_blocks)


def extract_paper_full_text(file_url: str) -> str:
    """Return page-marked full text for one PDF without truncating its content."""
    file_path = resolve_paper_file(file_url)
    if not file_path:
        return ""
    try:
        stat = file_path.stat()
        return _extract_pdf_text_cached(
            str(file_path),
            stat.st_size,
            stat.st_mtime_ns,
        )
    except (OSError, RuntimeError, ValueError):
        return ""
