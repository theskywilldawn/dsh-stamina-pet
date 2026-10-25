'use strict';
/**
 * 传承插件的桌面层（Electron 主进程）。
 *
 * 甲方案：**一块全屏透明画布**，里面可以同时站好几只大肥鱼，各走各的。
 * 它不接管 DSH 窗口，只是盖在桌面上的一层玻璃。
 *
 * 三条命脉，都是踩过坑才定下来的：
 *
 *   ① **默认整窗点击穿透**（`setIgnoreMouseEvents(true, {forward:true})`）。
 *      不穿透的话这块玻璃会吃掉整个桌面的鼠标，用户连图标都点不到。
 *      主进程每 60ms 拿一次**真实光标位置**（`screen.getCursorScreenPoint()`），
 *      落在某个角色身上才翻成可交互 —— 不依赖渲染端那条转发链：
 *      Windows 上 `forward:true` 的钩子会被别的软件抢走而静默失效。
 *
 *   ② **永远置顶要有人天天看着**。建窗时 `setAlwaysOnTop(true,'screen-saver')`
 *      只在那一次生效，之后任何一次 z 序扰动都能让它沉到普通窗口下面 ——
 *      而 `isAlwaysOnTop()` 查出来**还是 true**（`WS_EX_TOPMOST` 位还在），
 *      用户那边就是"看不见了"。所以挂一个低频看门狗定期重钉。
 *
 *   ③ **不抢焦点**。用 `showInactive()` 而不是 `show()`，`focusable:false`。
 *      用户正在打字时突然有个窗口抢走焦点，比看不见还讨厌。
 *
 * 数据怎么来：渲染端自己 fetch 宿主（DSH）的 HTTP 路由。**不走 stdin 桥** ——
 * Electron 主进程在 Windows 上根本收不到 piped stdin（electron#4218），
 * 而 DSH 本来就是 HTTP 服务，让页面直连过去最省事。
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');

/**
 * 她得能出声（2026-10-23）。
 *
 * Chromium 默认只放行「用户手势之后」的播放。这个窗口偏偏是最难算手势的那种：
 * focusable:false、大部分时间整窗点击穿透、焦点从不上身。哥哥戳她明明是真的点了一下，
 * 播放却可能被判成"没有用户手势"而静默失败 —— 表现就是「有口型、有气泡，就是没声音」。
 *
 * 不放着这个不确定性：直接开全局开关。桌面层是我们自己的窗口，没有别的页面，
 * 打开它的代价为零。
 */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const path = require('node:path');

// 宿主端口和路由由插件在 spawn 时用环境变量传进来 —— 每次 DSH 重启端口都会变。
const HOST_PORT = Number(process.env.CC_HOST_PORT || 0);
const HOST_ROUTE = String(process.env.CC_HOST_ROUTE || '/stamina-pet');
const HOST_PID = Number(process.env.CC_HOST_PID || 0);

/** 光标命中轮询间隔。60ms ≈ 16fps，够跟手又不烧 CPU。 */
const HIT_POLL_MS = 60;
/** 置顶看门狗多久复查一次（见文件头 ②）。 */
const TOPMOST_TICK_MS = 3000;

/** @type {BrowserWindow | null} */
let win = null;
/** 当前是不是"整窗穿透"。所有 setIgnoreMouseEvents 只经这一个变量兜底。 */
let ignoring = true;
/** 渲染端正在拖她 —— 这期间**不许**切回穿透，否则 pointermove 直接断。 */
let dragLock = false;
/** 角色在屏幕坐标里的命中矩形，由渲染端通过 IPC 上报。 */
let hits = [];

