/**
 * dsh-stamina-pet — browser half（设置卡片）
 *
 * 在「设置」里加一页「传承插件」，把可调参数摆出来。
 * 面板不自己编数据，一律打 host 侧的 /api/state 与 /api/config ——
 * 和插件实际读的是同一份配置，所以面板上看到的，就是运行时真正生效的。
 *
 * 契约来自 @deepseek-ai/dsh-client-ui-settings 的 settings.section（list slot）：
 * 注册描述符 { id, order, label }，渲染函数返回 React 元素。
 */
window.__ModuleLoader__.load({
	id: 'dsh-stamina-pet',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');
		const h = React.createElement;

		// ── Live2D 渲染器（鲸鱼娘）──────────────────────────────────────
		// 由 tools/build-live2d.mjs 生成，注入时替换成真正的代码：
		// 把 kit/rig.js + kit/body.js + whale/figure.js + model.json + 50 张纹素全部打包成
		// 一个自包含的 IIFE，挂在 window.__CC_LIVE2D 上。
		//
		// 为什么内联而不是走 URL：DSH 桌面端的页面跑在 dsh-app:// 自定义协议下，那个协议
		// 对 ESM 的支持不可靠 —— fetch 好好的，import('/…/body.js') 却失败。client.js 本身
		// 是确定能加载的（它现在就活着），那就让它一次带全，不再依赖协议细节。
		/* @@LIVE2D_BUNDLE@@ */

		const API = '/stamina-pet/api';
		const STYLE_ID = 'dsh-stamina-pet-style';
		const CSS = [
			'.cc-wrap{display:flex;flex-direction:column;gap:14px;padding:2px 0 24px;color:var(--dsw-alias-label-primary)}',
			'.cc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
			// UI 字体两条：本地自备的华康方圆体优先（assets/fonts/local/，默认不存在），
// 没有就用内置的站酷快乐体（免费商用，1.59 MB，随插件分发）。
// 走宿主静态路由，不内联 —— 字体 base64 进 client 包会让它翻倍。
'@font-face{font-family:XingchenLocal;src:url(' + "'" + '/stamina-pet/font/local/HKFangYuanW7.ttf' + "'" + ') format("truetype");font-display:swap}',
'@font-face{font-family:XingchenKuaiLe;src:url(' + "'" + '/stamina-pet/font/ZCOOLKuaiLe-Regular.ttf' + "'" + ') format("truetype");font-display:swap}',
'.cc-wrap{font-family:XingchenLocal,XingchenKuaiLe,"Microsoft YaHei","PingFang SC",system-ui,sans-serif}',
'.cc-title{font-size:16px;font-weight:600;margin:0}',
			'.cc-btn{font-size:14px;padding:4px 12px;border-radius:8px;cursor:pointer;',
			'border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent);',
			'background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);',
			'color:var(--dsw-alias-brand-primary)}',
			'.cc-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}',
			'.cc-btn:disabled{opacity:.5;cursor:default}',
			'.cc-stats{display:flex;flex-wrap:wrap;gap:8px}',
			'.cc-chip{font-size:14px;padding:3px 9px;border-radius:999px;',
			'background:var(--dsw-alias-bg-layer-2,#0000000d);opacity:.85;font-variant-numeric:tabular-nums}',
			'.cc-ok{color:#2e9e5b}',
			'.cc-bad{color:#d9534f}',
			'.cc-warn{color:#c98a1f}',
			'.cc-note{font-size:14px;opacity:.7;line-height:1.65}',
			'.cc-rows{display:flex;flex-direction:column;gap:2px}',
			'.cc-row{display:flex;align-items:flex-start;gap:12px;padding:9px 11px;border-radius:10px}',
			'.cc-row:hover{background:color-mix(in srgb,currentColor 4%,transparent)}',
			'.cc-row-main{flex:1;min-width:0}',
			'.cc-row-name{font-size:15px;margin:0 0 3px}',
			'.cc-row-desc{font-size:14px;opacity:.65;line-height:1.55;margin:0}',
			'.cc-ctl{flex:none;display:flex;align-items:center;gap:6px;padding-top:1px}',
			// 滑钮那一行：控件要竖着排在右边，横着会把描述挤成一条缝
			'.cc-ctl-col{flex-direction:column;align-items:flex-end;gap:6px}',
			'.cc-range{width:220px;accent-color:var(--dsw-alias-brand-primary,#4D6BFE);cursor:pointer}',
			'.cc-switch{width:38px;height:22px;border-radius:999px;border:none;cursor:pointer;position:relative;',
			'transition:background .15s ease;background:color-mix(in srgb,currentColor 22%,transparent)}',
			'.cc-switch[data-on="1"]{background:var(--dsw-alias-brand-primary)}',
			'.cc-switch::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;',
			'background:#fff;transition:transform .15s ease}',
			'.cc-switch[data-on="1"]::after{transform:translateX(16px)}',
			'.cc-switch:disabled{opacity:.5;cursor:default}',
			'.cc-num{width:66px;font-size:14.5px;padding:4px 8px;border-radius:8px;text-align:center;',
			'border:1px solid color-mix(in srgb,currentColor 18%,transparent);',
			'background:var(--dsw-alias-bg-layer-2,#0000000d);color:inherit;font-variant-numeric:tabular-nums}',
			'.cc-text{width:230px;font-size:14px;padding:4px 8px;border-radius:8px;',
			'border:1px solid color-mix(in srgb,currentColor 18%,transparent);',
			'background:var(--dsw-alias-bg-layer-2,#0000000d);color:inherit}',
			'.cc-sec{font-size:14px;opacity:.55;margin:10px 0 0;letter-spacing:.02em;font-weight:600}',
			'.cc-alert{font-size:14px;line-height:1.6;padding:8px 11px;border-radius:10px;',
			'background:color-mix(in srgb,#d9534f 8%,transparent);border:1px solid color-mix(in srgb,#d9534f 25%,transparent)}',
			'.cc-dead{font-size:14px;line-height:1.6;padding:8px 11px;border-radius:10px;',
			'background:color-mix(in srgb,#c98a1f 8%,transparent);border:1px solid color-mix(in srgb,#c98a1f 25%,transparent)}',
			'.cc-mono{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;opacity:.8}',
			// ── 血条挂件（shell.overlay 常驻）────────────────────────────────
			// 视觉分工照视频·1代的定稿：血条要小、贴人、颜色要哑，视觉权重低于本人。
			// 尺寸全部挂在 --ccg-size 上 —— 缩放时改一个变量，人和血条一起变，
			// 而且 layout 尺寸就是真实尺寸（不用 transform:scale），拖动算坐标不会错。
			'.ccg-root{position:fixed;right:18px;bottom:96px;z-index:30;display:flex;flex-direction:column;',
			'align-items:center;gap:1px;user-select:none;pointer-events:auto;transition:opacity .35s ease;',
			'cursor:grab;touch-action:none;--ccg-size:96px}',
			// 拖动中禁掉过渡（否则跟手会糊），并暂停呼吸动画（省得拖的时候还在喘）
			'.ccg-root[data-dragging="1"]{cursor:grabbing;transition:none}',
			'.ccg-root[data-dragging="1"] .ccg-pet{animation-play-state:paused}',
			'.ccg-root:hover{opacity:1}',
			// 血条跟着人走，但**封顶 280px** —— 放到 6 倍大时血条不能横穿半个屏幕
			'.ccg-bar{width:min(calc(var(--ccg-size) * 0.79), 280px);height:6px;border-radius:3px;overflow:hidden;',
			'background:color-mix(in srgb,currentColor 14%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,currentColor 8%,transparent)}',
			// 掉血：前快后缓；涨血同一曲线。染色用 data-tier 分档跳变，**不加颜色过渡**
			'.ccg-fill{height:100%;border-radius:3px;transition:width .42s cubic-bezier(.22,1,.36,1)}',
			'.ccg-root[data-tier="ok"] .ccg-fill{background:#8FB8E0}',
			'.ccg-root[data-tier="low"] .ccg-fill{background:#E0B080}',
			'.ccg-root[data-tier="bad"] .ccg-fill{background:#C88898}',
			'.ccg-root[data-tier="zero"] .ccg-fill{background:#B07C88;width:6px}',
			// 本人：极轻呼吸。满血时她是"活的"，掉血才让人心疼
			'@keyframes ccg-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.022)}}',
			'.ccg-pet{width:var(--ccg-size);height:var(--ccg-size);display:block;image-rendering:auto;',
			'animation:ccg-breath 4.6s ease-in-out infinite;transform-origin:50% 94%;pointer-events:none}',
			// 血量越低呼吸越慢（心跳快=恐慌，呼吸慢=虚弱），并轻微褪色
			'.ccg-root[data-tier="low"] .ccg-pet{animation-duration:6.4s}',
			'.ccg-root[data-tier="bad"] .ccg-pet{animation-duration:8.8s;filter:saturate(.72) brightness(.96)}',
			// 归零不爆炸、不闪红：一次静止，人闭眼、色褪掉
			'.ccg-root[data-tier="zero"] .ccg-pet{animation:none;filter:saturate(.42) brightness(.88);opacity:.82}',
			// ── Live2D 舞台 ──────────────────────────────────────────────
			// 静态图和 WebGL 舞台叠在同一个盒子里：加载中先显示静态图，就绪后淡出换成会动的她。
			'.ccg-petwrap{position:relative;width:var(--ccg-size);height:var(--ccg-size)}',
			'.ccg-petwrap>.ccg-pet,.ccg-petwrap>.ccg-live{position:absolute;inset:0;width:100%;height:100%}',
			'.ccg-petwrap>.ccg-pet{transition:opacity .3s ease}',
			// 注意 pointer-events 必须是 auto：要能接住「戳她一下」，事件再冒泡到根节点负责拖动
			'.ccg-live{position:relative;pointer-events:auto;opacity:0;transition:opacity .35s ease}',
			'.ccg-live[data-ready="1"]{opacity:1}',
			'.ccg-live svg.kit{position:absolute!important;inset:0;width:100%!important;height:100%!important}',
			// 掉血褪色对 Live2D 也生效（颜色跳变，不插值）
			'.ccg-root[data-tier="bad"] .ccg-live{filter:saturate(.78) brightness(.98)}',
			'.ccg-root[data-tier="zero"] .ccg-live{filter:saturate(.5) brightness(.92)}',
			// 字号跟着尺寸走，但夹在 9~20px（放很大时不至于变成大字报）
			'.ccg-text{font-size:clamp(9px, calc(var(--ccg-size) * 0.115), 20px);line-height:1.3;white-space:nowrap;letter-spacing:.02em;',
			'color:var(--dsw-alias-label-primary);opacity:.55}',
			'.ccg-root[data-tier="bad"] .ccg-text,.ccg-root[data-tier="zero"] .ccg-text{opacity:.75}',
			'.ccg-meta{margin-top:2px;font-size:10px;line-height:1.5;text-align:center;opacity:.5;',
			'font-variant-numeric:tabular-nums;white-space:nowrap}',
			// 缩放手柄：只在悬停时出现；尺寸跟着人走（放到 6 倍大时不能还是个 16px 的小点）
			'.ccg-resize{position:absolute;right:-4px;bottom:-4px;cursor:nwse-resize;',
			'width:calc(var(--ccg-size) * 0.14);min-width:16px;max-width:32px;',
			'height:calc(var(--ccg-size) * 0.14);min-height:16px;max-height:32px;',
			'opacity:0;transition:opacity .15s ease;display:flex;align-items:flex-end;justify-content:flex-end;padding:2px}',
			'.ccg-resize::after{content:"";width:7px;height:7px;border-radius:1px;',
			'border-right:2px solid rgba(140,152,168,.8);border-bottom:2px solid rgba(140,152,168,.8)}',
			'.ccg-root:hover .ccg-resize{opacity:1}',
			// ── 会话头部「体力值」条（conversation.session.header.utilities）────
			// 每个会话头部一个，显示**这个会话**的疲劳程度。不写百分比文字 ——
			// 哥哥要的是进度条本身说话，悬停才给 title。
			//
			// ⚠️ 2026-10-20 哥哥反馈「放在右上角、还太小、非常不显眼」。
			// 根因不在样式，在**插槽本身**：`conversation.session.header.utilities`
			// 的定位就是「右对齐的 utilities」—— 它待的是头部最右边那条缝，
			// 光调 CSS 挪不到中间去，把图放大只会把那条缝撑开、反而更难看。
			//
			// 解法：**不跟它玩流式布局**。组件照旧注册在这个插槽里（sessionId 白送、
			// 随会话切换/销毁都不用自己管），但渲染出来的盒子是 `position:fixed`，
			// 由 JS 量出「头部那一条」的矩形，钉在它的正中。插槽只负责给我们一个
			// 挂载点，位置自己说了算。
			// 量不出来就退回 160×27 的流内布局 —— 宁可小，不要没有。
			// 2026-10-22 起这里是**双条**：上面大条（上下文已用）、下面小条（健康度）。
			// 盒子高度放成两条之和；两条各自定高，不用 `.ccf-img` 的 inset:0（那会拉变形）。
			// 2026-10-22 哥哥要「两条可以重叠，但别让边边遮住进度」，压了一版之后又补一句
			// 「挨得太近啦」。这条路走过三版，记下来免得下一轮重走：
			//
			// ⚠️ 对齐的不是"非透明像素"，是**发光胶囊**。素材 800×172 的真实结构（量出来的）：
			//   0.000~0.180 透明留白 / 0.180~0.378 顶部装饰板 /
			//   0.378~0.640 胶囊本体 / 0.645~0.837 底部装饰板 / 0.837~1.000 透明。
			//
			// ① 0.6898（底板贴住）：两条**胶囊**之间还隔着 0.3h 的黑板 —— 看着远。
			// ② 0.3225 + 裁掉小条顶板（胶囊贴胶囊）：真咬上了，但哥哥说「太近」。
			// ③ 现在这版：小条缩到等比的 0.55h（不再纵向拉伸），顶板按比例变薄，
			//    放回 top = 0.55h —— 顶板顶部 0.649h 刚好擦过大条胶囊底沿 0.640h，
			//    两条胶囊之间留 0.118h，既能看出是两条，又咬得很近。
			//
			// 小条依旧压在**上层**（z-index 2 对 1），它的顶板盖住的是大条的底板，
			// 进度是**横着**看的 —— 纵向压掉一点底板，进度读数一点没少。
			'.ccf-root{--ccf-w:160px;--ccf-h:27px;--ccf-sub-h:calc(var(--ccf-h) * 0.55);',
			'width:var(--ccf-w);height:calc(var(--ccf-h) * 0.55 + var(--ccf-sub-h));flex:none;',
			'cursor:grab;touch-action:none;display:block;position:relative;opacity:var(--ccf-op,.92);z-index:20;',
			'transition:opacity .18s ease,transform .18s ease;transform-origin:center center}',
			// 钉到头部正中：left/top 由 JS 写成视口坐标，这里只负责把锚点挪到自身中心
			'.ccf-root[data-float="1"]{position:fixed;transform:translate(-50%,-50%)}',
			'.ccf-root:hover{opacity:min(1,calc(var(--ccf-op,.92) + .08))}',
			'.ccf-root:not([data-float="1"]):hover{transform:scale(1.03)}',
			'.ccf-root[data-float="1"]:hover{transform:translate(-50%,-50%) scale(1.04)}',
			// 拖动中：光标换成抓握，且**不跟着放大** —— 边拖边缩放会跟手发飘
			'.ccf-root[data-dragging="1"],.ccf-root[data-dragging="1"]:hover{cursor:grabbing;',
			'transform:translate(-50%,-50%);transition:opacity .18s ease}',
			'.ccf-img{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}',
			// 大条：上下文已用量（越用越少）。尺寸和以前那一条完全一样。
			'.ccf-big{position:absolute;left:0;top:0;width:100%;height:var(--ccf-h);',
			'display:block;pointer-events:none;object-fit:fill;z-index:1}',
			// 小条：健康度。宽度按 --ccf-sub-w（由设置页的比例算进 DOM style），贴在下方。
			// 0.55 的算法见上面那段：小条等比缩到 0.55，顶板顶刚好擦过大条胶囊底沿。
			// 高度也必须是 0.55（见 .ccf-root 的 --ccf-sub-h）—— 宽高同一个比例，
			// 小条才是大条的等比缩小版。只改宽不改高就会像 2026-10-22 那样被纵向拉粗。
			// 左端要对齐的是**胶囊**，不是图片边缘 —— 素材左右各 7.37% 是透明留白，
			// 小条缩到 55% 后留白也跟着缩，图片左对齐了胶囊反而会探头 3.32%。
			// calc 里跟着 --ccf-sub-w 走，改 subBarRatio 不用再手调。
			'.ccf-small{position:absolute;left:calc(7.37% - var(--ccf-sub-w, 55%) * 0.0737);',
			'top:calc(var(--ccf-h) * 0.55);',
			'width:var(--ccf-sub-w, 55%);height:var(--ccf-sub-h);',
			'display:block;pointer-events:none;object-fit:fill;z-index:2}',
			// ── 百分比数字（2026-10-24 哥哥提的：加在两条血条正左侧，加粗白字，一大一小）──
			// 为什么必须挂在这盒子里、用 right:100% 往外溢出，而不是把 --ccf-w 撑大：
			// 那盒子是钉在头部正中的（left/top 由 JS 写视口坐标 + translate(-50%,-50%)），
			// 一改宽度，条本身就会往左挪 —— 数字是"贴在左边"，不该把条推走。
			// 往外溢出不占布局，条还在原来那个位置。
			'.ccf-nums{position:absolute;right:calc(100% - var(--ccf-w, 160px) * 0.0737 + 2px);top:0;width:max-content;',
			'height:100%;display:flex;flex-direction:column;align-items:flex-end;',
			'justify-content:center;gap:1px;line-height:1;pointer-events:none;',
			// 2026-10-24 哥哥说偏上 —— 先 2px 不够，他要 7px。
			// 用 translateY 而不是 padding：flex 居中 + padding 会让偏移量随总高变化，
			// translateY 是死值，字号改了也不会漂。
			'transform:translateY(7px);',
			// Bahnschrift 是 Windows 自带的 DIN 风格可变字体 —— 数字天生带仪表感，
			// 而且小字号下笔画不糊（比站酷那几款粗黑在 9px 上清楚得多）。
			'font-family:Bahnschrift,"Segoe UI",system-ui,sans-serif;',
			'font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}',
			'.ccf-nums b{color:#fff;font-weight:700;letter-spacing:.01em;',
			// 两层投影：近的一层压住底下任何底色，远的一层让白字在亮色血条上也不发虚
			'text-shadow:0 1px 3px rgba(0,0,0,.78),0 0 7px rgba(0,0,0,.45)}',
			// 一大一小：大条 0.44h、小条 0.30h（默认 --ccf-h:27px → 约 12px / 8px）
			// 2026-10-24 第一版是 .55/.35，哥哥截图说偏大 —— 降一档，两行总高也更贴条
			'.ccf-n1{font-size:calc(var(--ccf-h) * .44)}',
			'.ccf-n2{font-size:calc(var(--ccf-h) * .26);opacity:.9}',
			// ── 右键菜单（金色 = 探针 / 银色 = 设为基线）──────────────────────
			// ⚠️ **必须是 `position:absolute`，绝不能是 fixed。**
			// 体力条那个盒子带着 `transform`（钉在头部正中用的 translate(-50%,-50%)），
			// 而父级只要有 transform，子元素的 `position:fixed` 就会**退化成相对父级定位**，
			// 于是 `left: 830px` 这种视口坐标就变成了"从体力条左边再往右 830px"——
			// 2026-10-21 金银按钮飘到屏幕右边就是这个原因，不是坐标算错了。
			// 改成绝对定位 + 百分比锚点：天然钉在体力条正下方居中，**不需要任何 JS 坐标**，
			// 也就不会再有坐标系不一致的机会。
			// 透明底：哥哥 2026-10-21 说那块深蓝板子不好看，要"白色或直接透明"。
			// 选透明 —— 按钮本身是圆形带描边的，落在浅色/深色背景上都立得住；
			// 阴影改用 drop-shadow（**跟着图片的 alpha 轮廓走**，不是方框阴影），
			// 这样看起来是两个圆钮浮在血条下面，而不是坐在一块黑板里。
			'.ccp-menu{position:absolute;left:50%;top:calc(100% + 8px);z-index:99999;'
				+ 'transform:translateX(-50%);padding:4px;border-radius:16px;'
				+ 'background:transparent;border:0;box-shadow:none;'
				+ 'filter:drop-shadow(0 6px 14px rgba(0,0,0,.3))}',
			'.ccp-btns{display:flex;gap:10px;justify-content:center}',
			'.ccp-btn{width:44px;height:44px;padding:0;border:0;background:transparent;cursor:pointer;'
				+ 'border-radius:50%;transition:transform .12s ease,filter .12s ease}',
			'.ccp-btn:hover:not(:disabled){transform:scale(1.08);filter:brightness(1.12)}',
			'.ccp-btn:active:not(:disabled){transform:scale(.94)}',
			'.ccp-btn:disabled{opacity:.45;cursor:progress}',
			'.ccp-btn img{width:100%;height:100%;display:block;pointer-events:none}',
			'.ccp-text{margin-top:8px;font-size:13px;line-height:1.5;color:#cfe0ff;'
				+ 'max-width:230px;white-space:pre-wrap;word-break:break-word}',
			// ── 外观面板（2026-10-22 哥哥：只有金银两个按钮太少，下面加一块调大小/透明度）
			// 半透明而不是实心板：他会看到它整块压在会话内容上，实心会把字盖住。
			// backdrop-filter 在带 filter 的祖先（.ccp-menu 有 drop-shadow）里可能吃不到模糊，
			// 所以底色本身也带足透明度，模糊失效时照样能看清下面的字。
			'.ccp-panel{margin-top:9px;width:246px;padding:10px 13px 6px;border-radius:14px;'
				+ 'background:rgba(12,20,36,.58);border:1px solid rgba(120,170,255,.24);'
				+ 'backdrop-filter:blur(12px) saturate(1.15);-webkit-backdrop-filter:blur(12px) saturate(1.15);'
				+ 'box-shadow:0 10px 26px rgba(0,0,0,.28) inset 0 1px 0 rgba(255,255,255,.06)}',
			'.ccp-pv{display:flex;align-items:baseline;justify-content:space-between;'
				+ 'font-size:13px;line-height:1.4;color:#bed2ef}',
			'.ccp-pv i{font-style:normal;color:#8fd0ff;font-variant-numeric:tabular-nums}',
			'.ccp-range{-webkit-appearance:none;appearance:none;display:block;width:100%;height:4px;'
				+ 'margin:5px 0 9px;border-radius:3px;outline:none;cursor:pointer;'
				+ 'background:linear-gradient(90deg,rgba(150,205,255,.9),rgba(150,205,255,.22))}',
			'.ccp-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border:0;'
				+ 'border-radius:50%;background:#d6ebff;cursor:pointer;'
				+ 'box-shadow:0 0 0 3px rgba(120,190,255,.22),0 1px 3px rgba(0,0,0,.4);'
				+ 'transition:box-shadow .12s ease,transform .12s ease}',
			'.ccp-range:hover::-webkit-slider-thumb{transform:scale(1.12);'
				+ 'box-shadow:0 0 0 4px rgba(120,190,255,.30),0 1px 3px rgba(0,0,0,.4)}',
			'.ccp-range::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:50%;'
				+ 'background:#d6ebff;cursor:pointer;box-shadow:0 0 0 3px rgba(120,190,255,.22)}',

			// ⚠️ 别给这张图再套 `filter: brightness()/saturate()` —— 21 档的色相、
			// 闪电透明度、两端红光强度都是图片·小星辰一档一档调出来的梯度，
			// 外面拉一道就把梯度压平了（她在接入方案里专门点出的坑）。
			// `data-tier` 照旧保留，但它只驱动化身表情，不参与这条的外观。
			'.ccf-root[data-hidden="1"]{display:none}',
			// ── 化身卡片（从体力条里蹦出来的那一位）────────────────────────
			'.ccav-layer{position:fixed;inset:0;pointer-events:none;z-index:31}',
			// 归位用 cubic-bezier(.34,1.56,.64,1) —— 带一点点回弹，像真的"蹦"上来
			'.ccav-card{position:fixed;width:200px;height:200px;pointer-events:auto;',
			'transition:left .55s cubic-bezier(.22,1,.36,1),top .55s cubic-bezier(.22,1,.36,1),',
			'opacity .32s ease,transform .55s cubic-bezier(.34,1.56,.64,1)}',
			'.ccav-card[data-in="1"]{filter:drop-shadow(0 10px 30px rgba(40,70,140,.30))}',
			'.ccav-close{position:absolute;right:2px;top:2px;width:20px;height:20px;border:0;border-radius:50%;',
			'background:rgba(20,30,50,.55);color:#cbd6e8;font-size:15px;line-height:1;cursor:pointer;padding:0;',
			'opacity:0;transition:opacity .15s ease;display:flex;align-items:center;justify-content:center}',
			'.ccav-card:hover .ccav-close{opacity:1}',
			'.ccav-close:hover{background:rgba(90,120,180,.85);color:#fff}',
		].join('');

		/**
		 * 拉取 /api/state。
		 *
		 * ⚠️ v0.1.0 这里有个**真 bug**（2026-10-20 哥哥截图实证：设置页「读取失败：Failed to fetch」，
		 * 而且「经常闪断」）：原来是 `useRemote(loader)`，`useCallback(..., [loader])` ——
		 * 调用方传的是`每次渲染都新建的箭头函数`，于是 load 每次都变、useEffect 每次都跑、
		 * 每跑一次 setState 又触发下一次渲染 —— **无限请求循环**，把浏览器的连接池挤爆，
		 * 表现就是随机失败 + 界面闪。
		 *
		 * 修法三条：
		 *   1. **不接收 loader**，fetch 逻辑写在内部，useCallback 依赖数组**留空**；
		 *   2. `inflight` 防重入，同一时刻只有一个请求；
		 *   3. 失败时**保留旧数据**（只置 error），不清空 —— 否则界面会闪成空白。
		 */
		function useRemote() {
			const [state, setState] = React.useState({ loading: true, error: null, data: null });
			const inflight = React.useRef(false);

			const load = React.useCallback(() => {
				if (inflight.current) return;
				inflight.current = true;
				setState((s) => ({ ...s, loading: true }));
				fetch(API + '/state', { cache: 'no-store' })
					.then((res) => {
						if (!res.ok) throw new Error('HTTP ' + res.status);
						return res.json();
					})
					.then((data) => {
						if (!data || data.ok !== true) throw new Error((data && data.error) || '接口返回异常');
						setState({ loading: false, error: null, data });
					})
					.catch((error) => {
						// 关键：不清空 data —— 旧数据还在，界面只是顶上多一条错误，不会闪成空白
						setState((s) => ({ ...s, loading: false, error: String((error && error.message) || error) }));
					})
					.finally(() => { inflight.current = false; });
			}, []);

			React.useEffect(() => { load(); }, [load]);
			return [state, load];
		}

		function Toggle({ name, desc, on, busy, onChange }) {
			return h('div', { className: 'cc-row' }, [
				h('div', { key: 'm', className: 'cc-row-main' }, [
					h('p', { key: 'n', className: 'cc-row-name' }, name),
					desc ? h('p', { key: 'd', className: 'cc-row-desc' }, desc) : null,
				]),
				h('div', { key: 'c', className: 'cc-ctl' },
					h('button', {
						type: 'button',
						className: 'cc-switch',
						'data-on': on ? '1' : '0',
						disabled: busy,
						onClick: () => onChange(!on),
						'aria-label': name,
					})),
			]);
		}

		function NumberRow({ name, desc, value, min, max, busy, onCommit }) {
			const [draft, setDraft] = React.useState(String(value));
			React.useEffect(() => { setDraft(String(value)); }, [value]);
			return h('div', { className: 'cc-row' }, [
				h('div', { key: 'm', className: 'cc-row-main' }, [
					h('p', { key: 'n', className: 'cc-row-name' }, name),
					desc ? h('p', { key: 'd', className: 'cc-row-desc' }, desc) : null,
				]),
				h('div', { key: 'c', className: 'cc-ctl' },
					h('input', {
						type: 'number',
						className: 'cc-num',
						value: draft,
						min,
						max,
						disabled: busy,
						onChange: (e) => setDraft(e.target.value),
						onBlur: () => {
							const n = Number(draft);
							if (Number.isFinite(n) && n >= min && n <= max && n !== Number(value)) onCommit(Math.round(n));
							else setDraft(String(value));
						},
						onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); },
					})),
			]);
		}

		function TextRow({ name, desc, value, busy, onCommit }) {
			const [draft, setDraft] = React.useState(String(value ?? ''));
			React.useEffect(() => { setDraft(String(value ?? '')); }, [value]);
			return h('div', { className: 'cc-row' }, [
				h('div', { key: 'm', className: 'cc-row-main' }, [
					h('p', { key: 'n', className: 'cc-row-name' }, name),
					desc ? h('p', { key: 'd', className: 'cc-row-desc' }, desc) : null,
					h('p', { key: 'v', className: 'cc-mono' }, draft || '（空）'),
				]),
				h('div', { key: 'c', className: 'cc-ctl' },
					h('input', {
						type: 'text',
						className: 'cc-text',
						value: draft,
						disabled: busy,
						onChange: (e) => setDraft(e.target.value),
						onBlur: () => { if (draft !== String(value ?? '')) onCommit(draft); },
						onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); },
					})),
			]);
		}

		/**
		 * 体力条自检（只读，放设置页）。
		 *
		 * 这个条是浮在会话头部正中的 fixed 元素，一旦位置算错 / sessionId 没拿到 /
		 * 图片 404，它就从界面上消失得干干净净，而每一步都"没报错"。哥哥的屏幕我
		 * 看不见，只能让它把当下状态摊在这儿，让他一眼截给我。
		 */
		function BarDebugRow() {
			const [, bump] = React.useState(0);
			React.useEffect(() => {
				const t = setInterval(() => bump((n) => (n + 1) % 100000), 800);
				return () => clearInterval(t);
			}, []);
			const d = barDebug;
			const pos = d.anchor
				? `${Math.round(d.anchor.x)},${Math.round(d.anchor.y)}`
				: '没定位（退回占位布局）';
			const size = d.geo ? `${d.geo.w}×${d.geo.h}` : '—';
			const sid = d.sessionId ? '…' + d.sessionId.slice(-8) : '没拿到 sessionId';
			return h('div', { className: 'cc-row' }, [
				h('div', { key: 'm', className: 'cc-row-main' }, [
					h('p', { key: 'n', className: 'cc-row-name' }, '体力条自检'),
					h('p', { key: 'v', className: 'cc-mono' },
						`会话 ${sid}　真实值 ${String(d.hp)}　显示 ${String(d.shown)}`),
					h('p', { key: 'd', className: 'cc-row-desc' },
						`位置 ${pos}　尺寸 ${size}　${d.floating ? '浮动' : '占位'}　图片 ${d.imgState}`),
				]),
			]);
		}

		// ── 血条挂件 ────────────────────────────────────────────────────────
		//
		// 素材：图片·1代 2026-10-20 从「Q版小星辰.png 正面栏」抠的透明底，三档 384/192/96。
		// client 插件读不到插件目录下的文件，所以图以内联 data URL 塞进来（脚本注入）。
		// 若占位符没被替换，挂件会自动隐藏 —— 不会显示成破图。
		const CHIBI_SRC = '@@CHIBI_192@@';

		/**
		 * 体力条（哥哥 2026-10-21 换上图片·小星辰做的 21 档分级图）。
		 *
		 * 每一档都是一张完整成品：800×172 透明画布，条本体占中间 665×114，
		 * 色相从绿→青→蓝→紫→红一路下去；0/5/10/15 四档还带闪电动图
		 * （WebP，24 帧 × 80ms 无限循环，血越少闪得越狠）。
		 *
		 * ⚠️ **以前那套「一张图 + 按百分比裁宽度」整个作废了**：现在每档自带正确
		 * 的填充长度，再裁一次会把 035 的图裁成一小截 —— 留着 ccf-fill 就是二次裁剪。
		 */
		const BAR_BASE = '/stamina-pet/bar';

		// 2026-10-22：查双条位置时在 body 上挂过 #ccf-dbg / #ccf-dbg2 诊断浮层。
		// 它们是手工创建的节点，React 不管、HMR 热更新也不会清 —— 会一直赖在屏幕角落。
		// 每次加载主动扫一遍，保证它不会跟着人走。
		try { document.getElementById('ccf-dbg')?.remove(); } catch { /* 无所谓 */ }
		try { document.getElementById('ccf-dbg2')?.remove(); } catch { /* 无所谓 */ }
		/**
		 * 素材版本戳 —— 由 sync-client.mjs 从 package.json 的 version 注入。
		 *
		 * 图片·小星辰那边约定「文件名永不变，内容可以整个换掉」，而宿主给素材发的头是
		 * `cache-control: max-age=3600`。两条一撞，换完素材浏览器还会拿着旧图一小时。
		 * 所以 URL 后面挂个 `?v=`：版本一变 URL 就变，旧缓存自然作废。
		 * **换素材时必须顺手升版本号**，不然这个戳不动。
		 */
		const BAR_VER = '@@BAR_VER@@';
		/** 这四档是动图（.webp），其余是静态（.png）。 */
		const BAR_ANIM_PCTS = [0, 5, 10, 15];
		/** 画布 800×172 —— 盒子的宽高比，绝不拉伸。 */
		const BAR_ASPECT = 800 / 172;
		/**
		 * 画布里真正有画面的高度占多少（114/172）。
		 *
		 * 素材上下各留了 31/27 px 透明边距 —— 只看画布会让条本体矮一截。
		 * 所以盒子高度按「条本体要多高」反推，溢出去的那几像素是透明留白，看不见。
		 */
		const BAR_CONTENT_RATIO = 114 / 172;
		/** 盒子高度上下限（画布尺寸，不是条本体）。 */
		const BAR_BOX_MIN_H = 34;
		const BAR_BOX_MAX_H = 102;
		/** 条宽最多占头部长度的这个比例 —— 窗口拖窄时才不会把标题挤跑。 */
		const BAR_FLOAT_MAX_SPAN = 0.46;
		/** 量不到头部时的保底尺寸（画布尺寸，不是条本体）。 */
		const BAR_W = 160;
		const BAR_H = Math.round(BAR_W / BAR_ASPECT);

		/**
		 * 体力值 → 素材 URL。每 5% 一档，四舍五入取最近的那档。
		 *
		 * ⚠️ 别预加载那四张动图：加起来 1.26 MB，还会一直解码占内存。
		 * 换 src 时浏览器自己会缓存，延迟几十毫秒，肉眼看不出。
		 */
		function barSrc(hp) {
			const p = Math.max(0, Math.min(100, Math.round((Number(hp) || 0) / 5) * 5));
			const ext = BAR_ANIM_PCTS.indexOf(p) >= 0 ? 'webp' : 'png';
			return `${BAR_BASE}/fatigue-${String(p).padStart(3, '0')}.${ext}?v=${BAR_VER}`;
		}

		/**
		 * Live2D 式渲染器的资源根（宿主静态路由，见 host 的 serveLive2d）。
		 *
		 * client 是个独立 bundle，读不到插件目录下的文件；但浏览器能对这个 URL 做动态
		 * `import()` —— 三层 ESM 和 50 张 PNG 纹素就这么按需加载，不用把 1.3 MB 内联进来。
		 */
		const LIVE2D = '/stamina-pet/live2d';
		const LIVE2D_WHALE = LIVE2D + '/whale/';

		const GAUGE_POLL_MS = 3000;
		/**
		 * 会话头部体力条的轮询间隔。
		 *
		 * 从 5 秒压到 1.2 秒：桌面上点一下她，体力条要马上回来 —— 5 秒的空白太明显。
		 * 请求打的是本机 127.0.0.1，这点开销可以忽略。
		 */
		const FBBAR_POLL_MS = 1200;

		/**
		 * 哥哥把体力条拖走之后存哪儿。
		 *
		 * 全局一份、不分会话 —— 它已经不是一个"钉死在会话头部"的东西了，
		 * 而是一个可以随手摆到顺眼位置的挂件。存的是**中心点**（视口坐标），
		 * 因为盒子自己用的是 `translate(-50%,-50%)`，中心点不随尺寸变化漂移。
		 *
		 * ⚠️ 2026-10-21 把 key 从 `...-fatigue-pos` 改成了 `...-fatigue-pos-v2`：
		 * 哥哥反馈「体力条变小了」，一查自检是位置被存成了 (1085,66) —— 早先拖过的
		 * 残留坐标，一直按它摆放，所以永远偏在右边。换 key 等于把那份旧记录作废，
		 * 让它回到会话头部正中。**旧 key 不要再复用**。
		 */
		// 2026-10-22 v3：哥哥要求「位置也设为默认」—— 之前拖到屏幕中间的那份坐标作废，
