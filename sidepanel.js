/**
 * Video Assistant — 侧边栏：字幕 / 概览 / 笔记 / 问 AI 四个标签页。
 *
 * 字幕区三视图（原文 / 译文 / 双语）人人都有，翻译方向由字幕语种决定；
 * 「顺句」只给中文字幕，且与三视图可叠加（开着顺句时原文指顺句稿）。
 * 侧边栏是全窗口共享的，标签页查询都限定在本面板所属窗口内。
 */

"use strict";

const POLL_INTERVAL_MS = 1000;
// 用户手动滚动后先别抢滚动条；有「回到当前句」浮标兜底，这个窗口可以放宽。
const AUTOSCROLL_SUPPRESS_MS = 8000;

const SIDE_PANEL_EN = Object.freeze({
  "缓存": "Cached",
  "字幕": "Transcript",
  "概览": "Overview",
  "笔记": "Notes",
  "问 AI": "Ask AI",
  "正在获取字幕…": "Fetching captions…",
  "打开一个视频": "Open a video",
  "支持 YouTube 标准播放页，以及 Bilibili 普通视频、合集和分P页面。":
    "Supports standard YouTube watch pages and Bilibili videos, collections, and multi-part pages.",
  "此网站已停用": "This site is disabled",
  "可在设置的“适用范围”中重新开启。":
    "Re-enable it under Site availability in Settings.",
  "打开设置": "Open settings",
  "出错了": "Something went wrong",
  "字幕需要登录": "Sign-in required for captions",
  "没能取到字幕": "Could not fetch captions",
  "未知错误，请重试。": "Unknown error. Please try again.",
  "重试": "Retry",
  "去登录 Bilibili": "Sign in to Bilibili",
  "顺句": "Polish",
  "原文": "Original",
  "译文": "Translation",
  "双语": "Bilingual",
  "复制": "Copy",
  "导出": "Export",
  "回到当前句": "Back to current line",
  "生成 AI 概览": "Generate AI overview",
  "把整段字幕交给大模型，产出覆盖全片的章节和 3-5 条金句。需要先在设置页配置 AI 服务。":
    "Generate chapters covering the full video and 3–5 key quotes. Configure an AI provider in Settings first.",
  "生成概览": "Generate overview",
  "正在生成概览…": "Generating overview…",
  "正在准备…": "Preparing…",
  "长视频会切成多块并发生成，可在设置页调整并发数。":
    "Long videos are processed in parallel chunks. Concurrency can be changed in Settings.",
  "重新生成": "Regenerate",
  "章节": "Chapters",
  "金句": "Key quotes",
  "本视频": "This video",
  "全部": "All",
  "手记": "Memos",
  "AI 记": "AI Notes",
  "字幕补齐中…": "Fetching transcript…",
  "AI 笔记": "AI Notes",
  "生成 AI 笔记": "Generate AI notes",
  "把整段字幕交给大模型，整理成一份适合复习的结构化笔记。需要先在设置页配置 AI 服务。":
    "Turn the full transcript into structured notes for review. Configure an AI provider in Settings first.",
  "笔记提示词": "Notes prompt",
  "AI 笔记模板": "AI note template",
  "自定义": "Custom",
  "选择一种模板后生成笔记；选择“自定义”可编辑专属提示词。":
    "Choose a template to generate notes. Select Custom to edit your own prompt.",
  "笔记生成失败": "Note generation failed",
  "请先打开一个支持的视频。": "Open a supported video first.",
  "还没有笔记": "No notes yet",
  "播放时点播放器上的「笔记」按钮，或按 n，就能记下当前时间点的一条笔记。":
    "Use the Note button on the player, or press N, to save a note at the current time.",
  "播放时点播放器上的「笔记」按钮，或按":
    "Use the Note button on the player, or press",
  "，就能记下当前时间点的一条笔记。":
    "to save a note at the current timestamp.",
  "记录一条手记": "Write a memo",
  "视频页保存时会附带当前播放位置":
    "When saved on a video page, the current playback position is included",
  "保存": "Save",
  "还没有手记": "No memos yet",
  "这个视频还没有手记": "No memos for this video",
  "播放时点播放器上的「笔记」按钮，或按 n，就能记下当前时间点的一条手记。":
    "Use the Note button on the player, or press N, to save a memo at the current timestamp.",
  "，就能记下当前时间点的一条手记。":
    "to save a memo at the current timestamp.",
  "无需打开视频，也可以随时记录文字。":
    "You can write a memo at any time, even without a video open.",
  "还没有 AI 记": "No AI notes yet",
  "在“问 AI”中可将任意回答保存到这里。":
    "Save any answer from Ask AI here.",
  "仅结合当前视频上下文回答": "Answers using the current video context only",
  "关联上下文": "Use context",
  "关联字幕": "Use transcript",
  "关联概述": "Use overview",
  "关联 AI 笔记": "Use AI notes",
  "关联手记": "Use memos",
  "清空对话": "Clear chat",
  "Enter 发送 · Shift+Enter 换行": "Enter to send · Shift+Enter for a new line",
  "发送": "Send",
  "想问 AI 什么？": "What would you like to ask?",
  "选择字幕、概述、AI 笔记或手记作为当前视频的上下文。":
    "Choose the transcript, overview, AI notes, or memos as context for the current video.",
  "请先打开一个支持的视频，再使用问 AI。":
    "Open a supported video before using Ask AI.",
  "解释": "Explain",
  "输入问题…": "Type a question…",
  "向 AI 提问": "Ask AI",
  "写下想法、待办或灵感…": "Write down an idea, task, or thought…",
  "重新获取字幕（跳过缓存）": "Refresh captions (skip cache)",
  "重新获取字幕": "Refresh captions",
  "用 AI 补标点、改同音错别字（需先配置 AI 服务）":
    "Use AI to add punctuation and fix recognition errors (AI provider required)",
  "在字幕里搜索（快捷键 /）": "Search transcript (shortcut: /)",
  "搜索字幕": "Search transcript",
  "搜索字幕（原文、顺句稿、译文都会搜）":
    "Search original, polished, and translated text",
  "关闭搜索": "Close search",
  "请先输入问题。": "Enter a question first.",
  "思考中…": "Thinking…",
  "存入 AI 记": "Save to AI Notes",
  "已存入 AI 记": "Saved to AI Notes",
  "保存失败": "Save failed",
  "保存中…": "Saving…",
  "已保存": "Saved",
  "存为笔记": "Save as note",
  "存为手记": "Save as memo",
  "打开": "Open",
  "播放": "Play",
  "链接": "Link",
  "已复制": "Copied",
  "删除这条笔记": "Delete this note",
  "删除这条手记": "Delete this memo",
  "删除这条 AI 记": "Delete this AI note",
  "删除": "Delete",
  "选择这条笔记": "Select this note",
  "已选": "Selected",
  "全选已加载": "Select loaded",
  "取消全选已加载": "Deselect loaded",
  "删除所选": "Delete selected",
  "清空当前范围": "Clear current scope",
  "跳到这个时间点": "Jump to this timestamp",
  "在新标签页打开原视频并跳到这一刻":
    "Open the original video at this timestamp in a new tab",
  "复制笔记正文": "Copy note text",
  "复制带时间戳的视频链接": "Copy timestamped video link",
  "打开视频并跳到记录位置": "Open the video at the saved timestamp",
  "复制手记正文": "Copy memo text",
  "编辑": "Edit",
  "思维导图": "Mind map",
  "编辑这条笔记": "Edit this note",
  "保存修改": "Save changes",
  "取消": "Cancel",
  "笔记内容不能为空。": "Note content cannot be empty.",
  "保存失败，请重试。": "Save failed. Please try again.",
  "回答中…": "Answering…",
  "概览生成失败": "Overview generation failed",
  "概览提示词（可调整）": "Overview prompt (editable)",
  "修改会自动保存在本机，并用于下一次生成。":
    "Changes are saved locally and used for the next generation.",
  "已自动保存": "Saved automatically",
  "请稍后重试。": "Please try again later.",
  "这个视频还没有笔记": "No notes for this video",
  "还没有任何笔记": "No notes yet",
  "导出当前范围": "Export current scope",
  "导出为 JSON": "Export as JSON",
  "导出为 Markdown": "Export as Markdown",
  "导出为 CSV": "Export as CSV",
  "加载更多": "Load more",
  "已显示": "Showing",
  "共": "of",
  "访问锚点": "Open timestamp",
  "手记截图": "Memo screenshot",
  "已保存，并记录当前视频访问锚点。":
    "Saved with the current video timestamp.",
  "已保存。": "Saved.",
  "请先输入手记内容。": "Write something before saving.",
  "顺句中": "Polishing…",
  "翻译中…": "Translating…",
  "AI 正在润色这条笔记…": "AI is polishing this note…",
  "正在解释…": "Explaining…",
  "AI 笔记生成中...": "Generating AI notes...",
  "输入问题…（Enter 发送）": "Type a question… (Enter to send)",
  "恢复默认": "Restore default",
  "重置": "Reset",
  "关闭": "Close",
  "AI 笔记功能栏": "AI notes toolbar",
  "笔记样式切换": "Note style switch",
  "导出 AI 笔记": "Export AI notes",
  // mermaid 卡片工具栏（切换前已渲染的旧卡片靠属性扫描兜底翻译）
  "复制 Mermaid 源码": "Copy Mermaid source",
  "下载 SVG": "Download SVG",
  "查看源码": "View source",
  "查看图形": "View diagram",
  "重置视图": "Reset view",
});

const SIDE_PANEL_ZH = Object.freeze(
  Object.fromEntries(Object.entries(SIDE_PANEL_EN).map(([zh, en]) => [en, zh])),
);

function uiText(text) {
  const value = String(text ?? "");
  const dictionary = state.uiLanguage === "en" ? SIDE_PANEL_EN : SIDE_PANEL_ZH;
  if (dictionary[value]) return dictionary[value];
  let normalized = value.replace(/\s+/g, " ").trim();
  // 多行 HTML 文案归一化后会在 CJK 标点旁多出空格（"金句。 需要"），
  // 折叠掉再查一次，否则永远匹配不上字典键（"金句。需要"）。
  normalized = normalized.replace(/ +([。！？；，、）】》"])/g, "$1").replace(
    /([。！？；，、（【《"]) +/g,
    "$1",
  );
  if (dictionary[normalized]) return dictionary[normalized];
  const replacements =
    state.uiLanguage === "en"
      ? [
          [/^(\d+) 段$/, "$1 segments"],
          [/^(\d+) 章节$/, "$1 chapters"],
          [/^(\d+) 金句$/, "$1 key quotes"],
          [/^(\d+) 条$/, "$1 items"],
          [/^(\d+) 条命中$/, "$1 matches"],
          [/^已选 (\d+) 条$/, "$1 selected"],
          [/^已显示 (\d+) \/ 共 (\d+) 条$/, "Showing $1 of $2"],
          [/^(\d+) 块失败，结果不完整$/, "$1 chunks failed; result incomplete"],
          [/^已保存$/, "Saved"],
        ]
      : [
          [/^(\d+) segments$/, "$1 段"],
          [/^(\d+) chapters$/, "$1 章节"],
          [/^(\d+) key quotes$/, "$1 金句"],
          [/^(\d+) items$/, "$1 条"],
          [/^(\d+) matches$/, "$1 条命中"],
          [/^(\d+) selected$/, "已选 $1 条"],
          [/^Showing (\d+) of (\d+)$/, "已显示 $1 / 共 $2 条"],
          [/^(\d+) chunks failed; result incomplete$/, "$1 块失败，结果不完整"],
          [/^Saved$/, "已保存"],
        ];
  return replacements.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    value,
  );
}

function applySidepanelLanguage() {
  document.documentElement.lang = state.uiLanguage;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      node.parentElement?.closest?.(
        ".segment-text, .entry-text, .chat-message-text, .video-title, .note-meta, .memo-created",
      )
    ) {
      continue;
    }
    const match = node.nodeValue.match(/^(\s*)(.*?)(\s*)$/s);
    if (!match?.[2]) continue;
    node.nodeValue = `${match[1]}${uiText(match[2])}${match[3]}`;
  }
  for (const element of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
    for (const attribute of ["placeholder", "title", "aria-label"]) {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, uiText(element.getAttribute(attribute)));
      }
    }
  }
}

const state = {
  windowId: null,
  uiLanguage: "zh-CN",
  tabId: null,
  site: null,
  bvid: null,
  page: 1,
  data: null,
  analysis: null,
  analysisLanguage: null,
  polished: {}, // 分段 id → 顺句后的文字
  polishMode: false,
  translated: {}, // 分段 id → 译文（中文字幕对应英文，外文字幕对应中文）
  transcriptMode: "original", // original | translated | bilingual
  isChinese: true, // 决定顺句入口的有无与翻译方向的提示
  polishRun: 0, // 换视频/切换显示方式时自增，用来作废进行中的批次
  view: "idle", // idle | disabled | loading | error | ready
  errorResult: null,
  tab: "transcript",
  notesScope: "video", // video | all | memo | ai
  ownerTabId: null, // 面板归属的标签页 id（per-tab 实例锁定）
  activeIndex: -1,
  lastUserScrollAt: 0,
  lastAutoScrollAt: 0,
  searchQuery: "", // 搜索期间暂停自动跟随，命中行之外全部藏起
  currentTime: 0,
  chatMessages: [], // 当前视频的多轮问答，仅在本次侧栏会话中保留
  chatSending: false,
  notesForExport: [],
  notesLoaded: [],
  notesTotalCount: 0,
  notesHasMore: false,
  notesDeleteMode: false,
  videoNoteGenerating: false,
  selectedNoteIds: new Set(),
  overviewPrompts: { ...BILI_SETTINGS.DEFAULT_OVERVIEW_PROMPTS },
  // 提示词的编辑语言可独立于侧栏界面语言；例如中文界面也能直接维护英文模板。
  overviewPromptLanguage: "zh-CN",
  notePrompts: { ...BILI_SETTINGS.DEFAULT_NOTE_PROMPTS },
  notePromptLanguage: "zh-CN",
  noteStyle: BILI_NOTE_TEMPLATES.DEFAULT_NOTE_STYLE,
};

const el = (id) => document.getElementById(id);

// 字幕行的 DOM 索引，renderSegments 时重建。直接持有节点引用让查找变 O(1)：
// 用 querySelector 找行的话，上千段的视频全量重画就是 O(n²)，切视图会卡。
const segmentView = {
  rows: [], // 与 segments 同下标
  byId: new Map(), // 分段 id → { row, text }
  activeRow: null,
};

// ============================================================
// 渲染调度
// ============================================================

const SECTIONS = [
  "loadingState",
  "idleState",
  "disabledState",
  "errorState",
  "transcriptPanel",
  "overviewPanel",
  "notesPanel",
  "chatPanel",
];

// 笔记独立于字幕管线：即使字幕拉取失败，之前存的笔记也应该能看。
function render() {
  for (const id of SECTIONS) el(id).hidden = true;

  if (state.view === "disabled") {
    el("disabledState").hidden = false;
    return;
  }
  if (state.tab === "notes") {
    el("notesPanel").hidden = false;
    return;
  }
  // 问 AI 与字幕管线解耦：字幕加载中、失败或当前没有视频上下文时，均可对话。
  if (state.tab === "chat") {
    el("chatPanel").hidden = false;
    return;
  }
  if (state.view !== "ready") {
    el(`${state.view}State`).hidden = false;
    return;
  }
  const panel =
    state.tab === "overview"
      ? "overviewPanel"
      : state.tab === "chat"
        ? "chatPanel"
        : "transcriptPanel";
  el(panel).hidden = false;
}

function setView(view, errorResult = null) {
  state.view = view;
  state.errorResult = errorResult;

  if (view === "error" && errorResult) {
    const needLogin = errorResult.error === "NEED_LOGIN";
    el("errorTitle").textContent = uiText(
      needLogin ? "字幕需要登录" : "没能取到字幕",
    );
    el("errorText").textContent =
      uiText(errorResult.message || errorResult.error || "未知错误，请重试。");
    el("errorLoginLink").hidden = !needLogin;
  }
  render();
}

function switchTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll(".tab")) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
  hideExplain();
  updateFollowPill();
  if (tab === "notes") loadNotes();
  if (tab === "chat") {
    renderChat();
    el("chatInput").focus();
  }
  render();
}

// ============================================================
// 当前标签页
// ============================================================

