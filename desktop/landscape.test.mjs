import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const read = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const GL_CONSTANTS = {
  VERTEX_SHADER: 1,
  FRAGMENT_SHADER: 2,
  COMPILE_STATUS: 3,
  LINK_STATUS: 4,
  TRIANGLES: 5,
};

function boot({ landing = true, rect = { width: 1484, height: 895 }, hidden = false, connected = true, reduced = false } = {}) {
  const state = {
    landing,
    rect,
    hidden,
    connected,
    display: "block",
    visibility: "visible",
    opacity: "1",
    now: 0,
    nextRaf: 1,
    pending: new Map(),
    observers: [],
    docListeners: new Map(),
    winListeners: new Map(),
    canvasListeners: new Map(),
    drawCalls: 0,
    shadersCreated: 0,
  };

  const listen = (map, type, fn) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const emit = (map, event) => {
    for (const fn of map.get(event.type) || []) fn(event);
  };

  const gl = {
    ...GL_CONSTANTS,
    createShader: () => (state.shadersCreated++, { id: state.shadersCreated }),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram: () => {},
    useProgram: () => {},
    getUniformLocation: (_program, name) => ({ name }),
    viewport: () => {},
    uniform2f: () => {},
    uniform1f: () => {},
    drawArrays: () => {
      state.drawCalls += 1;
    },
  };

  const classList = values => {
    const set = new Set(values);
    return {
      add: value => set.add(value),
      remove: value => set.delete(value),
      contains: value => set.has(value),
      values: () => [...set],
    };
  };

  const consoleRoot = { classList: classList(landing ? ["console", "landing-mode"] : ["console"]) };
  const canvas = {
    id: "gl",
    clientWidth: 1484,
    clientHeight: 895,
    width: 0,
    height: 0,
    isConnected: connected,
    getContext: () => gl,
    closest: selector => (selector === ".console" ? consoleRoot : null),
    getBoundingClientRect: () => ({ width: state.rect.width, height: state.rect.height, top: 0, left: 0, right: state.rect.width, bottom: state.rect.height }),
    addEventListener: (type, fn) => listen(state.canvasListeners, type, fn),
    removeEventListener: () => {},
  };

  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback;
      state.observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() {}
  }

  const documentStub = {
    getElementById: id => (id === "gl" ? canvas : null),
    querySelector: selector => (selector === ".console" ? consoleRoot : null),
    addEventListener: (type, fn) => listen(state.docListeners, type, fn),
    removeEventListener: () => {},
    dispatchEvent: event => (emit(state.docListeners, event), true),
    get hidden() {
      return state.hidden;
    },
    set hidden(value) {
      state.hidden = value;
    },
  };

  const windowStub = {
    devicePixelRatio: 1,
    MutationObserver: MutationObserverStub,
    addEventListener: (type, fn) => listen(state.winListeners, type, fn),
    removeEventListener: () => {},
  };

  const sandbox = {
    console,
    document: documentStub,
    window: windowStub,
    MutationObserver: MutationObserverStub,
    matchMedia: query => ({ matches: query.includes("reduced-motion") && reduced, addEventListener: (_, handler) => { if (query.includes("reduced-motion")) state.changeMotion = handler; } }),
    performance: { now: () => state.now },
    requestAnimationFrame: callback => {
      const id = state.nextRaf++;
      state.pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame: id => state.pending.delete(id),
    getComputedStyle: () => ({ display: state.display, visibility: state.visibility, opacity: state.opacity }),
    addEventListener: (type, fn) => listen(state.winListeners, type, fn),
    removeEventListener: () => {},
    innerWidth: 1484,
    innerHeight: 895,
    setTimeout,
    clearTimeout,
  };

  vm.createContext(sandbox);
  vm.runInContext(read("./landscape.js"), sandbox, { filename: "landscape.js" });

  return {
    state,
    canvas,
    consoleRoot,
    flush() {
      const callbacks = [...state.pending.values()];
      state.pending.clear();
      state.now += 16;
      for (const callback of callbacks) callback(state.now);
    },
    mutateConsole() {
      for (const observer of state.observers) observer.callback([{ type: "attributes" }]);
    },
    emitDocument(type) {
      emit(state.docListeners, { type });
    },
    emitCanvas(type) {
      emit(state.canvasListeners, { type, preventDefault: () => {} });
    },
  };
}

describe("landing landscape render loop", () => {
  it("paints one still frame in reduced motion and stops when hidden", () => {
    const app = boot({ reduced: true });
    app.flush();
    expect(app.state.drawCalls).toBe(1);
    expect(app.state.pending.size).toBe(0);
    app.consoleRoot.classList.remove("landing-mode");
    app.mutateConsole();
    app.flush();
    expect(app.state.drawCalls).toBe(1);
  });

  it("reacts to motion preference changes without reloading", () => {
    const app = boot();
    app.flush();
    app.state.changeMotion({ matches: true });
    app.flush();
    expect(app.state.pending.size).toBe(0);
    app.state.changeMotion({ matches: false });
    app.flush();
    expect(app.state.pending.size).toBe(1);
  });

  it("renders frames while the launch screen is visible", () => {
    const app = boot();
    expect(app.state.pending.size).toBe(1);

    app.flush();
    expect(app.state.drawCalls).toBe(1);
    expect(app.state.pending.size).toBe(1);
  });

  it("stops rendering when the launch screen is left behind", () => {
    const app = boot();

    app.consoleRoot.classList.remove("landing-mode");
    app.mutateConsole();
    expect(app.state.pending.size).toBe(0);

    const draws = app.state.drawCalls;
    app.flush();
    expect(app.state.drawCalls).toBe(draws);
  });

  it("resumes rendering when the launch screen is shown again", () => {
    const app = boot({ landing: false });
    expect(app.state.pending.size).toBe(0);

    app.consoleRoot.classList.add("landing-mode");
    app.mutateConsole();
    expect(app.state.pending.size).toBe(1);
  });

  it("stops rendering while the document is hidden", () => {
    const app = boot();

    app.state.hidden = true;
    app.emitDocument("visibilitychange");
    expect(app.state.pending.size).toBe(0);

    app.state.hidden = false;
    app.emitDocument("visibilitychange");
    expect(app.state.pending.size).toBe(1);
  });

  it("stops rendering when the canvas is laid out at zero size", () => {
    const app = boot();

    app.state.rect = { width: 0, height: 0 };
    app.emitDocument("visibilitychange");
    expect(app.state.pending.size).toBe(0);
  });

  it("stops rendering when the canvas is detached from the document", () => {
    const app = boot();

    app.canvas.isConnected = false;
    app.emitDocument("visibilitychange");
    expect(app.state.pending.size).toBe(0);
  });

  it("restarts the loop after a WebGL context restore", () => {
    const app = boot();

    app.emitCanvas("webglcontextlost");
    expect(app.state.pending.size).toBe(0);

    app.emitCanvas("webglcontextrestored");
    expect(app.state.pending.size).toBe(1);
  });
});

describe("desktop runtime defaults", () => {
  it("renders with hardware acceleration enabled by default", () => {
    const main = read("./main.cjs");
    expect(main).toContain('if (process.env.NTOX_DESKTOP_ENABLE_GPU === "0")');
    expect(main).not.toContain('NTOX_DESKTOP_ENABLE_GPU !== "1"');
  });

  it("hides the launch screen as soon as the dashboard is opened", () => {
    const landing = read("./landing.css");
    expect(landing).toContain(".console:not(.landing-mode)>.launch-screen{display:none}");
  });
});
