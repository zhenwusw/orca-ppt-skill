// 扫 examples/ 生成一个本地 gallery 页面。
// 数据全部从稿子本身读出来，不另建元数据文件：
//   主题   ← HTML 里引的 runtime/themes/*.css
//   版式   ← 转场计划注释里的「版式 xxx」
//   手法   ← 转场计划注释里每行的「手法：…」
//   页数   ← <section> 的个数
//   时长   ← ffprobe 读 index.mp4
//   缩略图 ← ffmpeg 从 index.mp4 抽一帧
// 用法：node scripts/gallery.mjs   （或 npm run dev）
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = join(ROOT, "examples");
// 页面生成在仓库根目录，这样 npx serve . 之后 localhost:3000 直接就是它；
// 缩略图放 gallery/thumbs/，两者都是生成物，不进版本库。
const PAGE = join(ROOT, "index.html");
const OUT = join(ROOT, "gallery");
const THUMBS = join(OUT, "thumbs");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const hasFfmpeg = run("ffmpeg", ["-version"]) !== null;
const hasFfprobe = run("ffprobe", ["-version"]) !== null;

// 色板：挑三个能代表这套主题、而且在深色卡片上看得见的颜色。
// 直接取 bg/surface/accent 的话，暗色主题的前两个会和卡片同色，只剩一圈描边。
const CARD_BG = "#16161c";
const MIN_FROM_CARD = 45;   // 和卡片底色的最小距离，低于这个就看不见
const MIN_BETWEEN = 30;     // 两个色板之间的最小距离，太近就是重复

const rgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const dist = (a, b) => {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

function themePath(themeFile) {
  return themeFile === "tokens.css"
    ? join(ROOT, "runtime", "tokens.css")
    : join(ROOT, "runtime", "themes", themeFile);
}

// 主题的显示名写在每个主题文件开头的注释里：「主题：Editorial Forest（…」
function readThemeName(themeFile) {
  if (themeFile === "tokens.css") return "默认";
  const p = themePath(themeFile);
  if (!existsSync(p)) return themeFile.replace(/\.css$/, "");
  const m = readFileSync(p, "utf8").match(/主题：([^（(\n*]+)/);
  return m ? m[1].trim() : themeFile.replace(/\.css$/, "");
}

function readPalette(themeFile) {
  const p = themePath(themeFile);
  if (!existsSync(p)) return [];
  const css = readFileSync(p, "utf8");
  const pick = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    const v = m ? m[1].trim() : null;
    return v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null;
  };
  // 顺序 = 代表性从强到弱。accent 排在 surface-2 前面，它比二级面更能说明这套主题
  const candidates = ["bg", "surface", "accent", "surface-2", "accent-soft", "text"]
    .map(pick).filter(Boolean);

  const picked = [];
  const rejected = [];
  for (const c of candidates) {
    if (picked.length === 3) break;
    if (picked.some((q) => dist(c, q) < MIN_BETWEEN)) continue;
    if (dist(c, CARD_BG) < MIN_FROM_CARD) { rejected.push(c); continue; }
    picked.push(c);
  }
  // 够不到三个（整套主题都是暗色）就从被刷掉的里面补，先补离卡片底色最远的
  rejected.sort((a, b) => dist(b, CARD_BG) - dist(a, CARD_BG));
  for (const c of rejected) {
    if (picked.length === 3) break;
    if (picked.some((q) => dist(c, q) < MIN_BETWEEN)) continue;
    picked.push(c);
  }
  return picked;
}

function parseDeck(name) {
  const dir = join(EXAMPLES, name);
  const htmlPath = join(dir, "index.html");
  if (!existsSync(htmlPath)) return null;
  const html = readFileSync(htmlPath, "utf8");

  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, name])[1].trim();
  const themeFile = (html.match(/runtime\/themes\/([a-z0-9-]+\.css)/) || [, "tokens.css"])[1];
  const pages = (html.match(/<section[\s>]/g) || []).length;

  const planBlock = (html.match(/<!--[^]*?转场计划[^]*?-->/) || [""])[0];
  const layout = (planBlock.match(/版式\s*([a-z0-9-]+)/) || [])[1] || null;
  const moves = [];
  for (const m of planBlock.matchAll(/手法：([^\n]+)/g)) {
    // 「整页推近            from：…」→ 取到两个以上空格之前
    const move = m[1].split(/\s{2,}/)[0].trim().replace(/（.*$/, "");
    for (const part of move.split(/\s*\+\s*/)) {
      const v = part.trim();
      if (v && !moves.includes(v)) moves.push(v);
    }
  }

  const mp4 = join(dir, "index.mp4");
  let seconds = null, frames = null, thumb = null;
  if (existsSync(mp4)) {
    if (hasFfprobe) {
      const d = run("ffprobe", ["-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", mp4]);
      if (d) seconds = Math.round(parseFloat(d) * 10) / 10;
      const n = run("ffprobe", ["-v", "error", "-select_streams", "v:0",
        "-count_packets", "-show_entries", "stream=nb_read_packets",
        "-of", "default=nw=1:nk=1", mp4]);
      if (n) frames = parseInt(n, 10);
    }
    if (hasFfmpeg) {
      const out = join(THUMBS, `${name}.jpg`);
      const ok = run("ffmpeg", ["-v", "error", "-ss", "1", "-i", mp4,
        "-frames:v", "1", "-vf", "scale=848:-1", "-q:v", "4", "-y", out]);
      if (ok !== null && existsSync(out)) thumb = `gallery/thumbs/${name}.jpg`;
    }
  }

  return {
    name, title, themeFile, layout, pages, moves, seconds, frames, thumb,
    palette: readPalette(themeFile),
    themeName: readThemeName(themeFile),
    mtime: statSync(htmlPath).mtimeMs,
    hasVideo: existsSync(mp4),
  };
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(THUMBS, { recursive: true });

