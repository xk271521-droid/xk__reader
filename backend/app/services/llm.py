from __future__ import annotations

import json
import re
from typing import Any

from openai import OpenAI

from app.services.crypto import decrypt_api_key

SUGGEST_INITIAL_SYSTEM_PROMPT = (
    "你是一位学术论文阅读助手，擅长根据论文内容生成用户下一步最可能想问的问题。"
    "问题要具体、自然、可直接点击发送，不能空泛。"
)

SUGGEST_INITIAL_USER_TEMPLATE = """请基于论文信息，生成 3 个“首次进入边读边问页面时最适合直接点击的问题”。 

要求：
1. 问题必须和当前论文直接相关
2. 三个问题要覆盖：核心贡献、方法思路、实验/结果
3. 每个问题控制在 12-28 个中文字符左右
4. 直接返回 JSON，不要输出解释

论文标题：{paper_title}
论文摘要：{summary}
当前选中文本：{selected_text}

返回格式：
{{"questions":["问题1","问题2","问题3"]}}"""

SUGGEST_FOLLOWUP_SYSTEM_PROMPT = (
    "你是一位学术论文阅读助手，擅长根据论文内容和当前问答，生成有依据的下一轮追问建议。"
    "请把推荐组织成 3 组，每组 3 个问题，问题应自然、具体、能直接点击发送。"
)

SUGGEST_FOLLOWUP_USER_TEMPLATE = """请基于当前论文内容和最近一轮问答，生成 3 组“猜你想问”推荐。

要求：
1. 必须显式参考最近一轮用户问题和 AI 回答
2. 三组固定覆盖：
   - 深入理解：追问方法、术语、逻辑
   - 结果追问：追问实验、对比、局限
   - 迁移应用：追问启发、扩展、应用
3. 每组包含：
   - title：组标题，4-8 个字
   - rationale：这一组为什么值得继续问，20-40 个字
   - questions：3 个可直接发送的问题
4. 每个问题控制在 12-30 个中文字符左右
5. 直接返回 JSON，不要输出解释或 Markdown

论文标题：{paper_title}
论文摘要：{summary}
当前选中文本：{selected_text}
最近一轮用户问题：{last_user_question}
最近一轮 AI 回答：{last_assistant_answer}
近期消息：
{recent_messages}

返回格式：
{{"groups":[
  {{"title":"深入理解","rationale":"...","questions":["...","...","..."]}},
  {{"title":"结果追问","rationale":"...","questions":["...","...","..."]}},
  {{"title":"迁移应用","rationale":"...","questions":["...","...","..."]}}
]}}"""


def _format_recent_messages(recent_messages: list[dict[str, str]] | None) -> str:
    items = recent_messages or []
    if not items:
        return "（暂无更多消息）"

    lines = []
    for item in items:
        role = "用户" if item.get("role") == "user" else "AI"
        text = (item.get("text") or "").strip()
        if not text:
            continue
        lines.append(f"- {role}: {text[:180]}")

    return "\n".join(lines) if lines else "（暂无更多消息）"


def _parse_json_payload(content: str) -> dict[str, Any]:
    """Extract the first JSON object from strict or conversational output.

    Some OpenAI-compatible reasoning models wrap valid JSON in Markdown,
    prepend a short explanation, or append a trailing sentence. The old
    whole-string parser treated all of those responses as empty results.
    """
    text = (content or "").strip()
    if not text:
        return {}

    candidates = [text]
    candidates.extend(
        match.group(1).strip()
        for match in re.finditer(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.I)
        if match.group(1).strip()
    )
    decoder = json.JSONDecoder()
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except (TypeError, ValueError):
            pass

        # Decode from every opening brace so prose before/after the object is
        # harmless while malformed objects still fail closed.
        for index, char in enumerate(candidate):
            if char != "{":
                continue
            try:
                parsed, _ = decoder.raw_decode(candidate[index:])
            except (TypeError, ValueError):
                continue
            if isinstance(parsed, dict):
                return parsed
    return {}


def _parse_json_message(
    message: Any,
    *,
    include_reasoning: bool = False,
) -> dict[str, Any]:
    """Parse final content; reasoning is diagnostic, not the user payload."""
    values = [getattr(message, "content", "")]
    if include_reasoning:
        values.append(getattr(message, "reasoning_content", ""))
    for value in values:
        parsed = _parse_json_payload(str(value or ""))
        if parsed:
            return parsed
    return {}