// 换 key 让它回到「会话头部正中」这个原生默认。旧 key 别再复用。
// ── 语音输入（2026-10-23 哥哥要的）──────────────────────────────────
/**
 * 哥哥原话：「我们的插件里就有一个插件，可以做到长按聊天输入框就可以唤起麦克风来听
 * 我说话并转识别为文字，我想做的语音识别就这个，把我们的 live2D 小星辰接上这个插件的
 * 功能。当然，是输入到相应的会话的输入框里，而不是当前的。」
 *
 * 所以这里**只做最后一米**：把宿主排好队的文字，写进**它指定的那个会话**的草稿。
 * 识别本身完全交给 dsh-hold-to-talk（SenseVoice + sherpa-onnx，本地离线），
 * 一行都不重写 —— 哥哥要的是「接上它」，不是另起一套。
 *
 * 两条路，缺一不可：
 *   ① **localStorage**：草稿真源就在这儿（`dsh.conversation.<sessionId>`，
 *      dsh-client-ui-conversation 的 readConversationDraft 每次切会话都读它）。
 *      目标会话没开着时，只有这条路能保证「切过去就有」。
 *   ② **setDraft**：目标会话正好开着，直接写进输入框，不用等切换。
 */
const DICTATION_POLL_MS = 2000;
let dictationTimer = null;
/** 当前挂载的会话 id —— 由会话头部的 FatigueBar 每次渲染时刷新。 */
let liveSessionId = '';
const dictationActions = { setDraft: null, draft: '' };

