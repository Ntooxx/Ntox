import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { createAgentInfra, createAgentConfig } from "../core/dispatcher.js";
import { BriefingEngine } from "../meta/briefing.js";
import { LLMClient, estimateCost, detectLocalProviders, getProviderNames, getProviders, providerRequiresKey, LOCAL_PROVIDERS } from "../core/llm.js";
import { describeError } from "../core/errors.js";
import { Agent } from "../core/agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/episodic.js";
import { UserModel } from "../memory/user-model.js";
import { Reflector } from "../meta/reflector.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { SkillRegistry } from "../skills/registry.js";
import { SkillExecutor } from "../skills/executor.js";
import { SkillLibrary } from "../skills/library.js";
import { learnSkillFromDescription } from "../skills/learner.js";
import { Analytics } from "../meta/analytics.js";
import { ProactiveEngine } from "../meta/proactive.js";
import { CognitiveKernel } from "../cognition/kernel.js";
import { Spinner, animateExit, renderVolumeBar } from "./animation.js";
import { LineWriter } from "./line-writer.js";
import { BlockBuffer } from "./block-buffer.js";
import { setSoundConfig, getSoundConfig, playMelody, testSound } from "./sound.js";
import { playIntro } from "./intro.js";
import { runFirstTimeOnboarding } from "./first-time.js";
import { processAtReferences } from "./at-refs.js";
import {
  loadConfig,
  saveConfig,
  loadCosts,
  saveCosts,
  loadCachedModels,
  saveCachedModels,
} from "../core/config.js";
import type { ModelInfo, Reflection, QueryType } from "../types/index.js";
import {
  renderWelcome,
  renderHelp,
  renderConfig,
  renderCosts,
  renderUsageBar,
  renderMemoryStats,
  renderMetaStats,
  renderMistakeList,
  renderUserPrompt,
  renderAssistantLabel,
  renderUserLabel,
  renderDivider,
  renderInlineTag,
  renderSkillsMenu,
  renderDomainSkills,
  renderModelsMenu,
  renderToolPill,
  renderMemoryPulse,
} from "./render.js";

export class Repl {
  private rl: readline.Interface;
  private config = loadConfig();
  private llm: LLMClient;
  private agent: Agent;
  private tools: ToolRegistry;
  private memory: MemoryStore;
  private userModel: UserModel;
  private reflector: Reflector;
  private mistakes: MistakeJournal;
  private skillRegistry: SkillRegistry;
  private skillExecutor: SkillExecutor;
  private skillLibrary: SkillLibrary;
  private lastBrowsedSkills: { name: string; importance: number; description: string; voices: string[] }[] = [];
  private analytics: Analytics;
  private proactive: ProactiveEngine;
  private cognitiveKernel: CognitiveKernel;
  private sessionId: string;
  private models: ModelInfo[] = [];
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private sessionCost = 0;
  private messageCount = 0;
  private isProcessing = false;
  private lastReflection: Reflection | null = null;
  private lastStrategy: QueryType | null = null;

  private infra: ReturnType<typeof createAgentInfra>;
  private briefingEngine: BriefingEngine;

  constructor() {
    this.sessionId = `sess_${randomUUID().slice(0, 8)}`;
    this.infra = createAgentInfra(this.config);
    this.briefingEngine = new BriefingEngine();

    this.llm = this.infra.llm;
    this.tools = this.infra.tools;
    this.memory = this.infra.memory;
    this.userModel = this.infra.userModel;
    this.mistakes = this.infra.mistakes;
    this.skillRegistry = this.infra.skillRegistry;
    this.skillExecutor = this.infra.skillExecutor;
    this.skillLibrary = this.infra.skillLibrary;
    this.analytics = this.infra.analytics;
    this.proactive = this.infra.proactive;
    this.cognitiveKernel = this.infra.cognitiveKernel;
    this.reflector = new Reflector(this.llm, this.config.metaReflectionEnabled);

    setSoundConfig({ enabled: this.config.soundEnabled, volume: this.config.soundVolume });
    if (this.config.cognitiveEnabled) this.cognitiveKernel.setEnabled(true);

    this.agent = this.createAgent();

    this.rl = readline.createInterface({ input, output });
  }

  private createAgent(): Agent {
    const cfg = createAgentConfig(this.infra, this.config, this.sessionId);
    return new Agent(cfg);
  }

  async start(): Promise<void> {
    if (process.stdout.isTTY) {
      await playIntro();
      process.stdout.write(`\x1b[39m\n  ${chalk.rgb(255,183,77)('>')} ${chalk.dim('loading...')}\n`);
    }

    this.rl = readline.createInterface({ input, output });

    if (!this.config.apiKey && providerRequiresKey(this.config.provider)) {
      await this.promptApiKey();
    }

    try {
      const local = await detectLocalProviders();
      this.localProviders = { ollama: local.ollama, lmstudio: local.lmstudio };
    } catch { /* ignore */ }

    process.on("SIGINT", () => {
      this.handleExit();
    });

    this.llm = new LLMClient(
      this.config.apiKey,
      this.config.model,
      this.config.embeddingModel,
      this.config.maxTokens,
      this.config.temperature,
      this.config.apiBaseUrl,
      this.config.provider
   );
    this.reflector = new Reflector(this.llm, this.config.metaReflectionEnabled);
    this.agent = this.createAgent();
    this.agent.setSkillsCount(this.skillRegistry.count());
    this.userModel.startSession();
    await runFirstTimeOnboarding(this.userModel, this.rl);
    await this.loadModels();
    this.skillLibrary.scan();
    this.agent.initKernel(this.config.model);

    const providerNames = getProviderNames();
    const providerLabel = providerNames[this.config.provider] || this.config.provider;

    console.log(renderWelcome(this.config.model, providerLabel));
    playMelody("startup");
    this.showAutoBrief();
    this.loop();
  }

