/**
 * CONTENT SCRIPT
 *
 * This script runs ON the YouTube page itself. It can see and modify
 * the YouTube page DOM (the HTML elements).
 *
 * It handles:
 * 1. Extracting video info (title, channel name) from the page
 * 2. Injecting "key moment" markers onto YouTube's progress bar
 * 3. Adding a "Digest" button to YouTube's action bar (next to Share/Save)
 *
 * Think of it like a robot sitting inside the YouTube tab,
 * reading the page and making small visual changes.
 */

const DEBUG = false;
// 两站共用的按钮 UI 库（manifest 里 content-shared.js 排在本文件之前注入，
// 同一 isolated world，这里直接取 globalThis）。
const UI = globalThis.VideoAssistantUI;
const CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest?.().version || "test";

const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// GLOBAL STATE
// ============================================================

let ytdNoteButton = null;
let ytdNoteButtonTimer = null;
// 连点几下不该存出几条一样的手记，在途时忽略而不是排队（与 B 站同款）。
let noteInFlight = false;

// 手记 label span 的类名（模块级：saveCurrentNote 与注入函数共用，
// 千万别写成函数内局部量——B 站同款悬空引用 bug 就是这么来的）。
const NOTE_LABEL_CLASS = "ytd-note-label";
let ytdNoteKeyboardListenerAdded = false;
let ytdNoteButtonRetryTimer = null;
let ytdDigestButton = null;
let digestButtonObserver = null;
let digestButtonReconcileTimer = null;
let digestButtonResizeListenerAdded = false;
let controlsHealthTimer = null;
let siteEnabled = true;

const DIGEST_BLUE = "#168cff";
// 手记按钮胶囊样式（含 hover 常量）来自共享库 content-shared.js。
const CONTROLS_HEALTH_CHECK_MS = 1500;

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * When the page loads, inject our Digest button and Note button.
 * We wait a bit for YouTube's UI to fully render.
 */
async function init() {
  try {
    const scope = await chrome.runtime.sendMessage({
      action: "isSiteEnabled",
      site: "youtube",
    });
    siteEnabled = scope?.enabled !== false;
  } catch (error) {
    // service worker 重启期间读取失败时保持默认开启，避免功能莫名消失。
    siteEnabled = true;
  }

  // UI language for injected copy (note button label etc). Falls back to
  // the shared lib's Chinese default when the read fails.
  try {
    const language = await chrome.runtime.sendMessage({ action: "getUiLanguage" });
    UI.setUiLanguage(language?.uiLanguage);
  } catch (error) {
    // keep zh-CN default; next injection still works
  }

  // Register the global "n" keyboard shortcut once
  if (!ytdNoteKeyboardListenerAdded) {
    document.addEventListener("keydown", handleNoteKeyboardShortcut);
    ytdNoteKeyboardListenerAdded = true;
  }

  if (siteEnabled) {
    // Try to inject the buttons immediately
    injectDigestButton();
    tryInjectNoteButton();
  } else {
    removeInjectedControls();
  }

  // Also set up an observer to handle YouTube's dynamic content loading
  // (YouTube is an SPA, so elements appear/disappear as you navigate)
  setupButtonObserver();
  setupDigestButtonResizeListener();
  setupControlsHealthCheck();
}

// YouTube can finish a watch-page render without another mutation we can
// observe. Keep a small safety net so an enabled video page never stays
// without controls just because an action row or player arrived late.
function setupControlsHealthCheck() {
  if (controlsHealthTimer) return;
  controlsHealthTimer = setInterval(() => {
    if (!siteEnabled || !window.location.pathname.includes("/watch")) return;
    injectDigestButton();
    if (!ytdNoteButton || !ytdNoteButton.isConnected) tryInjectNoteButton();
  }, CONTROLS_HEALTH_CHECK_MS);
}

