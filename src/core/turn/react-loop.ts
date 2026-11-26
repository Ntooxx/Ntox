import { isTransientStreamError } from "../errors.js";
import type { Message, ToolCall, AgentTurnTrace, ToolContext } from "../../types/index.js";
import type { ResponseMode } from "../../meta/response-mode.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { AgentCallbacks, AgentConfig, AgentRunOptions } from "../agent.js";
import type { TurnRuntime } from "./turn-types.js";
import type { PostTurnInfo } from "./post-turn.js";
import {
  MAX_TURN_ATTEMPTS,
  MAX_STREAM_RETRIES,
  STREAM_RETRY_BACKOFF_MS,
  MAX_ACTION_NUDGES,
  MAX_PLAN_CONTINUES,
  MAX_FAILURE_EXPLAINS,
  MAX_TOOL_CALLS_PER_RESPONSE,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_WEB_TOOL_CALLS_PER_TURN,
  WEB_TOOL_NAMES,
  commitsToImmediateAction,
  isCompleteAnswer,
  allowsAgenticContinuation,
  unfinishedPlanTasks,
  collectTurnFailures,
  responseAddressesFailures,
  extractLegacyXmlToolCalls,
} from "./turn-helpers.js";
import {
  executeToolBatch,
  buildTurnLimitNotice,
  REPEAT_STRIKES_BEFORE_NUDGE,
  type ToolCallBudget,
  type RepeatWatch,
  type ToolExecContext,
} from "./tool-executor.js";
import { checkFalseSuccess } from "./false-success.js";
import type { RoutingDecision } from "../../evaluation/routing.js";

export interface ReactLoopInput {
  cfg: AgentConfig;
  callbacks: AgentCallbacks;
  options: AgentRunOptions;
  userInput: string;
  messages: Message[];
  fullSystemPrompt: string;
  openaiTools: ReturnType<ToolRegistry["toOpenAITools"]>;
  toolContext: ToolContext;
  responseMode: ResponseMode;
  toolExec: ToolExecContext;
  runtime: TurnRuntime;
  trace: AgentTurnTrace | null;
  routing?: RoutingDecision;
  finishTrace: (response?: string, error?: string) => void;
  commitTurn: (finalText: string) => void;
  pushMessage: (msg: Message) => void;
  postTurn: (info: PostTurnInfo) => Promise<void>;
  saveSession: () => void;
}

