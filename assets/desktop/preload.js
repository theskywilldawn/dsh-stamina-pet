'use strict';
/**
 * 桌面层的 preload —— 页面和主进程之间只开这么一个小口子。
 *
 * 只给两件事：
 *   setHits  上报"角色身体在屏幕上的位置"。主进程靠它在光标落到角色身上时
 *            才解除整窗穿透（见 main.js 文件头 ①）。不报 = 永远点不到。
 *   quit     让页面能主动关掉这一层（调试和设置页的开关用）。
 *
 * 别的什么都不给：`contextIsolation: true` + `nodeIntegration: false`，
 * 页面拿不到 fs / child_process，出不了这个玻璃罩子。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccDesktop', {
  setHits: (list) => ipcRenderer.send('cc:hits', list),
  /**
   * 拖动期间锁住穿透。
   *
   * 为什么必须有这个：主进程每 60ms 用真实光标位置判命中，光标一移出她的
   * 命中框就恢复整窗穿透 —— 而**穿透之后 pointermove 再也到不了页面**，
   * 拖动就断在半路。`setPointerCapture` 救不了：事件根本进不来。
   * 所以按下的那一刻就告诉主进程「我在拖，别切回穿透」，松手再解开。
   */
  dragLock: (on) => ipcRenderer.send('cc:drag', !!on),
  quit: () => ipcRenderer.send('cc:quit'),
  // 调试日志（见 main.js 的 ccLog）：只在 CC_LOG 有值时落盘，平时零开销
  log: (msg) => ipcRenderer.send('cc:log', msg),
});
