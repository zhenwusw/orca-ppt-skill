// 核每套配色的对比度。
//
//   node scripts/check-palettes.mjs
//
// 为什么要机器核:配色是「看着差不多就行」最容易骗过人的地方 —— 莫兰迪那种低饱和配色,
// 陶土强调色摆在豆沙面板上,单看每个颜色都好看,摞在一起数字就糊了。四套配色 × 六对
// 组合,靠眼睛逐个比是不现实的,而且改一个色值就得全部重看。
//
// 阈值按 WCAG 4.5:1。不是为了合规,是因为这个数字恰好对应「离屏幕两米还读得动」。

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "palettes");

/**
 * 只核**规范真正保证的那几对**。
 *
 * 第一版我凭感觉列了六对,结果把五个已发布的主题全判挂了 —— 那说明检查对是错的,
 * 不是配色全坏了。对照 visual-spec / themes.md 删掉三对:
 *
 * - 「强调色 / 页面底」不查:`.t-accent` 的大字是**有意的低对比装饰**
 *   (Editorial Forest 封面那个粉色 "finer." 就是),不是可读性缺陷。
 * - 「关键数字 / 面板」不查:规范自己写着「`.t-metric` 的强调色压不住浅色面板时,
 *   加 `.t-on-surface` 改成文字色」—— 已经有对策,这儿再判失败是重复且误导。
 * - 「文字 / 二级面板」不查:规范没有为 `--surface-2` 指定文字色,这对组合是我假设的。
 *
 * 剩下这三对是规范写死的:正文必须在页面底上读得动,`--text-on-surface` 这个变量
 * 存在的全部意义就是「在 `--surface` 上清楚可读」(themes.md 原话)。
 */
const PAIRS = [
  { fg: "--text", bg: "--bg", need: 4.5, hard: true, what: "正文 / 页面底" },
  {
    fg: "--text-on-surface",
    bg: "--surface",
    need: 4.5,
    hard: true,
    what: "面板上的文字 / 面板",
  },
  // Bento 的 highlight 格是「强调色铺底 + 一个大数字」。全局只有一个文字色的话，
  // 总有一套配色的文字会在强调色上消失 —— clearing 的白字压在浅黄上只有 1.24:1，
  // 这个 bug 就是这条抓到的。所以配色多带一个 --text-on-accent。
  {
    fg: "--text-on-accent",
    bg: "--accent",
    need: 4.5,
    hard: true,
    what: "强调块上的文字 / 强调色",
  },
  {
    fg: "--text-on-accent",
    bg: "--accent-soft",
    need: 4.5,
    hard: true,
    what: "强调块上的文字 / 次强调色",
  },
  // 次要文字本来就该淡一档,3:1 是底线不是目标;不够只提醒,不判失败。
  { fg: "--text-dim", bg: "--bg", need: 3, hard: false, what: "次要文字 / 页面底" },
];

function parse(css) {
  const vars = {};
  for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

/** `#rgb` / `#rrggbb` / `rgba(r,g,b,a)` 都认。带透明度的按叠在 `over` 上算。 */
function rgb(value, over) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const fn = value.match(/rgba?\(([^)]+)\)/);
  if (!fn) return null;
  const parts = fn[1].split(",").map((p) => parseFloat(p));
  const [r, g, b, a = 1] = parts;
  if (a === 1 || !over) return [r, g, b];
  return [r, g, b].map((c, i) => Math.round(c * a + over[i] * (1 - a)));
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

let bad = 0;
for (const file of readdirSync(DIR).filter((n) => n.endsWith(".css")).sort()) {
  const vars = parse(readFileSync(join(DIR, file), "utf8"));
  const name = file.replace(/\.css$/, "");
  const fails = [];
  const notes = [];
  for (const pair of PAIRS) {
    const bgColor = rgb(vars[pair.bg]);
    const fgColor = rgb(vars[pair.fg], bgColor);
    if (!bgColor || !fgColor) continue;
    const ratio = contrast(fgColor, bgColor);
    if (ratio >= pair.need) continue;
    const line = `${pair.what} ${ratio.toFixed(2)}:1（要 ${pair.need}:1）`;
    (pair.hard ? fails : notes).push(line);
  }
  bad += fails.length;
  console.log(`${name.padEnd(14)} ${fails.length === 0 ? "✓" : "✗"}`);
  for (const fail of fails) console.log(`   ✗ ${fail}`);
  for (const note of notes) console.log(`   · ${note}（偏淡，看一眼）`);
}
process.exit(bad === 0 ? 0 : 1);
