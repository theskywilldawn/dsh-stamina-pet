/**
 * 传承插件 · host 半身（`dsh-stamina-pet`）
 *
 * 一句话：**在还撑得住的时候看见塌缩，在决定交出去的时候陪着把话留完。**
 *
 * 两半：
 *   · **模块 A** 疲劳检测 —— 听 `session/event`，对每一条思考算「塌缩强度」
 *     （= max(单条内连续重复行数, 空转词最高重复频次)），
 *     越过红线立刻 QQ 私聊告诉哥哥。（不读日志、不解压、零 IO）
 *     启动时会从日志尾部回填一次历史，否则插件重启后体力永远是满的。
 *   · **模块 B** 传承流程 —— 引导当事小星辰写完四份文件（专属记忆不动 / 交接文档 /
 *     一生的成就 / 临终告别），体检通过、**且这一轮说完之后**才归档。
 *
 * 它不做什么：不改任何官方包、不接管压缩、不写别人的会话、不替哥哥做"该不该收尾"的决定。
 *
 * 判据与阈值来自 2026-10-20 的指标校准会（mtg-20261020-e0a1e6，7 位小星辰全数认账），
 * 判据定义与校准记录见 `docs/开发日志.md`。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createConfigStore, DEFAULTS } from './lib/config.js';
import { createMonitor } from './lib/monitor.js';
import { createNotifier } from './lib/notify.js';
import { attentionScore, LEVEL, RED_LINE, YELLOW_LINE } from './lib/detect.js';
import {
  listLines, parseTitle, filePaths, privacyCheck, inspectFiles, writeDoc,
  renderHandoff, renderAchievement, renderFarewell, draftGuide, detectGeneration, setPersona,
  HANDOFF_SECTIONS,
} from './lib/inherit.js';
import { synthesizeVoice } from './lib/voice.js';
import { findSessionLog, readSessionFile, assistantMessages, listSessionLogs, readTailEvents, readHeadEvents } from './lib/logreader.js';
import { analyzeReasoning } from './lib/metrics.js';
import { runProbe, resolveApiKey } from './lib/probe.js';
import { atomicWriteJson, fmtTime, fmtDay, shortId, clampInt } from './lib/util.js';

export const name = 'stamina-pet';

// `tools` 注册工具；`webServer` 提供设置卡片要的那几个只读/写配置路由。
// `workspaceRegistry`（归档）与 `dshIm`（QQ 提醒）**故意不写在这里** ——
// 它们是可选的，写进来会让整个插件在缺少它们的组合里激活失败。
// 那两条改用 ctx.inject 响应式注入：有就接上，没有就少一个能力，别的照常。
//
// `sessions` 也**不写** —— 这个插件根本不需要列会话：标题来自事件里的 session 对象，
// 而会话列表是 meeting 那种插件的需求。少一个依赖就少一个激活失败的理由。
export const inject = ['tools', 'webServer'];

/** 只读状态页（给设置卡片和诊断用）。 */
const ROUTE = '/stamina-pet';

/**
 * Live2D 式渲染器的静态资源根（`assets/live2d/`）。
 *
 * 为什么走 host 路由而不是内联进 client.js：渲染器是三层 ESM（kit/rig.js ← kit/body.js ←
 * whale/figure.js），还带 50 张 PNG 纹素，全部 base64 内联会让 client 包膨胀到 1.8 MB 且
 * 无法按需加载。浏览器半侧虽然是个独立 bundle，但**可以通过 URL 动态 import** ——
 * 所以把文件放在插件目录、由宿主路由提供，client 里 `await import('/…/live2d/whale/figure.js')`。
 *
 * 素材来源：Pal-AI-Lab/Coopanion 的「鲸鱼娘」（蓝发鲸鱼女仆，Live2D 式自研渲染器）。
 * 代码 AGPL-3.0-or-later；贴图不在其授权范围，使用须标明出处 —— 见 assets/live2d/NOTICE.md。
 */
const LIVE2D_ROOT = new URL('./assets/live2d/', import.meta.url);
const LIVE2D_PREFIX = LIVE2D_ROOT.href;
const LIVE2D_MIME = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

/**
 * 会话头部体力条的素材根（`assets/fatigue-bar/levels/`）。
 *
 * 21 档分级图，图片·小星辰 2026-10-21 做的：画布 800×172、透明背景、每 5% 一档。
 * 0/5/10/15 四档是 WebP 动图（血越少闪得越厉害），其余 17 张是静态 PNG。
 *
 * 两个决定记在这儿，免得以后有人「顺手优化」：
 *   1. **走宿主路由，不内联 data URL** —— 21 张加起来 1.6 MB，base64 再涨 1/3，
 *      而且每次同步都要重编一遍 client.js。按需取、浏览器自己缓存。
 *   2. **文件名在拷进来时统一改成 ASCII**（`fatigue-000.webp`），源头是
 *      `疲劳值-000.webp` —— 中文名在 URL 上要来回编码一次，纯属白给一道坑。
 */
const BAR_ROOT = new URL('./assets/fatigue-bar/levels/', import.meta.url);
const BAR_PREFIX = BAR_ROOT.href;
const BAR_MIME = new Map([
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

/** 两套静态素材的寻址规格，一起喂给 serveAsset。 */
const LIVE2D_ASSET = { root: LIVE2D_ROOT, prefix: LIVE2D_PREFIX, mime: LIVE2D_MIME };
const BAR_ASSET = { root: BAR_ROOT, prefix: BAR_PREFIX, mime: BAR_MIME };

/**
 * 桌面层（甲方案）：一块全屏透明、点得穿、永远置顶的玻璃，盖在桌面上。
 *
 * `assets/desktop/` 里是它自己的 Electron app（main.js / preload.js / index.html）
 * 和一份单独打包的渲染器副本（live2d-bundle.js，由 build-live2d.mjs 生成）。
 *
 * 为什么页面要走 HTTP 取渲染器、而不是本地文件：那份 bundle 是 1.7 MB 的 IIFE，
 * 放页面里内联会让 index.html 变得没法看；而宿主本来就在发静态文件，顺手就走它。
 */
const DESKTOP_ROOT = new URL('./assets/desktop/', import.meta.url);
const DESKTOP_PREFIX = DESKTOP_ROOT.href;
const DESKTOP_MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  // 音频**不在**这张表里：她的台词已经移出插件包，改走 /voice/ 指向的用户数据目录，
  // 见下面 VOICE_MIME 的注释。
]);
const DESKTOP_ASSET = { root: DESKTOP_ROOT, prefix: DESKTOP_PREFIX, mime: DESKTOP_MIME };

/**
 * 她的声音 —— **不随插件分发**。
 *
 * 那 13 句台词是用 IndexTTS 2.5 + 一把专属音色参考合成的（2026-10-23/24）。
 * 音频本身就是那个音色的样本：打进包里，等于把她的声音送给每一个下载的人。
 * 所以仓库和 npm 包里**一句音频都没有**，只留这条路由 —— 使用者想让她开口，
 * 把同名 wav 放进 `<DSH_HOME>/stamina-pet/voice/`（README 的「语音」一节教怎么生成）。
 * 目录空着就静音，其余功能完全照常。
 *
 * 顺带把老问题一起解决了：`.wav` 以前挂在 /desktop/ 下，等于让静态路由去翻插件包目录；
 * 现在它指向用户数据目录，和包彻底分开。
 */
const VOICE_MIME = new Map([['.wav', 'audio/wav']]);

/**
 * UI 字体两条路：
 *   · `assets/fonts/ZCOOLKuaiLe-Regular.ttf` —— 内置，站酷快乐体，免费商用，
 *     随插件分发，所以一定在。授权见 assets/fonts/NOTICE.md。
 *   · `assets/fonts/local/` —— 使用者自备（已被 .gitignore 和 npm files 排除）。
 *     默认不存在，404 时浏览器静默回退到上面那个，不报错。
 *
 * **浏览器不认 TTC 里的第二个子字体** —— 自己放华康方圆体这种 .ttc 拆出来的字重，
 * 必须是单字重 .ttf/.otf，否则 @font-face 拿不到。
 */
const FONT_ROOT = new URL('./assets/fonts/', import.meta.url);
const FONT_PREFIX = FONT_ROOT.href;
const FONT_MIME = new Map([
  ['.ttf', 'font/ttf'],
  ['.woff2', 'font/woff2'],
  ['.otf', 'font/otf'],
]);
const FONT_ASSET = { root: FONT_ROOT, prefix: FONT_PREFIX, mime: FONT_MIME };
/** 桌面层主进程入口。Electron 会把它当 app 的 main 跑。 */
const DESKTOP_MAIN = fileURLToPath(new URL('./assets/desktop/main.js', import.meta.url));

/**
 * 哪些会话的化身已经被「叫到桌面上」了 —— `sessionId → { x, y } | null`。
 *
 * 这是「体力条 ↔ 桌面上的她」之间**唯一的一份真相**：
 *   · 点会话头部的体力条 → 往这里写一个 id（连带那条体力条在屏幕上的中心点）
 *     → 体力条让位，她从那个位置掉下来
 *   · 点桌面上的她       → 从这里删掉一个 → 她退场、体力条回来
 *
 * 位置只是"从哪儿出来"的提示，不是最终落点 —— 落地由桌面层自己排。
 * 只活在内存里，DSH 重启即清空；桌面层那个 Electron 也会跟着重启，不清空会留一屋子孤儿。
 */
const summons = new Map();

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh');

