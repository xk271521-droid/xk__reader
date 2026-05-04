from __future__ import annotations

from pathlib import Path
from time import time_ns
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select, update as sql_update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import Folder, Paper, User
from app.schemas.paper import (
    FolderCreate,
    FolderResponse,
    FolderUpdate,
    PaperMetadata,
    PaperResponse,
    PaperUpdate,
)
from app.services.translate import translate_title

router = APIRouter(prefix="/papers", tags=["papers"])

ALLOWED_PDF_TYPES = {"application/pdf"}


def build_folder_response(folder: Folder) -> FolderResponse:
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        created_at=folder.created_at.isoformat() if folder.created_at else None,
    )


def build_paper_response(paper: Paper) -> PaperResponse:
    return PaperResponse(
        id=paper.id,
        folder_id=paper.folder_id,
        file_name=paper.file_name,
        file_size=paper.file_size,
        title=paper.title or "",
        translated_title=paper.translated_title,
        author=paper.author,
        subject=paper.subject,
        keywords=paper.keywords,
        creator=paper.creator,
        producer=paper.producer,
        creation_date=paper.creation_date,
        modification_date=paper.modification_date,
        doi=paper.doi,
        page_count=paper.page_count,
        last_viewed_at=paper.last_viewed_at.isoformat() if paper.last_viewed_at else None,
        created_at=paper.created_at.isoformat() if paper.created_at else None,
    )


# ── Folders ──────────────────────────────────────────────


