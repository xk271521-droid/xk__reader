import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models import Folder, Paper, PaperReadingBrief, User
from app.services.paper_reading_brief import normalize_paper_reading_brief


class PaperReadingBriefTest(unittest.TestCase):
    def test_normalizes_the_eight_section_contract_and_term_explanations(self):
        result = normalize_paper_reading_brief({
            "one_sentence_conclusion": {"text": "The method improves accuracy.", "pages": [5, "5"], "figures": ["Fig. 2"]},
            "background_and_pain_points": [{"text": "Existing methods are slow.", "pages": [1]}],
            "research_objective": [{"text": "Reduce inference time.", "pages": [2]}],
            "core_methods_or_models": [{"text": "A sparse transformer is used.", "pages": [3]}],
            "results_and_comparisons": [{"text": "Latency falls by 30% versus baseline.", "pages": [6]}],
            "conclusions_and_contributions": [{"text": "The model is practical.", "pages": [7]}],
            "limitations_and_boundaries": [{"text": "Only evaluated on one dataset.", "pages": [8]}],
            "key_terms": [{
                "term": "Sparse attention",
                "chinese_name": "稀疏注意力",
                "abbreviation": "SA",
                "standard_explanation": "An attention mechanism with restricted connections.",
                "plain_explanation": "It only looks at the most relevant pieces instead of everything.",
                "paper_role": "The central efficiency method.",
                "pages": [3],
                "basis": "general_knowledge",
            }],
        })

        self.assertEqual(result["one_sentence_conclusion"]["pages"], [5])
        self.assertEqual(result["results_and_comparisons"][0]["pages"], [6])
        self.assertEqual(result["key_terms"][0]["standard_explanation"], "An attention mechanism with restricted connections.")
        self.assertEqual(result["key_terms"][0]["plain_explanation"], "It only looks at the most relevant pieces instead of everything.")
        self.assertEqual(result["key_terms"][0]["basis"], "general_knowledge")

    def test_unknown_basis_falls_back_to_explicit_paper_evidence(self):
        result = normalize_paper_reading_brief({
            "results_and_comparisons": [{
                "text": "The test result is reported.",
                "basis": "invented_basis",
            }],
        })

        self.assertEqual(result["results_and_comparisons"][0]["basis"], "paper_explicit")

    def test_keeps_missing_sections_explicit_instead_of_inventing_content(self):
        result = normalize_paper_reading_brief({"one_sentence_conclusion": ""})

        self.assertEqual(result["one_sentence_conclusion"]["text"], "原文未明确说明。")
        self.assertEqual(result["background_and_pain_points"][0]["text"], "原文未明确说明。")
        self.assertEqual(result["key_terms"], [])

    def test_database_allows_only_one_brief_per_paper(self):
        engine = create_engine("sqlite://")
        Session = sessionmaker(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = Session()
        try:
            user = User(uid="brief-user", phone="13000000000", password_hash="hash")
            folder = Folder(user=user, name="papers")
            paper = Paper(
                user=user,
                folder=folder,
                file_name="brief.pdf",
                file_path="/uploads/papers/brief.pdf",
                file_size="1 KB",
            )
            db.add_all([user, folder, paper])
            db.commit()

            db.add(PaperReadingBrief(paper_id=paper.id, user_id=user.id, status="queued"))
            db.commit()
            db.add(PaperReadingBrief(paper_id=paper.id, user_id=user.id, status="queued"))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()

            saved = db.scalars(
                select(PaperReadingBrief).where(PaperReadingBrief.paper_id == paper.id)
            ).all()
            self.assertEqual(len(saved), 1)
        finally:
            db.close()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