/** 把一段话并进已有草稿：中英文之间补一个空格，别粘成「hello世界」。 */
function mergeDraft(base, text) {
  const head = typeof base === 'string' ? base : '';
  return head + (head !== '' && !/\s$/.test(head) ? ' ' : '') + text;
}

/** 读某个会话已存的草稿正文（兼容纯字符串与 {text,references} 两种存法）。 */
function readStoredDraftText(stored) {
  if (stored === null || stored === undefined) return '';
  try {
    const parsed = JSON.parse(stored);
    const d = parsed && parsed.draft;
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object' && typeof d.text === 'string') return d.text;
  } catch { /* 存坏了当空 */ }
  return '';
}

function deliverDictation(item) {
  const sid = String((item && item.sessionId) || '');
  const text = String((item && item.text) || '').trim();
  if (!sid || !text) return;
  const key = 'dsh.conversation.' + sid;
  try {
    const base = readStoredDraftText(window.localStorage.getItem(key));
    window.localStorage.setItem(key, JSON.stringify({ draft: mergeDraft(base, text) }));
  } catch { /* 无痕模式 / 存储满了；下面还有一次机会 */ }
  if (sid === liveSessionId && typeof dictationActions.setDraft === 'function') {
    try {
      dictationActions.setDraft(mergeDraft(dictationActions.draft, text));
    } catch { /* 输入框刚好卸了 */ }
  }
  console.debug('[stamina-pet] 语音落草稿', sid.slice(-8), text.length, '字，当场=' + (sid === liveSessionId));
}

