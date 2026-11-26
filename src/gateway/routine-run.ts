import type { SharedInfra } from "../core/dispatcher.js";
import { createRoutineRuntime, renderRoutineRun, runRoutine } from "../skills/routine.js";

export async function executeRoutineByName(shared: SharedInfra, name: string): Promise<string> {
  const skill = shared.skillRegistry.get(name);
  if (!skill) return `Skill "${name}" not found.`;
  if (!skill.steps || skill.steps.length === 0) {
    return `Skill "${name}" has no routine steps. Add a "steps" array to make it a routine.`;
  }
  const runtime = createRoutineRuntime({
    llm: shared.llm,
    tools: shared.tools,
    skillRegistry: shared.skillRegistry,
  });
  const result = await runRoutine(skill, runtime);
  shared.skillRegistry.incrementUsage(name);
  return renderRoutineRun(skill, result);
}
