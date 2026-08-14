import chalk from "chalk";
import { LineWriter } from "./line-writer.js";
import { termWidth } from "./render.js";

type ProseMode = "normal" | "heading" | "list" | "fence";

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function clampVisible(s: string, width: number): string {
  const plain = stripAnsi(s);
  if (plain.length <= width) return s;
  return `${plain.slice(0, Math.max(1, width - 1))}…`;
}

function isFenceStart(line: string): boolean {
  return line.trimStart().startsWith("```");
}

function codeLang(line: string): string {
  return line.trimStart().slice(3).trim().split(/\s+/)[0] || "code";
}

function classifyLineStart(probe: string): ProseMode | null {
  const trimmed = probe.trimStart();
  if (trimmed === "") return null;
  if ("```".startsWith(trimmed) || trimmed.startsWith("```")) return "fence";
  if (/^#{1,6}\s/.test(trimmed) || /^#{1,6}$/.test(trimmed)) return "heading";
  if (/^[-*]\s/.test(trimmed) || /^[-*]$/.test(trimmed) || /^\d+\.?\s?$/.test(trimmed)) return "list";
  return "normal";
}

export class ChatRenderer {
  private out: NodeJS.WriteStream;
  private prose: LineWriter;
  private prefix: string;
  private wrapPrefix: string;
  private probe = "";
  private probeMode: ProseMode | null = null;
  private codeLine = "";
  private inCode = false;
  private atLineStart = true;

  constructor(out: NodeJS.WriteStream, prefix: string, wrapPrefix?: string) {
    this.out = out;
    this.prefix = prefix;
    this.wrapPrefix = wrapPrefix || " ".repeat(visibleLen(prefix) || 2);
    this.prose = new LineWriter(out, prefix, this.wrapPrefix);
  }

  startLine(): void {
    this.atLineStart = true;
  }

  write(text: string): void {
    for (const ch of text) {
      if (this.inCode) {
        this.writeCodeChar(ch);
      } else {
        this.writeProseChar(ch);
      }
    }
  }

  writeTag(tag: string): void {
    if (this.inCode) {
      if (this.codeLine.length > 0) {
        this.renderCodeLine(this.codeLine);
        this.codeLine = "";
      }
      this.renderCodeEnd();
      this.inCode = false;
      this.atLineStart = true;
    }
    this.flushProbeAsProse();
    this.prose.writeTag(tag);
    this.atLineStart = false;
  }

  flush(): void {
    if (this.inCode) {
      if (this.codeLine.length > 0) {
        if (isFenceStart(this.codeLine)) {
          this.renderCodeEnd();
          this.inCode = false;
        } else {
          this.renderCodeLine(this.codeLine);
        }
        this.codeLine = "";
      }
    } else {
      this.flushProbeAsProse();
    }
    this.prose.flush();
  }

  private writeProseChar(ch: string): void {
    if (this.atLineStart || this.probeMode) {
      this.probe += ch;
      this.evaluateProbe();
      return;
    }
    this.prose.write(ch);
    if (ch === "\n") this.atLineStart = true;
  }

  private evaluateProbe(): void {
    if (this.probe.includes("\n")) {
      const [line, ...rest] = this.probe.split("\n");
      this.probe = "";
      this.renderProbedLine(line);
      this.atLineStart = true;
      const remaining = rest.join("\n");
      if (rest.length > 0) this.write(remaining);
      return;
    }

    const mode = classifyLineStart(this.probe);
    if (!mode) return;
    this.probeMode = mode;
    if (mode === "normal") this.flushProbeAsProse();
  }

  private renderProbedLine(line: string): void {
    const mode = this.probeMode || classifyLineStart(line);
    this.probeMode = null;
    if (mode === "fence" && isFenceStart(line)) {
      this.renderCodeStart(codeLang(line));
      this.inCode = true;
      return;
    }
    if (mode === "heading" && /^#{1,6}\s/.test(line.trimStart())) {
      this.prose.flush();
      this.out.write(`${this.prefix}${chalk.bold.cyan(line.replace(/^#{1,6}\s*/, ""))}\n`);
      return;
    }
    if (mode === "list" && /^\s*(?:[-*]|\d+\.)\s/.test(line)) {
      this.prose.write(line.replace(/^\s*[-*]\s/, "  - ").replace(/^\s*(\d+\.)\s/, "  $1 "));
      this.prose.newline();
      return;
    }
    this.prose.write(line);
    this.prose.newline();
  }

  private flushProbeAsProse(): void {
    if (this.probe.length === 0) return;
    const text = this.probe;
    this.probe = "";
    this.probeMode = null;
    this.prose.write(text);
    this.atLineStart = text.endsWith("\n");
  }

  private writeCodeChar(ch: string): void {
    if (ch === "\r") return;
    if (ch === "\n") {
      const line = this.codeLine;
      this.codeLine = "";
      if (isFenceStart(line)) {
        this.renderCodeEnd();
        this.inCode = false;
        this.atLineStart = true;
      } else {
        this.renderCodeLine(line);
      }
      return;
    }
    this.codeLine += ch;
  }

  private codeWidth(): number {
    return Math.max(24, termWidth() - visibleLen(this.prefix) - 4);
  }

  private renderCodeStart(lang: string): void {
    this.prose.flush();
    const w = this.codeWidth();
    const label = lang ? `${chalk.cyan(lang)}` : "";
    const title = label ? `${label} ${chalk.dim("\u2500".repeat(Math.max(0, w - label.length - 1)))}` : chalk.dim("\u2500".repeat(w));
    this.out.write(`${this.prefix}${chalk.dim(`\u250c ${title} \u2510`)}\n`);
  }

  private renderCodeEnd(): void {
    const w = this.codeWidth();
    this.out.write(`${this.prefix}${chalk.dim(`\u2514 ${"\u2500".repeat(w)} \u2518`)}\n`);
  }

  private renderCodeLine(line: string): void {
    const w = this.codeWidth();
    const clamped = clampVisible(line, w);
    const padding = w - stripAnsi(clamped).length;
    this.out.write(`${this.prefix}${chalk.dim("\u2502")} ${clamped}${" ".repeat(padding)} ${chalk.dim("\u2502")}\n`);
  }
}
