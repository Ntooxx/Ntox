import { describe, expect, it } from "vitest";
import { ALL_ROUNDS } from "./dataset.js";
import { selectRounds } from "./rounds.js";

describe("selectRounds", () => {
  it("returns every round for an empty or all spec", () => {
    expect(selectRounds("")).toHaveLength(ALL_ROUNDS.length);
    expect(selectRounds("all")).toHaveLength(ALL_ROUNDS.length);
    expect(selectRounds("ALL").map((r) => r.name)).toEqual(ALL_ROUNDS.map((r) => r.name));
  });

  it("parses a 1-based comma separated list", () => {
    const picked = selectRounds("1, 3");
    expect(picked).toEqual([ALL_ROUNDS[0], ALL_ROUNDS[2]]);
  });

  it("deduplicates and ignores out-of-range or garbage tokens", () => {
    const picked = selectRounds("2,2,0,9,x,");
    expect(picked).toEqual([ALL_ROUNDS[1]]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(selectRounds("nope")).toEqual([]);
  });
});
