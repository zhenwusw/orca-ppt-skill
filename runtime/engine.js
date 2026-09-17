// orca-transition-skill 运行时。
//
// 转场分两类实现：
//   共享元素 / 形态变换 → reveal.js auto-animate（两页都写 data-auto-animate，元素用 data-id 配对），
//                         本文件补上旧元素退场和新元素入场（autoAnimateExtras）
//   目标页写 data-st="…" 的 → 本文件的 builders：
//     汇报稿：carry（元素交接）/ split（一变多）/ merge（多合一）/ match-move（匹配放大）/ mask（遮挡剪辑）
//     故事稿：zoom-match（推近匹配）/ iris（遮挡变形）
//     旧版：speed-match / match-cut，规范已不再使用，只为兼容旧示例保留
//
// data-st 页的做法：reveal 在这里是硬切。切页瞬间把上一页的内容克隆成 ghost 层，
// 放在新页里，第一帧和上一页完全一样，所以硬切看不出来；再用 GSAP 把 ghost 交接给新内容。
//
// 放映模式：翻页正常播放。
// 录制模式（URL 带 ?capture）：动画全部暂停，由 scripts/capture.mjs 调 __capture.seek(ms) 逐帧推进。
(() => {
  const CAPTURE = new URLSearchParams(location.search).has("capture");
  const W = 1920;
  const H = 1080;

  const DURATION = { "speed-match": 0.9, "match-cut": 0.6, mask: 1.0 };
  const VECTOR = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

  // GSAP 拿到空数组会在控制台警告「target not found」，混进自检报告里。空的就跳过
  const timeline = () => {
    const tl = gsap.timeline({ paused: true });
    const proxy = new Proxy(tl, {
      get(target, prop) {
        const v = target[prop];
        if (typeof v !== "function") return v;
        if (!["to", "from", "fromTo", "set"].includes(prop)) return v.bind(target);
        return (targets, ...rest) => {
          if (!(Array.isArray(targets) && targets.length === 0)) v.call(target, targets, ...rest);
          return proxy;
        };
      },
    });
    return proxy;
  };

  // ───────── 运动模糊 ─────────
  // 模拟 30fps、180° 快门：曝光 1/60 秒，元素在这段时间里移动多少像素，就糊多长。
  // 模糊量都从时间线当前时刻算出来，所以逐帧录制时是确定的。
  const SHUTTER = 1 / 60;
  let blurSvg = null;
  let blurSeq = 0;
  const blurred = new Set();

  // 单方向模糊（SVG 高斯模糊只在一个轴上有值）。返回一个设置函数，参数是速度（px/s）
  function directionalBlur(els, axis, max = 10) {
    if (!els.length) return () => {};
    if (!blurSvg) {
      blurSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      blurSvg.setAttribute("width", "0");
      blurSvg.setAttribute("height", "0");
      blurSvg.style.position = "absolute";
      document.body.append(blurSvg);
    }
    const id = `st-mb-${blurSeq++}`;
    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    filter.id = id;
    // 滤镜区域放宽，否则糊出去的部分会被元素边框裁掉
    for (const [k, v] of [["x", "-50%"], ["y", "-50%"], ["width", "200%"], ["height", "200%"]]) filter.setAttribute(k, v);
    const gauss = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
    gauss.setAttribute("in", "SourceGraphic");
    gauss.setAttribute("stdDeviation", "0 0");
    filter.append(gauss);
    blurSvg.append(filter);
    for (const el of els) {
      el.style.filter = `url(#${id})`;
      blurred.add(el);
    }
    return (speed) => {
      const sd = Math.min(max, (speed * SHUTTER) / 2);
      gauss.setAttribute("stdDeviation", axis === "x" ? `${sd} 0` : `0 ${sd}`);
    };
  }

  // 各向同性模糊（缩放用）。元素本身有 scale 时，CSS 滤镜会跟着被放大，所以要除回去
  function isoBlur(els, px, scale = 1) {
    for (const el of els) {
      el.style.filter = px > 0.05 ? `blur(${px / scale}px)` : "";
      blurred.add(el);
    }
  }

  function clearBlur() {
    for (const el of blurred) el.style.filter = "";
    blurred.clear();
    blurSvg?.replaceChildren();
  }

  const layer = (cls) => {
    const d = document.createElement("div");
    d.className = `st-layer ${cls}`;
    return d;
  };

  // data-st 页：把原内容包进 .st-enter，方便整体移动
  function prepare() {
    // data-st 页自动补上 data-auto-animate + restart：reveal 不会从上一页自动动画进来（由 GSAP 接管），
    // 但下一页仍然可以从这一页做共享元素。
    for (const section of document.querySelectorAll(".reveal .slides > section[data-st]")) {
      section.setAttribute("data-auto-animate", "");
      section.setAttribute("data-auto-animate-restart", "");
    }
    for (const section of document.querySelectorAll(".reveal .slides > section[data-auto-animate]")) {
      section.setAttribute("data-auto-animate-unmatched", "false");
    }
    for (const section of document.querySelectorAll(".reveal .slides > section[data-st]")) {
      const enter = layer("st-enter");
      enter.append(...section.childNodes);
      section.append(enter);
    }
  }

  function snapshot(prev, keep = () => true) {
    const ghost = layer("st-ghost");
    const source = prev.querySelector(":scope > .st-enter") ?? prev;
    for (const child of source.children) {
      if (child.matches(".st-ghost, .st-mask, .st-enter, .st-guide") || !keep(child)) continue;
      const clone = child.cloneNode(true);
      // 去掉 reveal 配对用的标记，避免克隆体被 auto-animate 当成共享元素
      for (const el of [clone, ...clone.querySelectorAll("*")]) {
        el.removeAttribute("data-id");
        el.removeAttribute("data-auto-animate-target");
        el.removeAttribute("id");
      }
      ghost.append(clone);
    }
    return ghost;
  }

  const center = (el) => [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
  // 不比 outerHTML：GSAP 会往 style 里写 opacity / transform，浏览器还会重排 style 文本
  const signature = (el) => [
    el.tagName, el.className, el.textContent.trim(),
    el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight,
  ].join("|");
  const rectOf = (el) => ({ l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight });

  const builders = {
    "speed-match"(section, ghost, enter) {
      const d = +section.dataset.stDuration || DURATION["speed-match"];
      const [vx, vy] = VECTOR[section.dataset.stDirection || "left"];
      const ease = "power3.inOut";
      return timeline()
        .fromTo(ghost, { x: 0, y: 0 }, { x: vx * W, y: vy * H, duration: d, ease }, 0)
        .fromTo(enter, { x: -vx * W, y: -vy * H }, { x: 0, y: 0, duration: d, ease }, 0);
    },

    "match-cut"(section, ghost, enter) {
      const d = +section.dataset.stDuration || DURATION["match-cut"];
      const key = section.dataset.stMatch;
      const a = ghost.querySelector(`[data-match="${key}"]`);
      const b = enter.querySelector(`[data-match="${key}"]`);
      if (!a || !b) {
        console.error(`[orca-transition-skill] match-cut 找不到 data-match="${key}"（前后两页都要有）`);
        return timeline();
      }
      const [ax, ay] = center(a);
      const [bx, by] = center(b);
      if (Math.hypot(ax - bx, ay - by) > 40) {
        console.warn(`[orca-transition-skill] match-cut "${key}" 前后中心相差 ${Math.round(Math.hypot(ax - bx, ay - by))}px，匹配会不准`);
      }
      // 以匹配元素为中心推近，切点处换内容，再从同样的推近程度回落。
      // 两段位移相同、曲线同阶、时长相同，切点速度相等。
      const half = d / 2;
      const push = 1.12;
      // 初始状态要在时间线外面设：时间线停在 0 秒时，0 秒处的 set 不会生效
      gsap.set(enter, { autoAlpha: 0, scale: push, transformOrigin: `${bx}px ${by}px` });
      return timeline()
        .fromTo(ghost, { scale: 1, transformOrigin: `${ax}px ${ay}px` }, { scale: push, duration: half, ease: "power2.in" }, 0)
        .set(ghost, { autoAlpha: 0 }, half)
        .set(enter, { autoAlpha: 1 }, half)
        .to(enter, { scale: 1, duration: half, ease: "power2.out" }, half);
    },

    mask(section, ghost, enter) {
      const d = +section.dataset.stDuration || DURATION.mask;
      const [vx, vy] = VECTOR[section.dataset.stDirection || "left"];
      const mask = document.createElement("div");
      mask.className = "st-mask";
      // 只接受设计变量名：accent / surface / surface-2 / bg / accent-soft
      if (section.dataset.stMaskColor) mask.style.background = `var(--${section.dataset.stMaskColor})`;
      section.append(mask);
      const half = d / 2;
      // 色块从一侧加速盖满，盖满的那一帧换内容，再沿同方向减速离开
      gsap.set(enter, { autoAlpha: 0 });
      gsap.set(mask, { x: -vx * W, y: -vy * H });
      return timeline()
        .fromTo(mask, { x: -vx * W, y: -vy * H }, { x: 0, y: 0, duration: half, ease: "power3.in" }, 0)
        .set(ghost, { autoAlpha: 0 }, half)
        .set(enter, { autoAlpha: 1 }, half)
        .to(mask, { x: vx * W, y: vy * H, duration: half, ease: "power3.out" }, half);
    },
  };

  // 元素级速度匹配：不推整页。data-carry 相同的元素成对交接——
  // 旧的加速离开并淡出，新的从另一侧同速度减速进入；按 data-carry 首次出现的顺序错开。
  // 没写 data-carry 的元素原地交叉淡化（前后两页一模一样的面板因此看不出变化）。
  builders.carry = (section, ghost, enter) => {
    const d = +section.dataset.stDuration || 1.0;
    const half = d / 2;
    const maxDist = +section.dataset.stDistance || 240;
    const MIN_DIST = 80;
    const [vx, vy] = VECTOR[section.dataset.stDirection || "left"];
    const stagger = 0.06;
    const newEls = [...enter.children];
    const oldEls = [...ghost.children];
    const keys = [...new Set([...newEls, ...oldEls].map((el) => el.dataset.carry).filter(Boolean))];
    const tl = timeline();

    // 不交接的元素：前后一样的原地不动；不一样的，旧的淡出、新的淡入（同时进行，不突然消失）
    const newSigs = new Set(newEls.map(signature));
    const oldSigs = new Set(oldEls.map(signature));
    const newStill = newEls.filter((el) => !el.dataset.carry);
    const oldStill = oldEls.filter((el) => !el.dataset.carry);
    // 新页整层在旧页上面，所以新页的元素一开始全部隐藏；
    // 相同的元素由旧页那份撑到最后一刻再换，否则新面板会把旧面板里还没走的内容盖住
    gsap.set(newEls, { autoAlpha: 0 });
    const sameNew = newStill.filter((el) => oldSigs.has(signature(el)));
    tl.to(newStill.filter((el) => !oldSigs.has(signature(el))), { autoAlpha: 1, duration: half, ease: "power1.inOut" }, half * 0.5);
    tl.to(oldStill.filter((el) => !newSigs.has(signature(el))), { autoAlpha: 0, duration: half, ease: "power1.inOut" }, 0);
    tl.set(sameNew, { autoAlpha: 1 }, d);
    tl.set(oldStill, { autoAlpha: 0 }, d);

    // 滑动距离不能让元素滑出它所在的容器（包住它的不动元素，比如面板；没有就是安全区）。
    // 一组交接元素共用一个距离，前后速度才对得上。
    const containers = [...newStill, ...oldStill].map(rectOf);
    const roomFor = (el) => {
      const e = rectOf(el);
      const box = containers
        .filter((c) => c.l <= e.l && c.t <= e.t && c.r >= e.r && c.b >= e.b && (c.r - c.l) * (c.b - c.t) > (e.r - e.l) * (e.b - e.t))
        .sort((a, b) => (a.r - a.l) * (a.b - a.t) - (b.r - b.l) * (b.b - b.t))[0]
        ?? { l: 40, t: 40, r: W - 40, b: H - 40 };
      // 旧元素朝 v 方向离开，新元素从 -v 方向进来；两个方向的余量都要算
      return vx ? Math.min(e.l - box.l, box.r - e.r) : Math.min(e.t - box.t, box.b - e.b);
    };

    keys.forEach((key, i) => {
      const t = i * stagger;
      const olds = oldEls.filter((el) => el.dataset.carry === key);
      const news = newEls.filter((el) => el.dataset.carry === key);
      const room = Math.min(...[...olds, ...news].map(roomFor));
      const dist = Math.max(MIN_DIST, Math.min(maxDist, room));
      // 透明度比位移先走完：元素还没到终点就已经看不见，不会压到容器边上
      const axis = vx ? "x" : "y";
      const blurOld = directionalBlur(olds, axis);
      const blurNew = directionalBlur(news, axis);
      // power2 曲线的速度：加速段 2p·dist/half，减速段 2(1-p)·dist/half
      if (olds.length) {
        tl.fromTo(olds, { x: 0, y: 0 }, {
          x: vx * dist, y: vy * dist, duration: half, ease: "power2.in",
          onUpdate() { blurOld((2 * this.progress() * dist) / half); },
        }, t);
        tl.fromTo(olds, { autoAlpha: 1 }, { autoAlpha: 0, duration: half * 0.7, ease: "power1.in" }, t + half * 0.3);
      }
      if (news.length) {
        tl.fromTo(news, { x: -vx * dist, y: -vy * dist }, {
          x: 0, y: 0, duration: half, ease: "power2.out",
          onUpdate() { blurNew((2 * (1 - this.progress()) * dist) / half); },
        }, half + t);
        tl.fromTo(news, { autoAlpha: 0 }, { autoAlpha: 1, duration: half * 0.7, ease: "power1.out" }, half + t);
      }
    });
    return tl;
  };

  // 带运动的匹配剪辑：匹配组（data-match 相同的元素）以锚点中心放大，
  // 放到最大的那一帧换成下一页的匹配组，再从同样的大小回落。其余内容先退后进。
  builders["match-move"] = (section, ghost, enter) => {
    const d = +section.dataset.stDuration || 0.9;
    const half = d / 2;
    const peak = +section.dataset.stScale || 1.5;
    const sel = `[data-match="${section.dataset.stMatch}"]`;
    const olds = [...ghost.querySelectorAll(sel)];
    const news = [...enter.querySelectorAll(sel)];
    if (!olds.length || !news.length) {
      console.error(`[orca-transition-skill] match-move 找不到 ${sel}（前后两页都要有）`);
      return timeline();
    }
    const [ax, ay] = center(olds[0]);
    const [bx, by] = center(news[0]);
    if (Math.hypot(ax - bx, ay - by) > 40) {
      console.warn(`[orca-transition-skill] match-move 前后锚点中心相差 ${Math.round(Math.hypot(ax - bx, ay - by))}px`);
    }
    const origin = (cx, cy) => (i, el) => `${cx - el.offsetLeft}px ${cy - el.offsetTop}px`;
    // 前后两页完全相同的元素（比如同位置的面板）原地不动
    const newSigs = new Set([...enter.children].map(signature));
    const oldSigs = new Set([...ghost.children].map(signature));
    const oldRest = [...ghost.children].filter((el) => !olds.includes(el) && !newSigs.has(signature(el)));
    const newRest = [...enter.children].filter((el) => !news.includes(el) && !oldSigs.has(signature(el)));
    const sameNew = [...enter.children].filter((el) => !news.includes(el) && oldSigs.has(signature(el)));

    // 匹配组边缘离缩放中心的距离，决定边缘的线速度
    const reach = Math.max(...olds.map((el) => Math.max(el.offsetWidth, el.offsetHeight) / 2));
    gsap.set(olds, { transformOrigin: origin(ax, ay) });
    gsap.set(news, { autoAlpha: 0, scale: peak, transformOrigin: origin(bx, by) });
    if (newRest.length) gsap.set(newRest, { autoAlpha: 0, y: 24 });
    if (sameNew.length) gsap.set(sameNew, { autoAlpha: 0 });

    return timeline()
      .to(olds, {
        scale: peak, duration: half, ease: "power2.in",
        onUpdate() {
          const q = this.progress();
          const speed = ((peak - 1) * 2 * q / half) * reach;
          isoBlur(olds, Math.min(6, (speed * SHUTTER) / 3), 1 + (peak - 1) * q * q);
        },
      }, 0)
      .to(oldRest, { autoAlpha: 0, duration: half * 0.8, ease: "power1.in" }, 0)
      .set(ghost, { autoAlpha: 0 }, half)
      .set(news, { autoAlpha: 1 }, half)
      .set(sameNew, { autoAlpha: 1 }, half)
      .to(news, {
        scale: 1, duration: half, ease: "power2.out",
        onUpdate() {
          const q = this.progress();
          const speed = ((peak - 1) * 2 * (1 - q) / half) * reach;
          isoBlur(news, Math.min(6, (speed * SHUTTER) / 3), peak - (peak - 1) * (1 - (1 - q) * (1 - q)));
        },
      }, half)
      .to(newRest, { autoAlpha: 1, y: 0, duration: half, ease: "power2.out", stagger: 0.04 }, half + 0.1);
  };

  // 新元素的入场方式（data-enter）。默认上浮淡入；图表用 grow-up / grow-right 从基线长出来
  const ENTER = {
    rise: { from: { autoAlpha: 0, y: 24 }, to: { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" } },
    "grow-up": { from: { scaleY: 0, transformOrigin: "50% 100%" }, to: { scaleY: 1, duration: 0.6, ease: "power3.out" } },
    "grow-right": { from: { scaleX: 0, transformOrigin: "0% 50%" }, to: { scaleX: 1, duration: 0.6, ease: "power3.out" } },
    pop: { from: { autoAlpha: 0, scale: 0.6 }, to: { autoAlpha: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" } },
  };
  function enterTween(tl, el, at) {
    const kind = el.dataset.enter || "rise";
    let spec = ENTER[kind];
    if (!spec) {
      console.error(`[orca-transition-skill] 不认识的 data-enter="${kind}"，可选：${Object.keys(ENTER).join(" / ")}`);
      spec = ENTER.rise;
    }
    gsap.set(el, spec.from);
    tl.to(el, { ...spec.to }, at);
  }

  // auto-animate 页的补充：reveal 会让上一页没配对的元素瞬间消失，新页没配对的元素只会淡入。
  // 这里把旧元素克隆出来淡出，新元素按 data-auto-animate-delay 上浮淡入。
  function autoAnimateExtras(section, prev) {
    // 「配上了」= 两页都有同一个 data-id。只有一边有的也算没配对
    const ids = (sec) => new Set([...sec.querySelectorAll("[data-id]")].map((el) => el.dataset.id));
    const prevIds = ids(prev);
    const currIds = ids(section);
    // reveal 配对要求标签名也相同，不同就静默失败，这里报出来
    for (const el of section.querySelectorAll("[data-id]")) {
      const twin = prev.querySelector(`[data-id="${el.dataset.id}"]`);
      if (twin && twin.tagName !== el.tagName) {
        console.error(`[orca-transition-skill] data-id="${el.dataset.id}" 前一页是 <${twin.tagName.toLowerCase()}>，这一页是 <${el.tagName.toLowerCase()}>，标签不同配不上`);
      }
    }
    // 前后两页一模一样的元素（页眉、页脚）原地不动：不克隆出来淡出，新页的也不重新入场
    const sameIn = (sec) => new Set([...sec.children].filter((el) => !el.dataset.id).map(signature));
    const prevSame = sameIn(prev);
    const currSame = sameIn(section);
    const ghost = snapshot(prev, (el) => !currIds.has(el.dataset.id) && !(!el.dataset.id && currSame.has(signature(el))));
    // 放在最上面：放在底下会被正在长大的共享形状盖住，第一帧就看不见了
    section.append(ghost);
    const tl = timeline();
    if (ghost.children.length) {
      tl.fromTo(ghost.children, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -16, duration: 0.35, ease: "power1.in" }, 0);
    }
    const incoming = [...section.children].filter((el) =>
      !prevIds.has(el.dataset.id) && !el.classList.contains("st-layer") && !(!el.dataset.id && prevSame.has(signature(el))));
    for (const el of incoming) enterTween(tl, el, +(el.dataset.autoAnimateDelay ?? 0.6));
    return tl;
  }

  // 形状元素的位置、尺寸、底色、圆角（圆角换算成像素，不超过短边一半），一变多 / 多合一用来插值
  const radiusPx = (cs, w, h) => {
    const r = cs.borderTopLeftRadius;
    return r.endsWith("%") ? (parseFloat(r) / 100) * Math.min(w, h) : parseFloat(r) || 0;
  };
  const box = (el) => {
    const cs = getComputedStyle(el);
    return {
      left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight,
      backgroundColor: cs.backgroundColor,
      borderRadius: Math.min(radiusPx(cs, el.offsetWidth, el.offsetHeight), Math.min(el.offsetWidth, el.offsetHeight) / 2),
    };
  };

  // 一变多：上一页一个元素，下一页多个元素写同一个 data-split。
  // 第一帧，多个新元素叠在旧元素的位置、用旧元素的颜色和圆角，看起来还是那一个；
  // 然后依次散开，飞到各自的位置，变成各自的尺寸、颜色、圆角。
  builders.split = (section, ghost, enter) => {
    const key = section.dataset.stSplit;
    const sel = `[data-split="${key}"]`;
    const src = ghost.querySelector(sel);
    const targets = [...enter.querySelectorAll(sel)];
    if (!src || targets.length < 2) {
      console.error(`[orca-transition-skill] split 需要上一页有一个 ${sel}，这一页至少两个（现在是 ${src ? 1 : 0} 和 ${targets.length}）`);
      return timeline();
    }
    const d = +section.dataset.stDuration || 1.2;
    const move = d * 0.75;
    const stagger = Math.min(0.08, (d - move) / targets.length);
    const from = box(src);
    const ends = targets.map(box);

    const newSigs = new Set([...enter.children].map(signature));
    const oldSigs = new Set([...ghost.children].map(signature));
    const oldRest = [...ghost.children].filter((el) => el !== src && !newSigs.has(signature(el)));
    const sameOld = [...ghost.children].filter((el) => el !== src && newSigs.has(signature(el)));
    const newRest = [...enter.children].filter((el) => !targets.includes(el) && !oldSigs.has(signature(el)));
    const sameNew = [...enter.children].filter((el) => !targets.includes(el) && oldSigs.has(signature(el)));

    gsap.set(src, { autoAlpha: 0 });
    if (sameNew.length) gsap.set(sameNew, { autoAlpha: 0 });
    for (const el of targets) gsap.set(el, { ...from, borderRadius: `${from.borderRadius}px` });

    const tl = timeline();
    tl.to(oldRest, { autoAlpha: 0, y: -16, duration: 0.35, ease: "power1.in" }, 0);
    targets.forEach((el, i) => {
      const end = ends[i];
      tl.to(el, { ...end, borderRadius: `${end.borderRadius}px`, duration: move, ease: "power3.inOut" }, i * stagger);
    });
    const restAt = move * 0.7;
    newRest.forEach((el, i) => enterTween(tl, el, +(el.dataset.enterDelay ?? restAt + i * 0.04)));
    tl.set(sameNew, { autoAlpha: 1 }, d);
    tl.set(sameOld, { autoAlpha: 0 }, d);
    return tl;
  };

  // 多合一：一变多反过来。上一页多个元素、这一页一个元素写同一个 data-merge。
  // 上一页的几个形状（ghost 里的克隆）依次飞到新元素的位置，变成它的尺寸、颜色、圆角，叠成一个；
  // 最后一个落位时换成真正的新元素。其他新元素在合拢后期入场。
  builders.merge = (section, ghost, enter) => {
    const key = section.dataset.stMerge;
    const sel = `[data-merge="${key}"]`;
    const srcs = [...ghost.querySelectorAll(sel)];
    const target = enter.querySelector(sel);
    if (srcs.length < 2 || !target || enter.querySelectorAll(sel).length > 1) {
      console.error(`[orca-transition-skill] merge 需要上一页至少两个 ${sel}，这一页恰好一个（现在是 ${srcs.length} 和 ${enter.querySelectorAll(sel).length}）`);
      return timeline();
    }
    const d = +section.dataset.stDuration || 1.2;
    const move = d * 0.75;
    const stagger = Math.min(0.08, (d - move) / srcs.length);
    const to = box(target);
    const landed = (srcs.length - 1) * stagger + move;

    const newSigs = new Set([...enter.children].map(signature));
    const oldSigs = new Set([...ghost.children].map(signature));
    const oldRest = [...ghost.children].filter((el) => !srcs.includes(el) && !newSigs.has(signature(el)));
    const sameOld = [...ghost.children].filter((el) => !srcs.includes(el) && newSigs.has(signature(el)));
    const newRest = [...enter.children].filter((el) => el !== target && !oldSigs.has(signature(el)));
    const sameNew = [...enter.children].filter((el) => el !== target && oldSigs.has(signature(el)));

    gsap.set(target, { autoAlpha: 0 });
    if (sameNew.length) gsap.set(sameNew, { autoAlpha: 0 });

    const tl = timeline();
    tl.to(oldRest, { autoAlpha: 0, y: -16, duration: 0.35, ease: "power1.in" }, 0);
    srcs.forEach((el, i) => {
      tl.to(el, { ...to, borderRadius: `${to.borderRadius}px`, duration: move, ease: "power3.inOut" }, i * stagger);
    });
    tl.set(target, { autoAlpha: 1 }, landed);
    tl.set(srcs, { autoAlpha: 0 }, landed);
    const restAt = landed * 0.8;
    newRest.forEach((el, i) => enterTween(tl, el, +(el.dataset.enterDelay ?? restAt + i * 0.04)));
    tl.set(sameNew, { autoAlpha: 1 }, Math.max(d, landed));
    tl.set(sameOld, { autoAlpha: 0 }, Math.max(d, landed));
    return tl;
  };

  // ───────── 故事模式 ─────────
  // 照片 <img class="st-photo" width height data-anchors="名字:…; 名字:…">，坐标是原图像素：
  //   圆      名字:cx,cy,r
  //   矩形    名字:x,y,w,h
  //   四边形  名字:q:x1,y1,x2,y2,x3,y3,x4,y4   （四个角，顺时针或逆时针都行；斜的屏幕、透视下的卡片用它）
  // 照片默认铺满画布（cover）。「镜头」= 原图上的哪个点对准画布中心 + 缩放倍数。
  // 页面写 data-guide="锚点名" 时，引导框常驻在这个锚点上，转场时跟着锚点走。
  // 引导框是 SVG 画的一圈点（GUIDE_POINTS 个），所有形状都用同一种表示，圆变四边形时逐点插值。
  const MATCH_R = 300;      // 匹配时锚点在画面上的半径
  const GUIDE_PAD = 16;     // 引导框比锚点大一圈
  const GUIDE_POINTS = 96;
  const MIN_ANCHOR = 40;    // 锚点半径（矩形、四边形取外接框长边的一半）小于它，推近后会糊
  const err = (msg) => console.error(`[orca-transition-skill] ${msg}`);
  const warn = (msg) => console.warn(`[orca-transition-skill] ${msg}`);

  function parseAnchors(img) {
    if (img._anchors) return img._anchors;
    const out = {};
    const src = img.getAttribute("src");
    for (const raw of (img.dataset.anchors || "").split(";")) {
      const item = raw.trim();
      if (!item) continue;
      const i = item.indexOf(":");
      if (i < 0) { err(`照片 ${src} 的锚点「${item}」缺少冒号，格式是 名字:数字,数字…`); continue; }
      const name = item.slice(0, i).trim();
      let body = item.slice(i + 1).trim();
      const quad = body.startsWith("q:");
      if (quad) body = body.slice(2);
      const v = body.split(",").map((x) => Number(x.trim()));
      if (v.some((x) => Number.isNaN(x))) { err(`照片 ${src} 的锚点「${name}」里有不是数字的值：${body}`); continue; }
      let a;
      if (quad) {
        if (v.length !== 8) { err(`照片 ${src} 的四边形锚点「${name}」要 8 个数字（四个角），现在是 ${v.length} 个`); continue; }
        a = { kind: "poly", pts: [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]] };
      } else if (v.length === 3) {
        a = { kind: "circle", cx: v[0], cy: v[1], r: v[2], size: v[2] };
      } else if (v.length === 4) {
        a = { kind: "poly", pts: [[v[0], v[1]], [v[0] + v[2], v[1]], [v[0] + v[2], v[1] + v[3]], [v[0], v[1] + v[3]]] };
      } else {
        err(`照片 ${src} 的锚点「${name}」有 ${v.length} 个数字：圆写 3 个，矩形写 4 个，四边形写 q: 加 8 个`);
        continue;
      }
      if (a.kind === "poly") {
        const xs = a.pts.map((p) => p[0]);
        const ys = a.pts.map((p) => p[1]);
        a.cx = xs.reduce((s, x) => s + x, 0) / 4;
        a.cy = ys.reduce((s, y) => s + y, 0) / 4;
        a.size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
      }
      a.name = name;
      out[name] = a;
    }
    img._anchors = out;
    return out;
  }
  const anchorOf = (img, name) => {
    const a = parseAnchors(img)[name];
    if (!a) err(`照片 ${img.getAttribute("src")} 上没有锚点「${name}」`);
    return a;
  };
  const restCam = (img) => {
    const w = +img.getAttribute("width");
    const h = +img.getAttribute("height");
    return { k: Math.max(W / w, H / h), cx: w / 2, cy: h / 2 };
  };
  const MAX_PUSH = 3;     // 相对原位最多推近几倍，再大照片会糊
  const MIN_PUSH = 1.3;   // 少于这个倍数，观众看不出在推近
  const sizeOf = (a) => a.size;
  const imgSize = (img) => [+img.getAttribute("width"), +img.getAttribute("height")];

  // 推近匹配的切点帧：两张照片的锚点要落在画面上同一点、同样大小，而且两张照片都得铺满画布。
  // 先按 MAX_PUSH 定半径，再在两张照片「不露边」的可行区间里，找离画面中心最近的落点。
  function planMatch(imgA, a, imgB, b) {
    const restA = restCam(imgA).k;
    const restB = restCam(imgB).k;
    let R = Math.min(MATCH_R, MAX_PUSH * restA * sizeOf(a), MAX_PUSH * restB * sizeOf(b));
    const feasible = (img, anc, k) => {
      const [w, h] = imgSize(img);
      // 锚点在画面 (px, py)：照片左边缘 px - cx·k ≤ 0，右边缘 px + (w - cx)·k ≥ W，上下同理
      return { x0: W - (w - anc.cx) * k, x1: anc.cx * k, y0: H - (h - anc.cy) * k, y1: anc.cy * k };
    };
    for (let tries = 0; tries < 6; tries++) {
      const fa = feasible(imgA, a, R / sizeOf(a));
      const fb = feasible(imgB, b, R / sizeOf(b));
      const x0 = Math.max(fa.x0, fb.x0), x1 = Math.min(fa.x1, fb.x1);
      const y0 = Math.max(fa.y0, fb.y0), y1 = Math.min(fa.y1, fb.y1);
      if (x0 <= x1 && y0 <= y1) {
        const px = Math.min(Math.max(W / 2, x0), x1);
        const py = Math.min(Math.max(H / 2, y0), y1);
        const pushA = R / sizeOf(a) / restA;
        const pushB = R / sizeOf(b) / restB;
        if (Math.min(pushA, pushB) < MIN_PUSH - 0.005) {
          const weak = pushA < pushB ? a : b;
          const other = weak === a ? b : a;
          const cause = R < MATCH_R - 0.5 && sizeOf(other) < sizeOf(weak)
            ? `另一个锚点「${other.name}」太小，推近上限 ${MAX_PUSH} 倍把切点半径压低了`
            : `锚点「${weak.name}」在照片里太大`;
          warn(`zoom-match 推近不够：「${a.name}」${pushA.toFixed(2)} 倍，「${b.name}」${pushB.toFixed(2)} 倍，低于 ${MIN_PUSH} 看起来像平移。原因：${cause}`);
        }
        return { R, px, py };
      }
      R *= 1.2; // 推得越近，可行区间越宽
    }
    warn(`zoom-match「${a.name}」和「${b.name}」在各自照片里的位置差太多，推近后会露出照片边缘。换锚点或换照片顺序`);
    return { R, px: W / 2, py: H / 2 };
  }
  const focusCam = (a, plan) => {
    const k = plan.R / sizeOf(a);
    return { k, cx: a.cx - (plan.px - W / 2) / k, cy: a.cy - (plan.py - H / 2) / k };
  };
  // 过渡中的镜头也不许露边：把中心点夹在照片能铺满画布的范围里
  const clampCam = (img, cam) => {
    const [w, h] = imgSize(img);
    const hx = W / 2 / cam.k, hy = H / 2 / cam.k;
    return { k: cam.k, cx: Math.min(Math.max(cam.cx, hx), w - hx), cy: Math.min(Math.max(cam.cy, hy), h - hy) };
  };
  // 缩放按对数插值，推近的速度感才均匀
  const mixCam = (a, b, t) => ({
    k: Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * t),
    cx: a.cx + (b.cx - a.cx) * t,
    cy: a.cy + (b.cy - a.cy) * t,
  });
  const applyCam = (img, cam) =>
    gsap.set(img, { x: W / 2 - cam.cx * cam.k, y: H / 2 - cam.cy * cam.k, scale: cam.k, transformOrigin: "0 0" });
  const toScreen = (cam, x, y) => [W / 2 + (x - cam.cx) * cam.k, H / 2 + (y - cam.cy) * cam.k];

  // ── 引导框的点
  // 所有形状都按「从中心每隔同样角度发一条射线，取射线和轮廓的交点」取点，起点在正上方，顺时针。
  // 这样圆和方的第 n 个点在同一个方向上，逐点插值时形状对称地收放，不会被拧歪。
  // 锚点都是凸形状（圆、矩形、四边形），每条射线和轮廓只有一个交点。
  function resample(poly, cx, cy) {
    const out = [];
    for (let n = 0; n < GUIDE_POINTS; n++) {
      const a = -Math.PI / 2 + (n / GUIDE_POINTS) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = null;
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i];
        const [x2, y2] = poly[(i + 1) % poly.length];
        const ex = x2 - x1, ey = y2 - y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((x1 - cx) * ey - (y1 - cy) * ex) / den; // 射线上的距离
        const u = ((x1 - cx) * dy - (y1 - cy) * dx) / den; // 边上的位置 0..1
        if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && (best === null || t > best)) best = t;
      }
      out.push(best === null ? [cx, cy] : [cx + dx * best, cy + dy * best]);
    }
    return out;
  }
  function circlePoints(cx, cy, r) {
    return Array.from({ length: GUIDE_POINTS }, (_, n) => {
      const a = -Math.PI / 2 + (n / GUIDE_POINTS) * Math.PI * 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
  }
  // 锚点在当前镜头下的引导框：圆直接取点；多边形往外扩一圈，再把角修圆
  // 多边形锚点在屏幕上的四个角（已往外扩），统一从左上角起、顺时针排，两个四边形才能逐角混合
  function screenCorners(cam, a) {
    const [cx, cy] = toScreen(cam, a.cx, a.cy);
    let corners = a.pts.map(([x, y]) => {
      const [sx, sy] = toScreen(cam, x, y);
      const d = Math.hypot(sx - cx, sy - cy) || 1;
      return [sx + ((sx - cx) / d) * GUIDE_PAD * 1.4, sy + ((sy - cy) / d) * GUIDE_PAD * 1.4];
    });
    let area = 0;
    corners.forEach(([x1, y1], i) => { const [x2, y2] = corners[(i + 1) % 4]; area += x1 * y2 - x2 * y1; });
    if (area < 0) corners = corners.reverse();
    let start = 0;
    corners.forEach(([x, y], i) => { if (x + y < corners[start][0] + corners[start][1]) start = i; });
    return [...corners.slice(start), ...corners.slice(0, start)];
  }
  function outline(cam, a) {
    const [cx, cy] = toScreen(cam, a.cx, a.cy);
    if (a.kind === "circle") return circlePoints(cx, cy, a.r * cam.k + GUIDE_PAD);
    return cornersOutline(screenCorners(cam, a));
  }
  function cornersOutline(corners) {
    const [cx, cy] = centroid(corners);
    const edges = corners.map((p, i) => Math.hypot(corners[(i + 1) % 4][0] - p[0], corners[(i + 1) % 4][1] - p[1]));
    const radius = Math.min(...edges) * 0.12;
    const dense = [];
    corners.forEach((p, i) => {
      const prev = corners[(i + 3) % 4];
      const next = corners[(i + 1) % 4];
      const toward = (q, len) => {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        return [p[0] + ((q[0] - p[0]) / d) * len, p[1] + ((q[1] - p[1]) / d) * len];
      };
      const a0 = toward(prev, radius);
      const a1 = toward(next, radius);
      for (let s = 0; s <= 6; s++) { // 二次贝塞尔：a0 → 角点 → a1
        const t = s / 6;
        dense.push([
          (1 - t) * (1 - t) * a0[0] + 2 * (1 - t) * t * p[0] + t * t * a1[0],
          (1 - t) * (1 - t) * a0[1] + 2 * (1 - t) * t * p[1] + t * t * a1[1],
        ]);
      }
    });
    return resample(dense, cx, cy);
  }
  const mixPoints = (a, b, t) => a.map(([x, y], i) => [x + (b[i][0] - x) * t, y + (b[i][1] - y) * t]);
  const centroid = (pts) => pts.reduce(([sx, sy], [x, y]) => [sx + x / pts.length, sy + y / pts.length], [0, 0]);
  const accentRGBA = (alpha) => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  function drawGuide(guide, pts, fill = 0) {
    const path = guide.firstElementChild;
    path.setAttribute("d", `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`);
    path.style.fill = accentRGBA(fill);
  }

  function prepareStory() {
    for (const section of document.querySelectorAll(".reveal .slides > section")) {
      const img = section.querySelector(".st-photo");
      if (!img) continue;
      if (!img.getAttribute("width") || !img.getAttribute("height")) err(`照片 ${img.getAttribute("src")} 没写原图的 width / height`);
      applyCam(img, restCam(img));
      const scrim = document.createElement("div");
      scrim.className = "st-scrim";
      img.after(scrim);
      for (const a of Object.values(parseAnchors(img))) {
        if (a.size < MIN_ANCHOR) warn(`照片 ${img.getAttribute("src")} 的锚点「${a.name}」半径 ${Math.round(a.size)}，小于 ${MIN_ANCHOR}，推近后会糊，不要用`);
      }
      if (section.dataset.guide) {
        const guide = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        guide.setAttribute("class", "st-guide");
        guide.setAttribute("viewBox", `0 0 ${W} ${H}`);
        guide.append(document.createElementNS("http://www.w3.org/2000/svg", "path"));
        section.append(guide);
        const a = anchorOf(img, section.dataset.guide);
        if (a) drawGuide(guide, outline(restCam(img), a));
      }
    }
  }

  function storyParts(section, ghost, enter) {
    const oldImg = ghost.querySelector(".st-photo");
    const newImg = enter.querySelector(".st-photo");
    const guide = section.querySelector(":scope > .st-guide");
    if (!oldImg || !newImg) {
      err("故事转场要求前后两页都有 .st-photo");
      return null;
    }
    const { stFrom, stTo, guide: guideName, st } = section.dataset;
    const prevGuide = section.previousElementSibling?.dataset.guide;
    if (!guide) warn(`${st} 目标页没写 data-guide，没有引导框观众很难看出形状呼应`);
    if (guideName && stTo !== guideName) warn(`${st} 的 data-st-to="${stTo}" 和本页 data-guide="${guideName}" 不一致，转场结束时引导框会跳`);
    if (prevGuide && stFrom !== prevGuide) warn(`${st} 的 data-st-from="${stFrom}" 和上一页 data-guide="${prevGuide}" 不一致，转场开始时引导框会跳`);
    const isCaption = (img) => (el) => el !== img && !el.classList.contains("st-scrim");
    return {
      oldImg, newImg, guide,
      from: anchorOf(oldImg, stFrom),
      to: anchorOf(newImg, stTo),
      oldCaps: [...ghost.children].filter(isCaption(oldImg)),
      newCaps: [...enter.children].filter(isCaption(newImg)),
    };
  }

  // 推近式匹配剪辑：推近上一张照片，让锚点到画面上的切点位置、半径 MATCH_R；
  // 就在这一帧切到下一张照片（它的锚点也在同一位置、同样大小），再拉远回原位。
  // 前半段加速推近，后半段减速拉远，切点是整段运动最快的地方。
  builders["zoom-match"] = (section, ghost, enter) => {
    const parts = storyParts(section, ghost, enter);
    if (!parts?.from || !parts?.to) return timeline();
    const { oldImg, newImg, guide, from, to, oldCaps, newCaps } = parts;
    if ((from.kind === "circle") !== (to.kind === "circle")) {
      warn(`zoom-match「${from.name}」和「${to.name}」一个是圆一个是方，形状对不上。形状不同用 iris`);
    }
    const d = +section.dataset.stDuration || 1.8;
    const half = d / 2;
    const inE = gsap.parseEase("power2.in");
    const outE = gsap.parseEase("power2.out");
    const oldRest = restCam(oldImg);
    const newRest = restCam(newImg);
    const plan = planMatch(oldImg, from, newImg, to);
    const p = { t: 0 };
    const camAt = (t) => (t < half
      ? { img: oldImg, anchor: from, cam: clampCam(oldImg, mixCam(oldRest, focusCam(from, plan), inE(t / half))) }
      : { img: newImg, anchor: to, cam: clampCam(newImg, mixCam(focusCam(to, plan), newRest, outE(Math.min(1, (t - half) / half)))) });
    // 一个快门时间里，画面四个角上的点移动了多远（推近时离中心越远动得越快）
    const smear = (t) => {
      let t2 = t + SHUTTER;
      if ((t < half) !== (t2 < half) || t2 > d) t2 = t - SHUTTER;
      const a = camAt(t);
      const b = camAt(t2);
      if (a.img !== b.img) return 0;
      let len = 0;
      for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        const ix = a.cam.cx + (sx - W / 2) / a.cam.k;
        const iy = a.cam.cy + (sy - H / 2) / a.cam.k;
        const [bx, by] = toScreen(b.cam, ix, iy);
        len = Math.max(len, Math.hypot(bx - sx, by - sy));
      }
      return len;
    };
    // 两个锚点形状不完全一样时（正矩形对斜四边形），切点前后各 BLEND 秒把引导框的形状混合过去，
    // 不然切点那一帧框会突然变形。切点处两边的位置和大小本来就对齐，混合只改形状。
    const BLEND = 0.12;
    const oldCamAt = (t) => clampCam(oldImg, mixCam(oldRest, focusCam(from, plan), inE(Math.min(1, t / half))));
    const newCamAt = (t) => clampCam(newImg, mixCam(focusCam(to, plan), newRest, outE(Math.max(0, (t - half) / half))));
    const render = () => {
      const { img, cam } = camAt(p.t);
      applyCam(img, cam);
      isoBlur([img], Math.min(6, smear(p.t) / 4), cam.k);
      if (!guide) return;
      const w = Math.min(1, Math.max(0, (p.t - (half - BLEND)) / (2 * BLEND)));
      const blend = w * w * (3 - 2 * w);
      if (blend <= 0) return drawGuide(guide, outline(oldCamAt(p.t), from));
      if (blend >= 1) return drawGuide(guide, outline(newCamAt(p.t), to));
      if (from.kind === "poly" && to.kind === "poly") {
        // 两个四边形：混合四个角，再生成圆角轮廓，中途每一帧都是干净的四边形
        return drawGuide(guide, cornersOutline(mixPoints(screenCorners(oldCamAt(p.t), from), screenCorners(newCamAt(p.t), to), blend)));
      }
      drawGuide(guide, mixPoints(outline(oldCamAt(p.t), from), outline(newCamAt(p.t), to), blend));
    };
    gsap.set(enter, { autoAlpha: 0 });
    gsap.set(newCaps, { autoAlpha: 0, y: 24 });
    render();
    return timeline()
      .to(p, { t: d, duration: d, ease: "none", onUpdate: render }, 0)
      .to(oldCaps, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, 0)
      .set(ghost, { autoAlpha: 0 }, half)
      .set(enter, { autoAlpha: 1 }, half)
      .to(newCaps, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: 0.06 }, d - 0.4);
  };

  // 遮挡 + 形态变换：引导框从锚点处填色、放大成盖满画面的圆，盖满时换照片，
  // 再缩成下一张照片上的锚点形状（圆可以变成斜的四边形），颜色褪回只剩边框。
  builders.iris = (section, ghost, enter) => {
    const parts = storyParts(section, ghost, enter);
    if (!parts?.from || !parts?.to || !parts.guide) {
      if (parts && !parts.guide) err("iris 需要目标页写 data-guide");
      return timeline();
    }
    const { oldImg, newImg, guide, from, to, oldCaps, newCaps } = parts;
    const d = +section.dataset.stDuration || 1.4;
    const half = d / 2;
    const start = outline(restCam(oldImg), from);
    const [cx, cy] = centroid(start);
    const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 20;
    const cover = circlePoints(cx, cy, R);
    const end = outline(restCam(newImg), to);
    const inE = gsap.parseEase("power2.in");
    const outE = gsap.parseEase("power2.out");
    const p = { t: 0, fill: 0 };
    const render = () => {
      const pts = p.t < half
        ? mixPoints(start, cover, inE(p.t / half))
        : mixPoints(cover, end, outE(Math.min(1, (p.t - half) / half)));
      drawGuide(guide, pts, p.fill);
    };

    gsap.set(enter, { autoAlpha: 0 });
    gsap.set(newCaps, { autoAlpha: 0, y: 24 });
    render();
    return timeline()
      .to(p, { t: d, duration: d, ease: "none", onUpdate: render }, 0)
      .to(p, { fill: 1, duration: half * 0.8, ease: "power1.in", onUpdate: render }, 0)
      .to(oldCaps, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, 0)
      .set(ghost, { autoAlpha: 0 }, half)
      .set(enter, { autoAlpha: 1 }, half)
      .to(p, { fill: 0, duration: half * 0.8, ease: "power1.out", onUpdate: render }, half)
      .to(newCaps, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: 0.06 }, d - 0.4);
  };

  let current = null;
  let lastIndex = null;

  function cleanup() {
    // 先跑到终点再销毁，避免中途翻页时元素停在隐藏状态
    current?.progress(1).kill();
    current = null;
    for (const el of document.querySelectorAll(".st-ghost, .st-mask")) el.remove();
    for (const el of document.querySelectorAll(".st-enter")) gsap.set(el, { clearProps: "all" });
    clearBlur();
  }

  function onSlide({ currentSlide, previousSlide, indexh }) {
    cleanup();
    const forward = lastIndex !== null && indexh === lastIndex + 1;
    lastIndex = indexh;
    if (!previousSlide || !forward) return;
    const kind = currentSlide.dataset.st;
    if (!kind) {
      if (currentSlide.hasAttribute("data-auto-animate") && previousSlide.hasAttribute("data-auto-animate")) {
        current = autoAnimateExtras(currentSlide, previousSlide);
        current.progress(0);
        if (!CAPTURE) current.play();
      }
      return;
    }
    const build = builders[kind];
    if (!build) {
      console.error(`[orca-transition-skill] 不认识的 data-st="${kind}"，可选：${Object.keys(builders).join(" / ")}`);
      return;
    }
    const enter = currentSlide.querySelector(":scope > .st-enter");
    const ghost = snapshot(previousSlide);
    currentSlide.prepend(ghost);
    current = build(currentSlide, ghost, enter);
    current.progress(0);
    if (!CAPTURE) current.play();
  }

  prepare();
  prepareStory();
  Reveal.initialize({
    width: W,
    height: H,
    margin: 0,
    center: false,
    controls: false,
    progress: false,
    hash: true,
    transition: "none",
    backgroundTransition: "none",
    autoAnimateDuration: 0.9,
    autoAnimateEasing: "cubic-bezier(0.65, 0, 0.35, 1)",
  });
  Reveal.on("ready", (e) => { lastIndex = e.indexh; });
  Reveal.on("slidechanged", onSlide);

  // 本次转场的 CSS 动画。暂停的动画不会自己结束，不单独记下来的话，
  // 下一次 seek 会把上一次转场的动画也倒回去，ghost 克隆时就拍到错误的状态。
  let captured = [];

  window.__capture = {
    // 切页后等两帧，让 auto-animate 把 CSS transition 挂上，再全部冻住。返回这次转场的总时长（毫秒）
    async go(index) {
      for (const a of captured) a.finish();
      current?.progress(1);
      Reveal.slide(index);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      captured = document.getAnimations();
      let end = 0;
      for (const a of captured) {
        a.pause();
        end = Math.max(end, a.effect.getComputedTiming().endTime);
      }
      if (current) end = Math.max(end, current.duration() * 1000);
      const hold = +(Reveal.getSlide(index).dataset.hold || 1.5) * 1000;
      return { transition: end, hold };
    },
    seek(ms) {
      for (const a of captured) a.currentTime = ms;
      current?.time(ms / 1000);
    },
    count: () => Reveal.getTotalSlides(),
  };
})();
