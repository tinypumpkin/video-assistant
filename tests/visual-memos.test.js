const test = require("node:test");
const assert = require("node:assert/strict");

const visualMemos = require("../lib/visual-memos.js");

const image = (value) => `data:image/jpeg;base64,${value.repeat(16)}`;
const meta = (hash, score = 0.6) => ({
  version: 1,
  useful: true,
  score,
  entropy: 2,
  edgeDensity: 0.1,
  brightnessStdDev: 30,
  laplacianVariance: 300,
  extremePixelRatio: 0.1,
  perceptualHash: hash,
});

test("视觉手记只选择当前视频且通过像素过滤的截图", () => {
  const resource = { site: "youtube", videoId: "abc", page: 1 };
  const selected = visualMemos.selectReferences([
    { kind: "memo", site: "youtube", bvid: "abc", page: 1, timestampSeconds: 10, imageDataUrl: image("A"), imageMeta: meta("0123456789abcdef") },
    { kind: "memo", site: "youtube", bvid: "other", page: 1, timestampSeconds: 20, imageDataUrl: image("B"), imageMeta: meta("1123456789abcdef") },
    { kind: "memo", site: "youtube", bvid: "abc", page: 1, timestampSeconds: 30, imageDataUrl: image("C") },
    { kind: "ai_note", site: "youtube", bvid: "abc", page: 1, timestampSeconds: 40, imageDataUrl: image("D"), imageMeta: meta("2123456789abcdef") },
  ], resource);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].timestampSeconds, 10);
});

test("相近时间的近重复截图只保留评分更高的一张", () => {
  const resource = { site: "bilibili", videoId: "BV1", page: 1 };
  const selected = visualMemos.selectReferences([
    { kind: "memo", site: "bilibili", bvid: "BV1", page: 1, timestampSeconds: 10, imageDataUrl: image("A"), imageMeta: meta("0000000000000000", 0.4) },
    { kind: "memo", site: "bilibili", bvid: "BV1", page: 1, timestampSeconds: 20, imageDataUrl: image("B"), imageMeta: meta("0000000000000001", 0.9) },
  ], resource);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].timestampSeconds, 20);
});

test("哈希汉明距离按位计算", () => {
  assert.equal(visualMemos.hammingDistance("0000000000000000", "000000000000000f"), 4);
  assert.equal(visualMemos.hammingDistance("bad", "0000000000000000"), Infinity);
});

test("引用标记只保留允许且首次出现的 ID", () => {
  const markdown = [
    "# 标题",
    "{{va-cite:cite_01}}",
    "正文",
    "{{va-cite:cite_01}}",
    "{{va-cite:unknown}}",
  ].join("\n\n");

  assert.deepEqual(visualMemos.parseCitationIds(markdown), ["cite_01", "unknown"]);
  const clean = visualMemos.sanitizeCitationMarkers(markdown, ["cite_01"]);
  assert.equal((clean.match(/\{\{va-cite:cite_01\}\}/g) || []).length, 1);
  assert.doesNotMatch(clean, /unknown/);
});

test("AI 笔记引用可从原手记恢复图片，并兼容旧笔记按顺序匹配", () => {
  const resource = { site: "youtube", videoId: "abc", page: 1 };
  const notes = [
    {
      id: "memo-1",
      kind: "memo",
      site: "youtube",
      bvid: "abc",
      page: 1,
      timestampSeconds: 80,
      imageDataUrl: image("A"),
      imageMeta: meta("0123456789abcdef"),
    },
  ];

  const saved = visualMemos.resolveCitations(
    notes,
    resource,
    [{ citationId: "cite_01", sourceNoteId: "memo-1", timestampSeconds: 80 }],
    "内容\n\n{{va-cite:cite_01}}",
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sourceNoteId, "memo-1");
  assert.equal(saved[0].imageDataUrl, image("A"));

  const legacy = visualMemos.resolveCitations(
    notes,
    resource,
    [],
    "旧内容\n\n{{va-cite:cite_legacy}}",
  );
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].sourceNoteId, "memo-1");
});
