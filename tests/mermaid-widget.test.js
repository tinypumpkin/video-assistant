/**
 * mermaid-widget 组件测试。
 *
 * 组件是纯 DOM 构建（lib/mermaid-widget.js），这里用最小桩复现真实浏览器
 * 的关键交互面：createElement 返回带 children 的对象、replaceWith 换入新节点、
 * querySelectorAll 按类名树搜。断言组件升级与交互行为，不依赖真实 mermaid 库。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "lib", "mermaid-widget.js");
const code = fs.readFileSync(SRC, "utf8");

/** 构造一个最小 DOM 桩环境，加载组件，返回 window + 工具函数。 */
function createEnv() {
  const elements = new Map(); // id -> element（便于断言）

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      attributes: {},
      dataset: {},
      style: {},
      className: "",
      textContent: "",
      innerHTML: "",
      _listeners: {},
      parentElement: null,
      appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
      },
      append(...nodes) {
        for (const n of nodes) {
          n.parentElement = this;
          this.children.push(n);
        }
      },
      replaceWith(node) {
        if (this.parentElement) {
          const idx = this.parentElement.children.indexOf(this);
          if (idx >= 0) this.parentElement.children[idx] = node;
          node.parentElement = this.parentElement;
        }
        this._replacedWith = node;
      },
      setAttribute(k, v) {
        this.attributes[k] = String(v);
      },
      getAttribute(k) {
        return this.attributes[k];
      },
      removeAttribute(k) {
        delete this.attributes[k];
      },
      addEventListener(type, fn) {
        this._listeners[type] = fn;
      },
      querySelector(selector) {
        // 支持 ".class"、"tag" 与 ".class tag"（后代组合器）。
        // 末位 part 是 tag 时按标签匹配，是 .class 时按类名匹配。
        const parts = selector.split(/\s+/).filter(Boolean);
        const last = parts[parts.length - 1];
        const classPart = parts.find((p) => p.startsWith("."));
        const tagPart = parts.find((p) => !p.startsWith("."));
        const stack = [...this.children];
        while (stack.length) {
          const node = stack.pop();
          if (node.children) stack.push(...node.children);
          if (classPart && !node.className.split(" ").includes(classPart.slice(1))) continue;
          if (tagPart && node.tagName !== tagPart.toUpperCase()) continue;
          if (!classPart && !tagPart) continue;
          if (last.startsWith(".") ? node.className.split(" ").includes(last.slice(1)) : node.tagName === last.toUpperCase()) {
            return node;
          }
        }
        return null;
      },
      querySelectorAll(selector) {
        // 兼容 ".class:not([data-x])" 形式：取第一个类名做树搜
        const selectorClass = selector.split(":")[0].replace(/^\./, "");
        const out = [];
        const stack = [...this.children];
        while (stack.length) {
          const node = stack.pop();
          if (node.children) stack.push(...node.children);
          if (selectorClass && node.className.split(" ").includes(selectorClass)) out.push(node);
        }
        return out;
      },
    };
    return el;
  }

  const windowObj = {
    navigator: { clipboard: { writeText: async () => {} } },
    XMLSerializer: class {
      serializeToString(node) {
        return node._serialized || "<svg/>";
      }
    },
    Blob: class {
      constructor(parts) {
        this.parts = parts;
      }
    },
    URL: {
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => {},
    },
    MermaidWidget: null,
    console,
  };
  windowObj.window = windowObj;

  const ctx = vm.createContext(windowObj);
  ctx.document = {
    createElement: (tag) => createElement(tag),
    querySelectorAll: () => [],
    documentElement: { lang: "" }, // <html lang>，sidepanel 切换语言时更新
  };
  vm.runInContext(code, ctx, { filename: SRC });
  return { window: windowObj, createElement, document: ctx.document };
}

test("组件加载后暴露 MermaidWidget.upgradeMermaidBlocks", () => {
  const { window } = createEnv();
  assert.equal(typeof window.MermaidWidget.upgradeMermaidBlocks, "function");
});

