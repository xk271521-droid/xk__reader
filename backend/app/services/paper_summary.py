from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AiProvider, Annotation, Paper, PaperFullTranslation, PaperSummary
from app.services.crypto import decrypt_api_key


SUMMARY_TYPES: dict[str, dict[str, Any]] = {
    "overview": {
        "title": "整篇总结",
        "target_words": "1800-2600",
        "section_chars": "220-420",
        "intent": "帮助研究生第一次读懂论文主线，快速抓住问题、方法、实验、结论和不足。",
        "sections": ["研究问题", "背景动机", "核心方法", "实验设计", "主要结论", "创新点", "不足与局限", "后续追问"],
        "focus": "全文结构、摘要、引言、方法、实验、结论、局限。",
    },
    "annotations": {
        "title": "我的标注总结",
        "target_words": "按标注数量动态生成，通常 800-1600",
        "section_chars": "160-320",
        "intent": "只围绕用户自己标注过的内容做主题聚类和复盘，帮助用户看清自己关注了什么。",
        "sections": ["标注主题聚类", "方法相关重点", "结果相关重点", "用户关注点", "遗漏提醒", "后续追问"],
        "focus": "用户标注文本、标注页码、标注前后文；不要把全文总结伪装成标注总结。",
    },
    "review": {
        "title": "文献综述卡片",
        "target_words": "900-1400",
        "section_chars": "160-300",
        "intent": "产出可聚合的标准字段，服务后期多篇论文对比矩阵和综述写作。",
        "sections": ["研究问题与对象", "关键变量/指标", "方法与模型", "数据与样本", "核心结论与发现", "创新点与局限性", "文献定位与引用价值", "可对比标签"],
        "focus": "字段短而稳定，适合进入矩阵；必须优先补齐关键变量/指标、核心结论与发现、创新点与局限性、文献定位与引用价值。",
        "extra_rules": "文献综述卡片必须说明被解释变量、核心解释变量、变量衡量口径和数据来源；核心结论要区分长期/短期效应、显著/不显著结果和反常发现；创新点与局限性要能服务用户找研究切入点；文献定位与引用价值要说明这篇文献适合在综述中承担什么角色。",
    },
    "reproduction": {
        "title": "复现总结",
        "target_words": "1800-3200",
        "section_chars": "240-520",
        "intent": "给后续实验复现和代码阅读准备工程向清单，明确哪些信息文中没有说明。",
        "sections": ["模型结构", "数据集", "预处理", "训练/推理参数", "评价指标", "环境依赖", "关键公式逻辑", "缺失信息清单"],
        "focus": "方法、实验、表格、公式、参数、数据集、评价指标、环境；没找到就写文中未说明。",
    },
    "meeting": {
        "title": "组会汇报稿",
        "target_words": "1600-2600",
        "section_chars": "220-450",
        "intent": "生成研究生组会能直接讲的口语化稿子，按讲述顺序组织。",
        "sections": ["一分钟简介", "研究背景", "核心创新点", "方法流程", "实验结果", "局限", "对自己课题的启发", "下周计划建议"],
        "focus": "先大纲后讲述，语言自然，能直接开口讲 3-5 分钟。",
    },
}

STAGE_LABELS = {
    "idle": "等待生成",
    "extracting_context": "提取全文",
    "chunking": "分块分析",
    "analyzing_structure": "分析结构",
    "generating_summary": "生成总结",
    "checking_coverage": "校验结果",
    "completed": "完成",
    "failed": "生成失败",
}

ANNOTATION_TYPE_LABELS = {
    "highlight": "高亮",
    "underline": "下划线",
    "wavy_underline": "波浪线",
}


@dataclass
class PageText:
    page: int
    text: str


def summary_title(summary_type: str) -> str:
    return SUMMARY_TYPES.get(summary_type, SUMMARY_TYPES["overview"])["title"]


def load_available_provider(db: Session, user_id: int, provider_id: int | None = None) -> AiProvider | None:
    owned_or_system = (AiProvider.user_id == user_id) | (AiProvider.user_id.is_(None))
    if provider_id:
        provider = db.scalar(
            select(AiProvider).where(
                AiProvider.id == provider_id,
                AiProvider.is_active.is_(True),
                owned_or_system,
            )
        )
        if provider:
            return provider
    return db.scalar(
        select(AiProvider)
        .where(AiProvider.is_active.is_(True), owned_or_system)
        .order_by(AiProvider.user_id.is_(None), AiProvider.sort_order, AiProvider.id)
        .limit(1)
    )


