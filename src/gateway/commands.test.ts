import { describe, expect, it } from "vitest";
import {
  isAliveQuery,
  parseApprovalCallbackData,
  parseApproveCommand,
  parseSkillInstallCommand,
  parseSkillLifecycleCommand,
  parseSkillMarketplaceCommand,
  parseSkillSaveCommand,
  recordDirectGatewayResponse,
  renderAliveStatus,
  renderApprovalOutcome,
  renderApprovalRequest,
  renderApprovalRequestInteractive,
  renderSkillSaveOutcome,
  resolveApproval,
  resolveSkillSave,
} from "./commands.js";

describe("gateway commands", () => {
  it("detects explicit and natural Alive status requests", () => {
    expect(isAliveQuery("/alive")).toBe(true);
    expect(isAliveQuery("What did Alive notice recently?")).toBe(true);
    expect(isAliveQuery("hello there")).toBe(false);
  });

  it("ignores long prompts that merely contain alive and a subject word", () => {
    const spec = [
      "# PROJECT: GENESIS — A Living GPU-Driven Procedural City",
      "Design a structured-buffer architecture separating simulation state from rendering data.",
      "The user should feel they are watching a miniature civilization, genuinely alive.",
      "Keep every system load-bearing so the city stays alive under population pressure.",
    ].join("\n");

    expect(spec.length).toBeGreaterThan(200);
    expect(isAliveQuery(spec)).toBe(false);
  });

  it("requires the Alive subject to sit close to the word alive", () => {
    expect(isAliveQuery("is the host alive and did it notice the failing tests?")).toBe(true);
    expect(isAliveQuery(`alive ${"x".repeat(120)} notice`)).toBe(false);
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

  it("renders an interactive request that points at the tap targets", () => {
    const message = renderApprovalRequestInteractive("git push origin main");
    expect(message).toContain("Approval required: git push origin main");
    expect(message).toContain("Tap a button below");
    expect(message).toContain("/approve");
  });
});

describe("approval callback data", () => {
  it("maps button payloads to approval scopes", () => {
    expect(parseApprovalCallbackData("approve:once")).toBe("once");
    expect(parseApprovalCallbackData("approve:session")).toBe("session");
    expect(parseApprovalCallbackData("approve:always")).toBe("always");
    expect(parseApprovalCallbackData("approve:deny")).toBe("deny");
  });

  it("rejects unknown or malformed payloads", () => {
    expect(parseApprovalCallbackData("approve:bogus")).toBeNull();
    expect(parseApprovalCallbackData("approve:")).toBeNull();
    expect(parseApprovalCallbackData("once")).toBeNull();
    expect(parseApprovalCallbackData("approve:session:extra")).toBeNull();
  });
});

describe("skill save command", () => {
  const pending = {
    name: "migrate-tests",
    description: "Migrate a test suite",
    category: "coding",
    prompt: "steps",
    triggers: ["migrate tests"],
    tools: ["read"],
    examples: [],
    created: 1,
    updated: 1,
    usageCount: 0,
  };

  it("recognizes save commands and captures the optional name", () => {
    expect(parseSkillSaveCommand("/skill save")).toEqual({ kind: "save", name: null });
    expect(parseSkillSaveCommand("/skill save migrate-tests")).toEqual({ kind: "save", name: "migrate-tests" });
    expect(parseSkillSaveCommand("/skill save  MIGRATE-TESTS ")).toEqual({ kind: "save", name: "migrate-tests" });
  });

  it("ignores other skill subcommands and unrelated text", () => {
    expect(parseSkillSaveCommand("/skill show migrate-tests").kind).toBe("not-skill-save");
    expect(parseSkillSaveCommand("/skill learn read pdfs").kind).toBe("not-skill-save");
    expect(parseSkillSaveCommand("save this please").kind).toBe("not-skill-save");
  });

  it("resolves a save against the pending proposal", () => {
    const saved = resolveSkillSave(null, pending);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.skill.name).toBe("migrate-tests");

    const named = resolveSkillSave("migrate-tests", pending);
    expect(named.ok).toBe(true);

    const wrongName = resolveSkillSave("other-name", pending);
    expect(wrongName.ok).toBe(false);
    if (!wrongName.ok) expect(wrongName.message).toContain("Waiting: migrate-tests");

    const none = resolveSkillSave(null, undefined);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toContain("No skill proposal waiting");
  });

  it("renders the save outcome with activation triggers", () => {
    const text = renderSkillSaveOutcome(pending);
    expect(text).toContain("Skill saved: migrate-tests");
    expect(text).toContain("migrate tests");
  });
});

describe("skill install command", () => {
  it("recognizes install commands with url, git, and file sources", () => {
    expect(parseSkillInstallCommand("/skill install https://example.com/s.json")).toEqual({
      kind: "install",
      source: "https://example.com/s.json",
      force: false,
    });
    expect(parseSkillInstallCommand("/skill install https://github.com/u/r")).toEqual({
      kind: "install",
      source: "https://github.com/u/r",
      force: false,
    });
    expect(parseSkillInstallCommand("/skill install ./my skill.json")).toEqual({
      kind: "install",
      source: "./my skill.json",
      force: false,
    });
  });

  it("extracts the --force flag wherever it appears", () => {
    expect(parseSkillInstallCommand("/skill install ./s.json --force")).toEqual({
      kind: "install",
      source: "./s.json",
      force: true,
    });
    expect(parseSkillInstallCommand("/skill install --force ./s.json")).toEqual({
      kind: "install",
      source: "./s.json",
      force: true,
    });
  });

  it("rejects a missing source with usage", () => {
    const bare = parseSkillInstallCommand("/skill install");
    expect(bare.kind).toBe("invalid");
    if (bare.kind === "invalid") expect(bare.message).toContain("/skill install <url|git|file|name>");

    const forceOnly = parseSkillInstallCommand("/skill install --force");
    expect(forceOnly.kind).toBe("invalid");
  });

  it("ignores other skill subcommands and unrelated text", () => {
    expect(parseSkillInstallCommand("/skill save migrate-tests").kind).toBe("not-skill-install");
    expect(parseSkillInstallCommand("/skill show x").kind).toBe("not-skill-install");
    expect(parseSkillInstallCommand("/skill installer foo").kind).toBe("not-skill-install");
    expect(parseSkillInstallCommand("install ./s.json").kind).toBe("not-skill-install");
  });
});

describe("skill stats/diff/export commands", () => {
  it("parses stats", () => {
    expect(parseSkillLifecycleCommand("/skill stats")).toEqual({ kind: "stats" });
    expect(parseSkillLifecycleCommand("/skill STATS")).toEqual({ kind: "stats" });
  });

  it("parses run with an optional name", () => {
    expect(parseSkillLifecycleCommand("/skill run morning-brief")).toEqual({
      kind: "run",
      name: "morning-brief",
    });
    expect(parseSkillLifecycleCommand("/skill run")).toEqual({ kind: "run", name: null });
    expect(parseSkillLifecycleCommand("/skill runner").kind).toBe("not-skill-lifecycle");
  });

  it("parses diff with an optional source", () => {
    expect(parseSkillLifecycleCommand("/skill diff weather-alerts")).toEqual({
      kind: "diff",
      name: "weather-alerts",
      source: null,
    });
    expect(parseSkillLifecycleCommand("/skill diff Weather-Alerts ./local.json -- maybe")).toEqual({
      kind: "diff",
      name: "weather-alerts",
      source: "./local.json -- maybe",
    });
    expect(parseSkillLifecycleCommand("/skill diff")).toEqual({ kind: "diff", name: null, source: null });
  });

  it("parses export with an optional name", () => {
    expect(parseSkillLifecycleCommand("/skill export my-skill")).toEqual({ kind: "export", name: "my-skill" });
    expect(parseSkillLifecycleCommand("/skill export")).toEqual({ kind: "export", name: null });
  });

  it("ignores other skill subcommands and unrelated text", () => {
    expect(parseSkillLifecycleCommand("/skill stats extra").kind).toBe("not-skill-lifecycle");
    expect(parseSkillLifecycleCommand("/skill marketplace").kind).toBe("not-skill-lifecycle");
    expect(parseSkillLifecycleCommand("/skill install x").kind).toBe("not-skill-lifecycle");
    expect(parseSkillLifecycleCommand("diff things now").kind).toBe("not-skill-lifecycle");
  });
});

describe("skill marketplace command", () => {
  it("recognizes the marketplace command with an optional query", () => {
    expect(parseSkillMarketplaceCommand("/skill marketplace")).toEqual({ kind: "marketplace", query: null });
    expect(parseSkillMarketplaceCommand("/skill marketplace weather")).toEqual({
      kind: "marketplace",
      query: "weather",
    });
    expect(parseSkillMarketplaceCommand("/skill MARKETPLACE  release notes ")).toEqual({
      kind: "marketplace",
      query: "release notes",
    });
  });

  it("ignores other skill subcommands and unrelated text", () => {
    expect(parseSkillMarketplaceCommand("/skill market").kind).toBe("not-skill-marketplace");
    expect(parseSkillMarketplaceCommand("/skill marketplaceextra").kind).toBe("not-skill-marketplace");
    expect(parseSkillMarketplaceCommand("/skill install weather-alerts").kind).toBe("not-skill-marketplace");
    expect(parseSkillMarketplaceCommand("marketplace").kind).toBe("not-skill-marketplace");
  });
});