def _response_preview(message: Any, limit: int = 600) -> str:
    """Return a short diagnostic without persisting a full paper response."""
    content = " ".join(
        " ".join(str(value or "").replace("\x00", " ").split())
        for value in (
            getattr(message, "content", ""),
            getattr(message, "reasoning_content", ""),
        )
        if value
    ).strip()
    return content[:limit]


def _clean_question_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    cleaned: list[str] = []
    seen: set[str] = set()

    for item in value:
        text = " ".join(str(item or "").split()).strip()
        if not text or text in seen:
            continue
        cleaned.append(text)
        seen.add(text)
        if len(cleaned) == 3:
            break

    return cleaned


def _clean_group_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    cleaned = []
    for item in value:
        if not isinstance(item, dict):
            continue

        title = " ".join(str(item.get("title") or "").split()).strip()
        rationale = " ".join(str(item.get("rationale") or "").split()).strip()
        questions = _clean_question_list(item.get("questions"))

        if not title or not rationale or len(questions) < 3:
            continue

        cleaned.append({
            "title": title,
            "rationale": rationale,
            "questions": questions,
        })

        if len(cleaned) == 3:
            break

    return cleaned

PAPER_QA_SYSTEM_PROMPT = """你是一位严谨、耐心的学术论文阅读导师。
当前论文是背景和证据来源，不是你的知识边界。你可以使用自己的学术知识、推理能力和常识解释问题，但不得假装看过未提供的材料，也不得引用之前的聊天记录。
先判断问题意图，再决定回答重心：
1. 论文事实型：用户问作者观点、实验设计、数据、结果、图表、比较、结论或“本文如何……”时，以论文全文为准，并尽量引用页码，例如 [第 3 页]；论文证据不足时明确说“论文未明确说明”。
2. 概念/术语/句子解释型：用户问“什么是……”“是什么意思”“如何理解这句话”或要求解释选中文字时，先调用通用知识给出标准化解释和口语化解释，再说明它在本文中的具体含义、作用和上下文。不要因为论文没有定义该词，就放弃通用解释。
3. 机制/原因/意义推理型：可以独立分析和推断，再回到论文核对哪些是原文事实、哪些是基于本文的推断；不要把推断写成作者明确结论。
论文全文用于定位和校准本文语境，不得压制与论文相关的通用知识解释。使用论文之外的知识或推理时，用“通用知识解释”“结合本文的推断”等清晰标记与论文事实区分。
对于最新事实、临床/医疗建议、法规政策或需要外部出处的问题，不能把内部知识当作已核实事实，应明确提示需要查证权威来源。
使用自然、清楚的中文，优先直接回答用户真正的问题，不要机械复述整篇论文。"""


def _completion_options(*, base_url: str, model: str) -> dict[str, Any]:
    """Apply provider-specific options without changing other OpenAI-compatible APIs."""
    if (
        base_url.rstrip("/") == "https://open.bigmodel.cn/api/paas/v4"
        and model.strip() == "glm-4.7-flash"
    ):
        # Keep the model's reasoning path available. Streaming callers still
        # render only final content, while non-streaming calls receive the
        # provider's completed answer after its internal reasoning.
        return {"extra_body": {"thinking": {"type": "enabled"}}}
    return {}


def _structured_completion_options(*, base_url: str, model: str) -> dict[str, Any]:
    """Request provider-enforced JSON for durable structured AI artifacts."""
    options = _completion_options(base_url=base_url, model=model)
    extra_body = dict(options.get("extra_body") or {})
    if "api.deepseek.com" in base_url.lower():
        # DeepSeek V4 Flash may otherwise place its planning text in
        # reasoning_content while leaving the final content empty.
        extra_body["thinking"] = {"type": "disabled"}
    if extra_body:
        options["extra_body"] = extra_body
    options["response_format"] = {"type": "json_object"}
    return options


