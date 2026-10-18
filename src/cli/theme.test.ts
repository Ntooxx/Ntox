import { describe, expect, it } from "vitest";
import { gradient, meterBar, mix, panel, paint, palette, stripAnsi, truncateVisible, visibleWidth } from "./theme.js";

describe("theme primitives", () => {
  it("measures visible width without ansi codes", () => {
    expect(visibleWidth(paint(palette.accent, "hello"))).toBe(5);
    expect(visibleWidth("plain")).toBe(5);
  });

  it("truncates by visible width", () => {
    expect(truncateVisible("abcdefgh", 5)).toBe("abcd…");
    expect(truncateVisible("abc", 10)).toBe("abc");
  });

  it("interpolates color mixes", () => {
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
  });

  it("renders gradients that keep the original text", () => {
    const out = gradient("NTOX", palette.accent, palette.violet);
    expect(stripAnsi(out)).toBe("NTOX");
    expect(out).toContain("\x1b[38;2;");
  });

  it("draws panels with consistent line widths", () => {
    const out = panel("demo", ["one", "two"], { width: 40 });
    const lines = out.split("\n");
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(40);
    }
    expect(stripAnsi(lines[0])).toContain("demo");
  });

  it("pads short body lines and truncates long ones", () => {
    const out = panel("", ["short", "x".repeat(200)], { width: 30 });
    const lines = out.split("\n");
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(30);
    }
    expect(stripAnsi(lines[2]).includes("…")).toBe(true);
  });

  it("builds meter bars within requested width", () => {
    expect(stripAnsi(meterBar(50, 10))).toHaveLength(10);
    expect(stripAnsi(meterBar(0, 8))).toHaveLength(8);
    expect(stripAnsi(meterBar(200, 8))).toHaveLength(8);
  });
});
