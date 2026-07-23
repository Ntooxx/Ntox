import chalk from "chalk";

const FRAMES = "\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F";

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text = "";

  start(text = "thinking"): void {
    if (this.interval) return;
    this.text = text;
    this.frame = 0;

    const tick = () => {
      const f = FRAMES[this.frame % FRAMES.length];
      process.stdout.write(`\r${chalk.hex("#00ccff")("\u2502")} ${chalk.cyan(f)} ${chalk.dim(this.text)}  \x1b[K`);
      this.frame++;
    };
    tick();
    this.interval = setInterval(tick, 80);
  }

  setText(text: string): void {
    this.text = text;
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    process.stdout.write("\r\x1b[K");
  }
}

export function animateExit(): Promise<void> {
  process.stdout.write("\r\x1b[K");
  return Promise.resolve();
}

export function renderVolumeBar(pct: number, width = 10): string {
  const f = Math.round((pct / 100) * width);
  const c = pct > 70 ? chalk.green : pct > 30 ? chalk.yellow : chalk.red;
  return c("\u2588".repeat(f)) + chalk.dim("\u2591".repeat(width - f));
}

export function animateConvergence(): Promise<void> {
  return Promise.resolve();
}
