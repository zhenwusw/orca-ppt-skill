# orca-transition-skill

一个给 AI Agent（Claude Code 等）用的 skill：生成带电影级转场的 HTML 演示稿。
页与页之间按内容关系选用共享元素、形态变换、一变多、元素交接、匹配放大、遮挡剪辑等手法；
故事模式用整页照片加推近匹配讲演变史。成品是单个 HTML，浏览器直接放映，也能逐帧录成视频。

Agent 的使用说明见 [`SKILL.md`](SKILL.md)。

## 安装

```bash
git clone https://github.com/zhenwusw/orca-transition-skill.git
cd orca-transition-skill
npm install
```

演示稿直接引用 `node_modules/` 里的 reveal.js 和 GSAP，所以必须先 `npm install`。

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

## 目录

| 路径 | 内容 |
| --- | --- |
| `SKILL.md` | skill 入口，Agent 的工作流程 |
| `references/` | 视觉规范、转场手法、故事模式、剪辑软件转场名对照 |
| `runtime/` | 设计变量（`tokens.css`）和转场引擎（`engine.js`） |
| `scripts/capture.mjs` | 逐帧录制成视频 |
| `templates/starter.html` | 新演示稿的起始文件 |
| `examples/story-circle/` | 故事模式示例 |

示例照片由 AI 生成。

## License

[MIT](LICENSE)