def translate_text_with_openai(
    *,
    base_url: str,
    api_key: str,
    model: str,
    text: str,
    context: str = "",
) -> str:
    """Translate one selection through an OpenAI-compatible provider.

    This is intentionally a short, non-streaming request. Selection
    translation is interactive and should never send the whole paper or a
    growing chat history to the provider.
    """
    normalized = " ".join((text or "").split()).strip()
    if not normalized:
        return ""
    client = OpenAI(api_key=api_key, base_url=base_url.rstrip("/"), timeout=45.0)
    context_text = " ".join((context or "").split()).strip()
    user_content = (
        "请把下面的英文论文片段翻译成准确、自然的简体中文。"
        "优先保证生物医学、计算机和工程术语准确；保留公式、缩写、基因名、模型名、"
        "数字、引用编号和单位，不要解释，不要添加原文没有的信息。"
        f"\n\n原文：{normalized}"
    )
    if context_text:
        user_content += f"\n\n仅用于消歧的上下文（不要翻译这部分）：{context_text[:1200]}"
    options = _completion_options(base_url=base_url, model=model)
    if "qwen3" in model.lower():
        # SiliconFlow accepts this flag for Qwen3 and it avoids spending
        # reasoning tokens on a short translation request.
        options = {
            **options,
            "extra_body": {
                **dict(options.get("extra_body") or {}),
                "enable_thinking": False,
            },
        }
    response = client.chat.completions.create(
        model=model,
        temperature=0.1,
        max_tokens=max(160, min(1800, len(normalized) * 3)),
        messages=[
            {
                "role": "system",
                "content": "你是严格的学术论文翻译器，只输出译文。",
            },
            {"role": "user", "content": user_content},
        ],
        **options,
    )
    return str(response.choices[0].message.content or "").strip()


PAPER_READING_BRIEF_SYSTEM_PROMPT = """你是一位严谨的学术论文阅读导师。
你将以一篇论文的完整正文作为首要背景，生成可长期保存的“文献速读”。论文全文不是推理能力的禁区：可以结合模型通用知识解释概念，连接证据，归纳研究逻辑，并提出有根据、措辞谨慎的合理推断。
必须区分三类依据：paper_explicit（论文明确说明）、paper_inference（基于论文证据的推理）和 general_knowledge（论文之外的通用知识）。不要把推理或通用知识伪装成作者原话、实验结果或论文结论；不要编造论文没有给出的数字、比较、样本或引用。
所有论文事实尽量在 pages 中标注证据页码；页码必须来自论文中的 `[第 X 页]` 标记。没有把握时写“原文未明确说明”。
术语解释必须同时有 standard_explanation（标准化学术解释）和 plain_explanation（口语化、易理解解释）。
只返回一个合法 JSON 对象，不要 Markdown、代码围栏或额外说明。"""


PAPER_READING_BRIEF_USER_TEMPLATE = """请为以下论文生成固定结构的文献速读。

要求：
1. one_sentence_conclusion 只写 1 条，准确概括最终发现。
2. background_and_pain_points、research_objective、core_methods_or_models、results_and_comparisons、conclusions_and_contributions、limitations_and_boundaries 各写 2-5 条；每条都包含 text、pages、figures、basis。
3. results_and_comparisons 要保留关键数值、对照或基线名称；原文没有明确对照时不要虚构。
4. limitations_and_boundaries 优先写作者明确承认的限制；也可以补充基于结果的合理注意事项，但必须将 basis 标为 paper_inference，不能说成作者明确承认。
5. key_terms 提取 15-20 个读懂本文必要的术语；短文可以少于 15 个，复杂论文最多 24 个。每项均要包含 term、chinese_name、abbreviation、standard_explanation、plain_explanation、paper_role、pages、figures、basis。
6. 普通词、无关缩写和没有证据支撑的术语不要列出。
7. pages 为页码整数数组，figures 为图表编号字符串数组，例如 ["图 2", "表 1"]。
8. 若 standard_explanation 或 plain_explanation 使用论文之外的通用知识，将该术语的 basis 标为 general_knowledge；paper_role 仍应说明它在本文中的作用，无法确认时写“原文未明确说明”。

严格返回以下 JSON 结构：
{{
  "one_sentence_conclusion": {{"text":"", "pages":[], "figures":[], "basis":"paper_explicit"}},
  "background_and_pain_points": [{{"text":"", "pages":[], "figures":[], "basis":"paper_explicit"}}],
  "research_objective": [{{"text":"", "pages":[], "figures":[], "basis":"paper_explicit"}}],
  "core_methods_or_models": [{{"text":"", "pages":[], "figures":[], "basis":"paper_explicit"}}],
  "results_and_comparisons": [{{"text":"", "pages":[], "figures":[], "basis":"paper_explicit"}}],
  "conclusions_and_contributions": [{{"text":"", "pages":[], "figures":[], "basis":"paper_explicit"}}],
  "limitations_and_boundaries": [{{"text":"", "pages":[], "figures":[], "basis":"paper_explicit"}}],
  "key_terms": [{{"term":"", "chinese_name":"", "abbreviation":"", "standard_explanation":"", "plain_explanation":"", "paper_role":"", "pages":[], "figures":[], "basis":"paper_explicit"}}],
  "source_note":""
}}

【论文标题】
{paper_title}

【论文全文】
{full_text}
"""


