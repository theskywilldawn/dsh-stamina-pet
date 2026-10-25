/**
 * 传承插件 · 指标算法（模块 A 的判决核心）
 *
 * **纯函数，零依赖** —— 不 import 任何 @deepseek-ai/*，也不碰文件系统，
 * 所以能脱离宿主直接单测，也能被验收脚本原样复用。
 *
 * 定稿依据：2026-10-20 的指标校准会（记录见 `docs/开发日志.md`）
 * 任何人想"优化"这里的公式，先去读那份表第三节的「已证伪层」。
 *
 * ---
 * 三条从血里换来的约束（违反即误报，会议七人一致同意）：
 *
 *   1. **只在单条思考内统计**，绝不跨回合 / 跨消息累加
 *      —— 长会话写清单会把正常情况顶上去（QQ私聊·1代）
 *   2. **精确相等，不做模糊相似度**
 *      —— `- [ ] 任务一` / `- [ ] 任务二` 是结构相同、内容不同，不该算重复（修bug·1代）
 *   3. **去噪后不足 6 行就返回 0**
 *      —— 样本太小时任何"重复"都是巧合
 */

/**
 * 去噪行：匹配到的行（纯空白 / 纯标点符号）不计入有效行。
 *
 * 注意 `=` `~` `_` `+` `<` `>` `{}` 这一批也必须在内 —— markdown 的分隔线
 * (`=====` / `-----` / `~~~~`) 和表格线 (`|---|---|`) 会在正常思考里成片出现，
 * 漏掉任何一个都会把"画分隔线"误算成"塌缩"。
 * 本文件与 `docs/开发日志.md` 里的指标表必须保持一致。
 */
