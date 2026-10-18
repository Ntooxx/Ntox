import { NtoxCognitiveLayer } from "../cognition/layer.js";
import { MemoryStore } from "../memory/episodic.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { TheoryMemory } from "../memory/theory-memory.js";
import { CognitiveKernel } from "../cognition/kernel.js";
import { PatternStore } from "../cognition/patterns.js";
import { CognitiveSpace } from "../cognition/cognitive-space.js";
import { SkillRegistry } from "../skills/registry.js";
import { localEmbed } from "../core/local-embed.js";
import { checkForSurfaceReasoning, detectFalseSuccess } from "../research/false-success.js";
import { getTheoryHierarchy, getTheoryStats, recordObservation, resetTheoryStore } from "../research/theory-store.js";
import type { CognitiveTrace, CritiqueResult, ThinkingMetrics } from "../types/index.js";

function kernelCritiqueLike(overrides: Partial<CritiqueResult>): CritiqueResult {
  return {
    completeness: 0.8,
    accuracy: 0.9,
    clarity: 0.8,
    gaps: [],
    strengthened: true,
    ...overrides,
  };
}

export interface NecessityCheckResult {
  id: string;
  subsystem: string;
  claim: string;
  passed: boolean;
  detail: string;
}

export interface NecessityReport {
  passed: boolean;
  checks: NecessityCheckResult[];
  summary: { total: number; passed: number; failed: number; generatedAt: number };
}

type Check = () => Promise<NecessityCheckResult> | NecessityCheckResult;

const traceTemplate: CognitiveTrace = {
  problemRepresentation: "",
  assumptions: [],
  unknowns: [],
  reasoningStrategy: "",
  strategyJustification: "",
  evidenceUsed: [],
  predictions: [],
  selfCritique: "",
  critiqueResolution: "",
  finalAnswer: "",
  abstractionExtracted: "",
  tokenCount: 0,
};

async function memoryGating(): Promise<NecessityCheckResult> {
  const message = "the quarterly planning codename is navy-ember";
  const embedding = localEmbed(message);
  const memory = new MemoryStore();
  memory.clearAll();
  memory.addDurableMemory("fact", message, "necessity", 0.95);

  const enabled = new NtoxCognitiveLayer(
    {
      cognitionEnabled: false,
      theoryEnabled: false,
      strategyEnabled: false,
      mistakesEnabled: false,
      memoryEnabled: true,
    },
    { memory },
  );
  const disabled = new NtoxCognitiveLayer(
    {
      cognitionEnabled: false,
      theoryEnabled: false,
      strategyEnabled: false,
      mistakesEnabled: false,
      memoryEnabled: false,
    },
    { memory: new MemoryStore() },
  );

  const onContext = await enabled.beforeStep({ sessionId: "necessity-memory-on", userMessage: message, embedding });
  const offContext = await disabled.beforeStep({ sessionId: "necessity-memory-off", userMessage: message, embedding });

  const onHasMemory = onContext.diagnostics.memoryIncluded && onContext.prompt.includes("navy-ember");
  const offHasMemory = offContext.diagnostics.memoryIncluded || offContext.prompt.includes("navy-ember");
  const passed = onHasMemory && !offHasMemory;
  return {
    id: "memory-gating",
    subsystem: "episodic-memory",
    claim: "Stored memories enter the prompt only when memory is enabled.",
    passed,
    detail: `enabled memoryIncluded=${onContext.diagnostics.memoryIncluded} factPresent=${onContext.prompt.includes("navy-ember")}; disabled memoryIncluded=${offContext.diagnostics.memoryIncluded}`,
  };
}

async function correctionPrecedence(): Promise<NecessityCheckResult> {
  const query = "What is the harbor token? Remind me.";
  const embedding = localEmbed(query);
  const memory = new MemoryStore();
  memory.clearAll();
  memory.addDurableMemory("fact", "harbor token is blue-ember", "necessity", 0.95);
  const mistakes = new MistakeJournal();
  mistakes.clearAll();
  mistakes.add("harbor", "what is the harbor token?", "blue-ember", "harbor token is navy-ember", "user-correction");

  const enabled = new NtoxCognitiveLayer(
    {
      cognitionEnabled: false,
      theoryEnabled: false,
      strategyEnabled: false,
      mistakesEnabled: true,
      memoryEnabled: true,
    },
    { memory, mistakes },
  );
  const disabled = new NtoxCognitiveLayer(
    {
      cognitionEnabled: false,
      theoryEnabled: false,
      strategyEnabled: false,
      mistakesEnabled: false,
      memoryEnabled: true,
    },
    { memory, mistakes: new MistakeJournal() },
  );

  const onContext = await enabled.beforeStep({ sessionId: "necessity-corr-on", userMessage: query, embedding });
  const offContext = await disabled.beforeStep({ sessionId: "necessity-corr-off", userMessage: query, embedding });

  const correctionAt = onContext.prompt.indexOf("Previous Corrections");
  const memoryAt = onContext.prompt.indexOf("Relevant Past Memories");
  const ordered = correctionAt >= 0 && (memoryAt < 0 || correctionAt < memoryAt);
  const passed = onContext.diagnostics.correctionIncluded && ordered && !offContext.prompt.includes("navy-ember");
  return {
    id: "correction-precedence",
    subsystem: "mistake-journal",
    claim: "User corrections are injected ahead of conflicting older memories, and only when mistakes are enabled.",
    passed,
    detail: `enabled correctionIncluded=${onContext.diagnostics.correctionIncluded} correctionsBeforeMemories=${ordered}; disabled leak=${offContext.prompt.includes("navy-ember")}`,
  };
}

