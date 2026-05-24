from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.schemas.paper import PAPER_TEXT_LIMITS, PaperMetadata, compact_paper_text


DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
ARXIV_PREFIXED_RE = re.compile(r"\barxiv\s*[:：]\s*(\d{4}\.\d{4,5})(v\d+)?\b", re.IGNORECASE)
ARXIV_BARE_RE = re.compile(r"\b((?:0[7-9]|1[0-9]|2[0-9])\d{2}\.\d{4,5})(v\d+)?\b", re.IGNORECASE)

MISSING_METADATA_VALUES = {
    "pdf 元数据中未识别",
    "unknown",
    "untitled",
    "untitled document",
    "document",
    "paper",
    "pdf",
    "scan",
    "new document",
    "microsoft word",
}


def clean_metadata_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def is_missing_metadata_value(value: Any) -> bool:
    text = clean_metadata_text(value)
    return not text or text.lower() in MISSING_METADATA_VALUES


def normalize_pdf_date(raw_date: Any) -> str:
    value = clean_metadata_text(raw_date)
    if not value:
        return ""
    if not value.startswith("D:"):
        return value
    year = value[2:6]
    month = value[6:8]
    day = value[8:10]
    return "-".join(part for part in (year, month, day) if part)


def find_doi(text: Any) -> str:
    match = DOI_RE.search(str(text or ""))
    if not match:
        return ""
    return re.sub(r"[)\].,;:]+$", "", match.group(0))


def find_arxiv_id(text: Any) -> str:
    value = str(text or "")
    match = ARXIV_PREFIXED_RE.search(value) or ARXIV_BARE_RE.search(value)
    if not match:
        return ""
    return f"{match.group(1)}{match.group(2) or ''}"


def is_weak_metadata_title(title: Any, file_name: str | None = "") -> bool:
    cleaned = clean_metadata_text(title)
    file_title = clean_metadata_text(re.sub(r"\.pdf$", "", str(file_name or ""), flags=re.IGNORECASE))
    if is_missing_metadata_value(cleaned):
        return True
    if file_title and cleaned.lower() == file_title.lower():
        return True
    if re.fullmatch(r"(?:arxiv[:\s-]*)?\d{4}\.\d{4,5}(?:v\d+)?", cleaned, flags=re.IGNORECASE):
        return True
    if re.match(r"^pii\s*:", cleaned, flags=re.IGNORECASE):
        return True
    return False


def is_article_marker(line: str) -> bool:
    return bool(
        re.fullmatch(
            r"(research|original|review|regular|short|survey)?\s*(article|paper|letter)",
            line,
            flags=re.IGNORECASE,
        )
    )


def is_front_matter_noise(line: str) -> bool:
    value = clean_metadata_text(line)
    if not value:
        return True
    if is_article_marker(value):
        return True
    if re.match(r"^(arxiv|doi)\b", value, flags=re.IGNORECASE):
        return True
    if re.match(r"^(https?://|www\.)", value, flags=re.IGNORECASE):
        return True
    if re.match(r"^(submitted|published|preprint|copyright|received|revised|accepted|correspondence|academic editor)\b", value, flags=re.IGNORECASE):
        return True
    if re.match(r"^(volume|vol\.?)\s+\d+", value, flags=re.IGNORECASE):
        return True
    if re.search(r"\b(article id|pages?|issn|isbn)\b", value, flags=re.IGNORECASE):
        return True
    if re.fullmatch(r"\d+", value):
        return True
    if re.fullmatch(r"(hindawi|springer|elsevier|ieee|acm|mdpi|nature|frontiers|plos|wiley|sage)", value, flags=re.IGNORECASE):
        return True
    return False


def is_section_start(line: str) -> bool:
    return bool(
        re.match(
            r"^(\d+\.?\s*)?(abstract|keywords|key words|index terms|introduction|1\s+introduction|references)\b",
            line,
            flags=re.IGNORECASE,
        )
    )


def is_likely_affiliation_line(line: str) -> bool:
    return bool(
        re.search(
            r"\b(university|institute|department|school|college|laboratory|academy|google|microsoft|facebook|meta|openai|research|faculty|centre|center|@)\b",
            line,
            flags=re.IGNORECASE,
        )
    )


def is_likely_author_line(line: str) -> bool:
    value = clean_metadata_text(line)
    if not value or is_likely_affiliation_line(value) or is_section_start(value):
        return False
    capitalized_words = re.findall(r"\b[A-Z][A-Za-z.'-]{1,}\b", value)
    name_like_words = re.findall(r"\b[A-Z][a-z][A-Za-z.'-]*\b", value)
    if len(capitalized_words) < 2 or len(name_like_words) < 2 or len(value) > 180:
        return False
    title_vocabulary = re.compile(
        r"\b(algorithm|analysis|approach|based|benchmark|classification|dataset|detection|estimation|framework|learning|method|model|neural|network|networks|recognition|survey|system|towards?|using|with|via|for|of)\b",
        re.IGNORECASE,
    )
    if re.search(r"[,;]|\band\b", value, flags=re.IGNORECASE):
        return not title_vocabulary.search(value)
    return len(capitalized_words) <= 6 and not re.search(r"[.!?]$", value) and not title_vocabulary.search(value)


