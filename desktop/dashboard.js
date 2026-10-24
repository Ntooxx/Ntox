(() => {
  const root = document.getElementById("ntox-console");
  const chatApp = document.getElementById("desktop-chat");
  if (!root || !chatApp) return;

  const iconPaths = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', overview: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', agents: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', tasks: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 2.5 2.5L16 9"/>', memory: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>', tools: '<path d="m14.7 6.3 3 3M4 20l8.8-8.8M15 5a4 4 0 0 0 5 5l-4 4-5-5 4-4ZM3 21l4-4"/>', evaluations: '<path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4a7 7 0 0 1-.1 1.8Z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', chat: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8 8 0 0 1-3.4-.7L4 20l1.4-4.1A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z"/><path d="M8 12h8M8 9h5"/>'
  };
  const glyphMotion = globalThis.NTOXGlyphMotion;
  const icon = (name, size = 18) => glyphMotion?.icon(name, size) || `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.overview}</svg>`;
  const agentGlyph = agent => {
    const identity = `${agent.role || ""} ${agent.name || ""}`.toLowerCase();
    if (/research/.test(identity)) return "research";
    if (/content|writ/.test(identity)) return "content";
    if (/outreach|communication/.test(identity)) return "outreach";
    if (/analy/.test(identity)) return "analysis";
    if (/coordinator|primary/.test(identity)) return "multi-agent";
    return "agent-detail";
  };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const nav = ["Overview", "Agents", "Tasks", "Memory", "Tools", "Evaluations", "Settings"];
  const state = { page: "Overview", bootstrap: null, agents: [], tasks: [], workflows: [], memory: [], graph: { nodes: [], links: [] }, tools: [], evaluations: { runs: [], suites: [] }, settings: {}, providers: [], credentials: [], secretStore: null, credentialMessage: "", formDrafts: {}, memoryGraphMessage: "", loading: true, loaded: new Set(), errors: {}, lastUpdated: null, agentQuery: "", agentStatus: "all", agentRole: "all", taskQuery: "", taskStatus: "all", selectedTask: "", composerOpen: false, evaluationGroup: "", memoryQuery: "", memoryVisible: 30, selectedMemory: "", toolQuery: "", toolCategory: "all", settingsMessage: "", permissionMessage: "", workflowMessage: "", permissions: null, permissionsLoading: false, notifications: [] };
  let renderedSignature = "";
  let graphFrame = 0;
  let graphObserver = null;
  let graphVisibilityObserver = null;
  let graphVisibilityHandler = null;
  let graphMotionQuery = null;
  let graphMotionHandler = null;
  let renderFrame = 0;
  let renderedPage = "";
  let enteringTimer = 0;
  root.innerHTML = `<header class="console-top"><a class="console-brand" href="#home" data-launch-home aria-label="Return to NTOX welcome"><span>NTOX<sup>®</sup></span><small>cognitive agent runtime</small></a><div class="system-state" role="status" aria-live="polite"><i></i><span><b id="system-label">CONNECTING</b><small id="system-detail">Loading local runtime data</small></span></div><div class="console-time"><span id="console-clock"></span><small>local desktop runtime</small></div><button class="console-mobile-menu" aria-label="Open navigation" aria-expanded="false">${icon("menu")}</button></header><aside class="console-sidebar"><nav aria-label="Main navigation">${nav.map(page => `<button class="nav-item ${page === state.page ? "active" : ""}" data-page="${page}" aria-current="${page === state.page ? "page" : "false"}">${icon(page.toLowerCase())}<span>${page}</span></button>`).join("")}</nav><div class="sidebar-motto">HIGHER<br>INTELLIGENCE<br>THROUGH<br>COMPOUND AGENTS.</div><button class="chat-nav" data-open-chat aria-label="Open dedicated desktop chat">${icon("chat")}<span>Open desktop chat</span><kbd>↗</kbd></button></aside><main class="console-main" id="console-main" aria-live="off"></main>`;
  root.classList.add("landing-mode");
  root.insertAdjacentHTML("afterbegin", `<section class="launch-screen" aria-label="NTOX welcome"><canvas id="gl" class="launch-landscape" aria-hidden="true"></canvas><div class="launch-grain" aria-hidden="true"></div><header class="launch-top"><a class="launch-brand" href="#home" aria-label="NTOX home">NTOX<span>®</span></a><span class="launch-runtime"><i></i> LOCAL COGNITIVE RUNTIME</span></header><div class="launch-copy"><span class="launch-eyebrow">A NEW KIND OF INTELLIGENCE</span><h1>NTOX</h1><p class="launch-subtitle">AI&nbsp; AGENTS</p><span class="launch-rule"></span><p class="launch-tagline">Intelligence that works.</p></div><div class="launch-bottom"><span class="launch-caption">RESEARCH&nbsp; / &nbsp;OPERATIONS&nbsp; / &nbsp;CODE</span><div class="launch-actions"><button class="launch-enter" data-launch-dashboard>Open agents dashboard <span aria-hidden="true">↗</span></button><button class="launch-chat" data-launch-chat>Start a conversation</button></div><span class="launch-version">LOCAL RUNTIME&nbsp; · &nbsp;YOUR CHOICE OF PROVIDER</span></div></section>`);

  const main = () => document.getElementById("console-main");
  const api = (route, method = "GET", body) => window.ntoxDesktop.request({ route, method, body });
  const header = (eyebrow, title, description, aside = "") => {
    const overview = state.page === "Overview";
    return `<section class="page-hero ${overview ? "overview-hero" : "glyph-hero"}" data-section="${state.page.toLowerCase()}"><div class="hero-copy"><div class="eyebrow">${eyebrow}</div><h1 tabindex="-1">${title}</h1><p>${description}</p>${aside && !overview ? `<div class="hero-actions">${aside}</div>` : ""}</div>${overview ? '<div class="hero-art" aria-hidden="true"></div>' : glyphMotion?.markup(state.page.toLowerCase()) || ""}${overview && aside ? `<div class="hero-aside">${aside}</div>` : ""}</section>`;
  };
  const metric = (label, value, note, symbol = "memory", resourceOverride) => { const labelUpper = label.toUpperCase(); const resource = labelUpper.includes("AGENT") || labelUpper.includes("RUNS") ? "agents" : labelUpper.includes("TASK") || labelUpper.includes("WORKFLOW") || labelUpper.includes("PARALLEL") ? "tasks" : labelUpper.includes("MEMORY") ? "memory" : labelUpper.includes("TOOL") || labelUpper.includes("ORCHESTRATION") ? "tools" : labelUpper.includes("EVALUATION") || labelUpper.includes("SUITE") ? "evaluations" : "runtime"; return `<article class="metric-card"><div class="metric-label">${icon(symbol, 20)}<span>${label}</span></div><div class="metric-value">${state.loaded.has(resourceOverride || resource) ? esc(value) : "—"}</div><p>${esc(note)}</p></article>`; };
  const status = value => `<span class="status ${esc(String(value || "unknown").toLowerCase())}"><i></i>${esc(value || "Unknown")}</span>`;
  const empty = text => `<div class="empty-state">${esc(text)}</div>`;


  const shortText = (value, length = 100) => { const text = String(value || ""); return esc(text.length > length ? text.slice(0, length - 1) + "…" : text); };
  const dateLabel = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const elapsed = task => { if (!task.startedAt || !task.completedAt) return task.status === "running" ? "In progress" : "—"; const seconds = Math.max(0, Math.round((new Date(task.completedAt) - new Date(task.startedAt)) / 1000)); return Number.isFinite(seconds) ? seconds >= 60 ? Math.floor(seconds / 60) + "m " + seconds % 60 + "s" : seconds + "s" : "—"; };
  const disclosure = (text, length = 110, key = "") => String(text || "").length > length ? '<details class="cell-disclosure" data-disclosure-key="' + esc(key) + '"><summary data-focus-key="disclosure:' + esc(key) + '">' + shortText(text, length) + '</summary><p>' + esc(text) + '</p></details>' : esc(text || "—");

  function notificationsPanel() {
    const items = (state.notifications || []).slice(0, 5);
    if (!items.length) return "";
    return `<section class="panel notification-panel"><div class="panel-head"><div><span class="eyebrow">NOTIFICATIONS</span><h2>${items.length} alert${items.length === 1 ? "" : "s"}${state.notifications.length > items.length ? ` · ${state.notifications.length} total` : ""}</h2></div><button class="quiet-button" data-clear-notifications>Clear</button></div><div class="notification-list">${items.map(item => `<div class="notification-item"><span>${esc(item.reason)}</span><time>${new Date(item.at).toLocaleString()}</time></div>`).join("")}</div></section>`;
  }

  function overview() {
    const runtime = state.bootstrap?.runtime || {};
    const activeAgents = state.agents.filter(agent => agent.status === "running").length;
    const runningTasks = state.tasks.filter(task => ["running", "queued"].includes(task.status)).length;
    const activeWorkflows = state.workflows.filter(workflow => ["running", "queued"].includes(workflow.status)).length;
    const recent = state.tasks.slice(0, 5);
    return `${header("NTOX / COMMAND CENTER", "Intelligence, in motion.", "A live view of your local NTOX runtime.", `<div class="hero-status"><span class="live-dot"></span><div><small>RUNTIME HEALTH</small><b data-runtime-reading="status">${esc(state.errors.runtime ? "Unavailable" : runtime.status || "Connecting")}</b><em data-runtime-reading="uptime">${runtime.uptimeSeconds ? `UP ${Math.floor(runtime.uptimeSeconds / 3600)}H ${Math.floor(runtime.uptimeSeconds % 3600 / 60)}M` : "LOCAL AGENT API"}</em></div></div>`)}${notificationsPanel()}<section class="metrics-grid">${metric("ACTIVE AGENTS", activeAgents, "Currently executing subagent runs", "agents")}${metric("PARALLEL TASKS", runningTasks, "Queued and running workflow steps", "tasks")}${metric("ACTIVE WORKFLOWS", activeWorkflows, "Persisted desktop workflows", "tools")}${metric("MEMORY RECORDS", state.bootstrap?.memory?.total ?? (state.memory.length), "Runtime memory records", "memory")}</section><section class="overview-grid"><article class="panel fleet-panel"><div class="panel-head"><div><span class="eyebrow">AGENT FLEET</span><h2>Working together</h2></div><button class="quiet-button" data-go="Agents">View fleet ${icon("arrow", 15)}</button></div><div class="fleet-list">${state.agents.length ? state.agents.slice(0, 6).map(agent => `<div class="fleet-row"><span class="agent-avatar">${icon(agentGlyph(agent), 22)}</span><div class="agent-title"><b>${esc(agent.name)}</b><small>${esc(agent.role)}</small></div>${status(agent.status)}<span class="row-activity">${esc(agent.currentTask || "Ready for work")}</span></div>`).join("") : empty(state.loaded.has("agents") ? "No agents are currently reported by the runtime." : "Agent data is not available yet.")}</div></article><article class="panel activity-panel"><div class="panel-head"><div><span class="eyebrow">RECENT WORK</span><h2>Workflow activity</h2></div><button class="quiet-button" data-go="Tasks">All tasks ${icon("arrow", 15)}</button></div>${recent.length ? `<div class="activity-list">${recent.map(task => `<div><time>${task.startedAt ? new Date(task.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</time><i class="activity-mark"></i><p><b>${esc(task.title)}</b><small>${esc(task.workflowId)} · ${esc(task.status)}</small></p></div>`).join("")}</div>` : empty(state.loaded.has("tasks") ? "No desktop workflows yet. Create one in Tasks." : "Task data is not available yet.")}</article><article class="panel runtime-panel"><span class="eyebrow">LOCAL RUNTIME</span><h2>Machine status</h2><div class="runtime-row"><span>CPU cores</span><b data-runtime-reading="cpu">${esc(runtime.cpuCount ?? "Not reported")}</b></div><div class="runtime-row"><span>System memory</span><b data-runtime-reading="memory">${runtime.memoryTotalBytes ? runtime.memoryFreeBytes != null ? `${(runtime.memoryFreeBytes / 1024 ** 3).toFixed(1)} / ${(runtime.memoryTotalBytes / 1024 ** 3).toFixed(1)} GB free` : `${(runtime.memoryTotalBytes / 1024 ** 3).toFixed(1)} GB total · free amount unavailable` : "Not reported"}</b></div><div class="runtime-row"><span>Saved model</span><b>${esc(state.bootstrap?.config?.model || "Not reported")}</b></div></article></section>`;
  }

  function agentsPage() {
    const query = state.agentQuery.toLowerCase();
    const agents = state.agents.filter(agent => (!query || `${agent.name} ${agent.id} ${agent.role} ${agent.currentTask || ""}`.toLowerCase().includes(query)) && (state.agentStatus === "all" || String(agent.status).toLowerCase() === state.agentStatus) && (state.agentRole === "all" || agent.role === state.agentRole));
    const statuses = [...new Set(state.agents.map(agent => String(agent.status || "unknown").toLowerCase()))];
    const roles = [...new Set(state.agents.map(agent => agent.role).filter(Boolean))];
    const running = state.agents.filter(agent => agent.status === "running").length;
    const rows = agents.map(agent => `<tr><td><div class="fleet-identity"><span class="agent-avatar">${icon(agentGlyph(agent), 24)}</span><span><b>${esc(agent.name)}</b><small title="${esc(agent.id)}">${shortText(agent.id, 28)}</small></span></div></td><td>${status(agent.status)}</td><td>${esc(agent.role || "Not reported")}</td><td>${disclosure(agent.currentTask || "No task assigned", 110, `agent:${agent.id}:task`)}</td><td class="cell-time">${dateLabel(agent.startedAt)}</td><td>${Array.isArray(agent.tools) ? disclosure(agent.tools.join(", "), 45, `agent:${agent.id}:tools`) : "Not reported"}</td></tr>`).join("");
    return `${header("AGENTS", "Manage your<br>intelligent agent fleet.", "Monitor, configure, and coordinate autonomous agents<br class=wide-break> that perceive, reason, act and learn.")}<section class="metrics-grid">${metric("ACTIVE AGENTS", running + " / " + state.agents.length, "Running / reported agent records", "agents")}${metric("WORKFLOW TASKS", state.tasks.filter(task => ["running", "queued"].includes(task.status)).length, "Running and queued across workflows", "tasks")}${metric("AVAILABLE TOOLS", state.tools.length, "Registered runtime capabilities", "tools")}${metric("CONCURRENCY LIMIT", 3, "Maximum parallel subagent workers", "overview", "runtime")}</section><section class="panel table-panel agent-fleet"><div class="table-toolbar"><span class="eyebrow">AGENT FLEET</span><label class="search-field">${icon("search", 15)}<input id="agent-search" aria-label="Search agents" value="${esc(state.agentQuery)}" placeholder="Search agents..."></label><div class="toolbar-controls"><select id="agent-status-filter" aria-label="Filter agents by status"><option value="all">All statuses</option>${statuses.map(value => `<option value="${esc(value)}" ${state.agentStatus === value ? "selected" : ""}>${esc(value.replaceAll("_", " "))}</option>`).join("")}</select><select id="agent-role-filter" aria-label="Filter agents by role"><option value="all">All roles</option>${roles.map(role => `<option value="${esc(role)}" ${state.agentRole === role ? "selected" : ""}>${esc(role)}</option>`).join("")}</select><button class="primary-button" data-go="Tasks" data-new-workflow>${icon("plus", 16)} Create workflow</button></div></div><div class="table-scroll"><table><thead><tr><th>AGENT</th><th>STATUS</th><th>ROLE</th><th>CURRENT TASK</th><th>STARTED</th><th>TOOLS</th></tr></thead><tbody id="agent-rows">${rows || `<tr><td colspan="6">${empty(state.agents.length ? "No agents match these filters. Clear the search or choose another status." : "No NTOX subagent runs have been recorded.")}</td></tr>`}</tbody></table></div><footer class="panel-footer"><span>${agents.length} of ${state.agents.length} reported agents</span><span>Coordinator and persisted subagent runs</span></footer></section>`;
  }

  function tasksPage() {
    const counts = value => state.tasks.filter(task => value === "completed" ? ["completed", "succeeded"].includes(task.status) : value === "failed" ? ["failed", "timed_out"].includes(task.status) : task.status === value).length;
    const failed = state.tasks.filter(task => ["failed", "timed_out"].includes(task.status)).length;
    const tasks = state.tasks.filter(task => (state.taskStatus === "all" || task.status === state.taskStatus) && `${task.title} ${task.id} ${task.workflowId}`.toLowerCase().includes(state.taskQuery.toLowerCase()));
    const selected = tasks.find(task => task.id === state.selectedTask) || tasks[0];
    const actionShown = new Set();
    const rows = tasks.map(task => {
      const canCancel = ["running", "queued"].includes(task.status);
      const canRetry = ["failed", "timed_out", "cancelled"].includes(task.status);
      const showAction = task.workflowId && !actionShown.has(task.workflowId) && (canCancel || canRetry);
      if (showAction) actionShown.add(task.workflowId);
      return `<tr class="${selected?.id === task.id ? "selected-row" : ""}"><td><button id="task-${esc(task.id)}" class="task-select" data-task-select="${esc(task.id)}" aria-pressed="${selected?.id === task.id}">${icon("tasks", 17)}<span><b>${shortText(task.title, 72)}</b><small>${esc(task.id)}</small></span></button></td><td>${shortText(task.workflowId, 25)}</td><td>${status(task.status)}</td><td>${elapsed(task)}</td><td>${showAction ? `<button class="row-action" data-workflow-action="${canCancel ? "cancel" : "retry"}" data-workflow="${esc(task.workflowId)}">${canCancel ? "Cancel workflow" : "Retry workflow"}</button>` : "—"}</td></tr>`;
    }).join("");
    const detail = selected ? `<div class="panel-head"><span class="eyebrow">TASK DETAILS</span>${status(selected.status)}</div><div class="selected-task-title"><span class="task-identity-glyph">${icon(selected.status === "running" ? "running" : "tasks", 30)}</span><div><small>${esc(selected.id)}</small><h2>${esc(selected.title)}</h2><p>${esc(selected.workflowId)}</p></div></div><dl class="detail-facts"><div><dt>Agent</dt><dd>${esc(state.agents.find(agent => agent.id === selected.runId)?.name || selected.runId || "Not assigned")}</dd></div><div><dt>Started</dt><dd>${dateLabel(selected.startedAt)}</dd></div><div><dt>Completed</dt><dd>${dateLabel(selected.completedAt)}</dd></div><div><dt>Duration</dt><dd>${elapsed(selected)}</dd></div></dl><div class="task-output"><span class="eyebrow">${selected.error ? "ERROR" : "RESULT"}</span><p>${esc(selected.error || selected.result || (selected.status === "running" ? "The agent is working. Its result will appear here when reported." : "No result has been reported."))}</p></div>` : empty("Select a task to inspect its execution and result.");
    return `${header("TASKS", "Orchestrate, monitor,<br>and scale agent workflows.", "Track execution across agents and keep complex work moving forward.", `<button class="primary-button" data-compose-workflow>${icon("plus", 16)} New workflow</button>`)}<section class="metrics-grid">${metric("COMPLETED TASKS", counts("completed"), "Results recorded by the runtime", "tasks")}${metric("RUNNING TASKS", counts("running"), "Currently executing", "overview")}${metric("QUEUED TASKS", counts("queued"), "Waiting to execute", "tasks")}${metric("FAILED TASKS", failed, "Failed or timed out", "evaluations", "tasks")}</section><section class="task-workspace"><article class="panel table-panel task-ledger"><div class="table-toolbar"><span class="eyebrow">TASK QUEUE</span><div class="toolbar-controls"><label class="search-field">${icon("search", 15)}<input id="task-search" aria-label="Search tasks" value="${esc(state.taskQuery)}" placeholder="Search tasks..."></label><select id="task-status-filter" aria-label="Filter tasks by status"><option value="all">All statuses</option>${[...new Set(state.tasks.map(task => task.status))].map(value => `<option value="${esc(value)}" ${state.taskStatus === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></div></div><div class="table-scroll"><table><thead><tr><th>TASK</th><th>WORKFLOW</th><th>STATUS</th><th>DURATION</th><th>ACTION</th></tr></thead><tbody>${rows || `<tr><td colspan="5">${empty(state.tasks.length ? "No tasks match these filters." : "Your queue is clear. Create a workflow to give your agents a goal.")}</td></tr>`}</tbody></table></div><footer class="panel-footer">${tasks.length} tasks shown · Cancel and retry affect the whole workflow.</footer></article><aside class="panel task-inspector">${detail}</aside></section><details class="panel workflow-composer" id="workflow-composer" ${state.composerOpen ? "open" : ""}><summary data-focus-key="workflow-composer-toggle"><span>${icon("create-agent", 24)} Create a workflow</span><small>Give your agents a goal</small></summary><section class="task-create"><form id="workflow-form"><label>Overall goal<textarea id="workflow-goal" name="goal" required maxlength="10000" placeholder="Describe the outcome you want..."></textarea></label><label>Parallel subtask prompts <small>Optional. Add one prompt per line, up to three. Leave blank to run one agent on the full goal.</small><textarea id="workflow-subtasks" name="subtasks" maxlength="30000" placeholder="Research the key facts...&#10;Compare the available approaches...&#10;Identify risks and tradeoffs..."></textarea></label><label>Execution mode<select name="mode"><option value="research">Research only — read, search, browse</option><option value="execute">Execute — full tools: shell, file writes, process control</option></select><small>Research describes what to do. Execute lets the agent actually do it. The workspace policy still applies in both modes.</small></label><div class="form-actions"><span id="workflow-message" role="status">${esc(state.workflowMessage || "Pick Research for read-only agents, or Execute when you want the work done for you.")}</span><button class="primary-button" type="submit">${icon("plus", 16)} Start workflow</button></div></form></section></details>`;
  }

  function memoryPage() {
    const nodes = state.graph.nodes.slice(0, 220);
    const visibleIds = new Set(nodes.map(node => String(node.id)));
    const visibleLinkCount = state.graph.links.slice(0, 480).filter(link => visibleIds.has(String(link.source)) && visibleIds.has(String(link.target)) && String(link.source) !== String(link.target)).length;
    const writes = state.memory.slice(0, 8).map(item => `<div class="memory-write"><time>${new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>${icon("memory", 16)}<p>${esc(item.text)}<small>${esc(item.source)}</small></p><span>${esc(item.type)}</span>${item.type !== "episodic" ? `<div class="memory-record-actions"><button class="row-action" data-memory-action="edit" data-memory="${esc(item.id)}">Edit</button><button class="row-action" data-memory-action="delete" data-memory="${esc(item.id)}">Delete</button></div>` : ""}</div>`).join("");
    const filtered = state.memory.filter(item => `${item.text} ${item.type} ${item.source} ${item.id}`.toLowerCase().includes(state.memoryQuery.toLowerCase()));
    const selected = filtered.find(item => String(item.id) === state.selectedMemory) || filtered[0];
    const types = [...new Set(state.memory.map(item => item.type))].map(type => ({ type, count: state.memory.filter(item => item.type === type).length }));
    const shades = ["#f4f4f4", "#b8b8b8", "#888888", "#616161", "#454545"];
    let offset = 0;
    const segments = types.map((item, index) => { const start = offset; offset += item.count / state.memory.length * 100; return shades[index % shades.length] + " " + start + "% " + offset + "%"; });
    const typeCounts = types.map((item, index) => `<li><span><i style="background:${shades[index % shades.length]}"></i>${esc(item.type)}</span><b>${item.count}</b></li>`).join("");
    const recordList = filtered.slice(0, state.memoryVisible).map(item => `<button class="memory-record ${selected && item.id === selected.id ? "selected" : ""}" aria-pressed="${selected && item.id === selected.id ? "true" : "false"}" data-memory-select="${esc(item.id)}"><b>${esc(String(item.text || "Untitled memory").slice(0, 96))}</b><small>${esc(item.type)} · ${esc(item.source || "Source unavailable")}</small></button>`).join("");
    const detail = selected ? `<div class="memory-record-detail"><span class="eyebrow">SELECTED RECORD</span><h3>${esc(selected.type)}</h3><p>${esc(selected.text || "No text content")}</p><dl><div><dt>Source</dt><dd>${esc(selected.source || "Not reported")}</dd></div><div><dt>Created</dt><dd>${selected.createdAt ? esc(new Date(selected.createdAt).toLocaleString()) : "Not reported"}</dd></div><div><dt>Record ID</dt><dd>${esc(selected.id)}</dd></div></dl></div>` : empty("Select a memory record to inspect its content and provenance.");
    return `${header("MEMORY", "Memory", "A unified, persistent memory system for autonomous agents.<br>Capture, organize, and retrieve knowledge across your runtime.")}<section class="memory-layout"><article class="panel graph-panel"><div class="panel-head"><div><span class="eyebrow">MEMORY GRAPH</span><h2>Shared provenance map</h2></div><span class="graph-count"><b>${state.graph.total ?? nodes.length}</b> total · ${nodes.length} shown <i></i> ${visibleLinkCount} drawn source links</span></div><p class="graph-description">Each point is a loaded record. Lines indicate shared source or session provenance, not semantic similarity.</p><div class="graph-key">${[...new Set(nodes.map(node => String(node.type || "episodic")))].map(type => `<span data-type="${esc(type)}"><i></i>${esc(type)}</span>`).join("") }</div>${nodes.length ? `<canvas class="memory-canvas" aria-hidden="true"></canvas><div class="graph-tooltip" aria-hidden="true"></div><div class="graph-hint" role="status" aria-live="polite">${esc(state.memoryGraphMessage || `SELECT A RECORD BELOW OR CLICK A NODE | ${nodes.length} GRAPH NODES`)}</div>` : empty("No graph nodes were reported. Inspect loaded records below.")}</article><div class="memory-side"><article class="panel memory-stat"><span class="eyebrow">MEMORY SYSTEM</span><b>${state.bootstrap?.config?.memoryEnabled ? "Enabled" : "Disabled"}</b><p>Configured runtime memory</p></article><article class="panel memory-stat"><span class="eyebrow">TOTAL RECORDS</span><b>${state.graph.total ?? state.memory.length}</b><p>${state.memory.length} recent records loaded from all stores</p></article><article class="panel memory-stat"><span class="eyebrow">MEMORY SIZE</span><b>${state.bootstrap?.memory?.stats?.memorySizeBytes ? `${(state.bootstrap.memory.stats.memorySizeBytes / 1024).toFixed(1)} KB` : "—"}</b><p>Stored episode data</p></article></div><article class="panel memory-record-browser"><div class="panel-head"><div><span class="eyebrow">RECORD EXPLORER</span><h2>Search and inspect</h2><small class="sample-note">${filtered.length} matching loaded records · showing ${Math.min(filtered.length, state.memoryVisible)}</small></div><label class="search-field">${icon("search", 15)}<input id="memory-search" aria-label="Search memory records" value="${esc(state.memoryQuery)}" placeholder="Search loaded records"></label></div><div class="memory-browser-grid"><div class="memory-record-list" role="group" aria-label="Loaded memory records">${recordList}${filtered.length > state.memoryVisible ? `<button class="row-action" data-memory-more>Show next ${Math.min(30, filtered.length - state.memoryVisible)} records (${state.memoryVisible} of ${filtered.length})</button>` : ""}${!recordList ? empty(state.memoryQuery ? "No loaded records match this search." : "No memory records loaded.") : ""}</div>${detail}</div></article><article class="panel recent-writes"><div class="panel-head"><div><span class="eyebrow">RECENT RECORDS</span><h2>Latest writes</h2></div></div>${writes || empty("No records to show.")}</article><article class="panel distribution"><div class="panel-head"><div><span class="eyebrow">LOADED MEMORY TYPES</span><h2>Recent sample</h2></div></div><p class="sample-note">Counts describe the ${state.memory.length} records currently loaded, not the full store.</p>${state.memory.length ? `<div class="distribution-body"><div class="sample-ring" style="background:conic-gradient(${segments.join(",")})"><b>${state.memory.length}<small>loaded records</small></b></div><ul class="memory-type-list">${typeCounts}</ul></div>` : empty("No memory records.")}</article></section>`;
  }

  function mountMemoryGraph() {
    const canvas = main().querySelector(".memory-canvas");
    if (!canvas) return;
    const panel = canvas.closest(".graph-panel");
    const tooltip = panel.querySelector(".graph-tooltip");
    const nodes = state.graph.nodes.slice(0, 220);
    const palette = { episodic: [245, 245, 245], semantic: [198, 198, 198], procedural: [160, 160, 160], user: [135, 135, 135], external: [110, 110, 110], fact: [198, 198, 198], note: [160, 160, 160] };
    const hash = value => { let n = 2166136261; for (const char of String(value)) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return n >>> 0; };
    const groupOf = node => String(node.source || node.sessionId || node.type || "other");
    const groupCounts = new Map();
    nodes.forEach(node => groupCounts.set(groupOf(node), (groupCounts.get(groupOf(node)) || 0) + 1));
    const groups = [...groupCounts.keys()].sort((a, b) => groupCounts.get(b) - groupCounts.get(a));
    const points = nodes.map((node, index) => {
      const seed = hash(node.id || `${node.type}-${index}`);
      const randomA = seed / 4294967295;
      const randomB = (Math.imul(seed, 48271) >>> 0) / 4294967295;
      const type = String(node.type || "episodic").toLowerCase();
      const randomC = (Math.imul(seed, 69621) >>> 0) / 4294967295;
      const group = groups.indexOf(String(node.source || node.sessionId || node.type || "other"));
      const angle = (group - 1) / Math.max(1, groups.length - 1) * Math.PI * 2 + .6;
      const centerX = group ? .5 + Math.cos(angle) * .36 : .5;
      const centerY = group ? .5 + Math.sin(angle) * .34 : .5;
      const share = groupCounts.get(groups[group]) / nodes.length;
      const spread = group ? Math.max(.045, Math.sqrt(share) * .24) : Math.max(.18, Math.sqrt(share) * .36);
      const radius = Math.sqrt(randomA) * spread;
      return { node, id: String(node.id), type, color: palette[type] || palette.episodic, x: centerX + Math.cos(randomC * Math.PI * 2) * radius, y: centerY + Math.sin(randomC * Math.PI * 2) * radius, phase: randomB * Math.PI * 2, radius: 1.1 + (seed % 9) / 10 };
    });
    const pointById = new Map(points.map((point, index) => [point.id, index]));
    const links = state.graph.links.slice(0, 480).map(link => ({ a: pointById.get(String(link.source)), b: pointById.get(String(link.target)), phase: hash(`${link.source}-${link.target}`) / 4294967295 })).filter(link => Number.isInteger(link.a) && Number.isInteger(link.b) && link.a !== link.b);
    const degrees = new Map();
    links.forEach(link => { degrees.set(link.a, (degrees.get(link.a) || 0) + 1); degrees.set(link.b, (degrees.get(link.b) || 0) + 1); });
    points.forEach((point, index) => { point.radius += Math.min(2.8, Math.sqrt(degrees.get(index) || 0) * .18); });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    graphMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = graphMotionQuery.matches;
    let width = 0;
    let height = 0;
    let hovered = -1;
    let lastFrame = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      cancelAnimationFrame(graphFrame);
      graphFrame = 0;
      lastFrame = 0;
      draw(performance.now());
    };
    const draw = time => {
      graphFrame = 0;
      if (!reducedMotion && time - lastFrame < 33) { graphFrame = requestAnimationFrame(draw); return; }
      lastFrame = time;
      ctx.clearRect(0, 0, width, height);
      links.forEach(link => {
        const a = points[link.a], b = points[link.b];
        const ax = (a.x + (reducedMotion ? 0 : Math.sin(time * .00018 + a.phase) * .002)) * width;
        const ay = (a.y + (reducedMotion ? 0 : Math.cos(time * .00016 + a.phase) * .003)) * height;
        const bx = (b.x + (reducedMotion ? 0 : Math.sin(time * .00018 + b.phase) * .002)) * width;
        const by = (b.y + (reducedMotion ? 0 : Math.cos(time * .00016 + b.phase) * .003)) * height;
        const active = hovered === link.a || hovered === link.b;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = active ? "rgba(240,240,240,.4)" : "rgba(200,200,200,.16)";
        ctx.lineWidth = active ? .9 : .55;
        ctx.stroke();
        if (!reducedMotion && link.phase < .23) {
          const progress = (time * .00012 + link.phase) % 1;
          ctx.beginPath();
          ctx.arc(ax + (bx - ax) * progress, ay + (by - ay) * progress, active ? 1.5 : 1, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(245,245,245,.74)";
          ctx.fill();
        }
      });
      points.forEach((point, index) => {
        const x = point.x * width + (reducedMotion ? 0 : Math.sin(time * .00018 + point.phase) * 2.2);
        const y = point.y * height + (reducedMotion ? 0 : Math.cos(time * .00016 + point.phase) * 2.6);
        const active = hovered === index;
        const [r, g, b] = point.color;
        const radius = point.radius + (active ? 1.7 : 0);
        if (point.radius > 1.7 || active) {
          ctx.beginPath();
          ctx.arc(x, y, radius * (active ? 4.5 : 3.1), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${active ? .17 : .075})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${active ? 1 : .78})`;
        ctx.fill();
      });
      const rect = panel.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < innerHeight && !document.hidden;
      if (!reducedMotion && visible) graphFrame = requestAnimationFrame(draw);
    };
    const nearestPoint = (x, y) => {
      let nearest = -1, distance = 18;
      points.forEach((point, index) => {
        const next = Math.hypot(point.x * width - x, point.y * height - y);
        if (next < distance) { distance = next; nearest = index; }
      });
      return nearest;
    };
    const locate = event => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const nearest = nearestPoint(x, y);
      hovered = nearest;
      if (nearest < 0) {
        tooltip.classList.remove("visible");
        canvas.style.cursor = "default";
        if (reducedMotion) draw(0);
        return;
      }
      const point = points[nearest];
      const text = String(point.node.text || point.node.label || point.node.source || point.id);
      tooltip.textContent = text.length > 150 ? `${text.slice(0, 147)}...` : text;
      tooltip.style.left = `${Math.min(Math.max(18, x + 14), Math.max(18, width - 230))}px`;
      tooltip.style.top = `${Math.max(12, y - 38)}px`;
      tooltip.classList.add("visible");
      canvas.style.cursor = "crosshair";
      if (reducedMotion) draw(0);
    };
    canvas.addEventListener("pointermove", locate);
    canvas.addEventListener("click", event => {
      const rect = canvas.getBoundingClientRect();
      const nearest = nearestPoint(event.clientX - rect.left, event.clientY - rect.top);
      if (nearest < 0) return;
      const id = points[nearest].id;
      const index = state.memory.findIndex(record => String(record.id) === id);
      if (index < 0) {
        state.memoryGraphMessage = "This graph record is outside the recent records currently loaded.";
        render();
        return;
      }
      state.memoryGraphMessage = `Selected record ${id}. Opening it in the recent records below.`;
      state.memoryQuery = "";
      state.memoryVisible = Math.max(state.memoryVisible, Math.ceil((index + 1) / 30) * 30);
      state.selectedMemory = id;
      render();
      requestAnimationFrame(() => {
        const record = main().querySelector(`[data-memory-select="${CSS.escape(id)}"]`);
        record?.scrollIntoView({ block: "center", behavior: "smooth" });
        record?.focus({ preventScroll: true });
      });
    });
    canvas.addEventListener("pointerleave", () => { hovered = -1; tooltip.classList.remove("visible"); canvas.style.cursor = "default"; if (reducedMotion) draw(0); });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    graphObserver = resizeObserver;
    graphVisibilityObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || document.hidden) { cancelAnimationFrame(graphFrame); graphFrame = 0; }
      else if (!reducedMotion && !graphFrame) graphFrame = requestAnimationFrame(draw);
    }, { threshold: .05 });
    graphVisibilityObserver.observe(panel);
    if (graphVisibilityHandler) document.removeEventListener("visibilitychange", graphVisibilityHandler);
    graphVisibilityHandler = () => {
      if (document.hidden) { cancelAnimationFrame(graphFrame); graphFrame = 0; }
      else if (!reducedMotion && !graphFrame && panel.getBoundingClientRect().bottom > 0 && panel.getBoundingClientRect().top < innerHeight) graphFrame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", graphVisibilityHandler);
    graphMotionHandler = event => {
      reducedMotion = event.matches;
      if (reducedMotion) { cancelAnimationFrame(graphFrame); graphFrame = 0; draw(0); }
      else if (!document.hidden && panel.getBoundingClientRect().bottom > 0 && panel.getBoundingClientRect().top < innerHeight && !graphFrame) graphFrame = requestAnimationFrame(draw);
    };
    graphMotionQuery.addEventListener("change", graphMotionHandler);
    resize();
  }
  function toolsPage() {
    const filtered = state.tools.filter(tool => `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(state.toolQuery.toLowerCase()) && (state.toolCategory === "all" || tool.category === state.toolCategory));
    const categories = [...new Set(state.tools.map(tool => tool.category).filter(Boolean))];
    const cards = filtered.map(tool => `<article class="tool-card"><span class="tool-icon">${icon(/web|search/i.test(tool.category || "") ? "research" : /memory/i.test(tool.category || "") ? "memory" : /agent/i.test(tool.category || "") ? "multi-agent" : "tools", 24)}</span><div><h3>${esc(tool.name)}</h3><p>${esc(tool.description || "No description provided by the runtime.")}</p></div><div class="tool-card-foot"><span>${esc(tool.category || "Uncategorized")}</span><span class="status ${tool.enabled ? "running" : "idle"}"><i></i>${tool.enabled ? "Registered" : "Disabled"}</span><small>${tool.requiresApproval ? "Approval may be required by policy" : "Runtime policy applies"}</small></div></article>`).join("");
    return `${header("TOOLS", "Capabilities at hand.", "Tools reported by your local NTOX runtime. Registration does not mean every agent can use a tool; runtime policy still applies.")}<section class="metrics-grid">${metric("REGISTERED TOOLS", state.tools.length, "Listed in the current runtime registry", "tools")}${metric("POLICY GATED", state.tools.filter(tool => tool.requiresApproval).length, "May require runtime approval", "evaluations")}${metric("ORCHESTRATION", state.tools.some(tool => tool.name === "subagent") ? "Enabled" : "Unavailable", "Subagent tool registration", "agents")}</section><section class="panel tool-catalog"><div class="table-toolbar"><div><span class="eyebrow">TOOL CATALOG</span><h2>Registered capabilities</h2></div><div class="toolbar-controls"><label class="search-field">${icon("search", 15)}<input id="tool-search" aria-label="Search tools" value="${esc(state.toolQuery)}" placeholder="Search tools"></label><label class="visually-hidden" for="tool-category-filter">Filter tools by category</label><select id="tool-category-filter"><option value="all">All categories</option>${categories.map(category => `<option value="${esc(category)}" ${state.toolCategory === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></div></div><div class="tool-grid">${cards || empty(state.tools.length ? "No tools match these filters." : "No tools are registered in this runtime.")}</div></section>`;
  }

  function evaluationsPage() {
    const runs = state.evaluations.runs || [];
    const groups = [...new Set(runs.map(run => JSON.stringify([run.suite, run.agent, run.curriculum])))];
    const group = groups.includes(state.evaluationGroup) ? state.evaluationGroup : groups[0];
    const series = runs.filter(run => JSON.stringify([run.suite, run.agent, run.curriculum]) === group && Number.isFinite(Date.parse(run.completedAt)) && Number.isFinite(Number.parseFloat(run.score))).sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt)).slice(-20);
    const minTime = series.length ? Date.parse(series[0].completedAt) : 0;
    const maxTime = series.length ? Date.parse(series.at(-1).completedAt) : 0;
    const point = (run, index) => [maxTime > minTime ? 40 + (Date.parse(run.completedAt) - minTime) / (maxTime - minTime) * 660 : 370, 155 - Math.max(0, Math.min(100, Number.parseFloat(run.score))) * 1.3];
    const chart = series.length ? `<svg class="measurement-chart" viewBox="0 0 740 200" role="img" aria-label="Historical mean scores for the selected suite, experiment arm, and curriculum. Exact values are available in the history table.">${[0, 25, 50, 75, 100].map(value => `<path d="M40 ${155 - value * 1.3}H700"/><text x="10" y="${159 - value * 1.3}">${value}</text>`).join("")}${series.length > 1 ? `<polyline points="${series.map(point).map(p => p.join(",")).join(" ")}"/>` : ""}${series.map((run, index) => { const [x, y] = point(run, index); return `<circle cx="${x}" cy="${y}" r="3"><title>${esc(run.score)} · ${esc(dateLabel(run.completedAt))}</title></circle>`; }).join("")}<text x="40" y="185">${esc(dateLabel(series[0].completedAt))}</text><text x="700" y="185" text-anchor="end">${series.length > 1 ? esc(dateLabel(series.at(-1).completedAt)) : "Single measurement"}</text></svg>` : `<div class="measurement-empty">${icon("evaluations", 32)}<h3>Ready for the first measurement</h3><p>Recorded evaluations will appear here when available.</p></div>`;
    const latest = runs.find(run => Number.isFinite(Date.parse(run.completedAt)));
    return `${header("EVALUATIONS", "Verify. Measure.<br>Improve with evidence.", "Inspect recorded evaluations across your agent runtime.<br>Compare the same suite, experiment arm, and curriculum.")}<section class="metrics-grid">${metric("RECORDED EVALUATIONS", runs.length, "Loaded historical measurements", "evaluations", "evaluations")}${metric("EVALUATION SUITES", (state.evaluations.suites || []).length, "Suites with recorded results", "tools", "evaluations")}${metric("EXPERIMENT ARMS", new Set(runs.map(run => run.agent)).size, "Distinct measured configurations", "agents", "evaluations")}${metric("CURRICULA", new Set(runs.map(run => run.curriculum).filter(Boolean)).size, "Evaluation datasets represented", "memory", "evaluations")}</section><section class="measurement-layout"><article class="panel measurement-panel"><div class="panel-head"><span class="eyebrow">RECORDED SCORE HISTORY</span>${groups.length ? `<select id="evaluation-group" aria-label="Select evaluation series">${groups.map(value => { const [suite, arm, curriculum] = JSON.parse(value); return `<option value="${esc(value)}" ${group === value ? "selected" : ""}>${esc(suite)} / ${esc(arm)} / ${esc(curriculum)}</option>`; }).join("")}</select>` : `<span class="subtle-label">Awaiting records</span>`}</div>${chart}<p class="sample-note">Mean scores on a 0–100 scale. Each series keeps its suite, arm, and curriculum together.</p></article><aside class="panel evidence-panel"><span class="eyebrow">MEASUREMENT CONTEXT</span><h2>${runs.length ? "Historical evidence" : "Awaiting evidence"}</h2><p>Completed measurements from the local evaluation history.</p><dl class="detail-facts"><div><dt>Latest record</dt><dd>${dateLabel(latest?.completedAt)}</dd></div><div><dt>History loaded</dt><dd>${runs.length} records</dd></div><div><dt>Live evaluation</dt><dd>Not reported</dd></div></dl><p class="sample-note">Safety compliance and deployment health are not reported by this endpoint.</p></aside></section><section class="panel runs-panel"><div class="panel-head"><span class="eyebrow">RECENT EVALUATION RECORDS</span><span class="subtle-label">${runs.length} measurements</span></div>${runs.length ? `<div class="table-scroll"><table><thead><tr><th>RECORD</th><th>SUITE</th><th>EXPERIMENT ARM</th><th>CURRICULUM</th><th>MEAN SCORE</th><th>STATUS</th><th>GENERATED</th></tr></thead><tbody>${runs.map(run => `<tr><td>${disclosure(run.id, 28, `evaluation:${run.id}:id`)}</td><td>${disclosure(run.suite, 42, `evaluation:${run.id}:suite`)}</td><td>${esc(run.agent)}</td><td>${disclosure(run.curriculum || "Not reported", 48, `evaluation:${run.id}:curriculum`)}</td><td class="score-cell">${esc(run.score)}</td><td>${status(run.status)}</td><td class="cell-time">${dateLabel(run.completedAt)}</td></tr>`).join("")}</tbody></table></div>` : empty(state.evaluations.message || "No evaluation records are available yet.")}</section>`;
  }

  function settingsPage() {
    const settings = state.settings;
    const providers = state.providers || [];
    const credentials = state.credentials || [];
    const activeCredential = credentials.find(item => item.provider === settings.provider) || {};
    const selectedProvider = state.credentialProvider || settings.provider || "";
    const selectedCredential = credentials.find(item => item.provider === selectedProvider) || {};
    const providerOptions = providers.map(item => `<option value="${esc(item.id)}" ${item.id === selectedProvider ? "selected" : ""}>${esc(item.name)}${item.apiKeyRequired ? "" : " (no key needed)"}</option>`).join("");
    const storeNote = state.secretStore && state.secretStore.encrypted
      ? "Keys are encrypted at rest with your operating system keystore."
      : "Keys are stored in a file restricted to your user account.";
    const keyHint = selectedCredential.masked ? `Saved: ${selectedCredential.masked}` : selectedCredential.apiKeyRequired === false ? "No key needed for this provider" : "Paste your API key";
    const credentialsPanel = `<article class="panel credentials-panel"><span class="eyebrow">PROVIDER CREDENTIALS</span><h2>Bring your own key</h2><p class="sample-note">${esc(storeNote)} The selected provider receives the key and prompts when needed; it may run locally or remotely.</p><label class="setting-row"><span><b>Provider</b><small>The provider this key belongs to.</small></span><select id="credential-provider">${providerOptions || `<option value="${esc(selectedProvider)}">${esc(selectedProvider || "No providers reported")}</option>`}</select></label><label class="setting-row"><span><b>API key</b><small>Write-only. The saved value is never sent back to this window.</small></span><input id="credential-key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(keyHint)}" maxlength="4000"></label><label class="setting-row"><span><b>Base URL</b><small>Only used by the OpenAI-compatible provider.</small></span><input id="credential-base-url" value="${esc(settings.apiBaseUrl || "")}" maxlength="400" placeholder="https://your-endpoint/v1"></label><div class="form-actions"><span id="credential-message" role="status">${esc(state.credentialMessage || `Saved provider: ${activeCredential.name || settings.provider || "unknown"}${activeCredential.configured ? " · key configured" : " · no key configured"}`)}</span><button class="row-action" type="button" id="credential-use">Use this provider</button><button class="row-action" type="button" id="credential-delete">Remove key</button><button class="row-action" type="button" id="credential-test">Test key</button><button class="primary-button" type="button" id="credential-save">Save key</button></div></article>`;
    const permissions = state.permissions?.profile ? state.permissions : null;
    const permissionOptions = (values, selected) => values.map(value => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("");
    const permissionNote = state.permissionMessage || (permissions ? `Profile ${permissions.profile.id} · ${permissions.profile.allowedTools.length ? `${permissions.profile.allowedTools.length} tools allowed` : "every tool allowed"}` : "Loading workspace permissions…");
    const permissionsPanel = permissions
      ? `<article class="panel permissions-panel"><span class="eyebrow">WORKSPACE PERMISSIONS</span><h2>Tool policy</h2><p class="sample-note">What the agent may do without asking. A denied action names the exact key to change, and approval prompts from chat are answered here.</p><div class="permission-tools">${permissions.tools.map(name => `<label class="permission-tool"><input type="checkbox" data-permission-tool="${esc(name)}" ${!permissions.profile.allowedTools.length || permissions.profile.allowedTools.includes(name) ? "checked" : ""}><span>${esc(name)}</span></label>`).join("")}</div><label class="setting-row"><span><b>Shell</b><small>Where shell commands may run.</small></span><select id="permission-shell">${permissionOptions(["disabled", "workspace", "approval-required"], permissions.profile.shellPolicy)}</select></label><label class="setting-row"><span><b>Network</b><small>Fetch, search, browse, and mail.</small></span><select id="permission-network">${permissionOptions(["disabled", "fetch-only", "browser-allowed"], permissions.profile.networkPolicy)}</select></label><label class="setting-row"><span><b>Read roots</b><small>Absolute paths, comma separated.</small></span><input id="permission-read-roots" value="${esc(permissions.profile.readRoots.join(", "))}" maxlength="1200" spellcheck="false"></label><label class="setting-row"><span><b>Write roots</b><small>Absolute paths, comma separated.</small></span><input id="permission-write-roots" value="${esc(permissions.profile.writeRoots.join(", "))}" maxlength="1200" spellcheck="false"></label><div class="form-actions"><span id="permission-message" role="status">${esc(permissionNote)}</span><button class="primary-button" type="button" id="permission-save">Save permissions</button></div></article>`
      : `<article class="panel permissions-panel"><span class="eyebrow">WORKSPACE PERMISSIONS</span><h2>Tool policy</h2><p class="sample-note">${esc(state.errors.permissions || "Loading workspace permissions…")}</p></article>`;
    return `${header("SETTINGS", "Configure your local runtime.", "Edit saved, non-secret NTOX settings. Provider and model changes need an API restart before the current runtime adopts them.")}<section class="settings-layout">${credentialsPanel}${permissionsPanel}<article class="panel settings-panel"><span class="eyebrow">SAVED CONFIGURATION</span><h2>Runtime defaults</h2><form id="settings-form"><label class="setting-row"><span><b>Provider</b><small>Configured provider ID.</small></span><input id="settings-provider" name="provider" required value="${esc(settings.provider)}" maxlength="80"></label><label class="setting-row"><span><b>Model</b><small>Model identifier used by the NTOX API runtime.</small></span><input id="settings-model" name="model" required value="${esc(settings.model)}" maxlength="200"></label><label class="setting-row"><span><b>Temperature</b><small>Sampling temperature from 0 to 2.</small></span><input id="settings-temperature" name="temperature" type="number" min="0" max="2" step="0.1" value="${esc(settings.temperature)}"></label><label class="setting-row"><span><b>Maximum tokens</b><small>Maximum response tokens.</small></span><input id="settings-max-tokens" name="maxTokens" type="number" min="1" max="1000000" step="1" value="${esc(settings.maxTokens)}"></label><label class="setting-row"><span><b>Memory enabled</b><small>Allow runtime sessions to use memory.</small></span><input id="settings-memory-enabled" name="memoryEnabled" type="checkbox" ${settings.memoryEnabled ? "checked" : ""}></label><div class="form-actions"><span id="settings-message" role="status">${esc(state.settingsMessage || "Saved configuration changes to provider or model require a local API restart. Credentials are managed separately.")}</span><button class="primary-button" type="submit">Save changes</button></div></form></article><article class="panel runtime-panel"><span class="eyebrow">RUNTIME STATUS</span><h2>${esc(state.bootstrap?.runtime?.status || "Unknown")}</h2><div class="runtime-row"><span>API endpoint</span><code>127.0.0.1:${esc(settings.apiPort || "3100")}</code></div><div class="runtime-row"><span>Workspace</span><code>${esc(settings.workspace || "Local")}</code></div><div class="runtime-row"><span>Saved provider</span><code>${esc(settings.provider || "Unknown")}</code></div><div class="runtime-row"><span>Active model</span><code>Not reported by the local API</code></div><p>Desktop sessions and conversation history are private to this installed desktop client. Browser chat remains a separate surface.</p></article></section>`;
  }

  function updateRuntimeReadings() {
    const runtime = state.bootstrap?.runtime || {};
    const readings = {
      status: state.errors.runtime ? "Unavailable" : runtime.status || "Connecting",
      uptime: runtime.uptimeSeconds != null ? `HOST UP ${Math.floor(runtime.uptimeSeconds / 3600)}H ${Math.floor(runtime.uptimeSeconds % 3600 / 60)}M` : "LOCAL AGENT API",
      cpu: runtime.cpuCount ?? "Not reported",
      memory: runtime.memoryTotalBytes && runtime.memoryFreeBytes != null ? `${(runtime.memoryFreeBytes / 1024 ** 3).toFixed(1)} / ${(runtime.memoryTotalBytes / 1024 ** 3).toFixed(1)} GB free` : "Not reported",
    };
    main().querySelectorAll("[data-runtime-reading]").forEach(element => { element.textContent = readings[element.dataset.runtimeReading]; });
  }

  function draftControls(formId) {
    if (formId === "credential-form") return ["credential-provider", "credential-key", "credential-base-url"].map(id => document.getElementById(id)).filter(Boolean);
    return [...(document.getElementById(formId)?.elements || [])];
  }

  function rememberDraft(formId) {
    const draft = {};
    for (const control of draftControls(formId)) {
      if (!control.id && !control.name) continue;
      draft[control.id || control.name] = { value: control.value, checked: control.type === "checkbox" ? control.checked : undefined };
    }
    state.formDrafts[formId] = draft;
  }

  function restoreDraft(formId) {
    const draft = state.formDrafts[formId];
    if (!draft) return;
    for (const control of draftControls(formId)) {
      const value = draft[control.id || control.name];
      if (!value) continue;
      control.value = value.value;
      if (control.type === "checkbox") control.checked = value.checked;
    }
  }

  function trackDraft(formId, form = document.getElementById(formId)) {
    const controls = form ? [form] : draftControls(formId);
    controls.forEach(control => {
      control.addEventListener("input", () => rememberDraft(formId));
      control.addEventListener("change", () => rememberDraft(formId));
    });
    restoreDraft(formId);
  }

  function render() {
    const viewData = {
      Overview: [state.agents, state.tasks, state.workflows, state.bootstrap?.memory?.total, state.bootstrap?.config, state.notifications],
      Agents: [state.agents, state.tasks, state.tools],
      Tasks: [state.tasks, state.workflows, state.agents],
      Memory: [state.memory, state.graph, state.bootstrap?.memory?.total, state.bootstrap?.memory?.stats],
      Tools: state.tools,
      Evaluations: state.evaluations,
      Settings: [state.settings, state.providers, state.credentials, state.secretStore, state.permissions, state.permissionMessage],
    };
    const signature = JSON.stringify({ page: state.page, errors: state.errors, loaded: [...state.loaded], data: viewData[state.page], memoryGraphMessage: state.memoryGraphMessage, filters: [state.agentQuery, state.agentStatus, state.agentRole, state.taskQuery, state.taskStatus, state.selectedTask, state.evaluationGroup, state.memoryQuery, state.memoryVisible, state.selectedMemory, state.toolQuery, state.toolCategory, state.settingsMessage, state.workflowMessage, state.credentialMessage, state.credentialProvider] });
    updateRuntimeReadings();
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    const enteredPage = state.page !== renderedPage;
    renderedPage = state.page;
    root.dataset.page = state.page;
    if (graphFrame) cancelAnimationFrame(graphFrame);
    if (graphObserver) graphObserver.disconnect();
    if (graphVisibilityObserver) graphVisibilityObserver.disconnect();
    if (graphVisibilityHandler) { document.removeEventListener("visibilitychange", graphVisibilityHandler); graphVisibilityHandler = null; }
    if (graphMotionQuery && graphMotionHandler) graphMotionQuery.removeEventListener("change", graphMotionHandler);
    graphMotionQuery = null;
    graphMotionHandler = null;
    const views = { Overview: overview, Agents: agentsPage, Tasks: tasksPage, Memory: memoryPage, Tools: toolsPage, Evaluations: evaluationsPage, Settings: settingsPage };
    root.querySelectorAll(".nav-item").forEach(button => { const active = button.dataset.page === state.page; button.classList.toggle("active", active); button.setAttribute("aria-current", active ? "page" : "false"); });
    const activeElement = document.activeElement;
    const focusId = activeElement && main().contains(activeElement) ? activeElement.id : "";
    const focusMemoryId = activeElement?.dataset?.memorySelect || "";
    const focusKey = activeElement?.dataset?.focusKey || "";
    const focusIsCheckbox = Boolean(focusId && activeElement.type === "checkbox");
    const focusValue = focusId ? focusIsCheckbox ? activeElement.checked : activeElement.value : undefined;
    const cursor = focusId && typeof activeElement.selectionStart === "number" ? [activeElement.selectionStart, activeElement.selectionEnd] : null;
    const scrollTop = main().scrollTop;
    const panelScroll = [...main().querySelectorAll(".table-scroll,.memory-record-list")].map(element => ({ className: element.className.split(" ")[0], top: element.scrollTop, left: element.scrollLeft }));
    const openDisclosures = [...main().querySelectorAll("details[data-disclosure-key][open]")].map(element => element.dataset.disclosureKey);
    const failed = Object.entries(state.errors);
    let connection = "<div class=\"refresh-meta\" data-refresh-meta>" + (state.lastUpdated ? "Updated " + new Date(state.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " · Refreshes every 5 seconds" : "Connecting to local runtime") + "</div>";
    if (state.loading) connection = "<div class=\"connection-banner\" role=\"status\"><i></i><span>Connecting to the local runtime. Dashboard sections will load independently.</span></div>";
    else if (failed.length) {
      const clean = message => String(message).replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "").slice(0, 500);
      const failures = state.errors.runtime ? [["Runtime", state.errors.runtime]] : failed;
      const grouped = new Map();
      failures.forEach(([name, message]) => { const detail = clean(message); grouped.set(detail, [...(grouped.get(detail) || []), name]); });
      connection = '<div class="connection-banner warning" role="status"><span>' + [...grouped].map(([message, names]) => '<b>' + esc(names.join(", ")) + ' unavailable.</b> ' + esc(message)).join("<br>") + ' <small>Previously loaded data is retained. Retrying every 5 seconds.</small></span><button class="row-action" data-retry>Retry now</button></div>';
    }
    const panel = main();
    panel.classList.remove("entering");
    panel.innerHTML = state.loading || failed.length ? connection + views[state.page]() : views[state.page]() + connection;
    ["workflow-form", "settings-form", "credential-form"].forEach(restoreDraft);
    updateRuntimeReadings();
    panel.querySelectorAll(".table-scroll").forEach(element => { element.tabIndex = 0; element.setAttribute("role", "region"); element.setAttribute("aria-label", state.page + " table; scroll for more columns"); });
    if (enteredPage) panel.classList.add("entering");
    if (enteringTimer) clearTimeout(enteringTimer);
    enteringTimer = enteredPage ? setTimeout(() => { enteringTimer = 0; panel.classList.remove("entering"); }, 900) : 0;
    bindPage();
    glyphMotion?.mount(panel);
    if (state.page === "Memory") mountMemoryGraph();
    main().scrollTop = scrollTop;
    if (focusId) { const replacement = document.getElementById(focusId); if (replacement) { if (focusValue !== undefined) { if (focusIsCheckbox) replacement.checked = focusValue; else replacement.value = focusValue; } replacement.focus({ preventScroll: true }); if (cursor && replacement.setSelectionRange) replacement.setSelectionRange(cursor[0], cursor[1]); } }
    else if (focusMemoryId) main().querySelector(`[data-memory-select="${CSS.escape(focusMemoryId)}"]`)?.focus({ preventScroll: true });
    else if (focusKey) main().querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    openDisclosures.forEach(key => { const disclosure = main().querySelector(`[data-disclosure-key="${CSS.escape(key)}"]`); if (disclosure) disclosure.open = true; });
    panelScroll.forEach(saved => { const element = main().querySelector(`.${CSS.escape(saved.className)}`); if (element) { element.scrollTop = saved.top; element.scrollLeft = saved.left; } });
  }

  function scheduleRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
  }

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      try { state.bootstrap = { ...await api("/api/desktop/bootstrap"), memory: state.bootstrap?.memory }; state.notifications = state.bootstrap.notifications || []; state.loaded.add("runtime"); delete state.errors.runtime; }
      catch (error) { state.errors.runtime = error.message || "Request failed"; }
      try { state.secretStore = await window.ntoxDesktop.getSecretStoreStatus(); } catch { state.secretStore = null; }
      state.loading = false;
      const label = document.getElementById("system-label");
      const detail = document.getElementById("system-detail");
      const connected = state.loaded.has("runtime") && !state.errors.runtime;
      root.dataset.runtimeState = connected ? "connected" : "unavailable";
      if (label) label.textContent = connected ? "SYSTEM OPERATIONAL" : "RUNTIME UNAVAILABLE";
      if (detail) detail.textContent = connected ? "Local runtime connected" : "Check local API connection";
      render();
      const resources = [
      ["agents", "/api/agents", result => { state.agents = result.agents || []; }],
      ["tasks", "/api/tasks", result => { state.tasks = result.tasks || []; state.workflows = result.workflows || []; }],
      ["memory", "/api/memory?limit=100", result => { state.memory = result.records || []; if (state.bootstrap) state.bootstrap.memory = result; if (!state.memory.some(item => String(item.id) === String(state.selectedMemory))) state.selectedMemory = state.memory[0]?.id || ""; }],
      ["graph", "/api/memory/graph", result => { state.graph = result; }],
      ["tools", "/api/tools", result => { state.tools = result.tools || []; }],
      ["evaluations", "/api/evaluations", result => { state.evaluations = result; }],
      ["settings", "/api/settings", result => { state.settings = result.settings || {}; state.providers = result.providers || []; state.credentials = result.credentials || []; }]
      ];
      await Promise.all(resources.map(async ([name, route, apply]) => {
        try { const result = await api(route); apply(result); state.loaded.add(name); delete state.errors[name]; }
        catch (error) { state.errors[name] = error.message || "Request failed"; }
        scheduleRender();
      }));
      if (!Object.keys(state.errors).length) state.lastUpdated = Date.now();
      document.dispatchEvent(new CustomEvent("ntox:runtime-update", { detail: { connected, agents: state.agents, agentError: Boolean(state.errors.agents), memory: state.bootstrap?.memory?.total, memoryError: Boolean(state.errors.memory) } }));
      if (detail && connected) detail.textContent = `${state.agents.filter(agent => agent.status === "running").length} active NTOX runs`;
      render();
      const meta = main().querySelector("[data-refresh-meta]");
      if (meta) meta.textContent = `Updated ${new Date(state.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · Refreshes every 5 seconds`;
    } finally { state.refreshing = false; }
  }

  const splitRoots = value => String(value || "").split(",").map(item => item.trim()).filter(Boolean);

  async function savePermissions() {
    const button = document.getElementById("permission-save");
    const message = document.getElementById("permission-message");
    if (!button || !state.permissions) return;
    const profile = state.permissions.profile;
    const materialized = profile.allowedTools.length ? profile.allowedTools : (state.permissions.tools || []);
    const current = new Set(materialized);
    const selected = new Set();
    main().querySelectorAll("[data-permission-tool]").forEach(box => { if (box.checked) selected.add(box.dataset.permissionTool); });
    const payload = {
      addTools: [...selected].filter(name => !current.has(name)),
      removeTools: materialized.filter(name => !selected.has(name)),
      shellPolicy: document.getElementById("permission-shell")?.value,
      networkPolicy: document.getElementById("permission-network")?.value,
      readRoots: splitRoots(document.getElementById("permission-read-roots")?.value),
      writeRoots: splitRoots(document.getElementById("permission-write-roots")?.value),
    };
    button.disabled = true;
    if (message) message.textContent = "Saving permissions…";
    try {
      const result = await api("/api/desktop/permissions", "PATCH", payload);
      state.permissions = result;
      state.permissionMessage = `Saved. ${result.profile.allowedTools.length ? `${result.profile.allowedTools.length} tools allowed` : "every tool allowed"}`;
    } catch (error) {
      state.permissionMessage = `Could not save permissions: ${String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "")}`;
    } finally {
      button.disabled = false;
      if (message) message.textContent = state.permissionMessage;
      scheduleRender();
    }
  }

  function bindPage() {
    if (state.page === "Settings" && !state.permissions && !state.permissionsLoading && !state.errors.permissions) {
      state.permissionsLoading = true;
      api("/api/desktop/permissions")
        .then(result => { state.permissions = result; state.permissionsLoading = false; scheduleRender(); })
        .catch(error => { state.permissionsLoading = false; state.errors.permissions = String(error?.message || error || "Workspace permissions are unavailable."); scheduleRender(); });
    }
    const permissionSave = document.getElementById("permission-save");
    if (permissionSave) permissionSave.addEventListener("click", savePermissions);
    main().querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => { if (button.hasAttribute("data-new-workflow")) state.composerOpen = true; go(button.dataset.go); if (button.hasAttribute("data-new-workflow")) { document.getElementById("workflow-composer")?.scrollIntoView({ block: "start" }); document.getElementById("workflow-goal")?.focus({ preventScroll: true }); } }));
    main().querySelectorAll("[data-clear-notifications]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Clearing…";
      try { const result = await api("/api/desktop/bootstrap", "POST", { clearNotifications: true }); state.notifications = result.notifications || []; render(); await refresh(); }
      catch (error) { state.errors.notifications = error.message; render(); }
    }));
    const search = document.getElementById("agent-search");
    if (search) search.addEventListener("input", () => { state.agentQuery = search.value; render(); });
    const agentStatus = document.getElementById("agent-status-filter");
    if (agentStatus) agentStatus.addEventListener("change", () => { state.agentStatus = agentStatus.value; render(); });
    const roleFilter = document.getElementById("agent-role-filter");
    roleFilter?.addEventListener("change", () => { state.agentRole = roleFilter.value; render(); });
    const taskSearch = document.getElementById("task-search");
    taskSearch?.addEventListener("input", () => { state.taskQuery = taskSearch.value; render(); });
    const taskFilter = document.getElementById("task-status-filter");
    taskFilter?.addEventListener("change", () => { state.taskStatus = taskFilter.value; render(); });
    main().querySelectorAll("[data-task-select]").forEach(button => button.addEventListener("click", () => { state.selectedTask = button.dataset.taskSelect; render(); }));
    const composer = document.getElementById("workflow-composer");
    composer?.addEventListener("toggle", () => { state.composerOpen = composer.open; });
    main().querySelector("[data-compose-workflow]")?.addEventListener("click", () => { composer.open = true; state.composerOpen = true; composer.scrollIntoView({ block: "start" }); document.getElementById("workflow-goal")?.focus({ preventScroll: true }); });
    const evaluationGroup = document.getElementById("evaluation-group");
    evaluationGroup?.addEventListener("change", () => { state.evaluationGroup = evaluationGroup.value; render(); });
    const memorySearch = document.getElementById("memory-search");
    if (memorySearch) memorySearch.addEventListener("input", () => { state.memoryQuery = memorySearch.value; state.memoryVisible = 30; render(); });
    main().querySelectorAll("[data-memory-select]").forEach(button => button.addEventListener("click", () => { state.selectedMemory = button.dataset.memorySelect; render(); }));
    main().querySelector("[data-memory-more]")?.addEventListener("click", () => { const firstNew = state.memoryVisible; state.memoryVisible += 30; render(); main().querySelectorAll("[data-memory-select]")[firstNew]?.focus(); });
    const retryButton = main().querySelector("[data-retry]");
    if (retryButton) retryButton.addEventListener("click", () => { void refresh(); });
    const toolSearch = document.getElementById("tool-search");
    if (toolSearch) toolSearch.addEventListener("input", () => { state.toolQuery = toolSearch.value; render(); });
    const toolCategory = document.getElementById("tool-category-filter");
    if (toolCategory) toolCategory.addEventListener("change", () => { state.toolCategory = toolCategory.value; render(); });
    main().querySelectorAll("[data-workflow-action]").forEach(button => button.addEventListener("click", async () => {
      if (button.dataset.workflowAction === "cancel" && !window.confirm("Cancel this entire workflow and its active tasks?")) return;
      button.disabled = true;
      button.textContent = button.dataset.workflowAction === "cancel" ? "Cancelling…" : "Retrying…";
      try { await api(`/api/tasks/${encodeURIComponent(button.dataset.workflow)}/${button.dataset.workflowAction}`, "POST", {}); await refresh(); }
      catch (error) { state.errors.tasks = error.message; render(); }
    }));
    main().querySelectorAll("[data-memory-action]").forEach(button => button.addEventListener("click", async () => {
      const record = state.memory.find(item => item.id === button.dataset.memory);
      if (!record) return;
      try {
        if (button.dataset.memoryAction === "delete") {
          if (!window.confirm("Delete this durable NTOX memory record?")) return;
          await api(`/api/memory/${encodeURIComponent(record.id)}`, "DELETE");
        } else {
          const text = window.prompt("Edit durable memory", record.text);
          if (text === null || !text.trim()) return;
          await api(`/api/memory/${encodeURIComponent(record.id)}`, "PATCH", { text: text.trim() });
        }
        await refresh();
      } catch (error) { state.errors.memory = error.message; render(); }
    }));
    const workflowForm = document.getElementById("workflow-form");
    trackDraft("workflow-form", workflowForm);
    if (workflowForm) workflowForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(workflowForm);
      const goal = String(form.get("goal") || "").trim();
      const subtasks = String(form.get("subtasks") || "").split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      const mode = form.get("mode") === "execute" ? "execute" : "research";
      const message = document.getElementById("workflow-message");
      const button = workflowForm.querySelector("button[type=submit]");
      if (!goal) { workflowForm.elements.goal.focus(); return; }
      if (subtasks.length > 3) { state.workflowMessage = "Use at most three subtask prompts. Your text has been kept."; message.textContent = state.workflowMessage; workflowForm.elements.subtasks.focus(); return; }
      button.disabled = true;
      state.workflowMessage = "Starting isolated NTOX agents…";
      message.textContent = state.workflowMessage;
      try {
        const result = await api("/api/tasks", "POST", { goal, mode, ...(subtasks.length ? { subtasks } : {}) });
        state.workflowMessage = `Workflow ${result.workflow.id} started.`;
        message.textContent = state.workflowMessage;
        workflowForm.reset();
        delete state.formDrafts["workflow-form"];
        await refresh();
      } catch (error) { state.workflowMessage = `Workflow could not start: ${error.message}. Your inputs are still here.`; message.textContent = state.workflowMessage; }
      finally { button.disabled = false; }
    });
    const settingsForm = document.getElementById("settings-form");
    trackDraft("settings-form", settingsForm);
    if (settingsForm) settingsForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(settingsForm);
      const message = document.getElementById("settings-message");
      const button = settingsForm.querySelector("button[type=submit]");
      button.disabled = true;
      state.settingsMessage = "Saving configuration…";
      message.textContent = state.settingsMessage;
      try {
        await api("/api/settings", "PATCH", { provider: form.get("provider"), model: form.get("model"), temperature: Number(form.get("temperature")), maxTokens: Number(form.get("maxTokens")), memoryEnabled: settingsForm.elements.memoryEnabled.checked });
        state.settingsMessage = "Saved to NTOX configuration. Restart the local API to activate provider or model changes.";
        message.textContent = state.settingsMessage;
        await refresh();
        delete state.formDrafts["settings-form"];
      } catch (error) { state.settingsMessage = `Could not save settings: ${error.message}. Your edits are still here.`; message.textContent = state.settingsMessage; }
      finally { button.disabled = false; }
    });
    const credentialProvider = document.getElementById("credential-provider");
    const credentialMessage = document.getElementById("credential-message");
    const credentialKey = document.getElementById("credential-key");
    const credentialBaseUrl = document.getElementById("credential-base-url");
    const setCredentialMessage = text => { state.credentialMessage = text; if (credentialMessage) credentialMessage.textContent = text; };
    const credentialInput = () => ({ provider: credentialProvider?.value || "", apiKey: credentialKey?.value || "", baseUrl: credentialBaseUrl?.value || "" });
    trackDraft("credential-form");
    if (credentialProvider) credentialProvider.addEventListener("change", () => { state.credentialProvider = credentialProvider.value; state.credentialMessage = ""; render(); });
    const credentialTest = document.getElementById("credential-test");
    if (credentialTest) credentialTest.addEventListener("click", async () => {
      const input = credentialInput();
      if (!input.provider) { setCredentialMessage("Choose a provider first."); return; }
      credentialTest.disabled = true;
      setCredentialMessage("Testing key…");
      try {
        const result = await window.ntoxDesktop.testCredential(input);
        setCredentialMessage(result.ok ? `Key accepted${result.modelCount ? ` · ${result.modelCount} models available` : ""}.` : `Key rejected: ${result.error || "the provider did not accept it"}.`);
      } catch (error) { setCredentialMessage(`Could not test the key: ${error.message}.`); }
      finally { credentialTest.disabled = false; }
    });
    const credentialSave = document.getElementById("credential-save");
    if (credentialSave) credentialSave.addEventListener("click", async () => {
      const input = credentialInput();
      if (!input.provider) { setCredentialMessage("Choose a provider first."); return; }
      if (!input.apiKey) { setCredentialMessage("Enter an API key before saving."); return; }
      credentialSave.disabled = true;
      setCredentialMessage("Saving key…");
      try {
        const result = await window.ntoxDesktop.saveCredential(input);
        if (credentialKey) credentialKey.value = "";
        delete state.formDrafts["credential-form"]?.["credential-key"];
        state.credentialMessage = result.encrypted ? "Key saved and encrypted at rest." : "Key saved to your restricted local credential store.";
        await refresh();
      } catch (error) { setCredentialMessage(`Could not save the key: ${error.message}.`); }
      finally { credentialSave.disabled = false; }
    });
    const credentialDelete = document.getElementById("credential-delete");
    if (credentialDelete) credentialDelete.addEventListener("click", async () => {
      const input = credentialInput();
      if (!input.provider) { setCredentialMessage("Choose a provider first."); return; }
      if (!window.confirm(`Remove the saved key for ${input.provider}?`)) return;
      credentialDelete.disabled = true;
      setCredentialMessage("Removing key…");
      try {
        await window.ntoxDesktop.deleteCredential({ provider: input.provider });
        if (credentialKey) credentialKey.value = "";
        delete state.formDrafts["credential-form"]?.["credential-key"];
        state.credentialMessage = "Saved key removed.";
        await refresh();
      } catch (error) { setCredentialMessage(`Could not remove the key: ${error.message}.`); }
      finally { credentialDelete.disabled = false; }
    });
    const credentialUse = document.getElementById("credential-use");
    if (credentialUse) credentialUse.addEventListener("click", async () => {
      const input = credentialInput();
      if (!input.provider) { setCredentialMessage("Choose a provider first."); return; }
      credentialUse.disabled = true;
      setCredentialMessage(`Saving ${input.provider} as the configured provider…`);
      try {
        await api("/api/settings", "PATCH", { provider: input.provider });
        state.credentialMessage = `${input.provider} saved. Restart the local API to apply this provider.`;
        await refresh();
      } catch (error) { setCredentialMessage(`Could not switch provider: ${error.message}.`); }
      finally { credentialUse.disabled = false; }
    });
  }

  function go(page) {
    const previous = state.page;
    const changed = previous !== page;
    state.page = page;
    render();
    if (changed) window.scrollTo(0, 0);
    main().querySelector("h1")?.focus({ preventScroll: true });
    root.querySelector(".console-sidebar").classList.remove("open");
    root.querySelector(".console-mobile-menu").setAttribute("aria-expanded", "false");
    if (changed) glyphMotion?.enter(previous.toLowerCase(), page.toLowerCase());
    else glyphMotion?.sync();
  }
  root.addEventListener("click", event => {
    if (event.target.closest("[data-launch-dashboard]")) { root.classList.remove("landing-mode"); go("Agents"); glyphMotion?.enter("intro", "agents", true); }
    if (event.target.closest("[data-launch-chat]")) {
      root.classList.remove("landing-mode");
      go("Agents");
      root.dataset.returnPage = state.page;
      root.classList.add("chat-mode");
      chatApp.classList.add("chat-visible");
      document.getElementById("desktop-message-input")?.focus();
      glyphMotion?.enter("intro", "chat", true);
    }
    const navButton = event.target.closest("[data-page]");
    if (navButton) go(navButton.dataset.page);
    if (event.target.closest("[data-open-chat]")) { root.dataset.returnPage = state.page; root.classList.add("chat-mode"); chatApp.classList.add("chat-visible"); document.getElementById("desktop-message-input")?.focus(); glyphMotion?.enter(state.page.toLowerCase(), "chat", true); }
    if (event.target.closest(".console-mobile-menu")) { const open = root.querySelector(".console-sidebar").classList.toggle("open"); event.target.closest(".console-mobile-menu").setAttribute("aria-expanded", String(open)); }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("[data-launch-home]")) return;
    const previous = root.classList.contains("chat-mode") ? "chat" : state.page.toLowerCase();
    root.classList.remove("chat-mode");
    chatApp.classList.remove("chat-visible", "context-open");
    root.classList.add("landing-mode");
    root.querySelector("[data-launch-dashboard]")?.focus();
    glyphMotion?.enter(previous, "intro", true);
  });
  const leaveChat = destination => { root.classList.remove("chat-mode"); chatApp.classList.remove("chat-visible", "context-open"); if (destination && nav.includes(destination)) go(destination); glyphMotion?.enter("chat", state.page.toLowerCase(), true); };
  document.querySelectorAll("[data-back-console]").forEach(button => button.addEventListener("click", () => leaveChat(root.dataset.returnPage || "Overview")));
  const contextClose = document.querySelector(".desktop-context-head button");
  const contextToggle = document.getElementById("desktop-context-toggle");
  if (contextToggle && window.innerWidth <= 1100) contextToggle.setAttribute("aria-expanded", "false");
  if (contextClose) contextClose.addEventListener("click", () => { chatApp.classList.add("context-collapsed"); chatApp.classList.remove("context-open"); contextToggle?.setAttribute("aria-expanded", "false"); contextToggle?.focus(); });
  if (contextToggle) contextToggle.addEventListener("click", () => {
    if (window.innerWidth <= 1100) { const open = !chatApp.classList.contains("context-open"); chatApp.classList.toggle("context-open", open); chatApp.classList.toggle("context-collapsed", !open); contextToggle.setAttribute("aria-expanded", String(open)); }
    else { const open = chatApp.classList.contains("context-collapsed"); chatApp.classList.toggle("context-collapsed", !open); contextToggle.setAttribute("aria-expanded", String(open)); }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (chatApp.classList.contains("context-open")) contextClose?.click();
      const sidebar = root.querySelector(".console-sidebar");
      if (sidebar.classList.contains("open")) { sidebar.classList.remove("open"); const menu = root.querySelector(".console-mobile-menu"); menu.setAttribute("aria-expanded", "false"); menu.focus(); }
    }
  });
  window.addEventListener("resize", () => {
    if (!contextToggle) return;
    const open = window.innerWidth <= 1100 ? chatApp.classList.contains("context-open") : !chatApp.classList.contains("context-collapsed");
    contextToggle.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".context-link").forEach(button => button.addEventListener("click", () => leaveChat(button.dataset.contextDestination)));
  const clock = document.getElementById("console-clock");
  const updateClock = () => { clock.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date()); };
  updateClock();
  setInterval(updateClock, 30000);
  render();
  void refresh();
  setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
})();
