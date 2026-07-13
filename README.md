# 小苏e学刷课 v6.1 — 本地化部署指南

## 简介

**小苏e学刷课** 是一个基于 Node.js + Playwright 的云学堂（yunxuetang.cn）自动化学习脚本。它可以：

- 🎬 **自动监控视频播放** — 检测视频暂停并自动恢复播放，支持**视频快进**直接跳到末尾
- 📝 **自动完成随堂考试** — 使用序贯探索策略智能答题，通过多次尝试和分数反馈锁定正确答案
- 🔍 **多源答案提取** — 从 API 响应、Vue 组件数据、DOM 元素中自动提取正确答案
- ⏩ **智能课程跳过** — 自动检测已完成的课程并跳过
- 🔔 **桌面通知提醒** — 考试通过/失败、脚本异常时弹出系统通知

---

## 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | ≥ 18.0.0 | [下载 LTS 版本](https://nodejs.org/) |
| **Chrome / Chromium / Edge** | 最新版 | 任意 Chromium 内核浏览器均可 |
| **操作系统** | Windows 10+ / macOS 11+ / Linux | 已提供对应启动脚本 |

> 推荐使用 Chrome 浏览器，稳定性最佳。

---

## 快速开始（3 步）

### 第一步：下载项目

将整个 `xiaosu-autolearn` 文件夹放到你电脑上的任意目录。

### 第二步：启动 Chrome 调试模式

| 系统 | 操作 |
|------|------|
| **Windows** | 双击 `start-chrome.bat` |
| **macOS / Linux** | 终端执行 `./start-chrome.sh` |

这会打开一个全新的 Chrome 窗口，自动跳转到云学堂首页。

> ⚠ **重要**：这个 Chrome 窗口使用了独立的用户数据目录，不会影响你日常使用的 Chrome。
>
> 自定义端口：`start-chrome.bat --port 9223` 或 `./start-chrome.sh --port 9223`

### 第三步：登录并运行脚本

1. 在新打开的 Chrome 窗口中**登录云学堂**
2. 进入你要学习的**课程播放页面**（看到视频即可）
3. 运行自动化脚本：

| 系统 | 操作 |
|------|------|
| **Windows** | 双击 `run.bat` |
| **macOS / Linux** | 终端执行 `./run.sh` |

脚本会自动完成剩余工作：播放视频 → 自动答题 → 进入下一课。

---

## 工作流程说明

```
启动 Chrome 调试模式
       ↓
登录云学堂 → 进入课程播放页面
       ↓
运行 run.bat/run.sh
       ↓
┌──────────────────────────────────┐
│  脚本主循环（每 3 秒检查）          │
│                                  │
│  有视频 → 检查播放状态            │
│    ├─ 暂停 → 自动恢复播放         │
│    ├─ 播放中 → 快进到末尾 ✨      │
│    └─ 已结束 → 检查考试入口       │
│                                  │
│  有考试 → 自动答题               │
│    ├─ 单选题/判断题 → 智能选择     │
│    ├─ 多选题 → 组合枚举尝试       │
│    ├─ 提交 → 检查分数            │
│    ├─ 未通过 → 分析+重试         │
│    └─ 通过 → 桌面通知 🔔         │
│                                  │
│  课程已完成 → 智能跳过 ✨         │
│  无视频无考试 → 点击"下一个"      │
└──────────────────────────────────┘
```

---

## 文件结构

```
xiaosu-autolearn/
├── auto_learn_v6.js      # 核心自动化脚本
├── config.json           # 用户配置文件（自动生成，可编辑）
├── config.example.json   # 配置文件模板（参考用）
├── package.json          # 项目配置与依赖声明
├── start-chrome.bat      # Windows Chrome 启动器
├── start-chrome.sh       # macOS/Linux Chrome 启动器
├── run.bat               # Windows 一键运行
├── run.sh                # macOS/Linux 一键运行
├── .gitignore            # Git 忽略规则
├── auto_learn_v6.log     # 运行日志（自动生成）
└── README.md             # 本文件
```

---

## 配置说明（config.json）

