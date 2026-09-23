/** Video Assistant — 双 Provider 设置、授权与连通性测试。 */

"use strict";

const EN_TEXT = Object.freeze({
  "设置": "Settings",
  "界面语言": "Interface language",
  "适用范围": "Site availability",
  "默认同时在 YouTube 与 Bilibili 启用；关闭后，该网站不再显示摘要和手记按钮。": "Enabled for both YouTube and Bilibili by default. Disable a site to hide its summary and memo buttons.",
  "标准视频播放页": "Standard watch pages",
  "普通视频、合集与分P": "Videos, collections, and multi-part pages",
  "修改后自动保存，并同步到已打开的视频页。": "Changes are saved automatically and applied to open video pages.",
  "适用范围已保存": "Site availability saved",
  "笔记与快捷键": "Notes and shortcuts",
  "所有笔记仅保存在本机，可在侧边栏“笔记”中查看、编辑、复制或导出 JSON、Markdown、CSV。": "All notes stay on this device. Open Notes in the side panel to view, edit, copy, or export JSON, Markdown, and CSV.",
  "播放器上的 Note 按钮或": "Use the Note button on the player or",
  "：保存当前播放位置的字幕笔记。": ": save a caption note at the current playback position.",
  "“手记”：随时记录文字；在视频页保存时会附带视频标题和访问锚点。": "Memos: write at any time. Saving on a video page includes its title and timestamp link.",
  "“AI 记”：在“问 AI”中将任意回答保存为笔记。": "AI Notes: save any answer from Ask AI as a note.",
  "字幕页按": "On the Transcript tab, press",
  "：快速搜索字幕；所有已保存笔记都可随时再次编辑。": ": search captions quickly. Every saved note can be edited later.",
  "笔记存储": "Note storage",
  "最多保留笔记条目": "Maximum saved notes",
  "默认 100 条，最多 400 条。达到条目上限时，保存新笔记会清理最早的笔记。": "Default: 100 notes; maximum: 400. When the limit is reached, saving a new note removes the oldest one.",
  "笔记、字幕缓存和设置共用本机扩展存储。笔记写入使用 7 MB 安全线；空间不足时不会写入新笔记。超过 100 条时，侧边栏按每页 100 条加载，导出仍包含当前范围的全部笔记。降低上限会删除超出部分最早的笔记，请先导出备份。": "Notes, caption caches, and settings share local extension storage. Notes use a 7 MB safety line; new notes are not saved when space is insufficient. Above 100 notes, the side panel loads 100 notes per page, while exports still include the whole current scope. Lowering the limit removes the oldest excess notes, so export a backup first.",
  "保存笔记设置": "Save note settings",
  "笔记设置已保存": "Note settings saved",
  "保存后已清理最早的": "After saving, removed the oldest",
  "条笔记。": "notes.",
  "YouTube 字幕服务": "YouTube caption services",
  "Bilibili 字幕直接读取平台接口。YouTube 默认使用本地获取；如本地不可用，可在下拉框中改用一个字幕服务商 API。": "Bilibili captions are read from the platform API. YouTube uses local retrieval by default; if it is unavailable, choose one caption provider API from the dropdown.",
  "保存字幕服务商": "Save caption provider",
  "API Key 仅保存在本机扩展存储，且只会发送给对应服务商。保存时 Chrome 会请求已配置服务商的域名访问权限。": "API keys are stored only in local extension storage and sent only to their matching provider. Saving requests Chrome host access for configured provider domains.",
  "字幕服务商": "Caption provider",
  "服务商说明": "Provider notes",
  "申请 API Key ↗": "Get API key ↗",
  "查看 API 文档、额度与限制 ↗": "View API docs, quota & limits ↗",
  "字幕服务商已保存": "Caption provider saved",
  "没有获得已配置字幕服务商的域名权限。": "Host permission was not granted for the configured caption provider.",
  "AI 服务": "AI services",
  "可配置多个 AI 服务。按从上到下的顺序请求，前一项发生可恢复故障后才会尝试下一项；直接拖动卡片即可调整顺序。": "Configure multiple AI services. They are tried from top to bottom; the next service is requested only after a recoverable failure. Drag cards to reorder them.",
  "添加 AI 服务": "Add AI service",
  "AI 服务": "AI service",
  "主服务（首选）": "Primary (preferred)",
  "备用服务": "Fallback service",
  "默认优先请求；发生可恢复故障后才会尝试后续服务。": "Requested first; later services are tried only after a recoverable failure.",
  "前面的服务发生可恢复故障时，才会尝试此服务。": "Tried only after an earlier service has a recoverable failure.",
  "拖动排序": "Drag to reorder",
  "AI 服务已保存并授权": "AI services saved and authorized",
  "尚未添加 AI 服务。": "No AI service added yet.",
  "最多只能添加 8 个 AI 服务。": "You can add up to 8 AI services.",
  "请至少添加一个 AI 服务。": "Add at least one AI service.",
  "未测试": "Not tested",
  "服务商": "Provider",
  "API 协议": "API protocol",
  "OpenAI 兼容": "OpenAI-compatible",
  "API 地址（base_url）": "API base URL",
  "自动拼接": "The endpoint is appended automatically:",
  "；明文 HTTP 仅允许本机。": "; plain HTTP is allowed only for localhost.",
  "本地模型可以留空。失焦后仅显示前 2 位与后 3 位。": "Optional for local models. When unfocused, only the first 2 and last 3 characters are shown.",
  "模型": "Model",
  "模型名": "Model name",
  "选择 AI 服务模型": "Choose AI service model",
  "选择已获取的模型": "Choose a fetched model",
  "拉取模型": "Fetch models",
  "可手动填写，或从服务端拉取。": "Enter one manually or fetch it from the provider.",
  "DeepSeek 默认模型：deepseek-v4-flash，可直接保存或改为其他模型。": "DeepSeek default: deepseek-v4-flash. Save it as-is or choose another model.",
  "测试此服务": "Test service",
  "并发数": "Concurrency",
  "所有 AI 服务共用此并发上限，默认 3。": "All AI services share this limit; default: 3.",
  "单次请求超时（秒）": "Request timeout (seconds)",
  "最大输出 token": "Maximum output tokens",
  "默认 32768，所有 AI 服务共用。首次请求按任务估算，截断重试最多使用此额度；请勿超过所用模型支持的上限。": "Default: 32768, shared by all AI services. Initial budgets depend on the task; truncation retries use up to this limit. Do not exceed your model's supported limit.",
  "某项服务超时后会尝试下一项服务。": "The next service is tried after one service times out.",
  "保存模型配置": "Save model configuration",
  "保存时 Chrome 会一次性请求已配置 AI 服务的域名权限。仅在网络错误、超时、HTTP 408/409/425/429 或 5xx 时尝试下一项；密钥错误、模型错误和请求格式错误不会自动回退。": "Chrome requests host access for configured AI service domains in one step. Only network errors, timeouts, HTTP 408/409/425/429, or 5xx responses try the next service; key, model, and request-format errors never do.",
  "获取密钥 →": "Get API key →",
  "正在拉取模型…": "Fetching models…",
  "服务没有返回模型列表，请手动填写。": "The provider returned no models; enter one manually.",
  "模型列表已更新": "Model list updated",
  "配置不完整": "Incomplete",
  "正在测试…": "Testing…",
  "测试成功": "Test successful",
  "测试成功：支持视觉输入": "Test successful: vision input supported",
  "连接正常": "Healthy",
  "连接失败": "Failed",
  "需要授权才能访问该地址。": "Host permission is required for this address.",
  "API 地址不合法。": "The API URL is invalid.",
  "没有获得所有已启用 Provider 的域名权限。": "Host permission was not granted for every enabled provider.",
  "主备配置已保存并授权": "Primary and backup saved and authorized",
  "请填写 API 地址。": "Enter an API URL.",
  "API 地址不是合法的 URL。": "The API URL is invalid.",
  "API 地址必须以 http:// 或 https:// 开头。": "The API URL must start with http:// or https://.",
  "只有本机地址允许用 http，其余请用 https，否则密钥会明文传输。": "HTTP is allowed only for localhost; use HTTPS elsewhere to protect the API key.",
  "请填写 API 密钥。": "Enter an API key.",
  "请填写模型名，或点「拉取模型列表」选一个。": "Enter a model name or choose one with Fetch models.",
  "自定义": "Custom",
  "Google Gemini（OpenAI 兼容端点）": "Google Gemini (OpenAI-compatible endpoint)",
  "月之暗面 Kimi": "Moonshot Kimi",
  "智谱 GLM": "Zhipu GLM",
  "阿里云百炼（通义千问）": "Alibaba Cloud Model Studio (Qwen)",
  "火山方舟（Agent Plan）": "Volcengine Ark (Agent Plan)",
  "硅基流动 SiliconFlow": "SiliconFlow",
  "本地 Ollama": "Local Ollama",
});

