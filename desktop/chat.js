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
  const restored = window.ntoxDesktop?.loadConversations().then(saved => { if (Array.isArray(saved)) conversations = saved; }).catch(() => {});

  window.ntoxDesktop?.getRuntimeStatus().then(status => {
    const badge = document.querySelector(".desktop-runtime");
    if (badge) badge.innerHTML = `<i></i> ${status.connected ? "LOCAL RUNTIME READY" : "LOCAL RUNTIME STARTS ON FIRST MESSAGE"}`;
  }).catch(() => {});

  Promise.all([window.ntoxDesktop?.request({ route: "/api/agents" }), window.ntoxDesktop?.request({ route: "/api/memory?limit=1" })]).then(([agents, memory]) => {
    const roster = document.getElementById("desktop-context-agents");
    const total = document.getElementById("desktop-memory-count");
    if (roster) roster.innerHTML = (agents?.agents || []).slice(0, 5).map(agent => `<div class="context-agent"><i>${escapeHtml(agent.name.slice(0, 1))}</i><span><b>${escapeHtml(agent.name)}</b><small>${escapeHtml(agent.status)}</small></span><em></em></div>`).join("") || "No agents registered";
    if (total) total.textContent = `${memory?.total || 0} stored records`;
    const badge = document.querySelector(".desktop-runtime");
    if (badge) badge.innerHTML = "<i></i> LOCAL RUNTIME READY";
  }).catch(() => {});

  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const save = () => window.ntoxDesktop?.saveConversations(conversations.slice(0, 80)).catch(() => {});
  const active = () => conversations.find(conversation => conversation.id === activeId);

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
    const filtered = conversations.filter(conversation => conversation.title.toLowerCase().includes(query));
    list.innerHTML = filtered.length ? filtered.map(conversation => `<button class="desktop-conversation-item ${conversation.id === activeId ? "active" : ""}" data-conversation="${escapeHtml(conversation.id)}"><span>${escapeHtml(conversation.title)}</span><small>${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(conversation.updatedAt)}</small></button>`).join("") : `<div class="desktop-empty-list">${query ? "No matching conversations" : "No conversations yet"}</div>`;
    list.querySelectorAll("[data-conversation]").forEach(button => button.addEventListener("click", () => { activeId = button.dataset.conversation; render(); }));
  }

  function renderMessages() {
    const conversation = active();
    title.textContent = conversation?.title || "New conversation";
    if (!conversation || conversation.messages.length === 0) {
      messages.innerHTML = `<div class="desktop-welcome"><div class="desktop-welcome-mark">N</div><span class="eyebrow">YOUR LOCAL NTOX AGENT</span><h1>What are we<br>working on?</h1><p>This is the desktop agent's private chat. Its conversations are separate from the NTOX web app.</p><div class="desktop-suggestions"><button data-prompt="Give me a quick briefing of my NTOX workspace."><b>Workspace briefing</b><small>Summarize what needs attention</small></button><button data-prompt="Help me plan a multi-agent research task."><b>Plan with agents</b><small>Turn an idea into a coordinated task</small></button></div></div>`;
      messages.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => { input.value = button.dataset.prompt; input.focus(); }));
      return;
    }
    messages.innerHTML = conversation.messages.map(message => `<article class="desktop-message ${message.role}"><span class="desktop-message-avatar">${message.role === "user" ? "A" : "N"}</span><div class="desktop-message-body">${escapeHtml(message.content)}${pending && message === conversation.messages.at(-1) && message.role === "assistant" && !message.content ? "<span class=\"stream-cursor\"></span>" : ""}</div></article>`).join("");
    messages.scrollTop = messages.scrollHeight;
  }

  function render() { renderList(); renderMessages(); }

  async function sendMessage(text) {
    const message = text.trim();
    if (!message || pending) return;
    if (!active()) newConversation();
    const conversation = active();
    conversation.messages.push({ role: "user", content: message });
    const assistantMessage = { role: "assistant", content: "" };
    conversation.messages.push(assistantMessage);
    if (conversation.title === "New conversation") conversation.title = message.length > 44 ? `${message.slice(0, 41)}…` : message;
    conversation.updatedAt = Date.now();
    input.value = "";
    input.style.height = "42px";
    pending = true;
    activeRequestId = crypto.randomUUID();
    const requestId = activeRequestId;
    save();
    render();
    try {
      if (!window.ntoxDesktop?.sendMessage) throw new Error("Open this workspace through the NTOX Desktop app to connect its local agent.");
      const response = await window.ntoxDesktop.sendMessage({ requestId, sessionId: `desktop_${conversation.id}`, message });
      if (!assistantMessage.content) assistantMessage.content = response;
    } catch (error) {
      assistantMessage.content = error.message || "The local NTOX runtime is unavailable.";
    } finally {
      activeRequestId = "";
      conversation.updatedAt = Date.now();
      pending = false;
      save();
      render();
      input.focus();
    }
  }

  window.ntoxDesktop?.onChatEvent(payload => {
    if (!pending || payload.requestId !== activeRequestId) return;
    const conversation = active();
    const assistantMessage = conversation?.messages.at(-1);
    if (!assistantMessage || assistantMessage.role !== "assistant") return;
    if (payload.event === "token") assistantMessage.content += payload.data?.text || "";
    save();
    renderMessages();
  });

  document.getElementById("desktop-new-chat").addEventListener("click", newConversation);
  document.getElementById("desktop-clear-chat").addEventListener("click", () => { if (!active() || pending) return; active().messages = []; save(); render(); });
  search.addEventListener("input", renderList);
  form.addEventListener("submit", event => { event.preventDefault(); void sendMessage(input.value); });
  input.addEventListener("input", () => { input.style.height = "42px"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; });
  input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(input.value); } });
  document.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); newConversation(); } });
  void Promise.resolve(restored).finally(() => { if (conversations.length) activeId = conversations[0].id; else newConversation(); render(); });
})();
