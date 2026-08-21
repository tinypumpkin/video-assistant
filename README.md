<p align="center">
  <img src="icons/icon128.png" width="128" alt="Video Assistant logo">
</p>

<h1 align="center">Video Assistant</h1>

<p align="center">
  <strong>视频学习助手 —— 字幕 · 双语 · AI 概览 · 问答 · 笔记</strong>
</p>

<p align="center">
  <strong>中文</strong> |
  <a href="README_EN.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/version-1.0.5-green" alt="v1.0.5">
  <img src="https://img.shields.io/badge/i18n-zh--CN%20%7C%20en--US-orange" alt="i18n">
  <img src="https://img.shields.io/badge/platform-YouTube%20%7C%20Bilibili-ff6b6b" alt="platform">
</p>

---

> ⚠️ **注意**：本项目为个人开发的开源扩展，通过 GitHub Releases 分发，不上架 Chrome Web Store。所有 AI 与字幕服务使用你自己的 API Key，扩展本身无后端、无账户、无遥测。

---

## ✨ 功能 Features

<table>
<tr>
<td width="50%">

### 📝 字幕与翻译 Transcript
- 原文 / 译文 / 双语对照三种视图
- 中文字幕译英文，其他语言译中文
- 跟随播放高亮、时间戳跳转、全文搜索（`/`）
- 一键复制、TXT 导出
- Bilibili AI 字幕「顺句」补标点、修同音错字

### 🧠 AI 概览与问答 AI
- 长视频分块**并发生成**章节、摘要与金句
- 「问 AI」自由连续问答，多选关联字幕/概览/笔记
- 划词解释选中内容
- 概览提示词可调、自动保存、恢复默认

</td>
<td width="50%">

### 📌 笔记体系 Notes
- **笔记**：字幕/概览/划词处保存，带时间戳锚点
- **手记**：随手记录，视频页附标题+播放位置锚点
- **AI 记**：收纳问答保存的内容
- 默认按当前视频过滤，「全部」才跨视频
- 批量删除、按范围清空（二次确认）
- 导出 TXT / CSV / Markdown

### 🪟 侧边栏 per-tab 面板 Panel
- 每个视频标签页**独立面板**，互不干扰
- 切标签页不串台、加载动画不跨页
- `open({tabId})` 手势链路，按钮可靠打开

</td>
</tr>
</table>

---

## 🌍 中英文界面 i18n

- 界面语言跟随设置，**三层全通**：AI 输出、侧边栏文案、页面注入按钮
- 已注入按钮随语言切换原地刷新
- 两站 Digest 按钮同一海蓝色图标

---

## ⚙️ 配置 Configuration

### AI Provider（1–8 个，有序回退）

| 配置项 | 说明 |
|---|---|
| 服务商 | DeepSeek、OpenAI、Claude、Gemini、Kimi、GLM、通义千问、火山方舟、SiliconFlow、OpenRouter、Ollama 预设 |
| 协议 | OpenAI 兼容 / Anthropic 原生 / 自定义 |
| Base URL | HTTPS 强制（localhost 豁免） |
| API Key | 失焦掩码（前2后3），只存本机 |
| 模型 | 独立拉取列表；DeepSeek 默认 `deepseek-v4-flash` |

- 可恢复故障（网络/超时/408/409/425/429/5xx/空内容）自动回退下一项
- 配置错误（400/401/403/404）不跳过，避免掩盖问题

### YouTube 字幕服务商（按顺序回退）

[Supadata](https://docs.supadata.ai/get-transcript) · [Captapi](https://captapi.com/how-to/youtube-transcript) · [TranscriptFetch](https://transcriptfetch.com/docs/endpoints) · [TranscriptAPI](https://transcriptapi.com/docs/api/)

- 字幕本地缓存（30 天，20 条 LRU），缓存命中不重复请求
- 「重新获取字幕」可能再次消耗服务商额度

---

## 📥 安装 Installation

需要 Chrome 116+。

1. 在 [Releases](https://github.com/tinypumpkin/video-assistant/releases) 下载最新的 `video-assistant-<version>.zip`
2. 本地解压
3. 打开 `chrome://extensions`，开启「开发者模式」
4. 将解压后的文件夹拖拽到扩展程序页面；或点击「加载已解压的扩展程序」选择该文件夹
5. 在自动打开的设置页配置至少一个 YouTube 字幕服务商和 AI Provider

---

## 🏗️ 项目结构 Project Structure

```
video-assistant/
├── manifest.json              # Chrome Extension Manifest V3
├── background.js              # Service Worker（消息路由 26 action、字幕管线、AI 路由）
├── sidepanel.html/js/css      # 侧边栏（4 tab 状态机、per-tab ownerTabId）
├── options.html/js            # 设置页
├── content-youtube.js         # YouTube 注入（按钮、快捷键）
├── content-bilibili.js            # Bilibili 注入（按钮、截图手记）
├── content-shared.js          # 双站共享 UI 库（COPY_ZH/EN 文案表）
├── custom-select.js           # 自定义下拉组件（移植自 tab-assistant）
├── prompts/                   # AI 提示词与笔记模板
├── lib/                       # 核心模块
│   ├── ai.js / ai-provider.js / provider-router.js   # AI 客户端与有序路由
│   ├── bili-api.js / youtube-api.js / transcript.js  # 字幕获取
│   ├── wbi.js                 # Bilibili WBI 签名
│   ├── cache.js               # 字幕/概览缓存（TTL+LRU）
│   ├── concurrency.js         # 串行写队列
│   ├── markdown.js            # 安全 Markdown 渲染
│   ├── mermaid-widget.js      # Mermaid 图表增强（移植自 tab-assistant）
│   └── note-mindmap.js        # 笔记→思维导图树构建（自研）
├── vendor/                    # 第三方库（markmap/d3/mermaid/katex/markdown-it）
├── icons/                     # 扩展图标
└── tests/                     # 421 个自动化测试（node:test）
```

---

## 🔧 开发 Development

```bash
npm test        # 421 个自动化测试（零依赖）
npm run package # 打包 dist/video-assistant-<version>.zip
```

- **Manifest V3** · 零构建工具 · 原生 JS
- **chrome.storage.local** 持久化，数据全部本机
- 测试覆盖：字幕解析、WBI、缓存隔离、Provider 路由、DOM 注入、侧边栏交互、per-tab 协议、i18n 三层、笔记过滤
- 调试：`chrome://extensions` 刷新扩展；Service Worker 日志在扩展详情页；侧边栏右键「检查」

---

## 📄 许可与致谢 License & Credits

[MIT](LICENSE)

**上游项目**（代码与提示词来源）：

- [youtube-digest](https://github.com/zarazhangrui/youtube-digest) — Zara Zhang（张咋了）
- [video-digest-ai](https://github.com/Keybird0/video-digest-ai) — Keybird
- [bilibili-digest](https://github.com/biuworks/bilibili-digest) — k1234567

**组件移植与思路参考**：

- [tab-assistant](https://github.com/tinypumpkin/tab-assistant)（MIT）：自定义下拉组件、Mermaid 图表增强组件与 AI 回答交互样式移植自该项目
- [markdown2mind](https://github.com/tinypumpkin/markdown2mind)（无 LICENSE）：Markdown 笔记生成思维导图的集成思路参考（`lib/note-mindmap.js` 为自研实现）

所有密钥只写入 `chrome.storage.local`。扩展没有后端、账户、分析、广告或遥测。
