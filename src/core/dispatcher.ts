import { homedir } from "node:os";
import { LLMClient } from "./llm.js";
import type { AgentConfig, AgentCallbacks } from "./agent.js";
import { Agent } from "./agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { shellTool } from "../tools/shell.js";
import { readTool, writeTool, globTool, lsTool, editTool } from "../tools/filesystem.js";
import { grepTool } from "../tools/grep.js";
import { webFetchTool } from "../tools/web.js";
import { searchTool } from "../tools/search.js";
import { ttsTool } from "../tools/voice.js";
import { sttTool } from "../tools/stt.js";
import { imageTool } from "../tools/image.js";
import { subagentTool } from "../tools/subagent.js";
import { checkpointTool } from "../tools/checkpoint.js";
import { MemoryStore } from "../memory/episodic.js";
import { UserModel } from "../memory/user-model.js";
import { Reflector } from "../meta/reflector.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { SkillExecutor } from "../skills/executor.js";
import { SkillRegistry } from "../skills/registry.js";
import { SkillLibrary } from "../skills/library.js";
import { Analytics } from "../meta/analytics.js";
import { ProactiveEngine } from "../meta/proactive.js";
import { ObservationEngine } from "../meta/observation.js";
import { CognitiveKernel } from "../cognition/kernel.js";
import type { NtoxConfig, CostUsage } from "../types/index.js";

export interface AgentInfra {
  llm: LLMClient;
  tools: ToolRegistry;
  memory: MemoryStore;
  userModel: UserModel;
  mistakes: MistakeJournal;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  skillLibrary: SkillLibrary;
  analytics: Analytics;
  proactive: ProactiveEngine;
  observation: ObservationEngine;
  cognitiveKernel: CognitiveKernel;
}

export interface SharedInfra {
  llm: LLMClient;
  tools: ToolRegistry;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  skillLibrary: SkillLibrary;
}

export interface SessionInfra {
  memory: MemoryStore;
  userModel: UserModel;
  mistakes: MistakeJournal;
  analytics: Analytics;
  proactive: ProactiveEngine;
  observation: ObservationEngine;
  cognitiveKernel: CognitiveKernel;
}

export function createSharedInfra(config: NtoxConfig): SharedInfra {
  const llm = new LLMClient(
    config.apiKey, config.model, config.embeddingModel,
    config.maxTokens, config.temperature, config.apiBaseUrl, config.provider
  );

  const tools = new ToolRegistry();
  tools.register(readTool);
  tools.register(writeTool);
  tools.register(globTool);
  tools.register(lsTool);
  tools.register(shellTool);
  tools.register(webFetchTool);
  tools.register(searchTool);
  tools.register(grepTool);
  tools.register(editTool);
  tools.register(ttsTool);
  tools.register(sttTool);
  tools.register(imageTool);
  tools.register(subagentTool);
  tools.register(checkpointTool);

  const skillRegistry = new SkillRegistry();
  const skillExecutor = new SkillExecutor(skillRegistry, true);
  const skillLibrary = new SkillLibrary();

  return { llm, tools, skillRegistry, skillExecutor, skillLibrary };
}

export function createSessionInfra(shared: SharedInfra): SessionInfra {
  const analytics = new Analytics();
  return {
    memory: new MemoryStore(),
    userModel: new UserModel(),
    mistakes: new MistakeJournal(),
    analytics,
    proactive: new ProactiveEngine(analytics),
    observation: new ObservationEngine(),
    cognitiveKernel: new CognitiveKernel(shared.skillRegistry),
  };
}

export function createAgentInfra(config: NtoxConfig): AgentInfra {
  const shared = createSharedInfra(config);
  const session = createSessionInfra(shared);
  return { ...shared, ...session };
}

