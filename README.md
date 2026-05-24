# Paper Reader

面向论文阅读、笔记、摘要、文献矩阵和格式检查的前后端项目。

## 项目结构

```text
codexwork/
├─ frontend/              # Vite + React 前端
│  ├─ src/app/            # 应用装配入口
│  ├─ src/components/     # 页面和可复用组件
│  ├─ src/hooks/          # 阅读器和交互 hooks
│  ├─ src/services/       # API 请求封装
│  └─ src/styles/         # 全局和页面样式
├─ backend/               # FastAPI 后端
│  ├─ app/api/routes/     # API 路由
│  ├─ app/models/         # 数据模型
│  ├─ app/schemas/        # 请求/响应模型
│  ├─ app/services/       # 业务逻辑
│  └─ tests/              # 后端测试
└─ check-before-deploy.ps1 # 部署前检查
```

## 本地运行

### 后端

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

### 前端

```powershell
cd frontend
npm install
npm run dev
```

## 常用检查

```powershell
# 后端测试
cd backend
python -m unittest discover -s tests

# 前端测试和构建
cd frontend
npm test
npm run build

# 部署前整体验证
cd ..
.\check-before-deploy.ps1
```

## 改进优先级

1. 先保证质量门禁可一键运行：测试、构建、路由 smoke check、敏感信息扫描。
2. 再清理技术债：ESLint 错误、大组件、大 CSS、重复请求处理。
3. 最后做深层优化：PDF 渲染、文献矩阵长任务、数据库迁移、接口限流和监控。

## License and Source Code

This project is distributed under the GNU Affero General Public License v3.0
or later. See [LICENSE](./LICENSE).

Source code for the network service is available at:

https://github.com/xk271521-droid/xk__reader

Third party dependency notes are documented in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
