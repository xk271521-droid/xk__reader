# XK 阅读项目接手说明

这份文件是给后续 AI / Codex 看的。用户不是职业程序员，目标是让 AI 在新对话里也能稳定接手，不要让用户反复解释架构。

## 项目结构

- 网页版和后端主仓库：`C:\Users\xk\Desktop\codexwork`
- 桌面端 Electron 壳仓库：`C:\Users\xk\Desktop\paper-reader-desktop`
- 当前桌面快捷方式：`C:\Users\xk\Desktop\XK 阅读.lnk`
- 当前桌面程序：`C:\Users\xk\Desktop\paper-reader-desktop\release\XK 阅读\XK 阅读.exe`

## 核心原则

- 桌面端不是另写一套 UI。
- 桌面端必须打包并运行网页版前端，所以“网页版有的功能，桌面端也必须有”。
- 桌面独有功能只作为增强层出现，网页版不显示、不依赖。
- 网页版和桌面端共用同一个服务器后端，账号、文献、任务、AI、会员等数据保持一致。

## 改功能时怎么判断放哪里

1. 网页版和桌面端都要有的功能：
   - 改 `C:\Users\xk\Desktop\codexwork\frontend`
   - 如涉及接口，改 `C:\Users\xk\Desktop\codexwork\backend`
   - 完成后重新打包桌面端即可，不要在桌面仓库重写同一套功能。

2. 只有桌面端要有的能力：
   - 原生能力放在 `C:\Users\xk\Desktop\paper-reader-desktop`
   - 前端入口仍可写在 `codexwork/frontend`，但必须用桌面模式判断包起来。

3. 桌面模式判断：
   - 使用 `frontend/src/utils/desktopShell.js` 里的 `isDesktopShell()`
   - 不要到处手写 `window.paperDesktop`
   - 当前桌面壳会注入 `window.__PAPER_READER_DESKTOP__ = true`

示例：

```jsx
import { isDesktopShell } from '../utils/desktopShell'

const isDesktop = isDesktopShell()

return isDesktop ? <DesktopOnlyFeature /> : null
```

## 桌面端打包

每次网页版改完后，如果要让桌面端拿到新功能，运行：

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm run package:win
```

打包脚本会：

- 构建 `C:\Users\xk\Desktop\codexwork\frontend`
- 把构建产物复制到桌面端包内
- 使用同一个服务器后端：`http://47.99.141.123`
- 生成/更新桌面快捷方式 `C:\Users\xk\Desktop\XK 阅读.lnk`

## 常用验证

网页版前端：

```powershell
cd C:\Users\xk\Desktop\codexwork\frontend
npm test
npm run build
```

桌面端：

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm test
npm run package:win
```

## 已知关键点

- 登录页和主界面的“源码”入口在桌面模式下应隐藏。
- 桌面端登录页需要更快拿到输入焦点。
- 如果桌面端又出现“源码”或桌面专属功能不显示，优先检查桌面标记是否注入：
  - `window.paperDesktop`
  - `window.__PAPER_READER_DESKTOP__`
- PDF worker 需要由桌面本地服务器正确提供 `.mjs`，不要退回 `file://` 直接打开网页。

## 给新对话的建议开场

用户可以直接说：

“先读 `C:\Users\xk\Desktop\codexwork\AGENTS.md` 和 `C:\Users\xk\Desktop\paper-reader-desktop\AGENTS.md`，继续按这个架构开发：网页版核心 + 桌面增强层。”
