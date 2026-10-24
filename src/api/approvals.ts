import { setInteractiveApproval, type ApprovalDecision } from "../tools/approval.js";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  command: string;
  at: number;
}

export interface ApprovalExpiry {
  id: string;
  expired: true;
}

export type ApprovalSink = (payload: ApprovalRequest | ApprovalExpiry) => void;

interface PendingApproval {
  toolName: string;
  command: string;
  at: number;
  resolve: (decision: ApprovalDecision | null) => void;
}

export const APPROVAL_DECISIONS: ApprovalDecision[] = ["allow-once", "allow-session", "allow-always", "deny"];

export class ApprovalBridge {
  private readonly sinks = new Set<ApprovalSink>();
  private readonly pending = new Map<string, PendingApproval>();
  private sequence = 0;

  constructor(readonly timeoutMs = 180_000) {}

  install(): void {
    setInteractiveApproval((toolName, command) => this.ask(toolName, command));
  }

  subscribe(sink: ApprovalSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  list(): ApprovalRequest[] {
    return [...this.pending.entries()].map(([id, entry]) => ({
      id,
      toolName: entry.toolName,
      command: entry.command,
      at: entry.at,
    }));
  }

  async ask(toolName: string, command: string): Promise<ApprovalDecision | null> {
    if (this.sinks.size === 0) return null;
    const id = `apr_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const request: ApprovalRequest = { id, toolName, command, at: Date.now() };
    return new Promise<ApprovalDecision | null>((resolve) => {
      this.pending.set(id, { toolName, command, at: request.at, resolve });
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        resolve(null);
        this.broadcast({ id, expired: true });
      }, this.timeoutMs);
      timer.unref?.();
      this.broadcast(request);
    });
  }

  resolve(id: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    entry.resolve(decision);
    this.broadcast({ id, expired: true });
    return true;
  }

  private broadcast(payload: ApprovalRequest | ApprovalExpiry): void {
    for (const sink of [...this.sinks]) {
      try {
        sink(payload);
      } catch {
        this.sinks.delete(sink);
      }
    }
  }
}

export const approvalBridge = new ApprovalBridge();