def clean_author_line(line: str) -> str:
    value = clean_metadata_text(line)
    value = re.sub(r"\b(?:ID|ORCID)\b", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^[,\s\d]+", "", value)
    value = re.sub(r",\s*\d+\b\s*", "; ", value)
    value = re.sub(r"\s+\d+\s+", "; ", value)
    value = re.sub(r"\s*;\s*", "; ", value)
    return clean_metadata_text(value.strip(" ,;"))


def is_title_candidate(line: str) -> bool:
    value = clean_metadata_text(line)
    if is_front_matter_noise(value) or is_section_start(value) or is_likely_affiliation_line(value):
        return False
    if len(value) < 8 or len(value) > 220:
        return False
    word_count = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9+-]*", value))
    if word_count < 2:
        return False
    return True


def split_clean_lines(text: Any) -> list[str]:
    return [
        clean_metadata_text(line)
        for line in re.split(r"\n+", str(text or ""))
        if clean_metadata_text(line)
    ]


def extract_abstract_from_lines(lines: list[str], abstract_index: int) -> str:
    if abstract_index < 0:
        return ""
    chunks: list[str] = []
    first = re.sub(r"^abstract[\s.:-]*", "", lines[abstract_index], flags=re.IGNORECASE).strip()
    if first:
        chunks.append(first)
    for line in lines[abstract_index + 1:]:
        if re.match(r"^(keywords|key words|index terms|ccs concepts)\b", line, flags=re.IGNORECASE):
            break
        if re.match(r"^(\d+\.?\s*)?(introduction|1\s+introduction)\b", line, flags=re.IGNORECASE):
            break
        chunks.append(line)
        if len(" ".join(chunks)) > 1200:
            break
    return clean_metadata_text(" ".join(chunks))[:1200]


def extract_keywords_from_lines(lines: list[str]) -> str:
    for index, line in enumerate(lines):
        if not re.match(r"^(keywords|key words|index terms)\b", line, flags=re.IGNORECASE):
            continue
        first = re.sub(
            r"^(keywords|key words|index terms)[\s.:\-\u2013\u2014]*",
            "",
            line,
            flags=re.IGNORECASE,
        ).strip()
        chunks = [first] if first else []
        next_line = lines[index + 1] if index + 1 < len(lines) else ""
        if next_line and not is_section_start(next_line):
            chunks.append(next_line)
        return clean_metadata_text(" ".join(chunks))[:400]
    return ""


def _metadata_value(info: dict[str, Any], *keys: str) -> str:
    for key in keys:
        if key in info and not is_missing_metadata_value(info.get(key)):
            return clean_metadata_text(info.get(key))
        lowered = key.lower()
        if lowered in info and not is_missing_metadata_value(info.get(lowered)):
            return clean_metadata_text(info.get(lowered))
    return ""


def extract_front_matter_hints(text: Any, info: dict[str, Any] | None = None, file_name: str | None = "") -> dict[str, Any]:
    info = info or {}
    info_text = "\n".join(clean_metadata_text(value) for value in info.values() if value)
    raw_text = "\n".join(part for part in (str(text or ""), info_text, str(file_name or "")) if part)
    lines = split_clean_lines(text)
    abstract_index = next((index for index, line in enumerate(lines) if re.match(r"^abstract\b", line, flags=re.IGNORECASE)), -1)
    scan_limit = abstract_index if abstract_index >= 0 else min(len(lines), 36)
    marker_indexes = [index for index in range(scan_limit) if is_article_marker(lines[index])]
    start_index = marker_indexes[-1] + 1 if marker_indexes else 0

    title_parts: list[str] = []
    title_end_index = -1
    for index in range(start_index, scan_limit):
        line = lines[index]
        if not title_parts:
            if not is_title_candidate(line) or is_likely_author_line(line):
                continue
        else:
            if is_front_matter_noise(line) or is_section_start(line) or is_likely_author_line(line) or is_likely_affiliation_line(line):
                break
            if not is_title_candidate(line):
                break

        title_parts.append(line)
        title_end_index = index
        title_text = clean_metadata_text(" ".join(title_parts))
        if len(title_parts) >= 3 or len(title_text) >= 150 or (len(title_text) > 35 and re.search(r"[.!?]$", line)):
            break

    author_lines: list[str] = []
    if title_end_index >= 0:
        for line in lines[title_end_index + 1:scan_limit]:
            if is_front_matter_noise(line) or is_section_start(line):
                if author_lines:
                    break
                continue
            if is_likely_affiliation_line(line):
                if author_lines:
                    break
                continue
            if is_likely_author_line(line):
                author_line = clean_author_line(line)
                if author_line:
                    author_lines.append(author_line)
                if len(author_lines) >= 3:
                    break
            elif author_lines:
                break

    arxiv_category_match = re.search(r"\[([a-z-]+\.[A-Z]{2}(?:\.[A-Z]{2})?)\]", raw_text)
    return {
        "title": clean_metadata_text(" ".join(title_parts))[:300],
        "author": clean_metadata_text("; ".join(author_lines))[:200],
        "subject": extract_abstract_from_lines(lines, abstract_index),
        "keywords": extract_keywords_from_lines(lines) or (arxiv_category_match.group(1) if arxiv_category_match else ""),
        "doi": find_doi(raw_text),
        "arxiv_id": find_arxiv_id(raw_text),
    }


