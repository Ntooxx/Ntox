import { describe, expect, it, beforeEach } from "vitest";
import { clearFileChanges, getFileChangesSince, recordFileChange, renderFileChanges } from "./change-tracker.js";

describe("change tracker", () => {
  beforeEach(() => clearFileChanges());

  it("records and renders file changes", () => {
    const start = Date.now() - 1;
    recordFileChange({
      path: `${process.cwd()}\\example.txt`,
      action: "edit",
      before: "a\nold\nc",
      after: "a\nnew\nc",
    });

    const changes = getFileChangesSince(start);
    expect(changes).toHaveLength(1);
    const rendered = renderFileChanges(changes);
    expect(rendered).toContain("action: edit");
    expect(rendered).toContain("-old");
    expect(rendered).toContain("+new");
  });

  it("prints a useful empty state", () => {
    expect(renderFileChanges([])).toContain("No file changes");
  });
});