  private async promptApiKey(): Promise<void> {
    const providerNames = getProviderNames();
    const localProviders = LOCAL_PROVIDERS;
    const apiProviders = Object.entries(providerNames).filter(([k]) => !localProviders.includes(k));

    console.log(chalk.bold("\n  Welcome to NTOX!\n"));
    console.log(chalk.dim("  I need an AI provider to work. Choose one:\n"));

    // Auto-detect local
    let localOllama = false, localLmstudio = false;
    try {
      const local = await detectLocalProviders();
      localOllama = local.ollama;
      localLmstudio = local.lmstudio;
    } catch { /* ignore */ }

    let idx = 1;
    if (localOllama) {
      console.log(`  ${chalk.cyan(`${idx}.`)} ${chalk.bold("Ollama")} ${chalk.green("(detected)")} ${chalk.dim("— no key needed, local models")}`);
      idx++;
    }
    if (localLmstudio) {
      console.log(`  ${chalk.cyan(`${idx}.`)} ${chalk.bold("LM Studio")} ${chalk.green("(detected)")} ${chalk.dim("— no key needed, local models")}`);
      idx++;
    }
    for (const [key, name] of apiProviders) {
      console.log(`  ${chalk.cyan(`${idx}.`)} ${chalk.bold(name)} ${chalk.dim(`(${key})`)}`);
      idx++;
    }

    console.log(chalk.dim(`\n  ${idx}. Configure later`));
    console.log(chalk.dim("  Or press Enter to skip setup.\n"));

    return new Promise((resolve) => {
      this.rl.question(chalk.cyan("  Select: "), async (answer) => {
        const trimmed = answer.trim();
        if (!trimmed) {
          console.log(chalk.dim("  Skipping setup. Use /config to set up later.\n"));
          saveConfig(this.config);
          resolve();
          return;
        }

        const num = parseInt(trimmed);
        const localDetected: Array<{ key: string; name: string }> = [];
        if (localOllama) localDetected.push({ key: "ollama", name: "Ollama" });
        if (localLmstudio) localDetected.push({ key: "lmstudio", name: "LM Studio" });
        const apiOptions = apiProviders.map(([k, n]) => ({ key: k, name: n }));
        const allOptions = [...localDetected, ...apiOptions];
        const selectedIdx = num >= 1 && num <= allOptions.length ? num - 1 : -1;

        if (selectedIdx >= 0) {
          const selected = allOptions[selectedIdx];
          this.config.provider = selected.key;

          if (selected.key === "ollama" || selected.key === "lmstudio") {
            saveConfig(this.config);
            console.log(chalk.green(`  Using ${selected.name}. No API key needed.\n`));
            resolve();
            return;
          }

          if (selected.key === "openai-compatible") {
            this.rl.question(chalk.cyan("  API base URL (e.g. http://localhost:8000/v1): "), (url) => {
              if (url.trim()) this.config.apiBaseUrl = url.trim();
              this.rl.question(chalk.cyan("  API key (optional, press Enter to skip): "), (key) => {
                if (key.trim()) this.config.apiKey = key.trim();
                saveConfig(this.config);
                console.log(chalk.green(`  Configured ${selected.name}.\n`));
                resolve();
              });
            });
          } else {
            this.rl.question(chalk.cyan(`  Enter your ${selected.name} API key: `), (key) => {
              if (key.trim()) this.config.apiKey = key.trim();
              saveConfig(this.config);
              console.log(chalk.green(`  Configured ${selected.name}. Config saved to ~/.ntox/config.json\n`));
              resolve();
            });
          }
        } else {
          console.log(chalk.dim("  Skipping setup.\n"));
          saveConfig(this.config);
          resolve();
        }
      });
    });
  }

  private localProviders: { ollama: boolean; lmstudio: boolean } = { ollama: false, lmstudio: false };

  private async loadModels(): Promise<void> {
    // Detect local providers quickly
    try {
      const local = await detectLocalProviders();
      this.localProviders = { ollama: local.ollama, lmstudio: local.lmstudio };

      const cached = loadCachedModels();
      if (cached && cached.length > 0) {
        this.models = cached;
        // Merge local models into cache if not present
        const existingIds = new Set(this.models.map((m) => m.id));
        for (const m of [...local.ollamaModels, ...local.lmstudioModels]) {
          if (!existingIds.has(m.id)) this.models.push(m);
        }
        return;
      }
      this.models = await this.llm.fetchModels();
      saveCachedModels(this.models);
    } catch (e) {
      console.log(chalk.yellow(`Could not fetch models: ${e}`));
      this.models = [];
    }
  }

  private loop(): void {
    if (this.exiting) return;
      this.rl.question(renderUserPrompt(this.messageCount + 1), async (input) => {
        if (this.exiting) return;
        try {
          const trimmed = input.trim();
        if (!trimmed) { this.loop(); return; }

        if (this.isProcessing) {
          console.log(chalk.yellow("Still processing previous request..."));
          this.loop();
          return;
        }

        if (trimmed.startsWith("/")) {
          if (this.isProcessing && (trimmed === "/exit" || trimmed === "/quit")) {
            console.log(chalk.yellow("Can't exit while processing. Please wait."));
            this.loop();
            return;
          }
          await this.handleCommand(trimmed);
          this.loop();
          return;
        }

        process.stdout.write(`\n${renderDivider()}\n`);
        process.stdout.write(`${renderUserLabel()}${chalk.white(trimmed)}\n`);
        this.isProcessing = true;
        await this.handleMessage(trimmed);
        this.isProcessing = false;
        this.loop();
        } catch (err) {
          this.isProcessing = false;
          console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
          this.loop();
        }
    });
  }

