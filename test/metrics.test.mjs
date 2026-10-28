#!/usr/bin/env node
/**
 * 传承插件 · 核心算单元测试（零依赖，手写断言）
 *
 * 跑法：
 *   node test/metrics.test.mjs
 *
 * 这份测试守住的是会议七人一致认账的**三条强制约束**，
 * 以及**已证伪指标不许回来**这条底线。任何人改 lib/metrics.js 或 lib/detect.js，
 * 先让这里全绿，再谈"优化"。
 */
import assert from 'node:assert/strict';
import { analyzeReasoning, effectiveRows, repeatRun, idleRatio, shortRatio, windowState, rowCore, collapseOf, detectRepeatRequest } from '../lib/metrics.js';
import { judge, attentionScore, yellowStreakOf, LEVEL, RED_LINE, YELLOW_LINE } from '../lib/detect.js';

let passed = 0;
let failed = 0;
const cases = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    cases.push(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    cases.push(`  ❌ ${name}\n       ${error?.message ?? error}`);
  }
}

// ============================================================ 约束 ①：单条内统计
test('约束① 连续重复只在单条思考内算，两条首尾相同的思考不能连起来', () => {
  const a = '好。\n好。\n好。\n好。\n好。\n好。';
  const b = '好。\n好。\n好。\n好。\n好。\n好。';
  const ra = analyzeReasoning(a);
  const rb = analyzeReasoning(b);
  // 关键：如果实现是"把多条拼起来再算"，这里会得到 12。必须各自 6。
  assert.equal(ra.maxRun, 6, '单条内 6 行重复应算 6');
  assert.equal(rb.maxRun, 6, '另一条同样只算自己的 6，不跨条累加');
});

// ============================================================ 约束 ②：精确相等
test('约束② 清单类思考（结构相同、内容不同）绝不报警', () => {
  const checklist = [
    '- [ ] 检查配置文件编码',
    '- [ ] 检查插件是否加载',
    '- [ ] 检查路由是否注册',
    '- [ ] 检查数据库连接',
    '- [ ] 检查日志目录',
    '- [ ] 检查硬链接',
    '- [ ] 检查镜像同步',
    '- [ ] 检查图标资源',
    '- [ ] 检查中文编码',
    '- [ ] 检查权限位',
    '- [ ] 检查缓存',
    '- [ ] 检查端口',
  ].join('\n');
  const r = analyzeReasoning(checklist);
  assert.equal(r.maxRun, 1, '内容不同的清单行 ≠ 重复，maxRun 必须是 1');
  assert.ok(r.maxRun < YELLOW_LINE, '清单绝不该碰到黄线');
});

test('约束② 完全相同的清单行（真重复）要算出来', () => {
  const rows = '- [ ] 待办\n'.repeat(10);
  assert.equal(analyzeReasoning(rows).maxRun, 10);
});

// ============================================================ 约束 ③：样本不足
test('约束③ 有效行不足 6 行时返回 0，不许瞎报', () => {
  assert.equal(analyzeReasoning('好。\n好。\n好。').maxRun, 0);
  assert.equal(analyzeReasoning('').maxRun, 0);
  assert.equal(analyzeReasoning('   \n\n  ').maxRun, 0);
});

// ============================================================ 去噪
test('纯标点/符号行不计入有效行', () => {
  assert.deepEqual(effectiveRows('---\n***\n你好\n```\n'), ['你好'], '横线/星号/反引号行全被去噪');
  assert.deepEqual(effectiveRows('```\n```\n====='), [], '全是符号 → 一行有效行都没有');
});

// ============================================================ 崩溃样本形态
test('崩溃样本形态：13740 行「好。」判为红线', () => {
  const collapse = '好。\n'.repeat(13740);
  const r = analyzeReasoning(collapse);
  assert.equal(r.maxRun, 13740);
  assert.equal(judge({ series: [2, 16, 12, 207, r.maxRun], windowSize: 30, hasReasoning: true, samples: 5 }).level, LEVEL.RED);
});

test('正常会话（maxRun=4）永远不报警', () => {
  const healthy = [1, 2, 3, 2, 1, 4, 3, 2, 1, 1, 2, 3, 4, 2, 1];
  const verdict = judge({ series: healthy, windowSize: 30, hasReasoning: true, samples: healthy.length });
  assert.equal(verdict.level, LEVEL.OK);
});

// ============================================================ 黄线与趋势
test('黄线需要连续 2 次采样才升级', () => {
  const once = judge({ series: [2, 9], windowSize: 30, hasReasoning: true, samples: 2 });
  assert.equal(once.level, LEVEL.OK, '只撞一次黄线不该升级');
  const twice = judge({ series: [2, 9], windowSize: 30, yellowStreak: 1, hasReasoning: true, samples: 2 });
  assert.equal(twice.level, LEVEL.YELLOW, '连续第 2 次撞黄线才提醒');
});

