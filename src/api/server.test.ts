import { describe, expect, it } from "vitest";
import { createApiServer } from "./server.js";
import type { Agent } from "../core/agent.js";

function mockAgent(tokens: string[]): Agent {
  return {
    run: async function* (
      _input: string,
      callbacks: {
        onToken: (t: string) => void;
        onPhase?: (p: string) => void;
        onUsage?: (u: unknown) => void;
      },
    ) {
      callbacks.onPhase?.("responding");
      for (const token of tokens) {
        callbacks.onToken(token);
        yield token;
      }
      callbacks.onUsage?.({ inputTokens: 10, outputTokens: 5, cost: 0 });
    },
    resetConversation: () => {},
  } as unknown as Agent;
}

async function readSse(res: Response): Promise<{ events: { event: string; data: unknown }[] }> {
  const text = await res.text();
  const events: { event: string; data: unknown }[] = [];
  for (const block of text.split("\n\n")) {
    const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (eventLine && dataLine) {
      events.push({
        event: eventLine.slice(7).trim(),
        data: JSON.parse(dataLine.slice(6)),
      });
    }
  }
  return { events };
}

describe("createApiServer", () => {
  it("responds to /api/health", async () => {
    const api = createApiServer({ port: 3991, host: "127.0.0.1" });
    const running = await api.start();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await running.stop();
    }
  });

  it("rejects chat without a bearer token when auth is configured", async () => {
    const api = createApiServer({
      port: 3992,
      host: "127.0.0.1",
      authToken: "secret",
      agentFactory: () => mockAgent(["hi"]),
    });
    const running = await api.start();
    try {
      const denied = await fetch(`http://${running.host}:${running.port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(denied.status).toBe(401);

      const wrong = await fetch(`http://${running.host}:${running.port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(wrong.status).toBe(401);
    } finally {
      await running.stop();
    }
  });

  it("streams chat over SSE with token/done events", async () => {
    const api = createApiServer({
      port: 3993,
      host: "127.0.0.1",
      agentFactory: () => mockAgent(["Hello ", "world"]),
    });
    const running = await api.start();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi", sessionId: "test-session" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const { events } = await readSse(res);
      const tokens = events.filter((e) => e.event === "token");
      const done = events.find((e) => e.event === "done");
      expect(tokens.length).toBeGreaterThan(0);
      expect(done).toBeDefined();
      const doneData = done!.data as { response: string; sessionId: string };
      expect(doneData.response).toContain("Hello");
      expect(doneData.sessionId).toBe("test-session");
      const joined = tokens.map((t) => (t.data as { text: string }).text).join("");
      expect(joined).toContain("Hello");
    } finally {
      await running.stop();
    }
  });

  it("returns 400 for missing message", async () => {
    const api = createApiServer({
      port: 3994,
      host: "127.0.0.1",
      agentFactory: () => mockAgent(["x"]),
    });
    const running = await api.start();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    } finally {
      await running.stop();
    }
  });

  it("resets a session", async () => {
    let resetCalled = false;
    const agent = {
      ...mockAgent(["ok"]),
      resetConversation: () => {
        resetCalled = true;
      },
    };
    const api = createApiServer({
      port: 3995,
      host: "127.0.0.1",
      agentFactory: () => agent as unknown as Agent,
    });
    const running = await api.start();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/api/session/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "test-session" }),
      });
      expect(res.status).toBe(200);
      expect(resetCalled).toBe(true);
    } finally {
      await running.stop();
    }
  });

  it("returns 404 for unknown routes", async () => {
    const api = createApiServer({ port: 3996, host: "127.0.0.1" });
    const running = await api.start();
    try {
      const res = await fetch(`http://${running.host}:${running.port}/api/nope`);
      expect(res.status).toBe(404);
    } finally {
      await running.stop();
    }
  });
});
