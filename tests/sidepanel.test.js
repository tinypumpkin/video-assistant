const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * 侧边栏的渲染集成测试。
 *
 * 这里加载的是真正的 sidepanel.js，只把 DOM 和 chrome API 换成桩，
 * 然后走完整的 loadTranscript 流程。这样测的是真实的分支与调用顺序，
 * 而不是另写一份逻辑自己跟自己对答案。
 *
 * 之所以不用浏览器端到端：侧边栏跑在 chrome-extension:// 里，
 * 需要先把扩展装进真实浏览器，还得有 B 站登录态和一个真的 AI 密钥，
 * 每跑一次都要花钱、且结果不确定。而这个 bug 的因果完全在渲染路径上，
 * 在这一层就能钉死。
 */

const ROOT = path.join(__dirname, "..");

/** 属性随便读写、方法都不做事的元素桩，够渲染路径用即可。 */
function createElement(tag = "div") {
  const queried = new Map();
  return {
    tagName: tag,
    className: "",
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    parentElement: null,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    classList: {
      values: new Set(),
      add(...names) {
        for (const name of names) this.values.add(name);
      },
      remove(...names) {
        for (const name of names) this.values.delete(name);
      },
      toggle(name, force) {
        if (force === true) this.values.add(name);
        else if (force === false) this.values.delete(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
        return this.values.has(name);
      },
      contains(name) {
        return this.values.has(name);
      },
    },
    appendChild(child) {
      if (child && typeof child === "object") child.parentElement = this;
      this.children.push(child);
      return child;
    },
    append(...nodes) {
      for (const node of nodes) {
        if (node && typeof node === "object") node.parentElement = this;
      }
      this.children.push(...nodes);
    },
    insertBefore(node) {
      this.children.push(node);
      return node;
    },
    replaceWith(node) {
      if (this.parentElement) {
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children[index] = node;
        if (node && typeof node === "object") node.parentElement = this.parentElement;
      }
      this.replacedWith = node;
    },
    remove() {
      if (!this.parentElement) return;
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    },
    scrolled: false,
    scrollIntoView() {
      this.scrolled = true;
    },
    focus() {},
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    removeEventListener() {},
    // 同一个选择器要返回同一个对象，否则写进去的值下次就读不到了。
    querySelector(selector) {
      if (!queried.has(selector)) queried.set(selector, createElement("div"));
      return queried.get(selector);
    },
    querySelectorAll() {
      return [];
    },
  };
}

function createContext({
  transcript,
  analysis,
  videoAvailable = { available: true },
  siteEnabled = true,
  tabsQuery,
}) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, createElement("div"));
    return elements.get(id);
  };

  const sent = [];
  const clipboardWrites = [];
  const clipboardTexts = [];
  class ClipboardItemStub {
    constructor(items) {
      this.items = items;
    }
  }
  class BlobStub {
    constructor(parts, options = {}) {
      this.text = parts.map((part) => String(part)).join("");
      this.type = options.type || "";
    }
  }
  // 流式「问 AI」用 Port 长连接；测试里通过 conn.port._emit() 模拟后台推消息。
  const ports = [];
  // 真实页面中的五个复选框在 HTML 里默认全选；桩没有解析 HTML，显式补上。
  for (const id of [
    "chatContextTranscript",
    "chatContextOverview",
    "chatContextNotes",
    "chatContextMemos",
  ]) {
    byId(id).checked = true;
  }
  const openedTabs = [];
  const seeks = [];
  const tabStore = [
    { id: 1, windowId: 1, url: "https://www.bilibili.com/video/BV1xx411c7mD" },
    { id: 7, windowId: 1, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  ];
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    CSS: { escape: (value) => value },
    window: { getSelection: () => null },
    document: {
      getElementById: byId,
      createElement: (tag) => createElement(tag),
      createTextNode: (text) => ({ tagName: "#text", textContent: String(text) }),
      createElementNS: (namespace, tag) => createElement(tag),
      createDocumentFragment: () => createElement("#fragment"),
      querySelector(selector) {
        if (!String(selector).startsWith(".")) return null;
        const className = String(selector).slice(1);
        const visit = (node) => {
          if (String(node?.className || "").split(/\s+/).includes(className)) return node;
          for (const child of node?.children || []) {
            const found = visit(child);
            if (found) return found;
          }
          return null;
        };
        for (const node of elements.values()) {
          const found = visit(node);
          if (found) return found;
        }
        return null;
      },
      querySelectorAll: () => [],
      addEventListener() {},
    },
    navigator: {
      clipboard: {
        writeText: async (text) => clipboardTexts.push(String(text)),
        write: async (items) => clipboardWrites.push(items),
      },
    },
    ClipboardItem: ClipboardItemStub,
    Blob: BlobStub,
    chrome: {
      runtime: {
        async sendMessage(message) {
          sent.push(message);
          if (message.action === "isSiteEnabled") return { enabled: siteEnabled };
          if (message.action === "fetchTranscript") return transcript;
          if (message.action === "analyzeTranscript") return analysis;
          if (message.action === "askVideo") {
            return { success: true, answer: `回答：${message.question}` };
          }
          if (message.action === "translateSegments") {
            const translated = {};
            for (const id of message.segmentIds) translated[id] = `${id} 的译文`;
            return { success: true, translated };
          }
          if (message.action === "checkVideoAvailable") return videoAvailable;
          return { success: true };
        },
        onMessage: { addListener() {} },
        connect(name) {
          const listeners = { message: [], disconnect: [] };
          const sentToPort = [];
          const port = {
            name: String(name),
            postMessage(message) {
              sentToPort.push(message);
            },
            onMessage: { addListener(fn) { listeners.message.push(fn); } },
            onDisconnect: { addListener(fn) { listeners.disconnect.push(fn); } },
            disconnect() {
              port.disconnected = true;
              for (const fn of listeners.disconnect) fn();
            },
            // 测试钩子：模拟后台通过 Port 推消息（delta / done / error）。
            _emit(message) {
              for (const fn of listeners.message) fn(message);
            },
          };
          ports.push({ port, sent: sentToPort });
          return port;
        },
      },
      tabs: {
        query: async (query) =>
          tabsQuery
            ? tabsQuery(query)
            : [{ id: 1, windowId: 1, url: "https://www.bilibili.com/video/BV1xx411c7mD" }],
        get: async (tabId) => {
          const match = tabStore.find((tab) => tab.id === tabId);
          if (!match) throw new Error("No tab with id: " + tabId);
          return match;
        },
        sendMessage: async (tabId, message) => {
          if (message?.action === "seekTo") seeks.push(message.seconds);
          return {};
        },
        create: async (options) => {
          openedTabs.push(options.url);
          return { id: 2 };
        },
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} },
      },
      windows: { getCurrent: async () => ({ id: 1 }) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    },
    BILI_TRANSCRIPT: require("../lib/transcript.js"),
    BILI_AI: require("../lib/ai.js"),
    BILI_CONCURRENCY: require("../lib/concurrency.js"),
    BILI_MARKDOWN: require("../lib/markdown.js"),
    BILI_VISUAL_MEMOS: require("../lib/visual-memos.js"),
    NOTE_MINDMAP: require("../lib/note-mindmap.js"),
    BILI_NOTE_TEMPLATES: require("../prompts/note-styles.js"),
    BILI_SETTINGS: require("../settings.js"),
  };
  context.globalThis = context;

  vm.createContext(context);
  // sidepanel.js 顶层用的是 const，在 vm 里不会挂到全局对象上，
  // 所以在末尾追加一行，从同一个词法作用域里把要测的绑定递出来。
  const source = fs.readFileSync(path.join(ROOT, "sidepanel.js"), "utf8");
  vm.runInContext(
    `${source}\n;globalThis.__api = { state, uiText, parseVideoRef, activeTab, syncWithActiveTab, loadTranscript, analyze, renderSegments, renderAnalysis, segmentDisplayText, noteTextForSegment, saveTextAsVideoNote, paintSegmentText, setTranscriptMode, selectionContext, applySearchFilter, updateFollowPill, jumpToActive, closeSearch, renderNoteCard, renderMemoCard, renderAiVideoNoteDocument, renderMarkdownWithVisualReferences, copyCurrentAiVideoNote, copyMemoToClipboard, startAiVideoNoteEdit, cancelAiVideoNoteEdit, saveAiVideoNoteEdit, deleteCurrentAiVideoNote, resetCurrentAiVideoNote, exportNotesFromSelect, notesAsMarkdown, notesAsCsv, playNote, saveMemo, currentMemoVideoContext, submitChatQuestion, saveChatAsNote, renderChat, appendChatDelta, flushTypewriter, displayedChatText, switchTab, renderOverviewPrompt, resetOverviewPrompt, renderNotePrompt, resetNotePrompt, renderNoteStyleSelector, updateNoteStyle, selectedNotePrompt, generateVideoNote, renderNotes, renderMemos, loadNotes, chatContextSelection, setNotesScope, setNotesView, renderNotesMindmap };`,
    context,
  );

  return {
    ...context.__api,
    el: byId,
    chrome: context.chrome,
    sent,
    ports,
    clipboardWrites,
    clipboardTexts,
    openedTabs,
    seeks,
  };
}

