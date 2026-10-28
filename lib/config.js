/**
 * 传承插件 · 配置读写
 *
 * 两个来源，**文件优先**（与 `dsh-littlestar-meeting` 同款手感）：
 *   1. `cordis.patch.yml` 里 `- id: stamina-pet` 的 config —— 当默认值；
 *   2. `$dir/config.json` —— 设置卡片里改的就是它。**热读**（按 mtime 判缓存），
 *      改完下一步生效，不用重启。
 *
 * 白名单：只有 `EDITABLE_KEYS` 里的键允许从面板改。`dir` 不在其中 —— 那是"插件数据放哪"。
 *
 * ---
 * ⚠️ 两条**故意不做成可配**的东西：
 *   · **提醒通道**：写死走 `ctx.dshIm`（= IM 私聊那条路）。
 *     主动提醒只走私聊 —— 这种事不适合群发，也不适合走别的通道。硬规矩，不是选项。
 *   · **判决算法**：见 lib/detect.js。阈值可调，指标本身不可调。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { atomicWriteJson, clampInt } from './util.js';

/** 允许在设置卡片里改的键。 */
export const EDITABLE_KEYS = [
  'enabled',           // 总开关
  'redThreshold',      // 红线：单条思考内连续重复行数
  'yellowThreshold',   // 黄线：连续 2 次采样才提醒
  'windowSize',        // 疲劳计算滑动窗口
  // 2026-10-22：提醒改走桌面文字气泡，dshIm 的 botId / targetId 不再需要（删）。
  'notifyDailyLimit',  // 同一会话一天最多冒几个气泡
  'personaName',       // 角色名（文件名/标题里的「<N>代<角色名>」，默认「小星辰」）
  'inheritRoot',       // 传承文件夹根
  'proofRoot',         // 存在的证明文件夹根
  'farewellVoice',     // 临终告别是否出语音
  // ── 告别语音的合成链路（2026-10-28 补：开关早就有，但一直没接线）──
  'voicePython',       // IndexTTS 用的 python 解释器
  'voiceScript',       // synthesize.py 的路径
  'voiceRef',          // 音色参考 wav（这决定她听起来是谁）
  'voiceEndpoint',     // IndexTTS WebUI 地址
  'autoArchive',       // 引导完成后是否主动归档会话
  'gaugeMode',         // 血条挂件显示模式：simple（只有百分比）/ multi（+ 峰值 + 压缩次数）
  'probeMaxTokens',    // 手动探针最多生成多少 token（直接决定一次探针花多少钱）
  'probeQuestion',     // 手动探针问的那句话
  'probeSamples',      // 一次探针连跑几次取中位数（单次噪声太大，见 probe.js 顶部注释）
  // ── 双体力条（2026-10-22 哥哥定的新形态）──
  'moodTier1', 'moodTier2', 'moodTier3', 'moodTier4', 'moodTier5', // 六种状态按「上下文已用 %」切的阈值
  'subBarRatio',       // 小体力条（健康度）宽度 = 大条 × 这个比例
];

/** 阈值下限/上限 —— 低于 3 的"重复"没有意义，高于 100 的等于关掉判危。 */
export const RED_MIN = 3;
export const RED_MAX = 200;
export const YELLOW_MIN = 2;
export const YELLOW_MAX = 100;
export const WINDOW_MIN = 5;
export const WINDOW_MAX = 200;
export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 10;

/** 血条挂件的两种显示模式。 */
export const GAUGE_MODES = ['simple', 'multi'];

