from __future__ import annotations

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
