from __future__ import annotations

import re
from typing import Any

from app.services.paper_format_known_profiles import extract_known_profile_requirements


SIZE_TOKENS = [
    ("小初号", 36.0),
    ("小初", 36.0),
    ("初号", 42.0),
    ("小1号", 24.0),
    ("小一号", 24.0),
    ("小一", 24.0),
    ("1号", 26.0),
    ("一号", 26.0),
    ("小2号", 18.0),
    ("小二号", 18.0),
    ("小二", 18.0),
    ("2号", 22.0),
    ("二号", 22.0),
    ("小3号", 15.0),
    ("小三号", 15.0),
    ("小三", 15.0),
    ("3号", 16.0),
    ("三号", 16.0),
    ("小4号", 12.0),
    ("小四号", 12.0),
    ("小四", 12.0),
    ("4号", 14.0),
    ("四号", 14.0),
    ("小5号", 9.0),
    ("小五号", 9.0),
    ("小五", 9.0),
    ("5号", 10.5),
    ("五号", 10.5),
    ("小6号", 6.5),
    ("小六号", 6.5),
    ("小六", 6.5),
    ("6号", 7.5),
    ("六号", 7.5),
    ("7号", 5.5),
    ("七号", 5.5),
    ("8号", 5.0),
    ("八号", 5.0),
]

FONT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"times\s+new\s+roman", re.I), "Times New Roman"),
    (re.compile(r"courier\s+new", re.I), "Courier New"),
    (re.compile(r"calibri", re.I), "Calibri"),
    (re.compile(r"cambria", re.I), "Cambria"),
    (re.compile(r"arial", re.I), "Arial"),
    (re.compile(r"微软雅黑"), "微软雅黑"),
    (re.compile(r"黑体"), "黑体"),
    (re.compile(r"宋体"), "宋体"),
    (re.compile(r"仿宋"), "仿宋"),
    (re.compile(r"楷体"), "楷体"),
]


def extract_requirements_and_notes_from_text(text: str) -> tuple[dict[str, Any], list[str]]:
    normalized = _normalize_text(text)
    if not normalized:
        return {}, []

    requirements: dict[str, Any] = {}
    notes: list[str] = []

    _merge(requirements, _extract_body_rules(normalized))
    _merge(requirements, _extract_heading_rules(normalized))
    _merge(requirements, _extract_margin_rules(normalized))
    _merge(requirements, _extract_reference_rules(normalized))
    _merge(requirements, _extract_appendix_rules(normalized))
    _merge(requirements, _extract_abstract_rules(normalized))
    _merge(requirements, _extract_toc_rules(normalized))
    _merge(requirements, _extract_header_rules(normalized))
    _merge(requirements, _extract_page_number_rules(normalized))
    _merge(requirements, _extract_caption_rules(normalized))
    _merge(requirements, extract_known_profile_requirements(normalized))

    if re.search(r"章.{0,8}独立分页", normalized):
        requirements["chapter_page_break"] = True
    if re.search(r"页码", normalized):
        requirements["add_page_number"] = True

    if re.search(r"参考文献.{0,20}(格式|期刊|图书)", normalized):
        notes.append("参考文献格式已给出，但未提及悬挂缩进和行距")
    if re.search(r"外国作者.{0,10}姓名", normalized):
        notes.append("参考文献著录顺序和条目内容仍建议人工复核")
    if re.search(r"节和小节不能位于一页的最底部|不能落页尾", normalized):
        notes.append("节和小节不能位于一页的最底部，每页中不能空白太大")
    if re.search(r"每页中不能空白太大|留白太大", normalized):
        _append_unique(notes, "节和小节不能位于一页的最底部，每页中不能空白太大")
    if re.search(r"5\s*(至|到|-|~)\s*8\s*页", normalized):
        notes.append("附录中英文翻译的具体页数要求")
    if re.search(r"代码及注释", normalized) and "appendix_code_font" not in requirements:
        notes.append("代码及注释的具体内容")

    return requirements, notes[:8]


