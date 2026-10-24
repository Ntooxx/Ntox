import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import "./catalog.js";
import "./geometry.js";

const { items, createScene, svg, icon } = globalThis.NTOXGlyphs;

test("every requested section and storyboard scene has both glyph sizes", () => {
  assert.equal(items.length, 21);
  assert.equal(new Set(items.map(item => item.id)).size, 21);
  for (const id of ["intro", "overview", "agents", "chat", "tasks", "memory", "tools", "evaluations", "settings", "onboarding", "create-agent", "agent-detail", "running", "workflows", "analytics", "integrations", "multi-agent", "research", "content", "outreach", "analysis"]) {
    assert.ok(items.some(item => item.id === id));
    for (const folder of ["artwork", "icons"]) assert.ok(existsSync(new URL(`./${folder}/${id}.svg`, import.meta.url)));
  }
});

test("all geometry is finite, deterministic and distinct", () => {
  const scenes = items.map(item => createScene(item.id));
  assert.equal(new Set(scenes.map(scene => JSON.stringify(scene))).size, 21);
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    assert.deepEqual(scene, createScene(items[index].id));
    assert.ok(scene.lines.length > 0);
    assert.ok(scene.dots.length > 0);
    for (const line of scene.lines) {
      assert.ok(line.points.length > 1);
      for (const point of line.points) assert.ok(point.every(Number.isFinite));
    }
    for (const dot of scene.dots) assert.ok([dot.x, dot.y, dot.z, dot.radius, dot.alpha].every(Number.isFinite));
  }
});

test("exports match the generator and use only neutral colors", () => {
  for (const item of items) {
    for (const [folder, render] of [["artwork", svg], ["icons", icon]]) {
      const output = readFileSync(new URL(`./${folder}/${item.id}.svg`, import.meta.url), "utf8");
      assert.equal(output, render(item));
      assert.match(output, /role="img" aria-labelledby="title"/);
      assert.ok(!output.includes("NaN"));
      assert.ok(!output.includes("<script"));
      for (const [, hex] of output.matchAll(/#([0-9a-f]{6})/gi)) {
        assert.equal(hex.slice(0, 2), hex.slice(2, 4));
        assert.equal(hex.slice(2, 4), hex.slice(4, 6));
      }
    }
  }
});
