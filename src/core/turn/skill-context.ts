import { hashText } from "../../mind/util.js";
import { buildNarrative } from "../../memory/narrative.js";
import { renderPlanContext } from "../../tools/plan.js";
import type { ContextKind } from "../../mind/types.js";
import type { SkillTriggerMatch } from "../../types/index.js";
import type { TurnContext } from "./turn-types.js";

export async function buildSkillContext(ctx: TurnContext): Promise<void> {
  const { cfg, callbacks, userInput, pendingContextRecords } = ctx;
  // 6. Cognitive kernel (once, cached)
  callbacks.onPhase?.("reasoning");
  let cognitiveContext = "";
  ctx.lastCognitiveResult = null;
  if (cfg.cognitiveKernel.isEnabled()) {
    ctx.lastCognitiveResult = cfg.cognitiveKernel.process(userInput);
    cognitiveContext = ctx.lastCognitiveResult.cognitiveContext;
    if (callbacks.onCognitive) {
      const r = ctx.lastCognitiveResult;
      const summary = `compressed ${r.primitive.domains.length} domains -> ${r.patterns.length} patterns`;
      if (ctx.currentTrace) ctx.currentTrace.cognitiveSummary = summary;
      callbacks.onCognitive(summary);
    }
  }

  if (cognitiveContext && ctx.mindTurn && ctx.mind) {
    pendingContextRecords.push({
      section: "cognition",
      kind: "pattern" as ContextKind,
      id: `patterns:${hashText(cognitiveContext)}`,
      text: cognitiveContext,
      relevance: 0.6,
    });
  }

  // 7. User profile
  const userContext = cfg.userModel.buildUserContext();
  const planContext = renderPlanContext(cfg.sessionId);

  // 7b. Narrative — session continuity
  let narrativeContext = "";
  if (cfg.memoryEnabled) {
    const recentEpisodes = cfg.memory.getRecent(5);
    const profile = cfg.userModel.getProfile();
    const narrative = buildNarrative(recentEpisodes, profile);
    if (narrative) narrativeContext = `\n\n## Session Continuity\n${narrative}`;
  }

  // 8. Unified skill matching — registry + library triggers
  let skillMatches: SkillTriggerMatch[] = [];
  let skillContext = "";
  const libraryFrameworkContext = "";

  const regMatches = cfg.skillExecutor.findMatchingSkills(userInput);
  skillMatches.push(...regMatches);

  if (cfg.skillLibrary) {
    const libTriggers = cfg.skillLibrary.findByTrigger(userInput);
    for (const m of libTriggers) {
      const def = cfg.skillLibrary.toSkillDefinition(m.skill);
      def.prompt = cfg.skillLibrary.getContextForQuery(m.skill.name, userInput) ?? def.description;
      skillMatches.push({ skill: def, confidence: m.confidence });
    }
  }

  const seenSkills = new Set<string>();
  skillMatches = skillMatches
    .filter((m) => {
      const isNew = !seenSkills.has(m.skill.name);
      seenSkills.add(m.skill.name);
      return isNew;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 1);

  if (skillMatches.length > 0) {
    const top = skillMatches[0];
    skillContext = `\n\n## Active Skill: ${top.skill.name}\n${top.skill.prompt}`;
    if (!top.skill.isExternal) {
      cfg.skillExecutor.incrementUsage(top.skill.name);
    }
    cfg.analytics.trackSkillTrigger(top.skill.name);
    if (ctx.currentTrace) ctx.currentTrace.skill = { name: top.skill.name, confidence: top.confidence };
    if (callbacks.onSkillTriggered) {
      callbacks.onSkillTriggered(top.skill.name, top.confidence);
    }
  }

  const alivePulse = ctx.alive?.pulse();
  if (alivePulse) ctx.publishAliveActions(alivePulse, callbacks);
  const aliveContext = ctx.alive?.consumeWakeContext() ?? "";

  if (ctx.mindTurn && ctx.mind) {
    const topSkillMatch = skillMatches[0];
    if (topSkillMatch && skillContext) {
      pendingContextRecords.push({
        section: "skills",
        kind: "skill" as ContextKind,
        id: `skill:${topSkillMatch.skill.name}`,
        text: skillContext,
        relevance: topSkillMatch.confidence,
      });
    }
  }
  ctx.cognitiveContext = cognitiveContext;
  ctx.userContext = userContext;
  ctx.planContext = planContext;
  ctx.narrativeContext = narrativeContext;
  ctx.skillContext = skillContext;
  ctx.libraryFrameworkContext = libraryFrameworkContext;
  ctx.aliveContext = aliveContext;
}
