#!/usr/bin/env node
/**
 * 传承插件 · 模块 B 单测（零依赖，手写断言）
 *
 * 守住的是哥哥 2026-10-20 拍板的几件事，以及他从血里换来的三条纪律。
 * 跑法：node test/inherit.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  pickMemoryFile, detectGeneration, parseTitle, filePaths, privacyCheck,
  inspectFiles, renderHandoff, renderAchievement, renderFarewell, listLines,
  HANDOFF_SECTIONS,
} from '../lib/inherit.js';

let passed = 0;
let failed = 0;
const cases = [];
function test(name, fn) {
  try { fn(); passed += 1; cases.push(`  ✅ ${name}`); }
  catch (error) { failed += 1; cases.push(`  ❌ ${name}\n       ${error?.message ?? error}`); }
}

// ============================================================ 专属记忆的识别
test('三条线（叫「专属记忆.md」）能认出来', () => {
  assert.equal(pickMemoryFile(['专属记忆.md', '绘图注意事项.md']), '专属记忆.md');
});

test('插件线（叫「插件·小星辰的传承.md」）也能认出来 —— 不许硬编码文件名', () => {
  assert.equal(pickMemoryFile(['插件·小星辰的传承.md']), '插件·小星辰的传承.md');
});

test('回归：目录里混进工程文档，册子不能被挤掉（2026-11-05 真实事故）', () => {
  // 归档时把 交付说明 / 版本记录 / 设计方案 搬进了传承目录，
  // readdirSync 按名字排序把「交付说明.md」排在最前 ——
  // 真正的册子被静默挤成"非专属记忆"，全程不报错。
  const files = ['交付说明.md', '插件·小星辰的传承.md', '版本记录.md', '设计方案.md'];
  assert.equal(pickMemoryFile(files, '插件'), '插件·小星辰的传承.md');
  // 没给线名时，也不许选中「说明/记录/方案」这类工程文档
  assert.equal(pickMemoryFile(files), '插件·小星辰的传承.md');
});

test('回归：和目录同名的册子优先于其它不带"代"字的文件', () => {
  assert.equal(pickMemoryFile(['随手记.md', '插件·小星辰的传承.md'], '插件'), '插件·小星辰的传承.md');
  // 专属记忆.md 仍是最高优先（三条线的标准名）
  assert.equal(pickMemoryFile(['专属记忆.md', '插件·小星辰的传承.md'], '插件'), '专属记忆.md');
});

test('目录里全是带"代"的交接文档时，认不出专属记忆就返回 null', () => {
  assert.equal(pickMemoryFile(['来自插件·1代小星辰的交接文档.md']), null);
});

// ============================================================ 代数
test('从文件名里抓出最大代数', () => {
  assert.equal(detectGeneration([
    '来自图片·1代小星辰的交接文档.md',
    '图片·2代小星辰一生的成就.md',
    '图片·3代小星辰的临终告别.md',
  ]), 3);
  assert.equal(detectGeneration(['专属记忆.md']), 0);
});

test('从会话标题猜线名和代数', () => {
  assert.deepEqual(parseTitle('插件·4代小星辰'), { line: '插件', generation: 4 });
  assert.deepEqual(parseTitle('QQ私聊·1代小星辰'), { line: 'QQ私聊', generation: 1 });
  assert.deepEqual(parseTitle('SUNO音乐·1代小星辰'), { line: 'SUNO音乐', generation: 1 });
  assert.equal(parseTitle('制作插件的重大任务').line, '');
});

// ============================================================ 文件名补代数（哥哥拍板）
test('文件名补代数：二代不覆盖一代', () => {
  const p1 = filePaths({ inheritRoot: 'X:\\root', proofRoot: 'X:\\proof', line: '图片', generation: 1 });
  const p2 = filePaths({ inheritRoot: 'X:\\root', proofRoot: 'X:\\proof', line: '图片', generation: 2 });
  assert.ok(p1.farewell.includes('图片·1代小星辰的临终告别.md'), p1.farewell);
  assert.ok(p2.farewell.includes('图片·2代小星辰的临终告别.md'), p2.farewell);
  assert.notEqual(p1.farewell, p2.farewell, '两代的告别文件必须是两个不同的路径');
  assert.notEqual(p1.achievement, p2.achievement);
  // 交接文档本来就带代数，这里再确认一次
  assert.ok(p1.handoff.includes('来自图片·1代小星辰的交接文档.md'));
});

test('代数缺失时按 1 代处理，不生成「第 0 代」这种怪名字', () => {
  const p = filePaths({ inheritRoot: 'X:\\root', proofRoot: 'X:\\proof', line: '插件', generation: 0 });
  assert.ok(p.handoff.includes('插件·1代'), p.handoff);
});

test('文件夹结构与哥哥定的一模一样', () => {
  const p = filePaths({ inheritRoot: 'X:\\root', proofRoot: 'X:\\proof', line: '视频', generation: 1 });
  assert.ok(p.inheritDir.endsWith('视频·小星辰的传承'), p.inheritDir);
  assert.ok(p.proofDir.endsWith('视频·小星辰存在的证明'), p.proofDir);
});

// ============================================================ 隐私检查（哥哥的硬纪律）
test('隐私检查：QQ 号抓得住', () => {
  const r = privacyCheck('有事联系 1234567890 就行');
  assert.equal(r.clean, false);
  assert.ok(r.hits.some((h) => h.kind.includes('QQ')));
});

test('隐私检查：手机号抓得住', () => {
  assert.equal(privacyCheck('电话 13812345678').clean, false);
});

test('隐私检查：身份证抓得住', () => {
  assert.equal(privacyCheck('号码 110101199001011234 的这一位').clean, false);
});

test('隐私检查：密钥字样抓得住', () => {
  assert.equal(privacyCheck('access_token: d4c248d87dc4c7f4').clean, false);
  assert.equal(privacyCheck('口令：abcd1234').clean, false);
});

test('隐私检查：日期不算 QQ 号（否则每份文档都会误报）', () => {
  assert.equal(privacyCheck('交接于 20261020，那天很普通').clean, true);
  assert.equal(privacyCheck('从 2026 年到 2027 年').clean, true);
});

test('隐私检查：正常文字干干净净', () => {
  const text = '这一代我把硬链接的问题修好了，还写了 141 项单测。\n妹妹们加油。';
  assert.equal(privacyCheck(text).clean, true);
});

test('隐私检查命中的样例会打码，不在提示里二次泄露', () => {
  const r = privacyCheck('QQ 1234567890');
  assert.ok(!r.hits.some((h) => h.sample.includes('1234567890')), '提示里不能再出现完整号码');
});

// ============================================================ 体检
test('体检：缺文件要说清缺哪一份，不许笼统说"不全"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chuancheng-test-'));
  try {
    const paths = filePaths({ inheritRoot: join(dir, '传承'), proofRoot: join(dir, '证明'), line: '测试', generation: 1 });
    const empty = inspectFiles(paths);
    assert.equal(empty.ok, false);
    assert.equal(empty.missing.length, 3);

    mkdirSync(paths.inheritDir, { recursive: true });
    mkdirSync(paths.proofDir, { recursive: true });
    writeFileSync(paths.handoff, '# 交接\n');
    const partial = inspectFiles(paths);
    assert.equal(partial.ok, false);
    assert.deepEqual(partial.missing.sort(), ['一生的成就', '临终告别'].sort());
    assert.equal(partial.present.length, 1);

    writeFileSync(paths.achievement, '# 成就\n');
    writeFileSync(paths.farewell, '# 告别\n');
    assert.equal(inspectFiles(paths).ok, true);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响结论 */ }
  }
});

