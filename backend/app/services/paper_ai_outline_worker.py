from __future__ import annotations

import sys

from app.services.paper_ai_outline import run_paper_ai_outline_task


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if not args:
        raise SystemExit("usage: python -m app.services.paper_ai_outline_worker <outline_id> [provider_id]")
    outline_id = int(args[0])
    provider_id = int(args[1]) if len(args) > 1 and args[1] not in {"", "none", "null"} else None
    run_paper_ai_outline_task(outline_id, provider_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
