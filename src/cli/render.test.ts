import { describe, expect, it } from "vitest";
import {
  renderHelp,
  renderLastTurn,
  renderModelsMenu,
  renderTips,
  renderToolEvent,
  renderTurnSummary,
  summarizeToolResult,
} from "./render.js";
import type { AgentTurnTrace } from "../types/index.js";

describe("tool result rendering", () => {
  it("summarizes web_read method and title", () => {
    const summary = summarizeToolResult("web_read", {
      success: true,
      data: { title: "Example Domain", method: "browser", diagnostics: [] },
    });
    expect(summary).toContain("browser");
    expect(summary).toContain("Example Domain");
  });

  it("includes elapsed time in tool events", () => {
    const rendered = renderToolEvent(
      "shell",
      {
        success: true,
        data: { stdout: "ok", status: 0 },
      },
      42,
    );
    expect(rendered).toContain("shell");
    expect(rendered).toContain("42ms");
    expect(rendered).toContain("ok");
  });

  it("summarizes failures without throwing", () => {
    expect(summarizeToolResult("read", { success: false, error: "bad path" })).toBe("bad path");
  });
});

describe("guide rendering", () => {
  it("renders help as a quick guide", () => {
    const rendered = renderHelp();
    expect(rendered).toContain("ntox quick guide");
    expect(rendered).toContain("/last");
    expect(rendered).toContain("/retry");
  });

  it("renders practical tips", () => {
    const rendered = renderTips();
    expect(rendered).toContain("practical Ntox tips");
    expect(rendered).toContain("/rollback");
  });
});

describe("model menu rendering", () => {
  it("keeps displayed model numbers aligned with selector indexes across providers", () => {
    const rendered = renderModelsMenu(
      [
        { id: "openai/gpt", name: "GPT" },
        { id: "anthropic/claude", name: "Claude" },
      ],
      "",
    );

    expect(rendered).toContain(" 2. Claude");
    expect(rendered).toContain(" 1. GPT");
    expect(rendered).toContain("/model refresh");
  });
});

describe("last turn rendering", () => {
  const trace: AgentTurnTrace = {
    startedAt: 100,
    completedAt: 250,
    userInput: "edit file",
    responseMode: "tool-build",
    memoryRecallCount: 0,
    searchUsed: false,
    toolCalls: [{ name: "edit", args: { filePath: "a.ts" }, success: true, durationMs: 12 }],
    policyDecisions: [],
    checkpointIds: ["cp_1"],
    retries: 0,
    fileChanges: [{ path: "C:/repo/a.ts", action: "edit", timestamp: 200 }],
  };

  it("summarizes important turn counts", () => {
    const summary = renderTurnSummary(trace);
    expect(summary).toContain("tool-build");
    expect(summary).toContain("1 tool");
    expect(summary).toContain("1 file");
    expect(summary).toContain("1 checkpoint");
  });

  it("renders recovery guidance", () => {
    const rendered = renderLastTurn(trace);
    expect(rendered).toContain("/rollback cp_1");
    expect(rendered).toContain("/trace for details");
  });
});
