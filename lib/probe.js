/**
 * 手动探针 —— 问模型一句话，量它的**输出分布熵**。
 *
 * ---
 * 🔑 为什么是「熵」：学术侧唯一一个**我们真的拿得到**的"因"信号。
 *
 * 三路内部信号里，注意力衰减和表征漂移都要读模型内部张量（黑盒拿不到），
 * 只有 next-token 分布的熵可以通过 API 的 `logprobs` 取到。
 * 而单看熵一路，论文实测 AUROC 就有 0.954（三合一才 0.977）——性价比最高。
 *
 * ⚠️ **绝对值没有意义**。熵高度依赖"在聊什么"（写代码 vs 闲聊差很远）。
 * 唯一有意义的是**相对她自己健康期基线的偏离**。所以必须配一个「设为基线」的动作。
 *
 * ⚠️ **单次读数噪声极大**。2026-10-21 实测：同一个会话、相隔几秒连测四次，
 * 熵在 1.11~1.44 之间跳（30%），根本盖过疲劳本身的差异。所以一次「探针」
 * 实际要**连跑 `samples` 次（默认 3）取中位数**，用重复测量把噪声压下去。
 * 三个指标里 `lowConfRatio` 最稳（绝对波动约 ±1 个百分点），熵最飘。
 *
 * ⚠️ **成本**：`top_logprobs: 20` 会让返回体涨到每 token 约 1.4 KB（实测 320 倍）。
 * 所以探针只生成有限长度，并把 `bytes` 字段当场丢掉，不落盘、不进会话日志。
 * 一次 250 token 的样本约 370 KB，默认 3 次合计约 1.1 MB —— 手动触发才花这个钱。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 默认探针问题：三点式，逼出足够长的回答（20 token 的样本统计量不够）。 */
export const PROBE_QUESTION = '用 200 字左右、分成三点回答：①你此刻在处理的事是什么 ②其中最有把握和最没把握的各是哪一点 ③接下来第一步具体做什么。';

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';

