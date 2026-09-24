from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path

from app.core.config import settings


def spawn_python_worker(module_name: str, *args: object) -> None:
    backend_root = Path(__file__).resolve().parents[2]
    command = [sys.executable, "-m", module_name, *(str(arg) for arg in args if arg is not None)]
    subprocess.Popen(
        command,
        cwd=str(backend_root),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def spawn_full_translation_worker_process(translation_id: int) -> None:
    if getattr(settings, "standalone_runtime", False):
        # The packaged backend is a single executable; run the same worker in
        # a daemon thread because no Python module interpreter is shipped.
        from app.services.full_pdf_translation import run_full_pdf_translation_task

        threading.Thread(
            target=run_full_pdf_translation_task,
            args=(translation_id,),
            name=f"full-translation-{translation_id}",
            daemon=True,
        ).start()
        return
    spawn_python_worker("app.services.full_translation_worker", translation_id)


def spawn_paper_reading_brief_worker_process(brief_id: int, provider_id: int | None = None) -> None:
    spawn_python_worker("app.services.paper_reading_brief_worker", brief_id, provider_id)


def spawn_paper_ai_outline_worker_process(outline_id: int, provider_id: int | None = None) -> None:
    spawn_python_worker("app.services.paper_ai_outline_worker", outline_id, provider_id)
