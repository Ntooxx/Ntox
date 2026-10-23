(() => {
  const root = document.getElementById("ntox-console");
  const chatApp = document.getElementById("desktop-chat");
  if (!root || !chatApp) return;

  const iconPaths = {
    overview: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', agents: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', tasks: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 2.5 2.5L16 9"/>', memory: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>', tools: '<path d="m14.7 6.3 3 3M4 20l8.8-8.8M15 5a4 4 0 0 0 5 5l-4 4-5-5 4-4ZM3 21l4-4"/>', evaluations: '<path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4a7 7 0 0 1-.1 1.8Z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', chat: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8 8 0 0 1-3.4-.7L4 20l1.4-4.1A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z"/><path d="M8 12h8M8 9h5"/>'
  };
  const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || iconPaths.overview}</svg>`;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const nav = ["Overview", "Agents", "Tasks", "Memory", "Tools", "Evaluations", "Settings"];
  const state = { page: "Overview", bootstrap: null, agents: [], tasks: [], workflows: [], memory: [], graph: { nodes: [], links: [] }, tools: [], evaluations: { runs: [], suites: [] }, settings: {}, loading: true, error: "" };
  root.innerHTML = `<header class="console-top"><a class="console-brand" href="#overview"><span>NTOX<sup>®</sup></span><small>cognitive agent runtime</small></a><div class="system-state"><i></i><span><b id="system-label">CONNECTING</b><small id="system-detail">Loading local runtime data</small></span></div><div class="console-time"><span id="console-clock"></span><small>local desktop runtime</small></div><button class="console-mobile-menu" aria-label="Open navigation">${icon("overview")}</button></header><aside class="console-sidebar"><nav aria-label="Main navigation">${nav.map(page => `<button class="nav-item ${page === state.page ? "active" : ""}" data-page="${page}">${icon(page.toLowerCase())}<span>${page}</span></button>`).join("")}</nav><div class="sidebar-motto">HIGHER<br>INTELLIGENCE<br>THROUGH<br>COMPOUND AGENTS.</div><button class="chat-nav" data-open-chat>${icon("chat")}<span>Open NTOX chat</span><kbd>↗</kbd></button></aside><main class="console-main" id="console-main"></main>`;

  const main = () => document.getElementById("console-main");
  const api = (route, method = "GET", body) => window.ntoxDesktop.request({ route, method, body });
  const header = (eyebrow, title, description, aside = "") => `<section class="page-hero"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${aside}</section>`;
  const metric = (label, value, note, symbol = "memory") => `<article class="metric-card"><div class="metric-label">${icon(symbol, 20)}<span>${label}</span></div><div class="metric-value">${esc(value)}</div><p>${esc(note)}</p></article>`;
  const status = value => `<span class="status ${esc(String(value || "unknown").toLowerCase())}"><i></i>${esc(value || "Unknown")}</span>`;
  const empty = text => `<div class="empty-state">${esc(text)}</div>`;

  function overview() {
    const runtime = state.bootstrap?.runtime || {};
    const activeAgents = state.agents.filter(agent => agent.status === "running").length;
    const runningTasks = state.tasks.filter(task => ["running", "queued"].includes(task.status)).length;
    const activeWorkflows = state.workflows.filter(workflow => ["running", "queued"].includes(workflow.status)).length;
    const recent = state.tasks.slice(0, 5);
    return `${header("NTOX / COMMAND CENTER", "Intelligence, in motion.", "A live view of your local NTOX runtime.", `<div class="hero-status"><span class="live-dot"></span><div><small>RUNTIME HEALTH</small><b>${esc(runtime.status || "Connecting")}</b><em>${runtime.uptimeSeconds ? `UP ${Math.floor(runtime.uptimeSeconds / 3600)}H ${Math.floor(runtime.uptimeSeconds % 3600 / 60)}M` : "LOCAL AGENT API"}</em></div></div>`)}<section class="metrics-grid">${metric("ACTIVE AGENTS", activeAgents, "Currently executing subagent runs", "agents")}${metric("PARALLEL TASKS", runningTasks, "Queued and running workflow steps", "tasks")}${metric("ACTIVE WORKFLOWS", activeWorkflows, "Persisted desktop workflows", "tools")}${metric("MEMORY RECORDS", state.bootstrap?.memory?.total ?? (state.memory.length), "Runtime memory records", "memory")}</section><section class="overview-grid"><article class="panel fleet-panel"><div class="panel-head"><div><span class="eyebrow">AGENT FLEET</span><h2>Working together</h2></div><button class="quiet-button" data-go="Agents">View fleet ${icon("arrow", 15)}</button></div><div class="fleet-list">${state.agents.length ? state.agents.slice(0, 6).map(agent => `<div class="fleet-row"><span class="agent-avatar">${icon("agents", 18)}</span><div class="agent-title"><b>${esc(agent.name)}</b><small>${esc(agent.role)}</small></div>${status(agent.status)}<span class="row-activity">${esc(agent.currentTask || "Ready for work")}</span></div>`).join("") : empty("No agents reported by the runtime.")}</div></article><article class="panel activity-panel"><div class="panel-head"><div><span class="eyebrow">RECENT WORK</span><h2>Workflow activity</h2></div><button class="quiet-button" data-go="Tasks">All tasks ${icon("arrow", 15)}</button></div>${recent.length ? `<div class="activity-list">${recent.map(task => `<div><time>${task.startedAt ? new Date(task.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</time><i class="activity-mark"></i><p><b>${esc(task.title)}</b><small>${esc(task.workflowId)} · ${esc(task.status)}</small></p></div>`).join("")}</div>` : empty("No desktop workflows yet. Create one in Tasks.")}</article><article class="panel runtime-panel"><span class="eyebrow">LOCAL RUNTIME</span><h2>Machine status</h2><div class="runtime-row"><span>CPU cores</span><b>${esc(runtime.cpuCount ?? "—")}</b></div><div class="runtime-row"><span>System memory</span><b>${runtime.memoryTotalBytes ? `${(runtime.memoryFreeBytes / 1024 ** 3).toFixed(1)} / ${(runtime.memoryTotalBytes / 1024 ** 3).toFixed(1)} GB free` : "—"}</b></div><div class="runtime-row"><span>Model</span><b>${esc(state.bootstrap?.config?.model || "—")}</b></div></article></section>`;
  }

  function agentsPage() {
    const rows = state.agents.map(agent => `<tr><td><b>${esc(agent.name)}</b><small>${esc(agent.id)}</small></td><td>${status(agent.status)}</td><td>${esc(agent.role)}</td><td>${esc(agent.currentTask || "Idle")}</td><td>${agent.startedAt ? new Date(agent.startedAt).toLocaleString() : "—"}</td><td>${Array.isArray(agent.tools) ? esc(agent.tools.join(", ")) : "—"}</td></tr>`).join("");
    return `${header("AGENTS", "Manage your intelligent agent fleet.", "NTOX-owned agents and isolated subagent runs.")}<section class="metrics-grid">${metric("REGISTERED AGENTS", state.agents.length, "Coordinator and persisted subagent runs", "agents")}${metric("ACTIVE RUNS", state.agents.filter(agent => agent.status === "running").length, "Executing now", "tasks")}${metric("AVAILABLE TOOLS", state.tools.length, "Registered runtime tools", "tools")}${metric("MAX CONCURRENCY", 3, "Current subagent runtime limit", "memory")}</section><section class="panel table-panel"><div class="table-toolbar"><div><span class="eyebrow">AGENT FLEET</span><h2>Runtime agents</h2></div><label class="search-field">${icon("search", 15)}<input id="agent-search" placeholder="Search agents..."></label></div><div class="table-scroll"><table><thead><tr><th>AGENT</th><th>STATUS</th><th>ROLE</th><th>CURRENT TASK</th><th>STARTED</th><th>TOOLS</th></tr></thead><tbody id="agent-rows">${rows || `<tr><td colspan="6">${empty("No NTOX subagent runs have been recorded.")}</td></tr>`}</tbody></table></div></section>`;
  }

  function tasksPage() {
    const rows = state.tasks.map(task => `<tr><td><b>${esc(task.title)}</b><small>${esc(task.id)}</small></td><td>${esc(task.workflowId)}</td><td>${status(task.status)}</td><td>${task.startedAt ? new Date(task.startedAt).toLocaleTimeString() : "—"}</td><td>${task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : "—"}</td><td>${task.error ? esc(task.error) : esc(task.result || "—")}</td></tr>`).join("");
    return `${header("TASKS", "Orchestrate work across NTOX agents.", "Create durable workflows and run up to three isolated subagents in parallel.")}<section class="panel task-create"><div class="panel-head"><div><span class="eyebrow">NEW WORKFLOW</span><h2>Give your agents a goal</h2></div></div><form id="workflow-form"><label>Overall goal<textarea name="goal" required maxlength="10000" placeholder="Describe the outcome you want..."></textarea></label><label>Parallel subtask prompts <small>Optional. Add one prompt per line, up to three. Leave blank to run one agent on the full goal.</small><textarea name="subtasks" maxlength="30000" placeholder="Research the key facts...&#10;Compare the available approaches...&#10;Identify risks and tradeoffs..."></textarea></label><div class="form-actions"><span id="workflow-message">Subagents receive read and research tools only.</span><button class="primary-button" type="submit">${icon("plus", 16)} Start workflow</button></div></form></section><section class="panel table-panel"><div class="table-toolbar"><div><span class="eyebrow">TASK QUEUE</span><h2>Persisted workflow steps</h2></div><span>${state.tasks.length} tasks · ${state.workflows.length} workflows</span></div><div class="table-scroll"><table><thead><tr><th>TASK</th><th>WORKFLOW</th><th>STATUS</th><th>STARTED</th><th>COMPLETED</th><th>RESULT / ERROR</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${empty("No workflows yet. Create a workflow above.")}</td></tr>`}</tbody></table></div></section>`;
  }

  function memoryPage() {
    const nodes = state.graph.nodes.slice(0, 70);
    const points = nodes.map((node, index) => ({ ...node, x: 16 + (index % 10) * 8.7 + (index % 3) * 1.2, y: 20 + (Math.floor(index / 10) % 7) * 12 + (index % 4) * 1.7 }));
    const byId = new Map(points.map(point => [point.id, point]));
    const lines = state.graph.links.map(link => { const a = byId.get(link.source), b = byId.get(link.target); return a && b ? `<line x1="${a.x}%" y1="${a.y}%" x2="${b.x}%" y2="${b.y}%"/>` : ""; }).join("");
    const graph = `<svg class="memory-web" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}${points.map(point => `<circle cx="${point.x}%" cy="${point.y}%" r="${point.type === "episodic" ? 1.4 : 2.1}"/>`).join("")}</svg>`;
    const writes = state.memory.slice(0, 8).map(item => `<div class="memory-write"><time>${new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>${icon("memory", 16)}<p>${esc(item.text)}<small>${esc(item.source)}</small></p><span>${esc(item.type)}</span></div>`).join("");
    return `${header("MEMORY", "A mind that remembers.", "Inspect the runtime's persistent episodic and durable memory.")}<section class="memory-layout"><article class="panel graph-panel"><div class="panel-head"><div><span class="eyebrow">MEMORY GRAPH</span><h2>Records connected by source</h2></div><span class="graph-count">${state.graph.total || nodes.length} records · ${state.graph.links.length} links</span></div><div class="graph-key"><span><i></i>Episodic</span><span><i></i>Durable</span></div>${nodes.length ? graph : empty("No memory records have been stored yet.")}</article><div class="memory-side"><article class="panel memory-stat"><span class="eyebrow">MEMORY SYSTEM</span><b>${state.bootstrap?.config?.memoryEnabled ? "Enabled" : "Disabled"}</b><p>Configured runtime memory</p></article><article class="panel memory-stat"><span class="eyebrow">TOTAL RECORDS</span><b>${state.graph.total ?? state.memory.length}</b><p>Episodic and durable records</p></article><article class="panel memory-stat"><span class="eyebrow">MEMORY SIZE</span><b>${state.bootstrap?.memory?.stats?.memorySizeBytes ? `${(state.bootstrap.memory.stats.memorySizeBytes / 1024).toFixed(1)} KB` : "—"}</b><p>Stored episode data</p></article></div><article class="panel recent-writes"><div class="panel-head"><div><span class="eyebrow">RECENT RECORDS</span><h2>Memory activity</h2></div></div>${writes || empty("No records to show.")}</article><article class="panel distribution"><div class="panel-head"><div><span class="eyebrow">MEMORY TYPES</span><h2>Current distribution</h2></div></div>${state.memory.length ? `<ul class="memory-type-list">${[...new Set(state.memory.map(item => item.type))].map(type => `<li>${esc(type)}<b>${state.memory.filter(item => item.type === type).length}</b></li>`).join("")}</ul>` : empty("No memory records.")}</article></section>`;
  }

  function toolsPage() {
    const cards = state.tools.map(tool => `<article class="tool-card"><span class="tool-icon">${icon("tools", 20)}</span><div><h3>${esc(tool.name)}</h3><p>${esc(tool.description)}</p></div><div class="tool-card-foot"><span>${esc(tool.category)}</span><span class="status ${tool.enabled ? "running" : "idle"}"><i></i>${tool.enabled ? "Registered" : "Disabled"}</span><small>${tool.requiresApproval ? "Policy gated" : "Runtime policy"}</small></div></article>`).join("");
    return `${header("TOOLS", "Capabilities at hand.", "The tool registry exposed by your local NTOX runtime.")}<section class="metrics-grid">${metric("REGISTERED TOOLS", state.tools.length, "Available to runtime agents", "tools")}${metric("POLICY GATED", state.tools.filter(tool => tool.requiresApproval).length, "Shell and filesystem write operations", "evaluations")}${metric("ORCHESTRATION", state.tools.some(tool => tool.name === "subagent") ? "Enabled" : "Unavailable", "Subagent tool registration", "agents")}</section><section class="panel tool-catalog"><div class="table-toolbar"><div><span class="eyebrow">TOOL CATALOG</span><h2>Registered capabilities</h2></div></div><div class="tool-grid">${cards || empty("No tools are registered.")}</div></section>`;
  }

  function evaluationsPage() {
    const runs = state.evaluations.runs || [];
    return `${header("EVALUATIONS", "Verify. Measure. Improve.", "Evaluation results from records produced by this runtime.")}<section class="metrics-grid">${metric("RECORDED RUNS", runs.length, "Persisted evaluation records", "evaluations")}${metric("SUITES", (state.evaluations.suites || []).length, "Available evaluation suites", "tools")}</section><section class="panel runs-panel"><div class="panel-head"><div><span class="eyebrow">EVALUATION HISTORY</span><h2>Recent runs</h2></div></div>${runs.length ? `<div class="table-scroll"><table><thead><tr><th>ID</th><th>SUITE</th><th>AGENT</th><th>SCORE</th><th>STATUS</th><th>COMPLETED</th></tr></thead><tbody>${runs.map(run => `<tr><td>${esc(run.id)}</td><td>${esc(run.suite)}</td><td>${esc(run.agent)}</td><td>${esc(run.score)}</td><td>${status(run.status)}</td><td>${esc(run.completedAt)}</td></tr>`).join("")}</tbody></table></div>` : empty(state.evaluations.message || "No evaluation run records are available in this runtime. Scores will appear here when an evaluation service writes authoritative results.")}</section>`;
  }

  function settingsPage() {
    const settings = state.settings;
    return `${header("SETTINGS", "Configure your local runtime.", "Only non-secret model and runtime preferences are editable here.")}<section class="settings-layout"><article class="panel settings-panel"><span class="eyebrow">AGENT DEFAULTS</span><h2>Runtime configuration</h2><form id="settings-form"><label class="setting-row"><span><b>Provider</b><small>Configured provider ID.</small></span><input name="provider" value="${esc(settings.provider)}" maxlength="80"></label><label class="setting-row"><span><b>Model</b><small>Model identifier used by new agent sessions.</small></span><input name="model" value="${esc(settings.model)}" maxlength="200"></label><label class="setting-row"><span><b>Temperature</b><small>Sampling temperature from 0 to 2.</small></span><input name="temperature" type="number" min="0" max="2" step="0.1" value="${esc(settings.temperature)}"></label><label class="setting-row"><span><b>Maximum tokens</b><small>Maximum response tokens.</small></span><input name="maxTokens" type="number" min="1" max="1000000" step="1" value="${esc(settings.maxTokens)}"></label><label class="setting-row"><span><b>Memory enabled</b><small>Allow runtime sessions to use memory.</small></span><input name="memoryEnabled" type="checkbox" ${settings.memoryEnabled ? "checked" : ""}></label><div class="form-actions"><span id="settings-message">Secrets remain in NTOX configuration and are never returned.</span><button class="primary-button" type="submit">Save changes</button></div></form></article><article class="panel runtime-panel"><span class="eyebrow">RUNTIME STATUS</span><h2>${esc(state.bootstrap?.runtime?.status || "Unknown")}</h2><div class="runtime-row"><span>API endpoint</span><code>127.0.0.1:${esc(settings.apiPort || "3100")}</code></div><div class="runtime-row"><span>Workspace</span><code>${esc(settings.workspace || "Local")}</code></div><div class="runtime-row"><span>Provider</span><code>${esc(settings.provider || "Unknown")}</code></div><p>Desktop sessions and conversation history are private to this installed desktop client. Browser chat remains a separate surface.</p></article></section>`;
  }

  function render() {
    const views = { Overview: overview, Agents: agentsPage, Tasks: tasksPage, Memory: memoryPage, Tools: toolsPage, Evaluations: evaluationsPage, Settings: settingsPage };
    root.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.page === state.page));
    main().innerHTML = `${state.error ? `<div class="api-error">${esc(state.error)}</div>` : ""}${views[state.page]()}`;
    bindPage();
  }

  async function refresh() {
    try {
      const [bootstrap, agents, tasks, memory, graph, tools, evaluations, settings] = await Promise.all([api("/api/desktop/bootstrap"), api("/api/agents"), api("/api/tasks"), api("/api/memory?limit=100"), api("/api/memory/graph"), api("/api/tools"), api("/api/evaluations"), api("/api/settings")]);
      state.bootstrap = bootstrap;
      state.agents = agents.agents || [];
      state.tasks = tasks.tasks || [];
      state.workflows = tasks.workflows || [];
      state.memory = memory.records || [];
      state.bootstrap.memory = memory;
      state.graph = graph;
      state.tools = tools.tools || [];
      state.evaluations = evaluations;
      state.settings = settings.settings || {};
      state.error = "";
      state.loading = false;
      const label = document.getElementById("system-label");
      const detail = document.getElementById("system-detail");
      if (label) label.textContent = "SYSTEM OPERATIONAL";
      if (detail) detail.textContent = `${state.agents.filter(agent => agent.status === "running").length} subagent runs active`;
    } catch (error) {
      state.error = error.message || "Could not load local NTOX runtime data.";
      const label = document.getElementById("system-label");
      const detail = document.getElementById("system-detail");
      if (label) label.textContent = "RUNTIME UNAVAILABLE";
      if (detail) detail.textContent = "Start or configure the local API";
    }
    render();
  }

  function bindPage() {
    main().querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => go(button.dataset.go)));
    const search = document.getElementById("agent-search");
    if (search) search.addEventListener("input", () => main().querySelectorAll("#agent-rows tr").forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(search.value.toLowerCase()); }));
    const workflowForm = document.getElementById("workflow-form");
    if (workflowForm) workflowForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(workflowForm);
      const goal = String(form.get("goal") || "").trim();
      const subtasks = String(form.get("subtasks") || "").split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      const message = document.getElementById("workflow-message");
      const button = workflowForm.querySelector("button[type=submit]");
      button.disabled = true;
      message.textContent = "Starting isolated NTOX agents…";
      try {
        const result = await api("/api/tasks", "POST", { goal, ...(subtasks.length ? { subtasks } : {}) });
        message.textContent = `Workflow ${result.workflow.id} started.`;
        workflowForm.reset();
        await refresh();
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; }
    });
    const settingsForm = document.getElementById("settings-form");
    if (settingsForm) settingsForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(settingsForm);
      const message = document.getElementById("settings-message");
      try {
        await api("/api/settings", "PATCH", { provider: form.get("provider"), model: form.get("model"), temperature: Number(form.get("temperature")), maxTokens: Number(form.get("maxTokens")), memoryEnabled: settingsForm.elements.memoryEnabled.checked });
        message.textContent = "Settings saved to NTOX configuration.";
        await refresh();
      } catch (error) { message.textContent = error.message; }
    });
  }

  function go(page) { state.page = page; render(); root.querySelector(".console-sidebar").classList.remove("open"); }
  root.addEventListener("click", event => {
    const navButton = event.target.closest("[data-page]");
    if (navButton) go(navButton.dataset.page);
    if (event.target.closest("[data-open-chat]")) { root.classList.add("chat-mode"); chatApp.classList.add("chat-visible"); document.querySelector(".back-to-console").classList.add("visible"); }
    if (event.target.closest(".console-mobile-menu")) root.querySelector(".console-sidebar").classList.toggle("open");
  });
  document.querySelectorAll("[data-back-console]").forEach(button => button.addEventListener("click", () => { root.classList.remove("chat-mode"); chatApp.classList.remove("chat-visible"); document.querySelector(".back-to-console").classList.remove("visible"); }));
  const clock = document.getElementById("console-clock");
  const updateClock = () => { clock.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date()); };
  updateClock();
  setInterval(updateClock, 30000);
  void refresh();
  setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
})();