// ── 调试日志通道 ─────────────────────────────────────────────────────
// 渲染端的 console 我们看不到（窗口无边框、没开 devtools、stdout 又被宿主吞了）。
// 2026-10-21 查「她总是从地面冒出来」这件事，前后猜了五六轮都没定位，就是因为
// 拿不到运行时数据。这里开一条口子：页面通过 preload 的 log() 发 IPC，
// 主进程直接追加到 CC_LOG 指向的文件（由宿主 spawn 时传进来）。
const fs = require('node:fs');
const LOG_PATH = String(process.env.CC_LOG || '');
function ccLog(msg) {
  if (!LOG_PATH) return;
  try { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`); } catch { /* 写不进去也别炸 */ }
}
ipcMain.on('cc:log', (_event, msg) => ccLog(String(msg)));

// 不用单实例锁。
//
// 试过 `requestSingleInstanceLock()`：DSH 重启时新 helper 抢不到锁就 `app.quit()`，
// 而旧的还连着**上一个端口**（重启后端口变了），于是新的一退出、旧的活着但拿不到
// 数据 —— 桌面上那层玻璃就死了，还不报错。改成：**由宿主负责收尸**
// （插件停用时 kill），加上宿主 PID 看门狗兜底，比锁可靠。

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  // `CC_SAFE=1` 时缩小成一个小窗口 —— 调试用。
  // 全屏透明窗口一旦哪里没生效，屏幕上就是一大块挡板；第一次跑代码先开小窗验一眼，
  // 别拿整块屏幕试错。
  const safe = process.env.CC_SAFE === '1';
  const bounds = safe
    ? { x: area.x + 40, y: area.y + 40, width: 420, height: 340 }
    : { x: area.x, y: area.y, width: area.width, height: area.height };

  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    // 不抢焦点：见文件头 ③。输入框都在 DSH 本体里，这层纯展示 + 点按。
    focusable: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 窗口被别的东西挡住时 Chromium 默认会暂停重绘，角色会"凭空消失"一阵
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* 非 mac 无所谓 */ }
  win.webContents.setBackgroundThrottling(false);
  // 右键菜单由渲染端自己画，屏蔽 Electron 默认那个
  win.webContents.on('context-menu', (e) => e.preventDefault());

  // 见文件头 ①：先整窗穿透
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoring = true;

  win.loadFile(path.join(__dirname, 'index.html'), {
    query: { port: String(HOST_PORT), route: HOST_ROUTE },
  }).catch((err) => {
    console.error('[cc-desktop] 页面加载失败:', err && err.message ? err.message : err);
  });

  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) win.showInactive();
  });
  // 兜底：某些显卡驱动下 ready-to-show 会不来，那就等页面加载完自己兜一次
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isVisible()) win.showInactive();
    }, 400);
  });

  win.on('closed', () => { win = null; });
}

function pointInHits(p) {
  for (let i = 0; i < hits.length; i += 1) {
    const r = hits[i];
    if (
      p.x >= r.x && p.x <= r.x + r.w
      && p.y >= r.y && p.y <= r.y + r.h
    ) return true;
  }
  return false;
}

function startPointerWatch() {
  let tick = 0;
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    let p = null;
    let inside = false;
    try {
      p = screen.getCursorScreenPoint();
      inside = pointInHits(p);
    } catch { inside = false; }
    // 想让的状态是：在角色身上 → 不穿透；否则 → 穿透
    // 拖动中一律不穿透 —— 光标划出她身体的那一瞬间是最容易断的
    const wantIgnore = dragLock ? false : !inside;
    if (wantIgnore !== ignoring) {
      // ⚠️ `ignoring` 必须**在设置成功之后**才更新。
      // 2026-10-23 出过一次「鼠标怎么都点不到她」：如果 setIgnoreMouseEvents 抛了
      // 异常却被静默吞掉，变量会先认账、窗口却没变 —— 之后 wantIgnore 永远等于
      // ignoring，再也走不进这个分支，只能靠重启救回来。
      try {
        win.setIgnoreMouseEvents(wantIgnore, { forward: true });
        ignoring = wantIgnore;
      } catch (error) {
        ccLog(`watch 设置穿透失败：${error?.message ?? error}`);
        return;
      }
      // 只在状态变化时记 —— 这是判断「点不到」的第一现场
      ccLog(`watch 切换 光标(${p ? p.x + ',' + p.y : '?'}) ${inside ? '命中' : '未命中'} → 穿透=${wantIgnore} 区域数=${hits.length}`);
      return;
    }
    // 每 2 秒兜一条快照，方便和页面报上来的区域对照
    tick += 1;
    if (tick % 33 === 0) {
      // 自愈：每 2 秒**无条件**重设一次穿透状态。
      // 治的就是上面那种「变量和真实样式脱钩」的卡死 —— 哪怕前面漏了哪条路径，
      // 这里两秒内一定把窗口掰回正确状态。成本是两秒一次 SetWindowLong。
      try {
        win.setIgnoreMouseEvents(wantIgnore, { forward: true });
        ignoring = wantIgnore;
      } catch { /* 窗口没了 */ }
      const h0 = hits[0];
      ccLog(`watch 当前 光标(${p ? p.x + ',' + p.y : '?'}) 命中=${inside} 区域数=${hits.length}`
        + (h0 ? ` 第一块=(${Math.round(h0.x)},${Math.round(h0.y)} ${Math.round(h0.w)}x${Math.round(h0.h)})` : ''));
    }
  }, HIT_POLL_MS).unref();
}

function startTopmostWatchdog() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { /* 窗口没了 */ }
  }, TOPMOST_TICK_MS).unref();
}

/** 宿主（DSH）没了就跟着退出，别在桌面上留一层孤儿玻璃。 */
function startHostWatchdog() {
  if (!HOST_PID) return;
  setInterval(() => {
    try {
      process.kill(HOST_PID, 0);
    } catch {
      app.quit();
    }
  }, 2000).unref();
}

/**
 * 心跳自检：页面活着的标志是它每 90ms 报一次命中矩形。
 *
 * 这是**防止留一块黑屏在桌面上**的保险：如果 index.html 没跑起来（渲染器拉不到、
 * 脚本报错、CSP 拦了），窗口本身还是会在的 —— 一块全屏、置顶、还不吃鼠标的玻璃，
 * 用户看不见内容也关不掉它。所以 8 秒内一次心跳都没收到，就自己退出。
 *
 * 反过来说：**收到过心跳就绝不再判死**。页面卡一下不该让整层玻璃消失。
 */
function startHeartbeatCheck() {
  setTimeout(() => {
    if (gotHeartbeat) return;
    console.error('[cc-desktop] 页面 8 秒内没有心跳，判定没跑起来，退出');
    app.quit();
  }, 8000).unref();
}

/** 页面有没有起来过。见 startHeartbeat 的注释 —— 这是防止"留一块黑屏在桌面上"的保险。 */
let gotHeartbeat = false;

let hitsTick = 0;
ipcMain.on('cc:drag', (_event, on) => {
  dragLock = on === true;
  ccLog('drag 锁 ' + (dragLock ? 'ON' : 'OFF'));
  if (!dragLock || !win || win.isDestroyed()) return;
  // 立刻解除穿透：等下一个 60ms tick 就晚了，那一下 pointermove 已经丢
  try { win.setIgnoreMouseEvents(false); ignoring = false; } catch { /* 窗口没了 */ }
});

ipcMain.on('cc:hits', (_event, list) => {
  if (!Array.isArray(list)) return;
  gotHeartbeat = true;
  // 页面报的是**窗口内**坐标，这里比的是 `screen.getCursorScreenPoint()` 的**屏幕**坐标，
  // 所以要补上窗口原点 —— 不补的话判定整体偏移一个窗口位置，鼠标得往右下偏才点得中。
  const b = (win && !win.isDestroyed()) ? win.getBounds() : { x: 0, y: 0 };
  hits = list
    .filter((r) => (
      r
      && Number.isFinite(r.x) && Number.isFinite(r.y)
      && Number.isFinite(r.w) && Number.isFinite(r.h)
    ))
    .map((r) => ({ x: r.x + b.x, y: r.y + b.y, w: r.w, h: r.h }));
  // 每 40 条约 3.6 秒记一次：页面报了几块、窗口原点是多少、归一化后第一块在哪
  hitsTick += 1;
  if (hitsTick % 40 === 0) {
    const raw0 = list[0];
    const h0 = hits[0];
    ccLog(`hits 收到 ${list.length} 块 窗口原点(${b.x},${b.y}) 窗口${b.width}x${b.height}`
      + (raw0 ? ` 页面第一块=(${Math.round(raw0.x)},${Math.round(raw0.y)})` : '')
      + (h0 ? ` → 屏幕(${Math.round(h0.x)},${Math.round(h0.y)})` : ''));
  }
});

ipcMain.on('cc:quit', () => { app.quit(); });

app.whenReady().then(() => {
  if (!HOST_PORT) {
    // 没拿到宿主端口就一定连不上数据，直接退，别留个空壳
    console.error('[cc-desktop] 没有 CC_HOST_PORT，退出');
    app.quit();
    return;
  }
  createWindow();
  startPointerWatch();
  startTopmostWatchdog();
  startHostWatchdog();
  startHeartbeatCheck();
});

app.on('window-all-closed', () => { app.quit(); });
