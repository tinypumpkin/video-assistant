/**
 * Bilibili Digest — content script（B 站播放页）：注入 Digest / 笔记按钮，
 * n 快捷键记笔记，响应侧边栏的播放器指令。
 *
 * 按钮 UI（品牌图标 / 手记图标 / 气泡提示 / 保存反馈）来自共享库
 * content-shared.js（globalThis.VideoAssistantUI），两站同一份实现——
 * 改按钮长相只改那一个文件。这里只保留 B 站特有的部分：工具栏选择器、
 * 注入时机、B 站消息协议。
 *
 * 工具栏选择器是一组候选，全部落空时退化成播放器上的浮动按钮。
 * 贯穿全文件的一条纪律：**页面稳定之前不碰 DOM**，原因见 SETTLE_DELAY_MS。
 */

(() => {
  "use strict";

  // 两站共用的按钮 UI 库（manifest 里 content-shared.js 排在本文件之前注入）。
  const UI = globalThis.VideoAssistantUI;
  const CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest?.().version || "test";

  const DEBUG = false;
  const debugLog = (...args) => {
    if (DEBUG) console.log("[Bilibili Digest]", ...args);
  };

  const OVERLAY_ID = "bili-digest-overlay";
  const DIGEST_BUTTON_ID = "bili-digest-button";
  const NOTE_BUTTON_ID = "bili-digest-note-button";
  const NOTE_TOAST_ID = "bili-note-toast";
  const NOTE_TOAST_STYLE_ID = "bili-note-toast-style";
  const NOTE_LABEL_CLASS = "bili-digest-note-label";
  const DIGEST_HINT_CLASS = "bili-digest-hint";
  let siteEnabled = true;
  // SPA 自查定时器句柄：孤儿退出时要能清掉它。
  let reinjectTimer = null;
  let keyboardListenerAdded = false;

  // 从左到右依次尝试，命中即用。覆盖新旧两版播放页。
  const TOOLBAR_SELECTORS = [
    ".video-toolbar-left",
    ".video-toolbar-container .toolbar-left",
    "#arc_toolbar_report .toolbar-left",
    ".toolbar-left",
    ".video-toolbar-v1 .toolbar-left",
  ];
  // 浮动按钮挂在哪一层。硬约束：不能挂进直接包着 <video> 的那层——那层归
  // B 站播放器自己管，插外来节点会让它推倒重建，视频加载两遍。
  const PLAYER_SELECTORS = [
    "#bilibili-player .bpx-player-primary-area",
    "#bilibili-player",
    ".bpx-player-container",
    "#playerWrap",
  ];

  // 按钮自查的间隔。B 站重渲染后要靠它把按钮补回去。
  const REINJECT_INTERVAL_MS = 800;

  /**
   * 等页面稳定下来再动 DOM。B 站播放页是 SSR + Vue hydration：hydration 跑完
   * 之前往它管的容器插节点，Vue 会判定两端对不上、把整棵树推倒重渲染，
   * 表现为视频加载两遍。没有公开的「hydration 完成」信号，用三个条件近似：
   * window.load 已发生、<video> 已挂上、再留一点余量。
   */
  const SETTLE_DELAY_MS = 1200;
  const PLAYER_POLL_MS = 200;
  const PLAYER_WAIT_TIMEOUT_MS = 15000;

  // ============================================================
  // 页面读取
  // ============================================================

  // 播放页是 /video/BVxxx，合集播放页把 BV 号放在 ?bvid= 里，所以整个 URL 都要看。
  const currentBvid = () => {
    const match = location.href.match(/BV[0-9A-Za-z]{10}/);
    return match ? match[0] : null;
  };

  const currentPage = () => {
    const match = location.search.match(/[?&]p=(\d+)/);
    const page = match ? Number(match[1]) : 1;
    return Number.isFinite(page) && page > 0 ? page : 1;
  };

  const firstMatch = (selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  };

  const holdsVideoDirectly = (element) =>
    Array.prototype.some.call(
      element.children || [],
      (child) => child.tagName === "VIDEO",
    );

  // 外层容器，且不是 <video> 的直接父节点，才能安全挂东西。
  function playerContainer() {
    for (const selector of PLAYER_SELECTORS) {
      const element = document.querySelector(selector);
      if (element && !holdsVideoDirectly(element)) return element;
    }
    return null;
  }

  const videoElement = () =>
    document.querySelector(".bpx-player-video-wrap video") ||
    document.querySelector("video");

  function readVideoInfo() {
    const titleNode =
      document.querySelector("h1.video-title") ||
      document.querySelector(".video-title") ||
      document.querySelector("h1[title]");
    const ownerNode =
      document.querySelector(".up-info-container .up-name") ||
      document.querySelector("a.up-name") ||
      document.querySelector(".up-name");
    const video = videoElement();

    return {
      bvid: currentBvid(),
      page: currentPage(),
      // B 站标题带 "_哔哩哔哩_bilibili" 后缀，DOM 拿不到时才退回它。
      title:
        titleNode?.getAttribute("title")?.trim() ||
        titleNode?.textContent?.trim() ||
        document.title.replace(/_哔哩哔哩.*$/, "").trim(),
      owner: ownerNode?.textContent?.trim() || "",
      duration: Number(video?.duration) || 0,
      currentTime: Number(video?.currentTime) || 0,
    };
  }

  // ============================================================
  // 按钮
  // ============================================================




  function removeInjectedButtons() {
    document.getElementById(DIGEST_BUTTON_ID)?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(NOTE_TOAST_ID)?.remove();
  }

  // 浮动按钮共用一个纵向容器，否则 Digest 退化成浮动按钮时会和笔记按钮叠在一起。
  function ensureOverlay() {
    const player = playerContainer();
    if (!player) return null;

    let overlay = player.querySelector(`#${OVERLAY_ID}`);
    if (overlay?.isConnected) return overlay;

    // 浮动定位需要一个定位上下文，播放器容器默认可能是 static。
    if (getComputedStyle(player).position === "static") {
      player.style.position = "relative";
    }
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `position:absolute;top:12px;right:12px;z-index:9999;
       display:flex;flex-direction:column;align-items:flex-end;gap:8px;`;
    player.appendChild(overlay);
    return overlay;
  }

  // 浏览器可能拒绝从这里程序化打开侧边栏（Edge 对用户手势的判定比 Chrome 严）。
  // 那时唯一走得通的是工具栏图标，它由浏览器自己处理，所以把人指过去。
  async function openSidePanel(button) {
    let result = null;
    try {
      result = await chrome.runtime.sendMessage({ action: "openSidePanel" });
    } catch (error) {
      // service worker 正在重启之类，下面统一按打不开处理。
    }
    // button 由调用方传入：函数体内没有其他途径拿到这个引用。
    if (!result?.success) UI.flashDigestHint(button, UI.uiCopy("clickToolbarHint"));
  }

  function injectDigestButton() {
    const existing = document.getElementById(DIGEST_BUTTON_ID);
    if (existing?.isConnected) {
      if (existing.getAttribute?.("data-video-assistant-version") === CONTENT_SCRIPT_VERSION) return;
      existing.remove();
    }

    const button = document.createElement("button");
    button.id = DIGEST_BUTTON_ID;
    button.setAttribute("data-video-assistant-version", CONTENT_SCRIPT_VERSION);
    button.type = "button";
    button.title = UI.uiCopy("openSidePanel");
    // 图标即按钮：svg 填满整个按钮，不再放文字位。
    button.append(UI.digestIcon());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSidePanel(button);
    });

    const toolbar = firstMatch(TOOLBAR_SELECTORS);
    if (toolbar) {
      UI.styleDigestButton(button);
      toolbar.appendChild(button);
      debugLog("Digest 按钮已注入工具栏");
      return;
    }

    const overlay = ensureOverlay();
    if (overlay) {
      UI.styleDigestButton(button);
      overlay.appendChild(button);
      debugLog("工具栏未命中，Digest 按钮退化为浮动按钮");
    }
  }

  function injectNoteButton() {
    const existing = document.getElementById(NOTE_BUTTON_ID);
    if (existing?.isConnected) {
      if (existing.getAttribute?.("data-video-assistant-version") === CONTENT_SCRIPT_VERSION) return;
      existing.remove();
    }

    const overlay = ensureOverlay();
    if (!overlay) return;

    const button = document.createElement("button");
    button.id = NOTE_BUTTON_ID;
    button.setAttribute("data-video-assistant-version", CONTENT_SCRIPT_VERSION);
    button.type = "button";
    button.title = UI.uiCopy("noteTitle");
    // 图标 + 文案。文案单独一个 span：保存反馈只换这里的字，图标留在原处。
    button.append(UI.noteIcon(), UI.noteLabel(UI.uiCopy("noteLabel"), NOTE_LABEL_CLASS));
    // 胶囊样式与 hover 行为都与 YT 同一份（共享库）。
    UI.styleNoteButton(button);
    UI.bindNoteHover(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      saveNoteAtCurrentTime();
    });
    overlay.appendChild(button);
  }

  function injectButtons() {
    if (!siteEnabled || !currentBvid()) return;
    injectDigestButton();
    injectNoteButton();
  }

  // ============================================================
  // 记手记（截图 + 当前字幕）
  // ============================================================

  let noteInFlight = false;

  // 保存反馈：只换 label 文案（共享库实现），图标不动。
  function flashNoteButton(text) {
    const button = document.getElementById(NOTE_BUTTON_ID);
    UI.flashNoteLabel(button, NOTE_LABEL_CLASS, text, UI.uiCopy("noteLabel"));
  }

  // 把当前视频帧画到 canvas 再转 JPEG dataURL。
  // B 站播放器没有跨源问题（同源 + CORS 头都齐全），drawImage 不会污染画布。
  // 截图只用于手记回看，质量 0.7、宽压到 840px，一条手记几十 KB。
  function captureVideoFrame(video) {
    try {
      const scale = Math.min(1, 840 / (video.videoWidth || 840));
      const width = Math.max(2, Math.round((video.videoWidth || 840) * scale));
      const height = Math.max(2, Math.round((video.videoHeight || 472) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch (error) {
      // 跨源污染或解码器不给帧，截图失败不该挡住文字部分入库。
      debugLog("截图失败：", error?.message || error);
      return null;
    }
  }

  /** 保存成功后显示与 YouTube 等价的右下角手记卡片。 */
  function showNoteSavedToast(note) {
    if (!note || !document.body) return;
    document.getElementById(NOTE_TOAST_ID)?.remove();

    const toast = document.createElement("div");
    toast.id = NOTE_TOAST_ID;
    toast.style.cssText = `
      position:fixed;bottom:20px;right:20px;z-index:999999;
      background:#fff;border:1px solid #ece5d9;border-radius:14px;
      padding:16px 20px;max-width:350px;box-shadow:0 12px 32px rgba(50,42,32,.2);
      font-family:system-ui,-apple-system,"Roboto",sans-serif;
      animation:biliNoteSlideIn .3s ease;
    `;

    const title = document.createElement("div");
    title.textContent = `📝 ${UI.uiCopy("savedToastTitle")}`;
    title.style.cssText = "font-weight:700;margin-bottom:6px;color:#168cff;";

    const meta = document.createElement("div");
    meta.textContent = `${String(note.timestamp || "")} — ${String(note.videoTitle || "")}`;
    meta.style.cssText = "font-size:12px;color:#6b6258;margin-bottom:8px;";

    const content = document.createElement("div");
    content.textContent = `"${String(note.text || "")}"`;
    content.style.cssText = "font-size:13px;line-height:1.55;color:#2e2a24;";

    const linkRow = document.createElement("div");
    linkRow.style.cssText = "margin-top:10px;font-size:11px;";
    const link = document.createElement("a");
    link.href = String(note.timestampedUrl || "#");
    link.textContent = `🔗 ${UI.uiCopy("copyLink")}`;
    link.style.cssText = "color:#168cff;font-weight:600;text-decoration:none;";
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(String(note.timestampedUrl || ""));
        link.textContent = "✓ Copied!";
      } catch (error) {
        console.error("Copy failed:", error);
      }
    });
    linkRow.appendChild(link);
    toast.append(title, meta, content, linkRow);

    if (document.head && !document.getElementById(NOTE_TOAST_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = NOTE_TOAST_STYLE_ID;
      style.textContent = `
        @keyframes biliNoteSlideIn {
          from { transform:translateX(100%); opacity:0; }
          to { transform:translateX(0); opacity:1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "biliNoteSlideIn .3s ease reverse";
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  async function saveNoteAtCurrentTime() {
    const video = videoElement();
    const bvid = currentBvid();
    if (!video || !bvid || noteInFlight) return;

    // 连点几下不该存出几条一样的手记，在途时忽略而不是排队。
    noteInFlight = true;
    flashNoteButton(UI.uiCopy("saving"));
    // 截图可能因新播放器还没解码出帧 / canvas 被跨源污染而失败（SPA 切视频后
    // 的典型时间窗）。此时至少把手记时间点以文字落库，别让 N 键白按。
    const shot = captureVideoFrame(video);
    const videoInfo = readVideoInfo();
    try {
      const result = await chrome.runtime.sendMessage({
        action: "saveMemo",
        kind: "memo",
        site: "bilibili",
        bvid,
        page: currentPage(),
        timestamp: Math.floor(video.currentTime || 0),
        videoTitle: videoInfo.title,
        ...(shot
          ? { imageDataUrl: shot, imageMeta: UI.analyzeVideoFrame(video) }
          : { text: `（视频截图失败，记录于 ${Math.floor(video.currentTime || 0)}s）` }),
      });
      if (result?.success) {
        flashNoteButton(UI.uiCopy("saved"));
        showNoteSavedToast(result.memo);
      } else {
        // 与 YouTube 侧对齐：失败必须留下具体原因，否则永远只能看到笼统的「保存失败」。
        console.error("[Video Assistant] B站手记保存失败：", result?.error, result?.message);
        flashNoteButton(UI.uiCopy("saveFailed"));
      }
    } catch (error) {
      console.error("[Video Assistant] B站手记保存异常：", error?.message || error);
      flashNoteButton(UI.uiCopy("saveFailed"));
    } finally {
      noteInFlight = false;
    }
  }

  const isTypingTarget = UI.isTypingTarget;

  function handleKeydown(event) {
    if (!siteEnabled) return;
    if (event.key !== "n" && event.key !== "N") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    saveNoteAtCurrentTime();
  }

  // ============================================================
  // 消息处理
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === "videoAssistantContentScriptPing") {
      sendResponse({ success: true, site: "bilibili", version: CONTENT_SCRIPT_VERSION });
      return false;
    }

    if (message?.action === "uiLanguageChanged") {
      // options 切语言后 background 转发来的：刷新共享库语言 + 已注入的按钮。
      UI.setUiLanguage(message.uiLanguage);
      UI.refreshNoteButtonLanguage(NOTE_LABEL_CLASS, "noteTitle");
      sendResponse({ success: true });
      return false;
    }

    if (message?.action === "siteScopeChanged") {
      siteEnabled = message.bilibiliEnabled !== false;
      if (siteEnabled) {
        injectButtons();
      } else {
        removeInjectedButtons();
      }
      sendResponse({ success: true });
      return false;
    }

    if (message?.action === "getVideoInfo") {
      sendResponse(readVideoInfo());
      return false;
    }

    if (message?.action === "getPlaybackTime") {
      const video = videoElement();
      sendResponse({
        currentTime: Number(video?.currentTime) || 0,
        paused: video ? video.paused : true,
      });
      return false;
    }

    if (message?.action === "seekTo") {
      const video = videoElement();
      if (!video) {
        sendResponse({ success: false, error: "NO_PLAYER" });
        return false;
      }
      video.currentTime = Math.max(0, Number(message.seconds) || 0);
      // 用户从侧边栏点时间戳意味着想看这一段，暂停着就顺手播起来。
      if (video.paused) video.play().catch(() => {});
      sendResponse({ success: true });
      return false;
    }

    return false;
  });

  // ============================================================
  // 启动
  // ============================================================

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function whenWindowLoaded() {
    if (document.readyState === "complete") return Promise.resolve();
    return new Promise((resolve) =>
      window.addEventListener("load", () => resolve(), { once: true }),
    );
  }

  // <video> 挂上说明应用已渲染过一轮。等不到也别一直等下去。
  async function whenPlayerMounted() {
    const deadline = Date.now() + PLAYER_WAIT_TIMEOUT_MS;
    while (!videoElement() && Date.now() < deadline) {
      await delay(PLAYER_POLL_MS);
    }
  }

  async function init() {
    // 孤儿检测：扩展重载/更新后，旧 content script 仍留在此页面里，它的
    // chrome.runtime 已失效。旧脚本的 setInterval 会继续跑并反复抛
    // “Extension context invalidated”，还会 remove() 新脚本注入的按钮——
    // 两代脚本互相拆台，按钮永远点不动。这里一旦探测到 runtime 失效，
    // 立即停掉本实例的所有定时器并不再注入（新脚本会接管）。
    let orphaned = false;
    try {
      chrome.runtime.getURL("");
    } catch (error) {
      orphaned = true;
    }
    if (orphaned) {
      debugLog("[Video Assistant] 检测到扩展已重载，旧内容脚本退出。");
      return;
    }

    try {
      const scope = await chrome.runtime.sendMessage({
        action: "isSiteEnabled",
        site: "bilibili",
      });
      siteEnabled = scope?.enabled !== false;
    } catch (error) {
      // service worker 重启期间读取失败时保持默认开启，避免功能莫名消失。
      siteEnabled = true;
    }

    // 注入 UI 的语言（手记按钮文案等）。取失败不挡注入，共享库默认中文。
    try {
      const language = await chrome.runtime.sendMessage({ action: "getUiLanguage" });
      UI.setUiLanguage(language?.uiLanguage);
    } catch (error) {
      debugLog("读取界面语言失败，按默认中文注入：", error?.message || error);
    }

    // 挂监听不碰 DOM，不会干扰 hydration，可以立刻生效。
    if (!keyboardListenerAdded) {
      document.addEventListener("keydown", handleKeydown);
      keyboardListenerAdded = true;
    }

    await whenWindowLoaded();
    await whenPlayerMounted();
    await delay(SETTLE_DELAY_MS);

    if (siteEnabled) injectButtons();
    // 定时自查而非 MutationObserver：弹幕每飘一条都是 DOM 变更，观察 body 白烧
    // CPU 还会让防抖永远等不到空档。定时器顺带覆盖了 SPA 换页（不触发事件）。
    // 每轮先做孤儿探测：扩展重载后本实例立即停摆，把页面让给新注入的脚本。
    reinjectTimer = setInterval(() => {
      try {
        chrome.runtime.getURL("");
      } catch (error) {
        clearInterval(reinjectTimer);
        reinjectTimer = null;
        debugLog("[Video Assistant] 扩展已重载，旧内容脚本停止注入。");
        return;
      }
      injectButtons();
    }, REINJECT_INTERVAL_MS);
  }

  init();
})();
