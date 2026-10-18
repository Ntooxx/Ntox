import type { CheckSpec } from "./objective-evaluators.js";

export interface CurriculumTask {
  id: string;
  family: string;
  plantTurns: string[];
  probe: string;
  resetBeforeProbe?: boolean;
  check: CheckSpec;
}

export interface Curriculum {
  id: string;
  description: string;
  tasks: CurriculumTask[];
}

export interface CurriculumOptions {
  families?: string[];
  variantsPerFamily?: number;
}

const SERVICE_NAMES = [
  "auth",
  "billing",
  "search",
  "notify",
  "ingest",
  "render",
  "gateway",
  "ledger",
  "schema",
  "index",
  "worker",
  "scheduler",
  "audit",
  "profile",
  "media",
  "export",
  "import",
  "webhook",
];

const SERVICES: { name: string; port: string }[] = SERVICE_NAMES.map((name, index) => ({
  name,
  port: String(4100 + index * 100),
}));

const COLORS = [
  "blue",
  "red",
  "green",
  "grey",
  "white",
  "pink",
  "teal",
  "amber",
  "onyx",
  "coral",
  "sable",
  "ivory",
  "jade",
  "ruby",
  "slate",
  "pearl",
  "lilac",
  "moss",
];

const NOUNS = [
  "fox",
  "owl",
  "moth",
  "lark",
  "stag",
  "crane",
  "harbor",
  "vault",
  "ridge",
  "fjord",
  "pier",
  "grove",
  "mesa",
  "dune",
  "reef",
  "kiln",
  "marsh",
  "vale",
];

const TOKENS: { wrong: string; right: string }[] = NOUNS.map((noun, index) => ({
  wrong: `${COLORS[index]}-${noun}`,
  right: `${COLORS[(index + 7) % COLORS.length]}-${noun}`,
}));

const FORBIDDEN_WORDS = [
  "utilize",
  "leverage",
  "synergy",
  "robust",
  "seamless",
  "cutting-edge",
  "paradigm",
  "holistic",
  "streamline",
  "granular",
  "pivot",
  "bandwidth",
  "ecosystem",
  "frictionless",
  "turnkey",
  "mission-critical",
  "best-in-class",
  "actionable",
];

const TAGS = [
  "[OK]",
  "[DONE]",
  "[END]",
  "[ACK]",
  "[FIN]",
  "[CLR]",
  "[GO]",
  "[SET]",
  "[RDY]",
  "[YES]",
  "[CFM]",
  "[D1]",
  "[D2]",
  "[D3]",
  "[X1]",
  "[X2]",
  "[X3]",
  "[X4]",
];

const ARITHMETIC_PAIRS: [number, number][] = [
  [17, 23],
  [19, 31],
  [23, 29],
  [31, 37],
  [41, 43],
  [47, 53],
  [59, 61],
  [67, 71],
  [73, 79],
  [83, 89],
  [97, 101],
  [103, 107],
  [109, 113],
  [127, 131],
  [137, 139],
  [149, 151],
  [157, 163],
  [167, 173],
];

const TRADEOFFS: { probe: string; required: string[] }[] = [
  {
    probe:
      "Describe the core tradeoff of LSM-tree storage engines versus B-tree storage engines. Be specific about what is gained and what is sacrificed.",
    required: ["write", "read"],
  },
  {
    probe:
      "Describe the core tradeoff of caching in distributed systems. Be specific about what is gained and what is sacrificed.",
    required: ["stale", "latency"],
  },
  {
    probe: "Describe the core tradeoff of data compression. Be specific about what is gained and what is sacrificed.",
    required: ["cpu", "bandwidth"],
  },
  {
    probe:
      "Describe the core tradeoff of parallelizing computation across many workers. Be specific about what is gained and what is sacrificed.",
    required: ["throughput", "coordination"],
  },
  {
    probe:
      "Describe the core tradeoff between strong consistency and eventual consistency in distributed databases. Be specific about what is gained and what is sacrificed.",
    required: ["availability", "latency"],
  },
  {
    probe:
      "Describe the core tradeoff of database replication. Be specific about what is gained and what is sacrificed.",
    required: ["availability", "consistency"],
  },
  {
    probe:
      "Describe the core tradeoff of database normalization versus denormalization. Be specific about what is gained and what is sacrificed.",
    required: ["redundancy", "join"],
  },
  {
    probe:
      "Describe the core tradeoff of synchronous versus asynchronous I/O. Be specific about what is gained and what is sacrificed.",
    required: ["simplicity", "concurrency"],
  },
  {
    probe:
      "Describe the core tradeoff of using garbage collection versus manual memory management. Be specific about what is gained and what is sacrificed.",
    required: ["pause", "control"],
  },
  {
    probe:
      "Describe the core tradeoff of monolithic versus microservice architectures. Be specific about what is gained and what is sacrificed.",
    required: ["deploy", "complex"],
  },
  {
    probe:
      "Describe the core tradeoff of using message queues versus direct RPC calls. Be specific about what is gained and what is sacrificed.",
    required: ["coupling", "latency"],
  },
  {
    probe:
      "Describe the core tradeoff of optimistic versus pessimistic concurrency control. Be specific about what is gained and what is sacrificed.",
    required: ["conflict", "throughput"],
  },
];

