/**
 * 传承插件 · 零依赖小工具
 *
 * 与 DSH 无关的纯函数 + 文件写入，方便脱开宿主单测。
 * 结构照 `dsh-littlestar-meeting/lib/util.js`，家里插件保持同一个手感。
 */
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

/**
 * 原子写 JSON：先写 .tmp，再 rename 覆盖。
 *
 * ⚠️ **绝不要用 PowerShell 的 `Set-Content -Encoding utf8` 写 JSON** ——
 * 它会写 UTF-8 BOM，DSH 启动时 `JSON.parse` 直接崩（插件·1代用血换的教训）。
 * 这个函数就是唯一正确的写法。
 */
export function atomicWriteJson(file, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, { encoding: 'utf8' });
  try {
    renameSync(tmp, file);
  } catch (error) {
    try {
      renameSync(tmp, file);
    } catch {
      try { unlinkSync(tmp); } catch { /* 清理失败不掩盖原始错误 */ }
      throw error;
    }
  }
  return text.length;
}

/** 原子写文本（交接文档 / 告别词用）。 */
export function atomicWriteText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, { encoding: 'utf8' });
  try {
    renameSync(tmp, file);
  } catch (error) {
    try {
      renameSync(tmp, file);
    } catch {
      try { unlinkSync(tmp); } catch { /* 同上 */ }
      throw error;
    }
  }
  return text.length;
}

/** 本地时间字符串。 */
export function fmtTime(ts, zone = 'Asia/Shanghai') {
  try {
    return new Date(ts).toLocaleString('zh-CN', { timeZone: zone, hour12: false });
  } catch {
    return new Date(ts).toISOString();
  }
}

/** 只到日期的字符串（文件名、日志行用）。 */
export function fmtDay(ts = Date.now(), zone = 'Asia/Shanghai') {
  try {
    const d = new Date(ts);
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}${get('month')}${get('day')}`;
  } catch {
    return new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
  }
}

/** 截短长文本。 */
export function clip(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** 会话标题兜底：没有标题就用短 id。 */
export function shortId(sessionId) {
  const s = String(sessionId ?? '');
  if (s === '') return '(未知会话)';
  return s.length <= 14 ? s : `${s.slice(0, 8)}…${s.slice(-4)}`;
}

/** 请求 id。 */
export function newRequestId(prefix = 'stamina-pet') {
  return `${prefix}-${randomUUID()}`;
}

/** 安全文件名：把 Windows 不允许的字符换掉。 */
export function safeFileName(name, fallback = '未命名') {
  const s = String(name ?? '').trim();
  if (s === '') return fallback;
  const cleaned = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '·').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? fallback : cleaned.slice(0, 120);
}

/** 数值夹取。 */
export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
