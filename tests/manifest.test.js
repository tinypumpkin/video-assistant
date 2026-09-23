const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readJson = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const readText = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const manifest = readJson("manifest.json");

test("清单版本与包版本保持一致，确保 Chrome 能识别新构建", () => {
  assert.equal(manifest.version, readJson("package.json").version);
});

test("是一份 MV3 清单", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.version);
  // 侧边栏 API 需要 Chrome 116+。Edge 的版本号跟 Chromium 对齐，同一个门槛
  // 对它一样成立（Edge 自 114 起支持侧边栏）。
  assert.ok(Number(manifest.minimum_chrome_version) >= 116);
  assert.ok(manifest.permissions.includes("scripting"));
});

/**
 * 侧边栏 per-tab：Chrome 默认是窗口级面板，必须对每个标签页显式
 * setOptions({ tabId, enabled }) 才会生成独立的 tab 级面板实例——
 * 切到未启用的标签页自动隐藏、切回启用过的自动恢复、关标签页面板随
 * 之销毁、每个标签页的面板 state 互不串台。这是用户 4 项需求的根基。
 * 图标点击交给浏览器内建的 openPanelOnActionClick；它会使用当前标签页已生效
 * 的配置，避免手写 open 与异步 setOptions 抢时序。
 */
test("侧边栏 per-tab：按标签页 URL 启用，图标点击使用浏览器内建打开行为", () => {
  assert.ok(manifest.side_panel?.default_path, "侧边栏路径应当由清单提供");
  assert.ok(manifest.permissions.includes("sidePanel"));

  const source = readText("background.js");
  // 每个标签页独立启用：setOptions 必须带 tabId（不是窗口级全局调用），
  // 且按 URL 判断（视频页 enabled、其他页 disabled）
  assert.match(
    source,
    /setOptions\(\{[\s\S]{0,80}enabled:\s*Boolean\(video\)/,
    "按标签页 URL 启用面板，否则仍是窗口级",
  );
  assert.match(source, /tabs\.onUpdated\.addListener/);
  assert.match(source, /isVideoUrl/);
  // 工具栏图标由浏览器在 tab 配置生效后打开，避免手写 open 与 setOptions 竞态
  assert.match(
    source,
    /setPanelBehavior\(\{\s*openPanelOnActionClick:\s*true\s*\}\)/,
    "工具栏图标应使用 Chrome 官方 side panel 打开行为",
  );
  // 已打开的标签页不重放 onUpdated：安装/启动时补一轮 setOptions
  assert.match(source, /onStartup\.addListener/);
  assert.match(source, /onInstalled\.addListener/);
  assert.doesNotMatch(source, /action\.onClicked\.addListener/);
});

test("扩展更新和跨标签页切换会恢复内容脚本，并在打开前配置目标侧栏", () => {
  const background = readText("background.js");
  const youtube = readText("content-youtube.js");
  const bilibili = readText("content-bilibili.js");

  assert.match(background, /function ensureContentScriptForTab\(/);
  assert.match(background, /videoAssistantContentScriptPing/);
  assert.match(background, /files:\s*\[[\s\S]{0,120}"content-shared\.js"/);
  assert.match(background, /tabs\.onActivated\.addListener/);
  assert.match(background, /changeInfo\.status !== "complete"/);
  for (const source of [youtube, bilibili]) {
    assert.match(source, /videoAssistantContentScriptPing/);
    assert.match(source, /CONTENT_SCRIPT_VERSION/);
  }

  const openHandler = background.slice(
    background.indexOf("async function handleOpenSidePanel"),
    background.indexOf("chrome.runtime.onMessage.addListener"),
  );
  assert.ok(
    openHandler.indexOf("chrome.sidePanel.setOptions") < openHandler.indexOf("chrome.sidePanel.open"),
    "目标 tab 的侧栏配置必须先于 open 发起",
  );
  assert.match(openHandler, /Promise\.all\(\[configuring, opening\]\)/);
});

test("侧栏冷启动立即显示静态骨架，重型 Mermaid 按需加载", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  assert.match(html, /id="loadingState" class="state">/);
  assert.doesNotMatch(html, /src="vendor\/mermaid\.min\.js"/);
  assert.match(sidepanel, /function ensureMermaidLibrary\(/);
  assert.match(sidepanel, /chrome\.runtime\.getURL\("vendor\/mermaid\.min\.js"\)/);
  assert.match(sidepanel, /initializeSidepanel\(\)\.catch\(showStartupError\)/);
});

test("同一份清单能投 Chrome 应用商店和 Edge 加载项", () => {
  // 这两条都是 Edge 认证会直接打回的硬性要求。
  assert.equal(manifest.update_url, undefined, "商店版清单不能带 update_url");
  for (const field of [manifest.name, manifest.description]) {
    assert.doesNotMatch(field, /chrome/i, "名称和描述里不能出现 Chrome");
  }
});

test("描述不超过 132 字符，且不宣传尚未实现的功能", () => {
  // 商店对这个字段有 132 字符的硬上限，超了要等到上传那一刻才报错。
  assert.ok(manifest.description.length > 0);
  assert.ok(
    manifest.description.length <= 132,
    `描述有 ${manifest.description.length} 字符，超过商店 132 的上限`,
  );

  // 描述先于实现出现，就是在向用户承诺一个装完找不到的功能。
  // 认这个消息名而不是「translat」这几个字母：注释里提一句翻译不算接线。
  const translationWired = readText("sidepanel.js").includes("translateSegments");
  if (!translationWired) {
    for (const field of [manifest.description, readJson("package.json").description]) {
      assert.doesNotMatch(
        field,
        /bilingual|translation/i,
        "双语翻译尚未接线，描述里不应出现",
      );
    }
  }
});

/**
 * 清单里但凡引用了不存在的文件，浏览器就整个拒绝加载扩展，
 * 而且报错信息经常只指向清单本身。这条测试把问题提前暴露在命令行里。
 */
test("清单引用的每个文件都真实存在", () => {
  const referenced = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.options_ui?.page,
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);

  assert.ok(referenced.length > 0);
  for (const file of referenced) {
    assert.ok(exists(file), `清单引用了不存在的文件：${file}`);
  }
});

test("service worker importScripts 的依赖都存在", () => {
  const source = readText(manifest.background.service_worker);
  const block = source.match(/importScripts\(([\s\S]*?)\);/);
  assert.ok(block, "background.js 应通过 importScripts 引入依赖");

  const files = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(files.includes("settings.js"));
  for (const file of files) {
    assert.ok(exists(file), `importScripts 引用了不存在的文件：${file}`);
  }
});

test("YouTube 本地字幕在当前页面 MAIN world 请求，并支持单选字幕来源", () => {
  const source = readText("background.js");
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /world:\s*"MAIN"/);
  assert.match(source, /localCaptionSource/);
  // 本地获取唯一路径：钩子捕获播放器自己的 /api/timedtext 响应（带 pot）。
  assert.match(source, /timedtext-hook/);
  assert.match(source, /loadModule\("captions"\)/);
  assert.match(source, /unloadModule\("captions"\)/);
  // 后台不得再次直连字幕 URL；正文只能来自播放器自己的请求。
  assert.doesNotMatch(source, /api\/timedtext.*toString\(\)/);
});

test("HTML 引用的脚本与样式都存在", () => {
  for (const page of ["sidepanel.html", "options.html"]) {
    const html = readText(page);
    const assets = [
      ...[...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ];
    assert.ok(assets.length > 0, `${page} 应引用脚本或样式`);
    for (const asset of assets) {
      assert.ok(exists(asset), `${page} 引用了不存在的文件：${asset}`);
    }
  }
});

test("侧栏与设置页共用 Tab Assistant 风格的可访问下拉组件", () => {
  const sidepanel = readText("sidepanel.html");
  const options = readText("options.html");
  const script = readText("custom-select.js");
  const css = readText("custom-select.css");
  for (const html of [sidepanel, options]) {
    assert.match(html, /href="custom-select\.css"/);
    assert.match(html, /src="custom-select\.js"/);
  }
  assert.match(script, /MutationObserver/, "动态生成的设置页 select 也会自动增强");
  assert.match(script, /aria-haspopup/);
  assert.match(script, /role", "listbox"/);
  assert.match(script, /new Event\("change", \{ bubbles: true \}\)/, "沿用原有 change 业务事件");
  assert.match(script, /ArrowDown/);
  assert.match(script, /Escape/);
  assert.match(css, /\.custom-select__option\[aria-selected="true"\]/);
  assert.match(css, /assets\/icons\/check\.svg/);
  assert.match(css, /assets\/icons\/chevron-down\.svg/);
});

test("下拉菜单始终向下展开，菜单自身滚动不触发关闭", () => {
  const script = readText("custom-select.js");
  // 方向：不再有向上展开的自适应逻辑（below < menuHeight && above > below）
  assert.doesNotMatch(
    script,
    /openAbove/,
    "菜单应始终向下展开，去掉向上自适应（用户预期下拉）",
  );
  assert.match(script, /始终向下展开/);
  // 底部空间不足时收缩菜单高度（overflow-y:auto 内部滚动），而不是向上弹
  assert.match(script, /maxHeight = Math\.min\(260, Math\.max\(40, below\)\)/);
  // 滚轮：菜单自身滚动（scroll 事件 target 在菜单/包装器内）不能触发 close
  assert.match(script, /openController\.menu\.contains\(target\)/);
  assert.match(script, /openController\.wrapper\.contains\(target\)/);
});

test("打包白名单包含下拉组件及其图标资源", () => {
  const script = readText("scripts/package.sh");
  for (const file of [
    "custom-select.css",
    "custom-select.js",
    "assets/icons/check.svg",
    "assets/icons/chevron-down.svg",
  ]) {
    assert.ok(script.includes(file), `打包白名单遗漏 ${file}`);
  }
  assert.match(script, /matchAll\(\/url\\\(/, "打包自检会继续校验 CSS 的 url() 依赖");
});

test("字幕服务商使用单一下拉框，默认本地并可切换 API", () => {
  const html = readText("options.html");
  const script = readText("options.js");
  const settings = readText("settings.js");
  const background = readText("background.js");
  assert.doesNotMatch(html, /id="addCaptionProviderBtn"/);
  assert.match(html, /id="saveCaptionProvidersBtn"/);
  assert.match(html, /id="captionProviderList"/);
  assert.match(script, /renderCaptionProviders/);
  assert.doesNotMatch(script, /moveCaptionProvider/);
  assert.doesNotMatch(script, /wireCaptionProviderDrag/);
  assert.match(script, /saveCaptionProviders/);
  assert.match(settings, /captapi/);
  assert.match(settings, /transcriptfetch/);
  assert.match(settings, /transcriptapi/);
  assert.match(background, /fetchTranscriptWithFallback/);
  assert.match(settings, /id: "local"/);
  assert.match(background, /readYouTubeCaptionTracks/);
  assert.match(readText("content-youtube.js"), /getYouTubeCaptionTracks/);
});

test("模型配置保存按钮使用明确文案", () => {
  const html = readText("options.html");
  const script = readText("options.js");
  assert.match(html, /id="saveBtn"[^>]*>保存模型配置</);
  assert.match(script, /"保存模型配置":\s*"Save model configuration"/);
});

test("设置页提供默认全开的双站点适用范围开关", () => {
  const html = readText("options.html");
  const script = readText("options.js");
  const background = readText("background.js");
  assert.match(html, /适用范围/);
  assert.match(html, /id="youtubeEnabled"[^>]*checked/);
  assert.match(html, /id="bilibiliEnabled"[^>]*checked/);
  assert.match(script, /saveSiteScope/);
  assert.match(background, /isSiteEnabled/);
  assert.match(background, /siteScopeChanged/);
});

test("面向用户的网站名称统一为 Bilibili", () => {
  for (const file of [
    "manifest.json",
    "options.html",
    "sidepanel.html",
    "README.md",
    "PRIVACY.md",
  ]) {
    const text = readText(file);
    assert.doesNotMatch(text, /B\s*站|哔哩哔哩/, `${file} 仍有旧网站名称`);
  }
});

test("界面语言会保存、广播到侧栏，并隔离不同语言的概览缓存", () => {
  const options = readText("options.js");
  const background = readText("background.js");
  const sidepanel = readText("sidepanel.js");
  assert.match(options, /notifyUiLanguageChanged/);
  assert.match(options, /\{ \.\.\.current, uiLanguage \}/);
  assert.match(background, /uiLanguageChanged/);
  assert.match(background, /cachedLanguage === analysisLanguage/);
  assert.match(sidepanel, /applySidepanelLanguage/);
  assert.match(sidepanel, /state\.analysisLanguage !== state\.uiLanguage/);
});

test("字幕补齐中 pill：标志在落库时带上，收尾时无条件清除", () => {
  const background = readText("background.js");
  // 落库时带标志（仅 needsEnrich 时）
  assert.ok(
    background.includes("...(needsEnrich ? { pendingTranscript: true } : {})"),
    "memo 对象按 needsEnrich 条件携带 pendingTranscript",
  );
  // 收尾无条件清标志（finally 块），失败也不能永远转圈
  const enrichFn = background.slice(
    background.indexOf("async function enrichMemoInBackground"),
    background.indexOf("/** 清除等待字幕标志"),
  );
  assert.ok(/finally\s*\{/.test(enrichFn), "enrichMemoInBackground 必须有 finally 收尾");
  assert.ok(
    enrichFn.includes("clearPendingTranscript(memo.id)"),
    "finally 里清除 pendingTranscript",
  );
  // 侧边栏按标志渲染 pill
  const sidepanel = readText("sidepanel.js");
  assert.ok(
    sidepanel.includes('memo.pendingTranscript') &&
      sidepanel.includes("note-pending-transcript") &&
      sidepanel.includes("字幕补齐中…"),
    "renderMemoCard 按 pendingTranscript 渲染 pill",
  );
  // 中英文案都在字典里
  assert.ok(
    sidepanel.includes('"字幕补齐中…": "Fetching transcript…"'),
    "i18n 字典含 pill 文案",
  );
});

test("四个 tab 的 panel-toolbar 都是滚动容器的直接子级，sticky 吸顶不失效", () => {
  const html = readText("sidepanel.html");
  const css = readText("sidepanel.css");
  // CSS 吸顶意图
  assert.ok(css.includes(".panel-toolbar {"), "panel-toolbar 样式存在");
  const rule = css.slice(css.indexOf(".panel-toolbar {"), css.indexOf("}", css.indexOf(".panel-toolbar {")));
  assert.ok(rule.includes("position: sticky") && rule.includes("top: 0"), "工具栏 sticky 吸顶");

  // 每个面板的第一层 .panel-toolbar 必须是 section 直接子级。
  // sticky 的参考系是最近的可滚动祖先，但作用范围限于父容器盒子——
  // 套在中间 div（旧 #overviewResult）里时，工具栏只能在该 div 顶部
  // 粘住，随内容一起被滚出视口。
  const panelIds = ["transcriptPanel", "overviewPanel", "notesPanel", "chatPanel"];
  for (const id of panelIds) {
    const start = html.indexOf(`<section id="${id}"`);
    assert.ok(start >= 0, `${id} 存在`);
    const end = html.indexOf("</section>", start);
    const panel = html.slice(start, end);
    const firstToolbar = panel.indexOf('<div class="panel-toolbar');
    assert.ok(firstToolbar >= 0, `${id} 有工具栏`);
    // 向上回溯到 8px 缩进的直接父级（section 内直接子元素缩进一致）
    const before = panel.slice(0, firstToolbar);
    const lastSectionTag = before.lastIndexOf("<section");
    const lastDivClose = before.lastIndexOf("</div>");
    const lastDivOpen = before.lastIndexOf("<div");
    const wrapped = lastDivOpen > lastSectionTag && lastDivOpen > lastDivClose;
    assert.ok(
      !wrapped,
      `${id} 的工具栏是 section 直接子级（不能包在中间 div 里，否则 sticky 失效）`,
    );
  }

  // 概览的显隐同步：overviewToolbar 跟 overviewResult 同进退
  const js = readText("sidepanel.js");
  const shows = js.match(/el\("overviewResult"\)\.hidden = false;\s*\n\s*el\("overviewToolbar"\)\.hidden = false;/g) || [];
  const hides = js.match(/el\("overviewResult"\)\.hidden = true;\s*\n\s*el\("overviewToolbar"\)\.hidden = true;/g) || [];
  assert.ok(shows.length >= 1 && hides.length >= 2, "概览工具栏与结果区同显隐");
});

test("手记乐观保存：带截图先落库，字幕后台补齐不再卡「保存中…」", () => {
  const background = readText("background.js");
  // 保存路径上不得再同步等字幕——YT 字幕冷启动（第三方服务商串行）
  // 要数秒到数十秒，等它会让按钮卡在「保存中…」很久。
  const saveFn = background.slice(
    background.indexOf("async function handleSaveMemo"),
    background.indexOf("async function enrichMemoInBackground"),
  );
  assert.ok(saveFn.includes("needsEnrich"), "保存路径需要区分是否要后台补字幕");
  assert.ok(
    !saveFn.includes("ensureTranscript"),
    "handleSaveMemo 落库前不得再同步调用 ensureTranscript（字幕移到后台补齐）",
  );
  assert.ok(
    background.includes("async function enrichMemoInBackground"),
    "后台补齐函数必须存在：拉字幕 → 取上下文 → 更新 → noteUpdated 广播",
  );
  // 补齐动作在落库 + noteSaved 广播之后才触发，保证乐观路径先完成。
  const saveCall = saveFn.indexOf("mutateNotes(");
  const enrichCall = saveFn.indexOf("enrichMemoInBackground(");
  assert.ok(saveCall >= 0 && enrichCall > saveCall, "先落库，后补齐");
});

test("两站手记按钮走同一 saveMemo 协议，归进手记而非笔记", () => {
  const bilibili = readText("content-bilibili.js");
  const youtube = readText("content-youtube.js");
  // 两站的页面快捷手记都走 saveMemo + kind:"memo"（侧边栏「手记」tab）
  assert.match(bilibili, /action: "saveMemo"/);
  assert.match(bilibili, /kind: "memo"/);
  assert.match(youtube, /action: "saveMemo"/);
  assert.match(youtube, /kind: "memo"/);
  // 站点脚本不得再走旧 saveNote 链路（侧边栏「存为笔记」的 saveNote 由
  // sidepanel.js 发，不在此限）
  assert.doesNotMatch(youtube, /action: "saveNote"/);
  assert.doesNotMatch(bilibili, /action: "saveNote"/);
  // 两站都带截图尝试（失败各自降级为 null，不挡保存）
  assert.match(bilibili, /captureVideoFrame\(/);
  assert.match(youtube, /captureVideoFrame\(/);
  // 两站都有连点保护
  assert.match(bilibili, /noteInFlight/);
  assert.match(youtube, /noteInFlight/);
});

test("两站手记按钮胶囊样式来自共享库，白字深色底", () => {
  const bilibili = readText("content-bilibili.js");
  const youtube = readText("content-youtube.js");
  const shared = readText("content-shared.js");
  // 胶囊底色的唯一事实源在共享库
  assert.match(shared, /NOTE_BG = "rgba\(0,0,0,\.55\)"/);
  assert.match(shared, /NOTE_BG_HOVER = "rgba\(0,0,0,\.72\)"/);
  assert.match(shared, /color:#fff/);
  assert.match(shared, /border-radius:999px/);
  // 两站都调用共享库，不再自带本地胶囊样式
  assert.match(bilibili, /UI\.styleNoteButton\(/);
  assert.match(youtube, /UI\.styleNoteButton\(/);
  // 旧蓝色底已清除（合并前 B 站遗留死代码）
  assert.doesNotMatch(bilibili, /DIGEST_BLUE/);
  assert.doesNotMatch(youtube, /NOTE_BACKGROUND\s*=/);
});

test("两站按钮 UI 来自同一份共享库，品牌图标只有一份实现", () => {
  const youtube = readText("content-youtube.js");
  const bili = readText("content-bilibili.js");
  const shared = readText("content-shared.js");
  // 两站都引入共享库
  assert.match(youtube, /VideoAssistantUI/);
  assert.match(bili, /VideoAssistantUI/);
  // icon-only 的唯一事实源在 content-shared.js：真实品牌 SVG 经 WAR getURL 引用
  assert.match(shared, /getURL\(BRAND_ICON_PATH\)/);
  assert.match(shared, /DIGEST_ICON_SIZE = 28/);
  assert.match(shared, /background:transparent/);
  assert.match(shared, /line-height:0/);
  assert.match(shared, /DIGEST_HINT_CLASS = "va-digest-hint"/);
  // 站点脚本里不得再有本地实现（防止两份按钮实现再次分叉）
  assert.doesNotMatch(youtube, /getURL\("icons\/tab-assistant-video-icon\.svg"\)/);
  assert.doesNotMatch(bili, /getURL\("icons\/tab-assistant-video-icon\.svg"\)/);
  assert.doesNotMatch(youtube, /ytd-digest-label|ytd-digest-icon/);
  assert.doesNotMatch(youtube, /Click the toolbar icon/);
  assert.doesNotMatch(bili, /function iconFromPaths/);
  assert.doesNotMatch(youtube, /innerHTML[\s\S]*?<svg/);
});

test("YouTube 操作栏延迟或缺失时，Digest 会退到播放器并持续自检", () => {
  const youtube = readText("content-youtube.js");
  assert.match(youtube, /function findPlayerContainer\(/);
  assert.match(youtube, /function setDigestButtonPlacement\(/);
  assert.match(youtube, /Digest button using player fallback/);
  assert.match(youtube, /function setupControlsHealthCheck\(/);
  assert.match(youtube, /CONTROLS_HEALTH_CHECK_MS\s*=\s*1500/);
  assert.match(youtube, /setupControlsHealthCheck\(\);/);
});

test("模型选择使用独立 select，不再受 datalist 当前值过滤", () => {
  const html = readText("options.html");
  const script = readText("options.js");
  assert.doesNotMatch(html, /<datalist/i);
  assert.match(html, /id="aiProviderList"/i);
  assert.match(script, /modelOptions.className\s*=\s*"model-option-select"/);
  assert.match(script, /setModelOptions/);
  assert.match(script, /availableModels/);
});

test("AI 服务支持有序多项、拖动排序与局部密钥掩码", () => {
  const html = readText("options.html");
  const script = readText("options.js");
  const settings = readText("settings.js");
  const background = readText("background.js");
  assert.match(html, /id="addAiProviderBtn"/);
  assert.match(html, /id="aiProviderList"/);
  assert.match(script, /renderAiProviders/);
  assert.match(script, /wireAiProviderDrag/);
  assert.match(script, /moveAiProviderById/);
  assert.match(script, /maskApiKey/);
  assert.match(script, /key\.slice\(0, 2\)/);
  assert.match(script, /key\.slice\(-3\)/);
  assert.match(script, /presetStates/);
  assert.match(script, /const previousPresetId = card\.currentPresetId/);
  assert.match(settings, /normalizeAiProviders/);
  assert.match(background, /尝试下一项 AI 服务/);
});

test("问 AI 需要当前视频，但不以字幕成功为前置条件", () => {
  const sidepanel = readText("sidepanel.js");
  const background = readText("background.js");
  const prompt = readText("prompts/ask.md");
  assert.match(sidepanel, /!state\.site \|\| !state\.bvid/);
  assert.match(background, /只读已经取得的缓存/);
  assert.match(prompt, /回答范围仅限当前视频/);
});

test("问 AI 可按需关联当前视频字幕、概览、AI 笔记和手记", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  const background = readText("background.js");
  assert.match(html, /id="chatContextTranscript"[^>]*checked/);
  assert.match(html, /id="chatContextOverview"[^>]*checked/);
  assert.match(html, /id="chatContextNotes"[^>]*checked/);
  assert.match(html, /id="chatContextMemos"[^>]*checked/);
  assert.doesNotMatch(html, /chatContextAiRecords|关联 AI 记/);
  assert.match(sidepanel, /function chatContextSelection\(/);
  assert.match(sidepanel, /contextSelection:\s*chatContextSelection\(\)/);
  assert.match(background, /function normalizeChatContextSelection\(/);
  assert.match(background, /function notesAsChatContext\(/);
  assert.match(background, /note\.kind === "ai_video_note"/);
  assert.match(background, /function memosAsChatContext\(/);
  assert.match(background, /note\.kind === "memo"/);
  assert.match(background, /memoImages/);
  assert.doesNotMatch(background, /aiRecordsAsChatContext|aiRecordsContext|selectedContext\.aiRecords/);
  assert.match(background, /function handleUpdateNote\(/);
  assert.match(sidepanel, /function beginNoteEdit\(/);
  assert.match(sidepanel, /action:\s*"updateNote"/);
});

test("AI 服务测试探测视觉输入并保存能力，问答按 Provider 能力附加手记图片", () => {
  const options = readText("options.js");
  const settings = readText("settings.js");
  const provider = readText("lib/ai-provider.js");
  const background = readText("background.js");
  assert.match(options, /测试成功：支持视觉输入/);
  assert.match(options, /card\.supportsVision = supportsVision/);
  assert.match(settings, /supportsVision: source\.supportsVision === true/);
  assert.match(provider, /function attachImagesToLastUserMessage/);
  assert.match(background, /settings\.supportsVision[\s\S]{0,160}attachImagesToLastUserMessage/);
});

test("笔记栏目复用安全 Markdown 渲染器", () => {
  const sidepanel = readText("sidepanel.js");
  const css = readText("sidepanel.css");
  assert.match(sidepanel, /BILI_MARKDOWN\.render\(text, note\.text, document\)/);
  assert.match(sidepanel, /BILI_MARKDOWN\.render\(text, memo\.text, document\)/);
  assert.match(css, /\.note \.entry-text\.markdown-body/);
});

test("字幕区与金句均一键存为手记，提示词恢复按钮等宽", () => {
  const script = readText("sidepanel.js");
  const css = readText("sidepanel.css");
  assert.match(script, /function saveTextAsVideoNote/);
  assert.match(script, /className = "ghost-btn segment-save-btn"/);
  assert.match(script, /noteTextForSegment/);
  // 字幕与金句的保存入口都走 asMemo（存为手记）。
  assert.match(script, /asMemo: true/);
  assert.match(script, /action: asMemo \? "saveMemo" : "saveNote"/);
  // 章节的保存入口已剥离，注释与渲染结构一起锚定。
  assert.match(script, /章节的「存为笔记」已按需求剥离/);
  assert.match(script, /card\.append\(head, summary\)/);
  assert.match(css, /\.overview-prompt-reset-actions \.ghost-btn[\s\S]*min-width: 140px/);
});

test("问 AI 安全渲染 Markdown，概览页提供可编辑提示词", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  const background = readText("background.js");
  assert.match(html, /lib\/markdown\.js/);
  assert.match(sidepanel, /BILI_MARKDOWN\.render/);
  assert.match(html, /id="overviewPrompt"/);
  assert.match(html, /id="resetOverviewPromptZhBtn"[^>]*>\s*恢复默认/);
  assert.match(html, /id="resetOverviewPromptEnBtn"[^>]*>\s*Restore default/);
  assert.match(sidepanel, /customPrompt:\s*el\("overviewPrompt"\)/);
  assert.match(sidepanel, /resetOverviewPrompt\("zh-CN"\)/);
  assert.match(sidepanel, /resetOverviewPrompt\("en"\)/);
  assert.match(background, /analysisPrompt === analysisPrompt|cachedPrompt === analysisPrompt/);
});

test("笔记页提供手记和 AI 记两个独立栏目", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  const background = readText("background.js");
  assert.match(html, /id="notesScopeMemo"[^>]*>手记</);
  assert.match(html, /id="notesScopeAi"[^>]*>AI 记</);
  assert.match(sidepanel, /action:\s*"saveMemo"/);
  assert.match(
    sidepanel,
    /message\.role === "assistant" && !message\.error\)/,
    "无视频时 AI 回答也必须显示保存入口",
  );
  assert.match(background, /kind === "ai_note"/);
  assert.match(background, /timestampedUrl:\s*canonicalVideoUrl/);
});

test("笔记页提供 JSON、Markdown 和 CSV 本地导出下拉框", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  assert.match(html, /id="exportNotesFormatSelect"/);
  assert.match(html, /<option value="json">JSON<\/option>/);
  assert.match(html, /<option value="markdown">Markdown<\/option>/);
  assert.match(html, /<option value="csv">CSV<\/option>/);
  assert.match(sidepanel, /function exportNotes\(format\)/);
  assert.match(sidepanel, /function exportNotesFromSelect\(select\)/);
  assert.match(sidepanel, /JSON\.stringify\(/);
  assert.match(sidepanel, /function notesAsMarkdown\(notes\)/);
  assert.match(sidepanel, /function notesAsCsv\(notes\)/);
});

test("笔记仅使用 IndexedDB V2，不再保留 V1 迁移与回退路径", () => {
  const background = readText("background.js");
  const database = readText("lib/note-db.js");
  assert.doesNotMatch(background, /video_digest_notes|NOTES_STORAGE_KEY|migrateLegacy/);
  assert.doesNotMatch(database, /video_digest_notes|migrateLegacy|migrationMeta/);
  assert.match(background, /BILI_NOTE_DB\.listNotes/);
  assert.match(background, /BILI_NOTE_DB\.applyChanges/);
  assert.match(database, /DB_NAME = "video_assistant_notes"/);
  for (const store of ["notes", "assets", "note_assets", "meta"]) {
    assert.match(database, new RegExp(`["']${store}["']`));
  }
  assert.match(database, /exactHash/);
  assert.match(database, /assetSchemaVersion: 1/);
  assert.doesNotMatch(database, /captureAsset[\s\S]{0,300}schemaVersion: 1/);
  assert.match(database, /collectGarbage/);
});

test("笔记范围按本视频、手记、AI 记、全部排列，全部视图汇总所有笔记类型", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  const background = readText("background.js");
  const order = ["notesScopeVideo", "notesScopeMemo", "notesScopeAi", "notesScopeAll"];
  const positions = order.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(sidepanel, /scope:\s*state\.notesScope/);
  assert.match(sidepanel, /function renderAnyNote\(note\)/);
  assert.match(background, /if \(scope === "all"\)/);
  assert.match(background, /\.\.\.pageNotes\(notes\.map\([^\n]+hydrateAiNoteVisualReferences/);
});

test("笔记上限可配置，V2 截图有独立容量线，并在超过 100 条时分页", () => {
  const settings = readText("settings.js");
  const options = readText("options.html");
  const background = readText("background.js");
  const sidepanel = readText("sidepanel.js");
  const html = readText("sidepanel.html");
  assert.match(settings, /noteLimit: Object\.freeze\(\{ min: 1, max: 400, default: 100 \}\)/);
  assert.match(options, /id="noteLimit"[^>]*max="400"/);
  assert.match(readText("lib/note-db.js"), /DEFAULT_ASSET_BUDGET_BYTES = 200 \* 1024 \* 1024/);
  assert.match(background, /function pageNotes\(/);
  assert.match(sidepanel, /const NOTES_PAGE_SIZE = 100/);
  assert.match(html, /id="loadMoreNotesBtn"/);
});

test("AI 视频笔记把手记文字、附近字幕和图片作为同一视觉补充组", () => {
  const background = readText("background.js");
  const provider = readText("lib/ai-provider.js");
  const visualMemos = readText("lib/visual-memos.js");
  const prompt = readText("prompts/note-generation.md");
  assert.match(visualMemos, /memoText:\s*String\(note\.text/);
  assert.match(background, /function visualTranscriptWindow\(/);
  assert.match(background, /memoText:\s*reference\.memoText/);
  assert.match(background, /transcriptWindow:\s*reference\.transcriptWindow/);
  assert.match(provider, /手记文字 \/ Memo text/);
  assert.match(provider, /对应时间点附近字幕 \/ Nearby transcript/);
  assert.match(prompt, /不得跨组关联/);
  assert.match(prompt, /不得把引用集中放在文末/);
  assert.match(background, /relocateCitationMarkers\(/);
});

test("笔记页支持多选删除与按当前范围一键清空", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  const background = readText("background.js");
  for (const id of [
    "toggleNotesDeleteModeBtn",
    "selectVisibleNotesBtn",
    "deleteSelectedNotesBtn",
    "clearCurrentNotesBtn",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(sidepanel, /function deleteSelectedNotes\(/);
  assert.match(sidepanel, /function clearCurrentNotes\(/);
  assert.match(background, /message\?\.action === "deleteNotes"/);
  assert.match(background, /message\?\.action === "clearNotes"/);
  assert.match(background, /function noteMatchesScope\(/);
});

test("侧栏脚本引用的固定节点全部存在，聊天空态不会被消息重绘删除", () => {
  const html = readText("sidepanel.html");
  const sidepanel = readText("sidepanel.js");
  const htmlIds = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
  );
  const referencedIds = new Set(
    [...sidepanel.matchAll(/\bel\("([^"]+)"\)/g)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...referencedIds].filter((id) => !htmlIds.has(id)),
    [],
  );
  assert.match(
    html,
    /id="chatEmpty"[\s\S]*?<\/div>\s*<div id="chatMessages"[^>]*><\/div>/,
  );
  assert.doesNotMatch(sidepanel, /list\.appendChild\(empty\)/);
  assert.ok(
    html.indexOf('id="chatForm"') > html.indexOf('id="chatMessages"'),
    "问 AI 输入框必须位于消息列表下方",
  );
  const css = readText("sidepanel.css");
  assert.match(css, /\.chat-sticky\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;/);
});

test("安装时索要的权限只限两个视频网站与字幕数据源，且全部走 https", () => {
  const hosts = manifest.host_permissions || [];
  assert.ok(hosts.every((host) => host.startsWith("https://")), "不应出现明文 http");

  // 字幕 JSON 托管在 hdslb CDN，漏了它字幕就下载不下来。
  assert.ok(hosts.some((host) => host.includes("api.bilibili.com")));
  assert.ok(hosts.some((host) => host.includes("hdslb.com")));
  assert.ok(hosts.some((host) => host.includes("youtube.com")));
  assert.ok(hosts.some((host) => host.includes("api.supadata.ai")));

  // AI 服务地址由用户自定义，必须留到运行时申请。
  // 一旦有人图省事把它写进 host_permissions，安装时就会索要全网权限。
  for (const host of hosts) {
    assert.match(
      host,
      /bilibili\.com|hdslb\.com|youtube\.com|supadata\.ai/,
      `出现了预期之外的主机权限：${host}`,
    );
  }
});

test("AI 笔记功能栏在范围栏下方保持第二层吸顶", () => {
  const css = readText("sidepanel.css");
  const start = css.indexOf(".ai-note-action-bar {");
  assert.ok(start >= 0, "AI 笔记功能栏样式存在");
  const rule = css.slice(start, css.indexOf("}", start));
  assert.ok(rule.includes("position: sticky"), "功能栏启用 sticky");
  assert.match(rule, /top:\s*40px/, "功能栏避开顶部范围栏");
  assert.match(rule, /z-index:\s*2/, "功能栏有独立堆叠层级");
  assert.match(rule, /background:/, "吸顶时具有不透明度足够的背景遮挡内容");
});

test("自定义 AI 地址走可选权限，且明文 http 只对本机放行", () => {
  const optional = manifest.optional_host_permissions || [];
  assert.ok(optional.length > 0, "缺少 optional_host_permissions，自定义地址会被 CORS 拦下");
  assert.ok(
    optional.includes("https://*/*"),
    "需要 https://*/* 才能在运行时申请任意 https 服务商",
  );

  for (const host of optional) {
    if (!host.startsWith("http://")) continue;
    assert.match(
      host,
      /^http:\/\/(localhost|127\.0\.0\.1)\//,
      `明文 http 只应对本机放行，出现了：${host}`,
    );
  }
});

test("内容脚本只注入两个站点的播放页，不是整个站点", () => {
  const matches = (manifest.content_scripts || []).flatMap((e) => e.matches);
  assert.ok(matches.length > 0);
  for (const pattern of matches) {
    assert.ok(
      /^https:\/\/www\.bilibili\.com\/(video|list)\//.test(pattern) ||
        pattern === "https://www.youtube.com/watch*",
      `内容脚本的匹配范围过宽：${pattern}`,
    );
  }
});

test("侧边栏与设置页的存储读写走同一个 storage key", () => {
  const settings = require("../settings.js");
  assert.equal(settings.STORAGE_KEY, "video_digest_settings");
  for (const file of ["background.js", "options.js"]) {
    assert.match(
      readText(file),
      /BILI_SETTINGS\.STORAGE_KEY/,
      `${file} 应通过 BILI_SETTINGS.STORAGE_KEY 访问存储`,
    );
  }
});

test("问 AI 对话框引入 mermaid 卡片与胶囊输入区结构", () => {
  const html = readText("sidepanel.html");
  const css = readText("sidepanel.css");
  const js = readText("sidepanel.js");

  // 1) mermaid-widget 组件已接线：HTML 引入脚本，调度器委托组件
  assert.ok(html.includes('src="lib/mermaid-widget.js"'), "mermaid-widget 脚本已引入");
  assert.ok(js.includes("window.MermaidWidget?.upgradeMermaidBlocks"), "调度器委托 mermaid 组件");
  assert.ok(css.includes(".mermaid-widget__header"), "mermaid 卡片标题栏样式存在");
  assert.ok(css.includes(".mermaid-btn--copy"), "复制按钮样式存在");

  // 2) 输入区是胶囊卡片（chat-input-card 包裹 textarea）
  const chatForm = html.slice(html.indexOf('id="chatForm"'), html.indexOf("</form>", html.indexOf('id="chatForm"')));
  assert.ok(chatForm.includes('class="chat-input-card"'), "胶囊输入卡包裹输入区");
  const textareaIdx = chatForm.indexOf('id="chatInput"');
  const cardIdx = chatForm.indexOf('class="chat-input-card"');
  assert.ok(textareaIdx > cardIdx, "textarea 在输入卡内部");
  assert.ok(chatForm.includes("输入问题…（Enter 发送）"), "发送提示收进输入框，不再额外占一行");
  assert.ok(!chatForm.includes("chat-composer-footer"), "聊天输入区不保留第二层提示栏");
  assert.ok(css.includes(".chat-composer textarea:focus-visible"), "textarea 不重复绘制内层焦点框");

  // 3) 发送按钮图标化：含 SVG 且不再依赖文字内容
  const sendBtn = html.slice(html.indexOf('id="sendChatBtn"'), html.indexOf("</button>", html.indexOf('id="sendChatBtn"')) + 9);
  assert.ok(sendBtn.includes("<svg"), "发送按钮含 SVG 图标");
  assert.ok(!/primary-btn/.test(sendBtn), "不再使用 primary-btn 文字按钮");
  assert.ok(js.includes('el("sendChatBtn").title'), "状态提示走 title 而非 textContent（保护 SVG）");
});

test("两站注入 UI 文案走共享库语言表，不残留硬编码中文", () => {
  const youtube = readText("content-youtube.js");
  const bili = readText("content-bilibili.js");
  const shared = readText("content-shared.js");

  // 两站注入/反馈文案一律 uiCopy 取词（单一事实源在共享库语言表）
  for (const source of [youtube, bili]) {
    assert.match(source, /UI\.uiCopy\("noteLabel"\)/);
    assert.match(source, /UI\.uiCopy\("saving"\)/);
    assert.match(source, /UI\.uiCopy\("saved"\)/);
    assert.match(source, /UI\.uiCopy\("clickToolbarHint"\)/);
    // 硬编码中文直写注入 UI 被禁止（debugLog 日志除外）
    assert.doesNotMatch(source, /title = "[^"]*[一-龥]/);
    assert.doesNotMatch(source, /flashNoteLabel\([^)]*"[一-龥]/);
    assert.doesNotMatch(source, /noteLabel\("[一-龥]/);
  }

  // 语言表中英 1:1，键集合一致
  assert.match(shared, /COPY_KEYS: Object\.keys\(COPY_ZH\)/);
  // 语言接线：初始取词 + 广播刷新，两站都要有
  for (const source of [youtube, bili]) {
    assert.match(source, /action: "getUiLanguage"/);
    assert.match(source, /uiLanguageChanged/);
    assert.match(source, /UI\.setUiLanguage/);
    assert.match(source, /UI\.refreshNoteButtonLanguage/);
  }
  // background 双通道转发：runtime 广播（扩展页）+ tabs（content 脚本）
  const background = readText("background.js");
  assert.match(background, /action === "getUiLanguage"/);
  assert.match(background, /tabs\.sendMessage/);
});

test("手记/AI 记录按视频过滤：getMemos 透传 site+bvid，后台按视频隔离", () => {
  const background = readText("background.js");
  const sidepanel = readText("sidepanel.js");

  // 后台：getMemos 消息把 site/bvid 透传给 handler
  assert.match(
    background,
    /action === "getMemos"[\s\S]{0,400}site: message\.site[\s\S]{0,60}bvid: message\.bvid/,
  );
  // 后台：handler 传了 bvid 就按 site+bvid 过滤（与 getNotes 同款条件）
  assert.match(background, /bvid \? resolveVideo\(site, bvid\) : null/);
  assert.match(background, /note\.site \|\| "bilibili"\) === resource\.site/);
  assert.match(background, /note\.bvid === resource\.videoId/);

  // 侧边栏：手记/AI 记录加载与导出都带当前视频上下文
  for (const kind of ["memo", "ai_note"]) {
    assert.match(sidepanel, new RegExp(`kind: "${kind}"[\\s\\S]{0,400}site: state\\.site[\\s\\S]{0,80}bvid: state\\.bvid`));
  }
});

test("侧边栏 per-tab 语义：打开按 tabId、进度与按钮广播定向", () => {
  const background = readText("background.js");
  const sidepanel = readText("sidepanel.js");

  // 面板打开按 tabId（不是窗口级 windowId）——多标签页各开各的面板
  assert.match(background, /sidePanel\.open\(\{ tabId: tab\.id \}\)/);
  assert.doesNotMatch(background, /sidePanel\.open\(\{ windowId/);

  // 进度广播带发起任务的 tabId，面板端按归属 tab 过滤
  assert.match(background, /reportProgress\(kind, done, total, tabId\)/);
  assert.match(sidepanel, /message\.tabId != null && message\.tabId !== state\.tabId/);

  // 面板锁定归属标签页（ownerTabId），事件与按钮广播都只响应自己的标签页
  assert.match(sidepanel, /ownerTabId/);
  assert.match(sidepanel, /tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/);
  assert.match(sidepanel, /tabId === state\.ownerTabId/);
  assert.match(sidepanel, /senderTabId !== state\.ownerTabId/);
  // 生成笔记的加载动画是面板实例自身状态（videoNoteGenerating），
  // per-tab 实例隔离后天然只作用于当前标签页。
  assert.match(sidepanel, /videoNoteGenerating/);
});

test("手记保存失败透传明确错误，V2 不再执行旧存储清缓存分支", () => {
  const background = readText("background.js");

  // saveMemo 路由的 catch 必须同时带 error 和 message：UI 两端一个读 error
  // 一个读 message，只放一边会让用户看到笼统的「保存失败」。
  assert.match(
    background,
    /sendResponse\(\{ success: false, error: error\.message, message: error\.message \}\)/,
  );

  assert.doesNotMatch(background, /clearDigestCache|NOTE_STORAGE_SAFE_BYTES|capNotesForStorage/);
  assert.match(background, /BILI_NOTE_DB\.applyChanges/);
});
