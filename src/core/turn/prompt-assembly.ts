import { getModePrompt } from "../../meta/response-mode.js";
import { DebateOrchestrator, DEBATE_VOICES } from "../orchestrator.js";
import {
  buildContextBudgetLedger,
  assembleBudgetedSystemPrompt,
  assembleSelectedSystemPrompt,
  type AssembledPrompt,
} from "../context-ledger.js";
import { hashText } from "../../mind/util.js";
import { compileContext, type CompilableItem } from "../../mind/context-compiler.js";
import {
  RESEARCH_QUESTION_PATTERN,
  RECOMMENDATION_QUESTION_PATTERN,
  DEFAULT_SYSTEM_CONTEXT_TOKEN_BUDGET,
} from "./turn-helpers.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { ToolContext } from "../../types/index.js";
import type { ContextKind } from "../../mind/types.js";
import type { TurnContext } from "./turn-types.js";

export type PromptAssemblyResult =
  | { kind: "debate"; debateOutput: string }
  | {
      kind: "continue";
      fullSystemPrompt: string;
      openaiTools: ReturnType<ToolRegistry["toOpenAITools"]>;
      toolContext: ToolContext;
      droppedSections: string[];
    };

export async function buildPromptAssembly(ctx: TurnContext): Promise<PromptAssemblyResult> {
  const {
    cfg,
    callbacks,
    userInput,
    responseMode,
    memoryContext,
    theoryContext,
    mistakesContext,
    recoveryContext,
    searchContext,
    strategyPrompt,
    mentalModelContext,
    executiveContext,
    sessionGuidance,
    timeGuidance,
    styleGuidance,
    pendingContextRecords,
    cognitiveContext,
    userContext,
    planContext,
    narrativeContext,
    skillContext,
    libraryFrameworkContext,
    aliveContext,
  } = ctx;
  // 9. Build system prompt — static sections first (prompt-cache friendly),
  // volatile sections last, enforced token budget with priority dropping
  const modePrompt = getModePrompt(responseMode, userInput);
  let identityContext = "";
  let capabilityContext = "";
  if (ctx.mindTurn && ctx.mind) {
    try {
      identityContext = ctx.mind.identitySummary();
      if (identityContext) {
        pendingContextRecords.push({
          section: "identity",
          kind: "identity" as ContextKind,
          id: "identity",
          text: identityContext,
          relevance: 0.8,
        });
      }
      capabilityContext = ctx.mind.capabilityGuidance(ctx.mindTurn.domains);
    } catch (e) {
      console.error("[mind-identity]", e);
    }
  }
  const systemContextBudget = cfg.systemContextBudget ?? DEFAULT_SYSTEM_CONTEXT_TOKEN_BUDGET;

  const sectionSpecs: {
    name: string;
    text: string;
    priority: number;
    pinned: boolean;
    kind?: ContextKind;
    id?: string;
  }[] = [
    { name: "mode", text: modePrompt ? `\n\n${modePrompt}` : "", priority: 100, pinned: true },
    {
      name: "researchGuidance",
      text: RESEARCH_QUESTION_PATTERN.test(userInput)
        ? "\n\n## Research Accuracy\nNTOX has searched and, when possible, opened scholarly source pages. Answer in one response; do not repeat the same search or emit tool-call syntax. Keep the answer focused (about 800 words maximum). Treat fetched source excerpts as directly checked evidence, and search snippets only as leads. For each important claim, distinguish source-supported facts from inference and recommendation, and cite the source URL that supports it. Check whether a source actually supports the claim before citing it. Search coverage is limited: never infer nobody has done something from missing results. For novelty, identify the narrow scope checked and say it remains unverified when evidence is insufficient. Do not call an idea a paper seed or claim it is yours to take without evidence."
        : "",
      priority: 99,
      pinned: true,
    },
    {
      name: "recommendationGuidance",
      text:
        !RESEARCH_QUESTION_PATTERN.test(userInput) && RECOMMENDATION_QUESTION_PATTERN.test(userInput)
          ? "\n\n## Recommendation Integrity\nGive a recommendation that follows from the user's stated goal and relevant known constraints. Separate facts you know from assumptions and your judgment. If a key constraint is missing, state the assumption you used and give a low-risk next step that can produce evidence. For personal advice, avoid presenting a preference-sensitive judgment as an objective fact. For project or build advice, ground claims in the files or behavior you inspected; say what you could not verify. Give the main trade-off and a concrete way to judge whether the recommendation worked."
          : "",
      priority: 98,
      pinned: true,
    },
    { name: "user", text: userContext, priority: 90, pinned: true },
    { name: "plan", text: planContext, priority: 88, pinned: true },
    {
      name: "skills",
      text: skillContext,
      priority: 85,
      pinned: true,
      kind: "skill",
      id: pendingContextRecords.find((r) => r.section === "skills")?.id,
    },
    { name: "memory", text: memoryContext, priority: 75, pinned: false },
    {
      name: "cognition",
      text: cognitiveContext,
      priority: 72,
      pinned: false,
      kind: "pattern",
      id: `patterns:${hashText(cognitiveContext)}`,
    },
    { name: "narrative", text: narrativeContext, priority: 70, pinned: false },
    { name: "theory", text: theoryContext, priority: 65, pinned: false },
    {
      name: "mistakes",
      text: mistakesContext,
      priority: 60,
      pinned: false,
      kind: "correction",
      id: `corrections:${hashText(mistakesContext)}`,
    },
    {
      name: "recovery",
      text: recoveryContext ? `\n\n${recoveryContext}` : "",
      priority: 58,
      pinned: false,
      kind: "recovery",
      id: `recovery:${hashText(recoveryContext)}`,
    },
    {
      name: "search",
      text: searchContext,
      priority: 98,
      pinned: searchContext.includes("## Research"),
    },
    { name: "skillFrameworks", text: libraryFrameworkContext, priority: 50, pinned: false },
    { name: "alive", text: aliveContext ? `\n\n${aliveContext}` : "", priority: 45, pinned: false },
    {
      name: "strategy",
      text: strategyPrompt && !cfg.cognitiveKernel.isEnabled() ? "\n\n" + strategyPrompt : "",
      priority: 40,
      pinned: true,
    },
    { name: "mentalModel", text: mentalModelContext, priority: 35, pinned: false },
    { name: "executive", text: executiveContext, priority: 30, pinned: false },
    { name: "identity", text: identityContext, priority: 26, pinned: false, kind: "identity", id: "identity" },
    { name: "capability", text: capabilityContext, priority: 22, pinned: false },
    {
      name: "session",
      text: sessionGuidance ? `\n\n## Session Context\n${sessionGuidance}` : "",
      priority: 20,
      pinned: true,
    },
    { name: "time", text: timeGuidance ? `\n\n## Time Context\n${timeGuidance}` : "", priority: 15, pinned: true },
    {
      name: "style",
      text: styleGuidance ? `\n\n## Communication Style\n${styleGuidance}` : "",
      priority: 10,
      pinned: true,
    },
  ];

  const useCompiler = ctx.mindTurn != null && ctx.mind != null && cfg.contextCompilerEnabled !== false;
  let assembled: AssembledPrompt;
  let droppedSections: string[] = [];

  if (useCompiler && ctx.mind) {
    const reliabilityBySection = new Map<string, number>();
    for (const rec of pendingContextRecords) {
      const current = reliabilityBySection.get(rec.section) ?? 0;
      const rel = ctx.mind.reliability.score(rec.kind, rec.id);
      reliabilityBySection.set(rec.section, current === 0 ? rel : (current + rel) / 2);
    }

    const baseTokens = Math.ceil(cfg.systemPrompt.length / 4);
    const cognitiveBudget = Math.max(400, systemContextBudget - baseTokens);
    const items: CompilableItem[] = sectionSpecs
      .filter((s) => s.text)
      .map((s) => ({
        kind: s.kind ?? ("pattern" as ContextKind),
        id: s.id ?? s.name,
        text: s.text,
        tokens: Math.ceil(s.text.length / 4),
        relevance: s.priority / 100,
        reliability: reliabilityBySection.get(s.name) ?? 0.5,
        pinned: s.pinned,
        order: s.priority,
      }));
    const compiled = compileContext(items, cognitiveBudget);
    const selected = new Set(compiled.included.map((i) => i.id));
    const selectedNames = new Set(
      sectionSpecs.filter((s) => s.text && selected.has(s.id ?? s.name)).map((s) => s.name),
    );
    assembled = assembleSelectedSystemPrompt(
      cfg.systemPrompt,
      sectionSpecs.map(({ name, text, priority }) => ({ name, text, priority })),
      selectedNames,
    );
    droppedSections = assembled.dropped;
  } else {
    assembled = assembleBudgetedSystemPrompt(
      cfg.systemPrompt,
      sectionSpecs.map(({ name, text, priority }) => ({ name, text, priority })),
      systemContextBudget,
    );
  }

  if (ctx.mind && ctx.mindTurn) {
    const includedSections = new Set(assembled.included);
    for (const rec of pendingContextRecords) {
      if (includedSections.has(rec.section)) {
        ctx.mind.recordContextText(ctx.mindTurn, rec.kind, rec.id, rec.text, rec.relevance);
      }
    }
  }

  const fullSystemPrompt = assembled.prompt;
  if (ctx.currentTrace && assembled.dropped.length > 0) {
    ctx.currentTrace.droppedContextSections = assembled.dropped;
  }
  if (ctx.currentTrace) {
    ctx.currentTrace.contextBudget = buildContextBudgetLedger({
      system: cfg.systemPrompt,
      strategy: strategyPrompt,
      cognition: cognitiveContext,
      memory: memoryContext,
      theory: theoryContext,
      mistakes: mistakesContext,
      user: userContext,
      narrative: narrativeContext,
      plan: planContext,
      mentalModel: mentalModelContext,
      executive: executiveContext,
      skills: skillContext + libraryFrameworkContext,
      search: searchContext,
      mode: modePrompt,
      session: sessionGuidance + identityContext + capabilityContext,
      time: timeGuidance,
      full: fullSystemPrompt,
    });
  }

  const openaiTools = cfg.tools
    .toOpenAITools()
    .filter((tool) => !(RESEARCH_QUESTION_PATTERN.test(userInput) && tool.function.name === "search"));
  const toolContext = {
    sessionId: cfg.sessionId,
    turnId: ctx.runTurnId,
    workspaceRoot: cfg.policy?.profile.workspaceRoot,
    tools: cfg.tools,
  };

  // 9a. Debate detection — route complex research questions to multi-agent debate
  const isDebateQuery =
    userInput.startsWith("/debate") ||
    (userInput.length > 80 &&
      /\b(?:debate|compare|analyze|evaluate|assess)\b/i.test(userInput) &&
      /\b(?:why|how|should|is it|are there|what are the implications)\b/i.test(userInput));

  if (isDebateQuery && !cfg.cognitiveKernel.isEnabled()) {
    let skipDebate = false;
    if (ctx.mind && ctx.mindTurn) {
      try {
        skipDebate = ctx.mind.capability.decideStance(ctx.mindTurn.domains, "standard").skipDebate;
      } catch {
        skipDebate = false;
      }
    }
    if (skipDebate) {
      if (ctx.currentTrace) ctx.currentTrace.debateSkipped = "capability-confident";
    } else {
      const cleanQuery = userInput.replace(/^\/debate\s*/i, "");
      callbacks.onPhase?.("responding");
      const orchestrator = new DebateOrchestrator(cfg.llm);
      try {
        const result = await orchestrator.debate(cleanQuery, "", (voice, step) => {
          callbacks.onThinking?.(`${voice} (${step}/${DEBATE_VOICES.length})`);
        });
        const debateOutput = result.synthesis;
        callbacks.onToken(debateOutput);
        ctx.pushMessage({ role: "assistant", content: debateOutput });
        ctx.lastAssistantResponse = debateOutput;
        ctx.lastUserMessage = userInput;
        ctx.finishTrace(debateOutput);
        return { kind: "debate", debateOutput };
      } catch (e) {
        console.error("[debate] failed, falling through to standard mode:", e);
      }
    }
  }

  return {
    kind: "continue",
    fullSystemPrompt,
    openaiTools,
    toolContext,
    droppedSections,
  };
}
