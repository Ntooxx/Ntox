export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export type ShellPolicy = "disabled" | "workspace" | "approval-required";
export type NetworkPolicy = "disabled" | "fetch-only" | "browser-allowed";

export interface WorkspaceProfile {
  id: string;
  name: string;
  workspaceRoot: string;
  readRoots: string[];
  writeRoots: string[];
  allowedTools: string[];
  shellPolicy: ShellPolicy;
  networkPolicy: NetworkPolicy;
  autoCheckpoint: boolean;
}

export interface PolicyDecision {
  tool: string;
  allowed: boolean;
  reason: string;
  path?: string;
  timestamp: number;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  pricing: {
    prompt: number;
    completion: number;
  };
  context_length: number;
}

export interface CostUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface StreamChunk {
  delta: string;
  usage?: CostUsage;
  toolCalls?: ToolCall[];
}

export interface NtoxConfig {
  apiKey: string;
  model: string;
  provider: string;
  apiBaseUrl: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  embeddingModel: string;
  memoryEnabled: boolean;
  memoryRetrievalCount: number;
  metaStrategyEnabled: boolean;
  metaReflectionEnabled: boolean;
  metaMistakesEnabled: boolean;
  metaMinConfidence: number;
  cognitiveEnabled: boolean;
  theoryEnabled: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  animationLevel: "off" | "minimal" | "full";
  uiMode: "minimal" | "normal" | "debug";
  telegramToken: string;
  telegramAllowedUsers: string[];
  discordToken: string;
  discordAllowedUsers: string[];
  whatsappToken: string;
  whatsappPhoneNumberId: string;
  whatsappVerifyToken: string;
  whatsappPort: number;
  dockerEnabled: boolean;
  webPort: number;
  webHost: string;
  introEnabled: boolean;
  verboseCallbacks: boolean;
  defaultProfileId: string;
  profiles: WorkspaceProfile[];
}

export interface Episode {
  id: string;
  timestamp: number;
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
  summary: string;
  embedding: number[];
}

export interface MemoryQueryResult {
  episode: Episode;
  similarity: number;
}

export interface MemoryStats {
  totalEpisodes: number;
  totalSessions: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  memorySizeBytes: number;
}

export type MemoryLane = "fact" | "preference" | "decision" | "task" | "note";

export interface DurableMemory {
  id: string;
  lane: MemoryLane;
  text: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  source: "user" | "agent";
  provenance: string;
  lastUsedAt?: number;
  contradictionCount: number;
  history: {
    text: string;
    timestamp: number;
    reason: string;
  }[];
}

export type QueryType = "factual" | "coding" | "creative" | "analysis" | "planning" | "general";

export interface Reflection {
  confidence: number;
  addressed: boolean;
  knowledgeGaps: string[];
  improvement: string;
  timestamp: number;
}

export interface MistakeEntry {
  id: string;
  topicKey: string;
  query: string;
  wrongAnswer: string;
  correction: string;
  source: "user-correction" | "self-reflection";
  timestamp: number;
  fixed: boolean;
}

export type Verbosity = "concise" | "balanced" | "detailed";
export type TechnicalLevel = "beginner" | "intermediate" | "expert";
export type Tone = "formal" | "casual" | "adaptive";
export type Expertise = "beginner" | "intermediate" | "advanced" | "expert";
export type CommunicationStyle = "direct" | "narrative" | "visual" | "adaptive";
export type LearningStyle = "example-driven" | "conceptual" | "hands-on" | "adaptive";
export type Sentiment = "positive" | "negative" | "neutral" | "frustrated" | "excited" | "tired";
export type Energy = "low" | "medium" | "high";

export type JobStatus =
  | "discovered"
  | "evaluated"
  | "applied"
  | "responded"
  | "interviewing"
  | "offered"
  | "rejected"
  | "withdrawn"
  | "ghosted";

