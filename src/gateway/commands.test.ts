import { describe, expect, it } from "vitest";
import { isAliveQuery, renderAliveStatus } from "./commands.js";

describe("gateway commands", () => {
  it("detects explicit and natural Alive status requests", () => {
    expect(isAliveQuery("/alive")).toBe(true);
    expect(isAliveQuery("What did Alive notice recently?")).toBe(true);
    expect(isAliveQuery("hello there")).toBe(false);
  });

  it("renders recent Alive events without sending the question to the model", () => {
    const response = renderAliveStatus({
      pendingActions: [{ kind: "wake", reason: "Significant file_changed event", eventId: "event_1" }],
      events: [
        {
          id: "event_1",
          type: "file_changed",
          source: "workspace-watcher",
          timestamp: 100,
          significance: 0.9,
          payload: { path: "src/core/agent.ts" },
          requiresHuman: false,
        },
      ],
      predictions: [],
      openLoops: [],
    });

    expect(response).toContain("NTOX Alive");
    expect(response).toContain("Pending wake actions");
    expect(response).toContain("file_changed");
    expect(response).toContain("src/core/agent.ts");
  });
});
