from __future__ import annotations

import re
from typing import List

from sqlalchemy import select

from app.schemas.selection import (
    SelectionGlossaryItem,
    SelectionInsightResponse,
)
from app.services.translate import translate_text

STOPWORDS = {
    "about", "after", "among", "and", "approach", "based", "between",
    "from", "have", "into", "method", "model", "novel", "paper",
    "performance", "results", "study", "that", "their", "these",
    "this", "using", "with",
}

TOKEN_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9\-]{1,}\b")
ENDING_PUNCTUATION_RE = re.compile(r"[.!?;:]\s*$")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def detect_text_kind(text: str) -> str:
    normalized = normalize_text(text)
    words = normalized.split()
    word_count = len(words)

    if word_count <= 1:
        return "word"
    if word_count >= 40:
        return "passage"

    looks_like_title = (
        word_count >= 6
        and not ENDING_PUNCTUATION_RE.search(normalized)
        and normalized[:1].isupper()
    )
    if looks_like_title:
        return "title"
    if word_count >= 10 or ENDING_PUNCTUATION_RE.search(normalized):
        return "sentence"
    if word_count <= 5:
        return "phrase"
    return "sentence"


def extract_keywords(text: str) -> List[str]:
    unique_words: List[str] = []
    seen_words: set[str] = set()
    for word in TOKEN_RE.findall(text):
        normalized = word.lower()
        if normalized in STOPWORDS:
            continue
        if len(normalized) < 3 and not word.isupper():
            continue
        if normalized in seen_words:
            continue
        unique_words.append(word)
        seen_words.add(normalized)
        if len(unique_words) == 5:
            break
    return unique_words


def describe_term(term: str) -> str:
    if "-" in term or sum(1 for char in term if char.isupper()) >= 2:
        return "更像模型名、缩写或复合术语，建议回到方法部分确认定义。"
    if term.endswith(("tion", "ment", "ness", "ity", "ance", "ence")):
        return "更像概念名词，阅读时重点看它和动作、结果之间的关系。"
    if term.endswith(("ing", "ed")):
        return "更像过程或状态描述，结合前后主语和宾语去理解会更准。"
    return "建议结合上下文判断它是研究对象、方法步骤还是结果指标。"


def build_glossary(keywords: List[str]) -> List[SelectionGlossaryItem]:
    return [
        SelectionGlossaryItem(term=term, note=describe_term(term))
        for term in keywords[:3]
    ]


def build_focus_points(text_kind: str, keywords: List[str]) -> List[str]:
    focus_term = keywords[0] if keywords else "核心术语"
    if text_kind == "word":
        return [
            f"先确认 {focus_term} 在这篇论文里是通用词、术语还是缩写。",
            "再看它前后的限定词，避免只按字面义理解。",
            "最后回到所在句，判断作者是在定义概念还是描述结果。",
        ]
    if text_kind == "phrase":
        return [
            "先看这段短语修饰的是对象、方法还是实验结果。",
            f"优先盯住 {focus_term} 这类核心词，再补全前后搭配。",
            "如果它不是完整句，最好连上一句或下一句一起读。",
        ]
    if text_kind == "title":
        return [
            "先拆成研究对象、核心方法、目标效果三层来读。",
            f"通常 {focus_term} 这类词会决定论文的方法或主题。",
            "标题里的 enhancement、performance 这类词常提示作者强调改进效果。",
        ]
    if text_kind == "passage":
        return [
            "这段内容已经超过一句，先抓主题句再看补充细节。",
            "优先标出因果、转折、比较这些连接关系。",
            f"遇到 {focus_term} 这类核心词，回看它是否在前文已经定义过。",
        ]
    return [
        "先抓主语、动作和结论，别一上来逐词翻译。",
        "留意 because、therefore、while、by 等逻辑关系词。",
        f"看到 {focus_term} 这类关键词时，重点判断它在句子里承担什么角色。",
    ]


def build_local_translation(text: str, text_kind: str) -> str:
    preview = normalize_text(text)
    if text_kind == "word":
        return f"暂未拿到实时词义，先保留原词：{preview}"
    if text_kind == "phrase":
        return f"暂未拿到实时短语译文，建议结合上下句理解这段内容：{preview}"
    return f"暂未拿到实时译文，先保留当前原文重点：{preview}"


