/** 视觉手记筛选：只处理已在内容脚本完成低成本像素分析的截图。 */
var BILI_VISUAL_MEMOS = (() => {
  const IMAGE_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i;
  const CITATION_RE = /\{\{va-cite:([A-Za-z0-9_-]{1,64})\}\}/g;

  function analyzeImagePixels(rgba, width, height) {
    const size = Math.max(0, Number(width) * Number(height));
    if (!rgba || size < 16 || rgba.length < size * 4) return null;
    const gray = new Uint8Array(size);
    const bins = new Uint32Array(16);
    let sum = 0, sumSq = 0, extremes = 0;
    for (let i = 0; i < size; i += 1) {
      const offset = i * 4;
      const value = Math.round(rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114);
      gray[i] = value;
      bins[value >> 4] += 1;
      sum += value;
      sumSq += value * value;
      if (value <= 8 || value >= 247) extremes += 1;
    }
    const mean = sum / size;
    const brightnessStdDev = Math.sqrt(Math.max(0, sumSq / size - mean * mean));
    let entropy = 0;
    for (const count of bins) {
      if (!count) continue;
      const p = count / size;
      entropy -= p * Math.log2(p);
    }
    let edges = 0, comparisons = 0, lapSum = 0, lapSumSq = 0, lapCount = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - width]) >= 32) edges += 1;
        comparisons += 1;
        const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
        lapSum += lap;
        lapSumSq += lap * lap;
        lapCount += 1;
      }
    }
    const edgeDensity = comparisons ? edges / comparisons : 0;
    const lapMean = lapCount ? lapSum / lapCount : 0;
    const laplacianVariance = lapCount ? Math.max(0, lapSumSq / lapCount - lapMean * lapMean) : 0;
    let perceptualHash = "";
    for (let row = 0; row < 8; row += 1) {
      let nibble = 0, bits = 0;
      for (let col = 0; col < 8; col += 1) {
        const y = Math.min(height - 1, Math.round((row * (height - 1)) / 7));
        const x1 = Math.min(width - 1, Math.round((col * (width - 1)) / 8));
        const x2 = Math.min(width - 1, Math.round(((col + 1) * (width - 1)) / 8));
        nibble = (nibble << 1) | (gray[y * width + x1] > gray[y * width + x2] ? 1 : 0);
        if (++bits === 4) {
          perceptualHash += nibble.toString(16);
          nibble = 0;
          bits = 0;
        }
      }
    }
    const extremePixelRatio = extremes / size;
    const score = Math.min(1, (entropy / 4) * 0.35 + Math.min(1, edgeDensity / 0.16) * 0.35 +
      Math.min(1, brightnessStdDev / 55) * 0.15 + Math.min(1, laplacianVariance / 1800) * 0.15);
    const useful = extremePixelRatio < 0.97 && brightnessStdDev >= 8 && entropy >= 0.75 &&
      edgeDensity >= 0.012 && laplacianVariance >= 18 && score >= 0.22;
    return {
      version: 1, useful, score: Number(score.toFixed(4)), entropy: Number(entropy.toFixed(4)),
      edgeDensity: Number(edgeDensity.toFixed(4)), brightnessStdDev: Number(brightnessStdDev.toFixed(2)),
      laplacianVariance: Number(laplacianVariance.toFixed(2)),
      extremePixelRatio: Number(extremePixelRatio.toFixed(4)), perceptualHash,
      sampleWidth: width, sampleHeight: height,
    };
  }

  function hammingDistance(left, right) {
    if (!/^[0-9a-f]{16}$/i.test(left || "") || !/^[0-9a-f]{16}$/i.test(right || "")) return Infinity;
    let distance = 0;
    for (let i = 0; i < 16; i += 1) {
      let value = parseInt(left[i], 16) ^ parseInt(right[i], 16);
      while (value) {
        distance += value & 1;
        value >>>= 1;
      }
    }
    return distance;
  }

  function sanitizeImageMeta(meta) {
    if (!meta || meta.version !== 1 || meta.useful !== true) return null;
    const number = (key, max) => {
      const value = Number(meta[key]);
      return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
    };
    const perceptualHash = /^[0-9a-f]{16}$/i.test(meta.perceptualHash || "")
      ? meta.perceptualHash.toLowerCase()
      : "";
    if (!perceptualHash) return null;
    return {
      version: 1,
      useful: true,
      score: number("score", 1),
      entropy: number("entropy", 4),
      edgeDensity: number("edgeDensity", 1),
      brightnessStdDev: number("brightnessStdDev", 128),
      laplacianVariance: number("laplacianVariance", 1_000_000),
      extremePixelRatio: number("extremePixelRatio", 1),
      perceptualHash,
      sampleWidth: 96,
      sampleHeight: 54,
    };
  }

  function selectReferences(notes, resource, { maxImages = 6, maxDataChars = 2_000_000 } = {}) {
    const candidates = (Array.isArray(notes) ? notes : [])
      .filter((note) => note?.kind === "memo" && note.site === resource?.site &&
        String(note.bvid || note.videoId) === String(resource?.videoId) &&
        Number(note.page || 1) === Number(resource?.page || 1) && IMAGE_RE.test(note.imageDataUrl || ""))
      .map((note) => ({
        noteId: note.id,
        dataUrl: note.imageDataUrl,
        timestampSeconds: Math.max(0, Number(note.timestampSeconds) || 0),
        meta: sanitizeImageMeta(note.imageMeta),
      }))
      .filter((item) => item.meta)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds || b.meta.score - a.meta.score);

    const unique = [];
    for (const candidate of candidates) {
      const duplicate = unique.find((item) =>
        Math.abs(item.timestampSeconds - candidate.timestampSeconds) <= 120 &&
        hammingDistance(item.meta.perceptualHash, candidate.meta.perceptualHash) <= 6);
      if (!duplicate) unique.push(candidate);
      else if (candidate.meta.score > duplicate.meta.score) Object.assign(duplicate, candidate);
    }
    const ranked = unique.sort((a, b) => b.meta.score - a.meta.score || a.timestampSeconds - b.timestampSeconds);
    const selected = [];
    let chars = 0;
    for (const item of ranked) {
      if (selected.length >= maxImages || chars + item.dataUrl.length > maxDataChars) continue;
      selected.push(item);
      chars += item.dataUrl.length;
    }
    return selected.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }

  function parseCitationIds(markdown) {
    const ids = [];
    const seen = new Set();
    for (const match of String(markdown || "").matchAll(CITATION_RE)) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        ids.push(match[1]);
      }
    }
    return ids;
  }

  function sanitizeCitationMarkers(markdown, allowedIds) {
    const allowed = new Set(Array.isArray(allowedIds) ? allowedIds : []);
    const emitted = new Set();
    return String(markdown || "").replace(CITATION_RE, (_marker, citationId) => {
      if (!allowed.has(citationId) || emitted.has(citationId)) return "";
      emitted.add(citationId);
      return `{{va-cite:${citationId}}}`;
    });
  }

  /**
   * 将 AI 笔记保存的轻量引用（citationId + sourceNoteId）解析为侧栏可显示的数据。
   * 旧笔记没有轻量引用时，按引用编号顺序与当前视频的合格手记截图做兼容匹配。
   */
  function resolveCitations(notes, resource, storedReferences, markdown) {
    const ids = parseCitationIds(markdown);
    if (!ids.length) return [];
    const list = Array.isArray(notes) ? notes : [];
    const stored = Array.isArray(storedReferences) ? storedReferences : [];
    const fallback = selectReferences(list, resource);
    return ids.map((citationId, index) => {
      const saved = stored.find((item) => item?.citationId === citationId);
      const source = saved?.sourceNoteId
        ? list.find((note) => note?.id === saved.sourceNoteId)
        : null;
      const candidate = source && IMAGE_RE.test(source.imageDataUrl || "")
        ? {
            noteId: source.id,
            dataUrl: source.imageDataUrl,
            timestampSeconds: Math.max(0, Number(source.timestampSeconds) || 0),
          }
        : fallback[index];
      if (!candidate?.dataUrl) return null;
      return {
        citationId,
        sourceNoteId: candidate.noteId || saved?.sourceNoteId || null,
        imageDataUrl: candidate.dataUrl,
        timestampSeconds: Math.max(
          0,
          Number(saved?.timestampSeconds ?? candidate.timestampSeconds) || 0,
        ),
      };
    }).filter(Boolean);
  }

  return {
    CITATION_RE,
    analyzeImagePixels,
    hammingDistance,
    sanitizeImageMeta,
    selectReferences,
    parseCitationIds,
    sanitizeCitationMarkers,
    resolveCitations,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BILI_VISUAL_MEMOS;
