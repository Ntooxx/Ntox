import { describe, expect, it } from "vitest";
import {
  isAliveQuery,
  parseApproveCommand,
  recordDirectGatewayResponse,
  renderAliveStatus,
  renderApprovalOutcome,
  renderApprovalRequest,
  resolveApproval,
} from "./commands.js";

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

  it("records direct command replies into the conversation transcript", () => {
    const messages: { role: "user" | "assistant"; content: string }[] = [];

    recordDirectGatewayResponse(
      { addMessage: (message) => messages.push(message) },
      "/alive",
      "NTOX Alive\n\nNo events.",
    );

    expect(messages).toEqual([
      { role: "user", content: "/alive" },
      { role: "assistant", content: "NTOX Alive\n\nNo events." },
    ]);
  });
});

describe("parseApproveCommand", () => {
  it("ignores messages that are not approve commands", () => {
    expect(parseApproveCommand("approve this later").kind).toBe("not-approve");
    expect(parseApproveCommand("/approver once rm x").kind).toBe("not-approve");
  });

  it("parses scope and a multi-word command", () => {
    const parsed = parseApproveCommand("/approve always git push origin main");
    expect(parsed).toEqual({ kind: "approve", scope: "always", command: "git push origin main" });
  });

  it("parses a bare scope as a pending-command approval", () => {
    expect(parseApproveCommand("/approve once")).toEqual({ kind: "approve", scope: "once", command: null });
  });

  it("rejects missing or unknown scopes with a usage message", () => {
    const empty = parseApproveCommand("/approve");
    expect(empty.kind).toBe("invalid");

    const badScope = parseApproveCommand("/approve maybe git push");
    expect(badScope.kind).toBe("invalid");
    if (badScope.kind === "invalid") expect(badScope.message).toContain("/approve <once|session|always|deny>");
  });
});

describe("resolveApproval", () => {
  const pending = { command: "git push origin main", prompt: "push my branch" };

  it("stores a decision and retries the original prompt when the pending command matches", () => {
    const outcome = resolveApproval("once", null, pending);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision).toBe("allow-once");
      expect(outcome.command).toBe("git push origin main");
      expect(outcome.retryPrompt).toBe("push my branch");
    }
  });

  it("does not retry after a denial", () => {
    const outcome = resolveApproval("deny", pending.command, pending);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision).toBe("deny");
      expect(outcome.retryPrompt).toBeNull();
    }
  });

  it("records an approval without retrying when the command is unrelated to the pending one", () => {
    const outcome = resolveApproval("always", "npm publish", pending);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision).toBe("allow-always");
      expect(outcome.command).toBe("npm publish");
      expect(outcome.retryPrompt).toBeNull();
    }
  });

  it("fails when there is no command and nothing pending", () => {
    const outcome = resolveApproval("once", null);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("Nothing waiting for approval");
  });
});

describe("approval messages", () => {
  it("renders a push request that tells the user the exact reply", () => {
    const message = renderApprovalRequest("rm -rf dist");
    expect(message).toContain("Approval required: rm -rf dist");
    expect(message).toContain("/approve once rm -rf dist");
    expect(message).toContain("once | session | always | deny");
  });

  it("renders outcomes for approve and deny", () => {
    const approved = resolveApproval("session", "git push", { command: "git push", prompt: "push" });
    const denied = resolveApproval("deny", "git push");
    expect(approved.ok && renderApprovalOutcome(approved)).toBe("Approved (session): git push");
    expect(denied.ok && renderApprovalOutcome(denied)).toBe("Denied: git push");
  });
});
