(() => {
  const list = document.getElementById("desktop-conversations");
  const messages = document.getElementById("desktop-messages");
  const input = document.getElementById("desktop-message-input");
  const form = document.getElementById("desktop-chat-form");
  const title = document.getElementById("desktop-session-title");
  const search = document.getElementById("desktop-search");
  let conversations = [];
  let activeId = "";
  let pending = false;
  let activeRequestId = "";
  let activeRequestConversation = null;
  let saveTimer = 0;
  const restored = window.ntoxDesktop?.loadConversations().then(saved => { if (Array.isArray(saved)) conversations = saved; }).catch(() => {});

  document.addEventListener("ntox:runtime-update", ({ detail }) => {
    const badge = document.querySelector(".desktop-runtime");
    const roster = document.getElementById("desktop-context-agents");
    const total = document.getElementById("desktop-memory-count");
    document.getElementById("desktop-chat").dataset.runtimeState = detail.connected ? "connected" : "unavailable";
    if (badge) badge.innerHTML = "<i></i> " + (detail.connected ? "LOCAL RUNTIME READY" : "RUNTIME UNAVAILABLE");
    if (roster) roster.innerHTML = detail.agentError || !detail.connected ? "Agent status unavailable. Reconnect from the dashboard." : detail.agents.slice(0, 5).map(agent => `<div class="context-agent ${agent.status === "running" ? "running" : ""}"><i>${globalThis.NTOXGlyphMotion?.icon("agent-detail", 18) || escapeHtml(agent.name.slice(0, 1))}</i><span><b>${escapeHtml(agent.name)}</b><small>${escapeHtml(agent.status)}</small></span><em aria-hidden="true"></em></div>`).join("") || "No agents registered";
    if (total) total.textContent = detail.memoryError || !detail.connected ? "Memory count unavailable" : detail.memory == null ? "Memory count not reported" : detail.memory + " stored records";
  });

  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const formatMessage = value => String(value || "").split("```").map((part, index) => {
    if (index % 2 === 1) { const newline = part.indexOf("\n"); const code = newline < 0 ? part : part.slice(newline + 1); return `<pre class="message-code"><code>${escapeHtml(code)}</code></pre>`; }
    return escapeHtml(part).replace(/`([^`]+)`/g, "<code class=\"message-inline-code\">$1</code>");
  }).join("");
  const save = () => window.ntoxDesktop?.saveConversations(conversations.slice(0, 80)).catch(() => {});
  const saveSoon = () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(save, 240); };
  const active = () => conversations.find(conversation => conversation.id === activeId);
  const cleanIpcError = error => String(error?.message || "")
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

  function syncChatControls(conversation) {
    const conversationPending = pending && activeRequestConversation === conversation;
    const generationStatus = document.getElementById("desktop-generation-status");
    input.disabled = pending && !conversationPending;
    form.querySelector("button[type=submit]").disabled = pending;
    document.getElementById("desktop-clear-chat").disabled = pending || !conversation?.messages.length;
    generationStatus.lastChild.textContent = pending ? conversationPending ? " Generating response" : " A different conversation is generating. Return to it to follow the response." : " Desktop history · provider may be remote";
  }

  function newConversation() {
    const conversation = { id: crypto.randomUUID(), title: "New conversation", updatedAt: Date.now(), messages: [] };
    conversations.unshift(conversation);
    activeId = conversation.id;
    save();
    render();
    input.focus();
  }

  function renderList() {
    const query = search.value.trim().toLowerCase();
    const filtered = conversations.filter(conversation => `${conversation.title} ${conversation.messages.map(message => message.content).join(" ")}`.toLowerCase().includes(query));
    list.innerHTML = filtered.length ? filtered.map(conversation => `<button class="desktop-conversation-item ${conversation.id === activeId ? "active" : ""}" data-conversation="${escapeHtml(conversation.id)}" aria-current="${conversation.id === activeId ? "true" : "false"}"><span>${escapeHtml(conversation.title)}</span><small>${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(conversation.updatedAt)}</small></button>`).join("") : `<div class="desktop-empty-list" role="status">${query ? "No matching conversations" : "No conversations yet"}</div>`;
    list.querySelectorAll("[data-conversation]").forEach(button => button.addEventListener("click", () => { activeId = button.dataset.conversation; render(); }));
  }

  function renderMessages() {
    const conversation = active();
    title.textContent = conversation?.title || "New conversation";
    syncChatControls(conversation);
    document.getElementById("desktop-jump-latest").hidden = true;
    if (!conversation || conversation.messages.length === 0) {
      messages.innerHTML = `<div class="desktop-welcome">${globalThis.NTOXGlyphMotion?.markup("chat", "welcome") || '<div class="desktop-welcome-mark">N</div>'}<span class="eyebrow">YOUR LOCAL NTOX AGENT</span><h1>What are we<br>working on?</h1><p>History stays on this desktop and is separate from the NTOX web app.</p><div class="desktop-suggestions"><button data-prompt="Give me a quick briefing of my NTOX workspace."><b>Workspace briefing</b><small>Summarize what needs attention</small></button><button data-prompt="Help me plan a multi-agent research task."><b>Plan with agents</b><small>Turn an idea into a coordinated task</small></button></div></div>`;
      globalThis.NTOXGlyphMotion?.mount(messages);
      messages.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => { input.value = button.dataset.prompt; input.focus(); }));
      return;
    }
    const streamingConversation = pending && activeRequestConversation === conversation;
    messages.innerHTML = conversation.messages.map((message, index) => { const role = message.role === "user" ? "user" : "assistant"; const streaming = streamingConversation && message === conversation.messages.at(-1); return `<article class="desktop-message ${role}" data-message-index="${index}" ${streaming ? "data-streaming-message" : ""}><span class="desktop-message-avatar" aria-hidden="true">${role === "user" ? "A" : "N"}</span><div class="desktop-message-body"><div class="desktop-message-content">${formatMessage(message.content)}${streaming && !message.content ? "<span class=\"stream-cursor\"></span>" : ""}</div>${message.events?.length ? `<div class="desktop-message-events" aria-label="Agent activity">${message.events.slice(-5).map(event => `<span>${escapeHtml(event)}</span>`).join("")}</div>` : ""}${role === "assistant" && message.content ? `<button class="message-copy" data-copy-message="${index}" aria-label="Copy assistant response">Copy</button>` : ""}</div></article>`; }).join("");
    globalThis.NTOXGlyphMotion?.mount(messages);
    messages.querySelectorAll("[data-copy-message]").forEach(button => button.addEventListener("click", async () => {
      const message = conversation.messages[Number(button.dataset.copyMessage)];
      try { await navigator.clipboard.writeText(message.content); button.textContent = "Copied"; window.setTimeout(() => { if (button.isConnected) button.textContent = "Copy"; }, 1200); }
      catch { button.textContent = "Copy unavailable"; }
    }));
    messages.scrollTop = messages.scrollHeight;
  }

  function updateStreamingMessage(conversation, assistantMessage) {
    if (activeId !== conversation.id) return;
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 88;
    const article = messages.querySelector("[data-streaming-message]");
    if (!article) return;
    const content = article.querySelector(".desktop-message-content");
    content.innerHTML = formatMessage(assistantMessage.content);
    if (pending) { const cursor = document.createElement("span"); cursor.className = "stream-cursor"; content.append(cursor); }
    let events = article.querySelector(".desktop-message-events");
    if (assistantMessage.events?.length) {
      if (!events) { events = document.createElement("div"); events.className = "desktop-message-events"; events.setAttribute("aria-label", "Agent activity"); article.querySelector(".desktop-message-body").append(events); }
      events.innerHTML = assistantMessage.events.slice(-5).map(event => `<span>${escapeHtml(event)}</span>`).join("");
    }
    if (assistantMessage.content && !article.querySelector(".message-copy")) {
      const copy = document.createElement("button");
      copy.className = "message-copy";
      copy.textContent = "Copy";
      copy.setAttribute("aria-label", "Copy assistant response");
      copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(assistantMessage.content); copy.textContent = "Copied"; } catch { copy.textContent = "Copy unavailable"; } });
      article.querySelector(".desktop-message-body").append(copy);
    }
    if (nearBottom) messages.scrollTop = messages.scrollHeight;
    else document.getElementById("desktop-jump-latest").hidden = false;
  }

  function render() { renderList(); renderMessages(); }

  let activeApproval = null;
  const approvalBar = document.getElementById("desktop-approval");
  const approvalCommand = document.getElementById("desktop-approval-command");
  const approvalTool = document.getElementById("desktop-approval-tool");
  const approvalNote = document.getElementById("desktop-approval-note");

  function hideApproval() {
    approvalBar.hidden = true;
    activeApproval = null;
    approvalNote.textContent = "Your agent is waiting. Nothing runs until you choose.";
  }

  function showApproval(data, conversation, assistantMessage) {
    if (data.expired || !data.id) { hideApproval(); return; }
    activeApproval = { id: String(data.id) };
    approvalTool.textContent = `APPROVAL NEEDED · ${String(data.toolName || "shell").toUpperCase()}`;
    approvalCommand.textContent = String(data.command || "");
    approvalNote.textContent = "Your agent is waiting. Nothing runs until you choose.";
    approvalBar.hidden = false;
    if (assistantMessage) {
      assistantMessage.events ||= [];
      assistantMessage.events.push(`Approval requested: ${String(data.command || "").slice(0, 100)}`);
      if (conversation && activeId === conversation.id) document.getElementById("desktop-generation-status").lastChild.textContent = " Waiting for your approval";
      updateStreamingMessage(conversation, assistantMessage);
    }
    saveSoon();
    approvalBar.scrollIntoView({ block: "nearest" });
  }

  approvalBar.querySelectorAll("[data-approval]").forEach(button => button.addEventListener("click", async () => {
    const request = activeApproval;
    if (!request) return;
    const decision = button.dataset.approval;
    button.disabled = true;
    approvalBar.querySelectorAll("[data-approval]").forEach(item => { item.disabled = true; });
    try {
      await window.ntoxDesktop.approve({ id: request.id, decision });
      hideApproval();
      const conversation = activeRequestConversation;
      const assistantMessage = conversation?.messages.at(-1);
      const label = decision === "deny" ? "Approval denied" : `Approval ${decision.replace("allow-", "")}`;
      if (assistantMessage && assistantMessage.role === "assistant") {
        assistantMessage.events ||= [];
        assistantMessage.events.push(`${label}: ${String(approvalCommand.textContent || "").slice(0, 100)}`);
        if (conversation && activeId === conversation.id) document.getElementById("desktop-generation-status").lastChild.textContent = ` ${label}`;
        saveSoon();
        updateStreamingMessage(conversation, assistantMessage);
      }
    } catch (error) {
      approvalNote.textContent = `Could not send that decision: ${cleanIpcError(error)}`;
    } finally {
      approvalBar.querySelectorAll("[data-approval]").forEach(item => { item.disabled = false; });
    }
  }));

  async function sendMessage(text) {
    const message = text.trim();
    if (!message || pending) return;
    if (!active()) newConversation();
    const conversation = active();
    conversation.messages.push({ role: "user", content: message });
    const assistantMessage = { role: "assistant", content: "" };
    let responseOutcome = "";
    conversation.messages.push(assistantMessage);
    if (conversation.title === "New conversation") conversation.title = message.length > 44 ? `${message.slice(0, 41)}…` : message;
    conversation.updatedAt = Date.now();
    input.value = "";
    input.style.height = "42px";
    pending = true;
    activeRequestId = crypto.randomUUID();
    const requestId = activeRequestId;
    activeRequestConversation = conversation;
    document.getElementById("desktop-stop").hidden = false;
    document.getElementById("desktop-generation-status").lastChild.textContent = " Generating response";
    save();
    render();
    try {
      if (!window.ntoxDesktop?.sendMessage) throw new Error("Open this workspace through the NTOX Desktop app to connect its local agent.");
      const response = await window.ntoxDesktop.sendMessage({ requestId, sessionId: `desktop_${conversation.id}`, message });
      if (!assistantMessage.content) assistantMessage.content = response;
    } catch (error) {
      const stopped = error.name === "AbortError" || document.getElementById("desktop-stop").classList.contains("desktop-stop-pending");
      const detail = stopped ? "" : cleanIpcError(error);
      responseOutcome = stopped ? "Response stopped." : detail ? `Response failed. ${detail}` : "Response failed. Check your local runtime connection.";
      const note = stopped ? "Response stopped." : detail ? `Response failed: ${detail}` : "Response failed. Check your local runtime connection.";
      assistantMessage.content = assistantMessage.content ? `${assistantMessage.content}\n\n[${note}]` : (detail || note);
    } finally {
      hideApproval();
      activeRequestId = "";
      activeRequestConversation = null;
      const stopButton = document.getElementById("desktop-stop");
      stopButton.hidden = true;
      stopButton.disabled = false;
      stopButton.classList.remove("desktop-stop-pending");
      stopButton.textContent = "Stop response";
      document.getElementById("desktop-generation-status").lastChild.textContent = activeId === conversation.id ? " Desktop history · provider may be remote" : " Response complete in another conversation";
      conversation.updatedAt = Date.now();
      pending = false;
      save();
      renderList();
      updateStreamingMessage(conversation, assistantMessage);
      syncChatControls(active());
      if (responseOutcome) document.getElementById("desktop-generation-status").lastChild.textContent = ` ${responseOutcome.slice(0, 220)}`;
      else if (activeId !== conversation.id) document.getElementById("desktop-generation-status").lastChild.textContent = ` Response complete: ${conversation.title}`;
      input.focus();
    }
  }

  window.ntoxDesktop?.onChatEvent(payload => {
    if (!pending || payload.requestId !== activeRequestId) return;
    const conversation = activeRequestConversation;
    const assistantMessage = conversation?.messages.at(-1);
    if (!assistantMessage || assistantMessage.role !== "assistant") return;
    if (payload.event === "approval") showApproval(payload.data || {}, conversation, assistantMessage);
    if (payload.event === "token") assistantMessage.content += payload.data?.text || "";
    if (payload.event === "event") {
      const data = payload.data || {};
      const label = data.type === "tool_call" ? `Using ${data.name}` : data.type === "tool_result" ? `${data.name}: ${data.success ? "complete" : "failed"}` : data.type === "phase" ? `Phase: ${data.phase}` : data.type === "memory" ? `Memory ${data.action}` : data.type === "usage" ? `Tokens: ${data.inputTokens || 0} in · ${data.outputTokens || 0} out` : "";
      if (label) { assistantMessage.events ||= []; assistantMessage.events.push(label); }
      if (label && activeId === conversation.id) document.getElementById("desktop-generation-status").lastChild.textContent = ` ${label}`;
    }
    saveSoon();
    updateStreamingMessage(conversation, assistantMessage);
  });

  document.getElementById("desktop-new-chat").addEventListener("click", newConversation);
  document.getElementById("desktop-stop").addEventListener("click", event => { if (!activeRequestId) return; event.currentTarget.disabled = true; event.currentTarget.classList.add("desktop-stop-pending"); event.currentTarget.textContent = "Stopping…"; document.getElementById("desktop-generation-status").lastChild.textContent = " Stopping response"; void Promise.resolve(window.ntoxDesktop.cancelMessage(activeRequestId)).catch(() => {}); });
  document.getElementById("desktop-clear-chat").addEventListener("click", () => { if (!active() || pending || !active().messages.length) return; if (!window.confirm("Clear all messages in this desktop conversation?")) return; active().messages = []; save(); render(); });
  document.getElementById("desktop-jump-latest").addEventListener("click", () => { messages.scrollTo({ top: messages.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); document.getElementById("desktop-jump-latest").hidden = true; });
  search.addEventListener("input", renderList);
  form.addEventListener("submit", event => { event.preventDefault(); void sendMessage(input.value); });
  input.addEventListener("input", () => { input.style.height = "42px"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; });
  input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(input.value); } });
  document.addEventListener("keydown", event => { if (document.getElementById("desktop-chat").classList.contains("chat-visible") && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); newConversation(); } });
  void Promise.resolve(restored).finally(() => { if (conversations.length) activeId = conversations[0].id; else newConversation(); render(); });
})();
