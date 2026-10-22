const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

function initProgress() {
  const bar = document.querySelector(".progress__bar");
  if (!bar) return;

  let ticking = false;

  const paint = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.width = `${(ratio * 100).toFixed(2)}%`;
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(paint);
    },
    { passive: true },
  );

  paint();
}

function initNav() {
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");
  const panel = document.getElementById("navPanel");
  if (!nav) return;

  const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    panel.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.tagName !== "A") return;
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  }
}

function initReveals() {
  const items = Array.from(document.querySelectorAll(".reveal"));
  if (!items.length) return;

  if (reduced || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-in"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const siblings = Array.from(el.parentElement?.children ?? []).filter((n) =>
          n.classList.contains("reveal"),
        );
        const index = Math.max(0, siblings.indexOf(el));
        el.style.transitionDelay = `${Math.min(index * 85, 420)}ms`;
        el.classList.add("is-in");
        observer.unobserve(el);
      });
    },
    { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
  );

  items.forEach((el) => observer.observe(el));
}

function initCounters() {
  const nodes = Array.from(document.querySelectorAll("[data-count]"));
  if (!nodes.length) return;

  const render = (el, value) => {
    const decimals = Number(el.dataset.decimals ?? 0);
    const prefix = el.dataset.prefix ?? "";
    const suffix = el.dataset.suffix ?? "";
    el.textContent = `${prefix}${value.toFixed(decimals)}${suffix}`;
  };

  const run = (el) => {
    const target = Number(el.dataset.count ?? 0);
    if (reduced) {
      render(el, target);
      return;
    }

    const duration = 1500;
    const start = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      render(el, target * easeOutExpo(t));
      if (t < 1) requestAnimationFrame(step);
      else render(el, target);
    };

    requestAnimationFrame(step);
  };

  if (!("IntersectionObserver" in window)) {
    nodes.forEach(run);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        run(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.5 },
  );

  nodes.forEach((el) => observer.observe(el));
}

function initLoop() {
  const nodes = Array.from(document.querySelectorAll(".ring__node"));
  const items = Array.from(document.querySelectorAll(".loop__item"));
  const indexEl = document.getElementById("ringIndex");
  const nameEl = document.getElementById("ringName");
  const copyEl = document.getElementById("ringCopy");
  if (!nodes.length) return;

  const stages = nodes.map((node, i) => ({
    name: node.textContent.trim(),
    copy: items[i]?.querySelector("p")?.textContent.trim() ?? "",
  }));

  let current = 0;
  let timer = 0;

  const paint = (next) => {
    current = ((next % stages.length) + stages.length) % stages.length;

    nodes.forEach((node, i) => node.classList.toggle("is-active", i === current));
    items.forEach((item, i) => item.classList.toggle("is-active", i === current));

    if (indexEl) indexEl.textContent = String(current + 1).padStart(2, "0");

    if (nameEl && copyEl) {
      copyEl.classList.add("is-swapping");
      window.setTimeout(() => {
        nameEl.textContent = stages[current].name;
        copyEl.textContent = stages[current].copy;
        copyEl.classList.remove("is-swapping");
      }, reduced ? 0 : 190);
    }
  };

  const schedule = () => {
    window.clearTimeout(timer);
    if (reduced) return;
    timer = window.setTimeout(() => {
      paint(current + 1);
      schedule();
    }, 2900);
  };

  nodes.forEach((node, i) => {
    node.addEventListener("click", () => {
      paint(i);
      schedule();
    });
    node.addEventListener("mouseenter", () => {
      paint(i);
      window.clearTimeout(timer);
    });
    node.addEventListener("mouseleave", schedule);
  });

  items.forEach((item, i) => {
    item.addEventListener("mouseenter", () => {
      paint(i);
      window.clearTimeout(timer);
    });
    item.addEventListener("mouseleave", schedule);
  });

  paint(0);
  schedule();
}

function initMagnetic() {
  if (reduced || !window.matchMedia("(pointer: fine)").matches) return;

  document.querySelectorAll(".magnetic").forEach((el) => {
    const strength = 0.26;

    el.addEventListener("mousemove", (event) => {
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
    });

    el.addEventListener("mouseleave", () => {
      el.style.transform = "translate(0, 0)";
    });
  });
}

