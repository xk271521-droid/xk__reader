from __future__ import annotations

import json
import re
from typing import Any

from openai import OpenAI

from app.services.paper_format_known_profiles import detect_known_profile_key
from app.services.paper_format_requirement_rules import extract_requirements_and_notes_from_text


FORMAT_REQUIREMENT_SYSTEM_PROMPT = """
你是论文格式要求解析助手。

任务：把用户提供的学校模板、老师说明或检测要求，解析成程序可执行的 Word 格式字段。

严格规则：
1. 只提取“原文明确写出”的字段，或可以稳定换算的字段。
2. 不要根据常识、学校习惯、论文默认规范去补字段。
3. 只要原文没有明确写“正文对齐 / 首行缩进 / 页码 / 下边距 / 参考文献悬挂缩进 / 参考文献行距”等，就不要猜。
4. 不能稳定自动执行的内容，放到 notes，不要放进 requirements。
5. 如果原文只写参考文献著录格式、外国作者姓名写法、标题不能落页尾、页面不要留白太大，这些都写入 notes。
6. 必须直接返回 JSON，不要 Markdown，不要解释。
"""


FORMAT_REQUIREMENT_USER_TEMPLATE = """
请把下面的论文格式要求解析成 JSON。

支持字段：
- body_font
- latin_font
- heading_1_font / heading_2_font / heading_3_font
- body_size_pt / heading_1_size_pt / heading_2_size_pt / heading_3_size_pt
- table_size_pt
- line_spacing
- first_line_indent_cm
- margin_top_cm / margin_bottom_cm / margin_left_cm / margin_right_cm
- heading_1_align / heading_2_align / heading_3_align / body_align
- add_page_number
- chapter_page_break
- reference_hanging_indent_cm
- reference_line_spacing
- appendix_english_font / appendix_translation_font / appendix_code_font
- appendix_english_size_pt / appendix_translation_size_pt / appendix_code_size_pt
- appendix_english_line_spacing / appendix_translation_line_spacing / appendix_code_line_spacing

字号换算：
初号=42，小初=36，一号=26，小一=24，二号=22，小二=18，三号=16，小三=15，四号=14，小四=12，五号=10.5，小五=9，六号=7.5，小六=6.5，七号=5.5，八号=5

对齐换算：
居中=center，左对齐=left，右对齐=right，两端对齐=justify

重要限制：
1. 没有明确写出的字段，不要返回。
2. “正文默认”“一般要求”“通常格式”“常规情况”这类不算明确字段。
3. 如果原文没有明确写“首行缩进”，不要返回 first_line_indent_cm。
4. 如果原文没有明确写“正文对齐方式”，不要返回 body_align。
5. 如果原文没有明确写“下边距”，不要返回 margin_bottom_cm。
6. 如果原文没有明确写“页码”，不要返回 add_page_number。
7. 如果原文只是说明参考文献条目写法，不要猜 reference_hanging_indent_cm 或 reference_line_spacing。
8. “单倍行距”换算为 1.0，“1.5倍行距”换算为 1.5。
9. mm 请换算成 cm。
10. 如果写“章标题独立分页”，返回 chapter_page_break=true。
11. “小节标题”优先映射到 heading_3_*。
12. “代码及注释”优先映射到 appendix_code_*。
13. 无法稳定自动执行的内容写进 notes。

用户要求：
{requirement_text}

返回格式：
{{"requirements":{{...}},"notes":["..."]}}
"""


ALLOWED_FIELDS = {
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
}

ALIGN_VALUES = {"left", "center", "right", "justify"}
BOOLEAN_FIELDS = {"add_page_number", "chapter_page_break"}
TEXT_FIELDS = {
    "body_font",
    "latin_font",
    "heading_1_font",
    "heading_2_font",
    "heading_3_font",
    "appendix_english_font",
    "appendix_translation_font",
    "appendix_code_font",
}

FONT_ALIASES = {
    "宋体": "宋体",
    "黑体": "黑体",
    "仿宋": "仿宋",
    "楷体": "楷体",
    "微软雅黑": "微软雅黑",
    "times new roman": "Times New Roman",
    "arial": "Arial",
    "calibri": "Calibri",
    "cambria": "Cambria",
    "courier new": "Courier New",
}

