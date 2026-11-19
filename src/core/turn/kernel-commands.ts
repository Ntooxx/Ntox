import {
  Goal,
  Subtask,
  ActionResult,
  StateTransition,
  evolveState,
  ExecuteAction,
  type IdentityLog,
  type Verifier,
  type DecisionKernel,
} from "../../kernel/index.js";
import type { AgentCallbacks, AgentConfig } from "../agent.js";

export interface KernelRuntime {
  decisionKernel: DecisionKernel | null;
  identityLog: IdentityLog;
  verifier: Verifier;
  cycle: number;
}

export async function runKernelCommand(
  cfg: AgentConfig,
  callbacks: AgentCallbacks,
  kernel: KernelRuntime,
  userInput: string,
): Promise<string | null> {
  if (!kernel.decisionKernel) return null;
  const k = kernel.decisionKernel;
  const kernelActive = cfg.kernelEnabled === true && kernel.decisionKernel !== null;

  // Helper: execute a kernel action (creates goal, ticks, verifies, evolves, logs)
  const executeKernelAction = async (
    actionType: string,
    goalDesc: string,
    subtaskDesc: string,
    successCheck: () => boolean,
    successMsg: string,
    failMsg: string,
  ): Promise<string> => {
    const goal = new Goal(`g-${kernel.cycle}`, goalDesc, 5, () => true, [
      new Subtask(`s-${kernel.cycle}-1`, subtaskDesc, () => successCheck()),
    ]);
    k.goalQueue.add(goal);
    const action = k.tick();
    if (action instanceof ExecuteAction) {
      const outcome = kernel.verifier.verifySubtask(action.subtask as Subtask, null);
      const result = new ActionResult(actionType, outcome.success, outcome.details, kernel.cycle, cfg.sessionId);
      const after = evolveState(k.state, result);
      kernel.identityLog.append(
        new StateTransition(k.state.clone(), after, result, `kernel:${actionType}`, kernel.cycle),
      );
      k.state = after;
      kernel.cycle++;
      callbacks.onToken(outcome.success ? successMsg : failMsg);
      return outcome.success ? successMsg : failMsg;
    }
    return "Kernel did not return Execute action.";
  };

  // ─── /kernel commands ────────────────────────────────────────────

  // Create file — only when explicitly scoped: "/kernel create X with content Y"
  // (natural-language creation is left to the model + write tool)
  const createData = userInput.match(/^\/kernel\s+create\s+(.+?)\s+with\s+content\s+([\s\S]+)$/i);
  if (createData) {
    const filePath = createData[1].trim().replace(/^\/+/, "");
    const content = createData[2].trim();
    const writeTool = cfg.tools.get("write");
    let created = false;
    if (writeTool) {
      const res = await writeTool.execute({ path: filePath, content });
      created = res.success;
    }
    return executeKernelAction(
      "create",
      `create ${filePath}`,
      `write ${filePath}`,
      () => created,
      `File created: ${filePath}`,
      `Failed to create: ${filePath}`,
    );
  }

  // /kernel read <filepath>
  const readMatch = userInput.match(/^\/kernel\s+read\s+(?:file\s+)?(.+)$/i);
  if (readMatch) {
    const filePath = readMatch[1].trim();
    const readTool = cfg.tools.get("read");
    if (readTool) {
      const res = await readTool.execute({ path: filePath });
      if (res.success) {
        const response = `\`${filePath}\`:\n\`\`\`\n${res.data}\n\`\`\``;
        callbacks.onToken(response);
        return response;
      }
      return `Error reading file: ${res.error}`;
    }
    return "Read tool not available.";
  }

  // /kernel run <command>
  const runMatch = userInput.match(/^\/kernel\s+run\s+(.+)$/i);
  if (runMatch) {
    const command = runMatch[1].trim();
    const shellTool = cfg.tools.get("shell");
    if (!shellTool) return "Shell tool not available.";
    const res = await shellTool.execute({ command });
    const result = new ActionResult("Execute", res.success, "", kernel.cycle, cfg.sessionId);
    const after = evolveState(k.state, result);
    kernel.identityLog.append(new StateTransition(k.state.clone(), after, result, "kernel:run", kernel.cycle));
    k.state = after;
    kernel.cycle++;
    if (res.success) {
      const output = String(res.data ?? "").slice(0, 2000);
      callbacks.onToken(output);
      return output;
    }
    return `Command failed: ${res.error}`;
  }

  // ─── Kernel status commands ──────────────────────────────────────

  if (/^\/kernel\s*tick$/i.test(userInput.trim())) {
    const action = k.tick();
    const actionType = action.constructor.name;
    const response = `Kernel tick #${kernel.cycle}: ${actionType}\nState: confidence=${k.state.confidence.toFixed(2)}, energy=${k.state.energy.toFixed(2)}`;
    callbacks.onToken(response);
    return response;
  }

  if (/^\/kernel\s*state$/i.test(userInput.trim())) {
    const s = k.state;
    const response = `State:\n  confidence: ${s.confidence.toFixed(2)}\n  energy: ${s.energy.toFixed(2)}\n  curiosity: ${s.curiosity.toFixed(2)}\n  analytical: ${s.analytical.toFixed(2)}\n  patience: ${s.patience.toFixed(2)}\n  cycle: ${kernel.cycle}\n  log entries: ${kernel.identityLog.length}`;
    callbacks.onToken(response);
    return response;
  }

  if (/^\/kernel\s*status$/i.test(userInput.trim())) {
    const response = kernelActive
      ? `Kernel: active (${kernel.cycle} cycles, confidence ${k.state.confidence.toFixed(2)})`
      : "Kernel: inactive";
    callbacks.onToken(response);
    return response;
  }

  if (/^\/kernel\s*dashboard$/i.test(userInput.trim())) {
    const s = k.state;
    const lines: string[] = [];
    lines.push("=== NTOX COGNITIVE KERNEL ===");
    lines.push("");
    lines.push("State:");
    lines.push(
      `  confidence: ${(s.confidence * 100).toFixed(0)}%  energy: ${(s.energy * 100).toFixed(0)}%  curiosity: ${(s.curiosity * 100).toFixed(0)}%`,
    );
    lines.push(
      `  analytical: ${(s.analytical * 100).toFixed(0)}%  patience: ${(s.patience * 100).toFixed(0)}%  cycles: ${kernel.cycle}`,
    );
    lines.push("");

    try {
      const { getTheoryStats } = await import("../../research/theory-store.js");
      const stats = getTheoryStats();
      lines.push("Knowledge Distilled:");
      lines.push(`  observations: ${stats.totalObservations}  patterns: ${stats.totalPatterns}`);
      lines.push(
        `  theories: ${stats.totalTheories} (${stats.confirmedTheories} confirmed)  meta-theories: ${stats.totalMetaTheories}`,
      );
      lines.push("");
    } catch {
      /* ignore */
    }

    try {
      const patterns = cfg.cognitiveKernel?.getPatterns?.();
      if (patterns) {
        const all = patterns.list();
        lines.push(`Cognitive Patterns: ${all.length} learned`);
        const top = all.slice(0, 5);
        for (const p of top) {
          lines.push(
            `  [${(p.strength * 100).toFixed(0)}%] ${p.name} — hits: ${p.hitCount} — domains: ${p.domains.join(", ")}`,
          );
        }
        lines.push("");
      }
    } catch {
      /* ignore */
    }

    lines.push(`Identity Log: ${kernel.identityLog.length} transitions`);
    const allTransitions = [...kernel.identityLog];
    const recent = allTransitions.slice(-5);
    for (const t of recent) {
      const ts = new Date(t.timestamp).toLocaleTimeString();
      lines.push(
        `  ${ts} — ${t.actionResult.actionType} — ${t.actionResult.success ? "success" : "fail"} — confidence: ${t.after.confidence.toFixed(2)}`,
      );
    }

    const response = lines.join("\n");
    callbacks.onToken(response);
    return response;
  }

  return null; // Not a kernel-handleable message
}
