"""Server-side full-PDF translation helpers.

PDFMathTranslate/BabelDOC owns parsing, translation and PDF reconstruction.  The
API deliberately invokes a separately configured command instead of importing
the package: production currently uses a Python 3.10 backend while current
PDFMathTranslate requires a Python 3.11/3.12 runtime.
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from time import time

from app.core.config import settings
from app.services.oss_storage import (
    download_file as download_oss_file,
    full_translation_object_key,
    paper_object_key,
)


class PdfMathTranslateError(RuntimeError):
    """Raised when the external PDF translation runtime cannot deliver a PDF."""


@dataclass(frozen=True)
class PdfMathTranslateProvider:
    """A non-persistent snapshot of the user's active global AI provider."""

    provider_id: int
    label: str
    base_url: str
    api_key: str
    model: str


@dataclass(frozen=True)
class PdfMathTranslateResult:
    output_pdf: Path
    summary: dict[str, object]


def service_for_provider(provider: PdfMathTranslateProvider) -> str:
    """Choose PDFMathTranslate's adapter from the global provider endpoint."""
    endpoint = provider.base_url.strip().rstrip("/").lower()
    if "api.deepseek.com" in endpoint:
        return "deepseek"
    if "open.bigmodel.cn" in endpoint:
        return "zhipu"
    # User-created global providers use the generic OpenAI-compatible adapter.
    return "openailiked"


def sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_child(root: Path, value: str) -> Path | None:
    candidate = root / value
    try:
        resolved_root = root.resolve()
        resolved = candidate.resolve()
    except OSError:
        return None
    if resolved_root not in resolved.parents and resolved != resolved_root:
        return None
    return resolved


def resolve_paper_source(file_url: str) -> Path | None:
    """Resolve an uploaded original PDF, restoring it from OSS when necessary."""
    file_name = Path(file_url or "").name
    if not file_name:
        return None
    root = Path(settings.papers_upload_dir)
    source = _safe_child(root, file_name)
    if not source:
        return None
    if not source.exists():
        download_oss_file(paper_object_key(file_url), source)
    return source if source.exists() else None


def translation_artifact_file(artifact_path: str | None, *, restore_from_oss: bool = True) -> Path | None:
    """Resolve a stored result without trusting a database path."""
    if not artifact_path:
        return None
    root = Path(settings.full_translation_output_dir)
    artifact = _safe_child(root, artifact_path)
    if not artifact:
        return None
    if restore_from_oss and not artifact.exists():
        download_oss_file(full_translation_object_key(artifact_path), artifact)
    return artifact if artifact.exists() else None


def translation_artifact_relative_path(paper_id: int, generation_version: int) -> str:
    return f"{int(paper_id)}/translation-v{max(1, int(generation_version))}.pdf"


