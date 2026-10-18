import type { Agent } from "../core/agent.js";
import type { AgentTurnTrace, CognitivePattern, DurableMemory, MemoryStats } from "../types/index.js";
import type { MemoryStore } from "../memory/episodic.js";
import { approvalStore, SCOPE_TO_DECISION, type ApprovalScope } from "../tools/approval.js";
import { getStructuredFileChanges, type StructuredFileChange } from "../tools/change-tracker.js";
import {
  confirmTheory,
  disconfirmTheory,
  getTheoryHierarchy,
  getTheoryStats,
  loadTheoryStore,
} from "../research/theory-store.js";

export type { ApprovalScope };

export interface WhySummary {
  responseMode?: string;
  strategy?: string;
  skill?: { name: string; confidence: number };
  theoryReason?: string;
  cognitiveSummary?: string;
  memoryRecallCount: number;
  searchUsed: boolean;
  droppedContextSections?: string[];
  contextBudget?: AgentTurnTrace["contextBudget"];
  retries: number;
  error?: string;
  blockedReason?: string;
  durationMs?: number;
}

export interface MemoryView {
  stats: MemoryStats;
  durable: DurableMemory[];
}

export interface BeliefTheory {
  id: string;
  name: string;
  explanation: string;
  confidence: number;
  confirmed: boolean;
  timestamp: number;
  evidenceCount: number;
  recentEvidence: { signal: string; source: string; summary: string; timestamp: number }[];
}

export interface BeliefPattern {
  id: string;
  name: string;
  domains: string[];
  strength: number;
  hitCount: number;
  compileCount: number;
  compiled: boolean;
}

export interface BeliefsView {
  stats: ReturnType<typeof getTheoryStats>;
  theories: BeliefTheory[];
  patterns: BeliefPattern[];
}

export interface WebInspectServices {
  getTrace(sessionId: string): AgentTurnTrace | null;
  getWhy(sessionId: string): WhySummary | null;
  getChanges(sessionId: string): StructuredFileChange[];
  getMemory(sessionId: string): MemoryView;
  updateMemory(sessionId: string, id: string, text: string): DurableMemory | null;
  deleteMemory(sessionId: string, id: string): boolean;
  getBeliefs(sessionId: string): BeliefsView;
  voteTheory(theoryId: string, vote: "confirm" | "reject"): void;
  approveCommand(command: string, scope: ApprovalScope): boolean;
  rollback(checkpointId: string): Promise<{ success: boolean; error?: string; data?: unknown }>;
}

export function extractApprovalCommand(error: string): string | null {
  const match = error.match(/Command "(.+)" requires approval/);
  return match ? match[1] : null;
}

export function isApprovalRequired(error: string | undefined): boolean {
  return typeof error === "string" && error.includes("APPROVAL_REQUIRED");
}

function toWhy(trace: AgentTurnTrace | null): WhySummary | null {
  if (!trace) return null;
  return {
    responseMode: trace.responseMode,
    strategy: trace.strategy,
    skill: trace.skill,
    theoryReason: trace.theoryReason,
    cognitiveSummary: trace.cognitiveSummary,
    memoryRecallCount: trace.memoryRecallCount,
    searchUsed: trace.searchUsed,
    droppedContextSections: trace.droppedContextSections,
    contextBudget: trace.contextBudget,
    retries: trace.retries,
    error: trace.error,
    blockedReason: trace.blockedReason,
    durationMs: trace.completedAt ? trace.completedAt - trace.startedAt : undefined,
  };
}

export function createInspectServices(deps: {
  getAgent: (sessionId: string) => Agent | undefined;
  getMemory: (sessionId: string) => MemoryStore;
  getPatterns: (sessionId: string) => CognitivePattern[];
  rollbackTool?: {
    execute: (args: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
}): WebInspectServices {
  loadTheoryStore();

  return {
    getTrace(sessionId) {
      return deps.getAgent(sessionId)?.getLastTrace() ?? null;
    },

    getWhy(sessionId) {
      return toWhy(deps.getAgent(sessionId)?.getLastTrace() ?? null);
    },

    getChanges(sessionId) {
      const trace = deps.getAgent(sessionId)?.getLastTrace();
      if (!trace) return [];
      return getStructuredFileChanges(trace.startedAt);
    },

    getMemory(sessionId) {
      const store = deps.getMemory(sessionId);
      return { stats: store.getStats(), durable: store.listDurableMemories() };
    },

    updateMemory(sessionId, id, text) {
      return deps.getMemory(sessionId).updateDurableMemory(id, text, "web edit");
    },

    deleteMemory(sessionId, id) {
      return deps.getMemory(sessionId).deleteDurableMemory(id);
    },

    getBeliefs(sessionId) {
      loadTheoryStore();
      const hierarchy = getTheoryHierarchy();
      const stats = getTheoryStats();
      const theories: BeliefTheory[] = hierarchy.theories
        .slice()
        .sort((a, b) => b.confidence - a.confidence)
        .map((t) => ({
          id: t.id,
          name: t.name,
          explanation: t.explanation,
          confidence: t.confidence,
          confirmed: t.confirmed,
          timestamp: t.timestamp,
          evidenceCount: (t.evidence || []).length,
          recentEvidence: (t.evidence || [])
            .slice(-5)
            .map((e) => ({ signal: e.signal, source: e.source, summary: e.summary, timestamp: e.timestamp })),
        }));
      const patterns: BeliefPattern[] = deps
        .getPatterns(sessionId)
        .slice()
        .sort((a, b) => b.strength - a.strength)
        .map((p) => ({
          id: p.id,
          name: p.name,
          domains: p.domains,
          strength: p.strength,
          hitCount: p.hitCount,
          compileCount: p.compileCount,
          compiled: Boolean(p.compiledTemplate),
        }));
      return { stats, theories, patterns };
    },

    voteTheory(theoryId, vote) {
      loadTheoryStore();
      if (vote === "confirm") confirmTheory(theoryId);
      else disconfirmTheory(theoryId);
    },

    approveCommand(command, scope) {
      if (!command) return false;
      approvalStore.store("shell", `shell:${command}`, SCOPE_TO_DECISION[scope]);
      return true;
    },

    async rollback(checkpointId) {
      if (!deps.rollbackTool) return { success: false, error: "Rollback unavailable" };
      if (!checkpointId) return { success: false, error: "checkpointId required" };
      const result = await deps.rollbackTool.execute({ action: "rollback", checkpointId });
      return { success: result.success, error: result.error, data: result.data };
    },
  };
}
