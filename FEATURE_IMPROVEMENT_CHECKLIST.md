# 功能改进清单

更新时间：2026-05-24

## 当前执行状态

- [x] 阅读现场恢复：按论文保存/恢复页码、缩放、右侧工作区面板和面板宽度。
- [x] 文献导入增强（第一阶段）：重复导入提示、导入进度、失败重试。
- [x] 文献导入增强（第二阶段）：导入后自动补全弱元数据，并在文献库/详情侧栏支持重新识别。
- [x] 标注笔记闭环：高亮摘录/截图可进入笔记，笔记来源可跳回 PDF 页码或原文字符位置。
- [x] 当前论文 AI 问答：基于当前 PDF 全文摘录、摘要和笔记回答，并要求输出页码引用。
- [x] 文献库高级筛选和批量操作：支持状态、作者、年份、关键词筛选，并支持批量移动、删除、重新识别元数据。
- [x] 研究矩阵模板：支持综述草稿、方法对比、实验结果、创新与局限模板。
- [x] 任务中心增强：支持取消、重试、失败原因复制、完成清理和结果跳转，并补充状态模型测试。
- [x] 导出增强：支持注释 PDF/Word、笔记 Markdown/Word、总结 PDF/Word、矩阵多阶段导出，以及当前文献引用 Markdown/BibTeX。

## 本轮新增落点

- `frontend/src/components/home/importMetadataModel.js`：判断导入元数据是否过弱、自动调用服务端重新识别并合并结果。
- `frontend/src/components/home/libraryWorkflowModel.js`：统一文献库作者/年份/关键词筛选与批量操作计划。
- `frontend/src/components/reader/paperChatContext.js`：构建带页码标记的当前论文问答上下文。
- `frontend/src/components/reader/noteAnchorModel.js`：统一笔记/证据跳转到 PDF 的定位模型。
- `frontend/src/components/layout/taskCenterModel.js`：任务中心筛选、计数和失败信息复制模型。
- `frontend/src/components/home/researchMatrixTemplates.js`：研究矩阵模板与创建 payload 模型。

## 验证

- 前端单元测试覆盖上述新增模型。
- 待执行：`npm test` 与 `npm run build`。
