# 项目改进清单

更新时间：2026-05-24

## 本轮已处理

- [x] 去掉“我的文献”页多余内部滚轮，并把文献页布局 CSS 拆到 `home-library.css`。
- [x] Home 页面重型模块支持 hover/focus 预加载，搜索过滤改为 deferred，减少输入卡顿。
- [x] ECharts 改为按需动态加载，并拆分导出/图表 vendor chunk。
- [x] 前端新增 `npm test`、`npm run check`、`npm run lint`、`npm run lint:report`、`npm run check:strict`。
- [x] 部署前检查新增后端 unittest 和前端 Node test。
- [x] 根目录 README 和后端验证说明改为可读中文。
- [x] `.gitignore` 补充日志、zip 部署包和临时目录忽略规则。

## 下一批优先解决

- [ ] 清理 ESLint 存量问题：当前报告显示 145 个 error、42 个 warning，先从 `App.jsx`、`ResearchMatrixPage.jsx`、`PdfViewport.jsx`、`SideWorkspacePanel.jsx` 下手。
- [ ] 拆分超大文件：`app.css`、`ResearchMatrixPage.jsx`、`SideWorkspacePanel.jsx`、`App.jsx`、`backend/app/services/research_matrix.py`。
- [ ] 建统一前端 `apiClient`：集中处理 token、401、超时、AbortController、错误消息和 JSON 解析。
- [ ] 用应用内 Dialog/Toast 替换 `window.alert` / `window.confirm`。
- [ ] 扩展后端测试：认证、论文上传/删除、任务中心、会员权限、研究矩阵重试。
- [ ] 梳理数据库迁移：确认 Alembic 配置、建表迁移、索引和初始化数据。
- [ ] 继续拆页面级 CSS，压低 `index.css` 体积。
- [ ] 针对 PDF 阅读器做性能专项：缩略图懒加载、页面渲染取消、长文档滚动性能。

## 验证命令

```powershell
cd backend
python -m unittest discover -s tests

cd ..\frontend
npm test
npm run build

cd ..
.\check-before-deploy.ps1
```
