# Changelog

## [0.1.0] - Unreleased

### Added
- Milestone M5 (identity and proof): identity narrative with evidence-backed positions, revision log, and atomic persistence
- Opinion formation: repeatedly observed mental-model entries promote to identity positions; outcomes strengthen or challenge them
- Cognitive fingerprint profile (patterns, theories, strategy weights, skills, positions, voice) with a divergence score against a fresh instance
- Meta-theory transfer experiments: distant-domain theory pairing, transfer hypotheses, held-out scoring, and a base-rate keep gate
- Blind voice A/B harness: LLM judge or heuristic fallback, randomized presentation order, cumulative identification rate
- ALIVE-1 benchmark: per-run records of learning slope, correction recurrence, transfer lift, calibration ECE, autonomy yield, identity divergence, cost per solved task, and NCB; weekly curve and M5 acceptance assessment
- `/mind identity`, `/mind divergence`, `/mind transfer`, and `/mind alive` commands
- Cognitive kernel with pattern compilation and 8D cognitive vector space
- Theory memory: observations → patterns → theories → meta-theories
- False-success self-correction for shallow reasoning
- Persistent episodic memory with cosine similarity retrieval
- Skill library with 74+ bundled cognitive framework documents
- Skill registry with trigger-based auto-activation
- Meta-cognition: strategy classification, self-reflection, mistake journal
- Decision kernel with goals, subtasks, and verification
- User model: learns verbosity, technical level, communication style
- 9 LLM providers: OpenAI, Anthropic, Ollama, LM Studio, Groq, Together, Mistral, DeepSeek, OpenRouter
- Tool system: read, write, edit, glob, grep, shell, web fetch, search
- Telegram gateway with session management
- CLI REPL with streaming output, animations, and sound
- Config validation with Zod
- Embedding cache (100-entry LRU) for faster repeated queries
- Gateway skip-reflection mode to reduce API call latency
- Parallelized embedding + web search pre-fetch
- Unified skill matching across registry + library systems
- Tool security: path traversal protection, SSRF blocking, ReDoS prevention, shell blocklist
- Telegram user allowlist
- Interactive approvals: tap-to-approve buttons on Telegram (inline keyboard — Allow once / Session / Always / Deny) and WhatsApp (reply buttons — Allow once / Always allow / Deny), replacing typed `/approve` for pending risky commands
- Auto-learn skills from success: after a clean multi-tool turn, Ntox drafts a reusable skill and proposes it in chat; `/skill save <name>` (all channels) accepts it; cooldown + collision guards, `skillAutoLearnEnabled` config flag