def build_explanation(
    *,
    text_kind: str,
    paper_title: str | None,
    glossary: List[SelectionGlossaryItem],
) -> str:
    topic = paper_title or "当前论文"
    lead_term = glossary[0].term if glossary else ""
    term_hint = (
        f" 其中可以优先盯住 {lead_term} 这个词，判断它是方法、任务还是结果指标。"
        if lead_term else ""
    )
    if text_kind == "word":
        return (
            f"这次选中的内容更像 {topic} 里的单个术语。"
            " 这类词不要孤立记忆，最好回到所在句里看它被哪些词限定。"
            f"{term_hint}"
        )
    if text_kind == "phrase":
        return (
            f"这段内容更像 {topic} 里的短语片段，还不是完整结论。"
            " 阅读时先补全它前后的主干，再判断作者是在命名方法、描述对象还是限定条件。"
            f"{term_hint}"
        )
    if text_kind == "title":
        return (
            f"这段内容更像 {topic} 的标题或关键命题。"
            " 最有效的读法是先拆出研究对象，再找方法名称，最后看作者强调的提升目标。"
            f"{term_hint}"
        )
    if text_kind == "passage":
        return (
            f"这次选中的内容已经接近一个完整段落，建议按主题句 → 论证细节 → 结果落点的顺序去读 {topic}。"
            " 先找总述，再看补充说明，理解会比逐词硬翻更快。"
            f"{term_hint}"
        )
    return (
        f"这次选中的内容更像 {topic} 里的完整句子。"
        " 先抓主语、核心动作和结论，再看作者是在介绍方法、解释原理还是汇报结果。"
        f"{term_hint}"
    )


def build_selection_insight(
    *,
    text: str,
    paper_title: str | None,
    domain: str = "",
    summary: str | None = None,
    context: str = "",
    provider_id: int | None = None,
) -> SelectionInsightResponse:
    normalized_text = normalize_text(text)
    text_kind = detect_text_kind(normalized_text)
    keywords = extract_keywords(normalized_text)
    glossary = build_glossary(keywords)

    # 翻译：保持用百度
    translated_text = translate_text(normalized_text, domain=domain)
    if translated_text and translated_text != normalized_text:
        translation = translated_text
        source = "百度翻译 + AI阅读助手"
    else:
        translation = build_local_translation(normalized_text, text_kind)
        source = "AI阅读助手"

    # 解释：优先 LLM，失败回退规则模板
    explanation = _ai_explanation_or_fallback(
        text=normalized_text,
        text_kind=text_kind,
        paper_title=paper_title,
        glossary=glossary,
        summary=summary,
        context=context,
        provider_id=provider_id,
    )

    return SelectionInsightResponse(
        translation=translation,
        explanation=explanation,
        keywords=keywords,
        source=source,
        text_kind=text_kind,
        focus_points=build_focus_points(text_kind, keywords),
        glossary=glossary,
    )


def _ai_explanation_or_fallback(
    *,
    text: str,
    text_kind: str,
    paper_title: str | None,
    glossary: List[SelectionGlossaryItem],
    summary: str | None,
    context: str,
    provider_id: int | None,
) -> str:
    if not provider_id or not summary or not summary.strip():
        return build_explanation(
            text_kind=text_kind,
            paper_title=paper_title,
            glossary=glossary,
        )

    try:
        from app.db.session import SessionLocal
        from app.models.ai_provider import AiProvider
        from app.services.crypto import decrypt_api_key
        from app.services.llm import explain_selection

        db = SessionLocal()
        try:
            provider = db.scalar(
                select(AiProvider).where(
                    AiProvider.id == provider_id,
                    AiProvider.is_active.is_(True),
                )
            )
            if not provider:
                return build_explanation(
                    text_kind=text_kind,
                    paper_title=paper_title,
                    glossary=glossary,
                )

            api_key = decrypt_api_key(provider.encrypted_api_key)
            result = explain_selection(
                base_url=provider.base_url,
                api_key=api_key,
                model=provider.model,
                selected_text=text,
                summary=summary,
                context=context,
            )
            if result:
                return result
        finally:
            db.close()
    except Exception:
        pass

    return build_explanation(
        text_kind=text_kind,
        paper_title=paper_title,
        glossary=glossary,
    )
