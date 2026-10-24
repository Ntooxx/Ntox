# NTOX Desktop — Personalized Settings & Safe Secret Handling

Status: implemented — Phases 1–4 are in the tree. See "Implementation status" at the end.
Owner: desktop + core config/API.
Related: `DESKTOP_APP_ARCHITECTURE.md`, `SECURITY.md`.

## 1. Problem

The desktop app can only change five non-secret preferences (`provider`, `model`,
`temperature`, `maxTokens`, `memoryEnabled`), and it cannot let a user enter their own
API key at all. In practice that means:

- A new desktop user cannot become functional without dropping to the CLI and running
  `ntox setup` — the desktop is not self-sufficient.
- Provider keys are global and flat: one `apiKey` is reused for whichever provider
  `resolveProvider()` picks, so switching provider breaks the key.
- Secrets are stored in plaintext and the "safe" boundary is only enforced by convention.

The goal: every desktop user can configure their own runtime (model, provider, keys,
workspace, memory, ports) from the app, with secrets handled in a way that is safe by
construction — never rendered, never logged, never returned by an endpoint, and
encrypted at rest where the OS supports it.

## 2. Current state (audit)

| Area | Where | Today |
|---|---|---|
| Config schema | `src/core/config.ts:19-77` | One flat `apiKey` plus channel tokens (`telegramToken`, `discordToken`, `whatsapp*`, `webAuthToken`, `apiAuthToken`) all in one `config.json`. |
| Config write | `src/core/config.ts:367-373` | `writeFileSync` + `chmod 0600`. On Windows `chmod` is a **no-op**, so the file ACL is inherited from the user profile directory. |
| Secret exposure | `src/api/desktop.ts:81-84` | `safeConfig()` returns model/provider/temp/maxTokens/memoryEnabled/apiPort/workspace. Good baseline, but there is no test that keeps it secret-free. |
| Settings API | `src/api/desktop.ts:242-253` | `GET /api/settings`, `PATCH /api/settings`. No credential route. Model/provider changes require an API restart. |
| Provider catalog | `src/core/llm.ts:46-149` | 10 providers; `apiKeyRequired` true for openrouter/openai/groq/deepseek/together/mistral/anthropic, false for openai-compatible/ollama/lmstudio. |
| Provider resolution | `src/core/llm.ts:176-187` | Model prefix can override the configured provider. Keys must therefore resolve against the **effective** provider, not just the configured one. |
| API auth | `src/api/server.ts:71-75`, `:287-296` | Binds `127.0.0.1`; bearer auth only when `apiAuthToken` is set (empty by default → unauthenticated local API). |
| Runtime freeze | `src/api/server.ts:77-90`, `src/api/desktop.ts:113` | `loadConfig()` and `createSharedInfra()` are captured **once**; the LLM client lives for the process lifetime. |
| Desktop shell | `desktop/main.cjs:15-33`, `desktop/preload.cjs` | Reads config for `apiPort`/`apiAuthToken`; narrow IPC surface; renderer is sandboxed with a strict CSP (`desktop/index.html:7`). |
| CLI onboarding | `src/setup.ts:170-183` | Prompts for key + tokens and writes them to config. |

Existing positives to keep: strict renderer CSP, context isolation, sandbox, a narrow
preload bridge, values validated in the main process before they reach the API.

## 3. Goals / non-goals

Goals:
- Configure provider + model + per-provider API keys entirely from the desktop.
- Verify a key before saving it; show configured/masked state without revealing it.
- Secrets never cross into the renderer as data, never appear in the HTTP API responses,
  logs, or error strings.
- Store secrets encrypted at rest using the OS keystore where available.
- Let the API pick up settings changes without a manual restart.
- Keep the CLI (`ntox setup`) working against the same store.

Non-goals (this pass):
- Multi-user profiles on one machine.
- OAuth / device-code provider login.
- Cloud sync of settings.

## 4. Threat model & security rules

Assets: provider API keys, messaging channel tokens, API/web auth tokens.

