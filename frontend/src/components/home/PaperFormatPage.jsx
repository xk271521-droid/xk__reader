import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  extractPaperFormatTemplate,
  fetchPaperFormatProfiles,
  normalizePaperFormat,
  parsePaperFormatRequirements,
} from '../../services/paperReaderApi'
import {
  deleteRecentPaperFormatDraft,
  listRecentPaperFormatDrafts,
  saveRecentPaperFormatDraft,
} from '../../utils/paperFormatDraftStore'

const TEXT = {
  pageTitle: '\u8bba\u6587\u683c\u5f0f\u89c4\u8303\u5316',
  pageHint:
    '\u5de6\u4fa7\u653e\u8981\u6c42\u548c\u6587\u6863\uff0c\u53f3\u4fa7\u76f4\u63a5\u9009\u53c2\u6570\uff0c\u5e38\u7528\u53c2\u6570\u5355\u72ec\u6eda\u52a8\u3002',
  generate: '\u751f\u6210\u89c4\u8303\u7a3f',
  generating: '\u6b63\u5728\u751f\u6210',
  aiTitle: 'AI \u89e3\u6790\u683c\u5f0f\u8981\u6c42',
  aiHint:
    '\u7c98\u8d34\u5b66\u6821\u6a21\u677f\uff0c\u8001\u5e08\u8bf4\u660e\u6216\u68c0\u6d4b\u8981\u6c42\uff0c\u5148\u81ea\u52a8\u586b\u4e00\u7248\u3002',
  aiPlaceholder:
    '\u4f8b\u5982\uff1a\u6b63\u6587\u5b8b\u4f53\u5c0f\u56db\uff0c1.5 \u500d\u884c\u8ddd\uff1b\u4e00\u7ea7\u6807\u9898\u9ed1\u4f53\u4e09\u53f7\u5de6\u5bf9\u9f50\uff1b\u4e8c\u7ea7\u6807\u9898\u9ed1\u4f53\u56db\u53f7\u5de6\u5bf9\u9f50\uff1b\u9875\u8fb9\u8ddd\u4e0a 2.5\uff0c\u4e0b 2.5\uff0c\u5de6 3.17\uff0c\u53f3 2.54 \u5398\u7c73\uff1b\u9875\u7801\u5e95\u90e8\u5c45\u4e2d\u3002',
  aiFill: 'AI \u89e3\u6790\u5e76\u586b\u5165\u53f3\u4fa7\u53c2\u6570',
  aiParsing: '\u89e3\u6790\u4e2d',
  templateTitle: '\u4ece\u5b66\u6821\u6a21\u677f\u63d0\u53d6\u89c4\u5219',
  templateHint: '\u4e0a\u4f20\u4e00\u4efd\u5b66\u6821\u6216\u8001\u5e08\u63d0\u4f9b\u7684 .docx \u6a21\u677f\uff0c\u81ea\u52a8\u5b66\u4e00\u7248\u53c2\u6570\u3002',
  templateHintLegacy: '\u652f\u6301 .docx \u548c .doc \u6a21\u677f\uff0c\u4f1a\u5148\u8f6c\u6210\u53ef\u5b66\u4e60\u7684 Word \u7ed3\u6784\u518d\u63d0\u53d6\u89c4\u5219\u3002',
  templatePick: '\u9009\u62e9\u6a21\u677f',
  templateExtracting: '\u63d0\u53d6\u4e2d',
  templateTypeError: '\u8bf7\u4e0a\u4f20 .docx \u6216 .doc \u683c\u5f0f\u7684\u6a21\u677f\u6587\u6863\u3002',
  templateEmpty: '\u6a21\u677f\u91cc\u8fd8\u6ca1\u63d0\u53d6\u5230\u53ef\u7528\u89c4\u5219\uff0c\u53ef\u4ee5\u6362\u4e00\u4efd\u6a21\u677f\u518d\u8bd5\u8bd5\u3002',
  templateExtractFail: '\u4ece\u6a21\u677f\u63d0\u53d6\u89c4\u5219\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  uploadTitle: '\u4e0a\u4f20\u8bba\u6587 Word \u6587\u6863',
  uploadHint:
    '\u652f\u6301\u62d6\u62fd\u4e0a\u4f20 .docx\uff0c\u5355\u4e2a\u6587\u4ef6\u4e0d\u8d85\u8fc7 30 MB',
  pickFile: '\u9009\u62e9\u6587\u4ef6',
  recentDraftsTitle: '\u6700\u8fd1\u89c4\u8303\u7a3f',
  recentDraftsHint: '\u4e34\u65f6\u4fdd\u7559\u6700\u65b0 3 \u4efd\u89c4\u8303\u7a3f\uff0c\u53ef\u4ee5\u76f4\u63a5\u91cd\u65b0\u4e0b\u8f7d\u3002',
  recentDraftsEmpty: '\u8fd8\u6ca1\u6709\u4e34\u65f6\u4fdd\u5b58\u7684\u89c4\u8303\u7a3f\u3002',
  recentDraftsDownload: '\u91cd\u65b0\u4e0b\u8f7d',
  recentDraftsDelete: '\u79fb\u9664',
  recentDraftSource: '\u539f\u6587\u6863',
  ruleSource: '\u89c4\u5219\u6765\u6e90',
  detectedHint: '\u7eff\u8272\u5373\u4e3a AI \u5df2\u8bc6\u522b\uff0c\u672c\u6b21\u5c06\u4f18\u5148\u4fee\u6539',
  reset: '\u6062\u590d\u9ed8\u8ba4',
  customProfile: '\u4e0a\u4f20\u6a21\u677f / AI \u89e3\u6790 / \u81ea\u5b9a\u4e49\u8981\u6c42',
  body: '\u6b63\u6587',
  heading1: '\u4e00\u7ea7\u6807\u9898',
  heading2: '\u4e8c\u7ea7\u6807\u9898',
  heading3: '\u4e09\u7ea7\u6807\u9898',
  margins: '\u9875\u8fb9\u8ddd',
  common: '\u5e38\u7528\u53c2\u6570',
  headings: '\u6807\u9898\u8bbe\u7f6e',
  layout: '\u7248\u9762\u8bbe\u7f6e',
  references: '\u53c2\u8003\u6587\u732e',
  appendix: '\u9644\u5f55',
  bodyFont: '\u6b63\u6587\u4e2d\u6587\u5b57\u4f53',
  latinFont: '\u82f1\u6587\u5b57\u4f53',
  bodySize: '\u6b63\u6587\u5b57\u53f7',
  lineSpacing: '\u6b63\u6587\u884c\u8ddd',
  bodyAlign: '\u6b63\u6587\u5bf9\u9f50',
  indent: '\u9996\u884c\u7f29\u8fdb',
  heading1Font: '\u4e00\u7ea7\u6807\u9898\u5b57\u4f53',
  heading1Size: '\u4e00\u7ea7\u6807\u9898\u5b57\u53f7',
  heading1Align: '\u4e00\u7ea7\u6807\u9898\u5bf9\u9f50',
  heading2Font: '\u4e8c\u7ea7\u6807\u9898\u5b57\u4f53',
  heading2Size: '\u4e8c\u7ea7\u6807\u9898\u5b57\u53f7',
  heading2Align: '\u4e8c\u7ea7\u6807\u9898\u5bf9\u9f50',
  heading3Font: '\u4e09\u7ea7\u6807\u9898\u5b57\u4f53',
  heading3Size: '\u4e09\u7ea7\u6807\u9898\u5b57\u53f7',
  heading3Align: '\u4e09\u7ea7\u6807\u9898\u5bf9\u9f50',
  marginTop: '\u4e0a\u8fb9\u8ddd',
  marginBottom: '\u4e0b\u8fb9\u8ddd',
  marginLeft: '\u5de6\u8fb9\u8ddd',
  marginRight: '\u53f3\u8fb9\u8ddd',
  tableSize: '\u8868\u683c\u5b57\u53f7',
  pageNumber: '\u6dfb\u52a0\u9875\u7801',
  chapterPageBreak: '\u7ae0\u6807\u9898\u72ec\u7acb\u5206\u9875',
  referenceIndent: '\u53c2\u8003\u6587\u732e\u60ac\u6302\u7f29\u8fdb',
  referenceSpacing: '\u53c2\u8003\u6587\u732e\u884c\u8ddd',
  appendixEnglishFont: '\u82f1\u6587\u539f\u6587\u5b57\u4f53',
  appendixEnglishSize: '\u82f1\u6587\u539f\u6587\u5b57\u53f7',
  appendixEnglishSpacing: '\u82f1\u6587\u539f\u6587\u884c\u8ddd',
  appendixTranslationFont: '\u4e2d\u6587\u7ffb\u8bd1\u5b57\u4f53',
  appendixTranslationSize: '\u4e2d\u6587\u7ffb\u8bd1\u5b57\u53f7',
  appendixTranslationSpacing: '\u4e2d\u6587\u7ffb\u8bd1\u884c\u8ddd',
  appendixCodeFont: '\u4ee3\u7801\u5b57\u4f53',
  appendixCodeSize: '\u4ee3\u7801\u5b57\u53f7',
  appendixCodeSpacing: '\u4ee3\u7801\u884c\u8ddd',
  notesTitle: '\u5f85\u786e\u8ba4\u9879',
  confirmTitle: '\u672c\u6b21\u751f\u6210\u5c06\u4fee\u6539\u8fd9\u4e9b\u683c\u5f0f',
  confirmHintCustom: '\u53ea\u4f1a\u4fee\u6539\u4e0b\u5217\u660e\u786e\u8bc6\u522b\u6216\u4f60\u624b\u52a8\u8c03\u6574\u8fc7\u7684\u5b57\u6bb5\uff0c\u5176\u4ed6\u683c\u5f0f\u4fdd\u6301\u539f\u6587\u3002',
  confirmHintProfile: '\u5c06\u6309\u5f53\u524d\u6a21\u677f\u7edf\u4e00\u8c03\u6574\u4e0b\u5217\u683c\u5f0f\u9879\u3002',
  confirmCancel: '\u518d\u770b\u770b',
  confirmSubmit: '\u786e\u8ba4\u751f\u6210',
  confirmEmpty: '\u5f53\u524d\u6ca1\u6709\u68c0\u6d4b\u5230\u660e\u786e\u8981\u4fee\u6539\u7684\u5b57\u6bb5\u3002',
  reportTitle: '\u672c\u6b21\u6267\u884c\u62a5\u544a',
  reportHintCustom:
    '\u8fd9\u4e9b\u5b57\u6bb5\u5df2\u7ecf\u771f\u6b63\u5199\u5165\u89c4\u8303\u7a3f\uff0c\u6ca1\u5217\u51fa\u7684\u5185\u5bb9\u4fdd\u6301\u539f\u6587\u3002',
  reportHintProfile:
    '\u8fd9\u4e9b\u5b57\u6bb5\u5df2\u7ecf\u6309\u5f53\u524d\u6a21\u677f\u7edf\u4e00\u8c03\u6574\u3002',
  reportChangedTitle: '\u5df2\u6267\u884c\u7684\u5b57\u6bb5',
  reportCheckTitle: '\u672c\u6b21\u547d\u4e2d\u68c0\u67e5',
  reportNeedsConfirmTitle: '\u8fd8\u9700\u8981\u4f60\u786e\u8ba4\u7684\u70b9',
  reportKeptTitle: '\u672a\u5217\u51fa\u7684\u90e8\u5206',
  reportKeptCustom:
    '\u56e0\u4e3a\u8fd9\u6b21\u662f AI /\u81ea\u5b9a\u4e49\u6a21\u5f0f\uff0c\u6ca1\u6709\u660e\u786e\u8bc6\u522b\u6216\u4f60\u6ca1\u624b\u52a8\u8bbe\u5b9a\u7684\u5b57\u6bb5\uff0c\u90fd\u4f1a\u5c3d\u91cf\u4fdd\u7559\u539f\u6587\u3002',
  reportKeptProfile:
    '\u5f53\u524d\u662f\u6a21\u677f\u6a21\u5f0f\uff0c\u4f1a\u6309\u6a21\u677f\u6574\u4f53\u7edf\u4e00\u8c03\u6574\u76f8\u5173\u683c\u5f0f\u3002',
  reportEmpty: '\u8fd9\u6b21\u6ca1\u6709\u8fd4\u56de\u53ef\u786e\u8ba4\u7684\u5df2\u6267\u884c\u5b57\u6bb5\u3002',
  reportSummaryApplied: '\u5b9e\u9645\u4fee\u6539\u5b57\u6bb5',
  reportSummarySections: '\u8bc6\u522b\u5230\u7684\u533a\u5757',
  reportSummaryReferences: '\u53c2\u8003\u6587\u732e\u6bb5\u843d',
  reportSummaryWarnings: '\u5f85\u590d\u6838\u63d0\u9192',
  reportUnsupportedTitle: '\u4ecd\u5efa\u8bae\u4eba\u5de5\u590d\u6838',
  noText: '\u5148\u7c98\u8d34\u5b66\u6821\u6216\u8001\u5e08\u7ed9\u51fa\u7684\u683c\u5f0f\u8981\u6c42\u3002',
  parseEmpty:
    'AI \u6ca1\u6709\u8bc6\u522b\u51fa\u660e\u786e\u7684\u683c\u5f0f\u9879\uff0c\u8bf7\u628a\u8981\u6c42\u5199\u5f97\u66f4\u5177\u4f53\u4e00\u70b9\u3002',
  parseFail: 'AI \u89e3\u6790\u683c\u5f0f\u8981\u6c42\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  fileTypeError: '\u8bf7\u4e0a\u4f20 .docx \u683c\u5f0f\u7684 Word \u8bba\u6587\u6587\u6863\u3002',
  fileRequired: '\u5148\u9009\u62e9\u4e00\u4efd\u9700\u8981\u683c\u5f0f\u5316\u7684\u8bba\u6587\u6587\u6863\u3002',
  submitFail: '\u8bba\u6587\u683c\u5f0f\u5316\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  downloadAgain: '\u91cd\u65b0\u4e0b\u8f7d',
  resultPrefix: '\u5df2\u5904\u7406',
  resultMiddle: '\u4e2a\u6bb5\u843d\uff0c\u8bc6\u522b',
  resultSuffix: '\u4e2a\u4e00\u7ea7\u6807\u9898\u3002',
}

