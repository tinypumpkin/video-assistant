const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * content script 的注入测试。
 *
 * 加载的是真正的 content-bilibili.js，只把 DOM 和 chrome API 换成桩。重点守三件事：
 * 页面稳定之前一个节点都不许动（动了会让 B 站的 Vue 放弃 hydration、整页重渲染），
 * 浮动按钮不能挂进 <video> 的直接父节点，以及按钮被重渲染删掉之后能补回来。
 *
 * 桩里的 setTimeout 直接转发给真实计时器并把延时压成 0，
 * 这样脚本里那串「等 load、等播放器、再等一会儿」的 await 能在毫秒内走完。
 */

const ROOT = path.join(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "content-bilibili.js"), "utf8");
const YT_SOURCE = fs.readFileSync(path.join(ROOT, "content-youtube.js"), "utf8");
// 共享 UI 库必须先于站点脚本加载，与 manifest 注入顺序一致。
const SHARED_SOURCE = fs.readFileSync(
  path.join(ROOT, "content-shared.js"),
  "utf8",
);

function createDom() {
  const byId = new Map();
  const bySelector = new Map();

  function makeElement(tag = "div") {
    const element = {
      tagName: String(tag).toUpperCase(),
      id: "",
      className: "",
      title: "",
      type: "",
      textContent: "",
      isConnected: true,
      children: [],
      style: { cssText: "", position: "" },
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      appendChild(child) {
        this.children.push(child);
        child.isConnected = true;
        child.parentElement = this;
        if (child.id) byId.set(child.id, child);
        return child;
      },
      append(...nodes) {
        for (const node of nodes) this.appendChild(node);
      },
      remove() {
        this.isConnected = false;
        if (this.id) byId.delete(this.id);
      },
      listeners: {},
      addEventListener(type, handler) {
        (this.listeners[type] ||= []).push(handler);
      },
      // 支持 #id 和 .class 两种形态：前者找 overlay，后者找笔记按钮的文案 span。
      querySelector(selector) {
        const text = String(selector);
        const matches = text.startsWith(".")
          ? (node) => node.className === text.slice(1)
          : (node) => node.id === text.replace(/^#/, "");
        const walk = (node) => {
          for (const child of node.children) {
            if (matches(child)) return child;
            const hit = walk(child);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      // 语言切换刷新按钮时，共享库会用 closest("button") 找 label 的宿主。
      closest(selector) {
        const want = String(selector).replace(/^button$/i, "BUTTON");
        let node = this;
        while (node) {
          if (node.tagName === want) return node;
          node = node.parentElement || null;
        }
        return null;
      },
    };
    return element;
  }

  const document = {
    readyState: "complete",
    title: "测试视频_哔哩哔哩_bilibili",
    createElement: (tag) => makeElement(tag),
    createElementNS: (namespace, tag) => makeElement(tag),
    getElementById: (id) => byId.get(id) || null,
    // 支持逗号组合选择器（YT 脚本常写 "#a.b, #a, .b"）：任一命中即返回。
    querySelector: (selector) => {
      for (const part of String(selector).split(",")) {
        const hit = bySelector.get(part.trim());
        if (hit) return hit;
      }
      return null;
    },
    // YT 脚本初始化时会全量排查重复注入，桩按注册表过滤即可；
    // .class 形态额外做全树搜（共享库刷新按钮文案时用）——document 在下面
    // 才赋值，这里存个引用。
    querySelectorAll: (selector) => {
      const hits = [];
      for (const part of String(selector).split(",")) {
        const text = part.trim();
        const hit = bySelector.get(text);
        if (hit) {
          hits.push(hit);
          continue;
        }
        if (text.startsWith(".")) {
          const cls = text.slice(1);
          // 按钮都带 id 挂在 byId 注册表里，从这全量扫类名最直接。
          for (const node of byId.values()) {
            if (node.className === cls) hits.push(node);
            for (const child of node.children) {
              if (child.className === cls) hits.push(child);
            }
          }
          for (const node of bySelector.values()) {
            if (node.className === cls) hits.push(node);
            for (const child of node.children) {
              if (child.className === cls) hits.push(child);
            }
          }
        }
      }
      return hits;
    },
    addEventListener() {},
  };

  // 播放器已挂上 <video> 是脚本判断「页面稳定了」的条件之一，默认给上。
  // videoWidth/currentTime 给手记截图和锚点用。
  const video = makeElement("video");
  video.videoWidth = 1280;
  video.videoHeight = 720;
  video.currentTime = 323;
  bySelector.set("video", video);

  return {
    document,
    makeElement,
    /** 注册一个能被 document.querySelector(selector) 命中的元素。 */
    register(selector, element = makeElement()) {
      bySelector.set(selector, element);
      return element;
    },
  };
}

/** 让脚本里的 await 链跑完。延时都被压成 0，几个宏任务足够。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

function click(element) {
  const event = { preventDefault() {}, stopPropagation() {} };
  for (const handler of element.listeners.click || []) handler(event);
}

/**
 * 只推进微任务。按钮的临时文案是靠 setTimeout 还原的，而桩把延时压成了 0——
 * 一旦让出宏任务，文案就已经变回去了，什么都测不到。
 */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function start({
  dom,
  href = "https://www.bilibili.com/video/BV1xx411c7mD",
  sendMessage = () => Promise.resolve({ success: true }),
}) {
  const intervals = [];
  const messageListeners = [];
  const context = {
    console,
    // 压成 0：脚本等的是「页面稳定」这个事件顺序，不是具体秒数。
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    getComputedStyle: () => ({ position: "relative" }),
    location: { href, search: "" },
    window: { addEventListener() {} },
    document: dom.document,
    chrome: {
      runtime: {
        sendMessage,
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: { addListener: (fn) => messageListeners.push(fn) },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  // 与浏览器一致：content-shared.js 先注入，站点脚本后注入。
  vm.runInContext(SHARED_SOURCE, context);
  vm.runInContext(SOURCE, context);

  return {
    tick: () => intervals.forEach((fn) => fn()),
    messageListeners,
  };
}

/** 启动脚本并等它走完「页面稳定」的等待链。 */
async function run(options) {
  const handle = start(options);
  await flush();
  return handle;
}

// ============================================================
// YouTube 沙箱：与 B 站 start() 同构，多给 toast 需要的 body/head。
// ============================================================
function startYouTube({
  dom,
  href = "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  sendMessage = () => Promise.resolve({ success: true }),
  fetchImpl,
}) {
  const intervals = [];
  const messageListeners = [];
  const context = {
    console,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval: () => {},
    getComputedStyle: () => ({ position: "relative" }),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    // 站点脚本会用 URLSearchParams 解析 ?v=、new URL() 处理链接。
    URLSearchParams,
    URL,
    fetch: fetchImpl,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    location: { href, pathname: "/watch", search: "?v=jNQXAC9IVRw" },
    window: {
      addEventListener() {},
      location: { pathname: "/watch" },
      getComputedStyle: () => ({ position: "relative" }),
    },
    document: dom.document,
    chrome: {
      runtime: {
        sendMessage,
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: { addListener: (fn) => messageListeners.push(fn) },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SHARED_SOURCE, context);
  vm.runInContext(YT_SOURCE, context);

  return {
    tick: () => intervals.forEach((fn) => fn()),
    messageListeners,
  };
}

async function runYouTube(options) {
  const handle = startYouTube(options);
  await flush();
  return handle;
}

test("两站内容脚本提供版本握手，后台可识别失效或旧版本页面", async () => {
  const bili = await run({ dom: createDom() });
  const youtube = await runYouTube({ dom: createDom() });

  for (const [handle, site] of [[bili, "bilibili"], [youtube, "youtube"]]) {
    let reply;
    for (const listener of handle.messageListeners) {
      listener(
        { action: "videoAssistantContentScriptPing" },
        {},
        (value) => { reply = value; },
      );
      if (reply) break;
    }
    assert.deepEqual(
      JSON.parse(JSON.stringify(reply)),
      { success: true, site, version: "test" },
    );
  }
});

test("YT：从当前 watch 页读取公开字幕轨并校验视频 ID", async () => {
  const dom = createDom();
  const html = `<!doctype html><script>var ytInitialPlayerResponse = ${JSON.stringify({
    videoDetails: { videoId: "jNQXAC9IVRw" },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          baseUrl: "https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en",
          languageCode: "en",
          name: { simpleText: "English" },
          kind: "asr",
        }],
      },
    },
  })};</script>`;
  let requested;
  const handle = await runYouTube({
    dom,
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return { ok: true, async text() { return html; } };
    },
  });
  let reply;
  const keepAlive = handle.messageListeners[0](
    { action: "getYouTubeCaptionTracks", videoId: "jNQXAC9IVRw" },
    {},
    (value) => { reply = value; },
  );
  assert.equal(keepAlive, true);
  await flush();
  assert.equal(reply.success, true);
  assert.equal(reply.tracks[0].languageCode, "en");
  assert.equal(reply.tracks[0].kind, "asr");
  assert.equal(requested.options.credentials, "include");
  assert.equal(new URL(requested.url).searchParams.get("v"), "jNQXAC9IVRw");

  let mismatch;
  handle.messageListeners[0](
    { action: "getYouTubeCaptionTracks", videoId: "different" },
    {},
    (value) => { mismatch = value; },
  );
  await flush();
  assert.equal(mismatch.success, false);
  assert.match(mismatch.error, /当前标签页/);
});

const YT_NOTE_ID = "ytd-note-button";
const YT_NOTE_LABEL = "ytd-note-label";

test("YT：注入后点手记按钮能走通 saveMemo 链路（悬空引用回归）", async () => {
  const dom = createDom();
  // YT 的播放器容器 + YT 的 video 选择器（saveCurrentNote 找这个）
  dom.register("#movie_player");
  const ytVideo = dom.makeElement("video");
  ytVideo.videoWidth = 1280;
  ytVideo.videoHeight = 720;
  ytVideo.currentTime = 323;
  dom.register("video.html5-main-video", ytVideo);
  // toast 需要的 body/head
  dom.document.body = dom.makeElement("body");
  dom.document.head = dom.makeElement("head");
  const sent = [];
  const sendMessage = (message) => {
    sent.push(message);
    return Promise.resolve({
      success: true,
      memo: {
        timestamp: "05:23",
        videoTitle: "测试视频",
        text: "字幕上下文",
        timestampedUrl: "https://youtu.be/x?t=323",
      },
    });
  };

  await runYouTube({ dom, sendMessage });

  const button = dom.document.getElementById(YT_NOTE_ID);
  assert.ok(button, "手记按钮应已注入 #movie_player");
  click(button);
  await settle();

  const save = sent.find((message) => message.action === "saveMemo");
  assert.ok(save, "点击必须发出 saveMemo——此前 NOTE_LABEL_CLASS 悬空引用让第一次点击就静默崩掉");
  assert.equal(save.kind, "memo");
  assert.equal(save.timestamp, 320); // currentTime 323 - 3 秒回退
  // mock 无 canvas → 截图降级 null，不挡保存
  assert.equal(save.imageDataUrl, null);

  // 连点保护：在途时第二次点击不得再发一条
  click(button);
  await settle();
  assert.equal(
    sent.filter((message) => message.action === "saveMemo").length,
    1,
    "在途时第二次点击应被 noteInFlight 吞掉",
  );
});

test("YT：保存失败也要复位 noteInFlight，按钮不能永久锁死", async () => {
  const dom = createDom();
  dom.register("#movie_player");
  const ytVideo2 = dom.makeElement("video");
  ytVideo2.currentTime = 323;
  dom.register("video.html5-main-video", ytVideo2);
  dom.document.body = dom.makeElement("body");
  dom.document.head = dom.makeElement("head");
  let call = 0;
  const sendMessage = (message) => {
    if (message.action !== "saveMemo") {
      return Promise.resolve({ enabled: true });
    }
    call += 1;
    // 第一次 saveMemo 抛错（模拟 service worker 重启窗口），第二次成功
    if (call === 1) return Promise.reject(new Error("worker restarting"));
    return Promise.resolve({ success: true, memo: {} });
  };

  await runYouTube({ dom, sendMessage });
  const button = dom.document.getElementById(YT_NOTE_ID);

  click(button); // 崩掉的一击
  await flush();
  click(button); // 若标志卡死，这次会被静默吞掉
  await settle();

  assert.equal(call, 2, "第一次崩掉后按钮必须还能用——finally 释放标志");
});

const OVERLAY_ID = "bili-digest-overlay";
const DIGEST_ID = "bili-digest-button";
const NOTE_ID = "bili-digest-note-button";

test("页面稳定之前一个节点都不动", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");

  // 只启动、不等待：这一刻相当于 document_idle，B 站的 Vue 可能还没 hydrate 完。
  const { tick } = start({ dom });

  assert.deepEqual(
    toolbar.children,
    [],
    "hydration 之前改 DOM，Vue 会放弃服务端那棵树整页重渲染——视频会加载两遍",
  );
  assert.deepEqual(player.children, []);

  await flush();

  assert.ok(
    toolbar.children.some((child) => child.id === DIGEST_ID),
    "等页面稳定之后总得把按钮放上去",
  );
  assert.ok(tick);
});

test("浮动按钮不会挂进直接包着 <video> 的那一层", async () => {
  const dom = createDom();

  // 模拟 B 站把 <video> 直接放在首选容器里的情形。往这一层插外来节点，
  // 播放器初始化时会推倒重建，表现就是刷新页面后视频加载两遍。
  const videoWrap = dom.register("#bilibili-player .bpx-player-primary-area");
  const video = dom.makeElement("video");
  videoWrap.appendChild(video);

  const safeHost = dom.register("#bilibili-player");

  await run({ dom });

  assert.equal(
    videoWrap.querySelector(`#${OVERLAY_ID}`),
    null,
    "挂在 <video> 的直接父节点上会让播放器重建视频",
  );
  assert.ok(
    safeHost.querySelector(`#${OVERLAY_ID}`),
    "应该退到下一个不抱着 <video> 的容器",
  );
});

test("所有候选容器都抱着 <video> 时，宁可不挂浮动按钮", async () => {
  const dom = createDom();
  for (const selector of [
    "#bilibili-player .bpx-player-primary-area",
    "#bilibili-player",
    ".bpx-player-container",
    "#playerWrap",
  ]) {
    dom.register(selector).appendChild(dom.makeElement("video"));
  }
  const toolbar = dom.register(".video-toolbar-left");

  await run({ dom });

  assert.equal(dom.document.getElementById(NOTE_ID), null, "没有安全的落点就不挂");
  assert.ok(
    toolbar.children.some((child) => child.id === DIGEST_ID),
    "Digest 按钮在工具栏里，不受浮动容器缺失的影响",
  );
});

test("工具栏存在时 Digest 按钮进工具栏，笔记按钮进播放器浮层", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");

  await run({ dom });

  assert.ok(toolbar.children.some((child) => child.id === DIGEST_ID));
  assert.ok(player.querySelector(`#${NOTE_ID}`));
});

test("B站在适用范围中关闭后不注入任何按钮", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");

  await run({
    dom,
    sendMessage: (message) =>
      Promise.resolve(
        message.action === "isSiteEnabled"
          ? { enabled: false }
          : { success: true },
      ),
  });

  assert.deepEqual(toolbar.children, []);
  assert.equal(player.querySelector(`#${OVERLAY_ID}`), null);
});

test("Digest 是透明图标按钮，Note 保持白字深色浮层", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");

  await run({ dom });

  const digest = toolbar.children.find((child) => child.id === DIGEST_ID);
  const note = player.querySelector(`#${NOTE_ID}`);
  // Digest 无底色无描边：svg 即按钮。
  assert.match(digest.style.cssText, /transparent/i);
  assert.doesNotMatch(digest.style.cssText, /#168cff/i);
  // Note 胶囊样式由共享库 styleNoteButton 以 cssText 写入（两站同一份）。
  assert.match(note.style.cssText, /rgba\(0,0,0,\.55\)/);
  assert.match(note.style.cssText, /color:#fff/);
  assert.match(note.style.cssText, /border-radius:999px/);
});

test("笔记按钮带图标，文案单独放一个 span", async () => {
  const dom = createDom();
  dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");

  await run({ dom });

  const button = player.querySelector(`#${NOTE_ID}`);
  assert.deepEqual(
    button.children.map((child) => child.tagName),
    ["SVG", "SPAN"],
  );
  assert.equal(button.children[1].textContent, "手记");
  // 保存反馈改的是这个 span。要是直接写 button.textContent，图标会被一起抹掉。
  assert.ok(button.querySelector(".bili-digest-note-label"));
});

test("点手记按钮发 saveMemo，并弹出包含时间信息与复制链接的保存卡片", async () => {
  const dom = createDom();
  dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");
  const title = dom.register("h1.video-title");
  title.textContent = "B站测试视频";
  dom.document.body = dom.makeElement("body");
  dom.document.head = dom.makeElement("head");
  const sent = [];
  const sendMessage = (message) => {
    sent.push(message);
    if (message.action !== "saveMemo") return Promise.resolve({ success: true });
    return Promise.resolve({
      success: true,
      memo: {
        timestamp: "05:23",
        videoTitle: "B站测试视频",
        text: "字幕上下文",
        timestampedUrl: "https://www.bilibili.com/video/BV1xx411c7mD?t=323",
      },
    });
  };

  await run({ dom, sendMessage });

  const button = player.querySelector(`#${NOTE_ID}`);
  click(button);
  await settle();

  const save = sent.find((message) => message.action === "saveMemo");
  assert.ok(save, "快捷键手记走 saveMemo 而不是 saveNote");
  assert.equal(save.kind, "memo");
  assert.equal(save.timestamp, 323);
  assert.equal(save.videoTitle, "B站测试视频");
  // mock 环境没有 canvas，截图返回 null —— 手记仍应保存，且带文字兜底而不是裸 null 图。
  assert.equal(save.imageDataUrl, undefined);
  assert.match(save.text, /视频截图失败/);
  const legacy = sent.find((message) => message.action === "saveNote");
  assert.equal(legacy, undefined, "不再走旧的 saveNote 链路");

  const toast = dom.document.getElementById("bili-note-toast");
  assert.ok(toast, "保存成功后应在 Bilibili 页面右下角弹出卡片");
  assert.equal(toast.children[0].textContent, "📝 手记已保存");
  assert.equal(toast.children[1].textContent, "05:23 — B站测试视频");
  assert.equal(toast.children[2].textContent, '"字幕上下文"');
  const copyLink = toast.children[3].children[0];
  assert.equal(copyLink.textContent, "🔗 复制链接");
  assert.equal(copyLink.href, "https://www.bilibili.com/video/BV1xx411c7mD?t=323");
});

test("按钮被重渲染删掉后，定时自查会补回来", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  dom.register("#bilibili-player");

  const { tick } = await run({ dom });
  const injected = toolbar.children.find((child) => child.id === DIGEST_ID);
  assert.ok(injected);

  // B 站重渲染工具栏，把我们的按钮一起丢掉。
  injected.remove();
  toolbar.children = [];

  tick();

  assert.ok(
    toolbar.children.some((child) => child.id === DIGEST_ID),
    "重渲染之后按钮没补回来，用户就再也点不开侧边栏了",
  );
});

/**
 * 页面里的按钮靠给 service worker 发消息来开侧边栏，而浏览器要求 open() 发生在
 * 用户手势里。手势能否随消息传过来，Chrome 认，Edge 不一定认。被拒绝时按钮必须
 * 说点什么——一个点了毫无反应的按钮，用户只会当扩展坏了。
 */
test("侧边栏打不开时，Digest 按钮把人指向工具栏图标", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  dom.register("#bilibili-player");

  await run({
    dom,
    sendMessage: () =>
      Promise.resolve({ success: false, needsToolbarClick: true }),
  });

  const button = toolbar.children.find((child) => child.id === DIGEST_ID);
  click(button);
  await settle();

  // 图标即按钮，文字提示走浮层气泡（.va-digest-hint）
  const hint = button.querySelector(".va-digest-hint");
  assert.ok(hint, "拒绝之后得告诉用户改从哪里打开");
  assert.match(hint.textContent, /工具栏/);
});

test("侧边栏正常打开时按钮不多话", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  dom.register("#bilibili-player");

  await run({ dom });

  const button = toolbar.children.find((child) => child.id === DIGEST_ID);
  click(button);
  await settle();

  // 每次点都跳一句提示，等于狼来了，真出问题时没人看。
  const hint = button.querySelector(".va-digest-hint");
  assert.equal(hint, null);
});

test("Digest 按钮是纯图标按钮：svg 即按钮本体", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  dom.register("#bilibili-player");

  await run({ dom });

  const button = toolbar.children.find((child) => child.id === DIGEST_ID);
  // 只有一个 <img>，没有任何文字位。
  assert.equal(button.children.length, 1);
  assert.equal(button.children[0].tagName, "IMG");
  assert.match(button.children[0].src, /tab-assistant-video-icon\.svg/);
  // 无底色、无内边距、无边框：svg 尺寸 = 按钮尺寸。
  assert.match(button.style.cssText, /transparent/i);
  assert.match(button.style.cssText, /padding:\s*0/i);
  // 打不开侧边栏时的提示是浮层气泡，不占按钮内部。
  const label = button.querySelector(".bili-digest-label");
  assert.equal(label, null);
});

test("不是播放页时什么都不注入", async () => {
  const dom = createDom();
  const toolbar = dom.register(".video-toolbar-left");
  dom.register("#bilibili-player");

  await run({ dom, href: "https://www.bilibili.com/" });

  assert.deepEqual(toolbar.children, []);
});

// ============================================================
// 注入 UI 的语言跟随（content 脚本第三层 i18n）
// ============================================================

test("英文设置下 B 站手记按钮注入为英文文案", async () => {
  const dom = createDom();
  dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");

  await run({
    dom,
    sendMessage: (message) =>
      message.action === "getUiLanguage"
        ? Promise.resolve({ success: true, uiLanguage: "en" })
        : Promise.resolve({ success: true }),
  });

  const button = player.querySelector("#bili-digest-note-button");
  assert.ok(button, "手记按钮已注入");
  const label = button.querySelector(".bili-digest-note-label");
  assert.equal(label.textContent, "Note");
  assert.match(button.title, /Save a note at the current timestamp/);
});

test("语言切换广播会刷新已注入的 B 站按钮文案", async () => {
  const dom = createDom();
  dom.register(".video-toolbar-left");
  const player = dom.register("#bilibili-player");

  const handle = await run({ dom });
  const button = player.querySelector("#bili-digest-note-button");
  assert.equal(
    button.querySelector(".bili-digest-note-label").textContent,
    "手记",
  );

  // 模拟 background 的 tabs.sendMessage 转发
  for (const listener of handle.messageListeners) {
    listener(
      { action: "uiLanguageChanged", uiLanguage: "en" },
      {},
      () => {},
    );
  }

  assert.equal(
    button.querySelector(".bili-digest-note-label").textContent,
    "Note",
  );
  assert.match(button.title, /Save a note at the current timestamp/);
});

test("英文设置下 YT 手记按钮与保存反馈为英文", async () => {
  const dom = createDom();
  dom.register("#movie_player");
  const ytVideo = dom.makeElement("video");
  ytVideo.currentTime = 323;
  dom.register("video.html5-main-video", ytVideo);
  dom.document.body = dom.makeElement("body");

  await runYouTube({
    dom,
    sendMessage: (message) =>
      message.action === "getUiLanguage"
        ? Promise.resolve({ success: true, uiLanguage: "en" })
        : Promise.resolve({ success: true }),
  });

  const button = dom.document.getElementById("ytd-note-button");
  assert.ok(button, "YT 手记按钮已注入");
  const label = button.querySelector(".ytd-note-label");
  assert.equal(label.textContent, "Note");
  assert.match(button.title, /press n/);
});