const SEGMENTS = [
  { id: "s1", start: 0, text: "第一段原文" },
  { id: "s2", start: 5, text: "第二段原文" },
];

const ANALYSIS = {
  chapters: [
    { timestamp: "0:00", timestampSeconds: 0, title: "开场", summary: "讲了开场" },
  ],
  keyQuotes: [{ timestamp: "0:05", timestampSeconds: 5, quote: "一句金句" }],
};

test("字幕片段一键存为带时间锚点的手记", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 1;
  ctx.renderSegments(SEGMENTS);

  const row = ctx.el("transcriptList").children[0].children[0];
  const save = row.children[2];
  assert.equal(save.textContent, "存为手记");
  await save.listeners.get("click")({ stopPropagation() {} });

  const message = ctx.sent.find((item) => item.action === "saveMemo");
  assert.ok(message, "字幕区走 saveMemo 而不是 saveNote");
  assert.equal(message.kind, "memo");
  assert.equal(message.timestamp, 0);
  assert.equal(message.text, "第一段原文");
  assert.equal(message.bvid, "BV1xx411c7mD");
  assert.equal(save.textContent, "已保存");
  assert.equal(save.classList.contains("is-success"), true, "保存成功后显示绿色完成态");
  const legacy = ctx.sent.find((item) => item.action === "saveNote");
  assert.equal(legacy, undefined, "字幕区不再走 saveNote");
});

test("概览金句一键存为手记，章节已剥离保存入口", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 1;
  ctx.renderAnalysis(ANALYSIS, false);

  // 章节卡片不再渲染操作区（保存入口已剥离），只保留标题、摘要两段。
  const chapterCard = ctx.el("chapterList").children[0];
  assert.equal(chapterCard.children.length, 2, "章节卡片没有 actions 区");
  assert.ok(
    !chapterCard.children.some((child) => child.tagName === "BUTTON"),
    "章节卡片里不应有保存按钮",
  );

  // 金句存为手记。
  const quoteCard = ctx.el("quoteList").children[0];
  const quoteSave = quoteCard.children[2].children[0];
  assert.equal(quoteSave.textContent, "存为手记");
  await quoteSave.listeners.get("click")({ stopPropagation() {} });

  const saved = ctx.sent.filter((item) => item.action === "saveMemo");
  assert.deepEqual(
    saved.map(({ timestamp, text, kind }) => ({ timestamp, text, kind })),
    [{ timestamp: 5, text: "一句金句", kind: "memo" }],
  );
  const legacy = ctx.sent.find((item) => item.action === "saveNote");
  assert.equal(legacy, undefined, "金句不再走 saveNote");
});

test("英文界面会翻译侧边栏菜单和动态计数", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.uiLanguage = "en";

  assert.equal(ctx.uiText("字幕"), "Transcript");
  assert.equal(ctx.uiText("概览"), "Overview");
  assert.equal(ctx.uiText("笔记"), "Notes");
  assert.equal(ctx.uiText("问 AI"), "Ask AI");
  assert.equal(ctx.uiText("7 章节"), "7 chapters");
  assert.equal(ctx.uiText("5 金句"), "5 key quotes");
});

test("英文界面翻译生成动画/聊天占位符/提示词按钮等静态文案", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.uiLanguage = "en";

  // 三处用户报告的残留：笔记生成动画、聊天输入占位符、恢复默认按钮
  assert.equal(ctx.uiText("AI 笔记生成中..."), "Generating AI notes...");
  assert.equal(
    ctx.uiText("输入问题…（Enter 发送）"),
    "Type a question… (Enter to send)",
  );
  assert.equal(ctx.uiText("恢复默认"), "Restore default");
  assert.equal(ctx.uiText("重置"), "Reset");
  assert.equal(ctx.uiText("关闭"), "Close");
});

test("uiText 归一化折叠 CJK 标点旁空格后命中字典", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.uiLanguage = "en";

  // 多行 HTML 文案经 \\s+→" " 归一化会在标点旁多出空格，折叠后必须命中
  assert.equal(
    ctx.uiText("把整段字幕交给大模型，产出覆盖全片的章节和 3-5 条金句。 需要先在设置页配置 AI 服务。"),
    ctx.uiText("把整段字幕交给大模型，产出覆盖全片的章节和 3-5 条金句。需要先在设置页配置 AI 服务。"),
  );
  // <kbd>n</kbd> 切断的手记空状态片段
  assert.equal(
    ctx.uiText("， 就能记下当前时间点的一条手记。"),
    ctx.uiText("，就能记下当前时间点的一条手记。"),
  );
  // 正常英文文案里的空格不受折叠影响
  assert.equal(
    ctx.uiText("Generate chapters covering the full video and 3–5 key quotes."),
    "Generate chapters covering the full video and 3–5 key quotes.",
  );
});

test("概览提示词可在中文界面切换为英文默认版本", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const defaults = require("../settings.js").DEFAULT_OVERVIEW_PROMPTS;
  ctx.state.uiLanguage = "zh-CN";
  ctx.state.overviewPrompts = {
    "zh-CN": "保留的中文自定义提示词",
    en: "Existing English prompt",
  };

  ctx.resetOverviewPrompt("en");

  assert.equal(ctx.state.overviewPromptLanguage, "en");
  assert.equal(ctx.el("overviewPrompt").value, defaults.en);
  assert.equal(ctx.state.overviewPrompts["zh-CN"], "保留的中文自定义提示词");

  ctx.resetOverviewPrompt("zh-CN");
  assert.equal(ctx.state.overviewPromptLanguage, "zh-CN");
  assert.equal(ctx.el("overviewPrompt").value, defaults["zh-CN"]);
});

function transcriptResult(extra = {}) {
  return {
    success: true,
    fromCache: true,
    segments: SEGMENTS,
    videoInfo: { title: "标题", owner: "UP主" },
    ...extra,
  };
}

test("当前网站在适用范围中关闭时，侧边栏不请求字幕", async () => {
  const ctx = createContext({
    transcript: transcriptResult(),
    siteEnabled: false,
  });

  await ctx.syncWithActiveTab();

  assert.equal(ctx.state.view, "disabled");
  assert.equal(ctx.el("disabledState").hidden, false);
  assert.equal(
    ctx.sent.some((message) => message.action === "fetchTranscript"),
    false,
  );
});

test("视频地址识别兼容不带 www 的 YouTube 与 B站域名", () => {
  const ctx = createContext({ transcript: transcriptResult() });

  assert.equal(
    ctx.parseVideoRef("https://bilibili.com/video/BV1xx411c7mD")?.videoId,
    "BV1xx411c7mD",
  );
  assert.equal(
    ctx.parseVideoRef("https://youtube.com/watch?v=dQw4w9WgXcQ")?.videoId,
    "dQw4w9WgXcQ",
  );
});

test("侧栏窗口查询不到标签页时会从最后聚焦窗口找到 B站视频", async () => {
  const queries = [];
  const ctx = createContext({
    transcript: transcriptResult(),
    tabsQuery: async (query) => {
      queries.push(query);
      if (query.lastFocusedWindow) {
        return [{ id: 7, windowId: 9, url: "https://www.bilibili.com/video/BV1xx411c7mD" }];
      }
      return [];
    },
  });
  ctx.state.windowId = 1;

  await ctx.syncWithActiveTab();

  assert.equal(ctx.state.tabId, 7);
  assert.equal(ctx.state.bvid, "BV1xx411c7mD");
  assert.equal(ctx.state.view, "ready");
  assert.equal(queries[0].lastFocusedWindow, true);
});

test("Digest 按钮传来的标签页可直接驱动侧栏，不依赖窗口查询", async () => {
  let queryCount = 0;
  const ctx = createContext({
    transcript: transcriptResult(),
    tabsQuery: async () => {
      queryCount += 1;
      return [];
    },
  });

  await ctx.syncWithActiveTab({
    tab: { id: 8, windowId: 5, url: "https://www.bilibili.com/video/BV1xx411c7mD" },
  });

  assert.equal(queryCount, 0);
  assert.equal(ctx.state.tabId, 8);
  assert.equal(ctx.state.view, "ready");
});

