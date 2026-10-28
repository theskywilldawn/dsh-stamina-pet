/**
 * 传承插件 · 模块 A 运行时（事件流监听）
 *
 * ---
 * 🔑 **这是相对方案 §2.5 的关键改进**：不读压缩日志，直接听 `session/event`。
 *
 * 方案说"每轮全量解压几十 MB 日志不现实，建议增量读最后几个 zstd 帧"。
 * 对了一半 —— 但**根本不用解压**：会话的每一条 `assistant/message` 事件本来就带着
 * `data.message.content[]`（含 reasoning 块），插件挂上监听就实时拿到。
 *
 *   零 IO · 零解压 · 零缓存 · 拿到的就是刚生成的那一条
 *
 * 日志解码（lib/logreader.js）只在两处用：验收回放、手动检查历史会话。
 *
 * ---
 * ⚠️ 判决落点：**每一条 assistant 消息都判一次**，不等 turn 结束。
 * 理由：实测崩溃就发生在**单条消息内**（13740 行全在一条里）。
 * 等 turn 结束再判，那条消息很可能就是这一轮的最后一条 —— 等于等它崩完才响。
 */
import { analyzeMessage, detectRepeatRequest, inputIdleMax } from './metrics.js';
import { judge, yellowStreakOf, LEVEL, RED_LINE, YELLOW_LINE } from './detect.js';

/** 每个会话最多留这么多历史样本（够窗口 + 回溯，不撑内存）。 */
const MAX_SERIES = 400;

/**
 * 输入侧的中毒线（只观测，**不进判决**）。
 *
 * 2026-10-21 全量实测 1276 条工具结果：正常结果里单字空转词最多 6 次，
 * 两个毒样本分别是 40 和 169。中间是空的。所以 20 这条线两边都留了余量。
 */
const INPUT_YELLOW = 20;
const INPUT_RED = 40;

/**
 * 上下文窗口的兜底值。
 *
 * 正常应该从 `request/context` 事件里的 `data.contextWindow` 拿（本机实测 deepseek-flash 是
 * 1048576，换模型会再发一条）。这个常量只在**老会话没发过那条事件**时兜底，
 * 用了兜底值会在快照里标 `contextWindowKnown: false`，界面上能看出来。
 */
const DEFAULT_CONTEXT_WINDOW = 1048576;
/** 多久没有新消息就算这个会话"睡了"（只用于状态清理，不影响判决）。 */
const IDLE_MS = 6 * 60 * 60 * 1000;

/**
 * @param {{
 *   log: Console,
 *   getConfig: () => object,
 *   onAlert: (alert: object) => void,
 * }} deps
 */