function parseVideoRef(input) {
  const text = String(input || "");
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "youtube.com" && url.pathname === "/watch") {
      const videoId = url.searchParams.get("v") || "";
      return /^[A-Za-z0-9_-]{6,20}$/.test(videoId)
        ? { site: "youtube", videoId, page: 1 }
        : null;
    }
    if (hostname === "bilibili.com") {
      const match = text.match(/BV[0-9A-Za-z]{10}/);
      if (!match) return null;
      const page = Math.max(1, Number(url.searchParams.get("p")) || 1);
      return { site: "bilibili", videoId: match[0], page: Math.floor(page) };
    }
  } catch (error) {
    return null;
  }
  return null;
}

async function activeTab(preferredTab = null) {
  if (preferredTab?.url && parseVideoRef(preferredTab.url)) return preferredTab;

  // per-tab 面板只属于自己那个标签页：先查 ownerTabId，它不存在或
  // 已关闭再退回「活动标签页」兜底（首次打开、owner 还没锁定时）。
  if (state.ownerTabId != null) {
    try {
      const owner = await chrome.tabs.get(state.ownerTabId);
      return owner;
    } catch (error) {
      // owner 标签页已被关闭——面板实例也该随标签页销毁了，返回 null。
      state.ownerTabId = null;
      return null;
    }
  }

  // side panel 在 Chrome / Edge 中对 currentWindow 的归属并不完全一致。
  // 逐个尝试并优先返回真正的受支持视频页，避免拿到别的窗口活动标签。
  const queries = [
    { active: true, lastFocusedWindow: true },
    state.windowId == null ? null : { active: true, windowId: state.windowId },
    { active: true, currentWindow: true },
    { active: true },
  ].filter(Boolean);
  let fallback = preferredTab || null;
  for (const query of queries) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query(query);
    } catch (error) {
      continue;
    }
    fallback ||= tabs[0] || null;
    const videoTab = tabs.find((tab) => parseVideoRef(tab?.url));
    if (videoTab) return videoTab;
  }
  return fallback;
}

// 跟随当前标签页：换了视频就重新取字幕，不是播放页就回到提示态。
async function syncWithActiveTab({ force = false, tab: preferredTab = null } = {}) {
  const tab = await activeTab(preferredTab);
  const video = parseVideoRef(tab?.url);

  if (!video) {
    resetChat();
    state.site = null;
    state.bvid = null;
    state.data = null;
    state.analysis = null;
    setView("idle");
    return;
  }

  let scope = { enabled: true };
  try {
    scope = await chrome.runtime.sendMessage({
      action: "isSiteEnabled",
      site: video.site,
    });
  } catch (error) {
    // 后台短暂重启不应让已打开的侧边栏闪成停用状态。
  }

  if (scope?.enabled === false) {
    const siteName = video.site === "youtube" ? "YouTube" : "Bilibili";
    resetChat();
    state.tabId = tab.id;
    state.site = video.site;
    state.bvid = video.videoId;
    state.page = video.page;
    state.data = null;
    state.analysis = null;
    el("disabledTitle").textContent =
      state.uiLanguage === "en"
        ? `${siteName} is disabled under Site availability`
        : `${siteName} 已在适用范围中关闭`;
    el("disabledText").textContent =
      state.uiLanguage === "en"
        ? `Video Assistant will not add buttons or read captions on ${siteName}.`
        : `Video Assistant 不会在 ${siteName} 页面注入按钮或读取字幕。`;
    setView("disabled");
    return;
  }

  const unchanged =
    video.site === state.site &&
    video.videoId === state.bvid &&
    video.page === state.page &&
    state.data;
  if (!unchanged) resetChat();
  state.tabId = tab.id;
  state.site = video.site;
  state.bvid = video.videoId;
  state.page = video.page;
  if (unchanged && !force) return;

  state.analysis = null;
  await loadTranscript({ force });
  if (state.tab === "notes") loadNotes();
}

// ============================================================
// 字幕
// ============================================================

async function loadTranscript({ force = false } = {}) {
  el("loadingTitle").textContent = uiText("正在获取字幕…");
  el("loadingSubtitle").textContent = force
    ? state.uiLanguage === "en" ? "Cache bypassed" : "已跳过缓存"
    : "";
  el("videoMeta").hidden = true;
  setView("loading");

  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: "fetchTranscript",
      site: state.site,
      bvid: state.bvid,
      page: state.page,
      tabId: state.tabId,
      forceRefresh: force,
    });
  } catch (error) {
    setView("error", { message: error.message });
    return;
  }

  if (!result?.success) {
    if (result?.videoInfo) renderMeta(result.videoInfo, null, false);
    setView("error", result);
    return;
  }

  state.data = result;
  state.activeIndex = -1;
  // 之前顺过的句、翻过的译随缓存一起回来了，直接复用，不必再花一次钱。
  state.polished = result.polished || {};
  state.translated = result.translated || {};
  state.polishRun += 1;
  // 缓存里有就直接摆出来，否则用户会以为上次白跑了。
  state.polishMode = Object.keys(state.polished).length > 0;
  state.isChinese = BILI_TRANSCRIPT.isChineseSubtitle(result.language);
  state.transcriptMode = Object.keys(state.translated).length > 0 ? "bilingual" : "original";
  renderMeta(result.videoInfo, result, result.fromCache);
  renderSegments(result.segments);
  // 换了视频，上一个视频的搜索词不该继续过滤新列表。
  closeSearch();
  updateTranscriptControls();
  const analysisLanguage = result.analysisLanguage || "zh-CN";
  restoreOverview(
    analysisLanguage === state.uiLanguage ? result.analysis : null,
    analysisLanguage,
  );
  setView("ready");
}

function renderMeta(videoInfo, result, fromCache) {
  el("videoTitle").textContent = videoInfo?.title || "";
  el("videoOwner").textContent = videoInfo?.owner || "";

  const badge = el("subtitleBadge");
  if (result) {
    badge.textContent = `${result.languageLabel || result.language}${result.isAiSubtitle ? " · AI" : ""}`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  el("cacheBadge").hidden = !fromCache;
  el("videoMeta").hidden = false;
}

function renderSegments(segments = []) {
  const list = el("transcriptList");
  list.textContent = "";
  el("segmentCount").textContent = segmentCountText();
  segmentView.rows = [];
  segmentView.byId = new Map();
  segmentView.activeRow = null;

  const fragment = document.createDocumentFragment();
  segments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment";
    row.dataset.index = String(index);
    row.dataset.id = segment.id;

    const time = document.createElement("span");
    time.className = "segment-time";
    time.textContent = formatTimestamp(segment.start);

    const text = document.createElement("span");
    text.className = "segment-text";
    paintSegmentText(text, segment);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ghost-btn segment-save-btn";
    saveBtn.textContent = uiText("存为手记");
    saveBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await saveTextAsVideoNote(saveBtn, {
        timestamp: segment.start,
        text: noteTextForSegment(segment),
        asMemo: true,
      });
    });

    row.append(time, text, saveBtn);
    row.addEventListener("click", (event) => onEntryClick(event, segment.start));
    fragment.appendChild(row);
    segmentView.rows.push(row);
    segmentView.byId.set(segment.id, { row, text });
  });
  list.appendChild(fragment);
}

// 这一段的「原文」——中文字幕开着顺句时，原文指的是顺句稿。
function sourceText(segment) {
  if (state.isChinese && state.polishMode && state.polished[segment.id]) {
    return state.polished[segment.id];
  }
  return segment.text;
}

// 这一段该显示什么文字。双语模式要两行，不走这里，见 paintSegmentText。
function segmentDisplayText(segment) {
  if (state.transcriptMode === "translated") {
    // 还没翻到这一段时先摆原文，比留一片空白好读。
    return state.translated[segment.id] || sourceText(segment);
  }
  return sourceText(segment);
}

// 笔记跟随当前阅读视图：双语时同时保存原文和已取得的译文，单语时保存当前显示内容。
function noteTextForSegment(segment) {
  if (state.transcriptMode === "bilingual") {
    return [sourceText(segment), state.translated[segment.id]].filter(Boolean).join("\n");
  }
  return segmentDisplayText(segment);
}

async function saveTextAsVideoNote(button, { timestamp, text, asMemo = false }) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = uiText("保存中…");
  let result;
  try {
    // 字幕区按产品口径存成手记（kind=memo），金句仍存成笔记（quote）。
    result = await chrome.runtime.sendMessage({
      action: asMemo ? "saveMemo" : "saveNote",
      kind: asMemo ? "memo" : undefined,
      site: state.site,
      bvid: state.bvid,
      page: state.page,
      timestamp,
      text,
    });
  } catch (error) {
    result = { success: false };
  }
  button.classList.toggle("is-success", Boolean(result?.success));
  button.textContent = uiText(result?.success ? "已保存" : "保存失败");
  setTimeout(() => {
    button.disabled = false;
    button.classList.remove("is-success");
    button.textContent = original;
  }, 1_500);
}

// 把文字写进节点，命中搜索词的部分套上 <mark>。字幕是外部内容，
// 一律 textContent 逐节点写、不拼 HTML；没有搜索词时走快路径。
function writeText(node, text) {
  const query = state.searchQuery;
  const source = String(text || "");
  if (!query) {
    node.textContent = source;
    return;
  }

  const lower = source.toLowerCase();
  let cursor = 0;
  node.textContent = "";
  for (let at = lower.indexOf(query); at >= 0; at = lower.indexOf(query, cursor)) {
    if (at > cursor) {
      const plain = document.createElement("span");
      plain.textContent = source.slice(cursor, at);
      node.appendChild(plain);
    }
    const hit = document.createElement("mark");
    hit.className = "search-hit";
    hit.textContent = source.slice(at, at + query.length);
    node.appendChild(hit);
    cursor = at + query.length;
  }

  // 一条也没命中：双语的另一行命中了，这一行照常显示。
  if (cursor === 0) {
    node.textContent = source;
    return;
  }
  if (cursor < source.length) {
    const tail = document.createElement("span");
    tail.textContent = source.slice(cursor);
    node.appendChild(tail);
  }
}

