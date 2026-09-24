# 选词翻译服务切换

## 状态

- 状态：百度/腾讯主链路已完成；SiliconFlow 四模型备用链路待实现
- 日期：2026-08-08
- 范围：网页前端、共用后端；桌面端通过重新打包复用前端改动。

## 目标

在阅读器“即时理解”面板右上角提供翻译服务下拉列表。用户可在百度翻译、腾讯机器翻译和 SiliconFlow 四个模型之间切换；切换后立即重新翻译当前选词，默认百度翻译。

## 实施约束

1. 供应商选择随当前浏览器保存，不写入论文或用户业务数据。
2. 百度/腾讯按用户选择严格执行；SiliconFlow 模型按用户选择执行，只有明确开启“模型备用”时才允许按 GLM-4 → Qwen3 → GLM-Z1 → Hunyuan 兜底。
3. 腾讯云凭据只保存到服务器环境变量，前端不得获取或保存密钥。
4. 服务未配置、鉴权失败或额度不足时，界面显示明确错误并保留用户当前选择。

## 实施计划

1. 后端请求模型增加 `translation_provider`，允许 `baidu`、`tencent` 和四个 SiliconFlow 模型标识。
2. 将选词翻译从“百度优先、腾讯兜底”调整为严格按所选供应商执行；模型备用只在用户显式开启时触发。
3. 前端记录所选供应商，切换时取消旧请求并重发当前选词。
4. 在即时理解标题右侧加入可访问的原生下拉列表。
5. 补充前后端测试，完成前端构建验证。

## 跟随翻译浮层

### 目标

在“即时理解”面板提供“跟随”开关。开启后，用户在 PDF 中重新选词时，会在选区附近显示紧凑的译文浮层；右侧完整即时理解面板继续保留。浮层必须复用同一条即时理解请求，避免重复调用翻译服务。

### 实施方案

1. 跟随偏好只保存到本地浏览器，默认关闭；关闭浮层只影响本次选词，不关闭偏好。
2. 原生 PDF 与 PDFium 两种阅读引擎分别传出可追踪的选区锚点，浮层统一渲染到页面根节点，避免被 PDF 滚动区裁切。
3. 浮层首次优先显示在选区下方，空间不足时显示在上方；用户拖动后固定在阅读正文区内，PDF 滚动不会让浮层消失，窗口变化只做边界保护。
4. 浮层显示原文、译文、翻译来源、加载/错误状态和复制/关闭操作；不发起额外翻译请求。
5. 增加坐标定位单元测试，并完成前端测试、构建和桌面端重新打包。

## 腾讯云配置

需要腾讯云 API 密钥：`SecretId` 与 `SecretKey`，并授予该密钥机器翻译（TMT）调用权限。生产服务器的 `backend/.env` 需要配置：

```env
TENCENT_MT_ENABLED=true
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TENCENT_MT_REGION=ap-guangzhou
```

2026-08-09: Refined the insight header controls into one quiet two-row group while keeping provider and follow actions aligned with the two-line title.
2026-08-09: Added a persisted collapse/expand control for the insight panel. The follow translation portal remains independent so its floating panel stays visible when the sidebar is hidden.
2026-08-09: Moved the collapse action into the follow row so the translation provider keeps its full width and related translation controls stay grouped together.
2026-08-09: Replaced the provider select background arrow with an explicit ChevronDown icon so the dropdown affordance remains visible under the reader theme overrides.
2026-08-10: Follow panel paragraphs no longer truncate; the panel can scroll up to 420px, and the last dragged coordinate is retained in memory for subsequent selections during the reading session.
2026-08-10: Stabilized follow visibility by snapshotting the selection's client rectangle before the temporary selection menu unmounts, and retrying EmbedPDF text retrieval during its short update race.
2026-08-10: Follow positioning now refreshes on PDF/window scrolling and visual viewport changes, while manually dragged panels remain pinned and only receive boundary correction.
2026-08-11: Fixed a sticky hidden state where a dragged panel could keep `visibility: hidden` after an invalid anchor; restoring its clamped position now explicitly makes it visible again.

`TRANSLATION_ENGINE` 不影响本次选词下拉选择，无需为此改动。SiliconFlow 复用 AI 厂商配置中的接口和密钥，前端只传模型标识；SiliconFlow 卡片不需要成为全局启用项，AI 精读/边读边问仍读取全局启用厂商。密钥只应写入服务器环境或已加密的 AI 厂商记录，不能提交到 Git 或放入前端。

## 变更记录

- 2026-08-08：确认现状为百度优先、腾讯兜底；该行为无法让用户稳定选择腾讯，改为显式供应商路由。
- 2026-08-08：完成下拉切换、严格供应商路由、错误反馈与自动化测试；前端测试 77 项通过，后端新增 3 项标准库测试通过，前端构建通过。
- 2026-08-09：按确认的配色稿完成即时理解面板样式，使用蓝色原文、青绿色译文、琥珀色术语标签和蓝色供应商下拉框。
- 2026-08-09：完成选词跟随翻译浮层；采用复用即时理解结果、根节点固定定位和双 PDF 引擎锚点适配，定位单测、前端测试、构建和桌面端打包均通过。
- 2026-08-09：根据使用反馈改为“首次贴近、之后固定”的悬浮模式；拖拽边界改为阅读正文区，滚动不再触发锚点重算。
- 2026-08-09：修复即时理解面板窄宽度排版；头部改为标题与控件两列、各自两行对齐，百度翻译和跟随开关不会再挤压标题。
- 2026-08-09：根据全文翻译模型实测结果，新增 SiliconFlow 四模型备用设计；默认仍为百度，腾讯保留为显式机器翻译选项。
- 2026-08-09：划词翻译下拉改为六个同级选项，移除 SiliconFlow 分组标题；模型显示名缩短为 `GLM-4`、`Qwen3`、`GLM-Z1`、`Hunyuan`，并统一居中。
