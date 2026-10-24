import chalk from "chalk";
import { LineWriter } from "./line-writer.js";
import { accents, dimRgb, paint, palette } from "./theme.js";

type ProseMode = "normal" | "heading" | "list" | "fence";

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function wrapVisible(s: string, width: number): string[] {
  if (visibleLen(s) <= width) return [s];
  const rows: string[] = [];
  let row = "";
  let vis = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
      if (m) {
        row += m[0];
        i += m[0].length;
        continue;
      }
    }
    row += s[i];
    i++;
    vis++;
    if (vis >= width) {
      rows.push(row);
      row = "";
      vis = 0;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
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
      this.prose.reset();
      this.inCode = false;
    }
    this.flushProbeAsProse();
    this.prose.writeTag(tag);
    this.atLineStart = true;
  }

  flush(): void {
    if (this.inCode) {
      if (this.codeLine.length > 0) {
        if (isFenceStart(this.codeLine)) {
          this.renderCodeEnd();
          this.prose.reset();
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
      const text = line.replace(/^#{1,6}\s*/, "");
      this.out.write(`${this.prefix}${chalk.bold(paint(palette.accent, text))}\n`);
      return;
    }
    if (mode === "list" && /^\s*(?:[-*]|\d+\.)\s/.test(line)) {
      this.prose.write(line.replace(/^\s*[-*]\s/, `  ${accents.title("•")} `).replace(/^\s*(\d+\.)\s/, "  $1 "));
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
        this.prose.reset();
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
    const cols = Math.min(this.out.columns || 80, 120);
    return Math.max(24, cols - visibleLen(this.prefix) - 5);
  }

  private renderCodeStart(lang: string): void {
    this.prose.flush();
    const w = this.codeWidth();
    const border = paint(dimRgb(palette.accent, 0.55), "─");
    const corner = paint(dimRgb(palette.accent, 0.8), "┌");
    const cornerR = paint(dimRgb(palette.accent, 0.8), "┐");
    const label = lang ? accents.title(lang) : "";
    const title = label ? `${label} ${border.repeat(Math.max(0, w - lang.length - 1))}` : border.repeat(w);
    this.out.write(`${this.prefix}${corner} ${title} ${cornerR}\n`);
  }

  private renderCodeEnd(): void {
    const w = this.codeWidth();
    const border = paint(dimRgb(palette.accent, 0.55), "─");
    const corner = paint(dimRgb(palette.accent, 0.8), "└");
    const cornerR = paint(dimRgb(palette.accent, 0.8), "┘");
    this.out.write(`${this.prefix}${corner} ${border.repeat(w)} ${cornerR}\n`);
  }

  private renderCodeLine(line: string): void {
    const w = this.codeWidth();
    const gutter = paint(dimRgb(palette.accent, 0.5), "│");
    for (const row of wrapVisible(line, w)) {
      const padding = Math.max(0, w - visibleLen(row));
      this.out.write(`${this.prefix}${gutter} ${row}${" ".repeat(padding)} ${gutter}\n`);
    }
  }
}