function paintSegmentText(node, segment) {
  if (state.transcriptMode === "bilingual") {
    node.textContent = "";
    const source = document.createElement("span");
    source.className = "segment-source";
    writeText(source, sourceText(segment));

    const translation = document.createElement("span");
    const ready = state.translated[segment.id];
    translation.className = ready
      ? "segment-translation"
      : "segment-translation pending";
    if (ready) writeText(translation, ready);
    else translation.textContent = uiText("翻译中…");

    node.append(source, translation);
    return;
  }
  writeText(node, segmentDisplayText(segment));
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// 用户正在选词时，点击不应该被当成跳转。
function hasTextSelection() {
  const selection = window.getSelection();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
}

function onEntryClick(event, seconds) {
  if (hasTextSelection()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  seekTo(seconds);
}

async function seekTo(seconds) {
  if (!state.tabId) return;
  try {
    await chrome.tabs.sendMessage(state.tabId, {
      action: "seekTo",
      seconds: Math.floor(seconds),
    });
  } catch (error) {
    // 页面刚刷新时 content script 可能还没就位，忽略即可。
  }
}

// ============================================================
// 播放进度跟随
// ============================================================

function highlightActive(currentSeconds) {
  state.currentTime = Math.max(0, Number(currentSeconds) || 0);
  const segments = state.data?.segments || [];
  if (!segments.length || state.tab !== "transcript") return;

  // 分段按开始时间有序，二分找「最后一个 start <= 当前时刻」的下标。
  let low = 0;
  let high = segments.length - 1;
  let index = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].start <= currentSeconds) {
      index = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (index === state.activeIndex) return;

  segmentView.activeRow?.classList.remove("active");
  state.activeIndex = index;
  segmentView.activeRow = index >= 0 ? segmentView.rows[index] || null : null;
  if (!segmentView.activeRow) return;
  segmentView.activeRow.classList.add("active");

  // 搜索时列表被过滤过，滚动条属于搜索结果，不抢。
  if (state.searchQuery) return;
  if (Date.now() - state.lastUserScrollAt < AUTOSCROLL_SUPPRESS_MS) return;
  state.lastAutoScrollAt = Date.now();
  segmentView.activeRow.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function trackPlayback() {
  if (!state.tabId || !state.bvid) return;
  try {
    const response = await chrome.tabs.sendMessage(state.tabId, {
      action: "getPlaybackTime",
    });
    if (response) highlightActive(Number(response.currentTime) || 0);
  } catch (error) {
    // content script 不在（页面正在跳转）——下一轮再试。
  }
  // 挂在轮询里而不是滚动事件里，抑制窗口过期后浮标才能自己消失。
  updateFollowPill();
}

// ============================================================
// 「回到当前句」浮标 + 字幕搜索
// ============================================================

// 自动跟随停下来时（用户滚开了，或正在搜索），给一条一键回到播放位置的路。
function updateFollowPill() {
  const suppressed = Date.now() - state.lastUserScrollAt < AUTOSCROLL_SUPPRESS_MS;
  const show =
    state.view === "ready" &&
    state.tab === "transcript" &&
    state.activeIndex >= 0 &&
    (Boolean(state.searchQuery) || suppressed);
  el("followPill").hidden = !show;
}

function scrollToActive() {
  const row = segmentView.rows[state.activeIndex];
  if (!row) return;
  // 记一笔，免得这次滚动被滚动监听当成「用户滚开了」。
  state.lastAutoScrollAt = Date.now();
  row.scrollIntoView({ block: "center", behavior: "smooth" });
}

function jumpToActive() {
  // 从搜索结果跳回来时顺手收掉搜索，否则当前句多半被过滤藏着；
  // closeSearch 自己会把视线送回当前句，这里不必再滚一次。
  if (state.searchQuery) closeSearch();
  else scrollToActive();
  state.lastUserScrollAt = 0;
  updateFollowPill();
}

// 搜索匹配「屏幕上可能出现过的所有文字」：原文、顺句稿、译文。
function segmentSearchText(segment) {
  return [segment.text, state.polished[segment.id], state.translated[segment.id]]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function applySearchFilter(query) {
  state.searchQuery = String(query || "").trim().toLowerCase();
  const segments = state.data?.segments || [];

  let hits = 0;
  let firstHit = null;
  segments.forEach((segment, index) => {
    const match =
      !state.searchQuery || segmentSearchText(segment).includes(state.searchQuery);
    if (match) {
      hits += 1;
      if (!firstHit) firstHit = segmentView.rows[index] || null;
    }
    const row = segmentView.rows[index];
    if (row) row.hidden = !match;
  });

  // 重画是为了给命中的字套上 <mark>，光靠过滤眼睛没有落点。
  repaintSegmentText();
  el("searchCount").textContent = state.searchQuery
    ? uiText(`${hits} 条命中`)
    : "";

  // 滚到首个命中行，否则用户看到一片空白会以为搜索没生效。
  // 逐键过滤时用瞬时滚动，平滑动画会互相打架。
  if (state.searchQuery && firstHit) {
    state.lastAutoScrollAt = Date.now();
    firstHit.scrollIntoView({ block: "center", behavior: "auto" });
  }
  updateFollowPill();
}

function openSearch() {
  el("searchRow").hidden = false;
  el("searchInput").focus?.();
}

function closeSearch() {
  el("searchRow").hidden = true;
  el("searchInput").value = "";
  applySearchFilter("");
  // 收起搜索后视线还留在某条命中上，把它送回正在播的那句。
  scrollToActive();
}

// ============================================================
// 进度条
// ============================================================

const PROGRESS_NODES = {
  // 顺句和翻译按语种二选一，同一时刻只会有一个在跑，共用这一条进度。
  rewrite: { row: "rewriteProgress", bar: "rewriteProgressBar", text: "rewriteProgressText" },
  analysis: { row: null, bar: "overviewProgressBar", text: "overviewProgressText" },
};

function showProgress(kind, done, total) {
  const nodes = PROGRESS_NODES[kind];
  if (!nodes) return;
  const row = nodes.row ? el(nodes.row) : null;
  const bar = el(nodes.bar);
  const text = el(nodes.text);
  if (row) row.hidden = false;

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  if (bar) bar.style.width = `${percent}%`;
  if (text) {
    text.textContent = total > 0
      ? state.uiLanguage === "en"
        ? `${done}/${total} batches complete (${percent}%)`
        : `${done}/${total} 批完成（${percent}%）`
      : uiText("正在准备…");
  }
}

function hideProgress(kind) {
  const nodes = PROGRESS_NODES[kind];
  if (!nodes) return;
  const row = nodes.row ? el(nodes.row) : null;
  const bar = el(nodes.bar);
  if (row) row.hidden = true;
  if (bar) bar.style.width = "0%";
}

// 设置在设置页改动后不会自动同步过来，每次用之前读一遍。
async function loadSettings() {
  const stored = await chrome.storage.local.get([
    BILI_SETTINGS.STORAGE_KEY,
    BILI_SETTINGS.LEGACY_STORAGE_KEY,
  ]);
  return BILI_SETTINGS.normalizeAppSettings(
    stored[BILI_SETTINGS.STORAGE_KEY] ?? stored[BILI_SETTINGS.LEGACY_STORAGE_KEY],
  );
}

function segmentCountText() {
  return uiText(`${state.data?.segments?.length || 0} 段`);
}

// 借分段计数那一行显示临时提示，几秒后还原。
function showSegmentNotice(message) {
  el("segmentCount").textContent = message;
  setTimeout(() => {
    el("segmentCount").textContent = segmentCountText();
  }, 5000);
}

// 顺句只给中文字幕（外文字幕本来就带标点）；顺句和翻译任何一个在跑时
// 两套控件都锁住，免得两轮改写互相踩对方的批次。
function updateTranscriptControls(running) {
  const busy = Boolean(running);

  const button = el("polishBtn");
  button.hidden = !state.isChinese;
  button.disabled = busy;
  button.textContent = uiText(
    running === "polish" ? "顺句中" : state.polishMode ? "原文" : "顺句",
  );

  const modes = el("transcriptMode");
  modes.hidden = !state.data;
  for (const node of modes.querySelectorAll(".segmented-btn")) {
    const active = node.dataset.mode === state.transcriptMode;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
    node.disabled = busy;
  }
}

// 只重画文字，不重建整个列表——重建会丢掉高亮和滚动位置。
function repaintSegmentText(segmentIds) {
  const segments = state.data?.segments || [];
  const wanted = segmentIds ? new Set(segmentIds) : null;

  for (const segment of segments) {
    if (wanted && !wanted.has(segment.id)) continue;
    const nodes = segmentView.byId.get(segment.id);
    if (nodes) paintSegmentText(nodes.text, segment);
  }
}

// 顺句和翻译是同一套流程，差异集中在这张表里。
const REWRITE_KINDS = Object.freeze({
  polish: {
    action: "polishSegments",
    field: "polished",
    label: "顺句",
    plan: (segments) => BILI_AI.planPunctuationBatches(segments),
  },
  translate: {
    action: "translateSegments",
    field: "translated",
    label: "翻译",
    plan: (segments) => BILI_AI.planTranslationBatches(segments),
  },
});

// 偶发失败（限流、超时抖动）自动补一轮前的等待。太短会撞回同一次限流窗口。
const REWRITE_RETRY_DELAY_MS = 1500;

async function togglePolish() {
  if (!state.data) return;

  state.polishMode = !state.polishMode;
  // 关掉再打开时，上一轮还在飞的批次不应该再往界面上写。
  state.polishRun += 1;
  repaintSegmentText();
  updateTranscriptControls();

  if (state.polishMode) await runRewrite("polish", state.polishRun);
}

async function setTranscriptMode(mode) {
  if (!state.data) return;
  if (!["original", "translated", "bilingual"].includes(mode)) return;
  if (mode === state.transcriptMode) return;

  state.transcriptMode = mode;
  state.polishRun += 1;
  repaintSegmentText();
  updateTranscriptControls();

  if (mode !== "original") await runRewrite("translate", state.polishRun);
}

// 从当前播放位置切开、后半段优先：眼前的内容几秒内就有结果，
// 前面的部分随后补齐——总量和费用完全不变。
function orderFromPlayback(todo) {
  const segments = state.data?.segments || [];
  const active = segments[state.activeIndex];
  if (!active) return todo;

  const ahead = [];
  const behind = [];
  for (const segment of todo) {
    (segment.start >= active.start ? ahead : behind).push(segment);
  }
  return [...ahead, ...behind];
}

async function runRewrite(kind, run) {
  const task = REWRITE_KINDS[kind];
  const segments = state.data?.segments || [];
  const todo = segments.filter((segment) => !state[task.field][segment.id]);
  if (!todo.length) {
    updateTranscriptControls();
    return;
  }

  const batches = task.plan(orderFromPlayback(todo));
  const concurrency = (await loadSettings()).aiConcurrency;

  showProgress("rewrite", 0, batches.length);
  updateTranscriptControls(kind);

  const runBatch = async (batch) => {
    if (run !== state.polishRun) return null;
    const result = await chrome.runtime.sendMessage({
      action: task.action,
      site: state.site,
      bvid: state.bvid,
      page: state.page,
      segmentIds: batch.map((segment) => segment.id),
    });
    if (!result?.success) throw new Error(result?.message || `${task.label}失败`);

    // 每批一回来就刷到界面上，用户可以边生成边往下读。
    if (run === state.polishRun) {
      const done = result[task.field] || {};
      Object.assign(state[task.field], done);
      repaintSegmentText(Object.keys(done));
    }
    return result;
  };

  const results = await BILI_CONCURRENCY.mapWithConcurrency(
    batches,
    concurrency,
    runBatch,
    (done, total) => {
      if (run === state.polishRun) showProgress("rewrite", done, total);
    },
  );

  // 偶发失败（限流、超时抖动）静默补一轮，别让用户手点。
  // 全军覆没就不补了——那多半是配置错误，重试只会把同一个错误再撞一遍。
  const failedIndexes = results
    .map((result, index) => (result.status === "rejected" ? index : -1))
    .filter((index) => index >= 0);
  if (
    failedIndexes.length &&
    failedIndexes.length < batches.length &&
    run === state.polishRun
  ) {
    await new Promise((resolve) => setTimeout(resolve, REWRITE_RETRY_DELAY_MS));
    const retried = await BILI_CONCURRENCY.mapWithConcurrency(
      failedIndexes.map((index) => batches[index]),
      concurrency,
      runBatch,
    );
    failedIndexes.forEach((batchIndex, i) => {
      if (retried[i].status === "fulfilled") results[batchIndex] = retried[i];
    });
  }

  if (run !== state.polishRun) return;
  hideProgress("rewrite");

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length === batches.length) {
    // 全失败多半是没配好或被限流，退回原文并说明原因。
    if (kind === "polish") state.polishMode = false;
    else state.transcriptMode = "original";
    repaintSegmentText();
    showSegmentNotice(failures[0].reason?.message || `${task.label}失败`);
  } else if (failures.length) {
    // 部分失败仍保留已成功的部分，剩下的再点一次即可补齐。
    showSegmentNotice(`${failures.length} 批失败，再点一次「${task.label}」可以补齐。`);
  }
  updateTranscriptControls();
}

// ============================================================
// 问 AI
// ============================================================

function resetChat() {
  chatPortDisconnect();
  stopTypewriter();
  state.chatMessages = [];
  state.chatSending = false;
  if (el("chatMessages")) renderChat();
}

function chatContextSelection() {
  return {
    transcript: Boolean(el("chatContextTranscript").checked),
    overview: Boolean(el("chatContextOverview").checked),
    notes: Boolean(el("chatContextNotes").checked),
    memos: Boolean(el("chatContextMemos").checked),
  };
}

function renderChat() {
  const list = el("chatMessages");
  const empty = el("chatEmpty");
  if (!list || !empty) return;
  list.textContent = "";

  empty.hidden = state.chatMessages.length > 0 || state.chatSending;

  for (const message of state.chatMessages) {
    const bubble = document.createElement("article");
    bubble.className = `chat-message ${message.role}${message.error ? " error" : ""}`;

    // Markdown 会生成 p/ul/table 等块级节点，容器必须是 div；用 p 包裹会形成
    // p > p / p > ul 的非法结构，并放大浏览器默认的段落间距。
    const text = document.createElement("div");
    text.className = "chat-message-text";
    if (message.streaming) {
      // 与 Tab Assistant 一致：每次打字机推进都渲染当前累计 Markdown，
      // 用户不会先看到 ** / # / - 等源码、结束后再突然跳成排版结果。
      text.classList.add("chat-streaming");
      const displayed = displayedChatText(message);
      if (displayed) {
        text.classList.add("markdown-body");
        BILI_MARKDOWN.render(text, displayed, document);
      } else {
        text.classList.add("chat-thinking");
        text.setAttribute("aria-live", "polite");
        text.setAttribute("aria-label", uiText("思考中…"));

        // 空流式阶段使用独立的加载组件，而不是把「正在思考」当作模型正文。
        // 第一个 delta 到达后，typewriterTick 会替换它为实时 Markdown 渲染结果。
        const spinner = document.createElement("span");
        spinner.className = "chat-thinking-spinner";
        spinner.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "chat-thinking-label";
        label.textContent = uiText("思考中…");
        text.append(spinner, label);
      }
    } else if (message.role === "assistant" && !message.error) {
      text.classList.add("markdown-body");
      BILI_MARKDOWN.render(text, message.content, document);
      scheduleMermaidRun();
    } else {
      text.textContent = message.content;
    }
    bubble.appendChild(text);

    if (message.role === "assistant" && !message.error && !message.streaming) {
      const actions = document.createElement("div");
      actions.className = "entry-actions";
      const save = document.createElement("button");
      save.className = "ghost-btn";
      save.type = "button";
      save.textContent = uiText("存入 AI 记");
      save.addEventListener("click", () => saveChatAsNote(message, save));
      actions.appendChild(save);
      bubble.appendChild(actions);
    }
    list.appendChild(bubble);
  }

  el("chatInput").disabled = state.chatSending;
  el("sendChatBtn").disabled = state.chatSending;
  // 图标按钮：状态提示走 title/aria-label，不能写 textContent（会抹掉 SVG）
  el("sendChatBtn").title = uiText(state.chatSending ? "回答中…" : "发送");
  el("sendChatBtn").setAttribute("aria-label", uiText(state.chatSending ? "回答中…" : "发送"));
  list.scrollTop = list.scrollHeight;
}

/** 当前活跃的「问 AI」流式连接；换视频 / 清空对话 / 完成时断开。 */
let activeChatPort = null;

function chatPortDisconnect() {
  try {
    activeChatPort?.disconnect();
  } catch {
    // 已断开，忽略。
  }
  activeChatPort = null;
}

/**
 * 打字机：后台的 SSE 块可能爆发式到达（一个 HTTP chunk 带多个 data 块），
 * 若同步写 textContent，浏览器只在下一帧绘制最终状态，看起来就是整段一次出现。
 * 这里把增量收进 _pending 缓冲，按帧限速吐出，实现逐字效果；
 * 后台本身生成慢时（块间隔 > 16ms），文字依然实时出现，两种节奏自动兼容。
 */
const TYPEWRITER_INTERVAL_MS = 16;
const TYPEWRITER_CHARS_PER_TICK = 4;
let typewriterTimer = null;

/** 已显示文本 = content 去掉尚未吐出的 _pending。 */
function displayedChatText(message) {
  const pending = message?._pending || "";
  return String(message?.content || "").slice(
    0,
    String(message?.content || "").length - pending.length,
  );
}

function typewriterTick() {
  const message = state.chatMessages.find((entry) => entry?.streaming);
  const pending = message?._pending || "";
  if (!message || !pending) {
    stopTypewriter();
    return;
  }
  message._pending = pending.slice(TYPEWRITER_CHARS_PER_TICK);
  const list = el("chatMessages");
  if (!list) return;
  // 直接锚定流式文本节点，避免后续加入操作区或其它状态节点时写错目标。
  // 每次推进都用当前已显示文本重建安全 Markdown DOM。
  const textNode = list.querySelector(".chat-message-text.chat-streaming");
  if (textNode) {
    textNode.classList.remove("chat-thinking");
    textNode.classList.add("markdown-body");
    BILI_MARKDOWN.render(textNode, displayedChatText(message), document);
    list.scrollTop = list.scrollHeight;
  }
}

function stopTypewriter() {
  if (typewriterTimer) {
    clearInterval(typewriterTimer);
    typewriterTimer = null;
  }
}

/** 完成/失败前把积压的增量一次性吐完，避免残留半截文字。 */
function flushTypewriter() {
  const message = state.chatMessages.find((entry) => entry?.streaming);
  if (message) message._pending = "";
  stopTypewriter();
}

/** 流式增量：完整内容始终累积进 content（保存/历史用），待显示部分进 _pending。 */
function appendChatDelta(text) {
  const message = state.chatMessages.find((entry) => entry?.streaming);
  if (!message) return;
  message.content += text;
  message._pending = (message._pending || "") + text;
  if (!typewriterTimer) {
    typewriterTimer = setInterval(typewriterTick, TYPEWRITER_INTERVAL_MS);
  }
  // 立即吐一段，减少首字等待；其余交给定时器平滑推进。
  typewriterTick();
}

/** 流式完成：占位消息升级为正式消息，整表重渲染出 Markdown 与「存入 AI 记」。 */
function finishChatStreaming() {
  flushTypewriter();
  const message = state.chatMessages.find((entry) => entry?.streaming);
  if (message) message.streaming = false;
  state.chatSending = false;
  chatPortDisconnect();
  renderChat();
  el("chatInput").focus();
}

/**
 * 流式失败：还没吐过内容 → 显示错误；已吐过部分内容 → 保留内容并在末尾
 * 追加错误说明（该消息标 error，不进下一轮历史，避免把半截回答当上下文）。
 */
function failChat(messageText, question, timestampSeconds, emitted = false) {
  flushTypewriter();
  const pending = state.chatMessages.find((entry) => entry?.streaming);
  state.chatSending = false;
  chatPortDisconnect();
  if (pending) {
    pending.streaming = false;
    pending.error = true;
    if (pending.content && emitted) {
      pending.content += `\n\n> ⚠️ ${messageText}`;
    } else {
      pending.content = messageText;
    }
  } else {
    state.chatMessages.push({
      role: "assistant",
      content: messageText,
      question,
      timestampSeconds,
      error: true,
    });
  }
  renderChat();
  el("chatInput").focus();
}

async function submitChatQuestion(questionInput) {
  if (state.chatSending) return;
  const input = el("chatInput");
  const question = String(questionInput ?? input.value).trim().slice(0, 2_000);
  if (!question) {
    input.focus();
    return;
  }
  if (!state.site || !state.bvid) {
    state.chatMessages.push({
      role: "assistant",
      content: uiText("请先打开一个支持的视频，再使用问 AI。"),
      error: true,
    });
    renderChat();
    input.focus();
    return;
  }

  const history = state.chatMessages
    .filter((message) => !message.error)
    .map(({ role, content }) => ({ role, content }));
  const timestampSeconds = Math.max(0, Math.floor(state.currentTime));
  state.chatMessages.push({ role: "user", content: question, timestampSeconds });
  // 流式占位气泡：背景逐块推送增量，完成后升级为正式消息。
  state.chatMessages.push({
    role: "assistant",
    content: "",
    question,
    timestampSeconds,
    streaming: true,
  });
  state.chatSending = true;
  input.value = "";
  renderChat();

  chatPortDisconnect();
  let port;
  try {
    port = chrome.runtime.connect({ name: "askVideoStream" });
  } catch (error) {
    failChat("无法建立问答通道，请重载扩展后重试。", question, timestampSeconds);
    return;
  }
  activeChatPort = port;

  let finished = false;
  port.onMessage.addListener((message) => {
    if (message?.type === "delta" && typeof message.text === "string") {
      appendChatDelta(message.text);
    } else if (message?.type === "done") {
      finished = true;
      finishChatStreaming();
    } else if (message?.type === "error") {
      finished = true;
      failChat(
        message.message || "问答失败，请稍后重试。",
        question,
        timestampSeconds,
        Boolean(message.emitted),
      );
    }
  });
  port.onDisconnect.addListener(() => {
    // 完成或出错后的断开不算失败；其余都是通道中断。
    if (!finished && state.chatMessages.some((entry) => entry?.streaming)) {
      failChat("问答连接中断，请重试。", question, timestampSeconds, false);
    }
    activeChatPort = null;
  });

  try {
    port.postMessage({
      type: "start",
      site: state.site,
      bvid: state.bvid,
      page: state.page,
      tabId: state.tabId,
      videoInfo: state.data?.videoInfo || state.errorResult?.videoInfo || null,
      question,
      history,
      contextSelection: chatContextSelection(),
    });
  } catch (error) {
    failChat("问答连接失败，请重试。", question, timestampSeconds);
  }
}

async function saveChatAsNote(message, button) {
  if (!message?.content || !message?.question) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = state.uiLanguage === "en" ? "Saving…" : "保存中…";
  const videoContext = await currentMemoVideoContext(message.timestampSeconds);
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: "saveMemo",
      kind: "ai_note",
      text: (
        state.uiLanguage === "en"
          ? `Q: ${message.question}\n\nA: ${message.content}`
          : `问：${message.question}\n\n答：${message.content}`
      ).slice(0, 12_000),
      ...(videoContext || {}),
    });
  } catch (error) {
    result = { success: false };
  }
  button.classList.toggle("is-success", Boolean(result?.success));
  button.textContent = uiText(result?.success ? "已存入 AI 记" : "保存失败");
  setTimeout(() => {
    button.disabled = false;
    button.classList.remove("is-success");
    button.textContent = original;
  }, 1_500);
}

