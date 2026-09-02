import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { Tool, JobApplication, JobStatus } from "../types/index.js";

const TRACKER_PATH = join(NTOX_DIR, "job-applications.json");

interface TrackerStore {
  applications: JobApplication[];
  nextId: number;
}

function loadStore(): TrackerStore {
  if (!existsSync(TRACKER_PATH)) {
    const fresh: TrackerStore = { applications: [], nextId: 1 };
    saveStore(fresh);
    return fresh;
  }
  try {
    return JSON.parse(readFileSync(TRACKER_PATH, "utf-8"));
  } catch {
    const fresh: TrackerStore = { applications: [], nextId: 1 };
    saveStore(fresh);
    return fresh;
  }
}

function saveStore(store: TrackerStore): void {
  if (!existsSync(NTOX_DIR)) mkdirSync(NTOX_DIR, { recursive: true });
  writeFileSync(TRACKER_PATH, JSON.stringify(store, null, 2));
}

function pruneStore(store: TrackerStore): void {
  if (store.applications.length <= 500) return;
  const toRemove = store.applications
    .filter((a) => a.status === "withdrawn" || a.status === "rejected")
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const remove = toRemove.slice(0, store.applications.length - 450);
  const ids = new Set(remove.map((a) => a.id));
  store.applications = store.applications.filter((a) => !ids.has(a.id));
}

function formatApp(app: JobApplication): string {
  const status = `[${app.status.toUpperCase()}]`;
  const score = app.matchScore !== undefined ? ` (${app.matchScore}/100)` : "";
  const loc = app.location ? ` — ${app.location}` : "";
  const remote = app.remote ? " (remote)" : "";
  const salary = app.salary ? ` — ${app.salary}` : "";
  return `${status} ${app.title} at ${app.company}${score}${loc}${remote}${salary}\n  ${app.url}`;
}

