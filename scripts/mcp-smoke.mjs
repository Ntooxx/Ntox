import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const stderrLines = [];
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js", "mcp"],
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => stderrLines.push(chunk.toString()));

const client = new Client({ name: "smoke", version: "1.0.0" });
const started = Date.now();
await client.connect(transport);
console.log("handshake ok in", Date.now() - started, "ms");

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const listed = await client.callTool({ name: "skill_list", arguments: { query: "deploy" } });
console.log("skill_list ->", JSON.stringify(listed).slice(0, 400));

const all = await client.callTool({ name: "skill_list", arguments: {} });
const allText = (all.content ?? []).map((block) => block.text ?? "").join("\n");
console.log("skill_list(all) first line:", allText.split("\n")[0]);

const missing = await client.callTool({ name: "skill_run", arguments: { name: "nope" } });
console.log("skill_run(missing) isError:", missing.isError, JSON.stringify(missing.content).slice(0, 200));

await client.close();
console.log("stderr from server:\n" + stderrLines.join(""));
console.log("SMOKE PASS");
