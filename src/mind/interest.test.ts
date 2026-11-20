import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AliveEngine } from "../alive/engine.js";
import { NtoxAliveBridge } from "../alive/ntox.js";
import { IdentityStore } from "./identity.js";
import { deriveInterests, InterestRegistry } from "./interest.js";

function tempIdentity(): IdentityStore {
  return new IdentityStore({ path: join(mkdtempSync(join(tmpdir(), "ntox-int-")), "identity.json") });
}

describe("deriveInterests", () => {
  it("extracts only positions with confidence >= 0.6", () => {
    const identity = tempIdentity();
    identity.addPosition("strong", "hold this", 0.8);
    identity.addPosition("weak", "maybe this", 0.4);

    const interests = deriveInterests(identity);
    expect(interests).toHaveLength(1);
    expect(interests[0]?.topic).toBe("strong");
    expect(interests[0]?.strength).toBe(0.8);
  });

  it("erases the interest once challenges push confidence under the floor", () => {
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer property tests", 0.8);
    identity.challengePosition("testing", "failed on held-out parser", 0.5);
    identity.challengePosition("testing", "failed again", 0.5);

    expect(identity.get().positions[0]?.confidence).toBeLessThan(0.6);
    expect(deriveInterests(identity)).toHaveLength(0);
  });
});

describe("InterestRegistry", () => {
  it("onChallenge hardens the boundary and emits an event after the third hit", () => {
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer property tests", 0.8);
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const hardened: string[] = [];
    const registry = new InterestRegistry({
      identity,
      alive: bridge,
      onHarden: (topic) => hardened.push(topic),
    });

    expect(registry.onChallenge("testing")?.threatCount).toBe(1);
    expect(registry.onChallenge("testing")?.threatCount).toBe(2);
    expect(registry.onChallenge("testing")?.threatCount).toBe(3);
    expect(hardened).toHaveLength(3);

    const events = bridge.engine.getState().events.filter((event) => event.type === "identity_challenged");
    expect(events).toHaveLength(3);
    expect(events[2]?.requiresHuman).toBe(true);
  });

  it("ignores challenges to topics without an interest", () => {
    const identity = tempIdentity();
    const registry = new InterestRegistry({ identity });
    expect(registry.onChallenge("unknown")).toBeNull();
  });

  it("friction removes the interest instead of feeding the loop an open loop", () => {
    const identity = tempIdentity();
    identity.addPosition("testing", "prefer property tests", 0.8);
    identity.challengePosition("testing", "correction", 0.5);
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const registry = new InterestRegistry({ identity, alive: bridge });

    expect(registry.syncOpenLoops()).toBe(0);
    expect(bridge.engine.getState().openLoops).toHaveLength(0);
  });
});
