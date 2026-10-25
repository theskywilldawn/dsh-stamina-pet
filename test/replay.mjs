#!/usr/bin/env node
/**
 * 传承插件 · 端到端验收（回放本机全部会话）
 *
 * 它用的是**插件自己的代码**（lib/metrics.js + lib/detect.js + lib/logreader.js），
 * 不是另写一份 —— 验收脚本复用的口径必须跟运行时一模一样，否则验了等于没验。
 *
 * 验收标准（来自 2026-10-20 指标校准会第六节，记录见 `docs/开发日志.md`）：
 *   1. 崩溃样本：必须在崩溃那一条**报红线**
 *   2. 其余全部会话：**全程一次都不报**（零误报）
 *   3. 清单类思考：不报（算法层单测已守住，这里再跑一遍真实会话）
 *
 * 跑法：
 *   node test/replay.mjs                 # 全部会话
 *   node test/replay.mjs --min-mb 1      # 只看 ≥1MB 的
 *   node test/replay.mjs --json out.json
 */
import { existsSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { analyzeMessage, effectiveRows, repeatRun } from '../lib/metrics.js';
import { judge, yellowStreakOf, LEVEL, RED_LINE, YELLOW_LINE } from '../lib/detect.js';
import { listSessionLogs, decodeEvents } from '../lib/logreader.js';

const CRASH_SESSION = process.env.CRASH_SESSION || 'session-00000000';   // 填一个本地已归档、确认崩过的会话（只读日志），或设环境变量
const CRASH_APPROX_AT = 892;                 // 崩溃大约在第几条（方案记录：892 起爆，895 是峰值）

let passed = 0;
let failed = 0;
const checks = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    checks.push(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    checks.push(`  ❌ ${name}\n       ${error?.message ?? error}`);
  }
}

function parseArgs(argv) {
  const o = { minMb: 0, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--min-mb') o.minMb = Number(argv[++i]) || 0;
    else if (argv[i] === '--json') o.json = argv[++i];
  }
  return o;
}

const opt = parseArgs(process.argv.slice(2));
let logs = listSessionLogs();
if (opt.minMb) logs = logs.filter((l) => l.size >= opt.minMb * 1048576);
if (logs.length === 0) {
  console.error('ERROR: 没找到任何会话日志');
  process.exit(1);
}

console.log(`\n传承插件 · 端到端验收`);
console.log(`回放 ${logs.length} 个会话（用插件自己的算法）…\n`);

const rows = [];
for (const log of logs) {
  const { events, frames } = decodeEvents(readFileSync(log.file));

  // —— 按运行时的口径：每遇到一条 assistant 消息就采样一次，维护滑动窗口序列
  const series = [];
  const samples = [];
  let reasoningMsgs = 0;
  let msgIndex = 0;          // 第几条 assistant 消息（1-based，与方案记录对齐）
  let redAt = -1;            // 红线出现的**消息序号**
  let yellowAt = -1;
  let redCount = 0;
  let yellowCount = 0;
  let peak = 0;
  let peakAt = -1;           // 峰值出现的**消息序号**

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (ev?.type !== 'assistant/message') continue;
    const content = ev?.data?.message?.content;
    if (!Array.isArray(content)) continue;
    msgIndex += 1;

    const m = analyzeMessage(content);
    if (m.hasReasoning) reasoningMsgs += 1;
    if (!m.enough) continue;           // 样本不足不参与判决（与运行时一致）

    series.push(m.maxRun);
    samples.push(m);

    if (m.maxRun > peak) { peak = m.maxRun; peakAt = msgIndex; }

    const verdict = judge({
      series,
      windowSize: 30,
      yellowStreak: yellowStreakOf(series.slice(0, -1)),
      hasReasoning: true,
      samples: series.length,
    });
    if (verdict.level === LEVEL.RED) {
      redCount += 1;
      if (redAt < 0) redAt = msgIndex;
    } else if (verdict.level === LEVEL.YELLOW) {
      yellowCount += 1;
      if (yellowAt < 0) yellowAt = msgIndex;
    }
  }

  rows.push({
    id: log.id,
    sizeMB: +(log.size / 1048576).toFixed(2),
    frames,
    assistantMsgs: msgIndex,
    reasoningMsgs,
    samples: series.length,
    peak,
    peakAt,
    redCount,
    redAt,
    yellowCount,
    yellowAt,
    hasReasoning: reasoningMsgs > 0,
  });
}

