# orca-transition-skill

一个给 AI Agent（Claude Code 等）用的 skill：生成带电影级转场的 HTML 演示稿。
页与页之间按内容关系选用共享元素、形态变换、一变多、元素交接、匹配放大、匹配剪辑、遮挡剪辑等手法，
元素级还有原地替换（同位置换内容）和文字级匹配（缩写展开、数字变化）；
故事模式用整页照片加推近匹配讲演变史。成品是单个 HTML，浏览器直接放映，也能逐帧录成视频。

Agent 的使用说明见 [`SKILL.md`](SKILL.md)。

## 安装

```bash
npx skills add zhenwusw/orca-transition-skill -g -a claude-code
```

其他 agent 把 `-a` 换成对应的名字。依赖（reveal.js、GSAP、playwright-core）由 agent 首次使用时在 skill 目录里 `npm install`。
要做场景内部的 MG 动画，再装 [orca-motion-skill](https://github.com/zhenwusw/orca-motion-skill)，两个装在同一个 skills 目录下。

录视频还需要：

- 系统已安装的 Google Chrome（脚本不会下载浏览器）
- `ffmpeg`（在 PATH 中）

## 示例

浏览器打开 [`examples/story-circle/index.html`](examples/story-circle/index.html)，方向键翻页。
录制好的视频在 `examples/story-circle/index.mp4`。

录制：

```bash
node scripts/capture.mjs examples/story-circle/index.html -o out.mp4
```

## 本地预览全部示例

```bash
npm run dev
```

扫 `examples/`，生成首页 `index.html`（主题、版式、手法、页数、时长、首帧缩略图全部从稿子和 mp4 里读出来），
然后起静态服务。打开 `localhost:3000` 就是它。

只生成不起服务用 `npm run gallery`。缩略图和时长要 `ffmpeg` / `ffprobe`，没装就跳过这两项，页面照常。
生成物是根目录的 `index.html` 和 `gallery/thumbs/`，都不进版本库。

## 目录

| 路径 | 内容 |
| --- | --- |
| `SKILL.md` | skill 入口，Agent 的工作流程 |
| `references/` | 视觉规范、主题、转场手法、故事模式、剪辑软件转场名对照 |
| `runtime/` | 设计变量（`tokens.css`）、主题（`themes/`）和转场引擎（`engine.js`） |
| `scripts/capture.mjs` | 逐帧录制成视频 |
| `templates/` | 起始文件：汇报稿 `starter.html`，故事稿 `story-starter.html` |
| `examples/story-circle/` | 故事模式示例 |
| `examples/editorial-forest/` | 主题示例：Editorial Forest 配色，整页 ↔ 卡片转场 |
| `examples/soft-editorial/` | 主题示例：Soft Editorial 配色，卡片换布局 + 多合一转场 |
| `examples/emerald-editorial/` | 主题示例：Emerald Editorial 配色，横条一变多 + 整页推近 + 形态变换 + 遮挡剪辑 |
| `examples/editorial-tri-tone/` | 主题示例：Editorial Tri-Tone 配色，放大进元素内部 + 文字级匹配 + 原地替换 + 胶囊元素交接 |

示例照片由 AI 生成。

## 与 orca-motion-skill 的关系

[orca-motion-skill](https://github.com/zhenwusw/orca-motion-skill) 做场景**内部**的 MG 动画（格子依次亮起、卡片弹出、拼字、数字滚动），
本项目做场景**之间**的连贯。页面里放了 `.mo-scene` 时，`engine.js` 会在转场结束后播放场景，录制时逐帧录下来。

## License

[MIT](LICENSE)