/**
 * Attempts to inject the note button. If the player container isn't ready yet,
 * retry a few times with a short delay. YouTube renders the player asynchronously
 * after navigation, so a single immediate attempt can miss it.
 */
function tryInjectNoteButton() {
  if (!siteEnabled) return;
  if (!window.location.pathname.includes("/watch")) return;

  // Clear any existing retry so we don't stack timers
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  let attempts = 0;
  const maxAttempts = 30; // ~3 seconds of retrying

  function attempt() {
    attempts++;
    const playerContainer = document.querySelector(
      "#movie_player.html5-video-player, #movie_player, .html5-video-player",
    );

    if (playerContainer) {
      injectNoteButton();
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
      return;
    }

    if (attempts >= maxAttempts) {
      debugLog(
        "[YouTube Digest Content] Player container not found after retries, giving up",
      );
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
    }
  }

  attempt();
  if (!ytdNoteButton || !ytdNoteButton.isConnected) {
    ytdNoteButtonRetryTimer = setInterval(attempt, 100);
  }
}

// Run init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

/**
 * Listen for messages from the side panel or background script.
 * When they ask for video info, we read it from the page.
 * When they send key moments, we highlight them on the progress bar.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("[YouTube Digest Content] Received message:", message.action, message);

  if (message.action === "videoAssistantContentScriptPing") {
    sendResponse({ success: true, site: "youtube", version: CONTENT_SCRIPT_VERSION });
    return false;
  }

  if (message.action === "siteScopeChanged") {
    siteEnabled = message.youtubeEnabled !== false;
    if (siteEnabled) {
      injectDigestButton();
      tryInjectNoteButton();
    } else {
      removeInjectedControls();
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "getVideoInfo") {
    // Read video title and channel name from the page
    const info = extractVideoInfo();
    debugLog("[YouTube Digest Content] Returning video info:", info);
    sendResponse(info);
    return false; // Synchronous response
  }

  if (message.action === "getYouTubeCaptionTracks") {
    getLocalYouTubeCaptionTracks(message.videoId)
      .then((tracks) => sendResponse({ success: true, tracks }))
      .catch((error) => sendResponse({
        success: false,
        error: error?.message || "无法从当前 YouTube 页面读取字幕轨。",
      }));
    return true;
  }

  if (message.action === "highlightMoments") {
    // Key moment markers disabled — chapters are shown in the side panel only.
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "getCurrentTime" || message.action === "getPlaybackTime") {
    // Return the current video playback time (used by auto-scroll)
    const video = document.querySelector("video.html5-main-video");
    sendResponse({
      currentTime: video ? Math.floor(video.currentTime) : 0,
      paused: video ? video.paused : true,
    });
    return false;
  }

  if (message.action === "seekTo") {
    // Jump the video to a specific timestamp
    debugLog("[YouTube Digest Content] Seeking to:", message.seconds);
    seekToTimestamp(message.seconds);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "uiLanguageChanged") {
    // Forwarded by background after the user switches language in options:
    // refresh the shared lib language and already-injected buttons.
    UI.setUiLanguage(message.uiLanguage);
    UI.refreshNoteButtonLanguage(NOTE_LABEL_CLASS, "noteTitleNoShot");
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "showNoteSavedFeedback") {
    // Show brief feedback that note was saved
    showNoteSavedToast(message.note);
    sendResponse({ success: true });
    return false;
  }

  // Unknown action - still send a response to prevent hanging
  debugLog("[YouTube Digest Content] Unknown action:", message.action);
  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

// ============================================================
// DIGEST BUTTON INJECTION
// ============================================================

/**
 * Injects a "Digest" button into YouTube's action bar.
 * The button appears next to Share, Save, etc. below the video.
 *
 * When clicked, it opens the YouTube Digest side panel.
 */