test('跳过黄线的路径（4→6→…）靠趋势接住', () => {
  const series = [1, 2, 4, 6, 7];
  const v = judge({ series, windowSize: 30, hasReasoning: true, samples: series.length });
  assert.equal(v.level, LEVEL.YELLOW, '连续 3 条上升且末值 ≥2 应触发趋势提醒');
  assert.ok(v.reasons.join('').includes('单调上升'));
});

test('趋势不会对震荡序列乱报', () => {
  const series = [1, 5, 2, 6, 3, 4, 1];
  assert.equal(judge({ series, windowSize: 30, hasReasoning: true, samples: series.length }).level, LEVEL.OK);
});

// ============================================================ 已证伪指标不许回来
test('回归：工具失败率高 + 相同调用 10 次，但思考干净 → 必须不报警', () => {
  // 这个用例的存在，就是防后人把已证伪的两个指标加回来。
  // 判决函数**根本不允许**接收工具相关字段 —— 就算硬塞进去也得无视。
  const series = [1, 1, 2, 1, 1];
  const v = judge({
    series,
    windowSize: 30,
    hasReasoning: true,
    samples: 5,
    toolErrorRate: 0.9,
    maxIdenticalLoop: 10,
    blankRatio: 1,
    dupRatio: 0.99,
    steps: 9999,
    turns: 999,
    compactions: 99,
  });
  assert.equal(v.level, LEVEL.OK, '已证伪的四类指标绝不能影响判决');
});

// ============================================================ 降级
test('没有思考数据 → degraded，且不判危', () => {
  const v = judge({ series: [], windowSize: 30, hasReasoning: false, samples: 0 });
  assert.equal(v.level, LEVEL.OK);
  assert.equal(v.degraded, true);
});

test('注意力完整性只在解释层用，红线处归零', () => {
  assert.equal(attentionScore(0), 100);
  assert.equal(attentionScore(RED_LINE), 0);
  assert.equal(attentionScore(13740), 0);
  assert.equal(attentionScore(10), 50);
});

// ============================================================ 观察层
test('空转词占比能算出来（只观察，不判决）', () => {
  const text = '好。\n写。\n好。\n写。\n现在开始检查配置文件的编码是否正确\n再核对一下插件是否真的加载了';
  const rows = effectiveRows(text);
  const ratio = idleRatio(rows);
  assert.ok(ratio > 0.5, `空转行应占多数，实际 ${ratio}`);
  assert.ok(shortRatio(rows) > 0.5);
});

// ============================================================ 窗口
test('窗口状态：取末尾 N 条峰值 + 上升段', () => {
  const s = windowState([1, 2, 3, 4, 5, 9, 10], 3);
  assert.equal(s.windowPeak, 10);
  // 窗口是 [5,9,10]，上升了两步（5→9、9→10）—— 三 个点、两 步
  assert.equal(s.streak, 2, '5→9→10 是两次上升');
  assert.equal(windowState([], 30).windowPeak, 0);
});

test('趋势只数窗口内的，十几轮以前的爬升不算数', () => {
  // 前 10 条在爬，然后掉回平地待了很久 —— 不该还在"趋势上升"
  const oldRise = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const v = judge({ series: oldRise, windowSize: 10, hasReasoning: true, samples: oldRise.length });
  assert.equal(v.level, LEVEL.OK, '陈年爬升不该让现在的会话报警');
});

// ============================================================ 黄线还原
test('从历史样本还原黄线连续次数', () => {
  assert.equal(yellowStreakOf([1, 2, 9, 10, 11]), 3);
  assert.equal(yellowStreakOf([9, 1, 9, 9]), 2);
  assert.equal(yellowStreakOf([]), 0);
});

// ============================================================ v2：散布型塌缩
//
// 2026-11-05 的第二份崩溃样本。视频·1代那次的塌缩是**连续**刷「好。」（maxRun=1085），
// v1 抓得到；插件·4代这次是**散着**刷 ——「写。」「好。」「快。」交替出现，
// 相邻行从不相同，maxRun 恒等于 1，v1 完全瞎掉。
// 下面这几条钉死：同一种病，两种排布，都不能漏。
//
// ⚠️ 谁要是把 collapse 改回 maxRun，这里会立刻红。

/** 造一条「空转词被正经行隔开」的思考 —— 相邻行永不重复 */
function scattered(idleWord, times, decorate = (w) => w) {
  const rows = [];
  for (let i = 0; i < times; i += 1) {
    rows.push(decorate(idleWord));
    rows.push('看文件。');   // core =「看文件」，不在空转词表里，只用来隔开
  }
  return rows.join('\n');
}

