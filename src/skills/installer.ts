import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, type Dirent } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { validateHttpUrl } from "../tools/web.js";
import { parseSkillMarkdown } from "./markdown.js";
import { parseMarketplaceIndex, type MarketplaceEntry, type SkillMarketplace } from "./marketplace.js";
import { sanitizeSkillName } from "./naming.js";
import { parseRoutineSteps } from "./routine.js";
import type { RoutineStep, SkillDefinition } from "../types/index.js";

export { sanitizeSkillName };

const MAX_SKILL_BYTES = 512 * 1024;
const MAX_SCAN_FILES = 50;
const MAX_PACK_ENTRIES = 20;
const SCAN_MAX_DEPTH = 3;
const FETCH_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 30_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", "coverage"]);
const MARKDOWN_EXT = /\.(md|markdown)$/i;
const NON_SKILL_MD = /^(index|readme)/i;

export const SKILL_INSTALL_USAGE = "/skill install <url|git|file|name> [--force]";

export type SkillSourceKind = "url" | "git" | "file";

export type SkillSourceClass = { kind: SkillSourceKind; target: string } | { kind: "invalid"; reason: string };

export function isMarketplaceName(source: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(source);
}

type SkillFileFormat = "json" | "markdown";

function stripSourceParts(source: string): string {
  return source.split(/[?#]/)[0];
}

function formatOf(source: string): SkillFileFormat {
  return MARKDOWN_EXT.test(stripSourceParts(source)) ? "markdown" : "json";
}

export function classifySkillSource(raw: string): SkillSourceClass {
  let source = raw.trim();
  if (!source) return { kind: "invalid", reason: `Missing source. Usage: ${SKILL_INSTALL_USAGE}` };
  if (source.startsWith("git+")) source = source.slice(4);

  if (/^https?:\/\//i.test(source)) {
    let pathname: string;
    try {
      pathname = new URL(source).pathname.toLowerCase();
    } catch {
      return { kind: "invalid", reason: "Invalid URL" };
    }
    if (pathname.endsWith(".json") || MARKDOWN_EXT.test(pathname)) return { kind: "url", target: source };
    return { kind: "git", target: source };
  }
  if (/^git@[\w.-]+:[\w./-]+/i.test(source)) return { kind: "git", target: source };
  if (/^(ssh|git):\/\//i.test(source)) return { kind: "git", target: source };
  if (/^file:\/\//i.test(source)) {
    return { kind: "invalid", reason: "file:// URLs are not supported — pass a plain filesystem path" };
  }
  return { kind: "file", target: source.startsWith("~/") ? join(homedir(), source.slice(2)) : source };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export type SkillParseResult = { ok: true; skill: SkillDefinition } | { ok: false; error: string };

export function parseSkillJson(text: string): SkillParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "expected a JSON object" };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return { ok: false, error: "missing name" };
  if (typeof record.prompt !== "string" || !record.prompt.trim()) return { ok: false, error: "missing prompt" };
  const triggers = toStringArray(record.triggers)
    .map((trigger) => trigger.toLowerCase())
    .filter(Boolean);
  if (triggers.length === 0) return { ok: false, error: "missing triggers" };
  const name = sanitizeSkillName(record.name);
  if (!name) return { ok: false, error: "name is empty after sanitizing" };
  let parsedSteps: RoutineStep[] | undefined;
  if (record.steps !== undefined) {
    const steps = parseRoutineSteps(record.steps);
    if (!steps.ok) return { ok: false, error: `invalid steps: ${steps.error}` };
    parsedSteps = steps.steps;
  }

  const now = Date.now();
  return {
    ok: true,
    skill: {
      name,
      description:
        typeof record.description === "string" && record.description.trim() ? record.description.trim() : name,
      category: typeof record.category === "string" && record.category.trim() ? record.category.trim() : "custom",
      prompt: record.prompt,
      triggers: triggers.slice(0, 6),
      tools: toStringArray(record.tools).slice(0, 8),
      examples: toStringArray(record.examples).slice(0, 3),
      created: typeof record.created === "number" ? record.created : now,
      updated: now,
      usageCount: typeof record.usageCount === "number" && record.usageCount >= 0 ? record.usageCount : 0,
      steps: parsedSteps,
    },
  };
}

interface Candidate {
  label: string;
  text: string;
  strict: boolean;
  format: SkillFileFormat;
  depth: number;
  base?: string;
  nameOverride?: string;
}

function applyNameOverride(skill: SkillDefinition, override?: string): SkillDefinition {
  if (!override) return skill;
  const name = sanitizeSkillName(override);
  return name ? { ...skill, name } : skill;
}

function scanSkillFiles(root: string): Candidate[] {
  const candidates: Candidate[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > SCAN_MAX_DEPTH || candidates.length >= MAX_SCAN_FILES) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (candidates.length >= MAX_SCAN_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        const isMarkdown = MARKDOWN_EXT.test(lower);
        const isJson = lower.endsWith(".json");
        if (!isJson && !isMarkdown) continue;
        if (isMarkdown && NON_SKILL_MD.test(lower)) continue;
        try {
          if (statSync(full).size > MAX_SKILL_BYTES) continue;
          candidates.push({
            label: relative(root, full) || entry.name,
            text: readFileSync(full, "utf-8"),
            strict: false,
            format: isMarkdown ? "markdown" : "json",
            depth: 0,
          });
        } catch {
          continue;
        }
      }
    }
  };
  walk(root, 0);
  return candidates;
}

