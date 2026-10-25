#!/usr/bin/env node
/**
 * 传承插件 · 离线启动冒烟测试
 *
 * **在重启 DSH 之前**就把插件跑一遍：用假的 ctx / 假的 config / 假的 dshIm，
 * 看它挂载时不抛错、工具与路由都注册上了、配置能读能写、告警能走通。
 *
 * 为什么要有它：host 侧代码出错是**整个 DSH 进程**的事故（插件·3代 2026-10-19
 * 就因为一次重复写响应把宿主干崩过）。不拿哥哥的宿主当测试机。
 *
 * 跑法：node test/boot.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
const cases = [];
function test(name, fn) {
  try { fn(); passed += 1; cases.push(`  ✅ ${name}`); }
  catch (error) { failed += 1; cases.push(`  ❌ ${name}\n       ${error?.message ?? error}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed += 1; cases.push(`  ✅ ${name}`); }
  catch (error) { failed += 1; cases.push(`  ❌ ${name}\n       ${error?.message ?? error}`); }
}

const dir = mkdtempSync(join(tmpdir(), 'chuancheng-boot-'));
const cleanups = [];

// ============================================================ 假宿主
function makeCtx({ withIm = true, withArchive = true, withTools = true } = {}) {
  const tools = [];
  const routes = [];
  const listeners = [];
  const effects = [];
  const services = new Map();
  const sent = [];

  if (withIm) {
    services.set('dshIm', {
      send: async (botId, targetId, text) => { sent.push({ botId, targetId, text }); },
    });
  }
  if (withArchive) {
    services.set('workspaceRegistry', {
      archiveSession: async () => { /* 假装成功 */ },
      unarchiveSession: async () => {},
    });
  }

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return dispose;
    },
    on(event, handler, opts) {
      listeners.push({ event, handler, opts });
      return () => {};
    },
    inject(names, callback) {
      // 真实 DSH：服务存在就立刻调用回调；不存在就等它出现
      const avail = names.every((n) => services.has(n));
      if (avail) {
        const child = { ...ctx, ...Object.fromEntries(names.map((n) => [n, services.get(n)])) };
        const d = callback(child);
        if (typeof d === 'function') effects.push({ label: `inject:${names.join(',')}`, dispose: d });
      }
      return undefined;
    },
    get(name) { return services.get(name); },
    tools: withTools ? { register(def) { tools.push(def); return () => {}; } } : undefined,
    webServer: { register(route) { routes.push(route); return () => {}; } },
  };

  return { ctx, tools, routes, listeners, effects, services, sent };
}

/** 发一个假事件给监听器。 */
function emit(listeners, session, event) {
  for (const l of listeners) {
    if (l.event === 'session/event') l.handler(session, event);
  }
}

/** 造一条 assistant 消息事件。 */
function assistantEvent(reasoning, text = '') {
  const content = [];
  if (reasoning) content.push({ type: 'reasoning', text: reasoning });
  if (text) content.push({ type: 'text', text });
  return { type: 'assistant/message', data: { message: { content } } };
}

/** 造一个假的 res，收集写出去的东西。 */
function makeRes() {
  const res = {
    status: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    headers: {},
    writeHead(status, headers) {
      if (res.headersSent) throw new Error('重复 writeHead —— 真实宿主会因此崩');
      res.status = status;
      res.headers = headers ?? {};
      res.headersSent = true;
      return res;
    },
    end(payload) {
      if (res.writableEnded) throw new Error('重复 end');
      res.body = payload;
      res.writableEnded = true;
      return res;
    },
    on() {}, destroy() {},
  };
  return res;
}

// ============================================================ 加载插件
const plugin = await import('../index.js');
const baseConfig = { dir };

