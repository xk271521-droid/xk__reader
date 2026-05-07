from __future__ import annotations

import json
import re
from typing import Any

from openai import OpenAI

from app.services.crypto import decrypt_api_key

SUMMARY_SYSTEM_PROMPT = (
    "你是一位专业的学术论文阅读助手，擅长用通俗易懂的中文概括复杂的学术内容。"
)

SUMMARY_USER_TEMPLATE = """请仔细阅读以下论文内容，写一份 500-800 字的中文摘要。

要求：
1. 概括研究背景与核心问题
2. 说明提出的方法或理论框架
3. 总结关键实验/结果
4. 指出创新点和局限（如果有）
5. 使用流畅口语化中文，不要生硬直译术语
6. 严格控制在 500-800 个中文字符之间

论文全文：
{full_text}"""

EXPLANATION_SYSTEM_PROMPT = (
    "你是一位耐心的学术阅读导师，擅长用日常语言解释复杂的学术段落。"
)

EXPLANATION_USER_TEMPLATE = """以下是用户正在阅读的论文摘要和具体段落，请帮助理解。

【论文摘要】
{summary}

【选中文字】
{selected_text}

【上下文（前后 2-3 句）】
{context}

请用口语化、通俗易懂的中文解释：
1. 先用一两句概括这段内容在论文中的角色（方法？结果？背景？）
2. 用通俗语言拆解核心概念和逻辑，不要逐字翻译
3. 涉及专业术语时用类比或简单例子帮助理解
4. 控制在 200-400 字
5. 不要给"回去读原文"这类建议，直接解释清楚"""


def generate_summary(
    *,
    base_url: str,
    api_key: str,
    model: str,
    full_text: str,
) -> str:
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=120.0,
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": SUMMARY_USER_TEMPLATE.format(full_text=full_text)},
        ],
        temperature=0.5,
        max_tokens=1500,
    )
    content = response.choices[0].message.content
    return content.strip() if content else ""


def explain_selection_stream(
    *,
    base_url: str,
    api_key: str,
    model: str,
    selected_text: str,
    summary: str,
    context: str = "",
):
    """流式返回解释内容，yield token strings"""
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=60.0,
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": EXPLANATION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": EXPLANATION_USER_TEMPLATE.format(
                    summary=summary,
                    selected_text=selected_text,
                    context=context or "（无额外上下文）",
                ),
            },
        ],
        temperature=0.7,
        max_tokens=800,
        stream=True,
    )
    for chunk in response:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def explain_selection(
    *,
    base_url: str,
    api_key: str,
    model: str,
    selected_text: str,
    summary: str,
    context: str = "",
) -> str:
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=60.0,
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": EXPLANATION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": EXPLANATION_USER_TEMPLATE.format(
                    summary=summary,
                    selected_text=selected_text,
                    context=context or "（无额外上下文）",
                ),
            },
        ],
        temperature=0.7,
        max_tokens=800,
    )
    content = response.choices[0].message.content
    return content.strip() if content else ""


def explain_selection_stream(
    *,
    base_url: str,
    api_key: str,
    model: str,
    selected_text: str,
    summary: str,
    context: str = "",
):
    """流式返回解释内容，yield token strings"""
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=60.0,
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": EXPLANATION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": EXPLANATION_USER_TEMPLATE.format(
                    summary=summary,
                    selected_text=selected_text,
                    context=context or "（无额外上下文）",
                ),
            },
        ],
        temperature=0.7,
        max_tokens=800,
        stream=True,
    )
    for chunk in response:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


ASK_SYSTEM_PROMPT = '你是一位耐心的学术论文阅读导师。请结合论文摘要和选中文字，用通俗中文回答。控制在300字以内。'

ASK_USER_TEMPLATE = '论文摘要: {summary}\n正在阅读的片段: {selected_text}\n问题: {question}'

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
    text = (content or "").strip()
    if not text:
        return {}

    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if fenced:
        text = fenced.group(1)

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


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

def ask_question(*, base_url, api_key, model, question, selected_text="", summary=""):
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=60.0)
    user_msg = ASK_USER_TEMPLATE.format(summary=summary or "(无)", selected_text=selected_text or "(无)", question=question)
    response = client.chat.completions.create(model=model, temperature=0.7, max_tokens=600, messages=[
        {"role": "system", "content": ASK_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ])
    c = response.choices[0].message.content
    return c.strip() if c else ""


def ask_question_stream(*, base_url, api_key, model, question, selected_text="", summary=""):
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=60.0)
    user_msg = ASK_USER_TEMPLATE.format(summary=summary or "(无)", selected_text=selected_text or "(无)", question=question)
    response = client.chat.completions.create(
        model=model,
        temperature=0.7,
        max_tokens=600,
        stream=True,
        messages=[
            {"role": "system", "content": ASK_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
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
            translated[item_id] = str(missing_item.get("text") or "").strip()

    return translated
