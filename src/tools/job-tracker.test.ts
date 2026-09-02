import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import type { JobApplication } from "../types/index.js";

describe("job-tracker", () => {
  let tool: typeof import("./job-tracker.js").jobTrackerTool;

  beforeEach(async () => {
    const mod = await import("./job-tracker.js");
    tool = mod.jobTrackerTool;
  });

  afterEach(() => {
    const path = join(process.env.NTOX_DIR || "", "job-applications.json");
    if (existsSync(path)) unlinkSync(path);
  });

  function asApp(d: unknown): JobApplication {
    return d as JobApplication;
  }

  it("adds an application", async () => {
    const result = await tool.execute({
      action: "add",
      title: "Senior Developer",
      company: "Acme Corp",
      url: "https://linkedin.com/jobs/123",
      source: "linkedin",
    });
    expect(result.success).toBe(true);
    const app = asApp(result.data);
    expect(app.title).toBe("Senior Developer");
    expect(app.company).toBe("Acme Corp");
    expect(app.status).toBe("discovered");
    expect(app.id).toMatch(/^job_\d+$/);
  });

  it("gets an application by ID", async () => {
    const added = await tool.execute({
      action: "add",
      title: "Backend Engineer",
      company: "TechCo",
      url: "https://indeed.com/jobs/456",
      source: "indeed",
    });
    const result = await tool.execute({ action: "get", id: asApp(added.data).id });
    expect(result.success).toBe(true);
    expect(asApp(result.data).title).toBe("Backend Engineer");
  });

  it("updates an application status", async () => {
    const added = await tool.execute({
      action: "add",
      title: "Frontend Dev",
      company: "WebCo",
      url: "https://wellfound.com/jobs/789",
      source: "wellfound",
    });
    const updated = await tool.execute({
      action: "update",
      id: asApp(added.data).id,
      status: "applied",
      appliedAt: Date.now(),
      followUpAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
    });
    expect(updated.success).toBe(true);
    expect(asApp(updated.data).status).toBe("applied");
  });

  it("lists applications with status filter", async () => {
    await tool.execute({
      action: "add",
      title: "Dev A",
      company: "Company A",
      url: "https://example.com/a",
      source: "other",
    });
    await tool.execute({
      action: "add",
      title: "Dev B",
      company: "Company B",
      url: "https://example.com/b",
      source: "other",
    });
    const applied = await tool.execute({
      action: "add",
      title: "Dev C",
      company: "Company C",
      url: "https://example.com/c",
      source: "linkedin",
    });
    await tool.execute({ action: "update", id: asApp(applied.data).id, status: "applied" });

    const result = await tool.execute({ action: "list", filter: "applied" });
    expect(result.success).toBe(true);
    const data = result.data as { count: number; applications: JobApplication[]; summary: string };
    expect(data.count).toBe(1);
    expect(data.applications[0].status).toBe("applied");
  });

  it("searches applications", async () => {
    await tool.execute({
      action: "add",
      title: "Rust Engineer",
      company: "Blockchain Inc",
      url: "https://example.com/rust",
      source: "other",
    });
    await tool.execute({
      action: "add",
      title: "Python Developer",
      company: "AI Labs",
      url: "https://example.com/python",
      source: "other",
    });

    const result = await tool.execute({ action: "search", query: "Rust" });
    expect(result.success).toBe(true);
    const data = result.data as { count: number; applications: JobApplication[]; summary: string };
    expect(data.count).toBe(1);
    expect(data.applications[0].title).toBe("Rust Engineer");
  });

  it("adds notes to an application", async () => {
    const added = await tool.execute({
      action: "add",
      title: "DevOps",
      company: "CloudCo",
      url: "https://example.com/devops",
      source: "other",
    });
    const noted = await tool.execute({
      action: "notes",
      id: asApp(added.data).id,
      note: "Connected with hiring manager on LinkedIn",
    });
    expect(noted.success).toBe(true);
    const app = asApp(noted.data);
    expect(app.notes.length).toBe(1);
    expect(app.notes[0]).toContain("hiring manager");
  });

  it("returns stats", async () => {
    const a = await tool.execute({
      action: "add",
      title: "Job A",
      company: "A Inc",
      url: "https://a.com",
      source: "linkedin",
      matchScore: 85,
    });
    await tool.execute({ action: "update", id: asApp(a.data).id, status: "applied" });

    const b = await tool.execute({
      action: "add",
      title: "Job B",
      company: "B Inc",
      url: "https://b.com",
      source: "indeed",
      matchScore: 70,
    });
    await tool.execute({ action: "update", id: asApp(b.data).id, status: "interviewing" });

    const result = await tool.execute({ action: "stats" });
    expect(result.success).toBe(true);
    const data = result.data as {
      total: number; byStatus: Record<string, number>; avgMatchScore: number;
      thisWeek: number; interviewing: number; offered: number; pendingFollowups: number;
    };
    expect(data.total).toBe(2);
    expect(data.byStatus.applied).toBe(1);
    expect(data.byStatus.interviewing).toBe(1);
    expect(data.avgMatchScore).toBeGreaterThan(0);
  });

  it("finds follow-ups", async () => {
    const a = await tool.execute({
      action: "add",
      title: "Job X",
      company: "X Corp",
      url: "https://x.com",
      source: "linkedin",
    });
    const pastFollowUp = Date.now() - 1000 * 60 * 60;
    await tool.execute({
      action: "update",
      id: asApp(a.data).id,
      status: "applied",
      followUpAt: pastFollowUp,
    });

    const result = await tool.execute({ action: "followups" });
    expect(result.success).toBe(true);
    const data = result.data as { count: number; applications: JobApplication[]; summary: string };
    expect(data.count).toBe(1);
  });

  it("returns error for unknown action", async () => {
    const result = await tool.execute({ action: "nonexistent" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action");
  });
});
