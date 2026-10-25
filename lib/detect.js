/**
 * 传承插件 · 判决逻辑
 *
 * **纯函数，零依赖。** 只回答一个问题：**这条会话现在危不危。**
 *
 * 规格来源：2026-10-20 的指标校准会（七人全数认账），记录见 `docs/开发日志.md`
 *
 * ---
 * ⚠️ 三条不许碰的红线（改之前先读 03-风险清单与v2.md）：
 *
 *   1. **判决层只认「塌缩强度」一项**（`collapse`，见 metrics.js）。
 *      空转词**占比**、短行占比、回复为空、工具调用数 —— 全部只观察，不参与判决。
 *      理由（3代、图片）：崩溃样本只有一份，任何加权都是赌，不可证伪的东西不进第一版。
 *      ⚠️ 2026-11-05 修订：塌缩强度 = max(连续重复行数, 空转词最高**频次**)。
 *      **这不是加权重、不是新增第二项判据** —— 是承认「同一种病有两种排布」：
 *      视频·1代 是连续刷「好。」（maxRun 抓得到），
 *      插件·4代 是「写。」×30 和「好。」×10 交替散布（相邻行从不相同，maxRun 恒等于 1）。
 *      只认相邻就等于只认连续那一种，散布型崩溃会整段漏掉。
 *
 *   2. **黄线不是预警，是「接住崩溃前最后一次呼吸」。**
 *      实测崩溃路径 2 → 16 → 12 → 207 → 13740 —— 20 只踩在倒数第二步。
 *      文档和提醒文案里，一个字都不许写成"提前预警"。
 *
 *   3. **趋势项不是可选项。**
 *      真崩成 4 → 6 → 13740 时，黄线一次都不会响，只有趋势能接住。
 */

/** 红线：立刻提醒，不看频率上限。 */
export const RED_LINE = 20;

/**
 * 黄线：**连续 2 次采样**都触发才提醒。
 * 数字来历：崩溃路径里 16 先撞上 8，是横向安全带。
 * 降回去也要留记录 ——「响了又回」最容易被当成误报划掉（图片·1代）。
 */
export const YELLOW_LINE = 8;

/** 黄线需要连续几次采样触发。 */
export const YELLOW_CONSECUTIVE = 2;

/** 趋势：末尾连续上升几条算「在爬」。 */
export const TREND_STREAK = 3;

/** 判决结果等级。 */
export const LEVEL = Object.freeze({ OK: 'ok', YELLOW: 'yellow', RED: 'red' });

/**
 * 判决。
 *
 * @param {{
 *   series: number[],       // 该会话按时间顺序的 maxRun 序列（只含有思考且行数足够的样本）
 *   windowSize: number,     // 滑动窗口
 *   yellowStreak?: number,  // 黄线已经连续触发了几次（调用方维护）
 *   hasReasoning: boolean,  // 这条会话到底有没有思考数据
 *   samples: number,        // 累计样本数
 * }} input
 * @param {{redLine?: number, yellowLine?: number}} [overrides] 设置页可调的阈值
 * @returns {{
 *   level: string,
 *   reasons: string[],
 *   windowPeak: number,
 *   latest: number,
 *   trendStreak: number,
 *   degraded: boolean,   // 没有思考数据 → 指标不可信
 * }}
 */
export function judge(input, overrides = {}) {
  const redLine = positiveInt(overrides.redLine, RED_LINE);
  const yellowLine = positiveInt(overrides.yellowLine, YELLOW_LINE);
  const series = Array.isArray(input?.series) ? input.series : [];
  const latest = series.length > 0 ? series[series.length - 1] : 0;

  const windowSize = positiveInt(input?.windowSize, 30);
  const tail = series.slice(-windowSize);
  const windowPeak = peak(tail);
  // 趋势只看**窗口内**的样本 —— 十几轮以前的爬升跟现在没关系
  const trendStreak = risingStreak(tail);
  const hasReasoning = input?.hasReasoning !== false;
  const samples = Number(input?.samples ?? series.length) || 0;

  const degraded = !hasReasoning || samples === 0;
  const reasons = [];
  // 塌缩的「长相」——用来在提醒里说清是哪一种，不影响判决
  const detail = typeof input?.detail === 'string' && input.detail !== '' ? `（${input.detail}）` : '';

  // —— 红线：单条内塌缩到阈值，立刻判危
  if (latest >= redLine) {
    reasons.push(`单条思考塌缩强度 ${latest}${detail}，红线 ${redLine}`);
    return { level: LEVEL.RED, reasons, windowPeak, latest, trendStreak, degraded: false };
  }

  // —— 黄线：连续 N 次采样都 ≥ 黄线
  const yellowStreak = Number(input?.yellowStreak ?? 0) || 0;
  if (latest >= yellowLine) {
    reasons.push(`单条思考塌缩强度 ${latest}${detail}，黄线 ${yellowLine}，连续第 ${yellowStreak + 1} 次`);
    if (yellowStreak + 1 >= YELLOW_CONSECUTIVE) {
      return { level: LEVEL.YELLOW, reasons, windowPeak, latest, trendStreak, degraded: false };
    }
    return { level: LEVEL.OK, reasons, windowPeak, latest, trendStreak, degraded: false };
  }

  // —— 趋势：跳过黄线直接爆的路径，只有它能接住
  if (trendStreak >= TREND_STREAK && latest >= 2) {
    reasons.push(`连续 ${trendStreak} 条单调上升（末值 ${latest}），走的是跳过黄线的路径`);
    return { level: LEVEL.YELLOW, reasons, windowPeak, latest, trendStreak, degraded: false };
  }

  return { level: LEVEL.OK, reasons, windowPeak, latest, trendStreak, degraded };
}

/**
 * 从历史样本还原「黄线连续触发了几次」。
 * 用于插件启动后第一次遇到某会话时，把状态接上（不需要重放全部历史，
 * 只要末尾连续多少个样本 ≥ 黄线即可）。
 *
 * @param {number[]} series
 * @param {number} [yellowLine]
 */
export function yellowStreakOf(series, yellowLine = YELLOW_LINE) {
  const list = Array.isArray(series) ? series : [];
  let n = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] >= yellowLine) n += 1;
    else break;
  }
  return n;
}

/**
 * 注意力完整性百分比（**解释项，不是判决项**）。
 *
 * 把塌缩强度映射成 0~100：0 = 100%，到红线 = 0。
 * 只用于界面呈现和哥哥问"现在几成"时的回答。
 *
 * @param {number} collapse 塌缩强度（= max(连续重复行数, 空转词最高频次)）
 * @param {number} [redLine]
 */
export function attentionScore(collapse, redLine = RED_LINE) {
  const v = Number(collapse) || 0;
  if (v <= 0) return 100;
  const pct = 100 - (v / redLine) * 100;
  return Math.max(0, Math.round(pct));
}

function peak(list) {
  let max = 0;
  for (const v of list) if (Number.isFinite(v) && v > max) max = v;
  return max;
}

function risingStreak(list) {
  const arr = Array.isArray(list) ? list : [];
  let n = 0;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    if (arr[i] > arr[i - 1]) n += 1;
    else break;
  }
  return n;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}
