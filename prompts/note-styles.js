/** AI 视频笔记模板。提示词内容集中放在 prompts 目录，供侧边栏选择与生成请求复用。 */
var BILI_NOTE_TEMPLATES = (() => {
  const DEFAULT_NOTE_STYLE = "minimal";
  const CUSTOM_NOTE_STYLE = "custom";

  const NOTE_STYLE_METADATA = Object.freeze([
    Object.freeze({ key: "minimal", label: "精简", labelEn: "Minimal" }),
    Object.freeze({ key: "detailed", label: "详细", labelEn: "Detailed" }),
    Object.freeze({ key: "tutorial", label: "教程", labelEn: "Tutorial" }),
    Object.freeze({ key: "academic", label: "学术风格", labelEn: "Academic" }),
    Object.freeze({ key: "paper", label: "论文解析", labelEn: "Paper analysis" }),
    Object.freeze({ key: "xiaohongshu", label: "小红书", labelEn: "Xiaohongshu" }),
    Object.freeze({ key: "meeting_minutes", label: "会议纪要", labelEn: "Meeting minutes" }),
    Object.freeze({ key: "first_principles", label: "第一性原理", labelEn: "First principles" }),
  ]);

  const NOTE_STYLES = Object.freeze({
    minimal: "精简信息：仅记录最重要的内容，简洁明了。",
    detailed: "详细记录：包含完整内容和每个部分的详细讨论。尽可能多地记录视频内容，形成详尽笔记。",
    tutorial: "教程笔记：尽可能详细地记录教程，特别关注关键点、重要结论和可执行步骤。",
    academic: "学术风格：使用正式、严谨且结构化的学术报告风格整理内容。",
    paper:
      "按学术规范深度解析论文：1. 一句话主结论；2. 研究动机与问题（RQ/Hypothesis）；3. 方法与数据（设计、样本、变量、统计检验）；4. 结果与意义（效应量、显著性、稳健性）；5. 与相关工作对比（创新点、差异）；6. 局限与外推边界；7. 复现要点（数据获取、代码与参数）；8. 关键引文（APA 或 GB/T）；9. 面向非专业读者的术语表。",
    xiaohongshu:
      "使用小红书风格创作：标题采用正面刺激法或负面刺激法，强调具体收益、损失或紧迫感；正文可使用惊叹号、省略号和适量 emoji 增强活力，通过悬念、挑战性表达、热点话题、实用工具与具体成果提升吸引力。可自然使用“好用到哭、小白必看、宝藏、划重点、建议收藏、手把手、揭秘、打工人、吐血整理、隐藏、高级感、万万没想到”等爆款关键词，但不得歪曲或编造视频信息。",
    meeting_minutes: "会议纪要：按商业会议纪要格式输出，正式且精准，突出议题、结论、决策、责任人和后续行动。",
    first_principles:
      "禁止依赖经验类比，从基本真理与约束出发推导：1. 问题重述与边界；2. 基本公理或不可再简化事实（列明来源或可检验性）；3. 约束与目标函数（量化变量与权衡项）；4. 自下而上重构方案（前提→中间结论→可执行策略）；5. 反例或极端情形检验；6. 最小可行试验（MVP、度量、停止或调整标准）。用公式或表格量化关键变量，最后给出 3 条策略及各自触发条件。",
  });

  // 英文界面的同款模板：内容与中文版一一对应，只是行文语言不同。
  // 模板本身也是强语言指令，中英不配对会把输出语言拽回中文。
  const NOTE_STYLES_EN = Object.freeze({
    minimal: "Minimal: record only the most important takeaways, clean and concise.",
    detailed:
      "Detailed: cover the full content and every section's discussion. Capture as much of the video as possible into thorough notes.",
    tutorial:
      "Tutorial notes: document the tutorial in as much detail as possible, focusing on key points, important conclusions, and actionable steps.",
    academic:
      "Academic style: organize the content as a formal, rigorous, and well-structured academic report.",
    paper:
      "Deep paper analysis in academic form: 1. One-sentence main conclusion; 2. Motivation and research questions (RQ/Hypotheses); 3. Methods and data (design, sample, variables, statistical tests); 4. Results and significance (effect sizes, significance, robustness); 5. Comparison with related work (novelty, differences); 6. Limitations and external validity; 7. Reproduction notes (data access, code and parameters); 8. Key citations (APA); 9. A glossary for non-specialist readers.",
    xiaohongshu:
      "Write in Xiaohongshu (RED) style: titles use positive or negative stimulation, emphasizing concrete gains, losses, or urgency; the body may use exclamation marks, ellipses, and a moderate amount of emoji for energy, and should build appeal through suspense, challenge, trending topics, practical tools, and concrete results. Do not distort or fabricate video information.",
    meeting_minutes:
      "Meeting minutes: output in a formal business-minutes format, precise, highlighting topics, conclusions, decisions, owners, and action items.",
    first_principles:
      "No reasoning by analogy: derive from fundamental truths and constraints: 1. Problem restatement and boundaries; 2. Basic axioms or irreducible facts (state sources or falsifiability); 3. Constraints and objective function (quantified variables and trade-offs); 4. Bottom-up reconstruction (premises → intermediate conclusions → actionable strategies); 5. Counterexamples or extreme-case checks; 6. Minimal viable experiment (MVP, metrics, stop/adjust criteria). Quantify key variables with formulas or tables, and end with 3 strategies plus their trigger conditions.",
  });

  const AI_SUM = "在笔记末尾添加一个专业的中文“AI 摘要”，用简短段落概括整个视频。";
  const AI_SUM_EN =
    "At the end of the notes, add a professional \"AI Summary\" in English: one short paragraph summarizing the whole video.";

  function isKnownStyle(value) {
    return value === CUSTOM_NOTE_STYLE || NOTE_STYLE_METADATA.some((item) => item.key === value);
  }

  function normalizeStyle(value) {
    return isKnownStyle(value) ? value : DEFAULT_NOTE_STYLE;
  }

  function promptFor(value, language = "zh-CN") {
    const style = normalizeStyle(value);
    if (style === CUSTOM_NOTE_STYLE) return "";
    const table = language === "en" ? NOTE_STYLES_EN : NOTE_STYLES;
    const sum = language === "en" ? AI_SUM_EN : AI_SUM;
    return `${table[style]}\n\n${sum}`;
  }

  return {
    DEFAULT_NOTE_STYLE,
    CUSTOM_NOTE_STYLE,
    NOTE_STYLE_METADATA,
    NOTE_STYLES,
    NOTE_STYLES_EN,
    AI_SUM,
    AI_SUM_EN,
    isKnownStyle,
    normalizeStyle,
    promptFor,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = BILI_NOTE_TEMPLATES;
}
