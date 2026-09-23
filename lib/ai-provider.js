/**
 * AI 协议适配层：把「OpenAI 兼容」和「Anthropic」的差异全部收在这里。
 * 全是纯函数（配置 → {url, headers, body}），网络调用留在 background.js。
 */
var BILI_AI_PROVIDER = (() => {
  const settingsModule =
    typeof BILI_SETTINGS !== "undefined"
      ? BILI_SETTINGS
      : typeof require === "function"
        ? require("../settings.js")
        : null;

  const { PROTOCOLS } = settingsModule;

  // Anthropic 的版本号是必填头部，写死一个已知可用的日期版本。
  const ANTHROPIC_VERSION = "2023-06-01";

  /**
   * 关掉推理：本扩展的任务都是按规则改写，推理只拉长延迟；
   * 且 Anthropic 的 max_tokens 把思考算进去，放开思考可能在写出正文前烧光预算。
   */
  const THINKING_DISABLED = Object.freeze({ type: "disabled" });

  // thinking 不是 OpenAI 标准参数，发给不认识它的服务可能被拒，
  // 只在地址指向 DeepSeek（沿用了 Anthropic 的形状）时才加。
  function vendorExtras(baseUrl) {
    try {
      if (new URL(String(baseUrl)).hostname.endsWith("deepseek.com")) {
        return { thinking: THINKING_DISABLED };
      }
    } catch (error) {
      // 地址非法时交给调用方校验，这里不额外加字段。
    }
    return {};
  }

  // Anthropic 把 system 放在顶层，不接受 role 为 system 的消息。
  function splitSystemMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const system = list
      .filter((message) => message?.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const rest = list
      .filter((message) => message?.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));
    return { system, messages: rest };
  }

  function imageDataParts(dataUrl) {
    const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i);
    return match ? { mediaType: match[1].toLowerCase(), data: match[2] } : null;
  }

  /**
   * 按 Provider 协议把图片附加到最后一条 user 消息。调用方只有在该
   * Provider 已实测支持视觉输入时才调用；无效图片会被静默丢弃。
   */
  function attachImagesToLastUserMessage(protocol, messages, imageDataUrls) {
    const list = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
    const images = (Array.isArray(imageDataUrls) ? imageDataUrls : [])
      .map(imageDataParts)
      .filter(Boolean);
    if (!images.length) return list;

    const index = list.findLastIndex((message) => message?.role === "user");
    if (index < 0) return list;
    const text = typeof list[index].content === "string" ? list[index].content : "";
    list[index].content = protocol === PROTOCOLS.ANTHROPIC
      ? [
          { type: "text", text },
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.data },
          })),
        ]
      : [
          { type: "text", text },
          ...images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mediaType};base64,${image.data}` },
          })),
        ];
    return list;
  }

  /** 在最后一条用户消息中按“时间点标签 → 图片”交错排列视觉手记。 */
  function attachVisualReferencesToLastUserMessage(protocol, messages, references) {
    const list = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
    const valid = (Array.isArray(references) ? references : [])
      .map((reference) => ({
        label: String(reference?.label || "").slice(0, 120),
        memoText: String(reference?.memoText || "").trim().slice(0, 2_000),
        transcriptWindow: String(reference?.transcriptWindow || "").trim().slice(0, 3_000),
        image: imageDataParts(reference?.dataUrl),
      }))
      .filter((reference) => reference.label && reference.image);
    if (!valid.length) return list;
    const index = list.findLastIndex((message) => message?.role === "user");
    if (index < 0) return list;
    const blocks = [{ type: "text", text: typeof list[index].content === "string" ? list[index].content : "" }];
    for (const reference of valid) {
      const context = [
        reference.label,
        reference.memoText
          ? `手记文字 / Memo text:\n${reference.memoText}`
          : "",
        reference.transcriptWindow
          ? `对应时间点附近字幕 / Nearby transcript:\n${reference.transcriptWindow}`
          : "",
        "以下图片只与本组手记、字幕和时间点关联。 / The following image belongs only to this memo, transcript window, and timestamp.",
      ].filter(Boolean).join("\n\n");
      blocks.push({ type: "text", text: `\n\n${context}` });
      blocks.push(protocol === PROTOCOLS.ANTHROPIC
        ? { type: "image", source: { type: "base64", media_type: reference.image.mediaType, data: reference.image.data } }
        : { type: "image_url", image_url: { url: `data:${reference.image.mediaType};base64,${reference.image.data}` } });
    }
    list[index].content = blocks;
    return list;
  }

  function buildChatRequest({
    settings,
    messages,
    maxTokens,
    temperature,
    responseFormat,
    stream = false,
  }) {
    const url = settingsModule.chatCompletionsUrl(settings);
    if (!url) throw new Error("API 地址不合法，请到设置页检查。");
    // 在请求出口统一限制，覆盖普通生成、流式问答及服务测试。
    const outputLimit = settingsModule.normalize(settings).aiMaxOutputTokens;
    maxTokens = Math.min(outputLimit, Math.max(1, Math.floor(Number(maxTokens) || 4096)));

    if (settings.protocol === PROTOCOLS.ANTHROPIC) {
      const split = splitSystemMessages(messages);
      const body = {
        model: settings.aiModel,
        // Anthropic 的 max_tokens 是必填项。
        max_tokens: maxTokens,
        messages: split.messages,
        thinking: THINKING_DISABLED,
      };
      if (stream) body.stream = true;
      if (split.system) {
        // 几十个批次共用同一份系统提示词；Anthropic 的前缀缓存要显式打标记，
        // 否则每批都付全价 prefill。内容太短达不到门槛时服务端直接忽略，无副作用。
        body.system = [
          {
            type: "text",
            text: split.system,
            cache_control: { type: "ephemeral" },
          },
        ];
      }
      if (typeof temperature === "number") body.temperature = temperature;

      return {
        url,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.aiApiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          // 没有这个头，浏览器里的请求会被 CORS 挡掉；它就是为 BYOK 场景设计的。
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body,
      };
    }

    const body = {
      model: settings.aiModel,
      max_tokens: maxTokens,
      messages: Array.isArray(messages) ? messages : [],
      ...vendorExtras(settings.aiBaseUrl),
    };
    if (stream) body.stream = true;
    if (typeof temperature === "number") body.temperature = temperature;
    if (responseFormat) body.response_format = responseFormat;

    return {
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.aiApiKey}`,
      },
      body,
    };
  }

  // 取不到文本时返回空串，由调用方统一报「空响应」。
  function parseChatResponse(protocol, data) {
    if (protocol === PROTOCOLS.ANTHROPIC) {
      const blocks = Array.isArray(data?.content) ? data.content : [];
      return blocks
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
    }
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  }

  /**
   * 从单个 SSE 数据块里提取增量文本；两种协议形状都收在这里。
   * 返回空串表示该块没有正文增量（角色块、usage 块、thinking 块等），
   * 由调用方继续读下一块。
   */
  function extractStreamDelta(protocol, data) {
    if (!data || typeof data !== "object") return "";
    if (protocol === PROTOCOLS.ANTHROPIC) {
      const text =
        data?.type === "content_block_delta" && data?.delta?.type === "text_delta"
          ? data.delta.text
          : "";
      return typeof text === "string" ? text : "";
    }
    const delta = data?.choices?.[0]?.delta;
    if (!delta || typeof delta !== "object") return "";
    const content = delta.content;
    return typeof content === "string" ? content : "";
  }

  function parseErrorMessage(data, status) {
    const payload = data && typeof data === "object" ? data : {};
    const message =
      payload.error?.message ||
      payload.error?.type ||
      payload.message ||
      (typeof payload.error === "string" ? payload.error : "");
    return message || `服务返回 ${status}`;
  }

  /**
   * 模型返回 200 却没有正文时，判断成因：协议选错、token 截断、推理占满配额、
   * JSON 模式有毛病——每种对应的动作不同。两个 retry 标志对应可自愈的成因；
   * message 按「重试过仍不行」的口径写，因为它只在重试用尽后才会被看到。
   */
  function diagnoseEmptyResponse(protocol, data) {
    const payload = data && typeof data === "object" ? data : {};

    if (protocol === PROTOCOLS.ANTHROPIC) {
      // 拿到的是 OpenAI 形状的响应，说明协议选错了。
      if (!Array.isArray(payload.content) && Array.isArray(payload.choices)) {
        return {
          reason: "PROTOCOL_MISMATCH",
          message:
            "响应看起来是 OpenAI 格式，但当前选的是 Anthropic 协议。请到设置页把「API 协议」改成 OpenAI 兼容。",
          retryWithoutJsonMode: false,
        };
      }
      if (payload.stop_reason === "max_tokens") {
        return {
          reason: "TRUNCATED",
          message:
            "生成因输出 token 上限而中断，自动重试后仍未完成，未保存为完整结果。请缩短生成要求或更换支持更长输出的模型后重试。",
          retryWithoutJsonMode: false,
          retryWithMoreTokens: true,
        };
      }
      // 只有 thinking 块、没有 text 块
      if (
        Array.isArray(payload.content) &&
        payload.content.some((block) => block?.type === "thinking")
      ) {
        return {
          reason: "REASONING_ONLY",
          message:
            "模型只输出了思考过程，没有正文。建议在设置页换一个非推理模型。",
          retryWithoutJsonMode: false,
        };
      }
      return {
        reason: "EMPTY_CONTENT",
        message: "模型返回了空内容，请重试。",
        retryWithoutJsonMode: false,
      };
    }

    if (!Array.isArray(payload.choices) || !payload.choices.length) {
      // 拿到的是 Anthropic 形状的响应，说明协议选错了。
      if (Array.isArray(payload.content)) {
        return {
          reason: "PROTOCOL_MISMATCH",
          message:
            "响应看起来是 Anthropic 格式，但当前选的是 OpenAI 兼容协议。请到设置页把「API 协议」改成 Anthropic。",
          retryWithoutJsonMode: false,
        };
      }
      return {
        reason: "NO_CHOICES",
        message:
          "响应里没有 choices 字段，这个地址可能不是 OpenAI 兼容接口。请到设置页核对 API 地址与协议。",
        retryWithoutJsonMode: false,
      };
    }

    const choice = payload.choices[0] || {};
    const message = choice.message || {};
    // 推理模型把内容放在 reasoning_content，content 反而是空的。
    const reasoning = message.reasoning_content || message.reasoning;

    if (choice.finish_reason === "length") {
      return {
        reason: "TRUNCATED",
        message: reasoning && !parseChatResponse(protocol, payload).trim()
          ? "模型的输出额度被思考过程耗尽，自动重试后仍未生成正文。请更换非推理模型或缩短生成要求后重试。"
          : "生成因输出 token 上限而中断，自动重试后仍未完成，未保存为完整结果。请缩短生成要求或更换支持更长输出的模型后重试。",
        retryWithoutJsonMode: false,
        retryWithMoreTokens: true,
      };
    }
    if (reasoning) {
      return {
        reason: "REASONING_ONLY",
        message:
          "模型只输出了思考过程，没有正文。建议在设置页换一个非推理模型。",
        retryWithoutJsonMode: false,
      };
    }

    // 剩下最常见的是 JSON 模式偶发返回空串；提示词本身已要求 JSON，
    // 去掉 response_format 再试一次通常能成。
    return {
      reason: "EMPTY_CONTENT",
      message: "模型返回了空内容，请重试。",
      retryWithoutJsonMode: true,
    };
  }

  function buildModelsRequest(settings) {
    const url = settingsModule.modelsUrl(settings);
    if (!url) throw new Error("API 地址不合法，请到设置页检查。");

    const headers =
      settings.protocol === PROTOCOLS.ANTHROPIC
        ? {
            "x-api-key": settings.aiApiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
          }
        : { Authorization: `Bearer ${settings.aiApiKey}` };

    return { url, headers };
  }

  function parseModelsResponse(data) {
    const list = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : [];
    return list
      .map((item) =>
        typeof item === "string" ? item : item?.id || item?.name || "",
      )
      .filter((id) => typeof id === "string" && id)
      .sort((a, b) => a.localeCompare(b));
  }

  return {
    ANTHROPIC_VERSION,
    vendorExtras,
    splitSystemMessages,
    imageDataParts,
    attachImagesToLastUserMessage,
    attachVisualReferencesToLastUserMessage,
    buildChatRequest,
    parseChatResponse,
    extractStreamDelta,
    parseErrorMessage,
    diagnoseEmptyResponse,
    buildModelsRequest,
    parseModelsResponse,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = BILI_AI_PROVIDER;
}
