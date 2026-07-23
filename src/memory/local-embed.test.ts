import { describe, it, expect } from "vitest";
import { localEmbed } from "../core/local-embed.js";
import { cosineSimilarity } from "./episodic.js";

describe("localEmbed", () => {
  it("returns a fixed-dimension vector", () => {
    const v = localEmbed("hello world test query here");
    expect(v.length).toBe(256);
  });

  it("is deterministic", () => {
    const a = localEmbed("install dependencies and run tests");
    const b = localEmbed("install dependencies and run tests");
    expect(a).toEqual(b);
  });

  it("is normalized (unit length)", () => {
    const v = localEmbed("some reasonably long text about programming computers");
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it("returns a zero vector for empty input", () => {
    const v = localEmbed("");
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it("produces different vectors for different texts", () => {
    const a = localEmbed("configure the database connection pool settings");
    const b = localEmbed("bake a chocolate cake with vanilla frosting");
    expect(cosineSimilarity(a, b)).toBeLessThan(0.5);
  });

  it("produces similar vectors for related texts", () => {
    const a = localEmbed("fix the authentication bug in the login handler");
    const b = localEmbed("debug the login authentication issue");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.3);
  });

  it("is case and punctuation insensitive", () => {
    const a = localEmbed("Deploy the Service to Production!");
    const b = localEmbed("deploy the service to production");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.9);
  });
});