// ============================================================ 验收判定

const crash = rows.find((r) => r.id.startsWith(CRASH_SESSION));

check(`崩溃样本存在（${CRASH_SESSION}…）`, () => {
  if (!rows.some((r) => r.id.startsWith(CRASH_SESSION))) {
    throw new Error('没找到崩溃样本日志，验收无法进行');
  }
});

if (crash) {
  check('崩溃样本：报出红线', () => {
    if (crash.redCount < 1) throw new Error(`红线条数 = ${crash.redCount}，应当 ≥1`);
  });
  check(`崩溃样本：报警位置在第 ${CRASH_APPROX_AT}~905 条之间`, () => {
    if (crash.redAt < CRASH_APPROX_AT || crash.redAt > 905) {
      throw new Error(`实际在第 ${crash.redAt} 条（峰值 ${crash.peak} 出现在第 ${crash.peakAt} 条）`);
    }
  });
  check('崩溃样本：红线只报在那一条附近，不是满屏刷', () => {
    if (crash.redCount > 6) throw new Error(`红线报了 ${crash.redCount} 次，太多`);
  });
}

const others = rows.filter((r) => !r.id.startsWith(CRASH_SESSION));
const noisy = others.filter((r) => r.redCount > 0 || r.yellowCount > 0);

check(`其余 ${others.length} 个会话：全程零报警`, () => {
  if (noisy.length > 0) {
    const detail = noisy.map((r) => `${r.id.slice(0, 20)}…(峰值 ${r.peak}, 红 ${r.redCount} 黄 ${r.yellowCount})`).join('；');
    throw new Error(`有 ${noisy.length} 个会话误报：${detail}`);
  }
});

check(`有思考数据的会话健康时 maxRun 全部 < 黄线 ${YELLOW_LINE}`, () => {
  const bad = others.filter((r) => r.hasReasoning && r.peak >= YELLOW_LINE);
  if (bad.length > 0) {
    throw new Error(bad.map((r) => `${r.id.slice(0, 20)}… 峰值 ${r.peak}`).join('；'));
  }
});

check('没有思考数据的会话被判为 degraded、不误报', () => {
  const blind = others.filter((r) => !r.hasReasoning);
  // 它们不该有任何报警
  const bad = blind.filter((r) => r.redCount > 0 || r.yellowCount > 0);
  if (bad.length > 0) throw new Error(`${bad.length} 个无思考数据会话被误报`);
  // 并且界面必须知道它们不可信 —— 这里只验证事实存在，界面在单测里验
  return blind.length;
});

// ============================================================ 明细表
const pad = (s, n) => {
  let w = 0;
  for (const ch of String(s)) w += /[\u4e00-\u9fff\uff00-\uffef·]/.test(ch) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
console.log('明细（只列有思考数据的会话）：');
console.log(`${pad('会话 id', 44)}${pad('MB', 7)}${pad('消息', 6)}${pad('思考', 6)}${pad('样本', 6)}${pad('峰值', 7)}${pad('@消息', 7)}${pad('红线', 6)}${pad('黄线', 6)}`);
console.log('-'.repeat(96));
for (const r of rows.filter((x) => x.hasReasoning).sort((a, b) => b.peak - a.peak).slice(0, 25)) {
  console.log(
    pad(r.id.length > 42 ? `${r.id.slice(0, 38)}…` : r.id, 44) + pad(r.sizeMB, 7) +
    pad(r.assistantMsgs, 6) + pad(r.reasoningMsgs, 6) + pad(r.samples, 6) +
    pad(r.peak, 7) + pad(r.peakAt, 7) + pad(r.redCount, 6) + pad(r.yellowCount, 6),
  );
}

console.log(`\n${checks.join('\n')}`);
console.log(`\n${failed === 0 ? '✅' : '❌'} 验收通过 ${passed} / ${passed + failed}`);

if (opt.json) {
  writeFileSync(opt.json, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log(`明细已落盘: ${opt.json}`);
}
if (failed > 0) process.exit(1);