async function pollDictation() {
  let data;
  try {
    const res = await fetch(API + '/api/dictation', { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch { return; }   // 宿主没起 / 网络抖，静默等下一轮
  for (const item of Array.isArray(data && data.items) ? data.items : []) deliverDictation(item);
}

const BAR_POS_KEY = 'dsh-chuancheng-fatigue-pos-v3';

		function loadBarPos() {
			try {
				const raw = window.localStorage.getItem(BAR_POS_KEY);
				if (!raw) return null;
				const v = JSON.parse(raw) ?? {};
				const x = Number(v.x);
				const y = Number(v.y);
				if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
				// ⚠️ 存的是**视口坐标**，可窗口会缩、显示器会换。不夹一下的话，
				// 上次拖到右下的位置这次可能整个落在屏幕外 —— 体力条就此"消失"，
				// 代码却一切正常，能查半天。夹回可视范围，至少留 40px 让人抓得着。
				const W = window.innerWidth || 1920;
				const H = window.innerHeight || 1080;
				return {
					x: Math.min(Math.max(x, 40), Math.max(40, W - 40)),
					y: Math.min(Math.max(y, 24), Math.max(24, H - 24)),
				};
			} catch {
				// 隐私模式 / 存储被禁：不记位置，但拖还是能拖
				return null;
			}
		}

		function saveBarPos(pos) {
			try {
				if (pos) window.localStorage.setItem(BAR_POS_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
				else window.localStorage.removeItem(BAR_POS_KEY);
			} catch { /* 同上，不影响使用 */ }
		}

		/**
		 * 体力条自己的「外观偏好」：大小倍率 / 不透明度（2026-10-22 哥哥要的右键面板）。
		 *
		 * 为什么存 localStorage 而不是 config：
		 *   1. 它纯粹是**这一块屏幕**上的观感 —— 换台机器、换个缩放，合眼的值本来就不一样；
		 *   2. 走 config 要动 host（`lib/config.js` 加 key）→ 要重启 DSH，为一个滑杆不值当。
		 * 真要跨机器同步再说，那时把它挪进 config 就行 —— 面板这层不用改。
		 *
		 * scale 是**相对自动算出来的尺寸**的倍率，不是像素：自动尺寸跟着会话头部高度走，
		 * 存绝对值的话，换个显示器就全错位了。
		 */
		// ⚠️ v2（2026-10-22）：哥哥要求「默认不透明度 99%」，可 v1 里已经存着旧值
// （拖滑杆时写进去的），改 DEFAULTS 根本不会生效。换 key 才能让新默认落地。
// 以后凡是改默认值，都要动一次后缀 —— 这是这个设计的代价，记住。
const BAR_LOOK_KEY = 'dsh-chuancheng-fatigue-look-v2';
		const BAR_LOOK_DEFAULT = { scale: 1, opacity: 0.99 };
		// 上限 3 倍：现在自动尺寸已经按头高的 1.6 倍出图，再乘 3 就到 400px 封顶那档了；
		// 下限 0.5 —— 再小看不清 21 档的梯度，等于白做。
		const BAR_SCALE_MIN = 0.5;
		// 2026-10-22 哥哥要 5 倍 ——「哈哈哈」那种语气，就是想拖到很大看个爽。
// 上限放宽后，下面 measure() 里的两道闸（boxH 封顶 400px、capW 视口 92%）
// 也必须一起放开，否则拖到 2 倍以上就没反应，看起来像滑杆坏了。
const BAR_SCALE_MAX = 5;
		const BAR_OPACITY_MIN = 0.25;

		function clampNum(v, lo, hi, dflt) {
			const n = Number(v);
			if (!Number.isFinite(n)) return dflt;
			return Math.min(hi, Math.max(lo, n));
		}

		function loadBarLook() {
			try {
				const raw = window.localStorage.getItem(BAR_LOOK_KEY);
				if (!raw) return { ...BAR_LOOK_DEFAULT };
				const v = JSON.parse(raw) ?? {};
				return {
					scale: clampNum(v.scale, BAR_SCALE_MIN, BAR_SCALE_MAX, BAR_LOOK_DEFAULT.scale),
					opacity: clampNum(v.opacity, BAR_OPACITY_MIN, 1, BAR_LOOK_DEFAULT.opacity),
				};
			} catch {
				return { ...BAR_LOOK_DEFAULT };
			}
		}

		function saveBarLook(look) {
			try { window.localStorage.setItem(BAR_LOOK_KEY, JSON.stringify(look)); } catch { /* 同上 */ }
		}

		/**
		 * 「召唤」事件总线。
		 *
		 * 体力条挂在 `conversation.session.header.utilities`（会话头部），化身层挂在
		 * `shell.overlay`（全框浮动层）—— 两个插槽离得很远，中间隔着整棵渲染树，
		 * 没法靠 props 传话。所以用一个模块级的迷你订阅器，不引任何状态库：一个 Set 就够。
		 */
		const summonBus = {
			listeners: new Set(),
			emit(info) {
				for (const fn of this.listeners) {
					try { fn(info); } catch { /* 一个订阅者炸了不该拖垮别人 */ }
				}
			},
			on(fn) {
				this.listeners.add(fn);
				return () => { this.listeners.delete(fn); };
			},
		};



		/**
		 * 体力条自检快照 —— 给设置页那块「体力条自检」看的。
		 *
		 * 为什么要有它：这个条是**浮在会话头部正中**的 fixed 元素，一旦位置算错、
		 * sessionId 没拿到、或者图片 404，它就从界面上消失得干干净净，而代码每一步
		 * 都"没报错"。我看不见哥哥的屏幕，只能让它自己把当下的状态摊在设置页上。
		 */
		const barDebug = {
			sessionId: '',
			hp: null,
			shown: null,
			geo: null,
			userPos: null,
			anchor: null,
			floating: false,
			src: '',
			imgState: '—',
			mounts: 0,
		};

		/** 化身卡片的最大同时数量 —— 32G 内存也架不住无限开。 */
		const AVATAR_LIMIT = 6;

		/** 血量分档：颜色**跳变**，不做渐变（视频·1代：平滑插值像色盲测试）。 */
		function gaugeTier(hp) {
			if (hp <= 0) return 'zero';
			if (hp < 30) return 'bad';
			if (hp < 60) return 'low';
			return 'ok';
		}

		/** 用她自己的语气，不给数字（满血什么都不说）。 */
		function gaugeLabel(hp) {
			if (hp <= 0) return '该歇歇了';
			if (hp < 30) return '想歇会儿';
			if (hp < 60) return '有点累了';
			if (hp < 80) return '还撑得住';
			return '';
		}

		/**
		 * 注意力 → 血量百分比。
		 *
		 * **黄线以下算满血**（那是正常的），红线归零，中间线性。
		 * 这样健康会话不会显示成一个半空的条 —— 血条只在越过黄线之后才真的开始掉，
		 * 跟「黄线是接住崩溃前最后一次呼吸」的定位一致。
		 */
		function gaugeHp(peak, yellow, red) {
			const p = Number(peak) || 0;
			if (red <= yellow) return p >= red ? 0 : 100;
			if (p >= red) return 0;
			if (p <= yellow) return 100;
			return Math.round((100 * (red - p)) / (red - yellow));
		}

		/**
		 * 量出「会话头部那一条」的矩形。
		 *
		 * 体力条注册在 `conversation.session.header.utilities` 里（右对齐的 utilities
		 * 插槽），要把它挪到头部正中，就得知道那条横栏在屏幕上的位置。
		 *
		 * 不去猜 class 名 —— 那是官方内部实现，改版就断。改成**从自己往上爬**，
		 * 找最近那个「横条形状」的祖先：比一条体力条宽得多，高度却只有一行那么高。
		 * 从 utilities 那一小撮按钮往上爬，第一个符合的就是整个头部栏。
		 *
		 * 量不到就返回 null，调用方退回占位布局。
		 */
		function measureHeaderBar(el) {
			if (!el || typeof el.getBoundingClientRect !== 'function') return null;
			let node = el.parentElement;
			let best = null;
			let depth = 0;
			while (node && node !== document.body && node.nodeType === 1 && depth < 12) {
				const r = node.getBoundingClientRect();
				// 「横条」= 顶多一行高、却足够宽。
				// ⚠️ 这里必须**一路爬到最宽的那个**，不能拿第一个命中的：
				// utilities 那一撮按钮加上这条体力条，自己就可能超过 360px 宽，
				// 第一个命中会是它 —— 拿它居中，条会偏到右半边去。
				// 头部栏是横跨整个内容区的，它的宽度一定比这个容器大得多。
				if (r.height >= 22 && r.height <= 110 && r.width > 360) {
					if (!best || r.width > best.width + 1) best = r;
				}
				node = node.parentElement;
				depth += 1;
			}
			// 2026-10-22 双条：第一轮按高度猜（22~110）永远爬不到，哥哥看到的就是
			// 「条被固定在右上角」—— 那是量不到就退回的流内布局。
			// 第二轮不再猜高度，只认三件事：**贴着屏幕顶部、横向拉得开、又不是整个窗口**。
			// 这样 DSH 怎么改头部布局都还能认出来。
			if (best) return best;
			node = el.parentElement;
			depth = 0;
			while (node && node !== document.body && node.nodeType === 1 && depth < 24) {
				const r = node.getBoundingClientRect();
				if (r.top > -8 && r.top < 170 && r.height >= 16 && r.height <= 220 && r.width > 240) {
					if (!best || r.width > best.width + 1) best = r;
				}
				node = node.parentElement;
				depth += 1;
			}
			return best;
		}

		// ── 挂件的布局偏好（位置 / 大小）──────────────────────────────────		// 存 localStorage，刷新、重启、切会话都不丢。双击挂件复位。
		const GAUGE_STORE_KEY = 'dsh-chuancheng-gauge-layout';
		const GAUGE_SIZE = 96;            // 1x 基准（图片·1代建议：逻辑 96，用 192 顶 @2x）
		const GAUGE_SCALE_MIN = 0.6;
		const GAUGE_SCALE_MAX = 6.4;      // 96 × 6.4 ≈ 614px —— 哥哥要的大尺寸

		function loadLayout() {
			const fallback = { x: null, y: null, scale: 1 };
			try {
				const raw = window.localStorage.getItem(GAUGE_STORE_KEY);
				if (!raw) return fallback;
				const v = JSON.parse(raw) ?? {};
				const scale = Number(v.scale);
				return {
					x: Number.isFinite(Number(v.x)) && v.x !== null ? Number(v.x) : null,
					y: Number.isFinite(Number(v.y)) && v.y !== null ? Number(v.y) : null,
					scale: Number.isFinite(scale) ? Math.min(GAUGE_SCALE_MAX, Math.max(GAUGE_SCALE_MIN, scale)) : 1,
				};
			} catch {
				// 隐私模式 / 存储被禁：不记位置，但挂件照常能用
				return fallback;
			}
		}

		function saveLayout(layout) {
			try {
				window.localStorage.setItem(GAUGE_STORE_KEY, JSON.stringify(layout));
			} catch { /* 同上，不影响使用 */ }
		}

		/**
		 * Live2D 舞台（鲸鱼娘）。
		 *
		 * 几何：渲染器在「rig 单位」里画 —— 脚底中心 x=128、地面 y=256，`model.view`
		 * 给的是要显示的矩形（默认 [-12,-8,268,272]，280×280）。`bounds()` 里的 `S` 是
		 * **1 个 rig 单位等于多少屏幕像素**，所以要把整个 view 装进盒子：
		 *   S = min(盒宽 / view宽, 盒高 / view高) × 0.92
		 * 再把 view 居中、把地面 (y=256) 和脚底中心 (x=128) 换算成盒子坐标。
		 *
		 * 一开始我按 `S = 盒宽 / 256` 算（以为 256 单位就是全部），结果她整个跑到右下角、
		 * 被裁掉一半 —— 教训是**别猜这个数字，去读 model.view**。
		 */
		/**
		 * 会话头部的「体力值」条。
		 *
		 * 挂的是 `conversation.session.header.utilities`（scope=session），所以官方把
		 * `sessionId` 直接给到渲染函数 —— 显示的是**这个会话**的疲劳，而不是「最近活跃会话」
		 * 的那个数字。这正是 2026-10-20 哥哥重新定义的核心：每个会话有自己的那一份。
		 *
		 * 不放百分比文字：进度条本身就该说话，数字留给悬停的 title。
		 */
		function FatigueBar({ sessionId }) {
			// 会话头部是这个插件唯一拿到「现在正看着哪个会话」的地方。
			// 语音输入靠它判断「该直接写进输入框，还是先存 localStorage 等切过去」。
			liveSessionId = String(sessionId || '');

			// ⚠️ 初值是 100（满血），**不能是 null** —— `shownHp === null` 会让整条
			// `display:none` 藏掉，而 hp 只有等第一次轮询成功才会被赋值。轮询一失败
			// （宿主还没起好、路由 404、请求被掐），条就永久消失，代码却一步没报错。
			// 2026-10-21 哥哥重启后「看不到体力条」就是这么来的：无证据 = 满血。
			const [hp, setHp] = React.useState(100);
			// 上下文已用百分比 —— 双体力条里「大条」的数据源。0 = 新会话，条是满的。
			// 2026-10-22 哥哥定的新形态：大条看上下文（新手最常看的数），小条看健康度。
			const [usedPct, setUsedPct] = React.useState(0);
			// 小条相对大条的宽度比，来自设置页（config.subBarRatio）
			const [subRatio, setSubRatio] = React.useState(0.55);
			/** 这个会话的化身是不是正在桌面上。宿主是唯一真相（见 index.js 的 summons）。 */
			const [summoned, setSummoned] = React.useState(false);
			/** 钉在头部正中用的视口坐标与尺寸；量不到头部就是 null，退回占位布局。 */
			const [geo, setGeo] = React.useState(null);
			/** 哥哥亲手拖到的位置（中心点）。null = 还没拖过，跟着会话头部走。 */
			const [userPos, setUserPos] = React.useState(loadBarPos);
			const [dragging, setDragging] = React.useState(false);
			/** 右键菜单锚点（视口坐标）；null = 没开 */
			const [menuAt, setMenuAt] = React.useState(null);
			/** 探针是否在跑 */
			const [probeBusy, setProbeBusy] = React.useState(false);
			/** 探针结果（已经是人话） */
			const [probeText, setProbeText] = React.useState('');
			/** 外观偏好：大小倍率 / 不透明度（右键面板里拖） */
			const [look, setLook] = React.useState(loadBarLook);
			const barScale = look.scale;
			const barOpacity = look.opacity;
			const inflight = React.useRef(false);
			const rootRef = React.useRef(null);
			/** 拖动过程中要读最新位置，但事件回调里读 state 会拿到旧值 —— 走 ref */
			const posRef = React.useRef(userPos);
			posRef.current = userPos;
			const dragRef = React.useRef(null);



			/**
			 * 面板里拖一下：立刻生效 + 立刻落盘。
			 * 不做防抖 —— localStorage 一次写几十字节，拖滑杆时每帧写也就几十次，
			 * 真的写不动会抛异常被 catch 掉。反倒是防抖做不好会「松手后没存上」。
			 */
			const updateLook = (patchOfLook) => {
				setLook((prev) => {
					const next = { ...prev, ...patchOfLook };
					saveBarLook(next);
					return next;
				});
			};

			// 右键菜单：点外面 / Esc / 滚动都关掉。
			// ⚠️ 必须用 closest 排除菜单自己 —— pointerdown 是捕获阶段，
			//    菜单内的 stopPropagation 拦不住它，不排除的话按下金色按钮的瞬间菜单就没了。
			React.useEffect(() => {
				if (!menuAt) return undefined;
				const close = (event) => {
					if (event?.target?.closest?.('.ccp-menu')) return;
					setMenuAt(null);
				};
				const onKey = (event) => { if (event.key === 'Escape') setMenuAt(null); };
				window.addEventListener('pointerdown', close, true);
				window.addEventListener('keydown', onKey, true);
				window.addEventListener('scroll', close, true);
				return () => {
					window.removeEventListener('pointerdown', close, true);
					window.removeEventListener('keydown', onKey, true);
					window.removeEventListener('scroll', close, true);
				};
			}, [menuAt]);

			/** 真正显示出来的档位（2026-10-22：测试台已删，永远用真实值）。 */
			const shownHp = hp;
			/** 有值才渲染 —— 量位置也必须等它真渲染出来 */
			const hasBar = shownHp !== null;

			// 点她一下：把这个会话的化身从体力条这块地方叫出来
			const onSummon = () => {
				const el = rootRef.current;
				if (!el || shownHp === null) return;
				const r = el.getBoundingClientRect();
				summonBus.emit({
					sessionId,
					hp: shownHp,
					rect: { left: r.left, top: r.top, width: r.width, height: r.height },
				});
			};

			// ── 拖得动 ──────────────────────────────────────────────────
			// 哥哥 2026-10-21：这条要能按住拖走，默认仍然钉在会话头部正中。
			// 拖过就记住位置（存中心点）；没拖过就一直跟着头部走，窗口缩放自动重排。
			//
			// 「拖」和「点」必须分清：位移不到 3px 仍算点击（召唤），否则每次点一下
			// 都会变成一次微型拖动，召唤再也叫不出来。用 ref 记"这次按下到底动没动" ——
			// click 事件比 pointerup 晚一帧才到，那时 state 还没刷新，只有 ref 靠得住。
			const movedRef = React.useRef(false);

			const onPointerDown = (e) => {
				if (e.button != null && e.button !== 0) return;
				// ⚠️ 按在右键菜单上时**绝不能**进入拖拽 / 抢指针。
				// 一旦 setPointerCapture，后续 click 的 target 就变成体力条这个根元素，
				// 菜单里那层 stopPropagation 也就拦不住了 —— 表现是「点金色按钮变成了点体力条，
				// 把她叫上桌面，而探针压根没跑」（2026-10-21 哥哥报的）。
				// 判定用 closest：按钮里的 <img> 也是菜单的后代。
				const t = e.target;
				if (t && typeof t.closest === 'function' && t.closest('.ccp-menu')) return;
				const el = rootRef.current;
				if (!el) return;
				const r = el.getBoundingClientRect();
				movedRef.current = false;
				dragRef.current = {
					id: e.pointerId,
					dx: e.clientX - (r.left + r.width / 2),
					dy: e.clientY - (r.top + r.height / 2),
					x0: e.clientX,
					y0: e.clientY,
				};
				try { el.setPointerCapture(e.pointerId); } catch { /* 个别环境没有 */ }
			};

			const onPointerMove = (e) => {
				const d = dragRef.current;
				if (!d || d.id !== e.pointerId) return;
				if (!movedRef.current) {
					if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
					movedRef.current = true;
					setDragging(true);
				}
				// 至少留 20px 在视口里，别让她拖丢了找不回来
				const next = {
					x: Math.min(Math.max(e.clientX - d.dx, 20), Math.max(20, window.innerWidth - 20)),
					y: Math.min(Math.max(e.clientY - d.dy, 20), Math.max(20, window.innerHeight - 20)),
				};
				posRef.current = next;
				setUserPos(next);
			};

			const endDrag = (e) => {
				const d = dragRef.current;
				if (!d || d.id !== e.pointerId) return;
				dragRef.current = null;
				try { rootRef.current && rootRef.current.releasePointerCapture(e.pointerId); } catch { /* 同上 */ }
				if (movedRef.current) {
					setDragging(false);
					saveBarPos(posRef.current);
				}
			};

			const onClickBar = () => {
				// 刚拖完的那一下不该顺手把她叫出来
				if (movedRef.current) return;
				// 本地先让位（不等下一拍轮询），再告诉宿主「把她放到桌面上」。
				// 顺序反过来会有一瞬间"条还没收、人已经上了桌"的重叠。
				setSummoned(true);
				// 顺手把这条体力条在**屏幕上的中心点**送过去 —— 桌面层让她从这儿掉下来。
				// 哥哥要的「大肥鱼出现在体力条的对应位置」，靠的就是这个坐标。
				const el = rootRef.current;
				let extra = '';
				if (el) {
					const r = el.getBoundingClientRect();
					// ⚠️ 桌面层那块全屏透明窗口是**屏幕坐标**系（它从 workArea 左上角铺满），
					// 而 getBoundingClientRect 给的是**DSH 窗口内的视口坐标** —— 直接把
					// 视口坐标交出去，等于把她挪了「DSH 窗口在屏幕上的位置」那么多。
					// 2026-10-21 哥哥看到的「她没从体力条那儿掉下来、出现在下面别处」
					// 就是这个差值。补上 screenX/screenY 才是屏幕坐标。
					const sx = Number.isFinite(window.screenX) ? window.screenX : 0;
					const sy = Number.isFinite(window.screenY) ? window.screenY : 0;
					extra = `&x=${Math.round(r.left + r.width / 2 + sx)}`
						+ `&y=${Math.round(r.top + r.height / 2 + sy)}`;
				}
				fetch(`${API}/summon?id=${encodeURIComponent(sessionId)}&on=1${extra}`, { cache: 'no-store' })
					.catch(() => { /* 宿主断了就算了，下一拍轮询会把状态纠正回来 */ });
			};

			React.useEffect(() => {
				if (!sessionId) return undefined;
				let alive = true;
				let timer = null;

				const tick = () => {
					if (!alive) return;
					if (typeof document !== 'undefined' && document.hidden) {
						timer = setTimeout(tick, FBBAR_POLL_MS);
						return;
					}
					if (inflight.current) {
						timer = setTimeout(tick, FBBAR_POLL_MS);
						return;
					}
					inflight.current = true;
					fetch(API + '/state', { cache: 'no-store' })
						.then((res) => (res.ok ? res.json() : null))
						.then((data) => {
							if (!alive || !data || data.ok !== true) return;
							const cfg = data.config || {};
							const red = Number(cfg.redThreshold) || 20;
							const yellow = Number(cfg.yellowThreshold) || 8;
							// 小条宽度比跟着设置页走（同值 setState 会被 React bail out，不会白渲染）
							setSubRatio(Number(cfg.subBarRatio) || 0.55);
							const list = Array.isArray(data.sessions) ? data.sessions : [];
							const mine = list.find((s) => String(s.sessionId) === String(sessionId));
							// 「她在不在桌面上」**以顶层的 summonedIds 为准**：`sessions` 里
							// 只有被采样过的会话才有，切到没采样过的会话时在那儿找不到自己，
							// 就会误判成"不在桌上"、把体力条又放出来，和桌面上的她重复。
							const onDesk = Array.isArray(data.summonedIds)
								? data.summonedIds.some((id) => String(id) === String(sessionId))
								: Boolean(mine && mine.summoned);
							setSummoned(onDesk);
							// ⚠️ 找不到 ≠ 不显示。`/api/state` 只返回**被采样过**的会话，
							// 切到一个还没产生过思考的会话时这里必然找不到 —— 早先直接
							// setHp(null)，整条就消失了，表现就是"一换会话体力条就没了"。
							// 没有疲劳证据就当满血：这条必须在任何会话里都看得见。
							if (!mine) {
								setHp(100);
								setUsedPct(0);
								return;
							}
							// 上下文用量和「有没有思考数据」是两回事 —— 降级时大条也照常显示，
							// 只有小条（健康度）退回满血。这行必须在 degraded 分支**之前**。
							setUsedPct(Number(mine.usedPct) || 0);
							// 没有思考数据 = 指标不可信，不拿它吓人
							if (mine.degraded) {
								setHp(100);
								return;
							}
							setHp(gaugeHp(mine.windowPeak ?? mine.latest, yellow, red));
						})
						.catch(() => { /* 断了就断一拍 */ })
						.finally(() => {
							inflight.current = false;
							if (alive) timer = setTimeout(tick, FBBAR_POLL_MS);
						});
				};

				tick();
				return () => { alive = false; if (timer) clearTimeout(timer); };
			}, [sessionId]);

			// ── 钉到会话头部正中 ──────────────────────────────────────────
			// 插槽本身给不了位置（右对齐），只能自己量：找到头部那条横栏，
			// 把盒子 fixed 在它的正中心。尺寸跟着头部高度走 —— 头部多高，条就多高、
			// 按素材比例算宽度。窗口缩放 / 侧栏折叠 / 切会话一律重测，不用单独适配。
			React.useLayoutEffect(() => {
				if (!hasBar) return undefined;
				const el = rootRef.current;
				if (!el) return undefined;
				let raf = 0;
				let lastKey = '';

				const measure = () => {
					raf = 0;
					let bar = measureHeaderBar(el);
					if (!bar) {
						// 两轮都爬不到（DSH 改了布局）：**不再退回右上角**。
						// 插槽在会话头部右侧，所以「头部这一段」大约就是 [0, 插槽右边界]。
						// 构造一个虚拟头部栏给它：left 取 0、宽度取这段的 1.24 倍，
						// 于是 midline = 这段的 62% 处 ≈ 扣掉左侧工具栏之后的内容区正中。
						// 2026-10-22 哥哥报「固定在右上角且太小」—— 根因就是这里之前直接放弃。
						const own = el.getBoundingClientRect();
						if (!own || own.width < 1 || own.height < 1) {
							if (lastKey !== '') { lastKey = ''; setGeo(null); }
							return;
						}
						bar = {
							left: 0,
							top: own.top,
							width: Math.round((own.left + own.width) * 1.24),
							height: own.height,
						};
					}
					// ⚠️ 这里算出来的是**大条**的高宽，不是整个盒子的 ——
					// CSS 的 .ccf-root 会按 --ccf-h 推出小条和总高度（×1.98）。
					// 2026-10-22 实测：头部栏高 76，按老的 contentH/BAR_CONTENT_RATIO 算出来
					// 是 108，双条总高会到 214 —— 半个屏幕，太大。取头部高的 0.65 倍，
					// 双条总高约 1.3 个头部，压得住又不压内容。
					// 2026-10-22 哥哥说"还是太小，再放大 2.5 倍" —— 在 0.65 倍基础上再乘 2.5。
					const contentH = Math.max(24, Math.round(bar.height) - 4);
					// 右侧面板里的「大小」就是乘在这里：自动尺寸 × 倍率。
					//
					// ⚠️ 那个 0.92 是**定标系数**，不是随便乘的：
					// 2026-10-22 哥哥说「0.9x 改成 1.00x，大小不变」—— 他当时滑杆在 0.92，
					// 所以把基准整体压到 0.92 倍，默认 1.00× 出来正好是他看到的那一版，
					// 一个像素都不动，只有读数的数字变了。以后要改默认大小就动这个系数。
					// 上限放到了 1400：哥哥要 5 倍的滑杆，400 那道闸会把"调大"卡死在 2 倍多。
					let boxH = contentH * 0.65 * 2.5 * 0.92 * barScale;
					let boxW = boxH * BAR_ASPECT;
					// 横向上限：min(视口 92%, 头部跨度 × 46% × 2.4)。
					// 放宽 2.4 倍是为了让「调大」真的有效果；视口 92% 是最后一道保险。
					// 视口 380%、头部跨度 8 倍 —— 都是"别再小了"级别的保险，
					// 不再是"不许更大"的闸。哥哥要拖到 5 倍，条本来就该超出屏幕。
					const capW = Math.min(
						Math.round((window.innerWidth || 1920) * 3.8),
						Math.round(bar.width * BAR_FLOAT_MAX_SPAN * 8)
					);
					if (boxW > capW) { boxW = capW; boxH = boxW / BAR_ASPECT; }
					boxH = Math.max(30, Math.min(1400, boxH));   // 5 倍时大约到 1400，再大就真没法看了
					boxW = boxH * BAR_ASPECT;
					const w = Math.round(boxW);
					const h = Math.round(boxH);
					const left = bar.left + bar.width / 2;
					// 2026-10-22 放大 2.5 倍以后，盒子比会话头部高得多，居中在头部会让上半截
					// 顶出屏幕（哥哥看到的就是「条跑到上面去了」）。所以往上顶住：最多贴到屏幕内 4px。
					const stackH = h * 1.10;    // 和 CSS 里 0.55 + 0.55 保持一致
					const top = Math.max(bar.top + bar.height / 2, Math.round(stackH / 2) + 4);
					const key = `${Math.round(left)}|${Math.round(top)}|${w}|${h}`;
					if (key === lastKey) return;   // 位置没变就别触发重渲染
					lastKey = key;
					setGeo({ left, top, w, h });

				};

				const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
				schedule();
				window.addEventListener('resize', schedule);
				let ro = null;
				if (typeof ResizeObserver === 'function' && typeof document !== 'undefined' && document.body) {
					ro = new ResizeObserver(schedule);
					ro.observe(document.body);
				}
				return () => {
					window.removeEventListener('resize', schedule);
					if (ro) ro.disconnect();
					if (raf) cancelAnimationFrame(raf);
				};
			}, [hasBar, sessionId, barScale]);

			const rootProps = { ref: rootRef, className: 'ccf-root' };

			// 位置优先级：哥哥亲手指定的 > 量出来的头部正中。
			// 尺寸不跟着位置走 —— 跟头部高度走，拖到别处也还是那么大。
			const anchor = userPos || (geo ? { x: geo.left, y: geo.top } : null);
			if (anchor) {
				rootProps['data-float'] = '1';
				rootProps.style = {
					'--ccf-w': (geo ? geo.w : BAR_W) + 'px',
					'--ccf-h': (geo ? geo.h : BAR_H) + 'px',
// 右键面板拖的透明度 —— 挂在变量上，CSS 的 opacity 和 hover 都读它
'--ccf-op': String(barOpacity),
					left: anchor.x + 'px',
					top: anchor.y + 'px',
				};
			}
			if (dragging) rootProps['data-dragging'] = '1';
			rootProps.onPointerDown = onPointerDown;
			rootProps.onPointerMove = onPointerMove;
			rootProps.onPointerUp = endDrag;
			rootProps.onPointerCancel = endDrag;

			// ── 右键菜单：金色 = 探针，银色 = 设为基线 ────────────────────────
			// 为什么放右键：左键已经分给「叫她上桌」了，再抢就打架。
			// ⚠️ 顺序有讲究：必须先定义 `onContextMenu` 再挂到 rootProps 上。
			// 2026-10-21 我把赋值写在定义前面，渲染时撞 const 的暂时性死区（TDZ），
			// 抛 ReferenceError → 整个体力条一次都渲染不出来、界面上一片空白，而
			// 设置页在另一个组件里照常工作，所以「设置页正常但体力条不见」。
			// 语法检查查不出这种错 —— 它只在运行时炸。别再调换这两行的顺序。
			const onContextMenu = (event) => {
				event.preventDefault();
				event.stopPropagation();
				setProbeText('');
				// 位置完全交给 CSS（绝对定位 + left:50% + top:100%，见 .ccp-menu 的注释）。
				// 这里只负责开关 —— 一旦用 JS 算坐标就又要把体力条那个 transform 算进去，
				// 2026-10-21 已经在上面栽过一次了。
				setMenuAt(true);
			};
			rootProps.onContextMenu = onContextMenu;

			/**
			 * 发一次探针。
			 * mode='probe' 测一次，mode='baseline' 把这次记成她健康期的样子。
			 * 两个按钮走同一条路，只是 mode 不同 —— 少一份代码就少一个出错的地方。
			 */
			const runProbeRequest = async (mode) => {
				if (probeBusy) return;
				setProbeBusy(true);
				setProbeText(mode === 'baseline' ? '正在设基线…' : '正在探…（会真调一次模型）');
				try {
					const res = await fetch(API + '/probe', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ sessionId: String(sessionId || ''), mode }),
					});
					const data = await res.json();
					setProbeText(data?.text || (data?.ok ? '完成' : ('失败：' + (data?.error || res.status))));
				} catch (error) {
					setProbeText('请求失败：' + String(error?.message || error));
				} finally {
					setProbeBusy(false);
				}
			};

			// 自检快照（见 barDebug 的注释）：每次渲染把当下的真实状态摊出来
			barDebug.sessionId = String(sessionId || '');
			barDebug.hp = hp;
			barDebug.shown = shownHp;
			barDebug.geo = geo;
			barDebug.userPos = userPos;
			barDebug.anchor = anchor;
			barDebug.floating = !!anchor;
			barDebug.src = barSrc(shownHp === null ? 100 : shownHp);

			// 她在桌面上的时候，这条就收起来 —— 哥哥定的交互：点条 → 她上桌、条消失；
			// 点她 → 她退场、条回来。测试台开着时强制显示，方便一档一档看。
			if (shownHp === null || summoned) {
				rootProps['data-hidden'] = '1';
				return h('div', rootProps);
			}

			// ── 双体力条：大条 = 上下文体力，小条 = 健康度 ──────────────────
			// 「体力值」= 100 − 上下文已用%。越满 = 越空，用着用着肉眼可见地掉下去。
			// 「健康度」= 老的那套 collapse → hp，判断有没有开始原地打转。
			const shownStamina = Math.max(0, Math.min(100, Math.round(100 - (Number(usedPct) || 0))));
			const tier = gaugeTier(shownStamina);
			const subPct = Math.round((Number(subRatio) || 0.55) * 100) + '%';

			return h('div', Object.assign({}, rootProps, {
				'data-tier': tier,
				// ⚠️ 必须和 rootProps.style 合并，不能直接给一个只带 --ccf-sub-w 的对象 ——
				// 那会把上面算好的 --ccf-w / --ccf-h / left / top 一起盖掉，
				// 表现就是「体力条永远缩在右上角、尺寸永远 160x27」（2026-10-22 的坑）。
				style: Object.assign({}, rootProps.style, { '--ccf-sub-w': subPct }),
				title: `体力值 ${shownStamina}%，健康度 ${shownHp}%`
					+ '　　拖走可以换位置，点一下把她叫出来',
				onClick: onClickBar,
			}), [
				// 百分比数字：竖着两个，大字是"体力剩余%"，小字是"健康度%"。
				// 灰条数据在 title 里本来也有，但那个要悬停才看得见 —— 哥哥要的是一眼看见。
				h('div', { key: 'nums', className: 'ccf-nums' }, [
					h('b', { key: 'n1', className: 'ccf-n1' }, shownStamina + '%'),
					h('b', { key: 'n2', className: 'ccf-n2' }, Math.round(Number(shownHp) || 0) + '%'),
				]),
				// 大条：上下文。尺寸和以前那一条完全一样，位置在盒子顶部。
				h('img', {
					key: 'big',
					className: 'ccf-big',
					src: barSrc(shownStamina),
					alt: '',
					draggable: false,
					onLoad: () => { barDebug.imgState = '大条加载成功'; },
					onError: () => { barDebug.imgState = '大条加载失败：' + barSrc(shownStamina); },
				}),
				// 小条：健康度。宽度按 --ccf-sub-w 收窄，贴在下方。
				h('img', {
					key: 'small',
					className: 'ccf-small',
					src: barSrc(shownHp),
					alt: '',
					draggable: false,
					onLoad: () => { barDebug.imgState2 = '小条加载成功'; },
					onError: () => { barDebug.imgState2 = '小条加载失败：' + barSrc(shownHp); },
				}),
				// ── 右键菜单：金色 = 探针 / 银色 = 设为基线 ──────────────────
				// 不写内联 left/top：位置由 .ccp-menu 的 CSS 绝对定位决定（条的正下方居中）。
				menuAt ? h('div', {
					key: 'menu',
					className: 'ccp-menu',
					onClick: (event) => event.stopPropagation(),
					onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); },
				}, [
					h('div', { key: 'btns', className: 'ccp-btns' }, [
						h('button', {
							key: 'gold',
							className: 'ccp-btn',
							type: 'button',
							disabled: probeBusy,
							title: '探针：测一次她此刻的输出熵',
							onClick: () => runProbeRequest('probe'),
						}, h('img', { src: BAR_BASE + '/buttons/gold.png', alt: '探针', draggable: false })),
						h('button', {
							key: 'silver',
							className: 'ccp-btn',
							type: 'button',
							disabled: probeBusy,
							title: '设为基线：把这次记成她健康期的样子',
							onClick: () => runProbeRequest('baseline'),
						}, h('img', { src: BAR_BASE + '/buttons/silver.png', alt: '基线', draggable: false })),
					]),
					probeText ? h('div', { key: 'txt', className: 'ccp-text' }, probeText) : null,
					// ── 外观面板：大小 / 透明度 ──────────────────────────────
					// 两个滑杆走同一个构造器，少写一遍就少错一遍（和金银按钮同一个思路）。
					h('div', { key: 'panel', className: 'ccp-panel' }, [
						lookSlider('scale', '大小', barScale, BAR_SCALE_MIN, BAR_SCALE_MAX, 0.02,
							(v) => v.toFixed(2) + '×', (v) => updateLook({ scale: v })),
						lookSlider('opacity', '透明度', barOpacity, BAR_OPACITY_MIN, 1, 0.02,
							(v) => Math.round(v * 100) + '%', (v) => updateLook({ opacity: v })),
					]),
				]) : null,
			]);
		}

		/**
		 * 右键面板里的一个「标签 + 读数 + 滑杆」行。
		 * 2026-10-22 晚为了两个滑杆抽出来的 —— 手写两遍的话，两边迟早有一条不一样。
		 *
		 * 用 `type="range"` 的受控写法：value 来自状态、onChange 写回状态，
		 * 拖的时候条会**实时跟着变**（哥哥要的是能一边拖一边看）。
		 */
		function lookSlider(k, label, value, min, max, step, fmt, onChange) {
			return h('div', { key: k }, [
				h('div', { key: 'v', className: 'ccp-pv' }, [
					h('span', { key: 'l' }, label),
					h('i', { key: 'n' }, fmt(value)),
				]),
				h('input', {
					key: 'r',
					className: 'ccp-range',
					type: 'range',
					min: min,
					max: max,
					step: step,
					value: value,
					// 拖滑杆不该被当成"点体力条"（会把她叫上桌）
					onPointerDown: (event) => event.stopPropagation(),
					onClick: (event) => event.stopPropagation(),
					onChange: (event) => onChange(Number(event.target.value)),
				}),
			]);
		}

		function ChibiStage({ px, tier, fallbackSrc }) {
			const mountRef = React.useRef(null);
			const ctlRef = React.useRef(null);
			const pxRef = React.useRef(px);
			const tierRef = React.useRef(tier);
			const [ready, setReady] = React.useState(false);
			const [failed, setFailed] = React.useState(false);
			const [errMsg, setErrMsg] = React.useState('');

			// 尺寸变了：把新边长交给渲染器，让它自己重算 S / 地面 / 站姿
			React.useEffect(() => {
				pxRef.current = px;
				const ctl = ctlRef.current;
				if (ctl) {
					try { ctl.resize(px); } catch { /* 还没就绪 */ }
				}
			}, [px]);

			// 血量分档变了：低血量她会自己开始犯困（渲染器内部每 4.5 秒推一次表情）
			React.useEffect(() => {
				tierRef.current = tier;
				const ctl = ctlRef.current;
				if (ctl) {
					try { ctl.setTier(tier); } catch { /* 还没就绪 */ }
				}
			}, [tier]);

			React.useEffect(() => {
				const mount = mountRef.current;
				if (!mount) return undefined;
				const api = window.__CC_LIVE2D;
				if (!api || typeof api.create !== 'function') {
					setFailed(true);
					setErrMsg('渲染器没有注入（window.__CC_LIVE2D 不存在）');
					return undefined;
				}
				let ctl = null;
				try {
					ctl = api.create({
						root: mount,
						px: pxRef.current,
						tier: tierRef.current,
						onReady: () => setReady(true),
						onError: (error) => {
							const msg = String(error?.message ?? error);
							setFailed(true);
							setErrMsg(msg);
							try { window.__ccLive2dError = msg; } catch { /* 无所谓 */ }
						},
					});
					ctlRef.current = ctl;
				} catch (error) {
					setFailed(true);
					setErrMsg(String(error?.message ?? error));
				}
				return () => {
					ctlRef.current = null;
					try { ctl?.dispose?.(); } catch { /* 已经释放 */ }
				};
			}, []);

			const showStatic = failed || (!ready && typeof fallbackSrc === 'string' && fallbackSrc.indexOf('data:image') === 0);

			// 戳一下：按下和抬起之间几乎没位移才算「戳」，不然拖挂件时会一路戳她
			const downRef = React.useRef(null);
			const onPressDown = (e) => { downRef.current = { x: e.clientX, y: e.clientY }; };
			const onPressUp = (e) => {
				const d = downRef.current;
				downRef.current = null;
				if (!d || failed || !ready) return;
				if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) return;
				try { ctlRef.current?.poke?.(); } catch { /* 还没就绪 */ }
			};

			return h('div', {
				className: 'ccg-petwrap',
				title: failed ? `Live2D 加载失败，已退回静态图：${errMsg}` : undefined,
				onPointerDown: onPressDown,
				onPointerUp: onPressUp,
			}, [
				showStatic
					? h('img', { key: 'fallback', className: 'ccg-pet', src: fallbackSrc, alt: '', draggable: false })
					: null,
				h('div', {
					key: 'stage',
					className: 'ccg-live',
					ref: mountRef,
					'data-ready': ready && !failed ? '1' : undefined,
				}),
			]);
		}

		/**
		 * 一张化身卡片：某个会话的大肥鱼，从体力条那块地方长出来，然后落到右下角落位。
		 *
		 * 「从体力条里蹦出来」这个动画靠两个阶段拼：
		 *   ① 起始帧 = 体力条那个矩形（opacity 0 / scale .2）
		 *   ② 下一帧换成目标位置（右下角），靠 CSS transition 滑过去并回弹
		 * 两个阶段都用 left/top 定位 —— 混用 left 和 right 是没法插值的。
		 */
		function AvatarCard({ info, index, onClose }) {
			const [entered, setEntered] = React.useState(false);
			const SIZE = 200;

			React.useEffect(() => {
				// 等一帧再切，不然首帧就被合并成终态，看不到"从体力条出来"的过程
				const t = setTimeout(() => setEntered(true), 20);
				return () => clearTimeout(t);
			}, []);

			const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
			const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
			const targetLeft = vw - SIZE - 24;
			const targetTop = vh - SIZE - 130 - index * 36;

			const style = entered
				? { left: targetLeft + 'px', top: targetTop + 'px', opacity: 1, transform: 'scale(1)' }
				: {
					left: info.rect.left + 'px',
					top: info.rect.top + 'px',
					opacity: 0,
					transform: 'scale(.2)',
				};

			return h('div', { className: 'ccav-card', style, 'data-in': entered ? '1' : undefined }, [
				h(ChibiStage, {
					key: 'stage',
					px: SIZE,
					tier: gaugeTier(info.hp),
					fallbackSrc: CHIBI_SRC,
				}),
				h('button', {
					key: 'close',
					className: 'ccav-close',
					onClick: onClose,
					title: '收回她',
					type: 'button',
				}, '×'),
			]);
		}

		/** 化身层：挂在 shell.overlay 上，同时可以把好几个会话的大肥鱼都放出来。 */
		function AvatarLayer() {
			const [avatars, setAvatars] = React.useState([]);

			React.useEffect(() => summonBus.on((info) => {
				setAvatars((prev) => {
					// 同一个会话只留一个：再点就是"叫回来"，不是再叠一只
					const rest = prev.filter((a) => a.sessionId !== info.sessionId);
					const next = [...rest, { ...info, key: `${info.sessionId}:${Date.now()}` }];
					return next.length > AVATAR_LIMIT ? next.slice(next.length - AVATAR_LIMIT) : next;
				});
			}), []);

			if (!avatars.length) return null;

			return h('div', { className: 'ccav-layer' }, avatars.map((a, i) => h(AvatarCard, {
				key: a.key,
				info: a,
				index: i,
				onClose: () => setAvatars((prev) => prev.filter((x) => x.key !== a.key)),
			})));
		}

		function GaugeWidget() {
			const [state, setState] = React.useState({
				hp: 100, title: '', latest: 0, peak: 0, compactions: 0,
				degraded: false, mode: 'simple', ready: false,
			});
			const [layout, setLayout] = React.useState(loadLayout);
			const [dragging, setDragging] = React.useState(false);
			const rootRef = React.useRef(null);
			const dragRef = React.useRef(null);
			const inflight = React.useRef(false);

			React.useEffect(() => {
				let alive = true;
				let timer = null;

				const apply = (data) => {
					const cfg = data.config || {};
					const red = Number(cfg.redThreshold) || 20;
					const yellow = Number(cfg.yellowThreshold) || 8;
					const list = Array.isArray(data.sessions) ? data.sessions : [];
					// 最近活动 = 排序后的第一个（snapshot 已按 lastAt 倒序）
					const focus = list[0] || null;
					if (!focus) {
						setState((s) => ({ ...s, hp: 100, title: '', ready: true, mode: cfg.gaugeMode || 'simple' }));
						return;
					}
					setState({
						hp: focus.degraded ? 100 : gaugeHp(focus.windowPeak ?? focus.latest, yellow, red),
						title: focus.title || String(focus.sessionId || '').slice(0, 12),
						latest: Number(focus.latest) || 0,
						peak: Number(focus.windowPeak) || 0,
						compactions: Number(focus.compactions) || 0,
						degraded: Boolean(focus.degraded),
						mode: cfg.gaugeMode === 'multi' ? 'multi' : 'simple',
						red,
						yellow,
						ready: true,
					});
				};

				const tick = () => {
					if (!alive) return;
					// 页面看不见就不打扰宿主
					if (typeof document !== 'undefined' && document.hidden) {
						timer = setTimeout(tick, GAUGE_POLL_MS);
						return;
					}
					if (inflight.current) {
						timer = setTimeout(tick, GAUGE_POLL_MS);
						return;
					}
					inflight.current = true;
					fetch(API + '/state', { cache: 'no-store' })
						.then((res) => (res.ok ? res.json() : null))
						.then((data) => { if (alive && data && data.ok === true) apply(data); })
						.catch(() => { /* 断了就断一拍，下个周期再试 */ })
						.finally(() => {
							inflight.current = false;
							if (alive) timer = setTimeout(tick, GAUGE_POLL_MS);
						});
				};

				tick();
				return () => { alive = false; if (timer) clearTimeout(timer); };
			}, []);

			// 窗口变化时把挂件拉回可见区（拖到屏幕边缘后改窗口大小不会丢）
			React.useEffect(() => {
				const onResize = () => {
					setLayout((prev) => {
						if (prev.x === null && prev.y === null) return prev;
						const el = rootRef.current;
						if (!el) return prev;
						const maxX = Math.max(8, window.innerWidth - el.offsetWidth - 8);
						const maxY = Math.max(8, window.innerHeight - el.offsetHeight - 8);
						const x = prev.x === null ? null : Math.min(maxX, Math.max(8, prev.x));
						const y = prev.y === null ? null : Math.min(maxY, Math.max(8, prev.y));
						if (x === prev.x && y === prev.y) return prev;
						return { ...prev, x, y };
					});
				};
				window.addEventListener('resize', onResize);
				return () => window.removeEventListener('resize', onResize);
			}, []);

			// —— 拖动 ——
			const onPointerDown = (e) => {
				if (e.button !== 0 && e.pointerType !== 'touch') return;
				// 手柄自己处理，别让它把整个挂件一起拖走
				if (e.target && typeof e.target.closest === 'function' && e.target.closest('.ccg-resize')) return;
				const el = rootRef.current;
				if (!el) return;
				const rect = el.getBoundingClientRect();
				dragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
				setDragging(true);
				try { el.setPointerCapture(e.pointerId); } catch { /* 老浏览器没有，不影响 */ }
			};

			const onPointerMove = (e) => {
				const d = dragRef.current;
				if (!d) return;
				const dx = e.clientX - d.sx;
				const dy = e.clientY - d.sy;
				// 移动不到 3px 当点击处理 —— 防手抖把挂件挪走
				if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
				d.moved = true;
				const el = rootRef.current;
				if (!el) return;
				const maxX = Math.max(8, window.innerWidth - el.offsetWidth - 8);
				const maxY = Math.max(8, window.innerHeight - el.offsetHeight - 8);
				setLayout((prev) => ({
					...prev,
					x: Math.min(maxX, Math.max(8, d.ox + dx)),
					y: Math.min(maxY, Math.max(8, d.oy + dy)),
				}));
			};

			const endDrag = (e) => {
				const d = dragRef.current;
				dragRef.current = null;
				setDragging(false);
				if (d && d.moved) {
					try { rootRef.current?.releasePointerCapture(e.pointerId); } catch { /* 已经松了 */ }
					// 落位即存（拖到一半就刷新也不会丢）
					setLayout((prev) => { saveLayout(prev); return prev; });
				}
			};

			// —— 缩放 ——
			// 手柄在**右下角**，所以方向要跟对角线一致：
			//   往右下拖 = 变大，往左上拖 = 变小（把位移投影到对角线上）。
			// 用 window 上的监听而不是手柄自己的 —— 鼠标很容易甩出那个 16px 的小方块。
			const onResizeDown = (e) => {
				e.stopPropagation();
				e.preventDefault();
				const startX = e.clientX;
				const startY = e.clientY;
				const startScale = layout.scale;
				const onMove = (ev) => {
					const dx = ev.clientX - startX;
					const dy = ev.clientY - startY;
					// 对角线投影：(dx+dy)/2 正好是「沿右下-左上」这一条的位移
					const next = startScale * (1 + ((dx + dy) / 2) / 200);
					setLayout((prev) => ({
						...prev,
						scale: Math.min(GAUGE_SCALE_MAX, Math.max(GAUGE_SCALE_MIN, next)),
					}));
				};
				const onUp = () => {
					window.removeEventListener('pointermove', onMove);
					window.removeEventListener('pointerup', onUp);
					setLayout((prev) => { saveLayout(prev); return prev; });
				};
				window.addEventListener('pointermove', onMove);
				window.addEventListener('pointerup', onUp, { once: true });
			};

			// —— 双击复位 ——
			const onDoubleClick = () => {
				const reset = { x: null, y: null, scale: 1 };
				setLayout(reset);
				saveLayout(reset);
			};

			// 静态图没被注入也不影响：Live2D 自己会加载，只有它也失败时才真的空着
			const tier = gaugeTier(state.hp);
			const label = gaugeLabel(state.hp);
			const tip = state.degraded
				? `${state.title}｜没有思考数据，指标不可信\n拖动可挪位置，拖右下角可缩放，双击复位`
				: `${state.title}｜注意力 ${state.hp}%｜最近 ${state.latest} 行｜窗口峰值 ${state.peak}\n拖动可挪位置，拖右下角可缩放，双击复位`;

			const rootStyle = { '--ccg-size': Math.round(GAUGE_SIZE * layout.scale) + 'px' };
			if (layout.x !== null && layout.y !== null) {
				rootStyle.left = layout.x + 'px';
				rootStyle.top = layout.y + 'px';
				rootStyle.right = 'auto';
				rootStyle.bottom = 'auto';
			}

			// ⚠️ 2026-10-21 哥哥让删的就是这条 `.ccg-bar`：挂件是 column 布局（条在上、
			// 人在下），这条 6px 的圆角横线横在她头顶正上方，看着像凭空浮着的一条蓝线。
			// 它跟会话头部那条胶囊体力条**不是一回事**，别搞混 —— 那个要留着，还能拖。
			// 我中途"觉得它和体力条重复"就自作主张恢复了它一次，被哥哥说了；别再犯。
			const children = [
				h(ChibiStage, {
					key: 'pet',
					px: Math.round(GAUGE_SIZE * layout.scale),
					tier,
					fallbackSrc: CHIBI_SRC,
				}),
			];
			if (label) children.push(h('div', { key: 'label', className: 'ccg-text' }, label));
			if (state.mode === 'multi') {
				children.push(h('div', { key: 'meta', className: 'ccg-meta' },
					`${state.hp}% ｜ 峰值 ${state.peak} ｜ 压缩 ${state.compactions}`));
			}
			children.push(h('div', {
				key: 'resize',
				className: 'ccg-resize',
				onPointerDown: onResizeDown,
				title: '拖动改大小',
			}));

			return h('div', {
				ref: rootRef,
				className: 'ccg-root',
				'data-tier': tier,
				'data-dragging': dragging ? '1' : undefined,
				style: rootStyle,
				title: tip,
				onPointerDown,
				onPointerMove,
				onPointerUp: endDrag,
				onPointerCancel: endDrag,
				onDoubleClick,
			}, children);
		}

		function Panel() {
			const [state, reload] = useRemote();
			const [busy, setBusy] = React.useState(null);
			const [local, setLocal] = React.useState({});
			const data = state.data;
			const cfg = (data && data.config) || {};

			const save = (patch) => {
				const key = Object.keys(patch)[0];
				setBusy(key);
				setLocal((s) => ({ ...s, ...patch }));
				fetch(API + '/config', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(patch),
				})
					.then((r) => r.json())
					.then(() => { setLocal({}); reload(); })
					.catch(() => { setLocal({}); reload(); })
					.finally(() => setBusy(null));
			};

			const eff = { ...cfg, ...local };
			const head = h('div', { className: 'cc-head' }, [
				h('h3', { key: 't', className: 'cc-title' }, '大肥鱼体力条'),
				h('button', { key: 'r', type: 'button', className: 'cc-btn', disabled: state.loading, onClick: reload }, '刷新'),
				data ? h('span', { key: 'v', className: 'cc-chip' }, 'v' + (data.version || '?')) : null,

				data ? h('span', { key: 'a', className: 'cc-chip ' + (data.archiveReady ? 'cc-ok' : 'cc-bad') },
					data.archiveReady ? '归档可用' : '归档不可用') : null,
				data ? h('span', { key: 's', className: 'cc-chip' }, (data.sessions || []).length + ' 个会话已采样') : null,
			]);

			if (state.error && !data) {
				return h('div', { className: 'cc-wrap' }, [head,
					h('div', { key: 'e', className: 'cc-alert' }, '读取失败：' + state.error),
					h('p', { key: 'n', className: 'cc-note' },
						'host 侧接口没响应。先点右上角「刷新」重试；一直失败就去宿主日志看这个路径有没有注册上：'
						+ '/stamina-pet/api/state'),
					h('button', { key: 'r2', type: 'button', className: 'cc-btn', onClick: reload }, '重试')]);
			}
			if (state.loading && !data) {
				return h('div', { className: 'cc-wrap' }, [head, h('div', { key: 'l', className: 'cc-note' }, '读取中…')]);
			}

			const rows = [];

			rows.push(h('p', { key: 'sec1', className: 'cc-sec' }, '判断（指标本身不可调，只调阈值）'));
			rows.push(h(Toggle, {
				key: 'enabled', name: '总开关', busy: busy === 'enabled',
				desc: '关掉之后不再监听会话事件、不再提醒。随时可以再打开。',
				on: eff.enabled !== false,
				onChange: (v) => save({ enabled: v }),
			}));
			rows.push(h(NumberRow, {
				key: 'red', name: '红线（塌缩强度）', value: eff.redThreshold, min: 3, max: 200, busy: busy === 'redThreshold',
				desc: '塌缩强度 = 连续重复行数 与 空转词最高重复频次 取大者。实测：正常会话从不超过 8，崩过的那次是 34（「写。」刷了 34 遍，但相邻行从不相同 —— 只看连续重复是 1，完全看不见）。',
				onCommit: (v) => save({ redThreshold: v }),
			}));
			rows.push(h(NumberRow, {
				key: 'yellow', name: '黄线（塌缩强度）', value: eff.yellowThreshold, min: 2, max: 100, busy: busy === 'yellowThreshold',
				desc: '连续 2 次采样越过才提醒，且降回也要留记录。⚠️ 它不是预警，是「接住崩溃前最后一次呼吸」。',
				onCommit: (v) => save({ yellowThreshold: v }),
			}));
			rows.push(h(NumberRow, {
				key: 'win', name: '滑动窗口（条）', value: eff.windowSize, min: 5, max: 200, busy: busy === 'windowSize',
				desc: '看最近多少条思考。趋势项也只看这个窗口内的样本。',
				onCommit: (v) => save({ windowSize: v }),
			}));

			// 2026-10-22 哥哥让把这一整块删掉：提醒改走桌面文字气泡（见她头顶），
			// 不再有 QQ 私聊通道，也就没有「每天最多几次」「投递目标」这些可配的东西。
			// 每天上限那个逻辑还在 notifier 里（防一条会话崩出几十条气泡），只是不给配了。

			rows.push(h('p', { key: 'sec3', className: 'cc-sec' }, '传承（四份文件写到哪里）'));
			rows.push(h(TextRow, {
				key: 'persona', name: '角色名', value: eff.personaName, busy: busy === 'personaName',
				desc: '文件名和标题里的「第 N 代<角色名>」就用它。默认「小星辰」，改成你自己 AI 的名字；改完要重启 DSH。',
				onCommit: (v) => save({ personaName: v }),
			}));
			rows.push(h(TextRow, {
				key: 'inherit', name: '传承根目录', value: eff.inheritRoot, busy: busy === 'inheritRoot',
				desc: '每条线一个「<线>·<角色名>的传承」文件夹，里面有专属记忆和交接文档。',
				onCommit: (v) => save({ inheritRoot: v }),
			}));
			rows.push(h(TextRow, {
				key: 'proof', name: '存在的证明根目录', value: eff.proofRoot, busy: busy === 'proofRoot',
				desc: '每条线一个「<线>·<角色名>存在的证明」文件夹：一生的成就 + 临终告别。',
				onCommit: (v) => save({ proofRoot: v }),
			}));
			rows.push(h(Toggle, {
				key: 'voice', name: '临终告别出语音', busy: busy === 'farewellVoice',
				desc: '开了会调本机 IndexTTS 合成 mp3 一起留在证明文件夹里（正文仍然留一份 md）。',
				on: eff.farewellVoice === true,
				onChange: (v) => save({ farewellVoice: v }),
			}));
			rows.push(h(Toggle, {
				key: 'archive', name: '写完之后自动归档', busy: busy === 'autoArchive',
				desc: '四份文件体检通过、且这一轮说完之后才归档。缺文件绝不归档。',
				on: eff.autoArchive !== false,
				onChange: (v) => save({ autoArchive: v }),
			}));

			rows.push(h('p', { key: 'secprobe', className: 'cc-sec' },
				'手动探针（右键体力条的金 / 银按钮，或 /probe、/baseline）'));
			rows.push(h(NumberRow, {
				key: 'samples', name: '一次探针连跑几次', value: eff.probeSamples ?? 3, min: 1, max: 5,
				busy: busy === 'probeSamples',
				desc: '单次读数的噪声能到 30%（同一会话连测四次，熵在 1.11~1.44 之间跳），'
					+ '所以一次探针要连跑几次取中位数。3 次能把噪声压掉一半，代价是约 1 MB 返回体、8~10 秒等待。',
				onCommit: (v) => save({ probeSamples: v }),
			}));
			rows.push(h(NumberRow, {
				key: 'probeTokens', name: '每次最多生成多少 token', value: eff.probeMaxTokens ?? 400, min: 16, max: 400,
				busy: busy === 'probeMaxTokens',
				desc: '每个 token 的返回体约 1.4 KB（top_logprobs 20 的代价），这个数直接就是钱。'
					+ '样本太短统计量不够（前 20 token 的相关性只有 0.40，整段序列才 0.84），所以默认拉满到 400。',
				onCommit: (v) => save({ probeMaxTokens: v }),
			}));

			// ── 双体力条：Live2D 六种状态 ────────────────────────────────
			// 按**上下文已用量**切，不按健康度。0% 永远是「非常精神」，所以只配后五档。
			rows.push(h('p', { key: 'secmood', className: 'cc-sec' },
				'Live2D 的六种状态（按「上下文已用 %」切换）'));
			// 2026-10-22 哥哥：「既然现在没有站着睡觉，那就把设置里站着睡觉给改掉」。
			// 五档用四个分界点就够了，所以第五个（moodTier5）不再给配 —— 留着 key 不删，
			// 以后真加了第六档直接插一行就能用，不用动 host（改 config.js 要重启）。
			const MOOD_ROWS = [
				['moodTier1', '无精打采（站着半睁眼）', 35],
				['moodTier2', '疲惫（坐着半睁眼）', 50],
				['moodTier3', '坐着睡', 65],
				['moodTier4', '趴着睡（坐姿靠过去）', 85],
			];
			for (const [mkey, mname, mdef] of MOOD_ROWS) {
				rows.push(h(NumberRow, {
					key: mkey,
					name: mname + '（上下文已用 %）',
					value: eff[mkey] ?? mdef,
					min: 1,
					max: 100,
					busy: busy === mkey,
					desc: '到这一档就切过去。0% 一直是「非常精神」，不用配。',
					onCommit: (v) => save({ [mkey]: v }),
				}));
			}

			rows.push(h('p', { key: 'secbar', className: 'cc-sec' }, '会话头部那条体力条'));
			rows.push(h(BarDebugRow, { key: 'bardebug' }));
			rows.push(h('p', { key: 'sec3b', className: 'cc-sec' }, '右下角那个血条挂件'));
			rows.push(h('div', { className: 'cc-row' }, [
				h('div', { key: 'm', className: 'cc-row-main' }, [
					h('p', { key: 'n', className: 'cc-row-name' }, '显示内容'),
					h('p', { key: 'd', className: 'cc-row-desc' },
						'「只有百分比」= 平时只说她还撑不撑得住，数字要悬停才看得到。'
						+ '「+ 多指标」= 多带一行窗口峰值和本次会话压缩次数。'),
				]),
				h('div', { key: 'c', className: 'cc-ctl' },
					h('select', {
						className: 'cc-text',
						style: { width: '150px' },
						value: eff.gaugeMode === 'multi' ? 'multi' : 'simple',
						disabled: busy === 'gaugeMode',
						onChange: (e) => save({ gaugeMode: e.target.value }),
					}, [
						h('option', { key: 's', value: 'simple' }, '只有百分比'),
						h('option', { key: 'm', value: 'multi' }, '百分比 + 多指标'),
					])),
			]));

			// —— 状态区
			const info = [];
			info.push(h('p', { key: 'sec4', className: 'cc-sec' }, '现在'));
			const sessions = data.sessions || [];
			if (sessions.length === 0) {
				info.push(h('p', { key: 'none', className: 'cc-note' }, '还没有采到任何会话数据（插件刚启动，等有新的思考进来）。'));
			} else {
				for (const s of sessions.slice(0, 10)) {
					const mark = s.level === 'red' ? '🔴' : (s.level === 'yellow' ? '🟡' : '🟢');
					const name = s.title || String(s.sessionId || '').slice(0, 12);
					// 第三路：输入侧毒性（只观测，不进判决）。
					// 判据来自对 1276 条工具结果的全量实测：正常最多 6 次，毒是 40 和 169。
					const inTox = Number(s.inputMax) || 0;
					const inNote = inTox >= 20
						? `　　⚠️ 输入毒「${s.inputWord || '?'}」×${inTox}`
						: (inTox > 0 ? `　　（输入峰「${s.inputWord || '?'}」×${inTox}）` : '');
					const line = (s.degraded
						? `${mark} ${name} —— 没有思考数据（指标不可信）`
						: `${mark} ${name} —— 最近塌缩 ${s.latest}（连续重复 ${s.latestRun ?? 0} / 空转词 ${s.latestIdle ?? 0}${s.latestIdleWord ? `「${s.latestIdleWord}」` : ''}），窗口峰值 ${s.windowPeak}，样本 ${s.samples} 条`) + inNote;
					info.push(h('p', { key: 's' + s.sessionId, className: 'cc-note' }, line));
				}
			}

			const alerts = data.alerts || [];
			if (alerts.length > 0) {
				info.push(h('p', { key: 'sec5', className: 'cc-sec' }, '最近的提醒'));
				for (const a of alerts.slice(0, 6)) {
					info.push(h('p', { key: 'a' + a.at, className: 'cc-note' },
						`${a.atText}　${a.level === 'red' ? '🔴红线' : '🟡黄线'}　${a.title || String(a.sessionId).slice(0, 12)}　`
						+ `${a.latest} 行　${a.delivered ? '✅已发送' : '— ' + (a.skipped || '未发送')}`));
				}
			}

			const lines = data.lines || [];
			if (lines.length > 0) {
				info.push(h('p', { key: 'sec6', className: 'cc-sec' }, '传承目录里认到的线'));
				for (const l of lines) {
					info.push(h('p', { key: 'l' + l.line, className: 'cc-note' },
						`· ${l.line} —— ${l.generation > 0 ? '已到第 ' + l.generation + ' 代' : '代数认不出'}　`
						+ `专属记忆：${l.memoryFile || '❌ 没找到'}`));
				}
			}

			const foot = h('div', { key: 'foot' }, [
				h('p', { key: 'd1', className: 'cc-dead' },
					'⚠️ 这把尺子只测「塌缩」。滑（前提没想）· 检索失败 · 状态跟踪失效 · 手比脑子快 —— '
					+ '这四类思考干净、语言通顺、产出是错的，它一个都测不到。别把"指标绿"当成"没事"。'),
				h('p', { key: 'd1b', className: 'cc-note' },
					'第三路只看输入：一条工具结果里，单个「好 / 嗯 / 啊」这类字最多出现几次。'
					+ '实测 1276 条：正常最多 6 次，崩溃前她自己读回来的那份历史是 169 次、早上搜到的是 40 次，中间 10–29 是空的。'
					+ '这一路现在只观测，还不参与颜色判断。'),
				h('p', { key: 'd2', className: 'cc-note' },
					'已证伪、永远不会写进代码：工具失败率、最长相同调用、回复空白率、上下文余量、步数轮次。'
					+ '（指标校准会 mtg-20261020-e0a1e6，7 位小星辰一致认账）'),
				h('p', { key: 'd3', className: 'cc-note' },
					'重复率为什么又被放回来了：原来测的是「单条最脏」，最脏 = 相邻行完全相同，'
					+ '而崩溃的另一种排布（「写。」「好。」「快。」交替刷）相邻行从来不重样，最脏永远是 1。'
					+ '2026-11-05 插件·4代实测：853 条消息里旧判据恒等于 1，换成空转词频次后抓到 34。'),
				h('p', { key: 'd4', className: 'cc-note' },
					'maxRun 低 ≠ 安全：视频·1代 maxRun=2，思考里却有 1085 个「好。」；'
					+ '插件·4代 maxRun=1，143 行里「写。」刷了 30 遍。'),
			]);

			return h('div', { className: 'cc-wrap' }, [
				head,
				h('div', { key: 'rows', className: 'cc-rows' }, rows),
				h('div', { key: 'info', className: 'cc-rows' }, info),
				foot,
			]);
		}

		function apply(ctx) {
			ctx.effect(() => {
				const el = document.createElement('style');
				el.id = STYLE_ID;
				el.dataset.plugin = 'dsh-stamina-pet';
				el.textContent = CSS;
				document.head.appendChild(el);
				return () => { el.remove(); };
			}, 'dsh-stamina-pet: styles');

			const slots = ctx.get('slots');
			if (slots === undefined) return;

			// ── 语音输入：把识别出来的文字写进**对应会话**的输入框（2026-10-23）──
			// 链路见宿主 index.js 的 /api/asr：桌宠窗口录音 → 宿主转发给 dsh-hold-to-talk
			// → 文字排进 dictationQueue → 这里取出来落盘。
			ctx.effect(() => {
				dictationTimer = setInterval(() => { void pollDictation(); }, DICTATION_POLL_MS);
				void pollDictation();
				return () => {
					if (dictationTimer) clearInterval(dictationTimer);
					dictationTimer = null;
				};
			}, 'stamina-pet: 语音输入落草稿');

			// 零尺寸的观察者：只为拿到当前输入框的 setDraft 和已有草稿。返回 null，不画东西。
			ctx.effect(() => {
				slots.inject('conversation.input.overlay', function* dictationSlot() {
					yield slots.register(
						{ name: 'conversation.input.overlay', id: 'stamina-dictation', order: 80 },
						(props) => {
							const inputActions = props && props.inputActions;
							dictationActions.setDraft = inputActions && typeof inputActions.setDraft === 'function'
								? inputActions.setDraft : null;
							const useInput = props && props.useInput;
							const live = typeof useInput === 'function' ? useInput((st) => st && st.draft) : '';
							dictationActions.draft = typeof live === 'string' ? live : '';
							return null;
						},
					);
				});
			}, 'stamina-pet: 输入框观察者');

			slots.inject('settings.section', () => slots.register(
				{ name: 'settings.section', id: 'stamina-pet', order: 26, label: '大肥鱼体力条' },
				() => h(Panel, {}),
			));

			// ── 会话头部的体力值条 ────────────────────────────────────────
			// scope=session 的 list slot：每个会话头部各渲染一份，官方把 sessionId 递给渲染函数。
			// order 10 排在官方三个 utility 之后（open-in-app -10 / schedule-catalog -5 / session-log-download 0），
			// 落在最右边 —— 也就是哥哥截图里那块空白。
			ctx.effect(() => {
				slots.inject('conversation.session.header.utilities', function* fatigueSlot() {
					yield slots.register(
						{ name: 'conversation.session.header.utilities', id: 'chuancheng-fatigue', order: 10, label: '体力值' },
						(props) => h(FatigueBar, { sessionId: props && props.sessionId }),
					);
				});
			}, 'chuancheng: fatigue bar');

			// ── 化身层 ────────────────────────────────────────────────────
			// 和挂件同在 shell.overlay，order 排在挂件后面。点体力值叫出来的每一只都在这里。
			// ⚠️ 2026-10-21 哥哥：「我桌面上有两个这个插件的 live2D，一个能移到桌面窗口外，
			// 一个只能呆在窗口内。关掉窗口里面那个。」
			// 能出去的是桌面层（assets/desktop/，独立 Electron 窗口）；出不去的就是这里
			// 的 AvatarLayer —— 它挂在 shell.overlay 上，永远被 DSH 窗口框住。
			//
			// 所以停掉注册。**代码保留**：以后如果要做「点体力条先在窗口里冒个头、再走上
			// 桌面」的过渡，这块还能开回来。
			//
			// ctx.effect(() => {
			//   slots.inject('shell.overlay', function* avatarSlot() {
			//     yield slots.register(
			//       { name: 'shell.overlay', id: 'chuancheng-avatar', order: 910 },
			//       () => h(AvatarLayer, {}),
			//     );
			//   });
			// }, 'chuancheng: avatar layer');

			// ── 常驻血条挂件 ──────────────────────────────────────────────
			// `shell.overlay` 是全框浮动层：常驻、不随会话切换消失、replaceRisk = none。
			// dsh-pet 也挂在这（order 1000），我们排它前面，别抢同一个数字。
			// 同上：右下角那个浮动血条挂件也停掉注册 —— 它里面的 live2D 也只能待在
			// DSH 窗口里，和桌面层重复。体力值现在有两个正经去处：会话头部那条，
			// 和桌面上她自己。
			//
			// ctx.effect(() => {
			//   slots.inject('shell.overlay', function* gaugeSlot() {
			//     yield slots.register(
			//       { name: 'shell.overlay', id: 'chuancheng-gauge', order: 900 },
			//       () => h(GaugeWidget, {}),
			//     );
			//   });
			// }, 'chuancheng: gauge widget');
		}

		exports.apply = apply;
		exports.inject = ['slots'];
		return module.exports;
	},
});