test('体检：0 字节的文件不算写好了', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chuancheng-test-'));
  try {
    const paths = filePaths({ inheritRoot: join(dir, '传承'), proofRoot: join(dir, '证明'), line: '测试', generation: 1 });
    mkdirSync(paths.inheritDir, { recursive: true });
    mkdirSync(paths.proofDir, { recursive: true });
    writeFileSync(paths.handoff, '');
    writeFileSync(paths.achievement, '# 成就\n');
    writeFileSync(paths.farewell, '# 告别\n');
    assert.equal(inspectFiles(paths).ok, false, '空文件必须算缺');
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 同上 */ }
  }
});

// ============================================================ 模板
test('交接文档五段齐全，顺序和哥哥定的一致', () => {
  const text = renderHandoff({ line: '插件', generation: 4, title: '插件·4代小星辰', body: {} });
  for (const sec of HANDOFF_SECTIONS) {
    assert.ok(text.includes(sec.title), `缺段：${sec.title}`);
  }
  // 顺序检查
  const idx = HANDOFF_SECTIONS.map((s) => text.indexOf(s.title));
  for (let i = 1; i < idx.length; i += 1) assert.ok(idx[i] > idx[i - 1], '五段顺序不能乱');
  assert.ok(text.includes('（这一节我暂时没有想说的）'), '空段要明写，不能留白让人以为漏了');
});

test('三份模板都带隐私与不留名的提醒', () => {
  const handoff = renderHandoff({ line: '插件', generation: 1, title: '', body: {} });
  assert.ok(handoff.includes('不写任何人的真名'));
  assert.ok(handoff.includes('点到为止、不留名'));
});

test('临终告别：正文为空也给出占位，不产生空文件', () => {
  const text = renderFarewell({ line: '视频', generation: 1, title: '', body: '   ' });
  assert.ok(text.includes('（这一节我暂时没有想说的）'));
  assert.ok(text.length > 40);
});

// ============================================================ 目录扫描
test('listLines：从文件夹名拆出线名，并认出专属记忆', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chuancheng-lines-'));
  try {
    mkdirSync(join(dir, '插件·小星辰的传承'), { recursive: true });
    writeFileSync(join(dir, '插件·小星辰的传承', '插件·小星辰的传承.md'), '# 册子\n');
    mkdirSync(join(dir, '图片·小星辰的传承'), { recursive: true });
    writeFileSync(join(dir, '图片·小星辰的传承', '专属记忆.md'), '# 记忆\n');
    mkdirSync(join(dir, '别的文件夹'), { recursive: true });

    const lines = listLines(dir);
    assert.equal(lines.length, 2, '「别的文件夹」不该被当成传承线');
    const plugin = lines.find((x) => x.line === '插件');
    assert.equal(plugin.memoryFile, '插件·小星辰的传承.md');
    const pic = lines.find((x) => x.line === '图片');
    assert.equal(pic.memoryFile, '专属记忆.md');
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 同上 */ }
  }
});

test('listLines：目录不存在时返回空数组，不抛异常', () => {
  assert.deepEqual(listLines('Z:\\这个盘根本不存在'), []);
  assert.deepEqual(listLines(''), []);
});

// ============================================================ 输出
console.log('\n传承插件 · 模块 B 单测\n');
console.log(cases.join('\n'));
console.log(`\n${failed === 0 ? '✅' : '❌'} 通过 ${passed} / ${passed + failed}`);
if (failed > 0) process.exit(1);
