import { resolveSkillSource } from "./installer.js";
import type { SkillMarketplace } from "./marketplace.js";
import type { SkillDefinition } from "../types/index.js";

export const SKILL_AUTO_DISABLE_MS = 30 * 24 * 60 * 60 * 1000;

export function isSkillAutoDisabled(skill: SkillDefinition, now: number = Date.now()): boolean {
  if ((skill.usageCount ?? 0) > 0) return false;
  const lastTouched = Math.max(skill.created || 0, skill.updated || 0);
  return now - lastTouched > SKILL_AUTO_DISABLE_MS;
}

export type SkillStatus = "active" | "never-used" | "auto-disabled";

export interface SkillStat {
  name: string;
  usageCount: number;
  version: number;
  status: SkillStatus;
  lastUsedAt: number | null;
}

function skillStatus(skill: SkillDefinition, now: number): SkillStatus {
  if (isSkillAutoDisabled(skill, now)) return "auto-disabled";
  return (skill.usageCount ?? 0) === 0 ? "never-used" : "active";
}

export function collectSkillStats(skills: SkillDefinition[], now: number = Date.now()): SkillStat[] {
  const stats = skills.map((skill) => ({
    name: skill.name,
    usageCount: skill.usageCount ?? 0,
    version: skill.version ?? 1,
    status: skillStatus(skill, now),
    lastUsedAt: skill.lastUsedAt ?? null,
  }));
  stats.sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
  return stats;
}

export function renderSkillStats(skills: SkillDefinition[], now: number = Date.now()): string {
  const stats = collectSkillStats(skills, now);
  if (stats.length === 0) return "No skills installed.";
  const width = Math.min(30, Math.max(...stats.map((stat) => stat.name.length)));
  const totalUses = stats.reduce((sum, stat) => sum + stat.usageCount, 0);
  const disabled = stats.filter((stat) => stat.status === "auto-disabled").length;
  const lines = [`Skills (${stats.length}):`];
  for (const stat of stats) {
    const detail =
      stat.status === "active"
        ? `active, last used ${stat.lastUsedAt ? `${Math.round((now - stat.lastUsedAt) / 86_400_000)}d ago` : "unknown"}`
        : stat.status;
    lines.push(
      `  ${stat.name.padEnd(width)}  used ${String(stat.usageCount).padStart(3)}x  v${stat.version}  ${detail}`,
    );
  }
  lines.push("", `Total uses: ${totalUses}. Auto-disabled: ${disabled}.`);
  if (disabled > 0) {
    lines.push("Auto-disabled skills stop matching triggers until they are used or reinstalled with --force.");
  }
  return lines.join("\n");
}

export interface SkillChange {
  field: string;
  detail: string;
}

function clip(value: string | undefined): string {
  const text = (value ?? "").trim() || "(empty)";
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

export function diffSkills(local: SkillDefinition, incoming: SkillDefinition): SkillChange[] {
  const changes: SkillChange[] = [];
  if (local.name !== incoming.name) {
    changes.push({ field: "name", detail: `${local.name} -> ${incoming.name}` });
  }
  if (local.description !== incoming.description) {
    changes.push({ field: "description", detail: `${clip(local.description)} -> ${clip(incoming.description)}` });
  }
  if (local.category !== incoming.category) {
    changes.push({ field: "category", detail: `${clip(local.category)} -> ${clip(incoming.category)}` });
  }
  if (local.prompt !== incoming.prompt) {
    changes.push({ field: "prompt", detail: `changed (${local.prompt.length} -> ${incoming.prompt.length} chars)` });
  }
  const localSteps = JSON.stringify(local.steps ?? null);
  const incomingSteps = JSON.stringify(incoming.steps ?? null);
  if (localSteps !== incomingSteps) {
    changes.push({
      field: "steps",
      detail: `changed (${(local.steps ?? []).length} -> ${(incoming.steps ?? []).length} steps)`,
    });
  }
  for (const field of ["triggers", "tools", "examples"] as const) {
    const before = local[field] ?? [];
    const after = incoming[field] ?? [];
    for (const value of after.filter((item) => !before.includes(item))) {
      changes.push({ field, detail: `+ ${value}` });
    }
    for (const value of before.filter((item) => !after.includes(item))) {
      changes.push({ field, detail: `- ${value}` });
    }
  }
  return changes;
}

export function renderSkillDiff(local: SkillDefinition, incoming: SkillDefinition): string {
  const changes = diffSkills(local, incoming);
  if (changes.length === 0) return `${local.name} matches the source — nothing to update.`;
  const lines = [`Diff for ${local.name} (local v${local.version ?? 1} vs source):`];
  for (const change of changes) {
    lines.push(`  ${change.field}: ${change.detail}`);
  }
  lines.push("", "Update with: /skill install <source> --force");
  return lines.join("\n");
}

export interface SkillLookupRegistry {
  get(name: string): SkillDefinition | undefined;
}

export async function diffSkillByName(
  registry: SkillLookupRegistry,
  marketplace: SkillMarketplace,
  name: string,
  source?: string | null,
): Promise<string> {
  const local = registry.get(name);
  if (!local) return `Skill "${name}" is not installed.`;

  let resolvedSource = source?.trim() || null;
  if (!resolvedSource) {
    const lookup = await marketplace.lookup(local.name);
    if (lookup.status !== "found") {
      return `No marketplace entry for "${local.name}". Pass a source: /skill diff ${local.name} <url|git|file>`;
    }
    resolvedSource = lookup.entry.source;
  }

  const resolved = await resolveSkillSource(resolvedSource, { marketplace });
  if (resolved.skills.length === 0) {
    const detail = resolved.errors.length > 0 ? `: ${resolved.errors.join("; ")}` : "";
    return `No skills found in ${resolvedSource}${detail}`;
  }
  const incoming =
    resolved.skills.find((skill) => skill.name === local.name) ??
    (resolved.skills.length === 1 ? resolved.skills[0] : undefined);
  if (!incoming) {
    return `Source has no skill named "${local.name}". It contains: ${resolved.skills
      .map((skill) => skill.name)
      .join(", ")}`;
  }
  return renderSkillDiff(local, incoming);
}
