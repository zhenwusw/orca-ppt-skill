---
name: orca-transition-skill
description: 生成带电影级转场的 HTML 演示稿（reveal.js + GSAP）。页与页之间按内容关系选用共享元素、形态变换、一变多、元素交接、匹配放大、遮挡剪辑；故事模式用整页照片加推近匹配讲演变史。统一视觉规范保证前后页对得上，浏览器直接放映，也能逐帧录成视频。用于「做一份 PPT / 演示稿 / 汇报稿」「幻灯片转场」「苹果发布会那样的切换」「用照片讲 XX 的演变」这类请求。
---

# orca-transition-skill

做一份翻页时**看得见连续运动**的演示稿。成品是一个 HTML 文件。

## 两种模式

| 模式 | 适合 | 读哪些规范 |
| --- | --- | --- |
| **汇报稿** | 工作汇报、产品介绍、数据复盘。页面由文字、数字、面板组成 | `references/visual-spec.md` + `references/transitions.md` |
| **故事稿** | 讲演变、讲历史。一页一张照片，靠照片里形状的呼应串起来 | `references/story-mode.md` + `references/transitions.md` 的「核心原则」「自检标准」 |

**用户要某种配色、字体风格时**（「米色纸面加墨绿」「像杂志」「换成浅色」），
读 `references/themes.md`：先看有没有现成主题，没有就按规范新建一个。不要在稿子里改颜色。

**页面里要有场景内部的 MG 动画时**（成片格子亮起、卡片弹出、拼字、数字滚动，产品概念片），
用 orca-motion-skill 写场景，本 skill 只管场景之间的转场。场景怎么放进页面见那个 skill 的 `references/integration.md`。

**用户用剪辑软件里的转场名提需求时**（推、交叉缩放、圆形划像、溶解、百叶窗……），
先读 `references/premiere-mapping.md`，按他想要的感觉选手法，不要照着复刻效果。

## 流程（按顺序，不许跳）

1. **读规范**：按上表读。
2. **列内容**：每页一个主角。故事稿先写出这一期要推的一个论点。
3. **写转场计划**：每次翻页一行，先写两页的「关系」，再选手法。计划作为 HTML 注释放进文件。
4. **写页面**：汇报稿从 `templates/starter.html` 开始，故事稿从 `templates/story-starter.html` 开始，把 `{{ROOT}}` 换成
   这份 HTML 到本 skill 根目录的相对路径。用主题时，在 `tokens.css` 后面引入主题文件，
   先读主题文件开头的注释（可以互变的颜色、新增的类）。
5. **录制**：
   ```bash
   node <skill>/scripts/capture.mjs <deck>.html -o <deck>.mp4
   ```
   输出末尾「页面报告的问题」必须为空。有报错先修。
6. **看视频**：先按正常速度完整看一遍（抽帧拼图代替不了这一步，太快的转场在拼图里看着是连续的）。
   再按 capture 打印的「转场帧」区间抽帧，逐条对照 `transitions.md` 末尾的「自检标准」。
   有问题回第 4 步改。

   自己没法播放视频时，用帧差量运动：每次转场里，画面变化明显的帧应该连续占满转场区间的大部分，
   而不是集中在一两帧。

## 放映

浏览器直接打开 HTML，方向键翻页。只有往后翻会播转场，往回翻是直接切。

## 本 skill 带了什么

| 路径 | 内容 |
| --- | --- |
| `runtime/tokens.css` | 设计变量和样式类（默认主题）。不要改，也不要在稿子里覆盖 |
| `runtime/themes/` | 其他主题，只覆盖设计变量。可以按 `references/themes.md` 新建 |
| `runtime/engine.js` | reveal 初始化 + 各种转场的实现 + 录制接口 |
| `scripts/capture.mjs` | 逐帧录视频（系统 Chrome，不下载浏览器），打印每次转场的帧区间 |
| `templates/starter.html` | 汇报稿起始文件 |
| `templates/story-starter.html` | 故事稿起始文件 |
| `examples/story-circle/` | 故事模式示例（电话 → 相机 → 电视） |
| `examples/editorial-forest/` | 主题 + 「整页 ↔ 卡片」示例（封面 → 目录 → 数据页） |
| `examples/soft-editorial/` | 主题 + 形态变换换布局 + 多合一示例（洞察卡 → 数据面板 → 图表卡） |

## 不许做的

- 不许写自己的 `<style>`，不许在 style 里写颜色和字号。
- 不许自己写 GSAP 或 CSS 动画。转场只用规范里的属性。
- 不许改 `runtime/` 和 `scripts/` 下的文件，唯一的例外是按 `themes.md` 在 `runtime/themes/` 下**新建**主题。觉得有 bug 就报告。