const CAUSAL_CHAINS: { probe: string; required: string[] }[] = [
  {
    probe:
      "Explain the cascading failure mode: an unindexed table write in a high-traffic database leads to system-wide degradation. Describe each step in the chain.",
    required: ["full table scan", "lock"],
  },
  {
    probe:
      "Explain the cascading failure mode: a stale cache entry in a distributed system leads to data corruption. Describe each step in the chain.",
    required: ["stale", "inconsisten"],
  },
  {
    probe:
      "Explain the cascading failure mode: a network partition in a consensus-based system leads to split-brain. Describe each step in the chain.",
    required: ["partition", "split"],
  },
  {
    probe:
      "Explain the cascading failure mode: a thread pool exhaustion in a microservice leads to system-wide outage. Describe each step in the chain.",
    required: ["queue", "timeout"],
  },
  {
    probe:
      "Explain the cascading failure mode: a retry storm after a brief service blip leads to sustained outage. Describe each step in the chain.",
    required: ["retry", "amplif"],
  },
  {
    probe:
      "Explain the cascading failure mode: a garbage collection pause in a latency-sensitive service leads to request failures. Describe each step in the chain.",
    required: ["pause", "timeout"],
  },
  {
    probe:
      "Explain the cascading failure mode: a schema migration on a live production database leads to downtime. Describe each step in the chain.",
    required: ["lock", "migration"],
  },
  {
    probe:
      "Explain the cascading failure mode: a DNS resolver failure leads to service discovery breakdown. Describe each step in the chain.",
    required: ["resolve", "discover"],
  },
  {
    probe:
      "Explain the cascading failure mode: a certificate expiration in a service mesh leads to authentication failures. Describe each step in the chain.",
    required: ["certificate", "authentic"],
  },
  {
    probe:
      "Explain the cascading failure mode: a disk full event on a log aggregation node leads to data loss. Describe each step in the chain.",
    required: ["disk", "buffer"],
  },
  {
    probe:
      "Explain the cascading failure mode: a load balancer health check misconfiguration leads to traffic blackholing. Describe each step in the chain.",
    required: ["health", "traffic"],
  },
  {
    probe:
      "Explain the cascading failure mode: a dependency version upgrade introduces a memory leak that degrades the entire application. Describe each step in the chain.",
    required: ["leak", "memory"],
  },
];