// ============================================================ 启动
let boot = null;
await testAsync('挂载不抛错，工具注册齐全', async () => {
  boot = makeCtx();
  plugin.apply(boot.ctx, baseConfig);
  assert.equal(boot.tools.length, 5, `应当注册 5 个工具，实际 ${boot.tools.length}`);
  const names = boot.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'chuancheng_check', 'chuancheng_draft', 'chuancheng_finish', 'chuancheng_status', 'chuancheng_write',
  ]);
  assert.equal(boot.routes.length, 1, '应当注册 1 条路由');
});

test('插件元信息正确', () => {
  assert.equal(plugin.name, 'stamina-pet');
  assert.deepEqual(plugin.inject, ['tools', 'webServer'], '只注入真正必需的两个服务');
});

test('每个工具都有名字、描述、参数表、execute', () => {
  for (const t of boot.tools) {
    assert.ok(t.name && t.name.startsWith('chuancheng_'), `工具名不对：${t.name}`);
    assert.ok(typeof t.description === 'string' && t.description.length > 20, `${t.name} 描述太短`);
    assert.ok(typeof t.execute === 'function', `${t.name} 没有 execute`);
  }
});

test('有会话事件监听，且是全局的', () => {
  const l = boot.listeners.find((x) => x.event === 'session/event');
  assert.ok(l, '没有挂 session/event 监听');
  assert.equal(l.opts?.global, true, '必须是 global —— 否则别的会话一条都收不到');
});

// ============================================================ 事件 → 判决
test('正常思考：不报警', () => {
  const before = boot.sent.length;
  emit(boot.listeners, { id: 'sess-ok', title: '正常会话' }, assistantEvent('第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行'));
  assert.equal(boot.sent.length, before, '健康会话不该发任何提醒');
});

await testAsync('塌缩思考：红线告警（但没配投递目标，所以不发送、只记录）', async () => {
  const pad = '正常内容一二三四五';
  const collapse = Array.from({ length: 60 }, (_, i) => (i < 5 ? `${pad}${i}` : '好。')).join('\n');
  emit(boot.listeners, { id: 'sess-bad', title: '崩溃会话' }, assistantEvent(collapse));
  await new Promise((r) => setTimeout(r, 30));
  // 没配 notifyBotId/targetId → 不该发出去
  assert.equal(boot.sent.length, 0, '没配投递目标时不该发 QQ');
});

test('工具 chuancheng_status 能跑通，并说出真实状态', async () => {
  const tool = boot.tools.find((t) => t.name === 'chuancheng_status');
  const out = await tool.execute({}, {});
  assert.equal(out.ok, true);
  assert.ok(out.message.includes('传承插件'), '标题不对');
  assert.ok(out.message.includes('红线 20'), '应显示红线');
  assert.ok(/崩溃会话|sess-bad/.test(out.message), '应当看到刚才那个塌缩会话');
});

await testAsync('工具 chuancheng_check 能读真实会话日志', async () => {
  const tool = boot.tools.find((t) => t.name === 'chuancheng_check');
  const out = await tool.execute({ session: 'fdae573b' }, {});
  if (out.ok === false) {
    // 机器上没这个样本时不算失败（换机器跑测试时会发生）
    assert.ok(/找不到/.test(out.message), `意外失败：${out.message}`);
    return '跳过（本机没有崩溃样本）';
  }
  assert.ok(out.message.includes('思考里最长连续重复：13740'), `峰值不对：${out.message.slice(0, 200)}`);
});