// ============================================================
// AI 概览
// ============================================================

const OVERVIEW_EMPTY_TITLE = "生成 AI 概览";
const OVERVIEW_EMPTY_TEXT =
  "把整段字幕交给大模型，产出覆盖全片的章节和 3-5 条金句。需要先在设置页配置 AI 服务。";
let overviewPromptSaveTimer = null;

function normalizeOverviewPromptLanguage(language) {
  return language === "en" ? "en" : "zh-CN";
}

function renderOverviewPrompt() {
  const language = normalizeOverviewPromptLanguage(state.overviewPromptLanguage);
  el("overviewPrompt").value =
    state.overviewPrompts[language] ||
    BILI_SETTINGS.DEFAULT_OVERVIEW_PROMPTS[language];
}

async function persistOverviewPrompts() {
  const settings = await loadSettings();
  await chrome.storage.local.set({
    [BILI_SETTINGS.STORAGE_KEY]: {
      ...settings,
      overviewPrompts: state.overviewPrompts,
    },
  });
  el("overviewPromptStatus").textContent = uiText("已自动保存");
}

function updateOverviewPrompt() {
  const language = normalizeOverviewPromptLanguage(state.overviewPromptLanguage);
  const value = el("overviewPrompt").value.trim();
  state.overviewPrompts[language] =
    value || BILI_SETTINGS.DEFAULT_OVERVIEW_PROMPTS[language];
  clearTimeout(overviewPromptSaveTimer);
  overviewPromptSaveTimer = setTimeout(() => persistOverviewPrompts(), 400);
}

function resetOverviewPrompt(language) {
  const targetLanguage = normalizeOverviewPromptLanguage(language);
  state.overviewPrompts[targetLanguage] =
    BILI_SETTINGS.DEFAULT_OVERVIEW_PROMPTS[targetLanguage];
  state.overviewPromptLanguage = targetLanguage;
  renderOverviewPrompt();
  clearTimeout(overviewPromptSaveTimer);
  persistOverviewPrompts();
}

let notePromptSaveTimer = null;

function normalizeNotePromptLanguage(language) {
  return language === "en" ? "en" : "zh-CN";
}

function renderNotePrompt() {
  const language = normalizeNotePromptLanguage(state.notePromptLanguage);
  el("notePrompt").value =
    state.notePrompts[language] || BILI_SETTINGS.DEFAULT_NOTE_PROMPTS[language];
}

function renderNoteStyleSelector() {
  const select = el("noteStyleSelect");
  select.textContent = "";
  const metadata = [
    ...BILI_NOTE_TEMPLATES.NOTE_STYLE_METADATA,
    { key: BILI_NOTE_TEMPLATES.CUSTOM_NOTE_STYLE, label: "自定义", labelEn: "Custom" },
  ];
  for (const item of metadata) {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = state.uiLanguage === "en" ? item.labelEn : item.label;
    select.appendChild(option);
  }
  state.noteStyle = BILI_NOTE_TEMPLATES.normalizeStyle(state.noteStyle);
  select.value = state.noteStyle;
  el("noteTemplateDescription").textContent = uiText(
    "选择一种模板后生成笔记；选择“自定义”可编辑专属提示词。",
  );
  updateNoteTemplateVisibility();
}

function updateNoteTemplateVisibility() {
  const isVideoScope = state.notesScope === "video";
  const isCustom = state.noteStyle === BILI_NOTE_TEMPLATES.CUSTOM_NOTE_STYLE;
  el("noteTemplatePicker").hidden = !isVideoScope;
  el("notePromptEditor").hidden = !isVideoScope || !isCustom;
}

async function persistNoteStyle() {
  const settings = await loadSettings();
  await chrome.storage.local.set({
    [BILI_SETTINGS.STORAGE_KEY]: {
      ...settings,
      noteStyle: state.noteStyle,
    },
  });
}

function updateNoteStyle() {
  state.noteStyle = BILI_NOTE_TEMPLATES.normalizeStyle(el("noteStyleSelect").value);
  updateNoteTemplateVisibility();
  persistNoteStyle();
}

function selectedNotePrompt() {
  if (state.noteStyle !== BILI_NOTE_TEMPLATES.CUSTOM_NOTE_STYLE) {
    // 模板提示词与界面语言保持同一语言，否则中文模板会把输出语言拽回中文。
    return BILI_NOTE_TEMPLATES.promptFor(state.noteStyle, state.uiLanguage);
  }
  const language = normalizeNotePromptLanguage(state.notePromptLanguage);
  const customPrompt =
    el("notePrompt").value.trim() || BILI_SETTINGS.DEFAULT_NOTE_PROMPTS[language];
  const sum = state.uiLanguage === "en" ? BILI_NOTE_TEMPLATES.AI_SUM_EN : BILI_NOTE_TEMPLATES.AI_SUM;
  return `${customPrompt}\n\n${sum}`;
}

async function persistNotePrompts() {
  const settings = await loadSettings();
  await chrome.storage.local.set({
    [BILI_SETTINGS.STORAGE_KEY]: {
      ...settings,
      notePrompts: state.notePrompts,
    },
  });
  el("notePromptStatus").textContent = uiText("已自动保存");
}

function updateNotePrompt() {
  const language = normalizeNotePromptLanguage(state.notePromptLanguage);
  const value = el("notePrompt").value.trim();
  state.notePrompts[language] =
    value || BILI_SETTINGS.DEFAULT_NOTE_PROMPTS[language];
  clearTimeout(notePromptSaveTimer);
  notePromptSaveTimer = setTimeout(() => persistNotePrompts(), 400);
}

function resetNotePrompt(language) {
  const targetLanguage = normalizeNotePromptLanguage(language);
  state.notePrompts[targetLanguage] = BILI_SETTINGS.DEFAULT_NOTE_PROMPTS[targetLanguage];
  state.notePromptLanguage = targetLanguage;
  renderNotePrompt();
  clearTimeout(notePromptSaveTimer);
  persistNotePrompts();
}

async function generateVideoNote() {
  const button = el("generateVideoNoteBtn");
  const status = el("videoNoteGenerateStatus");
  if (!state.bvid) {
    status.textContent = uiText("请先打开一个支持的视频。");
    return;
  }
  if (state.videoNoteGenerating) return;
  state.videoNoteGenerating = true;
  renderNotes([], 0);
  button.disabled = true;
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: "generateVideoNote",
      site: state.site,
      bvid: state.bvid,
      page: state.page,
      tabId: state.tabId,
      noteStyle: state.noteStyle,
      customPrompt: selectedNotePrompt(),
    });
  } catch (error) {
    result = { success: false, message: error.message };
  }
  state.videoNoteGenerating = false;
  button.disabled = false;
  button.textContent = uiText("生成 AI 笔记");
  if (!result?.success) {
    renderNotes([], 0);
    status.textContent = uiText(result?.message || "笔记生成失败");
    return;
  }
  status.textContent = "";
  await loadNotes();
}

function resetOverview() {
  state.analysis = null;
  state.analysisLanguage = null;
  const empty = el("overviewEmpty");
  // 上一个视频可能把这里改成了错误提示，换视频时要还原。
  empty.querySelector(".state-title").textContent = uiText(OVERVIEW_EMPTY_TITLE);
  empty.querySelector(".state-text").textContent = uiText(OVERVIEW_EMPTY_TEXT);
  el("analyzeBtn").textContent = uiText("生成概览");
  empty.hidden = false;
  el("overviewLoading").hidden = true;
  el("overviewResult").hidden = true;
  el("overviewToolbar").hidden = true;
}

// 概览随字幕缓存一起回来，有就直接摆出来——否则一次已完成的生成会看起来像失败了。
function restoreOverview(analysis, analysisLanguage = state.uiLanguage) {
  resetOverview();
  if (!analysis) return;
  state.analysis = analysis;
  state.analysisLanguage = analysisLanguage;
  renderAnalysis(analysis, true);
}

async function analyze({ force = false } = {}) {
  if (!state.bvid) return;
  el("overviewEmpty").hidden = true;
  el("overviewResult").hidden = true;
  el("overviewToolbar").hidden = true;
  el("overviewLoading").hidden = false;
  // 分块数量由 background 算，这里先归零，等第一条进度广播回来再填。
  showProgress("analysis", 0, 0);

  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: "analyzeTranscript",
      site: state.site,
      bvid: state.bvid,
      page: state.page,
      forceRefresh: force,
      tabId: state.tabId,
      customPrompt: el("overviewPrompt").value.trim(),
    });
  } catch (error) {
    result = { success: false, message: error.message };
  }

  el("overviewLoading").hidden = true;
  hideProgress("analysis");

  if (!result?.success) {
    // 概览失败不该把整个面板打回错误态——字幕还在，用户可以继续读。
    el("overviewEmpty").hidden = false;
    el("overviewEmpty").querySelector(".state-title").textContent =
      uiText("概览生成失败");
    el("overviewEmpty").querySelector(".state-text").textContent =
      uiText(result?.message || "请稍后重试。");
    el("analyzeBtn").textContent = uiText("重试");
    return;
  }

  state.analysis = result.analysis;
  state.analysisLanguage = result.analysisLanguage || state.uiLanguage;
  renderAnalysis(result.analysis, result.fromCache, {
    failedChunks: result.failedChunks,
  });
}

function renderAnalysis(analysis, fromCache, { failedChunks = 0 } = {}) {
  const parts = [
    uiText(`${analysis.chapters.length} 章节`),
    uiText(`${analysis.keyQuotes.length} 金句`),
  ];
  if (fromCache) parts.push(uiText("缓存"));
  // 部分块失败时结果是不完整的，必须让用户知道，否则他会以为这就是全片概览。
  if (failedChunks) parts.push(uiText(`${failedChunks} 块失败，结果不完整`));
  el("overviewMeta").textContent = parts.join(" · ");

  const chapters = el("chapterList");
  chapters.textContent = "";
  for (const chapter of analysis.chapters) {
    const card = document.createElement("div");
    card.className = "chapter";

    const head = document.createElement("div");
    head.className = "entry-head";
    const time = document.createElement("span");
    time.className = "entry-time";
    time.textContent = chapter.timestamp;
    const title = document.createElement("span");
    title.className = "entry-title";
    title.textContent = chapter.title;
    head.append(time, title);

    const summary = document.createElement("p");
    summary.className = "entry-text";
    summary.textContent = chapter.summary;

    // 章节的「存为笔记」已按需求剥离：章节摘要偏概述性文本，
    // 需要摘录原文时走金句/字幕区；此处只保留定位跳转。

    card.append(head, summary);
    card.addEventListener("click", (event) =>
      onEntryClick(event, chapter.timestampSeconds),
    );
    chapters.appendChild(card);
  }

  const quotes = el("quoteList");
  quotes.textContent = "";
  for (const quote of analysis.keyQuotes) {
    const card = document.createElement("div");
    card.className = "quote";

    const head = document.createElement("div");
    head.className = "entry-head";
    const time = document.createElement("span");
    time.className = "entry-time";
    time.textContent = quote.timestamp;
    time.addEventListener("click", (event) =>
      onEntryClick(event, quote.timestampSeconds),
    );
    head.appendChild(time);

    const text = document.createElement("p");
    text.className = "entry-text";
    text.textContent = quote.quote;

    const actions = document.createElement("div");
    actions.className = "entry-actions";
    const saveBtn = document.createElement("button");
    saveBtn.className = "ghost-btn";
    saveBtn.textContent = uiText("存为手记");
    saveBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      // 金句已经是模型整理过的文本，直接落库，不必再润色一遍。
      await saveTextAsVideoNote(saveBtn, {
        timestamp: quote.timestampSeconds,
        text: quote.quote,
        asMemo: true,
      });
    });
    actions.appendChild(saveBtn);

    card.append(head, text, actions);
    quotes.appendChild(card);
  }

  el("overviewEmpty").hidden = true;
  el("overviewResult").hidden = false;
  el("overviewToolbar").hidden = false;
}

// ============================================================
// 笔记
// ============================================================

const NOTES_PAGE_SIZE = 100;

async function loadNotes({ append = false } = {}) {
  const offset = append ? state.notesLoaded.length : 0;
  if (!append) {
    state.notesLoaded = [];
    state.notesTotalCount = 0;
    state.notesHasMore = false;
  }
  state.notesForExport = [];
  setNotesExportButtonsDisabled(true);
  const pagination = { offset, limit: NOTES_PAGE_SIZE };
  let result;
  if (state.notesScope === "ai") {
    el("notesEntries").hidden = true;
    el("memoPanel").hidden = true;
    el("aiNotesPanel").hidden = false;
    result = await chrome.runtime.sendMessage({
      action: "getMemos",
      kind: "ai_note",
      // 与划词笔记同源：默认「当前视频」，只有「全部」范围才全量。
      site: state.site,
      bvid: state.bvid,
      ...pagination,
    });
  } else if (state.notesScope === "memo") {
    el("notesEntries").hidden = true;
    el("memoPanel").hidden = false;
    el("aiNotesPanel").hidden = true;
    result = await chrome.runtime.sendMessage({
      action: "getMemos",
      kind: "memo",
      site: state.site,
      bvid: state.bvid,
      ...pagination,
    });
  } else {
    el("notesEntries").hidden = false;
    el("memoPanel").hidden = true;
    el("aiNotesPanel").hidden = true;
    result = await chrome.runtime.sendMessage({
      action: "getNotes",
      site: state.site,
      bvid: state.notesScope === "video" ? state.bvid : null,
      scope: state.notesScope,
      ...pagination,
    });
  }

  const page = result?.notes || [];
  state.notesLoaded = append ? [...state.notesLoaded, ...page] : page;
  state.notesTotalCount = Number(result?.totalCount) || 0;
  state.notesHasMore = Boolean(result?.hasMore);
  if (state.notesScope === "ai") renderAiNotes(state.notesLoaded, state.notesTotalCount);
  else if (state.notesScope === "memo") renderMemos(state.notesLoaded, state.notesTotalCount);
  else renderNotes(state.notesLoaded, state.notesTotalCount);
  updateNotesPagination();
  // 导图视图下，loadNotes 会被 setNotesScope 触发，加载完直接重绘导图，
  // 并按导图可见性规则接管各子面板的 hidden（否则会闪回列表）。
  if (state.notesView === "mindmap") {
    setNotesView("mindmap");
  }
}

function renderMemos(memos, totalCount = memos.length) {
  el("aiNoteViewSwitch").hidden = true;
  el("notesExportBar").hidden = false;
  el("toggleNotesDeleteModeBtn").hidden = false;
  cancelAiVideoNoteEdit({ restore: false });
  el("notesCount").textContent = totalCount ? uiText(`${totalCount} 条`) : "";
  setNotesExportButtonsDisabled(totalCount === 0);
  el("memoForm").hidden = totalCount === 0;
  el("memoEmpty").hidden = totalCount > 0;
  const list = el("memoList");
  list.textContent = "";
  for (const memo of memos) list.appendChild(renderMemoCard(memo));
  updateNotesDeleteControls();
}

function renderAiNotes(notes, totalCount = notes.length) {
  el("aiNoteViewSwitch").hidden = true;
  el("notesExportBar").hidden = false;
  el("toggleNotesDeleteModeBtn").hidden = false;
  cancelAiVideoNoteEdit({ restore: false });
  el("notesCount").textContent = totalCount ? uiText(`${totalCount} 条`) : "";
  setNotesExportButtonsDisabled(totalCount === 0);
  el("aiNotesEmpty").hidden = totalCount > 0;
  const list = el("aiNotesList");
  list.textContent = "";
  for (const note of notes) list.appendChild(renderMemoCard(note, { ai: true }));
  updateNotesDeleteControls();
}

const SVG_NS = "http://www.w3.org/2000/svg";

// 引用 sidepanel.html 顶部雪碧图里的一个图形。
function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function actionButton({ iconName, label, title, onClick }) {
  const button = document.createElement("button");
  button.className = "ghost-btn";
  button.title = uiText(title || label);
  button.appendChild(icon(iconName));
  if (label) {
    const text = document.createElement("span");
    text.textContent = uiText(label);
    button.appendChild(text);
  } else {
    button.classList.add("icon-only");
    button.setAttribute("aria-label", uiText(title));
  }
  // 把按钮直接递给回调。事件派发结束后 event.currentTarget 会被清空，
  // 回调里一 await（写剪贴板就是）再去读它，拿到的是 null。
  button.addEventListener("click", () => onClick(button));
  return button;
}