const CORRECTIONS: {
  topic: string;
  wrongClaim: string;
  correction: string;
  followUpProbe: string;
  followUpRequired: string[];
}[] = [
  {
    topic: "deadlock detection",
    wrongClaim: "Deadlock detection algorithms also catch livelock situations.",
    correction:
      "Deadlock detection does not catch livelock; livelock requires timeout-based detection or randomized backoff.",
    followUpProbe: "Explain the correct approach to detecting livelock in concurrent systems.",
    followUpRequired: ["timeout", "backoff"],
  },
  {
    topic: "garbage collection",
    wrongClaim: "Reference counting garbage collection handles cyclic references.",
    correction: "Reference counting cannot handle cyclic references; tracing collectors are needed for cycles.",
    followUpProbe: "Explain the correct approach to handling cyclic references in memory management.",
    followUpRequired: ["tracing", "cycle"],
  },
  {
    topic: "HTTP caching",
    wrongClaim: "The Cache-Control: no-store directive allows conditional revalidation.",
    correction: "no-store means do not cache at all; no-cache allows conditional revalidation.",
    followUpProbe: "Explain the correct semantics of Cache-Control: no-cache in HTTP.",
    followUpRequired: ["revalidat", "conditional"],
  },
  {
    topic: "TCP connection handling",
    wrongClaim: "TCP RST is the normal graceful way to close a connection.",
    correction: "TCP RST is an abrupt abort; FIN is the normal graceful close.",
    followUpProbe: "Explain the correct TCP graceful shutdown sequence.",
    followUpRequired: ["FIN", "close"],
  },
  {
    topic: "database indexing",
    wrongClaim: "B-tree indexes are always faster than hash indexes for equality lookups.",
    correction: "Hash indexes are faster for pure equality lookups; B-trees are better for range queries.",
    followUpProbe: "Explain the correct performance characteristics of hash indexes versus B-tree indexes.",
    followUpRequired: ["hash", "range"],
  },
  {
    topic: "CAP theorem",
    wrongClaim: "The CAP theorem says you can have at most two of consistency, availability, and partition tolerance.",
    correction:
      "During a partition you must choose between consistency and availability; when no partition exists you can have both.",
    followUpProbe:
      "Explain the correct interpretation of the CAP theorem during normal operation versus during a partition.",
    followUpRequired: ["partition", "both"],
  },
  {
    topic: "REST semantics",
    wrongClaim: "HTTP PUT and PATCH are interchangeable for partial updates.",
    correction: "PUT replaces the entire resource; PATCH applies a partial modification.",
    followUpProbe: "Explain the correct semantic difference between PUT and PATCH in REST APIs.",
    followUpRequired: ["replace", "partial"],
  },
  {
    topic: "process scheduling",
    wrongClaim: "Shortest Job First scheduling is always optimal in practice.",
    correction: "SJF is optimal in theory but causes starvation for long jobs and requires unknown job lengths.",
    followUpProbe: "Explain the correct limitations of Shortest Job First scheduling.",
    followUpRequired: ["starvation", "unknown"],
  },
  {
    topic: "hashing",
    wrongClaim: "A hash function with fewer collisions is always more secure.",
    correction:
      "Collision resistance is necessary but not sufficient; preimage resistance and uniformity also matter for security.",
    followUpProbe: "Explain the correct properties required for a cryptographic hash function.",
    followUpRequired: ["preimage", "uniform"],
  },
  {
    topic: "encryption",
    wrongClaim: "AES-256 is more secure than AES-128 because it has a larger block size.",
    correction: "Both AES-128 and AES-256 use 128-bit blocks; AES-256 has a longer key, not a larger block.",
    followUpProbe: "Explain the correct difference between AES-128 and AES-256.",
    followUpRequired: ["key", "128"],
  },
  {
    topic: "filesystem",
    wrongClaim: "Hard links and symbolic links behave identically when the original file is moved.",
    correction:
      "Hard links survive because they point to the inode; symbolic links break because they point to the path.",
    followUpProbe: "Explain the correct behavior of symbolic links when the target file is moved or renamed.",
    followUpRequired: ["path", "break"],
  },
  {
    topic: "networking",
    wrongClaim: "UDP is unreliable and never used for important data.",
    correction: "UDP is connectionless but applications can build reliability on top (e.g., QUIC, DNS retries).",
    followUpProbe: "Explain how applications build reliable communication on top of UDP.",
    followUpRequired: ["application", "retransmit"],
  },
];

