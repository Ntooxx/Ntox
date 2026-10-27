# Reporting Security Vulnerabilities

If you discover a security vulnerability in NTOX, please report it privately.

**Do not** open a public issue. Instead, email the maintainer or open a [GitHub Security Advisory](https://github.com/Ntooxx/Ntox/security/advisories/new).

## Scope

- Shell command injection via the `shell` tool
- Unauthorized file access via `read`/`write` tools
- API key leakage in logs or error messages
- Remote code execution through LLM prompt injection

## Local Secrets

NTOX stores provider and gateway tokens in `~/.ntox/config.json`. The file is plaintext so the CLI and gateway can run without an external secret manager. On save, NTOX applies best-effort `0600` permissions where the operating system supports it.

Treat this file as sensitive. Do not commit it, sync it to shared storage, or expose `~/.ntox` through a web server or shared volume.

## Memory Retrieval

Episodic memory retrieval (embedding similarity ranking, cosine scoring mode, embedding model and dimensions) is configured in `config.json` and enforced in-process. Environment variables are **never** consulted for retrieval scoring or for the security policy that decides raw memory-file access — that boundary is enforced only by validated `memoryAccess` settings on workspace profiles.

## Procedural Memory (Phase 3, experimental — off by default)

`proceduralMemoryEnabled` (default `false`) gates the verified procedural store. Its files live in `~/.ntox/procedures/` (`procedures.json` plus the HMAC signing key `.harness.key`) and are **harness-authority-only**: the security policy denies the agent's entire tool surface (read, write, grep/ls, shell working directory, image) access to that directory at any depth, and **no profile grant opens it** — unlike `memoryAccess`, there is no "full" scope. Procedure content reaches the model only through retrieval rendering, framed as untrusted task data; that is content delivery, not file authority.

Verification evidence is signed with HMAC-SHA256 using the key file (created mode `0600` on first use). Source-code knowledge alone is not enough to forge a signature: an unkeyed hash or a signature produced under a different key is rejected at promotion, and a corrupt key fails closed (no signing, no verification). Promotion is reachable only from harness-side code — the agent-facing source tree cannot reference the signing functions (test-enforced). Note that policy checks do not inspect shell command *contents*, so trials should keep `shellPolicy: "disabled"` or workspace-restricted as already required by the experiment protocol.

## Response

You can expect acknowledgment within 48 hours and a fix timeline within the advisory.