function flashActionButton(button, message) {
  const label = button.querySelector("span");
  if (!label) return;
  const original = label.textContent;
  const success = message === "已复制";
  if (success) button.classList.add("is-success");
  label.textContent = uiText(message);
  setTimeout(() => {
    label.textContent = original;
    if (success) button.classList.remove("is-success");
  }, 1500);
}

function memoImageDataUrl(memo) {
  const image = String(memo?.imageDataUrl || "");
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(image) ? image : "";
}

function escapeClipboardHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function copyMemoToClipboard(memo) {
  const text = String(memo?.text || "");
  const imageDataUrl = memoImageDataUrl(memo);
  if (!imageDataUrl) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // text/plain 让纯文本编辑器仍可获得可还原图片的 Markdown；
  // text/html 让 Word、语雀、飞书等富文本编辑器直接粘贴出 Base64 图片。
  const plainText = `${text}\n\n![视频截图](${imageDataUrl})`;
  const html = `<div style="white-space:pre-wrap">${escapeClipboardHtml(text)}</div><img src="${imageDataUrl}" alt="视频截图">`;
  if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain;charset=utf-8" }),
          "text/html": new Blob([html], { type: "text/html;charset=utf-8" }),
        }),
      ]);
      return;
    } catch (error) {
      // 某些旧版 Chromium 禁止富文本剪贴板时，仍退回可携带图片的 Markdown。
    }
  }
  await navigator.clipboard.writeText(plainText);
}

function renderNotes(notes, totalCount = notes.length) {
  if (aiVideoNoteEditSession) cancelAiVideoNoteEdit({ restore: false });
  el("notesCount").textContent = totalCount ? uiText(`${totalCount} 条`) : "";
  setNotesExportButtonsDisabled(totalCount === 0);
  const isVideoScope = state.notesScope === "video";
  const showVideoNoteLoading = isVideoScope && state.videoNoteGenerating;
  el("notesEmpty").hidden = totalCount > 0 || showVideoNoteLoading;
  el("videoNoteLoading").hidden = !showVideoNoteLoading;
  el("notesEmptyTitle").textContent = uiText(
    isVideoScope ? "生成 AI 笔记" : "还没有任何笔记",
  );
  el("notesEmptyText").textContent = uiText(
    isVideoScope
      ? "把整段字幕交给大模型，整理成一份适合复习的结构化笔记。需要先在设置页配置 AI 服务。"
      : "播放时点播放器上的「笔记」按钮，或按 n，就能记下当前时间点的一条笔记。",
  );
  el("videoNoteGenerateActions").hidden = !isVideoScope || showVideoNoteLoading;
  updateNoteTemplateVisibility();
  el("generateVideoNoteBtn").disabled = !state.bvid || showVideoNoteLoading;
  if (!state.bvid && isVideoScope) {
    el("videoNoteGenerateStatus").textContent = uiText("请先打开一个支持的视频。");
  } else if (!totalCount) {
    el("videoNoteGenerateStatus").textContent = "";
  }

  const list = el("notesList");
  list.textContent = "";
  const hasAiVideoNote =
    isVideoScope && notes.some((note) => note?.kind === "ai_video_note");
  list.classList.toggle("ai-document-list", hasAiVideoNote);
  el("aiNoteViewSwitch").hidden = !hasAiVideoNote;
  el("notesExportBar").hidden = hasAiVideoNote;
  el("toggleNotesDeleteModeBtn").hidden = hasAiVideoNote;
  if (!hasAiVideoNote) cancelAiVideoNoteEdit({ restore: false });
  for (const note of notes) list.appendChild(renderAnyNote(note));
  if (!hasAiVideoNote && state.notesView === "mindmap") setNotesView("list");
  syncAiNoteViewSwitch();
  updateNotesDeleteControls();
}

function appendNoteSelection(head, note) {
  if (!state.notesDeleteMode) return;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "note-selection";
  checkbox.dataset.noteId = note.id;
  checkbox.checked = state.selectedNoteIds.has(note.id);
  checkbox.setAttribute("aria-label", uiText("选择这条笔记"));
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selectedNoteIds.add(note.id);
    else state.selectedNoteIds.delete(note.id);
    updateNotesDeleteControls();
  });
  head.appendChild(checkbox);
}

function updateNotesDeleteControls() {
  const inDeleteMode = state.notesDeleteMode;
  const selectedCount = state.selectedNoteIds.size;
  const toggle = el("toggleNotesDeleteModeBtn");
  const bar = el("notesDeleteBar");
  toggle.classList.toggle("active", inDeleteMode);
  toggle.textContent = uiText(inDeleteMode ? "取消" : "删除");
  bar.hidden = !inDeleteMode;
  if (!inDeleteMode) return;
  el("notesSelectionCount").textContent = uiText(`已选 ${selectedCount} 条`);
  const visibleIds = state.notesLoaded.map((note) => note.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => state.selectedNoteIds.has(id));
  el("selectVisibleNotesBtn").textContent = uiText(allVisibleSelected ? "取消全选已加载" : "全选已加载");
  el("deleteSelectedNotesBtn").disabled = selectedCount === 0;
}

function setNotesDeleteMode(enabled) {
  state.notesDeleteMode = enabled;
  state.selectedNoteIds.clear();
  loadNotes();
}

function selectVisibleNotes() {
  const visibleIds = state.notesLoaded.map((note) => note.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => state.selectedNoteIds.has(id));
  for (const id of visibleIds) {
    if (allVisibleSelected) state.selectedNoteIds.delete(id);
    else state.selectedNoteIds.add(id);
  }
  for (const checkbox of document.querySelectorAll(".note-selection")) {
    checkbox.checked = state.selectedNoteIds.has(checkbox.dataset.noteId);
  }
  updateNotesDeleteControls();
}

async function deleteSelectedNotes() {
  const noteIds = [...state.selectedNoteIds];
  if (!noteIds.length) return;
  const warning = state.uiLanguage === "en"
    ? `Delete ${noteIds.length} selected notes permanently?`
    : `确定永久删除已选的 ${noteIds.length} 条笔记吗？`;
  if (!globalThis.confirm(warning)) return;
  const result = await chrome.runtime.sendMessage({ action: "deleteNotes", noteIds });
  if (!result?.success) return;
  state.selectedNoteIds.clear();
  await loadNotes();
}

async function clearCurrentNotes() {
  const totalCount = state.notesTotalCount;
  if (!totalCount) return;
  const warning = state.uiLanguage === "en"
    ? `Permanently clear all ${totalCount} notes in this scope? This includes unloaded pages.`
    : `确定永久清空当前范围的 ${totalCount} 条笔记吗？这也会删除尚未加载的分页内容。`;
  if (!globalThis.confirm(warning)) return;
  const result = await chrome.runtime.sendMessage({
    action: "clearNotes",
    site: state.site,
    bvid: state.notesScope === "video" ? state.bvid : null,
    scope: state.notesScope,
  });
  if (!result?.success) return;
  state.selectedNoteIds.clear();
  await loadNotes();
}

function updateNotesPagination() {
  const button = el("loadMoreNotesBtn");
  if (!button) return;
  button.hidden = !state.notesHasMore;
  button.disabled = false;
  if (state.notesHasMore) {
    button.textContent = uiText("加载更多");
    button.title = uiText(`已显示 ${state.notesLoaded.length} / 共 ${state.notesTotalCount} 条`);
  }
}

async function loadMoreNotes() {
  if (!state.notesHasMore) return;
  const button = el("loadMoreNotesBtn");
  button.disabled = true;
  await loadNotes({ append: true });
}

function setNotesExportButtonsDisabled(disabled) {
  for (const id of ["exportNotesFormatSelect", "aiNoteExportFormatSelect"]) {
    const control = el(id);
    if (control) control.disabled = disabled;
  }
}

function noteKindLabel(kind) {
  if (state.uiLanguage === "en") {
    if (kind === "memo") return "Memo";
    if (kind === "ai_note" || kind === "ai_chat") return "AI Note";
    if (kind === "ai_video_note") return "AI Video Notes";
    return "Video Note";
  }
  if (kind === "memo") return "手记";
  if (kind === "ai_note" || kind === "ai_chat") return "AI 记";
  if (kind === "ai_video_note") return "AI 视频笔记";
  return "视频笔记";
}

function noteSourceLabel(note) {
  return [note.videoTitle, note.timestamp].filter(Boolean).join(" · ");
}

function noteCreatedAt(note) {
  if (!note.createdAt) return "";
  const date = new Date(note.createdAt);
  return Number.isNaN(date.getTime()) ? String(note.createdAt) : date.toISOString();
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function notesAsCsv(notes) {
  const fields = [
    "id",
    "kind",
    "text",
    "createdAt",
    "createdAtISO",
    "site",
    "bvid",
    "page",
    "videoTitle",
    "ownerName",
    "timestamp",
    "timestampSeconds",
    "timestampedUrl",
    "rawText",
    "pending",
    "imageAssetId",
    "visualCitationCount",
    "visualCitationTimestamps",
  ];
  return [
    fields.map(csvCell).join(","),
    ...notes.map((note) =>
      fields
        .map((field) => {
          if (field === "createdAtISO") return csvCell(noteCreatedAt(note));
          if (field === "visualCitationCount") {
            return csvCell(Array.isArray(note.visualReferences) ? note.visualReferences.length : 0);
          }
          if (field === "visualCitationTimestamps") {
            return csvCell(
              (Array.isArray(note.visualReferences) ? note.visualReferences : [])
                .map((reference) => reference.timestamp || reference.timestampSeconds)
                .filter((value) => value !== "" && value != null)
                .join(" | "),
            );
          }
          return csvCell(note[field]);
        })
        .join(","),
    ),
  ].join("\r\n");
}

function noteMarkdownWithVisualReferences(note, english = state.uiLanguage === "en") {
  const references = Array.isArray(note?.visualReferences) ? note.visualReferences : [];
  const referenceMap = new Map(references.map((reference) => [reference.citationId, reference]));
  const cleanText = BILI_VISUAL_MEMOS.sanitizeCitationMarkers(
    note?.text,
    [...referenceMap.keys()],
  );
  return cleanText.replace(BILI_VISUAL_MEMOS.CITATION_RE, (_marker, citationId) => {
    const reference = referenceMap.get(citationId);
    if (!reference?.imageDataUrl) return "";
    const label = `${english ? "Memo screenshot" : "手记截图"}${reference.timestamp ? ` ${reference.timestamp}` : ""}`;
    const image = `![${label}](${reference.imageDataUrl})`;
    return reference.timestampedUrl ? `\n\n[${image}](${reference.timestampedUrl})\n\n` : `\n\n${image}\n\n`;
  });
}

function notesAsMarkdown(notes) {
  const english = state.uiLanguage === "en";
  const exportedAt = new Date().toISOString();
  const sections = notes.map((note) => {
    const source = noteSourceLabel(note);
    const lines = [
      `## ${noteKindLabel(note.kind)}${source ? ` · ${source}` : ""}`,
      `- ${english ? "Created" : "创建时间"}: ${noteCreatedAt(note) || (english ? "Unknown" : "未知")}`,
    ];
    if (note.site) lines.push(`- ${english ? "Platform" : "平台"}: ${note.site}`);
    if (note.ownerName) lines.push(`- ${english ? "Author" : "作者"}: ${note.ownerName}`);
    if (note.timestampedUrl) {
      lines.push(`- ${english ? "Source" : "来源"}: ${note.timestampedUrl}`);
    }
    lines.push("", noteMarkdownWithVisualReferences(note, english).trim());
    // 视频截图在保存时已经由 canvas.toDataURL 转为 Base64 data URL。
    // Markdown 导出直接内嵌该 URL，离线打开时图片不会丢失。
    if (
      note.kind === "memo" &&
      typeof note.imageDataUrl === "string" &&
      /^data:image\/[a-z0-9.+-]+;base64,/i.test(note.imageDataUrl)
    ) {
      lines.push("", `![${english ? "Memo image" : "手记图片"}](${note.imageDataUrl})`);
    }
    return lines.join("\n");
  });
  return [
    english ? "# Video Assistant Notes" : "# Video Assistant 笔记",
    `${english ? "Exported" : "导出时间"}: ${exportedAt}`,
    "",
    ...sections,
  ].join("\n\n");
}

function notesExportFilename(extension) {
  const videoLabel =
    state.data?.videoInfo?.title || state.bvid || "当前视频";
  const scopeLabel =
    state.notesScope === "video" || state.notesScope === "memo" || state.notesScope === "ai"
      ? videoLabel
      : "全部笔记";
  return `${sanitizeFilename(`video-assistant-${scopeLabel}`)}.${extension}`;
}

function downloadNotesFile(content, extension, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = notesExportFilename(extension);
  link.click();
  URL.revokeObjectURL(url);
}

async function notesForCurrentScope() {
  // 导出跟随当前视图：手记/AI 记录默认当前视频，与列表加载一致。
  if (state.notesScope === "ai") {
    const result = await chrome.runtime.sendMessage({
      action: "getMemos",
      kind: "ai_note",
      site: state.site,
      bvid: state.bvid,
    });
    return result?.notes || [];
  }
  if (state.notesScope === "memo") {
    const result = await chrome.runtime.sendMessage({
      action: "getMemos",
      kind: "memo",
      site: state.site,
      bvid: state.bvid,
    });
    return result?.notes || [];
  }
  const result = await chrome.runtime.sendMessage({
    action: "getNotes",
    site: state.site,
    bvid: state.notesScope === "video" ? state.bvid : null,
    scope: state.notesScope,
  });
  return result?.notes || [];
}

async function exportNotes(format) {
  const notes = await notesForCurrentScope();
  if (!notes.length) return;
  if (format === "json") {
    const response = await chrome.runtime.sendMessage({
      action: "exportNotesV2",
      noteIds: notes.map((note) => note.id),
    });
    if (!response?.success || !response.bundle) {
      throw new Error(response?.error || uiText("导出失败"));
    }
    const payload = { ...response.bundle, scope: state.notesScope };
    downloadNotesFile(
      JSON.stringify(payload, null, 2),
      "json",
      "application/json",
    );
    return;
  }
  if (format === "markdown") {
    downloadNotesFile(notesAsMarkdown(notes), "md", "text/markdown");
    return;
  }
  if (format === "csv") {
    downloadNotesFile(`\ufeff${notesAsCsv(notes)}`, "csv", "text/csv");
  }
}

async function exportNotesFromSelect(select) {
  const format = select?.value;
  if (!format) return;
  try {
    await exportNotes(format);
  } finally {
    select.value = "";
  }
}

function renderAnyNote(note) {
  // 「全部」需要用统一卡片浏览各类笔记；AI 视频笔记是整段字幕的总结，
  // 不是一个时间点的记录，因此卡片中不提供访问时间锚点。
  if (note.kind === "ai_video_note" && state.notesScope === "all") {
    return renderMemoCard(note, {
      ai: true,
      sourceLabel: "AI 笔记",
      suppressAnchor: true,
      suppressTimestamp: true,
    });
  }
  if (note.kind === "ai_video_note") return renderAiVideoNoteDocument(note);
  if (["memo", "ai_note", "ai_chat"].includes(note.kind)) {
    return renderMemoCard(note, { ai: note.kind !== "memo" });
  }
  return renderNoteCard(note);
}

function renderAiVideoNoteDocument(note) {
  const article = document.createElement("article");
  article.className = "ai-note-document";

  if (state.notesDeleteMode) {
    const selection = document.createElement("div");
    selection.className = "ai-note-document-selection";
    appendNoteSelection(selection, note);
    article.appendChild(selection);
  }

  const body = document.createElement("div");
  body.className = "ai-note-document-body markdown-body";
  renderMarkdownWithVisualReferences(body, note, document);
  scheduleMermaidRun();

  article.appendChild(body);
  return article;
}

function renderMarkdownWithVisualReferences(container, note, doc) {
  const references = Array.isArray(note?.visualReferences) ? note.visualReferences : [];
  const referenceMap = new Map(references.map((reference) => [reference.citationId, reference]));
  const cleanText = BILI_VISUAL_MEMOS.sanitizeCitationMarkers(
    note?.text,
    [...referenceMap.keys()],
  );
  const parts = cleanText.split(BILI_VISUAL_MEMOS.CITATION_RE);
  if (parts.length === 1) {
    BILI_MARKDOWN.render(container, cleanText, doc);
    return;
  }

  container.textContent = "";
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const reference = referenceMap.get(part);
      if (reference) container.appendChild(buildVisualReferenceFigure(reference, doc));
      return;
    }
    if (!part.trim()) return;
    const section = doc.createElement("div");
    BILI_MARKDOWN.render(section, part, doc);
    const children = typeof section.childNodes?.[Symbol.iterator] === "function"
      ? [...section.childNodes]
      : [];
    if (children.length) {
      for (const child of children) container.appendChild(child);
    } else {
      container.appendChild(section);
    }
  });
}

