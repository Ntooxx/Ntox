import { describe, expect, it } from "vitest";
import { getCommandGroups, getSlashCommandNames, normalizeCommandName } from "./commands.js";

describe("command catalog", () => {
  it("normalizes aliases", () => {
    expect(normalizeCommandName("ask")).toBe("help");
    expect(normalizeCommandName("quit")).toBe("exit");
    expect(normalizeCommandName("new")).toBe("clear");
  });

  it("generates grouped help entries", () => {
    const groups = getCommandGroups();
    expect(groups.some((group) => group.title === "daily flow")).toBe(true);
    expect(groups.some((group) => group.title === "recovery")).toBe(true);
    expect(groups.flatMap((group) => group.items).some(([cmd]) => cmd === "/ui")).toBe(true);
    expect(groups.flatMap((group) => group.items).some(([cmd]) => cmd === "/status")).toBe(true);
    expect(groups.flatMap((group) => group.items).some(([cmd]) => cmd === "/doctor")).toBe(true);
    expect(groups.flatMap((group) => group.items).some(([cmd]) => cmd === "/retry")).toBe(true);
    expect(groups.flatMap((group) => group.items).some(([cmd]) => cmd === "/last")).toBe(true);
    expect(groups.flatMap((group) => group.items).some(([cmd]) => cmd === "/tips")).toBe(true);
    expect(groups.flatMap((group) => group.items).some(([cmd]) => cmd === "@https://url")).toBe(true);
  });

  it("lists slash command names and aliases once", () => {
    const names = getSlashCommandNames();
    expect(names).toContain("ui");
    expect(names).toContain("status");
    expect(names).toContain("doctor");
    expect(names).toContain("last");
    expect(names).toContain("tips");
    expect(names).toContain("undo");
    expect(names).toContain("retry");
    expect(names).toContain("quit");
    expect(new Set(names).size).toBe(names.length);
  });
});