function isVisibleDigestHost(element) {
  if (!element || !element.isConnected) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * YouTube keeps hidden copies of its responsive action toolbar in the DOM.
 * querySelector() can return one of those 0x0 copies before the toolbar the
 * viewer can actually see, so inspect every candidate and resolve the native
 * button group inside the visible action row for the current video.
 */
function findDigestButtonHost() {
  const primaryActionRows = Array.from(
    document.querySelectorAll("ytd-watch-metadata #actions-inner"),
  );

  for (const actionRow of primaryActionRows) {
    if (!isVisibleDigestHost(actionRow)) continue;

    const visibleButtonGroup = Array.from(
      actionRow.querySelectorAll("#top-level-buttons-computed"),
    ).find(isVisibleDigestHost);
    if (visibleButtonGroup) return visibleButtonGroup;
  }

  const fallbackCandidates = Array.from(
    document.querySelectorAll(
      "ytd-watch-metadata #actions #top-level-buttons-computed, " +
        "ytd-watch-metadata #top-level-buttons-computed, " +
        "#primary #actions #top-level-buttons-computed",
    ),
  );

  return (
    fallbackCandidates.find(
      (candidate) =>
        isVisibleDigestHost(candidate) &&
        (candidate.closest("ytd-watch-metadata") ||
          candidate.closest("#primary")),
    ) || null
  );
}

function findPlayerContainer() {
  return document.querySelector(
    "#movie_player.html5-video-player, #movie_player, .html5-video-player",
  );
}

function setDigestButtonPlacement(digestButton, { floating }) {
  if (floating) {
    // Use the same player host as Note while YouTube's native action row is
    // unavailable. Reconciliation moves it back below the video once ready.
    digestButton.style.position = "absolute";
    digestButton.style.top = "16px";
    digestButton.style.right = "126px";
    digestButton.style.zIndex = "9999";
    digestButton.style.marginRight = "0";
    return;
  }
  digestButton.style.position = "";
  digestButton.style.top = "";
  digestButton.style.right = "";
  digestButton.style.zIndex = "";
  digestButton.style.marginRight = "8px";
}

function createDigestButton() {
  const digestButton = document.createElement("button");
  digestButton.id = "ytd-digest-button";
  digestButton.setAttribute("data-video-assistant-version", CONTENT_SCRIPT_VERSION);
  digestButton.type = "button";
  digestButton.setAttribute("aria-label", "Open Video Assistant");
  digestButton.title = "Open Video Assistant";
  digestButton.innerHTML = "";

  // 图标即按钮本体 + 透明 icon-only 壳：实现来自共享库 content-shared.js，
  // 与 B 站完全同一份代码（同一张品牌 SVG、同一个样式函数）。
  digestButton.append(UI.digestIcon());
  UI.styleDigestButton(digestButton);

  // 与 B 站侧对齐：侧边栏打不开时（如 Edge 拒绝程序化打开），提示语浮在
  // 图标上方的深色小气泡里，2.6s 后自动消失，不占按钮任何空间。
  // Click handler — open the side panel
  digestButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    debugLog("[YouTube Digest] Digest button clicked");

    try {
      const result = await chrome.runtime.sendMessage({ action: "openSidePanel" });
      debugLog("[YouTube Digest] openSidePanel response:", result);
      if (!result?.success) UI.flashDigestHint(digestButton, UI.uiCopy("clickToolbarHint"));
    } catch (err) {
      console.error("[YouTube Digest] Failed to open side panel:", err);
      UI.flashDigestHint(digestButton, UI.uiCopy("clickToolbarHint"));
    }
  });

  ytdDigestButton = digestButton;
  return digestButton;
}

/**
 * Reconciles the Digest button with YouTube's currently visible action row.
 * This is intentionally idempotent because YouTube rebuilds its watch page
 * during navigation and at responsive breakpoints.
 */
