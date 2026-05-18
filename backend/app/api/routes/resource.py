from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import (
    Annotation,
    Folder,
    Paper,
    PaperFullTranslation,
    PaperNotebook,
    PaperNoteBlock,
    PaperNoteNode,
    PaperResourceLayout,
    PaperSummary,
    ShapeAnnotation,
    User,
)
from app.schemas.resource import ResourceLayoutPayload, ResourceLayoutResponse
from app.services.annotation_metrics import count_effective_annotations
from app.services.paper_summary import is_summary_stale

router = APIRouter(prefix="/resources", tags=["resources"])


RESOURCE_META: dict[str, dict[str, str]] = {
    "translation": {
        "label": "全篇翻译",
        "color": "#2563EB",
        "preview": "已完成全文翻译，可进入阅读器查看双语内容。",
    },
    "annotations": {
        "label": "原文标注",
        "color": "#EF4444",
        "preview": "包含当前保留的高亮、下划线或波浪线标注。",
    },
    "summary_overview": {
        "label": "整篇总结",
        "color": "#0891B2",
        "preview": "论文主线、方法、实验、结论和局限。",
    },
    "summary_annotations": {
        "label": "标注总结",
        "color": "#16A34A",
        "preview": "围绕当前标注形成的主题复盘。",
    },
    "summary_review": {
        "label": "综述卡片",
        "color": "#7C3AED",
        "preview": "变量指标、核心发现、创新局限和引用价值。",
    },
    "summary_reproduction": {
        "label": "复现总结",
        "color": "#F59E0B",
        "preview": "数据集、参数、公式、指标、环境和缺失项。",
    },
    "summary_meeting": {
        "label": "组会稿",
        "color": "#DB2777",
        "preview": "适合组会讲述的结构化汇报材料。",
    },
    "notes": {
        "label": "笔记",
        "color": "#CA8A04",
        "preview": "阅读过程中沉淀的摘录、截图和文字笔记。",
    },
}

SUMMARY_RESOURCE_TYPES = {
    "overview": "summary_overview",
    "annotations": "summary_annotations",
    "review": "summary_review",
    "reproduction": "summary_reproduction",
    "meeting": "summary_meeting",
}

RESOURCE_ORDER = list(RESOURCE_META)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _resource(
    resource_type: str,
    *,
    count: int = 1,
    updated_at: datetime | None = None,
    preview: str = "",
    status: str = "ready",
) -> dict[str, Any]:
    meta = RESOURCE_META[resource_type]
    return {
        "type": resource_type,
        "label": meta["label"],
        "color": meta["color"],
        "count": count,
        "status": status,
        "preview": preview or meta["preview"],
        "updated_at": _iso(updated_at),
    }


def _layout_response(layout: PaperResourceLayout) -> dict[str, float]:
    return {
        "x_pct": float(layout.x_pct),
        "y_pct": float(layout.y_pct),
        "rotation_deg": float(layout.rotation_deg or 0),
    }


def _max_datetime(*values: datetime | None) -> datetime | None:
    available = [value for value in values if value is not None]
    return max(available) if available else None


