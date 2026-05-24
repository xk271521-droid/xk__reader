from __future__ import annotations

import unittest

from app.services.pdf_layout import build_page_layout_from_words


class PdfLayoutTest(unittest.TestCase):
    def test_assigns_columns_and_orders_two_column_lines_by_reading_flow(self):
        words = [
            (60, 80, 90, 92, "left", 0, 0, 0),
            (96, 80, 130, 92, "top", 0, 0, 1),
            (330, 80, 370, 92, "right", 1, 0, 0),
            (376, 80, 410, 92, "top", 1, 0, 1),
            (60, 110, 90, 122, "left", 0, 1, 0),
            (96, 110, 150, 122, "bottom", 0, 1, 1),
            (330, 110, 370, 122, "right", 1, 1, 0),
            (376, 110, 440, 122, "bottom", 1, 1, 1),
        ]

        layout = build_page_layout_from_words(
            page_number=1,
            width=500,
            height=700,
            raw_words=words,
        )

        self.assertEqual([line["text"] for line in layout["lines"]], [
            "left top",
            "left bottom",
            "right top",
            "right bottom",
        ])
        self.assertEqual([line["column_id"] for line in layout["lines"]], [0, 0, 1, 1])
        self.assertEqual(layout["columns"], [
            {"id": 0, "left": 0.0, "right": 0.5},
            {"id": 1, "left": 0.5, "right": 1.0},
        ])


if __name__ == "__main__":
    unittest.main()