const ZH_TEXT = Object.freeze(
  Object.fromEntries(Object.entries(EN_TEXT).map(([zh, en]) => [en, zh])),
);

function translateText(text) {
  const value = String(text ?? "");
  const dictionary = uiLanguage === "en" ? EN_TEXT : ZH_TEXT;
  if (dictionary[value]) return dictionary[value];

  const replacements = uiLanguage === "en"
    ? [
        [/^已获取 (\d+) 个模型。$/, "Fetched $1 models."],
        [/^模型回复：/, "Model reply: "],
        [/^拉取失败：/, "Fetch failed: "],
        [/^测试失败：/, "Test failed: "],
        [/^保存失败：/, "Save failed: "],
        [/^保存后已清理最早的 (\d+) 条笔记。$/, "After saving, removed the oldest $1 notes."],
        [/^备用服务：/, "Backup: "],
      ]
    : [
        [/^Fetched (\d+) models\.$/, "已获取 $1 个模型。"],
        [/^Model reply: /, "模型回复："],
        [/^Fetch failed: /, "拉取失败："],
        [/^Test failed: /, "测试失败："],
        [/^Save failed: /, "保存失败："],
        [/^After saving, removed the oldest (\d+) notes\.$/, "保存后已清理最早的 $1 条笔记。"],
        [/^Backup: /, "备用服务："],
      ];
  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
}

function applyPageLanguage() {
  document.documentElement.lang = uiLanguage;
  document.title = uiLanguage === "en" ? "Video Assistant Settings" : "Video Assistant 设置";

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const match = node.nodeValue.match(/^(\s*)(.*?)(\s*)$/s);
    if (!match?.[2]) continue;
    node.nodeValue = `${match[1]}${translateText(match[2])}${match[3]}`;
  }
  for (const element of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
    for (const attribute of ["placeholder", "title", "aria-label"]) {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, translateText(element.getAttribute(attribute)));
      }
    }
  }
  for (const button of document.querySelectorAll("[data-language]")) {
    button.setAttribute("aria-pressed", String(button.dataset.language === uiLanguage));
  }
}

// 普通浏览器直接打开 options.html 时使用内存桩，方便本地预览；扩展环境始终使用 chrome API。
const chromeApi = globalThis.chrome?.storage?.local ? globalThis.chrome : {
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {},
    },
  },
  permissions: {
    async contains() {
      return false;
    },
    async request() {
      return true;
    },
  },
};

