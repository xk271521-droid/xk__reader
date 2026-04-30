# Paper Reader MVP

当前版本已经完成项目骨架，并接入了 `pdf.js` 单篇阅读页。

## 目录结构

```text
codexwork/
├─ frontend/
│  ├─ src/
│  │  ├─ app/            # 页面装配
│  │  ├─ components/     # 复用组件
│  │  ├─ hooks/          # 交互逻辑
│  │  ├─ services/       # 接口请求
│  │  └─ styles/         # 样式文件
│  └─ ...
├─ backend/
│  ├─ app/
│  │  ├─ api/            # 路由入口
│  │  ├─ core/           # 配置
│  │  ├─ schemas/        # 请求/响应模型
│  │  └─ services/       # 业务逻辑
│  ├─ main.py            # uvicorn 兼容入口
│  └─ requirements.txt
└─ README.md
```

## 运行方式

### 1. 启动后端

```powershell
cd D:\codexwork\backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

### 2. 启动前端

```powershell
cd D:\codexwork\frontend
npm install
npm run dev
```

## 当前已完成

- React 单篇阅读页
- `pdf.js` 本地 PDF 上传与渲染
- 上一页 / 下一页 / 页码 / 缩放
- 右侧固定翻译解释面板
- FastAPI 健康检查接口
- 划词后自动请求解释接口
- mock 翻译与术语解释返回
- 前后端按模块拆分，便于继续扩展

## 下一步

- 保存笔记和高亮
- 实现批注模式
- 接入真实 AI 翻译解释服务
