import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { workflowToolNames } from "./desktop.js";
import { existsSync, unlinkSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createApiServer } from "./server.js";
import { CREDENTIALS_PATH, setChannelSecret, setProviderCredential } from "../core/credentials.js";
import { CONFIG_PATH } from "../core/paths.js";

const TEST_KEY = "sk-or-v1-desktop-test-secret-0123456789";
const TEST_CHANNEL_TOKEN = "8598712471:AAdesktoptestsecretvalue0000000";

function clean(): void {
  for (const path of [CONFIG_PATH, CREDENTIALS_PATH]) {
    if (existsSync(path)) unlinkSync(path);
  }
}

beforeEach(clean);
afterEach(clean);

async function withServer(port: number, run: (base: string) => Promise<void>, authToken = ""): Promise<void> {
  const api = createApiServer({ port, host: "127.0.0.1", authToken });
  const running = await api.start();
  try {
    await run(`http://${running.host}:${running.port}`);
  } finally {
    await running.stop();
  }
}

describe("desktop settings API", () => {
  it("never returns a stored secret in settings or bootstrap", async () => {
    setProviderCredential("openrouter", TEST_KEY);
    setChannelSecret("telegramToken", TEST_CHANNEL_TOKEN);

    await withServer(3970, async (base) => {
      for (const route of ["/api/settings", "/api/desktop/bootstrap", "/api/settings/providers"]) {
        const res = await fetch(`${base}${route}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain(TEST_KEY);
        expect(text).not.toContain(TEST_CHANNEL_TOKEN);
        expect(text).not.toContain("desktop-test-secret");
      }
    });
  });

  it("reports masked credential status and the provider catalog", async () => {
    setProviderCredential("openrouter", TEST_KEY);
    await withServer(3971, async (base) => {
      const body = (await (await fetch(`${base}/api/settings`)).json()) as {
        providers: { id: string; apiKeyRequired: boolean }[];
        credentials: { provider: string; configured: boolean; masked: string }[];
        settings: Record<string, unknown>;
      };
      expect(body.providers.some((p) => p.id === "openrouter")).toBe(true);
      expect(body.providers.some((p) => p.id === "ollama" && p.apiKeyRequired === false)).toBe(true);
      const openrouter = body.credentials.find((c) => c.provider === "openrouter");
      expect(openrouter?.configured).toBe(true);
      expect(openrouter?.masked).toBe("sk-or-…6789");
      expect(body.settings).not.toHaveProperty("apiKey");
      expect(body.settings).not.toHaveProperty("telegramToken");
    });
  });

  it("rejects a patch that tries to set a secret", async () => {
    await withServer(3972, async (base) => {
      const res = await fetch(`${base}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", apiKey: TEST_KEY }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Secrets cannot be set");
      expect(body.error).not.toContain(TEST_KEY);
    });
  });

  it("patches non-secret settings and validates input", async () => {
    await withServer(3973, async (base) => {
      const ok = await fetch(`${base}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "anthropic/claude-3-5-sonnet", temperature: 0.4, memoryEnabled: false }),
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { settings: { model: string; temperature: number; memoryEnabled: boolean } };
      expect(body.settings.model).toBe("anthropic/claude-3-5-sonnet");
      expect(body.settings.temperature).toBe(0.4);
      expect(body.settings.memoryEnabled).toBe(false);

      const badProvider = await fetch(`${base}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "not-a-provider" }),
      });
      expect(badProvider.status).toBe(400);

      const badTemp = await fetch(`${base}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperature: 9 }),
      });
      expect(badTemp.status).toBe(400);
    });
  });

  it("stores, masks, and deletes a provider credential", async () => {
    await withServer(3974, async (base) => {
      const put = await fetch(`${base}/api/settings/credentials/openrouter`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: TEST_KEY }),
      });
      expect(put.status).toBe(200);
      const putText = await put.text();
      expect(putText).not.toContain(TEST_KEY);
      expect(
        (JSON.parse(putText) as { credential: { configured: boolean; masked: string } }).credential.configured,
      ).toBe(true);

      const del = await fetch(`${base}/api/settings/credentials/openrouter`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect((await del.json()) as { deleted: boolean }).toEqual({ deleted: true });

      const again = await fetch(`${base}/api/settings/credentials/openrouter`, { method: "DELETE" });
      expect(again.status).toBe(404);
    });
  });

  it("requires a key before testing a provider that needs one", async () => {
    await withServer(3975, async (base) => {
      const res = await fetch(`${base}/api/settings/credentials/openai/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("API key is required");
    });
  });

  it("rejects unknown providers on credential routes", async () => {
    await withServer(3976, async (base) => {
      const res = await fetch(`${base}/api/settings/credentials/nope`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: TEST_KEY }),
      });
      expect(res.status).toBe(404);
    });
  });

  it("reloads the runtime and returns fresh settings", async () => {
    await withServer(3977, async (base) => {
      const res = await fetch(`${base}/api/settings/reload`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { settings: Record<string, unknown> };
      expect(body.settings.model).toBeTruthy();
    });
  });

  it("enforces bearer auth on settings when a token is configured", async () => {
    await withServer(
      3978,
      async (base) => {
        const denied = await fetch(`${base}/api/settings`);
        expect(denied.status).toBe(401);
        const allowed = await fetch(`${base}/api/settings`, { headers: { Authorization: "Bearer desktop-token" } });
        expect(allowed.status).toBe(200);
      },
      "desktop-token",
    );
  });
});

