# 后端验证说明

本文档记录后端本地验证和部署前检查方式。

## 基础验证

```powershell
cd backend
python -m compileall app
python -m unittest discover -s tests
```

## 路由 smoke check

根目录脚本 `check-before-deploy.ps1` 会导入 FastAPI 应用，读取 OpenAPI schema，并确认关键路由已经注册，包括：

- `/api/health`
- `/api/health/detail`
- `/api/events/stream`
- `/api/tasks`
- `/api/tasks/summary`
- `/api/tasks/archive`
- `/api/tasks/archive-completed`
- `/api/research-matrix/runs/status`
- `/api/research-matrix/runs/{run_id}/papers/{paper_id}/retry-review`

运行：

```powershell
cd ..
.\check-before-deploy.ps1
```

## 可选跳过项

```powershell
.\check-before-deploy.ps1 -SkipBackendCompile
.\check-before-deploy.ps1 -SkipBackendTests
.\check-before-deploy.ps1 -SkipFrontendTests
.\check-before-deploy.ps1 -SkipFrontendBuild
```

## 注意

- 正式部署前不要跳过敏感信息扫描。
- 本地 `.env`、上传文件、日志和部署压缩包不应进入 Git。
- 新增重要业务逻辑时，优先在 `backend/tests/` 补 unittest 用例。
