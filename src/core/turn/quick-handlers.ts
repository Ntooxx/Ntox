import type { AgentTurnTrace, Message } from "../../types/index.js";
import type { DecisionKernel } from "../../kernel/index.js";
import type { AgentCallbacks, AgentConfig } from "../agent.js";
import { classifyMode, type ResponseMode } from "../../meta/response-mode.js";
import { scoreEffectiveness } from "../../meta/effectiveness.js";
import { classifyResponseStyle } from "../../meta/style-optimizer.js";
import { scoreInteraction } from "../../meta/interaction-score.js";
import {
  classifySessionIntent,
  isTechnicalQuery,
  shouldShiftIntent,
  getIntentGuidance,
  type SessionContext,
} from "../../meta/session-intent.js";
import { buildTimeContext, getTimeGuidance } from "../../meta/time-adapter.js";
import type { StyleOptimizer } from "../../meta/style-optimizer.js";
import type { RelationshipTracker } from "../../memory/relationship.js";
import type { SelfAwareness } from "../../meta/self-aware.js";

export interface QuickHandlerContext {
  userInput: string;
  cfg: AgentConfig;
  trace: AgentTurnTrace | null;
  pushMessage: (msg: Message) => void;
  onToken: (token: string) => void;
  decisionKernel: DecisionKernel | null;
  handleKernelMessage: (userInput: string) => Promise<string | null>;
}

export type QuickHandlerResult =
  { kind: "kernel" | "quick"; text: string } | { kind: "continue"; responseMode: ResponseMode };

export async function handleQuickPaths(ctx: QuickHandlerContext): Promise<QuickHandlerResult> {
  const { userInput, cfg } = ctx;
  const responseMode = classifyMode(userInput);
  if (ctx.trace) ctx.trace.responseMode = responseMode;

  if (
    ctx.decisionKernel &&
    (responseMode === "tool-execute" ||
      responseMode === "tool-build" ||
      responseMode === "profile-update" ||
      userInput.trim().startsWith("/kernel"))
  ) {
    const kernelResult = await ctx.handleKernelMessage(userInput);
    if (kernelResult !== null) {
      return { kind: "kernel", text: kernelResult };
    }
  }

  if (responseMode === "profile-update") {
    const nameMatch = userInput.match(
      /(?:my name is|call me|i am|i'm|people call me)\s+([\w\s]+?)(?:\s*,|\s*\.|\s*$)/i,
    );
    if (nameMatch) {
      const name = nameMatch[1].trim().replace(/\s{2,}/g, " ");
      cfg.userModel.setName(name);
      const response = `Got it — I'll call you ${name} from now on.`;
      ctx.pushMessage({ role: "assistant", content: response });
      ctx.onToken(response);
      return { kind: "quick", text: response };
    }
    const jobMatch = userInput.match(/(?:i work as|my (?:job|role|title) is)\s+(.+)/i);
    if (jobMatch) {
      const job = jobMatch[1].trim();
      cfg.userModel.setExpertise(job, "intermediate");
      const response = `Got it — you work as **${job}**. I'll keep that in mind.`;
      ctx.pushMessage({ role: "assistant", content: response });
      ctx.onToken(response);
      return { kind: "quick", text: response };
    }
  }

  return { kind: "continue", responseMode };
}

export interface TurnPreambleInput {
  userInput: string;
  cfg: AgentConfig;
  callbacks: AgentCallbacks;
  messages: Message[];
  lastAssistantResponse: string | null;
  lastUserMessage: string | null;
  styleOptimizer: StyleOptimizer;
  relationshipTracker: RelationshipTracker;
  sessionContext: SessionContext;
  selfAwareness: SelfAwareness;
}

export interface TurnPreambleResult {
  styleGuidance: string;
  sessionGuidance: string;
  timeGuidance: string;
}

export function runTurnPreamble(input: TurnPreambleInput): TurnPreambleResult {
  const { userInput, cfg, callbacks, messages } = input;
  // 0. Effectiveness tracking — score this message against the previous assistant response
  let styleGuidance = "";
  if (input.lastAssistantResponse && messages.length >= 2) {
    const effectiveness = scoreEffectiveness(userInput, input.lastAssistantResponse);
    if (effectiveness.isPositive || effectiveness.isNegative) {
      const prevStyle = classifyResponseStyle(input.lastAssistantResponse);
      input.styleOptimizer.setLastResponse(prevStyle);
      input.styleOptimizer.update(effectiveness);
    }
  }
  if (messages.length >= 2) {
    styleGuidance = input.styleOptimizer.getGuidance();
    if (styleGuidance && callbacks.onStyleGuidance) {
      callbacks.onStyleGuidance(styleGuidance.split("\n")[0].replace(/^- /, ""));
    }
  }

  // 0b. Interaction scoring — score previous exchange using current message as feedback
  if (input.lastAssistantResponse && input.lastUserMessage && messages.length >= 2) {
    const interactionScore = scoreInteraction(input.lastUserMessage, input.lastAssistantResponse, userInput);
    if (interactionScore.solved || Math.abs(interactionScore.satisfaction) > 0.1) {
      input.relationshipTracker.record(interactionScore);
      // Feed into user model closeness
      if (interactionScore.solved) {
        input.relationshipTracker.getBondLevel();
      }
    }
  }

  // 0a. Session context tracking
  const profile = cfg.userModel.getProfile();
  input.sessionContext.queryCount++;

  // Self-awareness: session start + discoveries from profile
  if (messages.length === 1) {
    input.selfAwareness.startSession();
    input.selfAwareness.discoverFromProfile(profile);
  }

  if (messages.length === 1) {
    // First message in session — detect intent
    input.sessionContext.intent = classifySessionIntent(userInput);
    input.sessionContext.startedAt = Date.now();
  } else {
    // Track intent shifts
    const newIntent = shouldShiftIntent(
      input.sessionContext.intent,
      userInput,
      input.sessionContext.consecutiveTechnical,
    );
    if (newIntent) {
      input.sessionContext.intent = newIntent;
      input.sessionContext.lastIntentShift = Date.now();
      input.sessionContext.shiftCount++;
    }
  }
  if (isTechnicalQuery(userInput)) {
    input.sessionContext.consecutiveTechnical++;
  } else {
    input.sessionContext.consecutiveTechnical = 0;
  }
  const sessionGuidance = getIntentGuidance(input.sessionContext.intent);
  const timeCtx = buildTimeContext(profile.lastActive);
  const timeGuidance = getTimeGuidance(timeCtx);

  return { styleGuidance, sessionGuidance, timeGuidance };
}
