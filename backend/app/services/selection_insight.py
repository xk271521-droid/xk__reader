from __future__ import annotations

import re
from typing import List, Literal

from app.schemas.selection import (
    SelectionGlossaryItem,
    SelectionInsightResponse,
)
from app.services.machine_translation import translate_with_tencent_mt
from app.services.termbase import load_termbase
from app.services.translate import translate_text
from app.services.llm import translate_text_with_openai
from app.services.translation_models import (
    FULL_TRANSLATION_MODEL_BY_KEY,
    is_siliconflow_endpoint,
)

STOPWORDS = {
    "about", "after", "among", "and", "approach", "based", "between",
    "from", "have", "into", "method", "model", "novel", "paper",
    "performance", "results", "study", "that", "their", "these",
    "this", "using", "with",
}

TranslationProvider = Literal[
    "baidu",
    "tencent",
    "siliconflow_glm4",
    "siliconflow_qwen3",
    "siliconflow_glmz1",
    "siliconflow_hunyuan",
]


class TranslationProviderUnavailable(RuntimeError):
    """Raised when the explicitly selected translation provider cannot respond."""

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


def build_translation_result(
    text: str,
    text_kind: str,
    domain: str = "",
    translation_provider: TranslationProvider = "baidu",
    provider_base_url: str = "",
    provider_api_key: str = "",
    context: str = "",
    baidu_appid: str = "",
    baidu_secret: str = "",
) -> tuple[str, str]:
    if translation_provider == "baidu":
        if not baidu_appid or not baidu_secret:
            raise TranslationProviderUnavailable("尚未配置百度翻译，请前往【账户中心 - AI 厂商与翻译配置】填写自己的百度翻译 APP ID 和密钥。")
        translated_text = translate_text(text, domain=domain, appid=baidu_appid, secret=baidu_secret)
        if translated_text:
            source = "百度领域翻译" if domain else "百度通用翻译"
            return translated_text, source
        raise TranslationProviderUnavailable("百度翻译调用失败，请检查密钥是否正确或额度是否充足。")

    if translation_provider in FULL_TRANSLATION_MODEL_BY_KEY:
        model = FULL_TRANSLATION_MODEL_BY_KEY[translation_provider]
        if not provider_api_key or not is_siliconflow_endpoint(provider_base_url):
            raise TranslationProviderUnavailable(
                "请先在 AI 厂商配置中添加 SiliconFlow 翻译厂商，再使用该备用模型。"
            )
        try:
            translated_text = translate_text_with_openai(
                base_url=provider_base_url,
                api_key=provider_api_key,
                model=model.model_id,
                text=text,
                context=context,
            )
        except Exception as exc:
            raise TranslationProviderUnavailable(
                f"{model.label} 暂时不可用：{exc}"
            ) from exc
        if translated_text:
            return translated_text, f"SiliconFlow · {model.label}"
        raise TranslationProviderUnavailable(f"{model.label} 未返回有效译文，请稍后重试。")

    try:
        terms, _ = load_termbase()
        translated_items = translate_with_tencent_mt(
            items=[{"id": "selection", "text": text}],
            terms=terms,
        )
        tencent_text = str(translated_items.get("selection") or "").strip()
        if tencent_text:
            return tencent_text, "腾讯机器翻译"
    except Exception as exc:
        # The caller selected Tencent, so do not silently replace it with Baidu.
        raise TranslationProviderUnavailable(f"腾讯机器翻译暂时不可用：{exc}") from exc

    raise TranslationProviderUnavailable("腾讯机器翻译未返回有效译文，请稍后重试。")


def build_selection_insight(
    *,
    text: str,
    paper_title: str | None,
    domain: str = "",
    translation_provider: TranslationProvider = "baidu",
    summary: str | None = None,
    context: str = "",
    provider_id: int | None = None,
    provider_base_url: str = "",
    provider_api_key: str = "",
    baidu_appid: str = "",
    baidu_secret: str = "",
) -> SelectionInsightResponse:
    normalized_text = normalize_text(text)
    text_kind = detect_text_kind(normalized_text)
    keywords = extract_keywords(normalized_text)
    glossary = build_glossary(keywords)

    translation, source = build_translation_result(
        normalized_text,
        text_kind,
        domain=domain,
        translation_provider=translation_provider,
        provider_base_url=provider_base_url,
        provider_api_key=provider_api_key,
        context=context,
        baidu_appid=baidu_appid,
        baidu_secret=baidu_secret,
    )

    return SelectionInsightResponse(
        translation=translation,
        keywords=keywords,
        source=source,
        text_kind=text_kind,
        focus_points=build_focus_points(text_kind, keywords),
        glossary=glossary,
    )
