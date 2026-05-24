from __future__ import annotations

import re
from dataclasses import dataclass, replace
from io import BytesIO
from typing import Any

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt


@dataclass(frozen=True)
class FormatProfile:
    key: str
    title: str
    body_font: str
    latin_font: str
    heading_1_font: str
    heading_2_font: str
    heading_3_font: str
    body_size_pt: float
    heading_1_size_pt: float
    heading_2_size_pt: float
    heading_3_size_pt: float
    table_size_pt: float
    line_spacing: float
    first_line_indent_cm: float
    margin_top_cm: float
    margin_bottom_cm: float
    margin_left_cm: float
    margin_right_cm: float
    heading_1_align: str = "left"
    heading_2_align: str = "left"
    heading_3_align: str = "left"
    body_align: str = "justify"
    add_page_number: bool = True
    chapter_page_break: bool = False
    reference_hanging_indent_cm: float = 0.74
    reference_line_spacing: float = 1.5
    appendix_english_font: str = "Times New Roman"
    appendix_translation_font: str = "\u5b8b\u4f53"
    appendix_code_font: str = "Times New Roman"
    appendix_english_size_pt: float = 10.5
    appendix_translation_size_pt: float = 12
    appendix_code_size_pt: float = 10.5
    appendix_english_line_spacing: float = 1.0
    appendix_translation_line_spacing: float = 1.0
    appendix_code_line_spacing: float = 1.0
    abstract_heading_font: str = "\u9ed1\u4f53"
    abstract_heading_size_pt: float = 18.0
    abstract_heading_align: str = "center"
    abstract_body_font: str = "\u5b8b\u4f53"
    abstract_body_size_pt: float = 12.0
    abstract_body_line_spacing: float = 1.5
    abstract_keywords_font: str = "\u5b8b\u4f53"
    abstract_keywords_size_pt: float = 12.0
    english_abstract_heading_font: str = "Times New Roman"
    english_abstract_heading_size_pt: float = 18.0
    english_abstract_heading_align: str = "center"
    english_abstract_body_font: str = "Times New Roman"
    english_abstract_body_size_pt: float = 12.0
    english_abstract_body_line_spacing: float = 1.5
    english_keywords_font: str = "Times New Roman"
    english_keywords_size_pt: float = 12.0
    toc_heading_font: str = "\u9ed1\u4f53"
    toc_heading_size_pt: float = 16.0
    toc_heading_align: str = "center"
    toc_body_font: str = "\u5b8b\u4f53"
    toc_body_size_pt: float = 10.5
    toc_body_line_spacing: float = 1.5
    header_text: str = ""
    header_font: str = "\u5b8b\u4f53"
    header_size_pt: float = 10.5
    header_line_spacing: float = 1.0
    header_distance_cm: float = 1.5
    page_number_font: str = "\u5b8b\u4f53"
    page_number_size_pt: float = 10.5
    page_number_align: str = "center"
    page_number_bottom_cm: float = 1.75
    caption_font: str = "\u5b8b\u4f53"
    caption_size_pt: float = 10.5
    figure_caption_align: str = "center"
    table_caption_align: str = "center"


@dataclass(frozen=True)
class ParagraphContext:
    section: str
    role: str
    appendix_kind: str = ""


DEFAULT_PROFILE = FormatProfile(
    key="undergraduate_cn",
    title="\u4e2d\u6587\u672c\u79d1\u8bba\u6587\u901a\u7528\u89c4\u8303",
    body_font="\u5b8b\u4f53",
    latin_font="Times New Roman",
    heading_1_font="\u9ed1\u4f53",
    heading_2_font="\u9ed1\u4f53",
    heading_3_font="\u9ed1\u4f53",
    body_size_pt=12,
    heading_1_size_pt=16,
    heading_2_size_pt=14,
    heading_3_size_pt=12,
    table_size_pt=10.5,
    line_spacing=1.5,
    first_line_indent_cm=0.74,
    margin_top_cm=2.54,
    margin_bottom_cm=2.54,
    margin_left_cm=3.17,
    margin_right_cm=2.54,
)

TYUST_CS_2026_PROFILE = replace(
    DEFAULT_PROFILE,
    key="tyust_cs_2026",
    title="\u592a\u539f\u79d1\u6280\u5927\u5b66\u8ba1\u7b97\u673a\u5b66\u9662 2026 \u672c\u79d1\u8bba\u6587\u683c\u5f0f",
    body_font="\u5b8b\u4f53",
    latin_font="Times New Roman",
    heading_1_font="\u9ed1\u4f53",
    heading_2_font="\u9ed1\u4f53",
    heading_3_font="\u9ed1\u4f53",
    body_size_pt=12,
    heading_1_size_pt=18,
    heading_2_size_pt=15,
    heading_3_size_pt=12,
    table_size_pt=10.5,
    line_spacing=1.5,
    first_line_indent_cm=0.74,
    margin_top_cm=3.6,
    margin_bottom_cm=2.5,
    margin_left_cm=3.0,
    margin_right_cm=2.0,
    heading_1_align="center",
    heading_2_align="left",
    heading_3_align="left",
    body_align="justify",
    add_page_number=True,
    chapter_page_break=True,
    abstract_heading_font="\u9ed1\u4f53",
    abstract_heading_size_pt=18.0,
    abstract_heading_align="center",
    abstract_body_font="\u5b8b\u4f53",
    abstract_body_size_pt=12.0,
    abstract_body_line_spacing=1.5,
    abstract_keywords_font="\u9ed1\u4f53",
    abstract_keywords_size_pt=12.0,
    english_abstract_heading_font="Times New Roman",
    english_abstract_heading_size_pt=18.0,
    english_abstract_heading_align="center",
    english_abstract_body_font="Times New Roman",
    english_abstract_body_size_pt=12.0,
    english_abstract_body_line_spacing=1.5,
    english_keywords_font="Times New Roman",
    english_keywords_size_pt=12.0,
    toc_heading_font="\u9ed1\u4f53",
    toc_heading_size_pt=16.0,
    toc_heading_align="center",
    toc_body_font="\u5b8b\u4f53",
    toc_body_size_pt=10.5,
    toc_body_line_spacing=1.5,
    header_text="\u592a\u539f\u79d1\u6280\u5927\u5b66\u5b66\u58eb\u5b66\u4f4d\u8bba\u6587",
    header_font="\u5b8b\u4f53",
    header_size_pt=10.5,
    header_line_spacing=1.0,
    header_distance_cm=2.5,
    page_number_font="\u5b8b\u4f53",
    page_number_size_pt=10.5,
    page_number_align="center",
    page_number_bottom_cm=1.8,
    caption_font="\u5b8b\u4f53",
    caption_size_pt=10.5,
    figure_caption_align="center",
    table_caption_align="center",
    appendix_english_font="Times New Roman",
    appendix_english_size_pt=10.5,
    appendix_english_line_spacing=1.0,
    appendix_translation_font="\u5b8b\u4f53",
    appendix_translation_size_pt=12.0,
    appendix_translation_line_spacing=1.0,
    appendix_code_font="Times New Roman",
    appendix_code_size_pt=10.5,
    appendix_code_line_spacing=1.0,
)

PROFILES = {
    DEFAULT_PROFILE.key: DEFAULT_PROFILE,
    TYUST_CS_2026_PROFILE.key: TYUST_CS_2026_PROFILE,
    "journal_cn": FormatProfile(
        key="journal_cn",
        title="\u4e2d\u6587\u671f\u520a\u8bba\u6587\u901a\u7528\u89c4\u8303",
        body_font="\u5b8b\u4f53",
        latin_font="Times New Roman",
        heading_1_font="\u9ed1\u4f53",
        heading_2_font="\u9ed1\u4f53",
        heading_3_font="\u9ed1\u4f53",
        body_size_pt=10.5,
        heading_1_size_pt=14,
        heading_2_size_pt=12,
        heading_3_size_pt=10.5,
        table_size_pt=10.5,
        line_spacing=1.25,
        first_line_indent_cm=0.74,
        margin_top_cm=2.2,
        margin_bottom_cm=2.2,
        margin_left_cm=2.5,
        margin_right_cm=2.5,
    ),
    "review_light": FormatProfile(
        key="review_light",
        title="\u8f7b\u91cf\u5ba1\u9605\u89c4\u8303",
        body_font="\u5b8b\u4f53",
        latin_font="Times New Roman",
        heading_1_font="\u9ed1\u4f53",
        heading_2_font="\u9ed1\u4f53",
        heading_3_font="\u9ed1\u4f53",
        body_size_pt=12,
        heading_1_size_pt=15,
        heading_2_size_pt=13,
        heading_3_size_pt=12,
        table_size_pt=10.5,
        line_spacing=1.5,
        first_line_indent_cm=0.74,
        margin_top_cm=2.54,
        margin_bottom_cm=2.54,
        margin_left_cm=2.8,
        margin_right_cm=2.8,
    ),
}

ZH_ABSTRACT = "\u6458\u8981"
ZH_KEYWORDS = "\u5173\u952e\u8bcd"
ZH_TOC = "\u76ee\u5f55"
ZH_REFERENCES = "\u53c2\u8003\u6587\u732e"
ZH_ACKNOWLEDGEMENT = "\u81f4\u8c22"
ZH_APPENDIX = "\u9644\u5f55"
ZH_ORDINAL = "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07"
ROMAN_ORDINAL = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX"

