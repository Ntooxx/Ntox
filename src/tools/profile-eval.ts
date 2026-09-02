import type { LLMClient } from "../core/llm.js";
import type { Tool, ProfileEvaluation } from "../types/index.js";

function parseEvaluation(text: string, url: string): ProfileEvaluation {
  const scoreMatch = text.match(/OVERALL SCORE:\s*(\d+)/i);
  const overallScore = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1]))) : 50;

  const sectionScore = (name: string): { score: number; feedback: string } => {
    const sectionRegex = new RegExp(`${name}:\\s*(\\d+)/10\\s*[-–]\\s*([^\\n]+)`, "i");
    const match = text.match(sectionRegex);
    return {
      score: match ? Math.min(10, Math.max(0, parseInt(match[1]))) : 5,
      feedback: match ? match[2].trim() : "Not evaluated",
    };
  };

  const topIssues: string[] = [];
  const issuesSection = text.match(/TOP ISSUES:?\s*\n?([\s\S]*?)(?:\n\n|$)/i);
  if (issuesSection) {
    const lines = issuesSection[1].split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"));
    for (const line of lines.slice(0, 5)) {
      topIssues.push(line.replace(/^[-*]\s*/, "").trim());
    }
  }

  const quickWins: string[] = [];
  const winsSection = text.match(/QUICK WINS:?\s*\n?([\s\S]*?)(?:\n\n|$)/i);
  if (winsSection) {
    const lines = winsSection[1].split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"));
    for (const line of lines.slice(0, 5)) {
      quickWins.push(line.replace(/^[-*]\s*/, "").trim());
    }
  }

  return {
    url,
    overallScore,
    sections: {
      headline: sectionScore("Headline"),
      summary: sectionScore("Summary"),
      experience: sectionScore("Experience"),
      skills: sectionScore("Skills"),
      recommendations: sectionScore("Recommendations"),
      activity: sectionScore("Activity"),
    },
    topIssues,
    quickWins,
    evaluatedAt: Date.now(),
  };
}

export function createProfileEvalTool(llm: LLMClient): Tool {
  return {
    name: "profile_eval",
    description:
      "Evaluate a LinkedIn or professional profile. Provide either a URL (browse first) or profile text content. Returns a structured scorecard with section scores, top issues, and quick wins.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Profile URL to evaluate" },
        content: { type: "string", description: "Profile page text (if already browsed). Use instead of URL." },
        focus: {
          type: "string",
          enum: ["full", "headline", "summary", "experience", "skills"],
          description: "Which sections to focus on (default: full)",
        },
        roleContext: { type: "string", description: "Target role for context (e.g. 'Senior TypeScript Developer')" },
      },
      required: [],
    },
    async execute(args) {
      const url = args.url ? String(args.url) : "";
      const content = args.content ? String(args.content) : "";
      const focus = args.focus ? String(args.focus) : "full";
      const roleContext = args.roleContext ? String(args.roleContext) : "";

      if (!url && !content) {
        return { success: false, error: "Either url or content is required" };
      }

      const profileText = content || `Profile URL: ${url}`;
      if (profileText.length < 50) {
        return { success: false, error: "Profile content too short. Browse the page first or provide more text." };
      }

      const evalPrompt = [
        `Evaluate this professional profile. Score each section 1-10 and provide specific, actionable feedback.`,
        ``,
        `## Profile Content`,
        profileText.slice(0, 8000),
        ``,
        `## Instructions`,
        focus !== "full" ? `Focus especially on: ${focus}. Still return all section scores.` : "",
        `Evaluate the following sections:`,
        `1. Headline — Does it clearly state role, value proposition, and keywords? Score 1-10.`,
        `2. Summary — Is it compelling? Does it tell a story? Does it include achievements? Score 1-10.`,
        `3. Experience — Are accomplishments quantified? Is there progression? Are keywords used? Score 1-10.`,
        `4. Skills — Are relevant skills listed? Are endorsements visible? Is the list prioritized? Score 1-10.`,
        `5. Recommendations — Any visible? Are they specific and from relevant people? Score 1-10.`,
        `6. Activity — Is there recent activity? Posts, articles, comments? Score 1-10.`,
        ``,
        roleContext ? `The person is targeting this role: ${roleContext}. Factor this into the evaluation.` : "",
        ``,
        `## Output Format`,
        `OVERALL SCORE: [0-100]`,
        ``,
        `Headline: [X]/10 — [1-2 sentences of specific feedback]`,
        `Summary: [X]/10 — [1-2 sentences of specific feedback]`,
        `Experience: [X]/10 — [1-2 sentences of specific feedback]`,
        `Skills: [X]/10 — [1-2 sentences of specific feedback]`,
        `Recommendations: [X]/10 — [1-2 sentences of specific feedback]`,
        `Activity: [X]/10 — [1-2 sentences of specific feedback]`,
        ``,
        `TOP ISSUES:`,
        `- [most impactful issue to fix]`,
        `- [second most impactful]`,
        `- [third]`,
        ``,
        `QUICK WINS:`,
        `- [specific change that takes < 10 minutes]`,
        `- [another quick change]`,
        `- [another quick change]`,
        ``,
        `Be direct and specific. No flattery. No hedging. Score honestly — most profiles are 40-60/100.`,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        let response = "";
        const stream = llm.stream(
          [{ role: "user", content: evalPrompt }],
          "You are a professional LinkedIn profile evaluator. Be direct, specific, and honest. Score rigorously.",
        );
        for await (const chunk of stream) {
          if (chunk.delta) response += chunk.delta;
        }

        if (response.length < 50) {
          return { success: false, error: "LLM returned empty or too-short evaluation" };
        }

        const evaluation = parseEvaluation(response, url);
        return { success: true, data: evaluation };
      } catch (e) {
        return {
          success: false,
          error: `Evaluation failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  };
}
