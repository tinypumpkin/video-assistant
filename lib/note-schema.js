/** Video Assistant V2 笔记 Schema：只负责纯数据转换与关系定义。 */
var BILI_NOTE_SCHEMA = (() => {
  const SCHEMA_VERSION = 2;
  const CITATION_RE = /\{\{va-cite:([A-Za-z0-9_-]{1,64})\}\}/g;
  const NOTE_KINDS = new Set(["memo", "quote", "ai_note", "ai_chat", "ai_video_note"]);

  function string(value, max = 0) {
    const text = typeof value === "string" ? value : "";
    return max > 0 ? text.slice(0, max) : text;
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function noteKind(value) {
    return NOTE_KINDS.has(value) ? value : "quote";
  }

  function videoKey(site, videoId, page = 1) {
    const normalizedSite = site === "youtube" ? "youtube" : "bilibili";
    const id = string(videoId, 200);
    return id ? `${normalizedSite}:${id}:${Math.max(1, Math.floor(number(page, 1)))}` : "";
  }

  function statusFromNote(note) {
    if (note?.pendingTranscript) return "pending_transcript";
    if (note?.pending) return "pending_polish";
    if (note?.failed) return "failed";
    return "ready";
  }

  function statusToNote(status) {
    return {
      ...(status === "pending_transcript" ? { pendingTranscript: true } : {}),
      ...(status === "pending_polish" ? { pending: true } : {}),
      ...(status === "failed" ? { failed: true } : {}),
    };
  }

  function noteToRecord(note) {
    const source = note && typeof note === "object" ? note : {};
    const id = string(source.id, 300);
    if (!id) throw new Error("笔记缺少 id");
    const kind = noteKind(source.kind);
    const site = source.site === "youtube" ? "youtube" : "bilibili";
    const idValue = string(source.bvid || source.videoId, 200);
    const page = Math.max(1, Math.floor(number(source.page, 1)));
    const createdAt = Math.max(0, number(source.createdAt, Date.now()));
    const record = {
      id,
      schemaVersion: SCHEMA_VERSION,
      kind,
      content: {
        format: "markdown",
        markdown: string(source.text),
        rawText: source.rawText == null ? null : string(source.rawText, 12_000),
      },
      video: idValue
        ? {
            videoKey: videoKey(site, idValue, page),
            site,
            videoId: idValue,
            page,
            title: string(source.videoTitle, 500),
            owner: string(source.ownerName, 300),
            canonicalUrl: string(source.canonicalUrl || source.timestampedUrl, 2_000),
          }
        : null,
      anchor: idValue
        ? {
            seconds: Math.max(0, Math.floor(number(source.timestampSeconds, 0))),
            label: string(source.timestamp, 30),
            url: string(source.timestampedUrl, 2_000),
          }
        : null,
      status: statusFromNote(source),
      generation: kind.startsWith("ai_")
        ? {
            noteStyle: string(source.noteStyle, 100) || null,
            customPrompt: string(source.notePrompt, 10_000) || null,
            outputLanguage: string(source.outputLanguage, 30) || null,
            providerId: string(source.providerId, 200) || null,
            model: string(source.model, 300) || null,
            usedVision: Boolean(source.usedVision || source.visualMemoReferenceCount),
            referencedImageCount: Math.max(0, Math.floor(number(source.visualMemoReferenceCount, 0))),
          }
        : null,
      createdAt,
      updatedAt: Math.max(createdAt, number(source.updatedAt, createdAt)),
    };
    return record;
  }

  function recordToNote(record) {
    const source = record && typeof record === "object" ? record : {};
    const note = {
      id: string(source.id, 300),
      kind: noteKind(source.kind),
      text: string(source.content?.markdown),
      createdAt: Math.max(0, number(source.createdAt, Date.now())),
      updatedAt: Math.max(0, number(source.updatedAt, source.createdAt)),
      ...statusToNote(source.status),
    };
    if (source.content?.rawText != null) note.rawText = string(source.content.rawText, 12_000);
    if (source.video?.videoId) {
      Object.assign(note, {
        site: source.video.site === "youtube" ? "youtube" : "bilibili",
        bvid: string(source.video.videoId, 200),
        videoId: string(source.video.videoId, 200),
        page: Math.max(1, Math.floor(number(source.video.page, 1))),
        videoTitle: string(source.video.title, 500),
        ownerName: string(source.video.owner, 300),
      });
    }
    if (source.anchor) {
      Object.assign(note, {
        timestampSeconds: Math.max(0, Math.floor(number(source.anchor.seconds, 0))),
        timestamp: string(source.anchor.label, 30),
        timestampedUrl: string(source.anchor.url, 2_000),
      });
    }
    if (source.generation) {
      if (source.generation.noteStyle) note.noteStyle = source.generation.noteStyle;
      if (source.generation.customPrompt) note.notePrompt = source.generation.customPrompt;
      if (source.generation.outputLanguage) note.outputLanguage = source.generation.outputLanguage;
      if (source.generation.providerId) note.providerId = source.generation.providerId;
      if (source.generation.model) note.model = source.generation.model;
      note.usedVision = Boolean(source.generation.usedVision);
      note.visualMemoReferenceCount = Math.max(
        0,
        Math.floor(number(source.generation.referencedImageCount, 0)),
      );
    }
    return note;
  }

  function citationIds(markdown) {
    const ids = [];
    const seen = new Set();
    for (const match of string(markdown).matchAll(CITATION_RE)) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        ids.push(match[1]);
      }
    }
    return ids;
  }

  function linkId(noteId, role, citationId, order = 0) {
    return `${noteId}:${role}:${citationId || Math.max(0, Math.floor(number(order, 0)))}`;
  }

  function captureLink(noteId, assetId, anchor, createdAt = Date.now()) {
    return {
      id: linkId(noteId, "capture", null, 0),
      noteId,
      assetId,
      role: "capture",
      citationId: null,
      marker: null,
      sourceNoteId: null,
      anchor: anchor || null,
      order: 0,
      createdAt,
    };
  }

  function citationLink(noteId, assetId, reference, anchor, order = 0, createdAt = Date.now()) {
    const citationId = string(reference?.citationId, 64);
    if (!citationId) throw new Error("图片引用缺少 citationId");
    return {
      id: linkId(noteId, "citation", citationId, order),
      noteId,
      assetId,
      role: "citation",
      citationId,
      marker: `{{va-cite:${citationId}}}`,
      sourceNoteId: string(reference?.sourceNoteId, 300) || null,
      anchor: anchor || null,
      order: Math.max(0, Math.floor(number(order, 0))),
      createdAt,
    };
  }

  return {
    SCHEMA_VERSION,
    CITATION_RE,
    videoKey,
    noteToRecord,
    recordToNote,
    citationIds,
    linkId,
    captureLink,
    citationLink,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_NOTE_SCHEMA;