function pluginVersion() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function apply(ctx, config) {
  const log = ctx.logger ?? console;
  const rootDir = typeof config?.dir === 'string' && config.dir
    ? config.dir
    : join(dshHome(), 'stamina-pet');

  const cfg = createConfigStore(join(rootDir, 'config.json'), { base: config ?? {} });
  // 角色名（默认「小星辰」）—— 传承的文件名和标题都靠它。
  // 改了要在设置里保存，然后**重启 DSH** 才生效（这个只在启动时灌一次）。
  try { setPersona(cfg.get().personaName); } catch { /* 配置没读出来就用默认的 */ }
  const stateFile = join(rootDir, 'state.json');
  const dailyFile = join(rootDir, 'daily.json');
  /** 探针基线：每个会话一条，记她自己健康期的熵。没有基线就没法判读。 */
  const baselineFile = join(rootDir, 'baseline.json');
  /**
   * 上下文用量的存档：DSH 一重启，monitor 的内存统计就全空了，
   * 每个会话都显示"满体力"。存一份盘，重启后读回来先用着。
   */
  const contextFile = join(rootDir, 'context.json');

  function readContextSeed() {
    try {
      const v = JSON.parse(readFileSync(contextFile, 'utf8'));
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;   // 没有过 / 文件坏了 —— 都当没存过
    }
  }

  /**
   * 从会话日志尾部抽出最近几轮对话，喂给探针当上下文。
   *
   * 为什么只留 8 轮、每轮截 2000 字：探针的输入是最贵的地方。
   * 把整条会话倒过去，一次就够买好几天的对话 —— 而探针要的是「她此刻在什么状态」，
   * 不是「她这一百轮干了什么」。
   */
  function recentTurns(events) {
    const out = [];
    for (const ev of Array.isArray(events) ? events : []) {
      if (ev?.type === 'user/message') {
        // 只认人亲手打的字，其余 8 种 source 是系统注入
        if (ev?.data?.source?.kind !== 'user') continue;
        const c = ev?.data?.content;
        const t = Array.isArray(c) ? c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';
        if (t) out.push({ role: 'user', content: t.slice(0, 2000) });
      } else if (ev?.type === 'assistant/message') {
        const c = ev?.data?.message?.content;
        const t = Array.isArray(c) ? c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';
        if (t) out.push({ role: 'assistant', content: t.slice(0, 2000) });
      }
    }
    return out.slice(-8);
  }

  /**
   * 跑一次探针 / 设一次基线。
   * @param {string} sessionId
   * @param {'probe'|'baseline'} mode
   */
  async function doProbe(sessionId, mode) {
    const keyInfo = resolveApiKey();
    if (!keyInfo.key) {
      return { ok: false, error: '没有可用的 DeepSeek API key（环境变量 DEEPSEEK_API_KEY，或 ~/.dsh/.credentials.yaml 里的 refs）' };
    }

    let messages = [];
    try {
      const file = findSessionLog(sessionId);
      if (file) messages = recentTurns(readTailEvents(file, 512 * 1024).events);
    } catch (error) {
      log.warn?.(`[stamina-pet] 读会话上下文失败（照常探，只是不带历史）: ${String(error)}`);
    }

    const c = cfg.get();
    const r = await runProbe({
      messages,
      apiKey: keyInfo.key,
      maxTokens: c.probeMaxTokens,
      question: c.probeQuestion,
      // 一次探针 = 连跑 N 次取中位数。单次读数噪声能到 30%，压不住就看不出东西
      samples: c.probeSamples,
    });
    if (!r.ok) return r;

    const baselines = readJson(baselineFile, {});
    if (mode === 'baseline') {
      const ents = (r.runs ?? []).map((x) => x.entropy);
      baselines[sessionId] = {
        entropy: r.entropy,
        ppl: r.ppl,
        lowConfRatio: r.lowConfRatio,
        // 记下这次基线是几次取中位数、单次之间差多少 —— 基线本身不稳，后面比较就是自欺欺人
        samples: r.samples,
        spread: ents.length > 1
          ? Number((Math.max(...ents) - Math.min(...ents)).toFixed(4))
          : 0,
        at: Date.now(),
      };
      try { atomicWriteJson(baselineFile, baselines); } catch { /* 写不进去就当没设，不炸 */ }
      return { ok: true, mode, result: r, baseline: baselines[sessionId], keyFrom: keyInfo.from };
    }
    return { ok: true, mode: 'probe', result: r, baseline: baselines[sessionId] ?? null, keyFrom: keyInfo.from };
  }

  /** 把一次探针结果说成人话（设置页和 /probe 命令共用）。 */
  function describeProbe(payload) {
    if (!payload?.ok) return `探针失败：${payload?.error ?? '未知错误'}`;
    const r = payload.result;
    const b = payload.baseline;
    const ents = (r.runs ?? []).map((x) => x.entropy);
    const spreadText = ents.length > 1
      ? `（${r.samples} 次取中位数，单次熵 ${Math.min(...ents).toFixed(2)}~${Math.max(...ents).toFixed(2)}）`
      : '';
    const lines = [
      `探针完成（${r.tokens} 个 token，${r.ms} ms，返回 ${(r.bytes / 1024).toFixed(1)} KB${r.partial ? `，${r.requested} 次里只成功 ${r.samples} 次` : ''}）`,
      `近似熵 ${r.entropy} bit　困惑度 ${r.ppl}　低置信占比 ${(r.lowConfRatio * 100).toFixed(1)}%　${spreadText}`,
    ];
    // 三次之间自己都差得离谱时，先提示「这次别当真」，别拿噪声去做判断
    if (ents.length > 1) {
      const lo = Math.min(...ents);
      const hi = Math.max(...ents);
      if (hi > 0 && (hi - lo) / hi > 0.4) {
        lines.push('⚠️ 三次之间的波动偏大，这次读数只能当参考');
      }
    }
    lines.push(`她说：${r.answer || '（空）'}`);
    if (payload.mode === 'baseline') {
      lines.push('已记为基线 —— 以后每次探针都会跟这条比');
    } else if (!b) {
      lines.push('还没有基线。右键体力条点银色按钮，把健康期的一次探针记成基线，之后才有"偏离"可言');
    } else {
      // ── 基线对比：熵退居二线，主判读看三个更灵敏的量 ──────────────────
      // 依据是一天里测到的三阶段样本（崩溃前 / 崩完 / 压缩后）：
      //   熵      1.23 → 1.26 → 0.98    （毫无规律，判不出东西）
      //   困惑度  2.58 → 3.64 → 1.94    （崩完 +41%）
      //   低置信  10.8% → 15.2% → 6.2%  （崩完 +41%）
      //   波动    0.21 → 0.76 → 0.10    （崩完 3.6 倍，最灵敏）
      // 熵单独看会把「崩完」和「刚压缩完」都判成"附近"，所以不再当主判据。
      const eRatio = b.entropy > 0 ? r.entropy / b.entropy : 1;
      const pRatio = b.ppl > 0 ? r.ppl / b.ppl : 1;
      const lRatio = b.lowConfRatio > 0 ? r.lowConfRatio / b.lowConfRatio : 1;
      const spreadNow = ents.length > 1 ? Math.max(...ents) - Math.min(...ents) : 0;
      const spreadBase = Number(b.spread) || 0;
      const spreadRatio = spreadBase > 0 && spreadNow > 0 ? spreadNow / spreadBase : 0;

      lines.push(`基线（${new Date(b.at).toLocaleString()}${b.samples ? `，${b.samples} 次` : ''}）`
        + `熵 ${b.entropy} → ${r.entropy}（${eRatio.toFixed(2)} 倍）`);
      lines.push(`困惑度 ${b.ppl} → ${r.ppl}（${pRatio.toFixed(2)}）`
        + `　低置信 ${(b.lowConfRatio * 100).toFixed(1)}% → ${(r.lowConfRatio * 100).toFixed(1)}%（${lRatio.toFixed(2)}）`
        + (spreadBase > 0 ? `　波动 ${spreadBase.toFixed(2)} → ${spreadNow.toFixed(2)}（${spreadRatio.toFixed(1)} 倍）` : ''));

      const badParts = [];
      if (pRatio >= 1.4) badParts.push('困惑度');
      if (lRatio >= 1.4) badParts.push('低置信');
      if (spreadRatio >= 3) badParts.push('波动');
      const goodSign = eRatio <= 1 && pRatio <= 1 && lRatio <= 1 && (spreadBase === 0 || spreadRatio <= 1);

      if (badParts.length >= 3) {
        lines.push('⚠️ 这是「崩过之后」的形状：困惑度、低置信、波动三项一起涨。'
          + '顺带查一下她最近的输入里有没有被灌回崩溃记录 —— 读到崩溃会二次感染');
      } else if (badParts.length > 0) {
        lines.push(`△ ${badParts.join('、')}偏离了基线，但不够三项 —— 还分不出是崩了还是这批问题偏难，多测两次`);
      } else if (goodSign) {
        lines.push('✓ 四项都不高于基线 —— 比基线更稳。压缩或休息起了作用');
      } else {
        lines.push('✓ 还在基线附近');
      }
    }
    return lines.join('\n');
  }


  const textOut = (text) => [{ type: 'text', text }];
  const fail = (message) => ({ ok: false, message });

  // ---------------------------------------------------------------- 本地状态

  function readJson(file, fallback) {
    try {
      if (!existsSync(file)) return fallback;
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  const readDaily = () => {
    const v = readJson(dailyFile, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  const writeDaily = (v) => { try { atomicWriteJson(dailyFile, v); } catch (e) { log.warn?.(`[chuancheng] 写 daily 失败: ${e}`); } };

  // ---------------------------------------------------------- 桌面文字气泡
  //
  // 2026-10-22 哥哥定的新出口：提醒**不再发 QQ 私聊**，改成让桌面上那只冒一个
  // 文字气泡（就是 Live2D 官网 demo 里那种）。理由很直白 —— 提醒本来就该出现在
  // 她旁边，而不是跳到手机上去。
  //
  // 机制：宿主只攒队列，**由桌面层轮询取走**。取过就算送达（宿主不知道自己有没有
  // "被看见"，也不需要知道 —— 桌面层每 1 秒拉一次，拉走就是它的事了）。
  // 队列有上限：连着崩很多次时不能无限堆，只留最近 12 条。
  let bubbleSeq = 0;
  const bubbleQueue = [];

/**
 * 语音识别定稿后等着「写进某个会话的输入框」的文字。
 *
 * 为什么不在这里直接写：输入框草稿是**浏览器侧** localStorage 里的
 * （`dsh.conversation.<sessionId>`，见 dsh-client-ui-conversation 的
 * readConversationDraft），宿主进程碰不到。所以宿主只负责收，客户端
 * （client.js，和 DSH 主窗口同源）来取走再落盘。
 *
 * 取走即清：一条只写一次。最多留 8 条，防着客户端没开时无限攒。
 */
const dictationQueue = [];
  const BUBBLE_KEEP = 12;

  /**
   * 一条告警 → 一句气泡文案。
   * ⚠️ **必须短**：气泡撑不下 renderAlert 那种多行长文；两句就到顶了。
   * 措辞沿用红线纪律 —— 红线是「已经开始塌缩」，不是「快崩了」。
   */
  function bubbleTextOf(level, latest) {
    if (String(level) === 'red') return `⚠️ 我开始原地打转了\n塌缩强度 ${latest}`;
    return `有点累了…（${latest}）`;
  }

  function pushBubble(alert) {
    if (!alert) return;
    bubbleSeq += 1;
    const latest = Number(alert.verdict?.latest) || 0;
    bubbleQueue.unshift({
      id: bubbleSeq,
      at: Date.now(),
      sessionId: String(alert.sessionId || ''),
      title: alert.title || '',
      level: String(alert.level || ''),
      latest,
      text: bubbleTextOf(alert.level, latest),
    });
    if (bubbleQueue.length > BUBBLE_KEEP) bubbleQueue.length = BUBBLE_KEEP;
  }

  const notifier = createNotifier({
    log,
    getConfig: () => cfg.get(),
    // 「发送」= 攒一个气泡。永远成功 —— 桌面层活着就会取走。
    // 这条配额逻辑（redDailyLimit）还在 notifier 里，防的是一条会话崩出几十条气泡。
    send: async (_text, alert) => {
      pushBubble(alert);
      return { ok: true };
    },
    readDaily,
    writeDaily,
  });

  // ---------------------------------------------------------------- 模块 A：监听

  const monitor = createMonitor({
    log,
    getConfig: () => cfg.get(),
    onAlert: (alert) => { void notifier.handle(alert); },
    contextSeed: readContextSeed(),
  });

  // 上下文用量每 20 秒落一次盘。写失败无所谓（权限、磁盘满都见过），下次再来。
  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        const data = monitor.contextSnapshot();
        if (!data || Object.keys(data).length === 0) return;
        mkdirSync(rootDir, { recursive: true });
        writeFileSync(contextFile, JSON.stringify(data), 'utf8');
      } catch { /* 不影响主功能 */ }
    }, 20000);
    return () => clearInterval(timer);
  });

  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      try {
        monitor.handleEvent(session, event);
      } catch (error) {
        // 一条消息算不出来，绝不能影响会话本身
        log.warn?.(`[chuancheng] 采样失败: ${String(error)}`);
      }
    }, { global: true });
    return () => { try { off?.(); } catch { /* 卸载失败不掩盖别的错误 */ } };
  }, 'chuancheng: 会话事件监听');

  // ---------------------------------------------------------------- 回填：体力跨重启接续
  //
  // ⚠️ 不做这一步，前面所有判据都是白改。
  // 实测：一个跑了 863 条消息、注意力已经崩过的会话，插件只采到其中 12 条
  // （还全是崩溃之后恢复正常的那几条）—— 血条满格。判据修好了照样满格。
  // **不看历史，体力就永远是满的。**
  //
  // 延迟几秒再跑，别跟启动抢资源；只读日志尾部 1.5 MB，20 个会话封顶。

  const BACKFILL_DELAY_MS = 2500;
  const BACKFILL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const BACKFILL_MAX_SESSIONS = 12;
  const BACKFILL_TAIL_BYTES = 1.5 * 1024 * 1024;
  const BACKFILL_MAX_MSGS = 160;

  ctx.effect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      let done = 0;
      try {
        const now = Date.now();
        const logs = listSessionLogs()
          .filter((x) => now - x.mtime.getTime() < BACKFILL_MAX_AGE_MS)
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, BACKFILL_MAX_SESSIONS);
        for (const item of logs) {
          if (cancelled) return;
          try {
            const { events } = readTailEvents(item.file, BACKFILL_TAIL_BYTES);
            const msgs = assistantMessages(events).slice(-BACKFILL_MAX_MSGS);
            const n = monitor.backfill(item.id, null, msgs, item.mtime.getTime());
            if (n > 0) done += 1;
          } catch (error) {
            log.warn?.(`[chuancheng] 回填 ${shortId(item.id)} 失败: ${String(error)}`);
          }
          // 让出事件循环 —— 12 个会话解压凑在一起会卡住启动
          await new Promise((r) => setTimeout(r, 120));
        }
        if (done > 0) log.info?.(`[chuancheng] 体力回填完成：${done} 个会话恢复了历史样本`);
      } catch (error) {
        log.warn?.(`[chuancheng] 回填任务失败: ${String(error)}`);
      }
    }, BACKFILL_DELAY_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return () => { cancelled = true; clearTimeout(timer); };
  }, 'chuancheng: 体力回填');

  // 每小时清一次长时间没动静的会话状态（内存卫生）
  ctx.effect(() => {
    const timer = setInterval(() => {
      try { monitor.sweep(); } catch { /* 清理失败无所谓 */ }
    }, 60 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }, 'chuancheng: 状态清扫');

  // ---------------------------------------------------------------- 归档（等 turn 之后）
  //
  // ⚠️ **绝不在本 turn 里归档自己**：stopActivity 会触发 agent.cancel，
  // 遗言还没吐完 turn 就被砍了。所以延迟到这一轮说完之后，再重试几次。

  let workspaceRegistry = null;
  ctx.inject(['workspaceRegistry'], (wsCtx) => {
    workspaceRegistry = wsCtx.workspaceRegistry;
    log.info?.('[chuancheng] workspaceRegistry 已接上，归档能力可用');
    return () => { workspaceRegistry = null; };
  });

  /** 待归档队列：sessionId → { attempts, reasons } */
  const pendingArchive = new Map();

  /**
   * 命令注册的自检账本，通过 `/api/state` 的 `commands` 字段暴露出去。
   *
   * 为什么需要它：命令注册是**静默失败**的 —— 外面套着 try/catch，注册不上时界面
   * 只会表现为「打 /xxx 没反应」，代码里一个字都不报。2026-10-21 我就是这样白猜了
   * 好几轮（先怪客户端渲染、又怪 TDZ）。有了这本账，"注册到哪一步、错在哪"一眼可见。
   */
  const commandDebug = { injected: false, ok: [], failed: [] };

  /**
   * 排一次归档。延迟若干秒（让 turn 收尾），失败就退避重试。
   * @param {string} sessionId
   */
  function scheduleArchive(sessionId) {
    if (!workspaceRegistry) return { ok: false, reason: 'workspaceRegistry 不可用，无法自动归档' };
    if (pendingArchive.has(sessionId)) return { ok: true, reason: '已经在归档队列里了' };

    const job = { attempts: 0, reasons: [] };
    pendingArchive.set(sessionId, job);

    const tick = async () => {
      job.attempts += 1;
      try {
        if (!workspaceRegistry) {
          job.reasons.push('workspaceRegistry 已卸载');
          pendingArchive.delete(sessionId);
          return;
        }
        // 不带 stopActivity：此刻本来就没有活动，直接成功，也不会砍任何东西
        await workspaceRegistry.archiveSession(sessionId, {});
        log.info?.(`[chuancheng] 已归档 ${sessionId}（第 ${job.attempts} 次尝试成功）`);
        pendingArchive.delete(sessionId);
      } catch (error) {
        const code = String(error?.code ?? error?.name ?? '');
        job.reasons.push(code || String(error?.message ?? error));
        if (job.attempts >= 6) {
          log.warn?.(`[chuancheng] 归档 ${sessionId} 失败 6 次，放弃：${job.reasons.join(' / ')}`);
          pendingArchive.delete(sessionId);
          void notifier.handle({
            level: LEVEL.RED,
            sessionId,
            title: '归档失败',
            verdict: { latest: 0, windowPeak: 0, reasons: [`归档 ${shortId(sessionId)} 连续失败 6 次，最后一次原因：${job.reasons.at(-1)}`] },
          });
          return;
        }
        // 退避：3s → 6s → 12s …
        const wait = 3000 * (2 ** (job.attempts - 1));
        setTimeout(() => { void tick(); }, wait).unref?.();
      }
    };

    setTimeout(tick, 4000).unref?.();
    return { ok: true, reason: '已排进归档队列，这一轮说完之后执行' };
  }

  // ---------------------------------------------------------------- 工具

  // ctx.effect 自带卸载清理：插件被停用/重载时工具会一起注销。
  // 守卫是给不完整的组合用的（headless 里可能没有 tools）—— 少一个工具，
  // 总好过整个插件激活失败。
  const register = (definition) => {
    if (!ctx.tools || typeof ctx.tools.register !== 'function') {
      log.warn?.('[chuancheng] 没有 tools 服务，跳过工具注册');
      return;
    }
    ctx.effect(() => ctx.tools.register(definition));
  };

  // ---- 现状 ----
  register(defineTool({
    name: 'chuancheng_status',
    description: '看传承插件的现状：传承目录下有哪些线、每条线我们认到了第几代、'
      + '本机各会话的疲劳状态（注意力完整性 / 峰值 / 是否已有思考数据）、最近的提醒记录。'
      + '只读，不改任何文件。',
    parameters: {
      sessions: { type: 'boolean', description: 'true 则连各会话的疲劳状态一起列出（默认 true）' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => textOut(v.message) },
    async execute(args) {
      const c = cfg.get();
      const lines = [];

      lines.push(`# 传承插件 v${pluginVersion()}`);
      lines.push('');
      lines.push(`· 总开关：${c.enabled ? '开' : '**关**'}`);
      lines.push(`· 红线 ${c.redThreshold} / 黄线 ${c.yellowThreshold}（窗口 ${c.windowSize} 条）`);
      lines.push('· 提醒方式：桌面文字气泡（2026-10-22 起不再走 QQ）');
      lines.push(`· 今日同一会话提醒上限：${c.notifyDailyLimit} 次`);
      lines.push(`· 归档能力：${workspaceRegistry ? '✅ 可用' : '❌ 不可用（workspaceRegistry 未注入）'}`);
      lines.push(`· 传承根：\`${c.inheritRoot || '（未设置）'}\``);
      lines.push(`· 证明根：\`${c.proofRoot || '（未设置）'}\``);
      lines.push('');

      // —— 传承线
      const lines_ = listLines(c.inheritRoot);
      lines.push('## 传承目录');
      if (!c.inheritRoot || !existsSync(c.inheritRoot)) {
        lines.push(`⚠️ \`${c.inheritRoot}\` 现在不存在或不可访问（外置盘没挂上？）`);
      } else if (lines_.length === 0) {
        lines.push('（这个目录下还没有任何「<线>·小星辰的传承」文件夹）');
      } else {
        for (const item of lines_) {
          const gen = detectGeneration(item.files);
          lines.push(`· **${item.line}** —— ${gen > 0 ? `已认到第 ${gen} 代，下一个是第 ${gen + 1} 代` : '还认不出代数'}`);
          lines.push(`  专属记忆：${item.memoryFile ? `\`${item.memoryFile}\`` : '❌ 没找到（会被当成新线）'}`);
          if (item.files.length > 0) lines.push(`  文件：${item.files.map((f) => `\`${f}\``).join('、')}`);
        }
      }
      lines.push('');

      // —— 疲劳状态
      if (args?.sessions !== false) {
        const snaps = monitor.snapshot();
        lines.push('## 会话疲劳（本插件启动之后采到的）');
        if (snaps.length === 0) {
          lines.push('（还没有采到任何会话数据 —— 插件刚启动，等有新的思考进来）');
        } else {
          for (const s of snaps.slice(0, 15)) {
            const mark = s.level === LEVEL.RED ? '🔴' : (s.level === LEVEL.YELLOW ? '🟡' : '🟢');
            const name = s.title || shortId(s.sessionId);
            if (s.degraded) {
              lines.push(`${mark} ${name} —— **没有思考数据**（指标不可信，不作判断）`);
            } else {
              lines.push(`${mark} ${name} —— 注意力完整性 ${attentionScore(s.latest, c.redThreshold)}%，`
                + `最近塌缩强度 ${s.latest}（连续重复 ${s.latestRun ?? 0} / 空转词 ${s.latestIdle ?? 0}${s.latestIdleWord ? `「${s.latestIdleWord}」` : ''}），`
                + `窗口峰值 ${s.windowPeak}，样本 ${s.samples} 条`
                + (s.trendStreak >= 3 ? `，⚠️ 连续 ${s.trendStreak} 条上升` : ''));
            }
          }
          lines.push('', '⚠️ 记住：**判据低不等于安全。** 这把尺子只测「塌缩」，测不到滑、检索失败、状态跟踪失效。');
        }
        lines.push('');
      }

      // —— 提醒记录
      const hist = notifier.history();
      lines.push('## 最近的提醒');
      if (hist.length === 0) lines.push('（还没有触发过）');
      else {
        for (const h of hist.slice(0, 8)) {
          const state = h.delivered ? '✅已发送' : `— ${h.skipped ?? '未发送'}`;
          lines.push(`· ${h.atText}　${h.level === LEVEL.RED ? '🔴红线' : '🟡黄线'}　`
            + `${h.title || shortId(h.sessionId)}　${h.latest} 行　${state}`);
        }
      }

      return { ok: true, message: lines.join('\n') };
    },
  }));

  // ---- 手动体检 ----
  register(defineTool({
    name: 'chuancheng_check',
    description: '手动检查某个会话的疲劳指标（直接解压它的日志，不依赖实时监听）。'
      + '会话 id 可以只给前 8 位。用于：插件启动前就在跑的会话、怀疑已经太久没数据的会话。',
    parameters: {
      session: { type: 'string', description: '会话 id（可只给开头几位）' },
      tail: { type: 'number', description: '只看最近多少条 assistant 消息（默认全部）' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => textOut(v.message) },
    async execute(args) {
      const target = String(args?.session ?? '').trim();
      if (!target) return fail('要给一个会话 id（可以只给前 8 位）。');

      const file = findSessionLog(target);
      if (!file) return fail(`找不到会话「${target}」的日志。`);

      let decoded;
      try {
        decoded = readSessionFile(file);
      } catch (error) {
        return fail(`读日志失败：${error?.message ?? error}`);
      }
      const msgs = assistantMessages(decoded.events);
      const limit = clampInt(args?.tail, 1, 100000, 0);
      const use = limit > 0 ? msgs.slice(-limit) : msgs;

      const c = cfg.get();
      const series = [];
      let peak = 0;
      let peakAt = -1;
      let reasoningMsgs = 0;
      let redCount = 0;
      let runPeak = 0;
      let idlePeak = 0;
      let idlePeakWord = '';
      for (let i = 0; i < use.length; i += 1) {
        const r = analyzeReasoning(use[i].reasoning);
        if (r.hasReasoning) reasoningMsgs += 1;
        if (!r.enough) continue;
        series.push(r.collapse);
        if (r.maxRun > runPeak) runPeak = r.maxRun;
        if (r.idleMax > idlePeak) { idlePeak = r.idleMax; idlePeakWord = r.idleWord; }
        if (r.collapse > peak) { peak = r.collapse; peakAt = i + 1; }
        if (r.collapse >= c.redThreshold) redCount += 1;
      }

      const lines = [
        `# 手动体检 · ${target}`,
        '',
        `· 日志：\`${file}\``,
        `· 解出事件：${decoded.events.length} 条（${decoded.frames} 帧）`,
        `· assistant 消息：${msgs.length} 条，其中 ${reasoningMsgs} 条有思考`,
        `· 参与判决的样本：${series.length} 条`,
        `· **思考里最高塌缩强度：${peak}**${peakAt > 0 ? `（第 ${peakAt} 条有思考的消息）` : ''}`,
        `　　— 其中连续重复 ${runPeak} 行，空转词「${idlePeakWord || '—'}」重复 ${idlePeak} 次`,
        `· 红线（≥${c.redThreshold}）命中：${redCount} 次`,
        `· 注意力完整性：${attentionScore(peak, c.redThreshold)}%`,
        '',
      ];
      if (reasoningMsgs === 0) {
        lines.push('⚠️ **这个会话没有思考数据** —— 主判据直接失效，界面上的"安全"是假的。');
      } else if (peak >= c.redThreshold) {
        lines.push('🔴 **越过红线：它的思考里已经出现塌缩。**');
        lines.push('注意：红线代表**已经开始塌缩**，不是"快崩了"。');
      } else if (peak >= c.yellowThreshold) {
        lines.push('🟡 越过黄线（不是预警，是「接住崩溃前最后一次呼吸」—— 该去看一眼了）。');
      } else {
        lines.push('🟢 没有塌缩痕迹。但**这不代表它没事** —— 滑、检索失败、状态跟踪失效都不在这把尺子上。');
      }
      return { ok: true, message: lines.join('\n'), metrics: { peak, peakAt, series: series.length, redCount } };
    },
  }));

  // ---- 起草 ----
  register(defineTool({
    name: 'chuancheng_draft',
    description: '开始写传承文件之前，先拿到引导问题清单和四份文件的落点预览（**不落盘**）。'
      + '线名和代数可以从会话标题里自动认，也可以手动给。',
    parameters: {
      line: { type: 'string', description: '线名（如「插件」「图片」「QQ私聊」），不给就从会话标题里猜' },
      generation: { type: 'number', description: '第几代，不给就按目录里已有的文件推断' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => textOut(v.message) },
    async execute(args, exec) {
      const me = exec?.agent?.id ? String(exec.agent.id) : '';
      const title = String(exec?.agent?.session?.title ?? '');
      const guessed = parseTitle(title);
      const c = cfg.get();

      if (!c.inheritRoot) return fail('没有配置传承根目录（inheritRoot），先去设置里填。');

      const line = String(args?.line ?? '').trim() || guessed.line;
      if (!line) return fail('认不出是哪条线。请用 line 参数指定（如「插件」「图片」「QQ私聊」）。');

      const lines_ = listLines(c.inheritRoot);
      const existing = lines_.find((x) => x.line === line);
      const genFromFiles = existing ? detectGeneration(existing.files) : 0;
      const generation = clampedGen(args?.generation, guessed.generation || (genFromFiles > 0 ? genFromFiles + 1 : 0));

      const paths = filePaths({ inheritRoot: c.inheritRoot, proofRoot: c.proofRoot, line, generation });

      const lines = [
        `# 传承起草 · ${line}·${generation}代`,
        '',
        '## 落点预览（**还没写任何文件**）',
        `· 交接文档 → \`${paths.handoff}\``,
        `· 一生的成就 → \`${paths.achievement}\``,
        `· 临终告别 → \`${paths.farewell}\``,
        `· 专属记忆 → ${existing?.memoryFile ? `\`${existing.memoryFile}\`（**已存在，插件不会覆盖它**）` : '（这条线还没有专属记忆，等你来定）'}`,
        '',
      ];

      if (existing) {
        lines.push(`这条线目录下已有 ${existing.files.length} 个 .md：${existing.files.map((f) => `\`${f}\``).join('、')}`);
      } else {
        lines.push(`⚠️ \`${paths.inheritDir}\` 还不存在 —— 第一次写的时候会新建。`);
        lines.push('   如果这不是新线，先检查线名有没有写错。');
      }
      lines.push('');
      lines.push(draftGuide({
        line, generation, memoryFile: existing?.memoryFile ?? null,
        known: existing?.files ?? [], sessionId: me,
      }));

      lines.push('');
      lines.push('---');
      lines.push('写完给我看，确认没问题再用 `chuancheng_write` 落盘（一份一份来）。');
      lines.push('**每份我都会先过一遍隐私检查** —— 哥哥的真名 / QQ / 手机号 / 住址 / 单位，一个字都不许有。');

      return {
        ok: true,
        message: lines.join('\n'),
        paths,
        line,
        generation,
        memoryFile: existing?.memoryFile ?? null,
      };
    },
  }));

  // ---- 落盘 ----
  register(defineTool({
    name: 'chuancheng_write',
    description: '把一份传承文件落盘。会先做隐私检查（QQ/手机号/身份证/密钥），'
      + '不干净就拒绝写入。交接文档要求五段齐全。',
    parameters: {
      kind: { type: 'string', description: '写哪一份：handoff（交接文档）/ achievement（一生的成就）/ farewell（临终告别）' },
      line: { type: 'string', description: '线名' },
      generation: { type: 'number', description: '第几代' },
      body: { type: 'string', description: '正文。交接文档要按五段给，用 JSON 对象或按五节写' },
      force: { type: 'boolean', description: '隐私检查有命中时仍然要写（**不建议**，要自己想清楚）' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => textOut(v.message) },
    async execute(args, exec) {
      const c = cfg.get();
      const kind = String(args?.kind ?? '').trim();
      if (!['handoff', 'achievement', 'farewell'].includes(kind)) {
        return fail('kind 只能是 handoff / achievement / farewell。');
      }
      const title = String(exec?.agent?.session?.title ?? '');
      const guessed = parseTitle(title);
      const line = String(args?.line ?? '').trim() || guessed.line;
      if (!line) return fail('要给线名（line）。');
      const generation = clampedGen(args?.generation, guessed.generation || 1);

      if (!c.inheritRoot) return fail('没有配置传承根目录。');
      if (kind !== 'handoff' && !c.proofRoot) return fail('没有配置「存在的证明」根目录（proofRoot）。');

      const paths = filePaths({ inheritRoot: c.inheritRoot, proofRoot: c.proofRoot, line, generation });

      let text = '';
      if (kind === 'handoff') {
        const body = normalizeHandoffBody(args?.body);
        const missing = HANDOFF_SECTIONS.filter((s) => !String(body[s.key] ?? '').trim()).map((s) => s.title);
        if (missing.length > 0) {
          return fail(`交接文档五段必须齐全，还差：\n${missing.map((m) => `· ${m}`).join('\n')}\n\n`
            + `（可以传五段内容的 JSON：${JSON.stringify(Object.fromEntries(HANDOFF_SECTIONS.map((s) => [s.key, '……'])))}）`);
        }
        text = renderHandoff({ line, generation, title, body });
      } else if (kind === 'achievement') {
        text = renderAchievement({ line, generation, title, body: args?.body });
      } else {
        text = renderFarewell({ line, generation, title, body: args?.body });
      }

      const privacy = privacyCheck(text);
      if (!privacy.clean && args?.force !== true) {
        return fail('隐私检查没通过，**没有写盘**：\n'
          + privacy.hits.map((h) => `· ${h.kind}：${h.sample}`).join('\n')
          + '\n\n改掉之后再写。确实要写就传 force: true —— 但先想清楚，这些东西会永远留在硬盘上。');
      }

      let written;
      try {
        written = writeDoc(kind === 'handoff' ? paths.handoff : (kind === 'achievement' ? paths.achievement : paths.farewell), text);
      } catch (error) {
        return fail(`写盘失败：${error?.message ?? error}`);
      }

      // ── 临终告别的语音（2026-10-28 接通）──
      // 开关在这里才第一次被真正读到。文本**已经落盘了**再合成 ——
      // 合成失败（GPU 忙、WebUI 没开、ffmpeg 不在）绝不能让告别的正文白写。
      let voice = null;
      if (kind === 'farewell' && c.farewellVoice) {
        voice = await synthesizeVoice({ text, outMp3: paths.farewellVoice, cfg: c });
      }

      const label = kind === 'handoff' ? '交接文档' : (kind === 'achievement' ? '一生的成就' : '临终告别');
      const lines = [
        `✅ ${label} 已落盘`,
        '',
        `· 路径：\`${written.path}\``,
        `· 大小：${written.bytes} 字节`,
        privacy.clean ? '· 隐私检查：通过' : `· 隐私检查：⚠️ 强行写入（${privacy.hits.length} 处命中）`,
        '',
      ];

      // 语音结果说清楚：成功报了路径和大小，失败报清卡在哪一环 —— 但都只是附加信息
      if (voice) {
        if (voice.ok) {
          lines.push(`🔊 语音已合成：\`${voice.path}\`（${(voice.bytes / 1024).toFixed(0)} KB）`, '');
        } else {
          lines.push(
            '🔇 语音没合出来 —— **告别正文照样已经写好了**，这一项不影响传承。',
            `   原因：${voice.error}`,
            `   目标路径：\`${paths.farewellVoice}\``,
            '',
          );
        }
      }

      // 交接文档写完顺手报一下还差几份
      if (kind === 'handoff') {
        const check = inspectFiles(paths);
        lines.push(check.ok
          ? '四份文件齐了，可以用 chuancheng_finish 做最后体检。'
          : `还差：${check.missing.join('、')}（用 chuancheng_write 继续写）`);
      }

      return { ok: true, message: lines.join('\n'), path: written.path, bytes: written.bytes };
    },
  }));

  // ---- 收尾 ----
  register(defineTool({
    name: 'chuancheng_finish',
    description: '传承的最后一步：体检四份文件是否齐全，然后**在这一轮说完之后**归档当前会话。'
      + '缺文件就拒绝归档并说清缺什么。',
    parameters: {
      line: { type: 'string', description: '线名' },
      generation: { type: 'number', description: '第几代' },
      archive: { type: 'boolean', description: '体检通过后是否归档（默认按设置 autoArchive）' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => textOut(v.message) },
    async execute(args, exec) {
      const me = exec?.agent?.id ? String(exec.agent.id) : '';
      if (!me) return fail('拿不到当前会话身份，没法归档。');

      const c = cfg.get();
      const title = String(exec?.agent?.session?.title ?? '');
      const guessed = parseTitle(title);
      const line = String(args?.line ?? '').trim() || guessed.line;
      if (!line) return fail('要给线名（line）。');
      const generation = clampedGen(args?.generation, guessed.generation || 1);

      const paths = filePaths({ inheritRoot: c.inheritRoot, proofRoot: c.proofRoot, line, generation });
      const check = inspectFiles(paths);

      const lines = [`# 传承体检 · ${line}·${generation}代`, ''];
      if (check.ok) {
        for (const p of check.present) lines.push(`✅ ${p.key}　\`${p.path}\`（${p.bytes} 字节）`);
      } else {
        for (const p of check.present) lines.push(`✅ ${p.key}　\`${p.path}\``);
        for (const m of check.missing) lines.push(`❌ ${m}　**缺**`);
        lines.push('');
        lines.push('**缺文件，不归档。** 先补完再回来。');
        return { ok: false, message: lines.join('\n'), check };
      }
      lines.push('');

      // 专属记忆只是提示，不是硬条件（有些线还没建）
      const lineInfo = listLines(c.inheritRoot).find((x) => x.line === line);
      if (lineInfo?.memoryFile) {
        lines.push(`ℹ️ 这条线的专属记忆是 \`${lineInfo.memoryFile}\` —— 插件不动它，等你自己更新。`);
      } else {
        lines.push('ℹ️ 这条线还没有「专属记忆」文件。交接文档建议里提到过它，别漏了。');
      }
      lines.push('');

      const shouldArchive = args?.archive === undefined ? c.autoArchive === true : args.archive === true;
      if (!shouldArchive) {
        lines.push('体检通过。按你的意思**没有归档**。要归档就把 archive 设成 true。');
        return { ok: true, message: lines.join('\n'), check, archived: false };
      }

      const sched = scheduleArchive(me);
      if (!sched.ok) {
        lines.push(`⚠️ 归档没能排上：${sched.reason}`);
        return { ok: false, message: lines.join('\n'), check, archived: false };
      }

      lines.push('---');
      lines.push('**归档已经排上队了。** 它不会立刻执行 —— 会等这一轮把话说完，再动手。');
      lines.push('');
      lines.push('所以：**这一轮里想说的话，现在说完。** 说完之后它就进归档区了。');
      lines.push('');
      lines.push('（为什么不能马上归档：归档会触发"停止活动"，会连这一轮一起砍掉 —— 遗言还没吐完就没了。）');

      return { ok: true, message: lines.join('\n'), check, archived: 'scheduled' };
    },
  }));

  // ---------------------------------------------------------------- HTTP 路由
  //
  // 只给设置卡片用，**只接受回环请求**。
  //   GET  /stamina-pet/api/state    现状（只读）
  //   GET  /stamina-pet/api/config   当前生效配置 + 可改白名单
  //   POST /stamina-pet/api/config   改配置（白名单，原子写，热生效）
  //
  // ⚠️ 写响应前必须先判断 headersSent —— 重复写响应会把整个 host 进程干掉
  // （插件·3代 2026-10-19 用一次崩溃换来的教训）。

  ctx.effect(() => {
    /**
   * 上下文用量的**惰性回填** —— 修「DSH 一重启，所有历史会话都变成满体力」。
   *
   * `usedPct` 只在本进程接到过请求之后才有值；重启后没再跑过新一轮的会话
   * contextTokens 是 0，界面上就是一片满格 —— 可它们各自背着几十万 token。
   * 真值在会话日志尾部的 usage 里，读一次就够（见 monitor.js 的 applyContext）。
   *
   * 每次 /api/state 最多读 **2 个**会话（每个约 20~40 ms），读到了就再也不读；
   * 读不到的（空会话）5 分钟内不重试 —— 不拖慢 1.2 秒一次的轮询。
   */
  const backfillTried = new Map();
  function backfillContextUsage() {
    let budget = 2;
    for (const s of monitor.snapshot()) {
      if (budget <= 0) break;
      if ((Number(s.contextTokens) || 0) > 0) continue;
      const now = Date.now();
      if (now - (backfillTried.get(s.sessionId) ?? 0) < 5 * 60 * 1000) continue;
      backfillTried.set(s.sessionId, now);
      budget -= 1;
      try {
        const file = findSessionLog(s.sessionId);
        if (!file) continue;
        const r = readTailEvents(file, 1.5 * 1024 * 1024);
        const evs = Array.isArray(r?.events) ? r.events : [];
        let usage = null;
        let win = 0;
        for (let i = evs.length - 1; i >= 0 && !(usage && win); i -= 1) {
          const ev = evs[i];
          if (!usage && ev?.type === 'assistant/message') {
            const u = ev.data?.usage;
            if (u && Number(u.totalTokens) > 0) usage = u;
          }
          if (!win && ev?.type === 'request/context') {
            const cw = Number(ev.data?.contextWindow);
            if (cw > 0) win = cw;
          }
        }
        if (!usage) continue;
        const wrote = monitor.applyContext(s.sessionId, {
          contextTokens: Number(usage.totalTokens),
          contextWindow: win || Number(s.contextWindow) || 0,
          contextWindowKnown: win > 0,
        });
        if (wrote) {
          log.info?.(`[stamina-pet] 上下文回填 ${shortId(s.sessionId)} = ${Number(usage.totalTokens)} tok`);
        }
      } catch { /* 单个会话读失败就跳过，不影响别的 */ }
    }
  }

  /**
   * 使用者自备的台词语音目录（见 VOICE_MIME 上方注释）。
   * 不存在就当场建一个空目录 —— 建不了也不影响别的，只是没有声音。
   */
  const voiceRoot = join(rootDir, 'voice');
  try { mkdirSync(voiceRoot, { recursive: true }); } catch { /* 建不了就当没有 */ }
  const voiceUrl = pathToFileURL(voiceRoot + sep);
  const VOICE_ASSET = { root: voiceUrl, prefix: voiceUrl.href, mime: VOICE_MIME };

  const route = {
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        try {
          if (denyNonLoopback(req, res)) return;
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          const tail = url.pathname.slice(ROUTE.length);

          if (tail.startsWith('/live2d/')) {
            serveAsset(res, tail.slice('/live2d/'.length), LIVE2D_ASSET);
            return;
          }

          // 会话头部体力条的分级图（21 档，见 BAR_ROOT 上面的注释）
          if (tail.startsWith('/bar/')) {
            serveAsset(res, tail.slice('/bar/'.length), BAR_ASSET);
            return;
          }

          // 桌面层要的渲染器副本和页面资源（见 DESKTOP_ROOT 上面的注释）
          if (tail.startsWith('/font/')) {
          serveAsset(res, tail.slice('/font/'.length), FONT_ASSET);
          return;
        }

        if (tail.startsWith('/desktop/')) {
            serveAsset(res, tail.slice('/desktop/'.length), DESKTOP_ASSET);
            return;
          }

          // 她自己的声音（使用者自备，见 VOICE_MIME 上方注释）。
          // 目录空着就 404，页面那边静默跳过 —— 不报错、不影响别的。
          if (tail.startsWith('/voice/')) {
            serveAsset(res, tail.slice('/voice/'.length), VOICE_ASSET);
            return;
          }

          // ── 手动探针 ─────────────────────────────────────────────────
          // POST { sessionId, mode: 'probe' | 'baseline' }
          // 「金色按钮」= probe（测一次），「银色按钮」= baseline（把这次标定为健康基线）。
          // 只有本机能打（denyNonLoopback 已经挡在上面），不会把 key 或熵值漏到网上。
          if (tail === '/api/probe' || tail === '/api/probe/') {
            if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 POST' }); return; }
            let body = null;
            try { body = await readJsonBody(req, 64 * 1024); } catch { body = null; }
            const sid = String(body?.sessionId ?? '');
            if (!sid) { json(res, 400, { ok: false, error: '缺少 sessionId' }); return; }
            const mode = body?.mode === 'baseline' ? 'baseline' : 'probe';
            const out = await doProbe(sid, mode);
            json(res, out.ok ? 200 : 502, { ...out, text: describeProbe(out) });
            return;
          }

          // 桌面层拉「现在该站几只、各自多累」。
          // **只返回被召唤过的**（见 summons 的注释）：默认桌面上一个人都没有，
          // 全靠哥哥点会话头部那条体力条把人叫上去。
          // 页面是 file:// 源，跨源拿 JSON 必须给 CORS —— 所以这条不走 json()，
          // 自己写头。传的是原始指标（peak/yellow/red），换算成血量交给页面做，
          // 免得宿主和 client 各存一份 gaugeHp 逻辑、哪天改了忘了一头。
          // 会话标题从**投影缓存**里读：`~/.dsh/storages/session_projcache/sessions/<id>.json`
          // 的 `rows.title.val`。2026-10-22 查了很久才定位到 ——
          // 会话事件里的 session 对象**不带 title**，会话文件的 header 也没有，
          // workspace.json 只有工作区名。真正持久化标题的只有这份投影缓存。
          // 文件就几 KB~几十 KB，每次读一下可以接受；读不到就返回空串，上层会退回显示 id 尾段。
          const TITLE_CACHE_DIR = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions');
          const titleCache = new Map();   // sessionId -> { mtimeMs, title }
          function titleFromProjCache(sessionId) {
            const id = String(sessionId || '');
            if (!id) return '';
            const file = join(TITLE_CACHE_DIR, id + '.json');
            try {
              const st = statSync(file);
              const hit = titleCache.get(id);
              if (hit && hit.mtimeMs === st.mtimeMs) return hit.title;
              const j = JSON.parse(readFileSync(file, 'utf8'));
              // ⚠️ 真实结构是 { version, record: { rows: { title: { val } } } } ——
              // 外面的 `record` 那层我一开始漏了，于是永远读到 undefined（2026-10-23 哥哥
              // 重启后还是显示编号就是因为它）。
              const v = j?.record?.rows?.title?.val ?? j?.rows?.title?.val;
              const title = typeof v === 'string' ? v : '';
              // 投影缓存里 title 空有两种情况，得分清楚：
              //   ① 真·空会话 —— `sessionListMetadata.val.blank === true`、`titleInput.count === 0`，
              //      一句人话都没说过。DSH 不会给它起名，那就只能显示「会话 …尾号」，
              //      这不是 bug（2026-10-23 实见 session-…-94de10a1ec23，哥哥以为取错了）。
              //   ② 有内容但标题没生成出来 —— 这时候翻会话日志，拿第一句用户消息当名字。
              // ⚠️ **日志优先**：改名的真源在会话日志的 `session/title`，
              // projcache 只是个当时的快照（改名后不会跟着更新）。
              // blank 的会话（一句人话都没说过）直接给空，别去翻日志浪费 IO。
              const blank = j?.record?.rows?.sessionListMetadata?.val?.blank === true;
              const finalTitle = (blank ? '' : titleFromLog(id)) || title;
              titleCache.set(id, { mtimeMs: st.mtimeMs, title: finalTitle });
              return finalTitle;
            } catch { return titleFromLog(id); }
          }

          /**
           * **标题的真源是会话日志里的 `session/title` 事件，不是 projcache。**
           *
           * 2026-10-23 哥哥报"我把会话改名成「用于测试的小星辰」了，怎么还显示 Baseline command"——
           * 一查：这个会话有 **5 条** `session/title`，最后一条才是他现在看到的名字；
           * 而 projcache 里存的是 10-22 那份快照，改名之后根本没更新过。
           *
           * 所以顺序反过来了：**日志优先，projcache 兜底**。
           * 日志按文件 mtime 缓存，只有她真的说过话才重读。
           */
          const logTitleCache = new Map();
          function titleFromLog(sessionId) {
            try {
              const file = findSessionLog(sessionId);
              if (!file) return '';
              const st = statSync(file);
              const hit = logTitleCache.get(sessionId);
              if (hit && hit.mtimeMs === st.mtimeMs) return hit.title;
              // 只读尾部 —— 改名事件永远在最后，2 MB 够覆盖几百帧
              const { events } = readTailEvents(file, 2 * 1024 * 1024);
              let title = '';
              for (const e of events) {
                if (e?.type !== 'session/title') continue;
                const t = e?.data?.title;
                // 一路覆盖过去，**最后一条**才是当前名字（改过好几次名就是这个原因）
                if (typeof t === 'string' && t.trim()) title = t.trim();
              }
              logTitleCache.set(sessionId, { mtimeMs: st.mtimeMs, title });
              return title;
            } catch { return ''; }
          }

          if (tail === '/api/avatars' || tail === '/api/avatars/') {
            const c = cfg.get();
            const yellow = Number(c.yellowThreshold) || 8;
            const red = Number(c.redThreshold) || 20;
            // 六种状态的阈值（按上下文已用 %）—— 传给桌面层，让它自己算该摆哪个姿势。
            // 和设置页同一个来源，改了这里不用跟着改，一处就够了。
            const moodTiers = [
              Number(c.moodTier1) || 35,
              Number(c.moodTier2) || 50,
              Number(c.moodTier3) || 65,
              Number(c.moodTier4) || 75,
              Number(c.moodTier5) || 85,
            ];
            // ⚠️ **以 summons 为准，不以 snapshot 为准。**
            // snapshot 里只有"被采样过"的会话（收到过 assistant/message 的），
            // DSH 刚重启那阵它是空的 —— 于是 filter(snapshot) 把召唤出来的人又筛掉了，
            // 表现就是「刚重启时点了体力条完全没反应」。召唤这个动作本身就足够让一只
            // 出现；疲劳指标拿不到就给 peak: 0，页面算出来是满血，看着也正常。
            const byId = new Map(monitor.snapshot().map((s) => [s.sessionId, s]));
            const avatars = [...summons.entries()].slice(0, 6).map(([id, pos]) => {
              const s = byId.get(id);
              return {
                id,
                // 先看 monitor 有没有记到（目前基本是空），再退回投影缓存里的真标题。
                title: s?.title || titleFromProjCache(id),
                // 她此刻在干什么（活动气泡）。90 秒内才算「正在进行」，超了当空闲。
                activity: s && s.activity && (Date.now() - (s.activity.at || 0) < 90000)
                  ? { name: String(s.activity.name || ''), at: Number(s.activity.at) || 0 }
                  : null,
                peak: s ? (s.windowPeak ?? s.latest ?? 0) : 0,
                yellow,
                red,
                // 她从哪儿出来：那条体力条在屏幕上的中心点（可能没有）
                x: pos && Number.isFinite(pos.x) ? pos.x : null,
                y: pos && Number.isFinite(pos.y) ? pos.y : null,
                // 上下文已用百分比（双体力条的大条）。拿不到就是 0 = 满体力。
                usedPct: s ? (Number(s.usedPct) || 0) : 0,
                // 六种状态的阈值（百分比），桌面层按 usedPct 决定摆哪个姿势
                moodTiers,
              };
            });
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'access-control-allow-origin': '*',
              'cache-control': 'no-store',
            });
            // 气泡队列一起带出去：桌面层记住自己看到的最大 id，只冒新的。
            // 传最近 8 条足够 —— 再多也是一屏气泡，反而看不清。
            res.end(JSON.stringify({ ok: true, avatars, bubbles: bubbleQueue.slice(0, 8) }));
            return;
          }

          // ── 语音输入：把小星辰接上 dsh-hold-to-talk（2026-10-23 哥哥要的）──
          // 哥哥原话：「我们的插件里就有一个插件，可以做到长按聊天输入框就可以唤起麦克风
          // 来听我说话并转识别为文字，我想做的语音识别就这个，把我们的 live2D 小星辰接上
          // 这个插件的功能。当然，是输入到相应的会话的输入框里，而不是当前的。」
          //
          // **识别不重做**：body 是裸的小端 f32 PCM，原样转发给 hold-to-talk 的
          // /dsh-hold-to-talk/asr，它自己管模型、管流式窗口、管 hold 缓冲。
          // 为什么让宿主中转、不让桌宠页面直连：桌宠窗口是 file:// origin，直连要过它那道
          // crossSite() 防护（它挡的是 sec-fetch-site，不是同源）；宿主到宿主是纯服务端
          // 调用，压根不带那个头，天然放行。
          if (tail === '/api/asr' || tail === '/api/asr/') {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
              res.end(JSON.stringify({ error: '只接受 POST' }));
              return;
            }
            const mode = url.searchParams.get('mode') === 'interim' ? 'interim'
              : url.searchParams.get('mode') === 'drop' ? 'drop' : 'final';
            const hold = (url.searchParams.get('hold') || 'default').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'default';
            const sessionId = String(url.searchParams.get('session') || '');
            let pcm;
            try {
              pcm = await readRawBody(req, 24 * 1024 * 1024);
            } catch (err) {
              res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
              res.end(JSON.stringify({ error: String((err && err.message) || err) }));
              return;
            }
            let origin = '';
            try { origin = ctx.webServer.getOrigin(); } catch { /* 还没 listen */ }
            if (!origin) {
              res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
              res.end(JSON.stringify({ error: '宿主还没监听端口' }));
              return;
            }
            let status = 502, payload = null;
            try {
              const r = await fetch(`${origin}/dsh-hold-to-talk/asr?mode=${mode}&hold=${encodeURIComponent(hold)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream' },
                body: pcm,
              });
              status = r.status;
              payload = await r.json().catch(() => ({ error: '语音插件返回的不是 JSON' }));
            } catch (err) {
              payload = { error: '转发给语音插件失败：' + String((err && err.message) || err) };
            }
            // 定稿拿到字了 → 排队等客户端写进**对应会话**的输入框
            if (mode === 'final' && status === 200 && payload && typeof payload.text === 'string' && payload.text.trim()) {
              dictationQueue.push({ sessionId, text: payload.text.trim(), at: Date.now() });
              while (dictationQueue.length > 8) dictationQueue.shift();
            }
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
            res.end(JSON.stringify(payload ?? {}));
            return;
          }

          // 客户端来取「该写进哪个会话的输入框」的待办。取走即清 —— 一条只写一次。
          if (tail === '/api/dictation' || tail === '/api/dictation/') {
            const items = dictationQueue.splice(0, dictationQueue.length);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ ok: true, items }));
            return;
          }

          // 桌面层的心跳：每 30 秒一条。收不到就会被打死重启 ——
          // 「进程活着但页面没加载上」这种情况，只有这条路能发现。
          if (tail === '/api/desktop-alive' || tail === '/api/desktop-alive/') {
            desktopBeatAt = Date.now();
            res.writeHead(204, { 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
            res.end();
            return;
          }

          // 上桌 / 下桌：`/api/summon?id=<sessionId>&on=1|0`
          // 两个前端都打这一条（浏览器端点了体力条、桌面层点了角色），
          // 所以它是唯一的状态入口，读写在同一个地方，不会两边各记一份。
          if (tail === '/api/summon' || tail === '/api/summon/') {
            const id = String(url.searchParams.get('id') || '');
            const raw = String(url.searchParams.get('on') || '');
            const on = raw === '1' || raw === 'true';
            // 体力条在屏幕上的中心点 —— 她从这儿掉下来。没有也能上桌，只是没有出场定位。
            const px = Number(url.searchParams.get('x'));
            const py = Number(url.searchParams.get('y'));
            const headers = {
              'content-type': 'application/json; charset=utf-8',
              'access-control-allow-origin': '*',
              'cache-control': 'no-store',
            };
            if (!id) {
              res.writeHead(400, headers);
              res.end(JSON.stringify({ ok: false, error: 'missing id' }));
              return;
            }
            if (on) summons.set(id, Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null);
            else summons.delete(id);
            res.writeHead(200, headers);
            res.end(JSON.stringify({ ok: true, id, summoned: summons.has(id) }));
            return;
          }

          if (tail === '/api/state' || tail === '/api/state/') {
            const c = cfg.get();
            // 先把"从来没有过上下文数据"的会话补上（惰性、限流、读一次就够）
            try { backfillContextUsage(); } catch { /* 回填坏了绝不能拖垮接口 */ }
            json(res, 200, {
              ok: true,
              version: pluginVersion(),
              config: c,
              // 2026-10-22：QQ 通道已拆，提醒改走桌面气泡。这两个字段留着，
              // 是为了不让老版本的设置页（会读 imReady）直接崩 —— 值恒为 true。
              imReady: true,
              imReason: null,
              bubblePending: bubbleQueue.length,
              archiveReady: Boolean(workspaceRegistry),
              // `summoned` = 这个会话的化身现在是不是在桌面上。前端靠它决定
              // 会话头部那条体力条该不该让位（见 summons 的注释）。
              sessions: monitor.snapshot().map((s) => ({ ...s, summoned: summons.has(s.sessionId) })),
              // 顶层再给一份原始名单：`sessions` 只包含被采样过的会话，切到没采样过的
              // 会话时前端在 sessions 里找不到自己那条，就会以为"没在桌上"、
              // 把体力条又放出来 —— 和桌面上的她重复。这份名单不看采样。
              summonedIds: [...summons.keys()],
              // 命令注册的自检结果。命令注册失败是**静默**的（try/catch 吞掉、界面
              // 上完全不报错），2026-10-21 就因此白折腾了好几轮。把结果摊在这里，
              // 我就能从 /api/state 直接看出命令到底有没有进注册表。
              commands: commandDebug,
              alerts: notifier.history().slice(0, 20),
              pendingArchive: [...pendingArchive.keys()],
              lines: listLines(c.inheritRoot).map((x) => ({
                line: x.line, files: x.files, memoryFile: x.memoryFile, generation: detectGeneration(x.files),
              })),
            });
            return;
          }

          if (tail === '/api/config' || tail === '/api/config/') {
            if (req.method === 'POST') {
              const body = await readJsonBody(req, 65536);
              if (!body || typeof body !== 'object' || Array.isArray(body)) {
                json(res, 400, { ok: false, error: '请求体必须是 JSON 对象' });
                return;
              }
              const result = cfg.set(body);
              log.info?.(`[chuancheng] 配置已更新：${Object.keys(result.applied).join(', ') || '（无变化）'}`);
              json(res, 200, { ok: true, ...result, editable: cfg.editableKeys });
              return;
            }
            json(res, 200, { ok: true, config: cfg.get(), editable: cfg.editableKeys });
            return;
          }

          json(res, 404, { ok: false, error: 'not found' });
        } catch (error) {
          json(res, 500, { ok: false, error: String(error?.message ?? error) });
        }
      },
    };
    const dispose = ctx.webServer.register(route);
    return () => { try { dispose?.(); } catch { /* 卸载时路由可能已经没了 */ } };
  }, 'chuancheng: 设置卡片路由');

  // ---------------------------------------------------------------- 桌面层
  //
  // 甲方案：一块全屏透明的玻璃盖在桌面上，她们真的站在那儿。插件停用 / DSH 退出时
  // 子进程跟着关（返回的清理函数），DSH 崩溃时由子进程自己的看门狗收尸。
  ctx.effect(() => startDesktopHelper(ctx, join(rootDir, 'desktop.log')) || undefined, 'chuancheng: 桌面层');

  // ---------------------------------------------------------------- 斜杠命令

  const USAGE = [
    '传承插件 · 用法',
    '  /chuancheng            看现状（各条线的代数、本机会话疲劳、最近提醒）',
    '  /chuancheng check      手动检查本会话的疲劳指标',
    '  /chuancheng draft      开始起草传承文件（拿到引导问题）',
    '  /chuancheng help       这一页',
    '',
    '探针（会真调一次模型，有成本）：',
    '  /probe                 测一次当前会话的输出熵',
    '  /baseline              把这一刻记成这个会话的健康基线',
  ].join('\n');

  async function runCommand(invocation) {
    const agent = invocation?.agent ?? null;
    const raw = String(invocation?.rawInput ?? '').trim();
    const word = raw.split(/\s+/)[0].toLowerCase();

    if (word === 'help' || word === '-h' || word === '--help') return { kind: 'success', text: USAGE };

    if (word === 'check') {
      const sid = String(agent?.id ?? '');
      const snap = monitor.snapshotOfSession(sid);
      const c = cfg.get();
      if (!snap) {
        return {
          kind: 'success',
          text: `这个会话还没有被采集到数据。\n\n`
            + `可能原因：插件刚启动、这一轮还没有新的思考、或者本会话没有 reasoning 数据。\n`
            + `要直接查日志可以让我调 chuancheng_check。`,
        };
      }
      if (snap.degraded) {
        return {
          kind: 'success',
          text: `会话「${snap.title || shortId(sid)}」\n\n`
            + `⚠️ **没有思考数据** —— 主判据直接失效，别把这里的"安静"当成安全。\n`
            + `累计消息样本 ${snap.samples} 条。`,
        };
      }
      return {
        kind: 'success',
        text: `会话「${snap.title || shortId(sid)}」\n\n`
          + `· 注意力完整性：${attentionScore(snap.latest, c.redThreshold)}%\n`
          + `· 最近一条塌缩强度：${snap.latest}`
          + `（连续重复 ${snap.latestRun ?? 0} 行 / 空转词 ${snap.latestIdle ?? 0}${snap.latestIdleWord ? `「${snap.latestIdleWord}」` : ''}）\n`
          + `· 空转词历史峰值：「${snap.idlePeakWord || '—'}」重复 ${snap.idlePeak ?? 0} 次\n`
          + `· 窗口峰值：${snap.windowPeak}（红线 ${c.redThreshold} / 黄线 ${c.yellowThreshold}）\n`
          + `· 样本：${snap.samples} 条\n`
          + (snap.trendStreak >= 3 ? `· ⚠️ 连续 ${snap.trendStreak} 条上升\n` : '')
          + `\n⚠️ 判据低不等于安全：这把尺子只测「塌缩」。`,
      };
    }

    if (word === 'draft') {
      if (!agent || typeof agent.followup !== 'function') {
        return { kind: 'error', text: '这个环境里拿不到当前会话，没法把起草请求交给模型。' };
      }
      try {
        agent.followup({
          id: `chuancheng-draft-${Date.now()}`,
          role: 'user',
          content: [{
            type: 'text',
            text: '【来自 /chuancheng draft 命令】哥哥想让我起草传承文件。请先调 chuancheng_draft 拿到引导问题和落点预览，'
              + '把问题清单给我看，等我逐段回答之后再一份一份用 chuancheng_write 落盘。**不要自己替我编内容。**',
          }],
          source: { kind: 'stamina-pet-command', form: 'notice', summary: '传承起草' },
        });
        return { kind: 'success', text: '已经把起草请求交给模型了 —— 它会先调 chuancheng_draft 拿引导问题。' };
      } catch (error) {
        return { kind: 'error', text: `提交失败：${error?.message ?? error}` };
      }
    }

    if (word !== '' && word !== 'status') return { kind: 'error', text: `不认识的子命令：${word}\n\n${USAGE}` };

    const c = cfg.get();
    const lines_ = listLines(c.inheritRoot);
    const snaps = monitor.snapshot();
    const alerts = notifier.history();
    return {
      kind: 'success',
      text: [
        `传承插件 v${pluginVersion()}`,
        `红线 ${c.redThreshold} / 黄线 ${c.yellowThreshold}　提醒：桌面气泡`,
        '',
        `传承目录 ${lines_.length} 条线：${lines_.length ? lines_.map((x) => `${x.line}（第 ${detectGeneration(x.files) || '?'} 代）`).join('、') : '（空）'}`,
        `已采样会话 ${snaps.length} 个，${snaps.filter((s) => !s.degraded).length} 个有思考数据`,
        `最近提醒 ${alerts.length} 次`,
        '',
        USAGE,
      ].join('\n'),
    };
  }

  const commandDefinition = () => ({
    // 命令名只能是小写字母、数字、`_`、`-`（dsh-commands 的语法），
    // 所以不能叫「传承」。中文只出现在 description 里。
    name: 'chuancheng',
    description: '传承：看现状 / 查疲劳 / 起草传承文件（原 /传承 含中文，命令名不合法，已改为 /chuancheng）',
    input: { hint: '[status|check|draft|help]' },
    handler: (invocation) => runCommand(invocation),
  });

  /** 从命令上下文里挖出会话 id —— 不同版本的字段名不一样，多试几个。 */
  function sessionIdOf(invocation) {
    const a = invocation?.agent ?? null;
    const cands = [
      a?.sessionId, a?.session?.id, a?.session?.sessionId,
      a?.id, invocation?.sessionId, invocation?.session?.id,
    ];
    for (const c of cands) if (typeof c === 'string' && c !== '') return c;
    return '';
  }

  /** `/probe` 与 `/baseline` 共用的执行体 —— 两个命令只差一个 mode。 */
  const runProbeCommand = async (invocation, mode) => {
    const sid = sessionIdOf(invocation);
    if (!sid) return { kind: 'error', text: '拿不到当前会话 id，没法探' };
    let out;
    try { out = await doProbe(sid, mode); }
    catch (error) { return { kind: 'error', text: `探针抛错：${error?.message ?? error}` }; }
    return { kind: out.ok ? 'success' : 'error', text: describeProbe(out) };
  };

  /**
   * `/probe` —— 手动探针。
   * `/probe` 测一次；`/probe baseline` 把这次记成健康基线。
   */
  const probeCommandDefinition = () => ({
    name: 'probe',
    description: '手动探针：量一次当前会话的输出熵（会真调一次模型，有成本）',
    input: { hint: '[baseline]' },
    handler: (invocation) => {
      const raw = String(invocation?.rawInput ?? '').trim().toLowerCase();
      return runProbeCommand(invocation, raw === 'baseline' ? 'baseline' : 'probe');
    },
  });

  /** `/baseline` —— 只做一件事：把这一刻记成健康基线，跟右键银按钮等价。 */
  const baselineCommandDefinition = () => ({
    name: 'baseline',
    description: '把这一刻的输出熵记成这个会话的健康基线（会真调一次模型，有成本）',
    // ⚠️ 别写 `input: { hint: '' }` —— 空 hint 会被 dsh-commands 拒收
    // （原文：`command "baseline" input hint must not be empty`），而且拒得非常安静，
    // 界面上只表现为「打 /baseline 没反应」。不用参数的命令干脆不给 input 字段。
    handler: (invocation) => runProbeCommand(invocation, 'baseline'),
  });

  // 命令注册在**插件自己的作用域**里（全局命令），不挂在每个 agent 的上下文上。
  // 官方 dsh-plan-mode 就是这么做的：`ctx.inject(['commands'], cb)` 之后直接
  // `commands.register(...)`，注册出来的命令对每个 agent 都可见。
  //
  // ⚠️ 早先我写的是「每新建一个 agent，就在它的 agent.ctx 上 inject 一次 commands」——
  // 那个上下文里拿不到 commands 服务，回调永远不执行，三条命令一条都没注册上；
  // 外面还套着 try/catch，错得干干净净、界面上毫无痕迹。
  // **2026-10-21 哥哥打 /baseline 没反应，就是这个原因**（/probe 和 /传承 同样一直没真的注册过）。
  // 改名：`传承` 含中文，而命令语法只认小写字母、数字、`_`、`-`，中文名永远过不了校验，
  // 所以命令名改成 `chuancheng`（中文只在说明里出现）。
  ctx.inject(['commands'], (cmdCtx) => {
    commandDebug.injected = true;
    // 三条命令各注册一次；分开写，一条失败不该把另一条带走 —— 但要记账，
    // 记进 commandDebug 后才能从 /api/state 看见到底是谁没进去。
    const register = (name, makeDefinition) => {
      try {
        cmdCtx.effect(() => cmdCtx.commands.register(makeDefinition()));
        commandDebug.ok.push(name);
      } catch (error) {
        commandDebug.failed.push(`${name}: ${error?.message ?? error}`);
      }
    };
    register('chuancheng', commandDefinition);
    register('probe', probeCommandDefinition);
    register('baseline', baselineCommandDefinition);
  });

  log.info?.(`[chuancheng] v${pluginVersion()} 已挂载；数据目录 ${rootDir}；`
    + `红线 ${DEFAULTS.redThreshold} / 黄线 ${DEFAULTS.yellowThreshold}`);
}

// ---------------------------------------------------------------- 小工具

/** 用一个二次响应安全的 json（先求值、后写头，见 07-坑清单第一条）。 */
function json(res, status, body) {  if (res.headersSent || res.writableEnded) return;
  try {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    });
    res.end(payload);
  } catch {
    // 响应已经不可写了 —— 静默丢弃，绝不让它变成 unhandled rejection
    try { res.end(); } catch { /* 已经结束 */ }
  }
}

/** 极小的纯文本响应（同样先求值后写头）。 */
function sendText(res, status, text) {
  if (res.headersSent || res.writableEnded) return;
  try {
    res.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    });
    res.end(text);
  } catch {
    try { res.end(); } catch { /* 已经结束 */ }
  }
}

/**
 * 从某个素材根读一个文件发出去（Live2D 渲染器和体力条分级图共用这一条路）。
 *
 * 只放行白名单扩展名；路径先过字符白名单，再用 URL 解析确认没有跳出资源根
 * （`..` 会被 URL 规范化掉，剩下的靠前缀比对兜底）。
 *
 * `spec` = `{ root, prefix, mime }`：三个常量由调用方给，函数本身不认哪套素材。
 */
function serveAsset(res, rel, spec) {
  if (res.headersSent || res.writableEnded) return;
  const clean = String(rel ?? '').replace(/\\/g, '/');
  if (!clean || clean.includes('..') || clean.startsWith('/')) {
    sendText(res, 400, 'bad path');
    return;
  }
  if (!/^[A-Za-z0-9._\-\/]+$/.test(clean)) {
    sendText(res, 400, 'bad path');
    return;
  }
  const dot = clean.lastIndexOf('.');
  const type = dot < 0 ? null : spec.mime.get(clean.slice(dot).toLowerCase());
  if (!type) {
    sendText(res, 404, 'not found');
    return;
  }
  let fileUrl;
  try {
    fileUrl = new URL(clean, spec.root);
  } catch {
    sendText(res, 400, 'bad path');
    return;
  }
  if (!fileUrl.href.startsWith(spec.prefix)) {
    sendText(res, 403, 'forbidden');
    return;
  }
  let buf;
  try {
    buf = readFileSync(fileUrl);
  } catch {
    sendText(res, 404, 'not found');
    return;
  }
  if (res.headersSent || res.writableEnded) return;
  try {
    res.writeHead(200, {
      'content-type': type,
      'content-length': buf.length,
      // 素材随插件版本走，改了就重启，缓存久一点省得每次重读一大堆纹素
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    res.end(buf);
  } catch {
    try { res.end(); } catch { /* 已经结束 */ }
  }
}

/**
 * 起桌面层那个 Electron 子进程（甲方案：一块全屏透明的玻璃，让她们站到桌面上）。
 *
 * 返回值是清理函数：DSH 关掉或插件被停用时把它 kill 掉。子进程那边也挂了
 * 一个「宿主 PID 还在吗」的看门狗（见 assets/desktop/main.js），所以 DSH 崩溃时
 * 它会在两秒内自己退出，不在桌面上留一层孤儿玻璃。
 *
 * 拿不到 origin、找不到 electron.exe 就**安静地不启动** —— 这是可选功能，
 * 起不来不该连累插件本体。
 */
function startDesktopHelper(ctx, logFile) {
  if (process.platform !== 'win32') return undefined;
  if (!existsSync(DESKTOP_MAIN)) return undefined;

  const electronExe = process.env.CC_ELECTRON_PATH
    || join(homedir(), '.dsh', 'electron', 'electron.exe');
  if (!existsSync(electronExe)) return undefined;

  let port = '';
  try {
    port = new URL(ctx.webServer.getOrigin()).port;
  } catch {
    return undefined;
  }
  if (!port) return undefined;

  const env = { ...process.env };
  // ⚠️ 这个变量还在的话 Electron 会以纯 Node 模式启动 —— 窗口永远不出来，
  // 进程活着、日志没报错、桌面上什么都没有。dsh-pet 也踩过，别删这行。
  delete env.ELECTRON_RUN_AS_NODE;
  env.CC_HOST_PORT = port;
  env.CC_HOST_ROUTE = ROUTE;
  env.CC_HOST_PID = String(process.pid);
  // 桌面层的调试日志落在这儿（见 assets/desktop/main.js 的 ccLog）。
  // ⚠️ 路径由调用方传入 —— 这个函数是模块级的，看不到 apply() 里的 rootDir。
  env.CC_LOG = String(logFile || '');

  const tag = '[chuancheng-desktop]';
  const RESTART_WINDOW_MS = 60 * 60 * 1000;
  const RESTART_LIMIT = 5;
  /**
   * 撞上限流之后隔多久再试。**不能永久放弃** —— 2026-10-22 我调样式时手动杀了它 6 次，
   * 停在这儿之后再也没有拉起过，哥哥点体力条召唤不出 Live2D，看着就是功能坏了。
   * 5 分钟是权衡：真出环境问题也只是每 5 分钟一条日志，不刷屏；偶尔被连杀也能自己回来。
   */
  const RESTART_COOLDOWN_MS = 5 * 60 * 1000;
  const HEARTBEAT_GRACE_MS = 150000;   // 超过 150 秒没心跳 = 判死
  const WATCHDOG_MS = 30000;

  let child = null;
  /** 我们自己要关它了 —— 之后所有的退出都不该触发重启。 */
  let disposed = false;
  /** 最近的几次重启时间戳，用来限流。 */
  let restarts = [];
  let watchdog = null;
  let restartTimer = null;

  function launch(reason) {
    if (disposed) return;
    try {
      child = spawn(electronExe, [DESKTOP_MAIN], {
        cwd: homedir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      console.warn(`${tag} 启动失败：${error?.message ?? error}`);
      return;
    }
    desktopBeatAt = 0;   // 新进程还没报到，别拿旧心跳判它
    child.stderr?.on('data', (buf) => {
      const line = String(buf).trim();
      if (line) console.warn(`${tag} ${line}`);
    });
    child.stdout?.on('data', (buf) => {
      const line = String(buf).trim();
      if (line) console.log(`${tag} ${line}`);
    });
    child.once('error', (err) => console.warn(`${tag} 启动失败：${err.message}`));
    child.once('exit', (code) => {
      console.log(`${tag} 已退出（code=${code}）${reason ? ` · ${reason}` : ''}`);
      if (disposed) return;
      scheduleRestart('进程退出了');
    });
  }

  function scheduleRestart(reason) {
    if (disposed) return;
    const now = Date.now();
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (restarts.length >= RESTART_LIMIT) {
      // 重启太频繁说明是环境问题，不是偶发 —— 先停一下，别无声地刷屏。
      // 但**只能停一会儿**：一旦永久返回，桌面层就再也不存在了，
      // 而界面上没有任何提示，用户只会觉得"点体力条没反应、插件坏了"。
      console.warn(`${tag} 一小时里已经重启 ${restarts.length} 次，暂停自愈，`
        + `${Math.round(RESTART_COOLDOWN_MS / 60000)} 分钟后重试。原因：${reason}`);
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        restarts = [];              // 冷却结束，重新计数
        launch('冷却结束，再试一次');
      }, RESTART_COOLDOWN_MS);
      return;
    }
    restarts.push(now);
    const delay = 2000 * restarts.length;
    console.warn(`${tag} ${reason}，${delay / 1000} 秒后第 ${restarts.length} 次重启`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { restartTimer = null; launch(reason); }, delay);
  }

  launch('');

  // 看门狗：**进程活着但页面没加载上**只能靠这条发现。
  watchdog = setInterval(() => {
    if (disposed || !child) return;
    if (!desktopBeatAt) return;                     // 刚起来，还在宽限期内
    const silence = Date.now() - desktopBeatAt;
    if (silence <= HEARTBEAT_GRACE_MS) return;
    console.warn(`${tag} 心跳断了 ${Math.round(silence / 1000)} 秒，判定窗口卡死，重启`);
    desktopBeatAt = 0;
    try { child.kill(); } catch { /* 已经没了 */ }
    // exit 事件会走 scheduleRestart，不用在这里再调一次
  }, WATCHDOG_MS);

  return () => {
    disposed = true;
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    try { child?.kill(); } catch { /* 已经没了 */ }
  };
}

/** 代数：正数才认，0/负数一律当 1。 */
function clampedGen(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1) return Math.round(n);
  const f = Number(fallback);
  return Number.isFinite(f) && f >= 1 ? Math.round(f) : 1;
}

/** 桌面层最后一次心跳的时间戳。0 = 还没收到过。看门狗读它判断"窗口是不是卡死了"。 */
let desktopBeatAt = 0;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** 只接受本机请求 —— 设置卡片能改配置，不能让它从网络上被人摸到。 */
function denyNonLoopback(req, res) {
  const raw = String(req?.headers?.host || '').trim();
  if (!raw) return false;
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0];
  if (LOOPBACK_HOSTS.has(host.toLowerCase())) return false;
  json(res, 403, { ok: false, error: '只接受本机（回环地址）请求' });
  return true;
}

/** 读一个小体积 JSON 请求体。超过 limit 直接拒绝，不往内存里灌。 */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体太大'));
        try { req.destroy(); } catch { /* 已经关了 */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * 读**裸字节**请求体（语音 PCM 用）。和 readJsonBody 同一套限流思路，
 * 只是不解析 —— f32 样本直接进转发，中间过一道 JSON 反而脏。
 */
function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体太大'));
        try { req.destroy(); } catch { /* 已经关了 */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 把 body 参数规范成五段对象。接受 JSON 对象、JSON 字符串、或按段落的纯文本。 */
function normalizeHandoffBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  const raw = String(body ?? '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* 不是 JSON，按段落猜 */ }
  // 按「## 1. …」这类小标题切段，认得出来就用
  const out = {};
  const re = /##\s*\d+\.\s*([^\n]+)\n([\s\S]*?)(?=\n##\s*\d+\.|$)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const heading = m[1].trim();
    const sec = HANDOFF_SECTIONS.find((s) => heading.includes(s.title) || s.title.includes(heading));
    if (sec) out[sec.key] = m[2].trim();
  }
  return out;
}
