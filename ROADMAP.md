# NTOX Roadmap

High-level plan for the next stage of NTOX: from "capable CLI agent" to
"an agent you talk to, that grows its own skills, anywhere you chat."

Status legend: **P0** = next milestone · **P1** = after · **P2** = later
Effort: **S** < 1 day · **M** 1–3 days · **L** 1+ week

---

## Where we are today

| Area | State |
|---|---|
| Channels | Telegram, Discord, WhatsApp (Cloud API), Web — **text only** |
| Voice | Web channel only (record → Whisper, TTS button). TG/Discord ignore voice; WA turns audio into `[audio message]` |
| Skills | 3 built-in + 83 bundled markdown skills, trigger matching, one-shot learner via REPL `/skill learn` only |
| Commands | Gateway: `/new /reset /help /approve /alive /cron` (+ TG `/start`). REPL: ~50 commands, no `/cron` |
| Proactivity | Cron scheduler exists (gateway-only). Proactive suggestions and `alive` events **never reach messaging channels** |
| Email | Does not exist |
| Autonomy | Auto-continue plans, failure explanations, 30-turn work loop (shipped this session) |

---

## Pillar 1 — Voice everywhere (P0) "talk to him"

The goal: send a voice note on Telegram or WhatsApp, get a spoken reply.
Most plumbing exists: `src/tools/stt.ts` (Whisper), `src/tools/voice.ts` (TTS),
`src/gateway/voice.ts` (mime/size validation), and a working reference
implementation in the web channel (`gateway/index.ts` transcribe/synthesize).

### 1.1 Voice-note input — TG · P0 · M · ✅ shipped
- Download the voice file (`getFile` on Bot API), pass bytes as base64 to the
  `stt` tool, run the transcript as a normal user message.
- Wired into `src/gateway/telegram.ts`; errors reply with a friendly message.

### 1.2 Voice-note input — WhatsApp · P0 · M · ✅ shipped
- Two-hop media download (`GET /{media_id}` → signed URL) → `stt` → normal message.
- Voice replies: media upload (`POST /{id}/media`) → `type:"audio"` message.

### 1.3 Voice-note input — Discord · P1 · S
- Fetch `attachment.url`, same path. (Good first issue.)

### 1.4 Voice replies ("voice mode") · P0 · M · ✅ shipped
- `/voice on|off|auto` per chat, persisted in `~/.ntox/voice.json` (default: auto).
- `auto`: reply with a voice note when the *input* was voice; `on`: always; `off`: never.
- Outbound: TTS in ogg/opus → TG `sendVoice` / WA audio message (reuses `makeSender`).
- Capped at 600 chars, markdown stripped; full text always arrives as the message above.

### 1.5 Format normalization · P0 · S · ✅ shipped
- Extension → mime map (`.oga` → `audio/ogg`), `STT_MAX_BASE64_CHARS` guard,
  TTS `format` param (`opus` for voice bubbles, `mp3` default elsewhere).

### 1.6 Realtime voice call mode · P2 · L
- OpenAI Realtime API or WebRTC: full-duplex spoken conversation, barge-in.
- Prototype as a separate gateway channel (`src/gateway/voicecall.ts`).

**Phase 1 acceptance:** *send a voice note in Telegram asking "what's on my
plan today?" and get a spoken answer back, with zero typing.*

---

## Pillar 2 — Skills 2.0 (P0–P1) "drastically better at skills"

Current limits: learner only fires from REPL `/skill learn`; no installation;
no lifecycle (nothing learns from successful sessions); registry has 3 built-ins.

### 2.1 Auto-learn from success · P0 · M · ✅ shipped
- After a turn that succeeded (>= 2 successful tool calls across >= 2 distinct
  tools, no corrections / false-success / tool failures, substantive request
  and response), a fire-and-forget "skill curator" LLM pass reviews the
  exchange and drafts a reusable skill.
- Proposal only — never auto-saved. The user confirms with `/skill save
  <name>` on any channel (REPL prompt included) or ignores it.
- Guards: 20-turn cooldown between proposals, max 3 proposals per session,
  name/trigger collision rejection against existing skills, disabled via
  `skillAutoLearnEnabled: false` in config. Wired through both streaming
  paths (`runAgentMessage` / `runAgentStream`); gateways store one pending
  proposal per chat.

