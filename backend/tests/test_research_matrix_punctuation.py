import unittest

from app.services.research_matrix import build_grouped_review_paragraph, build_outline_insights


class ResearchMatrixPunctuationTest(unittest.TestCase):
    def test_grouped_review_paragraph_does_not_stack_question_and_separator(self):
        paragraph = build_grouped_review_paragraph(
            "\u672c\u6279\u6587\u732e\u4e3b\u8981\u56f4\u7ed5\u4ee5\u4e0b\u95ee\u9898\u5c55\u5f00\uff1a",
            [
                {"text": "\u5982\u4f55\u63d0\u9ad8\u5206\u7c7b\u51c6\u786e\u6027\uff1f", "citations": []},
                {"text": "\u5982\u4f55\u63d0\u9ad8\u6a21\u578b\u9c81\u68d2\u6027\uff1f", "citations": []},
            ],
        )

        text = paragraph["text"]
        self.assertNotIn("\uff1f\uff1b", text)
        self.assertNotIn("?\uff1b", text)
        self.assertNotIn("\uff1f\u3002", text)
        self.assertIn("\u5982\u4f55\u63d0\u9ad8\u5206\u7c7b\u51c6\u786e\u6027\uff1b", text)

    def test_outline_insights_are_grounded_in_draft_content(self):
        drafts = {
            "method_compare": {
                "paragraphs": [
                    {
                        "text": "方法路线主要比较 M2D CNN 与 3D CNN，重点在参数量控制和多通道特征融合。",
                    }
                ],
            },
            "result_analysis": {
                "paragraphs": [
                    {
                        "text": "实验结果显示 M2D CNN 在 fMRI 分类准确率上更高，同时计算效率更好。",
                    }
                ],
            },
            "core_innovations": {
                "paragraphs": [
                    {
                        "text": "创新点集中在二维多通道卷积建模和灰狼优化参数搜索。",
                    }
                ],
            },
            "limitations_future": {
                "paragraphs": [
                    {
                        "text": "当前局限在于样本规模较小，跨数据集泛化仍需验证。",
                    }
                ],
            },
        }

        insights = build_outline_insights(drafts)
        joined = "\n".join(
            insights["consensus"] + insights["divergence"] + insights["gaps"]
        )

        self.assertIn("M2D CNN", joined)
        self.assertIn("样本规模较小", joined)
        self.assertNotIn("现有工作已经能够围绕方法路线形成可比框架", joined)
        self.assertNotIn("路线 A / 路线 B", joined)
        self.assertNotIn("现有文献已经暴露出一批共性局限", joined)


if __name__ == "__main__":
    unittest.main()
