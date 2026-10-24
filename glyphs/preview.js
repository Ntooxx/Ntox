(() => {
  const { items, createScene, project } = globalThis.NTOXGlyphs;
  const canvas = document.getElementById("glyph-canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const stage = document.getElementById("stage");
  const fallback = document.getElementById("stage-fallback");
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const state = { index: 0, scene: createScene("intro"), paused: false, reduced: motionPreference.matches, visible: true, time: 0, last: 0, frame: 0, transition: null, active: false, filter: "All", query: "" };
  let width = 0, height = 0, dpr = 1;
  const grid = document.getElementById("glyph-grid");
  const caption = document.getElementById("transition-caption");
  const motionToggle = document.getElementById("motion-toggle");
  const drawPath = (points, alpha, lineWidth, time, flat, glow = false) => {
    context.beginPath();
    points.forEach((point, i) => {
      const [x, y] = project(point, time, flat);
      if (i) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.strokeStyle = `rgba(255,255,255,${alpha})`;
    context.lineWidth = lineWidth;
    context.shadowBlur = glow ? 4 : 0;
    context.shadowColor = "rgba(255,255,255,.45)";
    context.stroke();
    context.shadowBlur = 0;
  };
  function drawScene(scene, time, opacity = 1) {
    context.globalAlpha = opacity;
    scene.surfaces.forEach(({ center, radius }) => {
      const [x, y, scale] = project(center, time, scene.flat);
      const r = radius * scale;
      const gradient = context.createRadialGradient(x - r * .5, y - r * .7, 0, x, y, r * 1.2);
      gradient.addColorStop(0, "#303030");
      gradient.addColorStop(.32, "#0c0c0c");
      gradient.addColorStop(1, "#020202");
      context.fillStyle = gradient;
      context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.fill();
    });
    scene.lines.forEach((line, index) => {
      drawPath(line.points, line.alpha, line.width, time, scene.flat, line.alpha > .7);
      if (line.flow && !state.reduced) {
        const pos = ((time * (state.active ? 15 : 5) + index * 17) % (line.points.length - 1));
        const lower = Math.floor(pos), fraction = pos - lower;
        const point = line.points[lower].map((value, axis) => value + (line.points[lower + 1][axis] - value) * fraction);
        const [x, y] = project(point, time, scene.flat);
        glow(x, y, .85, .65);
      }
    });
    scene.dots.forEach(dot => {
      const [x, y, scale] = project([dot.x, dot.y, dot.z], time, scene.flat);
      if (dot.beacon) glow(x, y, dot.radius * scale, dot.alpha);
      else {
        context.fillStyle = `rgba(255,255,255,${dot.alpha})`;
        context.beginPath(); context.arc(x, y, dot.radius * scale, 0, Math.PI * 2); context.fill();
      }
    });
    context.globalAlpha = 1;
  }
  function glow(x, y, radius, alpha) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius * 6);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha * .5})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius * 6, y - radius * 6, radius * 12, radius * 12);
    context.fillStyle = `rgba(255,255,255,${alpha})`;
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
  }
  function cloud(scene) {
    const points = scene.dots.map(dot => [dot.x, dot.y, dot.z]);
    scene.lines.forEach(line => line.points.forEach((point, i) => { if (i % 3 === 0) points.push(point); }));
    return Array.from({ length: 1400 }, (_, index) => points[index * 37 % points.length]);
  }
  function drawTransition() {
    const transition = state.transition;
    const raw = Math.min(1, transition.elapsed / .9);
    const eased = raw * raw * (3 - 2 * raw);
    const burst = Math.sin(raw * Math.PI);
    drawScene(transition.fromScene, state.time, Math.max(0, 1 - raw * 4));
    drawScene(state.scene, state.time, Math.max(0, (raw - .55) / .45));
    transition.from.forEach((point, index) => {
      const target = transition.to[index];
      const angle = index * 2.399;
      const position = point.map((value, axis) => value * (1 - eased) + target[axis] * eased + (axis === 0 ? Math.cos(angle) : Math.sin(angle)) * burst * (12 + index % 28));
      const [x, y] = project(position, state.time, state.scene.flat);
      context.fillStyle = `rgba(255,255,255,${(.12 + index % 7 * .08) * Math.sin(raw * Math.PI)})`;
      context.fillRect(x, y, index % 8 ? .65 : 1.1, index % 8 ? .65 : 1.1);
    });
    if (raw >= 1) {
      state.transition = null;
      caption.textContent = "";
      stage.dataset.transition = "complete";
    }
  }
  function draw() {
    if (!context || width === 0 || height === 0) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#030303";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / 370, height / 350);
    context.translate(width / 2 - 160 * scale, height / 2 - 160 * scale);
    context.scale(scale, scale);
    if (state.transition) drawTransition(); else drawScene(state.scene, state.time);
  }
  function stop() {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.last = 0;
  }
  function sync() {
    if (!context || document.hidden || !state.visible || state.reduced || state.paused) { stop(); draw(); return; }
    if (!state.frame) state.frame = requestAnimationFrame(frame);
  }
  function frame(now) {
    state.frame = 0;
    const delta = state.last ? Math.min((now - state.last) / 1000, .05) : 0;
    state.last = now;
    state.time += delta * (state.active ? 1.7 : 1);
    if (state.transition) state.transition.elapsed += delta;
    draw();
    sync();
  }
  function updateMotion() {
    motionToggle.disabled = state.reduced || !context;
    motionToggle.textContent = !context ? "Static preview" : state.reduced ? "Reduced motion" : state.paused ? "Resume motion" : "Pause motion";
    motionToggle.setAttribute("aria-pressed", String(state.paused || state.reduced || !context));
    document.getElementById("motion-label").textContent = !context || state.reduced || state.paused ? "STILL STUDY" : state.active ? "ACTIVE MOTION / ILLUSTRATIVE" : "AMBIENT MOTION";
    if (state.reduced || state.paused || !context) { state.transition = null; caption.textContent = ""; stage.dataset.transition = "complete"; }
    sync();
  }
  function choose(index, animate = true, fromIntro = false) {
    const oldScene = fromIntro ? createScene("intro") : state.scene;
    state.index = (index + items.length) % items.length;
    const item = items[state.index];
    state.scene = createScene(item.id);
    state.transition = animate && !state.reduced && !state.paused && context ? { fromScene: oldScene, from: cloud(oldScene), to: cloud(state.scene), elapsed: 0 } : null;
    stage.dataset.transition = state.transition ? "running" : "complete";
    caption.textContent = state.transition ? `${fromIntro ? "INTRO → " : "FORMING / "}${item.label.toUpperCase()}` : "";
    document.getElementById("selected-number").textContent = `${item.number} / ${item.group.toUpperCase()}`;
    document.getElementById("selected-name").textContent = item.name;
    document.getElementById("selected-description").textContent = item.description;
    document.getElementById("selected-label").textContent = item.label;
    document.getElementById("stage-destination").textContent = `${item.label.toUpperCase()} / ${item.name.toUpperCase()}`;
    document.getElementById("position").textContent = `${item.number} / ${items.length}`;
    document.getElementById("download-artwork").href = `artwork/${item.id}.svg`;
    document.getElementById("download-icon").href = `icons/${item.id}.svg`;
    document.querySelectorAll(".icon-sizes img").forEach(img => { img.src = `icons/${item.id}.svg`; });
    fallback.src = `artwork/${item.id}.svg`;
    grid.querySelectorAll(".glyph-card").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.glyph === item.id)));
    history.replaceState(null, "", `#${item.id}`);
    draw(); sync();
  }
  function renderGrid() {
    const filtered = items.filter(item => (state.filter === "All" || item.group === state.filter) && `${item.label} ${item.name} ${item.description}`.toLowerCase().includes(state.query));
    grid.replaceChildren(...filtered.map(item => {
      const button = document.createElement("button");
      button.className = "glyph-card";
      button.dataset.glyph = item.id;
      button.setAttribute("aria-pressed", String(item.id === items[state.index].id));
      button.setAttribute("aria-label", `Preview ${item.label}: ${item.name}`);
      button.innerHTML = `<span class="card-top"><span>${item.number} / ${item.group.toUpperCase()}</span><img src="icons/${item.id}.svg" alt=""></span><img class="glyph-art" src="artwork/${item.id}.svg" alt=""><span class="card-bottom"><span><b>${item.label}</b><small>${item.name}</small></span><span aria-hidden="true">↗</span></span>`;
      button.addEventListener("click", () => {
        choose(items.indexOf(item));
        document.getElementById("selected-name").setAttribute("tabindex", "-1");
        document.getElementById("selected-name").focus({ preventScroll: true });
        document.querySelector(".studio").scrollIntoView({ behavior: state.reduced ? "instant" : "smooth", block: "start" });
      });
      return button;
    }));
    document.getElementById("empty-results").hidden = filtered.length > 0;
    document.getElementById("results-count").textContent = `${filtered.length} glyphs shown`;
  }
  document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderGrid();
  }));
  document.getElementById("search").addEventListener("input", event => { state.query = event.target.value.trim().toLowerCase(); renderGrid(); });
  document.getElementById("previous").addEventListener("click", () => choose(state.index - 1));
  document.getElementById("next").addEventListener("click", () => choose(state.index + 1));
  document.getElementById("replay").addEventListener("click", () => choose(state.index));
  document.querySelectorAll("[data-transition]").forEach(button => button.addEventListener("click", () => choose(items.findIndex(item => item.id === button.dataset.transition), true, true)));
  motionToggle.addEventListener("click", () => { state.paused = !state.paused; updateMotion(); });
  document.getElementById("intensity").addEventListener("change", event => { state.active = event.target.value === "active"; updateMotion(); });
  motionPreference.addEventListener("change", event => { state.reduced = event.matches; updateMotion(); });
  document.addEventListener("visibilitychange", sync);
  new IntersectionObserver(entries => { state.visible = entries[0].isIntersecting; sync(); }, { threshold: .05 }).observe(stage);
  new ResizeObserver(() => {
    width = stage.clientWidth; height = stage.clientHeight; dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    draw();
  }).observe(stage);
  if (!context) { canvas.hidden = true; fallback.hidden = false; }
  renderGrid();
  choose(Math.max(0, items.findIndex(item => item.id === location.hash.slice(1))), false);
  updateMotion();
})();
