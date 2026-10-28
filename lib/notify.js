/**
 * 传承插件 · 提醒通知
 *
 * **出口由调用方注入（`send`）**。2026-10-22 哥哥把它从「QQ 私聊」改成了
 * 「让桌面上的她冒一个文字气泡」—— 这个文件不关心具体怎么送出去，
 * 只管**该不该送**（红线 / 每天配额 / 总开关）。
 *
 * ---
 * 三条纪律：
 *   1. **红线才说话。** 黄线只进记录，不骚扰哥哥（会议：同一会话一天最多 1~2 次）。
 *   2. **文案不许写成"提前预警"。** 红线代表**已经开始塌缩**，不是"快崩了"。
 *   3. **发送失败不许静默。** 写进插件日志，界面上看得到。
 */
import { fmtTime } from './util.js';
import { LEVEL } from './detect.js';

/**
 * @param {{
 *   log: Console,
 *   getConfig: () => object,
 *   send: (text: string) => Promise<{ok: boolean, reason?: string}>,
 *   readDaily: () => object,
 *   writeDaily: (value: object) => void,
 *   fmtDay: (ts?: number) => string,
 * }} deps
 */
export function createNotifier({ log, getConfig, send, readDaily, writeDaily }) {
  const recent = [];   // 最近的提醒记录（界面展示用，最多 50 条）

  /**
   * 判断这次该不该真的发出去。
   * @returns {{allow: boolean, reason?: string}}
   */
  function admit(alert) {
    const cfg = getConfig();
    if (cfg.enabled !== true) return { allow: false, reason: '插件总开关关闭' };

    // 黄线不打扰：只进记录（会议室结论 —— 黄线不是预警，它响了该去看一眼，
    // 但不该像红线一样把哥哥拽过来）
    if (alert.level !== LEVEL.RED) return { allow: false, reason: '黄线只记录不提醒' };

    const limit = Math.max(1, Number(cfg.notifyDailyLimit) || 2);
    const daily = readDaily();
    const entry = daily?.[alert.sessionId];
    const count = Number(entry?.count ?? 0);

    // 同一个会话同一天，红线也不超过上限（防一条会话崩出几十条消息时刷屏）
    if (count >= limit) return { allow: false, reason: `今天已经提醒过 ${count} 次（上限 ${limit}）` };

    // 2026-10-22：原来这里还有一道「必须先配 notifyBotId / notifyTargetId」的闸，
    // 那是 QQ 通道的遗留。现在出口是桌面气泡，没有目标可配，删掉。
    return { allow: true };
  }

  /** 记一次提醒（成功失败都记，避免"发失败 → 重试 → 刷屏"）。 */
  function bumpDaily(sessionId) {
    const daily = readDaily();
    const prev = daily?.[sessionId] ?? { day: '', count: 0 };
    const today = todayKey();
    const next = prev.day === today ? { day: today, count: Number(prev.count ?? 0) + 1 } : { day: today, count: 1 };
    writeDaily({ ...daily, [sessionId]: next });
    return next;
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * 处理一条告警。
   * @param {object} alert createMonitor 传上来的对象
   */
  async function handle(alert) {
    const decision = admit(alert);
    const record = {
      at: Date.now(),
      atText: fmtTime(Date.now()),
      level: alert.level,
      sessionId: alert.sessionId,
      title: alert.title,
      latest: alert.verdict?.latest ?? 0,
      windowPeak: alert.verdict?.windowPeak ?? 0,
      reasons: alert.verdict?.reasons ?? [],
      delivered: false,
      skipped: decision.allow ? null : decision.reason,
    };

    if (!decision.allow) {
      push(record);
      if (alert.level === LEVEL.RED) {
        log.warn?.(`[chuancheng] 红线告警未发送（${decision.reason}）：${alert.title || alert.sessionId}`);
      }
      return record;
    }

    const text = renderAlert(alert);
    try {
      const result = await send(text, alert);   // alert 一起给：气泡要拿 sessionId / level / latest
      if (result?.ok) {
        record.delivered = true;
        bumpDaily(alert.sessionId);
      } else {
        record.skipped = result?.reason ?? '发送失败';
        log.warn?.(`[chuancheng] 提醒发送失败：${record.skipped}`);
      }
    } catch (error) {
      record.skipped = String(error?.message ?? error);
      log.warn?.(`[chuancheng] 提醒发送异常：${record.skipped}`);
    }
    push(record);
    return record;
  }

  function push(record) {
    recent.unshift(record);
    if (recent.length > 50) recent.length = 50;
  }

  /** 最近的提醒（界面展示）。 */
  function history() {
    return [...recent];
  }

  return { handle, history, admit };
}

/**
 * 渲染提醒文案。
 *
 * ⚠️ 措辞纪律：红线**不是**"提前预警"。它是"已经开始塌缩了"。
 * 哥哥看到这条消息时不该以为还有时间慢慢收尾。
 */
export function renderAlert(alert) {
  const name = alert.title || alert.sessionId;
  const latest = Number(alert.verdict?.latest ?? 0);
  const s = alert.sample || {};
  const runPart = Number(s.maxRun ?? 0) > 1 ? `连续重复 ${s.maxRun} 行` : '';
  const idlePart = Number(s.idleMax ?? 0) > 1 ? `「${s.idleWord}」重复 ${s.idleMax} 次` : '';
  const shape = [runPart, idlePart].filter(Boolean).join(' + ') || `塌缩强度 ${latest}`;
  const lines = [];

  if (alert.level === LEVEL.RED) {
    lines.push('⚠️ 传承插件 · 注意力红线');
    lines.push('');
    lines.push(`会话「${name}」的思考里出现了塌缩。`);
    lines.push('');
    lines.push(`· 这一次：${shape}`);
    lines.push(`· 塌缩强度：${latest}`);
    lines.push(`· 最近窗口峰值：${alert.verdict?.windowPeak ?? latest}`);
    if (alert.verdict?.reasons?.length) {
      for (const r of alert.verdict.reasons) lines.push(`· ${r}`);
    }
    lines.push('');
    lines.push('说清楚一件事：**红线不代表"快崩了"，它代表已经开始塌缩。**');
    lines.push('本机会话里正常的思考塌缩强度从不超过 8 —— 中间是空的。');
    lines.push('');
    lines.push('要不要让它收尾、什么时候收，你说了算。插件不动手。');
  } else {
    lines.push('🟡 传承插件 · 黄线记录');
    lines.push('');
    lines.push(`会话「${name}」连续两次采样越过黄线。`);
    lines.push(`· 这一次：${shape}（强度 ${latest}）`);
    lines.push('');
    lines.push('黄线不是预警，是「接住崩溃前最后一次呼吸」—— 它只说明该去看一眼。');
  }

  lines.push('');
  lines.push(`（${fmtTime(Date.now())}）`);
  return lines.join('\n');
}