SIZE_TOKENS = [
    ("小初", 36.0),
    ("初号", 42.0),
    ("小一", 24.0),
    ("一号", 26.0),
    ("小二", 18.0),
    ("二号", 22.0),
    ("小三", 15.0),
    ("三号", 16.0),
    ("小四", 12.0),
    ("四号", 14.0),
    ("小五", 9.0),
    ("五号", 10.5),
    ("小六", 6.5),
    ("六号", 7.5),
    ("七号", 5.5),
    ("八号", 5.0),
]

ALIGN_TOKENS = [
    ("两端对齐", "justify"),
    ("左对齐", "left"),
    ("靠左边顶头", "left"),
    ("左边顶头", "left"),
    ("左起顶格", "left"),
    ("顶格", "left"),
    ("右对齐", "right"),
    ("居中", "center"),
]

BODY_KEYWORDS = ("正文",)
HEADING_1_KEYWORDS = ("章的标题", "章标题", "一级标题")
HEADING_2_KEYWORDS = ("节的标题", "节标题", "二级标题")
HEADING_3_KEYWORDS = ("小节标题", "三级标题")
APPENDIX_ENGLISH_KEYWORDS = ("英文原文", "外文原文")
APPENDIX_TRANSLATION_KEYWORDS = ("中文翻译",)
APPENDIX_CODE_KEYWORDS = ("代码及注释", "程序代码", "代码")

SENTENCE_SPLIT_PATTERN = re.compile(r"[。；;！!？?\n\r]+")


def parse_format_requirements_with_ai(
    *,
    base_url: str,
    api_key: str,
    model: str,
    requirement_text: str,
) -> dict[str, Any]:
    requirement_text = str(requirement_text or "").strip()
    explicit_requirements = _extract_explicit_requirements(requirement_text)
    explicit_notes = _build_notes(requirement_text)
    rule_requirements, rule_notes = extract_requirements_and_notes_from_text(requirement_text)

    ai_requirements: dict[str, Any] = {}
    ai_notes: list[str] = []

    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=60.0)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": FORMAT_REQUIREMENT_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": FORMAT_REQUIREMENT_USER_TEMPLATE.format(
                        requirement_text=requirement_text[:6000],
                    ),
                },
            ],
            temperature=0,
            max_tokens=1400,
        )
        content = response.choices[0].message.content or ""
        payload = _parse_json_object(content)
        ai_requirements = _sanitize_requirements(payload.get("requirements"))
        ai_notes = _sanitize_notes(payload.get("notes"))
    except Exception:
        ai_requirements = {}
        ai_notes = []

    merged_requirements = {**ai_requirements, **explicit_requirements, **rule_requirements}
    merged_requirements = _filter_requirements_by_evidence(merged_requirements, requirement_text)
    merged_notes = _merge_notes(ai_notes, explicit_notes + rule_notes)
    return {
        "requirements": merged_requirements,
        "notes": merged_notes,
        "matched_profile_key": detect_known_profile_key(requirement_text),
    }