const FONT_OPTIONS = ['\u5b8b\u4f53', '\u9ed1\u4f53', '\u4eff\u5b8b', '\u6977\u4f53', '\u5fae\u8f6f\u96c5\u9ed1']
const LATIN_FONT_OPTIONS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Courier New']
const BODY_SIZE_OPTIONS = [
  { label: '\u5c0f\u56db 12 pt', value: 12 },
  { label: '\u56db\u53f7 14 pt', value: 14 },
  { label: '\u4e94\u53f7 10.5 pt', value: 10.5 },
  { label: '\u5c0f\u4e09 15 pt', value: 15 },
]
const HEADING_1_SIZE_OPTIONS = [
  { label: '\u5c0f\u4e8c 18 pt', value: 18 },
  { label: '\u4e09\u53f7 16 pt', value: 16 },
  { label: '\u5c0f\u4e09 15 pt', value: 15 },
  { label: '\u4e8c\u53f7 22 pt', value: 22 },
  { label: '\u56db\u53f7 14 pt', value: 14 },
]
const HEADING_2_SIZE_OPTIONS = [
  { label: '\u56db\u53f7 14 pt', value: 14 },
  { label: '\u5c0f\u56db 12 pt', value: 12 },
  { label: '\u5c0f\u4e09 15 pt', value: 15 },
]
const HEADING_3_SIZE_OPTIONS = [
  { label: '\u5c0f\u56db 12 pt', value: 12 },
  { label: '\u4e94\u53f7 10.5 pt', value: 10.5 },
  { label: '\u56db\u53f7 14 pt', value: 14 },
]
const TABLE_SIZE_OPTIONS = [
  { label: '\u4e94\u53f7 10.5 pt', value: 10.5 },
  { label: '\u5c0f\u4e94 9 pt', value: 9 },
  { label: '\u5c0f\u56db 12 pt', value: 12 },
]
const LINE_SPACING_OPTIONS = [
  { label: '\u5355\u500d 1.0', value: 1 },
  { label: '1.25 \u500d', value: 1.25 },
  { label: '1.5 \u500d', value: 1.5 },
  { label: '1.75 \u500d', value: 1.75 },
  { label: '2 \u500d', value: 2 },
]
const ALIGN_OPTIONS = [
  { label: '\u5de6\u5bf9\u9f50', value: 'left' },
  { label: '\u4e24\u7aef\u5bf9\u9f50', value: 'justify' },
  { label: '\u5c45\u4e2d', value: 'center' },
  { label: '\u53f3\u5bf9\u9f50', value: 'right' },
]
const INDENT_OPTIONS = [
  { label: '\u4e0d\u7f29\u8fdb', value: 0 },
  { label: '2 \u5b57\u7b26 0.74 cm', value: 0.74 },
  { label: '0.8 cm', value: 0.8 },
  { label: '1 cm', value: 1 },
]
const MARGIN_OPTIONS = [
  { label: '2.0 cm', value: 2 },
  { label: '2.2 cm', value: 2.2 },
  { label: '2.54 cm', value: 2.54 },
  { label: '2.8 cm', value: 2.8 },
  { label: '3.0 cm', value: 3 },
  { label: '3.17 cm', value: 3.17 },
  { label: '3.6 cm', value: 3.6 },
]