  private async handleCommand(input: string): Promise<void> {
    const [cmd, ...args] = input.slice(1).split(/\s+/);
    const arg = args.join(" ");

    switch (cmd) {
      case "ask":
      case "help":
        console.log(renderHelp());
        break;
      case "menu": {
        await this.handleMenuCommand(arg);
        break;
      }
      case "model":
        await this.handleModelCommand(arg);
        break;
      case "provider":
        this.handleProviderCommand(arg);
        break;
      case "sound":
        await this.handleSoundCommand(arg);
        break;
      case "kernel": {
        // Try handling as kernel command first, otherwise show status
        if (arg) {
          const fullInput = `/${cmd} ${arg}`;
          const result = await this.agent.handleKernelMessage(fullInput, {
            onToken: (token) => process.stdout.write(token),
            onToolCall: () => {},
            onToolResult: () => {},
            onUsage: () => {},
            onThinking: () => {},
          });
          if (result !== null) break;
        }
        // Show kernel status
        console.log(this.agent.isKernelEnabled()
          ? chalk.green("Kernel active. Use /kernel <command>")
          : chalk.yellow("Kernel inactive. Enable with /config or init with /kernel create/read/run"));
        break;
      }
      case "config": {
        const [sub, key, ...valParts] = arg.split(/\s+/);
        if (sub === "set" && key && valParts.length >= 0) {
          const val = valParts.join(" ");
          if (!val) {
            console.log(chalk.yellow("Usage: /config set <key> <value>"));
            console.log(chalk.dim("Example: /config set telegramToken 123456:ABCdef"));
            break;
          }
          const cfg = this.config as unknown as Record<string, unknown>;
          if (val === "true") cfg[key] = true;
          else if (val === "false") cfg[key] = false;
          else if (/^\d+$/.test(val)) cfg[key] = parseInt(val, 10);
          else if (/^\d+\.\d+$/.test(val)) cfg[key] = parseFloat(val);
          else cfg[key] = val;
          saveConfig(this.config);
          console.log(chalk.green(`Set ${key} = ${val}`));

          if (key === "model") {
            this.llm.updateModel(String(cfg[key]));
          }

          if (key === "provider") {
            this.llm.updateProvider(String(cfg[key]));
            const modelPrefix = this.config.model.split("/")[0];
            if (modelPrefix && getProviders().includes(modelPrefix) && modelPrefix !== String(cfg[key]) && cfg[key] !== "openrouter") {
              console.log(chalk.yellow(
                `  Warning: Current model "${this.config.model}" has prefix "${modelPrefix}/" but provider is "${cfg[key]}".\n` +
                `  Tip: Use /model to select a compatible model, or switch back with /provider ${modelPrefix}.`
              ));
            }
          }
        } else {
          this.printConfig();
        }
        break;
      }
      case "cost":
        this.printCosts();
        break;
      case "memory":
        await this.handleMemoryCommand(arg);
        break;
      case "meta":
        this.printMeta();
        break;
      case "mistakes":
        this.printMistakes();
        break;
      case "profile":
        this.handleProfileCommand(arg);
        break;
      case "skill":
        await this.handleSkillCommand(arg);
        break;
      case "analytics":
        this.printAnalytics();
        break;
      case "suggest":
        this.printSuggestion();
        break;
      case "cognition":
        this.handleCognitiveCommand(arg);
        break;
      case "clear":
        this.agent.resetConversation();
        this.llm.resetSessionTokens();
        this.sessionInputTokens = 0;
        this.sessionOutputTokens = 0;
        this.sessionCost = 0;
        this.messageCount = 0;
        this.lastReflection = null;
        this.lastStrategy = null;
        console.log(chalk.dim("Conversation cleared."));
        break;
      case "reset":
        this.agent.resetConversation();
        this.llm.resetSessionTokens();
        this.sessionInputTokens = 0;
        this.sessionOutputTokens = 0;
        this.sessionCost = 0;
        this.messageCount = 0;
        this.memory.clearAll();
        this.mistakes.clearAll();
        this.lastReflection = null;
        this.lastStrategy = null;
        console.log(chalk.dim("Everything reset (memory + mistakes)."));
        break;
      case "brief":
        this.handleBriefCommand();
        break;
      case "focus":
        this.handleFocusCommand(arg);
        break;
      case "goals":
        this.handleGoalsCommand();
        break;
      case "benchmark":
        await this.handleBenchmark();
        break;
      case "exit":
      case "quit":
        this.handleExit();
        break;
      default:
        console.log(chalk.red(`Unknown command: /${cmd}. Type /help for commands.`));
    }
  }

  private handleMemoryCommand(arg: string): void {
    const parts = arg.split(/\s+/);
    const sub = parts[0];

    switch (sub) {
      case "": {
        const stats = this.memory.getStats();
        console.log(renderMemoryStats(stats));
        break;
      }
      case "search": {
        const query = parts.slice(1).join(" ");
        if (!query) { console.log(chalk.yellow("Usage: /memory search <query>")); return; }
        const results = this.memory.search(query, 10);
        if (results.length === 0) { console.log(chalk.dim("No matching memories.")); return; }
        console.log(chalk.bold(`\nSearch results for "${query}":`));
        for (const ep of results) {
          const date = new Date(ep.timestamp).toISOString().slice(0, 10);
          console.log(`\n  ${chalk.cyan(ep.id)} ${chalk.dim(date)}`);
          console.log(`  ${chalk.dim("Q:")} ${ep.summary}`);
          const preview = ep.assistantResponse.replace(/\s+/g, " ").slice(0, 120);
          console.log(`  ${chalk.dim("A:")} ${preview}...`);
        }
        break;
      }
      case "last": {
        const count = parseInt(parts[1], 10) || 5;
        const recent = this.memory.getRecent(count);
        if (recent.length === 0) { console.log(chalk.dim("No memories yet.")); return; }
        console.log(chalk.bold(`\nLast ${recent.length} memories:`));
        for (const ep of recent) {
          const date = new Date(ep.timestamp).toISOString().slice(0, 10);
          console.log(`\n  ${chalk.cyan(ep.id)} ${chalk.dim(date)}`);
          console.log(`  ${chalk.dim("Q:")} ${ep.summary}`);
        }
        break;
      }
      case "clear": {
        this.memory.clearAll();
        console.log(chalk.dim("All memories cleared."));
        break;
      }
      default:
        console.log(chalk.yellow("Memory: /memory, /memory search <q>, /memory last <n>, /memory clear"));
    }
  }