Adversaries:
1. Other local processes/users on the same machine.
2. The desktop renderer itself (a compromised page or XSS in dashboard/chat code).
3. Logs, crash reports, and error toasts.
4. Anyone who can read the config file (shared machine, backup, sync folder).

Rules (these are acceptance criteria, not suggestions):

R1. **Write-only secrets.** A secret is accepted at a boundary and never returned. No
    endpoint, IPC reply, log line, or error message ever contains a full secret.
    `GET` returns only `{ configured: boolean, masked: "sk-or-…a1b2" }`.
R2. **Renderer never holds a stored secret.** The renderer may hold a key only between
    the user typing it and the save request completing; input is cleared on success.
    Nothing secret is put in `localStorage`, the conversation store, or the DOM.
R3. **Redaction at the boundary.** The API and main process run every log/error through a
    redactor seeded with known secret values and key-shaped regexes before emitting.
R4. **Auth on by default for the desktop-managed API.** When the desktop owns the API
    process it always supplies and requires a bearer token (generated on first run).
R5. **Encryption at rest** by default on Windows/macOS via the OS keystore; documented
    fallback only where unavailable.
R6. **Least privilege for the secret file.** Restrict to the current user (ACL on
    Windows, 0600 elsewhere).
R7. **No secret in process arg lists.** Pass secrets to child processes via env or a
    short-lived, user-only file — never `argv`.

## 5. Target model

### 5.1 Split settings into two stores

Non-secret preferences stay in `~/.ntox/config.json` (unchanged shape, plus new keys).
Secrets move to a dedicated store so they can be redacted, masked, and encrypted as a
class:

```
~/.ntox/config.json          non-secret preferences only
~/.ntox/credentials.json     secret values (plaintext fallback, restricted to user)
~/.ntox/credentials.enc.json encrypted secret blob (safeStorage), preferred
```

Keep them as two files (not one) so that `GET /api/settings` is guaranteed unable to
leak a secret even if a field is accidentally added later.

Secret fields to migrate out of `config.json`:

| Field | Target |
|---|---|
| `apiKey` | `credentials.providers[<providerId>].apiKey` |
| `telegramToken` | `credentials.channels.telegram.token` |
| `discordToken` | `credentials.channels.discord.token` |
| `whatsappToken` / `whatsappAppSecret` / `whatsappVerifyToken` | `credentials.channels.whatsapp.*` |
| `webAuthToken` | `credentials.http.webAuthToken` |
| `apiAuthToken` | `credentials.http.apiAuthToken` |

Non-secret fields that stay in config: `provider`, `model`, `apiBaseUrl`, `temperature`,
`maxTokens`, `embeddingModel`, memory/meta/cognition toggles, `apiPort`, `webPort`,
`webHost`, `whatsappPort`, `dockerEnabled`, `animationLevel`, `uiMode`, `profiles[]`.

### 5.2 Credential record

```ts
interface ProviderCredential {
  provider: string;          // must exist in PROVIDERS (src/core/llm.ts)
  apiKey: string;            // never returned
  baseUrl?: string;          // openai-compatible only
  updatedAt: number;
  lastVerifiedAt?: number;   // set by the test endpoint
  fingerprint: string;       // sha256(apiKey).slice(0, 12) — lets us detect changes, not recover
}
```

### 5.3 Resolution & precedence

Add one helper so keys and provider always agree, mirroring `resolveProvider`:

```ts
// src/core/credentials.ts
export function resolveCredential(model: string, configuredProvider: string): string | undefined {
  const provider = resolveProvider(configuredProvider, model); // reuse llm.ts logic
  return (
    process.env.NTOX_API_KEY,                    // 1. desktop-injected, RAM only
    readCredentials().providers[provider]?.apiKey, // 2. credential store
    legacyConfigApiKey(),                        // 3. migration source
    providerEnvKey(provider)                     // 4. OPENROUTER_API_KEY, OPENAI_API_KEY, ...
  );
}
```

Precedence is: injected env > credential store > legacy config > conventional env var.
Every place that currently reads `config.apiKey` (LLM client construction, embedding
client) switches to `resolveCredential`.