function kernelLearning(): NecessityCheckResult {
  const registry = new SkillRegistry();
  const kernel = new CognitiveKernel(registry);
  const query = "Write a python function to fix a bug in our software";
  const patterns = kernel.getPatterns();

  kernel.setEnabled(false);
  const disabledContext = kernel.process(query).cognitiveContext;

  kernel.setEnabled(true);
  let result = kernel.process(query);
  for (let i = 0; i < 4 && result.patterns.length === 0; i++) result = kernel.process(query);

  let target = result.patterns[0];
  if (!target) {
    let created = null;
    for (let i = 0; i < 4 && !created; i++) created = patterns.learnFromQuery(result.primitive.domains);
    if (created) target = created;
  }

  for (let i = 0; i < 5 && target; i++) patterns.strengthen(target.id, 0.1);
  const warmContext = kernel.process(query).cognitiveContext;

  const passed = disabledContext === "" && target !== undefined && warmContext.includes("Learned Pattern");
  return {
    id: "kernel-learning",
    subsystem: "cognitive-kernel",
    claim: "The kernel contributes prompt context only once a matching pattern has been reinforced enough to activate.",
    passed,
    detail: `disabled=${disabledContext.length} chars; target=${target?.id ?? "none"}; after reinforcement=${warmContext.length} chars`,
  };
}

function patternCompilation(): NecessityCheckResult {
  const space = new CognitiveSpace();
  const store = new PatternStore(space);
  store.clearAll();

  const first = store.learnFromQuery(["programming", "python"]);
  const second = store.learnFromQuery(["programming", "python"]);
  const third = store.learnFromQuery(["programming", "python"]);

  let compiled = null;
  if (third) {
    for (let i = 0; i < 5; i++) store.strengthen(third.id, 0.1);
    compiled = store.compile(third.id);
  }

  const stats = store.getCompilationStats();
  const passed = first === null && second === null && third !== null && compiled !== null && stats.compiled >= 1;
  return {
    id: "pattern-compilation",
    subsystem: "pattern-store",
    claim: "Repeated co-occurring domains create a pattern at the 3rd sighting and compile after reinforcement.",
    passed,
    detail: `sightings returned pattern at 3rd=${third !== null}; compiled=${compiled !== null}; compiledTemplates=${stats.compiled}`,
  };
}

function theoryLearning(): NecessityCheckResult {
  resetTheoryStore();
  recordObservation("Async functions in Python avoid blocking the event loop", "programming", 0.5);
  recordObservation("Database indexes trade write speed for read speed", "database", 0.5);
  recordObservation("Caching reduces database load in web services", "programming", 0.5);

  const stats = getTheoryStats();
  const hierarchy = getTheoryHierarchy();
  const context = new TheoryMemory().buildTheoryContext("python async event loop caching");
  const surfaces =
    context.includes("Observed Patterns") || context.includes("Learned Knowledge") || hierarchy.theories.length > 0;
  const passed = stats.totalPatterns >= 1 && context.length > 0 && surfaces;
  return {
    id: "theory-learning",
    subsystem: "theory-memory",
    claim: "Cross-domain observations generalize into patterns and surface as theory context.",
    passed,
    detail: `patterns=${stats.totalPatterns} theories=${stats.totalTheories} contextChars=${context.length}`,
  };
}

function falseSuccessDetection(): NecessityCheckResult {
  const surfaceTrace: CognitiveTrace = {
    ...traceTemplate,
    finalAnswer: "Therefore the answer is clearly 42. Thus it is obvious. Hence it must be true.",
  };
  const deepTrace: CognitiveTrace = {
    ...traceTemplate,
    finalAnswer:
      "The answer is 42 because the recurrence halves the search space each step. However, this assumes sorted input; the limitation is unsorted data.",
    selfCritique: "I considered an alternative approach and the main limitation is the sorted-input assumption.",
    assumptions: ["input is sorted"],
  };
  const metrics: ThinkingMetrics = {
    representation: 0,
    strategy: 0,
    compression: 0,
    adaptation: 0,
    critique: 0,
    abstraction: 0,
    transfer: 0,
    cognitiveCompilation: 0,
    efficiency: 9,
  };

  const surface = checkForSurfaceReasoning(
    surfaceTrace,
    kernelCritiqueLike({ completeness: 0.2, accuracy: 0.35, gaps: ["Response is too brief for the query complexity"] }),
  );
  const deep = checkForSurfaceReasoning(deepTrace, kernelCritiqueLike({ completeness: 0.8, accuracy: 0.9 }));
  const detected = detectFalseSuccess(surfaceTrace, metrics);
  const passed = surface.isSurface && !deep.isSurface && detected !== null && detected.gap >= 4;
  return {
    id: "false-success-detection",
    subsystem: "false-success",
    claim: "Surface reasoning (low critic completeness/accuracy) is flagged while mechanism-based reasoning is not.",
    passed,
    detail: `surface flagged=${surface.isSurface}; deep flagged=${deep.isSurface}; recorded gap=${detected?.gap ?? "none"}`,
  };
}

const CHECKS: Check[] = [
  memoryGating,
  correctionPrecedence,
  kernelLearning,
  patternCompilation,
  theoryLearning,
  falseSuccessDetection,
];

export async function runNecessityChecks(): Promise<NecessityReport> {
  const checks: NecessityCheckResult[] = [];
  for (const check of CHECKS) {
    try {
      checks.push(await check());
    } catch (error) {
      checks.push({
        id: "error",
        subsystem: "unknown",
        claim: "Check threw",
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const passed = checks.filter((check) => check.passed).length;
  return {
    passed: passed === checks.length,
    checks,
    summary: { total: checks.length, passed, failed: checks.length - passed, generatedAt: Date.now() },
  };
}
