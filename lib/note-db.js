/** IndexedDB V2 笔记仓库：notes / assets / note_assets / meta。 */
var BILI_NOTE_DB = (() => {
  const DB_NAME = "video_assistant_notes";
  const DB_VERSION = 2;
  const STORES = Object.freeze({ notes: "notes", assets: "assets", links: "note_assets", meta: "meta" });
  const DEFAULT_ASSET_BUDGET_BYTES = 200 * 1024 * 1024;
  const IMAGE_RE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i;
  let dbPromise = null;

  function supported() {
    return typeof indexedDB !== "undefined" && Boolean(BILI_NOTE_SCHEMA);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 事务已中止"));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 事务失败"));
    });
  }

  function ensureIndex(store, name, keyPath, options) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
  }

  function open() {
    if (!supported()) return Promise.reject(new Error("当前环境不支持 IndexedDB"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const notes = db.objectStoreNames.contains(STORES.notes)
          ? request.transaction.objectStore(STORES.notes)
          : db.createObjectStore(STORES.notes, { keyPath: "id" });
        ensureIndex(notes, "by_created", "createdAt");
        ensureIndex(notes, "by_kind_created", ["kind", "createdAt"]);
        ensureIndex(notes, "by_video_created", ["video.videoKey", "createdAt"]);
        ensureIndex(notes, "by_video_kind_created", ["video.videoKey", "kind", "createdAt"]);

        const assets = db.objectStoreNames.contains(STORES.assets)
          ? request.transaction.objectStore(STORES.assets)
          : db.createObjectStore(STORES.assets, { keyPath: "id" });
        ensureIndex(assets, "by_created", "createdAt");
        ensureIndex(assets, "by_exact_hash", "exactHash", { unique: true });

        const links = db.objectStoreNames.contains(STORES.links)
          ? request.transaction.objectStore(STORES.links)
          : db.createObjectStore(STORES.links, { keyPath: "id" });
        ensureIndex(links, "by_note", "noteId");
        ensureIndex(links, "by_asset", "assetId");
        ensureIndex(links, "by_source_note", "sourceNoteId");
        ensureIndex(links, "by_note_role", ["noteId", "role"]);

        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("无法打开笔记数据库"));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error("笔记数据库升级被旧页面阻塞，请重新打开侧边栏"));
      };
    });
    return dbPromise;
  }

  function bytesToBase64(bytes) {
    let result = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      result += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(result);
  }

  function base64ToBytes(source) {
    const binary = atob(source);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function blobToDataUrl(blob) {
    if (!(blob instanceof Blob)) return "";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return `data:${blob.type || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(IMAGE_RE);
    if (!match) return null;
    return new Blob([base64ToBytes(match[2])], { type: match[1].toLowerCase() });
  }

  async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function assetFromNote(note) {
    const blob = dataUrlToBlob(note?.imageDataUrl);
    if (!blob) return null;
    const exactHash = await sha256Hex(blob);
    const analysis = note?.imageMeta && typeof note.imageMeta === "object" ? note.imageMeta : null;
    return {
      id: `asset_sha256_${exactHash}`,
      assetSchemaVersion: 1,
      blob,
      mimeType: blob.type,
      byteLength: blob.size,
      width: Math.max(0, Number(note?.imageWidth) || 0),
      height: Math.max(0, Number(note?.imageHeight) || 0),
      exactHash,
      perceptualHash: String(analysis?.perceptualHash || ""),
      analysis,
      createdAt: Math.max(0, Number(note?.createdAt) || Date.now()),
    };
  }

  async function getAll(storeName) {
    const db = await open();
    const transaction = db.transaction(storeName, "readonly");
    const result = await requestResult(transaction.objectStore(storeName).getAll());
    await transactionDone(transaction);
    return result;
  }

  async function linksForNote(noteId, role = null) {
    const db = await open();
    const transaction = db.transaction(STORES.links, "readonly");
    const store = transaction.objectStore(STORES.links);
    const request = role
      ? store.index("by_note_role").getAll(IDBKeyRange.only([noteId, role]))
      : store.index("by_note").getAll(IDBKeyRange.only(noteId));
    const result = await requestResult(request);
    await transactionDone(transaction);
    return result;
  }

  async function prepareNote(note) {
    const record = BILI_NOTE_SCHEMA.noteToRecord(note);
    const captureAsset = await assetFromNote(note);
    const links = [];
    if (captureAsset) {
      links.push(BILI_NOTE_SCHEMA.captureLink(record.id, captureAsset.id, record.anchor, record.createdAt));
    }

    if (record.kind === "ai_video_note") {
      const allowed = new Set(BILI_NOTE_SCHEMA.citationIds(record.content.markdown));
      const references = Array.isArray(note.visualMemoReferences) ? note.visualMemoReferences : [];
      const hydrated = Array.isArray(note.visualReferences) ? note.visualReferences : [];
      for (let order = 0; order < references.length; order += 1) {
        const reference = references[order];
        if (!allowed.has(reference?.citationId)) continue;
        const existing = hydrated.find((item) => item?.citationId === reference.citationId);
        let assetId = String(existing?.assetId || "");
        let sourceCapture = null;
        if (!assetId && reference?.sourceNoteId) {
          const sourceLinks = await linksForNote(reference.sourceNoteId, "capture");
          sourceCapture = sourceLinks[0] || null;
          assetId = String(sourceCapture?.assetId || "");
        }
        if (!assetId) continue;
        const seconds = Math.max(0, Number(reference.timestampSeconds ?? existing?.timestampSeconds) || 0);
        links.push(BILI_NOTE_SCHEMA.citationLink(
          record.id,
          assetId,
          reference,
          {
            seconds,
            label: String(existing?.timestamp || sourceCapture?.anchor?.label || ""),
            url: String(existing?.timestampedUrl || sourceCapture?.anchor?.url || ""),
          },
          order,
          record.createdAt,
        ));
      }
      if (record.generation) record.generation.referencedImageCount = links.filter((link) => link.role === "citation").length;
    }
    return { original: note, record, captureAsset, links };
  }

  async function deleteLinksForNote(store, noteId) {
    const keys = await requestResult(store.index("by_note").getAllKeys(IDBKeyRange.only(noteId)));
    for (const key of keys) store.delete(key);
  }

  async function applyChanges(
    changedNotes,
    deletedNoteIds = [],
    { assetBudgetBytes = DEFAULT_ASSET_BUDGET_BYTES } = {},
  ) {
    const prepared = [];
    for (const note of Array.isArray(changedNotes) ? changedNotes : []) {
      prepared.push(await prepareNote(note));
    }
    const db = await open();
    const transaction = db.transaction([STORES.notes, STORES.assets, STORES.links], "readwrite");
    const notes = transaction.objectStore(STORES.notes);
    const assets = transaction.objectStore(STORES.assets);
    const links = transaction.objectStore(STORES.links);
    const existingAssets = await requestResult(assets.getAll());
    const existingIds = new Set(existingAssets.map((asset) => asset.id));
    const pendingAssets = new Map(
      prepared
        .filter((item) => item.captureAsset && !existingIds.has(item.captureAsset.id))
        .map((item) => [item.captureAsset.id, item.captureAsset]),
    );
    const projectedBytes = existingAssets.reduce(
      (sum, asset) => sum + Math.max(0, Number(asset.byteLength) || 0),
      0,
    ) + [...pendingAssets.values()].reduce(
      (sum, asset) => sum + Math.max(0, Number(asset.byteLength) || 0),
      0,
    );
    if (projectedBytes > assetBudgetBytes) {
      transaction.abort();
      throw new Error("手记截图存储已达到 200 MB 安全线，请导出或删除部分手记后再保存。");
    }
    for (const noteId of new Set(deletedNoteIds || [])) {
      notes.delete(noteId);
      await deleteLinksForNote(links, noteId);
    }
    for (const item of prepared) {
      notes.put(item.record);
      if (item.captureAsset) assets.put(item.captureAsset);
      await deleteLinksForNote(links, item.record.id);
      for (const link of item.links) links.put(link);
    }
    await transactionDone(transaction);
    await collectGarbage();
  }

  async function collectGarbage() {
    const db = await open();
    const transaction = db.transaction([STORES.assets, STORES.links], "readwrite");
    const assets = transaction.objectStore(STORES.assets);
    const links = transaction.objectStore(STORES.links);
    const [assetRecords, linkRecords] = await Promise.all([
      requestResult(assets.getAll()),
      requestResult(links.getAll()),
    ]);
    const used = new Set(linkRecords.map((link) => link.assetId));
    for (const asset of assetRecords) {
      if (!used.has(asset.id)) assets.delete(asset.id);
    }
    await transactionDone(transaction);
  }

  async function listNotes({ includeAssetData = true } = {}) {
    const [records, links, assets] = await Promise.all([
      getAll(STORES.notes),
      getAll(STORES.links),
      getAll(STORES.assets),
    ]);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const linksByNote = new Map();
    for (const link of links) {
      if (!linksByNote.has(link.noteId)) linksByNote.set(link.noteId, []);
      linksByNote.get(link.noteId).push(link);
    }
    const dataUrlCache = new Map();
    const assetDataUrl = async (assetId) => {
      if (!includeAssetData) return "";
      if (!dataUrlCache.has(assetId)) {
        dataUrlCache.set(assetId, blobToDataUrl(assetMap.get(assetId)?.blob));
      }
      return dataUrlCache.get(assetId);
    };
    const result = [];
    for (const record of records.sort((left, right) => right.createdAt - left.createdAt)) {
      const note = BILI_NOTE_SCHEMA.recordToNote(record);
      const noteLinks = (linksByNote.get(record.id) || []).sort((a, b) => a.order - b.order);
      const capture = noteLinks.find((link) => link.role === "capture");
      if (capture) {
        const asset = assetMap.get(capture.assetId);
        note.imageAssetId = capture.assetId;
        if (asset?.analysis) note.imageMeta = asset.analysis;
        const dataUrl = await assetDataUrl(capture.assetId);
        if (dataUrl) note.imageDataUrl = dataUrl;
      }
      const citations = noteLinks.filter((link) => link.role === "citation");
      if (citations.length) {
        note.visualMemoReferenceCount = citations.length;
        note.visualMemoReferences = citations.map((link) => ({
          citationId: link.citationId,
          sourceNoteId: link.sourceNoteId,
          timestampSeconds: Math.max(0, Number(link.anchor?.seconds) || 0),
        }));
        note.visualReferences = [];
        for (const link of citations) {
          const dataUrl = await assetDataUrl(link.assetId);
          note.visualReferences.push({
            citationId: link.citationId,
            sourceNoteId: link.sourceNoteId,
            assetId: link.assetId,
            imageDataUrl: dataUrl,
            timestampSeconds: Math.max(0, Number(link.anchor?.seconds) || 0),
            timestamp: String(link.anchor?.label || ""),
            timestampedUrl: String(link.anchor?.url || ""),
          });
        }
      }
      result.push(note);
    }
    return result;
  }

  async function stats() {
    const [notes, assets, links] = await Promise.all([
      getAll(STORES.notes),
      getAll(STORES.assets),
      getAll(STORES.links),
    ]);
    return {
      noteCount: notes.length,
      assetCount: assets.length,
      linkCount: links.length,
      assetBytes: assets.reduce((sum, asset) => sum + Math.max(0, Number(asset.byteLength) || 0), 0),
    };
  }

  async function exportBundle(noteIds = null) {
    const [allNotes, allAssets, allLinks] = await Promise.all([
      getAll(STORES.notes),
      getAll(STORES.assets),
      getAll(STORES.links),
    ]);
    const selectedIds = Array.isArray(noteIds) && noteIds.length
      ? new Set(noteIds.map((id) => String(id || "")).filter(Boolean))
      : null;
    const notes = selectedIds ? allNotes.filter((note) => selectedIds.has(note.id)) : allNotes;
    const selectedNoteIds = new Set(notes.map((note) => note.id));
    const noteAssets = allLinks.filter((link) => selectedNoteIds.has(link.noteId));
    const assetIds = new Set(noteAssets.map((link) => link.assetId));
    const assets = [];
    for (const asset of allAssets) {
      if (!assetIds.has(asset.id)) continue;
      assets.push({
        ...asset,
        blob: undefined,
        dataUrl: await blobToDataUrl(asset.blob),
      });
    }
    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      notes,
      noteAssets,
      assets,
    };
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORES,
    DEFAULT_ASSET_BUDGET_BYTES,
    supported,
    open,
    dataUrlToBlob,
    blobToDataUrl,
    listNotes,
    applyChanges,
    collectGarbage,
    exportBundle,
    stats,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_NOTE_DB;