function collectFromFile(rawPath: string): Candidate[] {
  if (!existsSync(rawPath)) throw new Error(`File not found: ${rawPath}`);
  const stats = statSync(rawPath);
  if (stats.isDirectory()) return scanSkillFiles(rawPath);
  if (stats.size > MAX_SKILL_BYTES) throw new Error(`File too large (max ${MAX_SKILL_BYTES / 1024}KB)`);
  return [
    {
      label: rawPath,
      text: readFileSync(rawPath, "utf-8"),
      strict: true,
      format: formatOf(rawPath),
      depth: 0,
      base: rawPath,
    },
  ];
}

async function fetchSkillText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const blocked = validateHttpUrl(url);
  if (blocked) throw new Error(blocked);
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
    headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
  });
  if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_SKILL_BYTES) throw new Error(`Skill file too large (max ${MAX_SKILL_BYTES / 1024}KB)`);
  const text = await response.text();
  if (text.length > MAX_SKILL_BYTES) throw new Error(`Skill file too large (max ${MAX_SKILL_BYTES / 1024}KB)`);
  return text;
}

export function validateGitUrl(url: string): string | null {
  if (/^https?:\/\//i.test(url)) return validateHttpUrl(url);
  if (/^git@[\w.-]+:[\w./-]+/.test(url)) return null;
  if (/^(ssh|git):\/\//i.test(url)) return null;
  return `Unsupported git URL: ${url}`;
}

async function defaultGitClone(url: string, dir: string): Promise<void> {
  const problem = validateGitUrl(url);
  if (problem) throw new Error(problem);
  await new Promise<void>((resolve, reject) => {
    execFile(
      "git",
      ["clone", "--depth", "1", "--quiet", "--", url, dir],
      {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
          GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
        },
      },
      (error, _stdout, stderr) => {
        if (!error) return resolve();
        const firstLine = String(stderr ?? "")
          .trim()
          .split("\n")[0]
          .slice(0, 300);
        reject(
          new Error(firstLine ? `git clone failed: ${firstLine}` : `git clone failed: ${error.message.slice(0, 300)}`),
        );
      },
    );
  });
}

async function collectFromGit(
  url: string,
  cloneImpl: (url: string, dir: string) => Promise<void>,
): Promise<Candidate[]> {
  const problem = validateGitUrl(url);
  if (problem) throw new Error(problem);
  const tempRoot = mkdtempSync(join(tmpdir(), "ntox-skill-install-"));
  const cloneDir = join(tempRoot, "repo");
  try {
    await cloneImpl(url, cloneDir);
    if (!existsSync(cloneDir)) throw new Error("git clone produced no checkout");
    return scanSkillFiles(cloneDir);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export interface SkillRegistryLike {
  get(name: string): SkillDefinition | undefined;
  add(skill: SkillDefinition): void;
}

export interface SkillInstallOptions {
  force?: boolean;
  fetchImpl?: typeof fetch;
  gitCloneImpl?: (url: string, dir: string) => Promise<void>;
  marketplace?: SkillMarketplace;
}

export interface SkillInstallResult {
  installed: string[];
  skipped: { name: string; reason: string }[];
  errors: string[];
}

export interface ResolvedSkillSource {
  skills: SkillDefinition[];
  errors: string[];
}

async function collectCandidates(
  classified: Exclude<SkillSourceClass, { kind: "invalid" }>,
  options: SkillInstallOptions,
): Promise<{ candidates: Candidate[]; errors: string[] }> {
  try {
    if (classified.kind === "url") {
      const text = await fetchSkillText(classified.target, options.fetchImpl ?? fetch);
      return {
        candidates: [
          {
            label: classified.target,
            text,
            strict: true,
            format: formatOf(classified.target),
            depth: 0,
            base: classified.target,
          },
        ],
        errors: [],
      };
    }
    if (classified.kind === "git") {
      const candidates = await collectFromGit(classified.target, options.gitCloneImpl ?? defaultGitClone);
      if (candidates.length === 0) return { candidates, errors: [`No JSON files found in ${classified.target}`] };
      return { candidates, errors: [] };
    }
    const candidates = collectFromFile(classified.target);
    if (candidates.length === 0) return { candidates, errors: [`No JSON files found in ${classified.target}`] };
    return { candidates, errors: [] };
  } catch (error) {
    return { candidates: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
}

async function expandPack(
  entries: MarketplaceEntry[],
  options: SkillInstallOptions,
): Promise<{ candidates: Candidate[]; errors: string[] }> {
  const candidates: Candidate[] = [];
  const errors: string[] = [];
  for (const entry of entries.slice(0, MAX_PACK_ENTRIES)) {
    const source = entry.source;
    try {
      if (/^(ssh|git):\/\//i.test(source) || /^git@/.test(source)) {
        errors.push(`${entry.name}: pack entries must be files, got ${source}`);
        continue;
      }
      if (/^https?:\/\//i.test(source)) {
        const text = await fetchSkillText(source, options.fetchImpl ?? fetch);
        candidates.push({
          label: source,
          text,
          strict: true,
          format: formatOf(source),
          depth: 1,
          base: source,
          nameOverride: entry.name,
        });
        continue;
      }
      if (!existsSync(source)) {
        errors.push(`${entry.name}: file not found (${source})`);
        continue;
      }
      const stats = statSync(source);
      if (!stats.isFile()) {
        errors.push(`${entry.name}: not a file (${source})`);
        continue;
      }
      if (stats.size > MAX_SKILL_BYTES) {
        errors.push(`${entry.name}: file too large`);
        continue;
      }
      candidates.push({
        label: source,
        text: readFileSync(source, "utf-8"),
        strict: true,
        format: formatOf(source),
        depth: 1,
        base: source,
        nameOverride: entry.name,
      });
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { candidates, errors };
}

async function parseCandidates(candidates: Candidate[], options: SkillInstallOptions): Promise<ResolvedSkillSource> {
  const skills: SkillDefinition[] = [];
  const errors: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.format === "markdown") {
      const parsed = parseSkillMarkdown(candidate.text, candidate.label);
      if (parsed.ok) skills.push(applyNameOverride(parsed.skill, candidate.nameOverride));
      else if (candidate.strict) errors.push(`${candidate.label}: ${parsed.error}`);
      continue;
    }
    const parsed = parseSkillJson(candidate.text);
    if (parsed.ok) {
      skills.push(applyNameOverride(parsed.skill, candidate.nameOverride));
      continue;
    }
    if (candidate.strict && candidate.depth === 0) {
      const pack = parseMarketplaceIndex(candidate.text, candidate.base ?? candidate.label);
      if (pack.ok) {
        const expanded = await expandPack(pack.entries, options);
        errors.push(...expanded.errors);
        candidates.push(...expanded.candidates);
        continue;
      }
    }
    if (candidate.strict) errors.push(`${candidate.label}: ${parsed.error}`);
  }
  return { skills, errors };
}

async function collectFrom(
  classified: Exclude<SkillSourceClass, { kind: "invalid" }>,
  options: SkillInstallOptions,
  nameOverride?: string,
): Promise<ResolvedSkillSource> {
  const { candidates, errors } = await collectCandidates(classified, options);
  if (candidates.length === 0) return { skills: [], errors };
  if (nameOverride && candidates.length === 1 && candidates[0].strict) {
    candidates[0].nameOverride = nameOverride;
  }
  const parsed = await parseCandidates(candidates, options);
  const skills = parsed.skills;
  const allErrors = [...errors, ...parsed.errors];
  if (skills.length === 0 && allErrors.length === 0) {
    allErrors.push(`No skill definitions found in ${classified.target}`);
  }
  return { skills, errors: allErrors };
}

async function resolveMarketplaceName(name: string, marketplace: SkillMarketplace): Promise<ResolvedSkillSource> {
  const lookup = await marketplace.lookup(name);
  if (lookup.status === "found") {
    const resolved = classifySkillSource(lookup.entry.source);
    if (resolved.kind === "invalid") {
      return { skills: [], errors: [`Marketplace entry "${name}": ${resolved.reason}`] };
    }
    return collectFrom(resolved, { marketplace }, lookup.entry.name);
  }
  if (lookup.status === "not-found") {
    return {
      skills: [],
      errors: [`No marketplace skill named "${name}". Reply /skill marketplace to browse the index.`],
    };
  }
  if (lookup.status === "disabled") {
    return {
      skills: [],
      errors: [`"${name}" is not a file, and the marketplace is disabled (set skillMarketplaceIndex).`],
    };
  }
  return { skills: [], errors: [`Marketplace unavailable: ${lookup.error}`] };
}

export async function resolveSkillSource(
  source: string,
  options: SkillInstallOptions = {},
): Promise<ResolvedSkillSource> {
  const classified = classifySkillSource(source);
  if (classified.kind === "invalid") return { skills: [], errors: [classified.reason] };

  if (classified.kind === "file" && !existsSync(classified.target) && isMarketplaceName(classified.target)) {
    if (!options.marketplace) return { skills: [], errors: [`File not found: ${classified.target}`] };
    return resolveMarketplaceName(classified.target, options.marketplace);
  }
  return collectFrom(classified, options);
}

export async function installSkillFromSource(
  source: string,
  registry: SkillRegistryLike,
  options: SkillInstallOptions = {},
): Promise<SkillInstallResult> {
  const resolved = await resolveSkillSource(source, options);
  const result: SkillInstallResult = { installed: [], skipped: [], errors: [...resolved.errors] };
  for (const skill of resolved.skills) {
    const existing = registry.get(skill.name);
    if (existing && !options.force) {
      result.skipped.push({ name: skill.name, reason: "already exists (use --force to overwrite)" });
      continue;
    }
    registry.add(skill);
    result.installed.push(skill.name);
  }
  return result;
}

export function renderSkillInstallResult(result: SkillInstallResult): string {
  const failed = result.installed.length === 0 && result.skipped.length === 0;
  if (failed) return `Install failed: ${result.errors.join("; ")}`;

  const lines: string[] = [];
  if (result.installed.length > 0) {
    const noun = result.installed.length === 1 ? "skill" : "skills";
    lines.push(`Installed ${noun}: ${result.installed.join(", ")}`);
  }
  for (const skipped of result.skipped) {
    lines.push(`Skipped ${skipped.name}: ${skipped.reason}`);
  }
  for (const error of result.errors) {
    lines.push(`Warning: ${error}`);
  }
  if (result.installed.length > 0) {
    lines.push("Triggers are live. Use /skill show <name> to inspect.");
  }
  return lines.join("\n");
}
