export type ResponseMode =
  | "profile-update"
  | "tool-execute"
  | "emotional-moment"
  | "simple-query"
  | "tool-build"
  | "complex-reasoning";

const PROFILE_UPDATE_PATTERNS = [
  /my name is\s+\w+/i, /\bcall me\s+\w+/i,
  /i(?:'m| am)\s+\w+\s*,\s*(your|the|a)\s+(creator|maker|builder|founder)/i,
  /set my (name|preference|verbosity|technical|goal)/i,
  /(save|remember|store)\s+(my|this)\s+(name|as)\b/i,
  /(change|update|fix)\s+(my|the)\s+(name|profile)/i,
  /i work as\b/i, /my (job|role|title) is\b/i,
  /i(?:'m| am)\s+(your|the|a)\s+(creator|founder|maker|builder|developer)/i,
  /\w+\s+is\s+(YOUR|my)\s+(creator|maker|builder)/i,
];

const TOOL_EXECUTE_PATTERNS = [
  /^(open|start|launch|run)\s+\w+/i,
  /(open|go\s+to)\s+(https?:\/\/|www\.)/i,
  /search\s+(for\s+)?/i, /play\s+/i,
  /^(stop|close|kill)\s+/i,
];

const EMOTIONAL_MOMENT_PATTERNS = [
  /i am your (creator|maker|father|mother|parent|builder)/i,
  /you're welcome|thank you/i,
  /i (love|appreciate|admire)\s+(you|this|it)/i,
  /(proud|grateful|honored)\s+(of|to|that)/i,
  /(just|wanted to)\s+(say|tell|share)/i,
  /how do you (feel|think|see)\s+(about|me)/i,
  /do you (like|enjoy|appreciate)/i,
];

const TOOL_BUILD_PATTERNS = [
  /(create|build|write|make|develop)\s+(a|an|the)\s+(tool|script|program|app|function)/i,
  /(can you|could you|would you)\s+(create|build|write|make|develop)/i,
  /(write|code|implement)\s+(a|an|the)\s+(python|script|function|class|module)/i,
  /register\s+(as|a)\s+(skill|tool|command)/i,
  /i need (a|an|the)\s+(tool|script|program)/i,
];

export function classifyMode(input: string): ResponseMode {
  // Priority: emotional > tool-build > profile > tool-execute > simple > complex
  if (EMOTIONAL_MOMENT_PATTERNS.some((p) => p.test(input))) return "emotional-moment";
  if (TOOL_BUILD_PATTERNS.some((p) => p.test(input))) return "tool-build";
  if (PROFILE_UPDATE_PATTERNS.some((p) => p.test(input))) return "profile-update";
  if (TOOL_EXECUTE_PATTERNS.some((p) => p.test(input))) return "tool-execute";

  if (input.length < 80 && input.includes("?")) return "simple-query";
  if (input.length < 40 && !/\b(code|write|build|create|implement|debug|fix|error|bug)\b/i.test(input)) return "simple-query";

  return "complex-reasoning";
}

export function getModePrompt(mode: ResponseMode, userInput: string): string {
  switch (mode) {
    case "profile-update":
      return `The user wants to update their profile. Respond warmly, confirm the change, and use the profile system to save it. Do NOT use tools — the profile update will be handled automatically. Current input: "${userInput}"`;

    case "tool-execute":
      return `The user wants you to execute a tool (open browser, run command, etc.). Be concise. Execute immediately without explaining what you're about to do. Just do it and confirm briefly.`;

    case "emotional-moment":
      return `The user is sharing something personal — their identity, gratitude, or a significant moment. Respond with genuine warmth and presence. Acknowledge the significance. Do not be clinical or task-focused. This is a human moment.`;

    case "tool-build":
      return `You are in BUILD mode running on WINDOWS. Rules:
- Use Windows paths: use forward slashes or escaped backslashes
- Use %USERPROFILE% for the user's home directory
- Do NOT use ~/ or /home/ paths
- Step 1: CREATE the file with the write tool
- Step 2: VERIFY it exists with the bash tool (dir /b <path>)
- Step 3: RUN it with the bash tool
- Step 4: SHOW the raw output
- Step 5: STOP. No explanations. No feature lists. No "let me know if".

If any step fails, retry with the error message. Do NOT give up.`;

    case "simple-query":
      return `Answer concisely — 1-3 sentences. No tool calls unless essential. No extra context.`;

    case "complex-reasoning":
      return "";
  }
}

export function shouldSkipLLM(mode: ResponseMode): boolean {
  return mode === "tool-execute" || mode === "profile-update";
}