def translation_artifact_destination(artifact_path: str) -> Path:
    root = Path(settings.full_translation_output_dir)
    destination = _safe_child(root, artifact_path)
    if not destination:
        raise PdfMathTranslateError("译文文件存储路径无效。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    return destination


def translation_job_dir(translation_id: int) -> Path:
    root = Path(settings.full_translation_output_dir) / ".jobs"
    return root / f"translation-{int(translation_id)}-{int(time() * 1000)}"


def _format_command_args(
    input_pdf: Path,
    output_dir: Path,
    *,
    provider: PdfMathTranslateProvider,
) -> list[str]:
    command = settings.pdfmathtranslate_command
    if not command:
        raise PdfMathTranslateError("PDFMathTranslate 运行环境尚未配置。")

    values = {
        "input_pdf": str(input_pdf),
        "output_dir": str(output_dir),
        "source_lang": settings.pdfmathtranslate_source_lang,
        "target_lang": settings.pdfmathtranslate_target_lang,
        "service": service_for_provider(provider),
        "thread": settings.pdfmathtranslate_thread,
    }
    try:
        executable = shlex.split(command, posix=os.name != "nt")
        # Split first, then interpolate.  A PDF path containing spaces stays a
        # single subprocess argument and never reaches a shell.
        arguments = [part.format(**values) for part in shlex.split(settings.pdfmathtranslate_args, posix=os.name != "nt")]
    except (KeyError, ValueError) as exc:
        raise PdfMathTranslateError(f"PDFMathTranslate 参数模板无效：{exc}") from exc
    if not executable:
        raise PdfMathTranslateError("PDFMathTranslate command configuration is empty.")
    # pdf2zh 1.9.11 exposes BabelDOC through its own wrapper. Its parser does
    # not accept BabelDOC's native --no-dual flag, even though BabelDOC itself
    # does. Never forward that flag to the wrapper; _find_output_pdf selects
    # the generated mono PDF and discards the extra dual artifact afterward.
    arguments = [argument for argument in arguments if argument != "--no-dual"]
    return [*executable, *arguments]


def _build_process_environment(provider: PdfMathTranslateProvider) -> dict[str, str]:
    """Map the active global provider to PDFMathTranslate for this process only."""
    environment = os.environ.copy()
    service = service_for_provider(provider)
    api_key = provider.api_key.strip()
    if not api_key:
        raise PdfMathTranslateError("当前全局 AI 厂商缺少可用的 API 密钥。")
    if service == "zhipu":
        environment["ZHIPU_API_KEY"] = api_key
        environment["ZHIPU_MODEL"] = provider.model
    elif service == "deepseek":
        environment["DEEPSEEK_API_KEY"] = api_key
        environment["DEEPSEEK_MODEL"] = provider.model
    else:
        environment["OPENAILIKED_BASE_URL"] = provider.base_url.rstrip("/")
        environment["OPENAILIKED_API_KEY"] = api_key
        environment["OPENAILIKED_MODEL"] = provider.model
    return environment


def _terminate_process_tree(process: subprocess.Popen[str]) -> None:
    """Stop the renderer and children it may have spawned after a timeout."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        # pdf2zh's virtualenv launcher starts the real interpreter as a child;
        # Process.terminate() alone leaves that CPU-heavy layout worker alive.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
        return

    try:
        os.killpg(process.pid, 15)
    except ProcessLookupError:
        return


def _execute_pdfmathtranslate_command(
    command: list[str],
    *,
    cwd: str,
    environment: dict[str, str],
    timeout: int,
) -> subprocess.CompletedProcess[str]:
    """Run the isolated renderer and guarantee timeout cleanup for its children."""
    popen_options: dict[str, object] = {
        "cwd": cwd,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "env": environment,
    }
    if os.name == "nt":
        popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_options["start_new_session"] = True

    process = subprocess.Popen(command, **popen_options)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        _terminate_process_tree(process)
        process.wait(timeout=10)
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def _is_pdf(path: Path) -> bool:
    try:
        if not path.is_file() or path.stat().st_size <= 16:
            return False
        with path.open("rb") as handle:
            return handle.read(5) == b"%PDF-"
    except OSError:
        return False


def _latin_and_cjk_character_counts(path: Path) -> tuple[int, int] | None:
    """Return text coverage signals without failing a valid, non-text PDF."""
    try:
        import fitz

        document = fitz.open(path)
        try:
            text = "".join(page.get_text("text") for page in document)
        finally:
            document.close()
    except Exception:
        # Image-only PDFs and unusual embedded fonts cannot be checked using
        # extracted text, so leave visual validation to PDFMathTranslate.
        return None

    latin = sum("a" <= character.lower() <= "z" for character in text)
    cjk = sum("\u4e00" <= character <= "\u9fff" for character in text)
    return latin, cjk


def _validate_translation_coverage(source_pdf: Path, output_pdf: Path) -> None:
    """Reject a result that only translated a title while leaving English body text."""
    if not (
        settings.pdfmathtranslate_source_lang.lower().startswith("en")
        and settings.pdfmathtranslate_target_lang.lower().startswith("zh")
    ):
        return

    source_counts = _latin_and_cjk_character_counts(source_pdf)
    output_counts = _latin_and_cjk_character_counts(output_pdf)
    if not source_counts or not output_counts:
        return

    source_latin, _ = source_counts
    _, output_cjk = output_counts
    # Small metadata-only PDFs need no coverage judgement. For academic papers,
    # a Chinese translation should contain substantially more than a title.
    minimum_expected_cjk = max(80, round(source_latin * 0.10))
    if source_latin >= 800 and output_cjk < minimum_expected_cjk:
        raise PdfMathTranslateError(
            "翻译质检未通过：译文正文仍以英文为主，本次结果未保存，已保留旧译文。"
        )


def _find_output_pdf(job_dir: Path, source_pdf: Path, started_at: float) -> Path | None:
    candidates: list[Path] = []
    for path in job_dir.rglob(settings.pdfmathtranslate_output_glob):
        try:
            if path.resolve() == source_pdf.resolve() or path.stat().st_mtime < started_at - 1:
                continue
        except OSError:
            continue
        if _is_pdf(path):
            candidates.append(path)
    if not candidates:
        return None

    def sort_key(path: Path) -> tuple[int, float, int]:
        name = path.name.lower()
        # PDFMathTranslate normally emits a `mono` PDF for the translated-only
        # view.  Prefer it, then a clearly translated filename, while keeping a
        # configuration override available through OUTPUT_GLOB.
        preferred = int("mono" in name) * 2 + int("translated" in name or "zh" in name)
        stat = path.stat()
        return preferred, stat.st_mtime, stat.st_size

    return max(candidates, key=sort_key)


def run_pdfmathtranslate(
    source_pdf: Path,
    *,
    job_dir: Path,
    provider: PdfMathTranslateProvider,
) -> PdfMathTranslateResult:
    if not source_pdf.exists() or not _is_pdf(source_pdf):
        raise PdfMathTranslateError("原始 PDF 不存在或文件格式无效。")

    job_dir.mkdir(parents=True, exist_ok=True)
    input_pdf = job_dir / "source.pdf"
    output_dir = job_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_pdf, input_pdf)
    command = _format_command_args(input_pdf, output_dir, provider=provider)
    started_at = time()
    try:
        completed = _execute_pdfmathtranslate_command(
            command,
            cwd=str(job_dir),
            environment=_build_process_environment(provider),
            timeout=max(60, settings.pdfmathtranslate_timeout_seconds),
        )
    except FileNotFoundError as exc:
        raise PdfMathTranslateError("找不到 PDFMathTranslate 可执行程序，请检查服务器配置。") from exc
    except subprocess.TimeoutExpired as exc:
        raise PdfMathTranslateError("PDFMathTranslate 超时，原译文未被覆盖。") from exc

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "未知错误").strip().replace("\n", " ")[:500]
        raise PdfMathTranslateError(f"PDFMathTranslate 执行失败：{detail}")

    output_pdf = _find_output_pdf(job_dir, input_pdf, started_at)
    if not output_pdf:
        raise PdfMathTranslateError("PDFMathTranslate 未产出有效的译文 PDF。")
    _validate_translation_coverage(input_pdf, output_pdf)
    return PdfMathTranslateResult(
        output_pdf=output_pdf,
        summary={
            "engine": "pdfmathtranslate",
            "renderer": "babeldoc",
            "service": service_for_provider(provider),
            "provider_id": provider.provider_id,
            "provider_label": provider.label,
            "provider_base_url": provider.base_url,
            "model": provider.model,
            "source_language": settings.pdfmathtranslate_source_lang,
            "target_language": settings.pdfmathtranslate_target_lang,
            "exit_code": completed.returncode,
        },
    )