// 留在磁盘上但不给入口的示例
const SKIP = new Set(["q3-report", "q3-report-v2"]);

const decks = readdirSync(EXAMPLES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith(".") && !SKIP.has(d.name))
  .map((d) => parseDeck(d.name))
  .filter(Boolean)
  .sort((a, b) => b.mtime - a.mtime);

const byTheme = new Map();
for (const d of decks) {
  if (!byTheme.has(d.themeFile)) byTheme.set(d.themeFile, { key: d.themeFile, label: d.themeName, count: 0 });
  byTheme.get(d.themeFile).count += 1;
}
const tabs = [{ key: "all", label: "全部", count: decks.length },
  ...[...byTheme.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))];

function card(d) {
  const meta = d.seconds
    ? `${d.pages} 页 · ${d.seconds}s`
    : `${d.pages} 页 · 未录制`;
  const swatches = d.palette.map((c) =>
    `<span class="sw" style="background:${esc(c)}"></span>`).join("");
  const chips = d.moves.slice(0, 5).map((m) => `<span class="chip">${esc(m)}</span>`).join("");
  const layout = d.layout ? `<span class="layout">${esc(d.layout)}</span>` : "";
  const thumb = d.thumb
    ? `<img class="shot" src="${esc(d.thumb)}" alt="${esc(d.name)} 首帧" loading="lazy">`
    : `<div class="shot empty"><span>没有 index.mp4</span></div>`;
  return `<article class="card" data-theme="${esc(d.themeFile)}">
  <a class="thumb" href="examples/${esc(d.name)}/">${thumb}
    <span class="hover"><span class="btn solid">放映</span></span>
  </a>
  <div class="body">
    <div class="row">
      <a class="name" href="examples/${esc(d.name)}/">${esc(d.name)}</a>
      <span class="meta">${esc(meta)}</span>
    </div>
    <div class="row sub"><span class="sws">${swatches}</span><span class="theme">${esc(d.themeFile)}</span>${layout}</div>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    <div class="links"><a href="examples/${esc(d.name)}/">放映</a></div>
  </div>
</article>`;
}