def merge_pdf_metadata(existing: PaperMetadata | None, extracted: dict[str, Any], *, file_name: str | None = "") -> PaperMetadata:
    base = (existing or PaperMetadata()).model_dump()

    def extracted_value(attr: str) -> Any:
        if attr in extracted:
            return extracted.get(attr)
        if attr == "arxiv_id":
            return extracted.get("arxivId")
        if attr == "page_count":
            return extracted.get("pageCount")
        return None

    def assign_text(attr: str, *, force: bool = False) -> None:
        value = extracted_value(attr)
        if is_missing_metadata_value(value):
            return
        current = base.get(attr)
        if force or is_missing_metadata_value(current):
            base[attr] = compact_paper_text(str(value), PAPER_TEXT_LIMITS.get(attr, 300))

    title_value = extracted_value("title")
    force_title = (
        not is_missing_metadata_value(title_value)
        and is_weak_metadata_title(base.get("title"), file_name)
        and not is_weak_metadata_title(title_value, file_name)
    )
    assign_text("title", force=force_title)
    for attr in (
        "author",
        "subject",
        "keywords",
        "creator",
        "producer",
        "creation_date",
        "modification_date",
        "doi",
        "arxiv_id",
    ):
        assign_text(attr)

    page_count = extracted_value("page_count")
    if page_count and not int(base.get("page_count") or 0):
        try:
            base["page_count"] = max(0, int(page_count))
        except (TypeError, ValueError):
            pass
    return PaperMetadata(**base)


def extract_pdf_metadata(file_path: Path | str, *, file_name: str | None = "", existing: PaperMetadata | None = None, max_pages: int = 5) -> PaperMetadata:
    import fitz

    path = Path(file_path)
    text_chunks: list[str] = []
    info: dict[str, Any] = {}
    page_count = 0
    with fitz.open(path) as document:
        info = dict(document.metadata or {})
        page_count = document.page_count
        for index in range(min(page_count, max_pages)):
            text = document[index].get_text("text") or ""
            text = re.sub(r"\s+\n", "\n", text)
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
            if text:
                text_chunks.append(text)

    first_pages_text = "\n".join(text_chunks)
    hints = extract_front_matter_hints(first_pages_text, info, file_name)
    metadata_title = _metadata_value(info, "title", "Title")
    hint_title = clean_metadata_text(hints.get("title"))
    metadata_title_clean = clean_metadata_text(metadata_title)
    title = metadata_title_clean
    if hint_title and not is_weak_metadata_title(hint_title, file_name):
        if (
            is_weak_metadata_title(metadata_title_clean, file_name)
            or metadata_title_clean.lower().startswith(hint_title.lower())
            or hint_title.lower() in metadata_title_clean.lower() and len(metadata_title_clean) - len(hint_title) <= 80
        ):
            title = hint_title

    extracted = {
        "title": title,
        "author": _metadata_value(info, "author", "Author") or hints.get("author"),
        "subject": _metadata_value(info, "subject", "Subject") or hints.get("subject"),
        "keywords": _metadata_value(info, "keywords", "Keywords") or hints.get("keywords"),
        "creator": _metadata_value(info, "creator", "Creator"),
        "producer": _metadata_value(info, "producer", "Producer"),
        "creation_date": normalize_pdf_date(_metadata_value(info, "creationDate", "CreationDate")),
        "modification_date": normalize_pdf_date(_metadata_value(info, "modDate", "ModDate")),
        "doi": hints.get("doi") or find_doi("\n".join(str(value) for value in info.values())),
        "arxiv_id": hints.get("arxiv_id") or find_arxiv_id("\n".join(str(value) for value in info.values())),
        "page_count": page_count,
    }
    return merge_pdf_metadata(existing, extracted, file_name=file_name)