/** 中位数。偶数个取中间两个的平均 —— 比平均数抗极端值（一次抽风不至于带偏）。 */
function median(values) {
  const a = values.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (a.length === 0) return 0;
  const mid = a.length >> 1;
  return a.length % 2 === 1 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * 找 API key。顺序：环境变量 → DSH 凭据文件。
 * 绝不打印、绝不返回给前端。
 */
export function resolveApiKey(env = process.env) {
  if (typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.trim()) {
    return { key: env.DEEPSEEK_API_KEY.trim(), from: '环境变量 DEEPSEEK_API_KEY' };
  }
  const candidates = [
    join(env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml'),
    join(homedir(), '.dsh', '.credentials.yaml'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, 'utf8');
      const m = text.match(/DEEPSEEK_API_KEY\s*:\s*["']?([^\s"'\r\n]+)/);
      if (m) return { key: m[1], from: `凭据文件 ${file}` };
    } catch { /* 读不到就换下一个 */ }
  }
  return { key: null, from: null };
}

/**
 * 用 top-N 候选算**近似熵**（bit）。
 *
 * 为什么是"近似"：只看得到前 20 个候选，尾部被截断，所以这是熵的**下界**。
 * 但趋势比绝对值重要 —— 只要每次都用同一个口径，纵向比就是有效的。
 *
 * @param {Array<{logprob: number}>} topLogprobs
 * @returns {number}
 */
export function topEntropy(topLogprobs) {
  if (!Array.isArray(topLogprobs) || topLogprobs.length === 0) return 0;
  let sum = 0;
  for (const c of topLogprobs) {
    const lp = Number(c?.logprob);
    if (Number.isFinite(lp)) sum += Math.exp(lp);
  }
  if (sum <= 0) return 0;
  let h = 0;
  for (const c of topLogprobs) {
    const lp = Number(c?.logprob);
    if (!Number.isFinite(lp)) continue;
    const p = Math.exp(lp) / sum;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * 把 API 返回里的逐 token logprob 压成三个数。
 *
 * @param {Array<{token?: string, logprob: number, top_logprobs?: any[]}>} content
 */
export function summarizeLogprobs(content) {
  const list = Array.isArray(content) ? content : [];
  const ents = [];
  let sumNegLogp = 0;
  let n = 0;
  let lowConf = 0;
  for (const it of list) {
    const lp = Number(it?.logprob);
    if (!Number.isFinite(lp)) continue;
    // -9999 表示"不在前 20 名"，属于极端不确定，单独计
    if (lp <= -9000) { lowConf += 1; n += 1; continue; }
    sumNegLogp += -lp;
    n += 1;
    if (lp < -3) lowConf += 1; // 概率 < 5%
    const top = it?.top_logprobs;
    if (Array.isArray(top) && top.length > 1) ents.push(topEntropy(top));
  }
  const meanEntropy = ents.length ? ents.reduce((a, b) => a + b, 0) / ents.length : 0;
  return {
    tokens: n,
    entropy: Number(meanEntropy.toFixed(4)),
    // 困惑度代理：平均 -logp 的指数。跟熵高度相关，但对采样 token 的极端值更敏感
    ppl: n > 0 ? Number(Math.exp(sumNegLogp / n).toFixed(2)) : 0,
    // 低置信 token 占比：模型"拿不准"的比例，是熵的另一种便宜侧面
    lowConfRatio: n > 0 ? Number((lowConf / n).toFixed(4)) : 0,
  };
}

/**
 * 跑一次探针。
 *
 * **一次调用 = `samples` 次独立采样 + 取中位数**（默认 3 次）。
 * 单次读数噪声太大（同会话连测能差 30%），重复测量是唯一便宜的降噪手段。
 *
 * @param {{
 *   messages: Array<{role: string, content: string}>,
 *   question?: string,
 *   maxTokens?: number,
 *   samples?: number,
 *   apiKey?: string,
 *   baseURL?: string,
 *   model?: string,
 *   topN?: number,
 *   timeoutMs?: number,
 *   thinking?: boolean,
 * }} opts
 */
export async function runProbe(opts = {}) {
  const apiKey = opts.apiKey;
  if (!apiKey) return { ok: false, error: '没有可用的 DeepSeek API key（环境变量 DEEPSEEK_API_KEY 或 ~/.dsh/.credentials.yaml）' };

  const model = opts.model || DEFAULT_MODEL;
  const base = (opts.baseURL || DEFAULT_BASE).replace(/\/+$/, '');
  const maxTokens = Math.max(16, Math.min(400, Number(opts.maxTokens) || 400));
  const topN = Math.max(1, Math.min(20, Number(opts.topN) || 20));
  const question = opts.question || PROBE_QUESTION;
  const samples = Math.max(1, Math.min(5, Number(opts.samples) || 3));
  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || 60000);

  // 只带最近几轮，别把整条会话倒过去（那才是最贵的地方）
  const history = Array.isArray(opts.messages) ? opts.messages.slice(-8) : [];
  const body = {
    model,
    messages: [...history, { role: 'user', content: question }],
    max_tokens: maxTokens,
    temperature: 1.0,
    logprobs: true,
    top_logprobs: topN,
    thinking: opts.thinking === true ? { type: 'enabled' } : { type: 'disabled' },
  };

  /** 跑一次，成功就返回统计量，失败返回 { ok:false, error }。 */
  const once = async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}`, ms: Date.now() - t0 };
      const json = JSON.parse(text);
      const choice = json?.choices?.[0];
      const stats = summarizeLogprobs(choice?.logprobs?.content);
      return {
        ok: true,
        ms: Date.now() - t0,
        bytes: Buffer.byteLength(text, 'utf8'),
        answer: String(choice?.message?.content ?? '').trim(),
        usage: json?.usage ?? null,
        ...stats,
      };
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      return { ok: false, error: aborted ? '探针超时' : String(error?.message ?? error), ms: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  };

  const t0 = Date.now();
  const runs = [];
  let bytes = 0;
  let lastError = null;
  // **串行**跑：并发打同一把 key 容易被限流，而且慢的总时长其实差不多
  for (let i = 0; i < samples; i += 1) {
    const r = await once();
    if (!r.ok) { lastError = r.error; continue; }
    runs.push(r);
    bytes += r.bytes;
  }

  if (runs.length === 0) {
    return { ok: false, error: lastError || '探针全部失败', ms: Date.now() - t0, requested: samples, samples: 0 };
  }

  return {
    ok: true,
    ms: Date.now() - t0,
    bytes,
    model,
    // 回答取第一次的：内容只是给人看的，不参与统计
    answer: runs[0].answer,
    usage: runs[0].usage,
    tokens: Math.round(median(runs.map((r) => r.tokens))),
    entropy: Number(median(runs.map((r) => r.entropy)).toFixed(4)),
    ppl: Number(median(runs.map((r) => r.ppl)).toFixed(2)),
    lowConfRatio: Number(median(runs.map((r) => r.lowConfRatio)).toFixed(4)),
    samples: runs.length,
    requested: samples,
    partial: runs.length < samples,
    // 每轮的原始值留着 —— 诊断"这次读数靠不靠得住"全靠它看波动范围
    runs: runs.map((r) => ({
      tokens: r.tokens, entropy: r.entropy, ppl: r.ppl, lowConfRatio: r.lowConfRatio,
    })),
  };
}