function injectDigestButton() {
  if (!siteEnabled) return false;
  const existingButtons = Array.from(
    document.querySelectorAll("#ytd-digest-button"),
  );

  if (!window.location.pathname.includes("/watch")) {
    existingButtons.forEach((button) => button.remove());
    ytdDigestButton = null;
    return false;
  }

  let digestButton = existingButtons.find(
    (button) => button === ytdDigestButton,
  );

  if (!digestButton) {
    existingButtons.forEach((button) => button.remove());
    existingButtons.length = 0;
    digestButton = createDigestButton();
  }

  existingButtons.forEach((button) => {
    if (button !== digestButton) button.remove();
  });

  const actionsContainer = findDigestButtonHost();
  if (!actionsContainer) {
    const playerContainer = findPlayerContainer();
    if (!playerContainer) {
      debugLog(
        "[YouTube Digest Content] Neither action row nor player is ready yet",
      );
      return false;
    }
    if (
      window.getComputedStyle(playerContainer).position === "static" ||
      !playerContainer.style.position
    ) {
      playerContainer.style.position = "relative";
    }
    setDigestButtonPlacement(digestButton, { floating: true });
    if (digestButton.parentElement !== playerContainer) {
      playerContainer.appendChild(digestButton);
    }
    debugLog("[YouTube Digest Content] Digest button using player fallback");
    return true;
  }

  if (digestButton.parentElement !== actionsContainer) {
    // YouTube turns #actions-inner into a vertical flex column at narrow
    // breakpoints. A direct child there stretches into a full-width second
    // row, so keep Digest inside the native horizontal button group and
    // prepend it to preserve visibility when space is limited.
    actionsContainer.insertBefore(digestButton, actionsContainer.firstChild);
  }
  setDigestButtonPlacement(digestButton, { floating: false });

  debugLog("[YouTube Digest Content] Digest button reconciled");
  return true;
}

function scheduleDigestButtonReconciliation(delay = 80) {
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
  }

  digestButtonReconcileTimer = setTimeout(() => {
    digestButtonReconcileTimer = null;
    injectDigestButton();
  }, delay);
}

function setupDigestButtonResizeListener() {
  if (digestButtonResizeListenerAdded) return;

  window.addEventListener("resize", () => {
    scheduleDigestButtonReconciliation(120);
  });
  digestButtonResizeListenerAdded = true;
}

/**
 * Sets up a MutationObserver to watch for YouTube's dynamic content changes.
 * When the action buttons container appears (after navigation), we inject our button.
 */