def build_summary_response_payload(
    item: PaperSummary | None,
    summary_type: str,
    *,
    is_stale: bool = False,
    stale_message: str | None = None,
) -> dict[str, Any]:
    title = summary_title(summary_type)
    if not item:
        return {
            "type": summary_type,
            "title": title,
            "status": "idle",
            "stage": "idle",
            "progress": 0,
            "preview": "",
            "summary": None,
            "is_stale": False,
            "error_message": None,
            "updated_at": None,
            "model": "",
        }
    if is_stale and item.status != "running":
        message = stale_message or "来源内容已变化，请重新生成。"
        return {
            "type": summary_type,
            "title": title,
            "status": "idle",
            "stage": "idle",
            "progress": 0,
            "preview": message,
            "summary": None,
            "is_stale": True,
            "error_message": message,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            "model": item.model or "",
        }
    content = dict(item.content_json or {})
    content.setdefault("type", summary_type)
    content.setdefault("title", title)
    preview = str(content.get("preview") or "")
    return {
        "type": summary_type,
        "title": title,
        "status": item.status,
        "stage": item.stage or "idle",
        "progress": int(item.progress or 0),
        "preview": preview,
        "summary": content if item.status == "generated" and content else None,
        "is_stale": False,
        "error_message": item.error_message,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "model": item.model or "",
    }


def update_summary_progress(summary_id: int, *, stage: str, progress: int, status: str = "running", error: str | None = None) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        item = db.get(PaperSummary, summary_id)
        if not item:
            return
        item.status = status
        item.stage = stage
        item.progress = max(0, min(100, int(progress)))
        if error is not None:
            item.error_message = error
        db.add(item)
        db.commit()
    finally:
        db.close()


def run_paper_summary_task(summary_id: int, provider_id: int | None = None) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        item = db.get(PaperSummary, summary_id)
        if not item:
            return
        paper = db.scalar(select(Paper).where(Paper.id == item.paper_id, Paper.user_id == item.user_id))
        if not paper:
            _mark_failed(db, item, "论文不存在或无权访问。")
            return

        provider = load_available_provider(db, item.user_id, provider_id)
        if not provider:
            _mark_failed(db, item, "没有可用的 AI 厂商，请先在 AI 配置中启用一个模型。")
            return

        item.provider_id = provider.id
        item.model = provider.model
        item.error_message = None
        db.add(item)
        db.commit()

        annotations = load_annotation_context(db, paper.id, item.user_id)
        update_summary_progress(summary_id, stage="extracting_context", progress=10)

        if item.summary_type == "annotations":
            source_hash = compute_source_hash(paper, item.summary_type, [], annotations)
            if len(annotations) < 3:
                content = build_sparse_annotation_summary(item.summary_type, annotations)
                content = normalize_generated_summary(content, item.summary_type, [], annotations)
                _mark_generated(db, item, content, source_hash, provider)
                return

            api_key = decrypt_api_key(provider.encrypted_api_key)
            update_summary_progress(summary_id, stage="analyzing_structure", progress=48)
            fact_sheet = build_annotation_fact_sheet(paper, annotations)

            update_summary_progress(summary_id, stage="generating_summary", progress=72)
            content = generate_typed_summary(
                base_url=provider.base_url,
                api_key=api_key,
                model=provider.model,
                summary_type=item.summary_type,
                paper=paper,
                pages=[],
                fact_sheet=fact_sheet,
                annotations=annotations,
            )

            update_summary_progress(summary_id, stage="checking_coverage", progress=90)
            content = normalize_generated_summary(content, item.summary_type, [], annotations)
            _mark_generated(db, item, content, source_hash, provider)
            return

        pages = extract_paper_pages(db, paper)
        if item.summary_type != "annotations" and total_chars(pages) < 100:
            _mark_failed(db, item, "没有提取到足够的论文正文，请确认 PDF 文本可选择或先执行全文翻译解析。")
            return

        source_hash = compute_source_hash(paper, item.summary_type, pages, annotations)
        api_key = decrypt_api_key(provider.encrypted_api_key)
        update_summary_progress(summary_id, stage="chunking", progress=22)
        chunk_digests = build_chunk_digests(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            paper=paper,
            pages=pages,
            summary_id=summary_id,
        )

        update_summary_progress(summary_id, stage="analyzing_structure", progress=50)
        fact_sheet = build_fact_sheet(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            paper=paper,
            pages=pages,
            chunk_digests=chunk_digests,
            annotations=annotations,
        )

        update_summary_progress(summary_id, stage="generating_summary", progress=72)
        content = generate_typed_summary(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            summary_type=item.summary_type,
            paper=paper,
            pages=pages,
            fact_sheet=fact_sheet,
            annotations=annotations,
        )

        update_summary_progress(summary_id, stage="checking_coverage", progress=90)
        content = normalize_generated_summary(content, item.summary_type, pages, annotations)
        _mark_generated(db, item, content, source_hash, provider)
    except Exception as exc:
        fresh = db.get(PaperSummary, summary_id)
        if fresh:
            _mark_failed(db, fresh, f"生成失败：{exc}")
    finally:
        db.close()


def _mark_generated(db: Session, item: PaperSummary, content: dict[str, Any], source_hash: str, provider: AiProvider) -> None:
    item.status = "generated"
    item.stage = "completed"
    item.progress = 100
    item.source_hash = source_hash
    item.provider_id = provider.id
    item.model = provider.model
    item.content_json = content
    item.error_message = None
    db.add(item)
    db.commit()


def _mark_failed(db: Session, item: PaperSummary, message: str) -> None:
    item.status = "failed" if not item.content_json else "generated"
    item.stage = "failed"
    item.progress = max(0, min(100, int(item.progress or 0)))
    item.error_message = message
    db.add(item)
    db.commit()