const storageKey = BILI_SETTINGS.STORAGE_KEY;
const globalStatus = document.getElementById("globalStatus");
const youtubeEnabled = document.getElementById("youtubeEnabled");
const bilibiliEnabled = document.getElementById("bilibiliEnabled");
const siteScopeStatus = document.getElementById("siteScopeStatus");
const captionProviderList = document.getElementById("captionProviderList");
const captionProvidersStatus = document.getElementById("captionProvidersStatus");
const aiProviderList = document.getElementById("aiProviderList");
const aiConcurrency = document.getElementById("aiConcurrency");
const aiTimeoutSeconds = document.getElementById("aiTimeoutSeconds");
const aiMaxOutputTokens = document.getElementById("aiMaxOutputTokens");
const noteLimit = document.getElementById("noteLimit");
const noteSettingsStatus = document.getElementById("noteSettingsStatus");
let uiLanguage = "zh-CN";
let overviewPrompts = BILI_SETTINGS.normalizeOverviewPrompts();
let youtubeCaptionProviders = BILI_SETTINGS.normalizeYoutubeCaptionProviders();
let aiProviders = BILI_SETTINGS.normalizeAiProviders();
let draggedAiProviderId = "";
let savedNoteLimit = BILI_SETTINGS.LIMITS.noteLimit.default;

const statusTimers = new WeakMap();

function showStatus(element, text, { sticky = false, error = false } = {}) {
  element.textContent = translateText(text);
  element.style.color = error ? "#d74747" : "";
  clearTimeout(statusTimers.get(element));
  if (!sticky) {
    statusTimers.set(
      element,
      setTimeout(() => {
        element.textContent = "";
        element.style.color = "";
      }, 5000),
    );
  }
}

function fillPresets(card) {
  card.preset.textContent = "";
  for (const preset of BILI_SETTINGS.PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = translateText(preset.label);
    card.preset.appendChild(option);
  }
}

function isCustom(card) {
  return card.preset.value === BILI_SETTINGS.CUSTOM_PRESET_ID;
}

function updateEndpoint(card) {
  card.endpointPreview.textContent =
    card.protocol.value === BILI_SETTINGS.PROTOCOLS.ANTHROPIC
      ? "/v1/messages"
      : "/chat/completions";
}

function updatePresetHint(card, preset) {
  card.presetHint.textContent = "";
  if (!preset?.docsUrl) return;
  const link = document.createElement("a");
  link.href = preset.docsUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = translateText("获取密钥 →");
  card.presetHint.appendChild(link);
}

function maskApiKey(value) {
  const key = String(value || "");
  if (!key) return "";
  // 短于前 2 位与后 3 位的总长度时，没有可安全遮住的中段。
  if (key.length <= 5) return key;
  return `${key.slice(0, 2)}${"•".repeat(Math.max(4, key.length - 5))}${key.slice(-3)}`;
}

function apiKeyValue(input) {
  return String(input.dataset.secret ?? input.value ?? "");
}

function setApiKeyValue(input, value) {
  const key = String(value || "");
  input.dataset.secret = key;
  input.value = document.activeElement === input ? key : maskApiKey(key);
}

function enableApiKeyMask(input) {
  input.type = "text";
  input.addEventListener("focus", () => {
    input.value = apiKeyValue(input);
  });
  input.addEventListener("input", () => {
    input.dataset.secret = input.value;
  });
  input.addEventListener("blur", () => {
    input.value = maskApiKey(apiKeyValue(input));
  });
}

function modelOptionValues(card) {
  return [...card.modelOptions.options]
    .map((option) => option.value)
    .filter(Boolean);
}

function setModelOptions(card, input, { showCount = false } = {}) {
  const preset = BILI_SETTINGS.presetById(card.preset.value);
  const current = card.model.value.trim();
  const models = [
    ...new Set(
      [
        "deepseek-v4-flash",
        "gpt-5.6-terra",
        preset?.model,
        current,
        ...(Array.isArray(input) ? input : []),
      ]
        .filter((model) => typeof model === "string" && model.trim())
        .map((model) => model.trim()),
    ),
  ];

  card.modelOptions.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = translateText("选择已获取的模型");
  card.modelOptions.appendChild(placeholder);
  for (const id of models) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    card.modelOptions.appendChild(option);
  }
  card.modelOptions.value = models.includes(current) ? current : "";

  if (showCount && input.length) {
    card.modelsHint.textContent = `已获取 ${input.length} 个模型。`;
  } else if (preset?.id === "deepseek" && current === preset.model) {
    card.modelsHint.textContent = translateText(
      "DeepSeek 默认模型：deepseek-v4-flash，可直接保存或改为其他模型。",
    );
  } else {
    card.modelsHint.textContent = translateText(
      "内置 deepseek-v4-flash 与 gpt-5.6-terra，也可手动填写或从服务端拉取。",
    );
  }
}

function syncPresetFields(card) {
  const preset = BILI_SETTINGS.presetById(card.preset.value);
  if (!preset) return;
  if (preset.id !== BILI_SETTINGS.CUSTOM_PRESET_ID) {
    card.protocol.value = preset.protocol;
    card.baseUrl.value = preset.baseUrl;
  }
  card.customFields.hidden = !isCustom(card);
  updatePresetHint(card, preset);
  updateEndpoint(card);
}

function readProvider(card, presetId = card.preset.value) {
  const useCustomFields = presetId === BILI_SETTINGS.CUSTOM_PRESET_ID;
  return BILI_SETTINGS.normalize({
    presetId,
    protocol: useCustomFields ? card.protocol.value : undefined,
    aiBaseUrl: useCustomFields ? card.baseUrl.value : undefined,
    aiApiKey: apiKeyValue(card.apiKey),
    aiModel: card.model.value,
    availableModels: modelOptionValues(card),
    supportsVision: card.supportsVision === true,
  });
}

