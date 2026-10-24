import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS_CACHE_PATH } from "../core/paths.js";
import { loadCachedModels, loadCosts, saveCachedModels, saveCosts } from "../core/config.js";
import type { ModelInfo } from "../types/index.js";

const ZERO = { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 };

function modelCard(id: string, prompt: number, completion: number): ModelInfo {
  return { id, name: id, provider: "openrouter", context_length: 8192, pricing: { prompt, completion } };
}

async function freshRecordUsage() {
  vi.resetModules();
  return (await import("./spend.js")).recordUsage;
}

beforeEach(() => {
  saveCosts(ZERO);
  saveCachedModels([]);
});

describe("recordUsage", () => {
  it("accumulates tokens in the lifetime cost file", async () => {
    const recordUsage = await freshRecordUsage();

    recordUsage({ inputTokens: 1200, outputTokens: 300, cost: 0 }, { model: "test-model" });
    recordUsage({ inputTokens: 800, outputTokens: 200, cost: 0 }, { model: "test-model" });

    expect(loadCosts()).toEqual({ totalInputTokens: 2000, totalOutputTokens: 500, totalCost: 0 });
  });

  it("prices tokens from the cached model card when the provider reports no cost", async () => {
    saveCachedModels([modelCard("test-model", 0.003, 0.006)]);
    const recordUsage = await freshRecordUsage();

    recordUsage({ inputTokens: 1000, outputTokens: 500, cost: 0 }, { model: "test-model" });

    expect(loadCosts().totalCost).toBeCloseTo(0.006, 10);
  });

  it("keeps a provider reported cost instead of re-pricing it", async () => {
    saveCachedModels([modelCard("test-model", 0.003, 0.006)]);
    const recordUsage = await freshRecordUsage();

    recordUsage({ inputTokens: 1000, outputTokens: 500, cost: 0.42 }, { model: "test-model" });

    expect(loadCosts().totalCost).toBeCloseTo(0.42, 10);
  });

  it("records tokens for models without known pricing", async () => {
    saveCachedModels([modelCard("other-model", 1, 1)]);
    const recordUsage = await freshRecordUsage();

    recordUsage({ inputTokens: 500, outputTokens: 250, cost: 0 }, { model: "test-model" });

    expect(loadCosts()).toMatchObject({ totalInputTokens: 500, totalOutputTokens: 250, totalCost: 0 });
  });

  it("ignores empty usage", async () => {
    rmSync(MODELS_CACHE_PATH, { force: true });
    const recordUsage = await freshRecordUsage();

    recordUsage({ inputTokens: 0, outputTokens: 0, cost: 0 }, { model: "test-model" });

    expect(loadCosts()).toEqual(ZERO);
    expect(loadCachedModels()).toBeNull();
  });

  it("refreshes the model cache once when pricing is missing", async () => {
    rmSync(MODELS_CACHE_PATH, { force: true });
    const recordUsage = await freshRecordUsage();
    const fetchModels = vi.fn().mockResolvedValue([modelCard("test-model", 0.002, 0.004)]);

    recordUsage({ inputTokens: 10, outputTokens: 5, cost: 0 }, { model: "test-model", fetchModels });
    recordUsage({ inputTokens: 10, outputTokens: 5, cost: 0 }, { model: "test-model", fetchModels });
    await vi.waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));
    expect(loadCachedModels()?.map((entry) => entry.id)).toEqual(["test-model"]);
  });
});