  private handleProfileCommand(arg: string): void {
    const parts = arg.split(/\s+/);
    const sub = parts[0];

    switch (sub) {
      case "": {
        console.log(chalk.bold("\nUser Profile:"));
        console.log(this.userModel.getSummary());
        break;
      }
      case "set": {
        const key = parts[1];
        const value = parts.slice(2).join(" ");
        if (!key || !value) {
          console.log(chalk.yellow("Usage: /profile set <key> <value>"));
          console.log(chalk.dim("Keys: verbosity (concise/balanced/detailed), technical (beginner/intermediate/expert), name <name>"));
          return;
        }
        switch (key) {
          case "verbosity":
            if (["concise", "balanced", "detailed"].includes(value)) {
              this.userModel.setPreference("verbosity", value as "concise" | "balanced" | "detailed");
              console.log(chalk.green(`Verbosity set to ${value}`));
            } else {
              console.log(chalk.red("Valid: concise, balanced, detailed"));
            }
            break;
          case "technical":
            if (["beginner", "intermediate", "expert"].includes(value)) {
              this.userModel.setPreference("technicalLevel", value as "beginner" | "intermediate" | "expert");
              console.log(chalk.green(`Technical level set to ${value}`));
            } else {
              console.log(chalk.red("Valid: beginner, intermediate, expert"));
            }
            break;
          case "name":
            this.userModel.setName(value);
            console.log(chalk.green(`Name set to ${value}`));
            break;
          default:
            console.log(chalk.yellow("Unknown key. Try: verbosity, technical, name"));
        }
        break;
      }
      case "goal": {
        const subcmd = parts[1];
        if (subcmd === "add") {
          const goal = parts.slice(2).join(" ");
          if (!goal) {
            console.log(chalk.yellow("Usage: /profile goal add <description>"));
            return;
          }
          if (/\d{4}-\d{2}-\d{2}/.test(goal)) {
            // Has a date
            const dateMatch = goal.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
              const desc = goal.replace(dateMatch[0], "").trim();
              const newGoal = this.userModel.addGoal(desc, "general", new Date(dateMatch[1]).getTime());
              console.log(chalk.green(`Goal added: ${newGoal.description}`));
            }
          } else {
            const newGoal = this.userModel.addGoal(goal, "general");
            console.log(chalk.green(`Goal added: ${newGoal.description}`));
          }
        } else if (subcmd === "done" || subcmd === "complete") {
          const goalId = parts[2];
          if (!goalId) { console.log(chalk.yellow("Usage: /profile goal done <goalId>")); return; }
          this.userModel.completeGoal(goalId);
          console.log(chalk.green("Goal marked as completed."));
        } else if (subcmd === "remove") {
          const goalId = parts[2];
          if (!goalId) { console.log(chalk.yellow("Usage: /profile goal remove <goalId>")); return; }
          this.userModel.removeGoal(goalId);
          console.log(chalk.dim("Goal removed."));
        } else {
          console.log(chalk.dim("Usage: /profile goal add <desc>, /profile goal done <id>, /profile goal remove <id>"));
        }
        break;
      }
      default:
        console.log(chalk.yellow("Commands: /profile, /profile set <key> <val>, /profile goal add|done|remove"));
    }
  }

  private async handleSkillCommand(arg: string): Promise<void> {
    const parts = arg.split(/\s+/);
    const sub = parts[0];

    switch (sub) {
      case "": {
        const skills = this.skillRegistry.list();
        if (skills.length === 0) {
          console.log(chalk.dim("\nNo skills available."));
          return;
        }
        console.log(chalk.bold(`\nSkills (${skills.length}):`));
        for (const s of skills) {
          const count = chalk.dim(`used ${s.usageCount}x`);
          console.log(`  ${chalk.cyan(s.name)} ${chalk.dim(s.description)} ${count}`);
          console.log(`    ${chalk.dim("triggers:")} ${s.triggers.join(", ")}`);
        }
        break;
      }
      case "show": {
        const name = parts.slice(1).join(" ");
        if (!name) { console.log(chalk.yellow("Usage: /skill show <name>")); return; }
        const skill = this.skillRegistry.get(name);
        if (!skill) { console.log(chalk.red(`Skill "${name}" not found.`)); return; }
        console.log(chalk.bold(`\nSkill: ${skill.name}`));
        console.log(`  ${chalk.dim("Description:")} ${skill.description}`);
        console.log(`  ${chalk.dim("Category:    ")} ${skill.category}`);
        console.log(`  ${chalk.dim("Triggers:    ")} ${skill.triggers.join(", ")}`);
        console.log(`  ${chalk.dim("Tools:       ")} ${skill.tools.join(", ") || "none"}`);
        console.log(`  ${chalk.dim("Examples:    ")} ${skill.examples.join(", ") || "none"}`);
        console.log(`  ${chalk.dim("Usage:       ")} ${skill.usageCount}x`);
        console.log(`  ${chalk.dim("Prompt:      ")} ${skill.prompt.slice(0, 300)}...`);
        break;
      }
      case "learn": {
        const description = parts.slice(1).join(" ");
        if (!description) {
          console.log(chalk.yellow("Usage: /skill learn <description of what the skill should do>"));
          return;
        }
        console.log(chalk.dim("Learning skill..."));
        try {
          const skill = await learnSkillFromDescription(this.llm, description);
          this.skillRegistry.add(skill);
          console.log(chalk.green(`Learned skill: ${skill.name}`));
          console.log(chalk.dim(`  Triggers: ${skill.triggers.join(", ")}`));
          console.log(chalk.dim(`  Tools: ${skill.tools.join(", ") || "none"}`));
        } catch (e) {
          console.log(chalk.red(`Failed to learn skill: ${e}`));
        }
        break;
      }
      case "forget":
      case "remove": {
        const name = parts.slice(1).join(" ");
        if (!name) { console.log(chalk.yellow("Usage: /skill forget <name>")); return; }
        const removed = this.skillRegistry.remove(name);
        if (removed) {
          console.log(chalk.dim(`Skill "${name}" removed.`));
        } else {
          console.log(chalk.yellow(`Could not remove "${name}". It may be built-in.)`));
        }
        break;
      }
      case "library": {
        const stats = this.skillLibrary.getStats();
        const domains = this.skillLibrary.getDomains();
        console.log(chalk.bold(`\nSkill Library (${stats.total} skills, ${stats.domains} domains, ${stats.totalSizeKB}KB)`));
        for (const d of domains) {
          const skills = this.skillLibrary.get(d);
          console.log(`  ${chalk.cyan(d)} (${skills.length})`);
        }
        console.log(chalk.dim("\nUse /skill browse <domain> to see skills."));
        break;
      }
      case "browse": {
        const domain = parts.slice(1).join(" ");
        if (!domain) {
          console.log(chalk.yellow("Usage: /skill browse <domain>"));
          console.log(chalk.dim(`Domains: ${this.skillLibrary.getDomains().join(", ")}`));
          return;
        }
        const skills = this.skillLibrary.get(domain);
        if (skills.length === 0) {
          console.log(chalk.yellow(`No skills found in "${domain}".`));
          return;
        }
        this.lastBrowsedSkills = skills.map((s) => ({ name: s.name, importance: s.importance, description: s.description, voices: s.voices }));
        console.log(renderDomainSkills(domain, this.lastBrowsedSkills));
        break;
      }
      case "load": {
        const name = parts.slice(1).join(" ");
        if (!name) {
          console.log(chalk.yellow("Usage: /skill load <name or number>"));
          return;
        }

        // Support number selection: /skill load 3
        const numMatch = name.match(/^(\d+)$/);
        if (numMatch) {
          const lastBrowse = this.lastBrowsedSkills;
          if (lastBrowse && lastBrowse.length > 0) {
            const idx = parseInt(numMatch[1]) - 1;
            if (idx >= 0 && idx < lastBrowse.length) {
              const selected = lastBrowse[idx];
              await this.loadSkillByName(selected.name);
              return;
            }
          }
          console.log(chalk.yellow("No recent skill list. Use /menu skills <domain> first."));
          return;
        }

        await this.loadSkillByName(name);
        break;
      }
      default:
        console.log(chalk.yellow("Commands: /skill, /skill show <name>, /skill learn <desc>, /skill forget <name>, /skill library, /skill browse <domain>, /skill load <name>"));
    }
  }

  private async loadSkillByName(name: string): Promise<void> {
    const content = this.skillLibrary.loadContent(name);
    if (!content) { console.log(chalk.yellow(`Skill "${name}" not found.`)); return; }
    const skill = this.skillLibrary.byName(name);
    if (!skill) return;
    const skillDef: import("../types/index.js").SkillDefinition = {
      name: skill.name,
      description: skill.description,
      category: skill.domain,
      prompt: `## ${skill.name} (Skill Context)\n\n${content.slice(0, 2000)}...`,
      triggers: skill.triggers,
      tools: [], examples: [],
      created: Date.now(), updated: Date.now(), usageCount: 0,
      domain: skill.domain, importance: skill.importance, isExternal: true,
    };
    this.skillRegistry.add(skillDef);
    console.log(chalk.green(`Loaded: ${skill.name} (${skill.sizeKB}KB)`));
    if (skill.voices.length > 0) console.log(chalk.dim(`  Voices: ${skill.voices.join(", ")}`));
    if (skill.combos.length > 0) console.log(chalk.dim(`  Combos: ${skill.combos.slice(0, 3).join(", ")}`));
  }

  private handleCognitiveCommand(arg: string): void {
    const parts = arg.split(/\s+/);
    const sub = parts[0];

    if (sub === "on" || sub === "enable") {
      this.cognitiveKernel.setEnabled(true);
      this.config.cognitiveEnabled = true;
      saveConfig(this.config);
      console.log(chalk.green("Cognitive Kernel activated."));
      console.log(chalk.dim("  Patterns: compression → pattern retrieval → sparse activation → critique"));
      return;
    }

    if (sub === "off" || sub === "disable") {
      this.cognitiveKernel.setEnabled(false);
      this.config.cognitiveEnabled = false;
      saveConfig(this.config);
      console.log(chalk.dim("Cognitive Kernel deactivated. Using standard strategy+skill routing."));
      return;
    }

    if (sub === "sync") {
      console.log(chalk.yellow("Research sync not available in this version."));
      return;
    }

    // Show status
    const enabled = this.cognitiveKernel.isEnabled();
    const patterns = this.cognitiveKernel.getPatterns();
    const compStats = patterns.getCompilationStats();

    console.log(chalk.bold(`\nCognitive Kernel: ${enabled ? chalk.green("ACTIVE") : chalk.dim("inactive")}`));
    console.log(`  ${chalk.dim("Patterns:          ")} ${patterns.count()} total`);
    console.log(`  ${chalk.dim("Compiled patterns: ")} ${chalk.cyan(compStats.compiled.toString())}`);
    console.log(`  ${chalk.dim("Abstract patterns: ")} ${chalk.magenta(compStats.abstract.toString())} (merged from 2+ patterns)`);
    console.log(`  ${chalk.dim("Seed base:         ")} ${compStats.seed}`);

    const allPatterns = patterns.list().slice(0, 5);
    if (allPatterns.length > 0) {
      console.log(`  ${chalk.dim("Top Patterns:")}`);
      for (const p of allPatterns) {
        let status = chalk.dim(`strength: ${(p.strength * 100).toFixed(0)}%`);
        if (p.compiledTemplate) status += chalk.green(" [compiled]");
        if (p.id.startsWith("pat_compiled")) status += chalk.magenta(" [abstract]");
        if (p.id.startsWith("pat_research")) status += chalk.cyan(" [research]");
        if (p.compileCount >= 3) status += chalk.yellow(` [${p.compileCount}/5 compiling]`);
        console.log(`    ${chalk.cyan(p.name)} ${status}`);
        console.log(`      ${chalk.dim(p.domains.join(", "))}`);
      }
    }

    console.log(`  ${chalk.dim("Commands:")} /cognition on, /cognition off, /cognition sync`);
  }

  private printAnalytics(): void {
    const summary = this.analytics.getSummary();
    console.log(chalk.bold("\nAnalytics:"));
    for (const line of summary.split("\n")) {
      console.log(`  ${chalk.dim("→")} ${line}`);
    }
  }

  private async handleMenuCommand(arg: string): Promise<void> {
    const parts = arg.split(/\s+/);
    const sub = parts[0];
    const rest = parts.slice(1).join(" ");

    if (!sub || sub === "help") {
      console.log(renderHelp());
      return;
    }

    if (sub === "skills" || sub === "library") {
      if (!rest) {
        const domains = this.skillLibrary.getDomains();
        console.log(renderSkillsMenu(domains, this.skillLibrary.getStats().total));
        return;
      }
      const skills = this.skillLibrary.get(rest);
      if (skills.length === 0) {
        console.log(chalk.yellow(`No skills in domain "${rest}".`));
        return;
      }
      console.log(renderDomainSkills(
        rest,
        skills.map((s) => ({ name: s.name, importance: s.importance, description: s.description, voices: s.voices }))
      ));
      return;
    }

    if (sub === "model" || sub === "models") {
      if (this.models.length === 0) {
        console.log(chalk.yellow("No models loaded."));
        return;
      }
      console.log(renderModelsMenu(this.models, this.config.model));
      return;
    }

    console.log(chalk.yellow(`Unknown menu: "${sub}". Try /help.`));
  }

  private handleBriefCommand(): void {
    const exec = this.infra.executive;
    const observations = this.infra.observation ? (() => {
      try { return this.infra.observation.getAll(); } catch { return []; }
    })() : [];
    const mentalModel = this.infra.mentalModel ? (() => {
      try { return this.infra.mentalModel.getAllEntries(); } catch { return []; }
    })() : [];

    const ctx = {
      statedFocus: exec.getStatedFocus(),
      goals: exec.getActiveGoals(),
      risks: exec.getRisks(),
      constraints: exec.getConstraints(),
      observations: observations.slice(-20),
      beliefs: mentalModel,
      sessionCount: this.userModel.getProfile().sessionsCount,
      lastSessionEndAt: this.userModel.getProfile().lastSessionEnd || 0,
      lastBriefAt: 0,
      bondLevel: 0,
    };

    const brief = this.briefingEngine.generate(ctx);
    if (brief.type === "none") {
      console.log(chalk.dim("\n  Nothing notable right now. Everything looks aligned."));
      return;
    }
    console.log(chalk.cyan(this.briefingEngine.formatBrief(brief)));
  }

  private handleFocusCommand(arg: string): void {
    const exec = this.infra.executive;
    if (!arg) {
      const current = exec.getStatedFocus();
      console.log(current ? `Current focus: ${chalk.cyan(current)}` : chalk.dim("No focus set. Use /focus <goal>"));
      return;
    }
    exec.setFocus(arg);
    console.log(chalk.green(`Focus set: ${arg}`));
  }

  private handleGoalsCommand(): void {
    const exec = this.infra.executive;
    const goals = exec.getActiveGoals();
    if (goals.length === 0) {
      console.log(chalk.dim("No active goals. Tell NTOX about your goals to track them."));
      return;
    }
    console.log(chalk.bold("\n  Active Goals:"));
    for (const g of goals) {
      const bar = g.progress > 0 ? ` ${g.progress}%` : "";
      console.log(`    ${chalk.cyan(g.id.slice(0, 8))} ${g.description}${chalk.dim(bar)}`);
    }
    console.log("");
  }

  private showAutoBrief(): void {
    const exec = this.infra.executive;
    const observations = this.infra.observation ? (() => {
      try { return this.infra.observation.getAll(); } catch { return []; }
    })() : [];

    const ctx = {
      statedFocus: exec.getStatedFocus(),
      goals: exec.getActiveGoals(),
      risks: exec.getRisks(),
      constraints: exec.getConstraints(),
      observations: observations.slice(-20),
      beliefs: [],
      sessionCount: this.userModel.getProfile().sessionsCount,
      lastSessionEndAt: this.userModel.getProfile().lastSessionEnd || 0,
      lastBriefAt: 0,
      bondLevel: 0,
    };

    const brief = this.briefingEngine.generate(ctx);
    if (brief.type === "none") return;

    const formatted = this.briefingEngine.formatBrief(brief);
    if (!formatted) return;

    console.log(chalk.cyan(formatted));
  }

  private async handleBenchmark(): Promise<void> {
    console.log(chalk.bold("\n  NTOX Cognitive Kernel Benchmark"));
    console.log(chalk.dim("  Testing kernel ON vs kernel OFF across 20 queries...\n"));

    const judgeLLM = new LLMClient(
      this.config.apiKey, this.config.model, this.config.embeddingModel,
      this.config.maxTokens, this.config.temperature, this.config.apiBaseUrl, this.config.provider
    );

    const { runBenchmark } = await import("../benchmark/runner.js");
    const { saveReport, saveReportMarkdown, generateReport } = await import("../benchmark/report.js");

    const report = await runBenchmark(judgeLLM, (msg) => {
      console.log(chalk.dim(`  ${msg}`));
    });

    const jsonPath = saveReport(report);
    const mdPath = saveReportMarkdown(report);

    console.log("\n" + generateReport(report));
    console.log(chalk.green(`\n  Report saved:`));
    console.log(chalk.dim(`    JSON: ${jsonPath}`));
    console.log(chalk.dim(`    MD:   ${mdPath}`));
  }

  private printSuggestion(): void {
    const profile = this.userModel.getProfile();
    const sessionIntent = this.agent.getSessionIntent();
    const suggestion = this.proactive.generate(
      profile,
      this.messageCount,
      this.skillRegistry.count(),
      this.memory.count(),
      sessionIntent
    );
    if (suggestion) {
      console.log(chalk.bold(`\n${suggestion.type === "goal-reminder" ? "Goal:" : "Suggestion:"}`));
      console.log(`  ${suggestion.message}`);
    } else {
      console.log(chalk.dim("\nNo suggestions right now."));
    }
  }

  private printMeta(): void {
    const metaConfig = {
      strategyEnabled: this.config.metaStrategyEnabled,
      reflectionEnabled: this.config.metaReflectionEnabled,
      mistakesEnabled: this.config.metaMistakesEnabled,
      minConfidenceThreshold: this.config.metaMinConfidence,
    };
    console.log(renderMetaStats(
      metaConfig,
      this.lastStrategy,
      this.lastReflection,
      this.mistakes.getStats()
    ));
  }

  private printMistakes(): void {
    const all = this.mistakes.getAll();
    console.log(renderMistakeList(all));
  }

  private async handleModelCommand(arg: string): Promise<void> {
    if (this.models.length === 0) {
      console.log(chalk.yellow("No model data. Fetching..."));
      try {
        this.models = await this.llm.fetchModels();
        saveCachedModels(this.models);
      } catch (e) {
        console.log(chalk.red(`Failed: ${e}`));
        return;
      }
    }

    const numMatch = arg.match(/^(\d+)$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1]) - 1;
      const allModels = this.models;
      if (idx >= 0 && idx < allModels.length) {
        const selected = allModels[idx];
        this.config.model = selected.id;
        if (selected.provider && selected.provider !== "openrouter") {
          this.config.provider = selected.provider;
        } else {
          this.config.provider = "openrouter";
        }
        saveConfig(this.config);
        this.llm.updateModel(selected.id);
        this.llm.updateProvider(this.config.provider);
        const providerTag = selected.provider && selected.provider !== "openrouter"
          ? chalk.dim(` [${getProviderNames()[selected.provider] || selected.provider}]`)
          : "";
        console.log(chalk.green(`Switched to ${selected.name}${providerTag}`));
        return;
      }
      console.log(chalk.red(`No model #${idx + 1}. Use /menu models to see options.`));
      return;
    }

    if (arg) {
      const lower = arg.toLowerCase();
      const match = this.models.find((m) => m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower));
      if (match) {
        this.config.model = match.id;
        if (match.provider && match.provider !== "openrouter") {
          this.config.provider = match.provider;
        } else {
          this.config.provider = "openrouter";
        }
        saveConfig(this.config);
        this.llm.updateModel(match.id);
        this.llm.updateProvider(this.config.provider);
        const providerTag = match.provider && match.provider !== "openrouter"
          ? chalk.dim(` [${getProviderNames()[match.provider] || match.provider}]`)
          : "";
        console.log(chalk.green(`Switched to ${match.name}${providerTag}`));
        return;
      }
      console.log(chalk.red(`No model matching "${arg}".`));
      return;
    }

    console.log(renderModelsMenu(this.models, this.config.model));
    console.log(chalk.dim("\nType /model <number> or /model <name> to switch."));
  }

  private handleProviderCommand(arg: string): void {
    const providerNames = getProviderNames();
    if (!arg) {
      console.log(chalk.bold(`\nCurrent provider: ${chalk.cyan(providerNames[this.config.provider] || this.config.provider)}`));
      console.log(chalk.bold(`Model: ${chalk.yellow(this.config.model)}`));
      if (this.config.apiBaseUrl) {
        console.log(chalk.dim(`API Base URL: ${this.config.apiBaseUrl}`));
      }
      console.log(chalk.dim("\nAvailable providers:"));
      for (const [key, name] of Object.entries(providerNames)) {
        const active = key === this.config.provider ? chalk.green(" ← active") : "";
        const requiresKey = !["ollama", "lmstudio"].includes(key);
        console.log(`  ${chalk.cyan(key.padEnd(20))} ${name}${requiresKey ? "" : chalk.dim(" (no key needed)")}${active}`);
      }
      console.log(chalk.dim("\nSwitch: /provider <name>"));
      console.log(chalk.dim("Set custom endpoint: /provider openai-compatible <url>"));
      return;
    }

    const lower = arg.toLowerCase().split(/\s+/)[0];
    const urlPart = arg.slice(lower.length).trim();

    const matched = Object.keys(providerNames).find((k) => k === lower || k.includes(lower));
    if (!matched) {
      console.log(chalk.red(`Unknown provider "${lower}".`));
      return;
    }

    this.config.provider = matched;
    if (matched === "openai-compatible" && urlPart) {
      this.config.apiBaseUrl = urlPart;
    }
    if (matched === "openai-compatible" && !this.config.apiBaseUrl) {
      this.config.apiBaseUrl = "http://localhost:8000/v1";
    }

    // Validate model/provider compatibility
    const modelPrefix = this.config.model.split("/")[0];
    if (modelPrefix && getProviders().includes(modelPrefix) && modelPrefix !== matched && matched !== "openrouter") {
      console.log(
        chalk.yellow(
          `  Warning: Current model "${this.config.model}" has prefix "${modelPrefix}/" but provider is "${matched}".\n` +
          `  Tip: Use /model to select a model from ${getProviderNames()[matched] || matched}, or switch back with /provider ${modelPrefix}.`
        )
      );
    }

    saveConfig(this.config);
    console.log(chalk.green(`Switched to provider: ${providerNames[matched]} (${matched})`));
    if (matched === "openai-compatible") {
      console.log(chalk.dim(`API Base URL: ${this.config.apiBaseUrl}`));
    }
  }

  private async handleSoundCommand(arg: string): Promise<void> {
    const parts = arg.trim().toLowerCase().split(/\s+/);
    const sub = parts[0];

    if (!sub) {
      const cfg = getSoundConfig();
      console.log(chalk.bold("\n  Sound"));
      console.log(`  ${chalk.dim("enabled:")} ${cfg.enabled ? chalk.green("✓ on") : chalk.red("✗ off")}`);
      console.log(`  ${chalk.dim("volume: ")} ${cfg.volume}% ${renderVolumeBar(cfg.volume)}`);
      console.log(chalk.dim(`\n  /sound on         — Enable sounds`));
      console.log(chalk.dim(`  /sound off        — Disable sounds`));
      console.log(chalk.dim(`  /sound volume <n> — Set volume (0-100)`));
      console.log(chalk.dim(`  /sound test       — Test your speakers`));
      return;
    }

    if (sub === "on" || sub === "true" || sub === "1") {
      this.config.soundEnabled = true;
      saveConfig(this.config);
      setSoundConfig({ enabled: true, volume: this.config.soundVolume });
      console.log(chalk.green("Sound enabled"));
      playMelody("notification");
      return;
    }

    if (sub === "off" || sub === "false" || sub === "0") {
      this.config.soundEnabled = false;
      saveConfig(this.config);
      setSoundConfig({ enabled: false, volume: this.config.soundVolume });
      console.log(chalk.red("Sound disabled"));
      return;
    }

    if (sub === "volume") {
      const vol = parseInt(parts[1]);
      if (isNaN(vol) || vol < 0 || vol > 100) {
        console.log(chalk.red("Volume must be 0-100"));
        return;
      }
      this.config.soundVolume = vol;
      saveConfig(this.config);
      setSoundConfig({ enabled: this.config.soundEnabled, volume: vol });
      console.log(chalk.green(`Volume set to ${vol}%`));
      return;
    }

    if (sub === "test") {
      console.log(chalk.dim("Testing sound..."));
      await testSound();
      console.log(chalk.green("Sound test complete"));
      return;
    }

    console.log(chalk.red(`Unknown sound command: ${sub}`));
  }

  private printConfig(): void {
    const modelInfo = this.models.find((m) => m.id === this.config.model);
    const providerNames = getProviderNames();
    console.log(renderConfig(
      this.config.model,
      this.config.maxTokens,
      this.config.temperature,
      modelInfo?.context_length ?? null,
      this.config.embeddingModel,
      this.config.memoryEnabled,
      this.memory.count(),
      providerNames[this.config.provider] || this.config.provider,
      this.config.apiBaseUrl,
      this.config.telegramToken
    ));
  }

  private printCosts(): void {
    const lifetime = loadCosts();
    console.log(renderCosts(
      this.sessionInputTokens,
      this.sessionOutputTokens,
      this.sessionCost,
      lifetime.totalInputTokens,
      lifetime.totalOutputTokens,
      lifetime.totalCost
    ));
  }

  private async handleMessage(userInput: string): Promise<void> {
    this.messageCount++;
    const expandedInput = await processAtReferences(userInput);
    const modelInfo = this.models.find((m) => m.id === this.config.model);
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let hasStarted = false;

    if (!this.config.apiKey && providerRequiresKey(this.config.provider)) {
      console.log(chalk.red("No API key configured. Use /config to set one."));
      return;
    }

    const writer = new LineWriter(process.stdout, renderAssistantLabel(), "  ");
    process.stdout.write(renderAssistantLabel());
    const spinner = new Spinner();
    spinner.start();
    const blockBuffer = new BlockBuffer((text) => writer.write(text));

    const startOutput = () => {
      if (hasStarted) return;
      hasStarted = true;
      spinner.stop();
      process.stdout.write("\r");
      writer.startLine();
    };

    const streamResult = this.agent.run(expandedInput, {
      onToken: (token) => {
        startOutput();
        blockBuffer.write(token);
      },
      onToolCall: (name) => {
        startOutput();
        if (this.config.animationLevel !== "off") {
          writer.writeTag(renderInlineTag(renderToolPill(name, "running"), chalk.dim));
        } else {
          writer.writeTag(renderInlineTag(`tool: ${name}`, chalk.dim));
        }
      },
      onToolResult: (name, result) => {
        if (this.config.animationLevel !== "off") {
          writer.writeTag(renderInlineTag(renderToolPill(name, result.success ? "done" : "failed"), chalk.dim));
        }
        if (result.success) playMelody("done");
        else playMelody("error");
      },
      onUsage: (usage) => {
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
      },
      onThinking: (thought) => {
        if (hasStarted) writer.writeTag(renderInlineTag(thought, chalk.dim));
      },
      onPhase: (phase) => {
        if (this.config.animationLevel !== "off") {
          spinner.setPhase(phase);
        }
      },
      onMemoryRecall: (count) => {
        if (this.config.animationLevel !== "off") {
          writer.writeTag(renderInlineTag(renderMemoryPulse("recalled", count), chalk.dim));
        } else {
          writer.writeTag(renderInlineTag(`recalled ${count} memories`, chalk.dim));
        }
      },
      onMemoryStore: () => {
        if (this.config.animationLevel !== "off") {
          writer.writeTag(renderInlineTag(renderMemoryPulse("stored", 1), chalk.dim));
        }
        playMelody("memory");
      },
      onStrategy: (type) => {
        this.lastStrategy = type;
        spinner.setText(type);
      },
      onReflection: (reflection) => {
        this.lastReflection = reflection;
        if (reflection.confidence < this.config.metaMinConfidence) {
          writer.writeTag(renderInlineTag(
            `confidence: ${(reflection.confidence * 100).toFixed(0)}% — gaps: ${reflection.knowledgeGaps.join(", ") || "none"}`,
            chalk.yellow
          ));
        }
      },
      onCorrectionDetected: (topicKey) => {
        writer.writeTag(renderInlineTag(`correction logged: ${topicKey}`, chalk.yellow));
      },
      onSkillTriggered: (name, confidence) => {
        writer.writeTag(renderInlineTag(`skill: ${name} (${(confidence * 100).toFixed(0)}%)`, chalk.magenta));
      },
      onProactiveSuggestion: (suggestion) => {
        if (suggestion.type === "milestone" || suggestion.type === "feedback-prompt") return;
        const color = suggestion.type === "goal-reminder" ? chalk.green : chalk.cyan;
        writer.writeTag(renderInlineTag(suggestion.message, color));
      },
      onCognitive: (summary) => {
        spinner.setText(summary);
      },
      onStyleGuidance: (guidance) => {
        if (guidance.includes("Keep being")) return;
        writer.writeTag(renderInlineTag(`style: ${guidance}`, chalk.cyan));
      },
      onSelfAwareness: (message) => {
        if (message.includes("communicate in a") || message.includes("learn best via")) return;
        writer.writeTag(renderInlineTag(message, chalk.green));
      },
      onFeedbackRequest: (question) => {
        writer.writeTag(renderInlineTag(question, chalk.yellow));
      },
    });

    let streamError: Error | null = null;
    try {
      for await (const _ of streamResult) { /* drain */ }
      if (!hasStarted && totalInputTokens === 0) {
        spinner.stop();
        const providerHint = providerRequiresKey(this.config.provider)
          ? `\n  Check: API key (/config), model name (/model), or provider (/provider).`
          : `\n  Check: Is ${this.config.provider} running on ${this.config.apiBaseUrl || "localhost"}?`;
        console.log(chalk.red(`(no response from model — check your provider/model settings)${providerHint}`));
      }
    } catch (err) {
      streamError = err instanceof Error ? err : new Error(String(err));
    } finally {
      spinner.stop();
    }

    blockBuffer.forceFlush();
    writer.flush();

    try {
      const cost = estimateCost(this.config.model, totalInputTokens, totalOutputTokens, this.models);
      this.sessionInputTokens += totalInputTokens;
      this.sessionOutputTokens += totalOutputTokens;
      this.sessionCost += cost;

      if (!streamError && totalInputTokens > 0) {
        const lifetime = loadCosts();
        lifetime.totalInputTokens += totalInputTokens;
        lifetime.totalOutputTokens += totalOutputTokens;
        lifetime.totalCost += cost;
        saveCosts(lifetime);
      }

      if (!streamError) {
        const ctxTokens = this.agent.countTokens();
        process.stdout.write(`\n${renderDivider()}\n${renderUsageBar(
          { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost },
          modelInfo,
          modelInfo ? { used: ctxTokens, limit: modelInfo.context_length } : undefined
        )}\n`);
      }

      if (streamError) {
        const info = describeError(streamError);
        const hint = info.hint ? `\n  Hint: ${info.hint}.` : "";
        console.log(chalk.red(`\n  Stream error: ${info.message}${hint}`));
      }
    } catch (err) {
      console.log(chalk.red(`\nFailed to record usage: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  private exiting = false;

  private handleExit(): void {
    if (this.exiting) return;
    this.exiting = true;
    try { this.rl.close(); } catch { /* already closed */ }
    animateExit().then(() => {
      this.doExit();
    }).catch(() => {
      this.doExit();
    });
  }

  private doExit(): void {
    try {
      const awarenessSummary = this.agent.recordSessionEnd(this.sessionId);
      this.userModel.endSession();
      this.userModel.flush();
      const lifetime = loadCosts();
      if (this.sessionCost > 0) {
        console.log(chalk.dim(
          `\nSession: ${this.fmtTokens(this.sessionInputTokens)} in, ${this.fmtTokens(this.sessionOutputTokens)} out, ${this.fmtCost(this.sessionCost)}`
        ));
        console.log(chalk.dim(`Memory: ${this.memory.count()} episodes | Skills: ${this.skillRegistry.count()} | Mistakes: ${this.mistakes.getStats().total}`));
        console.log(chalk.dim(`Bond: ${this.agent.getBondLabel()}`));
        if (awarenessSummary) console.log(chalk.dim(`Learned: ${awarenessSummary}`));
        console.log(chalk.dim(
          `Lifetime: ${this.fmtTokens(lifetime.totalInputTokens)} in, ${this.fmtTokens(lifetime.totalOutputTokens)} out, ${this.fmtCost(lifetime.totalCost)}`
        ));
      }
    } catch { /* best-effort exit */ }
    console.log(chalk.green("\nGoodbye! \u2014 Ntox"));
    process.exit(0);
  }

  private fmtTokens(n: number): string {
    if (n < 1000) return `${n}`;
    return `${(n / 1000).toFixed(1)}k`;
  }

  private fmtCost(cost: number): string {
    if (cost < 0.001) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(3)}`;
  }
}