@router.get("/folders", response_model=list[FolderResponse])
def list_folders(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[FolderResponse]:
    folders = db.scalars(
        select(Folder).where(Folder.user_id == current_user.id).order_by(Folder.id)
    ).all()

    # 确保老用户也有"未分类"文件夹
    if not any(f.name == "未分类" for f in folders):
        uncategorized = Folder(user_id=current_user.id, name="未分类")
        db.add(uncategorized)
        db.commit()
        db.refresh(uncategorized)
        folders = [uncategorized] + list(folders)

    return [build_folder_response(f) for f in folders]


@router.post("/folders", response_model=FolderResponse)
def create_folder(
    payload: FolderCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FolderResponse:
    existing = db.scalar(
        select(Folder).where(
            Folder.user_id == current_user.id,
            Folder.name == payload.name,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="已有同名文件夹。")

    folder = Folder(user_id=current_user.id, name=payload.name)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return build_folder_response(folder)


@router.patch("/folders/{folder_id}", response_model=FolderResponse)
def rename_folder(
    folder_id: int,
    payload: FolderUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FolderResponse:
    folder = db.scalar(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在。")

    if folder.name == "未分类":
        raise HTTPException(status_code=403, detail="未分类文件夹不可修改。")

    # 检查同名
    if payload.name != folder.name:
        existing = db.scalar(
            select(Folder).where(
                Folder.user_id == current_user.id,
                Folder.name == payload.name,
            )
        )
        if existing:
            raise HTTPException(status_code=409, detail="已有同名文件夹。")

    folder.name = payload.name
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return build_folder_response(folder)


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_folder(
    folder_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    folder = db.scalar(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在。")

    if folder.name == "未分类":
        raise HTTPException(status_code=403, detail="未分类文件夹不可删除。")

    # 将该文件夹下的论文移到用户的"未分类"文件夹
    uncategorized = db.scalar(
        select(Folder).where(
            Folder.user_id == current_user.id,
            Folder.name == "未分类",
        )
    )
    if uncategorized:
        db.execute(
            sql_update(Paper).where(Paper.folder_id == folder_id).values(folder_id=uncategorized.id)
        )

    db.delete(folder)
    db.commit()


# ── Papers ───────────────────────────────────────────────


@router.get("/references")
def get_references(doi: str = ""):
    """通过多个 API 获取参考文献"""
    if not doi:
        return {"references": [], "source": ""}

    from urllib.request import Request, urlopen
    from urllib.parse import quote

    def try_crossref():
        url = f"https://api.crossref.org/works/{doi}"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        raw = (data.get("message") or {}).get("reference") or []
        if not raw:
            return None
        refs = []
        for r in raw:
            refs.append({
                "title": r.get("article-title") or r.get("unstructured") or "",
                "authors": r.get("author", ""),
                "year": r.get("year"),
                "journal": r.get("journal-title", ""),
                "doi": r.get("DOI", ""),
            })
        return (refs, f"Crossref ({len(raw)} 条)")

    def try_semantic_scholar():
        url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=paperId"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        paper_id = __import__("json").loads(resp.read()).get("paperId")
        if not paper_id:
            return None
        url2 = f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}/references?limit=1000&fields=title,authors,year,journal,externalIds"
        req2 = Request(url2, headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=8)
        data = __import__("json").loads(resp2.read())
        raw = data.get("data") or []
        if not raw:
            return None
        refs = []
        for r in raw:
            p = r.get("citedPaper") or {}
            authors = p.get("authors") or []
            author_str = ", ".join(a.get("name", "") for a in authors[:3])
            if len(authors) > 3:
                author_str += " et al."
            refs.append({
                "title": p.get("title", ""),
                "authors": author_str,
                "year": p.get("year"),
                "journal": (p.get("journal") or {}).get("name") if p.get("journal") else "",
                "doi": (p.get("externalIds") or {}).get("DOI", ""),
            })
        return (refs, f"Semantic Scholar ({len(raw)} 条)")

    def try_openalex():
        import ssl
        ctx = ssl._create_unverified_context()
        url = f"https://api.openalex.org/works/doi:{doi}"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        ref_ids = data.get("referenced_works") or []
        if not ref_ids:
            return None
        batch = ref_ids[:50]
        batch_str = "|".join(b.rsplit("/", 1)[-1] for b in batch)
        url2 = "https://api.openalex.org/works?filter=" + quote("openalex_id:" + batch_str) + "&per_page=100"
        req2 = Request(url2, headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=10)
        data2 = __import__("json").loads(resp2.read())
        refs = []
        for r in data2.get("results") or []:
            refs.append({
                "title": r.get("title", ""),
                "authors": ", ".join(
                    (a.get("author") or {}).get("display_name", "")
                    for a in (r.get("authorships") or [])[:3]
                ),
                "year": r.get("publication_year"),
                "journal": ((r.get("primary_location") or {}).get("source") or {}).get("display_name", ""),
                "doi": (r.get("doi") or "").replace("https://doi.org/", ""),
            })
        return (refs, f"OpenAlex ({len(raw)} 条)")

    for fn in (try_crossref, try_semantic_scholar, try_openalex):
        try:
            result = fn()
            if result:
                return {"references": result[0], "source": result[1]}
        except Exception:
            continue

    return {"references": [], "source": "所有来源均无数据"}


@router.get("/citations")
def get_citations(doi: str = ""):
    """获取引用该论文的其他论文"""
    if not doi:
        return {"citations": [], "source": ""}

    from urllib.request import Request, urlopen
    from urllib.parse import quote

    def try_openalex():
        import ssl
        ctx = ssl._create_unverified_context()
        url = f"https://api.openalex.org/works/doi:{doi}"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        count = data.get("cited_by_count", 0)
        oid = data.get("id", "").rsplit("/", 1)[-1]
        if not oid:
            return None
        req2 = Request("https://api.openalex.org/works?filter=" + quote("cites:" + oid) + "&per_page=100", headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=10)
        data2 = __import__("json").loads(resp2.read())
        refs = []
        for r in data2.get("results") or []:
            refs.append({
                "title": r.get("title", ""),
                "authors": ", ".join(
                    a.get("author", {}).get("display_name", "")
                    for a in (r.get("authorships") or [])[:3]
                ),
                "year": r.get("publication_year"),
                "journal": (r.get("primary_location") or {}).get("source", {}).get("display_name", ""),
                "doi": r.get("doi", "").replace("https://doi.org/", ""),
            })
        return (refs, f"OpenAlex (共被引 {count} 次)")

    def try_semantic_scholar():
        url = f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=paperId,citationCount"
        req = Request(url, headers={"Accept": "application/json"})
        resp = urlopen(req, timeout=8)
        data = __import__("json").loads(resp.read())
        paper_id = data.get("paperId")
        count = data.get("citationCount", 0)
        if not paper_id:
            return None
        url2 = f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}/citations?limit=100&fields=title,authors,year,journal,externalIds"
        req2 = Request(url2, headers={"Accept": "application/json"})
        resp2 = urlopen(req2, timeout=8)
        raw = __import__("json").loads(resp2.read()).get("data") or []
        if not raw:
            return None
        refs = []
        for r in raw:
            p = r.get("citingPaper") or {}
            authors = p.get("authors") or []
            author_str = ", ".join(a.get("name", "") for a in authors[:3])
            if len(authors) > 3:
                author_str += " et al."
            refs.append({
                "title": p.get("title", ""),
                "authors": author_str,
                "year": p.get("year"),
                "journal": (p.get("journal") or {}).get("name") if p.get("journal") else "",
                "doi": (p.get("externalIds") or {}).get("DOI", ""),
            })
        return (refs, f"Semantic Scholar (共被引 {count} 次)")

    for name, fn in [("S2", try_semantic_scholar), ("OA", try_openalex)]:
        try:
            result = fn()
            if result:
                return {"citations": result[0], "source": result[1]}
        except Exception as e:
            import traceback
            traceback.print_exc()

    return {"citations": [], "source": "暂无引用数据"}


@router.get("", response_model=list[PaperResponse])
def list_papers(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    folder_id: int | None = None,
) -> list[PaperResponse]:
    query = select(Paper).where(Paper.user_id == current_user.id)
    if folder_id is not None:
        query = query.where(Paper.folder_id == folder_id)
    papers = db.scalars(query.order_by(Paper.last_viewed_at.desc(), Paper.created_at.desc())).all()
    return [build_paper_response(p) for p in papers]


@router.post("", response_model=PaperResponse)
async def upload_paper(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    metadata_json: str = Form(""),
    folder_id: int | None = Form(None),
):
    if file.content_type not in ALLOWED_PDF_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 PDF 格式。")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空。")

    # 解析 metadata（前端传的 JSON 字符串）
    meta = PaperMetadata()
    if metadata_json.strip():
        try:
            import json
            meta_data = json.loads(metadata_json)
            meta = PaperMetadata(**meta_data)
        except Exception:
            pass

    # 确定目标文件夹
    target_folder_id = folder_id if folder_id is not None else _get_uncategorized_id(db, current_user.id)
    if target_folder_id is not None:
        target = db.scalar(
            select(Folder).where(Folder.id == target_folder_id, Folder.user_id == current_user.id)
        )
        if not target:
            target_folder_id = _get_uncategorized_id(db, current_user.id)

    # 保存文件到磁盘
    papers_dir = Path(settings.papers_upload_dir)
    papers_dir.mkdir(parents=True, exist_ok=True)

    suffix = ".pdf"
    file_name_on_disk = f"{current_user.uid}_{time_ns() // 1_000_000}{suffix}"
    file_path = papers_dir / file_name_on_disk
    file_path.write_bytes(content)

    file_url = f"/uploads/papers/{file_name_on_disk}"

    paper = Paper(
        user_id=current_user.id,
        folder_id=target_folder_id,
        file_name=file.filename or "untitled.pdf",
        file_path=file_url,
        file_size=f"{len(content)}",
        title=meta.title or (file.filename or "").replace(".pdf", ""),
        author=meta.author,
        subject=meta.subject,
        keywords=meta.keywords,
        creator=meta.creator,
        producer=meta.producer,
        creation_date=meta.creation_date,
        modification_date=meta.modification_date,
        doi=meta.doi,
        page_count=meta.page_count,
        last_viewed_at=datetime.now(timezone.utc),
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)

    # 自动翻译标题为中文
    discipline = current_user.profile.discipline if current_user.profile else ""
    try:
        translated = translate_title(paper.title, discipline)
        with open("translate_debug.log", "a", encoding="utf-8") as f:
            f.write(f"title={paper.title}\ndiscipline={discipline}\ntranslated={translated}\n---\n")
    except Exception as e:
        with open("translate_debug.log", "a", encoding="utf-8") as f:
            f.write(f"ERROR: {e}\n---\n")
        translated = None
    if translated:
        paper.translated_title = translated
        db.add(paper)
        db.commit()
        db.refresh(paper)

    return build_paper_response(paper)


@router.get("/{paper_id}", response_model=PaperResponse)
def get_paper(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperResponse:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")
    return build_paper_response(paper)


@router.get("/{paper_id}/file")
async def get_paper_file(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    actual_file = _resolve_paper_file(paper.file_path)
    if not actual_file or not actual_file.exists():
        raise HTTPException(status_code=404, detail="论文文件已丢失。")

    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(actual_file),
        filename=paper.file_name,
        media_type="application/pdf",
    )


@router.patch("/{paper_id}", response_model=PaperResponse)
def update_paper(
    paper_id: int,
    payload: PaperUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperResponse:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    if payload.folder_id is not None:
        # 验证目标文件夹属于当前用户
        target = db.scalar(
            select(Folder).where(Folder.id == payload.folder_id, Folder.user_id == current_user.id)
        )
        if not target:
            raise HTTPException(status_code=400, detail="目标文件夹不存在。")
        paper.folder_id = payload.folder_id

    if payload.last_viewed_at:
        paper.last_viewed_at = datetime.now(timezone.utc)

    if payload.title is not None:
        paper.title = payload.title
    if payload.translated_title is not None:
        paper.translated_title = payload.translated_title
    if payload.author is not None:
        paper.author = payload.author
    if payload.subject is not None:
        paper.subject = payload.subject
    if payload.keywords is not None:
        paper.keywords = payload.keywords
    if payload.doi is not None:
        paper.doi = payload.doi
    if payload.page_count is not None:
        paper.page_count = payload.page_count

    db.add(paper)
    db.commit()
    db.refresh(paper)
    return build_paper_response(paper)


@router.delete("/{paper_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_paper(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == current_user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    # 删除磁盘文件
    actual_file = _resolve_paper_file(paper.file_path)
    if actual_file and actual_file.exists():
        try:
            actual_file.unlink()
        except OSError:
            pass

    db.delete(paper)
    db.commit()


# ── References / Citations ────────────────────────────────


# ── Helpers ──────────────────────────────────────────────


def _get_uncategorized_id(db: Session, user_id: int) -> int:
    folder = db.scalar(
        select(Folder).where(Folder.user_id == user_id, Folder.name == "未分类")
    )
    if folder:
        return folder.id
    # 兜底：如果不存在则创建
    new_folder = Folder(user_id=user_id, name="未分类")
    db.add(new_folder)
    db.flush()
    return new_folder.id


def _resolve_paper_file(file_url: str) -> Path | None:
    """从 URL 路径解析出实际的磁盘文件路径"""
    if not file_url:
        return None
    file_name = Path(file_url).name
    if not file_name:
        return None
    candidate = Path(settings.papers_upload_dir) / file_name
    root = Path(settings.papers_upload_dir).resolve()
    try:
        resolved = candidate.resolve()
    except OSError:
        return None
    if root not in resolved.parents:
        return None
    return resolved
