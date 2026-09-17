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

// seek 后直接截图：截图本身会触发样式计算和绘制。实测在 seek 后多等两帧，录出的每一帧逐位不变
const seek = (ms) => page.evaluate((t) => window.__capture.seek(t), ms);

let browser;
let page;
const problems = [];
try {
  // 用系统里装好的 Chrome，不下载浏览器
  browser = await chromium.launch({ channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));

  await page.goto(pathToFileURL(path.resolve(deck)).href + "?capture#/0");
  // 演示稿等 Reveal 就绪；orca-motion-skill 的单独预览页没有 Reveal，只等 __capture
  await page.waitForFunction(() => window.__capture && (!window.Reveal || window.Reveal.isReady?.()));
  await page.evaluate(() => document.fonts.ready);

  const total = await page.evaluate(() => window.__capture.count());
  for (let i = 0; i < total; i++) {
    const { transition, hold, scene } = await page.evaluate((idx) => window.__capture.go(idx), i);
    const frames = Math.round((transition / 1000) * FPS);
    const firstFrame = n;
    for (let f = 0; f < frames; f++) {
      await seek((f / FPS) * 1000);
      await page.screenshot({ path: framePath() });
    }
    const holdFrames = Math.max(1, Math.round((hold / 1000) * FPS));
    if (scene) {
      // 页面里有场景动画（orca-motion-skill）：停留期间也逐帧 seek
      for (let h = 0; h < holdFrames; h++) {
        await seek(transition + (h / FPS) * 1000);
        await page.screenshot({ path: framePath() });
      }
    } else {
      await seek(transition);
      const still = framePath();
      await page.screenshot({ path: still });
      for (let h = 1; h < holdFrames; h++) copyFileSync(still, framePath());
    }
    const range = frames ? `，转场帧 ${firstFrame}–${firstFrame + frames - 1}` : "";
    const sceneNote = scene ? `，场景动画 ${(scene / 1000).toFixed(2)}s` : "";
    console.log(`第 ${i + 1} 页：转场 ${(transition / 1000).toFixed(2)}s，停留 ${(hold / 1000).toFixed(1)}s${range}${sceneNote}`);
  }
  await browser.close();
  browser = null;

  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(framesDir, "%05d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", out,
  ]);
} finally {
  // 出错也要删掉临时帧目录（几百张 1080p 截图），也要关掉浏览器
  await browser?.close().catch(() => {});
  rmSync(framesDir, { recursive: true, force: true });
}
if (problems.length) console.log("\n页面报告的问题：\n" + problems.join("\n"));
console.log(`\n${n} 帧 → ${out}`);