test("面板锁定 ownerTabId：活动标签页是别人的视频也不切换内容", async () => {
  const queries = [];
  const ctx = createContext({
    transcript: transcriptResult(),
    tabsQuery: async (query) => {
      queries.push(query);
      // 当前活动标签页是另一个视频（模拟用户切到别的标签页）
      return [{ id: 1, windowId: 1, url: "https://www.bilibili.com/video/BV1xx411c7mD" }];
    },
  });
  // 面板属于标签页 7（YouTube 视频）
  ctx.state.ownerTabId = 7;
  ctx.state.windowId = 1;

  await ctx.syncWithActiveTab();

  // 内容跟着 owner（标签页 7 的 YouTube 视频），不是活动标签页 1 的 B 站视频
  assert.equal(ctx.state.tabId, 7);
  assert.equal(ctx.state.site, "youtube");
  assert.equal(ctx.state.bvid, "dQw4w9WgXcQ");
  assert.equal(queries.length, 0, "owner 已锁定，不该再发起窗口查询");
});

test("ownerTabId 的标签页被关闭后显示 idle，不偷看别的标签页", async () => {
  const queries = [];
  const ctx = createContext({
    transcript: transcriptResult(),
    tabsQuery: async (query) => {
      queries.push(query);
      return [{ id: 1, windowId: 1, url: "https://www.bilibili.com/video/BV1xx411c7mD" }];
    },
  });
  ctx.state.ownerTabId = 99; // 不存在的标签页
  ctx.state.windowId = 1;

  await ctx.syncWithActiveTab();

  // per-tab 语义：owner 标签页没了，面板显示 idle 引导，
  // 绝不回退去查别的标签页（那会把别人的视频内容带进来）。
  assert.equal(ctx.state.view, "idle");
  assert.equal(ctx.state.ownerTabId, null, "失效的 owner 被清掉");
  assert.equal(queries.length, 0, "owner 失效后不再发起窗口查询");
});

// ============================================================
// 缓存里已有的结果要自动摆出来
// ============================================================

test("缓存里带着概览时，进来就直接展示，不用再点一次生成", async () => {
  const ctx = createContext({
    transcript: transcriptResult({ analysis: ANALYSIS }),
  });
  ctx.state.bvid = "BV1xx411c7mD";

  await ctx.loadTranscript();

  assert.equal(
    ctx.el("overviewResult").hidden,
    false,
    "结果就在手上却不显示，用户会以为上次生成失败了",
  );
  assert.equal(ctx.el("overviewEmpty").hidden, true);
  assert.deepEqual(ctx.state.analysis, ANALYSIS);
});

test("没有概览时保持空态，不会摆出一个空壳", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";

  await ctx.loadTranscript();

  assert.equal(ctx.el("overviewResult").hidden, true);
  assert.equal(ctx.el("overviewEmpty").hidden, false);
  assert.equal(ctx.state.analysis, null);
});

test("缓存里带着顺句结果时，直接显示顺过的文字", async () => {
  const ctx = createContext({
    transcript: transcriptResult({ polished: { s1: "第一段原文。" } }),
  });
  ctx.state.bvid = "BV1xx411c7mD";

  await ctx.loadTranscript();

  assert.equal(
    ctx.state.polishMode,
    true,
    "顺句是花钱换来的，回来默认显示原文等于让用户以为白顺了",
  );
  assert.equal(ctx.segmentDisplayText(SEGMENTS[0]), "第一段原文。");
  // 没顺到的那条仍然回落到原文
  assert.equal(ctx.segmentDisplayText(SEGMENTS[1]), "第二段原文");
});

test("没有顺句结果时不进入顺句态", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";

  await ctx.loadTranscript();

  assert.equal(ctx.state.polishMode, false);
  assert.equal(ctx.segmentDisplayText(SEGMENTS[0]), "第一段原文");
});

