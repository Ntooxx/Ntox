import { loadCachedModels, recordCosts, saveCachedModels } from "../core/config.js";
import { usageCost } from "../core/llm.js";
import type { CostUsage, ModelInfo } from "../types/index.js";

export interface SpendSource {
  model: string;
  fetchModels?: () => Promise<ModelInfo[]>;
}

let modelsRequested = false;

function cachedModels(): ModelInfo[] {
  return loadCachedModels() ?? [];
}

function requestModels(source: SpendSource): void {
  if (modelsRequested || !source.fetchModels) return;
  modelsRequested = true;
  void source
    .fetchModels()
    .then((models) => {
      if (models.length > 0) saveCachedModels(models);
    })
    .catch(() => {
      modelsRequested = false;
    });
}

export function recordUsage(usage: CostUsage, source: SpendSource): number {
  const inputTokens = Math.max(0, usage?.inputTokens || 0);
  const outputTokens = Math.max(0, usage?.outputTokens || 0);
  if (inputTokens === 0 && outputTokens === 0) return 0;
  const models = cachedModels();
  if (models.length === 0) requestModels(source);
  const cost = usageCost(usage, source.model);
  recordCosts({ inputTokens, outputTokens, cost });
  return cost;
}
