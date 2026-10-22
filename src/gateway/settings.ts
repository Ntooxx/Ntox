import type { LLMClient } from "../core/llm.js";
import { getProviders, getProviderNames } from "../core/llm.js";
import { loadCachedModels, patchConfig, saveCachedModels } from "../core/config.js";
import type { ModelInfo, NtoxConfig } from "../types/index.js";

export interface SettingsView {
  model: string;
  provider: string;
  providers: { id: string; name: string }[];
  uiMode: string;
  memoryEnabled: boolean;
  cognitiveEnabled: boolean;
}

export interface WebSettingsService {
  get(): SettingsView;
  listModels(): ModelInfo[];
  refreshModels(): Promise<ModelInfo[]>;
  setModel(model: string): { ok: boolean; settings: SettingsView };
  setProvider(provider: string): { ok: boolean; settings: SettingsView };
}

export function createSettingsService(deps: { config: NtoxConfig; llm: LLMClient }): WebSettingsService {
  const { config, llm } = deps;

  const view = (): SettingsView => {
    const names = getProviderNames();
    return {
      model: config.model,
      provider: config.provider,
      providers: getProviders().map((id) => ({ id, name: names[id] || id })),
      uiMode: config.uiMode,
      memoryEnabled: config.memoryEnabled,
      cognitiveEnabled: config.cognitiveEnabled,
    };
  };

  return {
    get: view,

    listModels() {
      return loadCachedModels() ?? [];
    },

    async refreshModels() {
      const models = await llm.fetchModels();
      if (models.length > 0) saveCachedModels(models);
      return models.length > 0 ? models : (loadCachedModels() ?? []);
    },

    setModel(model) {
      const next = model.trim();
      if (!next) return { ok: false, settings: view() };
      config.model = next;
      llm.updateModel(next);
      Object.assign(config, patchConfig({ model: next }));
      return { ok: true, settings: view() };
    },

    setProvider(provider) {
      const next = provider.trim();
      if (!getProviders().includes(next)) return { ok: false, settings: view() };
      config.provider = next;
      llm.updateProvider(next);
      Object.assign(config, patchConfig({ provider: next }));
      return { ok: true, settings: view() };
    },
  };
}