function setupButtonObserver() {
  if (digestButtonObserver) return;

  digestButtonObserver = new MutationObserver(() => {
    // Check if we need to inject the buttons
    if (siteEnabled && window.location.pathname.includes("/watch")) {
      scheduleDigestButtonReconciliation();
      if (!ytdNoteButton || !ytdNoteButton.isConnected) {
        tryInjectNoteButton();
      }
    }
  });

  // Watch the entire body for changes (YouTube rebuilds large chunks of the DOM)
  digestButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// ============================================================
// NOTE BUTTON (Overlay on Video Player)
// ============================================================

/**
 * Injects a "Note" button overlay on top of the YouTube video player.
 * The button appears when the mouse enters or moves over the player and hides
 * after the cursor stays still for more than 2 seconds or leaves the player.
 */
function injectNoteButton() {
  if (!siteEnabled) return;
  // Don't inject if we're not on a video page
  if (!window.location.pathname.includes("/watch")) return;

  // Don't inject if button already exists and is properly tracked.
  // If a stale button exists (e.g., from a previous content-script instance),
  // remove it and re-inject so event listeners are attached to the live one.
  const existingButton = document.getElementById("ytd-note-button");
  if (existingButton) {
    if (ytdNoteButton === existingButton && existingButton.isConnected) {
      return; // already injected and connected
    }
    existingButton.remove();
  }

  // Find the video player container. YouTube rebuilds this dynamically, so
  // we try the most common selectors.
  const playerContainer = findPlayerContainer();

  if (!playerContainer) {
    debugLog(
      "[YouTube Digest Content] Player container not found yet, will retry",
    );
    return;
  }

  // Ensure the player container has relative positioning for absolute children
  if (
    window.getComputedStyle(playerContainer).position === "static" ||
    !playerContainer.style.position
  ) {
    playerContainer.style.position = "relative";
  }

  debugLog("[YouTube Digest Content] Injecting note button");

  // Create the note button — a soft rounded pill that floats over the player.
  // 图标 + 文案 span 来自共享库：与 B 站同一张便签图形（雪碧图 #i-note 同源），
  // 逐节点构建（Trusted Types 安全），反馈只换 label 文字、图标不动。
  const noteButton = document.createElement("button");
  noteButton.id = "ytd-note-button";
  noteButton.setAttribute("data-video-assistant-version", CONTENT_SCRIPT_VERSION);
  noteButton.type = "button";
  noteButton.title = UI.uiCopy("noteTitleNoShot");
  noteButton.append(UI.noteIcon(), UI.noteLabel(UI.uiCopy("noteLabel"), NOTE_LABEL_CLASS));

  // 胶囊样式与 B 站同一份（共享库 styleNoteButton）。
  // 站点特有：绝对定位在播放器右上角 + 默认隐藏（鼠标活动控制显隐）。
  UI.styleNoteButton(noteButton);
  noteButton.style.position = "absolute";
  noteButton.style.top = "16px";
  noteButton.style.right = "16px";
  noteButton.style.zIndex = "9999";
  noteButton.style.opacity = "0";
  noteButton.style.pointerEvents = "none";
  noteButton.style.fontFamily =
    'system-ui, -apple-system, "Roboto", sans-serif';
  noteButton.style.transition =
    "opacity .18s ease, transform .18s ease, background .18s ease, box-shadow .18s ease";

  ytdNoteButton = noteButton;

  // Show button when mouse enters or moves over the player.
  // Hide after 2 seconds of idle or when the mouse leaves.
  playerContainer.addEventListener("mouseenter", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mousemove", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mouseleave", () => {
    clearTimeout(ytdNoteButtonTimer);
    ytdNoteButtonTimer = null;
    hideNoteButton();
  });

  // hover 加深/上浮来自共享库，与 B 站同款。
  UI.bindNoteHover(noteButton);

  // Click handler — save the current moment as a note
  noteButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await saveCurrentNote();
  });

  playerContainer.appendChild(noteButton);

  debugLog("[YouTube Digest Content] Note button injected");
}

function showNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "1";
  ytdNoteButton.style.pointerEvents = "auto";
}

function hideNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "0";
  ytdNoteButton.style.pointerEvents = "none";
}

function resetNoteButtonTimer() {
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = setTimeout(() => {
    hideNoteButton();
  }, 2000);
}

/**
 * Handles the "n" keyboard shortcut for saving a note.
 * Only triggers on YouTube watch pages and when the user is not typing
 * in an input field.
 */
function handleNoteKeyboardShortcut(e) {
  if (!siteEnabled) return;
  if (!window.location.pathname.includes("/watch")) return;
  if (e.key !== "n" && e.key !== "N") return;

  // 用户在输入框/弹幕框里打字时，n 是普通字符，不能抢（共享库实现）。
  if (UI.isTypingTarget(document.activeElement)) return;

  // Prevent YouTube's own "n" shortcut (e.g. next video in playlist)
  e.preventDefault();
  e.stopPropagation();

  // Show brief visual feedback on the button, then save
  showNoteButton();
  resetNoteButtonTimer();
  saveCurrentNote();
}

/**
 * Captures the current timestamp and saves it as a note.
 */