function writeProvider(card, provider) {
  const settings = BILI_SETTINGS.normalize(provider);
  card.preset.value = settings.presetId;
  card.protocol.value = settings.protocol;
  card.baseUrl.value = settings.aiBaseUrl;
  setApiKeyValue(card.apiKey, settings.aiApiKey);
  card.model.value = settings.aiModel;
  card.supportsVision = settings.supportsVision;
  syncPresetFields(card);
  card.baseUrl.value = settings.aiBaseUrl;
  setModelOptions(card, settings.availableModels, {
    showCount: settings.availableModels.length > 0,
  });
  card.currentPresetId = settings.presetId;
}

function createAiProviderId() {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `ai-${random}`;
}

function createField(labelText) {
  const field = document.createElement("label");
  field.className = "field";
  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = translateText(labelText);
  field.appendChild(label);
  return { field, label };
}

function aiProviderControl(text, { disabled = false, onClick } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-btn ai-provider-control";
  button.textContent = translateText(text);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function createAiProviderCard(provider, index, total) {
  const root = document.createElement("article");
  root.className = "provider-card ai-provider-card";
  root.dataset.aiProvider = "true";
  root.dataset.aiProviderId = provider.id;

  const card = {
    root,
    presetStates: new Map(provider._presetStates || []),
  };
  root._aiProviderCard = card;

  const titleRow = document.createElement("div");
  titleRow.className = "provider-title-row";
  const title = document.createElement("div");
  const dragHandle = document.createElement("span");
  dragHandle.className = "ai-provider-drag-handle";
  dragHandle.textContent = "⠿";
  dragHandle.draggable = true;
  dragHandle.title = translateText("拖动排序");
  dragHandle.setAttribute("aria-label", translateText("拖动排序"));
  const badge = document.createElement("span");
  badge.className = `role-badge ${index === 0 ? "role-primary" : "role-backup"}`;
  badge.textContent = index === 0 ? "PRIMARY" : "FALLBACK";
  const heading = document.createElement("h3");
  heading.textContent = index === 0
    ? translateText("主服务（首选）")
    : `${translateText("备用服务")} ${index}`;
  title.append(dragHandle, badge, heading);
  const health = document.createElement("span");
  health.className = "provider-health";
  health.textContent = translateText("未测试");
  card.health = health;
  titleRow.append(title, health);

  const controls = document.createElement("div");
  controls.className = "ai-provider-controls";
  controls.append(
    aiProviderControl("上移", {
      disabled: index === 0,
      onClick: () => moveAiProvider(index, -1),
    }),
    aiProviderControl("下移", {
      disabled: index === total - 1,
      onClick: () => moveAiProvider(index, 1),
    }),
    aiProviderControl("删除", { onClick: () => removeAiProvider(provider.id) }),
  );

  const description = document.createElement("p");
  description.className = "provider-description";
  description.textContent = translateText(
    index === 0
      ? "默认优先请求；发生可恢复故障后才会尝试后续服务。"
      : "前面的服务发生可恢复故障时，才会尝试此服务。",
  );

  const presetField = createField("服务商");
  const preset = document.createElement("select");
  card.preset = preset;
  presetField.field.appendChild(preset);
  const presetHint = document.createElement("span");
  presetHint.className = "field-hint";
  card.presetHint = presetHint;
  presetField.field.appendChild(presetHint);
  fillPresets(card);

  const customFields = document.createElement("div");
  customFields.hidden = true;
  card.customFields = customFields;
  const protocolField = createField("API 协议");
  const protocol = document.createElement("select");
  protocol.append(
    new Option(translateText("OpenAI 兼容"), "openai"),
    new Option("Anthropic", "anthropic"),
  );
  card.protocol = protocol;
  protocolField.field.appendChild(protocol);
  const baseField = createField("API 地址（base_url）");
  const baseUrl = document.createElement("input");
  baseUrl.type = "url";
  baseUrl.autocomplete = "off";
  baseUrl.spellcheck = false;
  baseUrl.placeholder = "https://api.example.com/v1";
  card.baseUrl = baseUrl;
  baseField.field.appendChild(baseUrl);
  const endpointHint = document.createElement("span");
  endpointHint.className = "field-hint";
  endpointHint.append(`${translateText("自动拼接")} `);
  const endpointPreview = document.createElement("code");
  endpointPreview.textContent = "/chat/completions";
  card.endpointPreview = endpointPreview;
  endpointHint.append(endpointPreview, translateText("；明文 HTTP 仅允许本机。"));
  baseField.field.appendChild(endpointHint);
  customFields.append(protocolField.field, baseField.field);

  const keyField = createField("API Key");
  const apiKey = document.createElement("input");
  apiKey.autocomplete = "off";
  apiKey.spellcheck = false;
  apiKey.placeholder = "sk-...";
  card.apiKey = apiKey;
  enableApiKeyMask(apiKey);
  keyField.field.appendChild(apiKey);
  const keyHint = document.createElement("span");
  keyHint.className = "field-hint";
  keyHint.textContent = translateText("本地模型可以留空。失焦后仅显示前 2 位与后 3 位。");
  keyField.field.appendChild(keyHint);

  const modelField = createField("模型");
  const modelRow = document.createElement("span");
  modelRow.className = "field-row model-field-row";
  const combo = document.createElement("span");
  combo.className = "model-combobox";
  const model = document.createElement("input");
  model.type = "text";
  model.autocomplete = "off";
  model.spellcheck = false;
  model.placeholder = translateText("模型名");
  card.model = model;
  const modelOptions = document.createElement("select");
  modelOptions.className = "model-option-select";
  modelOptions.setAttribute("aria-label", translateText("选择 AI 服务模型"));
  card.modelOptions = modelOptions;
  combo.append(model, modelOptions);
  const modelsButton = document.createElement("button");
  modelsButton.type = "button";
  modelsButton.className = "ghost-btn";
  modelsButton.textContent = translateText("拉取模型");
  modelRow.append(combo, modelsButton);
  modelField.field.appendChild(modelRow);
  const modelsHint = document.createElement("span");
  modelsHint.className = "field-hint";
  card.modelsHint = modelsHint;
  modelField.field.appendChild(modelsHint);

  const actions = document.createElement("div");
  actions.className = "provider-actions";
  const testButton = document.createElement("button");
  testButton.type = "button";
  testButton.className = "ghost-btn";
  testButton.textContent = translateText("测试此服务");
  const status = document.createElement("span");
  status.className = "status";
  status.setAttribute("role", "status");
  card.status = status;
  actions.append(testButton, status);

  root.append(titleRow, controls, description, presetField.field, customFields, keyField.field, modelField.field, actions);

  card.presetStates.set(provider.presetId, BILI_SETTINGS.normalize(provider));
  writeProvider(card, provider);
  preset.addEventListener("change", () => restoreProviderPreset(card));
  protocol.addEventListener("change", () => {
    card.supportsVision = false;
    updateEndpoint(card);
  });
  baseUrl.addEventListener("input", () => { card.supportsVision = false; });
  apiKey.addEventListener("input", () => { card.supportsVision = false; });
  model.addEventListener("input", () => {
    card.supportsVision = false;
    modelOptions.value = modelOptionValues(card).includes(model.value.trim())
      ? model.value.trim()
      : "";
  });
  modelOptions.addEventListener("change", () => {
    if (!modelOptions.value) return;
    model.value = modelOptions.value;
    card.supportsVision = false;
    setHealth(card, "未测试", "");
  });
  modelsButton.addEventListener("click", () => fetchModels(card));
  testButton.addEventListener("click", () => testProvider(card));

  wireAiProviderDrag(root, dragHandle, provider.id);
  return root;
}

function restoreProviderPreset(card) {
  // change 事件触发时 select 已经指向新值；用上次的值保存旧服务商的字段，
  // 才不会把旧 Key/模型误覆盖到新服务商，或在切回时被清空。
  const previousPresetId = card.currentPresetId || card.preset.value;
  card.presetStates.set(previousPresetId, readProvider(card, previousPresetId));
  const nextPresetId = card.preset.value;
  writeProvider(card, card.presetStates.get(nextPresetId) || { presetId: nextPresetId });
  setHealth(card, "未测试", "");
}

function normalizeUiAiProviders(input = aiProviders) {
  const raw = Array.isArray(input) ? input : [];
  const statesById = new Map(raw.map((provider) => [provider?.id, provider?._presetStates]));
  return BILI_SETTINGS.normalizeAiProviders(raw).map((provider) => ({
    ...provider,
    _presetStates: statesById.get(provider.id),
  }));
}

function readAiProviders() {
  return [...aiProviderList.querySelectorAll("[data-ai-provider]")].map((root) => {
    const card = root._aiProviderCard;
    return {
      id: root.dataset.aiProviderId,
      ...readProvider(card),
      _presetStates: [...card.presetStates.entries()],
    };
  });
}

function renderAiProviders(input = aiProviders) {
  const providers = normalizeUiAiProviders(input);
  aiProviders = providers;
  aiProviderList.textContent = "";
  if (!providers.length) {
    const empty = document.createElement("p");
    empty.className = "field-hint ai-provider-empty";
    empty.textContent = translateText("尚未添加 AI 服务。");
    aiProviderList.appendChild(empty);
    return;
  }
  providers.forEach((provider, index) => {
    aiProviderList.appendChild(createAiProviderCard(provider, index, providers.length));
  });
}

function moveAiProvider(index, direction) {
  const providers = readAiProviders();
  const target = index + direction;
  if (target < 0 || target >= providers.length) return;
  [providers[index], providers[target]] = [providers[target], providers[index]];
  renderAiProviders(providers);
}

function moveAiProviderById(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const providers = readAiProviders();
  const sourceIndex = providers.findIndex((provider) => provider.id === sourceId);
  const targetIndex = providers.findIndex((provider) => provider.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [source] = providers.splice(sourceIndex, 1);
  providers.splice(targetIndex, 0, source);
  renderAiProviders(providers);
}

function wireAiProviderDrag(root, handle, id) {
  handle.addEventListener("dragstart", (event) => {
    draggedAiProviderId = id;
    root.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  });
  handle.addEventListener("dragend", () => {
    draggedAiProviderId = "";
    document.querySelectorAll(".ai-provider-card.dragging, .ai-provider-card.drag-over")
      .forEach((element) => element.classList.remove("dragging", "drag-over"));
  });
  root.addEventListener("dragover", (event) => {
    if (!draggedAiProviderId || draggedAiProviderId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    root.classList.add("drag-over");
  });
  root.addEventListener("dragleave", () => root.classList.remove("drag-over"));
  root.addEventListener("drop", (event) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggedAiProviderId;
    root.classList.remove("drag-over");
    moveAiProviderById(sourceId, id);
  });
}

function addAiProvider() {
  const providers = readAiProviders();
  if (providers.length >= BILI_SETTINGS.MAX_AI_PROVIDERS) {
    showStatus(globalStatus, "最多只能添加 8 个 AI 服务。", { sticky: true, error: true });
    return;
  }
  providers.push({ id: createAiProviderId(), presetId: "deepseek" });
  renderAiProviders(providers);
  aiProviderList.querySelectorAll("[data-ai-provider]")
    .item(providers.length - 1)
    ?.querySelector("select")
    ?.focus();
}

function removeAiProvider(id) {
  renderAiProviders(readAiProviders().filter((provider) => provider.id !== id));
}

function currentAppSettings() {
  return BILI_SETTINGS.normalizeAppSettings({
    aiProviders: readAiProviders(),
    aiConcurrency: aiConcurrency.value,
    aiTimeoutSeconds: aiTimeoutSeconds.value,
    aiMaxOutputTokens: aiMaxOutputTokens.value,
    youtubeCaptionProviders: readCaptionProviders(),
    youtubeEnabled: youtubeEnabled.checked,
    bilibiliEnabled: bilibiliEnabled.checked,
    noteLimit: savedNoteLimit,
    uiLanguage,
    overviewPrompts,
  });
}

async function saveNoteSettings() {
  const normalizedLimit = BILI_SETTINGS.normalizeAppSettings({
    noteLimit: noteLimit.value,
  }).noteLimit;
  noteLimit.disabled = true;
  try {
    const stats = await chromeApi.runtime?.sendMessage?.({ action: "getNoteStats" });
    if (
      Number(stats?.totalCount) > normalizedLimit &&
      typeof globalThis.confirm === "function"
    ) {
      const warning =
        uiLanguage === "en"
          ? `Lowering the limit to ${normalizedLimit} will permanently remove ${stats.totalCount - normalizedLimit} oldest notes. Continue?`
          : `将上限降至 ${normalizedLimit} 条会永久删除最早的 ${stats.totalCount - normalizedLimit} 条笔记，是否继续？`;
      if (!globalThis.confirm(warning)) return;
    }
    const stored = await chromeApi.storage.local.get([
      storageKey,
      BILI_SETTINGS.LEGACY_STORAGE_KEY,
    ]);
    const current = BILI_SETTINGS.normalizeAppSettings(
      stored[storageKey] ?? stored[BILI_SETTINGS.LEGACY_STORAGE_KEY],
    );
    const next = BILI_SETTINGS.normalizeAppSettings({ ...current, noteLimit: normalizedLimit });
    await chromeApi.storage.local.set({ [storageKey]: next });
    savedNoteLimit = next.noteLimit;
    noteLimit.value = savedNoteLimit;
    const result = await chromeApi.runtime?.sendMessage?.({ action: "applyNoteLimit" });
    const removedCount = Number(result?.removedCount) || 0;
    showStatus(
      noteSettingsStatus,
      removedCount ? `保存后已清理最早的 ${removedCount} 条笔记。` : "笔记设置已保存",
      { sticky: removedCount > 0 },
    );
  } catch (error) {
    showStatus(noteSettingsStatus, `保存失败：${error.message}`, { sticky: true, error: true });
  } finally {
    noteLimit.disabled = false;
  }
}

async function notifySiteScopeChanged(settings) {
  try {
    await chromeApi.runtime?.sendMessage?.({
      action: "notifySiteScopeChanged",
      youtubeEnabled: settings.youtubeEnabled,
      bilibiliEnabled: settings.bilibiliEnabled,
    });
  } catch (error) {
    // 存储已成功；某个页面尚未加载内容脚本时广播失败不影响下次打开页面。
  }
}

function setHealth(card, text, state) {
  card.health.textContent = translateText(text);
  card.health.classList.toggle("ok", state === "ok");
  card.health.classList.toggle("error", state === "error");
}

async function ensurePermissionInteractive(provider) {
  const origin = BILI_SETTINGS.originOf(provider.aiBaseUrl);
  if (!origin) throw new Error("API 地址不合法。");
  if (await chromeApi.permissions.contains({ origins: [origin] })) return true;
  return chromeApi.permissions.request({ origins: [origin] });
}

async function requestMissingOrigins(origins, deniedMessage) {
  const missing = [];
  for (const origin of origins) {
    if (!(await chromeApi.permissions.contains({ origins: [origin] }))) missing.push(origin);
  }
  if (missing.length && !(await chromeApi.permissions.request({ origins: missing }))) {
    throw new Error(deniedMessage);
  }
}

async function fetchModels(card) {
  const provider = readProvider(card);
  const check = BILI_SETTINGS.validate(provider);
  const baseErrors = check.errors.filter((error) => !error.includes("模型名"));
  if (baseErrors.length) {
    showStatus(card.status, baseErrors.join(" "), { sticky: true, error: true });
    return;
  }

  try {
    if (!(await ensurePermissionInteractive(provider))) {
      throw new Error("需要授权才能访问该地址。");
    }
    showStatus(card.status, "正在拉取模型…", { sticky: true });
    const request = BILI_AI_PROVIDER.buildModelsRequest(provider);
    const response = await fetch(request.url, { headers: request.headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(BILI_AI_PROVIDER.parseErrorMessage(data, response.status));
    }
    const models = BILI_AI_PROVIDER.parseModelsResponse(data);
    if (!models.length) throw new Error("服务没有返回模型列表，请手动填写。");
    setModelOptions(card, models, { showCount: true });
    if (!card.model.value) card.model.value = models[0];
    card.modelOptions.value = card.model.value;
    showStatus(card.status, "模型列表已更新");
  } catch (error) {
    showStatus(card.status, `拉取失败：${error.message}`, {
      sticky: true,
      error: true,
    });
  }
}

async function testProvider(card) {
  const provider = readProvider(card);
  const check = BILI_SETTINGS.validate(provider);
  if (!check.ok) {
    showStatus(card.status, check.errors.join(" "), { sticky: true, error: true });
    setHealth(card, "配置不完整", "error");
    return;
  }

  try {
    if (!(await ensurePermissionInteractive(provider))) {
      throw new Error("需要授权才能访问该地址。");
    }
    showStatus(card.status, "正在测试…", { sticky: true });
    const requestOnce = async (messages) => {
      const request = BILI_AI_PROVIDER.buildChatRequest({
        settings: provider,
        messages,
        maxTokens: 32,
      });
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(BILI_AI_PROVIDER.parseErrorMessage(data, response.status));
      }
      return BILI_AI_PROVIDER.parseChatResponse(provider.protocol, data).trim();
    };

    // 图片里只写一个随机性低的短码，必须真正读取图片才能答对。视觉请求
    // 被拒或答错时，再发纯文本请求；后者成功仍表示 Provider 可用于本扩展。
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    context.fillStyle = "#111827";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "bold 48px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("VA7", canvas.width / 2, canvas.height / 2);
    const probeImage = canvas.toDataURL("image/png");
    const probeMessages = BILI_AI_PROVIDER.attachImagesToLastUserMessage(
      provider.protocol,
      [{ role: "user", content: "Read the exact three-character code in the image. Reply with only that code." }],
      [probeImage],
    );

    let supportsVision = false;
    try {
      const visionText = await requestOnce(probeMessages);
      supportsVision = /VA\s*7/i.test(visionText);
    } catch {
      // 不支持视觉输入不是连接失败，继续做纯文本连通性测试。
    }
    if (!supportsVision) {
      await requestOnce([{ role: "user", content: "回复两个字：可用" }]);
    }
    card.supportsVision = supportsVision;
    setHealth(card, "连接正常", "ok");
    showStatus(card.status, supportsVision ? "测试成功：支持视觉输入" : "测试成功", {
      sticky: true,
    });
  } catch (error) {
    setHealth(card, "连接失败", "error");
    showStatus(card.status, `测试失败：${error.message}`, {
      sticky: true,
      error: true,
    });
  }
}

async function save() {
  const appSettings = currentAppSettings();
  const check = BILI_SETTINGS.validateAppSettings(appSettings);
  if (!check.ok) {
    showStatus(globalStatus, check.errors.join(" "), {
      sticky: true,
      error: true,
    });
    return;
  }

  const origins = [
    ...new Set(
      [
        ...BILI_SETTINGS.activeProviders(appSettings)
          .map(({ settings }) => BILI_SETTINGS.originOf(settings.aiBaseUrl)),
        ...appSettings.youtubeCaptionProviders
          .filter((provider) => provider.apiKey)
          .map((provider) => BILI_SETTINGS.captionProviderById(provider.providerId)?.origin),
      ].filter(Boolean),
    ),
  ];

  try {
    // 一次请求两个 origin，确保仍在同一个用户点击手势里。
    await requestMissingOrigins(origins, "没有获得所有已启用 Provider 的域名权限。");
    await chromeApi.storage.local.set({ [storageKey]: appSettings });
    await notifySiteScopeChanged(appSettings);
    aiConcurrency.value = appSettings.aiConcurrency;
    aiTimeoutSeconds.value = appSettings.aiTimeoutSeconds;
    aiMaxOutputTokens.value = appSettings.aiMaxOutputTokens;
    aiProviders = appSettings.aiProviders;
    showStatus(globalStatus, "AI 服务已保存并授权");
  } catch (error) {
    showStatus(globalStatus, `保存失败：${error.message}`, {
      sticky: true,
      error: true,
    });
  }
}

async function saveSiteScope() {
  youtubeEnabled.disabled = true;
  bilibiliEnabled.disabled = true;
  try {
    const stored = await chromeApi.storage.local.get([
      storageKey,
      BILI_SETTINGS.LEGACY_STORAGE_KEY,
    ]);
    const settings = BILI_SETTINGS.normalizeAppSettings(
      stored[storageKey] ?? stored[BILI_SETTINGS.LEGACY_STORAGE_KEY],
    );
    const next = BILI_SETTINGS.normalizeAppSettings({
      ...settings,
      youtubeEnabled: youtubeEnabled.checked,
      bilibiliEnabled: bilibiliEnabled.checked,
    });
    await chromeApi.storage.local.set({ [storageKey]: next });
    await notifySiteScopeChanged(next);
    showStatus(siteScopeStatus, "适用范围已保存");
  } catch (error) {
    showStatus(siteScopeStatus, `保存失败：${error.message}`, {
      sticky: true,
      error: true,
    });
  } finally {
    youtubeEnabled.disabled = false;
    bilibiliEnabled.disabled = false;
  }
}

function readCaptionProviders() {
  if (!captionProviderList.children.length) return [];
  return BILI_SETTINGS.normalizeYoutubeCaptionProviders(
    [...captionProviderList.querySelectorAll("[data-caption-provider]")].map((card) => ({
      providerId: card.querySelector('[data-field="captionProviderId"]').value,
      apiKey: apiKeyValue(card.querySelector('[data-field="captionApiKey"]')),
    })),
  );
}

function providerDetail(profile) {
  return uiLanguage === "en" ? profile.detailEn : profile.detail;
}

function captionProviderLabel(profile) {
  return uiLanguage === "en" ? profile.labelEn || profile.label : profile.label;
}

function renderCaptionProviders(input = youtubeCaptionProviders) {
  const providers = BILI_SETTINGS.normalizeYoutubeCaptionProviders(input);
  youtubeCaptionProviders = providers;
  captionProviderList.textContent = "";
  const provider = providers[0];
  const profile = BILI_SETTINGS.captionProviderById(provider.providerId);
  const isLocal = provider.providerId === "local";

  const card = document.createElement("article");
  card.className = "caption-provider-card";
  card.dataset.captionProvider = "true";

    const providerField = document.createElement("label");
    providerField.className = "field";
    const providerLabel = document.createElement("span");
    providerLabel.className = "field-label";
    providerLabel.textContent = translateText("服务商");
    const providerSelect = document.createElement("select");
    providerSelect.dataset.field = "captionProviderId";
    for (const optionProfile of BILI_SETTINGS.YOUTUBE_CAPTION_PROVIDERS) {
      const option = document.createElement("option");
      option.value = optionProfile.id;
      option.textContent = captionProviderLabel(optionProfile);
      providerSelect.appendChild(option);
    }
    providerSelect.value = provider.providerId;
    providerSelect.addEventListener("change", () => {
      // 不同服务商的密钥不可复用，切换时主动清空，避免误发到另一个域名。
      renderCaptionProviders([{ providerId: providerSelect.value, apiKey: "" }]);
    });
    providerField.append(providerLabel, providerSelect);

    const keyField = document.createElement("label");
    keyField.className = "field";
    const keyLabel = document.createElement("span");
    keyLabel.className = "field-label";
    keyLabel.textContent = `${profile.label} API Key`;
    const keyInput = document.createElement("input");
    keyInput.autocomplete = "off";
    keyInput.spellcheck = false;
    keyInput.placeholder = "API Key";
    keyInput.dataset.field = "captionApiKey";
    enableApiKeyMask(keyInput);
    setApiKeyValue(keyInput, provider.apiKey);
    keyField.append(keyLabel, keyInput);
    keyField.hidden = profile.requiresApiKey === false;

    const info = document.createElement("section");
    info.className = "caption-provider-info";
    const infoTitle = document.createElement("strong");
    infoTitle.textContent = translateText("服务商说明");
    const detail = document.createElement("p");
    detail.textContent = providerDetail(profile);
    const links = document.createElement("p");
    links.className = "caption-provider-links";
    const dashboard = document.createElement("a");
    dashboard.href = profile.dashboardUrl || "#";
    dashboard.target = "_blank";
    dashboard.rel = "noreferrer";
    dashboard.textContent = translateText("申请 API Key ↗");
    const docs = document.createElement("a");
    docs.href = profile.docsUrl || "#";
    docs.target = "_blank";
    docs.rel = "noreferrer";
    docs.textContent = translateText("查看 API 文档、额度与限制 ↗");
    links.append(dashboard, docs);
    links.hidden = !profile.dashboardUrl && !profile.docsUrl;
    info.append(infoTitle, detail, links);

  card.append(providerField, keyField, info);
  captionProviderList.appendChild(card);
}

async function saveCaptionProviders() {
  try {
    const stored = await chromeApi.storage.local.get([
      storageKey,
      BILI_SETTINGS.LEGACY_STORAGE_KEY,
    ]);
    const settings = BILI_SETTINGS.normalizeAppSettings(
      stored[storageKey] ?? stored[BILI_SETTINGS.LEGACY_STORAGE_KEY],
    );
    const providers = readCaptionProviders();
    const next = BILI_SETTINGS.normalizeAppSettings({
      ...settings,
      youtubeCaptionProviders: providers,
    });
    const origins = [
      ...new Set(
        next.youtubeCaptionProviders
          .filter((provider) => provider.apiKey)
          .map((provider) => BILI_SETTINGS.captionProviderById(provider.providerId)?.origin)
          .filter(Boolean),
      ),
    ];
    await requestMissingOrigins(origins, "没有获得已配置字幕服务商的域名权限。");
    await chromeApi.storage.local.set({ [storageKey]: next });
    renderCaptionProviders(next.youtubeCaptionProviders);
    showStatus(captionProvidersStatus, "字幕服务商已保存");
  } catch (error) {
    showStatus(captionProvidersStatus, `保存失败：${error.message}`, {
      sticky: true,
      error: true,
    });
  }
}

async function load() {
  const stored = await chromeApi.storage.local.get([
    storageKey,
    BILI_SETTINGS.LEGACY_STORAGE_KEY,
  ]);
  const settings = BILI_SETTINGS.normalizeAppSettings(
    stored[storageKey] ?? stored[BILI_SETTINGS.LEGACY_STORAGE_KEY],
  );
  aiProviders = settings.aiProviders;
  aiConcurrency.value = settings.aiConcurrency;
  aiTimeoutSeconds.value = settings.aiTimeoutSeconds;
  aiMaxOutputTokens.value = settings.aiMaxOutputTokens;
  savedNoteLimit = settings.noteLimit;
  noteLimit.value = savedNoteLimit;
  youtubeCaptionProviders = settings.youtubeCaptionProviders;
  youtubeEnabled.checked = settings.youtubeEnabled;
  bilibiliEnabled.checked = settings.bilibiliEnabled;
  uiLanguage = settings.uiLanguage;
  overviewPrompts = { ...settings.overviewPrompts };
  document.documentElement.lang = uiLanguage;
  applyPageLanguage();
  renderAiProviders(aiProviders);
  renderCaptionProviders(youtubeCaptionProviders);
}

youtubeEnabled.addEventListener("change", saveSiteScope);
bilibiliEnabled.addEventListener("change", saveSiteScope);
document.getElementById("addAiProviderBtn").addEventListener("click", addAiProvider);
document
  .getElementById("saveCaptionProvidersBtn")
  .addEventListener("click", saveCaptionProviders);
document.getElementById("saveBtn").addEventListener("click", save);
document.getElementById("saveNoteSettingsBtn").addEventListener("click", saveNoteSettings);
for (const button of document.querySelectorAll("[data-language]")) {
  button.addEventListener("click", async () => {
    uiLanguage = button.dataset.language;
    applyPageLanguage();
    renderAiProviders(readAiProviders());
    renderCaptionProviders(readCaptionProviders());
    const stored = await chromeApi.storage.local.get([
      storageKey,
      BILI_SETTINGS.LEGACY_STORAGE_KEY,
    ]);
    const current = BILI_SETTINGS.normalizeAppSettings(
      stored[storageKey] ?? stored[BILI_SETTINGS.LEGACY_STORAGE_KEY],
    );
    await chromeApi.storage.local.set({
      [storageKey]: { ...current, uiLanguage },
    });
    try {
      await chromeApi.runtime?.sendMessage?.({
        action: "notifyUiLanguageChanged",
        uiLanguage,
      });
    } catch (error) {
      // 设置已经落库；没有打开侧栏时无需广播。
    }
  });
}

load();
