from __future__ import annotations

import re
from typing import List

from app.schemas.selection import SelectionInsightResponse


def extract_keywords(text: str) -> List[str]:
    words = re.findall(r"[A-Za-z][A-Za-z\-]{3,}", text)
    unique_words: List[str] = []
    seen_words: set[str] = set()

    for word in words:
        normalized = word.lower()
        if normalized not in seen_words:
            unique_words.append(word)
            seen_words.add(normalized)
        if len(unique_words) == 4:
            break

    return unique_words


def build_mock_translation(text: str) -> str:
    return (
        "演示翻译：这段内容主要在说明论文中的关键机制或实验结论。"
        f" 当前原文是 “{text[:120]}” 。后续接入真实大模型后，这里会替换成正式中译。"
    )


def build_mock_explanation(text: str, paper_title: str | None) -> str:
    topic = paper_title or "当前论文"
    return (
        f"演示解释：这句话需要结合 {topic} 的上下文来理解。"
        " 你可以先抓主语、核心动作和结论，再判断作者是在介绍方法、解释原理还是汇报结果。"
        " 目前这部分先用本地占位逻辑返回，方便我们验证“划词即解释”的交互流程。"
    )


def build_selection_insight(
    *,
    text: str,
    paper_title: str | None,
) -> SelectionInsightResponse:
    return SelectionInsightResponse(
        translation=build_mock_translation(text),
        explanation=build_mock_explanation(text, paper_title),
        keywords=extract_keywords(text),
        source="mock-backend",
    )