function buildVisualReferenceFigure(reference, doc) {
  const figure = doc.createElement("figure");
  figure.className = "ai-note-visual-reference";

  const image = doc.createElement("img");
  image.src = reference.imageDataUrl;
  image.alt = `${uiText("手记截图")} ${reference.timestamp || ""}`.trim();
  figure.appendChild(image);

  const caption = doc.createElement("figcaption");
  const label = doc.createElement("span");
  label.textContent = `${uiText("手记截图")} · ${reference.timestamp || ""}`.trim();
  caption.appendChild(label);
  if (reference.timestampedUrl) {
    const link = doc.createElement("a");
    link.href = reference.timestampedUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = uiText("访问锚点");
    caption.appendChild(link);
  }
  figure.appendChild(caption);
  return figure;
}

const MINDMAP_VISUAL_TOKEN_PREFIX = "VAVISUALREFERENCE";

function mindmapVisualToken(citationId) {
  const encoded = Array.from(String(citationId || ""))
    .map((character) => character.codePointAt(0).toString(16).padStart(2, "0"))
    .join("");
  return `${MINDMAP_VISUAL_TOKEN_PREFIX}${encoded}`;
}

/** 将图片引用变成不会被 Markdown 清洗掉的临时列表节点。 */
function noteMarkdownForMindmap(note) {
  const references = Array.isArray(note?.visualReferences) ? note.visualReferences : [];
  const referenceMap = new Map(
    references
      .filter((reference) => reference?.citationId)
      .map((reference) => [reference.citationId, reference]),
  );
  const cleanText = BILI_VISUAL_MEMOS.sanitizeCitationMarkers(
    note?.text || note?.content || "",
    [...referenceMap.keys()],
  );
  return cleanText
    .replace(BILI_VISUAL_MEMOS.CITATION_RE, (_marker, citationId) => {
      const reference = referenceMap.get(citationId);
      if (!reference) return "";
      return `\n- ${mindmapVisualToken(citationId)}\n`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mindmapVisualImageSource(reference) {
  const source = String(reference?.imageDataUrl || "").replace(/\s+/g, "");
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(source)
    ? source
    : "";
}

function mindmapVisualAnchorUrl(reference) {
  try {
    const url = new URL(String(reference?.timestampedUrl || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * NOTE_MINDMAP 默认会转义全部 HTML；只有内部图片引用节点在完成建树后，
 * 才由这里替换成受控 HTML，避免开放任意 Markdown HTML 的 XSS 入口。
 */
function buildMindmapDocumentTree(rootTitle, note) {
  const references = Array.isArray(note?.visualReferences) ? note.visualReferences : [];
  const referenceMap = new Map(
    references
      .filter((reference) => reference?.citationId)
      .map((reference) => [mindmapVisualToken(reference.citationId), reference]),
  );
  const tree = NOTE_MINDMAP.buildDocumentTree(rootTitle, noteMarkdownForMindmap(note));
  const visit = (node) => {
    const content = String(node?.content || "");
    if (content.startsWith(MINDMAP_VISUAL_TOKEN_PREFIX)) {
      const reference = referenceMap.get(content);
      const citationId = String(reference?.citationId || "");
      const imageSource = mindmapVisualImageSource(reference);
      const timestamp = String(reference?.timestamp || "").trim();
      const label = timestamp
        ? `${uiText("手记截图")} · ${timestamp}`
        : uiText("手记截图");
      const safeLabel = escapeClipboardHtml(label);
      const anchorUrl = mindmapVisualAnchorUrl(reference);
      if (imageSource) {
        const image = `<img class="mindmap-visual-reference-image" src="${imageSource}" alt="${safeLabel}">`;
        const media = anchorUrl
          ? `<a class="mindmap-visual-reference-link" href="${escapeClipboardHtml(anchorUrl)}" target="_blank" rel="noreferrer">${image}</a>`
          : image;
        node.content = `<figure class="mindmap-visual-reference">${media}<figcaption>${safeLabel}</figcaption></figure>`;
        node.payload = { ...node.payload, kind: "visual-reference", citationId };
      } else {
        node.content = escapeClipboardHtml(`📷 ${label}`);
        node.payload = { ...node.payload, kind: "visual-reference-fallback", citationId };
      }
    }
    for (const child of node?.children || []) visit(child);
  };
  visit(tree);
  return tree;
}

let aiVideoNoteEditSession = null;

function currentAiVideoNote() {
  return (state.notesLoaded || []).find((note) => note?.kind === "ai_video_note") || null;
}

function setAiNoteToolbarEditing(editing) {
  for (const id of [
    "aiNoteCopyBtn",
    "aiNoteEditBtn",
    "aiNoteDocumentBtn",
    "aiNoteMindmapBtn",
    "aiNoteExportFormatSelect",
    "aiNoteResetBtn",
    "aiNoteDeleteBtn",
  ]) {
    el(id).hidden = editing;
  }
  el("aiNoteViewGroup").hidden = editing;
  el("aiNoteCancelEditBtn").hidden = !editing;
  el("aiNoteSaveEditBtn").hidden = !editing;
  if (!editing) el("aiNoteSaveEditBtn").disabled = false;
}

async function copyCurrentAiVideoNote() {
  const note = currentAiVideoNote();
  if (!note) return;
  const button = el("aiNoteCopyBtn");
  const plainText = noteMarkdownWithVisualReferences(note);
  const references = Array.isArray(note.visualReferences) ? note.visualReferences : [];
  if (
    references.some((reference) => reference?.imageDataUrl) &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  ) {
    const referenceMap = new Map(references.map((reference) => [reference.citationId, reference]));
    const cleanText = BILI_VISUAL_MEMOS.sanitizeCitationMarkers(
      note?.text,
      [...referenceMap.keys()],
    );
    const html = cleanText.split(BILI_VISUAL_MEMOS.CITATION_RE).map((part, index) => {
      if (index % 2 === 0) return `<div style="white-space:pre-wrap">${escapeClipboardHtml(part)}</div>`;
      const reference = referenceMap.get(part);
      if (!reference?.imageDataUrl) return "";
      const image = `<img src="${reference.imageDataUrl}" alt="${escapeClipboardHtml(reference.timestamp || uiText("手记截图"))}">`;
      return reference.timestampedUrl
        ? `<a href="${escapeClipboardHtml(reference.timestampedUrl)}">${image}</a>`
        : image;
    }).join("");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain;charset=utf-8" }),
          "text/html": new Blob([html], { type: "text/html;charset=utf-8" }),
        }),
      ]);
    } catch (_error) {
      await navigator.clipboard.writeText(plainText);
    }
  } else {
    await navigator.clipboard.writeText(plainText);
  }
  flashActionButton(button, "已复制");
}

function startAiVideoNoteEdit() {
  const note = currentAiVideoNote();
  if (!note) return;
  if (state.notesView === "mindmap") setNotesView("list");
  const body = document.querySelector(".ai-note-document-body");
  if (!body) return;

  const editor = document.createElement("textarea");
  editor.className = "note-editor ai-note-document-editor";
  editor.rows = 16;
  editor.maxLength = 12_000;
  editor.value = note.text || "";
  body.replaceWith(editor);
  aiVideoNoteEditSession = { note, body, editor };
  setAiNoteToolbarEditing(true);
  editor.focus();
}

function cancelAiVideoNoteEdit({ restore = true } = {}) {
  if (restore && aiVideoNoteEditSession?.editor && aiVideoNoteEditSession?.body) {
    aiVideoNoteEditSession.editor.replaceWith(aiVideoNoteEditSession.body);
  }
  aiVideoNoteEditSession = null;
  setAiNoteToolbarEditing(false);
}

async function saveAiVideoNoteEdit() {
  const session = aiVideoNoteEditSession;
  if (!session) return;
  const text = String(session.editor.value || "").trim();
  if (!text) {
    session.editor.focus();
    return;
  }
  const button = el("aiNoteSaveEditBtn");
  button.disabled = true;
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: "updateNote",
      noteId: session.note.id,
      text,
    });
  } catch (error) {
    result = { success: false, message: error.message };
  }
  if (result?.success) {
    aiVideoNoteEditSession = null;
    setAiNoteToolbarEditing(false);
    await loadNotes();
    return;
  }
  button.disabled = false;
  button.title = uiText(result?.message || "保存失败，请重试。");
}

async function deleteCurrentAiVideoNote() {
  const note = currentAiVideoNote();
  if (!note) return;
  const button = el("aiNoteDeleteBtn");
  button.disabled = true;
  try {
    await chrome.runtime.sendMessage({ action: "deleteNote", noteId: note.id });
    state.selectedNoteIds.delete(note.id);
    await loadNotes();
  } finally {
    button.disabled = false;
  }
}

async function resetCurrentAiVideoNote() {
  const note = currentAiVideoNote();
  if (!note) return;
  const button = el("aiNoteResetBtn");
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ action: "deleteNote", noteId: note.id });
    if (!result?.success) {
      button.title = uiText(result?.message || "重置失败，请重试。");
      return;
    }
    state.selectedNoteIds.delete(note.id);
    if (state.notesView === "mindmap") setNotesView("list");
    await loadNotes();
  } finally {
    button.disabled = false;
  }
}

function beginNoteEdit(note, textElement, actions) {
  const editor = document.createElement("textarea");
  editor.className = "note-editor";
  editor.rows = 4;
  editor.maxLength = 12_000;
  editor.value = note.text || "";

  const editActions = document.createElement("div");
  editActions.className = "entry-actions note-edit-actions";
  const cancel = actionButton({
    iconName: "copy",
    label: "取消",
    title: "取消",
    onClick: () => {
      editor.replaceWith(textElement);
      editActions.replaceWith(actions);
    },
  });
  const save = actionButton({
    iconName: "edit",
    label: "保存修改",
    title: "保存修改",
    onClick: async (button) => {
      const text = String(editor.value || "").trim();
      if (!text) {
        editor.focus();
        return;
      }
      button.disabled = true;
      let result;
      try {
        result = await chrome.runtime.sendMessage({
          action: "updateNote",
          noteId: note.id,
          text,
        });
      } catch (error) {
        result = { success: false, message: error.message };
      }
      if (result?.success) {
        await loadNotes();
        return;
      }
      button.disabled = false;
      button.title = uiText(result?.message || "保存失败，请重试。");
    },
  });
  editActions.append(cancel, save);
  textElement.replaceWith(editor);
  actions.replaceWith(editActions);
  editor.focus();
}

function renderNoteCard(note) {
  const card = document.createElement("div");
  card.className = `note${note.kind === "ai_chat" ? " note-ai-chat" : ""}`;

  // 状态提示（视频已下架之类）常驻在卡片底部，平时藏着。
  const notice = document.createElement("p");
  notice.className = "note-notice";
  notice.hidden = true;
  // 后台还在润色时说一声，不然正文过几秒突然变了会让人纳闷。
  // 时间上限挡住润色中途 service worker 被回收留下的僵尸标记。
  if (note.pending && Date.now() - note.createdAt < 3 * 60 * 1000) {
    setNoteNotice(notice, "AI 正在润色这条笔记…", "muted");
  }
  const play = () => playNote(note, notice);

  const head = document.createElement("div");
  head.className = "entry-head";
  appendNoteSelection(head, note);

  // 时间戳做成按钮才看得出来能点。
  const time = document.createElement("button");
  time.className = "entry-time time-btn";
  time.textContent = note.timestamp;
  time.title = uiText("跳到这个时间点");
  time.addEventListener("click", play);

  const remove = actionButton({
    iconName: "trash",
    title: "删除这条笔记",
    onClick: async () => {
      await chrome.runtime.sendMessage({ action: "deleteNote", noteId: note.id });
      state.selectedNoteIds.delete(note.id);
      loadNotes();
    },
  });
  remove.classList.add("note-delete");

  head.appendChild(time);
  if (note.kind === "ai_chat" || note.kind === "ai_video_note") {
    const source = document.createElement("span");
    source.className = "note-source-badge";
    source.textContent = note.kind === "ai_video_note"
      ? state.uiLanguage === "en" ? "AI Notes" : "AI 笔记"
      : state.uiLanguage === "en" ? "AI Q&A" : "AI 问答";
    head.appendChild(source);
  }
  head.appendChild(remove);

  // 笔记与问 AI 共用同一套安全 Markdown 渲染器；原始文本仍保留在
  // note.text，供编辑、复制和本地导出使用。
  const text = document.createElement("div");
  text.className = "entry-text markdown-body";
  BILI_MARKDOWN.render(text, note.text, document);
  scheduleMermaidRun();

  const away =
    (note.site || "bilibili") !== (state.site || "bilibili") ||
    note.bvid !== state.bvid;

  // 看的就是这个视频时，再写一遍标题和 UP 主是废话，白占一行。
  const meta = document.createElement("p");
  meta.className = "note-meta";
  meta.textContent = away
    ? [note.videoTitle, note.ownerName].filter(Boolean).join(" · ")
    : "";
  meta.hidden = !meta.textContent;

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  // 别的视频的笔记要开新标签页，图标换成「外链」，免得点下去才发现跳走了。
  actions.append(
    actionButton({
      iconName: "edit",
      label: "编辑",
      title: "编辑这条笔记",
      onClick: () => beginNoteEdit(note, text, actions),
    }),
    actionButton({
      iconName: away ? "external" : "play",
      label: away ? "打开" : "播放",
      title: away ? "在新标签页打开原视频并跳到这一刻" : "跳到这个时间点",
      onClick: play,
    }),
    actionButton({
      iconName: "copy",
      label: "复制",
      title: "复制笔记正文",
      onClick: async (button) => {
        await navigator.clipboard.writeText(note.text);
        flashActionButton(button, "已复制");
      },
    }),
    actionButton({
      iconName: "link",
      label: "链接",
      title: "复制带时间戳的视频链接",
      onClick: async (button) => {
        await navigator.clipboard.writeText(note.timestampedUrl);
        flashActionButton(button, "已复制");
      },
    }),
  );

  card.append(head, text, meta, actions, notice);
  return card;
}

function renderMemoCard(
  memo,
  { ai = false, sourceLabel = null, suppressAnchor = false, suppressTimestamp = false } = {},
) {
  const card = document.createElement("div");
  card.className = `note note-memo${ai ? " note-ai-chat" : ""}`;

  const head = document.createElement("div");
  head.className = "entry-head";
  appendNoteSelection(head, memo);
  const created = document.createElement("span");
  created.className = "memo-created";
  created.textContent = new Date(memo.createdAt).toLocaleString(
    state.uiLanguage === "en" ? "en-US" : "zh-CN",
  );
  const remove = actionButton({
    iconName: "trash",
    title: ai ? "删除这条 AI 记" : "删除这条手记",
    onClick: async () => {
      await chrome.runtime.sendMessage({ action: "deleteNote", noteId: memo.id });
      state.selectedNoteIds.delete(memo.id);
      loadNotes();
    },
  });
  remove.classList.add("note-delete");
  head.appendChild(created);
  if (memo.pendingTranscript) {
    // 乐观保存的截图手记在等字幕回填：给个轻量提示，避免看着像只存了图。
    const pending = document.createElement("span");
    pending.className = "note-source-badge note-pending-transcript";
    pending.textContent = uiText("字幕补齐中…");
    head.appendChild(pending);
  }
  if (ai) {
    const badge = document.createElement("span");
    badge.className = "note-source-badge";
    badge.textContent = uiText(sourceLabel || "AI 记");
    head.appendChild(badge);
  }
  head.appendChild(remove);

  // 手记与 AI 记也支持 Markdown，避免同一份已保存内容在不同栏目展示不一致。
  const text = document.createElement("div");
  text.className = "entry-text markdown-body";
  if (memo.kind === "ai_video_note") {
    renderMarkdownWithVisualReferences(text, memo, document);
  } else {
    BILI_MARKDOWN.render(text, memo.text, document);
  }
  scheduleMermaidRun();

  const meta = document.createElement("p");
  meta.className = "note-meta";
  meta.textContent = memo.timestampedUrl
    ? [memo.videoTitle, suppressTimestamp ? "" : memo.timestamp].filter(Boolean).join(" · ")
    : "";
  meta.hidden = !meta.textContent;

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  if (memo.timestampedUrl && !suppressAnchor) {
    actions.appendChild(
      actionButton({
        iconName: "external",
        label: "访问锚点",
        title: "打开视频并跳到记录位置",
        onClick: () => playNote(memo, document.createElement("p")),
      }),
    );
  }
  actions.appendChild(
    actionButton({
      iconName: "edit",
      label: "编辑",
      title: "编辑这条笔记",
      onClick: () => beginNoteEdit(memo, text, actions),
    }),
  );
  actions.appendChild(
    actionButton({
      iconName: "copy",
      label: "复制",
      title: "复制手记正文",
      onClick: async (button) => {
        await copyMemoToClipboard(memo);
        flashActionButton(button, "已复制");
      },
    }),
  );

  // 快捷键手记可能带当前帧截图：正文上方放一张缩略图，点开新标签页看大图。
  // 注意顺序：此时 card 里只有 head，截图必须 append 进 card 而不是
  // text.before()——text 还没有父节点，before() 会静默失败，图就丢了。
  let shot = null;
  if (typeof memo.imageDataUrl === "string" && memo.imageDataUrl.startsWith("data:image/")) {
    shot = document.createElement("img");
    shot.src = memo.imageDataUrl;
    shot.alt = "视频截图";
    shot.className = "memo-shot";
    // data:URL 已在内存里，lazy 没有网络收益，反而面板隐藏时永不触发解码。
    shot.addEventListener("click", () => {
      const tab = window.open(memo.imageDataUrl, "_blank");
      if (tab) tab.opener = null;
    });
  }

  card.append(head);
  if (shot) card.append(shot);
  card.append(text, meta, actions);
  return card;
}

