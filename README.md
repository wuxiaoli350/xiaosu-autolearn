# 小苏e学刷课 v6.1 — 本地化部署指南

## 简介

**小苏e学刷课** 是一个基于 Node.js + Playwright 的云学堂（yunxuetang.cn）自动化学习脚本。它可以：

- 🎬 **自动监控视频播放** — 检测视频暂停并自动恢复播放，支持**视频快进**
- 📝 **自动完成随堂考试** — 序贯探索策略智能答题，通过分数反馈锁定正确答案
- 🔍 **多源答案提取** — 从 API 响应、Vue 组件数据、DOM 元素中提取正确答案
- ⏩ **智能课程跳过** — 自动检测已完成课程并跳过
- 🔔 **桌面通知提醒** — 考试通过/失败、异常时弹出通知

---

## 环境要求

| 依赖 | 说明 |
|------|------|
| **Node.js** ≥ 18 | https://nodejs.org/ |
| **Microsoft Edge** | Windows 10/11 自带，无需安装 |

> 默认使用 **Edge**（Windows 自带）。也兼容 Chrome。

---

## 快速开始（3 步）

### 第一步：下载

下载 ZIP 并解压到任意目录。

### 第二步：启动 Edge 调试模式

**双击 `start-edge.bat`**

会打开一个全新的 Edge 窗口并跳转云学堂。

### 第三步：登录并运行

1. 在 Edge 窗口中登录云学堂，进入课程播放页面
2. **双击 `run.bat`** 启动脚本

---

## 文件说明

| 文件 | 用途 |
|------|------|
| `start-edge.bat` | 启动 Edge 调试模式 |
| `run.bat` | 一键运行脚本 |
| `auto_learn_v6.js` | 核心自动化脚本 |
| `config.json` | 配置文件（自动生成） |
| `test-edge.bat` | 诊断工具 |

---

## 配置（config.json）

首次运行自动生成，可编辑调整：

```json
{
  "cdpUrl": "http://localhost:9223",
  "checkInterval": 3000,
  "maxRetry": 40,
  "videoFastForward": true,
  "smartSkipCompleted": true,
  "notificationEnabled": true
}
```

---

## 常见问题

### Q: 双击 bat 没反应？

在文件夹地址栏输入 `cmd` 回车，然后手动执行：
```
start-edge.bat
```

### Q: 端口连接失败？

确保先双击 `start-edge.bat` 启动了 Edge，再双击 `run.bat`。

### Q: 如何停止？

按 `Ctrl + C`。

---

## 免责声明

本工具仅供学习交流使用。使用者自行承担风险。