## 6. Storage design (phased)

**Phase A — restricted plaintext (ships first, low risk).**
`credentials.json` written by a single `SecretStore` module with:
- Windows: `icacls "<file>" /inheritance:r /grant:r "%USERNAME%:F"` after write.
- POSIX: `chmod 0600`.
- Atomic write (temp file + rename), same pattern already used in
  `src/api/desktop.ts:54-60`.
This removes the whole class of "secret in the settings response" bugs immediately and is
the minimum for the UI work.

**Phase B — OS keystore (target).**
Electron main process owns `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret
on Linux). Main encrypts the credential blob and writes `credentials.enc.json`; the
plaintext never rests on disk. The API child process receives what it needs through the
environment of the process the desktop spawns:

```
NTOX_ACTIVE_PROVIDER=<provider>
NTOX_API_KEY=<decrypted key>        # env, not argv
```
`resolveCredential` prefers `NTOX_API_KEY`, so the encrypted store is only needed by the
main process.

Tradeoff to document: encryption-at-rest requires the desktop to own the API process. If
the app reuses an externally started API, no env can be injected and the key must come
from `credentials.json` (Phase A path). Surface this as a Settings status line:
"Secrets encrypted at rest: on/off (reason)".

**Phase C (optional)** — keyring helper or a native credential store so the CLI can
read DPAPI-encrypted secrets too.

## 7. Backend API surface

All desktop routes stay behind the existing allowlist in `src/api/desktop.ts:116` and the
route regex in `desktop/main.cjs:124`.

Non-secret settings:
- `GET /api/settings` → `{ settings: NonSecretSettings, profiles: Profile[], providers: ProviderInfo[], credentials: CredentialStatus[] }`
  - `CredentialStatus = { provider, configured, masked, source: "env"|"store"|"config", updatedAt?, lastVerifiedAt? }`
- `PATCH /api/settings` → validate + persist non-secret fields. Reject any secret-looking
  field with `400` rather than silently ignoring it.
- `PATCH /api/settings/profiles/:id` → workspace roots, allowed tools, shell/network policy.

Credentials (write-only):
- `PUT /api/settings/credentials/:provider` → body `{ apiKey, baseUrl? }`.
  Validates `provider ∈ PROVIDERS`, length bounds, and runs the verification call unless
  `{ verify: false }`. Response: `{ credential: CredentialStatus }` — mask only.
- `DELETE /api/settings/credentials/:provider` → `{ deleted: true }`.
- `POST /api/settings/credentials/:provider/test` → sends a key in the request (for the
  pre-save "Test" button), performs a lightweight authenticated call, does not persist,
  returns `{ ok, provider, modelCount?, latencyMs, error? }` with the key redacted.

Runtime:
- `GET /api/settings/providers` → catalog from `PROVIDERS`: `{ id, name, apiKeyRequired, formats, defaultModel, supportsEmbeddings }`.
- `POST /api/settings/reload` → rebuild shared infra + session map so model/provider/key
  changes take effect without killing the process (see §9).

Auth: when the desktop owns the API, all of the above require the bearer token (R4). When
an external API is reused without a token, the desktop shows a persistent warning banner
and disables credential writes.

## 8. Desktop shell & IPC changes

`desktop/main.cjs`:
- Generate `apiAuthToken` on first run if empty (32 random bytes, hex), persist it, and
  pass it to the spawned API. Keep forwarding `Authorization` on every request.
- On startup with safeStorage available, decrypt the credential blob and inject
  `NTOX_API_KEY` + `NTOX_ACTIVE_PROVIDER` into the API child's env.
- Add IPC handlers, validated like the existing ones (`validSender` + payload checks):
  - `ntox:save-credential` `{ provider, apiKey, baseUrl? }`
  - `ntox:delete-credential` `{ provider }`
  - `ntox:test-credential` `{ provider, apiKey, baseUrl? }`
  - `ntox:reload-runtime`
- Register secret values with a redactor so `console.error` paths can't echo them.
- The allowlist regex (`desktop/main.cjs:124`) must be extended for the new routes, and
  must continue to reject anything outside `/api/settings…`.

`desktop/preload.cjs`: add the four methods above. No raw `ipcRenderer`, no filesystem.
The existing `request()` shim can keep serving non-secret GETs.

Renderer (`desktop/dashboard.js`):
- Settings page becomes sections: **Provider & model** (provider select, model input,
  optional `baseUrl` for openai-compatible), **API key** (`type="password"`, autocomplete
  off, "Test" and "Save" buttons, masked status chip), **Runtime** (temperature,
  maxTokens, memory, ports), **Workspace & policy** (profile roots, allowed tools, shell
  and network policy), **Channels** (Telegram/Discord/WhatsApp tokens, same write-only
  pattern).
- Never pre-fill an existing secret. Show `masked` + `configured` only. Clear the input on
  save. Never write secrets to `state` or the persistence store.
- After saving, call reload and show "Applied" vs "Requires API restart (external API)".

## 9. Live config reload

Replace the one-shot capture:
- `src/api/server.ts`: give `createApiServer` a `reload()` that rebuilds
  `createDefaultAgentFactory()` state and drops the `SessionManager` sessions, then swap
  the factory used by `handleChat`.
- `src/api/desktop.ts:113`: build `tools` lazily (a getter) so profile/tool changes apply.
- `POST /api/settings/reload` calls it; the desktop invokes reload after any
  settings/credential write. Keep an explicit restart path for the desktop-owned child
  process as a fallback (kill + respawn, as `before-quit` already does).

## 10. Cross-cutting: redaction

New `src/core/redact.ts`:
- `registerSecret(value)` — called on config load for every known secret, and whenever a
  credential is written.
- `redact(text)` — replaces registered values and key-shaped matches
  (`sk-…`, `sk-or-v1-…`, `xoxb-…`, long hex) with `***`.
Wire it into: `src/api/desktop.ts` error responses (`:257-259`), `src/api/server.ts`
error paths, `desktop/main.cjs` `console.error` handlers (`:23-24`, `:189-192`, `:194`,
`:199`), and the doctor output.

## 11. Migration

On first read after upgrade:
1. If `config.json` has `apiKey`/channel tokens and no `credentials.json`, move them into
   the credential store and blank the fields in config (one atomic write each).
2. Keep the old values working if the credential store is missing (fallback read), so a
   downgrade doesn't brick the user.
3. `validateConfig` (`src/core/config.ts:102-109`) must accept the secrets-free config and
   log, but not fail on, a missing credential for providers with `apiKeyRequired: false`.

## 12. Test plan (vitest)

- `src/core/credentials.test.ts`: precedence order; atomic write; migration idempotency;
  fingerprint stability; mask format.
- `src/api/desktop.test.ts`: `GET /api/settings` response contains **no** full secret
  (assert against a known key string and a `SECRET_KEYS` list); `PATCH` rejects
  secret-shaped fields; `PUT` credential stores without returning it; `DELETE`; `test`
  route never persists; auth required when a token is set; 401 without it.
- `src/core/redact.test.ts`: registered values and key-shaped strings are redacted in
  error strings, JSON bodies, and stack traces.
- Existing `src/api/server.test.ts`: extend for reload (model change reflects on the next
  request without restart).
- Manual/E2E: fresh profile → set provider + key from the desktop → chat works; key wrong
  → test button reports failure; reload applies a model change live; grep the log and
  `credentials.enc.json` to confirm the plaintext key never appears.

## 13. Rollout

Phase 1 — secret store + read paths (no UI):
`src/core/credentials.ts`, migration, redaction, `safeConfig` → split,
`GET /api/settings` extended with credential status. Tests from §12.

Phase 2 — write API + auth default:
credential routes, verification calls, bearer token generated by the desktop, allowlist
in `main.cjs`. Tests + manual auth checks.

Phase 3 — UI:
Settings sections in `desktop/dashboard.js`, preload + IPC, masked status chips, test
buttons, reload wiring.

Phase 4 — encryption at rest:
`safeStorage`, env injection to the API child, status line, docs.

Phase 5 — channels + profiles:
expose messaging tokens and profile/policy editing with the same write-only pattern.

Acceptance criteria for the whole feature:
1. A brand-new user can reach a working chat without touching the CLI or `config.json`.
2. No endpoint, IPC reply, log, or error string ever contains a full secret (test-enforced).
3. Secrets are encrypted at rest on Windows/macOS, with a visible status when they are not.
4. Changing provider/model/key takes effect without a manual process restart, or the UI
   says exactly why not.
5. Switching provider does not reuse another provider's key.
6. `ntox setup` and the desktop read the same credential store.

## 16. Implementation status

Shipped in this change:

- **Phase 1** — `src/core/credentials.ts` (restricted credential store, masking, fingerprints, provider-scoped resolution), `src/core/redact.ts` (registered-value and pattern redaction), `src/core/paths.ts`, and a split in `src/core/config.ts`: `saveConfig` strips every secret field from `config.json` and persists it to the credential store, `loadConfig` hydrates it back so existing callers keep working, and a legacy plaintext config is migrated on first load. Tests: `credentials.test.ts`, `redact.test.ts`, plus migration assertions in `config.test.ts`.
- **Phase 2** — `GET /api/settings` returns the provider catalog and masked credential status only; `PATCH /api/settings` rejects any secret field with `400`; `PUT`/`DELETE /api/settings/credentials/:provider` are write-only; `POST …/:provider/test` validates a candidate key via `probeProvider` without persisting; `POST /api/settings/reload` rebuilds the agent factory and tool registry. Error bodies and SSE error events pass through the redactor. The desktop generates a per-launch bearer token by default. Tests: `desktop.test.ts`.
- **Phase 3** — desktop Settings gained a provider-credential panel (provider select, write-only key field, base URL, Test/Save/Remove/Use-provider actions, masked status and an encryption note), wired through new IPC methods in `preload.cjs`/`main.cjs` and an extended route allowlist.
- **Phase 4** — OS-keystore encryption: provider keys are stored in `~/.ntox/credentials.enc.json` via `safeStorage`, decrypted by the main process, and delivered to the API child through `NTOX_API_KEY`/`NTOX_API_KEY_PROVIDER`. Existing plaintext credentials are migrated into the encrypted blob on launch and removed from disk. When the keystore is unavailable the restricted-file fallback is used and the UI says so.

Verified: 1235 tests pass; migration, masking, redaction, auth-on-by-default, ACL restriction, and DPAPI encryption were each checked end to end against the built `dist`.

Still open (Phase 5): channel tokens (Telegram/Discord/WhatsApp) and per-profile policy editing in the Settings UI, `schemaVersion` downgrade handling, and key rotation prompts.

## 17. Risks / open questions

- **External API reuse vs encryption.** If a user already runs `ntox api`, encryption at
  rest cannot be guaranteed; we need the explicit status line and a documented limitation.
- **Env-var visibility.** Passing the key through the child's environment is safe from
  other machines but readable by the same user's debugger; acceptable, preferable to argv.
- **Windows ACLs.** `icacls` behavior differs on domain-joined/OneDrive-synced profile
  folders; verify in Phase 1 and fall back to DPAPI-only where the ACL write fails.
- **Provider matrix.** Verification calls differ per provider (`modelsUrl` is `null` for
  deepseek/together/mistral/anthropic); for those, use a 1-token chat completion instead.
- **Config schema versioning.** There is no `schemaVersion` in `config.json`; add one
  before the migration so downgrades are detectable.

## 18. Definition of done (Phases 1–4)

- New endpoints implemented, allowlisted, and unit-tested.
- `safeConfig`/settings responses proven secret-free by test.
- Desktop Settings page can set, test, mask, and delete a provider key, and reload applies
  it live.
- `DESKTOP_APP_ARCHITECTURE.md` updated: endpoint table, IPC contract, and a
  "Secret handling" section pointing at this plan.