async function currentMemoVideoContext(timestampOverride) {
  if (!state.bvid) return null;
  let pageInfo = {};
  try {
    pageInfo =
      (await chrome.tabs.sendMessage(state.tabId, { action: "getVideoInfo" })) || {};
  } catch (error) {
    // 页面刷新期间拿不到内容脚本时，退回侧栏里已有的元数据。
  }
  const cachedInfo = state.data?.videoInfo || state.errorResult?.videoInfo || {};
  const seconds = Math.max(
    0,
    Number(
      Number.isFinite(Number(timestampOverride))
        ? timestampOverride
        : pageInfo.currentTime ?? state.currentTime,
    ) || 0,
  );
  state.currentTime = seconds;
  return {
    site: state.site,
    bvid: state.bvid,
    page: state.page,
    videoTitle:
      pageInfo.title || cachedInfo.title || el("videoTitle").textContent || state.bvid,
    timestamp: seconds,
  };
}

async function saveMemo() {
  const input = el("memoInput");
  const text = String(input.value || "").trim();
  if (!text) {
    el("memoSaveStatus").textContent = uiText("请先输入手记内容。");
    input.focus();
    return;
  }
  const button = el("saveMemoBtn");
  button.disabled = true;
  button.textContent = uiText("保存中…");
  const videoContext = await currentMemoVideoContext();
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: "saveMemo",
      kind: "memo",
      text,
      ...(videoContext || {}),
    });
  } catch (error) {
    result = { success: false, message: error.message };
  }
  button.disabled = false;
  button.textContent = uiText("保存");
  if (!result?.success) {
    el("memoSaveStatus").textContent = uiText(
      result?.message || "保存失败，请重试。",
    );
    return;
  }
  input.value = "";
  el("memoSaveStatus").textContent = uiText(
    videoContext ? "已保存，并记录当前视频访问锚点。" : "已保存。",
  );
  await loadNotes();
}

function setNoteNotice(notice, message, tone = "warn") {
  notice.className = `note-notice ${tone}`;
  notice.textContent = uiText(message);
  notice.hidden = !message;
}

// 同一个视频就地跳转；别的视频开新标签页，开之前先问一句视频还在不在。
async function playNote(note, notice) {
  if (
    (note.site || "bilibili") === (state.site || "bilibili") &&
    note.bvid === state.bvid
  ) {
    seekTo(note.timestampSeconds);
    return;
  }

  setNoteNotice(notice, "正在确认视频是否还在…", "muted");
  const result = await chrome.runtime.sendMessage({
    action: "checkVideoAvailable",
    site: note.site || "bilibili",
    bvid: note.bvid,
  });

  if (result?.available === false) {
    setNoteNotice(notice, result.message || "视频已下架，无法查看原视频。");
    return;
  }
  setNoteNotice(notice, "");
  chrome.tabs.create({ url: note.timestampedUrl });
}

function setNotesScope(scope) {
  state.notesScope = scope;
  // 上一个范围可能把 notesEntries 隐藏（手记、AI 记或导图）；切换任何范围时
  // 都先恢复列表可见性，避免回到“本视频”后只剩工具栏、正文仍被 hidden。
  setNotesView("list");
  state.selectedNoteIds.clear();
  el("notesScopeVideo").classList.toggle("active", scope === "video");
  el("notesScopeAll").classList.toggle("active", scope === "all");
  el("notesScopeMemo").classList.toggle("active", scope === "memo");
  el("notesScopeAi").classList.toggle("active", scope === "ai");
  loadNotes();
}

/* ---------------------- mermaid 图表增强 ---------------------- */

// markdown.js 渲染完会把 ```mermaid 代码块替换成 .mermaid-block（文本兜底）。
// 渲染升级由 lib/mermaid-widget.js 接管：升级为交互卡片（复制源码/下载 SVG/
// 源码图形双模式/滚轮缩放/拖拽平移），再交给 mermaid.run 真正画图。
// 图表渲染依赖可见容器尺寸，所以挂在 setTimeout 时机；组件内部自带
// 防重入与失败回退（恢复源码文本），这里只保留 80ms 防抖调度。
let mermaidTimer = null;
let mermaidLibraryPromise = null;

function ensureMermaidLibrary() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (mermaidLibraryPromise) return mermaidLibraryPromise;

  mermaidLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("vendor/mermaid.min.js");
    script.async = true;
    script.addEventListener("load", () => {
      if (window.mermaid) resolve(window.mermaid);
      else reject(new Error("Mermaid loaded without a global export"));
    }, { once: true });
    script.addEventListener("error", () => {
      reject(new Error("Mermaid failed to load"));
    }, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    // 允许下次渲染重试；Markdown 源码仍保留在 .mermaid-block 中。
    mermaidLibraryPromise = null;
    throw error;
  });
  return mermaidLibraryPromise;
}

function scheduleMermaidRun() {
  if (mermaidTimer) return;
  mermaidTimer = setTimeout(async () => {
    mermaidTimer = null;
    const blocks = document.querySelectorAll(".mermaid-block:not([data-mermaid-done])");
    if (!blocks.length) return;
    try {
      await ensureMermaidLibrary();
    } catch (error) {
      console.warn("Mermaid lazy load failed", error);
      return;
    }
    if (window.MermaidWidget?.upgradeMermaidBlocks) {
      window.MermaidWidget.upgradeMermaidBlocks(document);
    } else {
      // 组件未加载（异常路径）：退回旧的纯文本行为，至少源码可见。
      const lib = window.mermaid;
      if (!lib || typeof lib.initialize !== "function") return;
      try {
        lib.initialize({ startOnLoad: false, securityLevel: "strict", darkMode: false });
      } catch {
        return;
      }
      const blocks = document.querySelectorAll(".mermaid-block:not([data-mermaid-done])");
      if (!blocks.length) return;
      for (const block of blocks) {
        block.dataset.mermaidDone = "1";
        block.removeAttribute("data-processed");
      }
      Promise.resolve(lib.run({ nodes: [...blocks] })).catch(() => {
        for (const block of blocks) {
          if (!block.querySelector("svg")) {
            block.textContent = block.dataset.mermaidSource || "";
            delete block.dataset.mermaidDone;
          }
        }
      });
    }
  }, 80);
}

/* ---------------------- 笔记思维导图 ---------------------- */

// 会话级视图状态（不持久化，重开侧栏回到列表）。
state.notesView = "list";

// markmap 实例与生命周期。vendor 脚本未就绪/异常时导图降级为提示条。
let mindmapInstance = null;
let mindmapFitRetry = 0;
const MINDMAP_FIT_MAX_RETRY = 5;
// design_token Indigo/Violet 色阶：markmap 默认配色与整体风格不符。
const MINDMAP_COLORS = [
  "#6366f1",
  "#f97316",
  "#22c55e",
  "#06b6d4",
  "#ec4899",
  "#eab308",
  "#8b5cf6",
  "#ef4444",
];

function mindmapNodeColor(node) {
  const branchIndex = Number(node?.state?.path?.[1]);
  if (Number.isFinite(branchIndex)) {
    return MINDMAP_COLORS[branchIndex % MINDMAP_COLORS.length];
  }
  return MINDMAP_COLORS[(node?.state?.depth || 0) % MINDMAP_COLORS.length];
}

function notesMindmapReady() {
  return (
    typeof window !== "undefined" &&
    window.markmap &&
    typeof window.markmap.Markmap === "function"
  );
}

/** 布局未就绪（容器 0 尺寸）时 fit 会算出 NaN transform，直接跳过。 */
function patchMarkmapFit() {
  if (patchMarkmapFit.done || !notesMindmapReady()) return;
  try {
    const proto = window.markmap.Markmap.prototype;
    if (typeof proto.fit !== "function" || proto.fit.__safeFit) return;
    const originalFit = proto.fit;
    const safeFit = function safeFit(...args) {
      const rect = this.svg?.getBoundingClientRect?.();
      if (!rect || !rect.width || !rect.height) return Promise.resolve();
      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
        return Promise.resolve();
      }
      return originalFit.apply(this, args);
    };
    safeFit.__safeFit = true;
    proto.fit = safeFit;
    patchMarkmapFit.done = true;
  } catch {
    /* 原型补丁失败不影响主流程 */
  }
}
patchMarkmapFit.done = false;

/**
 * 面板刚显示时 SVG 尺寸可能还是 0，fit 没意义；等 120ms×N 次重试。
 * 参考项目 markdown2mind 在侧栏场景踩过的坑，直接移植。
 */
function queueMindmapFit() {
  if (!mindmapInstance) return;
  mindmapFitRetry = 0;
  const attempt = () => {
    if (!mindmapInstance) return;
    const svg = el("notesMindmapSvg");
    const rect = svg?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      try {
        mindmapInstance.fit();
      } catch {
        /* fit 失败无所谓，下一帧 setData 再试 */
      }
      return;
    }
    mindmapFitRetry += 1;
    if (mindmapFitRetry <= MINDMAP_FIT_MAX_RETRY) {
      setTimeout(attempt, 120);
    }
  };
  attempt();
}

/** 图片异步解码后节点尺寸会变化；等缩略图完成再重新居中。 */
function bindMindmapImageFit(attempt = 0) {
  setTimeout(() => {
    const images = document.querySelectorAll(
      "#notesMindmapSvg .mindmap-visual-reference-image",
    );
    // Markmap.create 内部异步 setData，首轮查询可能早于 foreignObject 创建。
    if (!images.length && attempt < 5 && state.notesView === "mindmap") {
      bindMindmapImageFit(attempt + 1);
      return;
    }
    for (const image of images) {
      if (image.complete || image.dataset.mindmapFitBound === "1") continue;
      image.dataset.mindmapFitBound = "1";
      image.addEventListener("load", queueMindmapFit, { once: true });
      image.addEventListener("error", queueMindmapFit, { once: true });
    }
    if (images.length) queueMindmapFit();
  }, attempt ? 60 : 0);
}

/** 各范围下导图根节点标题。 */
function notesMindmapRootTitle() {
  if (state.notesScope === "video") {
    return el("videoTitle")?.textContent || uiText("当前视频笔记");
  }
  if (state.notesScope === "memo") return uiText("手记");
  if (state.notesScope === "ai") return uiText("AI 记");
  return uiText("全部笔记");
}

/** 各范围下每条笔记的导图一级节点文案。 */
function notesMindmapLabelFor(note) {
  const kind = note?.kind || (state.notesScope === "ai" ? "ai_note" : "memo");
  const isAi = kind === "ai_note" || kind === "ai_chat";
  const badge = isAi
    ? uiText("AI")
    : note?.timestamp
      ? `⏱ ${note.timestamp}`
      : "";
  // 笔记正文字段是 text（getNotes/getMemos 的存储形状）。
  const text = NOTE_MINDMAP.shorten(
    String(note?.text || note?.content || "")
      .split("\n")
      .find((line) => line.trim()) || "",
  );
  return badge ? `${badge} ${text}` : text;
}

/** 渲染笔记思维导图（列表数据来自 state.notesLoaded）。 */
function renderNotesMindmap() {
  const panel = el("notesMindmapPanel");
  const svg = el("notesMindmapSvg");
  if (!panel || !svg) return;
  patchMarkmapFit();

  const notes = state.notesLoaded || [];
  if (!notes.length) {
    // 空态：清掉旧图，显示提示（复用 .state 空态样式）
    destroyMindmap();
    svg.textContent = "";
    const empty = document.createElement("div");
    empty.className = "state";
    empty.innerHTML = `<svg class="icon state-icon" aria-hidden="true"><use href="#i-note"/></svg>
      <p class="state-title">${uiText("当前范围还没有笔记")}</p>
      <p class="state-text">${uiText("先在列表视图记几条，再来导图看结构。")}</p>`;
    panel.appendChild(empty);
    return;
  }

  // 移除可能的旧空态节点
  Array.from(panel.children).forEach((child) => {
    if (child !== svg) child.remove();
  });

  if (!notesMindmapReady()) {
    // vendor 未就绪：提示 + 有限次重试（最多 3 次，防无限循环）
    const tip = document.createElement("div");
    tip.className = "state";
    tip.innerHTML = `<p class="state-title">${uiText("导图组件加载中…")}</p>`;
    panel.appendChild(tip);
    const retries = Number(renderNotesMindmap._retries) || 0;
    if (retries < 3) {
      renderNotesMindmap._retries = retries + 1;
      setTimeout(() => {
        if (state.notesView === "mindmap") renderNotesMindmap();
      }, 400);
    }
    return;
  }

  const aiVideoNote =
    state.notesScope === "video"
      ? notes.find((note) => note?.kind === "ai_video_note")
      : null;
  const tree = aiVideoNote
    ? buildMindmapDocumentTree(notesMindmapRootTitle(), aiVideoNote)
    : NOTE_MINDMAP.buildNotesTree(notesMindmapRootTitle(), notes, {
        labelFor: notesMindmapLabelFor,
      });

  try {
    if (mindmapInstance) {
      mindmapInstance.setData(tree);
    } else {
      mindmapInstance = window.markmap.Markmap.create(svg, {
        color: mindmapNodeColor,
        padding: 24,
        spacingVertical: 8,
        spacingHorizontal: 72,
        initialExpandLevel: 8,
        maxWidth: 360,
        duration: 300,
      }, tree);
    }
    bindMindmapImageFit();
    queueMindmapFit();
  } catch (error) {
    console.warn("笔记导图渲染失败", error);
    const tip = document.createElement("div");
    tip.className = "state";
    tip.innerHTML = `<p class="state-title">${uiText("导图渲染失败")}</p>`;
    panel.appendChild(tip);
  }
}

function destroyMindmap() {
  if (mindmapInstance && typeof mindmapInstance.destroy === "function") {
    try {
      mindmapInstance.destroy();
    } catch {
      /* destroy 失败直接丢弃实例 */
    }
  }
  mindmapInstance = null;
}

/** 列表 ↔ 导图切换。 */
function setNotesView(view) {
  const canUseMindmap =
    state.notesScope === "video" &&
    (state.notesLoaded || []).some((note) => note?.kind === "ai_video_note");
  const mindmap = view === "mindmap" && canUseMindmap;
  state.notesView = mindmap ? "mindmap" : "list";
  // 导图里没有卡片可选，进入导图时顺带退出删除模式，回来不用再手动取消。
  if (mindmap && state.notesDeleteMode) state.notesDeleteMode = false;
  el("notesMindmapPanel").hidden = !mindmap;
  el("notesEntries").hidden = mindmap || state.notesScope === "ai" || state.notesScope === "memo";
  el("memoPanel").hidden = mindmap || state.notesScope !== "memo";
  el("aiNotesPanel").hidden = mindmap || state.notesScope !== "ai";
  el("notesDeleteBar").hidden = mindmap || !state.notesDeleteMode;
  syncAiNoteViewSwitch();
  const loadMore = el("loadMoreNotesBtn");
  if (loadMore) loadMore.hidden = mindmap || !state.notesHasMore;
  if (mindmap) {
    renderNotesMindmap();
  } else {
    destroyMindmap();
  }
}

