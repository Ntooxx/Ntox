import { basename } from "node:path";
import { sanitizeSkillName } from "./naming.js";
import type { SkillDefinition } from "../types/index.js";

export type MarkdownSkillParse = { ok: true; skill: SkillDefinition } | { ok: false; error: string };

export function extractMdSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const target = heading.trim().toLowerCase();
  let collecting = false;
  const out: string[] = [];
  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      if (collecting) break;
      if (h2[1].trim().toLowerCase() === target) {
        collecting = true;
        continue;
      }
    } else if (collecting && /^---\s*$/.test(line)) {
      break;
    }
    if (collecting) out.push(line);
  }
  return out.join("\n").trim();
}

const GENERIC_BASENAMES = /^(index|readme|skill)$/i;

function stripUrlParts(source: string): string {
  return source.split(/[?#]/)[0];
}

function deriveName(label: string | undefined, title: string): string {
  if (label) {
    const base = basename(stripUrlParts(label))
      .replace(/\.(md|markdown|json)$/i, "")
      .replace(/^\d+[_-]/, "")
      .replace(/[_-]+/g, " ")
      .trim();
    if (base && !GENERIC_BASENAMES.test(base)) return sanitizeSkillName(base);
  }
  if (title) return sanitizeSkillName(title);
  return "";
}

function deriveTriggers(name: string, title: string): string[] {
  const combined = `${name} ${title}`.toLowerCase();
  const words = combined.split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  const unique: string[] = [];
  for (const word of words) {
    if (!unique.includes(word)) unique.push(word);
    if (unique.length >= 6) break;
  }
  if (unique.length === 0) {
    for (const word of combined.split(/[^a-z0-9]+/).filter(Boolean)) {
      if (!unique.includes(word)) unique.push(word);
      if (unique.length >= 6) break;
    }
  }
  return unique;
}

function splitList(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\s"]+|"$/g, "").trim())
    .flatMap((line) => (line.includes(", ") && !line.startsWith("-") ? line.split(",") : [line]))
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstParagraph(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^#\s/.test(line)) continue;
    if (out.length > 0 && (/^\s*$/.test(line) || /^#{1,3}\s/.test(line))) break;
    if (/^\s*$/.test(line) && out.length === 0) continue;
    if (/^#{1,3}\s/.test(line) && out.length === 0) continue;
    out.push(line);
  }
  return out.join(" ").trim();
}

function extractLastSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const target = heading.trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const h2 = /^##\s+(.*)$/.exec(lines[i]);
    if (h2 && h2[1].trim().toLowerCase() === target) start = i + 1;
  }
  if (start === -1) return "";
  return lines.slice(start).join("\n").trim();
}

export function parseSkillMarkdown(text: string, label?: string): MarkdownSkillParse {
  const content = text.replace(/^\uFEFF/, "").trim();
  if (!content) return { ok: false, error: "empty markdown file" };

  const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? "";
  const name = deriveName(label, title);
  if (!name) return { ok: false, error: "could not derive a skill name" };

  const curated = splitList(extractMdSection(content, "Triggers")).filter((trigger) => trigger.length < 60);
  const triggers = (curated.length > 0 ? curated : deriveTriggers(name, title)).slice(0, 6);
  if (triggers.length === 0) return { ok: false, error: "no triggers could be derived" };

  const promptSection = extractLastSection(content, "Prompt");
  const prompt = promptSection || content;
  if (prompt.trim().length < 20) return { ok: false, error: "content too thin to be a skill" };

  const purpose = extractMdSection(content, "Purpose") || firstParagraph(content);
  const description = purpose.replace(/\s+/g, " ").trim().slice(0, 160) || name;

  const now = Date.now();
  const category =
    extractMdSection(content, "Category")
      .toLowerCase()
      .split(/\s*\n\s*/)[0] || "custom";

  return {
    ok: true,
    skill: {
      name,
      description,
      category,
      prompt,
      triggers,
      tools: splitList(extractMdSection(content, "Tools")).slice(0, 8),
      examples: splitList(extractMdSection(content, "Examples")).slice(0, 3),
      created: now,
      updated: now,
      usageCount: 0,
      voices: splitList(extractMdSection(content, "Voices")).slice(0, 6),
      combos: splitList(extractMdSection(content, "Recommended Combinations")).slice(0, 6),
    },
  };
}