def extract_paper_pages(db: Session, paper: Paper) -> list[PageText]:
    pages = extract_pages_with_pymupdf(paper.file_path)
    if pages:
        return pages

    translation = db.scalar(select(PaperFullTranslation).where(PaperFullTranslation.paper_id == paper.id))
    fallback: list[PageText] = []
    for page in translation.pages_json if translation else []:
        page_number = int(page.get("page_number") or len(fallback) + 1)
        blocks = page.get("blocks") or []
        text = clean_text("\n".join(str(block.get("source_text") or "") for block in blocks))
        if text:
            fallback.append(PageText(page=page_number, text=text))
    return fallback


def extract_pages_with_pymupdf(file_url: str) -> list[PageText]:
    path = resolve_paper_file(file_url)
    if not path or not path.exists():
        return []
    try:
        import fitz  # PyMuPDF
    except Exception:
        return []

    pages: list[PageText] = []
    try:
        with fitz.open(path) as document:
            for index, page in enumerate(document, start=1):
                text = clean_text(page.get_text("text") or "")
                if text:
                    pages.append(PageText(page=index, text=text))
    except Exception:
        return []
    return pages


def resolve_paper_file(file_url: str) -> Path | None:
    if not file_url:
        return None
    file_name = Path(file_url).name
    if not file_name:
        return None
    root = Path(settings.papers_upload_dir).resolve()
    candidate = root / file_name
    try:
        resolved = candidate.resolve()
    except OSError:
        return None
    if root not in resolved.parents:
        return None
    return resolved


def load_annotation_context(db: Session, paper_id: int, user_id: int) -> list[dict[str, Any]]:
    annotations = db.scalars(
        select(Annotation)
        .where(Annotation.paper_id == paper_id, Annotation.user_id == user_id)
        .order_by(Annotation.page_number, Annotation.start_char, Annotation.id)
    ).all()
    return [
        {
            "id": annotation.id,
            "page": annotation.page_number,
            "start_char": annotation.start_char,
            "end_char": annotation.end_char,
            "type": annotation.type,
            "color": annotation.color or "",
            "quote": clean_text(annotation.quote_text)[:1200],
        }
        for annotation in annotations
        if clean_text(annotation.quote_text)
    ]


def total_chars(pages: list[PageText]) -> int:
    return sum(len(page.text) for page in pages)


