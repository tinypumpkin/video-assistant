const test = require("node:test");
const assert = require("node:assert/strict");

const templates = require("../prompts/note-styles.js");

test("AI 笔记模板元数据与提示词一一对应", () => {
  assert.equal(templates.DEFAULT_NOTE_STYLE, "minimal");
  assert.equal(templates.NOTE_STYLE_METADATA.length, 8);
  for (const item of templates.NOTE_STYLE_METADATA) {
    assert.ok(templates.NOTE_STYLES[item.key], `${item.key} 缺少模板提示词`);
    assert.match(templates.promptFor(item.key), /AI 摘要/);
  }
});

test("未知模板回退精简，自定义模板不注入预设提示词", () => {
  assert.equal(templates.normalizeStyle("unknown"), "minimal");
  assert.match(templates.promptFor("unknown"), /精简信息/);
  assert.equal(templates.promptFor("custom"), "");
});
