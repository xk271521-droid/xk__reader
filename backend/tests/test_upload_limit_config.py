import unittest

from app.core.config import Settings


class UploadLimitConfigTest(unittest.TestCase):
    def test_default_paper_upload_limit_supports_large_academic_pdfs(self) -> None:
        self.assertGreaterEqual(Settings().papers_max_size_bytes, 100 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
