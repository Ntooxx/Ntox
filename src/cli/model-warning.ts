import chalk from "chalk";
import { modelSupportsTools } from "../core/llm.js";
import type { ModelInfo } from "../types/index.js";

export function warnModelTools(models: ModelInfo[], modelId: string): void {
  const current = models.find((model) => model.id === modelId);
  if (modelSupportsTools(current) === false) {
    console.log(
      chalk.yellow(
        `Warning: "${modelId}" does not advertise tool support — the agent will not be able to call tools. Switch with /model.`,
      ),
    );
  }
}
