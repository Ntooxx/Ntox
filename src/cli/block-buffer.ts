export class BlockBuffer {
  private buffer = "";
  private min: number;
  private max: number;
  private idle: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flush: (text: string) => void;

  constructor(flush: (text: string) => void, min = 400, max = 1000, idle = 500) {
    this.flush = flush;
    this.min = min;
    this.max = max;
    this.idle = idle;
  }

  write(text: string): void {
    this.buffer += text;
    this.resetTimer();

    if (this.buffer.length >= this.max) {
      this.forceFlush();
    }
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.forceFlush(), this.idle);
  }

  forceFlush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.buffer.length === 0) return;
    const chunk = this.buffer;
    this.buffer = "";
    this.flush(chunk);
  }
}