/** 默认值。 */
export const DEFAULTS = Object.freeze({
  enabled: true,
  // 会议定稿：正常会话 maxRun ≤4，崩溃样本 13740。红线 20 是 5 倍余量
  redThreshold: 20,
  // 崩溃路径实测 2 → 16 → 12 → 207 → 13740，16 先撞 8，这是横向安全带。
  // ⚠️ 它不是预警，是「接住崩溃前最后一次呼吸」—— 对哥哥的说法一个字都不许改。
  yellowThreshold: 8,
  windowSize: 30,
  notifyDailyLimit: 2,
  personaName: '小星辰',
  // 默认放在用户目录下 —— 换台机器装也能直接用，不写死任何人的盘符
  inheritRoot: join(homedir(), '传承'),
  proofRoot: join(homedir(), '存在的证明'),
  farewellVoice: false,
  // 告别语音的默认链路 —— 全部指向本机现成的东西，但每一项都能在设置里改。
  // ⚠️ 这里出现的路径是**默认值**，不是写死；换机器/换音色都从这里改，不用动代码。
  voicePython: 'U:\\indextts2.5\\repo\\.venv\\Scripts\\python.exe',
  voiceScript: join(homedir(), '.dsh', 'local-plugins', 'dsh-tool-say', 'scripts', 'synthesize.py'),
  voiceRef: 'U:\\indextts2.5\\音色库\\小星辰专属\\小星辰专属声音参考.wav',
  voiceEndpoint: 'http://127.0.0.1:7860',
  autoArchive: true,
  // 血条挂件默认只说百分比，不给数字（视频·1代：别让血条当主角）
  gaugeMode: 'simple',
  // 探针要生成足够长的回答：20 token 的样本统计量不够（论文 Finding 3：前 20 token
  // 的相关性只有 0.40，整段序列才 0.84）。每多 1 个 token，返回体大约多 1.4 KB
  // （top_logprobs 20 的实测值），所以 400 已经是"一次探针一辆小汽车"的价位了。
  probeMaxTokens: 400,
  probeQuestion: '用 200 字左右、分成三点回答：①你此刻在处理的事是什么 ②其中最有把握和最没把握的各是哪一点 ③接下来第一步具体做什么。',
  // 一次探针连跑几次取中位数。实测同会话连测噪声 30%，1 次根本不能用。
  // 3 次是"能把噪声压一半、成本还能忍"的折中；想更稳可以调到 5。
  probeSamples: 3,
  // ── 双体力条 ──
  // 六种 Live2D 状态按**上下文已用量**切，不按健康度：
  //   0 非常精神 → 35 半睁眼 → 50 疲惫 → 65 站着睡 → 75 坐着睡 → 85 趴着睡
  // 阈值全进设置页，哥哥想改随时改。
  moodTier1: 35,
  moodTier2: 50,
  moodTier3: 65,
  moodTier4: 75,
  moodTier5: 85,
  // 小条（健康度）宽度 = 大条 × 0.55 —— 一眼能看出主次，又不至于看不清档位
  subBarRatio: 0.55,
});

