// 给每个主题渲一张样张。
//
//   node scripts/theme-samples.mjs
//
// 产物:runtime/themes/samples/<主题>.jpg,进仓库。
//
// **五张样张的内容完全一样**(都来自 samples/sample.html),只有主题不同 ——
// 选主题时人要比的是设计。内容各不相同的话,人只能一份份浏览,没法把几个摆在一起比。
// Keynote 的主题选择器全部用同一句 Lorem Ipsum,就是这个道理。
//
// 为什么不复用 capture.mjs:那个是录转场的,要 engine.js 跑起来、要逐帧 seek。
// 样张只要静止的第一屏,越少动的东西越确定 —— 只跑 reveal(不跑它页面是空的,
// 它的 CSS 默认隐藏所有 section),不加载 gsap 和 engine.js。

import { chromium } from "playwright-core";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEMES = join(ROOT, "runtime", "themes");
const SAMPLES = join(THEMES, "samples");
const TEMPLATE = join(SAMPLES, "sample.html");

const themes = readdirSync(THEMES)
  .filter((name) => name.endsWith(".css"))
  .map((name) => name.replace(/\.css$/, ""))
  .sort();

if (themes.length === 0) {
  console.error("runtime/themes 下一个主题都没有");
  process.exit(1);
}

mkdirSync(SAMPLES, { recursive: true });
const template = readFileSync(TEMPLATE, "utf8");

// 用系统里装好的 Chrome，不下载浏览器
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

const problems = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(e.message));

for (const theme of themes) {
  // 临时页和模板放同一个目录 —— 样张里的相对路径(tokens.css、reveal 的 reset)
  // 是按那个位置写的,换个地方全失效。
  const scratch = join(SAMPLES, `.${theme}.tmp.html`);
  writeFileSync(scratch, template.replace("{{THEME}}", `../${theme}.css`));
  try {
    await page.goto(pathToFileURL(scratch).href);
    await page.waitForFunction(() => window.Reveal?.isReady?.());
    // 字体没到就截,截到的是退路字体 —— 而字体正是主题之间差别最大的一项。
    await page.evaluate(() => document.fonts.ready);
    // 排版算完再截。reveal 就绪和布局落定之间还差一拍缩放计算。
    await page.waitForFunction(() => document.querySelector('.slides > section.present') !== null);
    await page.screenshot({
      path: join(SAMPLES, `${theme}.jpg`),
      type: "jpeg",
      quality: 88,
    });
    console.log(`${theme.padEnd(22)} ✓`);
  } finally {
    rmSync(scratch, { force: true });
  }
}

await browser.close();
if (problems.length > 0) {
  console.log(`\n渲染时的告警(${problems.length} 条):`);
  for (const problem of [...new Set(problems)].slice(0, 10)) console.log("  " + problem);
}
console.log(`\n${themes.length} 张样张 → ${SAMPLES}`);
