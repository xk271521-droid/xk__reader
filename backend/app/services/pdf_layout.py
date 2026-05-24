from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


COLUMN_SPLIT_CENTER = 0.5


def _round(value: float) -> float:
    return round(float(value), 6)


def _normalize_bbox(bbox: tuple[float, float, float, float], width: float, height: float) -> dict[str, float]:
    x0, y0, x1, y1 = bbox
    if width <= 0 or height <= 0:
        return {"left": 0.0, "top": 0.0, "width": 0.0, "height": 0.0}
    left = max(0.0, min(1.0, x0 / width))
    top = max(0.0, min(1.0, y0 / height))
    right = max(left, min(1.0, x1 / width))
    bottom = max(top, min(1.0, y1 / height))
    return {
        "left": _round(left),
        "top": _round(top),
        "width": _round(right - left),
        "height": _round(bottom - top),
    }


def _union_bbox(items: Iterable[dict[str, Any]]) -> tuple[float, float, float, float]:
    boxes = [item["bbox_abs"] for item in items]
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def _detect_columns(lines: list[dict[str, Any]]) -> list[dict[str, float | int]]:
    candidates = []
    for line in lines:
        rect = line["bbox"]
        center = rect["left"] + rect["width"] / 2
        if rect["width"] < 0.66 and (
            center < COLUMN_SPLIT_CENTER - 0.08 or center > COLUMN_SPLIT_CENTER + 0.08
        ):
            candidates.append(line)

    left_count = sum(
        1
        for line in candidates
        if line["bbox"]["left"] + line["bbox"]["width"] / 2 < COLUMN_SPLIT_CENTER
    )
    right_count = len(candidates) - left_count
    if left_count >= 2 and right_count >= 2:
        return [
            {"id": 0, "left": 0.0, "right": COLUMN_SPLIT_CENTER},
            {"id": 1, "left": COLUMN_SPLIT_CENTER, "right": 1.0},
        ]
    return [{"id": 0, "left": 0.0, "right": 1.0}]


def _assign_column_ids(lines: list[dict[str, Any]], columns: list[dict[str, float | int]]) -> None:
    has_two_columns = len(columns) == 2
    for line in lines:
        if not has_two_columns:
            line["column_id"] = 0
            continue
        rect = line["bbox"]
        center = rect["left"] + rect["width"] / 2
        is_full_width = rect["width"] >= 0.7 or (
            rect["left"] < 0.24 and rect["left"] + rect["width"] > 0.76
        )
        line["column_id"] = -1 if is_full_width else (0 if center < COLUMN_SPLIT_CENTER else 1)
        for word in line["words"]:
            word["column_id"] = line["column_id"]


def _line_reading_key(line: dict[str, Any]) -> tuple[int, float, float]:
    column_id = int(line.get("column_id", 0))
    if column_id < 0:
        return (-1, line["bbox"]["top"], line["bbox"]["left"])
    return (column_id, line["bbox"]["top"], line["bbox"]["left"])


def build_page_layout_from_words(
    *,
    page_number: int,
    width: float,
    height: float,
    raw_words: Iterable[tuple],
) -> dict[str, Any]:
    words = []
    for item in raw_words:
        if len(item) < 8:
            continue
        x0, y0, x1, y1, text, block_no, line_no, word_no = item[:8]
        text = str(text or "").strip()
        if not text:
            continue
        words.append(
            {
                "text": text,
                "block_no": int(block_no),
                "line_no": int(line_no),
                "word_no": int(word_no),
                "bbox_abs": (float(x0), float(y0), float(x1), float(y1)),
                "bbox": _normalize_bbox((float(x0), float(y0), float(x1), float(y1)), width, height),
                "column_id": 0,
            }
        )

    grouped: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for word in words:
        grouped[(word["block_no"], word["line_no"])].append(word)

    lines = []
    for index, ((block_no, line_no), line_words) in enumerate(grouped.items()):
        ordered_words = sorted(line_words, key=lambda word: (word["word_no"], word["bbox_abs"][0]))
        line_bbox = _union_bbox(ordered_words)
        lines.append(
            {
                "index": index,
                "block_no": block_no,
                "line_no": line_no,
                "column_id": 0,
                "text": " ".join(word["text"] for word in ordered_words),
                "bbox_abs": line_bbox,
                "bbox": _normalize_bbox(line_bbox, width, height),
                "words": ordered_words,
            }
        )

    lines.sort(key=lambda line: (line["bbox"]["top"], line["bbox"]["left"]))
    for index, line in enumerate(lines):
        line["index"] = index

    columns = _detect_columns(lines)
    _assign_column_ids(lines, columns)
    lines.sort(key=_line_reading_key)
    for index, line in enumerate(lines):
        line["reading_order"] = index
        for word in line["words"]:
            word["reading_order"] = index

    blocks_by_key: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        blocks_by_key[(line["block_no"], line["column_id"])].append(line)

    blocks = []
    for index, ((block_no, column_id), block_lines) in enumerate(
        sorted(blocks_by_key.items(), key=lambda item: _line_reading_key(item[1][0]))
    ):
        block_bbox = _union_bbox(block_lines)
        blocks.append(
            {
                "index": index,
                "block_no": block_no,
                "column_id": column_id,
                "text": "\n".join(line["text"] for line in block_lines),
                "bbox": _normalize_bbox(block_bbox, width, height),
                "line_indices": [line["index"] for line in block_lines],
            }
        )

    serializable_lines = [
        {
            key: value
            for key, value in line.items()
            if key != "bbox_abs"
        }
        for line in lines
    ]
    for line in serializable_lines:
        for word in line["words"]:
            word.pop("bbox_abs", None)

    return {
        "page_number": page_number,
        "width": _round(width),
        "height": _round(height),
        "columns": columns,
        "blocks": blocks,
        "lines": serializable_lines,
    }


def extract_pdf_page_layout(file_path: Path | str, page_number: int) -> dict[str, Any]:
    import fitz

    path = Path(file_path)
    with fitz.open(path) as document:
        if page_number < 1 or page_number > document.page_count:
            raise IndexError("PDF page number is out of range")
        page = document[page_number - 1]
        page_rect = page.rect
        return build_page_layout_from_words(
            page_number=page_number,
            width=page_rect.width,
            height=page_rect.height,
            raw_words=page.get_text("words") or [],
        )