HEADING_1_PATTERN = re.compile(
    rf"^\s*({ZH_ABSTRACT}|abstract|{ZH_KEYWORDS}|key\s*words|{ZH_TOC}|{ZH_REFERENCES}|{ZH_ACKNOWLEDGEMENT}|{ZH_APPENDIX}|"
    rf"\u7b2c[{ZH_ORDINAL}\d]+[\u7ae0\u8282]|"
    rf"[{ZH_ORDINAL}]+[\u3001.．]\s*.+)\s*$",
    re.IGNORECASE,
)
HEADING_2_PATTERN = re.compile(
    rf"^\s*((\d+(\.\d+){{1,2}})|([\uff08(][{ZH_ORDINAL}\d]+[)\uff09]))[\u3001.．\s].+"
)
HEADING_3_PATTERN = re.compile(r"^\s*(\d+\.\d+\.\d+|[\uff08(][1-9][0-9]*[)\uff09])[\u3001.．\s].+")
ABSTRACT_PATTERN = re.compile(rf"^\s*({ZH_ABSTRACT}|abstract)\s*$", re.IGNORECASE)
KEYWORDS_PATTERN = re.compile(rf"^\s*({ZH_KEYWORDS}|key\s*words?)\s*[:\uff1a]", re.IGNORECASE)
TOC_PATTERN = re.compile(rf"^\s*{ZH_TOC}\s*$", re.IGNORECASE)
REFERENCES_PATTERN = re.compile(rf"^\s*{ZH_REFERENCES}[\s\uff1a:]*$", re.IGNORECASE)
ACKNOWLEDGEMENT_PATTERN = re.compile(rf"^\s*{ZH_ACKNOWLEDGEMENT}[\s\uff1a:]*$", re.IGNORECASE)
APPENDIX_PATTERN = re.compile(rf"^\s*{ZH_APPENDIX}[\sA-Za-z0-9{ZH_ORDINAL}{ROMAN_ORDINAL}\u3001.．:：-]*.*$", re.IGNORECASE)
BODY_START_PATTERN = re.compile(
    rf"^\s*((\d+(\.\d+)*)|\u7b2c[{ZH_ORDINAL}\d]+[\u7ae0\u8282])[\s\u3001.．]?"
)
BODY_HEADING_1_PATTERN = re.compile(
    rf"^\s*(\d+|[{ZH_ORDINAL}]+)[\s\u3001.．]+.+$"
)
BODY_HEADING_2_PATTERN = re.compile(r"^\s*\d+\.\d+[\s\u3001.．]+.+$")
BODY_HEADING_3_PATTERN = re.compile(r"^\s*\d+\.\d+\.\d+[\s\u3001.．]+.+$")
COMMON_BODY_HEADINGS = {
    "??",
    "??",
    "????",
    "????",
    "????",
    "????",
    "?????",
    "????",
    "????",
    "????",
    "????",
    "?????",
    "????",
    "????",
    "?????",
    "????",
    "??",
    "??",
    "???",
    "?????",
}
REFERENCE_ITEM_PATTERN = re.compile(
    r"^\s*(\[\d+\]|\d+[.)]|[A-Z][A-Za-z'\-]+(?:,\s*[A-Z][A-Za-z'\-]+)*)"
)

# Clean Unicode overrides for Chinese role detection. Keep these near the
# compiled patterns so later helpers always read the fixed variants.
ROMAN_ORDINAL = "\u2160\u2161\u2162\u2163\u2164\u2165\u2166\u2167\u2168\u2169IVX"
HEADING_1_PATTERN = re.compile(
    rf"^\s*({ZH_ABSTRACT}|abstract|{ZH_KEYWORDS}|key\s*words|{ZH_TOC}|{ZH_REFERENCES}|{ZH_ACKNOWLEDGEMENT}|{ZH_APPENDIX}|"
    rf"\u7b2c[{ZH_ORDINAL}\d]+[\u7ae0\u8282]|"
    rf"[{ZH_ORDINAL}]+[\u3001.\-:：]\s*.+)\s*$",
    re.IGNORECASE,
)
HEADING_2_PATTERN = re.compile(
    rf"^\s*((\d+(\.\d+){{1,2}})|([\uff08(][{ZH_ORDINAL}\d]+[)\uff09]))[\u3001.\-:：\s].+"
)
HEADING_3_PATTERN = re.compile(r"^\s*(\d+\.\d+\.\d+|[\uff08(][1-9][0-9]*[)\uff09])[\u3001.\-:：\s].+")
ABSTRACT_PATTERN = re.compile(rf"^\s*({ZH_ABSTRACT}|abstract)\s*$", re.IGNORECASE)
KEYWORDS_PATTERN = re.compile(rf"^\s*({ZH_KEYWORDS}|key\s*words?)\s*[:\uff1a]", re.IGNORECASE)
TOC_PATTERN = re.compile(rf"^\s*{ZH_TOC}\s*$", re.IGNORECASE)
REFERENCES_PATTERN = re.compile(rf"^\s*{ZH_REFERENCES}[\s\uff1a:]*$", re.IGNORECASE)
ACKNOWLEDGEMENT_PATTERN = re.compile(rf"^\s*{ZH_ACKNOWLEDGEMENT}[\s\uff1a:]*$", re.IGNORECASE)
APPENDIX_PATTERN = re.compile(
    rf"^\s*{ZH_APPENDIX}[\sA-Za-z0-9{ZH_ORDINAL}{ROMAN_ORDINAL}\u3001.\-:：\uff08\uff09()]*.*$",
    re.IGNORECASE,
)
BODY_START_PATTERN = re.compile(
    rf"^\s*((\d+(\.\d+)*)|\u7b2c[{ZH_ORDINAL}\d]+[\u7ae0\u8282])[\s\u3001.\-:：]*"
)
BODY_HEADING_1_PATTERN = re.compile(
    rf"^\s*(\d+|[{ZH_ORDINAL}]+|\u7b2c[{ZH_ORDINAL}\d]+\u7ae0)[\s\u3001.\-:：]+.+$"
)
BODY_HEADING_2_PATTERN = re.compile(r"^\s*\d+\.\d+[\s\u3001.\-:：]+.+$")
BODY_HEADING_3_PATTERN = re.compile(r"^\s*\d+\.\d+\.\d+[\s\u3001.\-:：]+.+$")
COMMON_BODY_HEADINGS = {
    "\u7eea\u8bba",
    "\u5f15\u8a00",
    "\u7cfb\u7edf\u6982\u8ff0",
    "\u9700\u6c42\u5206\u6790",
    "\u603b\u4f53\u8bbe\u8ba1",
    "\u8be6\u7ec6\u8bbe\u8ba1",
    "\u7f16\u7801\u5b9e\u73b0",
    "\u7cfb\u7edf\u5b9e\u73b0",
    "\u5b9e\u73b0\u8fc7\u7a0b\u622a\u56fe",
    "\u5b9e\u9a8c\u7ed3\u679c",
    "\u6d4b\u8bd5\u7ed3\u679c",
    "\u7ed3\u675f\u8bed",
    "\u7ed3\u8bba",
    "\u81f4\u8c22",
    "\u53c2\u8003\u6587\u732e",
    "\u9644\u5f55",
    "\u6458\u8981",
    "\u76ee\u5f55",
    "\u524d\u8a00",
    "\u7cfb\u7edf\u5f00\u53d1\u80cc\u666f",
}
PROFILE_FIELDS = {
    "body_font",
    "latin_font",
    "heading_1_font",
    "heading_2_font",
    "heading_3_font",
    "body_size_pt",
    "heading_1_size_pt",
    "heading_2_size_pt",
    "heading_3_size_pt",
    "table_size_pt",
    "line_spacing",
    "first_line_indent_cm",
    "margin_top_cm",
    "margin_bottom_cm",
    "margin_left_cm",
    "margin_right_cm",
    "heading_1_align",
    "heading_2_align",
    "heading_3_align",
    "body_align",
    "add_page_number",
    "chapter_page_break",
    "reference_hanging_indent_cm",
    "reference_line_spacing",
    "appendix_english_font",
    "appendix_translation_font",
    "appendix_code_font",
    "appendix_english_size_pt",
    "appendix_translation_size_pt",
    "appendix_code_size_pt",
    "appendix_english_line_spacing",
    "appendix_translation_line_spacing",
    "appendix_code_line_spacing",
    "abstract_heading_font",
    "abstract_heading_size_pt",
    "abstract_heading_align",
    "abstract_body_font",
    "abstract_body_size_pt",
    "abstract_body_line_spacing",
    "abstract_keywords_font",
    "abstract_keywords_size_pt",
    "english_abstract_heading_font",
    "english_abstract_heading_size_pt",
    "english_abstract_heading_align",
    "english_abstract_body_font",
    "english_abstract_body_size_pt",
    "english_abstract_body_line_spacing",
    "english_keywords_font",
    "english_keywords_size_pt",
    "toc_heading_font",
    "toc_heading_size_pt",
    "toc_heading_align",
    "toc_body_font",
    "toc_body_size_pt",
    "toc_body_line_spacing",
    "header_text",
    "header_font",
    "header_size_pt",
    "header_line_spacing",
    "header_distance_cm",
    "page_number_font",
    "page_number_size_pt",
    "page_number_align",
    "page_number_bottom_cm",
    "caption_font",
    "caption_size_pt",
    "figure_caption_align",
    "table_caption_align",
}

# Override a few text-pattern constants with clean UTF-8 variants. The older
# literals above were introduced through mixed encodings and can silently break
# section detection for headings like 摘要 / 目录 / 绪论.
ROMAN_ORDINAL = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX"
APPENDIX_PATTERN = re.compile(rf"^\s*{ZH_APPENDIX}[\sA-Za-z0-9{ZH_ORDINAL}{ROMAN_ORDINAL}\u3001.．:：-]*.*$", re.IGNORECASE)
BODY_START_PATTERN = re.compile(
    rf"^\s*((\d+(\.\d+)*)|\u7b2c[{ZH_ORDINAL}\d]+[\u7ae0\u8282])[\s\u3001.．]?"
)
BODY_HEADING_1_PATTERN = re.compile(
    rf"^\s*(\d+|[{ZH_ORDINAL}]+)[\s\u3001.．]+.+$"
)
BODY_HEADING_2_PATTERN = re.compile(r"^\s*\d+\.\d+[\s\u3001.．]+.+$")
BODY_HEADING_3_PATTERN = re.compile(r"^\s*\d+\.\d+\.\d+[\s\u3001.．]+.+$")
COMMON_BODY_HEADINGS = {
    "绪论",
    "引言",
    "系统概述",
    "需求分析",
    "总体设计",
    "详细设计",
    "编码实现",
    "系统实现",
    "实现过程截图",
    "实验结果",
    "测试结果",
    "结束语",
    "结论",
    "致谢",
    "参考文献",
    "附录",
    "摘要",
    "目录",
    "前言",
    "系统开发背景",
}


