from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402
from app.services.upload_mirror import mirror_upload_file  # noqa: E402


def sync_folder(local_dir: Path, remote_prefix: str) -> int:
    if not local_dir.exists():
        return 0

    count = 0
    for path in local_dir.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(local_dir).as_posix()
        mirror_upload_file(path, f"{remote_prefix}/{relative}")
        count += 1
    return count


def main() -> None:
    if not settings.upload_mirror_enabled:
        raise SystemExit("UPLOAD_MIRROR_ENABLED is false; enable it in backend/.env first.")

    avatar_count = sync_folder(Path(settings.avatar_upload_dir), "avatars")
    paper_count = sync_folder(Path(settings.papers_upload_dir), "papers")
    print(f"synced avatars={avatar_count}, papers={paper_count}")


if __name__ == "__main__":
    main()