首次运行 `run.bat` / `run.sh` 时，会自动生成 `config.json`。你可以编辑它来调整行为：

```json
{
  "cdpUrl": "http://localhost:9223",
  "checkInterval": 3000,
  "waitAfterVideoEnd": 2000,
  "maxRetry": 40,
  "videoFastForward": true,
  "fastForwardThreshold": 0.95,
  "smartSkipCompleted": true,
  "notificationEnabled": true,
  "logFile": "auto_learn_v6.log"
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `cdpUrl` | `http://localhost:9223` | Chrome 调试端口地址 |
| `checkInterval` | `3000` | 页面状态检查间隔（毫秒） |
| `waitAfterVideoEnd` | `2000` | 视频结束后等待跳转时间（毫秒） |
| `maxRetry` | `40` | 考试最大重试次数 |
| `videoFastForward` | `true` | 是否启用视频自动快进 |
| `fastForwardThreshold` | `0.95` | 快进触发阈值（进度低于此比例才快进） |
| `smartSkipCompleted` | `true` | 是否自动跳过已完成课程 |
| `notificationEnabled` | `true` | 是否启用桌面通知 |
| `logFile` | `auto_learn_v6.log` | 日志文件路径 |

---

## 常见问题

### Q: 提示 "connect ECONNREFUSED 127.0.0.1:9223"

**原因**：Chrome 调试端口未开启或 Chrome 未以调试模式启动。

**解决**：先运行 `start-chrome.bat`（或 `.sh`），确保 Chrome 以调试模式打开后再运行 `run.bat`。

### Q: 提示 "未找到 Node.js"

**原因**：系统未安装 Node.js 或未添加到 PATH。

**解决**：
1. 访问 https://nodejs.org/ 下载并安装 LTS 版本
2. macOS 用户也可用 Homebrew：`brew install node`
3. 安装后重新打开终端/命令行窗口

### Q: 提示 Node.js 版本过低

**原因**：Node.js 版本低于 v18。

**解决**：前往 https://nodejs.org/ 下载最新 LTS 版本并安装。

### Q: 提示依赖安装失败

**原因**：网络问题导致 npm install 失败。

**解决**：
1. 检查网络连接
2. 脚本已内置镜像源自动切换，通常会自动处理
3. 手动执行：`npm install --registry=https://registry.npmmirror.com`

### Q: 考试一直不过怎么办？

**原因**：考试题目较多或答案较复杂。

**说明**：脚本默认最多重试 40 次（可在 `config.json` 中修改 `maxRetry`）。序贯探索策略会通过分数变化逐步锁定正确答案，通常 10-20 次内可通过。

### Q: 视频快进太快/不想快进？

编辑 `config.json`，将 `videoFastForward` 设为 `false`。

### Q: 桌面通知没弹出来？

- Windows：确保系统通知中心已开启
- macOS：检查"系统设置 → 通知 → 终端"是否允许通知
- Linux：需要 `libnotify-bin` 包（`sudo apt install libnotify-bin`）
- `node-notifier` 是可选依赖，安装失败不影响脚本核心功能

### Q: 如何停止脚本？

按 `Ctrl + C` 即可停止。下次运行时会重新开始。

### Q: 可以同时刷多个课程吗？

不建议。脚本设计为单页面操作。如需多个课程，可依次完成。

### Q: 脚本会不会被检测到？

脚本通过 CDP 协议连接正常的 Chrome 浏览器，模拟真实用户操作（鼠标点击、页面交互），不使用 Selenium WebDriver 等可被检测的方式。

---

## 高级用法

### 自定义端口

如果你的 9223 端口被占用：

```bash
# Windows
start-chrome.bat --port 9224
run.bat --port 9224

# macOS/Linux
./start-chrome.sh --port 9224
./run.sh --port 9224
```

### 重置配置

删除 `config.json`，下次运行时会自动重新生成默认配置。

---

## 免责声明

本工具仅供学习交流使用。请遵守云学堂平台的使用条款，合理使用自动化工具。使用者需自行承担使用本工具的一切风险和责任。
