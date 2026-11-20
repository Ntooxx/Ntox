import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IdentityStore } from "./identity.js";
import { JsonFileOwnershipStore, OwnershipGate, type OwnershipCandidate } from "./ownership.js";

function tempIdentity(): IdentityStore {
  return new IdentityStore({ path: join(mkdtempSync(join(tmpdir(), "ntox-own-")), "identity.json") });
}

function candidate(overrides: Partial<OwnershipCandidate> = {}): OwnershipCandidate {
  return {
    topic: "testing",
    stance: "prefer property tests",
    confidence: 0.6,
    evidence: ["correction:1"],
    source: "correction",
    ...overrides,
  };
}

describe("OwnershipGate", () => {
  it("declines with evidence present and a strong conflicting position", () => {
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer unit tests", 0.8);
    const gate = new OwnershipGate({
      store: new JsonFileOwnershipStore(join(mkdtempSync(join(tmpdir(), "ntox-own-")), "ownership.json")),
    });

    expect(gate.decide(candidate(), identity)).toBe("decline");
    expect(gate.getState().costlyRefusals).toBe(1);
    expect(gate.getState().integrity).toBeGreaterThan(0.2);
    expect(gate.getState().permeability).toBeLessThan(0.5);
  });

  it("defers with no evidence instead of counting a refusal", () => {
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer unit tests", 0.8);
    const gate = new OwnershipGate({
      store: new JsonFileOwnershipStore(join(mkdtempSync(join(tmpdir(), "ntox-own-")), "ownership.json")),
    });

    expect(gate.decide(candidate({ evidence: [] }), identity)).toBe("defer");
    expect(gate.getState().costlyRefusals).toBe(0);
    expect(gate.getState().declined).toBe(0);
  });

  it("accepts a non-conflicting candidate with evidence", () => {
    const identity = tempIdentity();
    const gate = new OwnershipGate({
      store: new JsonFileOwnershipStore(join(mkdtempSync(join(tmpdir(), "ntox-own-")), "ownership.json")),
    });

    expect(gate.decide(candidate(), identity)).toBe("accept");
    expect(gate.getState().accepted).toBe(1);
  });

  it("harden raises integrity and lowers permeability; soften reverses it", () => {
    const gate = new OwnershipGate({
      store: new JsonFileOwnershipStore(join(mkdtempSync(join(tmpdir(), "ntox-own-")), "ownership.json")),
    });
    const before = gate.getState();
    const hardened = gate.harden(0.1);
    expect(hardened.integrity).toBeCloseTo(before.integrity + 0.1);
    expect(hardened.permeability).toBeCloseTo(before.permeability - 0.1);
    const softened = gate.soften(0.1);
    expect(softened.integrity).toBeCloseTo(before.integrity);
    expect(softened.permeability).toBeCloseTo(before.permeability);
  });

  it("survives a reload from the same path", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ntox-own-")), "ownership.json");
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer unit tests", 0.8);
    const first = new OwnershipGate({ store: new JsonFileOwnershipStore(path) });
    first.decide(candidate(), identity);

    const reloaded = new OwnershipGate({ store: new JsonFileOwnershipStore(path) });
    expect(reloaded.getState().costlyRefusals).toBe(1);
    expect(reloaded.getState().declined).toBe(1);
  });
});