describe("workflow tool modes", () => {
  const catalog = [{ name: "read" }, { name: "shell" }, { name: "write" }, { name: "grep" }, { name: "search" }, { name: "subagent" }];

  it("restricts research workflows to read and search tools", () => {
    expect(workflowToolNames("research", catalog)).toEqual(["grep", "read", "search"]);
  });

  it("opens execute workflows to every tool except nested subagents", () => {
    expect(workflowToolNames("execute", catalog)).toEqual(["grep", "read", "search", "shell", "write"]);
  });
});

describe("desktop permissions API", () => {
  function patch(base: string, payload: unknown) {
    return fetch(`${base}/api/desktop/permissions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  it("reports the effective profile and the registered tools", async () => {
    await withServer(3980, async (base) => {
      const res = await fetch(`${base}/api/desktop/permissions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profile: { id: string; allowedTools: string[]; readRoots: string[]; shellPolicy: string; networkPolicy: string };
        defaultProfileId: string;
        tools: string[];
      };
      expect(body.profile.id).toBeTruthy();
      expect(body.defaultProfileId).toBeTruthy();
      expect(body.profile.readRoots.length).toBeGreaterThan(0);
      expect(body.profile.readRoots.every((root) => isAbsolute(root))).toBe(true);
      expect(body.profile.allowedTools).toContain("read");
      expect(body.tools).toContain("email_send");
    });
  });

  it("toggles tools and policies on the active profile", async () => {
    await withServer(3981, async (base) => {
      const granted = await patch(base, {
        removeTools: ["email_send"],
        shellPolicy: "workspace",
        networkPolicy: "fetch-only",
      });
      expect(granted.status).toBe(200);
      const after = (await granted.json()) as {
        profile: { allowedTools: string[]; shellPolicy: string; networkPolicy: string };
      };
      expect(after.profile.allowedTools).not.toContain("email_send");
      expect(after.profile.shellPolicy).toBe("workspace");
      expect(after.profile.networkPolicy).toBe("fetch-only");

      const restored = await patch(base, { addTools: ["email_send"] });
      expect(restored.status).toBe(200);
      const body = (await restored.json()) as { profile: { allowedTools: string[] } };
      expect(body.profile.allowedTools).toContain("email_send");
    });
  });

  it("validates permission changes before writing anything", async () => {
    await withServer(3982, async (base) => {
      const empty = await patch(base, {});
      expect(empty.status).toBe(400);
      expect(((await empty.json()) as { error: string }).error).toContain("No permission changes");

      const relative = await patch(base, { readRoots: ["relative/path"] });
      expect(relative.status).toBe(400);

      const noRoots = await patch(base, { writeRoots: [] });
      expect(noRoots.status).toBe(400);

      const badPolicy = await patch(base, { shellPolicy: "sometimes" });
      expect(badPolicy.status).toBe(400);

      const badTool = await patch(base, { addTools: ["email send; rm -rf"] });
      expect(badTool.status).toBe(400);
    });
  });

  it("keeps at least one tool on the allowlist", async () => {
    await withServer(3983, async (base) => {
      const everything = (await (await fetch(`${base}/api/desktop/permissions`)).json()) as {
        profile: { allowedTools: string[] };
      };
      const res = await patch(base, { removeTools: everything.profile.allowedTools });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("cannot be empty");
    });
  });

  it("persists permission changes so they survive a runtime reload", async () => {
    await withServer(3984, async (base) => {
      const removed = await patch(base, { removeTools: ["email_read"] });
      expect(removed.status).toBe(200);

      await fetch(`${base}/api/settings/reload`, { method: "POST" });
      const reloaded = (await (await fetch(`${base}/api/desktop/permissions`)).json()) as {
        profile: { allowedTools: string[] };
      };
      expect(reloaded.profile.allowedTools).toContain("read");
      expect(reloaded.profile.allowedTools).not.toContain("email_read");
    });
  });
});