def _extract_body_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    body_clause = _find_first(
        text,
        [
            r"正文用[^。；\n]+",
            r"正文正文?[^。；\n]*?字体[^。；\n]+",
            r"摘要正文[（(][^）)]+[）)]",
        ],
    )
    if not body_clause:
        return requirements

    if font := _extract_cjk_font(body_clause):
        requirements["body_font"] = font
    if size := _extract_size_pt(body_clause):
        requirements["body_size_pt"] = size
    if spacing := _extract_line_spacing(body_clause):
        requirements["line_spacing"] = spacing
    if align := _extract_align(body_clause):
        requirements["body_align"] = align
    if indent := _extract_indent_cm(body_clause):
        requirements["first_line_indent_cm"] = indent
    return requirements


def _extract_heading_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    specs = [
        ("heading_1", [r"章的标题[^。；\n]+", r"一级标题[^。；\n]+"]),
        ("heading_2", [r"节的标题[^。；\n]+", r"二级标题[^。；\n]+"]),
        ("heading_3", [r"小节标题[^。；\n]+", r"三级标题[^。；\n]+"]),
    ]
    for prefix, patterns in specs:
        clause = _find_first(text, patterns)
        if not clause:
            continue
        if font := _extract_cjk_font(clause):
            requirements[f"{prefix}_font"] = font
        if size := _extract_size_pt(clause):
            requirements[f"{prefix}_size_pt"] = size
        if align := _extract_align(clause):
            requirements[f"{prefix}_align"] = align
    return requirements


def _extract_margin_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    margin_clause = _find_first(
        text,
        [
            r"上边距[^。；\n]+左边距[^。；\n]+右边距[^。；\n]+",
            r"页边距[^。；\n]+",
        ],
    )
    if not margin_clause:
        return requirements
    for field, labels in {
        "margin_top_cm": ("上边距", "上"),
        "margin_bottom_cm": ("下边距", "下"),
        "margin_left_cm": ("左边距", "左"),
        "margin_right_cm": ("右边距", "右"),
    }.items():
        value = _extract_measurement_near(margin_clause, labels)
        if value is not None:
            requirements[field] = value
    return requirements


def _extract_reference_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    clause = _find_first(text, [r"参考文献[^。；\n]*悬挂缩进[^。；\n]+"])
    if clause and (indent := _extract_indent_cm(clause, hanging=True)) is not None:
        requirements["reference_hanging_indent_cm"] = indent

    clause = _find_first(text, [r"参考文献[^。；\n]*行距[^。；\n]+"])
    if clause and (spacing := _extract_line_spacing(clause)) is not None:
        requirements["reference_line_spacing"] = spacing
    return requirements


def _extract_appendix_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    appendix_specs = [
        (
            "appendix_english",
            [r"英文原文[^。；\n]+", r"英文资料翻译[^。；\n]*英文原文[^。；\n]+"],
            _extract_latin_font,
        ),
        (
            "appendix_translation",
            [r"中文翻译[^。；\n]+", r"附录[^。；\n]*中文翻译[^。；\n]+"],
            _extract_cjk_font,
        ),
        (
            "appendix_code",
            [r"代码及注释[^。；\n]+", r"程序代码[^。；\n]+", r"附录Ⅱ[^。；\n]*代码[^。；\n]+"],
            _extract_latin_font,
        ),
    ]
    for prefix, patterns, font_extractor in appendix_specs:
        clause = _find_first(text, patterns)
        if not clause:
            continue
        if font := font_extractor(clause):
            requirements[f"{prefix}_font"] = font
        if size := _extract_size_pt(clause):
            requirements[f"{prefix}_size_pt"] = size
        if spacing := _extract_line_spacing(clause):
            requirements[f"{prefix}_line_spacing"] = spacing
    return requirements