function initCopy() {
  const toast = document.getElementById("toast");
  let hideTimer = 0;

  const flash = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-on");
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => toast.classList.remove("is-on"), 1900);
  };

  document.querySelectorAll("[data-copy]").forEach((el) => {
    el.addEventListener("click", async () => {
      const value = el.dataset.copy ?? "";
      try {
        await navigator.clipboard.writeText(value);
        flash(`copied: ${value}`);
      } catch {
        flash("copy failed");
      }
    });
  });
}

function initAnchors() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();

      const offset = document.getElementById("nav")?.offsetHeight ?? 0;
      const top = target.getBoundingClientRect().top + window.scrollY - offset - 8;

      window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    });
  });
}

function initField() {
  const canvas = document.getElementById("field");
  if (!(canvas instanceof HTMLCanvasElement) || reduced) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const pointer = { x: -9999, y: -9999, active: false };
  let width = 0;
  let height = 0;
  let dpr = 1;
  let nodes = [];
  let pulses = [];
  let frame = 0;
  let running = true;
  let lastPulse = 0;

  const seed = () => {
    const area = width * height;
    const count = Math.round(Math.min(120, Math.max(34, area / 15000)));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 1.5 + 0.7,
      heat: 0,
    }));
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  };

  const spawnPulse = () => {
    pulses.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 0,
      life: 1,
    });
    if (pulses.length > 5) pulses.shift();
  };

  const draw = (time) => {
    if (!running) return;
    frame = requestAnimationFrame(draw);

    ctx.clearRect(0, 0, width, height);

    if (time - lastPulse > 2100) {
      lastPulse = time;
      spawnPulse();
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];

      a.x += a.vx;
      a.y += a.vy;

      if (a.x < -20) a.x = width + 20;
      if (a.x > width + 20) a.x = -20;
      if (a.y < -20) a.y = height + 20;
      if (a.y > height + 20) a.y = -20;

      if (pointer.active) {
        const dx = a.x - pointer.x;
        const dy = a.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 170 && dist > 0.001) {
          const force = (170 - dist) / 170;
          a.x += (dx / dist) * force * 1.9;
          a.y += (dy / dist) * force * 1.9;
          a.heat = Math.min(1, a.heat + force * 0.09);
        }
      }

      a.heat *= 0.955;

      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 132) continue;

        const alpha = (1 - dist / 132) * 0.23;
        const glow = Math.max(a.heat, b.heat);
        ctx.strokeStyle = glow > 0.02
          ? `rgba(255, 150, 112, ${alpha + glow * 0.34})`
          : `rgba(246, 241, 234, ${alpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = "lighter";

    for (const node of nodes) {
      const warm = node.heat > 0.02;
      const radius = node.r + node.heat * 2.6;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = warm
        ? `rgba(255, 150, 112, ${0.4 + node.heat * 0.55})`
        : "rgba(230, 184, 127, 0.34)";
      ctx.fill();
    }

    for (const pulse of pulses) {
      pulse.radius += 1.65;
      pulse.life -= 0.0058;
      if (pulse.life <= 0) continue;

      const alpha = Math.max(0, pulse.life) * 0.24;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(111, 208, 196, ${alpha})`;
      ctx.lineWidth = 1.15;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    pulses = pulses.filter((pulse) => pulse.life > 0 && pulse.radius < Math.max(width, height));
  };

  const start = () => {
    if (running) return;
    running = true;
    frame = requestAnimationFrame(draw);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  window.addEventListener("resize", resize);
  window.addEventListener(
    "mousemove",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active =
        pointer.x > -80 && pointer.x < width + 80 && pointer.y > -80 && pointer.y < height + 80;
    },
    { passive: true },
  );
  window.addEventListener("mouseleave", () => {
    pointer.active = false;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) start();
        else stop();
      },
      { threshold: 0.01 },
    );
    io.observe(canvas);
  }

  resize();
  spawnPulse();
  start();
}

function init() {
  initProgress();
  initNav();
  initReveals();
  initCounters();
  initLoop();
  initMagnetic();
  initCopy();
  initAnchors();
  initField();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
