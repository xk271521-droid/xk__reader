import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models import Folder, Paper, PaperAiOutline, User
from app.services.paper_ai_outline import (
    merge_native_outline_translations,
    native_outline_has_missing_translations,
    native_paper_outline_hash,
    normalize_native_paper_outline,
    normalize_paper_ai_outline,
)


class PaperAiOutlineTest(unittest.TestCase):
    def test_normalizes_bilingual_items_and_rejects_invalid_page_numbers(self):
        result = normalize_paper_ai_outline({
            "items": [{
                "title_cn": "引言",
                "title_en": "Introduction",
                "page": 1,
                "children": [
                    {"title_cn": "研究背景", "title_en": "Research Background", "page": 2},
                    {"title_cn": "错误页", "title_en": "Wrong page", "page": 99},
                ],
            }],
        }, full_text="[第 1 页] title\n[第 2 页] background")

        self.assertEqual(result["items"][0]["title_cn"], "引言")
        self.assertEqual(result["items"][0]["title_en"], "Introduction")
        self.assertEqual(result["items"][0]["children"][0]["page"], 2)
        self.assertIsNone(result["items"][0]["children"][1]["page"])

    def test_database_allows_only_one_cached_outline_per_paper(self):
        engine = create_engine("sqlite://")
        Session = sessionmaker(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = Session()
        try:
            user = User(uid="outline-user", phone="13000000001", password_hash="hash")
            folder = Folder(user=user, name="papers")
            paper = Paper(
                user=user,
                folder=folder,
                file_name="outline.pdf",
                file_path="/uploads/papers/outline.pdf",
                file_size="1 KB",
            )
            db.add_all([user, folder, paper])
            db.commit()

            db.add(PaperAiOutline(paper_id=paper.id, user_id=user.id, status="queued"))
            db.commit()
            db.add(PaperAiOutline(paper_id=paper.id, user_id=user.id, status="queued"))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()

            saved = db.scalars(select(PaperAiOutline).where(PaperAiOutline.paper_id == paper.id)).all()
            self.assertEqual(len(saved), 1)
        finally:
            db.close()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()

    def test_native_outline_preserves_source_tree_when_chinese_titles_are_merged(self):
        native = normalize_native_paper_outline({
            "items": [{
                "title_en": "Introduction",
                "page": 2,
                "children": [{"title_en": "Our contribution", "page": 3}],
            }],
        })
        merged = merge_native_outline_translations(native, {
            "0": "引言",
            "0.0": "我们的贡献",
        })

        self.assertEqual(native_paper_outline_hash(native), native_paper_outline_hash(native))
        self.assertEqual(merged["items"][0]["title_en"], "Introduction")
        self.assertEqual(merged["items"][0]["title_cn"], "引言")
        self.assertEqual(merged["items"][0]["children"][0]["page"], 3)
        self.assertFalse(native_outline_has_missing_translations(merged))


if __name__ == "__main__":
    unittest.main()