def _extract_abstract_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}

    zh_heading = _find_first(text, [r"中文摘要[^。；\n]*字样[^。；\n]+", r"中文摘要[^。；\n]*位置居中[^。；\n]+"])
    if zh_heading:
        if font := _extract_cjk_font(zh_heading):
            requirements["abstract_heading_font"] = font
        if size := _extract_size_pt(zh_heading):
            requirements["abstract_heading_size_pt"] = size
        if align := _extract_align(zh_heading):
            requirements["abstract_heading_align"] = align

    zh_body = _find_first(text, [r"摘要正文[（(][^）)]+[）)]", r"摘要正文[^。；\n]+"])
    if zh_body:
        body_clause = _take_before(zh_body, "关键词")
        if font := _extract_cjk_font(body_clause):
            requirements["abstract_body_font"] = font
        if size := _extract_size_pt(body_clause):
            requirements["abstract_body_size_pt"] = size
        if spacing := _extract_line_spacing(body_clause):
            requirements["abstract_body_line_spacing"] = spacing

    zh_keywords = _find_first(text, [r"关键词[^。；\n]+"])
    if zh_keywords:
        keyword_clause = _take_after(zh_keywords, "关键词")
        if font := _extract_cjk_font(keyword_clause):
            requirements["abstract_keywords_font"] = font
        if size := _extract_size_pt(keyword_clause):
            requirements["abstract_keywords_size_pt"] = size

    en_heading = _find_first(text, [r"Abstract[^。；\n]+"])
    if en_heading:
        if font := _extract_latin_font(en_heading):
            requirements["english_abstract_heading_font"] = font
        if size := _extract_size_pt(en_heading):
            requirements["english_abstract_heading_size_pt"] = size
        if align := _extract_align(en_heading):
            requirements["english_abstract_heading_align"] = align

    en_body = _find_first(text, [r"摘要内容字体是[^。；\n]+", r"英文摘要内容[^。；\n]+"])
    if en_body:
        if font := _extract_latin_font(en_body):
            requirements["english_abstract_body_font"] = font
        if size := _extract_size_pt(en_body):
            requirements["english_abstract_body_size_pt"] = size
        if spacing := _extract_line_spacing(en_body):
            requirements["english_abstract_body_line_spacing"] = spacing

    en_keywords = _find_first(text, [r"Keywords[^。；\n]+", r"关键词（Keywords）[^。；\n]+"])
    if en_keywords:
        if font := _extract_latin_font(en_keywords):
            requirements["english_keywords_font"] = font
        if size := _extract_size_pt(en_keywords):
            requirements["english_keywords_size_pt"] = size

    return requirements


def _extract_toc_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    heading = _find_first(text, [r"“?目录”?二字标题[^。；\n]+", r"目录.*标题用[^。；\n]+"])
    if heading:
        if font := _extract_cjk_font(heading):
            requirements["toc_heading_font"] = font
        if size := _extract_size_pt(heading):
            requirements["toc_heading_size_pt"] = size
        if align := _extract_align(heading):
            requirements["toc_heading_align"] = align

    body = _find_first(text, [r"目录内容[^。；\n]+"])
    if body:
        if font := _extract_cjk_font(body):
            requirements["toc_body_font"] = font
        if size := _extract_size_pt(body):
            requirements["toc_body_size_pt"] = size
        if spacing := _extract_line_spacing(body):
            requirements["toc_body_line_spacing"] = spacing
    return requirements


def _extract_header_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    clause = _find_first(text, [r"页眉的文字[^。；\n]+"])
    if not clause:
        return requirements

    quoted = re.findall(r"[“\"]([^”\"]+)[”\"]", clause)
    if quoted:
        requirements["header_text"] = quoted[0].strip()
    if font := _extract_cjk_font(clause):
        requirements["header_font"] = font
    if size := _extract_size_pt(clause):
        requirements["header_size_pt"] = size
    if spacing := _extract_line_spacing(clause):
        requirements["header_line_spacing"] = spacing
    if distance := _extract_measurement_near(clause, ("页眉线的上边距", "页眉线上边距")):
        requirements["header_distance_cm"] = distance
    return requirements


def _extract_page_number_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    clause = _find_first(
        text,
        [
            r"页码位于下端居中[^。；\n]+",
            r"页码[^。；\n]*5号[^。；\n]+",
            r"页码[^。；\n]+",
        ],
    )
    if not clause:
        return requirements

    if font := _extract_cjk_font(clause):
        requirements["page_number_font"] = font
    if size := _extract_size_pt(clause):
        requirements["page_number_size_pt"] = size
    if align := _extract_align(clause):
        requirements["page_number_align"] = align
    if bottom := _extract_measurement_near(clause, ("页码下边距", "下边距")):
        requirements["page_number_bottom_cm"] = bottom
    return requirements


