from __future__ import annotations

import sys

from app.services.paper_reading_brief import run_paper_reading_brief_task


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if not args:
        raise SystemExit("usage: python -m app.services.paper_reading_brief_worker <brief_id> [provider_id]")
    brief_id = int(args[0])
    provider_id = int(args[1]) if len(args) > 1 and args[1] not in {"", "none", "null"} else None
    run_paper_reading_brief_task(brief_id, provider_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