export async function* runReactLoop(input: ReactLoopInput): AsyncGenerator<string> {
  const { cfg, callbacks, options, userInput, messages, responseMode, toolExec, runtime, trace } = input;
  const openaiTools = input.openaiTools;
  const fullSystemPrompt = input.fullSystemPrompt;
  const toolContext = input.toolContext;
  const agenticContinuation = allowsAgenticContinuation(input.routing?.route);
  const emitFinalStream = openaiTools.length === 0 || responseMode === "simple-query" || !agenticContinuation;

  // 10. ReAct loop
  callbacks.onPhase?.("responding");
  let done = false;
  let fullResponse = "";
  let attempts = 0;
  let streamRetries = 0;
  let actionNudges = 0;
  let planContinues = 0;
  let failureExplains = 0;
  let modelCritiqueUsed = false;
  let turnCostUsd = 0;
  let turnTokens = 0;
  const toolCallBudget: ToolCallBudget = { total: 0, web: 0 };
  const failedToolCalls = new Map<string, string>();
  const repeatWatch: RepeatWatch = { names: null, tokens: null, strikes: 0, notifiedAt: 0 };

  while (!done && attempts < MAX_TURN_ATTEMPTS) {
    attempts++;
    if (trace) trace.retries = Math.max(0, attempts - 1);
    let responseBuffer = "";

    const availableTools =
      toolCallBudget.total >= MAX_TOOL_CALLS_PER_TURN
        ? []
        : openaiTools.filter(
            (tool) => !(toolCallBudget.web >= MAX_WEB_TOOL_CALLS_PER_TURN && WEB_TOOL_NAMES.has(tool.function.name)),
          );
    const streamIter = cfg.llm.stream(messages, fullSystemPrompt, availableTools, options.signal);
    const pendingToolCalls: ToolCall[] = [];
    let discardedToolCalls = 0;
    let providerToolCallLimitReached = false;
    try {
      for await (const chunk of streamIter) {
        if (chunk.toolCallLimitReached) providerToolCallLimitReached = true;
        if (chunk.usage) {
          callbacks.onUsage(chunk.usage);
          turnCostUsd += chunk.usage.cost;
          turnTokens += chunk.usage.inputTokens + chunk.usage.outputTokens;
        }
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          const remaining = MAX_TOOL_CALLS_PER_RESPONSE - pendingToolCalls.length;
          pendingToolCalls.push(...chunk.toolCalls.slice(0, Math.max(0, remaining)));
          discardedToolCalls += Math.max(0, chunk.toolCalls.length - Math.max(0, remaining));
          continue;
        }
        if (chunk.thinking) {
          callbacks.onThinking?.(chunk.thinking);
        }
        if (chunk.delta) {
          responseBuffer += chunk.delta;
          if (emitFinalStream) callbacks.onToken(chunk.delta);
          else callbacks.onIntermediate?.(chunk.delta);
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (options.signal?.aborted || errMsg.includes("cancelled")) {
        input.finishTrace(fullResponse + responseBuffer, "cancelled");
        throw new Error("cancelled", { cause: e });
      }
      if (streamRetries < MAX_STREAM_RETRIES && isTransientStreamError(e)) {
        streamRetries++;
        if (responseBuffer) {
          fullResponse += responseBuffer;
          input.pushMessage({ role: "assistant", content: responseBuffer });
          input.pushMessage({
            role: "user",
            content:
              "[STREAM INTERRUPTED] The provider dropped the connection partway through your reply. " +
              "Continue from the exact point where you stopped: do not repeat text you already produced, do not restart the answer.",
          });
        }
        if (trace) trace.error = errMsg;
        callbacks.onPhase?.("retrying");
        await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_BACKOFF_MS * streamRetries));
        continue;
      }
      input.pushMessage({ role: "assistant", content: `[Stream error: ${errMsg}]` });
      input.finishTrace(fullResponse + responseBuffer, errMsg);
      throw e;
    }

    if (pendingToolCalls.length === 0 && responseBuffer && openaiTools.length > 0) {
      const legacy = extractLegacyXmlToolCalls(responseBuffer, (name) => cfg.tools.get(name) !== undefined);
      if (legacy.calls.length > 0) {
        pendingToolCalls.push(...legacy.calls);
        responseBuffer = legacy.cleaned;
      }
    }

    if (pendingToolCalls.length > 0) {
      input.pushMessage({ role: "assistant", content: responseBuffer || "(tool call)", tool_calls: pendingToolCalls });
      await executeToolBatch(
        toolExec,
        pendingToolCalls,
        toolContext,
        failedToolCalls,
        callbacks,
        toolCallBudget,
        repeatWatch,
      );
      if (discardedToolCalls > 0 || providerToolCallLimitReached) {
        input.pushMessage({
          role: "user",
          content:
            `[TOOL LIMIT] This response exceeded the ${MAX_TOOL_CALLS_PER_RESPONSE}-call batch limit. ` +
            `${discardedToolCalls > 0 ? `${discardedToolCalls} extra calls were ignored. ` : "Extra calls were ignored. "}` +
            `Use the results already returned; do not generate URL variations or another bulk batch. Answer the user's request now.`,
        });
      }
      if (toolCallBudget.web >= MAX_WEB_TOOL_CALLS_PER_TURN || toolCallBudget.total >= MAX_TOOL_CALLS_PER_TURN) {
        input.pushMessage({
          role: "user",
          content:
            `[TOOL LIMIT] This turn has reached its limit of ${toolCallBudget.web >= MAX_WEB_TOOL_CALLS_PER_TURN ? MAX_WEB_TOOL_CALLS_PER_TURN + " web calls" : MAX_TOOL_CALLS_PER_TURN + " total tool calls"}. ` +
            `Synthesize the evidence and work completed so far, state any gaps, and answer now without requesting more tools.`,
        });
      }
      if (repeatWatch.strikes >= REPEAT_STRIKES_BEFORE_NUDGE && repeatWatch.strikes !== repeatWatch.notifiedAt) {
        repeatWatch.notifiedAt = repeatWatch.strikes;
        input.pushMessage({
          role: "user",
          content:
            `[REPEAT GUARD] The last ${repeatWatch.strikes} tool batches returned the same information (${repeatWatch.names}). ` +
            `Varying the arguments is not producing new evidence. Use the results already available: answer the user now, ` +
            `or state the blocker and the single next step that would actually change the outcome.`,
        });
      }
      continue;
    }

    if (responseMode === "tool-build" && attempts < 3) {
      const correction =
        "[BUILD MODE] You explained instead of building. Create the file NOW using the write tool. No explanation. No questions. Just build it.";
      input.pushMessage({ role: "assistant", content: responseBuffer });
      input.pushMessage({ role: "user", content: correction });
      continue;
    }

    if (responseMode === "tool-build" && attempts >= 3 && !done) {
      done = true;
    }

    // False success detection
    const falseSuccess = await checkFalseSuccess({
      cfg,
      userInput,
      responseBuffer,
      responseMode,
      attempts,
      done,
      modelCritiqueUsed,
      runtime,
      trace,
      pushMessage: input.pushMessage,
    });
    modelCritiqueUsed = falseSuccess.modelCritiqueUsed;
    if (falseSuccess.acted) continue;

    if (
      !done &&
      agenticContinuation &&
      !isCompleteAnswer(responseBuffer) &&
      openaiTools.length > 0 &&
      actionNudges < MAX_ACTION_NUDGES &&
      attempts < 6 &&
      responseMode !== "simple-query" &&
      responseMode !== "profile-update" &&
      commitsToImmediateAction(responseBuffer)
    ) {
      actionNudges++;
      input.pushMessage({ role: "assistant", content: responseBuffer });
      input.pushMessage({
        role: "user",
        content:
          "[ACTION REQUIRED] You announced you would act but made no tool call. Use the tools NOW to perform the action (write the file, run the command) — or state clearly that you cannot. Do not announce future actions without executing them.",
      });
      continue;
    }

    if (
      !done &&
      agenticContinuation &&
      planContinues < MAX_PLAN_CONTINUES &&
      attempts < MAX_TURN_ATTEMPTS &&
      openaiTools.length > 0 &&
      toolCallBudget.total < MAX_TOOL_CALLS_PER_TURN &&
      responseMode !== "profile-update"
    ) {
      const openTasks = unfinishedPlanTasks(cfg.sessionId);
      if (openTasks.length > 0) {
        planContinues++;
        const taskList = openTasks
          .slice(0, 6)
          .map((task) => `${task.id} (${task.status}) ${task.title}`)
          .join("; ");
        input.pushMessage({ role: "assistant", content: responseBuffer });
        input.pushMessage({
          role: "user",
          content:
            `[AUTO-CONTINUE] The active plan still has unfinished tasks: ${taskList}. ` +
            `Keep working now — call the next tool and drive the plan to completion. Do not stop to ask the user to say go, continue, or proceed. ` +
            `If the user's latest message deserves a direct reply, reply to it first, then continue the plan. ` +
            `Only end your turn when every task is completed, or you are genuinely blocked — and if blocked, say exactly what blocks it.`,
        });
        continue;
      }
    }

    if (!done && agenticContinuation && failureExplains < MAX_FAILURE_EXPLAINS && attempts < MAX_TURN_ATTEMPTS) {
      const failures = collectTurnFailures(trace);
      if (
        failures.length > 0 &&
        responseBuffer.trim().length > 0 &&
        !responseAddressesFailures(responseBuffer, failures)
      ) {
        failureExplains++;
        const failureList = failures
          .slice(0, 5)
          .map((failure) => `${failure.name}: ${failure.error.slice(0, 300)}`)
          .join("; ");
        input.pushMessage({ role: "assistant", content: responseBuffer });
        input.pushMessage({
          role: "user",
          content:
            `[EXPLAIN FAILURES] Your reply ends the turn while these tool calls failed: ${failureList}. ` +
            `Reply again with an explanation the user can act on: what you tried, why it failed, and what you did instead or what they should do about it. ` +
            `Include that explanation in your final answer.`,
        });
        continue;
      }
    }

    fullResponse += responseBuffer;
    if (!emitFinalStream) callbacks.onToken(fullResponse);
    input.pushMessage({ role: "assistant", content: responseBuffer });

    input.commitTurn(fullResponse);
    yield fullResponse;

    await input.postTurn({ responseBuffer, fullResponse, attempts, turnCostUsd, turnTokens });
    input.saveSession();
    return;
  }

  if (!done) {
    const notice = buildTurnLimitNotice(toolExec, cfg.sessionId);
    const finalText = (fullResponse + notice).trim();
    if (!emitFinalStream) callbacks.onToken(finalText);
    else callbacks.onToken(notice);
    input.pushMessage({ role: "assistant", content: notice });
    input.commitTurn(finalText);
    yield finalText;
    input.saveSession();
  }
}