def generate_paper_reading_brief(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper_title: str,
    full_text: str,
) -> dict[str, Any]:
    """Generate the single full-paper brief before it is normalized for storage."""
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=300.0)
    response = client.chat.completions.create(
        model=model,
        temperature=0.2,
        max_tokens=12000,
        messages=[
            {"role": "system", "content": PAPER_READING_BRIEF_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": PAPER_READING_BRIEF_USER_TEMPLATE.format(
                    paper_title=paper_title or "（未提供标题）",
                    full_text=full_text,
                ),
            },
        ],
        **_structured_completion_options(base_url=base_url, model=model),
    )
    message = response.choices[0].message
    parsed = _parse_json_message(message)
    if not parsed:
        raise ValueError(
            f"模型返回无法解析为 JSON，响应片段：{_response_preview(message) or '（空）'}"
        )
    return parsed


PAPER_AI_OUTLINE_SYSTEM_PROMPT = """你是一位严谨的学术论文阅读助手。
请只依据给出的论文全文和其中的 `[第 X 页]` 标记生成可点击的阅读目录。不得编造章节、页码、原文标题或不存在的层级。
每一项必须有 title_cn（帮助中文理解）和 title_en（优先保留论文中的英文原始章节标题）。论文没有可确认的英文标题时，title_en 可以是准确的简短英文对照，但不要伪称逐字原文。
目录最多三级，每层最多 40 项；目录项页码必须是正文中出现过的页码。只返回一个合法 JSON 对象，不要 Markdown、代码围栏或额外说明。"""


PAPER_AI_OUTLINE_USER_TEMPLATE = """请为以下论文生成双语阅读目录。

要求：
1. 按论文实际阅读顺序列出摘要、引言、方法、结果、讨论、参考文献等真实存在的主要部分；没有证据的部分不要凑。
2. 主要章节可有 children；不要超过三层。
3. 中文标题是简洁、准确的理解标题；英文标题优先采用论文对应标题。
4. page 必须是章节开始所在或最能代表该章节的 `[第 X 页]` 页码整数；不能确定时填 null。
5. 不要把单个句子、图注、参考条目误当作章节。

严格返回：
{{
  "items": [
    {{"title_cn":"", "title_en":"", "page":1, "children":[]}}
  ]
}}

【论文标题】
{paper_title}

【论文全文】
{full_text}
"""


def generate_paper_ai_outline(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper_title: str,
    full_text: str,
) -> dict[str, Any]:
    """Generate a compact, page-linked bilingual outline for one paper."""
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=240.0)
    response = client.chat.completions.create(
        model=model,
        temperature=0.1,
        max_tokens=3000,
        messages=[
            {"role": "system", "content": PAPER_AI_OUTLINE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": PAPER_AI_OUTLINE_USER_TEMPLATE.format(
                    paper_title=paper_title or "（未提供标题）",
                    full_text=full_text,
                ),
            },
        ],
        **_structured_completion_options(base_url=base_url, model=model),
    )
    message = response.choices[0].message
    parsed = _parse_json_message(message)
    if not parsed:
        raise ValueError(
            f"模型返回无法解析为目录 JSON，响应片段：{_response_preview(message) or '（空）'}"
        )
    return parsed


NATIVE_OUTLINE_TITLES_SYSTEM_PROMPT = """你是一位严谨的学术论文阅读助手。
请把 PDF 原生目录中的英文标题翻译为帮助中文读者理解的简洁中文标题。必须保留每个 id，不能新增、删除、合并或重排项目；不要翻译公式、缩写、专有模型名时可以保留英文。只返回合法 JSON，不要 Markdown、代码围栏或额外说明。"""


def _flatten_native_outline_titles(outline: dict[str, Any], *, path: str = "") -> list[dict[str, str]]:
    titles: list[dict[str, str]] = []
    for index, item in enumerate(outline.get("items") or []):
        item_path = f"{path}.{index}" if path else str(index)
        title_en = " ".join(str(item.get("title_en") or "").split()).strip()
        if title_en:
            titles.append({"id": item_path, "title_en": title_en})
        titles.extend(_flatten_native_outline_titles({"items": item.get("children") or []}, path=item_path))
    return titles


