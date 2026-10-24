import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { createAgentInfra, createAgentConfig } from "../core/dispatcher.js";
import { runAgentStream, computeTurnTimeoutMs } from "../core/message-handler.js";
import { BriefingEngine } from "../meta/briefing.js";
import {
  LLMClient,
  estimateCost,
  detectLocalProviders,
  getProviderNames,
  getProviders,
  providerRequiresKey,
  modelSupportsTools,
  formatTokenCount,
  LOCAL_PROVIDERS,
} from "../core/llm.js";
import { describeError } from "../core/errors.js";
import { Agent } from "../core/agent.js";
import { Reflector } from "../meta/reflector.js";
import { createIdleJobs } from "../mind/jobs.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/episodic.js";
import { UserModel } from "../memory/user-model.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { SkillRegistry } from "../skills/registry.js";
import { SkillLibrary } from "../skills/library.js";
import { learnSkillFromDescription } from "../skills/learner.js";
import { renderSkillProposal } from "../skills/auto-learner.js";
import { installSkillFromSource, renderSkillInstallResult } from "../skills/installer.js";
import { createMarketplace, renderMarketplaceList, type SkillMarketplace } from "../skills/marketplace.js";
import { diffSkillByName, renderSkillStats } from "../skills/lifecycle.js";
import { createRoutineRuntime, renderRoutineRun, runRoutine } from "../skills/routine.js";
import { renderMcpStatus } from "../mcp/bridge.js";
import { handleChannelCommand, type ChannelCommandContext } from "../core/channel-commands.js";
import {
  parseSkillInstallCommand,
  parseSkillLifecycleCommand,
  parseSkillMarketplaceCommand,
} from "../gateway/commands.js";
import { Analytics } from "../meta/analytics.js";
import { ProactiveEngine } from "../meta/proactive.js";
import { CognitiveKernel } from "../cognition/kernel.js";
import {
  loadTheoryStore,
  getTheoryHierarchy,
  confirmTheory,
  disconfirmTheory,
  detectDomain,
} from "../research/theory-store.js";
import { TransferStore, findTransferCandidates, type TransferTheoryView } from "../research/transfer.js";
import { freshProfile, profileComponents, profileDivergence } from "../mind/profile.js";
import { promoteOpinions } from "../mind/opinion.js";
import { assessM5, collectAliveRun, loadAliveRuns, saveAliveRun } from "../benchmark/alive.js";
import { loadVoiceABStats } from "../benchmark/voice-ab.js";
import {
  formatPatternDetail,
  formatPatternOverview,
  formatTheoryDetail,
  formatTheoryEvidence,
  formatTheoryOverview,
} from "./inspect.js";
import { approvalStore, setInteractiveApproval } from "../tools/approval.js";
import { Spinner, animateExit } from "./animation.js";
import { BlockBuffer } from "./block-buffer.js";
import { ChatRenderer } from "./chat-renderer.js";
import { playIntro } from "./intro.js";
import { normalizeCommandName, parseTokenLimit } from "./commands.js";
import { runFirstTimeOnboarding } from "./first-time.js";
import { processAtReferences } from "./at-refs.js";
import { getFileChangesSince, renderFileChanges } from "../tools/change-tracker.js";
import { loadConfig, patchConfig, loadCosts, saveCosts, loadCachedModels, saveCachedModels } from "../core/config.js";
import type { ModelInfo, Reflection, QueryType, AgentTurnTrace, NtoxConfig } from "../types/index.js";
import type { SkillDefinition } from "../types/index.js";
import {
  renderHeaderBar,
  renderStatusBar,
  renderHelp,
  renderConfig,
  renderCosts,
  renderMemoryStats,
  renderMetaStats,
  renderMistakeList,
  renderUserPrompt,
  renderAssistantLabel,
  renderInlineTag,
  renderSkillsMenu,
  renderDomainSkills,
  renderModelsMenu,
  renderToolPill,
  renderToolEvent,
  renderMemoryPulse,
  renderTips,
  renderLastTurn,
  renderBriefCard,
  termWidth,
} from "./render.js";
import { revealBlock, sweepDivider } from "./motion.js";
import { accents, gradient, palette } from "./theme.js";

