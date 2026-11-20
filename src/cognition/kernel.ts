import { CognitiveSpace } from "./cognitive-space.js";
import { MeaningCompressor } from "./compressor.js";
import { PatternStore } from "./patterns.js";
import { SparseActivator } from "./sparse-activator.js";
import { Critic } from "./critique.js";
import { SkillRegistry } from "../skills/registry.js";
import { hasSufficientObjectiveEvidence, meaningfulObjective } from "../mind/evidence.js";
import type { CognitivePattern, CritiqueResult, PrimitiveRepresentation, SkillDefinition } from "../types/index.js";

export interface CognitiveResult {
  primitive: PrimitiveRepresentation;
  patterns: CognitivePattern[];
  cognitiveContext: string;
  critique: CritiqueResult;
  compiledPatterns: { name: string; abstract: boolean }[];
}

export class CognitiveKernel {
  private space: CognitiveSpace;
  private compressor: MeaningCompressor;
  private patterns: PatternStore;
  private activator: SparseActivator;
  private critic: Critic;
  private registry: SkillRegistry;
  private enabled: boolean;
  private requireEvidenceForPromotion: boolean;

  constructor(registry: SkillRegistry) {
    this.space = new CognitiveSpace();
    this.compressor = new MeaningCompressor();
    this.patterns = new PatternStore(this.space);
    this.activator = new SparseActivator();
    this.critic = new Critic(true);
    this.registry = registry;
    this.enabled = false;
    this.requireEvidenceForPromotion = false;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * When enabled, a pattern is promoted to a registry skill only once it has
   * accumulated meaningful objective evidence. Heuristic critique may still
   * tune pattern strength, but never promotes to the skill library. Off by
   * default; enable it once the turn loop feeds an `objective` into process().
   */
  setRequireEvidenceForPromotion(val: boolean): void {
    this.requireEvidenceForPromotion = val;
  }
  getRequireEvidenceForPromotion(): boolean {
    return this.requireEvidenceForPromotion;
  }

  private patternToSkill(pattern: CognitivePattern): SkillDefinition {
    const name =
      pattern.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/gi, "_")
        .replace(/_+/g, "-")
        .replace(/^-|-$/g, "") || "compiled-pattern";
    const template = pattern.compiledTemplate || pattern.reasoningTemplate || "";
    return {
      name: name.slice(0, 50),
      description: `Compiled reasoning pattern across ${pattern.domains.join(", ")}`,
      category: "compiled",
      prompt: template,
      triggers: pattern.domains,
      tools: [],
      examples: [],
      created: Date.now(),
      updated: Date.now(),
      usageCount: 0,
      domain: pattern.domains[0] || "general",
      importance: Math.min(10, Math.max(1, Math.round(pattern.strength * 10))),
      isExternal: false,
    };
  }

  process(query: string, response?: string, objective?: number | null): CognitiveResult {
    const primitive = this.compressor.compress(query);
    const compiledPatterns: { name: string; abstract: boolean }[] = [];

    if (!this.enabled) {
      return {
        primitive,
        patterns: [],
        cognitiveContext: "",
        critique: { completeness: 0.5, accuracy: 0.5, clarity: 0.5, gaps: [], strengthened: true },
        compiledPatterns,
      };
    }

    const queryVector = this.space.computeQueryVector(primitive.domains);
    const retrievedPatterns = this.patterns.retrieve(queryVector, primitive.domains);
    this.patterns.learnFromQuery(primitive.domains);
    this.space.learnFromCoOccurrence(primitive.domains);

    const cognitiveContext = this.activator.activate(retrievedPatterns, primitive);

    let critique: CritiqueResult;
    const hasObjective = typeof objective === "number" && meaningfulObjective(objective);
    if (response) {
      critique = this.critic.critique(query, response, primitive);
      const strongPatterns = retrievedPatterns.filter((p) => p.strength >= 0.5 && p.compileCount >= 3);
      const primaryPattern = strongPatterns[0] || retrievedPatterns[0];

      if (primaryPattern) {
        if (hasObjective) {
          // Evidence-first: the objective signal owns strengthening/weakening.
          this.patterns.recordObjective(primaryPattern.id, objective!);
          if (objective! >= 0) {
            const afterStrengthen = this.patterns.strengthen(primaryPattern.id, 0.05);
            const evidenceMet = hasSufficientObjectiveEvidence(primaryPattern.objectiveHits);
            if (
              afterStrengthen &&
              afterStrengthen.compileCount >= 5 &&
              (!this.requireEvidenceForPromotion || evidenceMet)
            ) {
              const compiled = this.patterns.compile(primaryPattern.id);
              if (compiled) {
                const isAbstract = compiled.id.startsWith("pat_compiled");
                compiledPatterns.push({ name: compiled.name, abstract: isAbstract });
                if (!this.requireEvidenceForPromotion || hasSufficientObjectiveEvidence(compiled.objectiveHits)) {
                  this.registry.add(this.patternToSkill(compiled));
                }
              }
            }
          } else {
            this.patterns.weaken(primaryPattern.id, 0.05);
          }
        } else if (this.requireEvidenceForPromotion) {
          // No external evidence: the heuristic critic may tune strength but
          // must not promote to the skill library.
          if (critique.strengthened) {
            this.patterns.strengthen(primaryPattern.id);
          } else if (critique.completeness < 0.3 || critique.accuracy < 0.3) {
            this.patterns.weaken(primaryPattern.id);
          }
        } else if (critique.strengthened) {
          const afterStrengthen = this.patterns.strengthen(primaryPattern.id);
          if (afterStrengthen && afterStrengthen.compileCount >= 5) {
            const compiled = this.patterns.compile(primaryPattern.id);
            if (compiled) {
              const isAbstract = compiled.id.startsWith("pat_compiled");
              compiledPatterns.push({ name: compiled.name, abstract: isAbstract });
              this.registry.add(this.patternToSkill(compiled));
            }
          }
        } else if (critique.completeness < 0.3 || critique.accuracy < 0.3) {
          this.patterns.weaken(primaryPattern.id);
        }
      }
    } else {
      critique = { completeness: 0, accuracy: 0, clarity: 0, gaps: [], strengthened: true };
    }

    return { primitive, patterns: retrievedPatterns, cognitiveContext, critique, compiledPatterns };
  }

  review(query: string, response: string): { gaps: string[]; shouldRetry: boolean; correctionPrompt: string } {
    if (!this.enabled) return { gaps: [], shouldRetry: false, correctionPrompt: "" };

    const primitive = this.compressor.compress(query);
    const queryVector = this.space.computeQueryVector(primitive.domains);
    const retrievedPatterns = this.patterns.retrieve(queryVector, primitive.domains);
    const critique = this.critic.critique(query, response, primitive);

    const checklist = this.activator.buildChecklist(retrievedPatterns);
    const gaps = [...critique.gaps, ...checklist];

    const shouldRetry = critique.completeness < 0.3 || critique.accuracy < 0.3;

    let correctionPrompt = "";
    if (shouldRetry && gaps.length > 0) {
      correctionPrompt = `Your previous answer had issues: ${gaps.join("; ")}. Please provide a more complete and accurate answer.`;
    }

    return { gaps, shouldRetry, correctionPrompt };
  }

  getSpace(): CognitiveSpace {
    return this.space;
  }
  getPatterns(): PatternStore {
    return this.patterns;
  }
  getCompressor(): MeaningCompressor {
    return this.compressor;
  }
  getCritic(): Critic {
    return this.critic;
  }
}
