from __future__ import annotations

import re
from typing import List

from app.models import AiProvider

from app.schemas.selection import (
    SelectionGlossaryItem,
    SelectionInsightResponse,
)
from app.services.machine_translation import translate_with_tencent_mt
from app.services.termbase import load_termbase
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


def build_translation_result(text: str, text_kind: str, domain: str = "") -> tuple[str, str]:
    translated_text = translate_text(text, domain=domain)
    if translated_text and translated_text != text:
        source = "百度领域翻译 + AI 阅读助手" if domain else "百度通用翻译 + AI 阅读助手"
        return translated_text, source

    try:
        terms, _ = load_termbase()
        translated_items = translate_with_tencent_mt(
            items=[{"id": "selection", "text": text}],
            terms=terms,
        )
        tencent_text = str(translated_items.get("selection") or "").strip()
        if tencent_text and tencent_text != text:
            return tencent_text, "腾讯机器翻译 + AI 阅读助手"
    except Exception:
        pass

    return build_local_translation(text, text_kind), "AI 阅读助手"


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

    translation, source = build_translation_result(
        normalized_text,
        text_kind,
        domain=domain,
    )

    # 解释由前端单独调 explain 端点获取，主接口不做 AI 调用
    return SelectionInsightResponse(
        translation=translation,
        explanation="",
        keywords=keywords,
        source=source,
        text_kind=text_kind,
        focus_points=build_focus_points(text_kind, keywords),
        glossary=glossary,
    )


AI_OOPS = [
    "🤖 哎呀，AI 小助手刚走神了，没来得及分析这段——先看看下面的提示凑合用？",
    "😅 本想让 AI 帮你拆解的，结果它溜号了。先看看人类的提示吧！",
    "🙈 AI 说它还没学会读这一段……不过别担心，下面的阅读提示也能帮到你。",
    "🤔 AI 挠了挠头表示没看懂，但下面的小贴士应该能搭把手。",
    "😴 AI 可能睡着了（毕竟它不用喝咖啡），先看阅读提示顶着！",
    "🫠 AI 表示这段超出它的理解范围了——不过别急，试试看下面的阅读建议。",
]


def _ai_oops() -> str:
    import random
    return random.choice(AI_OOPS)


FRIENDLY_HINT = (
    "\n\n💡 **小提示**：在右上角头像 → AI 配置 里添加并启用一个厂商（比如 DeepSeek），"
    "下次划词就能享受 AI 加持啦～"
)


def _ai_explanation_or_fallback(
    *,
    text: str,
    text_kind: str,
    paper_title: str | None,
    glossary: List[SelectionGlossaryItem],
    summary: str | None,
    context: str,
    provider: AiProvider | None,
    api_key: str = "",
) -> str:
    if not provider or not api_key:
        return _ai_oops() + FRIENDLY_HINT

    if not summary or not summary.strip():
        return _ai_oops() + "\n\n> 还没生成论文摘要，AI 暂时没有上下文可以参考。先读完或者生成摘要再试～"

    try:
        from app.services.llm import explain_selection

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
    except Exception:
        pass

    return _ai_oops()