const MODEL_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export class Repl {
  private rl!: readline.Interface;
  private config = loadConfig();
  private llm: LLMClient;
  private agent: Agent;
  private tools: ToolRegistry;
  private memory: MemoryStore;
  private userModel: UserModel;
  private mistakes: MistakeJournal;
  private skillRegistry: SkillRegistry;
  private skillLibrary: SkillLibrary;
  private lastBrowsedSkills: { name: string; importance: number; description: string; voices: string[] }[] = [];
  private analytics: Analytics;
  private proactive: ProactiveEngine;
  private cognitiveKernel: CognitiveKernel;
  private sessionId: string;
  private models: ModelInfo[] = [];
  private modelCatalogUpdatedAt = 0;
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private sessionCost = 0;
  private messageCount = 0;
  private isProcessing = false;
  private activeTurnAbort: AbortController | null = null;
  private lastSubmittedInput: string | null = null;
  private lastReflection: Reflection | null = null;
  private lastStrategy: QueryType | null = null;
  private pendingSkillProposal: SkillDefinition | null = null;
  private skillMarketplaceInstance: SkillMarketplace | null = null;
  private skillMarketplaceSource: string | null = null;
  private thinkingChars = 0;
  private turnStartedAtMs = 0;

  private get marketplace(): SkillMarketplace {
    const source = this.config.skillMarketplaceIndex;
    if (!this.skillMarketplaceInstance || this.skillMarketplaceSource !== source) {
      this.skillMarketplaceInstance = createMarketplace({ indexSource: source });
      this.skillMarketplaceSource = source;
    }
    return this.skillMarketplaceInstance;
  }

  private infra: ReturnType<typeof createAgentInfra>;
  private briefingEngine: BriefingEngine;
  private resumeSessionId?: string;

  constructor(options: { resumeSessionId?: string } = {}) {
    this.resumeSessionId = options.resumeSessionId;
    this.sessionId = options.resumeSessionId || `sess_${randomUUID().slice(0, 8)}`;
    this.infra = createAgentInfra(this.config);
    this.briefingEngine = new BriefingEngine();

    this.llm = this.infra.llm;
    this.tools = this.infra.tools;
    this.memory = this.infra.memory;
    this.userModel = this.infra.userModel;
    this.mistakes = this.infra.mistakes;
    this.skillRegistry = this.infra.skillRegistry;
    this.skillLibrary = this.infra.skillLibrary;
    this.analytics = this.infra.analytics;
    this.proactive = this.infra.proactive;
    this.cognitiveKernel = this.infra.cognitiveKernel;

    if (this.config.cognitiveEnabled) this.cognitiveKernel.setEnabled(true);

    this.agent = this.createAgent();
  }

  private createAgent(): Agent {
    const cfg = createAgentConfig(this.infra, this.config, this.sessionId, { sessionSource: "repl" });
    return new Agent(cfg);
  }

  private channelCommandContext(): ChannelCommandContext {
    return {
      config: this.config,
      llm: this.llm,
      tools: this.tools,
      skills: this.skillRegistry,
      memory: this.memory,
      policy: this.infra.policy,
      agent: this.agent,
      models: this.models,
      sessionId: this.sessionId,
    };
  }

  async start(): Promise<void> {
    if (process.stdout.isTTY && this.config.introEnabled) {
      await playIntro();
    }

    if (!this.config.apiKey && providerRequiresKey(this.config.provider)) {
      await this.promptApiKey();
    }

    const bootSpinner = new Spinner();
    if (process.stdout.isTTY && this.config.animationLevel !== "off") {
      bootSpinner.start("initializing");
    }

    this.probeLocalProvidersInBackground();

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
      this.config.provider,
    );
    this.agent = this.createAgent();
    let resumeMessage: string | null = null;
    if (this.resumeSessionId) {
      const restored = this.agent.restoreSession(this.sessionId);
      if (restored.restored) {
        const saved = restored.savedAt ? new Date(restored.savedAt).toLocaleString() : "unknown";
        this.messageCount = this.agent.getMessages().filter((message) => message.role === "user").length;
        resumeMessage = `Resumed ${this.sessionId} (${restored.messageCount} messages, saved ${saved})`;
      } else {
        resumeMessage = `No saved session found for ${this.sessionId}; starting fresh.`;
      }
    }
    this.agent.setSkillsCount(this.skillRegistry.count());
    this.userModel.startSession();
    bootSpinner.stop();
    await runFirstTimeOnboarding(this.userModel);
    this.loadModelsCached();
    this.infra.aliveHosts?.start();
    if (this.config.idleEnabled === true) {
      try {
        this.wireIdleJobs();
        this.infra.mind?.idle.setActivity();
        this.infra.mind?.idle.start();
        const queuedProposals = this.infra.mind?.idle.drainProposals() ?? [];
        if (queuedProposals.length > 0) {
          console.log(chalk.bold("\nqueued while away"));
          for (const proposal of queuedProposals) console.log(`  ${chalk.dim("•")} ${proposal}`);
        }
      } catch (e) {
        console.error("[idle]", e);
      }
    }
    this.refreshModelsInBackground();
    this.connectMcpServersInBackground();
    this.agent.initKernel(this.config.model);

    const providerNames = getProviderNames();
    const providerLabel = providerNames[this.config.provider] || this.config.provider;

    await revealBlock(
      renderHeaderBar(this.config.model, providerLabel, {
        memoryCount: this.memory.count(),
      }),
      { enabled: this.config.animationLevel !== "off" },
    );
    process.stdout.write("\n");
    if (resumeMessage) console.log(chalk.cyan(resumeMessage), "\n");
    await this.showAutoBrief();
    this.rl = readline.createInterface({ input, output });
    this.registerApprovalPrompt();
    this.loop();
  }

  private registerApprovalPrompt(): void {
    setInteractiveApproval(async (toolName, command) => {
      const preview = command.length > 160 ? `${command.slice(0, 160)}…` : command;
      Spinner.pauseGlobally(true);
      try {
        console.log("");
        console.log(`  ${accents.warn("▲")} ${chalk.bold("approval needed")} ${accents.soft(`· ${toolName}`)}`);
        console.log(`    ${chalk.dim(preview.replace(/\s+/g, " "))}`);
        const answer = await new Promise<string>((resolve) => {
          this.rl.question(
            `  ${accents.gold("?")} allow? ${accents.soft("[y] once · [s] session · [a] always · [N] no")} `,
            resolve,
          );
        });
        const a = answer.trim().toLowerCase();
        if (a === "y" || a === "yes") return "allow-once";
        if (a === "s" || a === "session") return "allow-session";
        if (a === "a" || a === "always") return "allow-always";
        return "deny";
      } catch {
        return "deny";
      } finally {
        Spinner.pauseGlobally(false);
      }
    });
  }

  private async promptApiKey(): Promise<void> {
    const providerNames = getProviderNames();
    const localProviders = LOCAL_PROVIDERS;
    const apiProviders = Object.entries(providerNames).filter(([k]) => !localProviders.includes(k));

    console.log("");
    console.log(`  ${gradient("Welcome to NTOX", palette.accent, palette.violet)}`);
    console.log(chalk.dim("  I need an AI provider to work. Choose one:\n"));

    // Auto-detect local
    let localOllama = false,
      localLmstudio = false;
    try {
      const local = await detectLocalProviders();
      localOllama = local.ollama;
      localLmstudio = local.lmstudio;
    } catch {
      /* ignore */
    }

    let idx = 1;
    if (localOllama) {
      console.log(
        `  ${accents.title(`${idx}.`)} ${chalk.bold("Ollama")} ${accents.good("(detected)")} ${chalk.dim("— no key needed, local models")}`,
      );
      idx++;
    }
    if (localLmstudio) {
      console.log(
        `  ${accents.title(`${idx}.`)} ${chalk.bold("LM Studio")} ${accents.good("(detected)")} ${chalk.dim("— no key needed, local models")}`,
      );
      idx++;
    }
    for (const [key, name] of apiProviders) {
      console.log(`  ${accents.title(`${idx}.`)} ${chalk.bold(name)} ${chalk.dim(`(${key})`)}`);
      idx++;
    }

    console.log(chalk.dim(`\n  ${idx}. Configure later`));
    console.log(chalk.dim("  Or press Enter to skip setup.\n"));

    const tempRl = this.rl || readline.createInterface({ input, output });
    return new Promise((resolve) => {
      const done = () => {
        if (!this.rl) tempRl.close();
      };
      tempRl.question(chalk.cyan("  Select: "), async (answer) => {
        const trimmed = answer.trim();
        if (!trimmed) {
          console.log(chalk.dim("  Skipping setup. Use /config to set up later.\n"));
          done();
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
            this.config = patchConfig({ provider: selected.key });
            console.log(chalk.green(`  Using ${selected.name}. No API key needed.\n`));
            done();
            resolve();
            return;
          }

          if (selected.key === "openai-compatible") {
            tempRl.question(chalk.cyan("  API base URL (e.g. http://localhost:8000/v1): "), (url) => {
              if (url.trim()) this.config.apiBaseUrl = url.trim();
              tempRl.question(chalk.cyan("  API key (optional, press Enter to skip): "), (key) => {
                this.config = patchConfig({
                  provider: selected.key,
                  ...(this.config.apiBaseUrl ? { apiBaseUrl: this.config.apiBaseUrl } : {}),
                  ...(key.trim() ? { apiKey: key.trim() } : {}),
                });
                console.log(chalk.green(`  Configured ${selected.name}.\n`));
                done();
                resolve();
              });
            });
          } else {
            tempRl.question(chalk.cyan(`  Enter your ${selected.name} API key: `), (key) => {
              this.config = patchConfig({
                provider: selected.key,
                ...(key.trim() ? { apiKey: key.trim() } : {}),
              });
              console.log(chalk.green(`  Configured ${selected.name}. Config saved to ~/.ntox/config.json\n`));
              done();
              resolve();
            });
          }
        } else {
          console.log(chalk.dim("  Skipping setup.\n"));
          done();
          resolve();
        }
      });
    });
  }

  private localProviders: { ollama: boolean; lmstudio: boolean } = { ollama: false, lmstudio: false };

  private loadModelsCached(): void {
    const cached = loadCachedModels();
    if (cached && cached.length > 0) this.models = cached;
  }

  private refreshModelsInBackground(): void {
    if (this.modelCatalogUpdatedAt && Date.now() - this.modelCatalogUpdatedAt < MODEL_REFRESH_INTERVAL_MS) return;
    void this.refreshModels().catch(() => {
      /* catalog refresh is best-effort */
    });
  }

  private probeLocalProvidersInBackground(): void {
    void detectLocalProviders()
      .then((local) => {
        this.localProviders = { ollama: local.ollama, lmstudio: local.lmstudio };
      })
      .catch(() => {
        /* local provider probe is best-effort */
      });
  }

  private connectMcpServersInBackground(): void {
    if (Object.keys(this.config.mcpServers ?? {}).length === 0) return;
    void this.infra.mcp
      .connectAll()
      .then((statuses) => {
        const connected = statuses.filter((status) => status.state === "connected");
        const toolCount = connected.reduce((total, status) => total + status.tools.length, 0);
        if (connected.length > 0) {
          console.log(chalk.dim(`MCP: ${connected.length} server(s) connected, ${toolCount} tool(s) available — /mcp`));
        }
        for (const status of statuses) {
          if (status.state === "failed") console.log(chalk.yellow(`MCP "${status.name}" failed: ${status.error}`));
        }
      })
      .catch((error: unknown) => {
        console.error("[mcp]", error);
      });
  }

  private async refreshModels(): Promise<boolean> {
    const models = await this.llm.fetchModels();
    if (models.length === 0) return false;
    this.models = models;
    this.modelCatalogUpdatedAt = Date.now();
    saveCachedModels(models);
    this.warnCurrentModelTools();
    return true;
  }

  private warnCurrentModelTools(): void {
    const current = this.models.find((m) => m.id === this.config.model);
    if (modelSupportsTools(current) === false) {
      console.log(
        chalk.yellow(
          `Warning: "${this.config.model}" does not advertise tool support — the agent will not be able to call tools. Switch with /model.`,
        ),
      );
    }
  }

  private loop(): void {
    if (this.exiting) return;
    this.rl.question(renderUserPrompt(this.messageCount + 1, this.config.model) + " ", async (input) => {
      if (this.exiting) return;
      try {
        const trimmed = input.trim();
        if (!trimmed) {
          this.loop();
          return;
        }
        this.infra.mind?.idle.setActivity();

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

        process.stdout.write("\n");
        await sweepDivider(termWidth(), this.config.animationLevel !== "off");
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
    const [rawCmd, ...args] = input.slice(1).split(/\s+/);
    const cmd = normalizeCommandName(rawCmd);
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
      case "ui":
        this.handleUiCommand(arg);
        break;
      case "status":
        this.printStatus();
        break;
      case "last":
        this.printLastTurn();
        break;
      case "tips":
        console.log(renderTips());
        break;
      case "doctor":
        await this.printDoctor();
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
        console.log(
          this.agent.isKernelEnabled()
            ? chalk.green("Kernel active. Use /kernel <command>")
            : chalk.yellow("Kernel inactive. Enable with /config or init with /kernel create/read/run"),
        );
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
          if (key === "maxTokens") {
            const parsed = parseTokenLimit(val);
            if (parsed === null) {
              console.log(chalk.yellow("maxTokens must be a positive safe integer. Use /tokens <number>."));
              break;
            }
            cfg[key] = parsed;
          } else if (val === "true") cfg[key] = true;
          else if (val === "false") cfg[key] = false;
          else if (/^\d+$/.test(val)) cfg[key] = parseInt(val, 10);
          else if (/^\d+\.\d+$/.test(val)) cfg[key] = parseFloat(val);
          else cfg[key] = val;
          this.config = patchConfig({ [key]: cfg[key] } as Partial<NtoxConfig>);
          if (key === "maxTokens" || key === "temperature") {
            this.llm.updateParams(this.config.maxTokens, this.config.temperature);
          }
          console.log(chalk.green(`Set ${key} = ${val}`));

          if (key === "model") {
            this.llm.updateModel(String(cfg[key]));
          }

          if (key === "apiKey") {
            this.llm.updateKey(String(cfg[key]));
            console.log(chalk.dim("  API key applied to the running session — no restart needed."));
          }

          if (key === "provider") {
            this.llm.updateProvider(String(cfg[key]));
            const modelPrefix = this.config.model.split("/")[0];
            if (
              modelPrefix &&
              getProviders().includes(modelPrefix) &&
              modelPrefix !== String(cfg[key]) &&
              cfg[key] !== "openrouter"
            ) {
              console.log(
                chalk.yellow(
                  `  Warning: Current model "${this.config.model}" has prefix "${modelPrefix}/" but provider is "${cfg[key]}".\n` +
                    `  Tip: Use /model to select a compatible model, or switch back with /provider ${modelPrefix}.`,
                ),
              );
            }
          }
        } else {
          this.printConfig();
        }
        break;
      }
      case "tokens": {
        const requested = arg.trim();
        if (!requested) {
          console.log(
            `Model output limit: ${this.config.maxTokens.toLocaleString()} tokens\n` +
              `Set it for this account with /tokens <number> (example: /tokens 64000).\n` +
              `This is the requested output cap. Your provider or model may enforce a lower maximum; larger values can increase latency and cost.`,
          );
          break;
        }
        const maxTokens = parseTokenLimit(requested);
        if (maxTokens === null) {
          console.log(chalk.yellow("Usage: /tokens <positive integer> (example: /tokens 64000)"));
          break;
        }
        this.config = patchConfig({ maxTokens });
        this.llm.updateParams(this.config.maxTokens, this.config.temperature);
        console.log(
          chalk.green(`Model output limit set to ${maxTokens.toLocaleString()} tokens.`) +
            chalk.dim(" Provider/model limits still apply; higher limits may increase latency and cost."),
        );
        break;
      }
      case "cost":
        this.printCosts();
        break;
      case "undo":
        this.undoLastExchange();
        break;
      case "retry":
        await this.retryLastExchange();
        break;
      case "memory":
        await this.handleMemoryCommand(arg);
        break;
      case "remember":
        this.handleRememberCommand(arg);
        break;
      case "forget":
        this.handleForgetCommand(arg);
        break;
      case "meta":
        this.printMeta();
        break;
      case "mind":
        await this.handleMindCommand(arg);
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
      case "skills":
      case "tools":
      case "plan": {
        const outcome = await handleChannelCommand(`/${cmd} ${arg}`.trim(), this.channelCommandContext());
        if (outcome) console.log(outcome.text);
        break;
      }
      case "mcp":
        console.log(renderMcpStatus(this.infra.mcp.statuses()));
        break;
      case "analytics":
        this.printAnalytics();
        break;
      case "trace":
        this.printTrace();
        break;
      case "alive":
        this.printAlive();
        break;
      case "diff":
        this.printLastDiff();
        break;
      case "checkpoints":
        await this.printCheckpoints(arg);
        break;
      case "rollback":
        await this.rollbackCheckpoint(arg);
        break;
      case "workspace":
        this.printWorkspace();
        break;
      case "permissions":
        this.printPermissions();
        break;
      case "agents":
        await this.printAgents();
        break;
      case "approve":
        this.handleApproveCommand(arg);
        break;
      case "suggest":
        this.printSuggestion();
        break;
      case "cognition":
        this.handleCognitiveCommand(arg);
        break;
      case "patterns":
        this.handlePatternsCommand(arg);
        break;
      case "theories":
        this.handleTheoriesCommand(arg);
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
        await this.handleBriefCommand();
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

  private parseMemoryLane(raw: string): "fact" | "preference" | "decision" | "task" | "note" | null {
    const lane = raw.toLowerCase().replace(/s$/, "");
    if (["fact", "preference", "decision", "task", "note"].includes(lane)) {
      return lane as "fact" | "preference" | "decision" | "task" | "note";
    }
    return null;
  }

  private formatDurableMemory(memory: ReturnType<MemoryStore["listDurableMemories"]>[number]): string {
    const date = new Date(memory.updatedAt).toISOString().slice(0, 10);
    return `${chalk.cyan(memory.id)} ${chalk.dim(date)} ${chalk.yellow(memory.lane)} ${memory.text}`;
  }

  private handleRememberCommand(arg: string): void {
    const [laneRaw, ...textParts] = arg.trim().split(/\s+/);
    const lane = this.parseMemoryLane(laneRaw || "");
    const text = textParts.join(" ").trim();
    if (!lane || !text) {
      console.log(chalk.yellow("Usage: /remember <fact|preference|decision|task|note> <text>"));
      return;
    }
    const memory = this.memory.addDurableMemory(lane, text, "manual /remember");
    console.log(chalk.green(`Remembered ${memory.id}`));
  }

  private handleForgetCommand(arg: string): void {
    const id = arg.trim();
    if (!id) {
      console.log(chalk.yellow("Usage: /forget <memoryId>"));
      return;
    }
    console.log(
      this.memory.deleteDurableMemory(id) ? chalk.dim(`Forgot ${id}.`) : chalk.yellow(`No durable memory found: ${id}`),
    );
  }

  private handleMemoryCommand(arg: string): void {
    const parts = arg.split(/\s+/);
    const sub = parts[0];

    switch (sub) {
      case "": {
        const stats = this.memory.getStats();
        console.log(renderMemoryStats(stats));
        const durable = this.memory.listDurableMemories();
        if (durable.length > 0) {
          console.log(chalk.bold("\nDurable memories:"));
          for (const memory of durable.slice(0, 8)) console.log(`  ${this.formatDurableMemory(memory)}`);
          if (durable.length > 8) console.log(chalk.dim(`  ... +${durable.length - 8} more`));
        }
        break;
      }
      case "facts":
      case "preferences":
      case "decisions":
      case "tasks":
      case "notes": {
        const lane = this.parseMemoryLane(sub);
        const memories = lane ? this.memory.listDurableMemories(lane) : [];
        if (memories.length === 0) {
          console.log(chalk.dim(`No ${sub} saved.`));
          return;
        }
        console.log(chalk.bold(`\n${sub}:`));
        for (const memory of memories) console.log(`  ${this.formatDurableMemory(memory)}`);
        break;
      }
      case "why": {
        const id = parts[1];
        if (!id) {
          console.log(chalk.yellow("Usage: /memory why <memoryId>"));
          return;
        }
        const memory = this.memory.getDurableMemory(id);
        if (!memory) {
          console.log(chalk.yellow(`No durable memory found: ${id}`));
          return;
        }
        console.log(chalk.bold(`\n${memory.id}`));
        console.log(`  ${chalk.dim("lane")}       ${memory.lane}`);
        console.log(`  ${chalk.dim("confidence")} ${(memory.confidence * 100).toFixed(0)}%`);
        console.log(`  ${chalk.dim("source")}     ${memory.source}`);
        console.log(`  ${chalk.dim("provenance")} ${memory.provenance}`);
        console.log(`  ${chalk.dim("contradict")} ${memory.contradictionCount}`);
        console.log(`  ${chalk.dim("created")}    ${new Date(memory.createdAt).toISOString()}`);
        console.log(`  ${chalk.dim("updated")}    ${new Date(memory.updatedAt).toISOString()}`);
        console.log(`  ${chalk.dim("text")}       ${memory.text}`);
        if (memory.history.length > 0) {
          console.log(`  ${chalk.dim("history")}`);
          for (const item of memory.history.slice(-5)) {
            console.log(`    ${new Date(item.timestamp).toISOString()} ${chalk.dim(item.reason)}: ${item.text}`);
          }
        }
        break;
      }
      case "update": {
        const id = parts[1];
        const text = parts.slice(2).join(" ").trim();
        if (!id || !text) {
          console.log(chalk.yellow("Usage: /memory update <memoryId> <new text>"));
          return;
        }
        const memory = this.memory.updateDurableMemory(id, text, "manual /memory update");
        console.log(memory ? chalk.green(`Updated ${memory.id}`) : chalk.yellow(`No durable memory found: ${id}`));
        break;
      }
      case "contradict": {
        const id = parts[1];
        const reason = parts.slice(2).join(" ").trim() || "manual contradiction";
        if (!id) {
          console.log(chalk.yellow("Usage: /memory contradict <memoryId> <reason>"));
          return;
        }
        const memory = this.memory.markDurableMemoryContradicted(id, reason);
        console.log(
          memory
            ? chalk.yellow(`Marked ${memory.id} contradicted. Confidence now ${(memory.confidence * 100).toFixed(0)}%.`)
            : chalk.yellow(`No durable memory found: ${id}`),
        );
        break;
      }
      case "search": {
        const query = parts.slice(1).join(" ");
        if (!query) {
          console.log(chalk.yellow("Usage: /memory search <query>"));
          return;
        }
        const durableResults = this.memory.searchDurableMemories(query, 10);
        const results = this.memory.search(query, 10);
        if (results.length === 0 && durableResults.length === 0) {
          console.log(chalk.dim("No matching memories."));
          return;
        }
        console.log(chalk.bold(`\nSearch results for "${query}":`));
        for (const memory of durableResults) {
          console.log(`\n  ${this.formatDurableMemory(memory)}`);
        }
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
        if (recent.length === 0) {
          console.log(chalk.dim("No memories yet."));
          return;
        }
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
        console.log(
          chalk.yellow(
            "Memory: /memory, /remember <lane> <text>, /forget <id>, /memory why <id>, /memory update <id> <text>, /memory contradict <id> <reason>, /memory search <q>, /memory facts|preferences|decisions|tasks|notes, /memory last <n>, /memory clear",
          ),
        );
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
          console.log(
            chalk.dim(
              "Keys: verbosity (concise/balanced/detailed), technical (beginner/intermediate/expert), name <name>",
            ),
          );
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
          if (!goalId) {
            console.log(chalk.yellow("Usage: /profile goal done <goalId>"));
            return;
          }
          this.userModel.completeGoal(goalId);
          console.log(chalk.green("Goal marked as completed."));
        } else if (subcmd === "remove") {
          const goalId = parts[2];
          if (!goalId) {
            console.log(chalk.yellow("Usage: /profile goal remove <goalId>"));
            return;
          }
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
        if (!name) {
          console.log(chalk.yellow("Usage: /skill show <name>"));
          return;
        }
        const skill = this.skillRegistry.get(name);
        if (!skill) {
          console.log(chalk.red(`Skill "${name}" not found.`));
          return;
        }
        console.log(chalk.bold(`\nSkill: ${skill.name}`));
        console.log(`  ${chalk.dim("Description:")} ${skill.description}`);
        console.log(`  ${chalk.dim("Category:    ")} ${skill.category}`);
        console.log(`  ${chalk.dim("Triggers:    ")} ${skill.triggers.join(", ")}`);
        console.log(`  ${chalk.dim("Tools:       ")} ${skill.tools.join(", ") || "none"}`);
        console.log(`  ${chalk.dim("Examples:    ")} ${skill.examples.join(", ") || "none"}`);
        console.log(`  ${chalk.dim("Usage:       ")} ${skill.usageCount}x`);
        if (skill.steps && skill.steps.length > 0) {
          const chain = skill.steps
            .map(
              (step, index) =>
                `${index + 1}.${step.kind}${step.tool ? `(${step.tool})` : step.skill ? `(${step.skill})` : ""}`,
            )
            .join(" -> ");
          console.log(`  ${chalk.dim("Steps:       ")} ${chain}`);
        }
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
      case "save": {
        const nameArg = parts.slice(1).join(" ").trim().toLowerCase();
        const proposal = this.pendingSkillProposal;
        if (!proposal) {
          console.log(chalk.yellow("No skill proposal waiting. Run a multi-step task and Ntox may propose one."));
          return;
        }
        if (nameArg && nameArg !== proposal.name) {
          console.log(chalk.yellow(`No pending proposal named "${nameArg}". Waiting: ${proposal.name}`));
          return;
        }
        this.skillRegistry.add(proposal);
        this.pendingSkillProposal = null;
        console.log(chalk.green(`Skill saved: ${proposal.name}`));
        console.log(chalk.dim(`  Triggers: ${proposal.triggers.join(", ")}`));
        break;
      }
      case "install": {
        const parsed = parseSkillInstallCommand(`/skill ${arg}`);
        if (parsed.kind !== "install") {
          console.log(
            chalk.yellow(
              parsed.kind === "invalid" ? parsed.message : "Usage: /skill install <url|git|file|name> [--force]",
            ),
          );
          return;
        }
        console.log(chalk.dim(`Installing from ${parsed.source}...`));
        const result = await installSkillFromSource(parsed.source, this.skillRegistry, {
          force: parsed.force,
          marketplace: this.marketplace,
        });
        const message = renderSkillInstallResult(result);
        const failed = result.installed.length === 0 && result.skipped.length === 0;
        console.log(failed ? chalk.yellow(message) : chalk.green(message));
        break;
      }
      case "marketplace": {
        const parsed = parseSkillMarketplaceCommand(`/skill ${arg}`);
        const query = parsed.kind === "marketplace" ? (parsed.query ?? undefined) : undefined;
        const listing = await this.marketplace.list(query);
        console.log(renderMarketplaceList(listing, query));
        break;
      }
      case "stats": {
        console.log(renderSkillStats(this.skillRegistry.list()));
        break;
      }
      case "run": {
        const parsed = parseSkillLifecycleCommand(`/skill ${arg}`);
        if (parsed.kind !== "run" || !parsed.name) {
          console.log(chalk.yellow("Usage: /skill run <name>"));
          return;
        }
        const skill = this.skillRegistry.get(parsed.name);
        if (!skill) {
          console.log(chalk.yellow(`Skill "${parsed.name}" not found.`));
          return;
        }
        if (!skill.steps || skill.steps.length === 0) {
          console.log(
            chalk.yellow(
              `Skill "${parsed.name}" has no routine steps — plain skills activate by trigger. Just mention one of its triggers instead.`,
            ),
          );
          return;
        }
        console.log(chalk.dim(`Running routine ${skill.name} (${skill.steps.length} steps)...`));
        const runtime = createRoutineRuntime({ llm: this.llm, tools: this.tools, skillRegistry: this.skillRegistry });
        const result = await runRoutine(skill, runtime);
        this.skillRegistry.incrementUsage(skill.name);
        const message = renderRoutineRun(skill, result);
        console.log(result.ok ? chalk.green(message) : chalk.yellow(message));
        break;
      }
      case "diff": {
        const parsed = parseSkillLifecycleCommand(`/skill ${arg}`);
        if (parsed.kind !== "diff" || !parsed.name) {
          console.log(chalk.yellow("Usage: /skill diff <name> [source]"));
          return;
        }
        const message = await diffSkillByName(this.skillRegistry, this.marketplace, parsed.name, parsed.source);
        console.log(message.includes("matches the source") ? chalk.green(message) : message);
        break;
      }
      case "export": {
        const parsed = parseSkillLifecycleCommand(`/skill ${arg}`);
        if (parsed.kind !== "export" || !parsed.name) {
          console.log(chalk.yellow("Usage: /skill export <name>"));
          return;
        }
        const json = this.skillRegistry.exportSkill(parsed.name);
        if (!json) {
          console.log(chalk.yellow(`Skill "${parsed.name}" not found.`));
          return;
        }
        console.log(json);
        console.log(chalk.dim("Save the above as a .json file, then /skill install <file> on the other machine."));
        break;
      }
      case "forget":
      case "remove": {
        const name = parts.slice(1).join(" ");
        if (!name) {
          console.log(chalk.yellow("Usage: /skill forget <name>"));
          return;
        }
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
        console.log(
          chalk.bold(`\nSkill Library (${stats.total} skills, ${stats.domains} domains, ${stats.totalSizeKB}KB)`),
        );
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
        this.lastBrowsedSkills = skills.map((s) => ({
          name: s.name,
          importance: s.importance,
          description: s.description,
          voices: s.voices,
        }));
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
        console.log(
          chalk.yellow(
            "Commands: /skill, /skill show <name>, /skill learn <desc>, /skill save [name], /skill install <url|git|file|name>, /skill marketplace [query], /skill run <name>, /skill stats, /skill diff <name>, /skill export <name>, /skill forget <name>, /skill library, /skill browse <domain>, /skill load <name>",
          ),
        );
    }
  }

  private async loadSkillByName(name: string): Promise<void> {
    const content = this.skillLibrary.loadContent(name);
    if (!content) {
      console.log(chalk.yellow(`Skill "${name}" not found.`));
      return;
    }
    const skill = this.skillLibrary.byName(name);
    if (!skill) return;
    const skillDef: import("../types/index.js").SkillDefinition = {
      name: skill.name,
      description: skill.description,
      category: skill.domain,
      prompt: `## ${skill.name} (Skill Context)\n\n${content.slice(0, 2000)}...`,
      triggers: skill.triggers,
      tools: [],
      examples: [],
      created: Date.now(),
      updated: Date.now(),
      usageCount: 0,
      domain: skill.domain,
      importance: skill.importance,
      isExternal: true,
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
      this.config = patchConfig({ cognitiveEnabled: true });
      console.log(chalk.green("Cognitive Kernel activated."));
      console.log(chalk.dim("  Patterns: compression → pattern retrieval → sparse activation → critique"));
      return;
    }

    if (sub === "off" || sub === "disable") {
      this.cognitiveKernel.setEnabled(false);
      this.config = patchConfig({ cognitiveEnabled: false });
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
    console.log(
      `  ${chalk.dim("Abstract patterns: ")} ${chalk.magenta(compStats.abstract.toString())} (merged from 2+ patterns)`,
    );
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

  private handlePatternsCommand(arg: string): void {
    const id = arg.trim();
    const patterns = this.cognitiveKernel.getPatterns().list();
    const output = id ? formatPatternDetail(patterns, id) : formatPatternOverview(patterns, 12);
    console.log(`\n${output}`);
  }

  private handleTheoriesCommand(arg: string): void {
    loadTheoryStore();
    const [sub, id] = arg.trim().split(/\s+/);
    if (sub === "confirm" && id) {
      confirmTheory(id);
      console.log(chalk.green(`confirmed ${id}`));
      return;
    }
    if ((sub === "reject" || sub === "disconfirm") && id) {
      disconfirmTheory(id);
      console.log(chalk.yellow(`rejected ${id}`));
      return;
    }
    const snapshot = getTheoryHierarchy();
    const output =
      sub === "evidence" && id
        ? formatTheoryEvidence(snapshot, id)
        : sub
          ? formatTheoryDetail(snapshot, sub)
          : formatTheoryOverview(snapshot, 12);
    console.log(`\n${output}`);
  }

  private printWorkspace(): void {
    const profile = this.infra.policy.profile;
    console.log(chalk.bold("\nWorkspace:"));
    console.log(`  ${chalk.dim("profile")}   ${profile.name} (${profile.id})`);
    console.log(`  ${chalk.dim("root")}      ${profile.workspaceRoot}`);
    console.log(`  ${chalk.dim("read")}      ${profile.readRoots.join(", ")}`);
    console.log(`  ${chalk.dim("write")}     ${profile.writeRoots.join(", ")}`);
  }

  private printStatus(): void {
    const modelInfo = this.models.find((m) => m.id === this.config.model);
    const providerNames = getProviderNames();
    const profile = this.infra.policy.profile;
    const trace = this.agent.getLastTrace();
    const ctx = modelInfo ? `${((this.agent.countTokens() / modelInfo.context_length) * 100).toFixed(0)}%` : "n/a";
    const local =
      [this.localProviders.ollama ? "ollama" : "", this.localProviders.lmstudio ? "lmstudio" : ""]
        .filter(Boolean)
        .join(", ") || "none";
    console.log(chalk.bold("\nStatus:"));
    console.log(`  ${chalk.dim("model")}     ${chalk.yellow(this.config.model)}`);
    console.log(`  ${chalk.dim("provider")}  ${providerNames[this.config.provider] || this.config.provider}`);
    console.log(`  ${chalk.dim("ui")}        ${this.config.uiMode} / ${this.config.animationLevel}`);
    console.log(`  ${chalk.dim("context")}   ${ctx}`);
    console.log(`  ${chalk.dim("memory")}    ${this.memory.count()} episodes`);
    console.log(`  ${chalk.dim("workspace")} ${profile.name} (${profile.id})`);
    console.log(
      `  ${chalk.dim("policy")}    shell ${profile.shellPolicy}, network ${profile.networkPolicy}, checkpoints ${profile.autoCheckpoint ? "auto" : "manual"}`,
    );
    console.log(`  ${chalk.dim("local")}     ${local}`);
    if (trace) {
      const duration = trace.completedAt ? `${trace.completedAt - trace.startedAt}ms` : "open";
      const failed = trace.toolCalls.filter((call) => call.success === false).length;
      const changed = trace.fileChanges?.length || 0;
      console.log(
        `  ${chalk.dim("last turn")} ${trace.responseMode || "unknown"}, ${duration}, tools ${trace.toolCalls.length}, failed ${failed}, files ${changed}`,
      );
    } else {
      console.log(`  ${chalk.dim("last turn")} none`);
    }
  }

  private async printDoctor(): Promise<void> {
    const { runDoctorChecks, formatDoctorReport } = await import("../doctor.js");
    console.log("");
    console.log(formatDoctorReport(await runDoctorChecks()));
  }

  private printPermissions(): void {
    const profile = this.infra.policy.profile;
    console.log(chalk.bold("\nPermissions:"));
    console.log(`  ${chalk.dim("shell")}     ${profile.shellPolicy}`);
    console.log(`  ${chalk.dim("network")}   ${profile.networkPolicy}`);
    console.log(`  ${chalk.dim("checkpoint")} ${profile.autoCheckpoint ? "auto" : "manual"}`);
    console.log(`  ${chalk.dim("tools")}     ${profile.allowedTools.length ? profile.allowedTools.join(", ") : "all"}`);
    const denials = this.infra.policy.decisions.filter((d) => !d.allowed).slice(-5);
    if (denials.length > 0) {
      console.log(chalk.dim("\nRecent denials:"));
      for (const d of denials) console.log(`  ${d.tool}: ${d.reason}${d.path ? ` (${d.path})` : ""}`);
    }
  }

  private handleApproveCommand(arg: string): void {
    const [scope, ...rest] = arg.trim().split(/\s+/);
    const command = rest.join(" ");
    if (!scope || !command) {
      console.log(chalk.yellow("Usage: /approve <once|session|always|deny> <command>"));
      return;
    }
    if (!["once", "session", "always", "deny"].includes(scope)) {
      console.log(chalk.yellow("Scope must be once, session, always, or deny."));
      return;
    }
    const decision =
      scope === "once"
        ? "allow-once"
        : scope === "session"
          ? "allow-session"
          : scope === "always"
            ? "allow-always"
            : "deny";
    approvalStore.store("shell", `shell:${command}`, decision);
    console.log(chalk.green(`approval ${scope}: ${command}`));
  }

  private async printAgents(): Promise<void> {
    const { getSubagentRuns } = await import("../tools/subagent.js");
    const runs = getSubagentRuns(10);
    console.log(chalk.bold("\nSubagents:"));
    if (runs.length === 0) {
      console.log(chalk.dim("  no runs yet"));
      return;
    }
    for (const run of runs) {
      const age = new Date(run.startedAt).toISOString();
      console.log(`  ${chalk.cyan(run.id)} ${run.status} fitness ${run.fitness.toFixed(2)} ${chalk.dim(age)}`);
      console.log(`    ${run.task.replace(/\s+/g, " ").slice(0, 120)}`);
      if (run.error) console.log(`    ${chalk.red(run.error.slice(0, 160))}`);
    }
  }

  private printAnalytics(): void {
    const summary = this.analytics.getSummary();
    console.log(chalk.bold("\nAnalytics:"));
    for (const line of summary.split("\n")) {
      console.log(`  ${chalk.dim("→")} ${line}`);
    }
  }

  private printTrace(): void {
    const trace = this.agent.getLastTrace();
    if (!trace) {
      console.log(chalk.dim("\nNo turn trace yet. Send a message first."));
      return;
    }

    const duration = trace.completedAt ? `${trace.completedAt - trace.startedAt}ms` : "open";
    const lines = this.formatTrace(trace, duration);
    console.log(chalk.bold("\nLast Turn Trace:"));
    for (const line of lines) console.log(line);
  }

  private printLastTurn(): void {
    console.log(renderLastTurn(this.agent.getLastTrace()));
  }

  private printLastDiff(): void {
    const trace = this.agent.getLastTrace();
    if (!trace) {
      console.log(chalk.dim("\nNo turn trace yet. Send a message first."));
      return;
    }
    console.log(`\n${renderFileChanges(getFileChangesSince(trace.startedAt))}`);
  }

  private async printCheckpoints(arg: string): Promise<void> {
    const tool = this.tools.get("checkpoint");
    if (!tool) {
      console.log(chalk.yellow("Checkpoint tool is not available."));
      return;
    }
    const args: Record<string, unknown> = { action: "list" };
    if (arg.trim()) args.path = arg.trim();
    const result = await tool.execute(args);
    if (!result.success) {
      console.log(chalk.red(result.error || "Failed to list checkpoints."));
      return;
    }
    const data = result.data as { checkpoints?: { id: string; path: string; timestamp: string }[]; count?: number };
    const checkpoints = data.checkpoints || [];
    if (checkpoints.length === 0) {
      console.log(chalk.dim("No checkpoints found."));
      return;
    }
    console.log(chalk.bold(`\nCheckpoints (${data.count ?? checkpoints.length}):`));
    for (const checkpoint of checkpoints.slice(0, 20)) {
      console.log(`  ${chalk.cyan(checkpoint.id)} ${chalk.dim(checkpoint.timestamp)} ${checkpoint.path}`);
    }
    if (checkpoints.length > 20) console.log(chalk.dim(`  ... +${checkpoints.length - 20} more`));
  }

  private async rollbackCheckpoint(arg: string): Promise<void> {
    const checkpointId = arg.trim();
    if (!checkpointId) {
      console.log(chalk.yellow("Usage: /rollback <checkpointId>"));
      return;
    }
    const tool = this.tools.get("checkpoint");
    if (!tool) {
      console.log(chalk.yellow("Checkpoint tool is not available."));
      return;
    }
    const result = await tool.execute({ action: "rollback", checkpointId });
    if (!result.success) {
      console.log(chalk.red(result.error || "Rollback failed."));
      return;
    }
    console.log(chalk.green(`Rolled back ${checkpointId}. Use /diff to inspect the restore.`));
  }

  private formatTrace(trace: AgentTurnTrace, duration: string): string[] {
    const lines: string[] = [];
    lines.push(`  ${chalk.dim("mode")}      ${trace.responseMode || "unknown"}`);
    lines.push(`  ${chalk.dim("duration")}  ${duration}`);
    if (trace.strategy) lines.push(`  ${chalk.dim("strategy")}  ${trace.strategy}`);
    if (trace.workspaceProfile)
      lines.push(
        `  ${chalk.dim("workspace")} ${trace.workspaceProfile.name} (${trace.workspaceProfile.workspaceRoot})`,
      );
    lines.push(`  ${chalk.dim("memory")}    ${trace.memoryRecallCount} recalled`);
    lines.push(`  ${chalk.dim("search")}    ${trace.searchUsed ? "used" : "no"}`);
    if (trace.theoryReason) lines.push(`  ${chalk.dim("theory")}    ${trace.theoryReason}`);
    if (trace.contextBudget) {
      const b = trace.contextBudget;
      lines.push(
        `  ${chalk.dim("tokens")}    total~${b.total} system~${b.system} memory~${b.memory} theory~${b.theory} plan~${b.plan} tools~${b.toolResults}`,
      );
    }
    if (trace.checkpointIds.length > 0) lines.push(`  ${chalk.dim("checkpoints")} ${trace.checkpointIds.join(", ")}`);
    if (trace.fileChanges && trace.fileChanges.length > 0)
      lines.push(`  ${chalk.dim("files")}     ${trace.fileChanges.length} changed`);
    const denied = trace.policyDecisions.filter((d) => !d.allowed);
    if (denied.length > 0) lines.push(`  ${chalk.dim("policy")}    ${denied.length} denied`);
    if (trace.skill)
      lines.push(`  ${chalk.dim("skill")}     ${trace.skill.name} (${(trace.skill.confidence * 100).toFixed(0)}%)`);
    if (trace.cognitiveSummary) lines.push(`  ${chalk.dim("cognition")} ${trace.cognitiveSummary}`);
    if (trace.retries > 0) lines.push(`  ${chalk.dim("retries")}   ${trace.retries}`);
    if (trace.blockedReason) lines.push(`  ${chalk.dim("blocked")}   ${trace.blockedReason}`);
    if (trace.error) lines.push(`  ${chalk.dim("error")}     ${trace.error}`);
    if (trace.finalResponseLength !== undefined)
      lines.push(`  ${chalk.dim("response")}  ${trace.finalResponseLength} chars`);

    if (trace.toolCalls.length === 0) {
      lines.push(`  ${chalk.dim("tools")}     none`);
      return lines;
    }

    lines.push(`  ${chalk.dim("tools")}     ${trace.toolCalls.length}`);
    for (const call of trace.toolCalls) {
      const status = call.success === undefined ? "unknown" : call.success ? "ok" : "fail";
      const duration = call.durationMs !== undefined ? ` ${call.durationMs}ms` : "";
      const reason = call.reason ? ` ${chalk.dim(call.reason)}` : "";
      const checkpoint = call.autoCheckpointId ? ` ${chalk.dim(`checkpoint ${call.autoCheckpointId}`)}` : "";
      const args = Object.keys(call.args).length > 0 ? ` ${JSON.stringify(call.args)}` : "";
      lines.push(`    ${chalk.cyan(call.name)} ${chalk.dim(status)}${duration}${reason}${checkpoint}${args}`);
      if (call.error) lines.push(`      ${chalk.red(call.error.slice(0, 200))}`);
    }
    return lines;
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
      console.log(
        renderDomainSkills(
          rest,
          skills.map((s) => ({ name: s.name, importance: s.importance, description: s.description, voices: s.voices })),
        ),
      );
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

  private async handleBriefCommand(): Promise<void> {
    const exec = this.infra.executive;
    const observations = this.infra.observation
      ? (() => {
          try {
            return this.infra.observation.getAll();
          } catch {
            return [];
          }
        })()
      : [];
    const mentalModel = this.infra.mentalModel
      ? (() => {
          try {
            return this.infra.mentalModel.getAllEntries();
          } catch {
            return [];
          }
        })()
      : [];

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
    const card = renderBriefCard(brief);
    if (!card) {
      console.log(chalk.dim("\n  Nothing notable right now. Everything looks aligned."));
      return;
    }
    await revealBlock(card, { enabled: this.config.animationLevel !== "off", lineDelayMs: 10 });
    process.stdout.write("\n");
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

  private async showAutoBrief(): Promise<void> {
    const exec = this.infra.executive;
    const observations = this.infra.observation
      ? (() => {
          try {
            return this.infra.observation.getAll();
          } catch {
            return [];
          }
        })()
      : [];

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

    const card = renderBriefCard(brief);
    if (!card) return;

    await revealBlock(card, { enabled: this.config.animationLevel !== "off", lineDelayMs: 10 });
    process.stdout.write("\n");
  }

  private async handleBenchmark(): Promise<void> {
    console.log(chalk.bold("\n  NTOX Cognitive Kernel Benchmark"));
    console.log(chalk.dim("  Testing kernel ON vs kernel OFF across 20 queries...\n"));

    const judgeLLM = new LLMClient(
      this.config.apiKey,
      this.config.model,
      this.config.embeddingModel,
      this.config.maxTokens,
      this.config.temperature,
      this.config.apiBaseUrl,
      this.config.provider,
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
      sessionIntent,
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
    console.log(renderMetaStats(metaConfig, this.lastStrategy, this.lastReflection, this.mistakes.getStats()));
  }

  private printMistakes(): void {
    const all = this.mistakes.getAll();
    console.log(renderMistakeList(all));
  }

  private wireIdleJobs(): void {
    const mind = this.infra.mind;
    if (!mind) return;
    if (mind.idle.hasJob("resolve")) return;
    let selfPlayCursor = 0;
    const jobs = createIdleJobs({
      mind,
      memory: this.memory,
      alive: this.infra.alive,
      executive: this.infra.executive,
      reflector: new Reflector(this.llm, true),
      createSelfPlaySession: this.config.idleSelfPlay
        ? () => {
            const sid = `selfplay-${Date.now().toString(36)}`;
            const agent = new Agent(
              createAgentConfig(this.infra, this.config, sid, {
                skipReflection: true,
                predictionLlmEnabled: false,
                modelCritiqueEnabled: false,
                mind: undefined,
              }),
            );
            return {
              send: async (prompt: string) => {
                let response = "";
                let tokens = 0;
                const stream = agent.run(prompt, {
                  onToken: (t) => {
                    response += t;
                  },
                  onUsage: (u) => {
                    tokens += u.inputTokens + u.outputTokens;
                  },
                  onToolCall: () => {},
                  onToolResult: () => {},
                  onThinking: () => {},
                });
                for await (const _ of stream) {
                  /* drain */
                }
                return { response, tokens };
              },
              reset: async () => {
                agent.resetConversation();
              },
            };
          }
        : undefined,
      pushProposal: (proposal) => mind.idle.pushProposal(proposal),
      selfPlayCursor: () => selfPlayCursor++,
      selfPlayCapPerDay: 2,
    });
    for (const job of jobs) mind.idle.addJob(job);
  }

  private buildProfileExtras(): {
    patterns: { name: string; strength: number; domains: string[] }[];
    theories: { name: string; confidence: number }[];
    skills: string[];
    strategyWeights: Record<string, Record<string, number>>;
  } {
    const mind = this.infra.mind;
    const strategyWeights = Object.fromEntries(
      Object.entries(mind.bandit.stats().preferred).map(([context, variant]) => [context, { [variant]: 1 }]),
    );
    let patterns: { name: string; strength: number; domains: string[] }[] = [];
    let theories: { name: string; confidence: number }[] = [];
    try {
      loadTheoryStore();
      const hierarchy = getTheoryHierarchy();
      patterns = hierarchy.patterns.map((p) => ({
        name: p.name,
        strength: p.confidence,
        domains: [detectDomain(`${p.name} ${p.generalization}`)],
      }));
      theories = hierarchy.theories.filter((t) => t.confirmed).map((t) => ({ name: t.name, confidence: t.confidence }));
    } catch {
      /* theory store unavailable */
    }
    let skills: string[] = [];
    try {
      skills = this.skillRegistry.list().map((s) => s.name);
    } catch {
      /* skills unavailable */
    }
    return { patterns, theories, skills, strategyWeights };
  }

  private async handleMindCommand(arg: string): Promise<void> {
    const mind = this.infra.mind;
    if (!mind) {
      console.log(chalk.dim("\nMind is not configured."));
      return;
    }
    const [sub, ...rest] = arg.split(/\s+/);
    const subCmd = (sub ?? "").toLowerCase();

    if (subCmd === "ledger") {
      const limit = Math.max(1, Math.min(50, parseInt(rest[0] ?? "10", 10) || 10));
      const rows = mind.ledger.recent(limit);
      console.log(chalk.bold(`\nmind ledger (last ${rows.length})`));
      for (const row of rows) {
        const kinds = [...new Set(row.context.map((c) => c.kind))].join(",");
        const flags = [
          row.signals.corrected ? "corrected" : "",
          row.signals.thanked ? "thanked" : "",
          row.signals.toolFailure ? "tool-fail" : "",
          row.signals.falseSuccess ? "shallow" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const score = row.score.toFixed(2);
        const variant = row.strategyVariant ?? "standard";
        console.log(
          `  ${chalk.dim(new Date(row.timestamp).toISOString().slice(11, 19))} ${row.queryType.padEnd(9)} score=${score.padStart(5)} ${chalk.dim(`(${variant})`)} ${kinds} ${flags}`,
        );
      }
      if (rows.length === 0) console.log(chalk.dim("  no turns recorded yet"));
      return;
    }

    if (subCmd === "predict") {
      const query = rest.join(" ");
      if (!query) {
        console.log(chalk.yellow("Usage: /mind predict <query>"));
        return;
      }
      const prediction = mind.predict(query);
      console.log(chalk.bold("\nmind prediction"));
      console.log(`  ${chalk.dim("intent")}     ${prediction.intent}`);
      console.log(`  ${chalk.dim("shape")}      ${prediction.answerShape}`);
      console.log(`  ${chalk.dim("tools")}      ${prediction.expectedTools.join(", ") || "none"}`);
      console.log(`  ${chalk.dim("outcome")}    ${prediction.expectedOutcome}`);
      console.log(`  ${chalk.dim("confidence")} ${prediction.confidence.toFixed(2)}`);
      return;
    }

    if (subCmd === "fingerprint") {
      const fingerprint = mind.identity.fingerprint();
      console.log(chalk.bold("\nmind fingerprint"));
      console.log(`  ${chalk.dim("hash")}      ${chalk.cyan(fingerprint.hash)}`);
      console.log(`  ${chalk.dim("positions")} ${fingerprint.positions}`);
      console.log(`  ${chalk.dim("values")}    ${fingerprint.values}`);
      const positions = mind.identity.get().positions.slice(0, 5);
      if (positions.length > 0) {
        console.log(`  ${chalk.dim("top positions")}`);
        for (const position of positions) {
          const pct = Math.round(position.confidence * 100);
          console.log(`    ${position.topic}: ${position.stance} ${chalk.dim(`${pct}%`)}`);
        }
      }
      return;
    }

    if (subCmd === "idle") {
      const action = (rest[0] ?? "status").toLowerCase();
      if (action === "on") {
        this.wireIdleJobs();
        mind.idle.start();
        console.log(chalk.green(`Idle cognition started (jobs: ${mind.idle.jobsList().join(", ") || "none"}).`));
        return;
      }
      if (action === "off") {
        mind.idle.stop();
        console.log(chalk.dim("Idle cognition stopped."));
        return;
      }
      if (action === "run") {
        this.wireIdleJobs();
        const artifacts = await mind.idle.runCycle();
        console.log(chalk.bold(`\nmind idle cycle (${artifacts.length} artifacts)`));
        for (const artifact of artifacts) console.log(`  ${chalk.dim(artifact.job)}: ${artifact.summary}`);
        if (artifacts.length === 0) console.log(chalk.dim("  nothing to do"));
        return;
      }
      const status = mind.idle.status();
      console.log(chalk.bold("\nmind idle"));
      console.log(`  ${chalk.dim("enabled")}   ${status.enabled ? chalk.green("yes") : chalk.dim("no")}`);
      console.log(`  ${chalk.dim("cycles")}    ${status.cyclesToday} today / ${status.totalCycles} total`);
      console.log(
        `  ${chalk.dim("budgets")}   ${status.tokensToday}/${status.budgets.tokens} tok · $${status.usdToday.toFixed(3)}/$${status.budgets.usd} · cycle ${status.cyclesToday}/${status.budgets.cycles} · idle-gate ${Math.round(status.budgets.idleMs / 60_000)}m`,
      );
      const yieldValue = status.yieldPerKToken;
      console.log(
        `  ${chalk.dim("yield")}      ${yieldValue === Infinity ? "n/a (0 tokens spent)" : `${yieldValue.toFixed(2)} artifacts/1k tok`}`,
      );
      console.log(`  ${chalk.dim("jobs")}      ${status.jobs.join(", ") || "none wired"}`);
      if (status.pendingProposals.length > 0) {
        console.log(`  ${chalk.dim("proposals")}`);
        for (const proposal of status.pendingProposals) console.log(`    ${chalk.dim("•")} ${proposal}`);
      }
      const artifacts = mind.idle.recentArtifacts(5);
      if (artifacts.length > 0) {
        console.log(`  ${chalk.dim("recent artifacts")}`);
        for (const artifact of artifacts) console.log(`    ${chalk.dim(artifact.job)}: ${artifact.summary}`);
      }
      return;
    }

    if (subCmd === "consolidate") {
      const dupes = this.memory.consolidateDurable();
      const report = this.memory.consolidateEpisodes();
      console.log(chalk.bold("\nmind consolidate"));
      console.log(`  ${chalk.dim("dedupe")}   ${dupes} duplicate durable memories merged`);
      console.log(
        `  ${chalk.dim("episodes")}  ${report.clusters} clusters → ${report.created} created · ${report.merged} merged · ${report.challenged} challenged`,
      );
      try {
        const promoted = promoteOpinions(this.infra.mentalModel, mind.identity);
        if (promoted.length > 0) {
          console.log(`  ${chalk.dim("opinions")}   ${promoted.length} promoted to identity positions`);
        }
        if (mind.refreshNarrative()) {
          console.log(`  ${chalk.dim("narrative")}  identity narrative refreshed`);
        }
      } catch {
        /* opinion promotion unavailable */
      }
      return;
    }

    if (subCmd === "identity") {
      mind.refreshNarrative();
      const data = mind.identity.get();
      console.log(chalk.bold("\nmind identity"));
      console.log(`  ${chalk.dim("narrative")}  ${data.narrative || "(empty — turns will populate it)"}`);
      if (data.values.length > 0) console.log(`  ${chalk.dim("values")}     ${data.values.join(" · ")}`);
      if (data.activeProjects.length > 0)
        console.log(`  ${chalk.dim("projects")}   ${data.activeProjects.join(" · ")}`);
      if (data.positions.length > 0) {
        console.log(`  ${chalk.dim("positions")}`);
        for (const position of data.positions.slice(0, 10)) {
          const pct = Math.round(position.confidence * 100);
          console.log(
            `    ${position.topic.padEnd(24)} ${chalk.dim(`${pct}%`)} ${position.stance} ${chalk.dim(`[${position.evidence.length} ev]`)}`,
          );
        }
      } else {
        console.log(`  ${chalk.dim("positions")}  none yet — corrections and repeated opinions create them`);
      }
      if (data.revisionLog.length > 0) {
        console.log(`  ${chalk.dim("recent revisions")}`);
        for (const revision of data.revisionLog.slice(-5)) {
          console.log(`    ${new Date(revision.at).toISOString().slice(0, 10)} ${revision.topic}: ${revision.change}`);
        }
      }
      const fingerprint = mind.identity.fingerprint();
      console.log(`  ${chalk.dim("fingerprint")} ${fingerprint.hash}`);
      return;
    }

    if (subCmd === "divergence") {
      const extras = this.buildProfileExtras();
      const profile = mind.cognitiveProfile(extras);
      const fresh = freshProfile();
      const divergence = profileDivergence(profile, fresh);
      const components = profileComponents(profile, fresh);
      console.log(chalk.bold("\nmind divergence (trained vs fresh)"));
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      console.log(
        `  ${chalk.dim("score")}     ${chalk.cyan(divergence.toFixed(3))} ${divergence > 0.4 ? chalk.green("(> 0.4 M5 target)") : chalk.dim("(target > 0.4)")}`,
      );
      console.log(
        `  ${chalk.dim("profile")}   ${profile.positions.length} positions · ${profile.patterns.length} patterns · ${profile.topTheories.length} theories · ${profile.skills.length} skills`,
      );
      console.log(`  ${chalk.dim("components")}`);
      for (const [key, value] of Object.entries(components).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${key.padEnd(12)} ${pct(value)}`);
      }
      return;
    }

    if (subCmd === "transfer") {
      const store = new TransferStore();
      const action = (rest[0] ?? "list").toLowerCase();
      try {
        loadTheoryStore();
      } catch {
        /* store unavailable */
      }
      const hierarchy = getTheoryHierarchy();
      const theories: TransferTheoryView[] = hierarchy.theories.map((t) => ({
        id: t.id,
        name: t.name,
        explanation: t.explanation,
        confidence: t.confidence,
        confirmed: t.confirmed,
        ...(t.embedding ? { embedding: t.embedding } : {}),
      }));
      const candidates = findTransferCandidates(theories);
      if (action === "candidates") {
        console.log(chalk.bold(`\nmind transfer candidates (${candidates.length})`));
        for (const candidate of candidates.slice(0, 10)) {
          console.log(
            `  ${candidate.sourceDomain} → ${candidate.targetDomain}  ${chalk.dim(`sim=${candidate.structuralSimilarity.toFixed(2)}`)}`,
          );
          console.log(`    ${chalk.dim("from")} ${candidate.source.name}`);
          console.log(`    ${chalk.dim("to")}   ${candidate.target.name}`);
        }
        if (candidates.length === 0)
          console.log(chalk.dim("  no distant-domain theory pairs above similarity threshold"));
        return;
      }
      if (action === "scan") {
        const fresh = store.candidates(theories).slice(0, 3);
        if (fresh.length === 0) {
          console.log(chalk.dim("\nNo new transfer candidates to record."));
          return;
        }
        console.log(chalk.bold("\nmind transfer scan"));
        for (const candidate of fresh) {
          const hypothesis = store.createHypothesis(candidate);
          console.log(`  ${hypothesis.id} ${hypothesis.sourceDomain} → ${hypothesis.targetDomain}`);
          console.log(`    ${chalk.dim("hypothesis")} ${hypothesis.hypothesis}`);
          console.log(
            `    ${chalk.dim("resolve")}    /mind transfer resolve ${hypothesis.id} <baseline-score> <transfer-score>`,
          );
        }
        return;
      }
      if (action === "resolve") {
        const [id, baselineArg, transferArg] = rest.slice(1);
        const baseline = Number(baselineArg);
        const transfer = Number(transferArg);
        if (!id || !Number.isFinite(baseline) || !Number.isFinite(transfer)) {
          console.log(chalk.yellow("Usage: /mind transfer resolve <id> <baseline-score> <transfer-score>"));
          return;
        }
        const resolved = store.resolve(id, baseline, transfer);
        if (!resolved) {
          console.log(chalk.yellow(`No transfer hypothesis named ${id}.`));
          return;
        }
        const lift =
          resolved.lift === null ? "n/a" : `${resolved.lift >= 0 ? "+" : ""}${(resolved.lift * 100).toFixed(1)}%`;
        console.log(chalk.bold(`\n${resolved.id} ${resolved.status}`));
        console.log(`  ${chalk.dim("lift")} ${lift} (baseline ${baseline} → transfer ${transfer})`);
        return;
      }
      const hypotheses = store.list();
      const stats = store.stats();
      console.log(chalk.bold("\nmind transfer"));
      console.log(
        `  ${chalk.dim("stats")}      ${stats.total} hypotheses · ${stats.supported} supported · ${stats.rejected} rejected · ${stats.pending} pending · avg lift ${stats.avgLift >= 0 ? "+" : ""}${(stats.avgLift * 100).toFixed(1)}%`,
      );
      console.log(`  ${chalk.dim("candidates")} ${candidates.length} untested distant-domain pairs`);
      if (hypotheses.length > 0) {
        console.log(`  ${chalk.dim("hypotheses")}`);
        for (const hypothesis of hypotheses.slice(0, 8)) {
          const lift =
            hypothesis.lift === null
              ? "pending"
              : `${hypothesis.lift >= 0 ? "+" : ""}${(hypothesis.lift * 100).toFixed(1)}%`;
          const status =
            hypothesis.status === "supported"
              ? chalk.green("supported")
              : hypothesis.status === "rejected"
                ? chalk.dim("rejected")
                : chalk.yellow("pending");
          console.log(
            `    ${hypothesis.id} ${hypothesis.sourceDomain}→${hypothesis.targetDomain} ${status} lift=${lift}`,
          );
          console.log(`      ${chalk.dim(hypothesis.hypothesis.slice(0, 140))}`);
        }
      }
      return;
    }

    if (subCmd === "alive") {
      const action = (rest[0] ?? "show").toLowerCase();
      const extras = this.buildProfileExtras();
      const transferStore = new TransferStore();
      const run = collectAliveRun({
        identity: mind.identity,
        ledger: mind.ledger.stats(),
        rows: mind.ledger.all(),
        calibration: mind.calibration.stats(),
        mistakes: this.mistakes.getStats(),
        transfer: transferStore.stats(),
        idle: mind.idle.status(),
        strategyWeights: extras.strategyWeights,
        patterns: extras.patterns,
        theories: extras.theories,
        skills: extras.skills,
        voiceStats: loadVoiceABStats(),
      });
      const voiceStats = loadVoiceABStats();
      const assessment = assessM5(run, voiceStats);
      if (action === "save") {
        const saved = saveAliveRun(run);
        console.log(chalk.bold("\nmind alive"));
        console.log(`  saved ${saved.jsonPath}`);
        console.log(`  report ${saved.mdPath}`);
        return;
      }
      if (action === "curve") {
        const runs = loadAliveRuns();
        console.log(chalk.bold(`\nmind alive curve (${runs.length} runs)`));
        for (const point of runs.slice(-10)) {
          const div = point.metrics.identityDivergence;
          const transfer = point.metrics.transferLift;
          const ece = point.metrics.calibrationEce;
          console.log(
            `  ${new Date(point.timestamp).toISOString().slice(0, 10)}  div=${div === null ? "n/a" : div.toFixed(2)}  transfer=${transfer === null ? "n/a" : `${(transfer * 100).toFixed(0)}%`}  ece=${ece === null ? "n/a" : ece.toFixed(2)}  ${chalk.dim(`turns=${point.turns}`)}`,
          );
        }
        if (runs.length === 0) console.log(chalk.dim("  no saved runs — use /mind alive save"));
        return;
      }
      console.log(chalk.bold("\nmind alive (ALIVE-1)"));
      const fmt = (value: number | null, render: (v: number) => string) => (value === null ? "n/a" : render(value));
      console.log(`  ${chalk.dim("turns")}      ${run.turns} · fingerprint ${run.fingerprintHash}`);
      console.log(`  ${chalk.dim("slope")}      ${fmt(run.metrics.learningSlope, (v) => v.toFixed(4))} per 100 turns`);
      console.log(
        `  ${chalk.dim("correction")} ${fmt(run.metrics.correctionRecurrence, (v) => `${Math.round(v * 100)}%`)} recurrence`,
      );
      console.log(
        `  ${chalk.dim("transfer")}   ${fmt(run.metrics.transferLift, (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`)} avg lift`,
      );
      console.log(
        `  ${chalk.dim("calibration")} ece ${fmt(run.metrics.calibrationEce, (v) => v.toFixed(3))} · brier ${mind.calibration.stats().brier.toFixed(3)}`,
      );
      console.log(
        `  ${chalk.dim("autonomy")}   ${fmt(run.metrics.autonomyYield, (v) => `${v.toFixed(2)} artifacts/1k tok`)} · ${mind.idle.status().totalCycles} cycles`,
      );
      console.log(`  ${chalk.dim("divergence")} ${fmt(run.metrics.identityDivergence, (v) => v.toFixed(3))} vs fresh`);
      console.log(
        `  ${chalk.dim("voice")}      ${voiceStats.trials > 0 ? `${Math.round(voiceStats.identificationRate * 100)}% blind ID (n=${voiceStats.trials})` : "no blind A/B trials yet"}`,
      );
      console.log(
        `  ${chalk.dim("cost/task")}  ${fmt(run.metrics.costPerSolvedTask, (v) => `$${v.toFixed(4)}`)} per solved turn`,
      );
      for (const criterion of assessment.criteria) {
        const mark = criterion.met ? chalk.green("MET") : chalk.dim("not met");
        const value = criterion.value === null ? "n/a" : criterion.value.toFixed(3);
        console.log(`  ${chalk.dim("m5")}         ${criterion.label}: ${value} (target ${criterion.target}) ${mark}`);
      }
      console.log(
        `  ${chalk.dim("m5 status")}  ${assessment.met ? chalk.green("PASS") : chalk.dim("IN PROGRESS")} ${chalk.dim("(save with /mind alive save)")}`,
      );
      return;
    }

    const stats = mind.stats();
    console.log(chalk.bold("\nmind"));
    console.log(
      `  ${chalk.dim("turns")}      ${stats.ledger.total} recorded, avg score ${stats.ledger.avgScore.toFixed(2)}`,
    );
    console.log(
      `  ${chalk.dim("signals")}    corrected ${(stats.ledger.correctedRate * 100).toFixed(0)}% · thanked ${(stats.ledger.thankedRate * 100).toFixed(0)}% · abandoned ${(stats.ledger.abandonedRate * 100).toFixed(0)}% · tool-fail ${(stats.ledger.toolFailureRate * 100).toFixed(0)}%`,
    );
    try {
      const mistakeStats = this.mistakes.getStats();
      if (mistakeStats.followUps > 0) {
        console.log(
          `  ${chalk.dim("corrections")}  n=${mistakeStats.total} · recurrence ${(mistakeStats.recurrenceRate * 100).toFixed(0)}% of ${mistakeStats.followUps} follow-ups · injected ${mistakeStats.injected}×`,
        );
      } else if (mistakeStats.total > 0) {
        console.log(
          `  ${chalk.dim("corrections")}  n=${mistakeStats.total} · no repeat corrections yet (baseline accumulating)`,
        );
      }
    } catch {
      /* stats unavailable */
    }
    console.log(
      `  ${chalk.dim("prediction")} err ${stats.ledger.avgPredictionError.toFixed(2)} · brier ${stats.calibration.brier.toFixed(2)} · ece ${stats.calibration.ece.toFixed(2)} (n=${stats.calibration.count})`,
    );
    const predSources = stats.ledger.predictionSources;
    const predSourceParts = ["llm", "cache", "heuristic"]
      .filter((k) => (predSources[k] ?? 0) > 0)
      .map((k) => `${k}=${predSources[k]}`);
    if (predSourceParts.length > 0) {
      console.log(
        `  ${chalk.dim("predict src")}  ${predSourceParts.join(" ")} · avg ${Math.round(stats.ledger.avgPredictionTokens)} tok/llm-call`,
      );
    }
    const variantCalibration = Object.entries(stats.calibrationByStrategy).filter(([, s]) => s.count >= 10);
    if (variantCalibration.length > 0) {
      console.log(`  ${chalk.dim("calibration by variant")}`);
      for (const [variant, s] of variantCalibration) {
        console.log(
          `    ${(variant || "unlabeled").padEnd(10)} brier ${s.brier.toFixed(2)} · ece ${s.ece.toFixed(2)} ${chalk.dim(`n=${s.count}`)}`,
        );
      }
    }
    if (stats.ledger.byKind.length > 0) {
      console.log(`  ${chalk.dim("context lift")}  present vs absent arms`);
      for (const kind of stats.ledger.byKind.slice(0, 6)) {
        const lift = kind.lift >= 0 ? `+${kind.lift.toFixed(2)}` : kind.lift.toFixed(2);
        console.log(
          `    ${kind.kind.padEnd(10)} ${lift}  ${chalk.dim(`on n=${kind.present} avg ${kind.presentAvg.toFixed(2)} · off n=${kind.absent} avg ${kind.absentAvg.toFixed(2)}`)}`,
        );
      }
    }
    if (stats.bandit.contexts > 0) {
      console.log(`  ${chalk.dim("strategies")}`);
      for (const [strategy, variant] of Object.entries(stats.bandit.preferred).slice(0, 5)) {
        console.log(`    ${strategy.padEnd(10)} ${variant}`);
      }
    }
    const domains = stats.capability.domains.slice(0, 5);
    if (domains.length > 0) {
      console.log(`  ${chalk.dim("capability")}`);
      for (const domain of domains) {
        const pct = Math.round(domain.confidence * 100);
        console.log(`    ${domain.domain.padEnd(12)} ${pct}%  ${chalk.dim(`n=${domain.count}`)}`);
      }
    }
    console.log(`  ${chalk.dim("fingerprint")} ${stats.identity.hash} (${stats.identity.positions} positions)`);
    console.log(
      `  ${chalk.dim("reliability")} ${stats.reliability.tracked} tracked, avg ${stats.reliability.avgScore.toFixed(2)}`,
    );
  }

  private printAlive(): void {
    const alive = this.infra.alive;
    if (!alive) {
      console.log(chalk.dim("\nAlive is not configured."));
      return;
    }
    const snapshot = alive.inspect();
    console.log(chalk.bold("\nalive"));
    console.log(`  ${chalk.dim("events")}      ${chalk.cyan(String(snapshot.events.length))}`);
    console.log(`  ${chalk.dim("pending")}     ${chalk.cyan(String(snapshot.pendingActions.length))}`);
    console.log(`  ${chalk.dim("predictions")} ${chalk.cyan(String(snapshot.predictions.length))}`);
    console.log(`  ${chalk.dim("open loops")}  ${chalk.cyan(String(snapshot.openLoops.length))}`);
    if (snapshot.pendingActions.length > 0) {
      console.log(`  ${chalk.dim("wake")}`);
      for (const action of snapshot.pendingActions.slice(0, 5)) console.log(`    ${action.kind}: ${action.reason}`);
    }
    if (snapshot.events.length > 0) {
      console.log(`  ${chalk.dim("recent")}`);
      for (const event of snapshot.events.slice(0, 5)) {
        const path = typeof event.payload.path === "string" ? ` ${event.payload.path}` : "";
        const status = typeof event.payload.status === "string" ? ` ${event.payload.status}` : "";
        console.log(`    ${event.type}${status}${path} ${chalk.dim(event.source)}`);
      }
    }
  }

  private async handleModelCommand(arg: string): Promise<void> {
    if (arg.toLowerCase() === "refresh") {
      console.log(chalk.dim("Refreshing the OpenRouter model catalog..."));
      if (await this.refreshModels()) {
        console.log(chalk.green(`Updated ${this.models.length} OpenRouter models.`));
      } else {
        console.log(chalk.yellow("Could not refresh the OpenRouter catalog. Keeping the current list."));
      }
      return;
    }

    if (this.models.length === 0) {
      console.log(chalk.yellow("No OpenRouter model data. Fetching..."));
      try {
        if (!(await this.refreshModels())) {
          console.log(chalk.red("No OpenRouter models are available right now."));
          return;
        }
      } catch (e) {
        console.log(chalk.red(`Failed: ${e}`));
        return;
      }
    } else if (!arg && Date.now() - this.modelCatalogUpdatedAt >= MODEL_REFRESH_INTERVAL_MS) {
      await this.refreshModels();
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
        this.config = patchConfig({ model: selected.id, provider: this.config.provider });
        this.llm.updateModel(selected.id);
        this.llm.updateProvider(this.config.provider);
        const providerTag =
          selected.provider && selected.provider !== "openrouter"
            ? chalk.dim(` [${getProviderNames()[selected.provider] || selected.provider}]`)
            : "";
        console.log(chalk.green(`Switched to ${selected.name}${providerTag}`));
        if (modelSupportsTools(selected) === false) {
          console.log(chalk.yellow("Warning: this model does not advertise tool support — tool calls will not work."));
        }
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
        this.config = patchConfig({ model: match.id, provider: this.config.provider });
        this.llm.updateModel(match.id);
        this.llm.updateProvider(this.config.provider);
        const providerTag =
          match.provider && match.provider !== "openrouter"
            ? chalk.dim(` [${getProviderNames()[match.provider] || match.provider}]`)
            : "";
        console.log(chalk.green(`Switched to ${match.name}${providerTag}`));
        if (modelSupportsTools(match) === false) {
          console.log(chalk.yellow("Warning: this model does not advertise tool support — tool calls will not work."));
        }
        return;
      }
      console.log(chalk.red(`No model matching "${arg}".`));
      return;
    }

    console.log(renderModelsMenu(this.models, this.config.model));
    console.log(
      chalk.dim(
        "\nType /model <number> or /model <name> to switch. Use /model refresh to check for new OpenRouter models.",
      ),
    );
  }

  private handleProviderCommand(arg: string): void {
    const providerNames = getProviderNames();
    if (!arg) {
      console.log(
        chalk.bold(`\nCurrent provider: ${chalk.cyan(providerNames[this.config.provider] || this.config.provider)}`),
      );
      console.log(chalk.bold(`Model: ${chalk.yellow(this.config.model)}`));
      if (this.config.apiBaseUrl) {
        console.log(chalk.dim(`API Base URL: ${this.config.apiBaseUrl}`));
      }
      console.log(chalk.dim("\nAvailable providers:"));
      for (const [key, name] of Object.entries(providerNames)) {
        const active = key === this.config.provider ? chalk.green(" ← active") : "";
        const requiresKey = !["ollama", "lmstudio"].includes(key);
        console.log(
          `  ${chalk.cyan(key.padEnd(20))} ${name}${requiresKey ? "" : chalk.dim(" (no key needed)")}${active}`,
        );
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
            `  Tip: Use /model to select a model from ${getProviderNames()[matched] || matched}, or switch back with /provider ${modelPrefix}.`,
        ),
      );
    }

    this.config = patchConfig({
      provider: matched,
      ...(this.config.apiBaseUrl ? { apiBaseUrl: this.config.apiBaseUrl } : {}),
    });
    console.log(chalk.green(`Switched to provider: ${providerNames[matched]} (${matched})`));
    if (matched === "openai-compatible") {
      console.log(chalk.dim(`API Base URL: ${this.config.apiBaseUrl}`));
    }
  }

  private handleUiCommand(arg: string): void {
    const mode = arg.trim().toLowerCase();
    if (!mode) {
      console.log(chalk.bold("\nUI"));
      console.log(`  ${chalk.dim("mode")}       ${chalk.cyan(this.config.uiMode)}`);
      console.log(`  ${chalk.dim("animation")}  ${this.config.animationLevel}`);
      console.log(`  ${chalk.dim("callbacks")}  ${this.config.verboseCallbacks ? "debug" : "quiet"}`);
      console.log(chalk.dim("\n  /ui minimal   quietest output, no animation"));
      console.log(chalk.dim("  /ui normal    compact status, calm animation"));
      console.log(chalk.dim("  /ui debug     verbose trace-like callbacks"));
      return;
    }

    if (!["minimal", "normal", "debug"].includes(mode)) {
      console.log(chalk.yellow("Usage: /ui <minimal|normal|debug>"));
      return;
    }

    this.config.uiMode = mode as typeof this.config.uiMode;
    if (mode === "minimal") {
      this.config.animationLevel = "off";
      this.config.verboseCallbacks = false;
    } else if (mode === "normal") {
      this.config.animationLevel = "minimal";
      this.config.verboseCallbacks = false;
    } else {
      this.config.animationLevel = "full";
      this.config.verboseCallbacks = true;
    }
    this.config = patchConfig({
      uiMode: mode as typeof this.config.uiMode,
      animationLevel: this.config.animationLevel,
      verboseCallbacks: this.config.verboseCallbacks,
    });
    console.log(chalk.green(`UI mode set to ${mode}`));
  }

  private printConfig(): void {
    const modelInfo = this.models.find((m) => m.id === this.config.model);
    const providerNames = getProviderNames();
    console.log(
      renderConfig(
        this.config.model,
        this.config.maxTokens,
        this.config.temperature,
        modelInfo?.context_length ?? null,
        this.config.embeddingModel,
        this.config.memoryEnabled,
        this.memory.count(),
        providerNames[this.config.provider] || this.config.provider,
        this.config.apiBaseUrl,
        this.config.telegramToken,
        this.config.uiMode,
      ),
    );
  }

  private printCosts(): void {
    const lifetime = loadCosts();
    console.log(
      renderCosts(
        this.sessionInputTokens,
        this.sessionOutputTokens,
        this.sessionCost,
        lifetime.totalInputTokens,
        lifetime.totalOutputTokens,
        lifetime.totalCost,
        this.llm.embeddingFallbacks,
      ),
    );
  }

  private undoLastExchange(): void {
    const trace = this.agent.getLastTrace();
    const undone = this.agent.removeLastTurn();
    if (!undone) {
      console.log(chalk.dim("No exchange to undo."));
      return;
    }
    this.messageCount = Math.max(0, this.messageCount - 1);
    const changed = trace?.fileChanges?.length || 0;
    const fileNote =
      changed > 0
        ? chalk.dim(` Files unchanged; use /rollback for ${changed} file change${changed === 1 ? "" : "s"}.`)
        : "";
    console.log(chalk.green(`Undid last exchange.${fileNote}`));
  }

  private async retryLastExchange(): Promise<void> {
    if (!this.lastSubmittedInput) {
      console.log(chalk.dim("No prompt to retry yet."));
      return;
    }
    const trace = this.agent.getLastTrace();
    if (this.agent.removeLastTurn()) {
      this.messageCount = Math.max(0, this.messageCount - 1);
      const changed = trace?.fileChanges?.length || 0;
      if (changed > 0) {
        console.log(
          chalk.yellow(
            `Retrying conversation only. Files unchanged; use /rollback for ${changed} prior file change${changed === 1 ? "" : "s"}.`,
          ),
        );
      }
    }
    process.stdout.write("\n");
    await sweepDivider(termWidth(), this.config.animationLevel !== "off");
    this.isProcessing = true;
    try {
      await this.handleMessage(this.lastSubmittedInput);
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleMessage(userInput: string): Promise<void> {
    this.messageCount++;
    this.lastSubmittedInput = userInput;
    const expandedInput = await processAtReferences(userInput);
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let hasStarted = false;

    if (!this.config.apiKey && providerRequiresKey(this.config.provider)) {
      console.log(chalk.red("No API key configured. Use /config to set one."));
      return;
    }

    const writer = new ChatRenderer(process.stdout, renderAssistantLabel(), "  ");
    const spinner = new Spinner();
    if (this.config.animationLevel !== "off") spinner.start();
    const turnAbort = new AbortController();
    this.activeTurnAbort = turnAbort;
    const bufferShape =
      this.config.uiMode === "minimal"
        ? { min: 240, max: 900, idle: 180 }
        : this.config.animationLevel === "full"
          ? { min: 80, max: 320, idle: 55 }
          : { min: 120, max: 520, idle: 90 };
    const blockBuffer = new BlockBuffer(
      (text) => writer.write(text),
      bufferShape.min,
      bufferShape.max,
      bufferShape.idle,
    );
    const toolStarts = new Map<string, number>();

    const startOutput = () => {
      if (hasStarted) return;
      hasStarted = true;
      spinner.stop();
      process.stdout.write("\r");
      writer.startLine();
      if (this.thinkingChars > 0) {
        const secs = Math.max(1, Math.round((Date.now() - this.turnStartedAtMs) / 1000));
        writer.writeTag(
          renderInlineTag(`reasoned ${formatTokenCount(this.thinkingChars)} chars in ${secs}s`, chalk.dim),
        );
        this.thinkingChars = 0;
      }
    };

    let outputTokenCount = 0;
    let visibleChars = 0;
    this.thinkingChars = 0;
    this.turnStartedAtMs = Date.now();
    const turnTimeoutMs = computeTurnTimeoutMs(this.config.maxTokens);
    const {
      error: streamError,
      cancelled,
      timedOut,
    } = await runAgentStream(
      this.agent,
      expandedInput,
      {
        onToken: (token) => {
          startOutput();
          if (token) {
            blockBuffer.write(token);
            visibleChars += token.length;
          }
          outputTokenCount++;
          if (!hasStarted && outputTokenCount % 20 === 0) {
            spinner.setText(`generating (${outputTokenCount} tokens)`);
          }
        },
        onToolCall: (name, args) => {
          const key = `${name}:${JSON.stringify(args)}`;
          toolStarts.set(key, Date.now());
          startOutput();
          spinner.setText(`using ${name}`);
          if (this.config.uiMode === "debug" && this.config.animationLevel !== "off") {
            writer.writeTag(renderInlineTag(renderToolPill(name, "running")));
          } else if (this.config.uiMode === "debug") {
            writer.writeTag(renderInlineTag(`tool: ${name}`));
          }
        },
        onToolResult: (name, result, args) => {
          const key = `${name}:${JSON.stringify(args)}`;
          const startedAt = toolStarts.get(key);
          const elapsed = startedAt ? Date.now() - startedAt : undefined;
          toolStarts.delete(key);
          if (this.config.uiMode === "minimal" && result.success) return;
          if (this.config.animationLevel !== "off" || this.config.uiMode !== "minimal" || !result.success) {
            writer.writeTag(renderInlineTag(renderToolEvent(name, result, elapsed)));
          }
        },
        onUsage: (usage) => {
          totalInputTokens += usage.inputTokens;
          totalOutputTokens += usage.outputTokens;
        },
        onThinking: (thought) => {
          if (hasStarted) return;
          this.thinkingChars += thought.length;
          spinner.setText(`reasoning (${formatTokenCount(this.thinkingChars)} chars)`);
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
        },
        onStrategy: (type) => {
          this.lastStrategy = type;
          spinner.setText(type);
        },
        onReflection: (reflection) => {
          this.lastReflection = reflection;
          if (this.config.verboseCallbacks && reflection.confidence < this.config.metaMinConfidence) {
            writer.writeTag(
              renderInlineTag(
                `confidence: ${(reflection.confidence * 100).toFixed(0)}% — gaps: ${reflection.knowledgeGaps.join(", ") || "none"}`,
                chalk.yellow,
              ),
            );
          }
        },
        onCorrectionDetected: (topicKey) => {
          if (this.config.verboseCallbacks) {
            writer.writeTag(renderInlineTag(`correction logged: ${topicKey}`, chalk.yellow));
          }
        },
        onSkillTriggered: (name, confidence) => {
          if (this.config.verboseCallbacks) {
            writer.writeTag(renderInlineTag(`skill: ${name} (${(confidence * 100).toFixed(0)}%)`, chalk.magenta));
          }
        },
        onSkillProposal: (skill) => {
          this.pendingSkillProposal = skill;
          console.log(chalk.magenta("\n" + renderSkillProposal(skill)));
        },
        onProactiveSuggestion: (suggestion) => {
          if (suggestion.type === "milestone" || suggestion.type === "feedback-prompt") return;
          if (!this.config.verboseCallbacks) return;
          const color = suggestion.type === "goal-reminder" ? chalk.green : chalk.cyan;
          writer.writeTag(renderInlineTag(suggestion.message, color));
        },
        onCognitive: (summary) => {
          spinner.setText(summary);
        },
        onStyleGuidance: (guidance) => {
          if (!this.config.verboseCallbacks) return;
          if (guidance.includes("Keep being")) return;
          writer.writeTag(renderInlineTag(`style: ${guidance}`, chalk.cyan));
        },
        onSelfAwareness: (message) => {
          if (!this.config.verboseCallbacks) return;
          if (message.includes("communicate in a") || message.includes("learn best via")) return;
          writer.writeTag(renderInlineTag(message, chalk.green));
        },
        onFeedbackRequest: (question) => {
          if (this.config.verboseCallbacks) {
            writer.writeTag(renderInlineTag(question, chalk.yellow));
          }
        },
        onIntervention: (intervention) => {
          if (this.config.verboseCallbacks) {
            const color = intervention.confidence > 0.7 ? chalk.red : chalk.yellow;
            writer.writeTag(renderInlineTag(intervention.message, color));
          }
        },
        onDisagreement: (disagreement) => {
          if (this.config.verboseCallbacks) {
            const color = disagreement.confidence > 0.7 ? chalk.red : chalk.yellow;
            writer.writeTag(renderInlineTag(`I disagree: ${disagreement.reason}`, color));
          }
        },
      },
      turnAbort.signal,
      { absoluteTimeoutMs: turnTimeoutMs },
    );

    spinner.stop();
    if (this.activeTurnAbort === turnAbort) this.activeTurnAbort = null;

    if (!hasStarted && this.thinkingChars > 0) {
      const secs = Math.max(1, Math.round((Date.now() - this.turnStartedAtMs) / 1000));
      process.stdout.write(
        renderInlineTag(`reasoned ${formatTokenCount(this.thinkingChars)} chars in ${secs}s`, chalk.dim) + "\n",
      );
      this.thinkingChars = 0;
    }

    if (!hasStarted && totalInputTokens === 0) {
      const providerHint = providerRequiresKey(this.config.provider)
        ? `\n  Check: API key (/config), model name (/model), or provider (/provider).`
        : `\n  Check: Is ${this.config.provider} running on ${this.config.apiBaseUrl || "localhost"}?`;
      console.log(chalk.red(`(no response from model — check your provider/model settings)${providerHint}`));
    }

    blockBuffer.forceFlush();
    writer.flush();

    if (visibleChars === 0 && totalOutputTokens > 0 && !streamError && !cancelled && !timedOut) {
      console.log(
        chalk.yellow(
          `\n  The model used ${totalOutputTokens} output tokens but returned no visible text — usually a provider or tool-calling glitch. Try /retry or switch model (/model).`,
        ),
      );
    }

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

      if (!streamError && !cancelled) {
        const trace = this.agent.getLastTrace();
        process.stdout.write(
          `\n${renderStatusBar({ inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: 0 }, trace, {
            memoryCount: this.memory.count(),
            skillsCount: this.skillRegistry.count(),
          })}\n`,
        );
        if (
          trace &&
          (trace.toolCalls.length > 0 ||
            (trace.fileChanges?.length || 0) > 0 ||
            trace.checkpointIds.length > 0 ||
            trace.error)
        ) {
          process.stdout.write(`${chalk.dim("  /last for details  /retry to rerun")}\n`);
        }
      }

      if (timedOut) {
        console.log(
          chalk.yellow(
            `\n  Turn timed out after ${Math.round(turnTimeoutMs / 60000)} minutes — turn aborted so you're never stuck.\n` +
              `  Tip: lower maxTokens (/config set maxTokens 8192) for faster responses.`,
          ),
        );
      } else if (cancelled) {
        console.log(chalk.yellow("\n  Turn cancelled."));
      } else if (streamError) {
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
    if (this.isProcessing && this.activeTurnAbort && !this.activeTurnAbort.signal.aborted) {
      this.activeTurnAbort.abort(new Error("cancelled"));
      console.log(chalk.yellow("\nCancelled current turn. Press Ctrl+C again to exit."));
      return;
    }
    this.exiting = true;
    try {
      this.rl.close();
    } catch {
      /* already closed */
    }
    animateExit()
      .then(() => {
        void this.doExit();
      })
      .catch(() => {
        void this.doExit();
      });
  }

  private async doExit(): Promise<void> {
    try {
      await this.infra.mcp.disconnect();
    } catch {
      /* best-effort MCP shutdown */
    }
    try {
      this.infra.aliveHosts?.stop();
      const awarenessSummary = this.agent.recordSessionEnd(this.sessionId);
      this.userModel.endSession();
      this.userModel.flush();
      const lifetime = loadCosts();
      if (this.sessionCost > 0) {
        console.log(
          chalk.dim(
            `\nSession: ${this.fmtTokens(this.sessionInputTokens)} in, ${this.fmtTokens(this.sessionOutputTokens)} out, ${this.fmtCost(this.sessionCost)}`,
          ),
        );
        console.log(
          chalk.dim(
            `Memory: ${this.memory.count()} episodes | Skills: ${this.skillRegistry.count()} | Mistakes: ${this.mistakes.getStats().total}`,
          ),
        );
        console.log(chalk.dim(`Bond: ${this.agent.getBondLabel()}`));
        if (awarenessSummary) console.log(chalk.dim(`Learned: ${awarenessSummary}`));
        console.log(
          chalk.dim(
            `Lifetime: ${this.fmtTokens(lifetime.totalInputTokens)} in, ${this.fmtTokens(lifetime.totalOutputTokens)} out, ${this.fmtCost(lifetime.totalCost)}`,
          ),
        );
      }
    } catch {
      /* best-effort exit */
    }
    console.log(`\n  ${gradient("session closed", palette.accent, palette.violet)} ${chalk.dim("· goodbye")}`);
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
