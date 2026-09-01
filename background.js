/**
 * Bilibili Digest — service worker（MV3）：
 * 消息中转、字幕获取（WBI 签名）、LLM 调用、侧边栏按 tab 启用。
 */

importScripts(
  "settings.js",
  "lib/wbi.js",
  "lib/bili-api.js",
  "lib/youtube-api.js",
  "lib/transcript.js",
  "lib/cache.js",
  "lib/ai.js",
  "lib/ai-provider.js",
  "lib/visual-memos.js",
  "lib/note-schema.js",
  "lib/note-db.js",
  "lib/provider-router.js",
  "lib/concurrency.js",
);

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// 两道超时各管一段，边界是「响应头是否已到达」：之前是模型在生成，归可配的
// 硬超时管；之后 body 应连续到达，静默 50 秒即视为连接出了问题，不必可配。
const AI_IDLE_TIMEOUT_MS = 50_000;
const AI_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// 加码重试的天花板。再往上多数模型会因超过自身输出上限直接拒绝请求。
const MAX_OUTPUT_TOKENS = 32_768;

// 内容脚本运行在 B 站页面上下文，不应读到密钥或缓存。
chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) =>
    console.warn("[Bilibili Digest] 无法限制存储访问级别：", error),
  );

async function getSettings() {
  const stored = await chrome.storage.local.get([
    BILI_SETTINGS.STORAGE_KEY,
    BILI_SETTINGS.LEGACY_STORAGE_KEY,
  ]);
  const source =
    stored[BILI_SETTINGS.STORAGE_KEY] ??
    stored[BILI_SETTINGS.LEGACY_STORAGE_KEY];
  const settings = BILI_SETTINGS.normalizeAppSettings(source);
  if (!stored[BILI_SETTINGS.STORAGE_KEY] && stored[BILI_SETTINGS.LEGACY_STORAGE_KEY]) {
    await chrome.storage.local.set({ [BILI_SETTINGS.STORAGE_KEY]: settings });
  }
  return settings;
}

function isSiteEnabled(settings, site) {
  if (site === "youtube") return settings.youtubeEnabled;
  if (site === "bilibili") return settings.bilibiliEnabled;
  return false;
}

function contentScriptSite(url) {
  const value = String(url || "");
  if (/^https:\/\/www\.youtube\.com\/watch(?:\?|$)/i.test(value)) return "youtube";
  if (/^https:\/\/www\.bilibili\.com\/(?:video|list)\//i.test(value)) return "bilibili";
  return "";
}

async function ensureContentScriptForTab(tab) {
  const tabId = Number(tab?.id) || 0;
  const site = contentScriptSite(tab?.url);
  if (!tabId || !site) return false;

  const version = chrome.runtime.getManifest().version;
  try {
    const reply = await chrome.tabs.sendMessage(tabId, {
      action: "videoAssistantContentScriptPing",
    });
    if (reply?.success && reply.version === version && reply.site === site) return true;
  } catch (error) {
    // 页面可能在扩展更新前已经打开，旧 content script 已失效或根本没有注入。
  }

  try {
    // 先清掉旧脚本留在页面上的无效按钮；它们仍可见，但事件处理器已经无法
    // 连接新版 service worker，正是“必须刷新页面才可用”的直接表现。
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [site],
      func: (targetSite) => {
        const ids = targetSite === "youtube"
          ? ["ytd-digest-button", "ytd-note-button", "ytd-note-toast"]
          : ["bili-digest-button", "bili-digest-note-button", "bili-digest-overlay", "bili-note-toast"];
        for (const id of ids) document.getElementById(id)?.remove();
        document.getElementById("bili-note-toast-style")?.remove();
      },
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "content-shared.js",
        site === "youtube" ? "content-youtube.js" : "content-bilibili.js",
      ],
    });
    return true;
  } catch (error) {
    console.warn(`[Video Assistant] 无法恢复 ${site} 标签页的内容脚本：`, error);
    return false;
  }
}

async function broadcastSiteScope(settings) {
  const message = {
    action: "siteScopeChanged",
    youtubeEnabled: settings.youtubeEnabled,
    bilibiliEnabled: settings.bilibiliEnabled,
  };

  // 侧边栏等扩展页面走 runtime 消息；内容脚本必须逐标签页发送。
  chrome.runtime.sendMessage(message).catch(() => {});
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) =>
        /^https:\/\/www\.(youtube\.com\/watch|bilibili\.com\/(video|list)\/)/.test(
          tab.url || "",
        ),
      )
      .map((tab) => chrome.tabs.sendMessage(tab.id, message)),
  );
}

// ============================================================
// 侧边栏
// ============================================================

/**
 * 侧边栏 per-tab 管理。Chrome 的 sidePanel 默认是窗口级（global）面板：
 * 切到任何标签页都显示，内容跟随活动标签页，state 全部共享——这正是用户
 * 反馈「切换标签页侧边栏还在」「加载动画串到别的标签页」的根因。
 * 必须对每个标签页显式 setOptions({ tabId, enabled })，浏览器才会给它一个
 * 独立的 tab 级面板实例：
 *   - 切到未启用的标签页 → 面板自动隐藏（官方语义）
 *   - 切回启用过的标签页 → 面板自动恢复
 *   - 关闭标签页 → 对应面板随之销毁
 *   - 每个标签页的面板是独立实例，state（生成笔记动画等）互不串台
 *
 * 工具栏图标交给 Chrome 官方的 openPanelOnActionClick 行为。此前手写
 * action.onClicked + open({ tabId }) 会与异步 setOptions 形成竞态：新装/更新扩展
 * 后，已打开的标签页还没写入 tab 级 path 就被 open，Chrome 会先打开一个没有
 * 正确文档的全局空白侧栏。浏览器内建行为会读取当前 tab 已生效的配置再打开。
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("[Video Assistant] 无法设置侧栏打开行为：", error));

// 官方 per-tab 模式：按标签页 URL 设置 enabled，切到未启用的标签页时
// 面板自动隐藏、切回启用过的自动恢复、关闭标签页对应面板随之销毁。
// setOptions 不要求用户手势，在 onUpdated 里做不会丢手势。
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "loading") return;
  const video = isVideoUrl(tab?.url || changeInfo.url || "");
  chrome.sidePanel
    .setOptions({
      tabId,
      enabled: Boolean(video),
      path: "sidepanel.html",
    })
    .catch((error) => console.warn("[Video Assistant] 无法配置标签页侧栏：", error));
});

// 声明式 content script 只会随文档导航注入。扩展更新、B 站 SPA 从首页进入
// 播放页等场景可能没有新脚本；页面完成或切换到该标签页时做一次版本握手并修复。
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  ensureContentScriptForTab({ ...tab, id: tabId }).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId)
    .then(async (tab) => {
      const video = isVideoUrl(tab.url || "");
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: Boolean(video),
        path: "sidepanel.html",
      });
      if (video) await ensureContentScriptForTab(tab);
    })
    .catch((error) => console.warn("[Video Assistant] 无法同步活动标签页：", error));
});

// 已打开的标签页不会重放 onUpdated：安装/启动时把现有标签页全部过一遍，
// 否则刚装好扩展时已开着的视频页没有 enabled 配置，点按钮会落到全局面板。
async function syncSidePanelForExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      const video = isVideoUrl(tab.url || "");
      try {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          enabled: video,
          path: "sidepanel.html",
        });
        if (video) await ensureContentScriptForTab(tab);
      } catch (error) {
        console.warn("[Video Assistant] 无法同步现有标签页：", error);
      }
    }
  } catch (error) {
    // 查询失败（比如浏览器还没就绪）不致命，等下一次 onUpdated 再配。
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
  syncSidePanelForExistingTabs();
});
chrome.runtime.onStartup.addListener(syncSidePanelForExistingTabs);

/**
 * 播放页上那个注入的 Digest 按钮走这条路。手势能否从内容脚本的消息传递到这里，
 * Chrome 认，Edge 不一定认。被拒绝时如实回话，让页面上的按钮改口引导用户去点
 * 工具栏图标——那条路由浏览器自己处理，一定有效。
 */
async function handleOpenSidePanel(tab) {
  if (!tab) return { success: false };

  try {
    // 两个 API 都要在用户手势同步调用栈内发起。先排入 tab-specific 配置，再
    // 排入 open，避免 open 先命中 manifest 的全局面板、把 ownerTabId 锁到旧标签页。
    const configuring = chrome.sidePanel.setOptions({
      tabId: tab.id,
      enabled: true,
      path: "sidepanel.html",
    });
    const opening = chrome.sidePanel.open({ tabId: tab.id });
    await Promise.all([configuring, opening]);
  } catch (error) {
    console.warn("[Bilibili Digest] 打开侧边栏被拒绝：", error);
    return { success: false, needsToolbarClick: true };
  }

  // 广播面板「跟过来」：runtime 广播每个面板实例都收得到，面板端按
  // ownerTabId 过滤——只有归属发起按钮那个标签页的面板才会响应。
  chrome.runtime
    .sendMessage({
      action: "startDigestFromButton",
      tab: { id: tab.id, windowId: tab.windowId, url: tab.url || "" },
    })
    .catch(() => {});
  return { success: true };
}

