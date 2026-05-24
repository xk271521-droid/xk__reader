from __future__ import annotations

from pathlib import Path

from app.core.config import settings
from app.services.oss_storage import object_storage_available, paper_object_key, upload_file


def main() -> None:
    if not object_storage_available():
        raise SystemExit("OSS is not configured. Set OSS_ENABLED=true and OSS_* credentials first.")

    root = Path(settings.papers_upload_dir)
    if not root.exists():
        raise SystemExit(f"Paper upload directory does not exist: {root}")

    uploaded = 0
    skipped = 0
    failed = 0

    for pdf_path in sorted(root.glob("*.pdf")):
        key = paper_object_key(f"/uploads/papers/{pdf_path.name}")
        ok = upload_file(pdf_path, key, content_type="application/pdf")
        if ok:
            uploaded += 1
            print(f"uploaded {pdf_path.name} -> {key}")
        else:
            failed += 1
            print(f"failed {pdf_path.name}")

    print(f"done uploaded={uploaded} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()
