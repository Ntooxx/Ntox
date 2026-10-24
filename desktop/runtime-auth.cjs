async function resolveRuntimeAccess({ baseUrl, tokens, request = fetch }) {
  const candidates = [...new Set(tokens.filter(token => typeof token === "string" && token.trim()))];
  if (!candidates.length) candidates.push("");
  for (const token of candidates) {
    let response;
    try {
      response = await request(`${baseUrl}/api/settings/providers`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      return { connected: false };
    }
    if (response.status === 401 || response.status === 403) continue;
    if (!response.ok) throw new Error(`The service at ${baseUrl} cannot serve the desktop API (${response.status}). Check the configured API port.`);
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.providers)) throw new Error(`The service at ${baseUrl} is not a compatible NTOX runtime.`);
    return { connected: true, token };
  }
  throw new Error(`The runtime at ${baseUrl} rejected the saved desktop credentials. Restart that runtime with the same NTOX directory and API token, then choose Retry now.`);
}

module.exports = { resolveRuntimeAccess };
