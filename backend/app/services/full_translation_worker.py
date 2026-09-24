from __future__ import annotations

import sys

from app.services.full_pdf_translation import run_full_pdf_translation_task


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if not args:
        raise SystemExit("usage: python -m app.services.full_translation_worker <translation_id>")
    translation_id = int(args[0])
    run_full_pdf_translation_task(translation_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
