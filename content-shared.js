/**
 * Video Assistant — 两站（B 站 / YouTube）共用的按钮 UI 库。
 *
 * 注入方式：manifest 的两个 content_scripts entry 都把本文件排在站点脚本之前，
 * 同一 isolated world 里后加载的 content-bilibili.js / content-youtube.js 直接用
 * globalThis.VideoAssistantUI。不要在站点脚本里再复制这些函数——按钮长相的
 * 唯一事实源在这里，改一次两站同时生效。
 *
 * 品牌纪律（两次返工换来的约定）：
 * 1. Digest 按钮的图标必须是扩展真实品牌图形 icons/tab-assistant-video-icon.svg，
 *    经 chrome.runtime.getURL 引用（manifest web_accessible_resources 白名单两站都开），
 *    绝不内联矢量路径、绝不手绘近似线条图标。
 * 2. 图标即按钮本体：透明 icon-only 壳，无边框无底色，尺寸 = 图标尺寸。
 * 3. 逐个节点建 SVG 而非 innerHTML：站点若启用 Trusted Types，innerHTML 会被拦。
 */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const BRAND_ICON_PATH = "icons/tab-assistant-video-icon.svg";
  const DIGEST_ICON_SIZE = 28;

  // ============================================================
  // 注入 UI 的界面语言。content 脚本读不到 chrome.storage（TRUSTED_CONTEXTS），
  // 初始语言由站点脚本经 getUiLanguage 消息取来后调 setUiLanguage 写入这里；
  // 之后 options 切语言 → background 广播 uiLanguageChanged → 站点脚本再调
  // setUiLanguage。uiCopy(key) 取当前语言文案，未设置时一律回退中文（与
  // 侧边栏默认一致）。
  // ============================================================
  const COPY_ZH = {
    noteLabel: "手记",
    noteTitle: "在当前时间点记一条手记（含视频截图，快捷键 n）",
    noteTitleNoShot: "在当前时间点记一条手记（快捷键 n）",
    openSidePanel: "打开 Video Assistant 侧边栏",
    clickToolbarHint: "请点工具栏图标 →",
    saving: "保存中…",
    saved: "已保存",
    saveFailed: "保存失败",
    savedToastTitle: "手记已保存",
    copyLink: "复制链接",
  };
  const COPY_EN = {
    noteLabel: "Note",
    noteTitle: "Save a note at the current timestamp (with screenshot, press n)",
    noteTitleNoShot: "Save a note at the current timestamp (press n)",
    openSidePanel: "Open the Video Assistant side panel",
    clickToolbarHint: "Click the toolbar icon →",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Save failed",
    savedToastTitle: "Note saved",
    copyLink: "Copy link",
  };
  let uiLanguage = "zh-CN";

  function setUiLanguage(language) {
    uiLanguage = language === "en" ? "en" : "zh-CN";
  }

  function getUiLanguage() {
    return uiLanguage;
  }

  function uiCopy(key) {
    const table = uiLanguage === "en" ? COPY_EN : COPY_ZH;
    return table[key] ?? COPY_ZH[key] ?? key;
  }

  // 便签 + 笔。跟侧边栏笔记页用的是同一个图形（sidepanel.html 的雪碧图 #i-note）。
  const NOTE_ICON_PATHS = [
    "M8.6 2.4H4.1c-.6 0-1.1.5-1.1 1.1v8.9c0 .6.5 1.1 1.1 1.1h6.2c.6 0 1.1-.5 1.1-1.1V7.9",
    "M11.2 2.2a1.4 1.4 0 0 1 2 2L9.1 8.3l-2.5.5.5-2.5Z",
  ];

  function iconFromPaths(paths) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  const noteIcon = () => iconFromPaths(NOTE_ICON_PATHS);

  // Digest 按钮图标：走 chrome.runtime.getURL 拿扩展资源，而不是把 91KB 的
  // 矢量路径内联进 content script——图标换代时只换 SVG 文件，脚本不用动。
  // SVG 1254×1254，浏览器会缩放到 28×28。
  function digestIcon() {
    const img = document.createElement("img");
    try {
      img.src = chrome.runtime.getURL(BRAND_ICON_PATH);
    } catch (error) {
      // 扩展重载后 runtime 失效：返回无 src 的占位图而不是抛异常，
      // 让注入流程的其余部分（按钮结构、事件绑定）继续完成。
      img.remove();
      return document.createElement("span");
    }
    img.alt = "";
    img.width = DIGEST_ICON_SIZE;
    img.height = DIGEST_ICON_SIZE;
    img.style.display = "block";
    return img;
  }

  // 透明 icon-only 按钮：svg 多大按钮就多大，不画任何外围装饰。
  function styleDigestButton(button) {
    button.style.cssText = `display:inline-flex;align-items:center;
       padding:0;border:none;background:transparent;cursor:pointer;
       line-height:0;flex:0 0 auto;align-self:center;`;
  }

  // 打不开侧边栏时的提示。按钮本体只有图标没有文字位，
  // 提示做成短暂浮在图标上方的小气泡，2.6s 后自己走。
  // 两站统一类名 va-digest-hint（合并前 B 站用 bili-digest-hint）。
  const DIGEST_HINT_CLASS = "va-digest-hint";

  function flashDigestHint(button, text) {
    if (!button?.isConnected) return;
    button.querySelector(`.${DIGEST_HINT_CLASS}`)?.remove();
    const hint = document.createElement("span");
    hint.className = DIGEST_HINT_CLASS;
    hint.textContent = text;
    hint.style.cssText = `position:absolute;bottom:calc(100% + 6px);left:50%;
       transform:translateX(-50%);white-space:nowrap;pointer-events:none;
       padding:4px 10px;border-radius:6px;background:rgba(0,0,0,.75);
       color:#fff;font-size:12px;line-height:1.4;z-index:10000;`;
    button.style.position = "relative";
    button.appendChild(hint);
    setTimeout(() => hint.remove(), 2600);
  }

  // 手记按钮的胶囊样式（两站同一份）：白字深色半透明底 + 全圆角 + 细白边，
  // 播放器画面上高对比可读。hover 常量一并导出，站点侧 mouseenter/leave 用。
  // 合并前历史：B 站曾是 #168cff 蓝底（后被站点自己覆盖成深色），YT 曾是
  // rgba(0,0,0,.56)——现在统一为这份。
  const NOTE_BG = "rgba(0,0,0,.55)";
  const NOTE_BG_HOVER = "rgba(0,0,0,.72)";
  const NOTE_SHADOW = "0 4px 14px rgba(0,0,0,.3)";
  const NOTE_SHADOW_HOVER = "0 6px 18px rgba(0,0,0,.35)";

  function styleNoteButton(button) {
    button.style.cssText = `
      display:inline-flex;align-items:center;gap:6px;
      padding:8px 16px;border:1px solid rgba(255,255,255,.22);
      border-radius:999px;background:${NOTE_BG};color:#fff;
      font-size:13px;font-weight:600;line-height:1.4;
      letter-spacing:.2px;white-space:nowrap;cursor:pointer;
      box-shadow:${NOTE_SHADOW};
      transition:background .18s ease,box-shadow .18s ease,transform .18s ease;
    `;
  }

  // hover 加深 + 轻微上浮。两站同款（合并前只有 YT 有 hover）。
  function bindNoteHover(button) {
    button.addEventListener("mouseenter", () => {
      button.style.background = NOTE_BG_HOVER;
      button.style.boxShadow = NOTE_SHADOW_HOVER;
      button.style.transform = "translateY(-1px)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = NOTE_BG;
      button.style.boxShadow = NOTE_SHADOW;
      button.style.transform = "translateY(0)";
    });
  }

  // 手记按钮的文案 span：保存反馈只换这里的字，图标留在原处。
  function noteLabel(text, className) {
    const label = document.createElement("span");
    label.className = className;
    label.textContent = text;
    return label;
  }

  // 保存反馈：只改 label 文案，delay 后还原。图标和按钮结构完全不动。
  function flashNoteLabel(button, labelClass, text, revertText, delay = 1800) {
    const label = button?.querySelector(`.${labelClass}`);
    if (!label) return;
    label.textContent = text;
    setTimeout(() => {
      if (button.isConnected) label.textContent = revertText;
    }, delay);
  }

  // 用户在弹幕框 / 搜索框 / 评论框里打字时，n 是普通字符，不能抢。
  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      target.isContentEditable === true
    );
  }

  // 语言切换时刷新已注入的手记按钮（label 文案 + title）。
  // 站点脚本收到 uiLanguageChanged 后调 setUiLanguage + 本函数；
  // 按钮不存在时静默跳过（下一次注入自然用新语言）。
  function refreshNoteButtonLanguage(labelClass, titleKey) {
    for (const label of document.querySelectorAll(`.${labelClass}`)) {
      label.textContent = uiCopy("noteLabel");
      const owner = titleKey && label.closest("button");
      if (owner) owner.title = uiCopy(titleKey);
    }
  }

  // 只在 96×54 的缩略采样上做灰度统计，约 5 千像素；避免对 840px 截图
  // 做整图分析。返回值随手记一起保存，后台生成 AI 笔记时据此过滤空白、
  // 纯黑、严重模糊以及低信息过场帧。
  function analyzeImagePixels(rgba, width, height) {
    return globalThis.BILI_VISUAL_MEMOS?.analyzeImagePixels(rgba, width, height) || null;
  }

  function analyzeVideoFrame(video, { width = 96, height = 54 } = {}) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);
      return analyzeImagePixels(ctx.getImageData(0, 0, width, height).data, width, height);
    } catch (error) {
      return null;
    }
  }

  globalThis.VideoAssistantUI = {
    BRAND_ICON_PATH,
    DIGEST_HINT_CLASS,
    NOTE_BG,
    NOTE_BG_HOVER,
    NOTE_SHADOW,
    NOTE_SHADOW_HOVER,
    styleNoteButton,
    bindNoteHover,
    DIGEST_ICON_SIZE,
    digestIcon,
    styleDigestButton,
    flashDigestHint,
    noteIcon,
    noteLabel,
    flashNoteLabel,
    isTypingTarget,
    setUiLanguage,
    getUiLanguage,
    uiCopy,
    COPY_KEYS: Object.keys(COPY_ZH),
    refreshNoteButtonLanguage,
    analyzeImagePixels,
    analyzeVideoFrame,
  };
})();
