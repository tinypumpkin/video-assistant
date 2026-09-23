const test = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../settings.js");
const provider = require("../lib/ai-provider.js");

test("output budget defaults and invalid input are normalized for old and current settings", () => {
  for (const normalize of [settings.normalize, settings.normalizeAppSettings]) {
    for (const value of [undefined, null, "", "invalid", Infinity]) {
      assert.equal(normalize({ aiMaxOutputTokens: value }).aiMaxOutputTokens, 32768);
    }
    assert.equal(normalize({ aiMaxOutputTokens: -1 }).aiMaxOutputTokens, 1024);
    assert.equal(normalize({ aiMaxOutputTokens: 999999 }).aiMaxOutputTokens, 262144);
    assert.equal(normalize({ aiMaxOutputTokens: "65536" }).aiMaxOutputTokens, 65536);
    const saved = normalize({ aiMaxOutputTokens: 98304 });
    assert.equal(normalize(JSON.parse(JSON.stringify(saved))).aiMaxOutputTokens, 98304);
  }
});
test("both protocols and streaming obey the configured request ceiling", () => {
  for (const protocol of Object.values(settings.PROTOCOLS)) {
    for (const stream of [false, true]) {
      const request = provider.buildChatRequest({
        settings: settings.normalize({ presetId: "custom", protocol,
          aiBaseUrl: "https://api.example.com/v1", aiMaxOutputTokens: 2048 }),
        messages: [{ role: "user", content: "hello" }], maxTokens: 8192, stream,
      });
      assert.equal(request.body.max_tokens, 2048);
    }
  }
});