### 2.2 Skill installation · P0 · M · ✅ shipped
- `/skill install <url|git|file>` on all channels: fetch JSON or markdown,
  validate schema with `parseSkillJson` / `exportAsMarkdown` formats.
- Support plain-URL skill packs (a folder index.json + markdown files —
  same shape as the bundled `skills/` library).

### 2.3 Skill marketplace / shared registry · P1 · L · ✅ shipped
- A curated index of community skills installable by name:
  `/skill install weather-alerts`.
- Start simple: a git repo of skill files + a YAML/JSON index; no server.

### 2.4 Skill lifecycle & quality · P1 · M · ✅ shipped
- Usage stats exist (`incrementUsage`) — add `/skill stats`, auto-disable
  never-matched skills, versioning + `skill diff`, import/export between
  machines (already half-built in `registry.ts`).

### 2.5 Skill composition (routines) · P1 · M · ✅ shipped
- Skills that chain tools + other skills: "morning brief" = cron → web_read →
  summarize → TTS → send. This is the bridge between Pillar 2 and Pillar 4.

### 2.6 Broaden the library · P2 · M · ✅ shipped
- Grow from 83 bundled files toward domain packs (DevOps, Legal, Finance,
  Health, Gaming, Hardware) with the existing `## Triggers / ## Voices`
  structure.

### 2.7 External tools as skills (MCP bridge) · P2 · L · ✅ shipped
- Expose MCP servers to NTOX as skill-like tool providers, and NTOX skills
  as MCP tools for other hosts.
- `mcpServers` config (stdio command/args/env + remote url/headers) feeds a
  bridge that registers every remote tool as `mcp_<server>_<tool>` on REPL
  and gateway startup; `/mcp` reports state, tools, and errors on every
  channel. Outbound: `ntox mcp` serves `skill_list`, `skill_run`, and one
  tool per skill over stdio (`scripts/mcp-smoke.mjs` verifies a build).

**Phase 2 acceptance:** *finish a novel task once; NTOX offers to save it as
a skill; next time you type `/skill install <url>` or just mention the
trigger and it activates on Telegram.*

---

## Pillar 3 — Commands & chat UX (P0–P1)

### 3.1 Unified command layer · P0 · M · ✅ shipped
- Bring high-value REPL commands to all channels: `/status`, `/plan`,
  `/memory`, `/model`, `/skills`, `/tools`, `/cost`, `/undo`.
- Single registry (reuse `src/cli/commands.ts` catalog + `gateway/commands.ts`
  handler) so help text stays in sync.
- All ten read/write variants (`/status`, `/plan`, `/memory`, `/remember`,
  `/forget`, `/model`, `/skills`, `/tools`, `/cost`, `/undo`) answered by one
  `src/core/channel-commands.ts` handler wired into every channel; REPL gained
  `/skills`, `/tools`, `/plan` through the same handlers.
- Catalog entries carry `channel: true`; gateway `/help` renders from it via
  `renderChannelHelp`, so REPL and gateway help cannot drift.
- Read-only commands reply outside the transcript; `/model`, `/remember`,
  `/forget` are recorded through the session. Channel output is ANSI-stripped
  so styled renderer text stays plain in chat.

### 3.2 Interactive approvals · P0 · M · ✅ shipped
- Telegram approval requests arrive with an inline keyboard — Allow once /
  Session / Always / Deny (`callback_query` → `/approve <scope>`, spinner
  answered immediately, keyboard cleared after the decision).
- WhatsApp approval requests send interactive reply buttons (max 3 — Allow
  once / Always allow / Deny; `session` stays typing-only). Button replies map
  to `/approve <scope>` and run the same pipeline (typing, voice mode honored).
- Channels without buttons (Discord) keep the plain-text request.
- Fixed: `channelsByName` was never populated, so per-channel typing
  indicators and interactive sends from the gateway handler never fired.

### 3.3 `/cron` parity in REPL · P1 · S · ✅ shipped
- Cron is gateway-only today; expose the same manager in the REPL.
- `/cron` command handler extracted to `src/cron/commands.ts` so gateway and
  REPL share one implementation (add/list/toggle/remove/help, same usage
  text); REPL jobs are stored with `channel: "repl"` + session id.
- REPL starts its own `CronManager` at boot: `/skill run` jobs execute
  through the routine runner, other prompts through a fresh skip-reflection
  agent (never the live conversation), and results print to the terminal via
  delivery.
