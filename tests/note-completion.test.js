const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const provider = require("../lib/ai-provider.js");
const settingsModule = require("../settings.js");
const schema = require("../lib/note-schema.js");
const router = require("../lib/provider-router.js");

const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
const completionSource = source.slice(
  source.indexOf("async function requestProviderCompletion("),
  source.indexOf("// 真正发出请求"),
);
function harness(protocol, responses, settingsOverrides = {}) {
  const requests = [];
  const context = vm.createContext({
    BILI_SETTINGS: settingsModule,
    BILI_AI_PROVIDER: provider,
    ensureHostPermission: async () => {},
    debugLog: () => {},
    sendAiRequest: async (_settings, request) => {
      requests.push(request);
      assert.ok(responses.length, "Unexpected extra request");
      return responses.shift();
    },
  });
  vm.runInContext(completionSource, context);
  const settings = settingsModule.normalize({
    presetId: "custom", protocol,
    aiBaseUrl: "https://api.example.com/v1", aiApiKey: "test-key", aiModel: "test-model",
    ...settingsOverrides,
  });
  return {
    requests,
    run: (overrides = {}) => context.requestProviderCompletion(settings, {
      messages: [{ role: "user", content: "生成完整笔记" }],
      images: [], maxTokens: 4096, ...overrides,
    }),
  };
}
const openai = (text, reason = "stop") => ({ choices: [{ message: { content: text }, finish_reason: reason }] });
const anthropic = (text, reason = "end_turn") => ({ content: [{ type: "text", text }], stop_reason: reason });

for (const [protocol, response, reason] of [
  [settingsModule.PROTOCOLS.OPENAI, openai, "length"],
  [settingsModule.PROTOCOLS.ANTHROPIC, anthropic, "max_tokens"],
]) {
  test(`${protocol}: nonempty truncated output retries from original input`, async () => {
    const h = harness(protocol, [response("若希望预测仍不丢", reason), response("完整正文。\n## AI 摘要\n总结。")]);
    const result = await h.run();
    assert.equal(result.text, "完整正文。\n## AI 摘要\n总结。");
    assert.deepEqual(h.requests.map(r => r.body.max_tokens), [4096, 16384]);
    assert.deepEqual(h.requests[0].body.messages, h.requests[1].body.messages);
  });
  test(`${protocol}: repeated truncation fails instead of returning partial success`, async () => {
    const h = harness(protocol, Array.from({ length: 3 }, () => response("半句话", reason)));
    await assert.rejects(h.run(), error => error.code === "AI_OUTPUT_TRUNCATED");
    assert.deepEqual(h.requests.map(r => r.body.max_tokens), [4096, 16384, 32768]);
  });
}
test("normal complete response is accepted without another request", async () => {
  const h = harness(settingsModule.PROTOCOLS.OPENAI, [openai("完整正文。")]);
  assert.equal((await h.run()).text, "完整正文。");
  assert.equal(h.requests.length, 1);
});
test("configured ceiling can exceed the former 32768 hard limit", async () => {
  const h = harness(settingsModule.PROTOCOLS.OPENAI,
    [openai("半句", "length"), openai("半句", "length"), openai("完整")],
    { aiMaxOutputTokens: 131072 });
  assert.equal((await h.run()).text, "完整");
  assert.deepEqual(h.requests.map(r => r.body.max_tokens), [4096, 16384, 131072]);
});
test("configured ceiling also clamps the initial request", async () => {
  const h = harness(settingsModule.PROTOCOLS.OPENAI, [openai("完整")], { aiMaxOutputTokens: 2048 });
  await h.run();
  assert.equal(h.requests[0].body.max_tokens, 2048);
});
test("empty JSON response can recover before a nonempty truncated response", async () => {
  const h = harness(settingsModule.PROTOCOLS.OPENAI, [openai(""), openai("半句", "length"), openai("完整")]);
  assert.equal((await h.run({ responseFormat: { type: "json_object" } })).text, "完整");
  assert.equal(h.requests[1].body.response_format, undefined);
  assert.equal(h.requests[2].body.max_tokens, 32768);
});
test("at budget ceiling, truncated content fails without an identical retry", async () => {
  const h = harness(settingsModule.PROTOCOLS.OPENAI, [openai("半句", "length")]);
  await assert.rejects(h.run({ maxTokens: 32768 }), { code: "AI_OUTPUT_TRUNCATED" });
  assert.equal(h.requests.length, 1);
  assert.equal(router.shouldFailOver({ code: "AI_OUTPUT_TRUNCATED" }), true);
});
test("long AI note survives storage conversion and editing without losing tail citations", async () => {
  const text = "完整内容。".repeat(4000) + "\n{{va-cite:cite_01}}\n## AI 摘要\n结束。";
  const note = { id: "long-note", kind: "ai_video_note", text, createdAt: 1 };
  assert.equal(schema.recordToNote(schema.noteToRecord(note)).text, text);
  let saved;
  const context = vm.createContext({
    mutateNotes: async callback => { saved = callback([note])[0]; },
    chrome: { runtime: { sendMessage: async () => {} } },
  });
  vm.runInContext(source.slice(source.indexOf("async function handleUpdateNote("), source.indexOf("// 开新标签页前")), context);
  await context.handleUpdateNote(note.id, text + "补充。");
  assert.equal(saved.text, text + "补充。");
});
