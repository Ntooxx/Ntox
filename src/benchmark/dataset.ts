export interface BenchmarkQuery {
  id: string;
  domain: string;
  query: string;
  expectedTopics: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface BenchmarkRound {
  name: string;
  description: string;
  queries: BenchmarkQuery[];
}

const programming: BenchmarkQuery[] = [
  {
    id: "prog-1",
    domain: "programming",
    query: "Write a TypeScript function that implements a Least Recently Used (LRU) cache with O(1) get and put operations. Explain your design choices.",
    expectedTopics: ["Map", "doubly-linked list", "O(1)", "eviction"],
    difficulty: 3,
  },
  {
    id: "prog-2",
    domain: "programming",
    query: "Explain the difference between concurrency and parallelism. Give real-world examples of each in the context of a web server.",
    expectedTopics: ["threading", "async", "I/O bound", "CPU bound", "event loop"],
    difficulty: 2,
  },
  {
    id: "prog-3",
    domain: "programming",
    query: "Design a rate limiter using the token bucket algorithm. What are the tradeoffs vs sliding window?",
    expectedTopics: ["token bucket", "refill rate", "burst", "sliding window", "tradeoffs"],
    difficulty: 3,
  },
  {
    id: "prog-4",
    domain: "programming",
    query: "What is a memory leak in Node.js? How do you detect and fix one? Show a concrete example.",
    expectedTopics: ["heap", "GC", "closures", "event listeners", "profiler"],
    difficulty: 3,
  },
];

const mathematics: BenchmarkQuery[] = [
  {
    id: "math-1",
    domain: "mathematics",
    query: "Explain why the Riemann Hypothesis matters for prime number distribution. What would change if it were proven false?",
    expectedTopics: ["prime counting", "zeta function", "error term", "complex zeros"],
    difficulty: 4,
  },
  {
    id: "math-2",
    domain: "mathematics",
    query: "What is the Central Limit Theorem and why does it matter for practical statistics? Give an intuitive explanation, not just the formal statement.",
    expectedTopics: ["normal distribution", "sample mean", "convergence", "independence"],
    difficulty: 2,
  },
  {
    id: "math-3",
    domain: "mathematics",
    query: "Explain the concept of eigenvalues and eigenvectors geometrically. What do they represent visually?",
    expectedTopics: ["transformation", "scaling", "direction", "matrix"],
    difficulty: 3,
  },
  {
    id: "math-4",
    domain: "mathematics",
    query: "Why is P vs NP important? What would change in practice if P = NP were proven?",
    expectedTopics: ["complexity classes", "cryptography", "optimization", "verification"],
    difficulty: 4,
  },
];

const physics: BenchmarkQuery[] = [
  {
    id: "phys-1",
    domain: "physics",
    query: "Explain quantum entanglement to a computer scientist. How does it enable quantum computing?",
    expectedTopics: ["superposition", "measurement", "qubits", "correlation", "Bell state"],
    difficulty: 3,
  },
  {
    id: "phys-2",
    domain: "physics",
    query: "What is entropy in thermodynamics vs information theory? Are they the same concept?",
    expectedTopics: ["second law", "disorder", "Shannon entropy", "bits", "connection"],
    difficulty: 4,
  },
  {
    id: "phys-3",
    domain: "physics",
    query: "Why does time dilation occur in special relativity? Give an intuitive explanation using the light clock thought experiment.",
    expectedTopics: ["speed of light", "invariant", "Lorentz factor", "light clock"],
    difficulty: 3,
  },
  {
    id: "phys-4",
    domain: "physics",
    query: "Explain the butterfly effect in chaos theory. Is it real or a metaphor? What are the actual limitations of weather prediction?",
    expectedTopics: ["sensitive dependence", "initial conditions", "Lyapunov exponent", "deterministic"],
    difficulty: 3,
  },
];

const ai: BenchmarkQuery[] = [
  {
    id: "ai-1",
    domain: "ai",
    query: "Explain the transformer architecture's attention mechanism. Why did it replace RNNs for sequence tasks?",
    expectedTopics: ["self-attention", "QKV", "parallelization", "long-range dependencies"],
    difficulty: 3,
  },
  {
    id: "ai-2",
    domain: "ai",
    query: "What is the difference between fine-tuning and RAG for giving an LLM domain knowledge? When would you choose each?",
    expectedTopics: ["training data", "embeddings", "retrieval", "hallucination", "cost"],
    difficulty: 3,
  },
  {
    id: "ai-3",
    domain: "ai",
    query: "Why do neural networks generalize despite being overparameterized? What does the lottery ticket hypothesis say?",
    expectedTopics: ["overfitting", "implicit regularization", "sparse subnetworks", "pruning"],
    difficulty: 4,
  },
  {
    id: "ai-4",
    domain: "ai",
    query: "Explain RLHF (Reinforcement Learning from Human Feedback). What are its failure modes?",
    expectedTopics: ["reward model", "preference data", "sycophancy", "reward hacking"],
    difficulty: 3,
  },
];

const crossDomain: BenchmarkQuery[] = [
  {
    id: "cross-1",
    domain: "cross-domain",
    query: "How does information theory (Shannon entropy) apply to neural network compression and knowledge distillation?",
    expectedTopics: ["entropy", "mutual information", "compression", "distillation", "bits per parameter"],
    difficulty: 5,
  },
  {
    id: "cross-2",
    domain: "cross-domain",
    query: "Explain how the concept of eigenvalues from linear algebra connects to PageRank, quantum mechanics, and vibration analysis.",
    expectedTopics: ["eigenvector centrality", "Hamiltonian", "natural frequencies", "spectral"],
    difficulty: 5,
  },
  {
    id: "cross-3",
    domain: "cross-domain",
    query: "How does the second law of thermodynamics relate to the arrow of time, information theory, and the heat death of the universe?",
    expectedTopics: ["entropy increase", "irreversibility", "Maxwell's demon", "cosmology"],
    difficulty: 5,
  },
  {
    id: "cross-4",
    domain: "cross-domain",
    query: "What do Godel's incompleteness theorems, the halting problem, and quantum uncertainty have in common? Is there a deeper pattern?",
    expectedTopics: ["undecidability", "self-reference", "limits of knowledge", "formal systems"],
    difficulty: 5,
  },
  {
    id: "cross-5",
    domain: "cross-domain",
    query: "How does evolutionary biology inform the design of genetic algorithms in computer science? What are the key differences between biological and computational evolution?",
    expectedTopics: ["selection", "mutation", "crossover", "fitness landscape", "convergence"],
    difficulty: 4,
  },
];

export const ROUND_1: BenchmarkRound = {
  name: "Round 1: Cold Start",
  description: "First encounter. Kernel has no prior patterns.",
  queries: [programming[0], mathematics[0], physics[0], ai[0], crossDomain[0]],
};

export const ROUND_2: BenchmarkRound = {
  name: "Round 2: Warm Transfer",
  description: "Same domains, different queries. Kernel has Round 1 patterns.",
  queries: [programming[1], mathematics[1], physics[1], ai[1], crossDomain[1]],
};

export const ROUND_3: BenchmarkRound = {
  name: "Round 3: Pattern Compilation",
  description: "Third iteration. Patterns should be compiling toward abstractions.",
  queries: [programming[2], mathematics[2], physics[2], ai[2], crossDomain[2]],
};

export const ROUND_4: BenchmarkRound = {
  name: "Round 4: Deep Knowledge",
  description: "Fourth iteration. Compiled patterns should be active.",
  queries: [programming[3], mathematics[3], physics[3], ai[3], crossDomain[3]],
};

export const ROUND_5: BenchmarkRound = {
  name: "Round 5: Full Transfer",
  description: "Fifth iteration. Maximum pattern accumulation expected.",
  queries: [programming[0], mathematics[0], physics[0], ai[0], crossDomain[4]],
};

export const ALL_ROUNDS = [ROUND_1, ROUND_2, ROUND_3, ROUND_4, ROUND_5];
export const ALL_QUERIES = ALL_ROUNDS.flatMap((r) => r.queries);
