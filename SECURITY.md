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

`proceduralMemoryEnabled` (default `false`) gates the verified procedural store. Its files live in `~/.ntox/procedures/` (`procedures.json` plus the harness keypair `.harness.private.key` / `.harness.public.key`) and are **harness-authority-only**: the security policy denies the agent's entire tool surface (read, write, grep/ls, shell working directory, image) access to that directory at any depth, and **no profile grant opens it** — unlike `memoryAccess`, there is no "full" scope. Procedure content reaches the model only through retrieval rendering, framed as untrusted task data; that is content delivery, not file authority.

Verification evidence is signed with **Ed25519** by a harness-side signer module that holds the private key (created mode `0600` on first use). The in-process verifier carries only the **public** key — no agent-surface module can sign (test-enforced source scan and export-surface check). Source-code knowledge alone is never enough to forge a signature: unkeyed-hash forgeries, signatures from foreign keypairs, and tampered content are all rejected at promotion, and evidence is **version-bound** (it pins the procedure id, version, and content hash, so stale or transplanted evidence cannot promote a revision). Corrupt key material fails closed (no signing, no verification). Note that policy checks do not inspect shell command *contents*, so trials should keep `shellPolicy` workspace-confined or disabled as already required by the experiment protocol.

## Response

You can expect acknowledgment within 48 hours and a fix timeline within the advisory.
