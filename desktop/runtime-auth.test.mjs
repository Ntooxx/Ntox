import { describe, expect, it, vi } from "vitest";
import auth from "./runtime-auth.cjs";

const baseUrl = "http://127.0.0.1:3100";
const response = (status, body = { providers: [] }) => ({ status, ok: status === 200, json: async () => body });

describe("desktop runtime authentication", () => {
  it("reattaches with a valid stored token when an older token is rejected", async () => {
    const request = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));
    await expect(auth.resolveRuntimeAccess({ baseUrl, tokens: ["old", "new", "new"], request })).resolves.toEqual({ connected: true, token: "new" });
    expect(request.mock.calls.map(([, options]) => options.headers.Authorization)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("never calls a protected runtime healthy after an authentication failure", async () => {
    const request = vi.fn().mockResolvedValue(response(401));
    await expect(auth.resolveRuntimeAccess({ baseUrl, tokens: ["secret-value"], request })).rejects.toThrow("rejected the saved desktop credentials");
  });

  it("allows startup when there is no listener", async () => {
    const request = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(auth.resolveRuntimeAccess({ baseUrl, tokens: [], request })).resolves.toEqual({ connected: false });
  });

  it("rejects another service on the configured port", async () => {
    const request = vi.fn().mockResolvedValue(response(200, { ok: true }));
    await expect(auth.resolveRuntimeAccess({ baseUrl, tokens: [], request })).rejects.toThrow("not a compatible NTOX runtime");
  });
});