- `CronManager.setChannelFilter` gives each process ownership of its jobs, so
  a gateway service and an open REPL on the same `cron.json` never run the
  same job twice; filtered jobs keep their `nextRun` for their real owner.
- First tests for the cron module: command roundtrip + ownership/nextRun
  behavior under fake timers.

### 3.4 WhatsApp niceties · P1 · S · ✅ shipped (typing)
- Typing indicator via read-receipt + `typing_indicator` (refreshed at most
  every 8s during long generations), outbound formatting, status replies to
  forwarded media.

### 3.5 Rich media everywhere · P1 · M
- Inbound images/files on TG/WA (already partially: captions) feed the
  `image` tool; outbound: send screenshots/plots from tools as images.

---

## Pillar 4 — Proactivity & scheduling (P1) "he makes the first move"

### 4.1 Push proactive suggestions to channels · P1 · S
- `onProactiveSuggestion` is never wired in `runAgentMessage`
  (`core/dispatcher.ts`) — one of the highest-value one-line-ish gaps.
  Throttle to 1/day/chat.

### 4.2 `alive` events → push notifications · P1 · M
- `src/alive/` already detects file changes, git updates, open loops —
  currently viewable only via `/alive`. Push them through `makeSender`.

### 4.3 Scheduled digests · P1 · M
- `/cron add daily 8am "morning brief"` → plan status, inbox-worthy alive
  events, costs, open loops. Reuse `CronManager` + TTS for voice briefs.

### 4.4 Open-loop reminders · P2 · M
- "You asked me to finish X yesterday — shall I continue?" driven by
  `alive` open loops.

---

## Pillar 5 — Channels & integrations (P1–P2)

### 5.1 Email tool (send + read) · P1 · M
- New `src/tools/email.ts`: SMTP or Resend/Sendgrid for sending; IMAP or
  provider API for reading. Approval-gated (`send email` in destructive
  patterns). Commands: `/mail unread`, "email this to…".
- Nothing exists today — this is a greenfield pillar.

### 5.2 Slack · P1 · M — Good first issue
### 5.3 Matrix · P2 · M — Good first issue
### 5.4 Calendar & contacts · P2 · M
- Read/create events (Google Calendar / Outlook Graph), wired to natural
  language ("open calendar" should create, not just launch an app).

### 5.5 Files & photos · P2 · S
- Receive a photo of a document → OCR → memory. TG and WA both make this easy.

---

## Pillar 6 — Safety & control (P1, tracks autonomy)

- **Approval UX** (3.2) ✅ — inline buttons on TG/WA, session/always persistence exists.
- **Per-channel budgets** — token/cost caps per chat, `/cost` on channels.
- **Audit trail** — `shell-audit.log` exists; surface as `/audit` and keep
  N days.
- **Docker sandbox as default** when available (AGENTS.md known issue).

---

## Pillar 7 — Quality & infrastructure (parallel, S tasks)

- Real-provider integration tests for each wire format (OpenAI/Anthropic/
  Ollama) — AGENTS.md good-first-issue.
- Publish cognitive benchmark results to README (`npm run bench:cognitive`).
- CI running `verify:all`; badge in README.
- Docs: per-channel setup guide (Telegram token, WA Cloud API, Discord bot).

---

## Suggested phases

| Phase | Name | Contents | Outcome |
|---|---|---|---|
| **1** | Voice & talk | 1.1–1.5 ✅, 3.2 ✅, 3.4 ✅ | Voice notes in/out on TG + WA ✅, tap-to-approve ✅ |
| **2** | Skills & commands | 2.1 ✅, 2.2, 2.4, 3.1, 3.3 | Self-learning skills ✅ (propose + `/skill save`), installable skills, command parity |
| **3** | Proactive & email | 4.1–4.3, 5.1, 5.2 | He messages first; email send/read; Slack |
| **4** | Deep platform | 2.3, 2.5, 2.7, 4.4, 5.3–5.5, 6 | Marketplace, routines, MCP, calendar |
| **5** | Realtime | 1.6 | Spoken calls, wake word, hands-free |

Each phase ends with one demo-able acceptance scenario (see pillar footers).

---

## Quick wins (< half a day each)

1. Wire `onProactiveSuggestion` → gateway sender (4.1)
2. Discord voice input (1.3)
3. WhatsApp typing indicator (3.4)
4. REPL `/cron` parity (3.3)
5. `/status`, `/cost` on channels (3.1)
6. Publish benchmarks to README (7)