const LF = "\n";

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function clean(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1");
}

export class LineWriter {
  private word = "";
  private out: NodeJS.WriteStream;
  private linePrefix: string;
  private wrapPrefix: string;
  private col = 0;
  private prefixLen = 0;

  constructor(out: NodeJS.WriteStream, prefix: string, wrapPrefix?: string) {
    this.out = out;
    this.linePrefix = prefix;
    this.prefixLen = visibleLen(prefix);
    this.wrapPrefix = wrapPrefix || " ".repeat(this.prefixLen || 2);
    this.col = 0;
  }

  private get width(): number {
    return (this.out.columns || 80) - 1;
  }

  startLine(): void {
    this.col = 0;
    this.writePrefix();
  }

  private writePrefix(): void {
    if (this.col === 0) {
      this.out.write(this.linePrefix);
      this.col = this.prefixLen;
    }
  }

  write(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === LF) {
        this.flushWord();
        this.out.write(LF);
        this.col = 0;
        continue;
      }

      if (ch === "\r") continue;

      if (ch === " " || ch === "\t") {
        this.flushWord();
        if (this.col + 1 >= this.width) {
          this.out.write(LF + this.wrapPrefix);
          this.col = this.prefixLen;
        } else {
          this.out.write(" ");
          this.col++;
        }
        continue;
      }

      this.word += ch;
    }
  }

  private flushWord(): void {
    if (this.word.length === 0) return;

    this.writePrefix();

    let w = clean(this.word);
    const wlen = visibleLen(w);

    if (this.col > this.prefixLen && this.col + wlen > this.width) {
      this.out.write(LF + this.wrapPrefix);
      this.col = this.prefixLen;
    }

    while (visibleLen(w) > this.width - this.col) {
      const split = this.width - this.col;
      let s = "";
      for (let i = 0; i < w.length && visibleLen(s) < split; i++) {
        s += w[i];
      }
      this.out.write(s);
      this.out.write(LF + this.wrapPrefix);
      this.col = this.prefixLen;
      w = w.slice(s.length);
    }

    this.out.write(w);
    this.col += visibleLen(w);
    this.word = "";
  }

  flush(): void {
    this.flushWord();
  }

  newline(): void {
    this.flush();
    this.out.write(LF);
    this.col = 0;
  }

  reset(): void {
    this.flush();
    this.col = 0;
  }

  writeTag(tag: string): void {
    this.flushWord();
    this.write(tag);
    this.flushWord();
  }
}