async function saveCurrentNote() {
  debugLog("[YouTube Digest] Saving memo");

  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[YouTube Digest] No video element found");
    return;
  }
  if (noteInFlight) return;
  noteInFlight = true;
  // 释放也放进 finally：即使中途抛错（历史悬空引用 bug 就是这么把标志
  // 永久卡死的——第一次点击崩掉，之后所有点击被静默吞掉，按钮"点不动"），
  // 标志也能复位，按钮不会永久锁死。
  try {
    await doSaveCurrentNote(video);
  } finally {
    setTimeout(() => {
      noteInFlight = false;
    }, 500);
  }
}

async function doSaveCurrentNote(video) {
  // 与 B 站同款：回退 3 秒，取用户刚听到的内容（用户反应滞后）。
  const currentTime = Math.max(0, Math.floor(video.currentTime) - 3);
  const videoInfo = extractVideoInfo();
  const videoId = new URLSearchParams(window.location.search).get("v");

  const noteButton = ytdNoteButton;
  // 保存反馈只改 label span 的文字，图标和按钮结构完全不动（与 B 站同款）。
  if (noteButton) {
    UI.flashNoteLabel(noteButton, NOTE_LABEL_CLASS, UI.uiCopy("saving"), UI.uiCopy("noteLabel"), 999999);
    noteButton.style.pointerEvents = "none";
  }

  try {
    // 与 B 站手记按钮同一协议：saveMemo + kind:"memo"，落库后归进侧边栏
    // 「手记」tab（此前走 saveNote 会混进「笔记」tab 的 AI 润色笔记里）。
    // 正文由 background 从当前时间点字幕上下文生成；无字幕时存空文。
    const result = await chrome.runtime.sendMessage({
      action: "saveMemo",
      kind: "memo",
      site: "youtube",
      bvid: videoId,
      timestamp: currentTime,
      videoTitle: videoInfo.title,
      channelName: videoInfo.channelName,
      imageDataUrl: captureVideoFrame(video),
    });

    if (result.success) {
      if (noteButton) UI.flashNoteLabel(noteButton, NOTE_LABEL_CLASS, UI.uiCopy("saved"), UI.uiCopy("noteLabel"), 1800);
      showNoteSavedToast(result.memo);
    } else {
      if (noteButton) UI.flashNoteLabel(noteButton, NOTE_LABEL_CLASS, UI.uiCopy("saveFailed"), UI.uiCopy("noteLabel"), 1800);
      console.error("[YouTube Digest] Save note error:", result.error);
    }
  } catch (err) {
    if (noteButton) UI.flashNoteLabel(noteButton, NOTE_LABEL_CLASS, UI.uiCopy("saveFailed"), UI.uiCopy("noteLabel"), 1800);
    console.error("[YouTube Digest] Save note exception:", err);
  }

  setTimeout(() => {
    if (noteButton) {
      noteButton.style.pointerEvents = "auto";
    }
  }, 2000);
}

/**
 * 截取当前视频帧（与 B 站 captureVideoFrame 同款）。
 * 桌面 Chrome 的 YouTube 走 MSE：video.src 是 blob: URL（同源），
 * canvas 不会被污染，toDataURL 正常出图 —— 截图和字幕可以同时有。
 * try/catch 只是兜底（DRM 帧、解码器不给帧等极端情况）：截图失败
 * 返回 null，文字部分照常入库，不挡保存。
 */
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
    debugLog("截图失败：", error?.message || error);
    return null;
  }
}

/**
 * Shows a toast notification when a note is saved.
 */