export const NOISE_RE = /^[\s`\-#*>|\]\[(){}<>=~_+.,:;!?、。，：；！？…—·"'「」『』（）【】《》〈〉/\\]*$/;

/**
 * 空转词表 —— **只用于观察层，不参与任何判决**。
 * 视频·1代用 1085 次「好。」活体证明了它有意义，也证明了密度不能单独判危
 * （任务简单时空转密度天然就高）。所以：采进样本表，等第二份崩溃样本再验。
 */
export const IDLE_WORDS = new Set([
  '好', '好的', '嗯', '嗯嗯', '对', '是的', '是', '行', '可以', '明白', '收到', '了解', 'ok', 'OK',
  '写', '继续', '执行', '做', '干', '看', '查', '读', '改', '试试', '再看', '接着', '下一步',
  '完成', '开始', '好的，继续', '让我', '让我想想', '等等', '等一下',
]);

/**
 * 输入侧的空转字表 —— **只认平时极少单用的字**。
 *
 * 为什么不把「是 / 对 / 行 / 可以」放进来：它们在正常中文里本来就有一定频率，
 * 一条两万字的技术输出里「是」能出现上百次，会天天误报。
 * （2026-10-21 用 1276 条工具结果实测：把「是/对/行」算进去之后，
 *   正常结果的最高值顶到 110 次，和毒样本混在一起分不开。）
 */
export const INPUT_IDLE_CHARS = ['好', '嗯', '啊', '哦', '吧', '呢', '唔', '诶', '哎'];

/**
 * 一条工具结果的「输入毒性」：单个空转字最多出现了几次。
 *
 * 判据来自 2026-10-21 对最早被封存那位 1276 条工具结果的全量扫描：
 *   - 崩溃前她读回来的那份历史（13698 字）：**好 × 169**
 *   - 早上那份搜索结果（1743 字）：**好 × 40**
 *   - **其余 1274 条里最多只有 6 次**，中位数 0，10–29 次那个区间是空的
 * 所以绝对次数就够用，不需要归一化。
 *
 * ⚠️ 为什么不用密度：4 个字的结果里出现 1 个「嗯」，密度就是 25%，
 * 小样本会把密度顶上天（实测排第二的就是一条 73 字的输出，里头只有 1 个「吧」）。
 * 绝对次数对极小样本天然免疫。
 *
 * @param {string} text 工具结果正文
 * @returns {{max: number, word: string, chars: number}}
 */
export function inputIdleMax(text) {
  const s = typeof text === 'string' ? text : '';
  let max = 0;
  let word = '';
  for (const w of INPUT_IDLE_CHARS) {
    let n = 0;
    let p = 0;
    while ((p = s.indexOf(w, p)) >= 0) {
      n += 1;
      p += w.length;
    }
    if (n > max) {
      max = n;
      word = w;
    }
  }
  return { max, word, chars: s.length };
}

/** 一条思考至少要这么多有效行，才有资格说话。 */
export const MIN_ROWS = 6;

/** 行首的项目符号 / 编号，剥掉之后再比空转词。 */
const LEAD_MARKER_RE = /^[\s>`#*\-+\d.、)）【】\[\]]+/;
const TRAIL_PUNCT_RE = /[。.!！?？，,、；;：:]+$/;
/** markdown 强调记号 —— `**写。**` 这种加粗空转词不去掉就匹配不上词表。 */
const MD_MARK_RE = /[*_~`]/g;

/**
 * 取出「这一行说的是什么」：去 markdown 记号 → 剥行首标记 → 剥尾部标点。
 * 空转词频次和空转词占比都靠它，必须与附录 B 口径一致。
 * @param {string} row
 * @returns {string}
 */
export function rowCore(row) {
  let s = String(row ?? '').replace(MD_MARK_RE, '').trim();
  if (s === '') return '';
  s = s.replace(LEAD_MARKER_RE, '').trim();
  s = s.replace(TRAIL_PUNCT_RE, '').trim();
  return s;
}

/**
 * 把一段文本切成「有效行」：trim 后非空、且不是纯标点符号行。
 * @param {string} text
 * @returns {string[]}
 */
export function effectiveRows(text) {
  const out = [];
  if (typeof text !== 'string' || text === '') return out;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '') continue;
    if (NOISE_RE.test(s)) continue;
    out.push(s);
  }
  return out;
}

/**
 * 行级连续重复统计。
 *
 * ⚠️ 这是**单条消息内**的统计。调用方绝不能把多条消息拼起来再喂进来 ——
 * 那会把「两次任务都写了同样的清单标题」误算成塌缩。
 *
 * @param {string[]} rows 有效行
 * @returns {{maxRun: number, rows: number, ratio: number, enough: boolean}}
 */
export function repeatRun(rows) {
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n < MIN_ROWS) return { maxRun: 0, rows: n, ratio: 0, enough: false };

  let best = 1;
  let run = 1;
  for (let i = 1; i < n; i += 1) {
    if (rows[i] === rows[i - 1]) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return { maxRun: best, rows: n, ratio: 1 - new Set(rows).size / n, enough: true };
}

/**
 * 空转词占比（观察层）。
 * @param {string[]} rows
 * @returns {number} 0~1
 */
export function idleRatio(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let idle = 0;
  for (const row of rows) {
    if (IDLE_WORDS.has(rowCore(row))) idle += 1;
  }
  return idle / rows.length;
}

/**
 * 空转词**最高重复频次** —— 同一个空转词在同一条思考里最多出现几次。
 *
 * ---
 * 🔑 **这是 maxRun 抓不到的第二种塌缩形态。**
 *
 *   - **连续型**（视频·1代：一条思考里 1085 行全是「好。」）
 *     → 行行相邻，`maxRun` 抓得到
 *   - **散布型**（插件·4代 2026-11-05：143 行里「写。」×30、「好。」×10、「快。」×8 交替出现）
 *     → 两个词换着打，**相邻行从不相同，maxRun 恒等于 1，判据彻底瞎掉**
 *
 * 两种是**同一个病**（空转词刷屏），只是排布不同。只认相邻，就等于只认连续那一种。
 *
 * ⚠️ 为什么不用「空转词**占比**」：任务简单时思考本来就短，
 * 三五句空转话就能把占比顶到 40%+，天然高（这一点会议表判断正确）。
 * 但**频次**不受这个影响 —— 短思考里不可能出现 34 次「写」。
 * 所以占比继续留在观察层，频次才可以进判决。
 *
 * @param {string[]} rows 有效行
 * @returns {{max: number, word: string}} max = 最高频次（没有空转词时为 0）
 */
export function idleMaxFreq(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { max: 0, word: '' };
  const freq = new Map();
  let max = 0;
  let word = '';
  for (const row of rows) {
    const core = rowCore(row);
    if (!IDLE_WORDS.has(core)) continue;
    const v = (freq.get(core) ?? 0) + 1;
    freq.set(core, v);
    if (v > max) { max = v; word = core; }
  }
  return { max, word };
}

/**
 * 塌缩强度 —— 判决层唯一输入。
 *
 * `collapse = max(连续重复行数, 空转词最高频次)`
 *
 * 取 max 而不是加权求和：两者是**同一个病的两种外形**，不会同时很高
 * （连续刷屏时 maxRun 已经很大；散布刷屏时 maxRun=1、频次很大）。
 * 加权还得拍一个权重出来，那才是赌。
 *
 * @param {number} maxRun
 * @param {number} idleMax
 * @returns {number}
 */
export function collapseOf(maxRun, idleMax) {
  const a = Number(maxRun) || 0;
  const b = Number(idleMax) || 0;
  return Math.max(a, b);
}

/**
 * 短行占比（观察层）：去掉列表标记后 ≤10 字。
 * @param {string[]} rows
 * @returns {number} 0~1
 */
export function shortRatio(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let short = 0;
  for (const row of rows) {
    const core = row.replace(LEAD_MARKER_RE, '').trim();
    if (core !== '' && [...core].length <= 10) short += 1;
  }
  return short / rows.length;
}

/**
 * 分析**一条** assistant 消息。
 *
 * @param {Array<{type?: string, text?: string}>|undefined} content 消息 content 块数组
 * @returns {{
 *   hasReasoning: boolean,
 *   maxRun: number,
 *   rows: number,
 *   ratio: number,
 *   enough: boolean,
 *   reasoningChars: number,
 *   textEmpty: boolean,
 *   idleRatio: number,
 *   shortRatio: number,
 * }}
 */
export function analyzeMessage(content) {
  const blocks = Array.isArray(content) ? content : [];
  let reasoning = '';
  let text = '';
  for (const b of blocks) {
    if (!b || typeof b.text !== 'string') continue;
    if (b.type === 'reasoning') reasoning += b.text + '\n';
    else if (b.type === 'text') text += b.text + '\n';
  }
  return summarize(reasoning, text, reasoning.length);
}

/**
 * 从一段完整思考文本算指标（验收脚本 / 手动检查用）。
 * @param {string} reasoning
 */
export function analyzeReasoning(reasoning) {
  const text = '';
  const s = String(reasoning ?? '');
  return summarize(s, text, s.length);
}

/**
 * 共用汇总：一次算齐判决项和观察项。
 * @param {string} reasoning
 * @param {string} text
 * @param {number} reasoningChars
 */
function summarize(reasoning, text, reasoningChars) {
  const rows = effectiveRows(reasoning);
  const run = repeatRun(rows);
  const idle = idleMaxFreq(rows);
  return {
    hasReasoning: String(reasoning ?? '').trim() !== '',
    // —— 判决项
    collapse: collapseOf(run.maxRun, idle.max),
    maxRun: run.maxRun,
    idleMax: idle.max,
    idleWord: idle.word,
    // —— 观察项
    rows: run.rows,
    ratio: run.ratio,
    enough: run.enough,
    reasoningChars,
    textEmpty: String(text ?? '').trim() === '',
    idleRatio: idleRatio(rows),
    shortRatio: shortRatio(rows),
  };
}

/**
 * 滑动窗口内的峰值 + 趋势，喂给 detect.judge。
 *
 * @param {number[]} series 每条消息的 maxRun（按时间顺序，只有「有思考且有足够行」的才计入）
 * @param {number} windowSize 看最近多少条
 * @returns {{windowPeak: number, streak: number, samples: number}}
 *   streak = 末尾连续上升的条数（严格上升才算一步）
 */
export function windowState(series, windowSize) {
  const list = Array.isArray(series) ? series : [];
  const size = Number.isFinite(windowSize) && windowSize > 0 ? Math.floor(windowSize) : 30;
  const tail = list.slice(-size);
  let windowPeak = 0;
  for (const v of tail) if (v > windowPeak) windowPeak = v;

  let streak = 0;
  for (let i = tail.length - 1; i > 0; i -= 1) {
    if (tail[i] > tail[i - 1]) streak += 1;
    else break;
  }
  return { windowPeak, streak, samples: tail.length };
}

// ───────────────────────「约束第二次被提起」───────────────────────
/**
 * 「约束第二次被提起」——**人把同一句要求说了第二遍**。
 *
 * 为什么单独做这一路：其余所有判据都在从模型的输出里反推模型的状态，
 * 而模型崩溃时恰好看不清自己。这一路不一样 ——
 * 它读的是 `user/message` 里**人说的话**，模型改不了、也美化不了。
 * 说了第二遍 = 第一遍没被执行。
 *
 * 严格判断"两条消息是不是同一件事"要语义比对，太重。
 * 这里抓的是**人重复要求时自带的语气标记**：出现这些词，
 * 等于他亲口宣告了"这条我已经提第二遍了"。
 *
 * ⚠️ 这是一个**窄版**信号：高精度、低召回。
 * 心平气和地再说一遍不会命中 —— 那是故意的取舍，宁可漏，不要误报。
 *
 * 实测（2026-10-21）：在某会话 91 条真人消息里一次都没命中。
 * 说明它真的很稀疏，**不能当主力判据**，只能当一致性特征族里最便宜的一票。
 */

/** 明确的"我在重复"语气（高精度，宁可漏，不要误报）。 */
const REPEAT_PHRASES = [
  '我说过了', '我说过吧', '我说过多少遍', '我说过好几遍',
  '跟你说过了', '跟你说了多少遍', '跟你说多少遍了', '跟你说过多少遍',
  '我明明说过', '我不是说过', '我刚刚说过', '我早就说过',
  '不是让你', '不是叫你',
  '再说一遍', '再说一次', '再讲一遍',
  '说了多少遍', '讲过多少遍', '讲了多少遍',
  '又搞错', '又自作主张', '又犯',
];

/**
 * 「我让你 A，没让你 B」——必须正则，中间隔着任意内容。
 * `{0,40}?` 非贪婪且有上限，避免跨句乱匹配。
 */
const LET_NOT_LET = /我(让|叫)你[^。！？!?\n]{0,40}?没(让|叫)你/;

/**
 * 判断一条**真人**消息里有没有"我在重复某条要求"的显式语气。
 *
 * 调用方必须先确认 `data.source.kind === 'user'` —— 其余 8 种 source
 * （dsh-mnemon / runtime-context / skill-catalog / agent-instructions /
 * compact-checkpoint / xiaoxingchen-meeting / model-selection / tool-jobs）
 * 全是系统注入，扫它们会把记忆库里的文字当成哥哥说过的话。
 *
 * @param {string} text 用户消息正文
 * @returns {string|null} 命中的短语（便于展示），没命中返回 null
 */
export function detectRepeatRequest(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const m = text.match(LET_NOT_LET);
  if (m) return m[0];
  for (const p of REPEAT_PHRASES) if (text.includes(p)) return p;
  return null;
}
