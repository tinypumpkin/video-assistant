const test = require("node:test");
const assert = require("node:assert/strict");

const schema = require("../lib/note-schema.js");

test("V2 schema 在界面 DTO 与规范化记录之间保留视频、锚点和状态", () => {
  const note = {
    id: "memo_1",
    kind: "memo",
    text: "重点",
    rawText: "字幕原文",
    site: "youtube",
    bvid: "abc",
    page: 1,
    videoTitle: "测试视频",
    ownerName: "作者",
    timestampSeconds: 80,
    timestamp: "1:20",
    timestampedUrl: "https://www.youtube.com/watch?v=abc&t=80",
    pendingTranscript: true,
    createdAt: 100,
  };
  const record = schema.noteToRecord(note);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.video.videoKey, "youtube:abc:1");
  assert.equal(record.anchor.seconds, 80);
  assert.equal(record.status, "pending_transcript");
  assert.deepEqual(schema.recordToNote(record), {
    ...note,
    videoId: "abc",
    updatedAt: 100,
  });
});

test("引用标记去重且关系 ID 可重复生成", () => {
  const markdown = "A {{va-cite:cite_01}} B {{va-cite:cite_01}} C {{va-cite:cite_02}}";
  assert.deepEqual(schema.citationIds(markdown), ["cite_01", "cite_02"]);
  const first = schema.citationLink(
    "ai_1",
    "asset_1",
    { citationId: "cite_01", sourceNoteId: "memo_1" },
    { seconds: 80, label: "1:20", url: "https://example.com?t=80" },
    0,
    100,
  );
  const second = schema.citationLink(
    "ai_1",
    "asset_1",
    { citationId: "cite_01", sourceNoteId: "memo_1" },
    { seconds: 80, label: "1:20", url: "https://example.com?t=80" },
    0,
    100,
  );
  assert.deepEqual(first, second);
  assert.equal(first.id, "ai_1:citation: cite_01".replace(" ", ""));
  assert.equal(first.role, "citation");
});

test("截图关系与 AI 引用关系分离，删除源手记时可独立保留引用", () => {
  const capture = schema.captureLink("memo_1", "asset_1", { seconds: 80 }, 100);
  const citation = schema.citationLink(
    "ai_1",
    "asset_1",
    { citationId: "cite_01", sourceNoteId: "memo_1" },
    { seconds: 80 },
    0,
    101,
  );
  assert.notEqual(capture.id, citation.id);
  assert.equal(capture.assetId, citation.assetId);
  assert.equal(citation.sourceNoteId, "memo_1");
});