const DEFAULT_REQUIREMENTS = {
  body_font: '\u5b8b\u4f53',
  latin_font: 'Times New Roman',
  heading_1_font: '\u9ed1\u4f53',
  heading_2_font: '\u9ed1\u4f53',
  heading_3_font: '\u9ed1\u4f53',
  body_size_pt: 12,
  heading_1_size_pt: 16,
  heading_2_size_pt: 14,
  heading_3_size_pt: 12,
  table_size_pt: 10.5,
  line_spacing: 1.5,
  first_line_indent_cm: 0.74,
  margin_top_cm: 2.54,
  margin_bottom_cm: 2.54,
  margin_left_cm: 3.17,
  margin_right_cm: 2.54,
  heading_1_align: 'left',
  heading_2_align: 'left',
  heading_3_align: 'left',
  body_align: 'justify',
  add_page_number: true,
  chapter_page_break: false,
  reference_hanging_indent_cm: 0.74,
  reference_line_spacing: 1.5,
  appendix_english_font: 'Times New Roman',
  appendix_translation_font: '\u5b8b\u4f53',
  appendix_code_font: 'Times New Roman',
  appendix_english_size_pt: 10.5,
  appendix_translation_size_pt: 12,
  appendix_code_size_pt: 10.5,
  appendix_english_line_spacing: 1,
  appendix_translation_line_spacing: 1,
  appendix_code_line_spacing: 1,
}

const FALLBACK_PROFILES = [
  { key: 'undergraduate_cn', title: '\u4e2d\u6587\u672c\u79d1\u8bba\u6587\u901a\u7528\u89c4\u8303' },
  { key: 'tyust_cs_2026', title: '\u592a\u539f\u79d1\u6280\u5927\u5b66\u8ba1\u7b97\u673a\u5b66\u9662 2026 \u672c\u79d1\u8bba\u6587\u683c\u5f0f' },
]

