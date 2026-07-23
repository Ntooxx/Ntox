import type { QueryType } from "../types/index.js";

const CODING_KEYWORDS = [
  "code", "function", "class", "bug", "error", "syntax", "compile", "debug",
  "api", "npm", "python", "javascript", "typescript", "rust", "go", "java",
  "c++", "ruby", "php", "swift", "kotlin", "sql", "query", "database",
  "algorithm", "data structure", "array", "string", "object", "variable",
  "async", "promise", "callback", "loop", "conditional", "import", "export",
  "test", "unit test", "refactor", "optimize", "performance",
];

const FACTUAL_KEYWORDS = [
  "what", "who", "when", "where", "why", "how many", "how much",
  "definition", "define", "explain", "meaning", "history", "origin",
  "fact", "statistics", "population", "capital", "date", "year",
  "scientific", "theory", "law", "principle",
];

const CREATIVE_KEYWORDS = [
  "create", "design", "write", "make", "build", "imagine", "suggest",
  "idea", "brainstorm", "creative", "invent", "compose", "draft",
  "story", "poem", "name", "title", "concept", "theme",
];

const ANALYSIS_KEYWORDS = [
  "compare", "contrast", "analyze", "evaluate", "pros", "cons",
  "difference", "vs", "versus", "similarities", "relationship",
  "impact", "effect", "correlation", "trend", "pattern",
  "strength", "weakness", "advantage", "disadvantage", "trade-off",
];

const PLANNING_KEYWORDS = [
  "plan", "roadmap", "steps", "how to", "strategy", "timeline",
  "goal", "milestone", "phase", "schedule", "organize", "prepare",
  "approach", "method", "workflow", "process", "guide", "tutorial",
];

function countMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

export function classifyQuery(query: string): QueryType {
  const coding = countMatches(query, CODING_KEYWORDS);
  const factual = countMatches(query, FACTUAL_KEYWORDS);
  const creative = countMatches(query, CREATIVE_KEYWORDS);
  const analysis = countMatches(query, ANALYSIS_KEYWORDS);
  const planning = countMatches(query, PLANNING_KEYWORDS);

  const scores: [QueryType, number][] = [
    ["coding", coding],
    ["factual", factual],
    ["creative", creative],
    ["analysis", analysis],
    ["planning", planning],
  ];

  scores.sort((a, b) => b[1] - a[1]);

  if (scores[0][1] > 0) return scores[0][0];
  return "general";
}

export function getStrategyPrompt(type: QueryType): string {
  switch (type) {
    case "coding":
      return (
        "## Strategy: Coding & Technical\n" +
        "- Think step-by-step before writing code\n" +
        "- Consider edge cases and error handling\n" +
        "- Explain the reasoning, not just the code\n" +
        "- If debugging, analyze the error systematically\n" +
        "- Suggest tests where appropriate\n" +
        "- If you need to see files, use the available tools"
      );

    case "factual":
      return (
        "## Strategy: Factual & Explanatory\n" +
        "- Prioritize accuracy over completeness\n" +
        "- If uncertain, explicitly state your confidence level\n" +
        "- Distinguish between established fact and interpretation\n" +
        "- Keep it concise unless detail is requested"
      );

    case "creative":
      return (
        "## Strategy: Creative & Generative\n" +
        "- Explore multiple options or approaches\n" +
        "- Explain the thinking behind suggestions\n" +
        "- Ask clarifying questions if the brief is vague\n" +
        "- Be willing to iterate based on feedback"
      );

    case "analysis":
      return (
        "## Strategy: Analysis & Comparison\n" +
        "- Structure the analysis clearly (pros/cons, table, etc.)\n" +
        "- Consider multiple perspectives\n" +
        "- Support claims with reasoning\n" +
        "- Conclude with a balanced summary"
      );

    case "planning":
      return (
        "## Strategy: Planning & Roadmap\n" +
        "- Break down into concrete, actionable steps\n" +
        "- Estimate complexity or time for each step\n" +
        "- Identify dependencies between steps\n" +
        "- Suggest a logical order of execution"
      );

    default:
      return (
        "## Strategy: General\n" +
        "- Understand the request fully before responding\n" +
        "- Be concise and direct\n" +
        "- Ask clarifying questions if needed\n" +
        "- Use tools when they would help"
      );
  }
}

export function getStrategyLabel(type: QueryType): string {
  const labels: Record<QueryType, string> = {
    coding: "coding",
    factual: "factual",
    creative: "creative",
    analysis: "analysis",
    planning: "planning",
    general: "general",
  };
  return labels[type];
}
