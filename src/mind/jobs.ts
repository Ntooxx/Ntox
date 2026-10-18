import type { NtoxAliveBridge } from "../alive/ntox.js";
import type { EvalSession } from "../evaluation/runner.js";
import type { Executive } from "../meta/executive.js";
import type { Reflector } from "../meta/reflector.js";
import type { MemoryStore } from "../memory/episodic.js";
import type { Mind } from "./mind.js";
import type { IdleJob, IdleJobContext } from "./idle.js";
import { runSelfPlay } from "./self-play.js";
import { estimateTokens } from "./util.js";

export interface IdleJobsDeps {
  mind: Mind;
  memory?: MemoryStore;
  alive?: NtoxAliveBridge;
  executive?: Executive;
  reflector?: Reflector;
  createSelfPlaySession?: () => EvalSession;
  pushProposal?: (proposal: string) => void;
  selfPlayCursor?: () => number;
  selfPlayCapPerDay?: number;
}

const MIN_TOKEN_LEN = 4;

function significantTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= MIN_TOKEN_LEN),
    ),
  ];
}

export function createIdleJobs(deps: IdleJobsDeps): IdleJob[] {
  const reflectedTurnIds = new Set<string>();
  let selfPlayDay = "";
  let selfPlayToday = 0;

  const resolveJob: IdleJob = {
    name: "resolve",
    priority: 90,
    run: (ctx: IdleJobContext) => {
      if (!deps.alive) return null;
      const state = deps.alive.engine.getState();
      const loops = state.openLoops.filter((l) => l.status === "waiting_evidence" || l.status === "active");
      if (loops.length === 0) return null;
      const recentEvents = state.events.filter((e) => e.timestamp >= ctx.since).slice(-50);
      if (recentEvents.length === 0) return null;
      const resolved: string[] = [];
      for (const loop of loops) {
        const goalTokens = significantTokens(loop.goal);
        if (goalTokens.length === 0) continue;
        for (const event of recentEvents) {
          if (event.timestamp < loop.createdAt) continue;
          const haystack = `${event.type} ${JSON.stringify(event.payload)}`.toLowerCase();
          const overlap = goalTokens.filter((token) => haystack.includes(token)).length;
          if (overlap >= 2) {
            deps.alive!.engine.completeOpenLoop(
              loop.id,
              `${event.type}: ${JSON.stringify(event.payload).slice(0, 200)}`,
            );
            resolved.push(loop.goal.slice(0, 60));
            break;
          }
        }
      }
      if (resolved.length === 0) return null;
      return { summary: `resolved ${resolved.length} open loop(s): ${resolved.join("; ")}`, tokens: 0 };
    },
  };

  const consolidateJob: IdleJob = {
    name: "consolidate",
    priority: 80,
    run: () => {
      if (!deps.memory) return null;
      const dupes = deps.memory.consolidateDurable();
      const report = deps.memory.consolidateEpisodes();
      const parts: string[] = [];
      if (dupes > 0) parts.push(`${dupes} duplicates merged`);
      if (report.created > 0) parts.push(`${report.created} facts created`);
      if (report.merged > 0) parts.push(`${report.merged} clustered`);
      if (report.challenged > 0) parts.push(`${report.challenged} challenged`);
      if (parts.length === 0) return null;
      return { summary: `consolidated: ${parts.join(", ")}`, tokens: 0 };
    },
  };

  const reflectJob: IdleJob = {
    name: "reflect-surprise",
    priority: 70,
    run: async (ctx: IdleJobContext) => {
      if (!deps.reflector) return null;
      const rows = deps.mind.ledger
        .all()
        .filter(
          (r) =>
            (r.predictionError ?? 0) > 0.6 &&
            r.timestamp >= ctx.since &&
            typeof r.queryPreview === "string" &&
            r.queryPreview.length > 0 &&
            !reflectedTurnIds.has(r.turnId),
        )
        .sort((a, b) => (b.predictionError ?? 0) - (a.predictionError ?? 0))
        .slice(0, 2);
      if (rows.length === 0) return null;

      const improvements: string[] = [];
      let tokens = 0;
      for (const row of rows) {
        reflectedTurnIds.add(row.turnId);
        try {
          const reflection = await deps.reflector!.reflect(
            row.queryPreview!,
            `[SURPRISE REVIEW] Prediction error was ${(row.predictionError ?? 0).toFixed(2)}. Signals: ${JSON.stringify(row.signals)}.`,
          );
          if (reflection?.improvement) {
            improvements.push(reflection.improvement.slice(0, 200));
            tokens += estimateTokens(reflection.improvement) + 150;
          }
        } catch {
          continue;
        }
        if (ctx.expired()) break;
      }
      if (improvements.length === 0) return null;
      return {
        summary: `surprise reflection on ${rows.length} turn(s): ${improvements[0]}`,
        tokens,
      };
    },
  };

  const prepareJob: IdleJob = {
    name: "prepare",
    priority: 60,
    run: () => {
      if (!deps.alive) return null;
      const parts: string[] = [];
      try {
        const goals = deps.executive?.buildContext() ?? "";
        if (goals.trim()) parts.push(goals.trim().replace(/\s+/g, " ").slice(0, 400));
      } catch {
        /* executive unavailable */
      }
      try {
        const tasks = (deps.memory?.listDurableMemories("task") ?? [])
          .filter((m) => m.confidence >= 0.5)
          .slice(0, 3)
          .map((m) => m.text.slice(0, 120));
        if (tasks.length > 0) parts.push(`Active tasks: ${tasks.join("; ")}`);
      } catch {
        /* memory unavailable */
      }
      if (parts.length === 0) return null;
      const brief = parts.join(" | ");

      const state = deps.alive!.engine.getState();
      const lastPrepared = [...state.events].reverse().find((e) => e.type === "context_prepared");
      if (lastPrepared && lastPrepared.payload.nextStep === brief) return null;

      deps.alive!.recordEvent({
        type: "context_prepared",
        source: "ntox-idle",
        payload: { nextStep: brief },
        significance: 0.8,
      });
      return { summary: `prepared context: ${brief.slice(0, 120)}`, tokens: 0 };
    },
  };

  const selfPlayJob: IdleJob = {
    name: "self-play",
    priority: 50,
    run: async (ctx: IdleJobContext) => {
      if (!deps.createSelfPlaySession) return null;
      const day = new Date(ctx.now()).toISOString().slice(0, 10);
      if (selfPlayDay !== day) {
        selfPlayDay = day;
        selfPlayToday = 0;
      }
      const cap = deps.selfPlayCapPerDay ?? 2;
      if (selfPlayToday >= cap) return null;
      selfPlayToday += 1;
      const cursor = deps.selfPlayCursor?.() ?? 0;
      const result = await runSelfPlay(
        { createSession: deps.createSelfPlaySession, mind: deps.mind },
        { taskIndex: cursor, charge: (tokens, usd) => ctx.charge(tokens, usd) },
      );
      if (!result) return null;
      return { summary: result.summary, tokens: result.tokens };
    },
  };

  const proposeJob: IdleJob = {
    name: "propose",
    priority: 40,
    run: () => {
      if (!deps.pushProposal) return null;
      let proposal: string | null = null;

      if (deps.alive) {
        const staleLoop = deps.alive.engine
          .getState()
          .openLoops.filter((l) => l.status === "waiting_evidence")
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (staleLoop) {
          proposal = `Open question worth resolving: "${staleLoop.goal}" — next step: ${staleLoop.nextEvidence ?? "gather evidence"}`;
        }
      }

      if (!proposal) {
        const weak = deps.mind.capability
          .stats()
          .domains.filter((d) => d.count >= 5 && d.confidence < 0.4)
          .sort((a, b) => a.confidence - b.confidence)[0];
        if (weak) {
          proposal = `Suggestion: ${weak.domain} confidence is low (${Math.round(weak.confidence * 100)}%) — a short idle self-play round on that domain could raise it.`;
        }
      }

      if (!proposal) return null;
      deps.pushProposal(proposal);
      return { summary: `proposal queued: ${proposal.slice(0, 100)}`, tokens: 0 };
    },
  };

  return [resolveJob, consolidateJob, reflectJob, prepareJob, selfPlayJob, proposeJob];
}
