(() => {
  const library = globalThis.NTOXGlyphs;
  if (!library) return;
  const items = new Map(library.items.map(item => [item.id, item]));
  const scenes = new Map();
  const records = new Map();
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = false;
  try { paused = localStorage.getItem("ntox-glyph-motion") === "paused"; } catch {}
  let frameId = 0;
  let lastFrame = 0;
  let time = 0;
  let passage = null;
  let passageTimeout = 0;
  const sceneFor = id => {
    const key = items.has(id) ? id : "agents";
    if (!scenes.has(key)) scenes.set(key, library.createScene(key));
    return scenes.get(key);
  };
  const icon = (id, size = 20) => {
    const item = items.get(id);
    return item ? `<svg class="ntox-glyph-icon" width="${Number(size) || 20}" height="${Number(size) || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg>` : "";
  };
  const markup = (id, variant = "hero") => {
    const item = items.get(id);
    if (!item) return "";
    const type = ["hero", "welcome", "inline"].includes(variant) ? variant : "hero";
    return `<div class="glyph-composition glyph-${type}"><div class="glyph-stage" data-glyph="${id}" aria-hidden="true"><img class="glyph-fallback" src="glyphs/artwork/${id}.svg" alt="" draggable="false"><canvas class="glyph-canvas" hidden></canvas></div>${type === "hero" ? `<span class="glyph-caption" aria-hidden="true"><span>${item.name}</span><small>${item.number} / ${item.label}</small></span>` : ""}${type !== "inline" ? '<button type="button" id="glyph-motion-${id}" class="glyph-motion-toggle" data-glyph-motion aria-label="Pause decorative glyph animation" title="Pause decorative glyph animation"><span aria-hidden="true"></span></button>' : ""}</div>`;
  };
  const isVisible = element => {
    if (!element.isConnected || !element.getClientRects().length) return false;
    const consoleRoot = element.closest("#ntox-console");
    if (consoleRoot && (consoleRoot.classList.contains("landing-mode") || consoleRoot.classList.contains("chat-mode"))) return false;
    const chat = element.closest("#desktop-chat");
    if (chat && !chat.classList.contains("chat-visible")) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const glow = (ctx, x, y, radius, alpha) => {
    const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 6);
    halo.addColorStop(0, `rgba(255,255,255,${alpha * .38})`);
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - radius * 6, y - radius * 6, radius * 12, radius * 12);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  function drawScene(ctx, scene, clock, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    for (const surface of scene.surfaces) {
      const [x, y, scale] = library.project(surface.center, clock, scene.flat);
      const radius = surface.radius * scale;
      const gradient = ctx.createRadialGradient(x - radius * .5, y - radius * .7, 0, x, y, radius * 1.2);
      gradient.addColorStop(0, "#353535");
      gradient.addColorStop(.35, "#0b0b0b");
      gradient.addColorStop(1, "#020202");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    scene.lines.forEach((line, index) => {
      ctx.beginPath();
      line.points.forEach((point, i) => {
        const [x, y] = library.project(point, clock, scene.flat);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.strokeStyle = `rgba(255,255,255,${line.alpha})`;
      ctx.lineWidth = line.width;
      ctx.shadowColor = "#ffffff55";
      ctx.shadowBlur = line.alpha > .7 ? 3 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (line.flow && line.points.length > 1 && !preference.matches && !paused) {
        const position = (clock * 5 + index * 17) % (line.points.length - 1);
        const lower = Math.floor(position);
        const fraction = position - lower;
        const point = line.points[lower].map((value, axis) => value + (line.points[lower + 1][axis] - value) * fraction);
        const [x, y] = library.project(point, clock, scene.flat);
        glow(ctx, x, y, .8, .8);
      }
    });
    for (const dot of scene.dots) {
      const [x, y, scale] = library.project([dot.x, dot.y, dot.z], clock, scene.flat);
      if (dot.beacon) glow(ctx, x, y, dot.radius * scale, dot.alpha);
      else {
        ctx.fillStyle = `rgba(255,255,255,${dot.alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, dot.radius * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  const cloud = scene => {
    const points = scene.dots.map(dot => [dot.x, dot.y, dot.z]);
    scene.lines.forEach(line => line.points.forEach((point, i) => { if (i % 4 === 0) points.push(point); }));
    return Array.from({ length: 750 }, (_, index) => points[index * 37 % points.length] || [0, 0, 0]);
  };
  const interpolate = (from, to, progress, index) => {
    const eased = progress * progress * (3 - 2 * progress);
    const burst = Math.sin(progress * Math.PI) * (12 + index % 19);
    return from.map((value, axis) => value * (1 - eased) + to[axis] * eased + (axis === 0 ? Math.cos(index * 2.399) : Math.sin(index * 2.399)) * burst);
  };
  function paint(record) {
    const { canvas, ctx, element } = record;
    if (!ctx || !element.clientWidth || !element.clientHeight) return;
    const width = element.clientWidth;
    const height = element.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width, height) / 320;
    ctx.translate(width / 2 - 160 * scale, height / 2 - 160 * scale);
    ctx.scale(scale, scale);
    const clock = preference.matches ? 0 : time;
    const morph = record.morph;
    if (morph) {
      const progress = Math.min(1, (time - morph.start) / .64);
      drawScene(ctx, morph.scene, clock, Math.max(0, 1 - progress * 3));
      drawScene(ctx, record.scene, clock, Math.max(0, (progress - .35) / .65));
      ctx.fillStyle = `rgba(255,255,255,${Math.sin(progress * Math.PI) * .65})`;
      morph.from.forEach((point, index) => {
        const [x, y] = library.project(interpolate(point, morph.to[index], progress, index), clock, record.scene.flat);
        ctx.fillRect(x, y, index % 9 ? .7 : 1.2, index % 9 ? .7 : 1.2);
      });
      if (progress >= 1) record.morph = null;
    } else drawScene(ctx, record.scene, clock);
    canvas.hidden = false;
    record.fallback.hidden = true;
  }
  function finishPassage() {
    clearTimeout(passageTimeout);
    passage?.element.remove();
    passage = null;
  }
  function paintPassage(now) {
    if (!passage) return;
    const progress = Math.min(1, (now - passage.start) / 760);
    if (progress >= 1) { finishPassage(); return; }
    const { ctx, canvas, from, to, scene, destination } = passage;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(innerWidth * dpr) || canvas.height !== Math.round(innerHeight * dpr)) {
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = `rgba(0,0,0,${Math.pow(1 - progress, 2) * .96})`;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    const targetRect = destination?.isConnected ? destination.getBoundingClientRect() : null;
    const eased = 1 - Math.pow(1 - progress, 3);
    const targetX = targetRect?.width ? targetRect.left + targetRect.width / 2 : innerWidth * .5;
    const targetY = targetRect?.height ? targetRect.top + targetRect.height / 2 : innerHeight * .4;
    const x = innerWidth * .5 * (1 - eased) + targetX * eased;
    const y = innerHeight * .47 * (1 - eased) + targetY * eased;
    const startScale = Math.min(innerWidth / 650, innerHeight / 500, 1.5);
    const endScale = targetRect?.width ? Math.min(targetRect.width, targetRect.height) / 320 : .65;
    const scale = startScale * (1 - eased) + endScale * eased;
    ctx.translate(x - 160 * scale, y - 160 * scale);
    ctx.scale(scale, scale);
    drawScene(ctx, scene, time, Math.max(0, 1 - progress * 4));
    from.forEach((point, index) => {
      const [px, py] = library.project(interpolate(point, to[index], progress, index), time, false);
      ctx.fillStyle = `rgba(255,255,255,${(.2 + index % 7 * .1) * (1 - progress)})`;
      ctx.fillRect(px, py, index % 8 ? .85 : 1.5, index % 8 ? .85 : 1.5);
    });
  }
  function stop() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrame = 0;
  }
  function sync() {
    if (document.hidden || preference.matches || paused) { stop(); return; }
    if (!passage && ![...records.values()].some(record => record.ctx && isVisible(record.element))) { stop(); return; }
    if (!frameId) frameId = requestAnimationFrame(frame);
  }
  function frame(now) {
    frameId = 0;
    if (lastFrame && now - lastFrame < 32) { sync(); return; }
    time += lastFrame ? Math.min((now - lastFrame) / 1000, .08) : 0;
    lastFrame = now;
    for (const record of records.values()) if (isVisible(record.element)) paint(record);
    paintPassage(now);
    sync();
  }
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target);
      if (record && isVisible(record.element)) paint(record);
    }
    sync();
  });
  const intersectionObserver = new IntersectionObserver(() => sync(), { threshold: .01 });
  function updateControls() {
    document.querySelectorAll("[data-glyph-motion]").forEach(button => {
      const still = paused || preference.matches;
      button.disabled = preference.matches;
      button.dataset.paused = String(still);
      button.setAttribute("aria-pressed", String(still));
      const label = preference.matches ? "Glyph animation disabled by reduced-motion preference" : paused ? "Resume decorative glyph animation" : "Pause decorative glyph animation";
      button.setAttribute("aria-label", label);
      button.title = label;
    });
  }
  function mount(scope = document) {
    for (const [element] of records) if (!element.isConnected) {
      resizeObserver.unobserve(element);
      intersectionObserver.unobserve(element);
      records.delete(element);
    }
    scope.querySelectorAll("[data-glyph]").forEach(element => {
      if (records.has(element) || !items.has(element.dataset.glyph)) return;
      const canvas = element.querySelector("canvas");
      const fallback = element.querySelector("img");
      if (!canvas || !fallback) return;
      let ctx = null;
      try { ctx = canvas.getContext("2d"); } catch {}
      const record = { element, canvas, fallback, ctx, scene: sceneFor(element.dataset.glyph), morph: null };
      records.set(element, record);
      resizeObserver.observe(element);
      intersectionObserver.observe(element);
      if (isVisible(element)) paint(record);
    });
    updateControls();
    sync();
  }
  function enter(from, to, immersive = false) {
    finishPassage();
    mount();
    if (paused || preference.matches || document.hidden || !items.has(to)) return;
    const sourceScene = sceneFor(from);
    const destination = [...records.values()].find(record => record.element.dataset.glyph === to && isVisible(record.element));
    if (destination) { destination.morph = null; paint(destination); }
    if (immersive) {
      const element = document.createElement("div");
      element.className = "glyph-passage";
      element.setAttribute("aria-hidden", "true");
      const canvas = document.createElement("canvas");
      element.append(canvas);
      let ctx = null;
      try { ctx = canvas.getContext("2d"); } catch {}
      if (!ctx) return;
      document.body.append(element);
      passage = { element, canvas, ctx, start: performance.now(), scene: sourceScene, from: cloud(sourceScene), to: cloud(sceneFor(to)), destination: destination?.element };
      passageTimeout = setTimeout(finishPassage, 900);
      paintPassage(performance.now());
    } else if (destination && destination.ctx && from !== to) {
      destination.morph = { scene: sourceScene, from: cloud(sourceScene), to: cloud(destination.scene), start: time };
      paint(destination);
    }
    sync();
  }
  document.addEventListener("click", event => {
    if (!event.target.closest("[data-glyph-motion]")) return;
    paused = !paused;
    try { localStorage.setItem("ntox-glyph-motion", paused ? "paused" : "enabled"); } catch {}
    finishPassage();
    for (const record of records.values()) { record.morph = null; if (isVisible(record.element)) paint(record); }
    updateControls();
    sync();
  });
  preference.addEventListener("change", () => {
    finishPassage();
    for (const record of records.values()) { record.morph = null; if (isVisible(record.element)) paint(record); }
    updateControls();
    sync();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) finishPassage(); sync(); });
  document.addEventListener("scroll", sync, { passive: true, capture: true });
  document.addEventListener("keydown", event => { if (event.key === "Escape") finishPassage(); });
  globalThis.NTOXGlyphMotion = { icon, markup, mount, enter, sync };
})();
