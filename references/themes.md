# 主题规范

主题只换「长什么样」：颜色、圆角、字体。网格、字号档位、页面类型、转场手法全部不变，
所以换了主题的稿子，转场照样对得上。

默认主题就是 `runtime/tokens.css` 本身（暗底橙色）。其他主题放在 `runtime/themes/`：

| 主题 | 样子 | 来源 |
| --- | --- | --- |
| `editorial-forest.css` | 燕麦米色纸面，森林绿大面板，灰粉强调；Source Serif 4 + JetBrains Mono | frontend-slides bold-template-pack |
| `soft-editorial.css` | 奶油纸面，粉 / 黄绿 / 桃三色大圆角卡片；Cormorant Garamond + Work Sans | frontend-slides bold-template-pack |

## 使用主题

在 `tokens.css` **之后**加一行：

```html
<link rel="stylesheet" href="{{ROOT}}/runtime/tokens.css">
<link rel="stylesheet" href="{{ROOT}}/runtime/themes/editorial-forest.css">
```

写页面前**先读主题文件开头的注释**，里面写着三件事：
1. 每个颜色变量在这个主题里是什么颜色；
2. 哪些颜色可以互变（形态变换、一变多只能在这些颜色之间变）；
3. 这个主题新增了哪些类。

用了主题新增的类，这份稿子就只能配这个主题。

## 新建主题

用户要一种现有主题里没有的风格时，在 `runtime/themes/` 下新建一个文件。只许做下面这些事。

### 1. 覆盖颜色变量（必须全部覆盖）

| 变量 | 用途 | 要求 |
| --- | --- | --- |
| `--bg` | 页面底色 | |
| `--surface` | 大面板、整页形状 | 和 `--bg` 明显区分 |
| `--surface-2` | 小卡片、普通柱 | 和 `--surface`、`--bg` 都能区分 |
| `--text` | `--bg` 上的文字 | 在 `--bg` 上清楚可读 |
| `--text-dim` | 说明文字 | 在 `--bg` 上仍可读 |
| `--text-on-surface` | `.s-surface` 上的文字 | 在 `--surface` 上清楚可读 |
| `--accent` | 强调色 | 在 `--bg` 和 `--surface` 上都显眼 |
| `--accent-soft` | 强调色的弱化版 | 和 `--accent` 同色系 |

**`--accent` 和 `--accent-soft` 必须同色系**，因为规范默认它们可以互变。
`--surface` 和 `--surface-2` 不要求同色系，但不是同色系时要在文件注释里写明「不能互变」。
**所有颜色都是高明度浅色（马卡龙色、粉彩）时**，任意两个之间变色都不会发灰发棕，
可以在注释里写「任意两个之间都可以互变」，形态变换、一变多、多合一就不受同色系限制。
有一个是深色或高饱和的颜色，就不能这么写。

### 2. 覆盖圆角和字体

- `--radius-s` `--radius-m` `--radius-l`：可以改小改大，`--radius-full` 不动。
- `--font`：必须带退路字体，最后要有能显示中文的字体（`"PingFang SC"` 或 `"Songti SC"`）。
- 网络字体用 `@import url("https://fonts.googleapis.com/…")` 写在文件开头。断网时退回退路字体，版面不能因此错乱。

### 3. 调整五个字号类的字体、字重、行高、字距

`.t-display` `.t-metric` `.t-h1` `.t-h2` `.t-body` 可以改 `font-weight` `line-height` `letter-spacing`，
也可以改 `font-family`，但只能用主题里定义的字体变量（比如正文用 `--font-sans`，标题用 `--font`）。
**不许改 `font-size`**：规范里的文字宽度估算和页面坐标都建立在固定字号上。

### 4. 新增类（可选，最多 4 个）

只许新增这两种，而且只用变量里的颜色：
- **文字类** `.t-…`：换字体、大小写、字距，比如等宽小标签。字号不超过 `--type-body`。
- **形状类** `.s-…`：描边、特殊形状，比如描边圆章。

新增类里不许写位置、尺寸、动画、`transition`。每个新增类在文件开头注释里写一行：名字、样子、用在哪。

### 不许做的

- 不许改变量以外的布局规则（`.reveal .slides > section`、`.st-*` 这些类）。
- 不许在主题里给某一页、某个元素单独写样式。
- 不许改已有的主题文件来迁就某一份稿子。需要不同的样子就新建主题。

## 浅色主题的注意事项

- 遮挡剪辑写 `data-st-mask-color="bg"` 时，色块和纸面同色，效果是「内容被抹掉」。
- 想要满屏深色的页面（封面、章节页），不要改 `--bg`，用「整页 ↔ 卡片」组合里的整页形状（`transitions.md`）。
  这样深色页和浅色页之间还能用形态变换连起来。
- 深色形状上的文字一律加 `.t-on-surface`。
- `.t-metric` 自带强调色。放在浅色面板上时，强调色可能压不住底色，加 `.t-on-surface` 改成文字色。