const page = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PPT 转场动画 · orca-transition-skill</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=JetBrains+Mono:wght@400;500&family=Work+Sans:wght@400;500;600&display=swap">
<style>
:root{--bg:#0b0b0f;--card:#16161c;--line:#23232c;--text:#f5f5f7;--dim:#8e8e98;--faint:#6e6e78;--accent:#ff7a1a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Work Sans","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1440px;margin:0 auto;padding:60px}
header{display:block}
.eyebrow{margin:0;font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
h1{margin:12px 0 0;font-family:"Bricolage Grotesque","PingFang SC",sans-serif;font-size:48px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
hr{border:0;height:1px;background:#1f1f27;margin:28px 0}
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px}
.tab{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:11px 16px;background:var(--card);color:var(--dim);border:1px solid var(--line);border-radius:999px;font-family:"Work Sans","PingFang SC",sans-serif;font-size:13.5px;font-weight:500;cursor:pointer}
.tab:hover{color:var(--text);border-color:#33333f}
.tab .n{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--faint)}
.tab[aria-selected="true"]{background:var(--accent);color:#0b0b0f;border-color:var(--accent);font-weight:600}
.tab[aria-selected="true"] .n{color:rgba(11,11,15,.6)}
.warn{margin:0 0 28px;font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:24px}
.card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
/* .card 上的 display:flex 会盖掉 hidden 属性自带的 display:none（作者样式优先于浏览器默认样式） */
.card[hidden]{display:none!important}
.card:hover{border-color:var(--accent)}
.thumb{position:relative;display:block;aspect-ratio:16/9;background:#141419;text-decoration:none}
.shot{display:block;width:100%;height:100%;object-fit:cover}
.shot.empty{display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",monospace;font-size:11px;color:#5e5e68;border-bottom:1px solid var(--line)}
.hover{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;background:rgba(11,11,15,.55);opacity:0;transition:opacity .15s}
.card:hover .hover,.thumb:focus-visible .hover{opacity:1}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 18px;font-size:13.5px;font-weight:600;border-radius:7px}
.btn.solid{background:var(--accent);color:#0b0b0f}
.body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:12px}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.row.sub{align-items:center;justify-content:flex-start;gap:9px;flex-wrap:wrap}
.name{font-size:17px;font-weight:600;letter-spacing:-.01em;color:var(--text);text-decoration:none}
.name:hover{color:var(--accent)}
.meta{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--dim);white-space:nowrap}
.sws{display:flex;gap:4px}
.sw{width:11px;height:11px;border-radius:50%;border:1px solid rgba(255,255,255,.16)}
.theme{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--dim)}
.layout{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:var(--accent);border:1px solid rgba(255,122,26,.45);border-radius:4px;padding:2px 7px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-family:"JetBrains Mono",monospace;font-size:10.5px;color:#b9b9c2;background:#1e1e26;border-radius:999px;padding:4px 9px}
.links{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--faint)}
.links a{color:var(--accent);text-decoration:none}
.links a:hover{text-decoration:underline}
@media (max-width:640px){.wrap{padding:28px 20px}h1{font-size:34px}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <p class="eyebrow">orca-transition-skill</p>
    <h1>PPT 转场动画</h1>
  </div>
</header>
<hr>
<div class="tabs" role="tablist">
${tabs.map((t, i) => `  <button class="tab" role="tab" data-filter="${esc(t.key)}" aria-selected="${i === 0}">${esc(t.label)}<span class="n">${t.count}</span></button>`).join("\n")}
</div>
${hasFfmpeg ? "" : '<p class="warn">未装 ffmpeg，缩略图和时长缺失</p>'}
<div class="grid">
${decks.map(card).join("\n")}
</div>
</div>
<script>
(() => {
  const tabs = [...document.querySelectorAll(".tab")];
  const cards = [...document.querySelectorAll(".card")];
  tabs.forEach((t) => t.addEventListener("click", () => {
    const k = t.dataset.filter;
    tabs.forEach((o) => o.setAttribute("aria-selected", String(o === t)));
    cards.forEach((c) => { c.hidden = k !== "all" && c.dataset.theme !== k; });
  }));
})();
</script>
</body>
</html>
`;

writeFileSync(PAGE, page);
console.log(`index.html  ${decks.length} 份示例，${decks.filter((d) => d.thumb).length} 张缩略图`);
if (!hasFfmpeg) console.log("没找到 ffmpeg：缩略图跳过");
if (!hasFfprobe) console.log("没找到 ffprobe：页数照常，时长跳过");