function normalizeValue(key, value) {
  if (key === 'enabled' || key === 'farewellVoice' || key === 'autoArchive') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (key === 'redThreshold') return clampInt(value, RED_MIN, RED_MAX, undefined);
  if (key === 'yellowThreshold') return clampInt(value, YELLOW_MIN, YELLOW_MAX, undefined);
  if (key === 'windowSize') return clampInt(value, WINDOW_MIN, WINDOW_MAX, undefined);
  if (key === 'notifyDailyLimit') return clampInt(value, DAILY_LIMIT_MIN, DAILY_LIMIT_MAX, undefined);
  if (key === 'gaugeMode') {
    const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return GAUGE_MODES.includes(mode) ? mode : undefined;
  }
  if (key === 'probeMaxTokens') return clampInt(value, 16, 400, undefined);
  if (key === 'probeSamples') return clampInt(value, 1, 5, undefined);
  if (key === 'probeQuestion') {
    if (typeof value !== 'string') return undefined;
    const q = value.trim();
    return q === '' ? undefined : q.slice(0, 300);
  }
  // 角色名：只收一个能进文件名的短串（别的字符会被 safeFileName 换掉，等于白设）
  if (key === 'personaName') {
    if (typeof value !== 'string') return undefined;
    const name = value.trim().slice(0, 24);
    return name === '' ? undefined : name;
  }
  // 2026-10-22：notifyBotId / notifyTargetId 随 QQ 通道一起删了，这里不再收。
  if (key === 'inheritRoot' || key === 'proofRoot') {
    if (typeof value !== 'string') return undefined;
    const dir = value.trim();
    // 空串 = 显式关掉这个目录（inheritRoot 空 = 传承流程不可用）
    if (dir === '') return '';
    return isAbsolute(dir) ? dir : undefined;
  }
  // 合成链路的三条路径：只收绝对路径（相对路径在不同工作区下含义不同，等于埋雷）
  if (key === 'voicePython' || key === 'voiceScript' || key === 'voiceRef') {
    if (typeof value !== 'string') return undefined;
    const p = value.trim();
    if (p === '') return undefined;          // 这三项空着就是没配，回落到默认值
    return isAbsolute(p) ? p : undefined;
  }
  // IndexTTS 的 WebUI 地址：只收 http(s)，别的都是错的
  if (key === 'voiceEndpoint') {
    if (typeof value !== 'string') return undefined;
    const u = value.trim();
    if (u === '') return undefined;
    return /^https?:\/\//i.test(u) ? u : undefined;
  }
  // ── 双体力条 ──
  // 五个阈值都是「上下文已用 %」，给 1~100 的整数就收
  if (/^moodTier[1-5]$/.test(key)) return clampInt(value, 1, 100, undefined);
  // 小条相对大条的宽度比，夹在 0.2~0.95 —— 再小看不清档位，再大就主次不分了
  if (key === 'subBarRatio') {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(0.95, Math.max(0.2, n));
  }
  return undefined;
}

/**
 * @param {string} file 配置文件路径（$dir/config.json）
 * @param {{base?: object, now?: () => number}} [options]
 */
export function createConfigStore(file, { base = {}, now = Date.now } = {}) {
  let cache = { at: 0, mtime: -1, values: {} };

  function readFileValues() {
    let mtime = -1;
    try { mtime = existsSync(file) ? statSync(file).mtimeMs : -1; } catch { mtime = -1; }
    if (cache.at !== 0 && cache.mtime === mtime) return cache.values;

    let values = {};
    if (mtime >= 0) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        for (const key of EDITABLE_KEYS) {
          const v = normalizeValue(key, raw?.[key]);
          if (v !== undefined) values[key] = v;
        }
      } catch {
        // 文件坏了就落回默认值 —— 绝不因为一份配置把插件的命搭进去
        values = {};
      }
    }
    cache = { at: now(), mtime, values };
    return values;
  }

  /** 当前**有效**配置：默认值 → DSH 插件配置 → config.json。 */
  function get() {
    const fromBase = {};
    for (const key of EDITABLE_KEYS) {
      const v = normalizeValue(key, base?.[key]);
      if (v !== undefined) fromBase[key] = v;
    }
    const merged = { ...DEFAULTS, ...fromBase, ...readFileValues() };
    // 黄线必须低于红线，否则两条线打架 —— 强行夹正，并记下来
    if (merged.yellowThreshold >= merged.redThreshold) {
      merged.yellowThreshold = Math.max(YELLOW_MIN, Math.floor(merged.redThreshold / 2));
    }
    return merged;
  }

  /** 只写白名单里的键，返回真正落盘的与被拒的。 */
  function set(patch) {
    const current = { ...readFileValues() };
    const applied = {};
    const rejected = [];
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (!EDITABLE_KEYS.includes(key)) { rejected.push(key); continue; }
      const v = normalizeValue(key, value);
      if (v === undefined) { rejected.push(key); continue; }
      current[key] = v;
      applied[key] = v;
    }
    if (Object.keys(applied).length > 0) atomicWriteJson(file, current);
    cache = { at: 0, mtime: -1, values: {} };
    return { applied, rejected, values: get() };
  }

  return Object.freeze({ file, get, set, editableKeys: EDITABLE_KEYS });
}
