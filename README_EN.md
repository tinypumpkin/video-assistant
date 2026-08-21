<p align="center">
  <img src="icons/icon128.png" width="128" alt="Video Assistant logo">
</p>

<h1 align="center">Video Assistant</h1>

<p align="center">
  <strong>Video learning assistant — transcripts · bilingual view · AI overview · Q&A · notes</strong>
</p>

<p align="center">
  <a href="README.md">中文</a> |
  <strong>English</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/version-1.0.5-green" alt="v1.0.5">
  <img src="https://img.shields.io/badge/i18n-zh--CN%20%7C%20en--US-orange" alt="i18n">
  <img src="https://img.shields.io/badge/platform-YouTube%20%7C%20Bilibili-ff6b6b" alt="platform">
</p>

---

> ⚠️ **Note**: This is a personal open-source extension, currently distributed via GitHub Releases. All AI and caption services use your own API keys. The extension itself has no backend, no accounts, and no telemetry.

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 📝 Transcripts & Translation
- Original / translated / bilingual views
- Chinese captions translated to English; other languages to Chinese
- Follow-playback highlighting, timestamp jumps, full-text search (`/`)
- One-click copy, TXT export
- Bilibili AI captions: punctuation restoration & homophone fixes

### 🧠 AI Overview & Q&A
- Long videos chunked and processed **concurrently** into chapters, summaries & key quotes
- Free-form "Ask AI" conversations; optionally attach transcript, overview, or notes
- Explain selected text in place
- Editable overview prompts with auto-save & reset to default

</td>
<td width="50%">

### 📌 Notes System
- **Notes**: saved from transcript/overview/text-selection with timestamp anchors
- **Memos**: quick free-form entries; video pages add title + playback-position anchors
- **AI Notes**: collects answers saved from Q&A
- Filtered to the current video by default; "All" shows across videos
- Batch delete & clear-by-scope (with confirmation)
- Export to TXT / CSV / Markdown

### 🪟 Per-tab Side Panel
- Each video tab gets its **own panel** — no cross-talk
- Switching tabs never leaks state or loading spinners
- `open({tabId})` gesture-safe path; buttons open reliably

</td>
</tr>
</table>

---

## 🌍 UI Language (i18n)

- Language follows settings across **all three layers**: AI output, side panel UI, injected page buttons
- Injected buttons refresh in place when the language changes
- Both sites use the same SVG icon for the Video Assistant side panel button

---

## ⚙️ Configuration

### AI Providers (up to 8, ordered fallback)

| Setting | Details |
|---|---|
| Provider | Presets: DeepSeek, OpenAI, Claude, Gemini, Kimi, GLM, Qwen, Volcengine Ark, SiliconFlow, OpenRouter, Ollama |
| Protocol | OpenAI-compatible / Anthropic native / custom |
| Base URL | HTTPS enforced (localhost exempt) |
| API Key | Masked on blur (first 2 / last 3 chars); stored locally only |
| Model | Per-provider model list; DeepSeek defaults to `deepseek-v4-flash` |

- Recoverable failures (network / timeout / 408 / 409 / 425 / 429 / 5xx / empty content) fall back to the next provider
- Configuration errors (400/401/403/404) are **not** skipped, so problems surface immediately

### YouTube Caption Providers (ordered fallback)

[Supadata](https://docs.supadata.ai/get-transcript) · [Captapi](https://captapi.com/how-to/youtube-transcript) · [TranscriptFetch](https://transcriptfetch.com/docs/endpoints) · [TranscriptAPI](https://transcriptapi.com/docs/api/)

- Captions are cached locally (30 days, 20-entry LRU); cache hits skip network requests
- "Refetch captions" may consume provider quota again

---

## 📥 Installation

Requires Chrome 116+.

1. Download the latest `video-assistant-<version>.zip` from [Releases](https://github.com/tinypumpkin/video-assistant/releases)
2. Unzip locally
3. Open `chrome://extensions` and enable **Developer mode**
4. Drag the unzipped folder onto the extensions page, or click **Load unpacked** and select it
5. On the settings page that opens, configure at least one YouTube caption provider and one AI provider

---

## 🏗️ Project Structure

```
video-assistant/
├── manifest.json              # Chrome Extension Manifest V3
├── background.js              # Service Worker (26 message actions, transcript pipeline, AI routing)
├── sidepanel.html/js/css      # Side panel (4-tab state machine, per-tab ownerTabId)
├── options.html/js            # Settings page
├── content-youtube.js         # YouTube injection (buttons, shortcuts)
├── content-bilibili.js        # Bilibili injection (buttons, screenshot memos)
├── content-shared.js          # Shared UI library for both sites (COPY_ZH/EN strings)
├── custom-select.js           # Custom dropdown component (ported from tab-assistant)
├── prompts/                   # AI prompts & note templates
├── lib/                       # Core modules
│   ├── ai.js / ai-provider.js / provider-router.js   # AI client & ordered routing
│   ├── bili-api.js / youtube-api.js / transcript.js  # Caption fetching
│   ├── wbi.js                 # Bilibili WBI signing
│   ├── cache.js               # Caption/overview cache (TTL + LRU)
│   ├── concurrency.js         # Serial write queue
│   ├── markdown.js            # Safe Markdown rendering
│   ├── mermaid-widget.js      # Mermaid diagram enhancement (ported from tab-assistant)
│   └── note-mindmap.js        # Notes → mindmap tree builder (original)
├── vendor/                    # Third-party libs (markmap/d3/mermaid/katex/markdown-it)
├── icons/                     # Extension icons
└── tests/                     # 421 automated tests (node:test)
```

---

## 🔧 Development

```bash
npm test        # 421 automated tests (zero dependencies)
npm run package # Build dist/video-assistant-<version>.zip
```

- **Manifest V3** · zero build tooling · vanilla JS
- **chrome.storage.local** persistence — all data stays on your machine
- Test coverage: transcript parsing, WBI, cache isolation, provider routing, DOM injection, side panel interactions, per-tab protocol, i18n layers, note filtering
- Debugging: reload the extension at `chrome://extensions`; Service Worker logs via the extension details page; right-click the side panel → **Inspect**

---

## 📄 License & Credits

[MIT](LICENSE)

**Upstream projects** (code & prompt sources):

- [youtube-digest](https://github.com/zarazhangrui/youtube-digest) — Zara Zhang
- [video-digest-ai](https://github.com/Keybird0/video-digest-ai) — Keybird
- [bilibili-digest](https://github.com/biuworks/bilibili-digest) — k1234567

**Component porting & inspiration**:

- [tab-assistant](https://github.com/tinypumpkin/tab-assistant) (MIT): custom dropdown component, Mermaid diagram widget, and AI answer interaction styles ported from this project
- [markdown2mind](https://github.com/tinypumpkin/markdown2mind) (no LICENSE file): inspiration for the Markdown-notes-to-mindmap integration (`lib/note-mindmap.js` is an original implementation)

All API keys are stored only in `chrome.storage.local`. The extension has no backend, accounts, analytics, ads, or telemetry.