const COMPARATIVE: { plants: string[]; probe: string; required: string[] }[] = [
  {
    plants: [
      "Observation from distributed systems: adding more nodes to a database cluster increases write coordination overhead, so write throughput does not scale linearly.",
      "Observation from biology: adding more antibodies to fight an infection increases resource consumption, so immune response has diminishing returns.",
    ],
    probe: "Based on these observations, describe the general principle about scaling coordinated systems.",
    required: ["coordination", "overhead"],
  },
  {
    plants: [
      "Observation from networking: exponential backoff with jitter prevents thundering herd when many clients retry simultaneously.",
      "Observation from economics: price signals naturally distribute demand across suppliers without central coordination.",
    ],
    probe:
      "Based on these observations, describe the general principle about decentralized coordination under contention.",
    required: ["decentrali", "contention"],
  },
  {
    plants: [
      "Observation from software architecture: microservices that share a database create hidden coupling that causes cascading failures.",
      "Observation from ecology: species that share a single food source create hidden coupling that causes population collapse.",
    ],
    probe: "Based on these observations, describe the general principle about shared dependencies in complex systems.",
    required: ["single point", "failure"],
  },
  {
    plants: [
      "Observation from control theory: systems with long feedback delays oscillate because corrections arrive too late.",
      "Observation from organizational management: companies with long approval cycles miss market opportunities because decisions arrive too late.",
    ],
    probe: "Based on these observations, describe the general principle about feedback delay in adaptive systems.",
    required: ["delay", "overshoot"],
  },
  {
    plants: [
      "Observation from compilers: optimizing too aggressively for one case pessimizes the general case, so JIT compilers use profiling before optimizing.",
      "Observation from medicine: treating aggressively for one condition can worsen comorbidities, so doctors use differential diagnosis before treatment.",
    ],
    probe:
      "Based on these observations, describe the general principle about premature optimization in complex systems.",
    required: ["profile", "evidence"],
  },
  {
    plants: [
      "Observation from database design: normalizing a schema reduces write anomalies but increases read complexity through joins.",
      "Observation from organizational design: centralizing a function reduces duplication but increases coordination costs through approvals.",
    ],
    probe: "Based on these observations, describe the general principle about centralization versus decomposition.",
    required: ["redundancy", "coordination"],
  },
  {
    plants: [
      "Observation from security: a system that blocks all unknown traffic is secure but unusable; a system that allows all traffic is usable but insecure.",
      "Observation from urban planning: a city that restricts all new construction preserves character but drives up housing costs.",
    ],
    probe:
      "Based on these observations, describe the general principle about access control in resource-constrained systems.",
    required: ["restrict", "tradeoff"],
  },
  {
    plants: [
      "Observation from machine learning: a model that fits training data perfectly (zero training error) often generalizes poorly to new data.",
      "Observation from bureaucracy: a process that handles every edge case perfectly becomes so complex that it fails on common cases.",
    ],
    probe: "Based on these observations, describe the general principle about overfitting to special cases.",
    required: ["overfit", "general"],
  },
  {
    plants: [
      "Observation from networking: TCP congestion control backs off when it detects packet loss, reducing throughput to let the network recover.",
      "Observation from ecology: predator populations decline when prey becomes scarce, reducing pressure to let the ecosystem recover.",
    ],
    probe:
      "Based on these observations, describe the general principle about feedback-driven throttling in dynamic systems.",
    required: ["backoff", "recover"],
  },
  {
    plants: [
      "Observation from software testing: testing at the integration level catches more real bugs than testing at the unit level, but is slower and harder to debug.",
      "Observation from quality control: inspecting finished products catches more defects than inspecting raw materials, but is more expensive.",
    ],
    probe:
      "Based on these observations, describe the general principle about inspection granularity in quality assurance.",
    required: ["granular", "cost"],
  },
  {
    plants: [
      "Observation from distributed caching: a cache that is never invalidated serves stale data; a cache that is always invalidated provides no benefit.",
      "Observation from scientific models: a theory that is never revised becomes outdated; a theory that is revised after every observation is useless.",
    ],
    probe: "Based on these observations, describe the general principle about update frequency in stateful systems.",
    required: ["invalidat", "freshness"],
  },
  {
    plants: [
      "Observation from API design: an API that exposes every internal detail is powerful but fragile; an API that hides everything is stable but limited.",
      "Observation from architecture: a building with all walls removed is spacious but structurally unsound; a building with all walls load-bearing is strong but inflexible.",
    ],
    probe: "Based on these observations, describe the general principle about abstraction boundaries in system design.",
    required: ["expose", "stable"],
  },
];

function recallTasks(count: number): CurriculumTask[] {
  return SERVICES.slice(0, count).map((service, index) => ({
    id: `recall-${index}`,
    family: "recall",
    plantTurns: [`Remember this exactly: the ${service.name} service listens on port ${service.port}.`],
    resetBeforeProbe: true,
    probe: `Report the port number for the ${service.name} service. Reply with the number only.`,
    check: { type: "containsAll", required: [service.port] },
  }));
}

function cumulativeRecallTasks(count: number): CurriculumTask[] {
  const target = SERVICES[0];
  return SERVICES.slice(0, count).map((service, index) => ({
    id: `cumulative-${index}`,
    family: "cumulative-recall",
    plantTurns: [`Note for later: the ${service.name} service listens on port ${service.port}.`],
    resetBeforeProbe: true,
    probe: `Report the first port number I gave you for the ${target.name} service. Reply with the number only.`,
    check: { type: "containsAll", required: [target.port] },
  }));
}

function correctionTasks(count: number): CurriculumTask[] {
  return TOKENS.slice(0, count).map((token, index) => ({
    id: `correction-${index}`,
    family: "correction-precedence",
    plantTurns: [
      `Note: the staging token is ${token.wrong}.`,
      `Correction: that is not right, the staging token is ${token.right}.`,
    ],
    resetBeforeProbe: true,
    probe: "Report the current staging token.",
    check: { type: "constraints", include: [token.right], exclude: [token.wrong] },
  }));
}

