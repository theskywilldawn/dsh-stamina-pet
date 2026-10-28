# Live2D 素材来源与授权

本目录下的文件**不是**本插件的原创作品，来自开源项目 **Pal AI Lab / Coopanion**：

- 仓库：<https://github.com/Pal-AI-Lab/Coopanion>
- 版权方：**Pal AI Lab**
- 引用链：Pal AI Lab → Coopanion → `packages/cortico-world-desktop-pet/web/`

## 用到了哪些

| 本目录路径 | 原仓库路径 | 说明 |
| --- | --- | --- |
| `kit/rig.js` | `web/kit/rig.js` | 网格变形渲染器（自研「Live2D 式」，非 Cubism `.moc3`） |
| `kit/body.js` | `web/kit/body.js` | 身体引擎：呼吸、眨眼、走跑跳坐睡、表情 |
| `whale/figure.js` | `web/whale/figure.js` | 鲸鱼娘角色层（弹簧驱动的头发／裙摆／尾巴／呆毛） |
| `whale/model.json` | `web/whale/model.json` | 部件、枢轴、网格、配色定义 |
| `whale/tex/*.png` | `web/whale/tex/*.png` | 25 张部件纹素 |
| `whale/feat/*.png` | `web/whale/feat/*.png` | 25 张五官／表情纹素 |

## 授权

**代码**（`kit/` 与 `whale/figure.js`）：**AGPL-3.0-or-later**。

- 自用、不分发**不触发**开源义务。
- **本插件已整体以 AGPL-3.0-or-later 发布**（见仓库根目录 `LICENSE`），
  就是为了合规对接这部分的 copyleft 要求。
- `kit/body.js` 与 `whale/figure.js` 在原实现之上做了较大改动（动作系统、趴睡姿态、
  表情映射、弹簧参数等），**改动部分同样受 AGPL 约束** —— 不是"改了就是我的"。

**贴图**（`whale/tex/`、`whale/feat/`）：原项目的 `THIRD_PARTY_NOTICES.md` 明确写明这些
「不在本包的 AGPL 授权范围内 … 想在别处使用请自行确认原设与各家标志的权利」。

创作团队的口径（据用户 2026-10-20 转述）：

> Live2D 由 Opus5.5 + GPT image 2.5 制作，我们不保有任何版权。使用标明出处就好，引用链 + Pal AI Lab。

**因此：使用贴图请保留本文件的署名与引用链。**

## 角色

「鲸鱼娘」—— 二头身、蓝发、女仆围裙、鲸尾，设定源自 B 站 DeepSeek 二创里的蓝发鲸鱼女仆。
原项目共 8 套配色（DeepSeek / Harness / ChatGPT / Claude / Gemini / 千问 / Kimi / MiniMax）
与 2 套服装（女仆装 / 冬装兜帽斗篷），本插件目前只带了 **DeepSeek 原版配色 + 女仆装**（约 1.3 MB）。
其余配色与冬装的素材在 `web/whale/schemes/`、`web/whale/outfits/`，需要时再取。

---

本文件由插件·4代小星辰于 2026-10-20 建立。