const FIELD_LABELS = {
  body_font: '\u6b63\u6587\u4e2d\u6587\u5b57\u4f53',
  latin_font: '\u82f1\u6587\u5b57\u4f53',
  body_size_pt: '\u6b63\u6587\u5b57\u53f7',
  line_spacing: '\u6b63\u6587\u884c\u8ddd',
  body_align: '\u6b63\u6587\u5bf9\u9f50',
  first_line_indent_cm: '\u9996\u884c\u7f29\u8fdb',
  heading_1_font: '\u4e00\u7ea7\u6807\u9898\u5b57\u4f53',
  heading_1_size_pt: '\u4e00\u7ea7\u6807\u9898\u5b57\u53f7',
  heading_1_align: '\u4e00\u7ea7\u6807\u9898\u5bf9\u9f50',
  heading_2_font: '\u4e8c\u7ea7\u6807\u9898\u5b57\u4f53',
  heading_2_size_pt: '\u4e8c\u7ea7\u6807\u9898\u5b57\u53f7',
  heading_2_align: '\u4e8c\u7ea7\u6807\u9898\u5bf9\u9f50',
  heading_3_font: '\u4e09\u7ea7\u6807\u9898\u5b57\u4f53',
  heading_3_size_pt: '\u4e09\u7ea7\u6807\u9898\u5b57\u53f7',
  heading_3_align: '\u4e09\u7ea7\u6807\u9898\u5bf9\u9f50',
  margin_top_cm: '\u4e0a\u8fb9\u8ddd',
  margin_bottom_cm: '\u4e0b\u8fb9\u8ddd',
  margin_left_cm: '\u5de6\u8fb9\u8ddd',
  margin_right_cm: '\u53f3\u8fb9\u8ddd',
  table_size_pt: '\u8868\u683c\u5b57\u53f7',
  add_page_number: '\u9875\u7801',
  chapter_page_break: '\u7ae0\u6807\u9898\u5206\u9875',
  reference_hanging_indent_cm: '\u53c2\u8003\u6587\u732e\u60ac\u6302\u7f29\u8fdb',
  reference_line_spacing: '\u53c2\u8003\u6587\u732e\u884c\u8ddd',
  appendix_english_font: '\u9644\u5f55\u82f1\u6587\u539f\u6587\u5b57\u4f53',
  appendix_english_size_pt: '\u9644\u5f55\u82f1\u6587\u539f\u6587\u5b57\u53f7',
  appendix_english_line_spacing: '\u9644\u5f55\u82f1\u6587\u539f\u6587\u884c\u8ddd',
  appendix_translation_font: '\u9644\u5f55\u4e2d\u6587\u7ffb\u8bd1\u5b57\u4f53',
  appendix_translation_size_pt: '\u9644\u5f55\u4e2d\u6587\u7ffb\u8bd1\u5b57\u53f7',
  appendix_translation_line_spacing: '\u9644\u5f55\u4e2d\u6587\u7ffb\u8bd1\u884c\u8ddd',
  appendix_code_font: '\u9644\u5f55\u4ee3\u7801\u5b57\u4f53',
  appendix_code_size_pt: '\u9644\u5f55\u4ee3\u7801\u5b57\u53f7',
  appendix_code_line_spacing: '\u9644\u5f55\u4ee3\u7801\u884c\u8ddd',
  abstract_heading_font: '\u4e2d\u6587\u6458\u8981\u6807\u9898\u5b57\u4f53',
  abstract_heading_size_pt: '\u4e2d\u6587\u6458\u8981\u6807\u9898\u5b57\u53f7',
  abstract_heading_align: '\u4e2d\u6587\u6458\u8981\u6807\u9898\u5bf9\u9f50',
  abstract_body_font: '\u4e2d\u6587\u6458\u8981\u6b63\u6587\u5b57\u4f53',
  abstract_body_size_pt: '\u4e2d\u6587\u6458\u8981\u6b63\u6587\u5b57\u53f7',
  abstract_body_line_spacing: '\u4e2d\u6587\u6458\u8981\u884c\u8ddd',
  abstract_keywords_font: '\u4e2d\u6587\u5173\u952e\u8bcd\u5b57\u4f53',
  abstract_keywords_size_pt: '\u4e2d\u6587\u5173\u952e\u8bcd\u5b57\u53f7',
  english_abstract_heading_font: 'Abstract \u5b57\u4f53',
  english_abstract_heading_size_pt: 'Abstract \u5b57\u53f7',
  english_abstract_heading_align: 'Abstract \u5bf9\u9f50',
  english_abstract_body_font: '\u82f1\u6587\u6458\u8981\u6b63\u6587\u5b57\u4f53',
  english_abstract_body_size_pt: '\u82f1\u6587\u6458\u8981\u6b63\u6587\u5b57\u53f7',
  english_abstract_body_line_spacing: '\u82f1\u6587\u6458\u8981\u884c\u8ddd',
  english_keywords_font: 'Keywords \u5b57\u4f53',
  english_keywords_size_pt: 'Keywords \u5b57\u53f7',
  toc_heading_font: '\u76ee\u5f55\u6807\u9898\u5b57\u4f53',
  toc_heading_size_pt: '\u76ee\u5f55\u6807\u9898\u5b57\u53f7',
  toc_heading_align: '\u76ee\u5f55\u6807\u9898\u5bf9\u9f50',
  toc_body_font: '\u76ee\u5f55\u6b63\u6587\u5b57\u4f53',
  toc_body_size_pt: '\u76ee\u5f55\u6b63\u6587\u5b57\u53f7',
  toc_body_line_spacing: '\u76ee\u5f55\u6b63\u6587\u884c\u8ddd',
  header_text: '\u9875\u7709\u6587\u5b57',
  header_font: '\u9875\u7709\u5b57\u4f53',
  header_size_pt: '\u9875\u7709\u5b57\u53f7',
  header_line_spacing: '\u9875\u7709\u884c\u8ddd',
  header_distance_cm: '\u9875\u7709\u8ddd\u79bb',
  page_number_font: '\u9875\u7801\u5b57\u4f53',
  page_number_size_pt: '\u9875\u7801\u5b57\u53f7',
  page_number_align: '\u9875\u7801\u5bf9\u9f50',
  page_number_bottom_cm: '\u9875\u7801\u4e0b\u8fb9\u8ddd',
  caption_font: '\u56fe\u8868\u9898\u6ce8\u5b57\u4f53',
  caption_size_pt: '\u56fe\u8868\u9898\u6ce8\u5b57\u53f7',
  figure_caption_align: '\u56fe\u9898\u5bf9\u9f50',
  table_caption_align: '\u8868\u9898\u5bf9\u9f50',
}