def compute_source_hash(paper: Paper, summary_type: str, pages: list[PageText], annotations: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    digest.update(str(paper.id).encode("utf-8"))
    digest.update(summary_type.encode("utf-8"))
    digest.update(str(paper.updated_at or "").encode("utf-8"))
    if summary_type == "annotations":
        for annotation in annotations:
            digest.update(json.dumps(annotation, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()
    for page in pages:
        digest.update(str(page.page).encode("utf-8"))
        digest.update(page.text.encode("utf-8", errors="ignore"))
    return digest.hexdigest()


def is_summary_stale(db: Session, paper: Paper, item: PaperSummary | None) -> bool:
    if not item or item.status == "running" or not item.source_hash:
        return False
    if item.summary_type == "annotations":
        annotations = load_annotation_context(db, paper.id, item.user_id)
        current_hash = compute_source_hash(paper, item.summary_type, [], annotations)
        return current_hash != item.source_hash
    return False


def stale_summary_message(summary_type: str) -> str:
    if summary_type == "annotations":
        return "标注已变化，请重新生成标注总结。"
    return "论文来源已变化，请重新生成。"


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def build_chunk_digests(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper: Paper,
    pages: list[PageText],
    summary_id: int,
) -> list[str]:
    chunks = split_pages_into_chunks(pages, max_chars=15000, max_chunks=12)
    if not chunks:
        return []
    if len(chunks) == 1 and len(chunks[0]) < 18000:
        return [chunks[0]]

    digests: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        progress = 24 + int(index / max(1, len(chunks)) * 20)
        update_summary_progress(summary_id, stage="chunking", progress=progress)
        prompt = f"""请阅读以下论文分块，生成一份高密度中文事实摘要。

要求：
1. 只记录论文里明确出现的信息，不要补充常识。
2. 保留研究问题、方法、实验、数据集、指标、结果、局限、公式/参数、页码线索。
3. 如果看到表格、实验结果、结论，请优先记录。
4. 输出 500-800 字，使用分点。

论文标题：{paper.title or paper.file_name}
分块 {index}/{len(chunks)}：
{chunk}"""
        digests.append(call_text_completion(base_url=base_url, api_key=api_key, model=model, prompt=prompt, max_tokens=1800))
    return digests


def split_pages_into_chunks(pages: list[PageText], *, max_chars: int, max_chunks: int) -> list[str]:
    all_chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for page in pages:
        page_text = f"[第 {page.page} 页]\n{page.text}\n"
        if current and current_len + len(page_text) > max_chars:
            all_chunks.append("\n".join(current))
            current = []
            current_len = 0
        current.append(page_text)
        current_len += len(page_text)
    if current:
        all_chunks.append("\n".join(current))
    if len(all_chunks) <= max_chunks:
        return all_chunks
    if max_chunks <= 4:
        return all_chunks[:max_chunks]

    selected_indices = {0, 1, len(all_chunks) - 2, len(all_chunks) - 1}
    remaining_slots = max_chunks - len(selected_indices)
    middle_start = 2
    middle_end = len(all_chunks) - 2
    if remaining_slots > 0 and middle_end > middle_start:
        step = (middle_end - middle_start) / remaining_slots
        for offset in range(remaining_slots):
            selected_indices.add(min(middle_end - 1, middle_start + int(round(offset * step))))
    return [all_chunks[index] for index in sorted(selected_indices)[:max_chunks]]


def build_fact_sheet(
    *,
    base_url: str,
    api_key: str,
    model: str,
    paper: Paper,
    pages: list[PageText],
    chunk_digests: list[str],
    annotations: list[dict[str, Any]],
) -> str:
    excerpts = build_priority_excerpts(pages, max_chars=24000)
    annotation_text = format_annotations(annotations, limit=20)
    prompt = f"""你是严谨的论文阅读助手。请基于论文分块摘要和关键页摘录，整理一份“论文事实底稿”。

底稿必须覆盖：
- 研究问题和任务场景
- 背景动机和现有方法不足
- 核心方法、模型结构、公式或关键机制
- 数据集、实验设置、评价指标、对比方法
- 主要结果和结论
- 创新点、优点、局限、未来工作
- 关键术语和可回查页码

要求：
1. 只写论文中有依据的信息。
2. 没找到的信息写“文中未说明”。
3. 以中文分点输出，尽量具体。

论文标题：{paper.title or paper.file_name}
作者：{paper.author or "文中未说明"}
关键词：{paper.keywords or "文中未说明"}

【分块摘要】
{chr(10).join(chunk_digests)}

【关键页摘录】
{excerpts}

【用户标注摘录】
{annotation_text or "暂无用户标注。"}"""
    return call_text_completion(base_url=base_url, api_key=api_key, model=model, prompt=prompt, max_tokens=5000)


def generate_typed_summary(
    *,
    base_url: str,
    api_key: str,
    model: str,
    summary_type: str,
    paper: Paper,
    pages: list[PageText],
    fact_sheet: str,
    annotations: list[dict[str, Any]],
) -> dict[str, Any]:
    config = SUMMARY_TYPES[summary_type]
    excerpts = build_priority_excerpts(pages, max_chars=16000)
    annotation_text = format_annotations(annotations, limit=60 if summary_type == "annotations" else 12)
    prompt = f"""你正在为研究生阅读器生成“{config["title"]}”。

目标：{config["intent"]}
建议字数：{config["target_words"]} 中文字。
每个正文小节建议长度：{config["section_chars"]} 中文字符。
重点上下文：{config["focus"]}
必须包含的小节：{", ".join(config["sections"])}
补充规则：{config.get("extra_rules", "按该板块用途输出具体、有证据、可复用的内容。")}

质量要求：
1. 五个板块的写法必须不同，本次只生成“{config["title"]}”。
2. highlights 是顶部速览，每条只保留一个清晰结论，20-60 个中文字符即可。
3. section.body 才是正式总结，必须有信息密度：写清对象、方法/证据、结果/含义，不能只写标题式短语。
4. 每个 section.body 按本板块建议长度展开，通常写 2-4 个短段或分点；如果一个点内容太多，拆成多个 section，不要压缩成一句话。
5. keywords 用 2-6 个短标签，突出术语、数据集、指标、创新点、局限。
6. evidence 只能逐字摘自【关键页摘录】或【用户标注】，尽量给 2-4 条候选；系统会二次核验，匹配不到原文的证据会被删除。
7. missing_items 只列“具体缺失但会影响理解、复现、验证或综述引用”的信息，例如样本区间、变量定义、数据来源、参数、显著性、稳健性、实验环境、页码证据；如果只是泛泛的后续研究问题，不要放入 missing_items；没有具体缺失就返回空数组 []。
8. followup_questions 必须是可直接拿去问 AI 或指导用户回查原文的高价值问题，写清楚“围绕什么对象、为了什么目的、希望得到什么输出”；禁止输出“XX 如何影响 YY？”这种泛泛问题。
9. assistant_panels 是研究助手价值，不是摘要复述；必须给出“证据判断、研究价值、下一步行动”三类，每类 2-4 条，条目要具体到变量、页码、模型、数据、引用场景或复现动作。
10. annotations 类型只能围绕用户当前仍存在的标注，不要把全文总结冒充标注总结；必须按高亮、下划线、波浪线分别复盘。
11. 输出必须是 JSON，不要 Markdown，不要代码块。

JSON 结构：
{{
  "type": "{summary_type}",
  "title": "{config["title"]}",
  "preview": "120 字以内总览",
  "highlights": ["最重要结论 1", "最重要结论 2", "最重要结论 3"],
  "sections": [
    {{"heading": "研究问题", "body": "正文", "keywords": ["标签"], "evidence": [{{"page": 1, "quote": "短摘录", "source_type": "paper"}}]}}
  ],
  "assistant_panels": [
    {{"title": "证据判断", "intent": "帮用户判断结论是否可靠", "items": ["回查结果表中长期/短期系数和显著性，确认核心结论是否被数据支持"]}},
    {{"title": "研究价值", "intent": "帮用户判断这篇文献怎么被使用", "items": ["可作为特定区域 FDI 决定因素研究的变量选择参考"]}},
    {{"title": "下一步行动", "intent": "给用户可执行动作", "items": ["先记录被解释变量和核心解释变量口径，再与另一篇 FDI 文献做变量对比"]}}
  ],
  "missing_items": ["文中未说明样本时间窗口，影响判断结论适用范围"],
  "followup_questions": ["请结合论文模型和结果表，解释绿色政策变量通过哪些机制影响 FDI，并区分短期与长期效应"],
  "source_note": "本总结依据..."
}}

论文标题：{paper.title or paper.file_name}

【论文事实底稿】
{fact_sheet}

【关键页摘录】
{excerpts}

【用户标注】
{annotation_text or "暂无用户标注。"}"""
    raw = call_text_completion(base_url=base_url, api_key=api_key, model=model, prompt=prompt, max_tokens=7600)
    return parse_json_object(raw)


def build_priority_excerpts(pages: list[PageText], *, max_chars: int) -> str:
    if not pages:
        return ""
    scored: list[tuple[int, PageText]] = []
    for page in pages:
        text_lower = page.text.lower()
        score = 0
        for keyword in (
            "abstract", "introduction", "method", "approach", "experiment", "evaluation",
            "result", "discussion", "conclusion", "limitation", "dataset", "ablation",
            "摘要", "引言", "方法", "实验", "结果", "结论", "局限", "数据集", "消融",
        ):
            if keyword in text_lower:
                score += 2
        if page.page <= 2 or page.page >= max(1, pages[-1].page - 1):
            score += 3
        scored.append((score, page))

    selected: list[PageText] = []
    seen: set[int] = set()
    for _score, page in sorted(scored, key=lambda item: item[0], reverse=True):
        if page.page in seen:
            continue
        selected.append(page)
        seen.add(page.page)
        if len(selected) >= 14:
            break
    selected.sort(key=lambda item: item.page)

    parts: list[str] = []
    used = 0
    for page in selected:
        remain = max_chars - used
        if remain <= 0:
            break
        snippet = page.text[: min(2200, remain)]
        parts.append(f"[第 {page.page} 页]\n{snippet}")
        used += len(snippet)
    return "\n\n".join(parts)


def format_annotations(annotations: list[dict[str, Any]], *, limit: int) -> str:
    rows = []
    for index, annotation in enumerate(annotations[:limit], start=1):
        label = ANNOTATION_TYPE_LABELS.get(str(annotation.get("type") or "highlight"), "标注")
        rows.append(f"{index}. 第 {annotation.get('page') or '?'} 页｜{label}｜{annotation.get('quote')}")
    return "\n".join(rows)


def build_annotation_fact_sheet(paper: Paper, annotations: list[dict[str, Any]]) -> str:
    groups = build_annotation_groups(annotations)
    lines = [
        f"论文标题：{paper.title or paper.file_name}",
        f"当前有效标注总数：{len(annotations)}",
        "标注总结只能基于以下当前仍存在的用户标注，不允许补写全文内容。",
    ]
    for group in groups:
        lines.append(f"\n【{group['label']}：{group['count']} 条】")
        if not group["items"]:
            lines.append("暂无。")
            continue
        for item in group["items"][:80]:
            lines.append(f"{item['index']}. 第 {item.get('page') or '?'} 页：{item.get('quote') or ''}")
    return "\n".join(lines)


def call_text_completion(*, base_url: str, api_key: str, model: str, prompt: str, max_tokens: int) -> str:
    client = OpenAI(api_key=api_key, base_url=base_url, timeout=180.0)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "你是严谨、具体、善于做研究生论文阅读总结的中文学术助手。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.25,
        max_tokens=max_tokens,
    )
    content = response.choices[0].message.content
    return content.strip() if content else ""


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = str(text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise ValueError("模型返回内容不是有效 JSON。")


def normalize_generated_summary(
    content: dict[str, Any],
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> dict[str, Any]:
    config = SUMMARY_TYPES[summary_type]
    missing_items = normalize_string_list(content.get("missing_items"), 8)
    followup_questions = normalize_string_list(content.get("followup_questions"), 6)
    annotation_groups = build_annotation_groups(annotations) if summary_type == "annotations" else []
    normalized = {
        "type": summary_type,
        "title": str(content.get("title") or config["title"]),
        "preview": str(content.get("preview") or "")[:220],
        "highlights": normalize_string_list(content.get("highlights"), 3),
        "sections": normalize_sections(content.get("sections"), config["sections"], summary_type, pages, annotations),
        "annotation_groups": annotation_groups,
        "assistant_panels": normalize_assistant_panels(content.get("assistant_panels"), summary_type),
        "missing_items": filter_missing_items(missing_items),
        "followup_questions": filter_followup_questions(followup_questions),
        "source_note": str(content.get("source_note") or f"依据 {len(pages)} 页论文文本生成，来源依据已由系统核验。"),
    }
    if summary_type == "annotations":
        normalized["source_note"] = f"依据当前 {len(annotations)} 条用户标注生成，标注清单默认折叠展示，来源依据已由系统核验。"
    if not normalized["highlights"] and normalized["sections"]:
        normalized["highlights"] = [section["body"][:80] for section in normalized["sections"][:3]]
    if not normalized["preview"] and normalized["highlights"]:
        normalized["preview"] = "；".join(normalized["highlights"])[:180]
    return normalized


def normalize_sections(
    value: Any,
    required_headings: list[str],
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sections = value if isinstance(value, list) else []
    normalized: list[dict[str, Any]] = []
    for index, section in enumerate(sections[:12]):
        if not isinstance(section, dict):
            continue
        heading = str(section.get("heading") or required_headings[min(index, len(required_headings) - 1)])
        body = str(section.get("body") or "").strip()
        if not body:
            continue
        evidence_value = section.get("evidence") if isinstance(section.get("evidence"), list) else []
        evidence = build_verified_section_evidence(
            section={**section, "heading": heading, "body": body},
            section_index=index,
            evidence_value=evidence_value,
            summary_type=summary_type,
            pages=pages,
            annotations=annotations,
        )
        normalized.append({
            "heading": heading,
            "body": body,
            "keywords": normalize_string_list(section.get("keywords"), 6),
            "evidence": evidence,
        })
    return normalized


def build_annotation_groups(annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, Any]]] = {key: [] for key in ANNOTATION_TYPE_LABELS}
    for annotation in annotations:
        annotation_type = str(annotation.get("type") or "highlight")
        if annotation_type not in buckets:
            annotation_type = "highlight"
        buckets[annotation_type].append(annotation)

    groups: list[dict[str, Any]] = []
    for annotation_type, label in ANNOTATION_TYPE_LABELS.items():
        items: list[dict[str, Any]] = []
        sorted_annotations = sorted(
            buckets[annotation_type],
            key=lambda item: (int(item.get("page") or 0), int(item.get("start_char") or 0), int(item.get("id") or 0)),
        )
        for index, annotation in enumerate(sorted_annotations, start=1):
            quote = clean_text(annotation.get("quote") or "")
            if not quote:
                continue
            items.append(
                {
                    "id": annotation.get("id"),
                    "index": index,
                    "page": annotation.get("page"),
                    "quote": quote[:800],
                    "color": str(annotation.get("color") or ""),
                    "start_char": annotation.get("start_char"),
                    "end_char": annotation.get("end_char"),
                }
            )
        groups.append(
            {
                "type": annotation_type,
                "label": label,
                "count": len(items),
                "items": items,
            }
        )
    return groups


def build_verified_section_evidence(
    *,
    section: dict[str, Any],
    section_index: int,
    evidence_value: list[Any],
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in evidence_value[:8]:
        verified = verify_evidence_item(item, summary_type=summary_type, pages=pages, annotations=annotations)
        if not verified:
            continue
        key = evidence_key(verified)
        if key in seen:
            continue
        evidence.append(verified)
        seen.add(key)
        if len(evidence) >= 4:
            return evidence

    target_count = 4
    candidates = retrieve_evidence_candidates(
        section=section,
        section_index=section_index,
        summary_type=summary_type,
        pages=pages,
        annotations=annotations,
    )
    for candidate in candidates:
        key = evidence_key(candidate)
        if key in seen:
            continue
        evidence.append(candidate)
        seen.add(key)
        if len(evidence) >= target_count:
            break
    return evidence[:4]


def verify_evidence_item(
    item: Any,
    *,
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if isinstance(item, str):
        raw = {"quote": item}
    elif isinstance(item, dict):
        raw = item
    else:
        return None

    quote = clean_text(raw.get("quote") or "")
    if len(quote) < 12:
        return None
    source_type = str(raw.get("source_type") or ("annotation" if summary_type == "annotations" else "paper"))
    annotation_id = raw.get("annotation_id")

    if source_type == "annotation" or summary_type == "annotations":
        for annotation in annotations:
            annotation_quote = clean_text(annotation.get("quote") or "")
            if annotation_id and annotation.get("id") != annotation_id:
                continue
            if normalized_match(quote, annotation_quote):
                return {
                    "page": annotation.get("page"),
                    "quote": quote[:260],
                    "source_type": "annotation",
                    "annotation_id": annotation.get("id"),
                    "start_char": annotation.get("start_char"),
                    "end_char": annotation.get("end_char"),
                }
        return None

    page_number = normalize_page_number(raw.get("page"))
    pages_to_scan = [page for page in pages if page.page == page_number] if page_number else pages
    for page in pages_to_scan:
        if normalized_match(quote, page.text):
            return {"page": page.page, "quote": quote[:260], "source_type": "paper"}
    return None


def retrieve_evidence_candidates(
    *,
    section: dict[str, Any],
    section_index: int,
    summary_type: str,
    pages: list[PageText],
    annotations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    terms = extract_evidence_terms(section)
    if summary_type == "annotations":
        candidates: list[tuple[int, int, dict[str, Any]]] = []
        for order, annotation in enumerate(annotations):
            quote = clean_text(annotation.get("quote") or "")
            if len(quote) < 12:
                continue
            score = score_text_for_terms(quote, terms)
            candidates.append(
                (
                    score,
                    -order,
                    {
                        "page": annotation.get("page"),
                        "quote": quote[:260],
                        "source_type": "annotation",
                        "annotation_id": annotation.get("id"),
                        "start_char": annotation.get("start_char"),
                        "end_char": annotation.get("end_char"),
                    },
                )
            )
        return [item for _score, _order, item in sorted(candidates, key=lambda row: (row[0], row[1]), reverse=True)]

    scored: list[tuple[int, int, dict[str, Any]]] = []
    for page in pages:
        for snippet_index, snippet in enumerate(split_source_snippets(page.text)):
            score = score_text_for_terms(snippet, terms)
            if score <= 0:
                continue
            scored.append((score, -snippet_index, {"page": page.page, "quote": snippet[:260], "source_type": "paper"}))

    if scored:
        return [item for _score, _order, item in sorted(scored, key=lambda row: (row[0], row[1]), reverse=True)]

    fallback_pages = select_priority_pages_for_evidence(pages)
    if not fallback_pages:
        return []
    offset = section_index % len(fallback_pages)
    ordered_pages = fallback_pages[offset:] + fallback_pages[:offset]
    fallback: list[dict[str, Any]] = []
    for page in ordered_pages:
        for snippet in split_source_snippets(page.text)[:2]:
            if len(snippet) >= 30:
                fallback.append({"page": page.page, "quote": snippet[:260], "source_type": "paper"})
        if len(fallback) >= 4:
            break
    return fallback


def normalize_page_number(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def evidence_key(item: dict[str, Any]) -> str:
    return f"{item.get('source_type')}:{item.get('annotation_id') or ''}:{item.get('page') or ''}:{compact_text(item.get('quote') or '')[:80]}"


def normalized_match(needle: str, haystack: str) -> bool:
    compact_needle = compact_text(needle)
    compact_haystack = compact_text(haystack)
    if not compact_needle or not compact_haystack:
        return False
    if compact_needle in compact_haystack:
        return True
    return len(compact_needle) >= 80 and compact_needle[:80] in compact_haystack


def compact_text(value: str) -> str:
    return re.sub(r"\W+", "", str(value or "").lower(), flags=re.UNICODE)


def extract_evidence_terms(section: dict[str, Any]) -> list[str]:
    keyword_text = " ".join(str(item) for item in section.get("keywords") or [])
    raw = clean_text(f"{section.get('heading') or ''} {keyword_text} {section.get('body') or ''}")
    terms = set()
    for word in re.findall(r"[A-Za-z][A-Za-z0-9_-]{3,}", raw):
        terms.add(word.lower())
    for word in re.findall(r"[\u4e00-\u9fff]{2,8}", raw):
        terms.add(word)
    return list(terms)[:32]


def score_text_for_terms(text: str, terms: list[str]) -> int:
    if not terms:
        return 0
    compact = compact_text(text)
    score = 0
    for term in terms:
        if compact_text(term) in compact:
            score += 1
    return score


def split_source_snippets(text: str) -> list[str]:
    cleaned = clean_text(text)
    if not cleaned:
        return []
    sentences = [part.strip() for part in re.split(r"(?<=[。！？.!?；;])\s+", cleaned) if part.strip()]
    if len(sentences) <= 1:
        return [cleaned[index : index + 220].strip() for index in range(0, min(len(cleaned), 1200), 220) if cleaned[index : index + 220].strip()]

    snippets: list[str] = []
    buffer = ""
    for sentence in sentences:
        next_buffer = f"{buffer} {sentence}".strip() if buffer else sentence
        if len(next_buffer) < 120:
            buffer = next_buffer
            continue
        snippets.append(next_buffer[:260])
        buffer = ""
        if len(snippets) >= 24:
            break
    if buffer and len(snippets) < 24:
        snippets.append(buffer[:260])
    return snippets


def select_priority_pages_for_evidence(pages: list[PageText]) -> list[PageText]:
    if not pages:
        return []
    scored: list[tuple[int, PageText]] = []
    for page in pages:
        text_lower = page.text.lower()
        score = 0
        for keyword in (
            "abstract", "introduction", "method", "experiment", "result", "conclusion", "limitation",
            "摘要", "引言", "方法", "实验", "结果", "结论", "局限",
        ):
            if keyword in text_lower:
                score += 2
        if page.page <= 2 or page.page >= max(1, pages[-1].page - 1):
            score += 3
        scored.append((score, page))
    selected = [page for _score, page in sorted(scored, key=lambda item: item[0], reverse=True)[:10]]
    return sorted(selected, key=lambda page: page.page)


def normalize_string_list(value: Any, limit: int) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()][:limit]
    if isinstance(value, str) and value.strip():
        return [value.strip()[:160]]
    return []


def normalize_assistant_panels(value: Any, summary_type: str) -> list[dict[str, Any]]:
    defaults = {
        "overview": [
            ("证据判断", "判断论文结论是否值得信任"),
            ("研究价值", "判断这篇论文对选题、综述或方法有什么用"),
            ("下一步行动", "给出继续深读和回查的动作"),
        ],
        "annotations": [
            ("关注点复盘", "判断用户标注集中在哪些主题"),
            ("遗漏提醒", "提示还值得补标的论文部分"),
            ("下一步行动", "把标注转成可复习、可追问的任务"),
        ],
        "review": [
            ("证据判断", "判断变量、模型和结论是否足以支撑综述引用"),
            ("引用价值", "说明这篇文献适合放进综述的哪类论证"),
            ("下一步行动", "指导用户做多篇文献横向对比"),
        ],
        "reproduction": [
            ("复现风险", "判断哪些信息会卡住复现"),
            ("工程价值", "说明哪些方法或设置值得迁移到代码实现"),
            ("最小复现步骤", "给出从数据到结果的起步动作"),
        ],
        "meeting": [
            ("讨论价值", "判断哪些点适合在组会上展开讨论"),
            ("表达重点", "提示讲述时应突出什么"),
            ("下一步行动", "把汇报落到后续阅读或实验计划"),
        ],
    }
    panels = value if isinstance(value, list) else []
    normalized: list[dict[str, Any]] = []
    for index, panel in enumerate(panels[:4]):
        if not isinstance(panel, dict):
            continue
        title = str(panel.get("title") or "").strip()
        intent = str(panel.get("intent") or "").strip()
        items = normalize_string_list(panel.get("items"), 4)
        items = [item for item in items if len(item) >= 12]
        if not title or not items:
            continue
        normalized.append({"title": title[:24], "intent": intent[:80], "items": items})
    existing_titles = {panel["title"] for panel in normalized}
    for title, intent in defaults.get(summary_type, defaults["overview"]):
        if title not in existing_titles and len(normalized) < 3:
            normalized.append({"title": title, "intent": intent, "items": []})
    return normalized[:3]


def filter_missing_items(items: list[str]) -> list[str]:
    markers = (
        "未说明", "未交代", "未给出", "未报告", "未明确", "缺少", "缺失",
        "不清楚", "无法判断", "无法确认", "需要回查", "需回查", "没有说明",
    )
    filtered: list[str] = []
    for item in items:
        text = item.strip()
        if not text:
            continue
        if any(marker in text for marker in markers):
            filtered.append(text)
    return filtered[:6]


def filter_followup_questions(items: list[str]) -> list[str]:
    banned_patterns = (
        "如何影响",
        "有什么影响",
        "具体影响",
        "情况如何",
    )
    filtered: list[str] = []
    for item in items:
        text = item.strip()
        if len(text) < 12:
            continue
        if any(pattern in text and len(text) < 28 for pattern in banned_patterns):
            continue
        filtered.append(text)
    return filtered[:4]


def build_sparse_annotation_summary(summary_type: str, annotations: list[dict[str, Any]]) -> dict[str, Any]:
    config = SUMMARY_TYPES[summary_type]
    count = len(annotations)
    quotes = [
        {
            "page": item.get("page"),
            "quote": str(item.get("quote") or "")[:220],
            "source_type": "annotation",
            "annotation_id": item.get("id"),
            "start_char": item.get("start_char"),
            "end_char": item.get("end_char"),
        }
        for item in annotations
    ]
    if count == 0:
        body = ""
        highlights: list[str] = []
        sections: list[dict[str, Any]] = []
        missing_items: list[str] = []
    else:
        body = f"当前只有 {count} 条标注，适合做轻量复盘，还不足以形成稳定主题聚类。下面先保留这些标注的共同线索。"
        highlights = [f"已有 {count} 条标注，可继续补充方法、实验和局限相关内容。"]
        sections = [
            {
                "heading": "标注数量较少",
                "body": body,
                "keywords": ["当前标注", "轻量复盘"],
                "evidence": quotes,
            }
        ]
        missing_items = ["当前标注不足 3 条，暂不生成完整主题聚类。"]
    return {
        "type": summary_type,
        "title": config["title"],
        "preview": highlights[0] if highlights else "当前没有高亮、下划线或波浪线标注。",
        "highlights": highlights,
        "sections": sections,
        "annotation_groups": build_annotation_groups(annotations),
        "assistant_panels": [
            {
                "title": "下一步行动",
                "intent": "先补充阅读痕迹，再生成更有价值的标注复盘。",
                "items": ["继续标注方法、实验结果、局限和你想引用的句子，至少积累 3 条后再重新生成。"] if count else [],
            }
        ],
        "missing_items": missing_items,
        "followup_questions": ["我还应该标注哪些段落，才能形成更完整的阅读复盘？"] if count else [],
        "source_note": f"依据当前 {count} 条用户标注生成。",
    }