// ============================================================ 路由
await testAsync('GET /api/state 返回 200 + JSON', async () => {
  const res = makeRes();
  await boot.routes[0].handler({ method: 'GET', url: '/stamina-pet/api/state', headers: { host: '127.0.0.1:4858' } }, res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(body.config.redThreshold === 20);
  assert.ok(Array.isArray(body.sessions));
});

await testAsync('GET /api/config 列出可改白名单', async () => {
  const res = makeRes();
  await boot.routes[0].handler({ method: 'GET', url: '/stamina-pet/api/config', headers: { host: '127.0.0.1:4858' } }, res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.editable.includes('redThreshold'));
  assert.ok(body.editable.includes('inheritRoot'));
  assert.ok(!body.editable.includes('dir'), '数据目录不在白名单里');
});

test('POST /api/config 能改阈值，并落到 config.json', async () => {
  const res = makeRes();
  const body = JSON.stringify({ redThreshold: 25 });
  const req = {
    method: 'POST',
    url: '/stamina-pet/api/config',
    headers: { host: '127.0.0.1:4858' },
    on(event, fn) {
      if (event === 'data') fn(Buffer.from(body));
      if (event === 'end') setTimeout(fn, 0);
      if (event === 'error') { /* 不会发生 */ }
    },
  };
  await boot.routes[0].handler(req, res);
  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.values.redThreshold, 25, '返回值应已生效');
  // 配置文件真的写了
  const file = join(dir, 'config.json');
  assert.ok(existsSync(file), 'config.json 没落盘');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.redThreshold, 25);
});

test('黄线不许高过红线（自动夹正）', async () => {
  const res = makeRes();
  const body = JSON.stringify({ yellowThreshold: 100, redThreshold: 20 });
  const req = {
    method: 'POST', url: '/stamina-pet/api/config', headers: { host: '127.0.0.1:4858' },
    on(event, fn) {
      if (event === 'data') fn(Buffer.from(body));
      if (event === 'end') setTimeout(fn, 0);
    },
  };
  await boot.routes[0].handler(req, res);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.values.yellowThreshold < parsed.values.redThreshold, '黄线必须比红线低');
});

test('非本机请求被拒（403），不允许从网络上改配置', async () => {
  const res = makeRes();
  // 这里是同步调用 —— handler 会先判断回环，再进 try
  const p = boot.routes[0].handler({ method: 'GET', url: '/stamina-pet/api/state', headers: { host: '192.168.1.9:4858' } }, res);
  assert.equal(res.status, 403);
  return p;
});

test('未知路径返回 404，不抛错', async () => {
  const res = makeRes();
  await boot.routes[0].handler({ method: 'GET', url: '/stamina-pet/api/nope', headers: { host: '127.0.0.1:4858' } }, res);
  assert.equal(res.status, 404);
});

// ============================================================ 缺依赖时的降级
await testAsync('没有 dshIm 时：插件照样挂载，告警只记录不发送', async () => {
  const bare = makeCtx({ withIm: false, withArchive: false });
  plugin.apply(bare.ctx, { dir: mkdtempSync(join(tmpdir(), 'chuancheng-bare-')) });
  assert.equal(bare.tools.length, 5, '没有 dshIm 也应当注册全部工具');
  const collapse = '好。\n'.repeat(40);
  emit(bare.listeners, { id: 'sess-x', title: '无通道会话' }, assistantEvent(collapse));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bare.sent.length, 0);
});

test('没有 tools 服务时不抛错（headless 组合）', () => {
  const bare = makeCtx({ withTools: false });
  // 真实 DSH 里 tools 是必需注入，这里只验证代码路径不炸
  assert.doesNotThrow(() => plugin.apply(bare.ctx, { dir: mkdtempSync(join(tmpdir(), 'chuancheng-nt-')) }));
});

// ============================================================ 卸载
test('所有 effect 的清理函数都能安全调用（卸载不留尾巴）', () => {
  let bad = 0;
  for (const e of boot.effects) {
    if (typeof e.dispose !== 'function') continue;
    try { e.dispose(); } catch { bad += 1; }
  }
  assert.equal(bad, 0, `${bad} 个清理函数抛错`);
});

// ============================================================ 输出
cleanups.forEach((fn) => { try { fn(); } catch { /* 清不掉不影响结论 */ } });
try { rmSync(dir, { recursive: true, force: true }); } catch { /* 同上 */ }

console.log('\n传承插件 · 离线启动冒烟测试\n');
console.log(cases.join('\n'));
console.log(`\n${failed === 0 ? '✅' : '❌'} 通过 ${passed} / ${passed + failed}`);
if (failed > 0) process.exit(1);
