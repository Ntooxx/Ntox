import type { StrategyVariant } from "./bandit.js";

export type ContextKind =
  "memory" | "durable" | "correction" | "pattern" | "theory" | "skill" | "recovery" | "identity";

export interface ContextItem {
  kind: ContextKind;
  id: string;
  tokens: number;
  relevance?: number;
  reliability?: number;
}

export interface ToolCallRecord {
  name: string;
  success: boolean;
  durationMs?: number;
  argsHash?: string;
}

export interface TurnSignals {
  corrected: boolean;
  rephrased: boolean;
  thanked: boolean;
  abandoned: boolean;
  falseSuccess: boolean;
  toolFailure: boolean;
  objectiveScore?: number;
}

export interface Prediction {
  intent: string;
  answerShape: string;
  expectedTools: string[];
  expectedOutcome: string;
  confidence: number;
}

export interface PredictionResult {
  prediction: Prediction;
  outcome: number;
  error: number;
  brier: number;
}

export interface OutcomeRow {
  turnId: string;
  sessionId: string;
  timestamp: number;
  seq: number;
  queryType: string;
  queryPreview?: string;
  responseMode: string;
  strategy: string;
  strategyVariant?: string;
  context: ContextItem[];
  tools: ToolCallRecord[];
  prediction?: Prediction;
  predictionError?: number;
  signals: TurnSignals;
  score: number;
  tokens: number;
  costUsd: number;
  latencyMs: number;
  retries: number;
  banditReward?: number;
  droppedSections?: string[];
  predictionSource?: string;
  predictionTokens?: number;
}

export interface MindTurnHandle {
  row: OutcomeRow;
  prediction: Prediction;
  strategyVariant: StrategyVariant;
  disabledKind: ContextKind | null;
  domains: string[];
}

export interface MindFinishMeta {
  costUsd?: number;
  tokens?: number;
  latencyMs?: number;
  retries?: number;
  droppedSections?: string[];
  predictionSource?: string;
  predictionTokens?: number;
  correction?: {
    topicKey: string;
    correction: string;
  };
}
