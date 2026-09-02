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

## Response

You can expect acknowledgment within 48 hours and a fix timeline within the advisory.