test('v2 散布型塌缩：「写。」×30 被隔开（maxRun 恒为 1）必须判红', () => {
  const r = analyzeReasoning(scattered('写。', 30));
  assert.equal(r.maxRun, 1, '相邻行从不相同 —— 这正是 v1 瞎掉的原因');
  assert.equal(r.idleMax, 30, '但同一个空转词出现了 30 次');
  assert.equal(r.collapse, 30, 'collapse 必须取到 30');
  const v = judge({ series: [r.collapse], windowSize: 30, hasReasoning: true, samples: 1 });
  assert.equal(v.level, LEVEL.RED, 'collapse=30 已过红线 20，单条就该直接判危');
});

test('v2 散布型塌缩：加粗的「**写。**」也必须认得出', () => {
  const r = analyzeReasoning(scattered('写。', 12, (w) => `**${w}**`));
  assert.equal(r.idleMax, 12, 'markdown 强调记号要先剥掉，否则匹配不上词表');
  assert.equal(r.idleWord, '写');
});

test('v2 连续型塌缩不许退化（视频·1代那一类）', () => {
  const r = analyzeReasoning(Array.from({ length: 300 }, () => '好。').join('\n'));
  assert.equal(r.maxRun, 300);
  assert.equal(r.collapse, 300, 'collapse 是取大者，连续型不能丢');
  const v = judge({ series: [r.collapse], windowSize: 30, hasReasoning: true, samples: 1 });
  assert.equal(v.level, LEVEL.RED);
});

test('v2 防误报：代码块 / 表格分隔线成片出现不报警', () => {
  const code = [
    '改这一段样式：', '```css', '.hp-bar[data-out="1"] {', '  opacity: 0;', '}',
    '```', '|---|---|', '| a | b |', '```css', '.hp-bar[data-out="1"] {', '  opacity: 0;', '}',
    '```', '再跑一遍。',
  ].join('\n');
  const r = analyzeReasoning(code);
  assert.ok(r.collapse <= 2, `代码块不该被算成空转或连续重复，实际 ${r.collapse}`);
});

test('v2 防误报：「写代码」「写文件」不是空转词（整行精确匹配）', () => {
  const r = analyzeReasoning(['写代码', '写文件', '写CSS', '写文档', '写测试', '写注释'].join('\n'));
  assert.equal(r.idleMax, 0, '词表是整行精确相等，不是包含');
});

test('v2 口径：rowCore 要剥掉 markdown / 列表标记 / 首尾标点', () => {
  assert.equal(rowCore('**写。**'), '写');
  assert.equal(rowCore('- 写。'), '写');
  assert.equal(rowCore('> 好！'), '好');
  assert.equal(rowCore('写代码'), '写代码', '整行不同，保持原样');
});

test('v2 collapseOf 取大者，且不丢任何一边', () => {
  assert.equal(collapseOf(3, 17), 17);
  assert.equal(collapseOf(207, 2), 207);
  assert.equal(collapseOf(0, 0), 0);
});

// ============================================ 「约束第二次被提起」（v1.26 新增）
test('repeat：显式语气要能被认出来', () => {
  assert.equal(detectRepeatRequest('我说过了，每个文件夹各建一个图库'), '我说过了');
  assert.equal(detectRepeatRequest('不是让你改这个'), '不是让你');
  assert.ok(detectRepeatRequest('我让你改图片，没让你动配置')?.includes('没让你'), '「我让你A没让你B」要能认出');
  assert.equal(detectRepeatRequest('再说一遍，不要用红色'), '再说一遍');
  assert.equal(detectRepeatRequest('跟你说了多少遍了'), '跟你说了多少遍');
});

test('repeat：正常提要求不许误报（宁可漏，不要误报）', () => {
  assert.equal(detectRepeatRequest('帮我把体力条的透明度调低一点'), null);
  assert.equal(detectRepeatRequest('我让你做的是15%到0%这4张'), null, '「我让你」单独不构成重复，必须有「没让你」');
  assert.equal(detectRepeatRequest('这个又来了一个新需求'), null, '「又」单独不构成重复');
  assert.equal(detectRepeatRequest('我说过要做这个功能'), null, '「我说过」后面没「了/多少遍」时是陈述，不是重复');
  assert.equal(detectRepeatRequest(''), null);
  assert.equal(detectRepeatRequest(null), null);
});

// ============================================================ 输出
console.log('\n传承插件 · 核心算法单测\n');
console.log(cases.join('\n'));
console.log(`\n${failed === 0 ? '✅' : '❌'} 通过 ${passed} / ${passed + failed}`);
if (failed > 0) process.exit(1);
