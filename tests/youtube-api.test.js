const test = require("node:test");
const assert = require("node:assert/strict");

const youtube = require("../lib/youtube-api.js");

test("解析标准 YouTube 播放页并拒绝 Shorts", () => {
  assert.equal(
    youtube.parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"),
    "dQw4w9WgXcQ",
  );
  assert.equal(youtube.parseVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), null);
});

test("规范链接会移除播放列表和来源参数", () => {
  assert.equal(
    youtube.canonicalVideoUrl("dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert.equal(
    youtube.canonicalVideoUrl("dQw4w9WgXcQ", 65),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s",
  );
});

test("Supadata 内容归一化为通用秒级字幕并清理说话人标记", () => {
  const result = youtube.normalizeTranscript({
    lang: "en",
    availableLangs: ["en", "zh"],
    content: [
      { text: ">> Hello world", offset: 1500, duration: 2200, lang: "en" },
      { text: "  ", offset: 4000, duration: 1000 },
    ],
  });
  assert.deepEqual(result.transcript, [
    { text: "Hello world", start: 1.5, duration: 2.2, language: "en" },
  ]);
  assert.deepEqual(result.availableLanguages, ["en", "zh"]);
});

test("本地字幕轨只接受 YouTube timedtext，并按语言偏好选择", () => {
  const tracks = [
    {
      baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=en",
      languageCode: "en",
      name: "English",
      kind: "asr",
    },
    {
      baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hans",
      languageCode: "zh-Hans",
      name: "中文（简体）",
    },
    {
      baseUrl: "https://attacker.example/api/timedtext?v=abc",
      languageCode: "zh",
    },
  ];
  const normalized = youtube.normalizeLocalTracks(tracks);
  assert.equal(normalized.length, 2);
  assert.equal(
    youtube.pickLocalCaptionTrack(normalized, ["zh-CN", "en"]).languageCode,
    "zh-Hans",
  );
});

test("YouTube JSON3 字幕转为秒级分段并解码实体", () => {
  const result = youtube.normalizeJson3Transcript({
    events: [
      {
        tStartMs: 1250,
        dDurationMs: 2500,
        segs: [{ utf8: "Hello " }, { utf8: "&amp; world\n" }],
      },
      { tStartMs: 5000, dDurationMs: 1000 },
    ],
  }, "en");
  assert.deepEqual(result.transcript, [
    { text: "Hello & world", start: 1.25, duration: 2.5, language: "en" },
  ]);
});

test("YouTube timedtext XML 与 srv3 都能归一化", () => {
  const legacy = youtube.normalizeTimedTextBody(
    '<?xml version="1.0"?><transcript><text start="1.5" dur="2.25">A &amp; B</text></transcript>',
    "en",
  );
  assert.deepEqual(legacy.transcript[0], {
    text: "A & B",
    start: 1.5,
    duration: 2.25,
    language: "en",
  });
  const srv3 = youtube.normalizeTimedTextBody(
    '<timedtext format="3"><body><p t="2500" d="1000"><s>Hello</s> world</p></body></timedtext>',
    "en",
  );
  assert.equal(srv3.transcript[0].text, "Hello world");
  assert.equal(srv3.transcript[0].start, 2.5);
});

test("YouTube VTT 与 TTML 字幕都能归一化", () => {
  const vtt = youtube.normalizeTimedTextBody(
    "WEBVTT\n\n00:00:01.250 --> 00:00:03.500 align:start\nHello &amp; world",
    "en",
  );
  assert.deepEqual(vtt.transcript[0], {
    text: "Hello & world",
    start: 1.25,
    duration: 2.25,
    language: "en",
  });

  const ttml = youtube.normalizeTimedTextBody(
    '<tt><body><div><p begin="00:00:02.500" end="00:00:05.000"><span>TTML cue</span></p></div></body></tt>',
    "en",
  );
  assert.deepEqual(ttml.transcript[0], {
    text: "TTML cue",
    start: 2.5,
    duration: 2.5,
    language: "en",
  });
});

test("YouTube JSON3 兼容 XSSI 前缀、包装 events 与直接 text", () => {
  const result = youtube.normalizeTimedTextBody(
    `)]}'${JSON.stringify({ data: { events: [{ tStartMs: 500, dDurationMs: 1500, text: "Wrapped" }] } })}`,
    "en",
  );
  assert.equal(result.transcript[0].text, "Wrapped");
  assert.equal(result.transcript[0].start, 0.5);
});

test("本地字幕优先使用当前页面上下文返回的正文", async () => {
  const result = await youtube.fetchLocalTranscript(
    [{ baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=en", languageCode: "en", name: "English" }],
    ["en"],
    {
      localCaptionSource: {
        body: '<transcript><text start="0" dur="1">From page</text></transcript>',
      },
    },
  );
  assert.equal(result.transcript[0].text, "From page");
});

test("本地字幕未捕获正文时直接失败，不再回退直连字幕 URL", async () => {
  await assert.rejects(
    youtube.fetchLocalTranscript(
      [{
        baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=en",
        languageCode: "en",
        name: "English",
      }],
      ["en"],
      { localCaptionSource: { tracks: [] } },
    ),
    (error) => error?.code === "NO_SUBTITLE" && /没有捕获/.test(error.message),
  );
});

test("选中本地获取时只调用本地字幕", async () => {
  const calls = [];
  const result = await youtube.fetchTranscriptWithFallback(
    "dQw4w9WgXcQ",
    [
      { providerId: "local", apiKey: "" },
      { providerId: "supadata", apiKey: "paid-key" },
    ],
    {
      localTracks: [{
        baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en",
        languageCode: "en",
        name: "English",
      }],
      localCaptionSource: {
        body: JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Local" }] }],
        }),
      },
      fetchImpl: async (url) => {
        calls.push(url);
        throw new Error(`本地模式不应请求第三方服务：${url}`);
      },
    },
  );
  assert.equal(result.providerId, "local");
  assert.equal(result.transcript[0].text, "Local");
  assert.equal(calls.length, 0);
});

test("字幕请求强制 native 模式并只发送规范 URL", async () => {
  let requested;
  const fetchImpl = async (url, options) => {
    requested = { url: new URL(url), options };
    return {
      status: 200,
      ok: true,
      async json() {
        return {
          lang: "en",
          content: [{ text: "Hello", offset: 0, duration: 1000 }],
        };
      },
    };
  };
  const result = await youtube.fetchTranscript("dQw4w9WgXcQ", "secret", {
    fetchImpl,
  });
  assert.equal(requested.url.searchParams.get("mode"), "native");
  assert.equal(
    requested.url.searchParams.get("url"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert.equal(requested.options.headers["x-api-key"], "secret");
  assert.equal(result.transcript.length, 1);
});

test("Captapi 使用 Bearer 鉴权并归一化时间戳分段", async () => {
  let requested;
  const result = await youtube.fetchCaptapiTranscript("dQw4w9WgXcQ", "capt-key", {
    fetchImpl: async (url, options) => {
      requested = { url: new URL(url), options };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            data: {
              returnedLanguage: "en",
              segments: [{ text: "Hello", startMs: 1500, endMs: 3500 }],
            },
          };
        },
      };
    },
  });
  assert.equal(requested.url.origin, "https://api.captapi.com");
  assert.equal(requested.options.headers.Authorization, "Bearer capt-key");
  assert.deepEqual(result.transcript, [
    { text: "Hello", start: 1.5, duration: 2, language: "en" },
  ]);
});

