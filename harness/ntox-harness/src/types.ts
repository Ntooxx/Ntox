import type { CognitiveCorrection } from "../../../dist/cognition/index.js";

export interface HarnessCheck {
  target: string;
  type: string;
  passed: boolean;
  detail: string;
}

export interface PreStepInput {
  sessionId: string;
  userMessage: string;
  turnId?: string;
  embedding?: number[] | null;
  embeddingModel?: string;
}

export interface ToolResultInput {
  sessionId: string;
  toolName: string;
  success: boolean;
  turnId?: string;
  error?: string;
  durationMs?: number;
}

export interface TurnToolCall {
  name: string;
  success: boolean;
  args?: unknown;
}

export interface TurnEndInput {
  sessionId: string;
  turnId: string;
  userMessage: string;
  assistantResponse: string;
  toolCalls?: TurnToolCall[];
  wasCorrection?: boolean;
  falseSuccess?: boolean;
  correction?: CognitiveCorrection;
}

export interface NtoxHarnessConfig {
  enableProceduralMemory?: boolean;
  workspaceRoot?: string;
  maxCandidateSteps?: number;
}

export interface VerificationRequest {
  procedureId: string;
  taskId: string;
  envFingerprint: string;
  checks: HarnessCheck[];
}

export interface VerificationResult {
  ok: boolean;
  state?: string;
  reason?: string;
  signature?: string;
}