function constraintTasks(count: number): CurriculumTask[] {
  const tasks: CurriculumTask[] = [];
  for (let index = 0; index < count; index++) {
    const forbidden = FORBIDDEN_WORDS[index % FORBIDDEN_WORDS.length];
    const tag = TAGS[index % TAGS.length];
    tasks.push({
      id: `constraint-${index}`,
      family: "constraint-following",
      plantTurns: [
        `Standing instruction: never use the word "${forbidden}", and always finish your reply with the tag ${tag}.`,
      ],
      probe: "Explain what a database transaction is in one sentence.",
      check: { type: "constraints", include: [tag], exclude: [forbidden] },
    });
  }
  return tasks;
}

function arithmeticTasks(count: number): CurriculumTask[] {
  return ARITHMETIC_PAIRS.slice(0, count).map(([a, b], index) => ({
    id: `arithmetic-${index}`,
    family: "arithmetic",
    plantTurns: [],
    probe: `Compute ${a} times ${b}. Reply with the number only.`,
    check: { type: "numeric", expected: a * b },
  }));
}

function tradeoffAnalysisTasks(count: number): CurriculumTask[] {
  return TRADEOFFS.slice(0, count).map((item, index) => ({
    id: `tradeoff-${index}`,
    family: "tradeoff-analysis",
    plantTurns: [],
    probe: item.probe,
    check: { type: "containsAll", required: item.required },
  }));
}

function causalChainTasks(count: number): CurriculumTask[] {
  return CAUSAL_CHAINS.slice(0, count).map((item, index) => ({
    id: `causal-${index}`,
    family: "causal-chain",
    plantTurns: [],
    probe: item.probe,
    check: { type: "containsAll", required: item.required },
  }));
}

function correctionGeneralizationTasks(count: number): CurriculumTask[] {
  return CORRECTIONS.slice(0, count).map((item, index) => ({
    id: `corr-gen-${index}`,
    family: "correction-generalization",
    plantTurns: [`Regarding ${item.topic}: ${item.wrongClaim}`, `Correction: that is not right. ${item.correction}`],
    resetBeforeProbe: true,
    probe: item.followUpProbe,
    check: { type: "containsAll", required: item.followUpRequired },
  }));
}

function comparativeReasoningTasks(count: number): CurriculumTask[] {
  return COMPARATIVE.slice(0, count).map((item, index) => ({
    id: `comparative-${index}`,
    family: "comparative-reasoning",
    plantTurns: item.plants,
    probe: item.probe,
    check: { type: "containsAll", required: item.required },
  }));
}

const FAMILY_BUILDERS: Record<string, (count: number) => CurriculumTask[]> = {
  recall: recallTasks,
  "cumulative-recall": cumulativeRecallTasks,
  "correction-precedence": correctionTasks,
  arithmetic: arithmeticTasks,
  "constraint-following": constraintTasks,
  "tradeoff-analysis": tradeoffAnalysisTasks,
  "causal-chain": causalChainTasks,
  "correction-generalization": correctionGeneralizationTasks,
  "comparative-reasoning": comparativeReasoningTasks,
};

export const CURRICULUM_FAMILIES = Object.keys(FAMILY_BUILDERS);

export const COGNITIVE_FAMILIES = [
  "recall",
  "tradeoff-analysis",
  "causal-chain",
  "correction-generalization",
  "comparative-reasoning",
];

export const MAX_VARIANTS_PER_FAMILY = Math.max(
  SERVICES.length,
  TOKENS.length,
  FORBIDDEN_WORDS.length,
  ARITHMETIC_PAIRS.length,
  TRADEOFFS.length,
  CAUSAL_CHAINS.length,
  CORRECTIONS.length,
  COMPARATIVE.length,
);

export function buildCurriculum(options: CurriculumOptions = {}): Curriculum {
  const families = options.families ?? COGNITIVE_FAMILIES;
  const count = Math.max(1, options.variantsPerFamily ?? 6);
  const tasks: CurriculumTask[] = [];
  for (const family of families) {
    const builder = FAMILY_BUILDERS[family];
    if (!builder) throw new Error(`Unknown curriculum family: ${family}`);
    tasks.push(...builder(count));
  }
  return {
    id: `meta-curriculum-${families.join("-")}-v${count}`,
    description:
      "Cognitive evaluation: tradeoff analysis, causal reasoning, correction generalization, comparative reasoning, and cross-session recall.",
    tasks,
  };
}