export const jobTrackerTool: Tool = {
  name: "job_tracker",
  description:
    "Track job applications. Add, update, list, search, and manage job application records with status tracking and follow-up reminders.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "get", "update", "list", "search", "stats", "followups", "notes"],
        description: "Action to perform",
      },
      id: { type: "string", description: "Application ID (for get/update/notes)" },
      title: { type: "string", description: "Job title (for add)" },
      company: { type: "string", description: "Company name (for add)" },
      url: { type: "string", description: "Job listing URL" },
      source: {
        type: "string",
        enum: ["linkedin", "indeed", "glassdoor", "google", "wellfound", "other"],
        description: "Where the listing was found",
      },
      status: {
        type: "string",
        enum: ["discovered", "evaluated", "applied", "responded", "interviewing", "offered", "rejected", "withdrawn", "ghosted"],
        description: "Application status",
      },
      salary: { type: "string", description: "Salary range" },
      location: { type: "string", description: "Job location" },
      remote: { type: "boolean", description: "Remote position?" },
      matchScore: { type: "number", description: "Match score 0-100" },
      matchReasons: { type: "string", description: "Comma-separated match reasons" },
      note: { type: "string", description: "Note text (for notes action)" },
      followUpAt: { type: "number", description: "Follow-up timestamp (for update)" },
      filter: { type: "string", description: "Status filter for list (comma-separated)" },
      query: { type: "string", description: "Search query for search action" },
    },
    required: ["action"],
  },
  async execute(args) {
    const action = String(args.action);
    const store = loadStore();

    switch (action) {
      case "add": {
        const now = Date.now();
        const app: JobApplication = {
          id: `job_${store.nextId++}`,
          title: String(args.title || ""),
          company: String(args.company || ""),
          url: String(args.url || ""),
          source: (args.source as JobApplication["source"]) || "other",
          status: (args.status as JobStatus) || "discovered",
          salary: args.salary ? String(args.salary) : undefined,
          location: args.location ? String(args.location) : undefined,
          remote: args.remote != null ? Boolean(args.remote) : undefined,
          matchScore: args.matchScore != null ? Number(args.matchScore) : undefined,
          matchReasons: args.matchReasons
            ? String(args.matchReasons).split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
          notes: [],
          createdAt: now,
          updatedAt: now,
        };
        store.applications.push(app);
        pruneStore(store);
        saveStore(store);
        return { success: true, data: app };
      }
      case "get": {
        const id = String(args.id || "");
        const app = store.applications.find((a) => a.id === id);
        if (!app) return { success: false, error: `No application found with ID ${id}` };
        return { success: true, data: app };
      }
      case "update": {
        const id = String(args.id || "");
        const app = store.applications.find((a) => a.id === id);
        if (!app) return { success: false, error: `No application found with ID ${id}` };
        if (args.status) app.status = String(args.status) as JobStatus;
        if (args.title) app.title = String(args.title);
        if (args.company) app.company = String(args.company);
        if (args.url) app.url = String(args.url);
        if (args.source) app.source = String(args.source) as JobApplication["source"];
        if (args.salary) app.salary = String(args.salary);
        if (args.location) app.location = String(args.location);
        if (args.remote != null) app.remote = Boolean(args.remote);
        if (args.matchScore != null) app.matchScore = Number(args.matchScore);
        if (args.followUpAt != null) app.followUpAt = Number(args.followUpAt);
        app.updatedAt = Date.now();
        saveStore(store);
        return { success: true, data: app };
      }
      case "list": {
        let filtered = store.applications;
        if (args.filter) {
          const statuses = String(args.filter).split(",").map((s) => s.trim().toLowerCase());
          filtered = filtered.filter((a) => statuses.includes(a.status));
        }
        filtered = filtered.sort((a, b) => b.updatedAt - a.updatedAt);
        const summary = filtered.map(formatApp).join("\n\n");
        return { success: true, data: { count: filtered.length, applications: filtered, summary } };
      }
      case "search": {
        const query = String(args.query || "").toLowerCase();
        if (!query) return { success: false, error: "Search requires a query parameter" };
        const results = store.applications.filter(
          (a) =>
            a.title.toLowerCase().includes(query) ||
            a.company.toLowerCase().includes(query) ||
            a.url.toLowerCase().includes(query) ||
            a.notes.some((n) => n.toLowerCase().includes(query)),
        );
        const summary = results.map(formatApp).join("\n\n");
        return { success: true, data: { count: results.length, applications: results, summary } };
      }
      case "stats": {
        const total = store.applications.length;
        const byStatus: Record<string, number> = {};
        let totalScore = 0;
        let scoredCount = 0;
        let pendingFollowups = 0;
        const now = Date.now();
        for (const a of store.applications) {
          byStatus[a.status] = (byStatus[a.status] || 0) + 1;
          if (a.matchScore != null) { totalScore += a.matchScore; scoredCount++; }
          if (a.followUpAt && a.followUpAt <= now && (a.status === "applied" || a.status === "responded")) {
            pendingFollowups++;
          }
        }
        const avgScore = scoredCount > 0 ? Math.round(totalScore / scoredCount) : 0;
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const thisWeek = store.applications.filter((a) => a.createdAt >= weekAgo).length;
        const interviewCount = byStatus["interviewing"] || 0;
        const offerCount = byStatus["offered"] || 0;
        return {
          success: true,
          data: {
            total,
            byStatus,
            avgMatchScore: avgScore,
            thisWeek,
            interviewing: interviewCount,
            offered: offerCount,
            pendingFollowups,
          },
        };
      }
      case "followups": {
        const now = Date.now();
        const overdue = store.applications.filter(
          (a) =>
            a.followUpAt && a.followUpAt <= now && (a.status === "applied" || a.status === "responded"),
        );
        const summary =
          overdue.length === 0
            ? "No follow-ups pending."
            : overdue.map(formatApp).join("\n\n");
        return { success: true, data: { count: overdue.length, applications: overdue, summary } };
      }
      case "notes": {
        const id = String(args.id || "");
        const note = String(args.note || "");
        if (!note) return { success: false, error: "Notes action requires a note parameter" };
        const app = store.applications.find((a) => a.id === id);
        if (!app) return { success: false, error: `No application found with ID ${id}` };
        const stamp = new Date().toISOString();
        app.notes.push(`[${stamp}] ${note}`);
        app.updatedAt = Date.now();
        saveStore(store);
        return { success: true, data: app };
      }
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};
