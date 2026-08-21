/**
 * 笔记 → 思维导图树构建器（纯函数，零依赖）。
 *
 * 输出节点形状与 markmap-view 的 IPresentedNode 兼容：
 *   { content: "已转义的安全 HTML", children: [...], payload: {} }
 * markmap 会把 content 作为 innerHTML 塞进 foreignObject，所以所有文本
 * 必须先经 escapeMindmapText 过一遍 HTML 转义——这是唯一的 XSS 关口。
 */
var NOTE_MINDMAP = (() => {
  const MAX_LABEL = 140; // 文档导图要保留可独立阅读的完整要点
  const MAX_CHILDREN = 40; // 单层子节点上限，防超大笔记炸布局

  const ESCAPE_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  /** HTML 转义：mindmap content 的唯一安全关口。 */
  function escapeMindmapText(text) {
    return String(text || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ") // 控制字符清掉，防 foreignObject 布局错乱
      .replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
  }

  /** 折叠空白并截断到 limit。 */
  function shorten(text, limit = MAX_LABEL) {
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    if (!flat) return "";
    if (flat.length <= limit) return flat;
    return `${flat.slice(0, limit - 1)}…`;
  }

  function makeNode(content, children = [], payload = {}) {
    return { content, children, payload };
  }

  function cleanMarkdownLabel(text) {
    return String(text || "")
      .replace(/^\s*(?:#{1,6}\s+|>\s?)/, "")
      .replace(/^\s*(?:\*\*|__)(.+)(?:\*\*|__)\s*$/, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
  }

  function headingFromLine(raw) {
    const markdown = raw.match(/^\s*(#{1,6})\s+(.+)$/);
    if (markdown) {
      return { level: markdown[1].length, text: cleanMarkdownLabel(markdown[2]) };
    }
    const bold = raw.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/);
    if (bold) return { level: 3, text: cleanMarkdownLabel(bold[1]) };
    const chineseSection = raw.match(/^\s*([一二三四五六七八九十百]+、\s*.+)$/);
    if (chineseSection) return { level: 2, text: cleanMarkdownLabel(chineseSection[1]) };
    return null;
  }

  /**
   * 把一段 markdown 笔记正文解析成一级子节点数组（每个元素是子树）。
   * 只提取标题层级（#~######）与列表项（-, *, 数字.）两种结构；
   * 纯段落笔记返回空数组——段落文本由一级节点的 label 承担，不重复入树。
   *
   * 双轨建树：标题走自己的层级栈（depth = # 数）；列表项挂在「最近的标题」
   * 之下，缩进层级只决定列表内部的父子关系（相对层级，与标题数解耦）。
   * 这样「## 标题 → - 列表」总是父子，缩进再深也不会爬到标题外面。
   */
  function markdownToBranches(markdown, options = {}) {
    const includeParagraphs = Boolean(options.includeParagraphs);
    const lines = String(markdown || "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    const roots = [];
    // 标题栈：记录各层标题节点，列表挂到最内层标题下
    const headingStack = [];
    let baseIndent = null; // 当前笔记首个列表项的缩进，作为列表相对零点
    let paragraphLines = [];

    const pushNode = (node, depth, siblings) => {
      siblings.push(node);
      return node;
    };

    const flushParagraph = () => {
      if (!includeParagraphs || !paragraphLines.length) {
        paragraphLines = [];
        return;
      }
      const text = cleanMarkdownLabel(paragraphLines.join(" "));
      paragraphLines = [];
      if (!text) return;
      const hostChildren = headingStack.length
        ? headingStack[headingStack.length - 1].node.children
        : roots;
      hostChildren.push(makeNode(escapeMindmapText(shorten(text)), [], { kind: "paragraph" }));
    };

    for (const raw of lines) {
      if (/^\s*```/.test(raw)) {
        flushParagraph();
        continue;
      }
      const heading = headingFromLine(raw);
      if (heading) {
        flushParagraph();
        const level = heading.level;
        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        const parentChildren = headingStack.length
          ? headingStack[headingStack.length - 1].node.children
          : roots;
        const node = pushNode(
          makeNode(escapeMindmapText(shorten(heading.text)), [], { headingLevel: level }),
          level,
          parentChildren,
        );
        headingStack.push({ level, node });
        baseIndent = null; // 新标题重置列表零点
        continue;
      }
      const listMatch = raw.match(/^(\s*)([-+*]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        flushParagraph();
        const indent = Math.floor(listMatch[1].length / 2); // 2 空格一级
        if (baseIndent === null) baseIndent = indent;
        const rel = Math.max(0, indent - baseIndent); // 相对层级
        // 挂载点：最近的标题（若有），否则根
        const hostChildren = headingStack.length
          ? headingStack[headingStack.length - 1].node.children
          : roots;
        // 沿 host 的末梢链下潜 rel 层
        let target = hostChildren;
        for (let i = 0; i < rel; i += 1) {
          if (!target.length) break;
          target = target[target.length - 1].children;
        }
        pushNode(
          makeNode(escapeMindmapText(shorten(cleanMarkdownLabel(listMatch[3]))), [], {
            kind: "list",
          }),
          rel,
          target,
        );
        continue;
      }
      if (!raw.trim()) flushParagraph();
      else if (includeParagraphs && !/^\s*(?:---+|\|)/.test(raw)) paragraphLines.push(raw.trim());
    }
    flushParagraph();
    return roots;
  }

  function firstLine(text) {
    return String(text || "").split("\n")[0] || "";
  }

  /** 去掉首行的 markdown 装饰符号，得到适合当节点 label 的纯文本。 */
  function plainLabel(text) {
    return cleanMarkdownLabel(String(text || "")
      .replace(/^(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+\.\s+)/, "")
      .trim());
  }

  /** 把单篇 AI 长笔记直接变成文档导图，不再额外套一层“0:00 AI 笔记”。 */
  function buildDocumentTree(rootTitle, markdown) {
    const branches = markdownToBranches(markdown, { includeParagraphs: true });
    const fallback = makeNode(escapeMindmapText(shorten(rootTitle || "笔记")));
    if (!branches.length) return fallback;

    const first = branches[0];
    if (first.payload?.headingLevel === 1) {
      first.children.push(...branches.slice(1, MAX_CHILDREN));
      return first;
    }
    fallback.children.push(...branches.slice(0, MAX_CHILDREN));
    return fallback;
  }

  /**
   * 构建整棵笔记导图树。
   * @param {string} rootTitle 根节点标题（视频名 / 范围名）
   * @param {Array<{text?: string, content?: string, kind?: string, timestamp?: string}>} notes
   *   正文兼容 text（扩展存储形状）与 content 两种字段名
   * @param {{ labelFor?: (note) => string }} options 自定义每条笔记的一级节点文案
   */
  function buildNotesTree(rootTitle, notes, options = {}) {
    const labelFor =
      typeof options.labelFor === "function"
        ? options.labelFor
        : (note) => plainLabel(firstLine(note?.text || note?.content));
    const root = makeNode(escapeMindmapText(shorten(rootTitle || "笔记")));
    const list = Array.isArray(notes) ? notes : [];
    for (const note of list.slice(0, MAX_CHILDREN)) {
      let label = "";
      try {
        label = labelFor(note) || "";
      } catch {
        label = "";
      }
      const labelNode = makeNode(
        escapeMindmapText(shorten(label) || "（空笔记）"),
        [],
        { noteKind: note?.kind || "" },
      );
      const branches = markdownToBranches(note?.text || note?.content || "");
      // 笔记以标题/列表项开头时，label 即该行文案——首分支与 label 重复，
      // 跳过首分支本体、把它的子树提升为 label 的直接子节点，避免同文双节点。
      const firstText = plainLabel(firstLine(note?.text || note?.content));
      if (
        branches.length &&
        branches[0].content === escapeMindmapText(shorten(firstText))
      ) {
        labelNode.children.push(...branches[0].children);
        labelNode.children.push(...branches.slice(1));
      } else {
        for (const branch of branches.slice(0, MAX_CHILDREN)) {
          labelNode.children.push(branch);
        }
      }
      root.children.push(labelNode);
    }
    return root;
  }

  return {
    escapeMindmapText,
    shorten,
    buildNotesTree,
    buildDocumentTree,
    markdownToBranches,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = NOTE_MINDMAP;
}