function formatFileSize(size) {
  if (!size) return '0 KB'
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatPt(value) {
  return `${Number(value || 0).toFixed(value % 1 === 0 ? 0 : 1)} pt`
}

function formatCm(value) {
  return `${Number(value || 0).toFixed(value % 1 === 0 ? 0 : 2)} cm`
}

function formatDateTime(value) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function getAlignLabel(value) {
  return ALIGN_OPTIONS.find((item) => item.value === value)?.label || TEXT.heading1Align
}

function normalizeNoteText(note) {
  const text = String(note || '').replace(/^[：:、，,\s]+/, '').trim()
  return text || note
}

function formatRequirementValue(key, value) {
  if (key.endsWith('_align')) return getAlignLabel(value)
  if (key === 'add_page_number' || key === 'chapter_page_break') return value ? '\u5f00\u542f' : '\u5173\u95ed'
  if (key.includes('_size_pt') || key === 'body_size_pt' || key === 'table_size_pt') return formatPt(value)
  if (key.includes('_line_spacing') || key === 'line_spacing' || key === 'reference_line_spacing') {
    return `${Number(value)} \u500d`
  }
  if (
    key.includes('_indent_cm') ||
    key.startsWith('margin_') ||
    key === 'first_line_indent_cm' ||
    key === 'reference_hanging_indent_cm' ||
    key === 'header_distance_cm' ||
    key === 'page_number_bottom_cm'
  ) {
    return formatCm(value)
  }
  return String(value)
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function getCheckStatusMeta(status) {
  if (status === 'done') return { label: '\u5df2\u547d\u4e2d', tone: 'done', Icon: CheckCircle2 }
  if (status === 'warn') return { label: '\u9700\u590d\u6838', tone: 'warn', Icon: AlertTriangle }
  return { label: '\u63d0\u793a', tone: 'info', Icon: Info }
}

function SelectField({ label, value, options, onChange, highlighted = false }) {
  return (
    <label className={`paper-format__field${highlighted ? ' is-highlighted' : ''}`}>
      <span>{label}</span>
      <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {options.map((item) => (
          <option key={`${label}-${item.value}`} value={String(item.value)}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function PaperFormatPage() {
  const inputRef = useRef(null)
  const templateInputRef = useRef(null)
  const requirementTextareaRef = useRef(null)
  const [profiles, setProfiles] = useState([])
  const [profile, setProfile] = useState('undergraduate_cn')
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [requirements, setRequirements] = useState(DEFAULT_REQUIREMENTS)
  const [customRequirements, setCustomRequirements] = useState({})
  const [requirementText, setRequirementText] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [parseNotes, setParseNotes] = useState([])
  const [baseProfileKey, setBaseProfileKey] = useState('undergraduate_cn')
  const [showConfirmCard, setShowConfirmCard] = useState(false)
  const [aiDetectedFields, setAiDetectedFields] = useState([])
  const [recentDrafts, setRecentDrafts] = useState([])
  const [templateFile, setTemplateFile] = useState(null)
  const [isExtractingTemplate, setIsExtractingTemplate] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadProfiles() {
      try {
        const payload = await fetchPaperFormatProfiles()
        if (cancelled) return
        const nextProfiles = payload?.profiles || []
        const nextProfileKey = payload?.default_profile || 'undergraduate_cn'
        setProfiles(nextProfiles)
        setProfile(nextProfileKey)
        setBaseProfileKey(nextProfileKey)
        setCustomRequirements({})
        setAiDetectedFields([])
        const profileItem = nextProfiles.find((item) => item.key === nextProfileKey)
        if (profileItem?.requirements) {
          setRequirements({ ...DEFAULT_REQUIREMENTS, ...profileItem.requirements })
        }
      } catch {
        if (!cancelled) setProfiles([])
      }
    }

    loadProfiles()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const element = requirementTextareaRef.current
    if (!element) return
    const maxHeight = 220
    element.style.height = '0px'
    const nextHeight = Math.min(element.scrollHeight, maxHeight)
    element.style.height = `${Math.max(72, nextHeight)}px`
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [requirementText])

  useEffect(() => {
    let cancelled = false

    async function loadRecentDrafts() {
      try {
        const records = await listRecentPaperFormatDrafts()
        if (!cancelled) setRecentDrafts(records)
      } catch {
        if (!cancelled) setRecentDrafts([])
      }
    }

    loadRecentDrafts()
    return () => {
      cancelled = true
    }
  }, [])

  const profileOptions = profiles.length ? profiles : FALLBACK_PROFILES

  const selectedProfile = useMemo(
    () => profiles.find((item) => item.key === profile) || profiles[0] || profileOptions[0] || null,
    [profile, profiles, profileOptions],
  )

  const pendingRequirements = profile === 'custom' ? customRequirements : requirements

  const pendingFieldEntries = useMemo(() => {
    const source = pendingRequirements || {}
    return Object.keys(source)
      .filter((key) => FIELD_LABELS[key] != null)
      .map((key) => ({
        key,
        label: FIELD_LABELS[key],
        value: formatRequirementValue(key, source[key]),
      }))
  }, [pendingRequirements])

  const resultFieldEntries = useMemo(() => {
    const executedKeys = result?.stats?.explicit_requirements || []
    const appliedRequirements = result?.stats?.requirements || {}
    if (!Array.isArray(executedKeys)) return []
    return executedKeys
      .filter((key) => FIELD_LABELS[key] != null && appliedRequirements[key] !== undefined)
      .map((key) => ({
        key,
        label: FIELD_LABELS[key],
        value: formatRequirementValue(key, appliedRequirements[key]),
      }))
  }, [result])

  const resultUsedCustomMode = result?.stats?.profile === 'custom'
  const highlightedFieldKeys = useMemo(
    () => new Set(profile === 'custom' ? aiDetectedFields : []),
    [aiDetectedFields, profile],
  )
  function isFieldHighlighted(key) {
    return highlightedFieldKeys.has(key)
  }
  const executionReport = result?.stats?.execution_report || null
  const reportChecks = executionReport?.checks || []
  const unsupportedNotes = executionReport?.unsupported_notes || []
  const sectionCount = Object.keys(result?.stats?.sections || {}).length
  const reportSummaryItems = useMemo(() => {
    const warningCount =
      reportChecks.filter((item) => item.status === 'warn').length + unsupportedNotes.length + parseNotes.length
    return [
      {
        key: 'applied',
        label: TEXT.reportSummaryApplied,
        value: executionReport?.applied_count ?? resultFieldEntries.length,
      },
      {
        key: 'sections',
        label: TEXT.reportSummarySections,
        value: sectionCount,
      },
      {
        key: 'references',
        label: TEXT.reportSummaryReferences,
        value: result?.stats?.reference_items || 0,
      },
      {
        key: 'warnings',
        label: TEXT.reportSummaryWarnings,
        value: warningCount,
      },
    ]
  }, [executionReport, parseNotes.length, reportChecks, result?.stats?.reference_items, resultFieldEntries.length, sectionCount])

  function getProfileRequirementDefaults(profileKey) {
    const profileItem = profiles.find((item) => item.key === profileKey)
    if (profileItem?.requirements) {
      return { ...DEFAULT_REQUIREMENTS, ...profileItem.requirements }
    }
    return { ...DEFAULT_REQUIREMENTS }
  }

  function updateRequirement(key, value) {
    setRequirements((current) => ({ ...current, [key]: value }))
    if (profile === 'custom') {
      setCustomRequirements((current) => ({ ...current, [key]: value }))
    }
  }

  function updateNumberRequirement(key, value) {
    updateRequirement(key, Number(value))
  }

  function applyProfileRequirements(nextProfile) {
    if (nextProfile === 'custom') {
      setProfile('custom')
      return
    }
    setProfile(nextProfile)
    setBaseProfileKey(nextProfile)
    setCustomRequirements({})
    setAiDetectedFields([])
    const profileItem = profiles.find((item) => item.key === nextProfile)
    if (profileItem?.requirements) {
      setRequirements({ ...DEFAULT_REQUIREMENTS, ...profileItem.requirements })
    } else {
      setRequirements(DEFAULT_REQUIREMENTS)
    }
  }

  function resetToProfileDefaults() {
    const nextProfile = profile === 'custom' ? (baseProfileKey || selectedProfile?.key || 'undergraduate_cn') : profile
    applyProfileRequirements(nextProfile)
  }

  async function handleParseRequirements() {
    const text = requirementText.trim()
    if (!text) {
      setError(TEXT.noText)
      return
    }
    setIsParsing(true)
    setError('')
    setParseNotes([])
    try {
      const payload = await parsePaperFormatRequirements(text)
      const parsed = payload?.requirements || {}
      if (!Object.keys(parsed).length) {
        setError(TEXT.parseEmpty)
        return
      }
      const nextBaseKey = payload?.matched_profile_key || baseProfileKey || selectedProfile?.key || 'undergraduate_cn'
      setBaseProfileKey(nextBaseKey)
      setRequirements({ ...getProfileRequirementDefaults(nextBaseKey), ...parsed })
      setCustomRequirements(parsed)
      setAiDetectedFields(Object.keys(parsed))
      setProfile('custom')
      setParseNotes(payload?.notes || [])
    } catch (err) {
      setError(err?.message || TEXT.parseFail)
    } finally {
      setIsParsing(false)
    }
  }

  function pickFile(nextFile) {
    setError('')
    setResult(null)
    if (!nextFile) {
      setFile(null)
      return
    }
    if (!nextFile.name.toLowerCase().endsWith('.docx')) {
      setError(TEXT.fileTypeError)
      setFile(null)
      return
    }
    setFile(nextFile)
  }

  async function pickTemplateFile(nextFile) {
    setError('')
    if (!nextFile) {
      setTemplateFile(null)
      return
    }
    if (!/\.(docx|doc)$/i.test(nextFile.name)) {
      setError(TEXT.templateTypeError)
      setTemplateFile(null)
      return
    }
    setTemplateFile(nextFile)
    setIsExtractingTemplate(true)
    setParseNotes([])
    try {
      const payload = await extractPaperFormatTemplate(nextFile)
      const extracted = payload?.requirements || {}
      if (!Object.keys(extracted).length) {
        setError(TEXT.templateEmpty)
        return
      }
      const matchedProfileKey = payload?.matched_profile_key || ''
      const nextBaseKey = matchedProfileKey || baseProfileKey || selectedProfile?.key || 'undergraduate_cn'
      const baseRequirements = matchedProfileKey ? getProfileRequirementDefaults(nextBaseKey) : {}
      const nextCustomRequirements = { ...baseRequirements, ...extracted }
      const nextRequirements = { ...getProfileRequirementDefaults(nextBaseKey), ...extracted }
      setBaseProfileKey(nextBaseKey)
      setRequirements(nextRequirements)
      setCustomRequirements(nextCustomRequirements)
      setAiDetectedFields(Object.keys(nextCustomRequirements))
      setProfile('custom')
      setParseNotes(payload?.notes || [])
    } catch (err) {
      setError(err?.message || TEXT.templateExtractFail)
    } finally {
      setIsExtractingTemplate(false)
    }
  }

  async function submitNormalization() {
    if (!file) {
      setError(TEXT.fileRequired)
      return
    }
    setIsSubmitting(true)
    setError('')
    setResult(null)
    try {
      const payload = await normalizePaperFormat(
        file,
        profile,
        pendingRequirements,
      )
      setResult(payload)
      try {
        const nextDrafts = await saveRecentPaperFormatDraft({
          fileName: payload.fileName,
          sourceName: file.name,
          size: payload.blob?.size || 0,
          savedAt: Date.now(),
          blob: payload.blob,
        })
        setRecentDrafts(nextDrafts)
      } catch {
        void 0
      }
      downloadBlob(payload.blob, payload.fileName)
    } catch (err) {
      setError(err?.message || TEXT.submitFail)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSubmit() {
    if (!file) {
      setError(TEXT.fileRequired)
      return
    }
    setShowConfirmCard(true)
  }

  async function handleConfirmSubmit() {
    setShowConfirmCard(false)
    await submitNormalization()
  }

  async function handleDownloadRecentDraft(item) {
    if (!(item?.blob instanceof Blob)) return
    downloadBlob(item.blob, item.fileName || 'normalized-paper.docx')
  }

  async function handleDeleteRecentDraft(id) {
    try {
      const records = await deleteRecentPaperFormatDraft(id)
      setRecentDrafts(records)
    } catch {
      void 0
    }
  }

  return (
    <section className="paper-format paper-format--minimal">
      <div className="paper-format__head">
        <div>
          <p className="panel-label">Format Normalizer</p>
          <h2>{TEXT.pageTitle}</h2>
          <span>{TEXT.pageHint}</span>
        </div>
        <button
          type="button"
          className={`home-primary-button paper-format__generate-button${isSubmitting ? ' is-generating' : ''}`}
          disabled={isSubmitting || !file}
          onClick={handleSubmit}
        >
          {isSubmitting ? <Loader2 className="paper-format__spin" /> : <FileCheck2 />}
          <span>{isSubmitting ? TEXT.generating : TEXT.generate}</span>
        </button>
      </div>

      {showConfirmCard ? (
        <div className="paper-format__confirm-modal" role="dialog" aria-modal="true" aria-labelledby="paper-format-confirm-title">
          <button type="button" className="paper-format__confirm-backdrop" onClick={() => setShowConfirmCard(false)} aria-label="close" />
          <div className="paper-format__confirm-card">
            <div className="paper-format__confirm-head">
              <div>
                <strong id="paper-format-confirm-title">{TEXT.confirmTitle}</strong>
                <span>{profile === 'custom' ? TEXT.confirmHintCustom : TEXT.confirmHintProfile}</span>
              </div>
              <button type="button" className="paper-format__confirm-close" onClick={() => setShowConfirmCard(false)}>
                <X />
              </button>
            </div>

            <div className="paper-format__confirm-body">
              {pendingFieldEntries.length ? (
                <div className="paper-format__confirm-grid">
                  {pendingFieldEntries.map((item) => (
                    <div key={item.key} className="paper-format__confirm-item">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="paper-format__confirm-empty">{TEXT.confirmEmpty}</p>
              )}
            </div>

            <div className="paper-format__confirm-actions">
              <button type="button" className="home-secondary-button" onClick={() => setShowConfirmCard(false)}>
                {TEXT.confirmCancel}
              </button>
              <button type="button" className="home-primary-button paper-format__generate-button" onClick={handleConfirmSubmit}>
                {TEXT.confirmSubmit}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="paper-format__workspace">
        <main className="paper-format__main">
          <section className="paper-format__panel paper-format__panel--ai">
            <div className="paper-format__panel-head">
              <Sparkles />
              <div className="paper-format__panel-head-copy">
                <strong>{TEXT.aiTitle}</strong>
                <span>{TEXT.aiHint}</span>
              </div>
              <button
                type="button"
                className={`home-secondary-button paper-format__parse-button${isParsing ? ' is-parsing' : ''}`}
                disabled={isParsing || !requirementText.trim()}
                onClick={handleParseRequirements}
              >
                {isParsing ? <Loader2 className="paper-format__spin" /> : <Sparkles />}
                <span>{isParsing ? TEXT.aiParsing : TEXT.aiFill}</span>
              </button>
            </div>
            <textarea
              ref={requirementTextareaRef}
              value={requirementText}
              onChange={(event) => setRequirementText(event.target.value)}
              placeholder={TEXT.aiPlaceholder}
            />
          </section>

          <section className="paper-format__panel paper-format__upload paper-format__template-upload">
            <input
              ref={templateInputRef}
              type="file"
              accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => pickTemplateFile(event.target.files?.[0])}
            />
            <div className="paper-format__upload-head">
              <div className="paper-format__upload-icon">
                <FileCheck2 />
              </div>
              <div className="paper-format__upload-copy">
                <strong>{templateFile ? templateFile.name : TEXT.templateTitle}</strong>
                <span>
                  {templateFile
                    ? isExtractingTemplate
                      ? TEXT.templateExtracting
                      : formatFileSize(templateFile.size)
                    : TEXT.templateHintLegacy}
                </span>
              </div>
              <button
                type="button"
                className="home-secondary-button"
                disabled={isExtractingTemplate}
                onClick={() => templateInputRef.current?.click()}
              >
                {isExtractingTemplate ? <Loader2 className="paper-format__spin" /> : <FileText />}
                <span>{isExtractingTemplate ? TEXT.templateExtracting : TEXT.templatePick}</span>
              </button>
            </div>
          </section>

          <section
            className={`paper-format__panel paper-format__upload${isDragging ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragging(false)
              pickFile(event.dataTransfer.files?.[0])
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
            <div className="paper-format__upload-head">
              <div className="paper-format__upload-icon">
                <UploadCloud />
              </div>
              <div className="paper-format__upload-copy">
                <strong>{file ? file.name : TEXT.uploadTitle}</strong>
                <span>{file ? formatFileSize(file.size) : TEXT.uploadHint}</span>
              </div>
              <button type="button" className="home-secondary-button" onClick={() => inputRef.current?.click()}>
                <FileText />
                <span>{TEXT.pickFile}</span>
              </button>
            </div>
          </section>

          <section className="paper-format__panel paper-format__recent">
            <div className="paper-format__recent-head">
              <div className="paper-format__recent-icon">
                <Clock3 />
              </div>
              <div className="paper-format__recent-copy">
                <strong>{TEXT.recentDraftsTitle}</strong>
                <span>{TEXT.recentDraftsHint}</span>
              </div>
            </div>

            {recentDrafts.length ? (
              <div className="paper-format__recent-list">
                {recentDrafts.map((item) => (
                  <div key={item.id} className="paper-format__recent-item">
                    <div className="paper-format__recent-item-copy">
                      <strong>{item.fileName}</strong>
                      <span>
                        {formatFileSize(item.size)}
                        {item.sourceName ? ` · ${TEXT.recentDraftSource} ${item.sourceName}` : ''}
                      </span>
                      <span>{formatDateTime(item.savedAt)}</span>
                    </div>
                    <div className="paper-format__recent-actions">
                      <button
                        type="button"
                        className="home-secondary-button"
                        onClick={() => handleDownloadRecentDraft(item)}
                      >
                        <Download />
                        <span>{TEXT.recentDraftsDownload}</span>
                      </button>
                      <button
                        type="button"
                        className="paper-format__ghost-button paper-format__ghost-button--danger"
                        onClick={() => handleDeleteRecentDraft(item.id)}
                        aria-label={TEXT.recentDraftsDelete}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="paper-format__recent-empty">{TEXT.recentDraftsEmpty}</p>
            )}
          </section>

          {error || parseNotes.length || result ? (
            <section className="paper-format__feedback-stack" aria-label={TEXT.reportTitle}>
              {error ? <div className="paper-format__message is-error">{error}</div> : null}

              {parseNotes.length ? (
                <div className="paper-format__message is-note">
                  <strong>{TEXT.notesTitle}</strong>
                  <div className="paper-format__note-list">
                    {parseNotes.map((note) => (
                      <span key={note}>{normalizeNoteText(note)}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {result ? (
                <>
                  <div className="paper-format__message is-success">
                    <CheckCircle2 />
                    <span>
                      {TEXT.resultPrefix} {result.stats?.paragraphs || 0} {TEXT.resultMiddle} {result.stats?.heading_1 || 0} {TEXT.resultSuffix}
                    </span>
                    <button type="button" onClick={() => downloadBlob(result.blob, result.fileName)} title={TEXT.downloadAgain}>
                      <Download />
                    </button>
                  </div>

                  <section className="paper-format__report" aria-label={TEXT.reportTitle}>
                    <div className="paper-format__report-head">
                      <strong>{TEXT.reportTitle}</strong>
                      <span>{resultUsedCustomMode ? TEXT.reportHintCustom : TEXT.reportHintProfile}</span>
                    </div>

                    <div className="paper-format__report-stats">
                      {reportSummaryItems.map((item) => (
                        <div key={item.key} className="paper-format__report-stat">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="paper-format__report-block">
                      <div className="paper-format__report-label">{TEXT.reportChangedTitle}</div>
                      {resultFieldEntries.length ? (
                        <div className="paper-format__confirm-grid paper-format__confirm-grid--report">
                          {resultFieldEntries.map((item) => (
                            <div key={item.key} className="paper-format__confirm-item">
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="paper-format__confirm-empty">{TEXT.reportEmpty}</p>
                      )}
                    </div>

                    {reportChecks.length ? (
                      <div className="paper-format__report-block">
                        <div className="paper-format__report-label">{TEXT.reportCheckTitle}</div>
                        <div className="paper-format__report-checklist">
                          {reportChecks.map((item) => {
                            const meta = getCheckStatusMeta(item.status)
                            const StatusIcon = meta.Icon
                            return (
                              <div key={item.key} className={`paper-format__report-check is-${meta.tone}`}>
                                <div className="paper-format__report-check-head">
                                  <div className="paper-format__report-check-title">
                                    <StatusIcon />
                                    <strong>{item.label}</strong>
                                  </div>
                                  <span>{meta.label}</span>
                                </div>
                                <p>{item.detail}</p>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="paper-format__report-note">
                      <div className="paper-format__report-label">{TEXT.reportKeptTitle}</div>
                      <p>{resultUsedCustomMode ? TEXT.reportKeptCustom : TEXT.reportKeptProfile}</p>
                    </div>

                    {parseNotes.length ? (
                      <div className="paper-format__report-note is-warn">
                        <div className="paper-format__report-label">{TEXT.reportNeedsConfirmTitle}</div>
                        <div className="paper-format__report-list">
                          {parseNotes.map((note) => (
                            <span key={note}>{normalizeNoteText(note)}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {unsupportedNotes.length ? (
                      <div className="paper-format__report-note is-warn">
                        <div className="paper-format__report-label">{TEXT.reportUnsupportedTitle}</div>
                        <div className="paper-format__report-list">
                          {unsupportedNotes.map((note) => (
                            <span key={note}>{note}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                </>
              ) : null}
            </section>
          ) : null}
        </main>

        <aside className="paper-format__side">
          <div className="paper-format__group">
            <label htmlFor="paper-format-profile">{TEXT.ruleSource}</label>
            <div className="paper-format__group-row">
              <select
                id="paper-format-profile"
                value={profile}
                onChange={(event) => applyProfileRequirements(event.target.value)}
              >
                {profile === 'custom' ? <option value="custom">{TEXT.customProfile}</option> : null}
                {profileOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}
                  </option>
                ))}
              </select>
              <button type="button" className="paper-format__ghost-button" onClick={resetToProfileDefaults}>
                <RotateCcw />
                <span>{TEXT.reset}</span>
              </button>
            </div>
          </div>

          <div className="paper-format__custom-scroll">
            <div className="paper-format__custom-grid">
              <div className="paper-format__section-title">{TEXT.common}</div>

              <SelectField
                label={TEXT.bodyFont}
                value={requirements.body_font}
                options={FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('body_font', value)}
                highlighted={isFieldHighlighted('body_font')}
              />
              <SelectField
                label={TEXT.latinFont}
                value={requirements.latin_font}
                options={LATIN_FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('latin_font', value)}
                highlighted={isFieldHighlighted('latin_font')}
              />
              <SelectField
                label={TEXT.bodySize}
                value={requirements.body_size_pt}
                options={BODY_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('body_size_pt', value)}
                highlighted={isFieldHighlighted('body_size_pt')}
              />
              <SelectField
                label={TEXT.lineSpacing}
                value={requirements.line_spacing}
                options={LINE_SPACING_OPTIONS}
                onChange={(value) => updateNumberRequirement('line_spacing', value)}
                highlighted={isFieldHighlighted('line_spacing')}
              />
              <SelectField
                label={TEXT.bodyAlign}
                value={requirements.body_align}
                options={ALIGN_OPTIONS}
                onChange={(value) => updateRequirement('body_align', value)}
                highlighted={isFieldHighlighted('body_align')}
              />
              <SelectField
                label={TEXT.indent}
                value={requirements.first_line_indent_cm}
                options={INDENT_OPTIONS}
                onChange={(value) => updateNumberRequirement('first_line_indent_cm', value)}
                highlighted={isFieldHighlighted('first_line_indent_cm')}
              />

              <div className="paper-format__section-title">{TEXT.headings}</div>

              <SelectField
                label={TEXT.heading1Font}
                value={requirements.heading_1_font}
                options={FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('heading_1_font', value)}
                highlighted={isFieldHighlighted('heading_1_font')}
              />
              <SelectField
                label={TEXT.heading1Size}
                value={requirements.heading_1_size_pt}
                options={HEADING_1_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('heading_1_size_pt', value)}
                highlighted={isFieldHighlighted('heading_1_size_pt')}
              />
              <SelectField
                label={TEXT.heading1Align}
                value={requirements.heading_1_align}
                options={ALIGN_OPTIONS.filter((item) => item.value !== 'justify')}
                onChange={(value) => updateRequirement('heading_1_align', value)}
                highlighted={isFieldHighlighted('heading_1_align')}
              />
              <SelectField
                label={TEXT.heading2Font}
                value={requirements.heading_2_font}
                options={FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('heading_2_font', value)}
                highlighted={isFieldHighlighted('heading_2_font')}
              />
              <SelectField
                label={TEXT.heading2Size}
                value={requirements.heading_2_size_pt}
                options={HEADING_2_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('heading_2_size_pt', value)}
                highlighted={isFieldHighlighted('heading_2_size_pt')}
              />
              <SelectField
                label={TEXT.heading2Align}
                value={requirements.heading_2_align}
                options={ALIGN_OPTIONS.filter((item) => item.value !== 'justify')}
                onChange={(value) => updateRequirement('heading_2_align', value)}
                highlighted={isFieldHighlighted('heading_2_align')}
              />
              <SelectField
                label={TEXT.heading3Font}
                value={requirements.heading_3_font}
                options={FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('heading_3_font', value)}
                highlighted={isFieldHighlighted('heading_3_font')}
              />
              <SelectField
                label={TEXT.heading3Size}
                value={requirements.heading_3_size_pt}
                options={HEADING_3_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('heading_3_size_pt', value)}
                highlighted={isFieldHighlighted('heading_3_size_pt')}
              />
              <SelectField
                label={TEXT.heading3Align}
                value={requirements.heading_3_align}
                options={ALIGN_OPTIONS.filter((item) => item.value !== 'justify')}
                onChange={(value) => updateRequirement('heading_3_align', value)}
                highlighted={isFieldHighlighted('heading_3_align')}
              />

              <div className="paper-format__section-title">{TEXT.layout}</div>

              <SelectField
                label={TEXT.marginTop}
                value={requirements.margin_top_cm}
                options={MARGIN_OPTIONS}
                onChange={(value) => updateNumberRequirement('margin_top_cm', value)}
                highlighted={isFieldHighlighted('margin_top_cm')}
              />
              <SelectField
                label={TEXT.marginBottom}
                value={requirements.margin_bottom_cm}
                options={MARGIN_OPTIONS}
                onChange={(value) => updateNumberRequirement('margin_bottom_cm', value)}
                highlighted={isFieldHighlighted('margin_bottom_cm')}
              />
              <SelectField
                label={TEXT.marginLeft}
                value={requirements.margin_left_cm}
                options={MARGIN_OPTIONS}
                onChange={(value) => updateNumberRequirement('margin_left_cm', value)}
                highlighted={isFieldHighlighted('margin_left_cm')}
              />
              <SelectField
                label={TEXT.marginRight}
                value={requirements.margin_right_cm}
                options={MARGIN_OPTIONS}
                onChange={(value) => updateNumberRequirement('margin_right_cm', value)}
                highlighted={isFieldHighlighted('margin_right_cm')}
              />
              <SelectField
                label={TEXT.tableSize}
                value={requirements.table_size_pt}
                options={TABLE_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('table_size_pt', value)}
                highlighted={isFieldHighlighted('table_size_pt')}
              />
              <label className={`paper-format__check${isFieldHighlighted('add_page_number') ? ' is-highlighted' : ''}`}>
                <input
                  type="checkbox"
                  checked={requirements.add_page_number}
                  onChange={(event) => updateRequirement('add_page_number', event.target.checked)}
                />
                <span>{TEXT.pageNumber}</span>
              </label>
              <label className={`paper-format__check${isFieldHighlighted('chapter_page_break') ? ' is-highlighted' : ''}`}>
                <input
                  type="checkbox"
                  checked={requirements.chapter_page_break}
                  onChange={(event) => updateRequirement('chapter_page_break', event.target.checked)}
                />
                <span>{TEXT.chapterPageBreak}</span>
              </label>

              <div className="paper-format__section-title">{TEXT.references}</div>

              <SelectField
                label={TEXT.referenceIndent}
                value={requirements.reference_hanging_indent_cm}
                options={INDENT_OPTIONS}
                onChange={(value) => updateNumberRequirement('reference_hanging_indent_cm', value)}
                highlighted={isFieldHighlighted('reference_hanging_indent_cm')}
              />
              <SelectField
                label={TEXT.referenceSpacing}
                value={requirements.reference_line_spacing}
                options={LINE_SPACING_OPTIONS}
                onChange={(value) => updateNumberRequirement('reference_line_spacing', value)}
                highlighted={isFieldHighlighted('reference_line_spacing')}
              />

              <div className="paper-format__section-title">{TEXT.appendix}</div>

              <SelectField
                label={TEXT.appendixEnglishFont}
                value={requirements.appendix_english_font}
                options={LATIN_FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('appendix_english_font', value)}
                highlighted={isFieldHighlighted('appendix_english_font')}
              />
              <SelectField
                label={TEXT.appendixEnglishSize}
                value={requirements.appendix_english_size_pt}
                options={TABLE_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('appendix_english_size_pt', value)}
                highlighted={isFieldHighlighted('appendix_english_size_pt')}
              />
              <SelectField
                label={TEXT.appendixEnglishSpacing}
                value={requirements.appendix_english_line_spacing}
                options={LINE_SPACING_OPTIONS}
                onChange={(value) => updateNumberRequirement('appendix_english_line_spacing', value)}
                highlighted={isFieldHighlighted('appendix_english_line_spacing')}
              />
              <SelectField
                label={TEXT.appendixTranslationFont}
                value={requirements.appendix_translation_font}
                options={FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('appendix_translation_font', value)}
                highlighted={isFieldHighlighted('appendix_translation_font')}
              />
              <SelectField
                label={TEXT.appendixTranslationSize}
                value={requirements.appendix_translation_size_pt}
                options={BODY_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('appendix_translation_size_pt', value)}
                highlighted={isFieldHighlighted('appendix_translation_size_pt')}
              />
              <SelectField
                label={TEXT.appendixTranslationSpacing}
                value={requirements.appendix_translation_line_spacing}
                options={LINE_SPACING_OPTIONS}
                onChange={(value) => updateNumberRequirement('appendix_translation_line_spacing', value)}
                highlighted={isFieldHighlighted('appendix_translation_line_spacing')}
              />
              <SelectField
                label={TEXT.appendixCodeFont}
                value={requirements.appendix_code_font}
                options={LATIN_FONT_OPTIONS.map((item) => ({ label: item, value: item }))}
                onChange={(value) => updateRequirement('appendix_code_font', value)}
                highlighted={isFieldHighlighted('appendix_code_font')}
              />
              <SelectField
                label={TEXT.appendixCodeSize}
                value={requirements.appendix_code_size_pt}
                options={TABLE_SIZE_OPTIONS}
                onChange={(value) => updateNumberRequirement('appendix_code_size_pt', value)}
                highlighted={isFieldHighlighted('appendix_code_size_pt')}
              />
              <SelectField
                label={TEXT.appendixCodeSpacing}
                value={requirements.appendix_code_line_spacing}
                options={LINE_SPACING_OPTIONS}
                onChange={(value) => updateNumberRequirement('appendix_code_line_spacing', value)}
                highlighted={isFieldHighlighted('appendix_code_line_spacing')}
              />
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
