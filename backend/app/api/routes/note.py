from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Paper, PaperNotebook, PaperNoteBlock, PaperNoteNode, User
from app.schemas.note import (
    PaperNotebookListResponse,
    PaperNotebookPayload,
    PaperNotebookResponse,
    PaperNoteBlockResponse,
    PaperNoteNodeResponse,
    PaperNotesSaveRequest,
)

router = APIRouter(prefix="/papers/{paper_id}/notebooks", tags=["notes"])


def _is_persisted_id(value: int | str | None) -> bool:
    return isinstance(value, int)


def _ensure_owned_paper(paper_id: int, user: User, db: Session) -> Paper:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == user.id, Paper.deleted_at.is_(None))
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在或无权访问")
    return paper


def _select_owned_notebooks(paper_id: int, user_id: int):
    return (
        select(PaperNotebook)
        .options(selectinload(PaperNotebook.nodes).selectinload(PaperNoteNode.blocks))
        .where(PaperNotebook.paper_id == paper_id, PaperNotebook.user_id == user_id)
        .order_by(PaperNotebook.sort_order, PaperNotebook.id)
    )


def _build_block_response(block: PaperNoteBlock) -> PaperNoteBlockResponse:
    return PaperNoteBlockResponse(
        id=block.id,
        type=block.type,
        content=block.content or "",
        image_url=block.image_url,
        page_number=block.page_number,
        start_char=block.start_char,
        end_char=block.end_char,
        context_before=block.context_before or "",
        context_after=block.context_after or "",
        sort_order=block.sort_order,
    )


def _build_node_response(node: PaperNoteNode) -> PaperNoteNodeResponse:
    return PaperNoteNodeResponse(
        id=node.id,
        parent_id=node.parent_id,
        level=node.level,
        title=node.title,
        color_index=node.color_index,
        sort_order=node.sort_order,
        collapsed=node.collapsed,
        blocks=[_build_block_response(block) for block in sorted(node.blocks, key=lambda item: (item.sort_order, item.id))],
    )


def _build_notebook_response(notebook: PaperNotebook) -> PaperNotebookResponse:
    return PaperNotebookResponse(
        id=notebook.id,
        title=notebook.title,
        template_type=notebook.template_type,
        sort_order=notebook.sort_order,
        collapsed=notebook.collapsed,
        nodes=[_build_node_response(node) for node in sorted(notebook.nodes, key=lambda item: (item.sort_order, item.id))],
    )


@router.get("", response_model=PaperNotebookListResponse)
def list_notebooks(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperNotebookListResponse:
    _ensure_owned_paper(paper_id, user, db)
    notebooks = db.scalars(_select_owned_notebooks(paper_id, user.id)).all()
    return PaperNotebookListResponse(notebooks=[_build_notebook_response(notebook) for notebook in notebooks])


def _save_notebook_tree(
    db: Session,
    paper_id: int,
    user_id: int,
    payload: PaperNotebookPayload,
    notebook_map: dict[int, PaperNotebook],
) -> PaperNotebook:
    if _is_persisted_id(payload.id) and payload.id in notebook_map:
        notebook = notebook_map[payload.id]
    else:
        notebook = PaperNotebook(user_id=user_id, paper_id=paper_id)
        db.add(notebook)
        db.flush()

    notebook.title = payload.title
    notebook.template_type = payload.template_type
    notebook.sort_order = payload.sort_order
    notebook.collapsed = payload.collapsed
    db.add(notebook)
    db.flush()

    existing_nodes = {node.id: node for node in notebook.nodes}
    kept_node_ids: set[int] = set()
    node_id_remap: dict[int | str, int] = {}
    pending_nodes = list(payload.nodes)

    while pending_nodes:
        made_progress = False
        next_pending = []
        for node_payload in pending_nodes:
            if node_payload.parent_id and node_payload.parent_id not in node_id_remap:
                next_pending.append(node_payload)
                continue

            mapped_parent_id = node_payload.parent_id
            if mapped_parent_id in node_id_remap:
                mapped_parent_id = node_id_remap[mapped_parent_id]

            if _is_persisted_id(node_payload.id) and node_payload.id in existing_nodes:
                node = existing_nodes[node_payload.id]
            else:
                node = PaperNoteNode(notebook_id=notebook.id)
                db.add(node)
                db.flush()

            node.notebook_id = notebook.id
            node.parent_id = mapped_parent_id
            node.level = node_payload.level
            node.title = node_payload.title
            node.color_index = node_payload.color_index
            node.sort_order = node_payload.sort_order
            node.collapsed = node_payload.collapsed
            db.add(node)
            db.flush()

            kept_node_ids.add(node.id)
            if node_payload.id is not None:
                node_id_remap[node_payload.id] = node.id

            existing_blocks = {block.id: block for block in node.blocks}
            kept_block_ids: set[int] = set()
            for block_payload in node_payload.blocks:
                if _is_persisted_id(block_payload.id) and block_payload.id in existing_blocks:
                    block = existing_blocks[block_payload.id]
                else:
                    block = PaperNoteBlock(node_id=node.id)
                    db.add(block)
                    db.flush()

                block.node_id = node.id
                block.type = block_payload.type
                block.content = block_payload.content
                block.image_url = block_payload.image_url
                block.page_number = block_payload.page_number
                block.start_char = block_payload.start_char
                block.end_char = block_payload.end_char
                block.context_before = block_payload.context_before
                block.context_after = block_payload.context_after
                block.sort_order = block_payload.sort_order
                db.add(block)
                db.flush()
                kept_block_ids.add(block.id)

            for block in list(node.blocks):
                if block.id not in kept_block_ids:
                    db.delete(block)

            made_progress = True

        if not made_progress:
            raise HTTPException(status_code=400, detail="Invalid note tree parent references")

        pending_nodes = next_pending

    for node in list(notebook.nodes):
        if node.id not in kept_node_ids:
            db.delete(node)

    return notebook


@router.post("/save", response_model=PaperNotebookListResponse)
def save_notebooks(
    paper_id: int,
    payload: PaperNotesSaveRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperNotebookListResponse:
    _ensure_owned_paper(paper_id, user, db)
    existing_notebooks = db.scalars(
        select(PaperNotebook)
        .where(PaperNotebook.paper_id == paper_id, PaperNotebook.user_id == user.id)
    ).all()
    notebook_map = {notebook.id: notebook for notebook in existing_notebooks}
    kept_notebook_ids: set[int] = set()

    for notebook_payload in payload.notebooks:
        notebook = _save_notebook_tree(
            db=db,
            paper_id=paper_id,
            user_id=user.id,
            payload=notebook_payload,
            notebook_map=notebook_map,
        )
        kept_notebook_ids.add(notebook.id)

    for notebook in existing_notebooks:
        if notebook.id not in kept_notebook_ids:
            db.delete(notebook)

    db.commit()
    db.expire_all()

    notebooks = db.scalars(_select_owned_notebooks(paper_id, user.id)).all()
    return PaperNotebookListResponse(notebooks=[_build_notebook_response(notebook) for notebook in notebooks])