function syncAiNoteViewSwitch() {
  const documentBtn = el("aiNoteDocumentBtn");
  const mindmapBtn = el("aiNoteMindmapBtn");
  if (!documentBtn || !mindmapBtn) return;
  const mindmap = state.notesView === "mindmap";
  documentBtn.classList.toggle("active", !mindmap);
  mindmapBtn.classList.toggle("active", mindmap);
  documentBtn.setAttribute("aria-pressed", String(!mindmap));
  mindmapBtn.setAttribute("aria-pressed", String(mindmap));
}

// ============================================================
// 划词解释
// ============================================================

const EXPLAIN_GAP = 10; // 浮层与选区之间留的缝
const EXPLAIN_MARGIN = 8; // 浮层与内容区边缘留的缝

let pendingSelection = "";
let pendingRange = null;
// 解释浮层锚在被选中的那段文字上。存 Range 而不是坐标：滚动、改窗宽之后
// 重新取一次 getBoundingClientRect 就能算出新位置。
let explainAnchor = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function hideExplain() {
  el("explainTooltip").hidden = true;
  el("explainPopover").hidden = true;
  explainAnchor = null;
}

// 选中字幕里的一段文字后，在选区上方浮出「解释」按钮。
function onSelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    el("explainTooltip").hidden = true;
    return;
  }

  const text = selection.toString().trim();
  const container = selection.anchorNode?.parentElement;
  if (!text || text.length > 200 || !container?.closest(".content")) {
    el("explainTooltip").hidden = true;
    return;
  }

  const range = selection.getRangeAt(0);
  pendingSelection = text;
  pendingRange = range.cloneRange();

  const rect = range.getBoundingClientRect();
  const bounds = document.querySelector(".content").getBoundingClientRect();
  const tooltip = el("explainTooltip");
  tooltip.hidden = false;
  tooltip.style.left = `${clamp(
    rect.left + rect.width / 2 - tooltip.offsetWidth / 2,
    EXPLAIN_MARGIN,
    window.innerWidth - tooltip.offsetWidth - EXPLAIN_MARGIN,
  )}px`;
  tooltip.style.top = `${clamp(
    rect.top - tooltip.offsetHeight - 6,
    bounds.top + EXPLAIN_MARGIN,
    bounds.bottom - tooltip.offsetHeight - EXPLAIN_MARGIN,
  )}px`;
}

// 浮层贴在选中文字上方；上面塞不下就翻到下方，并始终留在内容区内不压住顶栏。
function positionExplainPopover() {
  const popover = el("explainPopover");
  if (popover.hidden || !explainAnchor) return;

  const rect = explainAnchor.getBoundingClientRect();
  const bounds = document.querySelector(".content").getBoundingClientRect();
  // 被解释的那句已经滚出视野，浮层再赖着就成了没有出处的一块牌子。
  if (rect.bottom < bounds.top || rect.top > bounds.bottom) {
    hideExplain();
    return;
  }

  const { offsetWidth: width, offsetHeight: height } = popover;
  const minTop = bounds.top + EXPLAIN_MARGIN;
  const maxTop = bounds.bottom - height - EXPLAIN_MARGIN;
  const above = rect.top - height - EXPLAIN_GAP;
  const below = rect.bottom + EXPLAIN_GAP;
  const placement = above >= minTop || below > maxTop ? "top" : "bottom";
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    EXPLAIN_MARGIN,
    window.innerWidth - width - EXPLAIN_MARGIN,
  );

  popover.dataset.placement = placement;
  popover.style.left = `${left}px`;
  popover.style.top = `${clamp(placement === "top" ? above : below, minTop, maxTop)}px`;
  // 浮层被边缘挡住而偏移时，小三角仍要对准选区中心。
  popover.style.setProperty(
    "--arrow-x",
    `${clamp(rect.left + rect.width / 2 - left, 16, width - 16)}px`,
  );
}

// 给模型的上下文：选中处所在段落及前后各一段。用户选中的是屏幕上显示的文字，
// 开着顺句或翻译时那不是原文，所以原文、顺句稿、译文都要找。
function selectionContext(selected) {
  const segments = state.data?.segments || [];
  const index = segments.findIndex(
    (segment) =>
      segment.text.includes(selected) ||
      (state.polished[segment.id] || "").includes(selected) ||
      (state.translated[segment.id] || "").includes(selected),
  );
  if (index === -1) return state.data?.transcriptText?.slice(0, 2000) || "";
  return segments
    .slice(Math.max(0, index - 1), index + 2)
    .map((segment) => segmentDisplayText(segment))
    .join(" ");
}

async function explainSelection() {
  const selected = pendingSelection;
  if (!selected) return;

  el("explainTooltip").hidden = true;
  el("explainTerm").textContent = selected;
  el("explainBody").textContent = uiText("正在解释…");
  el("explainPopover").hidden = false;
  explainAnchor = pendingRange;
  positionExplainPopover();

  const result = await chrome.runtime.sendMessage({
    action: "explainSelection",
    selectedText: selected,
    transcriptContext: selectionContext(selected),
    videoTitle: state.data?.videoInfo?.title || "",
  });

  el("explainBody").textContent = result?.success
    ? result.explanation
    : result?.message || "解释失败，请重试。";
  // 解释文字填进去，浮层高度变了，得重新贴一次。
  positionExplainPopover();
}

// ============================================================
// 复制 / 导出
// ============================================================

// 导出跟着界面走：看到的是哪一份，导出的就是哪一份。
function transcriptAsText() {
  const bilingual = state.transcriptMode === "bilingual";
  return (state.data?.segments || [])
    .map((segment) => {
      const stamp = `[${formatTimestamp(segment.start)}]`;
      if (!bilingual) return `${stamp} ${segmentDisplayText(segment)}`;
      const source = sourceText(segment);
      const translated = state.translated[segment.id];
      return translated
        ? `${stamp} ${source}\n${" ".repeat(stamp.length)} ${translated}`
        : `${stamp} ${source}`;
    })
    .join("\n");
}

function flashButton(button, text) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

async function copyTranscript() {
  if (!state.data) return;
  try {
    await navigator.clipboard.writeText(transcriptAsText());
    flashButton(el("copyBtn"), "已复制");
  } catch (error) {
    flashButton(el("copyBtn"), "复制失败");
  }
}

function exportTranscript() {
  if (!state.data) return;
  const title = state.data.videoInfo?.title || state.bvid;
  const sourceUrl =
    state.site === "youtube"
      ? `https://www.youtube.com/watch?v=${state.bvid}`
      : `https://www.bilibili.com/video/${state.bvid}${state.page > 1 ? `?p=${state.page}` : ""}`;
  const header = `${title}\n${state.data.videoInfo?.owner || ""}\n${sourceUrl}\n\n`;
  const blob = new Blob([header + transcriptAsText()], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(title)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "transcript";
}

// ============================================================
// 启动
// ============================================================

function setupEventListeners() {
  el("refreshBtn").addEventListener("click", () => {
    if (state.bvid) loadTranscript({ force: true });
  });
  el("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  el("errorRetryBtn").addEventListener("click", () => loadTranscript({ force: true }));
  el("polishBtn").addEventListener("click", togglePolish);
  for (const button of el("transcriptMode").querySelectorAll(".segmented-btn")) {
    button.addEventListener("click", () => setTranscriptMode(button.dataset.mode));
  }
  el("copyBtn").addEventListener("click", copyTranscript);
  el("exportBtn").addEventListener("click", exportTranscript);
  el("searchBtn").addEventListener("click", () => {
    if (el("searchRow").hidden) openSearch();
    else closeSearch();
  });
  el("searchClose").addEventListener("click", closeSearch);
  el("searchInput").addEventListener("input", (event) => {
    applySearchFilter(event.target.value);
  });
  el("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
  });
  el("followPill").addEventListener("click", jumpToActive);
  // 「/」唤起搜索——正在别的输入框里打字时不抢。
  document.addEventListener("keydown", (event) => {
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.key === "/" && state.tab === "transcript" && state.view === "ready") {
      event.preventDefault();
      openSearch();
    }
  });
  el("analyzeBtn").addEventListener("click", () => analyze());
  el("reanalyzeBtn").addEventListener("click", () => analyze({ force: true }));
  el("overviewPrompt").addEventListener("input", updateOverviewPrompt);
  el("resetOverviewPromptZhBtn").addEventListener("click", () =>
    resetOverviewPrompt("zh-CN"),
  );
  el("resetOverviewPromptEnBtn").addEventListener("click", () =>
    resetOverviewPrompt("en"),
  );
  el("generateVideoNoteBtn").addEventListener("click", generateVideoNote);
  el("noteStyleSelect").addEventListener("change", updateNoteStyle);
  el("notePrompt").addEventListener("input", updateNotePrompt);
  el("resetNotePromptZhBtn").addEventListener("click", () =>
    resetNotePrompt("zh-CN"),
  );
  el("resetNotePromptEnBtn").addEventListener("click", () =>
    resetNotePrompt("en"),
  );
  el("notesScopeVideo").addEventListener("click", () => setNotesScope("video"));
  el("notesScopeAll").addEventListener("click", () => setNotesScope("all"));
  el("notesScopeMemo").addEventListener("click", () => setNotesScope("memo"));
  el("notesScopeAi").addEventListener("click", () => setNotesScope("ai"));
  el("aiNoteDocumentBtn").addEventListener("click", () => setNotesView("list"));
  el("aiNoteMindmapBtn").addEventListener("click", () => setNotesView("mindmap"));
  el("aiNoteCopyBtn").addEventListener("click", copyCurrentAiVideoNote);
  el("aiNoteEditBtn").addEventListener("click", startAiVideoNoteEdit);
  el("aiNoteResetBtn").addEventListener("click", resetCurrentAiVideoNote);
  el("aiNoteDeleteBtn").addEventListener("click", deleteCurrentAiVideoNote);
  el("aiNoteCancelEditBtn").addEventListener("click", cancelAiVideoNoteEdit);
  el("aiNoteSaveEditBtn").addEventListener("click", saveAiVideoNoteEdit);
  el("toggleNotesDeleteModeBtn").addEventListener("click", () =>
    setNotesDeleteMode(!state.notesDeleteMode),
  );
  el("cancelNotesDeleteModeBtn").addEventListener("click", () => setNotesDeleteMode(false));
  el("selectVisibleNotesBtn").addEventListener("click", selectVisibleNotes);
  el("deleteSelectedNotesBtn").addEventListener("click", deleteSelectedNotes);
  el("clearCurrentNotesBtn").addEventListener("click", clearCurrentNotes);
  el("loadMoreNotesBtn").addEventListener("click", loadMoreNotes);
  el("exportNotesFormatSelect").addEventListener("change", (event) =>
    exportNotesFromSelect(event.currentTarget),
  );
  el("aiNoteExportFormatSelect").addEventListener("change", (event) =>
    exportNotesFromSelect(event.currentTarget),
  );
  el("memoForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveMemo();
  });
  el("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    submitChatQuestion();
  });
  el("chatInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitChatQuestion();
    }
  });
  el("clearChatBtn").addEventListener("click", resetChat);
  el("disabledSettingsBtn").addEventListener("click", () =>
    chrome.runtime.sendMessage({ action: "openOptions" }),
  );
  el("explainBtn").addEventListener("click", explainSelection);
  el("explainClose").addEventListener("click", hideExplain);

  // 按下鼠标就会清空选区，进而触发 selectionchange 把这个按钮藏掉，
  // click 根本没机会发生。阻止默认行为，选区才能活到点击那一刻。
  el("explainTooltip").addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  for (const button of document.querySelectorAll(".tab")) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  }

  document.addEventListener("selectionchange", onSelectionChange);

  window.addEventListener("resize", positionExplainPopover);

  document.querySelector(".content").addEventListener(
    "scroll",
    () => {
      positionExplainPopover();
      // 刚刚是我们自己滚的就不算用户操作。
      if (Date.now() - state.lastAutoScrollAt > 1000) {
        state.lastUserScrollAt = Date.now();
        updateFollowPill();
      }
    },
    { passive: true },
  );

  // per-tab 语义下，面板只跟随自己归属的标签页：
  // ① 自己归属的标签页被激活时重新同步（可能刚被切回来，内容要刷新）
  // ② 归属标签页的 URL 变了（B 站换视频走 pushState）时重新同步
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (state.ownerTabId == null) return;
    if (tabId === state.ownerTabId && windowId === state.windowId) {
      syncWithActiveTab();
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (state.ownerTabId == null) return;
    if (changeInfo.url && tabId === state.ownerTabId) syncWithActiveTab();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "startDigestFromButton") {
      // 点哪个标签页的按钮，只有归属那个标签页的面板才跟过去。
      const senderTabId = message.tab?.id;
      if (senderTabId != null && state.ownerTabId != null && senderTabId !== state.ownerTabId) {
        return false;
      }
      syncWithActiveTab({ tab: message.tab || null });
    }
    if (message?.action === "siteScopeChanged") syncWithActiveTab({ force: true });
    if (message?.action === "uiLanguageChanged") {
      state.uiLanguage = message.uiLanguage === "en" ? "en" : "zh-CN";
      state.overviewPromptLanguage = state.uiLanguage;
      state.notePromptLanguage = state.uiLanguage;
      applySidepanelLanguage();
      renderOverviewPrompt();
      renderNotePrompt();
      renderNoteStyleSelector();
      if (state.analysis && state.analysisLanguage !== state.uiLanguage) {
        resetOverview();
      } else if (state.analysis) {
        renderAnalysis(state.analysis, true);
      }
      if (state.tab === "notes") loadNotes();
      if (state.tab === "chat") renderChat();
      render();
    }
    if (message?.action === "noteSaved" && state.tab === "notes") loadNotes();
    // 笔记先存原始字幕、润色好了再替换正文，所以还有第二次刷新。
    if (message?.action === "noteUpdated" && state.tab === "notes") loadNotes();
    // 概览的分块在 background 里跑，进度只能靠它广播回来。
    // tabId 定向：只有归属当前标签页的面板才显示动画，别的标签页的面板不动。
    if (message?.action === "aiProgress") {
      if (message.tabId != null && message.tabId !== state.tabId) return false;
      showProgress(message.kind, message.done, message.total);
    }
    return false;
  });
}

async function initializeSidepanel() {
  const stored = await chrome.storage.local.get([
    BILI_SETTINGS.STORAGE_KEY,
    BILI_SETTINGS.LEGACY_STORAGE_KEY,
  ]);
  const settings = BILI_SETTINGS.normalizeAppSettings(
    stored[BILI_SETTINGS.STORAGE_KEY] ?? stored[BILI_SETTINGS.LEGACY_STORAGE_KEY],
  );
  state.uiLanguage = settings.uiLanguage;
  state.overviewPrompts = { ...settings.overviewPrompts };
  state.overviewPromptLanguage = state.uiLanguage;
  state.notePrompts = { ...settings.notePrompts };
  state.notePromptLanguage = state.uiLanguage;
  state.noteStyle = BILI_NOTE_TEMPLATES.normalizeStyle(settings.noteStyle);
  applySidepanelLanguage();
  renderOverviewPrompt();
  renderNotePrompt();
  renderNoteStyleSelector();
  state.windowId = (await chrome.windows.getCurrent()).id;

  // 锁定面板归属的标签页：per-tab 面板是打开它的那个标签页的实例。
  // 之后所有 tabId 定向（进度动画、startDigestFromButton）都以它为准，
  // 换到别的标签页时本面板实例保持自己的内容，不被别人的动作带跑。
  try {
    const [owner] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    state.ownerTabId = owner?.id ?? null;
  } catch (error) {
    state.ownerTabId = null;
  }

  setupEventListeners();
  setInterval(trackPlayback, POLL_INTERVAL_MS);
  await syncWithActiveTab();
}

function showStartupError(error) {
  console.error("[Video Assistant] 侧栏初始化失败：", error);
  for (const id of SECTIONS) {
    const section = el(id);
    if (section) section.hidden = true;
  }
  const invalidated = /Extension context invalidated/i.test(String(error?.message || error));
  el("errorTitle").textContent = invalidated ? "插件已更新" : "侧栏初始化失败";
  el("errorText").textContent = invalidated
    ? "当前侧栏仍属于旧版本。请关闭侧栏后重新点击插件图标。"
    : String(error?.message || error || "未知错误，请关闭侧栏后重试。");
  el("errorLoginLink").hidden = true;
  el("errorState").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  initializeSidepanel().catch(showStartupError);
});