export function createAgentConfig(
  infra: AgentInfra,
  config: NtoxConfig,
  sessionId: string,
  overrides: Partial<AgentConfig> = {}
): AgentConfig {
  return {
    llm: infra.llm,
    tools: infra.tools,
    memory: infra.memory,
    reflector: new Reflector(infra.llm, config.metaReflectionEnabled),
    mistakes: infra.mistakes,
    userModel: infra.userModel,
    skillExecutor: infra.skillExecutor,
    skillLibrary: infra.skillLibrary,
    analytics: infra.analytics,
    proactive: infra.proactive,
    observation: infra.observation,
    cognitiveKernel: infra.cognitiveKernel,
    kernelEnabled: false,
    kernelBasePath: homedir(),
    sessionId,
    systemPrompt: config.systemPrompt,
    memoryEnabled: config.memoryEnabled,
    memoryRetrievalCount: config.memoryRetrievalCount,
    theoryEnabled: config.theoryEnabled,
    strategyEnabled: config.metaStrategyEnabled,
    mistakesEnabled: config.metaMistakesEnabled,
    minConfidence: config.metaMinConfidence,
    maxContextMessages: 40,
    contextTokenBudget: 100_000,
    ...overrides,
  };
}

export class SessionManager {
  private agents = new Map<string, Agent>();
  private lastActive = new Map<string, number>();
  private locks = new Map<string, boolean>();
  private ttl: number;

  constructor(ttlMs: number = 30 * 60 * 1000) {
    this.ttl = ttlMs;
  }

  lock(id: string): boolean {
    if (this.locks.has(id)) return false;
    this.locks.set(id, true);
    return true;
  }

  unlock(id: string): void {
    this.locks.delete(id);
  }

  isLocked(id: string): boolean {
    return this.locks.has(id);
  }

  getOrCreate(id: string, cfg: AgentConfig): Agent {
    if (this.agents.has(id)) {
      this.lastActive.set(id, Date.now());
      return this.agents.get(id)!;
    }
    const agent = new Agent(cfg);
    this.agents.set(id, agent);
    this.lastActive.set(id, Date.now());
    return agent;
  }

  delete(id: string): void {
    this.agents.delete(id);
    this.lastActive.delete(id);
    this.locks.delete(id);
  }

  purge(): string[] {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, ts] of this.lastActive) {
      if (now - ts > this.ttl) {
        this.agents.delete(id);
        this.lastActive.delete(id);
        this.locks.delete(id);
        expired.push(id);
      }
    }
    return expired;
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  touch(id: string): void {
    this.lastActive.set(id, Date.now());
  }
}

export interface MessageOutput {
  onStart?(): void;
  onToken(token: string): void;
  onToolCall?(name: string): void;
  onUsage?(usage: CostUsage): void;
  onThinking?(thought: string): void;
  onEnd?(): void;
  flush(): string;
}

export interface MessageResult {
  response: string;
  toolCalls: string[];
  error: string | null;
}

export async function runAgentMessage(
  agent: Agent,
  text: string,
  output: MessageOutput
): Promise<MessageResult> {
  output.onStart?.();
  let response = "";
  const toolCalls: string[] = [];

  try {
    const callbacks: AgentCallbacks = {
      onToken: (token) => { response += token; output.onToken(token); },
      onToolCall: (name) => {
        toolCalls.push(name);
        output.onToolCall?.(name);
      },
      onToolResult: () => {},
      onUsage: (usage) => { output.onUsage?.(usage); },
      onThinking: (thought) => { output.onThinking?.(thought); },
    };

    const stream = agent.run(text, callbacks);
    for await (const _ of stream) { /* drain */ }
  } catch (e) {
    output.onEnd?.();
    const msg = e instanceof Error ? e.message : String(e);
    return { response: "", toolCalls, error: msg };
  }

  output.onEnd?.();
  let result = output.flush() || response.trim();
  if (!result) {
    result = toolCalls.length > 0
      ? `Ran ${toolCalls.length} tool${toolCalls.length > 1 ? "s" : ""}: ${toolCalls.join(", ")}`
      : "(no response)";
  }

  return { response: result, toolCalls, error: null };
}

export class GatewayOutput implements MessageOutput {
  public toolCalls: string[] = [];
  private buffer = "";
  private notifyTyping?: () => void;

  constructor(notifyTyping?: () => void) {
    this.notifyTyping = notifyTyping;
  }

  onToken(token: string): void { this.buffer += token; }
  onToolCall(name: string): void {
    this.toolCalls.push(name);
    this.notifyTyping?.();
  }
  flush(): string { return this.buffer.trim(); }
}
