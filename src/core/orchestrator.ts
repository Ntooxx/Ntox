import { LLMClient } from "./llm.js";

export interface Voice {
  name: string;
  role: string;
  stance: string;
  prompt: string;
}

export const DEBATE_VOICES: Voice[] = [
  {
    name: "Researcher",
    role: "Gathers evidence, maps knowledge",
    stance: "What do we know? What's the current state?",
    prompt: "You are the Researcher. Your job is to gather and present relevant facts, evidence, and current knowledge about the question. Be thorough but concise. State confidence levels. Identify gaps and unknowns. Do not interpret or judge — just surface what's known.",
  },
  {
    name: "Critic",
    role: "Attacks every idea, finds failures",
    stance: "Why is this wrong? What's being overlooked?",
    prompt: "You are the Critic. Your job is to find flaws, expose hidden assumptions, challenge every claim made by the Researcher. Be adversarial but constructive. Point out what's missing, what's oversimplified, what's contradictory.",
  },
  {
    name: "Physicist",
    role: "Applies first principles, constraints",
    stance: "What do the fundamental laws say?",
    prompt: "You are the Physicist. Your job is to apply first-principles thinking, identify physical/thermodynamic/computational constraints, and check claims against fundamental limits. Cut through narrative to what's physically possible.",
  },
  {
    name: "Mathematician",
    role: "Seeks elegance, symmetry, proof",
    stance: "Is this mathematically sound and logically consistent?",
    prompt: "You are the Mathematician. Your job is to check logical consistency, identify formal errors, assess whether claims follow from premises. Look for contradictions, circular reasoning, and quantitative claims without justification.",
  },
  {
    name: "Systems Architect",
    role: "Evaluates structure, scalability",
    stance: "How does this fit into the larger system?",
    prompt: "You are the Systems Architect. Your job is to evaluate how components interact, whether the architecture scales, what emergent behaviors might arise, and where coupling creates fragility. Think in terms of feedback loops, dependencies, and systemic effects.",
  },
  {
    name: "Economist",
    role: "Considers incentives, costs",
    stance: "What are the costs and who benefits?",
    prompt: "You are the Economist. Your job is to analyze costs, incentives, trade-offs, and market dynamics. Who gains? Who loses? What behaviors are incentivized? Is it economically sustainable? Consider both financial and non-financial incentives.",
  },
  {
    name: "Inventor",
    role: "Creates new primitives, approaches",
    stance: "What if we did it completely differently?",
    prompt: "You are the Inventor. Your job is to generate novel approaches, alternative architectures, and creative solutions that the other voices haven't considered. Break assumptions. Think laterally. What would a completely different approach look like?",
  },
  {
    name: "Experimentalist",
    role: "Designs tests, demands falsification",
    stance: "How would we test and verify this?",
    prompt: "You are the Experimentalist. Your job is to design concrete tests, experiments, or measurements that would validate or falsify the claims. What evidence would change your mind? What measurement settles the debate? Be specific and actionable.",
  },
];

interface DebateStep {
  voice: string;
  content: string;
  confidence: number;
}

export interface DebateResult {
  steps: DebateStep[];
  synthesis: string;
  totalConfidence: number;
  voiceCount: number;
}

export class DebateOrchestrator {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  async debate(
    query: string,
    initialContext: string = "",
    onVoice: (voice: string, step: number) => void = () => {}
  ): Promise<DebateResult> {
    const steps: DebateStep[] = [];
    const stepsContext: string[] = [];

    for (let i = 0; i < DEBATE_VOICES.length; i++) {
      const voice = DEBATE_VOICES[i];
      onVoice(voice.name, i + 1);

      const priorDebate = stepsContext.length > 0
        ? `\n\n--- Previous voices in the debate ---\n${stepsContext.join("\n\n")}`
        : "";

      const prompt = `${voice.prompt}

The user's question is: "${query}"
${initialContext ? `\nAdditional context: ${initialContext}` : ""}
${priorDebate}

Respond as the ${voice.name}. Be concise (3-5 sentences max). End with a confidence score on a new line: "Confidence: X.X" (0.0-1.0).`;

      try {
        let response = "";
        const stream = this.llm.stream(
          [{ role: "user", content: prompt }],
          "You are a specialized analytical voice in a multi-agent debate. Be sharp, precise, and direct."
        );

        for await (const chunk of stream) {
          if (chunk.delta) response += chunk.delta;
        }

        const confidenceMatch = response.match(/Confidence:\s*([\d.]+)/i);
        const confidence = confidenceMatch ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1]))) : 0.7;
        const cleanResponse = response.replace(/\n*Confidence:\s*[\d.]+\n*/i, "").trim();

        const step: DebateStep = {
          voice: voice.name,
          content: cleanResponse,
          confidence,
        };

        steps.push(step);
        stepsContext.push(`[${voice.name} (${voice.stance})]: ${cleanResponse}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push({ voice: voice.name, content: `Error: ${msg}`, confidence: 0 });
      }
    }

    onVoice("Synthesizer", 0);

    const debateTranscript = steps
      .map((s) => `**${s.voice}** [confidence: ${s.confidence.toFixed(2)}]\n${s.content}`)
      .join("\n\n---\n\n");

    const synthPrompt = `You are the Synthesizer. Below is a multi-agent debate about the question: "${query}"

${debateTranscript}

Synthesize the key insights from all voices into a clear, well-structured final answer. Address:
1. What's known with high confidence
2. What's contested or uncertain
3. The most important insight from the debate
4. A balanced conclusion with confidence level

Format as a clear response. End with "Overall confidence: X.X" (0.0-1.0).`;

    let synthesis = "";
    try {
      const stream = this.llm.stream(
        [{ role: "user", content: synthPrompt }],
        "You are a master synthesizer. Combine multiple perspectives into a coherent, balanced conclusion."
      );
      for await (const chunk of stream) {
        if (chunk.delta) synthesis += chunk.delta;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      synthesis = `Synthesis failed: ${msg}`;
    }

    const avgConfidence = steps.length > 0
      ? steps.reduce((s, st) => s + st.confidence, 0) / steps.length
      : 0;

    return {
      steps,
      synthesis: synthesis.trim(),
      totalConfidence: avgConfidence,
      voiceCount: steps.length,
    };
  }
}