test("换视频时，上一个视频的概览不会串台", async () => {
  const ctx = createContext({
    transcript: transcriptResult({ analysis: ANALYSIS }),
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();
  assert.equal(ctx.el("overviewResult").hidden, false);

  // 换到一个没有概览的视频
  ctx.chrome.runtime.sendMessage = async (message) =>
    message.action === "fetchTranscript" ? transcriptResult() : { success: true };
  await ctx.loadTranscript();

  assert.equal(ctx.state.analysis, null);
  assert.equal(ctx.el("overviewResult").hidden, true);
  assert.equal(ctx.el("overviewEmpty").hidden, false);
});

// ============================================================
// 生成完成后的渲染
// ============================================================

test("生成成功后立即展示结果，并收起加载态", async () => {
  const ctx = createContext({
    transcript: transcriptResult(),
    analysis: { success: true, analysis: ANALYSIS },
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  await ctx.analyze();

  assert.equal(ctx.el("overviewLoading").hidden, true);
  assert.equal(ctx.el("overviewResult").hidden, false);
  assert.deepEqual(ctx.state.analysis, ANALYSIS);
});

// ============================================================
// 双语对照：三视图人人都有，顺句只给中文字幕
// ============================================================

const EN = { language: "en-US", languageLabel: "英语（自动生成）" };

test("中文字幕：顺句开关和三视图都给（中文译成英文）", async () => {
  const ctx = createContext({ transcript: transcriptResult({ language: "ai-zh" }) });
  ctx.state.bvid = "BV1xx411c7mD";

  await ctx.loadTranscript();

  assert.equal(ctx.state.isChinese, true);
  assert.equal(ctx.el("polishBtn").hidden, false);
  assert.equal(
    ctx.el("transcriptMode").hidden,
    false,
    "中文字幕也要给三视图——译成英文",
  );
});

test("中文字幕切译文会发翻译请求（方向由 background 定）", async () => {
  const ctx = createContext({ transcript: transcriptResult({ language: "ai-zh" }) });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  await ctx.setTranscriptMode("translated");

  assert.ok(
    ctx.sent.some((message) => message.action === "translateSegments"),
    "中文视频切译文视图也应该走同一条翻译链路",
  );
});

test("双语的上行跟着顺句走：开了顺句就显示顺句稿", async () => {
  const ctx = createContext({
    transcript: transcriptResult({
      language: "ai-zh",
      polished: { s1: "第一段，原文。" },
      translated: { s1: "Line one translated." },
    }),
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  assert.equal(ctx.state.transcriptMode, "bilingual", "缓存里有译文就该直接进双语");
  const node = ctx.el("probe");
  ctx.paintSegmentText(node, SEGMENTS[0]);
  assert.deepEqual(
    node.children.map((child) => child.textContent),
    ["第一段，原文。", "Line one translated."],
    "顺句稿比无标点的 ASR 原文好读，双语上行没理由退回原文",
  );
});

test("外文字幕给三视图，不给顺句开关", async () => {
  const ctx = createContext({ transcript: transcriptResult(EN) });
  ctx.state.bvid = "BV1xx411c7mD";

  await ctx.loadTranscript();

  assert.equal(ctx.state.isChinese, false);
  assert.equal(ctx.el("transcriptMode").hidden, false);
  assert.equal(
    ctx.el("polishBtn").hidden,
    true,
    "英文字幕本来就带标点，顺句没有意义",
  );
});

test("缓存里带着译文时，进来就是双语，不用再翻一遍", async () => {
  const ctx = createContext({
    transcript: transcriptResult({ ...EN, translated: { s1: "第一段译文" } }),
  });
  ctx.state.bvid = "BV1xx411c7mD";

  await ctx.loadTranscript();

  assert.equal(ctx.state.transcriptMode, "bilingual");
  assert.equal(ctx.state.translated.s1, "第一段译文");
});

test("双语模式下原文和译文各占一行，没翻到的那条给占位", async () => {
  const ctx = createContext({
    transcript: transcriptResult({ ...EN, translated: { s1: "第一段译文" } }),
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  const node = ctx.el("probe");
  ctx.paintSegmentText(node, SEGMENTS[0]);
  assert.deepEqual(
    node.children.map((child) => child.textContent),
    ["第一段原文", "第一段译文"],
  );

  const pending = ctx.el("probe2");
  ctx.paintSegmentText(pending, SEGMENTS[1]);
  assert.equal(pending.children[1].textContent, "翻译中…");
});

test("切到译文视图会去翻译，结果回填进 state", async () => {
  const ctx = createContext({ transcript: transcriptResult(EN) });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  await ctx.setTranscriptMode("translated");

  assert.equal(ctx.state.transcriptMode, "translated");
  assert.equal(ctx.state.translated.s1, "s1 的译文");
  assert.equal(ctx.segmentDisplayText(SEGMENTS[0]), "s1 的译文");
  assert.ok(
    ctx.sent.some((message) => message.action === "translateSegments"),
    "切到译文视图却没发翻译请求",
  );
});

test("切回原文不再发翻译请求", async () => {
  const ctx = createContext({ transcript: transcriptResult(EN) });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();
  await ctx.setTranscriptMode("translated");

  const before = ctx.sent.filter((m) => m.action === "translateSegments").length;
  await ctx.setTranscriptMode("original");

  assert.equal(ctx.state.transcriptMode, "original");
  assert.equal(ctx.segmentDisplayText(SEGMENTS[0]), "第一段原文");
  assert.equal(
    ctx.sent.filter((m) => m.action === "translateSegments").length,
    before,
    "切回原文只是换个显示方式，不该再花钱",
  );
});

test("已经翻过的分段不会再翻第二次", async () => {
  const ctx = createContext({
    transcript: transcriptResult({ ...EN, translated: { s1: "第一段译文", s2: "第二段译文" } }),
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  await ctx.setTranscriptMode("translated");

  assert.equal(
    ctx.sent.filter((m) => m.action === "translateSegments").length,
    0,
    "缓存里全都有了还去请求，等于白花钱",
  );
  assert.equal(ctx.segmentDisplayText(SEGMENTS[0]), "第一段译文");
});

test("翻译从正在看的位置开始，前面的稍后环绕补齐", async () => {
  const ctx = createContext({ transcript: transcriptResult(EN) });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  // 用户看到了第二段（5 秒处）才切译文视图。
  ctx.state.activeIndex = 1;
  await ctx.setTranscriptMode("translated");

  const first = ctx.sent.find((m) => m.action === "translateSegments");
  assert.deepEqual(
    first.segmentIds,
    ["s2", "s1"],
    "眼前这一段应该排在最前，否则长视频里用户要等前面全部翻完",
  );
  // 顺序只影响先后，两段最终都要有结果。
  assert.equal(ctx.state.translated.s1, "s1 的译文");
  assert.equal(ctx.state.translated.s2, "s2 的译文");
});

test("偶发失败的批次会自动补一轮，不用用户手点", async () => {
  // 5 段会被切成 2 批（每批最多 4 段），好让「部分失败」成立。
  const many = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i + 1}`,
    start: i * 5,
    text: `第 ${i + 1} 段原文`,
  }));
  const ctx = createContext({
    transcript: {
      success: true,
      segments: many,
      videoInfo: { title: "标题", owner: "UP主" },
      language: "en-US",
    },
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  // 第一个翻译批次模拟限流失败，之后恢复正常。
  const original = ctx.chrome.runtime.sendMessage;
  let failedOnce = false;
  ctx.chrome.runtime.sendMessage = async (message) => {
    if (message.action === "translateSegments" && !failedOnce) {
      failedOnce = true;
      return { success: false, message: "限流" };
    }
    return original(message);
  };

  await ctx.setTranscriptMode("translated");

  for (const segment of many) {
    assert.ok(
      ctx.state.translated[segment.id],
      `${segment.id} 在自动补一轮之后仍然没有译文`,
    );
  }
  assert.ok(
    !ctx.el("segmentCount").textContent.includes("批失败"),
    "补齐之后不该再让用户手点补齐",
  );
});

test("划词解释能在顺句后的文字里找到上下文", async () => {
  const ctx = createContext({
    transcript: transcriptResult({ polished: { s1: "第一段，原文。" } }),
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  // 屏幕上显示的是顺句稿，用户选中的自然是带标点的版本——原文里并没有这串字。
  const context = ctx.selectionContext("第一段，原文。");
  assert.ok(
    context.includes("第一段，原文。"),
    "在顺句稿里找不到选区，上下文就退化成字幕开头，解释会驴唇不对马嘴",
  );
  assert.ok(context.includes("第二段原文"), "相邻分段也应该进上下文");
});

// ============================================================
// 字幕搜索与「回到当前句」浮标
// ============================================================

test("样式里必须兜住 hidden，否则整套显隐都是摆设", () => {
  // 本页大量元素既写了 display:flex 又靠 hidden 控制显隐（进度条、搜索栏、
  // 跟随浮标、被搜索过滤掉的字幕行……）。作者样式里的 display 会盖过
  // hidden 属性的浏览器默认值，少了这条兜底，它们一个都藏不住——
  // 而 DOM 桩不跑 CSS，只有在这里静态守住。
  const css = fs.readFileSync(path.join(ROOT, "sidepanel.css"), "utf8");
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

test("命中的字会被 mark 标出来", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  ctx.applySearchFilter("一段");

  const rows = ctx.el("transcriptList").children[0].children;
  const pieces = rows[0].children[1].children;
  assert.deepEqual(
    pieces.map((piece) => [piece.tagName, piece.textContent]),
    [
      ["span", "第"],
      ["mark", "一段"],
      ["span", "原文"],
    ],
    "一屏语气相近的字幕，光过滤还是要一行行找，标出来眼睛才有落点",
  );
});

test("搜索会把第一条命中滚进视野", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  ctx.applySearchFilter("第二段");

  const rows = ctx.el("transcriptList").children[0].children;
  assert.equal(
    rows[1].scrolled,
    true,
    "不滚过去的话命中行可能在几屏之外，用户会以为搜索没生效",
  );
  assert.equal(rows[0].scrolled, false, "没命中的行不该被滚到");
});

test("搜索会过滤字幕行并报命中数，清空后全部恢复", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  ctx.applySearchFilter("第一段");

  const rows = ctx.el("transcriptList").children[0].children;
  assert.equal(rows[0].hidden, false);
  assert.equal(rows[1].hidden, true, "没命中的行应该藏起来");
  assert.equal(ctx.el("searchCount").textContent, "1 条命中");

  ctx.applySearchFilter("");
  assert.equal(rows[1].hidden, false, "清空搜索后列表要完整回来");
  assert.equal(ctx.el("searchCount").textContent, "");
});

test("搜索能命中顺句稿和译文，不只搜原文", async () => {
  const ctx = createContext({
    transcript: transcriptResult({
      polished: { s1: "第一段，顺过了。" },
      translated: { s2: "Second line translated" },
    }),
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  // 用户眼里的文字是顺句稿/译文，搜不到等于「明明看得见却找不到」。
  ctx.applySearchFilter("顺过了");
  assert.equal(ctx.el("searchCount").textContent, "1 条命中");

  ctx.applySearchFilter("translated");
  assert.equal(ctx.el("searchCount").textContent, "1 条命中");
});

test("滚开或搜索时浮标出现，点击后回到当前句并复位", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();
  ctx.state.activeIndex = 1;

  // 用户刚滚动过 → 自动跟随暂停，浮标要给一条回来的路。
  ctx.state.lastUserScrollAt = Date.now();
  ctx.updateFollowPill();
  assert.equal(ctx.el("followPill").hidden, false);

  ctx.jumpToActive();
  assert.equal(ctx.el("followPill").hidden, true, "回来之后浮标该消失");
  assert.equal(ctx.state.lastUserScrollAt, 0, "点浮标等于明确表态要跟随");

  // 搜索期间同样给浮标：列表被过滤，回到当前句要先收搜索。
  ctx.applySearchFilter("第一段");
  ctx.updateFollowPill();
  assert.equal(ctx.el("followPill").hidden, false);
  ctx.jumpToActive();
  assert.equal(ctx.state.searchQuery, "", "从搜索跳回时应顺手收掉搜索");
});

test("换视频时上一个视频的搜索词不会带过来", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  ctx.applySearchFilter("第一段");
  assert.equal(ctx.state.searchQuery, "第一段");

  await ctx.loadTranscript();
  assert.equal(ctx.state.searchQuery, "", "新视频的列表不该被旧搜索词过滤");
});

// ============================================================
// 笔记回看
// ============================================================

const NOTE = {
  id: "note_1",
  bvid: "BV1yy411c7mD",
  timestamp: "1:05",
  timestampSeconds: 65,
  timestampedUrl: "https://www.bilibili.com/video/BV1yy411c7mD?t=65",
  text: "一条笔记",
  videoTitle: "另一个视频",
  ownerName: "别的 UP",
};

/** 卡片底部那行提示，renderNoteCard 把它放在最后。 */
const noticeOf = (card) => card.children[card.children.length - 1];

test("点当前视频的笔记就地跳转，不开新标签页", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.tabId = 1;
  await ctx.loadTranscript();

  const note = { ...NOTE, bvid: "BV1xx411c7mD" };
  await ctx.playNote(note, noticeOf(ctx.renderNoteCard(note)));

  assert.deepEqual(ctx.seeks, [65]);
  assert.deepEqual(ctx.openedTabs, [], "同一个视频还开新标签页就是白开一个");
});

test("点别的视频的笔记，确认视频还在之后开新标签页", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.tabId = 1;
  await ctx.loadTranscript();

  await ctx.playNote(NOTE, noticeOf(ctx.renderNoteCard(NOTE)));

  assert.deepEqual(ctx.openedTabs, [NOTE.timestampedUrl], "链接要带上时间戳");
  assert.deepEqual(ctx.seeks, [], "别的视频没法在当前页跳转");
});

test("后台还在润色的笔记，卡片上有「润色中」提示；僵尸标记不显示", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  // 刚保存、润色还没回来：要说一声，不然正文过几秒突然变了会让人纳闷。
  const fresh = noticeOf(
    ctx.renderNoteCard({ ...NOTE, pending: true, createdAt: Date.now() }),
  );
  assert.equal(fresh.hidden, false);
  assert.match(fresh.textContent, /润色/);

  // pending 卡了半天多半是润色中途 service worker 被回收，别永远挂着「润色中」。
  const stale = noticeOf(
    ctx.renderNoteCard({ ...NOTE, pending: true, createdAt: Date.now() - 10 * 60 * 1000 }),
  );
  assert.equal(stale.hidden, true);
});

test("视频已下架时给出提示，不再开标签页", async () => {
  const ctx = createContext({
    transcript: transcriptResult(),
    videoAvailable: { available: false, message: "视频已下架，无法查看原视频。" },
  });
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.tabId = 1;
  await ctx.loadTranscript();

  const notice = noticeOf(ctx.renderNoteCard(NOTE));
  await ctx.playNote(NOTE, notice);

  assert.deepEqual(
    ctx.openedTabs,
    [],
    "笔记能留三十天，视频早没了还开标签页，用户要等整页加载完才知道",
  );
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /已下架/);
});

test("生成失败只影响概览这一块，字幕仍然可读", async () => {
  const ctx = createContext({
    transcript: transcriptResult(),
    analysis: { success: false, message: "模型返回了空内容" },
  });
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  await ctx.analyze();

  assert.equal(ctx.el("overviewLoading").hidden, true);
  assert.equal(ctx.el("overviewEmpty").hidden, false);
  assert.equal(
    ctx.state.view,
    "ready",
    "概览失败不该把整个面板打回错误态，字幕还在",
  );
});

// ============================================================
// 问 AI（流式）
// ============================================================

/** 模拟后台流式回复：推送增量后 done。 */
function streamAnswer(conn, answer) {
  conn.port._emit({ type: "delta", text: answer });
  conn.port._emit({ type: "done" });
}

test("问 AI 支持连续追问并把历史发送给后台", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 1;
  await ctx.loadTranscript();

  await ctx.submitChatQuestion("第一问是什么？");
  streamAnswer(ctx.ports.at(-1), "回答：第一问是什么？");
  await ctx.submitChatQuestion("请继续解释");
  streamAnswer(ctx.ports.at(-1), "回答：请继续解释");

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        ctx.state.chatMessages.map(({ role, content }) => [role, content]),
      ),
    ),
    [
      ["user", "第一问是什么？"],
      ["assistant", "回答：第一问是什么？"],
      ["user", "请继续解释"],
      ["assistant", "回答：请继续解释"],
    ],
  );
  const asks = ctx.ports.map((entry) => entry.sent[0]);
  assert.equal(asks.length, 2);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(asks[1].history.map(({ role, content }) => [role, content])),
    ),
    [
      ["user", "第一问是什么？"],
      ["assistant", "回答：第一问是什么？"],
    ],
  );
});

// ============================================================
// 打字机渲染（流式气泡的 DOM 写入路径）
// ============================================================

test("空流式回答显示本地化的紧凑思考指示器", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.submitChatQuestion("请先思考");

  const bubble = ctx.el("chatMessages").children.at(-1);
  const thinking = bubble.children[0];
  assert.equal(thinking.classList.contains("chat-thinking"), true);
  assert.equal(thinking.classList.contains("markdown-body"), false);
  assert.equal(thinking.children[0].className, "chat-thinking-spinner");
  assert.equal(thinking.children[1].textContent, "思考中…");

  ctx.state.uiLanguage = "en";
  ctx.renderChat();
  const englishBubble = ctx.el("chatMessages").children.at(-1);
  assert.equal(englishBubble.children[0].children[1].textContent, "Thinking…");
});

test("打字机直接锚定流式文本节点，增量到达时即渲染 Markdown", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.loadTranscript();

  await ctx.submitChatQuestion("逐字说明");
  const conn = ctx.ports.at(-1);
  // 第一个增量到达：renderChat 已建出流式气泡，打字机应立即开始写。
  // 文本长度 > 每 tick 消费量（4 字），确保 _pending 有残留可断言。
  conn.port._emit({ type: "delta", text: "**第一段落**内容相当长需要逐字吐出" });
  const bubbleText = ctx.el("chatMessages").querySelector(".chat-message-text.chat-streaming");
  assert.ok(bubbleText, "流式文本节点存在");
  assert.equal(bubbleText.classList.contains("markdown-body"), true);
  assert.ok(bubbleText.children.length > 0, "首个 delta 已走 Markdown DOM 渲染，而非写入原始源码");
  const firstChunk = "**第一段落**内容相当长需要逐字吐出";
  assert.equal(
    ctx.state.chatMessages.find((m) => m?.streaming)?.content,
    firstChunk,
    "content 已累积完整增量",
  );
  assert.equal(
    ctx.displayedChatText(ctx.state.chatMessages.find((m) => m?.streaming)),
    firstChunk.slice(0, 4),
    "打字机只吐首 4 字，其余留在 _pending（逐字而非整段）",
  );

  // done：冲掉缓冲升级为正式消息
  conn.port._emit({ type: "done" });
  assert.equal(ctx.state.chatSending, false);
  const final = ctx.state.chatMessages.filter((m) => m.role === "assistant").pop();
  assert.equal(final.content, firstChunk);
  assert.ok(!final.streaming, "streaming 标志已清除");
});

test("问 AI 默认关联当前视频的四类上下文且不引用 AI 记", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  await ctx.submitChatQuestion("默认上下文");
  const [defaultAsk] = ctx.ports.at(-1).sent;
  assert.deepEqual(JSON.parse(JSON.stringify(defaultAsk.contextSelection)), {
    transcript: true,
    overview: true,
    notes: true,
    memos: true,
  });
  streamAnswer(ctx.ports.at(-1), "好的");

  ctx.el("chatContextTranscript").checked = false;
  ctx.el("chatContextOverview").checked = false;
  ctx.el("chatContextNotes").checked = false;
  ctx.el("chatContextMemos").checked = false;
  await ctx.submitChatQuestion("纯问答");
  const asks = ctx.ports.map((entry) => entry.sent[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(asks.at(-1).contextSelection)), {
    transcript: false,
    overview: false,
    notes: false,
    memos: false,
  });
  streamAnswer(ctx.ports.at(-1), "好的");
});

test("没有当前视频时问 AI 会在侧栏直接拦截", async () => {
  const ctx = createContext({
    transcript: { success: false, error: "NO_SUBTITLE", message: "没有字幕" },
    tabsQuery: async () => [{ id: 2, windowId: 1, url: "https://example.com/" }],
  });
  await ctx.syncWithActiveTab();
  assert.equal(ctx.state.view, "idle");

  ctx.switchTab("chat");
  assert.equal(ctx.el("chatPanel").hidden, false);
  assert.equal(ctx.el("idleState").hidden, true);

  await ctx.submitChatQuestion("请介绍一下你自己");
  assert.equal(ctx.ports.length, 0);
  assert.equal(ctx.state.chatMessages.at(-1).error, true);
  assert.match(ctx.state.chatMessages.at(-1).content, /支持的视频/);
});

test("流式增量逐块累积，期间处于 streaming 占位状态", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 1;
  await ctx.loadTranscript();

  await ctx.submitChatQuestion("分块回答");
  const conn = ctx.ports.at(-1);
  conn.port._emit({ type: "delta", text: "第一" });
  assert.equal(ctx.state.chatMessages.at(-1).streaming, true);
  // content 始终完整累积（保存/历史用），打字机只消费 _pending。
  assert.equal(ctx.state.chatMessages.at(-1).content, "第一");
  assert.equal(typeof ctx.state.chatMessages.at(-1)._pending, "string");
  conn.port._emit({ type: "delta", text: "块" });
  conn.port._emit({ type: "delta", text: "完成" });
  assert.equal(ctx.state.chatMessages.at(-1).content, "第一块完成");
  conn.port._emit({ type: "done" });
  assert.equal(ctx.state.chatMessages.at(-1).streaming, false);
  assert.equal(ctx.state.chatMessages.at(-1).content, "第一块完成");
  // 完成时打字机积压全部吐出，不留半截文字。
  assert.equal(ctx.state.chatMessages.at(-1)._pending, "");
});

test("流式出错：无输出时显示错误，有部分输出时保留内容并追加说明", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 1;
  await ctx.loadTranscript();

  // 完全没输出就失败：占位消息变成错误消息
  await ctx.submitChatQuestion("会失败的问题");
  ctx.ports.at(-1).port._emit({ type: "error", error: "AI_REQUEST_FAILED", message: "服务返回 500", emitted: false });
  assert.equal(ctx.state.chatMessages.at(-1).error, true);
  assert.equal(ctx.state.chatMessages.at(-1).content, "服务返回 500");

  // 已经吐了部分内容才失败：保留内容 + 追加错误说明，且标 error 不进下一轮历史
  await ctx.submitChatQuestion("会半路失败的问题");
  const conn = ctx.ports.at(-1);
  conn.port._emit({ type: "delta", text: "半截回答" });
  conn.port._emit({ type: "error", error: "AI_IDLE_TIMEOUT", message: "响应传到一半断了，请重试。", emitted: true });
  const partial = ctx.state.chatMessages.at(-1);
  assert.equal(partial.error, true);
  assert.match(partial.content, /^半截回答/);
  assert.match(partial.content, /响应传到一半断了/);
});

test("AI 回答可一键保存到独立 AI 记并附带视频锚点", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 1;
  ctx.state.data = transcriptResult();
  const button = createElement("button");
  button.textContent = "转为笔记";

  await ctx.saveChatAsNote(
    {
      role: "assistant",
      question: "核心观点是什么？",
      content: "核心观点是持续练习。",
      timestampSeconds: 65,
    },
    button,
  );

  const save = ctx.sent.find((message) => message.action === "saveMemo");
  assert.equal(save.kind, "ai_note");
  assert.equal(save.timestamp, 65);
  assert.equal(save.videoTitle, "标题");
  assert.match(save.text, /问：核心观点是什么？/);
  assert.match(save.text, /答：核心观点是持续练习。/);
  assert.equal(button.textContent, "已存入 AI 记");
  assert.equal(button.classList.contains("is-success"), true, "存入成功后显示绿色完成态");
});

test("没有视频时 AI 回答仍可保存，且不写入视频字段", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const button = createElement("button");
  button.textContent = "存入 AI 记";

  await ctx.saveChatAsNote(
    { question: "你好？", content: "你好！", timestampSeconds: 0 },
    button,
  );

  const save = ctx.sent.find((message) => message.action === "saveMemo");
  assert.equal(save.kind, "ai_note");
  assert.equal("bvid" in save, false);
  assert.equal("videoTitle" in save, false);
});

test("手记在视频页保存标题和当前播放锚点", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 1;
  ctx.state.tabId = 1;
  ctx.state.currentTime = 88;
  ctx.state.data = transcriptResult();
  ctx.state.notesScope = "memo";
  ctx.el("memoInput").value = "这是视频手记";

  await ctx.saveMemo();

  const save = ctx.sent.find((message) => message.action === "saveMemo");
  assert.equal(save.kind, "memo");
  assert.equal(save.bvid, "BV1xx411c7mD");
  assert.equal(save.videoTitle, "标题");
  assert.equal(save.timestamp, 88);
});

test("带截图的手记卡片渲染缩略图，且排在正文之前", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const memo = {
    id: "memo_shot_1",
    kind: "memo",
    text: "字幕原文",
    createdAt: Date.now(),
    imageDataUrl: "data:image/jpeg;base64,/9j/4AAQ",
  };
  const card = ctx.renderMemoCard(memo);
  const shot = card.children.find((child) => child.className === "memo-shot");
  assert.ok(shot, "卡片里应当有 .memo-shot 截图元素");
  assert.equal(shot.tagName.toUpperCase(), "IMG");
  assert.equal(shot.src, memo.imageDataUrl);
  const tags = card.children.map((child) => child.tagName.toUpperCase());
  const textIndex = card.children.findIndex((child) =>
    String(child.className).includes("entry-text"),
  );
  assert.ok(
    tags.indexOf("IMG") < textIndex,
    "截图在正文上方（head 之后、entry-text 之前）",
  );
  // 无截图的手记不受影响。
  const plain = ctx.renderMemoCard({ ...memo, imageDataUrl: undefined });
  assert.equal(
    plain.children.some((child) => child.className === "memo-shot"),
    false,
  );
});

test("复制带图片的手记会写入含 Base64 图片的富文本剪贴板", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const imageDataUrl = "data:image/jpeg;base64,/9j/4AAQ";
  await ctx.copyMemoToClipboard({
    kind: "memo",
    text: "带截图的重点",
    imageDataUrl,
  });

  assert.equal(ctx.clipboardWrites.length, 1);
  const item = ctx.clipboardWrites[0][0];
  assert.equal(item.items["text/plain"].text.includes(imageDataUrl), true);
  assert.match(item.items["text/html"].text, /<img src="data:image\/jpeg;base64,\/9j\/4AAQ"/);
  assert.equal(ctx.clipboardTexts.length, 0);
});

test("带图片的手记导出时保留 Base64 图片数据", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const imageDataUrl = "data:image/jpeg;base64,/9j/4AAQ";
  const memo = {
    id: "memo_base64_1",
    kind: "memo",
    text: "带截图的手记",
    createdAt: Date.now(),
    imageDataUrl,
  };

  const markdown = ctx.notesAsMarkdown([memo]);
  const csv = ctx.notesAsCsv([memo]);
  assert.match(markdown, new RegExp(`!\\[手记图片\\]\\(${imageDataUrl.replace(/[+/?]/g, "\\$&")}\\)`));
  assert.match(csv.split("\r\n")[0], /imageDataUrl/);
  assert.match(csv, /data:image\/jpeg;base64/);
});

test("普通页面保存手记时不携带任何视频信息", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "memo";
  ctx.el("memoInput").value = "一条普通手记";

  await ctx.saveMemo();

  const save = ctx.sent.find((message) => message.action === "saveMemo");
  assert.equal(save.kind, "memo");
  assert.equal("bvid" in save, false);
  assert.equal("videoTitle" in save, false);
  assert.equal("timestamp" in save, false);
});

test("本视频没有笔记时展示模板选择，默认隐藏自定义提示词", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.state.bvid = "BV1xx411c7mD";

  ctx.renderNotes([], 0);

  assert.equal(ctx.el("notesEmpty").hidden, false);
  assert.equal(ctx.el("notesEmptyTitle").textContent, "生成 AI 笔记");
  assert.match(ctx.el("notesEmptyText").textContent, /结构化笔记/);
  assert.equal(ctx.el("videoNoteGenerateActions").hidden, false);
  assert.equal(ctx.el("noteTemplatePicker").hidden, false);
  assert.equal(ctx.el("notePromptEditor").hidden, true);
  assert.equal(ctx.el("generateVideoNoteBtn").disabled, false);
});

test("生成 AI 笔记时用居中的加载状态替换空态内容", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.videoNoteGenerating = true;

  ctx.renderNotes([], 0);

  assert.equal(ctx.el("notesEmpty").hidden, true);
  assert.equal(ctx.el("videoNoteLoading").hidden, false);
  assert.equal(ctx.el("generateVideoNoteBtn").disabled, true);

  ctx.state.videoNoteGenerating = false;
  ctx.renderNotes([], 0);
  assert.equal(ctx.el("videoNoteLoading").hidden, true);
  assert.equal(ctx.el("notesEmpty").hidden, false);
});

test("全部笔记为空时不误显示本视频 AI 生成入口", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "all";

  ctx.renderNotes([], 0);

  assert.equal(ctx.el("notesEmptyTitle").textContent, "还没有任何笔记");
  assert.equal(ctx.el("videoNoteGenerateActions").hidden, true);
  assert.equal(ctx.el("noteTemplatePicker").hidden, true);
  assert.equal(ctx.el("notePromptEditor").hidden, true);
});

test("AI 笔记模板下拉框包含八种预设与自定义项", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.renderNoteStyleSelector();

  const options = ctx.el("noteStyleSelect").children;
  assert.equal(options.length, 9);
  assert.deepEqual(
    options.map((option) => option.value),
    [
      "minimal",
      "detailed",
      "tutorial",
      "academic",
      "paper",
      "xiaohongshu",
      "meeting_minutes",
      "first_principles",
      "custom",
    ],
  );
});

test("仅选择自定义模板时显示并使用自定义提示词", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.renderNoteStyleSelector();
  ctx.el("noteStyleSelect").value = "custom";
  ctx.updateNoteStyle();
  ctx.el("notePrompt").value = "只整理可执行步骤";

  assert.equal(ctx.el("notePromptEditor").hidden, false);
  assert.match(ctx.selectedNotePrompt(), /^只整理可执行步骤/);
  assert.match(ctx.selectedNotePrompt(), /AI 摘要/);

  ctx.el("noteStyleSelect").value = "minimal";
  ctx.updateNoteStyle();
  assert.equal(ctx.el("notePromptEditor").hidden, true);
  assert.match(ctx.selectedNotePrompt(), /精简信息/);
  assert.match(ctx.selectedNotePrompt(), /AI 摘要/);
});

test("生成后的 AI 视频笔记使用文档预览并显示双视图切换", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  const note = {
    id: "ai-doc-1",
    kind: "ai_video_note",
    text: "# 教程笔记\n\n## 核心主题\n正文",
  };

  ctx.renderNotes([note], 1);

  assert.equal(ctx.el("aiNoteViewSwitch").hidden, false);
  assert.equal(ctx.el("toggleNotesDeleteModeBtn").hidden, true);
  assert.equal(ctx.el("notesList").children[0].className, "ai-note-document");
  assert.equal(ctx.el("notesList").children[0].children[0].className, "ai-note-document-body markdown-body");
  assert.equal(ctx.el("notesList").children[0].children.length, 1, "文档底部不应再出现重复操作栏");

  const html = fs.readFileSync(path.join(ROOT, "sidepanel.html"), "utf8");
  assert.doesNotMatch(html, /id="toggleNotesViewBtn"/);
  for (const label of ["复制", "编辑", "Markdown", "思维导图", "删除"]) {
    assert.match(html, new RegExp(`>${label}<|<span>${label}</span>`));
  }
});

test("AI 视频笔记在 Markdown 中把引用标记渲染成手记截图", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  const note = {
    id: "ai-doc-with-image",
    kind: "ai_video_note",
    text: "# 教程笔记\n\n截图说明如下：\n\n{{va-cite:cite_01}}\n\n## 后续章节\n正文",
    visualReferences: [{
      citationId: "cite_01",
      imageDataUrl: "data:image/jpeg;base64,QUJD",
      timestamp: "1:20",
      timestampedUrl: "https://www.youtube.com/watch?v=abc&t=80",
    }],
  };

  ctx.renderNotes([note], 1);

  const article = ctx.el("notesList").children[0];
  const body = article.children[0];
  const findByClass = (node, className) => {
    if (String(node?.className || "").split(/\s+/).includes(className)) return node;
    for (const child of node?.children || []) {
      const found = findByClass(child, className);
      if (found) return found;
    }
    return null;
  };
  const figure = findByClass(body, "ai-note-visual-reference");
  assert.ok(figure, "引用位置应插入图片组件");
  assert.equal(figure.children[0].src, "data:image/jpeg;base64,QUJD");
  assert.match(figure.children[1].children[0].textContent, /1:20/);
  const collectText = (node) => [
    typeof node?.textContent === "string" ? node.textContent : "",
    ...(node?.children || []).flatMap(collectText),
  ].join(" ");
  assert.doesNotMatch(collectText(body), /va-cite/);
});

test("AI 笔记功能栏的复制与删除操作指向当前生成文档", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const note = { id: "ai-doc-2", kind: "ai_video_note", text: "# 测试笔记" };
  ctx.state.notesLoaded = [note];

  await ctx.copyCurrentAiVideoNote();
  assert.equal(ctx.el("aiNoteCopyBtn").classList.contains("is-success"), true);
  await ctx.deleteCurrentAiVideoNote();

  assert.ok(ctx.sent.some((message) => message.action === "deleteNote" && message.noteId === note.id));
});

test("AI 笔记导出下拉框提供三种格式，重置后回到重新生成状态", async () => {
  const html = fs.readFileSync(path.join(ROOT, "sidepanel.html"), "utf8");
  assert.match(html, /id="aiNoteExportFormatSelect"[\s\S]*?<option value="json">JSON<\/option>[\s\S]*?<option value="markdown">Markdown<\/option>[\s\S]*?<option value="csv">CSV<\/option>/);
  assert.match(html, /id="aiNoteResetBtn"[\s\S]*?>重置<\/button>/);

  const ctx = createContext({ transcript: transcriptResult() });
  const note = { id: "ai-doc-reset", kind: "ai_video_note", text: "# 待重置笔记" };
  ctx.state.notesScope = "video";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.notesLoaded = [note];
  ctx.state.notesTotalCount = 1;
  ctx.renderNotes([note], 1);

  await ctx.resetCurrentAiVideoNote();

  assert.ok(ctx.sent.some((message) => message.action === "deleteNote" && message.noteId === note.id));
  assert.equal(ctx.el("aiNoteViewSwitch").hidden, true);
  assert.equal(ctx.el("notesExportBar").hidden, false);
  assert.equal(ctx.el("notesEmpty").hidden, false);
  assert.equal(ctx.el("videoNoteGenerateActions").hidden, false);
  assert.equal(ctx.el("noteTemplatePicker").hidden, false);
});

test("AI 笔记视图切换使用参考中的文档与三节点导图图标", () => {
  const html = fs.readFileSync(path.join(ROOT, "sidepanel.html"), "utf8");
  assert.match(html, /M6 3h5\.293/);
  assert.match(html, /circle cx="10" cy="4" r="2"/);
  assert.match(html, /M9\.2 11\.6L6\.9 13\.4/);
});

test("AI 笔记视图切换使用参考的内缩胶囊尺寸与选中态", () => {
  const css = fs.readFileSync(path.join(ROOT, "sidepanel.css"), "utf8");
  assert.match(css, /\.ai-note-view-group\s*\{[\s\S]*?gap:\s*6px;[\s\S]*?padding:\s*4px;[\s\S]*?border-radius:\s*12px;/);
  assert.match(css, /\.ai-note-view-group \.ai-note-tool-btn\s*\{[\s\S]*?height:\s*24px;[\s\S]*?padding:\s*0 12px;[\s\S]*?border-radius:\s*10px;/);
  assert.match(css, /\.ai-note-view-group \.ai-note-view-btn\.active\s*\{[\s\S]*?color:\s*var\(--text\);[\s\S]*?background:\s*#fff;/);
});

test("AI 笔记功能栏使用紧凑黑色控件，加载提示字号不抢眼", () => {
  const css = fs.readFileSync(path.join(ROOT, "sidepanel.css"), "utf8");
  assert.match(css, /\.note-generation-loading p\s*\{[\s\S]*?font-size:\s*14px;/);
  assert.match(css, /\.ai-note-export-select\s*\{[\s\S]*?inline-size:\s*82px;/);
  assert.match(css, /\.ai-note-view-group \.ai-note-tool-btn\s*\{[\s\S]*?color:\s*var\(--text\);/);
  assert.match(css, /\.ai-note-delete-btn\s*\{[\s\S]*?color:\s*var\(--text\);/);
});

test("AI 笔记从统一功能栏进入编辑，并在原位切换保存/取消", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const note = { id: "ai-doc-3", kind: "ai_video_note", text: "# 修改前" };
  ctx.state.notesScope = "video";
  ctx.state.notesLoaded = [note];
  ctx.renderNotes([note], 1);

  ctx.startAiVideoNoteEdit();
  const editor = ctx.el("notesList").children[0].children[0];
  assert.equal(editor.className, "note-editor ai-note-document-editor");
  assert.equal(ctx.el("aiNoteViewGroup").hidden, true);
  assert.equal(ctx.el("aiNoteCancelEditBtn").hidden, false);
  assert.equal(ctx.el("aiNoteSaveEditBtn").hidden, false);

  editor.value = "# 修改后";
  await ctx.saveAiVideoNoteEdit();
  assert.ok(
    ctx.sent.some(
      (message) =>
        message.action === "updateNote" &&
        message.noteId === note.id &&
        message.text === "# 修改后",
    ),
  );
});

test("普通时间点笔记仍使用卡片且不提供导图入口", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.renderNotes([{ id: "n1", kind: "note", timestamp: "00:12", text: "要点" }], 1);

  assert.equal(ctx.el("aiNoteViewSwitch").hidden, true);
  assert.equal(ctx.el("toggleNotesDeleteModeBtn").hidden, false);
  assert.match(ctx.el("notesList").children[0].className, /^note/);
});

test("全部笔记将 AI 视频笔记显示为卡片，且不提供访问锚点", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "all";
  const note = {
    id: "ai-summary-1",
    kind: "ai_video_note",
    text: "# 完整视频总结",
    videoTitle: "架构视频",
    timestamp: "0:00",
    timestampedUrl: "https://www.bilibili.com/video/BV1xx411c7mD?t=0",
    createdAt: Date.now(),
  };

  ctx.renderNotes([note], 1);

  const card = ctx.el("notesList").children[0];
  assert.match(card.className, /^note/);
  assert.notEqual(card.className, "ai-note-document");
  const badge = card.children[0].children.find(
    (child) => child.className === "note-source-badge",
  );
  assert.equal(badge.textContent, "AI 笔记");
  assert.equal(card.children[2].textContent, "架构视频", "不展示 0:00 锚点时间");
  const labels = card.children[3].children.map((button) => button.children[1].textContent);
  assert.deepEqual(labels, ["编辑", "复制"]);
  assert.equal(labels.includes("访问锚点"), false);
});

test("生成 AI 笔记会发送当前视频和自定义提示词", async () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.page = 2;
  ctx.state.tabId = 9;
  ctx.state.noteStyle = "custom";
  ctx.el("notePrompt").value = "重点整理操作步骤";

  await ctx.generateVideoNote();

  const request = ctx.sent.find((message) => message.action === "generateVideoNote");
  assert.equal(request.bvid, "BV1xx411c7mD");
  assert.equal(request.page, 2);
  assert.equal(request.tabId, 9);
  assert.equal(request.noteStyle, "custom");
  assert.match(request.customPrompt, /^重点整理操作步骤/);
  assert.match(request.customPrompt, /AI 摘要/);
});

test("手记空态使用当前视频引导文案", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.renderMemos([], 0);
  assert.equal(ctx.el("memoEmpty").hidden, false);
  assert.equal(ctx.el("memoForm").hidden, true, "空态不应再被手记输入框挤到下方");

  const html = fs.readFileSync(path.join(ROOT, "sidepanel.html"), "utf8");
  assert.match(html, /这个视频还没有手记/);
  assert.match(html, /就能记下当前时间点的一条手记/);
});

/* ---------------------- 笔记思维导图 ---------------------- */

test("仅 AI 视频笔记可切换导图视图，切回 Markdown 恢复文档", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.state.notesLoaded = [{ id: "n1", kind: "ai_video_note", text: "# 一份 AI 笔记" }];
  ctx.el("notesEntries").hidden = false;

  ctx.setNotesView("mindmap");
  assert.equal(ctx.state.notesView, "mindmap");
  assert.equal(ctx.el("notesMindmapPanel").hidden, false);
  assert.equal(ctx.el("notesEntries").hidden, true); // 列表隐藏
  assert.equal(ctx.el("aiNoteMindmapBtn").getAttribute("aria-pressed"), "true");

  ctx.setNotesView("list");
  assert.equal(ctx.el("notesMindmapPanel").hidden, true);
  assert.equal(ctx.el("notesEntries").hidden, false); // video 范围恢复列表
  assert.equal(ctx.el("aiNoteDocumentBtn").getAttribute("aria-pressed"), "true");
});

test("从会隐藏正文的范围切回本视频时恢复 Markdown 容器", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "memo";
  ctx.el("notesEntries").hidden = true;

  ctx.setNotesScope("video");

  assert.equal(ctx.state.notesScope, "video");
  assert.equal(ctx.state.notesView, "list");
  assert.equal(ctx.el("notesEntries").hidden, false);
});

test("离开本视频范围会退出导图，手记和 AI 记不提供导图", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.state.notesLoaded = [{ id: "n1", kind: "ai_video_note", text: "# 笔记" }];
  ctx.setNotesView("mindmap");
  assert.equal(ctx.state.notesView, "mindmap");

  ctx.state.notesScope = "memo";
  ctx.state.notesLoaded = [{ id: "m1", kind: "memo", text: "手记" }];
  ctx.setNotesView("mindmap");
  assert.equal(ctx.state.notesView, "list");
  assert.equal(ctx.el("notesMindmapPanel").hidden, true);
});

test("AI 视频笔记进入导图视图自动退出删除模式", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.state.notesLoaded = [{ id: "n1", kind: "ai_video_note", text: "# 笔记" }];
  ctx.state.notesDeleteMode = true;

  ctx.setNotesView("mindmap");
  assert.equal(ctx.state.notesDeleteMode, false);
});

test("普通笔记和空范围无法通过内部调用进入导图", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  ctx.state.notesScope = "video";
  ctx.state.notesLoaded = [{ id: "n1", kind: "note", text: "普通笔记" }];
  ctx.setNotesView("mindmap");
  assert.equal(ctx.state.notesView, "list");
  assert.equal(ctx.el("notesMindmapPanel").hidden, true);
});

// ============================================================
// 字幕补齐中 pill（乐观保存的等待期提示）
// ============================================================

test("手记卡片：等待字幕回填时显示 pill，回填后消失", () => {
  const ctx = createContext({ transcript: transcriptResult() });
  const base = {
    id: "memo_pill_1",
    kind: "memo",
    text: "",
    createdAt: 1755600000000,
    pendingTranscript: true,
    imageDataUrl: "data:image/jpeg;base64,ROFO",
    videoTitle: "测试视频",
    timestamp: "5:23",
    timestampedUrl: "https://www.youtube.com/watch?v=abc&t=323",
  };

  // 桩的元素 querySelector 不搜树，自己深度遍历找类名节点。
  const findByClass = (root, className) => {
    if (String(root?.className || "").split(/\s+/).includes(className)) return root;
    for (const child of root?.children || []) {
      const found = findByClass(child, className);
      if (found) return found;
    }
    return null;
  };

  // 等待期：pill 在
  const waiting = ctx.renderMemoCard({ ...base });
  const pill = findByClass(waiting, "note-pending-transcript");
  assert.ok(pill, "pendingTranscript=true 时渲染 pill");
  assert.equal(pill.tagName, "span");
  assert.equal(pill.textContent, "字幕补齐中…");
  assert.ok(String(pill.className).includes("note-source-badge"), "复用徽章基础样式");

  // 回填后：pill 消失
  const settled = ctx.renderMemoCard({ ...base, pendingTranscript: false, text: "补齐的正文" });
  assert.equal(findByClass(settled, "note-pending-transcript"), null, "标志清除后不再渲染 pill");

  // 普通手记（从未等待）也不该有 pill
  const plain = ctx.renderMemoCard({ ...base, pendingTranscript: undefined, text: "普通正文" });
  assert.equal(findByClass(plain, "note-pending-transcript"), null);
});

// ============================================================
// 手记 / AI 记录按当前视频过滤（与划词笔记同源语义）
// ============================================================

test("手记 scope 加载时带当前视频的 site+bvid，只有全部范围才不带", async () => {
  const ctx = createContext({});
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.notesScope = "memo";
  ctx.sent.length = 0;

  await ctx.loadNotes();

  const memoCall = ctx.sent.find((m) => m.action === "getMemos" && m.kind === "memo");
  assert.ok(memoCall, "手记列表应请求 getMemos");
  assert.equal(memoCall.site, "bilibili");
  assert.equal(memoCall.bvid, "BV1xx411c7mD");
});

test("AI 记录 scope 加载时带当前视频的 site+bvid", async () => {
  const ctx = createContext({});
  ctx.state.site = "bilibili";
  ctx.state.bvid = "BV1xx411c7mD";
  ctx.state.notesScope = "ai";
  ctx.sent.length = 0;

  await ctx.loadNotes();

  const aiCall = ctx.sent.find((m) => m.action === "getMemos" && m.kind === "ai_note");
  assert.ok(aiCall, "AI 记录列表应请求 getMemos");
  assert.equal(aiCall.site, "bilibili");
  assert.equal(aiCall.bvid, "BV1xx411c7mD");
});

test("全部范围的手记不带 bvid（全量返回）", async () => {
  const ctx = createContext({});
  ctx.state.notesScope = "all";
  ctx.sent.length = 0;

  await ctx.loadNotes();

  const allCall = ctx.sent.find((m) => m.action === "getNotes");
  assert.ok(allCall, "全部范围应走 getNotes");
  assert.equal(allCall.scope, "all");
  assert.equal(allCall.bvid, null);
});