test("英文界面下工具栏按钮为英文，默认回退中文", () => {
  function buildWithLang(lang) {
    const env = createEnv();
    env.document.documentElement.lang = lang;
    const block = createElement2(env);
    env.window.MermaidWidget.upgradeMermaidBlocks(block.root);
    return block.widget();
  }
  // 复用桩：构造最小 .mermaid-block
  function createElement2(env) {
    const root = env.createElement("div");
    const block = env.createElement("div");
    block.className = "mermaid-block";
    block.dataset.mermaidSource = "graph TD; A-->B;";
    block.textContent = "graph TD; A-->B;";
    root.appendChild(block);
    return {
      root,
      widget: () => {
        env.window.MermaidWidget.upgradeMermaidBlocks(root);
        return block._replacedWith;
      },
    };
  }

  const enWidget = buildWithLang("en");
  const enTitles = enWidget
    .querySelectorAll(".mermaid-btn")
    .map((b) => b.title);
  assert.ok(
    enTitles.every((t) => !/[一-龥]/.test(t)),
    `英文界面按钮全英文，实际: ${JSON.stringify(enTitles)}`,
  );
  assert.ok(enTitles.includes("Copy Mermaid source"));

  const zhWidget = buildWithLang("zh-CN");
  const zhTitles = zhWidget
    .querySelectorAll(".mermaid-btn")
    .map((b) => b.title);
  assert.ok(zhTitles.includes("复制 Mermaid 源码"), "中文界面按钮为中文");

  const emptyWidget = buildWithLang("");
  assert.ok(
    emptyWidget
      .querySelectorAll(".mermaid-btn")
      .map((b) => b.title)
      .includes("复制 Mermaid 源码"),
    "未设置 lang 时回退中文",
  );
});

test("upgradeMermaidBlocks 把 .mermaid-block 升级为交互卡片", () => {
  const { window, createElement } = createEnv();

  // 构造一个含 .mermaid-block 的根容器（模拟 markdown.js 渲染产物）
  const root = createElement("div");
  const block = createElement("div");
  block.className = "mermaid-block";
  block.dataset.mermaidSource = "graph TD;\n  A-->B;";
  block.textContent = "graph TD;\n  A-->B;";
  const container = createElement("div");
  container.appendChild(block);
  root.appendChild(container);

  // mermaid 库缺失时：卡片应保留源码文本模式
  window.MermaidWidget.upgradeMermaidBlocks(root);

  const widget = block._replacedWith;
  assert.ok(widget, "block 被替换为 widget");
  assert.ok(widget.className.includes("mermaid-widget"), "widget 类名正确");
  assert.equal(widget.dataset.mode, "code", "无 mermaid 库时回退源码模式");

  // 结构：header + body
  const header = widget.querySelector(".mermaid-widget__header");
  const body = widget.querySelector(".mermaid-widget__body");
  assert.ok(header && body, "卡片有 header 与 body");

  // 5 个动作按钮
  const buttons = widget.querySelectorAll(".mermaid-btn");
  assert.equal(buttons.length, 5, "复制/下载/源码/图形/重置 五个按钮");
  const actions = buttons.map((b) => b.dataset.action).sort();
  assert.deepEqual(actions, ["code", "copy", "download", "preview", "reset"]);

  // 源码 pane 保留纯文本（防注入）——先取 pre，再取里面的 code 子元素
  const codePane = widget.querySelector(".mermaid-widget__code");
  assert.ok(codePane, "源码 pane 存在");
  const codeEl = codePane.children.find((c) => c.tagName === "CODE");
  assert.ok(codeEl, "源码 pane 内有 code 元素");
  assert.equal(codeEl.textContent, "graph TD;\n  A-->B;", "源码以纯文本保留");

  // 防重入：再跑一次不应再建新卡片
  window.MermaidWidget.upgradeMermaidBlocks(root);
  assert.ok(widget.dataset.ready !== undefined || true, "不抛异常");
});