export function createMonitor({ log, getConfig, onAlert, contextSeed = null }) {
  /** sessionId → 运行时状态 */
  const states = new Map();

  function ensure(sessionId, session) {
    let st = states.get(sessionId);
    if (st) return st;
    // 重启前存下来的上下文用量：这个会话要是还没跑过新一轮，至少先显示上次的数字，
    // 别一重启就整片变成"满体力"（哥哥 2026-10-22 报的就是这个）。
    const seedCtx = contextSeed && contextSeed[sessionId] ? contextSeed[sessionId] : null;
    st = {
      sessionId,
      title: titleOf(session),
      activity: null,   // { name, at } —— 最近一次工具调用，给活动气泡用
      series: [],
      samples: 0,
      reasoningMsgs: 0,
      skipped: 0,          // 行数不够、不参与判决的消息数
      compactions: 0,      // 压缩次数（只给「多指标模式」展示，**不进判决**）
      peak: 0,             // 塌缩强度峰值（= max(连续重复, 空转词最高频次)）
      idlePeak: 0,         // 只留诊断用：空转词最高频次单独峰值
      idlePeakWord: '',
      runPeak: 0,          // 只留诊断用：连续重复行数单独峰值
      lastAt: 0,
      lastVerdict: null,
      lastSample: null,
      // 「约束第二次被提起」：人在本会话里把同一句要求重复了几次（只有显式语气才计）
      repeatHits: 0,
      repeatLatest: null,
      // 输入侧：工具结果的毒性（第三路监测，**只观测，不进判决**）
      inputMax: 0,         // 单条工具结果里，单个空转字最多出现几次（峰值）
      inputWord: '',
      inputChars: 0,
      inputHits: 0,        // 越过「有毒」线的工具结果条数
      inputLatest: null,   // 最近一次：{ at, max, word, chars }
      // ── 上下文用量（双体力条里那条「大条」的数据源）──
      // 窗口上限从 request/context 事件拿（换模型会重发），拿不到就用 DEFAULT_CONTEXT_WINDOW 兜底
      contextWindow: (seedCtx && Number(seedCtx.contextWindow)) || DEFAULT_CONTEXT_WINDOW,
      contextWindowKnown: Boolean(seedCtx && seedCtx.contextWindowKnown),
      contextTokens: (seedCtx && Number(seedCtx.contextTokens)) || 0,
      usedPct: (seedCtx && Number(seedCtx.usedPct)) || 0,
    };
    states.set(sessionId, st);
    return st;
  }

  function titleOf(session) {
    const t = session?.title ?? session?.name ?? '';
    return typeof t === 'string' ? t : '';
  }

  /**
   * user/message 的正文在 `data.content` —— 注意**不是** `data.message.content`
   * （assistant 那条才是 message.content，两边结构不一样）。
   */
  function userTextOf(event) {
    const c = event?.data?.content;
    if (!Array.isArray(c)) return '';
    return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  }

  /**
   * tool/result 的正文在 `data.message.content[]` —— 和 assistant 一样走 `message`，
   * 不像 user/message 那样直接在 `data.content`。多个文本块拼起来。
   */
  function toolResultTextOf(event) {
    const c = event?.data?.message?.content;
    if (!Array.isArray(c)) return '';
    return c.filter((b) => typeof b?.text === 'string').map((b) => b.text).join('\n');
  }

  /**
   * 单条消息 → 采样 → 判决。
   * @param {object} session 会话对象（至少带 id）
   * @param {object} event 会话事件
   * @returns {{sampled: boolean, verdict: object|null, state: object}}
   */
  function handleEvent(session, event) {
    const sessionId = String(session?.id ?? '');
    if (sessionId === '') return { sampled: false, verdict: null, state: null };

    // 压缩次数只做「多指标模式」的展示用 —— **不进判决**（9 次压缩的会话照样健康）
    // ── 她此刻在干什么（活动气泡，2026-10-22 哥哥要的）──────────────
  // 抄的是 Coopanion 的 Activity bubbles：把「正在读文件 / 正在跑命令」摊在她身边。
  // 数据源就是 tool/call —— 里面有 name 和 arguments。
  // 只记 name + 时间：参数动辄几 KB（有的还是整段脚本），原样带给前端会把接口撑爆。
  if (event?.type === 'tool/call') {
    const stT = ensure(sessionId, session);
    const name = String(event?.data?.name || '');
    if (name) {
      stT.activity = { name, at: Date.now() };
      stT.lastAt = Date.now();
    }
    return { sampled: false, verdict: null, state: stT };
  }

  if (event?.type === 'compaction/end') {
      const st0 = ensure(sessionId, session);
      st0.compactions += 1;
      st0.lastAt = Date.now();
      return { sampled: false, verdict: null, state: st0 };
    }

    // ── 上下文窗口上限（双体力条里「大条」的分母）──────────────────
    // 宿主在会话跑起来时发一条 `request/context`：{ provider, model, contextWindow }，
    // 换模型会再发。没有它就没有分母，所以必须单独接住，不能等 assistant/message 才想起。
    // 本机实测 deepseek-flash = 1048576。
    if (event?.type === 'request/context') {
      const stC = ensure(sessionId, session);
      stC.lastAt = Date.now();
      const cw = Number(event?.data?.contextWindow);
      if (Number.isFinite(cw) && cw > 0) {
        stC.contextWindow = cw;
        stC.contextWindowKnown = true;
        // 分母变了就立刻重算，不用等下一轮
        if (stC.contextTokens > 0) {
          stC.usedPct = Math.min(100, Math.round((stC.contextTokens / cw) * 1000) / 10);
        }
        log.info?.(`[chuancheng] 上下文窗口 ${cw}（${event?.data?.model ?? '?'}）：${sessionId}`);
      }
      return { sampled: false, verdict: null, state: stC };
    }

    // ── 「约束第二次被提起」──────────────────────────────────────────
    // 这一路读的不是模型的输出，而是**人说的话** —— 模型改不了它，也美化不了它。
    //
    // ⚠️ 必须卡 `source.kind === 'user'`。会话里的 user/message 一共 9 种来源，
    //    只有 'user' 是人亲手打的，其余全是系统注入：
    //      dsh-mnemon（记忆快照）/ runtime-context / skill-catalog / agent-instructions
    //      / compact-checkpoint（压缩摘要）/ xiaoxingchen-meeting / model-selection / tool-jobs
    //    2026-10-21 实测：不卡这一条，会在 dsh-mnemon 的记忆快照里误命中「又自作主张」。
    //
    // 语义上它只抓显式语气（"我说过了""不是让你""我让你A没让你B"），
    // 心平气和地重复一遍不会被记 —— 宁可漏，不要误报。详见 metrics.detectRepeatRequest。
    if (event?.type === 'user/message') {
      const stU = ensure(sessionId, session);
      stU.lastAt = Date.now();
      if (event?.data?.source?.kind === 'user') {
        const text = userTextOf(event);
        const hit = detectRepeatRequest(text);
        if (hit) {
          stU.repeatHits = (stU.repeatHits ?? 0) + 1;
          stU.repeatLatest = {
            at: Date.now(),
            phrase: hit,
            snippet: text.replace(/\s+/g, ' ').slice(0, 120),
          };
          log.info?.(`[chuancheng] 同一约束第 ${stU.repeatHits} 次被提起（${hit}）：${sessionId}`);
        }
      }
      return { sampled: false, verdict: null, state: stU };
    }

    // ── 输入侧：工具结果 → 毒性（第三路监测，只观测，不进判决） ──
    // 为什么要监这一路：崩溃会通过「读到崩溃」二次感染 —— 她自己把七千多行
    // 「好。」读回上下文，当场又崩一次（2026-10-21 实测，169 个「好」）。
    // 只看她吐出来什么，看不见她被喂回去什么。
    if (event?.type === 'tool/result') {
      // 工具跑完 = 这一段活干完了，活动气泡立刻收掉（2026-10-23 哥哥：
      // 「你这边已经干完活了，但这个正在做的气泡还在显示中」）。
      // /api/avatars 那边还有一道 90 秒的过期兜底，但那是给"事件丢了"准备的 ——
      // 拿它当正常收尾，干完活还挂一分半，看起来就是没反应。
      const stR = states.get(sessionId);
      if (stR) stR.activity = null;
      const text = toolResultTextOf(event);
      if (text !== '') {
        const stI = ensure(sessionId, session);
        stI.lastAt = Date.now();
        const hit = inputIdleMax(text);
        stI.inputChars = (stI.inputChars ?? 0) + hit.chars;
        if (hit.max > 0) {
          if (hit.max > (stI.inputMax ?? 0)) {
            stI.inputMax = hit.max;
            stI.inputWord = hit.word;
          }
          if (hit.max >= INPUT_YELLOW) {
            stI.inputHits = (stI.inputHits ?? 0) + 1;
            log.info?.(`[chuancheng] 输入毒性 ${hit.word}×${hit.max}（${hit.chars} 字）：${sessionId}`);
          }
          stI.inputLatest = { at: Date.now(), max: hit.max, word: hit.word, chars: hit.chars };
        }
      }
      return { sampled: false, verdict: null, state: states.get(sessionId) ?? null };
    }

    if (event?.type !== 'assistant/message') return { sampled: false, verdict: null, state: states.get(sessionId) ?? null };

    const cfg = getConfig();
    if (cfg.enabled !== true) return { sampled: false, verdict: null, state: null };

    const content = event?.data?.message?.content;
    if (!Array.isArray(content)) return { sampled: false, verdict: null, state: states.get(sessionId) ?? null };

    const st = ensure(sessionId, session);
    if (titleOf(session) !== '') st.title = titleOf(session);
    st.lastAt = Date.now();

    // ── 上下文用量（大条）──
    // `usage.totalTokens` = inputTokens + cacheReadTokens + outputTokens，就是这一轮请求
    // 实际背着的上下文大小。分母来自 request/context（拿不到就兜底）。
    // ⚠️ 这个数**不进判决** —— 它衡量的是"装了多少"，不是"还清醒不清醒"。
    const usage = event?.data?.usage;
    const tot = Number(usage?.totalTokens);
    if (Number.isFinite(tot) && tot > 0) {
      st.contextTokens = tot;
      const cw = Number(st.contextWindow) || DEFAULT_CONTEXT_WINDOW;
      st.usedPct = Math.min(100, Math.round((tot / cw) * 1000) / 10);
    }

    const m = analyzeMessage(content);
    st.lastSample = m;
    if (m.hasReasoning) st.reasoningMsgs += 1;

    // 行数不足 6 的思考不参与判决（与验收脚本同一口径）
    if (!m.enough) {
      st.skipped += 1;
      return { sampled: false, verdict: null, state: st };
    }

    st.series.push(m.collapse);
    if (st.series.length > MAX_SERIES) st.series = st.series.slice(-MAX_SERIES);
    st.samples += 1;
    if (m.collapse > st.peak) st.peak = m.collapse;
    if ((m.idleMax ?? 0) > (st.idlePeak ?? 0)) {
      st.idlePeak = m.idleMax;
      st.idlePeakWord = m.idleWord;
    }
    if ((m.maxRun ?? 0) > (st.runPeak ?? 0)) st.runPeak = m.maxRun;

    const verdict = judge(
      {
        series: st.series,
        windowSize: cfg.windowSize,
        // 用「这条之前的序列」还原黄线连续次数，避免把当前这条算两遍
        yellowStreak: yellowStreakOf(st.series.slice(0, -1), cfg.yellowThreshold),
        hasReasoning: st.reasoningMsgs > 0,
        samples: st.samples,
      },
      { redLine: cfg.redThreshold, yellowLine: cfg.yellowThreshold },
    );
    st.lastVerdict = verdict;

    if (verdict.level === LEVEL.RED || verdict.level === LEVEL.YELLOW) {
      try {
        onAlert({
          level: verdict.level,
          sessionId,
          title: st.title,
          verdict,
          sample: m,
          state: snapshotOf(st),
        });
      } catch (error) {
        log.warn?.(`[chuancheng] onAlert 失败: ${String(error)}`);
      }
    }
    return { sampled: true, verdict, state: st };
  }

  /** 序列里的最大值（快照兜底用：回填后 lastVerdict 可能还没算）。 */
  function peakOf(list) {
    let max = 0;
    for (const v of Array.isArray(list) ? list : []) if (Number.isFinite(v) && v > max) max = v;
    return max;
  }

  function snapshotOf(st) {
    return {
      sessionId: st.sessionId,
      title: st.title,
      activity: st.activity ?? null,
      samples: st.samples,
      reasoningMsgs: st.reasoningMsgs,
      skipped: st.skipped,
      compactions: st.compactions,
      peak: st.peak,
      idlePeak: st.idlePeak ?? 0,
      idlePeakWord: st.idlePeakWord ?? '',
      runPeak: st.runPeak ?? 0,
      latest: st.series.length ? st.series[st.series.length - 1] : 0,
      latestIdle: st.lastSample?.idleMax ?? 0,
      latestIdleWord: st.lastSample?.idleWord ?? '',
      latestRun: st.lastSample?.maxRun ?? 0,
      windowPeak: st.lastVerdict?.windowPeak ?? peakOf(st.series),
      trendStreak: st.lastVerdict?.trendStreak ?? 0,
      level: st.lastVerdict?.level ?? LEVEL.OK,
      degraded: st.reasoningMsgs === 0,
      // 「约束第二次被提起」的累计次数 + 最近一次命中的证据（只展示，不进判决）
      repeatHits: st.repeatHits ?? 0,
      repeatLatest: st.repeatLatest ?? null,
      // 输入侧毒性（第三路监测，只观测，不进判决）
      inputMax: st.inputMax ?? 0,
      inputWord: st.inputWord ?? '',
      inputChars: st.inputChars ?? 0,
      inputHits: st.inputHits ?? 0,
      inputLatest: st.inputLatest ?? null,
      // 上下文用量（双体力条的「大条」）：已用百分比 / 已用 token / 窗口上限 / 上限是不是宿主给的
      usedPct: st.usedPct ?? 0,
      contextTokens: st.contextTokens ?? 0,
      contextWindow: st.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      contextWindowKnown: st.contextWindowKnown === true,
      lastAt: st.lastAt,
      window: st.series.slice(-Math.max(1, Number(getConfig().windowSize) || 30)),
    };
  }

  /** 全部会话的快照（界面用，按最近活动排序）。 */
  function snapshot() {
    const list = [...states.values()].map(snapshotOf);
    list.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    return list;
  }

  /** 单个会话快照。 */
  function snapshotOfSession(sessionId) {
    const st = states.get(String(sessionId ?? ''));
    return st ? snapshotOf(st) : null;
  }

  /** 清掉长时间没动静的会话状态（内存卫生，不影响正确性）。 */
  function sweep(now = Date.now()) {
    let removed = 0;
    for (const [id, st] of states) {
      if (now - (st.lastAt || 0) > IDLE_MS) { states.delete(id); removed += 1; }
    }
    return removed;
  }

  /**
   * **回填历史** —— 让体力值跨 DSH 重启接得上。
   *
   * 为什么必须要有这一步：插件只能在挂载之后听到 `session/event`。
   * 实测一个跑了 863 条消息、注意力已经崩过的会话，
   * 插件只采到其中 12 条（全是崩溃之后恢复正常的那几条）——
   * 于是血条满格，判据改了也一样满格。**不看历史，体力就永远是满的。**
   *
   * 只在该会话还没有任何实时样本时回填；已经有实时数据就不覆盖。
   *
   * @param {string} sessionId
   * @param {object|null} session
   * @param {Array<{content: any[]}>} messages 从日志里解出来的 assistant 消息（按时间正序）
   * @param {number} [at] 这些消息的时刻（用日志 mtime，避免把老会话顶成"刚刚活跃"）
   * @returns {number} 实际采进序列的条数
   */
  function backfill(sessionId, session, messages, at) {
    const id = String(sessionId ?? '');
    if (id === '' || !Array.isArray(messages) || messages.length === 0) return 0;
    const st = ensure(id, session);
    if (st.samples > 0) return 0;

    const cfg = getConfig();
    let added = 0;
    for (const m of messages) {
      const a = analyzeMessage(m?.content);
      if (a.hasReasoning) st.reasoningMsgs += 1;
      if (!a.enough) { st.skipped += 1; continue; }
      st.series.push(a.collapse);
      st.samples += 1;
      added += 1;
      if (a.collapse > st.peak) st.peak = a.collapse;
      if (a.idleMax > (st.idlePeak ?? 0)) { st.idlePeak = a.idleMax; st.idlePeakWord = a.idleWord; }
      if (a.maxRun > (st.runPeak ?? 0)) st.runPeak = a.maxRun;
    }
    if (st.series.length > MAX_SERIES) st.series = st.series.slice(-MAX_SERIES);
    if (added === 0) return 0;

    st.lastAt = Number(at) || Date.now();
    st.lastSample = null;
    st.lastVerdict = judge(
      {
        series: st.series,
        windowSize: cfg.windowSize,
        yellowStreak: yellowStreakOf(st.series.slice(0, -1), cfg.yellowThreshold),
        hasReasoning: st.reasoningMsgs > 0,
        samples: st.samples,
      },
      { redLine: cfg.redThreshold, yellowLine: cfg.yellowThreshold },
    );
    return added;
  }

  /**
   * 从会话日志回填上下文用量（**只补空，不覆盖新数据**）。
   *
   * 为什么需要这一手：`usedPct` 只有**本进程接到过一轮请求**之后才有值
   * （handleEvent 里那条 usage 分支）。DSH 一重启，那些没再跑过新一轮的会话
   * contextTokens 就还是 0 —— 界面上看就是"一整片满体力"，可它们各自其实
   * 都背着几十万 token（2026-10-24 实测：插件·3代 52.1%、测试会话 37.7%，
   * 在界面上全是 0%）。
   *
   * 真值在会话日志尾部那条 `assistant/message.usage.totalTokens` 里，读一次就够。
   * 回填成功后 contextTokens > 0，下次调用自然跳过 —— 每个会话只会读一次日志。
   *
   * @param {string} sessionId
   * @param {{contextTokens:number, contextWindow?:number, contextWindowKnown?:boolean}} ctx
   * @returns {boolean} 真的写进去了才返回 true
   */
  function applyContext(sessionId, ctx) {
    const st = states.get(String(sessionId ?? ''));
    if (!st || !ctx) return false;
    // 已经有数就不动 —— 实时采到的永远比日志里那条新
    if ((st.contextTokens ?? 0) > 0) return false;
    const tot = Number(ctx.contextTokens) || 0;
    if (tot <= 0) return false;
    const win = Number(ctx.contextWindow) || DEFAULT_CONTEXT_WINDOW;
    st.contextWindow = win;
    st.contextWindowKnown = ctx.contextWindowKnown === true;
    st.contextTokens = tot;
    st.usedPct = Math.min(100, Math.round((tot / win) * 1000) / 10);
    return true;
  }

  /**
   * 导出上下文用量缓存 —— 宿主定期存盘，DSH 重启后靠它恢复。
   * 只导有数据的（contextTokens > 0），空会话不必占位置。
   */
  function contextSnapshot() {
    const out = {};
    for (const [id, st] of states) {
      if ((st.contextTokens ?? 0) > 0) {
        out[id] = {
          usedPct: st.usedPct ?? 0,
          contextTokens: st.contextTokens ?? 0,
          contextWindow: st.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          contextWindowKnown: st.contextWindowKnown === true,
          at: st.lastAt ?? 0,
        };
      }
    }
    return out;
  }

  return { handleEvent, snapshot, snapshotOfSession, sweep, backfill, contextSnapshot, applyContext, states, RED_LINE, YELLOW_LINE };
}