def _extract_caption_rules(text: str) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    clause = _find_first(
        text,
        [
            r"字体为[^。；\n]*宋体",
            r"图、表、附注、公式[^。；\n]+",
            r"图号和说明[^。；\n]+",
            r"表号和说明[^。；\n]+",
        ],
    )
    if clause and (size := _extract_size_pt(clause)):
        requirements["caption_size_pt"] = size

    figure_clause = _find_first(text, [r"图号和说明[^。；\n]+"])
    table_clause = _find_first(text, [r"表号和说明[^。；\n]+"])
    if figure_clause and (align := _extract_align(figure_clause)):
        requirements["figure_caption_align"] = align
    if table_clause and (align := _extract_align(table_clause)):
        requirements["table_caption_align"] = align
    return requirements


def _normalize_text(text: str) -> str:
    normalized = str(text or "").replace("\r", "\n").replace("\xa0", " ")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{2,}", "\n", normalized)
    return normalized.strip()


def _find_first(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(0)
    return None


def _extract_cjk_font(text: str) -> str | None:
    return _extract_font(text, ascii_only=False)


def _extract_latin_font(text: str) -> str | None:
    return _extract_font(text, ascii_only=True)


def _extract_font(text: str, *, ascii_only: bool) -> str | None:
    matches: list[tuple[int, str]] = []
    for pattern, canonical in FONT_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        if ascii_only and canonical[0].isascii():
            matches.append((match.start(), canonical))
        if not ascii_only and not canonical[0].isascii():
            matches.append((match.start(), canonical))
    if not matches:
        return None
    matches.sort(key=lambda item: item[0])
    return matches[0][1]


def _extract_size_pt(text: str) -> float | None:
    pt_match = re.search(r"(\d+(?:\.\d+)?)\s*pt", text, re.I)
    if pt_match:
        return round(float(pt_match.group(1)), 1)
    for token, value in SIZE_TOKENS:
        if token in text:
            return value
    return None


def _extract_line_spacing(text: str) -> float | None:
    if "单倍行距" in text or "单倍" in text:
        return 1.0
    match = re.search(r"(\d+(?:\.\d+)?)\s*倍行距", text)
    if match:
        return round(float(match.group(1)), 2)
    return None


def _extract_align(text: str) -> str | None:
    if "两端对齐" in text:
        return "justify"
    if "居中" in text:
        return "center"
    if "右对齐" in text:
        return "right"
    if any(token in text for token in ("左对齐", "靠左边顶头", "左边顶头", "顶头")):
        return "left"
    return None


def _extract_indent_cm(text: str, *, hanging: bool = False) -> float | None:
    if hanging and "悬挂缩进" not in text:
        return None
    if not hanging and not any(token in text for token in ("首行缩进", "首行空两格", "首行空2格", "首行空 2 格")):
        return None
    match = re.search(r"(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米)", text, re.I)
    if match:
        return _to_cm(float(match.group(1)), match.group(2))
    if re.search(r"(2\s*字符|2\s*字|两字|两字符|首行空两格|首行空2格)", text):
        return 0.74
    if "不缩进" in text:
        return 0.0
    return None


def _extract_measurement_near(text: str, labels: tuple[str, ...]) -> float | None:
    for label in labels:
        match = re.search(rf"{re.escape(label)}\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米)", text, re.I)
        if match:
            return _to_cm(float(match.group(1)), match.group(2))
        fallback = re.search(rf"{re.escape(label)}\s*[:：]?\s*(\d+(?:\.\d+)?)", text, re.I)
        if fallback:
            # School templates often omit the unit after repeating it once in the same sentence.
            unit_match = re.search(r"(cm|厘米|mm|毫米)", text, re.I)
            if unit_match:
                return _to_cm(float(fallback.group(1)), unit_match.group(1))
    return None


def _to_cm(value: float, unit: str) -> float:
    if str(unit).lower() in {"mm", "毫米"}:
        return round(value / 10.0, 2)
    return round(value, 2)


def _merge(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key, value in source.items():
        if value is not None:
            target[key] = value


def _append_unique(items: list[str], value: str) -> None:
    if value not in items:
        items.append(value)


def _take_before(text: str, marker: str) -> str:
    index = text.find(marker)
    return text if index < 0 else text[:index]


def _take_after(text: str, marker: str) -> str:
    index = text.find(marker)
    return text if index < 0 else text[index:]
