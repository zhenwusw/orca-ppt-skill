// 把一份演示稿逐帧录成视频：每帧 seek 到确定时刻再截图，不依赖真实时间。
// 用法：node scripts/capture.mjs <deck.html> [-o out.mp4] [--fps 30]
// 每页的停留时长读 <section data-hold="秒">，默认 1.5。
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith("-") && !["-o", "--fps"].includes(args[i - 1]));
const deck = positional[0];
if (!deck) {
  console.error("用法：node scripts/capture.mjs <deck.html> [-o out.mp4] [--fps 30]");
  process.exit(1);
}
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const FPS = +opt("--fps", 30);
const out = path.resolve(opt("-o", deck.replace(/\.html?$/, "") + ".mp4"));

const framesDir = mkdtempSync(path.join(tmpdir(), "orca-transition-capture-"));
let n = 0;
const framePath = () => path.join(framesDir, String(n++).padStart(5, "0") + ".png");

// 用系统里装好的 Chrome，不下载浏览器
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const problems = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));

await page.goto(pathToFileURL(path.resolve(deck)).href + "?capture#/0");
await page.waitForFunction(() => window.Reveal?.isReady?.() && window.__capture);
await page.evaluate(() => document.fonts.ready);

const total = await page.evaluate(() => window.__capture.count());
for (let i = 0; i < total; i++) {
  const { transition, hold } = await page.evaluate((idx) => window.__capture.go(idx), i);
  const frames = Math.round((transition / 1000) * FPS);
  const firstFrame = n;
  for (let f = 0; f < frames; f++) {
    await page.evaluate((ms) => window.__capture.seek(ms), (f / FPS) * 1000);
    await page.screenshot({ path: framePath() });
  }
  await page.evaluate((ms) => window.__capture.seek(ms), transition);
  const still = framePath();
  await page.screenshot({ path: still });
  for (let h = 1; h < Math.round((hold / 1000) * FPS); h++) copyFileSync(still, framePath());
  const range = frames ? `，转场帧 ${firstFrame}–${firstFrame + frames - 1}` : "";
  console.log(`第 ${i + 1} 页：转场 ${(transition / 1000).toFixed(2)}s，停留 ${(hold / 1000).toFixed(1)}s${range}`);
}
await browser.close();

mkdirSync(path.dirname(out), { recursive: true });
execFileSync("ffmpeg", [
  "-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(framesDir, "%05d.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", out,
]);
rmSync(framesDir, { recursive: true, force: true });
if (problems.length) console.log("\n页面报告的问题：\n" + problems.join("\n"));
console.log(`\n${n} 帧 → ${out}`);
