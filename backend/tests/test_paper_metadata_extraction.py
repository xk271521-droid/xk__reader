from __future__ import annotations

import unittest

from app.schemas.paper import PaperMetadata
from app.services.paper_metadata import (
    extract_front_matter_hints,
    find_arxiv_id,
    find_doi,
    merge_pdf_metadata,
)


class PaperMetadataExtractionTest(unittest.TestCase):
    def test_extracts_arxiv_title_authors_keywords_and_identifier(self):
        text = """
        arXiv:1703.06870v2 [cs.CV] 24 Jan 2018
        Mask R-CNN
        Kaiming He, Georgia Gkioxari, Piotr Dollar, Ross Girshick
        Facebook AI Research (FAIR)
        Abstract
        We present a conceptually simple, flexible, and general framework.
        Keywords: instance segmentation; object detection; neural networks
        """

        hints = extract_front_matter_hints(text, {}, "1703.06870v2.pdf")

        self.assertEqual(hints["title"], "Mask R-CNN")
        self.assertIn("Kaiming He", hints["author"])
        self.assertEqual(hints["arxiv_id"], "1703.06870v2")
        self.assertEqual(
            hints["keywords"],
            "instance segmentation; object detection; neural networks",
        )

    def test_skips_publisher_front_matter_when_title_follows_article_marker(self):
        text = """
        Hindawi
        Computational Intelligence and Neuroscience
        Volume 2019, Article ID 5065214, 9 pages
        https://doi.org/10.1155/2019/5065214
        Research Article
        A Multichannel 2D Convolutional Neural Network Model for
        Task-Evoked fMRI Data Classification
        Jinlong Hu, Yuezhen Kuang, Bin Liao, Lijie Cao, Shoubin Dong, and Ping Li
        School of Computer Science and Engineering, South China University of Technology
        Abstract
        This paper proposes a model.
        """

        hints = extract_front_matter_hints(text, {}, "paper.pdf")

        self.assertEqual(
            hints["title"],
            "A Multichannel 2D Convolutional Neural Network Model for Task-Evoked fMRI Data Classification",
        )
        self.assertIn("Jinlong Hu", hints["author"])
        self.assertNotIn(",1", hints["author"])
        self.assertEqual(hints["doi"], "10.1155/2019/5065214")

    def test_identifier_cleanup(self):
        self.assertEqual(
            find_doi("Available at https://doi.org/10.48550/arXiv.1703.06870."),
            "10.48550/arXiv.1703.06870",
        )
        self.assertEqual(find_arxiv_id("arXiv:1703.06870v2 [cs.CV]"), "1703.06870v2")
        self.assertEqual(find_arxiv_id("PII: 0043-1648(91)90119-F"), "")

    def test_merge_replaces_weak_title_and_keeps_user_metadata(self):
        existing = PaperMetadata(
            title="1703.06870v2",
            author="User Edited Author",
            page_count=0,
        )
        merged = merge_pdf_metadata(
            existing,
            {
                "title": "Mask R-CNN",
                "author": "Kaiming He; Georgia Gkioxari",
                "doi": "10.48550/arXiv.1703.06870",
                "page_count": 10,
            },
            file_name="1703.06870v2.pdf",
        )

        self.assertEqual(merged.title, "Mask R-CNN")
        self.assertEqual(merged.author, "User Edited Author")
        self.assertEqual(merged.doi, "10.48550/arXiv.1703.06870")
        self.assertEqual(merged.page_count, 10)


if __name__ == "__main__":
    unittest.main()
