"""Dry-run-first cleanup for the three legacy PDF annotation tables.

This script intentionally cannot delete papers, notebooks, screenshots, chat,
or full-translation data. It is kept separate from application startup so a
deployment can never erase legacy annotations merely by restarting.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import delete, func, select

# Direct `python scripts/...` execution puts only the scripts directory on
# sys.path. Add the backend root explicitly so the same command works locally
# and on the deployment server.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import SessionLocal
from app.models import Annotation, InkAnnotation
from app.models.shape_annotation import ShapeAnnotation

CONFIRMATION = "DELETE-LEGACY-PDF-ANNOTATIONS"
TARGETS = (
    ("annotations_v2", Annotation),
    ("paper_ink_annotations", InkAnnotation),
    ("paper_shape_annotations", ShapeAnnotation),
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="清理旧版 PDF 批注数据；默认只预览数量。")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--user-id", type=int, help="只清理一个用户的旧批注")
    scope.add_argument("--all-users", action="store_true", help="清理所有用户的旧批注")
    parser.add_argument(
        "--confirm",
        default="",
        help=f"实际执行删除时必须填写：{CONFIRMATION}",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    db = SessionLocal()
    try:
        counts: dict[str, int] = {}
        for table_name, model in TARGETS:
            statement = select(func.count()).select_from(model)
            if args.user_id is not None:
                statement = statement.where(model.user_id == args.user_id)
            counts[table_name] = int(db.scalar(statement) or 0)

        scope_label = "all users" if args.all_users else f"user_id={args.user_id}"
        print(f"Legacy PDF annotation cleanup preview ({scope_label})")
        for table_name, count in counts.items():
            print(f"- {table_name}: {count}")

        if args.confirm != CONFIRMATION:
            print("Dry run only; no data was deleted.")
            return 0

        for _, model in TARGETS:
            statement = delete(model)
            if args.user_id is not None:
                statement = statement.where(model.user_id == args.user_id)
            db.execute(statement)
        db.commit()
        print(f"Deleted {sum(counts.values())} legacy PDF annotations. New unified annotations were untouched.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
