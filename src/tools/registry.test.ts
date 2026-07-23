import { describe, it, expect } from "vitest";
import { ToolRegistry, executeToolCall } from "./registry.js";
import type { Tool } from "../types/index.js";

const testTool: Tool = {
  name: "test",
  description: "A test tool",
  parameters: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  },
  async execute(args) {
    return { success: true, data: args.value };
  },
};

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const r = new ToolRegistry();
    r.register(testTool);
    expect(r.get("test")).toBe(testTool);
    expect(r.get("nonexistent")).toBeUndefined();
  });

  it("lists registered tools", () => {
    const r = new ToolRegistry();
    r.register(testTool);
    expect(r.list().length).toBe(1);
    expect(r.list()[0].name).toBe("test");
  });

  it("converts to OpenAI format", () => {
    const r = new ToolRegistry();
    r.register(testTool);
    const tools = r.toOpenAITools();
    expect(tools.length).toBe(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("test");
    expect(tools[0].function.parameters.type).toBe("object");
  });

  it("overwrites tool with same name", () => {
    const r = new ToolRegistry();
    r.register(testTool);
    const newer: Tool = { ...testTool, description: "updated" };
    r.register(newer);
    expect(r.get("test")!.description).toBe("updated");
  });
});

describe("executeToolCall", () => {
  it("executes a registered tool", async () => {
    const r = new ToolRegistry();
    r.register(testTool);
    const result = await executeToolCall(r, "test", { value: "hello" });
    expect(result.success).toBe(true);
    expect(result.data).toBe("hello");
  });

  it("returns error for unknown tool", async () => {
    const r = new ToolRegistry();
    const result = await executeToolCall(r, "unknown", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown");
  });
});
