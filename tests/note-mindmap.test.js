const test = require("node:test");
const assert = require("node:assert/strict");

const M = require("../lib/note-mindmap.js");

function collectTexts(node, out = []) {
  if (node.content) out.push(node.content);
  for (const child of node.children) collectTexts(child, out);
  return out;
}

test("markdownToBranches：标题层级成树", () => {
  const roots = M.markdownToBranches("# A\n## A1\n### A1a\n## A2\n# B");
  assert.equal(roots.length, 2);
  assert.equal(roots[0].content, "A");
  assert.equal(roots[0].children.length, 2);
  assert.equal(roots[0].children[0].content, "A1");
  assert.equal(roots[0].children[0].children[0].content, "A1a");
  assert.equal(roots[0].children[1].content, "A2");
  assert.equal(roots[1].content, "B");
});

test("markdownToBranches：列表挂在最近的标题下", () => {
  const roots = M.markdownToBranches("## 章\n- 甲\n  - 甲1\n- 乙");
  assert.equal(roots.length, 1);
  assert.equal(roots[0].content, "章");
  assert.equal(roots[0].children.length, 2);
  assert.equal(roots[0].children[0].content, "甲");
  assert.equal(roots[0].children[0].children[0].content, "甲1");
  assert.equal(roots[0].children[1].content, "乙");
});

test("markdownToBranches：无标题纯列表以列表项为骨架", () => {
  const roots = M.markdownToBranches("- 甲\n- 乙");
  assert.equal(roots.length, 2);
  assert.equal(roots[0].content, "甲");
});

test("markdownToBranches：纯段落返回空数组（label 承担）", () => {
  assert.deepEqual(M.markdownToBranches("就是一段话\n没有结构"), []);
});

test("escapeMindmapText：HTML 关口全转义", () => {
  assert.equal(
    M.escapeMindmapText('<img src=x onerror=alert(1)>"&\''),
    "&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;",
  );
});

test("escapeMindmapText：控制字符替换为空格", () => {
  assert.equal(M.escapeMindmapText("a\u0000b\u001fc"), "a b c");
});

test("shorten：超长截断加省略号，空白折叠", () => {
  assert.equal(M.shorten("  a   b  "), "a b");
  const long = "x".repeat(180);
  const cut = M.shorten(long);
  assert.equal(cut.length, M.shorten(long).length);
  assert.ok(cut.endsWith("…"));
  assert.ok(cut.length <= 140);
});

test("buildDocumentTree：AI 长笔记去掉时间点包装，标题直接作为根节点", () => {
  const tree = M.buildDocumentTree(
    "视频标题",
    "# DeepSeek Harness 速成教程笔记\n\n## 核心主题\n这是一段概述。\n\n## 一、核心设计理念\n- 万物皆可插拔\n- 插件覆盖模型和工具",
  );
  assert.equal(tree.content, "DeepSeek Harness 速成教程笔记");
  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[0].content, "核心主题");
  assert.equal(tree.children[0].children[0].content, "这是一段概述。");
  assert.equal(tree.children[1].children.length, 2);
});

test("buildDocumentTree：识别加粗标题与中文章节标题", () => {
  const tree = M.buildDocumentTree(
    "教程笔记",
    "**核心主题**\n概述内容\n\n一、安装与启动\n**安装步骤**\n1. 克隆仓库\n2. 安装依赖",
  );
  const texts = collectTexts(tree);
  assert.ok(texts.includes("核心主题"));
  assert.ok(texts.includes("一、安装与启动"));
  assert.ok(texts.includes("安装步骤"));
  assert.ok(texts.includes("克隆仓库"));
  assert.ok(texts.includes("安装依赖"));
});

test("buildNotesTree：根标题 + 每条笔记一级节点", () => {
  const tree = M.buildNotesTree("视频", [
    { content: "笔记一", kind: "note" },
    { content: "笔记二", kind: "note" },
  ]);
  assert.equal(tree.content, "视频");
  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[1].content, "笔记二");
});

test("buildNotesTree：首行重复的标题不双计", () => {
  const tree = M.buildNotesTree("视频", [
    { content: "## 第一章\n- 要点A\n\n## 第二章\n- 要点B" },
  ]);
  const texts = collectTexts(tree);
  const firstChapter = texts.filter((t) => t === "第一章");
  assert.equal(firstChapter.length, 1);
  assert.ok(texts.includes("要点A"));
  assert.ok(texts.includes("第二章"));
});

test("buildNotesTree：XSS 输入全部转义", () => {
  const tree = M.buildNotesTree("视频", [
    { content: "<script>alert(1)</script>\n- <b>x</b>" },
  ]);
  const json = JSON.stringify(tree);
  assert.equal(json.includes("<script"), false);
  assert.equal(json.includes("<b>"), false);
  assert.ok(json.includes("&lt;script&gt;"));
});

test("buildNotesTree：labelFor 异常时回退安全路径", () => {
  const tree = M.buildNotesTree("视频", [{ content: "正常" }], {
    labelFor: () => {
      throw new Error("boom");
    },
  });
  // labelFor 抛错 → label 空串 → “（空笔记）”
  assert.equal(tree.children[0].content, "（空笔记）");
});

test("buildNotesTree：空输入 / 非数组输入", () => {
  const empty = M.buildNotesTree("视频", []);
  assert.equal(empty.children.length, 0);
  const notArray = M.buildNotesTree("视频", null);
  assert.equal(notArray.children.length, 0);
});

test("buildNotesTree：超过 40 条笔记截断", () => {
  const notes = Array.from({ length: 60 }, (_, i) => ({ content: `笔记${i}` }));
  const tree = M.buildNotesTree("视频", notes);
  assert.equal(tree.children.length, 40);
});