@router.get("/overview")
def get_resource_overview(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    papers = db.scalars(
        select(Paper)
        .where(Paper.user_id == current_user.id, Paper.deleted_at.is_(None))
        .order_by(Paper.last_viewed_at.desc(), Paper.created_at.desc())
    ).all()
    if not papers:
        return {
            "stats": {
                "resource_paper_count": 0,
                "resource_count": 0,
                "translation_count": 0,
                "annotation_count": 0,
                "note_count": 0,
                "summary_count": 0,
            },
            "papers": [],
        }

    paper_ids = [paper.id for paper in papers]
    paper_by_id = {paper.id: paper for paper in papers}
    resources_by_paper: dict[int, list[dict[str, Any]]] = {paper.id: [] for paper in papers}
    layout_rows = db.scalars(
        select(PaperResourceLayout).where(
            PaperResourceLayout.user_id == current_user.id,
            PaperResourceLayout.paper_id.in_(paper_ids),
        )
    ).all()
    layouts_by_resource = {
        (layout.paper_id, layout.resource_type): _layout_response(layout)
        for layout in layout_rows
    }

    folder_ids = {paper.folder_id for paper in papers if paper.folder_id}
    folders = db.scalars(select(Folder).where(Folder.id.in_(folder_ids))).all() if folder_ids else []
    folder_names = {folder.id: folder.name for folder in folders}

    translation_rows = db.scalars(
        select(PaperFullTranslation)
        .join(Paper, Paper.id == PaperFullTranslation.paper_id)
        .where(
            Paper.user_id == current_user.id,
            PaperFullTranslation.paper_id.in_(paper_ids),
            PaperFullTranslation.status == "completed",
        )
    ).all()
    for item in translation_rows:
        resources_by_paper[item.paper_id].append(
            _resource("translation", updated_at=item.updated_at)
        )

    annotation_rows = db.execute(
        select(
            Annotation.paper_id,
            func.max(Annotation.created_at),
        )
        .where(
            Annotation.user_id == current_user.id,
            Annotation.paper_id.in_(paper_ids),
        )
        .group_by(Annotation.paper_id)
    ).all()
    annotation_items = db.scalars(
        select(Annotation).where(
            Annotation.user_id == current_user.id,
            Annotation.paper_id.in_(paper_ids),
        )
    ).all()
    annotation_by_paper: dict[int, list[Annotation]] = {}
    for annotation in annotation_items:
        annotation_by_paper.setdefault(int(annotation.paper_id), []).append(annotation)
    total_annotations = 0
    for paper_id, updated_at in annotation_rows:
        effective_count = count_effective_annotations(annotation_by_paper.get(int(paper_id), []))
        if effective_count <= 0:
            continue
        total_annotations += effective_count
        resources_by_paper[int(paper_id)].append(
            _resource(
                "annotations",
                count=effective_count,
                updated_at=updated_at,
                preview=f"当前保留 {effective_count} 条原文标注。",
            )
        )

    shape_annotation_rows = db.execute(
        select(
            ShapeAnnotation.paper_id,
            func.count(ShapeAnnotation.id),
            func.max(ShapeAnnotation.updated_at),
        )
        .where(
            ShapeAnnotation.user_id == current_user.id,
            ShapeAnnotation.paper_id.in_(paper_ids),
        )
        .group_by(ShapeAnnotation.paper_id)
    ).all()
    for paper_id, shape_count, updated_at in shape_annotation_rows:
        shape_count = int(shape_count or 0)
        if shape_count <= 0:
            continue
        total_annotations += shape_count
        existing_annotation_resource = next(
            (item for item in resources_by_paper[int(paper_id)] if item["type"] == "annotations"),
            None,
        )
        if existing_annotation_resource:
            existing_annotation_resource["count"] = int(existing_annotation_resource.get("count", 0)) + shape_count
            parsed_current_updated_at = None
            current_updated_at = existing_annotation_resource.get("updated_at")
            if current_updated_at:
                try:
                    parsed_current_updated_at = datetime.fromisoformat(current_updated_at)
                except ValueError:
                    parsed_current_updated_at = None
            existing_annotation_resource["updated_at"] = _iso(
                _max_datetime(updated_at, parsed_current_updated_at)
            )
            existing_annotation_resource["preview"] = f"褰撳墠淇濈暀 {existing_annotation_resource['count']} 鏉℃爣娉ㄣ€?"
            continue
        resources_by_paper[int(paper_id)].append(
            _resource(
                "annotations",
                count=shape_count,
                updated_at=updated_at,
                preview=f"褰撳墠淇濈暀 {shape_count} 鏉℃爣娉ㄣ€?",
            )
        )

    note_rows = db.execute(
        select(
            PaperNotebook.paper_id,
            func.count(func.distinct(PaperNotebook.id)),
            func.count(PaperNoteBlock.id),
            func.max(func.coalesce(PaperNoteBlock.updated_at, PaperNoteNode.updated_at, PaperNotebook.updated_at)),
        )
        .join(PaperNoteNode, PaperNoteNode.notebook_id == PaperNotebook.id, isouter=True)
        .join(PaperNoteBlock, PaperNoteBlock.node_id == PaperNoteNode.id, isouter=True)
        .where(
            PaperNotebook.user_id == current_user.id,
            PaperNotebook.paper_id.in_(paper_ids),
        )
        .group_by(PaperNotebook.paper_id)
    ).all()
    total_notes = 0
    for paper_id, notebook_count, block_count, updated_at in note_rows:
        notebook_count = int(notebook_count or 0)
        block_count = int(block_count or 0)
        if notebook_count <= 0:
            continue
        display_count = block_count or notebook_count
        total_notes += display_count
        preview = f"已有 {notebook_count} 个笔记本"
        if block_count:
            preview += f"，{block_count} 个内容块"
        preview += "。"
        resources_by_paper[int(paper_id)].append(
            _resource("notes", count=display_count, updated_at=updated_at, preview=preview)
        )

    summary_count = 0
    summaries = db.scalars(
        select(PaperSummary)
        .where(
            PaperSummary.user_id == current_user.id,
            PaperSummary.paper_id.in_(paper_ids),
            PaperSummary.status == "generated",
        )
    ).all()
    for item in summaries:
        resource_type = SUMMARY_RESOURCE_TYPES.get(item.summary_type)
        paper = paper_by_id.get(item.paper_id)
        if not resource_type or not paper:
            continue
        content = item.content_json if isinstance(item.content_json, dict) else {}
        preview = str(content.get("preview") or RESOURCE_META[resource_type]["preview"])
        status = "stale" if is_summary_stale(db, paper, item) else "ready"
        if status == "stale":
            preview = f"内容可能需更新：{preview}"
        summary_count += 1
        resources_by_paper[item.paper_id].append(
            _resource(resource_type, updated_at=item.updated_at, preview=preview[:120], status=status)
        )

    items: list[dict[str, Any]] = []
    resource_count = 0
    translation_count = len(translation_rows)
    for paper in papers:
        resources = sorted(
            resources_by_paper.get(paper.id, []),
            key=lambda item: RESOURCE_ORDER.index(item["type"]) if item["type"] in RESOURCE_ORDER else 99,
        )
        if not resources:
            continue
        for resource in resources:
            layout = layouts_by_resource.get((paper.id, resource["type"]))
            if layout:
                resource["layout"] = layout
        resource_count += len(resources)
        latest_resource_at = None
        for resource in resources:
            raw = resource.get("updated_at")
            try:
                parsed = datetime.fromisoformat(raw) if raw else None
            except ValueError:
                parsed = None
            latest_resource_at = _max_datetime(latest_resource_at, parsed)
        items.append({
            "paper_id": paper.id,
            "title": paper.title or paper.file_name,
            "file_name": paper.file_name,
            "author": paper.author or "",
            "folder_id": paper.folder_id,
            "folder_name": folder_names.get(paper.folder_id, "未分类"),
            "page_count": paper.page_count or 0,
            "updated_at": _iso(latest_resource_at or paper.updated_at),
            "resources": resources,
        })

    return {
        "stats": {
            "resource_paper_count": len(items),
            "resource_count": resource_count,
            "translation_count": translation_count,
            "annotation_count": total_annotations,
            "note_count": total_notes,
            "summary_count": summary_count,
        },
        "papers": items,
    }


@router.put("/{paper_id}/layout", response_model=ResourceLayoutResponse)
def save_resource_layout(
    paper_id: int,
    payload: ResourceLayoutPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if payload.resource_type not in RESOURCE_META:
        raise HTTPException(status_code=400, detail="未知资源类型")

    paper = db.scalar(
        select(Paper).where(
            Paper.id == paper_id,
            Paper.user_id == current_user.id,
            Paper.deleted_at.is_(None),
        )
    )
    if not paper:
        raise HTTPException(status_code=404, detail="文献不存在")

    layout = db.scalar(
        select(PaperResourceLayout).where(
            PaperResourceLayout.user_id == current_user.id,
            PaperResourceLayout.paper_id == paper_id,
            PaperResourceLayout.resource_type == payload.resource_type,
        )
    )
    if layout is None:
        layout = PaperResourceLayout(
            user_id=current_user.id,
            paper_id=paper_id,
            resource_type=payload.resource_type,
        )
        db.add(layout)

    layout.x_pct = payload.x_pct
    layout.y_pct = payload.y_pct
    layout.rotation_deg = payload.rotation_deg
    db.commit()
    db.refresh(layout)
    return {
        "resource_type": layout.resource_type,
        **_layout_response(layout),
    }
