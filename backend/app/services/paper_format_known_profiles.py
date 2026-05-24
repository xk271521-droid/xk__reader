from __future__ import annotations

import re
from typing import Any


TYUST_CS_2026_PROFILE_KEY = "tyust_cs_2026"

TITLE_MAIN = (
    "\u592a\u539f\u79d1\u6280\u5927\u5b66\u8ba1\u7b97\u673a\u5b66\u9662\u672c\u79d1\u751f\u6bd5\u4e1a\u8bba\u6587\u89c4\u8303\u8981\u6c42"
)
TITLE_HEADER = "\u592a\u539f\u79d1\u6280\u5927\u5b66\u5b66\u58eb\u5b66\u4f4d\u8bba\u6587"
TOC_MARKER = "\u76ee\u5f55\u6309\u4e09\u7ea7\u6807\u9898\u5199"
ROMAN_MARKER = "\u9875\u7801\u7528\u2160\u3001\u2161\u7b49\u5927\u5199\u7f57\u9a6c\u6570\u5b57"
CODE_MARKER = "\u4ee3\u7801\u53ca\u6ce8\u91ca\u5b57\u4f53\u4e3a\u4e94\u53f7times new roman"

ENGLISH_ORIGINAL = "\u82f1\u6587\u539f\u6587"
CHINESE_TRANSLATION = "\u4e2d\u6587\u7ffb\u8bd1"
CODE_OR_NOTES = "\u4ee3\u7801\u53ca\u6ce8\u91ca"
PROGRAM_CODE = "\u7a0b\u5e8f\u4ee3\u7801"
FIVE_SIZE = "\u4e94\u53f7"
SMALL_FOUR_SONG = "\u5c0f\u56db\u53f7\u5b8b\u4f53"
SINGLE_SPACING = "\u5355\u500d\u884c\u8ddd"
SONGTI = "\u5b8b\u4f53"


def detect_known_profile_key(text: str) -> str | None:
    normalized = _normalize_text(text)
    if not normalized:
        return None
    markers = (TITLE_MAIN, TITLE_HEADER)
    body_markers = (TOC_MARKER, ROMAN_MARKER, CODE_MARKER)
    if any(marker in normalized for marker in markers) and any(marker in normalized for marker in body_markers):
        return TYUST_CS_2026_PROFILE_KEY
    return None


def extract_known_profile_requirements(text: str) -> dict[str, Any]:
    normalized = _normalize_text(text)
    if not normalized:
        return {}

    requirements: dict[str, Any] = {}
    lower_text = normalized.lower()

    if ENGLISH_ORIGINAL in normalized and FIVE_SIZE in normalized and SINGLE_SPACING in normalized and "times new roman" in lower_text:
        requirements["appendix_english_font"] = "Times New Roman"
        requirements["appendix_english_size_pt"] = 10.5
        requirements["appendix_english_line_spacing"] = 1.0

    if CHINESE_TRANSLATION in normalized and SMALL_FOUR_SONG in normalized and SINGLE_SPACING in normalized:
        requirements["appendix_translation_font"] = SONGTI
        requirements["appendix_translation_size_pt"] = 12.0
        requirements["appendix_translation_line_spacing"] = 1.0

    if (
        (CODE_OR_NOTES in normalized or PROGRAM_CODE in normalized)
        and FIVE_SIZE in normalized
        and SINGLE_SPACING in normalized
        and "times new roman" in lower_text
    ):
        requirements["appendix_code_font"] = "Times New Roman"
        requirements["appendix_code_size_pt"] = 10.5
        requirements["appendix_code_line_spacing"] = 1.0

    return requirements


def _normalize_text(text: str) -> str:
    value = str(text or "").replace("\r", "\n").replace("\xa0", " ").replace("\u3000", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{2,}", "\n", value)
    return value.strip()
