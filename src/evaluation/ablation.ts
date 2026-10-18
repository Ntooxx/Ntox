import type { AgentConfig } from "../core/agent.js";

export type MetaArmId =
  "off" | "kernel" | "memory" | "theory" | "strategy" | "mistakes" | "raw-context" | "all" | "full";

export interface MetaArm {
  id: MetaArmId;
  label: string;
  description: string;
  overrides: Partial<AgentConfig>;
}

const OFF: Partial<AgentConfig> = {
  kernelEnabled: false,
  memoryEnabled: false,
  theoryEnabled: false,
  strategyEnabled: false,
  mistakesEnabled: false,
  skipReflection: true,
};

function isolate(extra: Partial<AgentConfig>): Partial<AgentConfig> {
  return { ...OFF, ...extra };
}

export const ABLATION_ARMS: MetaArm[] = [
  {
    id: "off",
    label: "Meta off",
    description: "All meta-cognitive subsystems disabled; plain LLM loop.",
    overrides: { ...OFF },
  },
  {
    id: "kernel",
    label: "Kernel only",
    description: "Only the cognitive kernel (pattern retrieval and compilation) is enabled.",
    overrides: isolate({ kernelEnabled: true }),
  },
  {
    id: "memory",
    label: "Memory only",
    description: "Only episodic memory retrieval is enabled.",
    overrides: isolate({ memoryEnabled: true }),
  },
  {
    id: "theory",
    label: "Theory only",
    description: "Only theory memory (distilled patterns and theories) is enabled.",
    overrides: isolate({ theoryEnabled: true }),
  },
  {
    id: "strategy",
    label: "Strategy only",
    description: "Only strategy classification is enabled.",
    overrides: isolate({ strategyEnabled: true }),
  },
  {
    id: "mistakes",
    label: "Mistakes only",
    description: "Only the mistake journal and correction recall are enabled.",
    overrides: isolate({ mistakesEnabled: true }),
  },
  {
    id: "raw-context",
    label: "Raw context",
    description:
      "Memory and theory are dumped into the prompt without cognitive selection; isolates context quantity from cognitive selection.",
    overrides: {
      kernelEnabled: false,
      memoryEnabled: true,
      theoryEnabled: true,
      strategyEnabled: false,
      mistakesEnabled: false,
      skipReflection: true,
      memoryRetrievalCount: 20,
    },
  },
  {
    id: "all",
    label: "All subsystems",
    description: "Every meta-cognitive subsystem enabled; reflection off for a practical runtime.",
    overrides: {
      kernelEnabled: true,
      memoryEnabled: true,
      theoryEnabled: true,
      strategyEnabled: true,
      mistakesEnabled: true,
      skipReflection: true,
    },
  },
  {
    id: "full",
    label: "Full meta",
    description: "Every meta-cognitive subsystem enabled with reflection.",
    overrides: {
      kernelEnabled: true,
      memoryEnabled: true,
      theoryEnabled: true,
      strategyEnabled: true,
      mistakesEnabled: true,
      skipReflection: false,
    },
  },
];

const ARM_INDEX = new Map<MetaArmId, MetaArm>(ABLATION_ARMS.map((arm) => [arm.id, arm]));

export function getArm(id: MetaArmId): MetaArm {
  const arm = ARM_INDEX.get(id);
  if (!arm) throw new Error(`Unknown meta arm: ${id}`);
  return arm;
}

export function armOverrides(id: MetaArmId): Partial<AgentConfig> {
  return { ...getArm(id).overrides };
}

export function armEnablesCognition(id: MetaArmId): boolean {
  return id === "kernel" || id === "all" || id === "full";
}

export function isMetaArmId(value: string): value is MetaArmId {
  return ARM_INDEX.has(value as MetaArmId);
}
