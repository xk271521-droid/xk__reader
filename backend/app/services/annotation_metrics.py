from __future__ import annotations

from collections.abc import Iterable

from app.models.annotation import Annotation


def count_effective_annotations(annotations: Iterable[Annotation]) -> int:
    groups: dict[tuple[int, str, str | None], list[tuple[int, int]]] = {}
    for annotation in annotations:
        start_char = int(annotation.start_char or 0)
        end_char = int(annotation.end_char or 0)
        if end_char <= start_char:
            continue
        key = (
            int(annotation.page_number or 0),
            str(annotation.type or "highlight"),
            annotation.color,
        )
        groups.setdefault(key, []).append((start_char, end_char))

    total = 0
    for ranges in groups.values():
        merged: list[list[int]] = []
        for start_char, end_char in sorted(ranges):
            if not merged or start_char > merged[-1][1]:
                merged.append([start_char, end_char])
                continue
            merged[-1][1] = max(merged[-1][1], end_char)
        total += len(merged)
    return total