function showNoteSavedToast(note) {
  // Remove existing toast
  const existing = document.getElementById("ytd-note-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "ytd-note-toast";
  toast.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 6px; color: ${DIGEST_BLUE};">📝 ${UI.uiCopy("savedToastTitle")}</div>
    <div style="font-size: 12px; color: #6b6258; margin-bottom: 8px;">${escapeHtmlForContent(note.timestamp)} — ${escapeHtmlForContent(note.videoTitle)}</div>
    <div style="font-size: 13px; line-height: 1.55; color: #2e2a24;">"${escapeHtmlForContent(note.text)}"</div>
    <div style="margin-top: 10px; font-size: 11px;">
      <a href="${escapeHtmlForContent(note.timestampedUrl)}" style="color: ${DIGEST_BLUE}; font-weight: 600; text-decoration: none;">🔗 ${UI.uiCopy("copyLink")}</a>
    </div>
  `;

  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    background: #ffffff;
    border: 1px solid #ece5d9;
    border-radius: 14px;
    padding: 16px 20px;
    max-width: 350px;
    box-shadow: 0 12px 32px rgba(50, 42, 32, 0.2);
    font-family: system-ui, -apple-system, "Roboto", sans-serif;
    animation: ytdSlideIn 0.3s ease;
  `;

  // Add animation keyframes
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ytdSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // Copy link handler
  toast.querySelector("a").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(note.timestampedUrl);
      e.target.textContent = "✓ Copied!";
    } catch (err) {
      console.error("Copy failed:", err);
    }
  });

  document.body.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toast.style.animation = "ytdSlideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============================================================
// VIDEO INFO EXTRACTION
// ============================================================

/**
 * Reads the video title, channel name, and description directly from YouTube's page.
 * These are just sitting in the HTML — we grab them from the DOM elements.
 */
function extractVideoInfo() {
  // The video title is in an h1 element inside the #title container
  const titleElement = document.querySelector(
    "h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string",
  );

  // The channel name is in the channel info section
  const channelElement = document.querySelector(
    "#channel-name yt-formatted-string a, ytd-channel-name yt-formatted-string a",
  );

  // Video duration from the video element
  const videoElement = document.querySelector("video.html5-main-video");

  // Video description — YouTube has this in a few possible places
  const descriptionElement = document.querySelector(
    "#description-inner, " +
      "ytd-watch-metadata #description yt-attributed-string, " +
      "#description yt-formatted-string, " +
      "ytd-expander#description yt-attributed-string",
  );

  return {
    title: titleElement?.textContent?.trim() || "",
    channelName: channelElement?.textContent?.trim() || "",
    duration: videoElement?.duration || 0,
    currentTime: videoElement?.currentTime || 0,
    description: descriptionElement?.textContent?.trim() || "",
  };
}

// 从 watch 页 HTML 的脚本中取 ytInitialPlayerResponse。不能直接读取页面全局变量：
// MV3 content script 运行在 isolated world；重新请求当前同源页面既能带登录态，也不
// 需要向扩展申请额外主机权限。
function extractInitialPlayerResponse(html) {
  const source = String(html || "");
  const marker = /ytInitialPlayerResponse\s*=\s*/g;
  const hit = marker.exec(source);
  if (!hit) throw new Error("当前页面没有公开播放器字幕信息。");
  const start = source.indexOf("{", hit.index + hit[0].length);
  if (start < 0) throw new Error("播放器字幕信息格式无效。");

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
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error("播放器字幕信息不完整。");
}

function publicCaptionTracks(playerResponse, expectedVideoId) {
  if (playerResponse?.videoDetails?.videoId !== expectedVideoId) {
    throw new Error("YouTube 返回了另一个视频的播放器信息。");
  }
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return (Array.isArray(tracks) ? tracks : []).map((track) => ({
    baseUrl: String(track?.baseUrl || ""),
    languageCode: String(track?.languageCode || ""),
    name: String(track?.name?.simpleText || track?.name?.runs?.map((run) => run?.text || "").join("") || ""),
    kind: track?.kind === "asr" ? "asr" : "",
    isTranslatable: track?.isTranslatable === true,
  })).filter((track) => track.baseUrl && track.languageCode);
}