def _parse_json_object(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if fenced:
        text = fenced.group(1)
    if not text.startswith("{"):
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            text = match.group(0)
    try:
        value = json.loads(text)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _sanitize_requirements(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    cleaned: dict[str, Any] = {}
    for key, raw in value.items():
        if key not in ALLOWED_FIELDS:
            continue
        if key.endswith("_align"):
            align = str(raw or "").strip()
            if align in ALIGN_VALUES:
                cleaned[key] = align
            continue
        if key in BOOLEAN_FIELDS:
            if isinstance(raw, bool):
                cleaned[key] = raw
            continue
        if key in TEXT_FIELDS:
            text = _normalize_font(raw)
            if text:
                cleaned[key] = text
            continue
        try:
            number = float(raw)
        except (TypeError, ValueError):
            continue
        cleaned[key] = number
    return cleaned


def _filter_requirements_by_evidence(requirements: dict[str, Any], requirement_text: str) -> dict[str, Any]:
    if not requirements:
        return {}
    clauses = _split_clauses(requirement_text)
    filtered: dict[str, Any] = {}
    for key, value in requirements.items():
        if _has_explicit_evidence_for_key(key, clauses):
            filtered[key] = value
    return filtered


def _sanitize_notes(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    notes = []
    for item in value:
        text = " ".join(str(item or "").split()).strip()
        if text:
            notes.append(text[:160])
        if len(notes) == 6:
            break
    return notes


def _merge_notes(*groups: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for note in group:
            note = " ".join(str(note or "").split()).strip()
            if not note or note in seen:
                continue
            seen.add(note)
            merged.append(note[:160])
            if len(merged) == 6:
                return merged
    return merged


def _extract_explicit_requirements(requirement_text: str) -> dict[str, Any]:
    clauses = _split_clauses(requirement_text)
    extracted: dict[str, Any] = {}

    body_clause = _find_body_clause(clauses)
    if body_clause:
        font = _extract_font(body_clause, allow_chinese=True, allow_latin=False)
        size = _extract_size_pt(body_clause)
        spacing = _extract_line_spacing(body_clause)
        align = _extract_align(body_clause)
        indent = _extract_first_line_indent(body_clause)
        if font:
            extracted["body_font"] = font
        if size is not None:
            extracted["body_size_pt"] = size
        if spacing is not None:
            extracted["line_spacing"] = spacing
        if align:
            extracted["body_align"] = align
        if indent is not None:
            extracted["first_line_indent_cm"] = indent

    _extract_heading_requirements(extracted, clauses, HEADING_1_KEYWORDS, "heading_1")
    _extract_heading_requirements(extracted, clauses, HEADING_2_KEYWORDS, "heading_2")
    _extract_heading_requirements(extracted, clauses, HEADING_3_KEYWORDS, "heading_3")

    for field, direction in (
        ("margin_top_cm", "top"),
        ("margin_bottom_cm", "bottom"),
        ("margin_left_cm", "left"),
        ("margin_right_cm", "right"),
    ):
        value = _extract_margin_cm(clauses, direction)
        if value is not None:
            extracted[field] = value

    if any(re.search(r"章.*独立分页|章标题.*独立分页|章.*分页", clause) for clause in clauses):
        extracted["chapter_page_break"] = True

    page_number_clause = _find_clause(clauses, ("页码",))
    if page_number_clause:
        extracted["add_page_number"] = True

    table_clause = _find_clause(clauses, ("表格",))
    if table_clause:
        table_size = _extract_size_pt(table_clause)
        if table_size is not None:
            extracted["table_size_pt"] = table_size

    reference_clause = _find_clause(clauses, ("参考文献", "悬挂缩进"), require_all=True)
    if reference_clause:
        hanging = _extract_first_line_indent(reference_clause, hanging=True)
        if hanging is not None:
            extracted["reference_hanging_indent_cm"] = hanging

    reference_spacing_clause = _find_clause(clauses, ("参考文献", "行距"), require_all=True)
    if reference_spacing_clause:
        spacing = _extract_line_spacing(reference_spacing_clause)
        if spacing is not None:
            extracted["reference_line_spacing"] = spacing

    _extract_appendix_requirements(
        extracted,
        clauses,
        APPENDIX_ENGLISH_KEYWORDS,
        "appendix_english_font",
        "appendix_english_size_pt",
        "appendix_english_line_spacing",
        allow_chinese=False,
        allow_latin=True,
    )
    _extract_appendix_requirements(
        extracted,
        clauses,
        APPENDIX_TRANSLATION_KEYWORDS,
        "appendix_translation_font",
        "appendix_translation_size_pt",
        "appendix_translation_line_spacing",
        allow_chinese=True,
        allow_latin=False,
    )
    _extract_appendix_requirements(
        extracted,
        clauses,
        APPENDIX_CODE_KEYWORDS,
        "appendix_code_font",
        "appendix_code_size_pt",
        "appendix_code_line_spacing",
        allow_chinese=False,
        allow_latin=True,
    )

    return extracted


def _extract_heading_requirements(
    extracted: dict[str, Any],
    clauses: list[str],
    keywords: tuple[str, ...],
    prefix: str,
) -> None:
    clause = _find_clause_with_signal(clauses, keywords, _has_heading_signal)
    if not clause:
        return
    font = _extract_font(clause, allow_chinese=True, allow_latin=False)
    size = _extract_size_pt(clause)
    align = _extract_align(clause)
    if font:
        extracted[f"{prefix}_font"] = font
    if size is not None:
        extracted[f"{prefix}_size_pt"] = size
    if align:
        extracted[f"{prefix}_align"] = align


def _extract_appendix_requirements(
    extracted: dict[str, Any],
    clauses: list[str],
    keywords: tuple[str, ...],
    font_field: str,
    size_field: str,
    spacing_field: str,
    *,
    allow_chinese: bool,
    allow_latin: bool,
) -> None:
    clause = _find_clause_with_signal(
        clauses,
        keywords,
        lambda clause: _has_appendix_signal(
            clause,
            allow_chinese=allow_chinese,
            allow_latin=allow_latin,
        ),
    )
    if not clause:
        return
    font = _extract_font(clause, allow_chinese=allow_chinese, allow_latin=allow_latin)
    size = _extract_size_pt(clause)
    spacing = _extract_line_spacing(clause)
    if font:
        extracted[font_field] = font
    if size is not None:
        extracted[size_field] = size
    if spacing is not None:
        extracted[spacing_field] = spacing


def _build_notes(requirement_text: str) -> list[str]:
    clauses = _split_clauses(requirement_text)
    notes: list[str] = []

    if any("参考文献" in clause and "格式" in clause for clause in clauses):
        notes.append("参考文献著录顺序和条目内容仍建议人工复核。")
    if any("外国作者" in clause and "姓名" in clause for clause in clauses):
        notes.append("外国作者姓名写法需要按学校要求人工复核。")
    if any("不能位于一页的最底部" in clause or "不能落页尾" in clause for clause in clauses):
        notes.append("标题不能落页尾属于版面控制项，生成后仍建议人工复核。")
    if any("不能空白太大" in clause or "留白太大" in clause for clause in clauses):
        notes.append("页面留白控制属于版面规则，生成后仍建议人工复核。")
    if any("5至8页" in clause or "5-8页" in clause or "5~8页" in clause for clause in clauses):
        notes.append("附录页数范围属于内容长度要求，生成后仍建议人工复核。")
    return notes[:6]


def _has_explicit_evidence_for_key(key: str, clauses: list[str]) -> bool:
    if key in {"body_font", "body_size_pt", "line_spacing", "body_align", "first_line_indent_cm"}:
        clause = _find_body_clause(clauses)
        if not clause:
            return False
        if key == "body_font":
            return _extract_font(clause, allow_chinese=True, allow_latin=False) is not None
        if key == "body_size_pt":
            return _extract_size_pt(clause) is not None
        if key == "line_spacing":
            return _extract_line_spacing(clause) is not None
        if key == "body_align":
            return _extract_align(clause) is not None
        return _extract_first_line_indent(clause) is not None

    if key.startswith("heading_1_"):
        return _has_heading_evidence(clauses, HEADING_1_KEYWORDS, key)
    if key.startswith("heading_2_"):
        return _has_heading_evidence(clauses, HEADING_2_KEYWORDS, key)
    if key.startswith("heading_3_"):
        return _has_heading_evidence(clauses, HEADING_3_KEYWORDS, key)

    if key.startswith("margin_"):
        direction = key.removeprefix("margin_").removesuffix("_cm")
        return _extract_margin_cm(clauses, direction) is not None

    if key == "chapter_page_break":
        return any(re.search(r"章.*独立分页|章标题.*独立分页|章.*分页", clause) for clause in clauses)
    if key == "add_page_number":
        return _find_clause(clauses, ("页码",)) is not None
    if key == "table_size_pt":
        clause = _find_clause(clauses, ("表格",))
        return clause is not None and _extract_size_pt(clause) is not None
    if key == "reference_hanging_indent_cm":
        clause = _find_clause(clauses, ("参考文献", "悬挂缩进"), require_all=True)
        return clause is not None and _extract_first_line_indent(clause, hanging=True) is not None
    if key == "reference_line_spacing":
        clause = _find_clause(clauses, ("参考文献", "行距"), require_all=True)
        return clause is not None and _extract_line_spacing(clause) is not None
    if key.startswith("appendix_english_"):
        return _has_appendix_evidence(clauses, APPENDIX_ENGLISH_KEYWORDS, key, allow_chinese=False, allow_latin=True)
    if key.startswith("appendix_translation_"):
        return _has_appendix_evidence(clauses, APPENDIX_TRANSLATION_KEYWORDS, key, allow_chinese=True, allow_latin=False)
    if key.startswith("appendix_code_"):
        return _has_appendix_evidence(clauses, APPENDIX_CODE_KEYWORDS, key, allow_chinese=False, allow_latin=True)
    if key == "latin_font":
        clause = _find_clause(clauses, ("英文字体", "Times New Roman", "Arial", "Calibri", "Cambria", "Courier New"))
        return clause is not None and _extract_font(clause, allow_chinese=False, allow_latin=True) is not None
    return True


def _has_heading_evidence(clauses: list[str], keywords: tuple[str, ...], key: str) -> bool:
    clause = _find_clause_with_signal(clauses, keywords, _has_heading_signal)
    if not clause:
        return False
    if key.endswith("_font"):
        return _extract_font(clause, allow_chinese=True, allow_latin=False) is not None
    if key.endswith("_size_pt"):
        return _extract_size_pt(clause) is not None
    if key.endswith("_align"):
        return _extract_align(clause) is not None
    return False


def _has_appendix_evidence(
    clauses: list[str],
    keywords: tuple[str, ...],
    key: str,
    *,
    allow_chinese: bool,
    allow_latin: bool,
) -> bool:
    clause = _find_clause_with_signal(
        clauses,
        keywords,
        lambda clause: _has_appendix_signal(
            clause,
            allow_chinese=allow_chinese,
            allow_latin=allow_latin,
        ),
    )
    if not clause:
        return False
    if key.endswith("_font"):
        return _extract_font(clause, allow_chinese=allow_chinese, allow_latin=allow_latin) is not None
    if key.endswith("_size_pt"):
        return _extract_size_pt(clause) is not None
    if key.endswith("_line_spacing"):
        return _extract_line_spacing(clause) is not None
    return False


def _split_clauses(text: str) -> list[str]:
    normalized = " ".join(str(text or "").split())
    return [part.strip() for part in SENTENCE_SPLIT_PATTERN.split(normalized) if part.strip()]


def _find_clause(clauses: list[str], keywords: tuple[str, ...], *, require_all: bool = False) -> str | None:
    for clause in clauses:
        matcher = all if require_all else any
        if matcher(keyword in clause for keyword in keywords):
            return clause
    return None


def _find_clause_with_signal(
    clauses: list[str],
    keywords: tuple[str, ...],
    signal,
) -> str | None:
    fallback: str | None = None
    for clause in clauses:
        if not any(keyword in clause for keyword in keywords):
            continue
        if signal(clause):
            return clause
        if fallback is None:
            fallback = clause
    return fallback


def _find_body_clause(clauses: list[str]) -> str | None:
    fallback: str | None = None
    for clause in clauses:
        compact = clause.replace(" ", "")
        if "正文" not in compact:
            continue
        if any(token in compact for token in HEADING_1_KEYWORDS + HEADING_2_KEYWORDS + HEADING_3_KEYWORDS):
            continue
        if not (
            compact.startswith("正文")
            or "正文用" in compact
            or "正文为" in compact
            or "论文正文用" in compact
            or "论文正文为" in compact
        ):
            continue
        if _has_body_signal(clause):
            return clause
        if fallback is None:
            fallback = clause
    return fallback


def _extract_font(text: str, *, allow_chinese: bool, allow_latin: bool) -> str | None:
    lowered = str(text or "").lower()
    matches: list[str] = []
    for token, canonical in FONT_ALIASES.items():
        is_latin = canonical[0].isascii()
        if token in lowered:
            if (is_latin and allow_latin) or (not is_latin and allow_chinese):
                matches.append(canonical)
    if not matches:
        return None
    if allow_latin and not allow_chinese:
        for name in matches:
            if name[0].isascii():
                return name
    if allow_chinese and not allow_latin:
        for name in matches:
            if not name[0].isascii():
                return name
    return matches[0]


def _normalize_font(value: Any) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    lowered = text.lower()
    for token, canonical in FONT_ALIASES.items():
        if token == lowered:
            return canonical
    return text[:60]


def _has_body_signal(clause: str) -> bool:
    return any(
        (
            _extract_font(clause, allow_chinese=True, allow_latin=False),
            _extract_size_pt(clause),
            _extract_line_spacing(clause),
            _extract_align(clause),
            _extract_first_line_indent(clause),
        )
    )


def _has_heading_signal(clause: str) -> bool:
    return any(
        (
            _extract_font(clause, allow_chinese=True, allow_latin=False),
            _extract_size_pt(clause),
            _extract_align(clause),
        )
    )


def _has_appendix_signal(clause: str, *, allow_chinese: bool, allow_latin: bool) -> bool:
    return any(
        (
            _extract_font(clause, allow_chinese=allow_chinese, allow_latin=allow_latin),
            _extract_size_pt(clause),
            _extract_line_spacing(clause),
        )
    )


def _extract_size_pt(text: str) -> float | None:
    text = str(text or "")
    numeric_match = re.search(r"(\d+(?:\.\d+)?)\s*pt", text, re.I)
    if numeric_match:
        return float(numeric_match.group(1))
    compact = text.replace(" ", "").lower()
    for token, value in SIZE_TOKENS:
        if token in compact:
            return value
        arabic_token = token.replace("一", "1").replace("二", "2").replace("三", "3").replace("四", "4").replace("五", "5").replace("六", "6").replace("七", "7").replace("八", "8").replace("初", "0")
        if arabic_token != token and arabic_token in compact:
            return value
    return None


def _extract_line_spacing(text: str) -> float | None:
    text = str(text or "")
    if "单倍" in text:
        return 1.0
    match = re.search(r"(\d+(?:\.\d+)?)\s*倍(?:行距)?", text)
    if match:
        return float(match.group(1))
    return None


def _extract_align(text: str) -> str | None:
    text = str(text or "")
    for token, value in ALIGN_TOKENS:
        if token in text:
            return value
    return None


def _extract_margin_cm(clauses: list[str], direction: str) -> float | None:
    direction_tokens = {
        "top": ("\u4e0a\u8fb9\u8ddd", "\u4e0a"),
        "bottom": ("\u4e0b\u8fb9\u8ddd", "\u4e0b"),
        "left": ("\u5de6\u8fb9\u8ddd", "\u5de6"),
        "right": ("\u53f3\u8fb9\u8ddd", "\u53f3"),
    }
    long_label, short_label = direction_tokens[direction]
    for clause in clauses:
        if "\u8fb9\u8ddd" not in clause and "\u9875\u8fb9\u8ddd" not in clause:
            continue
        match = re.search(
            rf"(?:{long_label}|{short_label})\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米)",
            clause,
            re.I,
        )
        if match:
            return _to_cm(float(match.group(1)), match.group(2))
        unit = _extract_unit(clause)
        compact_clause = clause.replace(" ", "")
        if unit:
            fallback = re.search(rf"(?:{long_label}|{short_label})[:：]?(\d+(?:\.\d+)?)", compact_clause)
            if fallback:
                return _to_cm(float(fallback.group(1)), unit)
    return None


def _extract_first_line_indent(text: str, *, hanging: bool = False) -> float | None:
    text = str(text or "")
    if hanging:
        if "悬挂缩进" not in text:
            return None
    else:
        if "首行缩进" not in text and "首行空两格" not in text and "首行空2格" not in text:
            return None
    match = re.search(r"(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米)", text, re.I)
    if match:
        return _to_cm(float(match.group(1)), match.group(2))
    if re.search(r"(2\s*字|2\s*字符|两字|两字符|首行空两格|首行空2格)", text):
        return 0.74
    if "不缩进" in text:
        return 0.0
    return None


def _extract_unit(text: str) -> str | None:
    match = re.search(r"(mm|毫米|cm|厘米)", text, re.I)
    if match:
        return match.group(1)
    return None


def _to_cm(value: float, unit: str) -> float:
    unit = str(unit or "").lower()
    if unit in {"mm", "毫米"}:
        return round(value / 10, 3)
    return round(value, 3)