test("TranscriptFetch 固定 captions 模式，避免触发音频转写", async () => {
  let requested;
  await youtube.fetchTranscriptFetchTranscript("dQw4w9WgXcQ", "tf-key", {
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, data: { language: "en", segments: [{ text: "Hello", start: 0, duration: 1 }] } };
        },
      };
    },
  });
  assert.equal(requested.url, youtube.TRANSCRIPTFETCH_TRANSCRIPT_URL);
  assert.equal(requested.options.headers.Authorization, "Bearer tf-key");
  assert.deepEqual(JSON.parse(requested.options.body), {
    video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    mode: "captions",
    timestamps: true,
  });
});

test("TranscriptAPI 使用文档规定的 GET 端点与 Bearer 鉴权", async () => {
  let requested;
  const result = await youtube.fetchTranscriptApiTranscript("dQw4w9WgXcQ", "ta-key", {
    fetchImpl: async (url, options) => {
      requested = { url: new URL(url), options };
      return {
        ok: true,
        status: 200,
        async json() {
          return { language: "en", transcript: [{ text: "Hello", start: 3, duration: 4 }] };
        },
      };
    },
  });
  assert.equal(requested.url.origin, "https://transcriptapi.com");
  assert.equal(requested.url.searchParams.get("include_timestamp"), "true");
  assert.equal(requested.options.headers.Authorization, "Bearer ta-key");
  assert.equal(result.transcript[0].start, 3);
});

test("选择一个 API 服务商后不会自动调用列表中的其他服务商", async () => {
  const calls = [];
  await assert.rejects(
    youtube.fetchTranscriptWithFallback(
      "dQw4w9WgXcQ",
      [
        { providerId: "supadata", apiKey: "first" },
        { providerId: "captapi", apiKey: "second" },
      ],
      {
        fetchImpl: async (url) => {
          calls.push(url);
          return { ok: false, status: 429, async json() { return {}; } };
        },
      },
    ),
    /限流/,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(youtube.TRANSCRIPT_URL));
});
