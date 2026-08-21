/**
 * Markdown 渲染器。
 *
 * 双路径设计：
 *  - 浏览器（sidepanel.html 已引入 vendor/markdown-it.min.js）：用 markdown-it
 *    渲染（html:false 关闭内联 HTML，表格/删除线/任务列表等完整语法），
 *    再用 KaTeX auto-render 处理数学公式、把 ```mermaid 代码块标记出来
 *    交给 mermaid.run 渐进增强。
 *  - Node（单元测试）：无 window/markdownit 时回退到自研轻量渲染器，
 *    纯 DOM 构建、零 HTML 解析，行为与旧版一致。
 *
 * 两条路径的共同安全底线：不执行任何来源的 HTML；链接仅放行 http(s)。
 */

/** markdown-it 实例（惰性创建，浏览器专属）。 */
let mdItInstance = null;

function getMarkdownIt(win) {
  if (mdItInstance) return mdItInstance;
  if (!win || typeof win.markdownit !== "function") return null;
  mdItInstance = win.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  // 默认 validateLink 已拒绝 javascript:/data: 等，这里再钉一道 http(s) 白名单。
  const validate = mdItInstance.validateLink;
  mdItInstance.validateLink = (url) => /^https?:\/\//i.test(url) && validate(url);
  return mdItInstance;
}

/** 浏览器路径：markdown-it 渲染 + KaTeX 数学 + mermaid 标记。 */
function renderWithMarkdownIt(container, markdown, win) {
  const md = getMarkdownIt(win);
  const doc = container.ownerDocument || win.document;
  const html = md.render(String(markdown || ""));
  const template = doc.createElement("template");
  template.innerHTML = html; // html:false，输出只含 markdown 生成的安全标签
  container.textContent = "";
  container.appendChild(template.content);
  enhance(container, win);
  return container;
}

/**
 * 渐进增强：KaTeX 数学公式 + mermaid 图表。
 * 任何一步失败都不影响已渲染的正文——增强是锦上添花，不是依赖。
 */
function enhance(container, win) {
  // KaTeX auto-render：$...$ / $$...$$ / \(..\) / \[..\]
  if (typeof win.renderMathInElement === "function") {
    try {
      win.renderMathInElement(container, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      });
    } catch {
      /* 数学渲染失败时保留原文 */
    }
  }
  // mermaid：把 ```mermaid 代码块换成 <div class="mermaid-source">，
  // 由 sidepanel.js 统一收集后调用 mermaid.run（需要可见容器，时机不同）。
  const blocks = container.querySelectorAll("pre > code.language-mermaid");
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) continue;
    const source = code.textContent || "";
    const holder = container.ownerDocument.createElement("div");
    holder.className = "mermaid-block";
    holder.dataset.mermaidSource = source;
    holder.textContent = source; // mermaid 未跑起来时至少展示源码
    pre.replaceWith(holder);
  }
}

/* ------------------ 自研轻量渲染器（Node 兜底路径） ------------------ */

var BILI_MARKDOWN = (() => {
  const BLOCK_START = /^(?:```|#{1,6}\s+|>\s?|(?:[-*_]\s*){3,}$|\s*(?:[-+*]|\d+\.)\s+)/;

  function appendInline(parent, source, doc) {
    const text = String(source || "");
    const token = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^\s)]+\)|\n)/g;
    let cursor = 0;
    for (const match of text.matchAll(token)) {
      if (match.index > cursor) {
        parent.appendChild(doc.createTextNode(text.slice(cursor, match.index)));
      }
      const value = match[0];
      if (value === "\n") {
        parent.appendChild(doc.createElement("br"));
      } else if (value.startsWith("`")) {
        const code = doc.createElement("code");
        code.textContent = value.slice(1, -1);
        parent.appendChild(code);
      } else if (value.startsWith("**") || value.startsWith("__")) {
        const strong = doc.createElement("strong");
        strong.textContent = value.slice(2, -2);
        parent.appendChild(strong);
      } else if (value.startsWith("*") || value.startsWith("_")) {
        const emphasis = doc.createElement("em");
        emphasis.textContent = value.slice(1, -1);
        parent.appendChild(emphasis);
      } else {
        const link = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const href = link?.[2] || "";
        if (/^https?:\/\//i.test(href)) {
          const anchor = doc.createElement("a");
          anchor.textContent = link[1];
          anchor.href = href;
          anchor.target = "_blank";
          anchor.rel = "noreferrer noopener";
          parent.appendChild(anchor);
        } else {
          parent.appendChild(doc.createTextNode(link?.[1] || value));
        }
      }
      cursor = match.index + value.length;
    }
    if (cursor < text.length) {
      parent.appendChild(doc.createTextNode(text.slice(cursor)));
    }
  }

  function render(container, markdown, doc = document) {
    // 浏览器且有 markdown-it：走完整渲染管线。
    const win = typeof window !== "undefined" ? window : null;
    const globalScope = typeof globalThis !== "undefined" ? globalThis : win;
    const mdCandidate =
      (globalScope && typeof globalScope.markdownit === "function" && globalScope) || win;
    if (mdCandidate && getMarkdownIt(mdCandidate)) {
      return renderWithMarkdownIt(container, markdown, mdCandidate);
    }

    // Node / 无 markdown-it：自研轻量渲染。
    container.textContent = "";
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^```\s*([\w-]*)\s*$/);
      if (fence) {
        const body = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        const pre = doc.createElement("pre");
        const code = doc.createElement("code");
        if (fence[1]) code.className = `language-${fence[1]}`;
        code.textContent = body.join("\n");
        pre.appendChild(code);
        container.appendChild(pre);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const node = doc.createElement(`h${heading[1].length}`);
        appendInline(node, heading[2], doc);
        container.appendChild(node);
        index += 1;
        continue;
      }

      if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
        container.appendChild(doc.createElement("hr"));
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        const blockquote = doc.createElement("blockquote");
        appendInline(blockquote, quote.join("\n"), doc);
        container.appendChild(blockquote);
        continue;
      }

      const listItem = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
      if (listItem) {
        const ordered = /\d+\./.test(listItem[1]);
        const list = doc.createElement(ordered ? "ol" : "ul");
        while (index < lines.length) {
          const item = lines[index].match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
          if (!item || /\d+\./.test(item[1]) !== ordered) break;
          const li = doc.createElement("li");
          appendInline(li, item[2], doc);
          list.appendChild(li);
          index += 1;
        }
        container.appendChild(list);
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !BLOCK_START.test(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      const node = doc.createElement("p");
      appendInline(node, paragraph.join("\n"), doc);
      container.appendChild(node);
    }
    return container;
  }

  return { render, enhance };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = BILI_MARKDOWN;
}
