const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const settings = require("../settings.js");
const provider = require("../lib/ai-provider.js");

const source = fs.readFileSync(path.join(__dirname, "../options.js"), "utf8");
const renderSource = source.slice(source.indexOf("function modelOptionValues("), source.indexOf("function syncPresetFields("));
const readSource = source.slice(source.indexOf("function readProvider("), source.indexOf("function writeProvider("));
const fetchSource = source.slice(source.indexOf("async function fetchModels("), source.indexOf("async function testProvider("));

function modelSelect() {
  const select = { options: [], value: "", appendChild(option) { this.options.push(option); } };
  Object.defineProperty(select, "textContent", { set() { select.options = []; select.value = ""; } });
  return select;
}

test("fresh provider fetch replaces legacy dropdown entries and saved models", async () => {
  let requestUrl;
  const context = vm.createContext({
    BILI_SETTINGS: settings,
    BILI_AI_PROVIDER: provider,
    document: { createElement: () => ({ value: "", textContent: "" }) },
    translateText: text => text,
    apiKeyValue: () => "test-key",
    ensurePermissionInteractive: async () => true,
    showStatus: () => {},
    fetch: async url => {
      requestUrl = url;
      return { ok: true, json: async () => ({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }) };
    },
  });
  vm.runInContext(renderSource + readSource + fetchSource, context);
  const card = {
    preset: { value: "deepseek" },
    protocol: { value: "openai" },
    baseUrl: { value: "https://api.deepseek.com" },
    apiKey: {},
    model: { value: "deepseek-v4-flash-vision-exp" },
    modelOptions: modelSelect(),
    modelsHint: { textContent: "" },
    status: {},
  };
  context.setModelOptions(card, ["gpt-5.6-terra", "deepseek-v4-flash-vision-exp"]);
  await context.fetchModels(card);

  assert.match(requestUrl, /^https:\/\/api\.deepseek\.com\//);
  assert.deepEqual(card.modelOptions.options.map(option => option.value),
    ["", "deepseek-chat", "deepseek-reasoner"]);
  assert.equal(card.model.value, "deepseek-chat");
  assert.equal(card.modelOptions.value, "deepseek-chat");
  assert.equal(card.modelsHint.textContent, "已获取 2 个模型。");
  assert.deepEqual(Array.from(context.readProvider(card).availableModels),
    ["deepseek-chat", "deepseek-reasoner"]);
});

test("manually entered model remains editable without entering fetched list", () => {
  const context = vm.createContext({
    BILI_SETTINGS: settings,
    document: { createElement: () => ({ value: "", textContent: "" }) },
    translateText: text => text,
    apiKeyValue: () => "test-key",
  });
  vm.runInContext(renderSource + readSource, context);
  const card = {
    preset: { value: "deepseek" }, protocol: { value: "openai" },
    baseUrl: { value: "https://api.deepseek.com" }, apiKey: {},
    model: { value: "my-private-model" }, modelOptions: modelSelect(),
    modelsHint: { textContent: "" },
  };
  context.setModelOptions(card, ["deepseek-chat"]);
  assert.equal(card.model.value, "my-private-model");
  assert.deepEqual(card.modelOptions.options.map(option => option.value), ["", "deepseek-chat"]);
  assert.equal(context.readProvider(card).aiModel, "my-private-model");
  assert.deepEqual(Array.from(context.readProvider(card).availableModels), ["deepseek-chat"]);
});

test("a late fetch from another provider cannot overwrite current provider models", async () => {
  let completeFetch;
  const context = vm.createContext({
    BILI_SETTINGS: settings, BILI_AI_PROVIDER: provider,
    document: { createElement: () => ({ value: "", textContent: "" }) },
    translateText: text => text, apiKeyValue: () => "test-key",
    ensurePermissionInteractive: async () => true,
    showStatus: () => {},
    fetch: () => new Promise(resolve => { completeFetch = resolve; }),
  });
  vm.runInContext(renderSource + readSource + fetchSource, context);
  const card = {
    preset: { value: "deepseek" }, protocol: { value: "openai" },
    baseUrl: { value: "https://api.deepseek.com" }, apiKey: {},
    model: { value: "deepseek-chat" }, modelOptions: modelSelect(),
    modelsHint: { textContent: "" }, status: {},
  };
  context.setModelOptions(card, ["deepseek-chat"]);
  const pending = context.fetchModels(card);
  await new Promise(resolve => setImmediate(resolve));
  card.preset.value = "openai";
  card.model.value = "gpt-test";
  context.setModelOptions(card, ["gpt-test"]);
  completeFetch({ ok: true, json: async () => ({ data: [{ id: "deepseek-reasoner" }] }) });
  await pending;
  assert.deepEqual(card.modelOptions.options.map(option => option.value), ["", "gpt-test"]);
});