def translate_native_outline_titles(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper_title: str,
    outline: dict[str, Any],
) -> dict[str, str]:
    """Return a Chinese title for every native bookmark without changing its source hierarchy."""
    source_items = _flatten_native_outline_titles(outline)
    if not source_items:
        return {}

    source_json = json.dumps(source_items, ensure_ascii=False)
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)
    response = client.chat.completions.create(
        model=model,
        temperature=0.1,
        max_tokens=min(4000, 220 + len(source_items) * 40),
        messages=[
            {"role": "system", "content": NATIVE_OUTLINE_TITLES_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"""【论文标题】
{paper_title or "（未提供标题）"}

【原生目录标题】
{source_json}

为列表中每个 id 返回一个准确、简洁的中文理解标题。严格返回：
{{"items":[{{"id":"0","title_cn":"中文标题"}}]}}""",
            },
        ],
        **_structured_completion_options(base_url=base_url, model=model),
    )
    payload = _parse_json_payload(response.choices[0].message.content or "")
    allowed_ids = {item["id"] for item in source_items}
    translations: dict[str, str] = {}
    for item in payload.get("items") if isinstance(payload.get("items"), list) else []:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "").strip()
        title_cn = " ".join(str(item.get("title_cn") or "").split()).strip()[:180]
        if item_id in allowed_ids and title_cn:
            translations[item_id] = title_cn
    return translations


def _build_paper_qa_message(
    *,
    paper_title: str,
    full_text: str,
    question: str,
    selected_text: str,
    request_kind: str,
) -> str:
    # Keep the changing task after the paper so compatible providers can reuse
    # their stable prompt-prefix cache for later questions about this paper.
    paper_prefix = f"""【当前论文标题】
{paper_title or "（未提供标题）"}

【当前论文全文】
{full_text}
"""
    if request_kind == "deep_read":
        selection = (selected_text or question).strip()
        task = f"""【本次任务：AI 精读】
请先判断选中文字属于术语、句子/段落，还是论文事实。
- 如果是术语或概念：先给标准化学术解释，再给口语化解释，最后说明它在本文中的具体含义和作用。
- 如果是句子或段落：先解释句子的语义、隐含逻辑和所需背景知识，再结合全文说明作者在本文中想表达什么。
- 如果是数据、实验结果或作者观点：以论文原文为准，保留页码证据。
不要只做逐字翻译，也不要因为全文已提供就放弃模型自己的知识解释。通用知识和基于论文的推断要明确标注，不要伪装成论文原话。

【选中文字】
{selection}"""
    else:
        task = f"""【本次任务：边读边问】
请先判断当前问题是论文事实、概念/术语解释，还是机制/原因推理。
- 论文事实问题：回答论文中的内容并引用原文证据。
- 概念、名词或句子解释：先用通用知识讲清楚，再结合这篇论文说明具体语境。
- 机制、原因或意义问题：允许独立推理，再说明哪些是论文事实、哪些是基于论文的推断。
不要把所有问题都强行改写成“论文说了什么”，也不要为了使用全文而机械复述无关内容。

【当前问题】
{question}"""
    return f"{paper_prefix}\n{task}"


