/**
 * 传承插件 · 会话日志读取
 *
 * **只在两个地方用**：①验收脚本复放历史样本；②手动检查某个会话。
 * 运行时监听走的是实时事件流（`session/event`），**一行压缩日志都不用解** ——
 * 这是相对方案 §2.5 的关键改进：不进 IO、没有解压成本、拿到的是最新一条。
 *
 * ---
 * ⚠️ 结构坑（3代用两次踩出来的，别重新摸索）：
 * `session.v4.jsonl.zstd` 是**追加式多帧** zstd —— 一个 10 MB 的文件里有几千个独立帧，
 * 而 Node 的 `zstdDecompressSync` **只解第一帧**。必须按 magic `28 B5 2F FD` 切帧后逐帧解。
 */
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LOG_FILE = 'session.v4.jsonl.zstd';

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

export function sessionsRoot() {
  return join(dshHome(), 'sessions');
}

/**
 * 按 zstd magic 找出每一帧的 [start, end)。
 * @param {Buffer} buf
 * @returns {Array<[number, number]>}
 */
export function frameRanges(buf) {
  const marks = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) {
      marks.push(i);
    }
  }
  const out = [];
  for (let k = 0; k < marks.length; k += 1) {
    out.push([marks[k], k + 1 < marks.length ? marks[k + 1] : buf.length]);
  }
  return out;
}

/**
 * 解一段 zstd buffer（可能是多帧）成事件数组。
 * @param {Buffer} buf
 * @param {{tailFrames?: number}} [options] tailFrames 只解最后 N 帧（增量读）
 * @returns {{events: object[], frames: number, badFrames: number}}
 */
export function decodeEvents(buf, options = {}) {
  let ranges = frameRanges(buf);
  const tail = Number(options.tailFrames) || 0;
  if (tail > 0 && ranges.length > tail) ranges = ranges.slice(-tail);

  const events = [];
  let badFrames = 0;
  for (const [start, end] of ranges) {
    let text;
    try {
      text = zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
    } catch {
      badFrames += 1;
      continue;
    }
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { events.push(JSON.parse(t)); } catch { /* 帧头 / 坏行 */ }
    }
  }
  return { events, frames: ranges.length, badFrames };
}

/**
 * 找全部会话日志。
 * @returns {Array<{id: string, ws: string, file: string, size: number, mtime: Date}>}
 */
export function listSessionLogs() {
  const root = sessionsRoot();
  const out = [];
  if (!existsSync(root)) return out;
  for (const ws of readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    let dirs;
    try { dirs = readdirSync(join(root, ws.name), { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const file = join(root, ws.name, d.name, LOG_FILE);
      if (!existsSync(file)) continue;
      let st;
      try { st = statSync(file); } catch { continue; }
      out.push({ id: d.name, ws: ws.name, file, size: st.size, mtime: st.mtime });
    }
  }
  return out.sort((a, b) => b.size - a.size);
}

/**
 * 按会话 id（精确或包含）找日志文件。
 * @param {string} idOrPart
 * @returns {string|null}
 */
export function findSessionLog(idOrPart) {
  const needle = String(idOrPart ?? '').trim();
  if (!needle) return null;
  const all = listSessionLogs();
  const exact = all.find((x) => x.id === needle);
  if (exact) return exact.file;
  const part = all.find((x) => x.id.includes(needle));
  return part ? part.file : null;
}

/**
 * 从事件数组里按顺序抽出「每一条 assistant 消息的思考文本 + 回复文本」。
 * @param {object[]} events
 * @returns {Array<{reasoning: string, text: string, content: any[], at: number}>}
 */
export function assistantMessages(events) {
  const out = [];
  let index = 0;
  for (const ev of events) {
    if (ev?.type !== 'assistant/message') continue;
    const content = ev?.data?.message?.content;
    if (!Array.isArray(content)) { index += 1; continue; }
    let reasoning = '';
    let text = '';
    for (const b of content) {
      if (!b || typeof b.text !== 'string') continue;
      if (b.type === 'reasoning') reasoning += b.text + '\n';
      else if (b.type === 'text') text += b.text + '\n';
    }
    out.push({ reasoning, text, content, at: index });
    index += 1;
  }
  return out;
}

/**
 * 读一个会话日志文件并解出事件。
 * @param {string} file
 * @param {{tailFrames?: number}} [options]
 */
export function readSessionFile(file, options = {}) {
  return decodeEvents(readFileSync(file), options);
}

/**
 * **只读文件末尾**再解 —— 回填历史用。
 *
 * 为什么要这么做：101 个会话日志一共 133 MB，全读一遍启动会卡住。
 * 但体力值只需要「最近若干条消息」，尾部 1.5 MB 就够（通常能覆盖几百帧）。
 *
 * ⚠️ 从文件中间截断时，缓冲区开头那一帧多半是**残缺的**。
 * 所以丢掉第一个 magic 之前的字节、**再从第二个 magic 起算**，
 * 保证参与解压的每一帧都是完整的。代价只是丢一帧，无所谓。
 *
 * @param {string} file
 * @param {number} [maxBytes]
 * @returns {{events: object[], frames: number, badFrames: number}}
 */
export function readTailEvents(file, maxBytes = 1.5 * 1024 * 1024) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, Math.max(65536, Number(maxBytes) || 0));
    const start = size - len;
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, start);

    if (start <= 0) return decodeEvents(buf);

    const marks = [];
    for (let i = 0; i + 4 <= buf.length; i += 1) {
      if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) {
        marks.push(i);
      }
    }
    if (marks.length === 0) return { events: [], frames: 0, badFrames: 0 };
    // 第一帧大概率残缺，从第二帧开始
    const from = marks.length > 1 ? marks[1] : marks[0];
    return decodeEvents(buf.subarray(from));
  } finally {
    closeSync(fd);
  }
}

/**
 * **只读文件开头**再解。
 *
 * 和 readTailEvents 对称：那个取「最近的体力值」，这个取「这个会话是从哪句话开始的」。
 * 用途只有一个 —— 会话没有标题时，拿她第一句用户消息当名字，
 * 总比显示「会话 …ec23」认得出是谁。
 *
 * 读 512 KB 就够（第一条 user/message 几乎必然在开头几帧）。
 * 文件更大的话尾部那半帧是被截断的，按 magic 切掉最后一段再解，别喂半截进去。
 *
 * @param {string} file
 * @param {number} [maxBytes]
 * @returns {{events: object[], frames: number, badFrames: number}}
 */
export function readHeadEvents(file, maxBytes = 512 * 1024) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, Math.max(65536, Number(maxBytes) || 0));
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, 0);
    if (len >= size) return decodeEvents(buf);
    const marks = [];
    for (let i = 0; i + 4 <= buf.length; i += 1) {
      if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) {
        marks.push(i);
      }
    }
    if (marks.length === 0) return { events: [], frames: 0, badFrames: 0 };
    // 最后一帧被文件截断了
    return decodeEvents(buf.subarray(0, marks[marks.length - 1]));
  } finally {
    closeSync(fd);
  }
}
