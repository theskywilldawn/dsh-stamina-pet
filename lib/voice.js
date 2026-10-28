/**
 * 传承插件 · 模块 D：临终告别的语音
 *
 * 只干一件事：把一段中文正文，用本机 IndexTTS 2.5 合成为 .mp3。
 *
 * **为什么单独一个文件**：合成是整条传承流程里唯一会调外部进程、会花几十秒、
 * 而且会因为「GPU 忙 / WebUI 没开 / 显存不够」直接失败的地方。隔离出来之后，
 * 它失败的时候整条流程一点不受影响 —— 文本照常落盘，只是少一个 mp3，
 * 并且明确告诉哥哥缺在哪儿。
 *
 * 整条链路（每一环都能单独坏，所以错误信息要能指到具体哪一环）：
 *
 *   正文 → 临时 txt
 *        → IndexTTS 的 python 跑 synthesize.py（连本机 WebUI，用专属音色）
 *        → 临时 wav
 *        → ffmpeg 转 mp3
 *        → 落到「存在的证明」目录
 *
 * 全部走配置，一个都不写死 —— 换台机器、换个音色、换个端口都不用改代码。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 告别念什么情绪。默认「悲伤」—— 这是唯一一个不该让使用者挑的地方。 */
const FAREWELL_EMOTION = '悲伤';

/** 合成超时。实测单句 10~30 秒，告别通常几百字，给足三分钟。 */
const SYNTH_TIMEOUT_MS = 180000;
/** ffmpeg 转码超时，纯转码，几秒就够。 */
const FFMPEG_TIMEOUT_MS = 60000;

/**
 * 跑一个子进程，把 stdout/stderr 收全，带超时。
 * 不 reject —— 所有失败都从返回值里出来，调用方好判断。
 */
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    let child = null;

    try {
      child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error: `启动失败：${error?.message ?? error}` });
      return;
    }

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经没了 */ }
      finish({ ok: false, error: `超时（${timeoutMs} ms 还没有结果）` });
    }, timeoutMs);

    child.stdout?.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr?.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', (e) => finish({ ok: false, error: `进程错误：${e?.message ?? e}` }));
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true, stdout: out, stderr: err });
      else finish({ ok: false, error: `退出码 ${code}${(err || out).trim() ? `：${(err || out).trim().slice(-300)}` : ''}` });
    });
  });
}

/**
 * 合成一段告别语音。
 *
 * @param {object} opts
 * @param {string} opts.text     要念的正文
 * @param {string} opts.outMp3   目标 mp3 绝对路径
 * @param {object} opts.cfg      插件配置（读 voice* 那几个键）
 * @returns {Promise<{ok: boolean, path?: string, bytes?: number, error?: string}>}
 */
export async function synthesizeVoice({ text, outMp3, cfg }) {
  const body = String(text ?? '').trim();
  if (body === '') return { ok: false, error: '没有正文，不合成' };

  const python = String(cfg?.voicePython ?? '').trim();
  const script = String(cfg?.voiceScript ?? '').trim();
  const ref = String(cfg?.voiceRef ?? '').trim();
  const endpoint = String(cfg?.voiceEndpoint ?? '').trim() || 'http://127.0.0.1:7860';

  // ── 前置检查：哪一环不在，就说哪一环，别让人猜 ──
  if (!python) return { ok: false, error: '没配 voicePython（IndexTTS 的 python 路径）' };
  if (!existsSync(python)) return { ok: false, error: `python 不存在：${python}` };
  if (!script) return { ok: false, error: '没配 voiceScript（合成脚本路径）' };
  if (!existsSync(script)) return { ok: false, error: `合成脚本不存在：${script}` };
  if (!ref) return { ok: false, error: '没配 voiceRef（音色参考音频）' };
  if (!existsSync(ref)) return { ok: false, error: `音色参考不存在：${ref}` };

  // 工作区放临时目录，跑完连锅端 —— 不往传承目录里留垃圾
  let dir = '';
  try {
    dir = mkdtempSync(join(tmpdir(), 'stamina-voice-'));
  } catch (error) {
    return { ok: false, error: `建临时目录失败：${error?.message ?? error}` };
  }

  const txtFile = join(dir, 'say.txt');
  const wavFile = join(dir, 'say.wav');

  try {
    // ⚠️ 一定走 --text-file，不拼命令行 —— 告别正文里有引号、换行、中文标点，
    // 拼进命令行就是一堆转义地狱，而且在 Windows 上更容易炸。
    writeFileSync(txtFile, body, 'utf8');

    const synth = await run(python, [
      script,
      '--text-file', txtFile,
      '--out', wavFile,
      '--voice', ref,
      '--endpoint', endpoint,
      '--emotion', FAREWELL_EMOTION,
    ], SYNTH_TIMEOUT_MS);

    if (!synth.ok) {
      // WebUI 没起来是最常见的一种，把这层意思点出来
      const hint = /Connection|connect|refused|Max retries|Failed to fetch/i.test(synth.error)
        ? '（多半是 IndexTTS 的 WebUI 没启动，端口 7860 连不上）'
        : '';
      return { ok: false, error: `合成失败：${synth.error}${hint}` };
    }
    if (!existsSync(wavFile)) return { ok: false, error: '合成脚本说成功了，但没有产出 wav' };

    const enc = await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', wavFile,
      '-codec:a', 'libmp3lame', '-q:a', '4',
      outMp3,
    ], FFMPEG_TIMEOUT_MS);

    if (!enc.ok) return { ok: false, error: `转 mp3 失败：${enc.error}（wav 已合成，但转换没成功）` };
    if (!existsSync(outMp3)) return { ok: false, error: 'ffmpeg 说成功了，但没有产出 mp3' };

    return { ok: true, path: outMp3, bytes: statSync(outMp3).size };
  } catch (error) {
    return { ok: false, error: `合成过程异常：${error?.message ?? error}` };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清不掉就算了，临时目录系统会收 */ }
  }
}