async function getLocalYouTubeCaptionTracks(videoIdInput) {
  const videoId = String(videoIdInput || "").trim();
  const currentVideoId = new URLSearchParams(location.search).get("v") || "";
  if (!videoId || videoId !== currentVideoId) {
    throw new Error("当前标签页不是所请求的 YouTube 视频。");
  }
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  const response = await fetch(url.toString(), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`YouTube 页面请求失败：HTTP ${response.status}`);
  const tracks = publicCaptionTracks(extractInitialPlayerResponse(await response.text()), videoId);
  if (!tracks.length) throw new Error("该 YouTube 视频没有公开字幕轨。");
  return tracks;
}

// ============================================================
// PROGRESS BAR KEY MOMENTS
// ============================================================

/**
 * Adds colored marker dots to YouTube's video progress bar
 * at the positions of key moments identified by the AI provider.
 *
 * How it works:
 * - YouTube's progress bar is a <div> element with a known class
 * - We calculate each moment's position as a percentage of total duration
 * - We inject small colored <div> elements at those positions
 * - The markers are absolutely positioned on top of the progress bar
 *
 * This is a "bonus feature" — it gives you a visual preview
 * of where the good stuff is in the video.
 */
function highlightKeyMoments(moments, videoDuration) {
  // Disabled: no timeline markers. Chapters live only in the side panel.
  return;
}

// ============================================================
// SEEK TO TIMESTAMP
// ============================================================

/**
 * Jumps the YouTube video to a specific timestamp (in seconds).
 * This is called when the user clicks a timestamp in the side panel.
 *
 * We simply set the video element's .currentTime property,
 * which is the standard HTML5 way to seek in a video.
 */
function seekToTimestamp(seconds) {
  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[YouTube Digest Content] No video element found for seek");
    return;
  }

  debugLog("[YouTube Digest Content] Seeking to:", seconds);
  video.currentTime = seconds;
  // Also play the video if it's paused
  if (video.paused) {
    video.play().catch(() => {}); // Ignore autoplay errors
  }
}

function escapeHtmlForContent(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function removeInjectedControls() {
  document
    .querySelectorAll("#ytd-digest-button")
    .forEach((button) => button.remove());
  document.getElementById("ytd-note-button")?.remove();
  document.getElementById("ytd-note-toast")?.remove();
  ytdDigestButton = null;
  ytdNoteButton = null;
  clearTimeout(digestButtonReconcileTimer);
  digestButtonReconcileTimer = null;
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = null;
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }
  if (controlsHealthTimer) {
    clearInterval(controlsHealthTimer);
    controlsHealthTimer = null;
  }
}

// ============================================================
// PAGE NAVIGATION DETECTION
// ============================================================

/**
 * YouTube is a "Single Page Application" (SPA). This means when you
 * click on a new video, the page doesn't fully reload — YouTube
 * dynamically swaps out the content. So our content script stays alive
 * but needs to detect when the video changes.
 *
 * We watch for URL changes using the `yt-navigate-finish` event,
 * which YouTube fires after navigation completes. When that happens,
 * we clean up old markers and re-inject the button.
 */
document.addEventListener("yt-navigate-finish", () => {
  // Clean up old key moment markers when navigating to a new video
  const existingMarkers = document.querySelectorAll(".ytd-key-moment-markers");
  existingMarkers.forEach((m) => m.remove());

  // Remove old buttons (they will be re-injected for the new video)
  document
    .querySelectorAll("#ytd-digest-button")
    .forEach((button) => button.remove());
  ytdDigestButton = null;
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
    digestButtonReconcileTimer = null;
  }

  const existingNoteButton = document.getElementById("ytd-note-button");
  if (existingNoteButton) existingNoteButton.remove();

  // Reset note button state
  ytdNoteButton = null;
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = null;
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  // Remove any toasts
  const existingToast = document.getElementById("ytd-note-toast");
  if (existingToast) existingToast.remove();

  // Re-inject buttons for the new video (with a small delay for YouTube to render)
  setTimeout(() => {
    if (siteEnabled) {
      scheduleDigestButtonReconciliation(0);
      tryInjectNoteButton();
    }
  }, 500);
});