def normalize_paper_docx(
    content: bytes,
    profile_key: str = DEFAULT_PROFILE.key,
    requirements: dict[str, Any] | None = None,
) -> tuple[bytes, dict]:
    profile, explicit_fields, full_apply = build_profile(profile_key, requirements)
    document = Document(BytesIO(content))
    contexts = _build_paragraph_contexts(document.paragraphs)
    section_roles = _ensure_logical_sections(document, contexts)
    stats = {
        "profile": profile.key,
        "profile_title": profile.title,
        "requirements": serialize_profile(profile),
        "explicit_requirements": sorted(explicit_fields),
        "paragraphs": 0,
        "heading_1": 0,
        "heading_2": 0,
        "heading_3": 0,
        "reference_items": 0,
        "tables": len(document.tables),
        "sections": {},
        "appendix_kinds": {"english": 0, "translation": 0, "code": 0},
    }

    _apply_sections(document, profile, explicit_fields=explicit_fields, full_apply=full_apply)
    _apply_document_styles(document, profile, explicit_fields=explicit_fields, full_apply=full_apply)
    _apply_headers(document, profile, section_roles, explicit_fields=explicit_fields, full_apply=full_apply)

    for paragraph, context in zip(document.paragraphs, contexts):
        if not paragraph.text.strip():
            continue
        stats["paragraphs"] += 1
        stats["sections"][context.section] = stats["sections"].get(context.section, 0) + 1

        if context.role == "abstract_heading":
            stats["heading_1"] += 1
            _format_abstract_heading(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "toc_heading":
            stats["heading_1"] += 1
            _format_toc_heading(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role in {"heading_1", "references_heading", "appendix_heading"}:
            stats["heading_1"] += 1
            if profile.chapter_page_break and context.section == "body":
                _ensure_page_break_before(paragraph)
            _format_heading_1(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "heading_2":
            stats["heading_2"] += 1
            _format_heading_2(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "heading_3":
            stats["heading_3"] += 1
            _format_heading_3(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "cover":
            _format_cover(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "abstract_body":
            _format_abstract_body(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "keywords":
            _format_keywords(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "toc_item":
            _format_toc_item(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "figure_caption":
            _format_caption(
                paragraph,
                profile,
                explicit_fields=explicit_fields,
                full_apply=full_apply,
                align=profile.figure_caption_align,
            )
        elif context.role == "table_caption":
            _format_caption(
                paragraph,
                profile,
                explicit_fields=explicit_fields,
                full_apply=full_apply,
                align=profile.table_caption_align,
            )
        elif context.role == "reference_item":
            stats["reference_items"] += 1
            _format_reference_item(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        elif context.role == "appendix_body":
            if context.appendix_kind in stats["appendix_kinds"]:
                stats["appendix_kinds"][context.appendix_kind] += 1
            _format_appendix_body(
                paragraph,
                profile,
                explicit_fields=explicit_fields,
                full_apply=full_apply,
                appendix_kind=context.appendix_kind,
            )
        else:
            _format_body(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)

    for table in document.tables:
        _format_table(table, profile, explicit_fields=explicit_fields, full_apply=full_apply)

    if (full_apply or "add_page_number" in explicit_fields) and profile.add_page_number:
        _apply_footer_page_number(document, profile, section_roles)

    stats["validation_report"] = _build_validation_report(
        document,
        contexts,
        profile,
        explicit_fields,
        full_apply,
        section_roles,
    )
    output = BytesIO()
    document.save(output)
    stats["execution_report"] = _build_execution_report(profile, explicit_fields, full_apply, stats)
    return output.getvalue(), stats


def build_profile(
    profile_key: str = DEFAULT_PROFILE.key, requirements: dict[str, Any] | None = None
) -> tuple[FormatProfile, set[str], bool]:
    base = PROFILES.get(profile_key) or DEFAULT_PROFILE
    data = requirements or {}
    if not isinstance(data, dict):
        data = {}
    full_apply = profile_key in PROFILES

    overrides: dict[str, Any] = {}
    string_fields = {
        "body_font",
        "latin_font",
        "heading_1_font",
        "heading_2_font",
        "heading_3_font",
        "appendix_english_font",
        "appendix_translation_font",
        "appendix_code_font",
        "abstract_heading_font",
        "abstract_body_font",
        "abstract_keywords_font",
        "english_abstract_heading_font",
        "english_abstract_body_font",
        "english_keywords_font",
        "toc_heading_font",
        "toc_body_font",
        "header_text",
        "header_font",
        "page_number_font",
        "caption_font",
        "heading_1_align",
        "heading_2_align",
        "heading_3_align",
        "body_align",
        "abstract_heading_align",
        "english_abstract_heading_align",
        "toc_heading_align",
        "page_number_align",
        "figure_caption_align",
        "table_caption_align",
    }
    numeric_fields = {
        "body_size_pt": (8, 22),
        "heading_1_size_pt": (10, 30),
        "heading_2_size_pt": (9, 26),
        "heading_3_size_pt": (8, 22),
        "table_size_pt": (7, 18),
        "line_spacing": (1.0, 3.0),
        "first_line_indent_cm": (0, 2.5),
        "margin_top_cm": (1, 5),
        "margin_bottom_cm": (1, 5),
        "margin_left_cm": (1, 5),
        "margin_right_cm": (1, 5),
        "reference_hanging_indent_cm": (0, 2.5),
        "reference_line_spacing": (1.0, 3.0),
        "appendix_english_size_pt": (7, 18),
        "appendix_translation_size_pt": (8, 22),
        "appendix_code_size_pt": (7, 18),
        "appendix_english_line_spacing": (1.0, 3.0),
        "appendix_translation_line_spacing": (1.0, 3.0),
        "appendix_code_line_spacing": (1.0, 3.0),
        "abstract_heading_size_pt": (10, 30),
        "abstract_body_size_pt": (8, 22),
        "abstract_body_line_spacing": (1.0, 3.0),
        "abstract_keywords_size_pt": (8, 22),
        "english_abstract_heading_size_pt": (10, 30),
        "english_abstract_body_size_pt": (8, 22),
        "english_abstract_body_line_spacing": (1.0, 3.0),
        "english_keywords_size_pt": (8, 22),
        "toc_heading_size_pt": (10, 30),
        "toc_body_size_pt": (7, 18),
        "toc_body_line_spacing": (1.0, 3.0),
        "header_size_pt": (7, 18),
        "header_line_spacing": (1.0, 3.0),
        "header_distance_cm": (0.5, 5.0),
        "page_number_size_pt": (7, 18),
        "page_number_bottom_cm": (0.5, 5.0),
        "caption_size_pt": (7, 18),
    }
    align_fields = {
        "heading_1_align",
        "heading_2_align",
        "heading_3_align",
        "body_align",
        "abstract_heading_align",
        "english_abstract_heading_align",
        "toc_heading_align",
        "page_number_align",
        "figure_caption_align",
        "table_caption_align",
    }

    for field in string_fields:
        value = data.get(field)
        if isinstance(value, str) and value.strip():
            normalized = value.strip()[:60]
            if field in align_fields and normalized not in {"left", "center", "right", "justify"}:
                continue
            overrides[field] = normalized

    for field, (minimum, maximum) in numeric_fields.items():
        value = data.get(field)
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        overrides[field] = min(max(number, minimum), maximum)

    if isinstance(data.get("add_page_number"), bool):
        overrides["add_page_number"] = data["add_page_number"]
    if isinstance(data.get("chapter_page_break"), bool):
        overrides["chapter_page_break"] = data["chapter_page_break"]
    if overrides:
        profile = replace(base, **overrides)
        if not full_apply:
            profile = replace(profile, key="custom", title="\u7528\u6237\u81ea\u5b9a\u4e49\u8bba\u6587\u683c\u5f0f")
        return profile, set(overrides.keys()), full_apply
    if full_apply:
        return base, set(PROFILE_FIELDS), True
    return base, set(), False


def serialize_profile(profile: FormatProfile) -> dict[str, Any]:
    return {
        "body_font": profile.body_font,
        "latin_font": profile.latin_font,
        "heading_1_font": profile.heading_1_font,
        "heading_2_font": profile.heading_2_font,
        "heading_3_font": profile.heading_3_font,
        "body_size_pt": profile.body_size_pt,
        "heading_1_size_pt": profile.heading_1_size_pt,
        "heading_2_size_pt": profile.heading_2_size_pt,
        "heading_3_size_pt": profile.heading_3_size_pt,
        "table_size_pt": profile.table_size_pt,
        "line_spacing": profile.line_spacing,
        "first_line_indent_cm": profile.first_line_indent_cm,
        "margin_top_cm": profile.margin_top_cm,
        "margin_bottom_cm": profile.margin_bottom_cm,
        "margin_left_cm": profile.margin_left_cm,
        "margin_right_cm": profile.margin_right_cm,
        "heading_1_align": profile.heading_1_align,
        "heading_2_align": profile.heading_2_align,
        "heading_3_align": profile.heading_3_align,
        "body_align": profile.body_align,
        "add_page_number": profile.add_page_number,
        "chapter_page_break": profile.chapter_page_break,
        "reference_hanging_indent_cm": profile.reference_hanging_indent_cm,
        "reference_line_spacing": profile.reference_line_spacing,
        "appendix_english_font": profile.appendix_english_font,
        "appendix_translation_font": profile.appendix_translation_font,
        "appendix_code_font": profile.appendix_code_font,
        "appendix_english_size_pt": profile.appendix_english_size_pt,
        "appendix_translation_size_pt": profile.appendix_translation_size_pt,
        "appendix_code_size_pt": profile.appendix_code_size_pt,
        "appendix_english_line_spacing": profile.appendix_english_line_spacing,
        "appendix_translation_line_spacing": profile.appendix_translation_line_spacing,
        "appendix_code_line_spacing": profile.appendix_code_line_spacing,
        "abstract_heading_font": profile.abstract_heading_font,
        "abstract_heading_size_pt": profile.abstract_heading_size_pt,
        "abstract_heading_align": profile.abstract_heading_align,
        "abstract_body_font": profile.abstract_body_font,
        "abstract_body_size_pt": profile.abstract_body_size_pt,
        "abstract_body_line_spacing": profile.abstract_body_line_spacing,
        "abstract_keywords_font": profile.abstract_keywords_font,
        "abstract_keywords_size_pt": profile.abstract_keywords_size_pt,
        "english_abstract_heading_font": profile.english_abstract_heading_font,
        "english_abstract_heading_size_pt": profile.english_abstract_heading_size_pt,
        "english_abstract_heading_align": profile.english_abstract_heading_align,
        "english_abstract_body_font": profile.english_abstract_body_font,
        "english_abstract_body_size_pt": profile.english_abstract_body_size_pt,
        "english_abstract_body_line_spacing": profile.english_abstract_body_line_spacing,
        "english_keywords_font": profile.english_keywords_font,
        "english_keywords_size_pt": profile.english_keywords_size_pt,
        "toc_heading_font": profile.toc_heading_font,
        "toc_heading_size_pt": profile.toc_heading_size_pt,
        "toc_heading_align": profile.toc_heading_align,
        "toc_body_font": profile.toc_body_font,
        "toc_body_size_pt": profile.toc_body_size_pt,
        "toc_body_line_spacing": profile.toc_body_line_spacing,
        "header_text": profile.header_text,
        "header_font": profile.header_font,
        "header_size_pt": profile.header_size_pt,
        "header_line_spacing": profile.header_line_spacing,
        "header_distance_cm": profile.header_distance_cm,
        "page_number_font": profile.page_number_font,
        "page_number_size_pt": profile.page_number_size_pt,
        "page_number_align": profile.page_number_align,
        "page_number_bottom_cm": profile.page_number_bottom_cm,
        "caption_font": profile.caption_font,
        "caption_size_pt": profile.caption_size_pt,
        "figure_caption_align": profile.figure_caption_align,
        "table_caption_align": profile.table_caption_align,
    }


def _build_execution_report(
    profile: FormatProfile,
    explicit_fields: set[str],
    full_apply: bool,
    stats: dict[str, Any],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add_check(key: str, label: str, status: str, detail: str) -> None:
        checks.append({"key": key, "label": label, "status": status, "detail": detail})

    def has_any(*names: str) -> bool:
        return full_apply or any(name in explicit_fields for name in names)

    if has_any("body_font", "latin_font", "body_size_pt", "line_spacing", "body_align", "first_line_indent_cm"):
        add_check("body", "正文样式", "done", f"已处理 {stats.get('paragraphs', 0)} 个正文相关段落。")

    if has_any(
        "heading_1_font",
        "heading_1_size_pt",
        "heading_1_align",
        "heading_2_font",
        "heading_2_size_pt",
        "heading_2_align",
        "heading_3_font",
        "heading_3_size_pt",
        "heading_3_align",
    ):
        add_check(
            "headings",
            "标题层级",
            "done",
            f"已识别一级标题 {stats.get('heading_1', 0)} 个，二级标题 {stats.get('heading_2', 0)} 个，三级标题 {stats.get('heading_3', 0)} 个。",
        )

    if has_any("margin_top_cm", "margin_bottom_cm", "margin_left_cm", "margin_right_cm"):
        add_check(
            "margins",
            "页边距",
            "done",
            f"当前使用上 {profile.margin_top_cm:.2f} / 下 {profile.margin_bottom_cm:.2f} / 左 {profile.margin_left_cm:.2f} / 右 {profile.margin_right_cm:.2f} cm。",
        )

    if has_any("table_size_pt"):
        table_count = stats.get("tables", 0)
        add_check(
            "tables",
            "表格字体",
            "done" if table_count else "info",
            f"{'已处理' if table_count else '本次文档中未发现'} {table_count} 个表格。",
        )

    if has_any("add_page_number") and profile.add_page_number:
        add_check("page_number", "页码", "done", "已在页脚插入页码字段。")

    if has_any("chapter_page_break") and profile.chapter_page_break:
        body_count = stats.get("sections", {}).get("body", 0)
        add_check(
            "chapter_page_break",
            "章标题分页",
            "done" if body_count else "warn",
            "已对正文一级标题启用独立分页。" if body_count else "要求已接收，但当前文档里没有识别到正文区块。",
        )

    if has_any("reference_hanging_indent_cm", "reference_line_spacing"):
        reference_count = stats.get("reference_items", 0)
        add_check(
            "references",
            "参考文献",
            "done" if reference_count else "warn",
            f"{'已处理' if reference_count else '要求已接收，但未识别到'} {reference_count} 条参考文献段落。",
        )

    appendix_kinds = stats.get("appendix_kinds", {})
    appendix_specs = [
        (
            "appendix_english",
            "附录英文原文",
            ("appendix_english_font", "appendix_english_size_pt", "appendix_english_line_spacing"),
            appendix_kinds.get("english", 0),
        ),
        (
            "appendix_translation",
            "附录中文翻译",
            ("appendix_translation_font", "appendix_translation_size_pt", "appendix_translation_line_spacing"),
            appendix_kinds.get("translation", 0),
        ),
        (
            "appendix_code",
            "附录代码",
            ("appendix_code_font", "appendix_code_size_pt", "appendix_code_line_spacing"),
            appendix_kinds.get("code", 0),
        ),
    ]
    for key, label, fields, count in appendix_specs:
        if not has_any(*fields):
            continue
        add_check(
            key,
            label,
            "done" if count else "warn",
            f"{'已处理' if count else '要求已接收，但未识别到'} {count} 个相关段落。",
        )

    unsupported = []
    if stats.get("reference_items", 0):
        unsupported.append("参考文献条目内容本身的著录顺序与作者写法，目前仍建议人工复核。")
    if stats.get("sections", {}).get("body", 0):
        unsupported.append("节标题是否落在页尾、页面留白是否过大，这类版面问题目前仍建议人工复核。")

    validation = stats.get("validation_report") or {}
    for check in validation.get("checks") or []:
        if isinstance(check, dict):
            checks.append(check)

    return {
        "mode": "profile" if full_apply else "custom",
        "applied_count": len(explicit_fields),
        "checks": checks,
        "unsupported_notes": unsupported,
        "validation_summary": validation.get("summary", {}),
    }


def _build_validation_report(
    document: Document,
    contexts: list[ParagraphContext],
    profile: FormatProfile,
    explicit_fields: set[str],
    full_apply: bool,
    section_roles: list[str],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add_check(key: str, label: str, status: str, detail: str) -> None:
        checks.append({"key": f"verify_{key}", "label": label, "status": status, "detail": detail})

    def should_check(*fields: str) -> bool:
        return full_apply or any(field in explicit_fields for field in fields)

    if should_check("margin_top_cm", "margin_bottom_cm", "margin_left_cm", "margin_right_cm"):
        margin_errors: list[str] = []
        for section in document.sections:
            _append_length_error(margin_errors, "\u4e0a\u8fb9\u8ddd", section.top_margin.cm, profile.margin_top_cm)
            _append_length_error(margin_errors, "\u4e0b\u8fb9\u8ddd", section.bottom_margin.cm, profile.margin_bottom_cm)
            _append_length_error(margin_errors, "\u5de6\u8fb9\u8ddd", section.left_margin.cm, profile.margin_left_cm)
            _append_length_error(margin_errors, "\u53f3\u8fb9\u8ddd", section.right_margin.cm, profile.margin_right_cm)
        add_check(
            "margins",
            "\u9875\u8fb9\u8ddd\u81ea\u68c0",
            "warn" if margin_errors else "done",
            "\uff1b".join(margin_errors[:3]) if margin_errors else "\u5df2\u62bd\u68c0\u5206\u8282\u9875\u8fb9\u8ddd\uff0c\u4e0e\u5f53\u524d\u89c4\u5219\u4e00\u81f4\u3002",
        )

    if should_check("body_font", "latin_font", "body_size_pt", "line_spacing", "body_align", "first_line_indent_cm"):
        _add_paragraph_validation_check(
            checks,
            key="body",
            label="\u6b63\u6587\u6837\u5f0f\u81ea\u68c0",
            paragraph=_find_context_paragraph(document, contexts, roles={"body"}),
            profile=profile,
            expected_font=profile.body_font if should_check("body_font") else None,
            expected_latin_font=profile.latin_font if should_check("latin_font") else None,
            expected_size_pt=profile.body_size_pt if should_check("body_size_pt") else None,
            expected_spacing=profile.line_spacing if should_check("line_spacing") else None,
            expected_align=profile.body_align if should_check("body_align") else None,
            expected_first_indent_cm=profile.first_line_indent_cm if should_check("first_line_indent_cm") else None,
        )

    _add_paragraph_validation_check(
        checks,
        key="heading_1",
        label="\u4e00\u7ea7\u6807\u9898\u81ea\u68c0",
        paragraph=_find_context_paragraph(document, contexts, roles={"heading_1"}),
        profile=profile,
        expected_font=profile.heading_1_font if should_check("heading_1_font") else None,
        expected_latin_font=profile.latin_font if should_check("latin_font") else None,
        expected_size_pt=profile.heading_1_size_pt if should_check("heading_1_size_pt") else None,
        expected_align=profile.heading_1_align if should_check("heading_1_align") else None,
        skip_if_no_expectation=True,
    )
    _add_paragraph_validation_check(
        checks,
        key="heading_2",
        label="\u4e8c\u7ea7\u6807\u9898\u81ea\u68c0",
        paragraph=_find_context_paragraph(document, contexts, roles={"heading_2"}),
        profile=profile,
        expected_font=profile.heading_2_font if should_check("heading_2_font") else None,
        expected_latin_font=profile.latin_font if should_check("latin_font") else None,
        expected_size_pt=profile.heading_2_size_pt if should_check("heading_2_size_pt") else None,
        expected_align=profile.heading_2_align if should_check("heading_2_align") else None,
        skip_if_no_expectation=True,
    )
    _add_paragraph_validation_check(
        checks,
        key="heading_3",
        label="\u4e09\u7ea7\u6807\u9898\u81ea\u68c0",
        paragraph=_find_context_paragraph(document, contexts, roles={"heading_3"}),
        profile=profile,
        expected_font=profile.heading_3_font if should_check("heading_3_font") else None,
        expected_latin_font=profile.latin_font if should_check("latin_font") else None,
        expected_size_pt=profile.heading_3_size_pt if should_check("heading_3_size_pt") else None,
        expected_align=profile.heading_3_align if should_check("heading_3_align") else None,
        skip_if_no_expectation=True,
    )

    if should_check("abstract_heading_font", "abstract_heading_size_pt", "abstract_heading_align"):
        _add_paragraph_validation_check(
            checks,
            key="abstract_heading",
            label="\u4e2d\u6587\u6458\u8981\u81ea\u68c0",
            paragraph=_find_context_paragraph(document, contexts, roles={"abstract_heading"}, text_predicate=lambda text: text.lower() != "abstract"),
            profile=profile,
            expected_font=profile.abstract_heading_font if should_check("abstract_heading_font") else None,
            expected_size_pt=profile.abstract_heading_size_pt if should_check("abstract_heading_size_pt") else None,
            expected_align=profile.abstract_heading_align if should_check("abstract_heading_align") else None,
        )

    if should_check("toc_heading_font", "toc_heading_size_pt", "toc_heading_align", "toc_body_font", "toc_body_size_pt", "toc_body_line_spacing"):
        _add_paragraph_validation_check(
            checks,
            key="toc",
            label="\u76ee\u5f55\u6837\u5f0f\u81ea\u68c0",
            paragraph=_find_context_paragraph(document, contexts, roles={"toc_heading", "toc_item"}),
            profile=profile,
            expected_font=profile.toc_heading_font if should_check("toc_heading_font") else None,
            expected_size_pt=profile.toc_heading_size_pt if should_check("toc_heading_size_pt") else None,
            expected_align=profile.toc_heading_align if should_check("toc_heading_align") else None,
        )

    appendix_specs = [
        (
            "appendix_english",
            "\u9644\u5f55\u82f1\u6587\u81ea\u68c0",
            "english",
            profile.appendix_english_font,
            profile.appendix_english_size_pt,
            profile.appendix_english_line_spacing,
            ("appendix_english_font", "appendix_english_size_pt", "appendix_english_line_spacing"),
        ),
        (
            "appendix_translation",
            "\u9644\u5f55\u4e2d\u6587\u81ea\u68c0",
            "translation",
            profile.appendix_translation_font,
            profile.appendix_translation_size_pt,
            profile.appendix_translation_line_spacing,
            ("appendix_translation_font", "appendix_translation_size_pt", "appendix_translation_line_spacing"),
        ),
        (
            "appendix_code",
            "\u9644\u5f55\u4ee3\u7801\u81ea\u68c0",
            "code",
            profile.appendix_code_font,
            profile.appendix_code_size_pt,
            profile.appendix_code_line_spacing,
            ("appendix_code_font", "appendix_code_size_pt", "appendix_code_line_spacing"),
        ),
    ]
    for key, label, appendix_kind, font, size_pt, spacing, fields in appendix_specs:
        if not should_check(*fields):
            continue
        _add_paragraph_validation_check(
            checks,
            key=key,
            label=label,
            paragraph=_find_context_paragraph(document, contexts, roles={"appendix_body"}, appendix_kind=appendix_kind),
            profile=profile,
            expected_font=font if should_check(fields[0]) else None,
            expected_latin_font=font if appendix_kind in {"english", "code"} and should_check(fields[0]) else None,
            expected_size_pt=size_pt if should_check(fields[1]) else None,
            expected_spacing=spacing if should_check(fields[2]) else None,
        )

    if should_check("header_text", "header_font", "header_size_pt"):
        header_status, header_detail = _verify_headers(document, profile, section_roles)
        add_check("header", "\u9875\u7709\u81ea\u68c0", header_status, header_detail)

    if profile.add_page_number and should_check("add_page_number", "page_number_font", "page_number_size_pt", "page_number_align", "page_number_bottom_cm"):
        page_status, page_detail = _verify_page_numbers(document, profile, section_roles)
        add_check("page_number", "\u9875\u7801\u81ea\u68c0", page_status, page_detail)

    return {
        "checks": checks,
        "summary": {
            "passed": sum(1 for item in checks if item.get("status") == "done"),
            "warnings": sum(1 for item in checks if item.get("status") == "warn"),
            "info": sum(1 for item in checks if item.get("status") == "info"),
        },
    }


def _add_paragraph_validation_check(
    checks: list[dict[str, Any]],
    *,
    key: str,
    label: str,
    paragraph,
    profile: FormatProfile,
    expected_font: str | None = None,
    expected_latin_font: str | None = None,
    expected_size_pt: float | None = None,
    expected_spacing: float | None = None,
    expected_align: str | None = None,
    expected_first_indent_cm: float | None = None,
    skip_if_no_expectation: bool = False,
) -> None:
    expectations = [
        expected_font,
        expected_latin_font,
        expected_size_pt,
        expected_spacing,
        expected_align,
        expected_first_indent_cm,
    ]
    if skip_if_no_expectation and not any(value is not None for value in expectations):
        return
    if paragraph is None:
        checks.append(
            {
                "key": f"verify_{key}",
                "label": label,
                "status": "info",
                "detail": "\u672a\u627e\u5230\u53ef\u62bd\u6837\u6bb5\u843d\uff0c\u8be5\u9879\u4fdd\u7559\u4e3a\u5f85\u590d\u6838\u3002",
            }
        )
        return

    errors: list[str] = []
    run = _first_text_run(paragraph)
    if run is None:
        errors.append("\u6bb5\u843d\u6ca1\u6709\u53ef\u68c0\u67e5\u7684\u6587\u5b57\u8fd0\u884c")
    else:
        if expected_font is not None:
            actual_font = _run_east_asian_font(run) or getattr(run.font, "name", None) or ""
            if actual_font and actual_font != expected_font:
                errors.append(f"\u5b57\u4f53 {actual_font} \u2260 {expected_font}")
        if expected_latin_font is not None:
            actual_latin = getattr(run.font, "name", None) or _run_latin_font(run) or ""
            if actual_latin and actual_latin != expected_latin_font:
                errors.append(f"\u82f1\u6587\u5b57\u4f53 {actual_latin} \u2260 {expected_latin_font}")
        if expected_size_pt is not None:
            actual_size = getattr(getattr(run.font, "size", None), "pt", None)
            if actual_size is not None and not _near(float(actual_size), expected_size_pt, 0.15):
                errors.append(f"\u5b57\u53f7 {float(actual_size):.1f}pt \u2260 {expected_size_pt:.1f}pt")

    if expected_spacing is not None:
        actual_spacing = _paragraph_line_spacing_value(paragraph)
        if actual_spacing is not None and not _near(actual_spacing, expected_spacing, 0.05):
            errors.append(f"\u884c\u8ddd {actual_spacing:.2f} \u2260 {expected_spacing:.2f}")
    if expected_align is not None:
        actual_align = _alignment_name(paragraph.alignment)
        if actual_align and actual_align != expected_align:
            errors.append(f"\u5bf9\u9f50 {actual_align} \u2260 {expected_align}")
    if expected_first_indent_cm is not None:
        actual_indent = _length_cm(paragraph.paragraph_format.first_line_indent)
        if actual_indent is not None and not _near(actual_indent, expected_first_indent_cm, 0.08):
            errors.append(f"\u9996\u884c\u7f29\u8fdb {actual_indent:.2f}cm \u2260 {expected_first_indent_cm:.2f}cm")

    checks.append(
        {
            "key": f"verify_{key}",
            "label": label,
            "status": "warn" if errors else "done",
            "detail": "\uff1b".join(errors[:3]) if errors else "\u62bd\u6837\u68c0\u67e5\u901a\u8fc7\uff0c\u6837\u5f0f\u5df2\u5199\u5165 Word \u6bb5\u843d\u3002",
        }
    )


def _find_context_paragraph(
    document: Document,
    contexts: list[ParagraphContext],
    *,
    roles: set[str],
    appendix_kind: str | None = None,
    text_predicate=None,
):
    for paragraph, context in zip(document.paragraphs, contexts):
        text = (paragraph.text or "").strip()
        if not text or context.role not in roles:
            continue
        if appendix_kind is not None and context.appendix_kind != appendix_kind:
            continue
        if text_predicate is not None and not text_predicate(text):
            continue
        return paragraph
    return None


def _append_length_error(errors: list[str], label: str, actual: float | None, expected: float) -> None:
    if actual is None:
        return
    if not _near(float(actual), expected, 0.08):
        errors.append(f"{label} {float(actual):.2f}cm \u2260 {expected:.2f}cm")


def _verify_headers(document: Document, profile: FormatProfile, section_roles: list[str]) -> tuple[str, str]:
    checked = 0
    errors: list[str] = []
    for index, section in enumerate(document.sections):
        role = section_roles[index] if index < len(section_roles) else "body"
        if role == "front_matter":
            continue
        checked += 1
        text = "\n".join(paragraph.text.strip() for paragraph in section.header.paragraphs if paragraph.text.strip())
        if profile.header_text and profile.header_text not in text:
            errors.append("\u9875\u7709\u6587\u5b57\u672a\u547d\u4e2d")
    if not checked:
        return "info", "\u672a\u68c0\u6d4b\u5230\u9700\u8981\u9875\u7709\u7684\u5206\u8282\u3002"
    return ("warn", "\uff1b".join(errors[:3])) if errors else ("done", "\u5df2\u62bd\u68c0\u9875\u7709\u5206\u8282\uff0c\u9875\u7709\u6587\u5b57\u5df2\u5199\u5165\u3002")


def _verify_page_numbers(document: Document, profile: FormatProfile, section_roles: list[str]) -> tuple[str, str]:
    errors: list[str] = []
    checked = 0
    for index, section in enumerate(document.sections):
        role = section_roles[index] if index < len(section_roles) else "body"
        if role == "front_matter":
            continue
        checked += 1
        if not _footer_has_page_field(section):
            errors.append("\u9875\u811a\u672a\u627e\u5230 PAGE \u5b57\u6bb5")
        expected_format = "upperRoman" if role == "front_roman" else "decimal"
        actual_format = _section_page_number_format(section)
        if actual_format and actual_format != expected_format:
            errors.append(f"\u9875\u7801\u683c\u5f0f {actual_format} \u2260 {expected_format}")
        align = _alignment_name(section.footer.paragraphs[0].alignment) if section.footer.paragraphs else ""
        if align and align != profile.page_number_align:
            errors.append(f"\u9875\u7801\u5bf9\u9f50 {align} \u2260 {profile.page_number_align}")
    if not checked:
        return "info", "\u672a\u68c0\u6d4b\u5230\u9700\u8981\u9875\u7801\u7684\u5206\u8282\u3002"
    return ("warn", "\uff1b".join(errors[:3])) if errors else ("done", "\u5df2\u68c0\u67e5\u9875\u7801\u5b57\u6bb5\u548c\u5206\u8282\u7f16\u53f7\u683c\u5f0f\u3002")


def _footer_has_page_field(section: Section) -> bool:
    for paragraph in section.footer.paragraphs:
        for run in paragraph.runs:
            if any((node.text or "").strip().upper() == "PAGE" for node in run._r.findall(qn("w:instrText"))):
                return True
    return False


def _section_page_number_format(section: Section) -> str:
    pg_num_type = section._sectPr.find(qn("w:pgNumType"))
    if pg_num_type is None:
        return ""
    return pg_num_type.get(qn("w:fmt")) or ""


def _first_text_run(paragraph):
    for run in paragraph.runs:
        if (run.text or "").strip():
            return run
    return paragraph.runs[0] if paragraph.runs else None


def _run_east_asian_font(run) -> str:
    r_pr = run._element.rPr
    if r_pr is None or r_pr.rFonts is None:
        return ""
    return r_pr.rFonts.get(qn("w:eastAsia")) or ""


def _run_latin_font(run) -> str:
    r_pr = run._element.rPr
    if r_pr is None or r_pr.rFonts is None:
        return ""
    return r_pr.rFonts.get(qn("w:ascii")) or r_pr.rFonts.get(qn("w:hAnsi")) or ""


def _paragraph_line_spacing_value(paragraph) -> float | None:
    spacing = paragraph.paragraph_format.line_spacing
    if isinstance(spacing, (int, float)):
        return float(spacing)
    rule = paragraph.paragraph_format.line_spacing_rule
    if rule == WD_LINE_SPACING.SINGLE:
        return 1.0
    if rule == WD_LINE_SPACING.ONE_POINT_FIVE:
        return 1.5
    if rule == WD_LINE_SPACING.DOUBLE:
        return 2.0
    return None


def _alignment_name(value) -> str:
    if value == WD_ALIGN_PARAGRAPH.CENTER:
        return "center"
    if value == WD_ALIGN_PARAGRAPH.RIGHT:
        return "right"
    if value == WD_ALIGN_PARAGRAPH.JUSTIFY:
        return "justify"
    if value == WD_ALIGN_PARAGRAPH.LEFT:
        return "left"
    return ""


def _length_cm(value) -> float | None:
    if value is None:
        return None
    return round(float(value.cm), 2)


def _near(actual: float, expected: float, tolerance: float) -> bool:
    return abs(float(actual) - float(expected)) <= tolerance


def _apply_sections(
    document: Document, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool
) -> None:
    for section in document.sections:
        if full_apply:
            section.start_type = WD_SECTION_START.NEW_PAGE
            section.page_height = Cm(29.7)
            section.page_width = Cm(21.0)
            section.header_distance = Cm(profile.header_distance_cm)
            section.footer_distance = Cm(profile.page_number_bottom_cm)
        if not full_apply and "header_distance_cm" in explicit_fields:
            section.header_distance = Cm(profile.header_distance_cm)
        if not full_apply and "page_number_bottom_cm" in explicit_fields:
            section.footer_distance = Cm(profile.page_number_bottom_cm)
        if full_apply or "margin_top_cm" in explicit_fields:
            section.top_margin = Cm(profile.margin_top_cm)
        if full_apply or "margin_bottom_cm" in explicit_fields:
            section.bottom_margin = Cm(profile.margin_bottom_cm)
        if full_apply or "margin_left_cm" in explicit_fields:
            section.left_margin = Cm(profile.margin_left_cm)
        if full_apply or "margin_right_cm" in explicit_fields:
            section.right_margin = Cm(profile.margin_right_cm)


def _apply_document_styles(
    document: Document, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool
) -> None:
    normal = document.styles["Normal"]
    if full_apply or "latin_font" in explicit_fields:
        normal.font.name = profile.latin_font
    if full_apply or "body_size_pt" in explicit_fields:
        normal.font.size = Pt(profile.body_size_pt)
    if full_apply or "body_font" in explicit_fields:
        _set_style_east_asian_font(normal, profile.body_font)


def _apply_headers(
    document: Document, profile: FormatProfile, section_roles: list[str], *, explicit_fields: set[str], full_apply: bool
) -> None:
    if not (profile.header_text and (full_apply or _has_any(explicit_fields, "header_text", "header_font", "header_size_pt", "header_line_spacing"))):
        return
    sections = list(document.sections)
    for index, section in enumerate(sections):
        role = section_roles[index] if index < len(section_roles) else "body"
        section.header.is_linked_to_previous = False
        header = section.header
        paragraph = header.paragraphs[0] if header.paragraphs else header.add_paragraph()
        if role == "front_matter":
            paragraph.text = ""
            continue
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.text = profile.header_text
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = profile.header_line_spacing
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.header_font,
                latin_font=profile.header_font if profile.header_font and profile.header_font[0].isascii() else profile.latin_font,
                size_pt=profile.header_size_pt,
                bold=False,
            )


def _ensure_logical_sections(document: Document, contexts: list[ParagraphContext]) -> list[str]:
    paragraphs = list(document.paragraphs)
    if not paragraphs or not contexts:
        return ["body"]

    abstract_index = next((index for index, ctx in enumerate(contexts) if ctx.section == "abstract"), None)
    body_index = next((index for index, ctx in enumerate(contexts) if ctx.section == "body"), None)

    roles: list[str] = []
    inserted_front_break = False
    inserted_body_break = False

    if abstract_index is not None and abstract_index > 0:
        inserted_front_break = _insert_section_break_before(paragraphs, abstract_index, document)
    if body_index is not None and body_index > 0:
        inserted_body_break = _insert_section_break_before(paragraphs, body_index, document)

    has_roman_front = any(ctx.section in {"abstract", "toc"} for ctx in contexts[: body_index or len(contexts)])

    if inserted_front_break:
        roles.append("front_matter")
    if has_roman_front:
        roles.append("front_roman")
    if body_index is not None:
        roles.append("body")
    if not roles:
        roles.append("body")

    actual_count = len(list(document.sections))
    if len(roles) < actual_count:
        roles.extend(["body"] * (actual_count - len(roles)))
    return roles[:actual_count]


def _insert_section_break_before(paragraphs, index: int, document: Document) -> bool:
    if index <= 0 or index >= len(paragraphs):
        return False
    prev_paragraph = paragraphs[index - 1]
    p_pr = prev_paragraph._p.get_or_add_pPr()
    if p_pr.sectPr is not None:
        return False
    sentinel = document._element.body.get_or_add_sectPr()
    prev_paragraph._p.set_sectPr(sentinel.clone())
    return True


def _build_paragraph_contexts(paragraphs) -> list[ParagraphContext]:
    contexts: list[ParagraphContext] = []
    active_section = "front_matter"
    active_appendix_kind = ""

    for index, paragraph in enumerate(paragraphs):
        text = paragraph.text or ""
        stripped = re.sub(r"\s+", " ", text).strip()

        if not stripped:
            contexts.append(ParagraphContext(section=active_section, role="blank", appendix_kind=active_appendix_kind))
            continue

        detected_section = _detect_section_transition(stripped, active_section, index)
        if detected_section:
            active_section = detected_section
            if detected_section != "appendix":
                active_appendix_kind = ""

        role = _classify_paragraph_role(stripped, index, active_section)
        if active_section == "appendix" and role == "appendix_heading":
            active_appendix_kind = _detect_appendix_kind(stripped)

        contexts.append(
            ParagraphContext(
                section=active_section,
                role=role,
                appendix_kind=active_appendix_kind,
            )
        )

    return contexts


def _detect_section_transition(text: str, current_section: str, index: int) -> str | None:
    if ABSTRACT_PATTERN.match(text):
        return "abstract"
    if TOC_PATTERN.match(text):
        return "toc"
    if REFERENCES_PATTERN.match(text):
        return "references"
    if ACKNOWLEDGEMENT_PATTERN.match(text):
        return "acknowledgement"
    if APPENDIX_PATTERN.match(text):
        return "appendix"
    if current_section == "toc" and _looks_like_toc_item(text):
        return None
    if current_section in {"front_matter", "abstract", "toc"} and _looks_like_body_start(text, index):
        return "body"
    return None


def _classify_paragraph_role(text: str, index: int, section: str) -> str:
    if section == "front_matter":
        return "cover"
    if section == "abstract":
        if ABSTRACT_PATTERN.match(text):
            return "abstract_heading"
        if KEYWORDS_PATTERN.match(text):
            return "keywords"
        return "abstract_body"
    if section == "toc":
        return "toc_heading" if TOC_PATTERN.match(text) else "toc_item"
    if section == "references":
        if REFERENCES_PATTERN.match(text):
            return "references_heading"
        return "reference_item"
    if section == "appendix":
        if APPENDIX_PATTERN.match(text):
            return "appendix_heading"
        return "appendix_body"
    if section == "acknowledgement":
        return "heading_1" if ACKNOWLEDGEMENT_PATTERN.match(text) else "body"
    if _looks_like_figure_caption(text):
        return "figure_caption"
    if _looks_like_table_caption(text):
        return "table_caption"
    if BODY_HEADING_3_PATTERN.match(text):
        return "heading_3"
    if BODY_HEADING_2_PATTERN.match(text):
        return "heading_2"
    if BODY_HEADING_1_PATTERN.match(text):
        return "heading_1"
    if _looks_like_common_body_heading(text):
        return "heading_1"
    if HEADING_1_PATTERN.match(text) and len(text) <= 80:
        return "heading_1"
    if HEADING_3_PATTERN.match(text) and len(text) <= 90:
        return "heading_3"
    if HEADING_2_PATTERN.match(text) and len(text) <= 90:
        return "heading_2"
    if section == "front_matter" and index <= 2 and len(text) <= 80:
        return "cover"
    return "body"


def _looks_like_body_start(text: str, index: int) -> bool:
    if _looks_like_common_body_heading(text):
        return True
    if index <= 1:
        return bool(BODY_START_PATTERN.match(text))
    return bool(BODY_START_PATTERN.match(text) or HEADING_1_PATTERN.match(text))


def _looks_like_common_body_heading(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    if not compact or len(compact) > 24:
        return False
    return compact in COMMON_BODY_HEADINGS


def _detect_appendix_kind(text: str) -> str:
    lowered = text.lower()
    if any(token in text for token in ("英文", "外文", "原文")) or "english" in lowered:
        return "english"
    if any(token in text for token in ("翻译", "中文")) or "translation" in lowered:
        return "translation"
    if any(token in text for token in ("代码", "程序")) or "code" in lowered:
        return "code"
    return ""


def _looks_like_toc_item(text: str) -> bool:
    return bool(re.search(r"[.．·…]{3,}\s*\d+\s*$", text))


def _looks_like_figure_caption(text: str) -> bool:
    return bool(re.match(r"^\s*图\s*\d+(?:[.\-]\d+)?", text))


def _looks_like_table_caption(text: str) -> bool:
    return bool(re.match(r"^\s*表\s*\d+(?:[.\-—]\d+)?", text))


def _detect_appendix_kind(text: str) -> str:
    lowered = text.lower()
    if any(token in text for token in ("\u82f1\u6587", "\u5916\u6587", "\u539f\u6587")) or "english" in lowered:
        return "english"
    if any(token in text for token in ("\u7ffb\u8bd1", "\u4e2d\u6587")) or "translation" in lowered:
        return "translation"
    if any(token in text for token in ("\u4ee3\u7801", "\u7a0b\u5e8f")) or "code" in lowered:
        return "code"
    return ""


def _looks_like_toc_item(text: str) -> bool:
    return bool(re.search(r"([.\u2026·]{3,}|\s{2,})\s*\d+\s*$", text))


def _looks_like_figure_caption(text: str) -> bool:
    return bool(re.match(r"^\s*\u56fe\s*\d+(?:[.\-]\d+)?", text))


def _looks_like_table_caption(text: str) -> bool:
    return bool(re.match(r"^\s*\u8868\s*\d+(?:[.\-\u2014]\d+)?", text))


def _format_heading_1(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if full_apply or "heading_1_align" in explicit_fields:
        paragraph.alignment = _to_alignment(profile.heading_1_align)
    if full_apply:
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
        paragraph.paragraph_format.space_before = Pt(12)
        paragraph.paragraph_format.space_after = Pt(12)
    if full_apply or _has_any(explicit_fields, "heading_1_font", "heading_1_size_pt", "latin_font"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.heading_1_font if (full_apply or "heading_1_font" in explicit_fields) else None,
                latin_font=profile.latin_font if (full_apply or "latin_font" in explicit_fields) else None,
                size_pt=profile.heading_1_size_pt if (full_apply or "heading_1_size_pt" in explicit_fields) else None,
                bold=True if full_apply or _has_any(explicit_fields, "heading_1_font", "heading_1_size_pt") else None,
            )


def _format_heading_2(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if full_apply or "heading_2_align" in explicit_fields:
        paragraph.alignment = _to_alignment(profile.heading_2_align)
    if full_apply:
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
        paragraph.paragraph_format.space_before = Pt(6)
        paragraph.paragraph_format.space_after = Pt(6)
    if full_apply or _has_any(explicit_fields, "heading_2_font", "heading_2_size_pt", "latin_font"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.heading_2_font if (full_apply or "heading_2_font" in explicit_fields) else None,
                latin_font=profile.latin_font if (full_apply or "latin_font" in explicit_fields) else None,
                size_pt=profile.heading_2_size_pt if (full_apply or "heading_2_size_pt" in explicit_fields) else None,
                bold=True if full_apply or _has_any(explicit_fields, "heading_2_font", "heading_2_size_pt") else None,
            )


def _format_heading_3(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if full_apply or "heading_3_align" in explicit_fields:
        paragraph.alignment = _to_alignment(profile.heading_3_align)
    if full_apply:
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
        paragraph.paragraph_format.space_before = Pt(3)
        paragraph.paragraph_format.space_after = Pt(3)
    if full_apply or _has_any(explicit_fields, "heading_3_font", "heading_3_size_pt", "latin_font"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.heading_3_font if (full_apply or "heading_3_font" in explicit_fields) else None,
                latin_font=profile.latin_font if (full_apply or "latin_font" in explicit_fields) else None,
                size_pt=profile.heading_3_size_pt if (full_apply or "heading_3_size_pt" in explicit_fields) else None,
                bold=True if full_apply or _has_any(explicit_fields, "heading_3_font", "heading_3_size_pt") else None,
            )


def _format_cover(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if not full_apply:
        return
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.left_indent = None
    paragraph.paragraph_format.first_line_indent = None
    paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    paragraph.paragraph_format.space_before = Pt(12)
    paragraph.paragraph_format.space_after = Pt(12)
    for run in paragraph.runs:
        _format_run(
            run,
            east_asian_font=profile.heading_1_font,
            latin_font=profile.latin_font,
            size_pt=max(profile.heading_1_size_pt, profile.body_size_pt),
            bold=True,
        )


def _format_abstract_heading(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    text = (paragraph.text or "").strip()
    is_english = text.lower() == "abstract"
    font = profile.english_abstract_heading_font if is_english else profile.abstract_heading_font
    size_pt = profile.english_abstract_heading_size_pt if is_english else profile.abstract_heading_size_pt
    align = profile.english_abstract_heading_align if is_english else profile.abstract_heading_align
    font_field = "english_abstract_heading_font" if is_english else "abstract_heading_font"
    size_field = "english_abstract_heading_size_pt" if is_english else "abstract_heading_size_pt"
    align_field = "english_abstract_heading_align" if is_english else "abstract_heading_align"

    if full_apply or align_field in explicit_fields:
        paragraph.alignment = _to_alignment(align)
    if full_apply:
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = 1.5
        paragraph.paragraph_format.space_before = Pt(12)
        paragraph.paragraph_format.space_after = Pt(12)
    if full_apply or _has_any(explicit_fields, font_field, size_field):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=font if not is_english else profile.body_font,
                latin_font=font if is_english else profile.latin_font,
                size_pt=size_pt if (full_apply or size_field in explicit_fields) else None,
                bold=True,
            )


def _format_abstract_body(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    text = (paragraph.text or "").strip()
    is_english = _looks_like_english_content(text)
    font = profile.english_abstract_body_font if is_english else profile.abstract_body_font
    size_pt = profile.english_abstract_body_size_pt if is_english else profile.abstract_body_size_pt
    spacing = profile.english_abstract_body_line_spacing if is_english else profile.abstract_body_line_spacing
    font_field = "english_abstract_body_font" if is_english else "abstract_body_font"
    size_field = "english_abstract_body_size_pt" if is_english else "abstract_body_size_pt"
    spacing_field = "english_abstract_body_line_spacing" if is_english else "abstract_body_line_spacing"

    if full_apply:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT if is_english else _to_alignment(profile.body_align)
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None if is_english else Cm(profile.first_line_indent_cm)
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = spacing
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
    else:
        if spacing_field in explicit_fields:
            paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            paragraph.paragraph_format.line_spacing = spacing

    if full_apply or _has_any(explicit_fields, font_field, size_field):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=font if not is_english else profile.body_font,
                latin_font=font if is_english else profile.latin_font,
                size_pt=size_pt if (full_apply or size_field in explicit_fields) else None,
                bold=False,
            )


def _format_keywords(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    text = (paragraph.text or "").strip()
    is_english = text.lower().startswith("key words") or text.lower().startswith("keywords")
    font = profile.english_keywords_font if is_english else profile.abstract_keywords_font
    size_pt = profile.english_keywords_size_pt if is_english else profile.abstract_keywords_size_pt
    font_field = "english_keywords_font" if is_english else "abstract_keywords_font"
    size_field = "english_keywords_size_pt" if is_english else "abstract_keywords_size_pt"
    if full_apply:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = profile.abstract_body_line_spacing
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
    elif "abstract_body_line_spacing" in explicit_fields:
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = profile.abstract_body_line_spacing
    if full_apply or _has_any(explicit_fields, font_field, size_field):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=font if not is_english else profile.body_font,
                latin_font=font if is_english else profile.latin_font,
                size_pt=size_pt if (full_apply or size_field in explicit_fields) else None,
                bold=False if full_apply else None,
            )


def _format_toc_heading(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if full_apply or "toc_heading_align" in explicit_fields:
        paragraph.alignment = _to_alignment(profile.toc_heading_align)
    if full_apply:
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
        paragraph.paragraph_format.space_before = Pt(12)
        paragraph.paragraph_format.space_after = Pt(12)
    if full_apply or _has_any(explicit_fields, "toc_heading_font", "toc_heading_size_pt"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.toc_heading_font,
                latin_font=profile.latin_font,
                size_pt=profile.toc_heading_size_pt if (full_apply or "toc_heading_size_pt" in explicit_fields) else None,
                bold=True,
            )


def _format_toc_item(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if full_apply:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = profile.toc_body_line_spacing
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
    elif "toc_body_line_spacing" in explicit_fields:
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = profile.toc_body_line_spacing
    if full_apply or _has_any(explicit_fields, "toc_body_font", "toc_body_size_pt"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.toc_body_font,
                latin_font=profile.latin_font,
                size_pt=profile.toc_body_size_pt if (full_apply or "toc_body_size_pt" in explicit_fields) else None,
                bold=False,
            )


def _format_caption(
    paragraph,
    profile: FormatProfile,
    *,
    explicit_fields: set[str],
    full_apply: bool,
    align: str,
) -> None:
    if full_apply or _has_any(explicit_fields, "figure_caption_align", "table_caption_align"):
        paragraph.alignment = _to_alignment(align)
    if full_apply:
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
    if full_apply or _has_any(explicit_fields, "caption_font", "caption_size_pt", "body_font", "latin_font"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=(
                    profile.caption_font
                    if (full_apply or "caption_font" in explicit_fields)
                    else profile.body_font if "body_font" in explicit_fields else None
                ),
                latin_font=profile.latin_font if (full_apply or "latin_font" in explicit_fields) else None,
                size_pt=profile.caption_size_pt if (full_apply or "caption_size_pt" in explicit_fields) else None,
                bold=False,
            )


def _format_reference_item(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if full_apply:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        paragraph.paragraph_format.left_indent = Cm(profile.reference_hanging_indent_cm)
        paragraph.paragraph_format.first_line_indent = Cm(-profile.reference_hanging_indent_cm)
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = max(1.0, min(profile.reference_line_spacing, 2.0))
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
    else:
        if "body_align" in explicit_fields:
            paragraph.alignment = _to_alignment(profile.body_align)
        if "reference_hanging_indent_cm" in explicit_fields:
            paragraph.paragraph_format.left_indent = Cm(profile.reference_hanging_indent_cm)
            paragraph.paragraph_format.first_line_indent = Cm(-profile.reference_hanging_indent_cm)
        if "reference_line_spacing" in explicit_fields:
            paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            paragraph.paragraph_format.line_spacing = max(1.0, min(profile.reference_line_spacing, 2.0))
    if full_apply or _has_any(explicit_fields, "body_font", "latin_font", "body_size_pt"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.body_font if (full_apply or "body_font" in explicit_fields) else None,
                latin_font=profile.latin_font if (full_apply or "latin_font" in explicit_fields) else None,
                size_pt=profile.body_size_pt if (full_apply or "body_size_pt" in explicit_fields) else None,
                bold=False if full_apply else None,
            )


def _format_appendix_body(
    paragraph,
    profile: FormatProfile,
    *,
    explicit_fields: set[str],
    full_apply: bool,
    appendix_kind: str,
) -> None:
    if not appendix_kind and REFERENCE_ITEM_PATTERN.match(paragraph.text or ""):
        _format_reference_item(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)
        return
    if appendix_kind == "english":
        _format_appendix_variant(
            paragraph,
            explicit_fields=explicit_fields,
            full_apply=full_apply,
            east_asian_font=profile.appendix_english_font,
            latin_font=profile.appendix_english_font,
            size_pt=profile.appendix_english_size_pt,
            line_spacing=profile.appendix_english_line_spacing,
            font_fields={"appendix_english_font"},
            size_field="appendix_english_size_pt",
            spacing_field="appendix_english_line_spacing",
        )
        return
    if appendix_kind == "translation":
        _format_appendix_variant(
            paragraph,
            explicit_fields=explicit_fields,
            full_apply=full_apply,
            east_asian_font=profile.appendix_translation_font,
            latin_font=profile.latin_font,
            size_pt=profile.appendix_translation_size_pt,
            line_spacing=profile.appendix_translation_line_spacing,
            font_fields={"appendix_translation_font", "latin_font"},
            size_field="appendix_translation_size_pt",
            spacing_field="appendix_translation_line_spacing",
        )
        return
    if appendix_kind == "code":
        _format_appendix_variant(
            paragraph,
            explicit_fields=explicit_fields,
            full_apply=full_apply,
            east_asian_font=profile.appendix_code_font,
            latin_font=profile.appendix_code_font,
            size_pt=profile.appendix_code_size_pt,
            line_spacing=profile.appendix_code_line_spacing,
            font_fields={"appendix_code_font"},
            size_field="appendix_code_size_pt",
            spacing_field="appendix_code_line_spacing",
        )
        return
    _format_body(paragraph, profile, explicit_fields=explicit_fields, full_apply=full_apply)


def _format_body(paragraph, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if full_apply or "body_align" in explicit_fields:
        paragraph.alignment = _to_alignment(profile.body_align)
    if full_apply:
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = Cm(profile.first_line_indent_cm)
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = profile.line_spacing
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
    else:
        if "first_line_indent_cm" in explicit_fields:
            paragraph.paragraph_format.left_indent = None
            paragraph.paragraph_format.first_line_indent = Cm(profile.first_line_indent_cm)
        if "line_spacing" in explicit_fields:
            paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            paragraph.paragraph_format.line_spacing = profile.line_spacing
    if full_apply or _has_any(explicit_fields, "body_font", "latin_font", "body_size_pt"):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=profile.body_font if (full_apply or "body_font" in explicit_fields) else None,
                latin_font=profile.latin_font if (full_apply or "latin_font" in explicit_fields) else None,
                size_pt=profile.body_size_pt if (full_apply or "body_size_pt" in explicit_fields) else None,
                bold=False if full_apply else None,
            )


def _format_table(table, profile: FormatProfile, *, explicit_fields: set[str], full_apply: bool) -> None:
    if not (full_apply or _has_any(explicit_fields, "body_font", "latin_font", "table_size_pt")):
        return
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                if full_apply:
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    paragraph.paragraph_format.left_indent = None
                    paragraph.paragraph_format.first_line_indent = None
                    paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
                    paragraph.paragraph_format.space_before = Pt(0)
                    paragraph.paragraph_format.space_after = Pt(0)
                for run in paragraph.runs:
                    _format_run(
                        run,
                        east_asian_font=profile.body_font if (full_apply or "body_font" in explicit_fields) else None,
                        latin_font=profile.latin_font if (full_apply or "latin_font" in explicit_fields) else None,
                        size_pt=profile.table_size_pt if (full_apply or "table_size_pt" in explicit_fields) else None,
                        bold=False if full_apply else None,
                    )


def _format_appendix_variant(
    paragraph,
    *,
    explicit_fields: set[str],
    full_apply: bool,
    east_asian_font: str,
    latin_font: str,
    size_pt: float,
    line_spacing: float,
    font_fields: set[str],
    size_field: str,
    spacing_field: str,
) -> None:
    if full_apply:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
        paragraph.paragraph_format.left_indent = None
        paragraph.paragraph_format.first_line_indent = None
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        paragraph.paragraph_format.line_spacing = line_spacing
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
    else:
        if spacing_field in explicit_fields:
            paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            paragraph.paragraph_format.line_spacing = line_spacing
    if full_apply or _has_any(explicit_fields, *font_fields, size_field):
        for run in paragraph.runs:
            _format_run(
                run,
                east_asian_font=east_asian_font if (full_apply or _has_any(explicit_fields, *font_fields)) else None,
                latin_font=latin_font if (full_apply or "latin_font" in explicit_fields or _has_any(explicit_fields, *font_fields)) else None,
                size_pt=size_pt if (full_apply or size_field in explicit_fields) else None,
                bold=False if full_apply else None,
            )


def _to_alignment(value: str):
    if value == "center":
        return WD_ALIGN_PARAGRAPH.CENTER
    if value == "right":
        return WD_ALIGN_PARAGRAPH.RIGHT
    if value == "justify":
        return WD_ALIGN_PARAGRAPH.JUSTIFY
    return WD_ALIGN_PARAGRAPH.LEFT


def _has_any(explicit_fields: set[str], *names: str) -> bool:
    return any(name in explicit_fields for name in names)


def _looks_like_english_content(text: str) -> bool:
    stripped = str(text or "").strip()
    if not stripped:
        return False
    ascii_letters = len(re.findall(r"[A-Za-z]", stripped))
    cjk_letters = len(re.findall(r"[\u4e00-\u9fff]", stripped))
    return ascii_letters >= max(12, cjk_letters * 2)


def _ensure_page_break_before(paragraph) -> None:
    p_pr = paragraph._element.get_or_add_pPr()
    page_break = p_pr.find(qn("w:pageBreakBefore"))
    if page_break is None:
        page_break = OxmlElement("w:pageBreakBefore")
        p_pr.append(page_break)
    page_break.set(qn("w:val"), "1")


def _format_run(
    run,
    east_asian_font: str | None = None,
    latin_font: str | None = None,
    size_pt: float | None = None,
    *,
    bold: bool | None,
) -> None:
    if latin_font is not None:
        run.font.name = latin_font
    if size_pt is not None:
        run.font.size = Pt(size_pt)
    if bold is not None:
        run.font.bold = bold
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    if east_asian_font is not None:
        r_fonts.set(qn("w:eastAsia"), east_asian_font)
    if latin_font is not None:
        r_fonts.set(qn("w:ascii"), latin_font)
        r_fonts.set(qn("w:hAnsi"), latin_font)


def _set_style_east_asian_font(style, east_asian_font: str) -> None:
    r_pr = style.element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    r_fonts.set(qn("w:eastAsia"), east_asian_font)


def _apply_footer_page_number(document: Document, profile: FormatProfile, section_roles: list[str]) -> None:
    sections = list(document.sections)
    for index, section in enumerate(sections):
        role = section_roles[index] if index < len(section_roles) else "body"
        section.footer.is_linked_to_previous = False
        footer = section.footer
        paragraph = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
        paragraph.text = ""
        if role == "front_matter":
            _set_section_page_number_format(section, fmt="decimal", start=1)
            continue
        if role == "front_roman":
            _set_section_page_number_format(section, fmt="upperRoman", start=1)
        else:
            _set_section_page_number_format(section, fmt="decimal", start=1 if role == "body" else None)

        paragraph.alignment = _to_alignment(profile.page_number_align)
        paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        run = paragraph.add_run()
        _format_run(
            run,
            east_asian_font=profile.page_number_font,
            latin_font=profile.latin_font,
            size_pt=profile.page_number_size_pt,
            bold=False,
        )
        fld_begin = OxmlElement("w:fldChar")
        fld_begin.set(qn("w:fldCharType"), "begin")
        instr = OxmlElement("w:instrText")
        instr.set(qn("xml:space"), "preserve")
        instr.text = "PAGE"
        fld_separate = OxmlElement("w:fldChar")
        fld_separate.set(qn("w:fldCharType"), "separate")
        fld_end = OxmlElement("w:fldChar")
        fld_end.set(qn("w:fldCharType"), "end")
        run._r.extend([fld_begin, instr, fld_separate, fld_end])


def _set_section_page_number_format(section: Section, *, fmt: str, start: int | None = None) -> None:
    sect_pr = section._sectPr
    pg_num_type = sect_pr.find(qn("w:pgNumType"))
    if pg_num_type is None:
        pg_num_type = OxmlElement("w:pgNumType")
        sect_pr.insert_element_before(
            pg_num_type,
            "w:cols",
            "w:formProt",
            "w:vAlign",
            "w:noEndnote",
            "w:titlePg",
            "w:textDirection",
            "w:bidi",
            "w:rtlGutter",
            "w:docGrid",
            "w:printerSettings",
            "w:sectPrChange",
        )
    pg_num_type.set(qn("w:fmt"), fmt)
    if start is None:
        if pg_num_type.get(qn("w:start")) is not None:
            del pg_num_type.attrib[qn("w:start")]
    else:
        pg_num_type.set(qn("w:start"), str(start))