// ============================================================
// 消息路由
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === "isSiteEnabled") {
    getSettings()
      .then((settings) =>
        sendResponse({ enabled: isSiteEnabled(settings, message.site) }),
      )
      .catch((error) => sendResponse({ enabled: true, error: error.message }));
    return true;
  }

  if (message?.action === "notifySiteScopeChanged") {
    getSettings()
      .then(async (settings) => {
        await broadcastSiteScope(settings);
        sendResponse({ success: true });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "notifyUiLanguageChanged") {
    const uiLanguage = message.uiLanguage === "en" ? "en" : "zh-CN";
    // 扩展页（sidepanel/options）走 runtime 广播；content 脚本收不到它，
    // 单独用 tabs.sendMessage 逐 tab 转发（B 站 / YouTube 页面上注入的
    // 手记按钮文案要跟随界面语言）。
    chrome.runtime.sendMessage({ action: "uiLanguageChanged", uiLanguage }).catch(() => {});
    chrome.tabs
      .query({})
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.id == null) continue;
          chrome.tabs
            .sendMessage(tab.id, { action: "uiLanguageChanged", uiLanguage })
            .catch(() => {});
        }
      })
      .catch(() => {});
    sendResponse({ success: true });
    return false;
  }

  if (message?.action === "getUiLanguage") {
    // content 脚本读不到 chrome.storage（TRUSTED_CONTEXTS 防密钥泄露），
    // 初始语言从这拿。失败不阻塞注入：脚本侧默认中文。
    getSettings()
      .then((settings) =>
        sendResponse({ success: true, uiLanguage: settings.uiLanguage === "en" ? "en" : "zh-CN" }),
      )
      .catch(() => sendResponse({ success: true, uiLanguage: "zh-CN" }));
    return true; // 异步 sendResponse
  }

  if (message?.action === "fetchTranscript") {
    handleFetchTranscript(message.bvid, {
      site: message.site,
      page: message.page,
      tabId: message.tabId,
      forceRefresh: message.forceRefresh,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开启以异步回复
  }

  if (message?.action === "checkConfig") {
    getSettings()
      .then((settings) => {
        const check = BILI_SETTINGS.validateAppSettings(settings);
        sendResponse({ ready: check.ok, errors: check.errors });
      })
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.action === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;
  }

  if (message?.action === "openSidePanel") {
    handleOpenSidePanel(sender.tab)
      .then(sendResponse)
      .catch(() => sendResponse({ success: false, needsToolbarClick: true }));
    return true;
  }

  if (message?.action === "analyzeTranscript") {
    handleAnalyzeTranscript(message.bvid, {
      site: message.site,
      page: message.page,
      forceRefresh: message.forceRefresh,
      customPrompt: message.customPrompt,
      tabId: message.tabId,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "generateVideoNote") {
    handleGenerateVideoNote(message.bvid, {
      site: message.site,
      page: message.page,
      tabId: message.tabId,
      noteStyle: message.noteStyle,
      customPrompt: message.customPrompt,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "polishSegments") {
    handlePolishSegments(message.bvid, {
      site: message.site,
      page: message.page,
      segmentIds: message.segmentIds,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "translateSegments") {
    handleTranslateSegments(message.bvid, {
      site: message.site,
      page: message.page,
      segmentIds: message.segmentIds,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "explainSelection") {
    handleExplainSelection(
      message.selectedText,
      message.transcriptContext,
      message.videoTitle,
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "askVideo") {
    handleAskVideo(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "saveNote") {
    handleSaveNote(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "saveMemo") {
    handleSaveMemo(message)
      .then(sendResponse)
      // error 和 message 都带上：UI 两端有的读 error，有的读 message，
      // 只放一边会让另一边显示笼统的「保存失败」而看不到真实原因。
      .catch((error) =>
        sendResponse({ success: false, error: error.message, message: error.message }),
      );
    return true;
  }

  if (message?.action === "getNotes") {
    handleGetNotes(message.bvid, message.site, message.scope, {
      offset: message.offset,
      limit: message.limit,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "getMemos") {
    handleGetMemos(message.kind, {
      site: message.site,
      bvid: message.bvid,
      offset: message.offset,
      limit: message.limit,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "deleteNote") {
    handleDeleteNote(message.noteId)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "deleteNotes") {
    handleDeleteNotes(message.noteIds)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "clearNotes") {
    handleClearNotes(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "updateNote") {
    handleUpdateNote(message.noteId, message.text)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "getNoteStats") {
    handleGetNoteStats()
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "exportNotesV2") {
    handleExportNotesV2(message.noteIds)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "applyNoteLimit") {
    enforceStoredNoteLimits()
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.action === "checkVideoAvailable") {
    handleCheckVideoAvailable(message.bvid, message.site)
      .then(sendResponse)
      // 检查本身出错不该挡住用户，放行让 B 站自己说话。
      .catch(() => sendResponse({ available: true }));
    return true;
  }

  return false;
});

// ============================================================
// 字幕管线
// ============================================================

/**
 * 视频页 URL 判断（与 sidepanel.parseVideoRef 同规则，供 per-tab 启用用）。
 * 判定为视频页的标签页才有侧边栏；首页/搜索页/其他站点一律禁用。
 */
function isVideoUrl(url) {
  if (!url) return false;
  return /(^|\/)(www\.)?(bilibili\.com\/video\/|youtube\.com\/watch\?v=|youtu\.be\/|m\.bilibili\.com\/video\/)/i.test(url);
}

function resolveVideo(siteInput, videoIdInput, page = 1) {
  const site = siteInput === "youtube" ? "youtube" : "bilibili";
  const videoId =
    site === "youtube"
      ? VIDEO_YOUTUBE_API.parseVideoId(videoIdInput)
      : BILI_API.parseBvid(videoIdInput);
  if (!videoId) return null;
  const pageNumber =
    site === "bilibili" && Number(page) > 0 ? Math.floor(Number(page)) : 1;
  return {
    site,
    videoId,
    page: pageNumber,
    cacheId: site === "youtube" ? `youtube_${videoId}` : videoId,
  };
}

function canonicalVideoUrl(resource, seconds = 0) {
  return resource.site === "youtube"
    ? VIDEO_YOUTUBE_API.canonicalVideoUrl(resource.videoId, seconds)
    : BILI_API.canonicalVideoUrl(resource.videoId, seconds, resource.page);
}

async function readYouTubePageInfo(tabId) {
  let targetTabId = Number(tabId) || 0;
  if (!targetTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTabId = tab?.id || 0;
  }
  if (!targetTabId) return {};
  try {
    return (await chrome.tabs.sendMessage(targetTabId, { action: "getVideoInfo" })) || {};
  } catch (error) {
    return {};
  }
}

async function readYouTubeCaptionTracks(tabId, videoId) {
  let targetTabId = Number(tabId) || 0;
  if (!targetTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTabId = tab?.id || 0;
  }
  if (!targetTabId) return [];
  try {
    const result = await chrome.tabs.sendMessage(targetTabId, {
      action: "getYouTubeCaptionTracks",
      videoId,
    });
    return result?.success && Array.isArray(result.tracks) ? result.tracks : [];
  } catch (error) {
    return [];
  }
}

async function readYouTubeCaptionSource(tabId, videoId, languagePreference = []) {
  let targetTabId = Number(tabId) || 0;
  if (!targetTabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTabId = tab?.id || 0;
  }
  if (!targetTabId) return { tracks: [], error: "没有找到当前 YouTube 标签页。" };

  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      world: "MAIN",
      args: [{ videoId, languagePreference }],
      func: async ({ videoId: expectedVideoId, languagePreference: preferredLanguages }) => {
        const parseObject = (value) => {
          if (value && typeof value === "object") return value;
          if (typeof value !== "string") return null;
          try { return JSON.parse(value); } catch (error) { return null; }
        };
        const extractFromHtml = (html) => {
          const source = String(html || "");
          const hit = /ytInitialPlayerResponse\s*=\s*/g.exec(source);
          if (!hit) return null;
          const start = source.indexOf("{", hit.index + hit[0].length);
          if (start < 0) return null;
          let depth = 0;
          let quoted = false;
          let escaped = false;
          for (let index = start; index < source.length; index += 1) {
            const char = source[index];
            if (quoted) {
              if (escaped) escaped = false;
              else if (char === "\\") escaped = true;
              else if (char === '"') quoted = false;
              continue;
            }
            if (char === '"') quoted = true;
            else if (char === "{") depth += 1;
            else if (char === "}" && --depth === 0) {
              return parseObject(source.slice(start, index + 1));
            }
          }
          return null;
        };
        const captionTracks = (response) =>
          response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        const responseVideoId = (response) => String(response?.videoDetails?.videoId || "");
        const candidates = [];
        const player = document.getElementById("movie_player");
        try { candidates.push(parseObject(player?.getPlayerResponse?.())); } catch (error) {}
        candidates.push(
          parseObject(document.querySelector("ytd-watch-flexy")?.data?.playerResponse),
          parseObject(window.ytInitialPlayerResponse),
          parseObject(window.ytplayer?.config?.args?.raw_player_response),
          parseObject(window.ytplayer?.config?.args?.player_response),
        );
        let playerResponse = candidates.find(
          (candidate) => responseVideoId(candidate) === expectedVideoId && Array.isArray(captionTracks(candidate)),
        );
        if (!playerResponse) {
          const watchUrl = new URL("/watch", location.origin);
          watchUrl.searchParams.set("v", expectedVideoId);
          const watchResponse = await fetch(watchUrl, { credentials: "include", cache: "no-store" });
          if (watchResponse.ok) playerResponse = extractFromHtml(await watchResponse.text());
        }
        if (responseVideoId(playerResponse) !== expectedVideoId) {
          return { success: false, tracks: [], error: "当前播放器没有返回对应视频的字幕信息。" };
        }
        const tracks = (Array.isArray(captionTracks(playerResponse)) ? captionTracks(playerResponse) : [])
          .map((track) => ({
            baseUrl: String(track?.baseUrl || ""),
            languageCode: String(track?.languageCode || ""),
            name: String(track?.name?.simpleText || track?.name?.runs?.map((run) => run?.text || "").join("") || ""),
            kind: track?.kind === "asr" ? "asr" : "",
            isTranslatable: track?.isTranslatable === true,
          }))
          .filter((track) => track.baseUrl && track.languageCode);
        if (!tracks.length) return { success: false, tracks, error: "当前 YouTube 页面没有可用字幕轨。" };

        const preferences = (Array.isArray(preferredLanguages) ? preferredLanguages : [])
          .map((language) => String(language || "").toLowerCase());
        let selected = null;
        for (const preferred of preferences) {
          selected = tracks.find((track) => track.languageCode.toLowerCase() === preferred);
          if (!selected) {
            const base = preferred.split("-")[0];
            selected = tracks.find((track) => track.languageCode.toLowerCase().split("-")[0] === base);
          }
          if (selected) break;
        }
        selected ||= tracks.find((track) => track.kind !== "asr") || tracks[0];

        // ===== 主路径：捕获 YouTube 自己发出的 /api/timedtext 响应（参考沉浸式翻译）=====
        // 直接 fetch baseUrl 常因缺 pot 校验返回 200 + 空 HTML 反爬壳；而播放器自己
        // 取字幕的请求天生带合法 pot。所以先挂 XHR/fetch 钩子，再临时打开字幕模块
        // 逼播放器自己请求一次，捕获到的响应体即是可用字幕。
        const hookCaptures = [];
        const nativeXhrOpen = XMLHttpRequest.prototype.open;
        const nativeXhrSend = XMLHttpRequest.prototype.send;
        const nativeFetch = window.fetch;
        const looksLikeTimedText = (value) => String(value || "").includes("/api/timedtext");
        const wrappedXhrOpen = function (method, url) {
          this.__vaTimedTextUrl = String(url || "");
          return nativeXhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.open = wrappedXhrOpen;
        const wrappedXhrSend = function (...sendArgs) {
          const xhr = this;
          if (looksLikeTimedText(xhr.__vaTimedTextUrl)) {
            xhr.addEventListener("load", () => {
              try {
                if (xhr.status === 200 && xhr.responseText && xhr.responseText.length > 64) {
                  hookCaptures.push(xhr.responseText);
                }
              } catch (error) {}
            });
          }
          return nativeXhrSend.apply(this, sendArgs);
        };
        XMLHttpRequest.prototype.send = wrappedXhrSend;
        const wrappedFetch = async function (...fetchArgs) {
          const requestInput = fetchArgs[0];
          const requestUrl = typeof requestInput === "string"
            ? requestInput
            : String(requestInput?.url || "");
          const hookedResponse = await nativeFetch.apply(this, fetchArgs);
          try {
            if (looksLikeTimedText(requestUrl)) {
              hookedResponse.clone().text().then((hookedBody) => {
                if (hookedResponse.status === 200 && hookedBody.length > 64) {
                  hookCaptures.push(hookedBody);
                }
              }).catch(() => {});
            }
          } catch (error) {}
          return hookedResponse;
        };
        window.fetch = wrappedFetch;
        let capturedBody = "";
        try {
          const playerEl =
            document.getElementById("movie_player")
            || document.querySelector(".html5-video-player");
          // 先卸载再重载字幕模块：若播放器早已缓存当前区间的字幕，loadModule 是
          // 空操作，不会发出新请求，钩子永远等不到捕获。强制卸载后重载，
          // 播放器才会重新请求一次带有效 pot 的 timedtext。
          if (typeof playerEl?.unloadModule === "function") {
            try { playerEl.unloadModule("captions"); } catch (error) {}
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (typeof playerEl?.setOption === "function") {
            try { playerEl.setOption("captions", "track", { languageCode: selected.languageCode }); } catch (error) {}
          }
          if (typeof playerEl?.loadModule === "function") {
            try { playerEl.loadModule("captions"); } catch (error) {}
          }
          const hookDeadline = Date.now() + 6000;
          while (Date.now() < hookDeadline && !hookCaptures.length) {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          if (typeof playerEl?.unloadModule === "function") {
            try { playerEl.unloadModule("captions"); } catch (error) {}
          }
          capturedBody = hookCaptures.find((body) => {
            const probe = body.trim();
            return (
              (probe.startsWith("{") && probe.includes("\"segs\""))
              || /<(?:text|p)\b[^>]*>[\s\S]*?<\/(?:text|p)>/i.test(probe)
              || (/^WEBVTT\b/i.test(probe) && probe.includes("-->"))
            );
          }) || "";
        } finally {
          // 无论成败立刻还原原型，避免污染页面其它网络代码。
          // 条件还原：只在当前值仍是我们装的包装时才恢复；若其它代码已在其上再包一层，
          // 保持现值不动（我们的包装闭包持有 native 引用，让其它包装先剥离即可）。
          if (XMLHttpRequest.prototype.open === wrappedXhrOpen) {
            XMLHttpRequest.prototype.open = nativeXhrOpen;
          }
          if (XMLHttpRequest.prototype.send === wrappedXhrSend) {
            XMLHttpRequest.prototype.send = nativeXhrSend;
          }
          if (window.fetch === wrappedFetch) {
            window.fetch = nativeFetch;
          }
        }
        if (capturedBody) {
          return {
            success: true,
            tracks,
            body: capturedBody,
            contentType: "captured-timedtext",
            source: "timedtext-hook",
          };
        }

        // 本地获取只保留「播放器 self-request 捕获」一条路径；不再从后台直连
        // 字幕 URL，避免重复走到 HTTP 200 但正文为空的无效响应。
        // 失败时给出可操作的指引——稍等重试或切换到字幕服务商 API。
        return {
          success: false,
          tracks,
          error:
            "未能捕获 YouTube 播放器发出的字幕请求（可能刚打开页面、字幕模块未就绪）。"
            + "请稍候一两秒后重试；若多次失败，可在设置页改用字幕服务商 API。",
        };
      },
    });
    const result = injection?.[0]?.result;
    if (result && typeof result === "object") return result;
    return { tracks: [], error: "当前 YouTube 页面没有返回字幕读取结果。" };
  } catch (error) {
    const tracks = await readYouTubeCaptionTracks(targetTabId, videoId);
    return {
      tracks,
      error: tracks.length ? "无法在当前 YouTube 播放器上下文中请求字幕。" : (error?.message || "本地字幕读取失败。"),
    };
  }
}

// 优先命中站点隔离缓存；未命中后由对应站点适配器获取字幕。
async function handleFetchTranscript(
  videoIdInput,
  { site = "bilibili", page = 1, tabId, forceRefresh = false } = {},
) {
  const resource = resolveVideo(site, videoIdInput, page);
  if (!resource) {
    return {
      success: false,
      error: "INVALID_VIDEO_ID",
      message: "没有识别到受支持的视频地址。",
    };
  }

  const settings = await getSettings();
  const selectedCaptionProvider = resource.site === "youtube"
    ? settings.youtubeCaptionProviders[0]?.providerId || "local"
    : "";

  if (!forceRefresh) {
    const cached = await BILI_CACHE.load(resource.cacheId, { page: resource.page });
    const providerMatches = resource.site !== "youtube"
      || cached?.captionProviderId === selectedCaptionProvider;
    if (cached?.transcript?.length && providerMatches) {
      debugLog("[Video Assistant] 命中字幕缓存：", resource.cacheId);
      // 标志放在展开之后：旧版本写进缓存的脏标志不能盖过本次的真实值。
      return { ...cached, success: true, fromCache: true };
    }
  }

  try {
    let videoInfo;
    let entries;
    let language;
    let languageLabel;
    let isAiSubtitle = false;
    let availableTracks = [];

    if (resource.site === "youtube") {
      const pageInfoPromise = readYouTubePageInfo(tabId);
      const localCaptionSource = selectedCaptionProvider === "local"
        ? await readYouTubeCaptionSource(tabId, resource.videoId, settings.subtitleLangPreference)
        : { tracks: [] };
      const pageInfo = await pageInfoPromise;
      const transcriptResult = await VIDEO_YOUTUBE_API.fetchTranscriptWithFallback(
        resource.videoId,
        settings.youtubeCaptionProviders,
        {
          localTracks: localCaptionSource.tracks,
          localCaptionSource,
          languagePreference: settings.subtitleLangPreference,
        },
      );
      entries = transcriptResult.transcript;
      language = transcriptResult.language || "";
      languageLabel = transcriptResult.languageLabel || language || "Original";
      isAiSubtitle = transcriptResult.isAi === true;
      availableTracks = transcriptResult.availableLanguages.map((lang) => ({
        lang,
        langLabel: lang,
        isAi: false,
      }));
      videoInfo = {
        site: resource.site,
        videoId: resource.videoId,
        page: 1,
        pageCount: 1,
        title: pageInfo.title || resource.videoId,
        owner: pageInfo.channelName || "",
        description: pageInfo.description || "",
        duration: Number(pageInfo.duration) || 0,
      };
    } else {
      videoInfo = await BILI_API.fetchVideoInfo(resource.videoId, {
        page: resource.page,
      });
      videoInfo.site = resource.site;
      videoInfo.videoId = resource.videoId;
      const { tracks, needLogin } = await BILI_API.fetchSubtitleTracks(videoInfo);

      if (!tracks.length) {
        return {
          success: false,
          error: needLogin ? "NEED_LOGIN" : "NO_SUBTITLE",
          message: needLogin
            ? "该视频的字幕需要登录后才能查看，请先在浏览器里登录 Bilibili 账号。"
            : "该视频没有可用字幕。",
          videoInfo,
        };
      }

      const track = BILI_API.pickSubtitleTrack(
        tracks,
        settings.subtitleLangPreference,
      );
      entries = await BILI_API.fetchSubtitleTrackContent(track.url);
      language = track.lang;
      languageLabel = track.langLabel;
      isAiSubtitle = track.isAi;
      availableTracks = tracks.map(({ lang, langLabel, isAi }) => ({
        lang,
        langLabel,
        isAi,
      }));
    }

    if (!entries.length) {
      return {
        success: false,
        error: "EMPTY_TRANSCRIPT",
        message: "字幕文件是空的。",
        videoInfo,
      };
    }

    const segments = BILI_TRANSCRIPT.groupTranscriptEntries(entries);
    const texts = BILI_TRANSCRIPT.buildTranscriptTexts(entries);

    const result = {
      videoInfo,
      transcript: entries,
      segments,
      transcriptText: texts.plain,
      transcriptTextTimestamped: texts.timestamped,
      site: resource.site,
      videoId: resource.videoId,
      language,
      languageLabel,
      isAiSubtitle,
      availableTracks,
      captionProviderId: selectedCaptionProvider,
    };

    await BILI_CACHE.save(resource.cacheId, result, { page: resource.page });
    return { ...result, success: true, fromCache: false };
  } catch (error) {
    console.error("[Video Assistant] 字幕获取失败：", error);
    return {
      success: false,
      error: error.code || "TRANSCRIPT_FETCH_FAILED",
      message: error.message || "字幕获取失败。",
    };
  }
}

// ============================================================
// 模型调用
// ============================================================

const promptFileCache = new Map();

async function loadPromptSection(fileName, heading, variables = {}) {
  let markdown = promptFileCache.get(fileName);
  if (!markdown) {
    const response = await fetch(chrome.runtime.getURL(`prompts/${fileName}`));
    if (!response.ok) {
      throw new Error(`提示词文件读取失败：${fileName}`);
    }
    markdown = await response.text();
    promptFileCache.set(fileName, markdown);
  }
  return BILI_AI.extractPromptSection(markdown, heading, variables);
}

/**
 * 用户可以填任意 API 地址，而 MV3 不允许 fetch 未授权的域名。
 * 域名在安装时是未知的，所以走 optional_host_permissions 在设置页运行时申请。
 */
async function ensureHostPermission(baseUrl) {
  const origin = BILI_SETTINGS.originOf(baseUrl);
  if (!origin) {
    const error = new Error("API 地址不合法，请到设置页检查。");
    error.code = "INVALID_BASE_URL";
    throw error;
  }

  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) {
    const error = new Error(
      `扩展还没有访问 ${origin} 的权限。请打开设置页，点「保存并授权」。`,
    );
    error.code = "NEED_HOST_PERMISSION";
    throw error;
  }
}

// 协议差异由 lib/ai-provider.js 处理，这里只管超时、大小上限、空响应的诊断与重试。
async function requestAiCompletion({
  messages,
  images = [],
  visionMessages = messages,
  visualReferences = [],
  maxTokens,
  temperature,
  responseFormat,
}) {
  const appSettings = await getSettings();
  const check = BILI_SETTINGS.validateAppSettings(appSettings);
  if (!check.ok) {
    const error = new Error(`AI 还没配置好：${check.errors.join(" ")}`);
    error.code = "NO_AI_CONFIG";
    throw error;
  }

  const configured = BILI_SETTINGS.activeProviders(appSettings).map((entry) => ({
    ...entry,
    settings: {
      ...entry.settings,
      aiTimeoutSeconds: appSettings.aiTimeoutSeconds,
    },
  }));
  const providers = VIDEO_PROVIDER_ROUTER.routeOrder(configured);
  const failures = [];

  for (const [index, provider] of providers.entries()) {
    try {
      const usesVisualReferences = provider.settings.supportsVision === true && visualReferences.length > 0;
      const result = await requestProviderCompletion(provider.settings, {
        messages: usesVisualReferences ? visionMessages : messages,
        images: usesVisualReferences ? [] : images,
        visualReferences: usesVisualReferences ? visualReferences : [],
        maxTokens,
        temperature,
        responseFormat,
      });
      return { ...result, providerRole: provider.role, usedVisualReferences: usesVisualReferences };
    } catch (error) {
      failures.push({ provider, error });
      if (!VIDEO_PROVIDER_ROUTER.shouldFailOver(error)) throw error;
      if (index >= providers.length - 1) break;
      console.warn(
        `[Video Assistant] ${provider.label} 暂时不可用，尝试下一项 AI 服务：${error.message}`,
      );
    }
  }

  const error = new Error(failures.length
    ? `所有 AI 服务均失败。${failures
      .map(({ provider, error: failure }) => `${provider.label}：${failure.message || "暂不可用"}`)
      .join("；")}`
    : "没有可用的 AI 服务。");
  error.code = "AI_ALL_PROVIDERS_FAILED";
  throw error;
}

// 单个 Provider 内部仍保留空响应的自愈重试；用尽后才交给有序回退路由判断。
async function requestProviderCompletion(
  settings,
  { messages, images, visualReferences = [], maxTokens, temperature, responseFormat },
) {
  const check = BILI_SETTINGS.validate(settings);
  if (!check.ok) {
    const error = new Error(check.errors.join(" "));
    error.code = "NO_AI_CONFIG";
    throw error;
  }
  await ensureHostPermission(settings.aiBaseUrl);

  let format = responseFormat;
  let tokens = maxTokens;
  let diagnosis = null;
  const providerMessages = settings.supportsVision
    ? (visualReferences.length
        ? BILI_AI_PROVIDER.attachVisualReferencesToLastUserMessage(settings.protocol, messages, visualReferences)
        : BILI_AI_PROVIDER.attachImagesToLastUserMessage(settings.protocol, messages, images))
    : messages;

  // 空响应有两种能自愈的成因，各给一次机会，所以最多三轮。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const request = BILI_AI_PROVIDER.buildChatRequest({
      settings,
      messages: providerMessages,
      maxTokens: tokens,
      temperature,
      responseFormat: format,
    });
    const data = await sendAiRequest(settings, request);

    const text = BILI_AI_PROVIDER.parseChatResponse(settings.protocol, data);
    if (text.trim()) return { text, settings };

    diagnosis = BILI_AI_PROVIDER.diagnoseEmptyResponse(settings.protocol, data);

    if (format && diagnosis.retryWithoutJsonMode) {
      debugLog("[Bilibili Digest] JSON 模式返回空，脱掉 response_format 重试");
      format = null;
      continue;
    }

    // 预算被吃光了就加码重试——max_tokens 按实际生成计费，加码不额外花钱。
    if (diagnosis.retryWithMoreTokens && tokens < MAX_OUTPUT_TOKENS) {
      tokens = Math.min(tokens * 4, MAX_OUTPUT_TOKENS);
      debugLog("[Bilibili Digest] 输出被截断，放大预算重试：", tokens);
      continue;
    }

    break;
  }

  const error = new Error(diagnosis.message);
  error.code = "EMPTY_AI_RESPONSE";
  error.reason = diagnosis.reason;
  throw error;
}

// 真正发出请求，守住超时与响应大小（分工见 AI_IDLE_TIMEOUT_MS 处的说明）。
async function sendAiRequest(settings, request) {
  const controller = new AbortController();
  let timeoutKind = "";
  let idleTimer;
  let hardTimer;

  const abortFor = (kind) => {
    if (controller.signal.aborted) return;
    timeoutKind = kind;
    controller.abort();
  };
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abortFor("idle"), AI_IDLE_TIMEOUT_MS);
  };

  const hardTimeoutMs = settings.aiTimeoutSeconds * 1000;
  hardTimer = setTimeout(() => abortFor("hard"), hardTimeoutMs);
  // 空闲计时绝不能在这里起表：非流式请求在模型生成完之前一个字节都不会到，
  // 提前起表等于把「模型在慢慢想」当成「服务端死了」。这一段只由硬超时负责。

  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    // 响应头到了，body 应连续到达，空闲超时从这一刻起才有判断力。
    resetIdleTimer();

    const data = await readBoundedAiResponse(response, resetIdleTimer);
    if (!response.ok) {
      const error = new Error(
        BILI_AI_PROVIDER.parseErrorMessage(data, response.status),
      );
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    if (timeoutKind === "idle") {
      const timeout = new Error("响应传到一半断了，请重试。");
      timeout.code = "AI_IDLE_TIMEOUT";
      throw timeout;
    }
    if (timeoutKind === "hard") {
      const timeout = new Error(
        `请求超过 ${settings.aiTimeoutSeconds} 秒上限。可以在设置页调高超时，或降低并发。`,
      );
      timeout.code = "AI_HARD_TIMEOUT";
      throw timeout;
    }
    // fetch 对跨域被拒和网络不通都只抛笼统的 TypeError，给一句能指导下一步的提示。
    if (error instanceof TypeError) {
      const network = new Error(
        `连不上 ${settings.aiBaseUrl}。请检查地址是否正确、服务是否在运行，以及是否已在设置页授权。`,
      );
      network.code = "AI_NETWORK_ERROR";
      throw network;
    }
    throw error;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
  }
}

/** 边读边计字节数，避免异常大的响应把内存吃满。 */
async function readBoundedAiResponse(response, onActivity) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    onActivity();
    return JSON.parse(text.trimStart());
  }

  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    bytes += value?.byteLength ?? 0;
    if (bytes > AI_MAX_RESPONSE_BYTES) {
      await reader.cancel?.().catch(() => {});
      const error = new Error("响应超过 2 MiB 上限。");
      error.code = "AI_RESPONSE_TOO_LARGE";
      throw error;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text.trimStart());
}

/**
 * 把 SSE 响应体逐块解析成增量文本，OpenAI 兼容与 Anthropic 两种形状都吃。
 * 每收到一段正文增量就回调 onDelta；返回 { sawAnyData } 供上层判断
 * 是否吐过内容（决定「空响应重试」还是「部分输出直接终止」）。
 */
async function readSseStream(response, protocol, onDelta, onActivity) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    // 没有流式 reader 的网关：整段读回来当单块增量。
    const text = await response.text();
    onActivity?.();
    if (text.trim()) onDelta(text.trim());
    return { sawAnyData: Boolean(text.trim()) };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let sawAnyData = false;
  let ended = false;

  const flushLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return; // 空行 / SSE 注释
    if (trimmed.startsWith("event:")) return; // event 行只是分类，正文在 data 行
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      ended = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      return; // 半个 JSON（理论上不会出现，防御性跳过）
    }
    const delta = BILI_AI_PROVIDER.extractStreamDelta(protocol, data);
    if (delta) {
      sawAnyData = true;
      onDelta(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    bytes += value?.byteLength ?? 0;
    if (bytes > AI_MAX_RESPONSE_BYTES) {
      await reader.cancel?.().catch(() => {});
      const error = new Error("响应超过 2 MiB 上限。");
      error.code = "AI_RESPONSE_TOO_LARGE";
      throw error;
    }
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      await flushLine(line);
      if (ended) {
        await reader.cancel?.().catch(() => {});
        return { sawAnyData };
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await flushLine(buffer);
  return { sawAnyData };
}

/**
 * 流式版发送：复用非流式的双超时骨架（空闲 50s / 硬超时 aiTimeoutSeconds）
 * 和 2 MiB 上限，只是把整段 JSON 换成 SSE 逐块解析。
 */
async function sendAiRequestStream(settings, request, onDelta, signal) {
  const controller = new AbortController();
  let timeoutKind = "";
  let idleTimer;
  let hardTimer;

  const abortFor = (kind) => {
    if (controller.signal.aborted) return;
    timeoutKind = kind;
    controller.abort();
  };
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abortFor("idle"), AI_IDLE_TIMEOUT_MS);
  };

  const hardTimeoutMs = settings.aiTimeoutSeconds * 1000;
  hardTimer = setTimeout(() => abortFor("hard"), hardTimeoutMs);

  try {
    const abortSignal = signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal;
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: abortSignal,
    });
    resetIdleTimer();

    if (!response.ok) {
      // 错误响应通常是完整 JSON，不是 SSE，走非流式读取拿错误详情。
      const data = await readBoundedAiResponse(response, resetIdleTimer);
      const error = new Error(
        BILI_AI_PROVIDER.parseErrorMessage(data, response.status),
      );
      error.status = response.status;
      throw error;
    }

    const { sawAnyData } = await readSseStream(
      response,
      settings.protocol,
      onDelta,
      resetIdleTimer,
    );
    if (!sawAnyData) {
      // 流式响应里没有正文增量。没有完整 body 可做精细诊断（TRUNCATED /
      // REASONING_ONLY 等），统一按空响应交给上层 failover。
      const error = new Error("模型返回了空内容，请重试。");
      error.code = "EMPTY_AI_RESPONSE";
      throw error;
    }
    return { settings };
  } catch (error) {
    if (signal?.aborted) {
      const aborted = new Error("已取消。");
      aborted.code = "AI_CANCELLED";
      throw aborted;
    }
    if (timeoutKind === "idle") {
      const timeout = new Error("响应传到一半断了，请重试。");
      timeout.code = "AI_IDLE_TIMEOUT";
      throw timeout;
    }
    if (timeoutKind === "hard") {
      const timeout = new Error(
        `请求超过 ${settings.aiTimeoutSeconds} 秒上限。可以在设置页调高超时，或降低并发。`,
      );
      timeout.code = "AI_HARD_TIMEOUT";
      throw timeout;
    }
    if (error instanceof TypeError) {
      const network = new Error(
        `连不上 ${settings.aiBaseUrl}。请检查地址是否正确、服务是否在运行，以及是否已在设置页授权。`,
      );
      network.code = "AI_NETWORK_ERROR";
      throw network;
    }
    throw error;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
  }
}

/** 流式版单 Provider 请求：buildChatRequest(stream) → sendAiRequestStream。 */
async function requestProviderCompletionStream(
  settings,
  { messages, images, maxTokens, temperature, onDelta, signal },
) {
  const check = BILI_SETTINGS.validate(settings);
  if (!check.ok) {
    const error = new Error(check.errors.join(" "));
    error.code = "NO_AI_CONFIG";
    throw error;
  }
  await ensureHostPermission(settings.aiBaseUrl);

  const providerMessages = settings.supportsVision
    ? BILI_AI_PROVIDER.attachImagesToLastUserMessage(settings.protocol, messages, images)
    : messages;
  const request = BILI_AI_PROVIDER.buildChatRequest({
    settings,
    messages: providerMessages,
    maxTokens,
    temperature,
    stream: true,
  });
  await sendAiRequestStream(settings, request, onDelta, signal);
  return { settings };
}

/**
 * 流式版「按顺序尝试全部 AI 服务」。与非流式版本的差异：
 * 一旦某家已经吐过内容，失败就立即终止——两家服务拼出来的回答只会更乱，
 * 不执行 failover；只有一家都没吐过内容时，可恢复错误才轮到下一家。
 */
async function streamAiCompletion({ messages, images = [], maxTokens, temperature, onDelta, signal }) {
  const appSettings = await getSettings();
  const check = BILI_SETTINGS.validateAppSettings(appSettings);
  if (!check.ok) {
    const error = new Error(`AI 还没配置好：${check.errors.join(" ")}`);
    error.code = "NO_AI_CONFIG";
    throw error;
  }

  const configured = BILI_SETTINGS.activeProviders(appSettings).map((entry) => ({
    ...entry,
    settings: {
      ...entry.settings,
      aiTimeoutSeconds: appSettings.aiTimeoutSeconds,
    },
  }));
  const providers = VIDEO_PROVIDER_ROUTER.routeOrder(configured);
  const failures = [];

  for (const [index, provider] of providers.entries()) {
    let emitted = false;
    try {
      await requestProviderCompletionStream(provider.settings, {
        messages,
        images,
        maxTokens,
        temperature,
        onDelta: (text) => {
          emitted = true;
          onDelta(text);
        },
        signal,
      });
      return { providerRole: provider.role };
    } catch (error) {
      failures.push({ provider, error });
      if (emitted) throw error; // 已有部分输出：终止而非拼接
      if (!VIDEO_PROVIDER_ROUTER.shouldFailOver(error)) throw error;
      if (index >= providers.length - 1) break;
      console.warn(
        `[Video Assistant] ${provider.label} 暂时不可用，尝试下一项 AI 服务：${error.message}`,
      );
    }
  }

  const error = new Error(failures.length
    ? `所有 AI 服务均失败。${failures
      .map(({ provider, error: failure }) => `${provider.label}：${failure.message || "暂不可用"}`)
      .join("；")}`
    : "没有可用的 AI 服务。");
  error.code = "AI_ALL_PROVIDERS_FAILED";
  throw error;
}

/** 把模型服务的错误翻译成用户能看懂、且知道下一步该干什么的提示。 */
function aiErrorResponse(error) {
  // 这几类都要用户去设置页动手，原样透出提示即可。
  const actionable = [
    "NO_AI_CONFIG",
    "NEED_HOST_PERMISSION",
    "INVALID_BASE_URL",
    "AI_NETWORK_ERROR",
  ];
  if (actionable.includes(error.code)) {
    return { success: false, error: error.code, message: error.message };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      success: false,
      error: "INVALID_AI_KEY",
      message: "服务拒绝了这个密钥，请在设置里检查密钥和地址是否匹配。",
    };
  }
  if (error.status === 404) {
    return {
      success: false,
      error: "MODEL_OR_ENDPOINT_NOT_FOUND",
      message: "服务返回 404，多半是模型名写错或 API 地址不对，请到设置页核对。",
    };
  }
  if (error.status === 429) {
    return {
      success: false,
      error: "RATE_LIMITED",
      message: "服务限流了，稍等一会儿再试。",
    };
  }
  return {
    success: false,
    error: error.code || "AI_REQUEST_FAILED",
    message: error.message || "AI 请求失败。",
  };
}

// ============================================================
// AI 概览
// ============================================================

/** 同视频字幕的「在途去重」：连点几张截图手记会并发触发多次补齐，
 * 没有这张表就是 N 个并行外部 API 请求（provider 限流、配额白烧）。
 * 注意 key 含 site/videoId/page，tabId 不进 key：同一个视频换 tab 打开
 * 也该共享同一次拉取。 */
const transcriptInFlight = BILI_CONCURRENCY.createDedupMap();

/** 概览和笔记都需要字幕，统一从缓存拿，没有再走网络。 */
async function ensureTranscript(resource, { tabId } = {}) {
  const cached = await BILI_CACHE.load(resource.cacheId, { page: resource.page });
  if (cached?.transcript?.length) return { ...cached, success: true };
  return transcriptInFlight(`${resource.site}:${resource.videoId}:${resource.page}`, () =>
    handleFetchTranscript(resource.videoId, {
      site: resource.site,
      page: resource.page,
      tabId,
    }),
  );
}

// 缓存的「读—改—写」必须串行：并发批次会各自读到旧快照，后写的覆盖先写的，
// 表现为「有些段落莫名其妙没保存下来」，既不报错也难复现。
const cacheWriteQueue = BILI_CONCURRENCY.createSerialQueue();

function updateCache(bvid, page, mutate) {
  return cacheWriteQueue(async () => {
    const current = (await BILI_CACHE.load(bvid, { page })) || {};
    const next = mutate(current);
    // 只是更新已有条目，跳过淘汰——淘汰要读全量存储，一次任务几十批经不起这么读。
    await BILI_CACHE.save(bvid, next, { page, evict: false });
    return next;
  });
}

// success / fromCache 是每次响应现算的，跟着 spread 写进缓存的话，
// 下次命中时旧标志会盖掉新标志，落库前必须剥掉。
function persistable(transcript) {
  const { success, fromCache, ...rest } = transcript;
  return rest;
}

// 侧边栏可能没开着，广播失败是正常的。
// tabId 定向：进度只发给发起任务的标签页面板，别的标签页的面板不显示动画。
function reportProgress(kind, done, total, tabId) {
  const message = { action: "aiProgress", kind, done, total };
  if (tabId != null) message.tabId = tabId;
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function handleAnalyzeTranscript(
  videoIdInput,
  { site = "bilibili", page = 1, forceRefresh = false, customPrompt = "", tabId } = {},
) {
  const resource = resolveVideo(site, videoIdInput, page);
  if (!resource) {
    return { success: false, error: "INVALID_VIDEO_ID", message: "没有识别到视频 ID。" };
  }

  const cached = await BILI_CACHE.load(resource.cacheId, { page: resource.page });
  const settings = await getSettings();
  const analysisLanguage = settings.uiLanguage === "en" ? "en" : "zh-CN";
  const analysisPrompt = (
    String(customPrompt || "").trim() ||
    BILI_SETTINGS.DEFAULT_OVERVIEW_PROMPTS[analysisLanguage]
  ).slice(0, 5000);
  const cachedLanguage = cached?.analysisLanguage || "zh-CN";
  const cachedPrompt =
    cached?.analysisPrompt || BILI_SETTINGS.DEFAULT_OVERVIEW_PROMPTS[cachedLanguage];
  if (
    !forceRefresh &&
    cached?.analysis &&
    cachedLanguage === analysisLanguage &&
    cachedPrompt === analysisPrompt
  ) {
    return {
      success: true,
      fromCache: true,
      analysis: cached.analysis,
      analysisLanguage,
      analysisPrompt,
    };
  }

  const transcript = cached?.transcript?.length
    ? { ...cached, success: true }
    : await ensureTranscript(resource);
  if (!transcript.success) return transcript;

  try {
    const chunks = BILI_AI.planAnalysisChunks(transcript.segments);
    if (!chunks.length) {
      return { success: false, error: "NO_TRANSCRIPT", message: "没有可用的字幕。" };
    }

    const common = {
      videoTitle: transcript.videoInfo?.title || "未知",
      ownerName: transcript.videoInfo?.owner || "未知",
      videoDescription: transcript.videoInfo?.description || "（无简介）",
      outputLanguage: analysisLanguage === "en" ? "English" : "简体中文",
      customInstructions: analysisPrompt,
    };
    const totalDuration = Math.max(
      Math.floor(Number(transcript.videoInfo?.duration) || 0),
      chunks[chunks.length - 1].endSeconds,
    );

    debugLog(`[Bilibili Digest] 概览分 ${chunks.length} 块，并发 ${settings.aiConcurrency}`);
    reportProgress("analysis", 0, chunks.length, tabId);

    const analyzeOne = (chunk) => analyzeChunk(chunk, chunks.length, common);
    const results = await BILI_CONCURRENCY.mapWithConcurrency(
      chunks,
      settings.aiConcurrency,
      analyzeOne,
      (done, total) => reportProgress("analysis", done, total, tabId),
    );

    // 部分块失败多半是偶发超时或限流，静默补一轮；全军覆没通常是配置错误，不补。
    const failedIndexes = results
      .map((result, index) => (result.status === "rejected" ? index : -1))
      .filter((index) => index >= 0);
    if (failedIndexes.length && failedIndexes.length < chunks.length) {
      debugLog(`[Bilibili Digest] ${failedIndexes.length} 块失败，自动补一轮`);
      const retried = await BILI_CONCURRENCY.mapWithConcurrency(
        failedIndexes.map((index) => chunks[index]),
        settings.aiConcurrency,
        analyzeOne,
      );
      failedIndexes.forEach((chunkIndex, i) => {
        if (retried[i].status === "fulfilled") results[chunkIndex] = retried[i];
      });
    }

    const parts = results
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    const failures = results.filter((result) => result.status === "rejected");

    if (!parts.length) {
      // 全军覆没时把第一个真实错误透出去，它比「生成失败」有用得多。
      throw failures[0]?.reason || new Error("概览生成失败。");
    }

    const analysis = BILI_AI.mergeAnalyses(parts, totalDuration);
    if (!analysis.chapters.length && !analysis.keyQuotes.length) {
      return {
        success: false,
        error: "EMPTY_ANALYSIS",
        message: "模型没有产出有效的章节或金句，请重试。",
      };
    }

    // 概览与字幕存在同一条缓存里，下次打开直接命中。
    await updateCache(resource.cacheId, resource.page, (current) => ({
      ...current,
      ...persistable(transcript),
      analysis,
      analysisLanguage,
      analysisPrompt,
    }));

    return {
      success: true,
      fromCache: false,
      analysis,
      analysisLanguage,
      analysisPrompt,
      chunkCount: chunks.length,
      // 部分块失败仍然出结果，但要如实告诉用户这份概览是不完整的。
      failedChunks: failures.length,
    };
  } catch (error) {
    console.error("[Bilibili Digest] 概览生成失败：", error);
    return aiErrorResponse(error);
  }
}

async function handleGenerateVideoNote(
  videoIdInput,
  { site = "bilibili", page = 1, tabId, noteStyle = "minimal", customPrompt = "" } = {},
) {
  const resource = resolveVideo(site, videoIdInput, page);
  if (!resource) {
    return { success: false, error: "INVALID_VIDEO_ID", message: "没有识别到视频 ID。" };
  }

  const transcript = await ensureTranscript(resource, { tabId });
  if (!transcript.success) return transcript;

  try {
    const settings = await getSettings();
    const noteLanguage = settings.uiLanguage === "en" ? "en" : "zh-CN";
    const normalizedNoteStyle = BILI_SETTINGS.normalizeNoteStyle(noteStyle);
    const notePrompt = (
      String(customPrompt || "").trim() ||
      BILI_SETTINGS.DEFAULT_NOTE_PROMPTS[noteLanguage]
    ).slice(0, 5000);
    const hasVisionProvider = BILI_SETTINGS.activeProviders(settings)
      .some((provider) => provider.settings?.supportsVision === true);
    const transcriptContext = BILI_AI.buildChatTranscriptContext(
      transcript.segments,
      notePrompt,
      { maxChars: 32_000 },
    );
    if (!transcriptContext || transcriptContext === "（无可用字幕）") {
      return { success: false, error: "NO_TRANSCRIPT", message: "没有可用的字幕。" };
    }

    const visualMemoReferences = hasVisionProvider
      ? await prepareVisualMemoReferences(await readNotes(), resource)
      : [];
    const citationCandidates = visualMemoReferences.map((reference, index) => ({
      ...reference,
      citationId: `cite_${String(index + 1).padStart(2, "0")}`,
      transcriptWindow: visualTranscriptWindow(
        transcript.segments,
        reference.timestampSeconds,
      ),
    }));
    const visionTranscriptContext = citationCandidates.length
      ? BILI_AI.buildChatTranscriptContext(transcript.segments, notePrompt, {
          maxChars: 32_000,
          pinnedTimestamps: citationCandidates.map((reference) => reference.timestampSeconds),
          pinnedWindowSeconds: 15,
        })
      : transcriptContext;
    const variables = {
      videoTitle: transcript.videoInfo?.title || resource.videoId,
      ownerName: transcript.videoInfo?.owner || "未知",
      videoDescription: transcript.videoInfo?.description || "（无简介）",
      outputLanguage: noteLanguage === "en" ? "English" : "简体中文",
      noteTitleLabel: noteLanguage === "en" ? "Note Title" : "笔记标题",
      customInstructions: notePrompt,
      transcriptContext,
    };
    const [systemPrompt, visionSystemPrompt, userPrompt, visionUserPrompt] = await Promise.all([
      loadPromptSection("note-generation.md", "系统提示词", variables),
      loadPromptSection("note-generation.md", "视觉增强系统提示词", variables),
      loadPromptSection("note-generation.md", "用户提示词", variables),
      loadPromptSection("note-generation.md", "用户提示词", {
        ...variables,
        transcriptContext: visionTranscriptContext,
      }),
    ]);
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    const visualReferences = citationCandidates.map((reference) => ({
      noteId: reference.noteId,
      dataUrl: reference.dataUrl,
      memoText: reference.memoText,
      transcriptWindow: reference.transcriptWindow,
      label: noteLanguage === "en"
        ? `[Memo screenshot #${reference.citationId} | ${BILI_TRANSCRIPT.formatTimestamp(reference.timestampSeconds)}]`
        : `[手记截图 #${reference.citationId}｜${BILI_TRANSCRIPT.formatTimestamp(reference.timestampSeconds)}]`,
    }));
    const completion = await requestAiCompletion({
      messages,
      visionMessages: [
        { role: "system", content: `${systemPrompt}\n\n${visionSystemPrompt}` },
        { role: "user", content: visionUserPrompt },
      ],
      visualReferences,
      maxTokens: BILI_AI.estimateOutputTokens(transcriptContext.length, {
        ratio: 0.18,
        floor: 1800,
        ceiling: 6000,
      }),
      temperature: 0.2,
    });
    const generatedText = String(completion.text || "")
      .trim()
      .replace(/^```(?:markdown|md)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim()
      .slice(0, 12_000);
    if (!generatedText) {
      return { success: false, error: "EMPTY_AI_NOTE", message: "模型没有生成笔记内容，请重试。" };
    }

    const now = Date.now();
    const allowedCitationIds = citationCandidates.map((reference) => reference.citationId);
    // 只有实际走视觉请求时才允许模型留下截图引用标记。纯文本模型偶尔也会
    // 模仿提示词输出占位符，必须在入库前剔除，避免侧栏展示原始标记。
    const sanitizedText = BILI_VISUAL_MEMOS.sanitizeCitationMarkers(
      generatedText,
      completion.usedVisualReferences ? allowedCitationIds : [],
    );
    const text = BILI_VISUAL_MEMOS.relocateCitationMarkers(
      sanitizedText,
      completion.usedVisualReferences ? citationCandidates : [],
    );
    const usedCitationIds = BILI_VISUAL_MEMOS.parseCitationIds(text);
    const savedVisualReferences = usedCitationIds.map((citationId) => {
      const reference = citationCandidates.find((item) => item.citationId === citationId);
      return {
        citationId,
        sourceNoteId: reference?.noteId || null,
        timestampSeconds: Math.max(0, Number(reference?.timestampSeconds) || 0),
      };
    });
    const note = {
      id: `note_${now}_${Math.random().toString(36).slice(2, 8)}`,
      kind: "ai_video_note",
      site: resource.site,
      bvid: resource.videoId,
      videoId: resource.videoId,
      page: resource.page,
      videoTitle: String(transcript.videoInfo?.title || resource.videoId).slice(0, 500),
      ownerName: String(transcript.videoInfo?.owner || "").slice(0, 300),
      timestamp: BILI_TRANSCRIPT.formatTimestamp(0),
      timestampSeconds: 0,
      timestampedUrl: canonicalVideoUrl(resource, 0),
      text,
      notePrompt,
      noteStyle: normalizedNoteStyle,
      ...(savedVisualReferences.length
        ? {
            visualMemoReferenceCount: savedVisualReferences.length,
            visualMemoReferences: savedVisualReferences,
          }
        : {}),
      createdAt: now,
      pending: false,
    };
    const mutation = await mutateNotes((notes) => {
      notes.unshift(note);
      return notes;
    }, { protectedNoteId: note.id });
    chrome.runtime.sendMessage({ action: "noteSaved", note }).catch(() => {});
    return { success: true, note, removedCount: mutation.removed.length };
  } catch (error) {
    console.error("[Video Assistant] AI 笔记生成失败：", error);
    return aiErrorResponse(error);
  }
}

/** 为一张手记截图取出同一时间点附近的带时间戳字幕，作为图片的强定位上下文。 */
function visualTranscriptWindow(segments, timestampSeconds, windowSeconds = 15) {
  const list = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: Math.max(0, Number(segment?.start) || 0),
      text: String(segment?.text || "").trim(),
    }))
    .filter((segment) => segment.text);
  if (!list.length) return "";
  const target = Math.max(0, Number(timestampSeconds) || 0);
  const window = Math.max(1, Number(windowSeconds) || 15);
  let selected = list.filter((segment) => Math.abs(segment.start - target) <= window);
  if (!selected.length) {
    selected = [...list]
      .sort((left, right) => Math.abs(left.start - target) - Math.abs(right.start - target))
      .slice(0, 3)
      .sort((left, right) => left.start - right.start);
  }
  return selected
    .map((segment) => `[${BILI_TRANSCRIPT.formatTimestamp(segment.start)}] ${segment.text}`)
    .join("\n")
    .slice(0, 3_000);
}

async function analyzeStoredMemoImage(dataUrl) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(96, 54);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 96, 54);
    bitmap.close?.();
    return BILI_VISUAL_MEMOS.analyzeImagePixels(
      context.getImageData(0, 0, 96, 54).data,
      96,
      54,
    );
  } catch (error) {
    debugLog("[Video Assistant] 旧手记截图分析失败：", error);
    return null;
  }
}

/** 旧版本保存的截图没有 imageMeta；生成时最多补算 12 张，避免升级后旧手记失效。 */
async function prepareVisualMemoReferences(notes, resource) {
  const list = Array.isArray(notes) ? notes : [];
  const unanalyzed = list.filter((note) =>
    note?.kind === "memo" && note.site === resource.site &&
    String(note.bvid || note.videoId) === String(resource.videoId) &&
    Number(note.page || 1) === Number(resource.page || 1) &&
    typeof note.imageDataUrl === "string" && !note.imageMeta).slice(0, 12);
  await Promise.all(unanalyzed.map(async (note) => {
    const meta = await analyzeStoredMemoImage(note.imageDataUrl);
    if (meta) note.imageMeta = meta;
  }));
  return BILI_VISUAL_MEMOS.selectReferences(list, resource);
}

// 时长相关变量按本块区间算，好让模型只覆盖这一段。
async function analyzeChunk(chunk, chunkCount, common) {
  const timing = BILI_AI.analysisTimingVariables(chunk.text, chunk.endSeconds);
  const rangeNote =
    chunkCount > 1
      ? `注意：这是长视频切分后的第 ${chunk.index + 1} / ${chunkCount} 段，` +
        `覆盖 ${BILI_TRANSCRIPT.formatTimestamp(chunk.startSeconds)} 到 ` +
        `${BILI_TRANSCRIPT.formatTimestamp(chunk.endSeconds)}。` +
        `只为这一段产出章节与金句，不要涉及其它时间段。`
      : "";

  // 前情只喂给模型当上下文，产出仍限定在本块区间内，靠 minTimestampSeconds 兜底。
  const contextNote = chunk.contextText
    ? `\n前情回顾（上一段的结尾，只用来理解本段承接什么，不要为它开章节或挑金句）：\n${chunk.contextText}\n`
    : "";

  const variables = {
    ...common,
    ...timing,
    rangeNote,
    contextNote,
    startFormatted: BILI_TRANSCRIPT.formatTimestamp(chunk.startSeconds),
    minTimestampSeconds: chunk.startSeconds,
    transcriptText: chunk.text,
  };
  const [systemPrompt, userPrompt] = await Promise.all([
    loadPromptSection("analysis.md", "系统提示词", variables),
    loadPromptSection("analysis.md", "用户提示词", variables),
  ]);

  const { text } = await requestAiCompletion({
    // 概览是摘要，产出远小于原文；分块之后每块更小。
    // 按正文长度估算即可，前情只进输入不进输出。
    maxTokens: BILI_AI.estimateOutputTokens(chunk.text.length, {
      ratio: 0.5,
      floor: 2048,
    }),
    responseFormat: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return BILI_AI.validateAnalysis(
    BILI_AI.parseLooseJson(text),
    timing.maxTimestampSeconds,
    chunk.startSeconds,
  );
}

// ============================================================
// 逐条改写字幕：顺句（补标点 + 改同音错别字）与翻译（外文 → 中文）
// ============================================================

// 侧边栏按批发过来，这里再兜一道上限，避免异常大的请求。
const REWRITE_MAX_SEGMENTS_PER_CALL = 12;

/**
 * 顺句和翻译走同一条流水线：挑分段 → 查缓存 → 送模型 → 按 id 对回原位 → 写缓存。
 * 真正不同的只有下面这几项；prepare 按本次字幕算出提示词变量和对齐守卫。
 */
const REWRITE_TASKS = Object.freeze({
  polish: {
    label: "顺句",
    cacheKey: "polished",
    promptFile: "punctuate.md",
    // 原地补标点，输出量跟着输入走，再加上 JSON 结构和 id 的开销。
    tokenRatio: 1.5,
    async prepare() {
      return {
        variables: {},
        align: (parsed, todo) => {
          const { polished, rejected } = BILI_AI.alignPolishedSegments(parsed, todo);
          return { accepted: polished, rejected };
        },
      };
    },
  },
  translate: {
    label: "翻译",
    cacheKey: "translated",
    promptFile: "translation.md",
    // 中英互译字符数会变，按字符估 token 时统一放宽。
    tokenRatio: 2,
    async prepare(transcript) {
      // 方向由字幕轨语种决定：中文字幕译成英文，外文字幕译成中文。
      const toEnglish = BILI_TRANSCRIPT.isChineseSubtitle(transcript.language);
      const targetLang = toEnglish ? "en" : "zh";
      return {
        variables: {
          targetLangName: toEnglish ? "英文" : "简体中文",
          langRules: await loadPromptSection(
            "translation.md",
            toEnglish ? "英文规则" : "中文规则",
          ),
        },
        align: (parsed, todo) => {
          const { translated, rejected } = BILI_AI.alignTranslatedSegments(
            parsed,
            todo,
            { targetLang },
          );
          return { accepted: translated, rejected };
        },
      };
    },
  },
});

async function handleSegmentRewrite(
  kind,
  videoIdInput,
  { site = "bilibili", page = 1, segmentIds = [] } = {},
) {
  const task = REWRITE_TASKS[kind];
  const resource = resolveVideo(site, videoIdInput, page);
  if (!resource) {
    return { success: false, error: "INVALID_VIDEO_ID", message: "没有识别到视频 ID。" };
  }

  const cached = await BILI_CACHE.load(resource.cacheId, { page: resource.page });
  const transcript = cached?.segments?.length
    ? { ...cached, success: true }
    : await ensureTranscript(resource);
  if (!transcript.success) return transcript;

  const requested = new Set((segmentIds || []).map(String));
  const segments = (transcript.segments || [])
    .filter((segment) => requested.has(segment.id))
    .slice(0, REWRITE_MAX_SEGMENTS_PER_CALL);
  if (!segments.length) {
    return { success: false, error: "NO_SEGMENTS", message: "没有需要处理的分段。" };
  }

  const done = cached?.[task.cacheKey] || {};
  const todo = segments.filter((segment) => !done[segment.id]);
  if (!todo.length) {
    const hit = {};
    for (const segment of segments) hit[segment.id] = done[segment.id];
    return { success: true, fromCache: true, [task.cacheKey]: hit };
  }

  try {
    const { variables: extraVariables, align } = await task.prepare(transcript);
    const payload = {
      segments: todo.map((segment) => ({ id: segment.id, text: segment.text })),
    };
    const variables = {
      ...extraVariables,
      videoTitle: transcript.videoInfo?.title || "未知",
      segmentsJson: JSON.stringify(payload),
    };
    const [systemPrompt, userPrompt] = await Promise.all([
      loadPromptSection(task.promptFile, "系统提示词", variables),
      loadPromptSection(task.promptFile, "用户提示词", variables),
    ]);

    const { text } = await requestAiCompletion({
      maxTokens: BILI_AI.estimateOutputTokens(variables.segmentsJson.length, {
        ratio: task.tokenRatio,
        floor: 2048,
      }),
      // 两者都是照着原文做的，不是创作，温度越低越贴近原意。
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const { accepted, rejected } = align(BILI_AI.parseLooseJson(text), todo);
    if (rejected.length) {
      debugLog(`[Bilibili Digest] ${task.label}丢弃的条目：`, rejected);
    }

    // 这些批次是并发跑的，读—改—写要走串行队列，否则会互相覆盖。
    const saved = await updateCache(resource.cacheId, resource.page, (current) => ({
      ...current,
      ...persistable(transcript),
      [task.cacheKey]: { ...(current[task.cacheKey] || {}), ...accepted },
    }));

    // 命中缓存的那部分也一并回给侧边栏，它只认返回值。
    const response = { ...accepted };
    for (const segment of segments) {
      if (!response[segment.id] && saved[task.cacheKey][segment.id]) {
        response[segment.id] = saved[task.cacheKey][segment.id];
      }
    }
    return { success: true, fromCache: false, [task.cacheKey]: response, rejected };
  } catch (error) {
    console.error(`[Bilibili Digest] ${task.label}失败：`, error);
    return aiErrorResponse(error);
  }
}

const handlePolishSegments = (bvid, options) =>
  handleSegmentRewrite("polish", bvid, options);
const handleTranslateSegments = (bvid, options) =>
  handleSegmentRewrite("translate", bvid, options);

// ============================================================
// 多轮视频问答
// ============================================================

function analysisAsChatContext(analysis) {
  if (!analysis) return "（尚未生成概览）";
  const chapters = (analysis.chapters || []).map(
    (chapter) =>
      `[${chapter.timestamp}] ${chapter.title}${chapter.summary ? `：${chapter.summary}` : ""}`,
  );
  const quotes = (analysis.keyQuotes || []).map(
    (quote) => `[${quote.timestamp}] 金句：${quote.quote}`,
  );
  return [...chapters, ...quotes].join("\n").slice(0, 8_000) || "（概览为空）";
}

function normalizeChatContextSelection(selection) {
  // 兼容已有侧边栏：它们尚未发送该字段时，沿用原来的「全关联」行为。
  if (!selection || typeof selection !== "object") {
    return { transcript: true, overview: true, notes: true, memos: true };
  }
  return {
    transcript: selection.transcript === true,
    overview: selection.overview === true,
    notes: selection.notes === true,
    memos: selection.memos === true,
  };
}

function notesAsChatContext(notes, resource) {
  if (!resource) return "（当前没有关联视频，未附加笔记）";
  const matching = notes.filter(
    (note) =>
      (note.site || "bilibili") === resource.site &&
      note.bvid === resource.videoId &&
      note.kind === "ai_video_note" &&
      typeof note.text === "string" &&
      note.text.trim(),
  );
  const content = matching
    .slice(0, 20)
    .map((note) => {
      const timestamp = note.timestamp ? `[${note.timestamp}] ` : "";
      return `${timestamp}${note.text.trim().slice(0, 1_500)}`;
    })
    .join("\n\n")
    .slice(0, 8_000);
  return content || "（当前视频还没有生成 AI 笔记）";
}

function memosAsChatContext(notes, resource) {
  if (!resource) return { text: "（当前没有关联视频，未附加手记）", images: [] };
  const matching = notes.filter(
    (note) =>
      (note.site || "bilibili") === resource.site &&
      note.bvid === resource.videoId &&
      note.kind === "memo",
  );
  const text = matching
    .slice(0, 30)
    .map((memo) => {
      const timestamp = memo.timestamp ? `[${memo.timestamp}] ` : "";
      const body = typeof memo.text === "string" && memo.text.trim()
        ? memo.text.trim().slice(0, 1_500)
        : "（仅包含图片）";
      return `${timestamp}${body}`;
    })
    .join("\n\n")
    .slice(0, 10_000) || "（当前视频没有手记）";

  // 单张手记图已在保存时限制为 512 KB；问答再加总量保护，避免请求体膨胀。
  const images = [];
  let totalLength = 0;
  for (const memo of matching) {
    const image = typeof memo.imageDataUrl === "string" ? memo.imageDataUrl : "";
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(image)) continue;
    if (images.length >= 6 || totalLength + image.length > 2_000_000) break;
    images.push(image);
    totalLength += image.length;
  }
  return { text, images };
}

/**
 * 组装「问 AI」的提示词上下文：字幕缓存、视频信息、AI 笔记、手记和概览全部收在这里。
 * 非流式 handleAskVideo 与流式 handleAskVideoStream 共用，保证两种通道的行为一致。
 */
async function assembleAskContext({
  bvid: videoIdInput,
  site,
  page = 1,
  tabId,
  videoInfo: providedVideoInfo,
  question,
  history = [],
  contextSelection,
}) {
  const resource = resolveVideo(site, videoIdInput, page);
  const selectedContext = normalizeChatContextSelection(contextSelection);
  const useVideoContext = Object.values(selectedContext).some(Boolean);
  const userQuestion = String(question || "").trim().slice(0, 2_000);
  if (!userQuestion) {
    return { resource, userQuestion, error: { success: false, error: "EMPTY_QUESTION", message: "请先输入问题。" } };
  }
  if (!resource) {
    return {
      resource,
      userQuestion,
      error: {
        success: false,
        error: "NO_VIDEO_CONTEXT",
        message: "请先打开一个支持的视频，再使用问 AI。",
      },
    };
  }
  // 回答语言跟随界面语言（与概览/笔记一致），不跟随提问语言：
  // 用户把界面切成英文后，中文提问也应得到英文回答。
  const askLanguage = (await getSettings()).uiLanguage === "en" ? "en" : "zh-CN";

  // 问答不依赖字幕管线。能取到字幕就把它作为额外上下文；取不到或视频没有
  // 字幕时，仍可结合当前视频的元数据、AI 笔记与手记回答，但不扩展为通用问答。
  let transcript = null;
  let videoInfo =
    providedVideoInfo && typeof providedVideoInfo === "object"
      ? providedVideoInfo
      : {};
  if (resource && (selectedContext.transcript || selectedContext.overview)) {
    try {
      // 只读已经取得的缓存，不为一次聊天重新阻塞式拉字幕。
      const cached = await BILI_CACHE.load(resource.cacheId, { page: resource.page });
      if (cached?.transcript?.length) {
        transcript = cached;
        videoInfo = { ...(cached.videoInfo || {}), ...videoInfo };
      }
    } catch (error) {
      debugLog("[Video Assistant] 问答未读到字幕缓存，将继续普通对话：", error);
    }

    // YouTube 的标题等信息可直接向当前页面读取；失败也不阻断问答。
    if (!videoInfo.title && resource.site === "youtube" && useVideoContext) {
      try {
        videoInfo = await readYouTubePageInfo(tabId);
      } catch (error) {
        debugLog("[Video Assistant] 问答未取得视频基本信息：", error);
      }
    }
  }

  let notesContext = "（用户未选择关联 AI 笔记）";
  let memosContext = "（用户未选择关联手记）";
  let memoImages = [];
  if (selectedContext.notes || selectedContext.memos) {
    try {
      const savedNotes = await readNotes();
      if (selectedContext.notes) notesContext = notesAsChatContext(savedNotes, resource);
      if (selectedContext.memos) {
        const memoContext = memosAsChatContext(savedNotes, resource);
        memosContext = memoContext.text;
        memoImages = memoContext.images;
      }
    } catch (error) {
      debugLog("[Video Assistant] 问答未读到笔记或手记，将跳过：", error);
      if (selectedContext.notes) notesContext = "（没有可用的 AI 笔记）";
      if (selectedContext.memos) memosContext = "（没有可用的手记）";
    }
  }

  const variables = {
    outputLanguage: askLanguage === "en" ? "English" : "简体中文",
    videoTitle: useVideoContext
      ? videoInfo.title || (resource ? resource.videoId : "（未关联视频）")
      : "（未关联视频）",
    ownerName: useVideoContext
      ? videoInfo.owner || videoInfo.channelName || "未知"
      : "（无）",
    videoDescription:
      useVideoContext
        ? String(videoInfo.description || "（无简介）").slice(0, 4_000)
        : "（未关联视频资料）",
    overviewText: selectedContext.overview && transcript
      ? analysisAsChatContext(transcript.analysis)
      : selectedContext.overview
        ? "（当前没有可用的视频概览）"
        : "（用户未选择关联概览）",
    transcriptContext: selectedContext.transcript && transcript?.segments?.length
      ? BILI_AI.buildChatTranscriptContext(transcript.segments, userQuestion)
      : selectedContext.transcript
        ? "（当前没有可用的视频字幕；只能依据当前视频的其它已提供资料回答。）"
        : "（用户未选择关联字幕）",
    notesContext,
    memosContext,
    question: userQuestion,
  };
  const [systemPrompt, userPrompt] = await Promise.all([
    loadPromptSection("ask.md", "系统提示词", variables),
    loadPromptSection("ask.md", "用户提示词", variables),
  ]);
  const safeHistory = BILI_AI.normalizeChatHistory(history);
  return { resource, userQuestion, systemPrompt, userPrompt, safeHistory, memoImages };
}

async function handleAskVideo({
  bvid: videoIdInput,
  site,
  page = 1,
  tabId,
  videoInfo: providedVideoInfo,
  question,
  history = [],
  contextSelection,
}) {
  const assembled = await assembleAskContext({
    bvid: videoIdInput,
    site,
    page,
    tabId,
    videoInfo: providedVideoInfo,
    question,
    history,
    contextSelection,
  });
  if (assembled.error) return assembled.error;

  try {
    const { text, providerRole } = await requestAiCompletion({
      images: assembled.memoImages,
      maxTokens: 2_048,
      temperature: 0.3,
      messages: [
        { role: "system", content: assembled.systemPrompt },
        ...assembled.safeHistory,
        { role: "user", content: assembled.userPrompt },
      ],
    });
    return {
      success: true,
      answer: text.trim().slice(0, 12_000),
      providerRole,
    };
  } catch (error) {
    console.error("[Video Assistant] 视频问答失败：", error);
    return aiErrorResponse(error);
  }
}

/**
 * 流式版「问 AI」：通过 Port 长连接把增量文本逐块推给侧边栏。
 * 通道语义：delta（正文增量）→ done（完成）→ error（失败，emitted 表示是否已有部分输出）。
 * 侧边栏断开（换视频 / 清空对话 / 关闭面板）时由 onConnect 的 onDisconnect 触发 abort。
 */
async function handleAskVideoStream(port, message, signal) {
  const safePost = (payload) => {
    try {
      port.postMessage(payload);
    } catch {
      // 对端已断开，忽略。
    }
  };

  const assembled = await assembleAskContext(message);
  if (assembled.error) {
    safePost({ type: "error", error: assembled.error.error, message: assembled.error.message, emitted: false });
    return;
  }

  let emitted = false;
  try {
    await streamAiCompletion({
      images: assembled.memoImages,
      maxTokens: 2_048,
      temperature: 0.3,
      messages: [
        { role: "system", content: assembled.systemPrompt },
        ...assembled.safeHistory,
        { role: "user", content: assembled.userPrompt },
      ],
      onDelta: (text) => {
        emitted = true;
        safePost({ type: "delta", text });
      },
      signal,
    });
    safePost({ type: "done" });
  } catch (error) {
    const response = aiErrorResponse(error);
    safePost({ type: "error", error: response.error, message: response.message, emitted });
  }
}

// ============================================================
// 划词解释
// ============================================================

async function handleExplainSelection(selectedText, transcriptContext, videoTitle) {
  const text = String(selectedText || "").trim();
  if (!text) {
    return { success: false, error: "EMPTY_SELECTION", message: "没有选中任何文字。" };
  }

  try {
    // 解释语言跟随界面语言，与问答/概览/笔记一致。
    const explainLanguage = (await getSettings()).uiLanguage === "en" ? "en" : "zh-CN";
    const variables = {
      videoTitle: videoTitle || "未知",
      selectedText: text.slice(0, 1000),
      transcriptContext: String(transcriptContext || "").slice(0, 4000) || "无",
      outputLanguage: explainLanguage === "en" ? "English" : "简体中文",
    };
    const [systemPrompt, userPrompt] = await Promise.all([
      loadPromptSection("explain.md", "系统提示词", variables),
      loadPromptSection("explain.md", "用户提示词", variables),
    ]);

    const { text: explanation } = await requestAiCompletion({
      maxTokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return { success: true, explanation: explanation.trim() };
  } catch (error) {
    console.error("[Bilibili Digest] 划词解释失败：", error);
    return aiErrorResponse(error);
  }
}

// ============================================================
// 笔记
// ============================================================

// 笔记的「读—改—写」也要串行：润色是保存后异步落笔的，会和新增 / 删除并发。
const notesWriteQueue = BILI_CONCURRENCY.createSerialQueue();

async function readNotes() {
  if (!BILI_NOTE_DB?.supported?.()) throw new Error("当前环境不支持 IndexedDB 笔记存储");
  return BILI_NOTE_DB.listNotes({ includeAssetData: true });
}

function pageNotes(notes, { offset, limit } = {}) {
  const totalCount = notes.length;
  // 未传分页参数的旧调用方仍按原行为取得全部数据。
  if (!Number.isFinite(Number(limit))) {
    return { notes, totalCount, hasMore: false };
  }
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 100)));
  const page = notes.slice(start, start + size);
  return { notes: page, totalCount, hasMore: start + page.length < totalCount };
}

function mutateNotes(mutate, { protectedNoteId } = {}) {
  return notesWriteQueue(async () => {
    const notes = await readNotes();
    const before = new Map(notes.map((note) => [note.id, JSON.stringify(note)]));
    const next = mutate(notes);
    const settings = await getSettings();
    const capped = next.slice(0, settings.noteLimit);
    const removed = next.slice(settings.noteLimit);
    const nextIds = new Set(capped.map((note) => note.id));
    const deletedIds = notes.filter((note) => !nextIds.has(note.id)).map((note) => note.id);
    const changed = capped.filter(
      (note) => !before.has(note.id) || before.get(note.id) !== JSON.stringify(note),
    );
    await BILI_NOTE_DB.applyChanges(changed, deletedIds);
    return { notes: capped, removed, storageBlocked: false };
  });
}

async function enforceStoredNoteLimits() {
  const result = await mutateNotes((notes) => notes);
  return {
    success: true,
    removedCount: result.removed.length,
    storageBlocked: result.storageBlocked,
  };
}

async function handleGetNoteStats() {
  const [notes, settings, totalBytes, v2Stats] = await Promise.all([
    readNotes(),
    getSettings(),
    chrome.storage.local.getBytesInUse(null),
    BILI_NOTE_DB.stats(),
  ]);
  return {
    success: true,
    totalCount: notes.length,
    noteLimit: settings.noteLimit,
    storageVersion: 2,
    notesBytes: v2Stats.assetBytes,
    assetBytes: v2Stats.assetBytes,
    assetCount: v2Stats.assetCount,
    relationCount: v2Stats.linkCount,
    totalBytes,
    safeBytes: BILI_NOTE_DB.DEFAULT_ASSET_BUDGET_BYTES,
  };
}

async function handleExportNotesV2(noteIds) {
  if (!BILI_NOTE_DB?.supported?.()) {
    return { success: false, error: "V2_UNAVAILABLE", message: "当前环境不支持 V2 笔记导出。" };
  }
  return { success: true, bundle: await BILI_NOTE_DB.exportBundle(noteIds) };
}

// 请模型把口语字幕整理成通顺的笔记。失败返回 null，笔记保持原始字幕。
async function polishNoteText(context, videoTitle) {
  try {
    // 输出语言跟随界面语言设置；中文 ASR 修正规则按字幕原文判断，不随界面语言关闭。
    const polishLanguage = (await getSettings()).uiLanguage === "en" ? "en" : "zh-CN";
    const variables = {
      videoTitle: videoTitle || "未知",
      fullContext: context.fullContext,
      beforeText: context.beforeText || "（无）",
      targetText: context.targetText,
      afterText: context.afterText || "（无）",
      outputLanguage: polishLanguage === "en" ? "English" : "简体中文",
    };
    const [systemPrompt, userPrompt] = await Promise.all([
      loadPromptSection("note-cleanup.md", "系统提示词", variables),
      loadPromptSection("note-cleanup.md", "用户提示词", variables),
    ]);

    const { text } = await requestAiCompletion({
      maxTokens: 512,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const parsed = BILI_AI.parseLooseJson(text);
    if (typeof parsed?.quote === "string" && parsed.quote.trim()) {
      return parsed.quote.trim().slice(0, 3000);
    }
    return null;
  } catch (error) {
    // 润色失败不该让笔记丢掉，原始文本已经在库里了。
    console.warn("[Bilibili Digest] 笔记润色失败，保留原始字幕：", error.message);
    return null;
  }
}

// 后台润色完成后把正文换掉。笔记可能已被删除，map 不命中就什么都不做。
async function polishNoteWhenReady(noteId, context, videoTitle) {
  const polished = await polishNoteText(context, videoTitle);
  const mutation = await mutateNotes(
    (notes) =>
      notes.map((note) =>
        note.id === noteId && note.pending
          ? { ...note, text: polished || note.text, pending: false }
          : note,
      ),
    { protectedNoteId: noteId },
  );
  chrome.runtime.sendMessage({ action: "noteUpdated", noteId }).catch(() => {});
}

async function handleSaveNote({
  bvid: videoIdInput,
  videoId: legacyVideoId,
  site = "bilibili",
  page = 1,
  timestamp,
  text: manualText,
  kind: noteKind,
}) {
  const resource = resolveVideo(site, videoIdInput || legacyVideoId, page);
  if (!resource) {
    return { success: false, error: "INVALID_VIDEO_ID", message: "没有识别到视频 ID。" };
  }
  const seconds = Math.max(0, Math.floor(Number(timestamp) || 0));

  const transcript = await ensureTranscript(resource);
  if (!transcript.success) return transcript;

  const videoTitle = transcript.videoInfo?.title || "";
  // 字幕或概览里的「存为笔记」已经有整理好的文字，不必再过一次模型。
  let noteText = String(manualText || "").trim();
  let rawText = noteText;
  let polishContext = null;

  if (!noteText) {
    const context = BILI_AI.noteContextAt(transcript.transcript, seconds);
    if (!context) {
      return { success: false, error: "NO_TRANSCRIPT", message: "没有可用的字幕。" };
    }
    rawText = context.targetText;
    // 先用原始字幕落库，保存立即完成；润色在后台跑完再替换正文。
    noteText = [context.beforeText, context.targetText, context.afterText]
      .filter(Boolean)
      .join(" ");
    // 本地推理服务往往不需要密钥，所以用完整校验而不是只看密钥有没有填。
    const settings = await getSettings();
    if (BILI_SETTINGS.validateAppSettings(settings).ok) polishContext = context;
  }

  const note = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bvid: resource.videoId,
    site: resource.site,
    videoId: resource.videoId,
    page: resource.page,
    videoTitle: videoTitle.slice(0, 500),
    ownerName: (transcript.videoInfo?.owner || "").slice(0, 300),
    timestamp: BILI_TRANSCRIPT.formatTimestamp(seconds),
    timestampSeconds: seconds,
    timestampedUrl: canonicalVideoUrl(resource, seconds),
    text: noteText,
    rawText,
    kind: noteKind === "ai_chat" ? "ai_chat" : "quote",
    // 界面靠它显示「润色中」；配合 createdAt 识别润色中途挂掉留下的僵尸标记
    pending: Boolean(polishContext),
    createdAt: Date.now(),
  };

  const mutation = await mutateNotes((notes) => {
    notes.unshift(note);
    return notes;
  }, { protectedNoteId: note.id });

  // 侧边栏可能开着笔记页，通知它刷新。
  chrome.runtime.sendMessage({ action: "noteSaved", note }).catch(() => {});

  // 故意不 await：让播放页的按钮立刻得到「已保存」。
  if (polishContext) polishNoteWhenReady(note.id, polishContext, videoTitle);

  return { success: true, note, removedCount: mutation.removed.length };
}

async function handleGetNotes(videoIdInput, site = "bilibili", scope = "video", page) {
  const notes = await readNotes();
  if (scope === "all") {
    return {
      success: true,
      ...pageNotes(notes.map((note) => hydrateAiNoteVisualReferences(note, notes)), page),
    };
  }
  const regularNotes = notes.filter(
    (note) => !["memo", "ai_note", "ai_chat"].includes(note.kind),
  );
  const resource = videoIdInput ? resolveVideo(site, videoIdInput) : null;
  const selectedNotes = resource
    ? regularNotes.filter(
        (note) =>
          (note.site || "bilibili") === resource.site &&
          note.bvid === resource.videoId,
      )
    : regularNotes;
  return {
    success: true,
    ...pageNotes(
      selectedNotes.map((note) => hydrateAiNoteVisualReferences(note, notes)),
      page,
    ),
  };
}

function hydrateAiNoteVisualReferences(note, allNotes) {
  if (note?.kind !== "ai_video_note") return note;
  const resource = resolveVideo(
    note.site || "bilibili",
    note.bvid || note.videoId,
    note.page || 1,
  );
  if (!resource) return note;
  if (Array.isArray(note.visualReferences) && note.visualReferences.length) {
    return {
      ...note,
      visualReferences: note.visualReferences.map((reference) => ({
        ...reference,
        timestamp: reference.timestamp || BILI_TRANSCRIPT.formatTimestamp(reference.timestampSeconds),
        timestampedUrl: reference.timestampedUrl || canonicalVideoUrl(resource, reference.timestampSeconds),
      })),
    };
  }
  const references = BILI_VISUAL_MEMOS.resolveCitations(
    allNotes,
    resource,
    note.visualMemoReferences,
    note.text,
  ).map((reference) => ({
    ...reference,
    timestamp: BILI_TRANSCRIPT.formatTimestamp(reference.timestampSeconds),
    timestampedUrl: canonicalVideoUrl(resource, reference.timestampSeconds),
  }));
  return references.length ? { ...note, visualReferences: references } : note;
}

async function handleSaveMemo({
  text,
  kind,
  site,
  bvid: videoIdInput,
  page = 1,
  videoTitle,
  timestamp,
  imageDataUrl,
  imageMeta,
}) {
  let memoText = String(text || "").trim().slice(0, 10_000);
  // 纯截图无字幕的手记允许保存（正文为空），但纯空手记仍拒绝。
  const hasImage = typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/");
  if (!memoText && !hasImage) {
    return { success: false, error: "EMPTY_MEMO", message: "请先输入手记内容。" };
  }

  // 乐观保存：带截图的手记不再等字幕——先落库（点一下就完成），
  // 字幕上下文由后台补齐（见 enrichMemoInBackground）。字幕冷启动
  // （YouTube 第三方服务商串行尝试）要数秒到数十秒，等它会让按钮
  // 卡在「保存中…」很久；截图已经是完整的信息，没理由让用户等。
  // hasImage 但拿不到 videoId 的手记保持纯截图形态，不补字幕。
  const needsEnrich = !memoText && hasImage && videoIdInput;

  const memo = {
    id: `memo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: kind === "ai_note" ? "ai_note" : "memo",
    text: memoText,
    createdAt: Date.now(),
    // 等待字幕补齐的标志：侧边栏据此显示「字幕补齐中…」pill，
    // enrichMemoInBackground 收尾时清除（无论成败都要清，不能永远转圈）。
    ...(needsEnrich ? { pendingTranscript: true } : {}),
  };
  if (hasImage) {
    // 存储走 chrome.storage.local 的 7MB 安全线，一条 840px JPEG 截图约几十 KB。
    memo.imageDataUrl = imageDataUrl.slice(0, 512_000);
    const safeImageMeta = BILI_VISUAL_MEMOS.sanitizeImageMeta(imageMeta);
    if (safeImageMeta) memo.imageMeta = safeImageMeta;
  }
  const resource = videoIdInput ? resolveVideo(site, videoIdInput, page) : null;
  if (resource) {
    const seconds = Math.max(0, Math.floor(Number(timestamp) || 0));
    Object.assign(memo, {
      site: resource.site,
      bvid: resource.videoId,
      videoId: resource.videoId,
      page: resource.page,
      videoTitle: String(videoTitle || resource.videoId).trim().slice(0, 500),
      timestamp: BILI_TRANSCRIPT.formatTimestamp(seconds),
      timestampSeconds: seconds,
      timestampedUrl: canonicalVideoUrl(resource, seconds),
    });
  }

  const mutation = await mutateNotes((notes) => {
    notes.unshift(memo);
    return notes;
  }, { protectedNoteId: memo.id });
  chrome.runtime.sendMessage({ action: "noteSaved", note: memo }).catch(() => {});
  if (needsEnrich) {
    enrichMemoInBackground(memo, { site, bvid: videoIdInput, page, timestamp });
  }
  return { success: true, memo, removedCount: mutation.removed.length };
}

/**
 * 后台补齐手记正文：拉字幕 → 取时间点上下文 → 更新落库 → 广播刷新。
 * 失败静默（手记保持纯截图形态，与 B 站「拿不到字幕就空正文」语义一致）。
 * 同时顺带暖了字幕缓存：同视频下一条手记、侧边栏打开都直接命中。
 */
async function enrichMemoInBackground(memo, { site, bvid, page, timestamp }) {
  let enriched = false;
  try {
    const resource = resolveVideo(site, bvid, page);
    if (!resource) return;
    const transcript = await ensureTranscript(resource);
    if (!transcript.success) return;
    const seconds = Math.max(0, Math.floor(Number(timestamp) || 0));
    const context = BILI_AI.noteContextAt(transcript.transcript, seconds);
    if (context) {
      const memoText = [context.beforeText, context.targetText, context.afterText]
        .filter(Boolean)
        .join(" ");
      if (memoText) {
        await mutateNotes((notes) => {
          const target = notes.find((note) => note.id === memo.id);
          if (!target || target.text) return notes; // 已被删除或已补过
          target.text = memoText;
          enriched = true;
          return notes;
        });
      }
    }
  } catch (error) {
    debugLog("[Video Assistant] 手记正文补齐失败（不影响已保存的截图手记）：", error?.message || error);
  } finally {
    // 无论成败都清 pendingTranscript 并广播：用户需要知道「等待」结束了，
    // 失败时 pill 也要消失（手记保持纯截图形态，与既有语义一致）。
    await clearPendingTranscript(memo.id).catch(() => {});
    if (enriched) {
      chrome.runtime.sendMessage({ action: "noteUpdated", noteId: memo.id }).catch(() => {});
    }
  }
}

/** 清除等待字幕标志。返回是否真的改了存储（决定要不要刷新 UI）。 */
async function clearPendingTranscript(noteId) {
  return mutateNotes((notes) => {
    const target = notes.find((note) => note.id === noteId);
    if (!target?.pendingTranscript) return notes; // 无标志=无需写
    delete target.pendingTranscript;
    return notes;
  });
}

async function handleGetMemos(kind, { site, bvid, offset, limit } = {}) {
  const notes = await readNotes();
  let memos = notes.filter((note) =>
    kind === "ai_note"
      ? note.kind === "ai_note" || note.kind === "ai_chat"
      : note.kind === "memo",
  );
  // 手记/AI 记录与划词笔记同源存储，默认也是「当前视频」视图：
  // 传了 bvid 就按 site+bvid 过滤，只有「全部」范围才返回全部视频的手记。
  const resource = bvid ? resolveVideo(site, bvid) : null;
  if (resource) {
    memos = memos.filter(
      (note) =>
        (note.site || "bilibili") === resource.site &&
        note.bvid === resource.videoId,
    );
  }
  return { success: true, ...pageNotes(memos, { offset, limit }) };
}

async function handleDeleteNote(noteId) {
  await mutateNotes((notes) => notes.filter((note) => note.id !== noteId));
  return { success: true };
}

async function handleDeleteNotes(noteIds) {
  const ids = new Set(
    Array.isArray(noteIds)
      ? noteIds.filter((noteId) => typeof noteId === "string" && noteId)
      : [],
  );
  if (!ids.size) return { success: false, error: "EMPTY_SELECTION", message: "请先选择笔记。" };
  let deletedCount = 0;
  await mutateNotes((notes) =>
    notes.filter((note) => {
      const matched = ids.has(note.id);
      if (matched) deletedCount += 1;
      return !matched;
    }),
  );
  return { success: true, deletedCount };
}

function noteMatchesScope(note, { site, bvid, scope }) {
  if (scope === "all") return true;
  if (scope === "memo") return note.kind === "memo";
  if (scope === "ai") return note.kind === "ai_note" || note.kind === "ai_chat";
  if (scope !== "video") return false;
  const resource = bvid ? resolveVideo(site, bvid) : null;
  return Boolean(
    resource &&
      !["memo", "ai_note", "ai_chat"].includes(note.kind) &&
      (note.site || "bilibili") === resource.site &&
      note.bvid === resource.videoId,
  );
}

async function handleClearNotes({ site = "bilibili", bvid, scope = "video" }) {
  let deletedCount = 0;
  await mutateNotes((notes) =>
    notes.filter((note) => {
      const matched = noteMatchesScope(note, { site, bvid, scope });
      if (matched) deletedCount += 1;
      return !matched;
    }),
  );
  return { success: true, deletedCount };
}

async function handleUpdateNote(noteId, text) {
  const nextText = String(text || "").trim().slice(0, 12_000);
  if (!nextText) {
    return { success: false, error: "EMPTY_NOTE", message: "笔记内容不能为空。" };
  }
  let found = false;
  await mutateNotes((notes) =>
    notes.map((note) => {
      if (note.id !== noteId) return note;
      found = true;
      // 手动修改应胜过尚未完成的 AI 润色，避免后台结果把用户编辑覆盖掉。
      return { ...note, text: nextText, pending: false, updatedAt: Date.now() };
    }),
    { protectedNoteId: noteId },
  );
  if (!found) return { success: false, error: "NOTE_NOT_FOUND", message: "笔记不存在。" };
  chrome.runtime.sendMessage({ action: "noteUpdated", noteId }).catch(() => {});
  return { success: true };
}

// 开新标签页前先问一句视频还在不在，免得用户等页面加载完才看到「稿件不可见」。
// 判不准时一律放行：拦下还能看的视频比多开一个标签页糟糕得多。
async function handleCheckVideoAvailable(videoIdInput, site = "bilibili") {
  const resource = resolveVideo(site, videoIdInput);
  if (!resource) return { available: false, message: "这条笔记没有记下有效的视频号。" };

  if (resource.site === "youtube") return { available: true };

  try {
    await BILI_API.fetchVideoInfo(resource.videoId);
    return { available: true };
  } catch (error) {
    if (error?.code === "VIDEO_UNAVAILABLE") {
      return { available: false, message: "视频已下架，无法查看原视频。" };
    }
    return { available: true };
  }
}

// 流式「问 AI」长连接：侧边栏 connect({name:"askVideoStream"}) 后发
// {type:"start", ...} 触发一次流式问答；侧边栏断开即 abort 请求。
chrome.runtime.onConnect.addListener((port) => {
  if (port?.name !== "askVideoStream") return;
  const controller = new AbortController();
  let started = false;
  port.onMessage.addListener((message) => {
    if (message?.type !== "start" || started) return;
    started = true;
    handleAskVideoStream(port, message, controller.signal);
  });
  port.onDisconnect.addListener(() => controller.abort());
});