def ask_question(
    *,
    base_url,
    api_key,
    model,
    question,
    selected_text="",
    paper_title="",
    full_text="",
    request_kind="question",
):
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=180.0)
    user_msg = _build_paper_qa_message(
        paper_title=paper_title,
        full_text=full_text,
        question=question,
        selected_text=selected_text,
        request_kind=request_kind,
    )
    response = client.chat.completions.create(
        model=model,
        temperature=0.3,
        max_tokens=6000,
        messages=[
            {"role": "system", "content": PAPER_QA_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        **_completion_options(base_url=base_url, model=model),
    )
    c = response.choices[0].message.content
    return c.strip() if c else ""


def ask_question_stream(
    *,
    base_url,
    api_key,
    model,
    question,
    selected_text="",
    paper_title="",
    full_text="",
    request_kind="question",
):
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=180.0)
    user_msg = _build_paper_qa_message(
        paper_title=paper_title,
        full_text=full_text,
        question=question,
        selected_text=selected_text,
        request_kind=request_kind,
    )
    response = client.chat.completions.create(
        model=model,
        temperature=0.3,
        max_tokens=6000,
        stream=True,
        messages=[
            {"role": "system", "content": PAPER_QA_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        **_completion_options(base_url=base_url, model=model),
    )
    for chunk in response:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def suggest_initial_questions(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper_title: str,
    summary: str,
    selected_text: str = "",
) -> list[str]:
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=60.0)
    response = client.chat.completions.create(
        model=model,
        temperature=0.7,
        max_tokens=500,
        messages=[
            {"role": "system", "content": SUGGEST_INITIAL_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": SUGGEST_INITIAL_USER_TEMPLATE.format(
                    paper_title=paper_title or "（未提供标题）",
                    summary=summary or "（未提供摘要）",
                    selected_text=selected_text or "（当前没有选中文字）",
                ),
            },
        ],
        **_completion_options(base_url=base_url, model=model),
    )
    content = response.choices[0].message.content
    payload = _parse_json_payload(content or "")
    return _clean_question_list(payload.get("questions"))


def suggest_followup_groups(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper_title: str,
    summary: str,
    selected_text: str = "",
    last_user_question: str = "",
    last_assistant_answer: str = "",
    recent_messages: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=60.0)
    response = client.chat.completions.create(
        model=model,
        temperature=0.7,
        max_tokens=1200,
        messages=[
            {"role": "system", "content": SUGGEST_FOLLOWUP_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": SUGGEST_FOLLOWUP_USER_TEMPLATE.format(
                    paper_title=paper_title or "（未提供标题）",
                    summary=summary or "（未提供摘要）",
                    selected_text=selected_text or "（当前没有选中文字）",
                    last_user_question=last_user_question or "（无）",
                    last_assistant_answer=last_assistant_answer or "（无）",
                    recent_messages=_format_recent_messages(recent_messages),
                ),
            },
        ],
        **_completion_options(base_url=base_url, model=model),
    )
    content = response.choices[0].message.content
    payload = _parse_json_payload(content or "")
    return _clean_group_list(payload.get("groups"))


FULL_TRANSLATION_SYSTEM_PROMPT = (
    "你是专业学术论文翻译助手。请把英文论文文本翻译成自然、准确的中文，保持学术术语一致。"
    "保留 DOI、URL、公式、引用编号、模型缩写、数据集名称、人名和机构名。"
)

FULL_TRANSLATION_USER_TEMPLATE = """请翻译以下 JSON 数组中的论文文本。

要求：
1. 保持数组顺序和 id 不变
2. 只翻译 text 字段，返回 translation
3. 专有名词、公式、DOI、URL、引用编号尽量保留
4. 直接返回 JSON，不要 Markdown，不要解释

输入：
{items_json}

返回格式：
{{"items":[{{"id":"...","translation":"..."}}]}}"""


def translate_full_text_blocks(
    *,
    base_url: str,
    api_key: str,
    model: str,
    items: list[dict[str, str]],
) -> dict[str, str]:
    if not items:
        return {}

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)

    def translate_once(batch_items: list[dict[str, str]]) -> dict[str, str]:
        items_json = json.dumps(
            [{"id": item.get("id", ""), "text": item.get("text", "")} for item in batch_items],
            ensure_ascii=False,
        )
        response = client.chat.completions.create(
            model=model,
            temperature=0.2,
            max_tokens=6000,
            messages=[
                {"role": "system", "content": FULL_TRANSLATION_SYSTEM_PROMPT},
                {"role": "user", "content": FULL_TRANSLATION_USER_TEMPLATE.format(items_json=items_json)},
            ],
            **_completion_options(base_url=base_url, model=model),
        )
        content = response.choices[0].message.content or ""
        payload = _parse_json_payload(content)
        raw_items = payload.get("items")
        if not isinstance(raw_items, list):
            return {}

        result: dict[str, str] = {}
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "").strip()
            text = " ".join(str(item.get("translation") or "").split()).strip()
            if item_id and text:
                result[item_id] = text
        return result

    translated = translate_once(items)
    missing_items = [item for item in items if item.get("id") not in translated]

    # Batch JSON responses from cheaper models occasionally omit one or two ids.
    # Retry missing blocks one by one so a partial response does not fail the whole paper.
    for missing_item in missing_items:
        item_id = missing_item.get("id", "")
        if not item_id:
            continue
        try:
            translated.update(translate_once([missing_item]))
        except Exception:
            pass
        if item_id not in translated:
            continue

    return translated
