from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def spawn_python_worker(module_name: str, *args: object) -> None:
    backend_root = Path(__file__).resolve().parents[2]
    command = [sys.executable, "-m", module_name, *(str(arg) for arg in args if arg is not None)]
    subprocess.Popen(
        command,
        cwd=str(backend_root),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def spawn_paper_summary_worker_process(summary_id: int, provider_id: int | None = None) -> None:
    spawn_python_worker("app.services.paper_summary_worker", summary_id, provider_id)


def spawn_research_matrix_worker_process(run_id: int, provider_id: int | None = None) -> None:
    spawn_python_worker("app.services.research_matrix_worker", run_id, provider_id)


def spawn_full_translation_worker_process(translation_id: int, provider_id: int | None = None) -> None:
    spawn_python_worker("app.services.full_translation_worker", translation_id, provider_id)