export interface JobApplication {
  id: string;
  title: string;
  company: string;
  url: string;
  source: "linkedin" | "indeed" | "glassdoor" | "google" | "wellfound" | "other";
  status: JobStatus;
  salary?: string;
  location?: string;
  remote?: boolean;
  matchScore?: number;
  matchReasons?: string[];
  notes: string[];
  appliedAt?: number;
  lastCheckedAt?: number;
  followUpAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileEvaluation {
  url: string;
  overallScore: number;
  sections: {
    headline: { score: number; feedback: string };
    summary: { score: number; feedback: string };
    experience: { score: number; feedback: string };
    skills: { score: number; feedback: string };
    recommendations: { score: number; feedback: string };
    activity: { score: number; feedback: string };
  };
  topIssues: string[];
  quickWins: string[];
  evaluatedAt: number;
}

export interface JobSearchQuery {
  keywords: string[];
  location?: string;
  remote?: boolean;
  sources: ("linkedin" | "indeed" | "glassdoor" | "google" | "wellfound")[];
  salaryMin?: number;
  maxResults?: number;
}

export interface UserGoal {
  id: string;
  description: string;
  category: string;
  startedAt: number;
  targetDate?: number;
  status: "active" | "paused" | "completed";
  progress: number;
}

export interface UserPreferences {
  verbosity: Verbosity;
  technicalLevel: TechnicalLevel;
  tone: Tone;
  codeExamples: "always" | "when-helpful" | "never";
}

export interface UserCommunicationPatterns {
  averageMessageLength: number;
  totalMessages: number;
  correctionsReceived: number;
  prefersCodeBlocks: boolean;
  prefersBulletPoints: boolean;
}

export interface MoodEntry {
  timestamp: number;
  sentiment: Sentiment;
  energy: Energy;
  score: number;
}

export interface PersonalTerm {
  term: string;
  meaning: string;
  firstSeen: number;
  lastUsed: number;
  count: number;
}

export interface ProjectAssociation {
  projectId: string;
  projectName: string;
  description: string;
  firstMentioned: number;
  lastMentioned: number;
  mentionCount: number;
  tags: string[];
}

export interface UserProfile {
  name: string;
  expertise: Record<string, Expertise>;
  preferences: UserPreferences;
  goals: UserGoal[];
  patterns: UserCommunicationPatterns;
  domains: string[];
  lastActive: number;
  sessionsCount: number;
  createdAt: number;

  communicationStyle: CommunicationStyle;
  learningStyle: LearningStyle;
  timezone: string;
  moodHistory: MoodEntry[];
  personalVocabulary: PersonalTerm[];
  projectAssociations: ProjectAssociation[];
  closenessScore: number;
  lastSessionEnd: number;
}

export interface SkillDefinition {
  name: string;
  description: string;
  category: string;
  prompt: string;
  triggers: string[];
  tools: string[];
  examples: string[];
  created: number;
  updated: number;
  usageCount: number;
  domain?: string;
  importance?: number;
  contentPath?: string;
  voices?: string[];
  combos?: string[];
  isExternal?: boolean;
}

export interface SkillTriggerMatch {
  skill: SkillDefinition;
  confidence: number;
}

export interface AgentToolTrace {
  name: string;
  args: Record<string, unknown>;
  success?: boolean;
  error?: string;
  reason?: string;
  durationMs?: number;
  autoCheckpointId?: string;
}

export interface ContextBudgetLedger {
  system: number;
  strategy: number;
  cognition: number;
  memory: number;
  theory: number;
  mistakes: number;
  user: number;
  narrative: number;
  mentalModel: number;
  executive: number;
  skills: number;
  search: number;
  mode: number;
  session: number;
  time: number;
  toolResults: number;
  total: number;
}

export interface AgentTurnTrace {
  startedAt: number;
  completedAt?: number;
  userInput: string;
  responseMode?: string;
  strategy?: QueryType;
  memoryRecallCount: number;
  searchUsed: boolean;
  cognitiveSummary?: string;
  skill?: { name: string; confidence: number };
  toolCalls: AgentToolTrace[];
  workspaceProfile?: { id: string; name: string; workspaceRoot: string };
  policyDecisions: PolicyDecision[];
  checkpointIds: string[];
  contextBudget?: ContextBudgetLedger;
  theoryReason?: string;
  retries: number;
  blockedReason?: string;
  error?: string;
  finalResponseLength?: number;
  fileChanges?: {
    path: string;
    action: "write" | "edit" | "rollback";
    timestamp: number;
  }[];
}

export interface PrimitiveRepresentation {
  domains: string[];
  action: string;
  complexity: number;
  conceptualSummary: string;
}

export interface CognitivePattern {
  id: string;
  name: string;
  domains: string[];
  vector: number[];
  activatedRules: string[];
  reasoningTemplate: string;
  strength: number;
  hitCount: number;
  compileCount: number;
  compiledTemplate: string;
  lastActivated: number;
  created: number;
}

export interface CritiqueResult {
  completeness: number;
  accuracy: number;
  clarity: number;
  gaps: string[];
  strengthened: boolean;
}

export type ThinkPhase = "thinking" | "analyzing" | "reasoning" | "recalling" | "responding";

export interface SoundConfig {
  enabled: boolean;
  volume: number;
}

export interface CognitiveTrace {
  problemRepresentation: string;
  assumptions: string[];
  unknowns: string[];
  reasoningStrategy: string;
  strategyJustification: string;
  evidenceUsed: string[];
  predictions: string[];
  selfCritique: string;
  critiqueResolution: string;
  finalAnswer: string;
  abstractionExtracted: string;
  tokenCount: number;
}

export interface ThinkingMetrics {
  representation: number;
  strategy: number;
  compression: number;
  adaptation: number;
  critique: number;
  abstraction: number;
  transfer: number;
  cognitiveCompilation: number;
  efficiency: number;
}
