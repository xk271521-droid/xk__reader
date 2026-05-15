from __future__ import annotations

import sys

from app.services.paper_summary import run_paper_summary_task


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if not args:
        raise SystemExit("usage: python -m app.services.paper_summary_worker <summary_id> [provider_id]")
    summary_id = int(args[0])
    provider_id = None
    if len(args) > 1 and args[1] not in {"", "none", "null"}:
        provider_id = int(args[1])
    run_paper_summary_task(summary_id, provider_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
