(() => {
  "use strict";

  const app = document.querySelector(".app");
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  const storedToken = sessionStorage.getItem("ntox_token");
  let authToken = urlToken || storedToken || "";
  if (urlToken) sessionStorage.setItem("ntox_token", urlToken);

  const socket = io({ transports: ["websocket", "polling"], auth: { token: authToken } });

  const messages = document.getElementById("messages");
  const empty = document.getElementById("empty");
  const thread = document.getElementById("thread");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const sendIcon = document.getElementById("send-icon");
  const mic = document.getElementById("mic");
  const form = document.getElementById("form");
  const activity = document.getElementById("activity");
  const chatList = document.getElementById("chat-list");
  const phasePill = document.getElementById("phase-pill");
  const memoryPill = document.getElementById("memory-pill");
  const usagePill = document.getElementById("usage-pill");
  const statusDot = document.getElementById("status-dot");
  const statusTitle = document.getElementById("status-title");
  const statusSubtitle = document.getElementById("status-subtitle");
  const side = document.getElementById("side");
  const hintLeft = document.getElementById("hint-left");
  const drawer = document.getElementById("drawer");
  const drawerBody = document.getElementById("drawer-body");
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  const drawerTabs = document.getElementById("drawer-tabs");

  let sessionId = localStorage.getItem("ntox_session_id") || "";
  let chats = [];
  let pending = false;
  let current = null;
  let currentText = "";
  let renderQueued = false;
  let drawerOpen = false;
  let drawerTab = "why";
  let lastTrace = null;
  let lastWhy = null;
  let lastChanges = [];
  let lastMemory = null;
  let lastBeliefs = null;
  let retryAfterApprove = false;
  const openToolCards = new Map();
  const CODE_MARK = "\uE000";

  const SEND_ICON = '<path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2Z"/>';
  const STOP_ICON = '<rect x="6" y="6" width="12" height="12" rx="1"/>';

  const savedTheme = localStorage.getItem("ntox_theme");
  if (savedTheme === "dark" || savedTheme === "light") app.dataset.theme = savedTheme;
  else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) app.dataset.theme = "dark";

  function escapeHtml(text) {
    const node = document.createElement("div");
    node.textContent = text == null ? "" : String(text);
    return node.innerHTML;
  }

  function renderInline(raw) {
    const codes = [];
    let s = escapeHtml(raw);
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return CODE_MARK + (codes.length - 1) + CODE_MARK;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
      if (/^javascript:/i.test(u)) return t;
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + "</a>";
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    const markRe = new RegExp(CODE_MARK + "(\\d+)" + CODE_MARK, "g");
    s = s.replace(markRe, function (_, i) {
      return "<code>" + codes[Number(i)] + "</code>";
    });
    return s;
  }

  const HL_KEYWORDS = {
    js: "const let var function return if else for while do class extends new async await import export from default try catch finally throw typeof instanceof of in this null undefined true false yield delete void static get set super",
    ts: "const let var function return if else for while do class extends new async await import export from default try catch finally throw typeof instanceof of in this null undefined true false yield delete void static get set interface type enum implements declare readonly private public protected as super",
    jsx: "const let var function return if else for while do class new async await import export from default try catch throw typeof of in this null undefined true false",
    tsx: "const let var function return if else for while do class new async await import export from default try catch throw typeof of in this null undefined true false interface type as",
    python: "def class return if elif else for while import from as with try except finally raise lambda None True False and or not in is pass yield async await global nonlocal assert del exec print",
    py: "def class return if elif else for while import from as with try except finally raise lambda None True False and or not in is pass yield async await global nonlocal assert del exec print",
    bash: "if then else elif fi for while do done case esac function in select until echo exit return local export alias cd source",
    sh: "if then else elif fi for while do done case esac function in select until echo exit return local export alias cd source",
    shell: "if then else elif fi for while do done case esac function in select until echo exit return local export alias cd source",
    json: "true false null",
    go: "func return if else for range switch case default package import struct interface map chan go defer var const type break continue fallthrough select",
    rust: "fn let mut return if else for while match struct enum impl trait pub use mod const static move ref loop break continue as in",
    java: "public private protected class interface extends implements return if else for while new try catch finally throw throws static final void int String import package",
    c: "int void char float double return if else for while struct typedef enum union static const sizeof extern",
  };
  const HL_ALIASES = { javascript: "js", typescript: "ts", python: "python", "c++": "c", cpp: "c" };
  const HASH_COMMENT_LANGS = ["python", "py", "bash", "sh", "shell", "yaml", "yml", "rb", "ruby", "toml"];

  function highlightCode(code, lang) {
    const esc = escapeHtml(code);
    const raw = (lang || "").toLowerCase();
    const key = HL_ALIASES[raw] || raw;
    const words = HL_KEYWORDS[key];
    const kwRe = words ? "\\b(?:" + words.split(" ").join("|") + ")\\b" : "(?:^)\\uE0FF";
    let commentRe;
    if (HASH_COMMENT_LANGS.includes(key)) commentRe = "#[^\\n]*";
    else if (key && HL_KEYWORDS[key]) commentRe = "\\/\\/[^\\n]*|\\/\\*[^\\n]*?\\*\\/";
    else commentRe = "#[^\\n]*|\\/\\/[^\\n]*";
    const re = new RegExp(
      '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\\\n]|\\\\.)*`)' +
        "|(" +
        commentRe +
        ")" +
        "|(" +
        kwRe +
        ")" +
        "|\\b(\\d+(?:\\.\\d+)?)\\b" +
        "|\\b([A-Za-z_$][\\w$]*)(?=\\s*\\()",
      "g",
    );
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(esc)) !== null) {
      out += esc.slice(last, m.index);
      if (m[1] !== undefined) out += '<span class="tk-s">' + m[1] + "</span>";
      else if (m[2] !== undefined) out += '<span class="tk-c">' + m[2] + "</span>";
      else if (m[3] !== undefined && m[3]) out += '<span class="tk-k">' + m[3] + "</span>";
      else if (m[4] !== undefined) out += '<span class="tk-n">' + m[4] + "</span>";
      else if (m[5] !== undefined) out += '<span class="tk-f">' + m[5] + "</span>";
      else out += m[0];
      last = re.lastIndex;
      if (m[0] === "") re.lastIndex++;
    }
    out += esc.slice(last);
    return out;
  }

  function codeBlockHtml(lang, code) {
    const label = escapeHtml(lang || "code");
    const lines = highlightCode(code, lang).split("\n");
    const body = lines
      .map(function (line) {
        return '<span class="cl">' + (line || " ") + "</span>";
      })
      .join("");
    return (
      '<div class="codeblock">' +
      '<div class="codeblock-bar"><span>' +
      label +
      '</span><span class="cb-actions">' +
      '<button type="button" class="copy-btn" data-copy-code>Copy</button>' +
      '<button type="button" class="expand-btn" data-expand-code>Expand</button>' +
      "</span></div>" +
      "<pre><code>" +
      body +
      "</code></pre></div>"
    );
  }

  function renderMarkdown(src) {
    const text = String(src || "").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const out = [];
    let para = [];
    let i = 0;

    function flushPara() {
      if (!para.length) return;
      out.push("<p>" + renderInline(para.join("\n")).replace(/\n/g, "<br>") + "</p>");
      para = [];
    }

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^```(\S*)/);
      if (fence) {
        flushPara();
        const lang = fence[1] || "";
        const code = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        out.push(codeBlockHtml(lang, code.join("\n")));
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushPara();
        out.push("<h" + heading[1].length + ">" + renderInline(heading[2]) + "</h" + heading[1].length + ">");
        i++;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushPara();
        out.push("<hr>");
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        flushPara();
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + renderInline(quote.join(" ")) + "</blockquote>");
        continue;
      }

      if (/^\s*\|.*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        flushPara();
        function cells(row) {
          return row
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map(function (c) {
              return c.trim();
            });
        }
        const header = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) {
          rows.push(cells(lines[i]));
          i++;
        }
        let table = "<table><thead><tr>";
        header.forEach(function (h) {
          table += "<th>" + renderInline(h) + "</th>";
        });
        table += "</tr></thead><tbody>";
        rows.forEach(function (r) {
          table += "<tr>";
          r.forEach(function (c) {
            table += "<td>" + renderInline(c) + "</td>";
          });
          table += "</tr>";
        });
        table += "</tbody></table>";
        out.push(table);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push("<li>" + renderInline(lines[i].replace(/^\s*[-*+]\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ul>" + items.join("") + "</ul>");
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        flushPara();
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push("<li>" + renderInline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ol>" + items.join("") + "</ol>");
        continue;
      }

      if (line.trim() === "") {
        flushPara();
        i++;
        continue;
      }

      para.push(line);
      i++;
    }
    flushPara();
    return out.join("\n");
  }

  function setStatus(kind, title, subtitle) {
    statusDot.className = "status-dot " + kind;
    statusTitle.textContent = title;
    statusSubtitle.textContent = subtitle;
  }

  function scrollDown() {
    thread.scrollTop = thread.scrollHeight;
  }

  function hideEmpty() {
    if (empty) empty.hidden = true;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  function addActionButtons(article, role, text) {
    const existing = article.querySelector(".msg-actions");
    if (existing) existing.remove();
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "msg-btn";
    copy.textContent = "Copy";
    copy.addEventListener("click", function () {
      navigator.clipboard.writeText(text).then(function () {
        copy.textContent = "Copied";
        setTimeout(function () {
          copy.textContent = "Copy";
        }, 1200);
      });
    });
    actions.appendChild(copy);

    if (role === "assistant") {
      const speak = document.createElement("button");
      speak.type = "button";
      speak.className = "msg-btn";
      speak.textContent = "Speak";
      speak.title = "Read this reply aloud";
      speak.addEventListener("click", function () {
        if (speakButton || !text.trim()) return;
        speakButton = speak;
        speak.disabled = true;
        speak.textContent = "…";
        socket.emit("tts", { text: text });
      });
      actions.appendChild(speak);

      const why = document.createElement("button");
      why.type = "button";
      why.className = "msg-btn";
      why.textContent = "Why";
      why.title = "Why this answer — memories, skills, strategy";
      why.addEventListener("click", function () {
        socket.emit("get_trace");
        openDrawer("why");
      });
      actions.appendChild(why);

      const regen = document.createElement("button");
      regen.type = "button";
      regen.className = "msg-btn";
      regen.textContent = "Regenerate";
      regen.disabled = pending || !sessionId;
      regen.addEventListener("click", function () {
        regenerate();
      });
      actions.appendChild(regen);
    }

    if (role === "user") {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "msg-btn";
      edit.textContent = "Edit";
      edit.disabled = pending;
      edit.addEventListener("click", function () {
        startEditUser(article, text);
      });
      actions.appendChild(edit);
    }

    article.querySelector(".bubble").appendChild(actions);
  }

  function addMessage(role, text, opts) {
    const options = opts || {};
    if (!options.keepEmpty) hideEmpty();
    const wrap = document.createElement("article");
    wrap.className = "message " + role;
    const who = role === "user" ? "You" : "NTOX";
    const avatar = role === "user" ? "Y" : "N";
    wrap.innerHTML =
      '<div class="avatar">' +
      avatar +
      '</div><div class="bubble"><div class="meta"><strong>' +
      who +
      "</strong><span>" +
      fmtTime(options.timestamp || Date.now()) +
      '</span></div><div class="content"></div></div>';
    const content = wrap.querySelector(".content");
    if (role === "assistant") content.innerHTML = renderMarkdown(text || "");
    else content.textContent = text || "";
    if (!options.noActions) addActionButtons(wrap, role, text || "");
    messages.appendChild(wrap);
    if (!options.noScroll) scrollDown();
    return wrap;
  }

  function beginTurn(text) {
    hideEmpty();
    addMessage("user", text);
    currentText = "";
    current = null;
    phasePill.textContent = "queued";
  }

  function ensureAssistantBubble() {
    if (current) return current;
    hideEmpty();
    current = addMessage("assistant", "", { noActions: true });
    const content = current.querySelector(".content");
    content.classList.add("cursor");
    content.innerHTML = "";
    return current;
  }

  function scheduleAssistantRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      if (!current) return;
      const content = current.querySelector(".content");
      content.innerHTML = renderMarkdown(currentText);
      if (pending) content.classList.add("cursor");
      scrollDown();
    });
  }

  function finalizeAssistant(fullText) {
    if (!current) {
      if (fullText) {
        current = ensureAssistantBubble();
      } else {
        setPending(false);
        phasePill.textContent = "idle";
        return;
      }
    }
    currentText = fullText || currentText;
    const content = current.querySelector(".content");
    content.innerHTML = renderMarkdown(currentText);
    content.classList.remove("cursor");
    addActionButtons(current, "assistant", currentText);
    current = null;
    setPending(false);
    phasePill.textContent = "idle";
    scrollDown();
  }

  function toolSummary(name, args) {
    if (!args) return "";
    if (typeof args.command === "string") return args.command;
    const path = args.path || args.filePath;
    if (typeof path === "string") return path;
    if (typeof args.url === "string") return args.url;
    if (typeof args.query === "string") return args.query;
    if (typeof args.task === "string") return args.task;
    return "";
  }

  function addToolCard(name, args) {
    hideEmpty();
    ensureAssistantBubble();
    const card = document.createElement("div");
    card.className = "tool-card";
    card.innerHTML =
      '<button type="button" class="tool-card-head">' +
      '<span class="dot"></span>' +
      '<span class="tool-name"></span>' +
      '<span class="tool-summary"></span>' +
      '<span class="tool-status">running</span>' +
      "</button>" +
      '<div class="tool-card-body" hidden><pre></pre></div>';
    card.querySelector(".tool-name").textContent = name;
    card.querySelector(".tool-summary").textContent = toolSummary(name, args);

    const list = openToolCards.get(name) || [];
    list.push(card);
    openToolCards.set(name, list);

    card.querySelector(".tool-card-head").addEventListener("click", function () {
      const body = card.querySelector(".tool-card-body");
      body.hidden = !body.hidden;
    });
    if (args && Object.keys(args).length) {
      card.querySelector("pre").textContent = JSON.stringify(args, null, 2);
    }

    if (current && current.parentNode === messages) {
      messages.insertBefore(card, current.nextSibling);
    } else {
      messages.appendChild(card);
    }
    scrollDown();
    return card;
  }

  function resolveToolCard(name, success, error) {
    const list = openToolCards.get(name);
    if (!list || !list.length) return;
    const card = list.shift();
    card.classList.add(success ? "ok" : "fail");
    card.querySelector(".tool-status").textContent = success ? "ok" : "failed";
    if (error) {
      const body = card.querySelector(".tool-card-body");
      body.hidden = false;
      const pre = body.querySelector("pre");
      pre.textContent = (pre.textContent ? pre.textContent + "\n\n" : "") + error;
    }
  }

  function addActivity(html, tone) {
    const row = document.createElement("div");
    row.className = "event " + (tone || "");
    row.innerHTML = html;
    activity.prepend(row);
    while (activity.children.length > 30) activity.lastElementChild.remove();
  }

  function eventLabel(event) {
    if (event.type === "phase") return "<strong>" + escapeHtml(event.phase || "phase") + "</strong>";
    if (event.type === "tool_call") return "<strong>tool</strong> " + escapeHtml(event.name || "");
    if (event.type === "tool_result")
      return (
        "<strong>" +
        (event.success ? "tool ok" : "tool failed") +
        "</strong> " +
        escapeHtml(event.name || "")
      );
    if (event.type === "memory")
      return "<strong>memory</strong> " + escapeHtml(event.action || "") + " " + (event.count || "");
    if (event.type === "strategy") return "<strong>strategy</strong> " + escapeHtml(event.strategy || "");
    if (event.type === "skill") return "<strong>skill</strong> " + escapeHtml(event.skillName || "");
    if (event.type === "correction") return "<strong>correction</strong> " + escapeHtml(event.topicKey || "");
    if (event.type === "alive") return "<strong>alive</strong> " + escapeHtml((event.action && event.action.kind) || "action");
    if (event.type === "usage")
      return (
        "<strong>usage</strong> " +
        fmtTokens(event.inputTokens || 0) +
        " in · " +
        fmtTokens(event.outputTokens || 0) +
        " out"
      );
    return "<strong>event</strong> " + escapeHtml(event.type || "");
  }

  function setReady(ready) {
    if (mic) mic.disabled = !ready;
    if (pending) {
      input.disabled = true;
      send.disabled = false;
      send.classList.add("stop");
      send.title = "Stop";
      send.setAttribute("aria-label", "Stop");
      sendIcon.innerHTML = STOP_ICON;
      if (mic) mic.disabled = false;
      return;
    }
    input.disabled = !ready;
    send.disabled = !ready;
    send.classList.remove("stop");
    send.title = "Send";
    send.setAttribute("aria-label", "Send");
    sendIcon.innerHTML = SEND_ICON;
    if (ready) input.focus();
  }

  function setPending(value) {
    pending = value;
    setReady(socket.connected);
  }

  function ensureSessionId() {
    if (sessionId && /^conv_[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) return sessionId;
    sessionId = "conv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ntox_session_id", sessionId);
    return sessionId;
  }

  function joinSession(id) {
    sessionId = id;
    localStorage.setItem("ntox_session_id", sessionId);
    if (socket.connected) socket.emit("join", { sessionId: sessionId });
  }

  function clearThread() {
    Array.prototype.forEach.call(messages.querySelectorAll(".message, .tool-card, .approval-card"), function (n) {
      n.remove();
    });
    usagePill.hidden = true;
    current = null;
    currentText = "";
    openToolCards.clear();
    lastTrace = null;
    lastWhy = null;
    lastChanges = [];
    if (drawerOpen) renderDrawer();
  }

  function newChat() {
    if (pending) return;
    const id = "conv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    joinSession(id);
    clearThread();
    if (empty) {
      if (!empty.parentNode) messages.appendChild(empty);
      empty.hidden = false;
    }
    renderChatList();
    side.classList.remove("open");
    input.focus();
  }

  function timeAgo(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  function renderChatList() {
    if (!chats.length) {
      chatList.innerHTML = '<div class="chat-empty">No chats yet</div>';
      return;
    }
    chatList.innerHTML = "";
    chats.forEach(function (conv) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chat-item" + (conv.id === sessionId ? " active" : "");
      item.innerHTML =
        '<span class="chat-title"></span>' +
        '<span class="chat-time">' +
        timeAgo(conv.updatedAt) +
        "</span>" +
        '<span class="chat-actions">' +
        '<span class="chat-mini rename" title="Rename" role="button" tabindex="0">' +
        '<svg viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>' +
        '<span class="chat-mini danger delete" title="Delete" role="button" tabindex="0">' +
        '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>' +
        "</span>";
      item.querySelector(".chat-title").textContent = conv.title || "New chat";

      item.addEventListener("click", function (e) {
        if (e.target.closest(".chat-mini")) return;
        if (conv.id === sessionId || pending) return;
        clearThread();
        joinSession(conv.id);
        renderChatList();
        side.classList.remove("open");
      });

      item.querySelector(".rename").addEventListener("click", function (e) {
        e.stopPropagation();
        startRename(item, conv);
      });
      item.querySelector(".delete").addEventListener("click", function (e) {
        e.stopPropagation();
        socket.emit("delete_chat", { sessionId: conv.id });
        if (conv.id === sessionId) newChat();
      });

      chatList.appendChild(item);
    });
  }

  function startRename(item, conv) {
    const titleEl = item.querySelector(".chat-title");
    if (!titleEl || item.querySelector(".chat-rename-input")) return;
    const edit = document.createElement("input");
    edit.className = "chat-rename-input";
    edit.value = conv.title || "";
    titleEl.replaceWith(edit);
    edit.focus();
    edit.select();
    let saved = false;
    const save = function () {
      if (saved) return;
      saved = true;
      const next = edit.value.trim();
      if (next && next !== conv.title) {
        socket.emit("rename_chat", { sessionId: conv.id, title: next });
      } else {
        renderChatList();
      }
    };
    edit.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") save();
      if (e.key === "Escape") {
        saved = true;
        renderChatList();
      }
    });
    edit.addEventListener("blur", save);
  }

  function applyHistory(data) {
    clearThread();
    const msgs = (data && data.messages) || [];
    if (!msgs.length) {
      if (empty) {
        if (!empty.parentNode) messages.appendChild(empty);
        empty.hidden = false;
      }
      return;
    }
    hideEmpty();
    msgs.forEach(function (m) {
      addMessage(m.role, m.content, { timestamp: m.timestamp, noScroll: true });
    });
    scrollDown();
  }

  function submit(text) {
    const value = (text || input.value).trim();
    if (!value || pending || socket.disconnected) return;
    ensureSessionId();
    input.value = "";
    autosize();
    setPending(true);
    beginTurn(value);
    socket.emit("message", value);
  }

  function regenerate() {
    if (pending || !sessionId) return;
    setPending(true);
    Array.prototype.forEach.call(messages.querySelectorAll(".message.assistant, .tool-card, .approval-card"), function (n) {
      n.remove();
    });
    current = null;
    currentText = "";
    hintLeft.textContent = "";
    retryAfterApprove = false;
    socket.emit("regenerate");
  }

  function startEditUser(article, originalText) {
    if (pending) return;
    const content = article.querySelector(".content");
    const actions = article.querySelector(".msg-actions");
    if (actions) actions.style.display = "none";
    const prev = content.textContent;
    content.textContent = "";
    const ta = document.createElement("textarea");
    ta.className = "user-edit";
    ta.value = originalText;
    const row = document.createElement("div");
    row.className = "user-edit-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "prompt";
    save.textContent = "Send edit";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "prompt";
    cancel.textContent = "Cancel";
    row.appendChild(save);
    row.appendChild(cancel);
    content.appendChild(ta);
    content.appendChild(row);
    ta.focus();

    const restore = function () {
      content.textContent = prev;
      if (actions) actions.style.display = "";
    };
    cancel.addEventListener("click", restore);
    save.addEventListener("click", function () {
      const next = ta.value.trim();
      if (!next || next === originalText) {
        restore();
        return;
      }
      if (pending) return;
      if (actions) actions.style.display = "";
      content.textContent = next;
      setPending(true);
      Array.prototype.forEach.call(messages.querySelectorAll(".message.assistant, .tool-card"), function (n) {
        n.remove();
      });
      current = null;
      currentText = "";
      hintLeft.textContent = "";
      socket.emit("regenerate", { text: next });
    });
  }

  function stop() {
    if (!pending) return;
    socket.emit("stop");
    hintLeft.textContent = "stopping…";
  }

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizing = false;
  let recognition = null;
  let mediaRecorder = null;
  let mediaChunks = [];
  let speakButton = null;
  let speaking = null;

  function setListening(value) {
    recognizing = value;
    if (!mic) return;
    mic.classList.toggle("listening", value);
    mic.setAttribute("aria-pressed", value ? "true" : "false");
    mic.title = value ? "Stop listening" : "Voice input";
  }

  function voiceError(message) {
    addActivity("<strong>voice</strong> " + escapeHtml(message), "fail");
  }

  function finishRecognition() {
    setListening(false);
    recognition = null;
    if (input.value.trim()) {
      input.focus();
      autosize();
    }
  }

  function startRecognition() {
    recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    const base = input.value ? input.value.replace(/\s+$/, "") + " " : "";
    recognition.onresult = function (event) {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      input.value = base + transcript;
      autosize();
    };
    recognition.onerror = function (event) {
      finishRecognition();
      if (event.error && event.error !== "no-speech" && event.error !== "aborted") {
        voiceError("recognition failed: " + event.error);
      }
    };
    recognition.onend = finishRecognition;
    recognition.start();
    setListening(true);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    setListening(false);
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      voiceError("recording is not supported in this browser");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        mediaChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = function (event) {
          if (event.data && event.data.size) mediaChunks.push(event.data);
        };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (track) {
            track.stop();
          });
          const mimeType = mediaRecorder.mimeType || "audio/webm";
          mediaRecorder = null;
          const blob = new Blob(mediaChunks, { type: mimeType });
          mediaChunks = [];
          if (!blob.size) {
            voiceError("no audio captured");
            return;
          }
          hintLeft.textContent = "transcribing…";
          const reader = new FileReader();
          reader.onload = function () {
            socket.emit("stt", { audio: String(reader.result), mimeType: blob.type });
          };
          reader.onerror = function () {
            hintLeft.textContent = "";
            voiceError("could not read the recording");
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        setListening(true);
      })
      .catch(function () {
        voiceError("microphone access was denied");
      });
  }

  if (mic) {
    mic.disabled = true;
    mic.addEventListener("click", function () {
      if (recognizing) {
        if (recognition) recognition.stop();
        else stopRecording();
        return;
      }
      if (SpeechRecognitionCtor) startRecognition();
      else startRecording();
    });
  }

  function pct(n) {
    return Math.round((Number(n) || 0) * 100) + "%";
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function openDrawer(tab) {
    if (tab) drawerTab = tab;
    drawerOpen = true;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    if (window.matchMedia("(max-width:860px)").matches) drawerBackdrop.hidden = false;
    syncDrawerTabs();
    requestDrawerData();
    renderDrawer();
  }

  function closeDrawer() {
    drawerOpen = false;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    drawerBackdrop.hidden = true;
  }

  function syncDrawerTabs() {
    Array.prototype.forEach.call(drawerTabs.querySelectorAll("button"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === drawerTab);
    });
  }

  function requestDrawerData() {
    if (!socket.connected) return;
    if (drawerTab === "why" || drawerTab === "trace") socket.emit("get_trace");
    if (drawerTab === "files") socket.emit("get_changes");
    if (drawerTab === "memory") socket.emit("get_memory");
    if (drawerTab === "beliefs") socket.emit("get_beliefs");
  }

  function section(title, inner) {
    return '<div class="dsec"><h4>' + escapeHtml(title) + "</h4>" + inner + "</div>";
  }

  function row(label, value) {
    return (
      '<div class="drow"><span>' +
      escapeHtml(label) +
      "</span><span>" +
      escapeHtml(value == null || value === "" ? "—" : String(value)) +
      "</span></div>"
    );
  }

  function renderWhyTab() {
    const w = lastWhy;
    if (!w) {
      return '<p class="empty-note">No turn inspected yet. Send a message, then open Why.</p>';
    }
    let html = "";
    html += section(
      "Decision",
      row("Mode", w.responseMode) +
        row("Strategy", w.strategy) +
        row("Duration", w.durationMs != null ? w.durationMs + " ms" : null) +
        row("Retries", w.retries) +
        row("Search", w.searchUsed ? "used" : "not used"),
    );
    let reasoning = row("Memories recalled", w.memoryRecallCount);
    if (w.skill) reasoning += row("Skill", w.skill.name + " (" + pct(w.skill.confidence) + ")");
    if (w.theoryReason) reasoning += row("Theory", w.theoryReason);
    if (w.cognitiveSummary) reasoning += row("Cognition", w.cognitiveSummary);
    html += section("Reasoning sources", reasoning);
    if (w.blockedReason) html += section("Blocked", row("Reason", w.blockedReason));
    if (w.error) html += section("Error", row("Message", w.error));
    if (w.droppedContextSections && w.droppedContextSections.length) {
      html += section(
        "Dropped from context",
        '<div class="chips">' +
          w.droppedContextSections
            .map(function (s) {
              return '<span class="chip warn">' + escapeHtml(s) + "</span>";
            })
            .join("") +
          "</div>",
      );
    }
    if (w.contextBudget) {
      const b = w.contextBudget;
      html += section(
        "Context budget (tokens)",
        row("System", b.system) +
          row("Mode", b.mode) +
          row("User", b.user) +
          row("Skills", b.skills) +
          row("Memory", b.memory) +
          row("Cognition", b.cognition) +
          row("Theory", b.theory) +
          row("Mistakes", b.mistakes) +
          row("Tool results", b.toolResults) +
          row("Total", b.total),
      );
    }
    return html;
  }

  function renderTraceTab() {
    const t = lastTrace;
    if (!t) {
      return '<p class="empty-note">No trace yet. Complete a turn, then reopen Trace.</p>';
    }
    let html = section(
      "Turn",
      row("Mode", t.responseMode) +
        row("Strategy", t.strategy) +
        row("Started", fmtDate(t.startedAt)) +
        row("Response length", t.finalResponseLength != null ? t.finalResponseLength + " chars" : null) +
        row("Retries", t.retries) +
        row("Memory recalls", t.memoryRecallCount),
    );
    if (t.workspaceProfile) {
      html += section(
        "Workspace",
        row("Profile", t.workspaceProfile.name) + row("Root", t.workspaceProfile.workspaceRoot),
      );
    }
    const tools = t.toolCalls || [];
    if (tools.length) {
      const items = tools
        .map(function (call) {
          const status = call.success === false ? "fail" : call.success ? "ok" : "?";
          return (
            '<div class="drow"><span>' +
            escapeHtml(call.name) +
            (call.durationMs != null ? " · " + call.durationMs + "ms" : "") +
            '</span><span class="chip ' +
            (status === "ok" ? "ok" : status === "fail" ? "warn" : "") +
            '">' +
            status +
            (call.reason ? " · " + escapeHtml(call.reason) : "") +
            "</span></div>" +
            (call.error ? '<div class="drow"><span>error</span><span>' + escapeHtml(call.error) + "</span></div>" : "")
          );
        })
        .join("");
      html += section("Tools (" + tools.length + ")", items);
    } else {
      html += section("Tools", '<p class="empty-note">No tool calls this turn.</p>');
    }
    const policy = t.policyDecisions || [];
    if (policy.length) {
      html += section(
        "Policy (" + policy.length + ")",
        policy
          .slice(-12)
          .map(function (p) {
            return (
              '<div class="drow"><span>' +
              escapeHtml(p.tool) +
              (p.path ? " · " + escapeHtml(p.path.split(/[\\/]/).pop() || p.path) : "") +
              '</span><span class="chip ' +
              (p.allowed ? "ok" : "warn") +
              '">' +
              (p.allowed ? "allow" : "deny") +
              "</span></div>"
            );
          })
          .join(""),
      );
    }
    if (t.checkpointIds && t.checkpointIds.length) {
      html += section(
        "Checkpoints",
        '<div class="chips">' +
          t.checkpointIds
            .map(function (id) {
              return '<span class="chip">' + escapeHtml(id) + "</span>";
            })
            .join("") +
          "</div>",
      );
    }
    if (t.error) html += section("Error", row("Message", t.error));
    return html;
  }

  function renderFilesTab() {
    if (!lastChanges || !lastChanges.length) {
      return '<p class="empty-note">No file changes in the last turn.</p>';
    }
    const checkpointByPath = {};
    if (lastTrace && lastTrace.toolCalls) {
      lastTrace.toolCalls.forEach(function (call) {
        if (call.autoCheckpointId) {
          const p = call.args && (call.args.filePath || call.args.path);
          if (typeof p === "string") checkpointByPath[p] = call.autoCheckpointId;
        }
      });
    }
    return lastChanges
      .map(function (change) {
        const base = change.path.split(/[\\/]/).pop() || change.path;
        const lines = (change.lines || [])
          .map(function (l) {
            const prefix = l.type === "del" ? "-" : l.type === "add" ? "+" : " ";
            return (
              '<div class="diff-line ' +
              escapeHtml(l.type) +
              '">' +
              escapeHtml(prefix + l.text) +
              "</div>"
            );
          })
          .join("");
        const cp = checkpointByPath[change.path];
        return (
          '<div class="diff">' +
          '<div class="diff-head"><span title="' +
          escapeHtml(change.path) +
          '">' +
          escapeHtml(base) +
          ' · ' +
          escapeHtml(change.action) +
          "</span>" +
          (cp
            ? '<button type="button" class="mini-btn danger" data-rollback="' +
              escapeHtml(cp) +
              '">Rollback</button>'
            : "") +
          "</div>" +
          '<div class="diff-body">' +
          lines +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderMemoryTab() {
    if (!lastMemory) {
      return '<p class="empty-note">Loading memory…</p>';
    }
    const stats = lastMemory.stats || {};
    let html = section(
      "Stats",
      row("Episodes", stats.totalEpisodes) + row("Sessions", stats.totalSessions) + row("Durable", (lastMemory.durable || []).length),
    );
    const durable = lastMemory.durable || [];
    if (!durable.length) {
      html += '<p class="empty-note">No durable memories yet. Use <code>/remember</code> in chat or wait for NTOX to learn one.</p>';
      return html;
    }
    html += durable
      .map(function (m) {
        const hist = (m.history || [])
          .slice(-3)
          .map(function (h) {
            return (
              "<li>" +
              escapeHtml(fmtDate(h.timestamp)) +
              " — " +
              escapeHtml(h.reason) +
              ": " +
              escapeHtml(h.text) +
              "</li>"
            );
          })
          .join("");
        return (
          '<div class="mem-item" data-mem="' +
          escapeHtml(m.id) +
          '">' +
          '<div class="mem-meta"><span class="chip">' +
          escapeHtml(m.lane) +
          '</span><span>' +
          pct(m.confidence) +
          " conf</span>" +
          (m.contradictionCount ? '<span class="chip warn">' + m.contradictionCount + " contradictions</span>" : "") +
          "</div>" +
          '<p class="mem-text">' +
          escapeHtml(m.text) +
          "</p>" +
          (hist ? '<details><summary class="mem-meta">history</summary><ul class="mem-text">' + hist + "</ul></details>" : "") +
          '<div class="belief-actions">' +
          '<button type="button" class="mini-btn" data-mem-edit="' +
          escapeHtml(m.id) +
          '">Edit</button>' +
          '<button type="button" class="mini-btn danger" data-mem-del="' +
          escapeHtml(m.id) +
          '">Delete</button>' +
          "</div></div>"
        );
      })
      .join("");
    return html;
  }

  function renderBeliefsTab() {
    if (!lastBeliefs) {
      return '<p class="empty-note">Loading beliefs…</p>';
    }
    let html = "";
    const st = lastBeliefs.stats || {};
    html += section(
      "Theory store",
      row("Observations", st.totalObservations) +
        row("Patterns", st.totalPatterns) +
        row("Theories", st.totalTheories) +
        row("Confirmed", st.confirmedTheories) +
        row("Meta-theories", st.totalMetaTheories),
    );
    const theories = lastBeliefs.theories || [];
    if (!theories.length) {
      html += '<p class="empty-note">No theories yet. They emerge from repeated observations across sessions.</p>';
    } else {
      html += theories
        .map(function (t) {
          return (
            '<div class="belief">' +
            '<div class="belief-top"><span class="belief-name">' +
            escapeHtml(t.name) +
            '</span><span class="belief-conf">' +
            pct(t.confidence) +
            (t.confirmed ? " · confirmed" : "") +
            "</span></div>" +
            '<div class="bar"><i style="width:' +
            Math.round((t.confidence || 0) * 100) +
            '%"></i></div>' +
            '<p class="belief-desc">' +
            escapeHtml(t.explanation) +
            "</p>" +
            '<div class="mem-meta">' +
            t.evidenceCount +
            " evidence · " +
            escapeHtml(fmtDate(t.timestamp)) +
            "</div>" +
            '<div class="belief-actions">' +
            '<button type="button" class="mini-btn ok" data-theory="' +
            escapeHtml(t.id) +
            '" data-vote="confirm">Confirm</button>' +
            '<button type="button" class="mini-btn danger" data-theory="' +
            escapeHtml(t.id) +
            '" data-vote="reject">Reject</button>' +
            "</div></div>"
          );
        })
        .join("");
    }
    const patterns = lastBeliefs.patterns || [];
    if (patterns.length) {
      html += section(
        "Cognitive patterns (" + patterns.length + ")",
        patterns
          .slice(0, 20)
          .map(function (p) {
            return (
              '<div class="belief">' +
              '<div class="belief-top"><span class="belief-name">' +
              escapeHtml(p.name) +
              (p.compiled ? ' <span class="chip ok">compiled</span>' : "") +
              '</span><span class="belief-conf">' +
              pct(p.strength) +
              "</span></div>" +
              '<div class="bar"><i style="width:' +
              Math.round((p.strength || 0) * 100) +
              '%"></i></div>' +
              '<div class="mem-meta">' +
              escapeHtml((p.domains || []).join(", ") || "no domains") +
              " · " +
              p.hitCount +
              " hits · " +
              p.compileCount +
              "/5 compile</div></div>"
            );
          })
          .join(""),
      );
    }
    return html;
  }

  function renderDrawer() {
    syncDrawerTabs();
    if (drawerTab === "why") drawerBody.innerHTML = renderWhyTab();
    else if (drawerTab === "trace") drawerBody.innerHTML = renderTraceTab();
    else if (drawerTab === "files") drawerBody.innerHTML = renderFilesTab();
    else if (drawerTab === "memory") drawerBody.innerHTML = renderMemoryTab();
    else if (drawerTab === "beliefs") drawerBody.innerHTML = renderBeliefsTab();
  }

  function addApprovalCard(command) {
    hideEmpty();
    const existing = messages.querySelector(".approval-card");
    if (existing) existing.remove();
    const card = document.createElement("div");
    card.className = "approval-card";
    card.innerHTML =
      "<strong>Approval required</strong>" +
      '<div class="approval-cmd"></div>' +
      '<div class="approval-actions">' +
      '<button type="button" class="mini-btn ok" data-scope="once">Allow once</button>' +
      '<button type="button" class="mini-btn ok" data-scope="session">Allow session</button>' +
      '<button type="button" class="mini-btn" data-scope="always">Allow always</button>' +
      '<button type="button" class="mini-btn danger" data-scope="deny">Deny</button>' +
      "</div>";
    card.querySelector(".approval-cmd").textContent = command;
    card.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-scope]");
      if (!btn) return;
      const scope = btn.getAttribute("data-scope");
      socket.emit("approve", { command: command, scope: scope });
      if (scope !== "deny") retryAfterApprove = true;
      Array.prototype.forEach.call(card.querySelectorAll("button"), function (b) {
        b.disabled = true;
      });
      btn.textContent = scope === "deny" ? "Denied" : "Approved";
    });
    messages.appendChild(card);
    scrollDown();
  }

  drawerTabs.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    drawerTab = btn.getAttribute("data-tab");
    requestDrawerData();
    renderDrawer();
  });
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  document.getElementById("inspect-btn").addEventListener("click", function () {
    if (drawerOpen) closeDrawer();
    else openDrawer(drawerTab);
  });

  drawerBody.addEventListener("click", function (e) {
    const rb = e.target.closest("[data-rollback]");
    if (rb) {
      rb.disabled = true;
      rb.textContent = "Rolling back…";
      socket.emit("rollback", { checkpointId: rb.getAttribute("data-rollback") });
      return;
    }
    const vote = e.target.closest("[data-theory]");
    if (vote) {
      vote.disabled = true;
      socket.emit("vote_theory", {
        id: vote.getAttribute("data-theory"),
        vote: vote.getAttribute("data-vote"),
      });
      return;
    }
    const del = e.target.closest("[data-mem-del]");
    if (del) {
      del.disabled = true;
      socket.emit("delete_memory", { id: del.getAttribute("data-mem-del") });
      return;
    }
    const ed = e.target.closest("[data-mem-edit]");
    if (ed) {
      const item = ed.closest(".mem-item");
      if (!item || item.querySelector(".mem-edit")) return;
      const mem = (lastMemory && lastMemory.durable || []).find(function (m) {
        return m.id === item.getAttribute("data-mem");
      });
      if (!mem) return;
      const p = item.querySelector(".mem-text");
      p.hidden = true;
      const ta = document.createElement("textarea");
      ta.className = "mem-edit";
      ta.value = mem.text;
      const actions = document.createElement("div");
      actions.className = "belief-actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "mini-btn ok";
      save.textContent = "Save";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "mini-btn";
      cancel.textContent = "Cancel";
      actions.appendChild(save);
      actions.appendChild(cancel);
      item.insertBefore(ta, ed.closest(".belief-actions"));
      item.insertBefore(actions, ed.closest(".belief-actions"));
      ed.hidden = true;
      ta.focus();
      cancel.addEventListener("click", function () {
        p.hidden = false;
        ta.remove();
        actions.remove();
        ed.hidden = false;
      });
      save.addEventListener("click", function () {
        const next = ta.value.trim();
        if (!next) return;
        socket.emit("update_memory", { id: mem.id, text: next });
      });
    }
  });

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
  }

  messages.addEventListener("click", function (e) {
    const expand = e.target.closest("[data-expand-code]");
    if (expand) {
      const block = expand.closest(".codeblock");
      const on = block.classList.toggle("expanded");
      expand.textContent = on ? "Collapse" : "Expand";
      if (on) block.scrollIntoView({ block: "nearest" });
      return;
    }
    const btn = e.target.closest("[data-copy-code]");
    if (!btn) return;
    const code = btn.closest(".codeblock").querySelector("code");
    navigator.clipboard.writeText(code.textContent).then(function () {
      btn.textContent = "Copied";
      setTimeout(function () {
        btn.textContent = "Copy";
      }, 1200);
    });
  });

  socket.on("connect", function () {
    setStatus("connected", "Connected", "local web gateway");
    ensureSessionId();
    socket.emit("join", { sessionId: sessionId });
    setReady(!pending);
    loadStatus();
  });
  socket.on("disconnect", function () {
    setStatus("disconnected", "Disconnected", "waiting for gateway");
    setReady(false);
  });
  socket.on("connect_error", function (err) {
    setStatus("disconnected", "Connection failed", "start ntox gateway web");
    setReady(false);
    if (err && (err.message === "Unauthorized" || (err.data && err.data.message === "Unauthorized"))) {
      showTokenPrompt();
    }
  });

  const tokenOverlay = document.getElementById("token-overlay");
  const tokenInput = document.getElementById("token-input");
  const tokenError = document.getElementById("token-error");

  function showTokenPrompt() {
    if (tokenOverlay) tokenOverlay.hidden = false;
    if (tokenInput) tokenInput.focus();
  }

  function connectWithToken(token) {
    authToken = token;
    sessionStorage.setItem("ntox_token", token);
    if (tokenOverlay) tokenOverlay.hidden = true;
    if (tokenError) tokenError.textContent = "";
    socket.auth = { token: token };
    socket.disconnect();
    socket.connect();
  }

  document.getElementById("token-submit").addEventListener("click", function () {
    const value = tokenInput.value.trim() || "";
    if (!value) {
      if (tokenError) tokenError.textContent = "Token required";
      return;
    }
    connectWithToken(value);
  });
  tokenInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      const value = tokenInput.value.trim();
      if (value) connectWithToken(value);
    }
  });

  socket.on("joined", function (data) {
    if (data && data.sessionId) {
      sessionId = data.sessionId;
      localStorage.setItem("ntox_session_id", sessionId);
      renderChatList();
    }
  });

  socket.on("history", function (data) {
    applyHistory(data || { messages: [] });
  });

  socket.on("chats", function (list) {
    chats = Array.isArray(list) ? list : [];
    renderChatList();
  });

  socket.on("event", function (event) {
    if (event.type === "phase") phasePill.textContent = event.phase || "working";
    if (event.type === "memory")
      memoryPill.textContent = ((event.action || "memory") + " " + (event.count || "")).trim();
    if (event.type === "usage") {
      usagePill.hidden = false;
      usagePill.textContent = fmtTokens(event.inputTokens || 0) + "↑ " + fmtTokens(event.outputTokens || 0) + "↓";
    }
    if (event.type === "tool_call") addToolCard(event.name, event.args);
    if (event.type === "tool_result") resolveToolCard(event.name, event.success, event.error);
    addActivity(eventLabel(event), event.type === "tool_result" ? (event.success ? "ok" : "fail") : "");
  });

  socket.on("token", function (data) {
    if (data.done) {
      finalizeAssistant(data.full || currentText);
      hintLeft.textContent = data.cancelled ? "stopped" : "";
      if (!data.cancelled && socket.connected) socket.emit("get_trace");
      if (retryAfterApprove && !pending) {
        retryAfterApprove = false;
        setTimeout(function () {
          regenerate();
        }, 300);
      }
      return;
    }
    ensureAssistantBubble();
    currentText += data.text || "";
    scheduleAssistantRender();
  });

  socket.on("trace", function (data) {
    lastTrace = data && data.trace ? data.trace : null;
    lastWhy = data && data.why ? data.why : null;
    if (drawerOpen && (drawerTab === "why" || drawerTab === "trace")) renderDrawer();
  });

  socket.on("changes", function (data) {
    lastChanges = (data && data.changes) || [];
    if (drawerOpen && drawerTab === "files") renderDrawer();
  });

  socket.on("memory", function (data) {
    lastMemory = data || null;
    if (drawerOpen && drawerTab === "memory") renderDrawer();
  });

  socket.on("beliefs", function (data) {
    lastBeliefs = data || null;
    if (drawerOpen && drawerTab === "beliefs") renderDrawer();
  });

  socket.on("approval_required", function (data) {
    if (data && data.command) addApprovalCard(data.command);
  });

  socket.on("approved", function (data) {
    if (!data || !data.ok) return;
    addActivity(
      "<strong>approval</strong> " + escapeHtml(data.scope) + " " + escapeHtml(data.command || ""),
      "ok",
    );
    const card = messages.querySelector(".approval-card");
    if (card && data.scope === "deny") card.remove();
  });

  socket.on("stt_result", function (data) {
    hintLeft.textContent = "";
    if (data && data.text) {
      const value = input.value ? input.value.replace(/\s+$/, "") + " " : "";
      input.value = value + String(data.text).trim();
      autosize();
      input.focus();
      return;
    }
    voiceError((data && data.error) || "transcription failed");
  });

  socket.on("tts_audio", function (data) {
    const btn = speakButton;
    speakButton = null;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Speak";
    }
    if (data && data.error) {
      voiceError(data.error);
      return;
    }
    if (!data || !data.audio) return;
    if (speaking) {
      speaking.pause();
      speaking = null;
    }
    speaking = new Audio(data.audio);
    speaking.onended = function () {
      speaking = null;
    };
    speaking.play().catch(function () {
      speaking = null;
      voiceError("could not play audio");
    });
  });

  socket.on("rolled_back", function (data) {
    if (data && data.success) {
      addActivity("<strong>rollback</strong> " + escapeHtml(data.checkpointId || ""), "ok");
      socket.emit("get_changes");
    } else {
      addActivity(
        "<strong>rollback failed</strong> " + escapeHtml((data && data.error) || "unknown"),
        "fail",
      );
      const btn = drawerBody.querySelector("[data-rollback]");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Rollback";
      }
    }
  });

  socket.on("inspect_error", function (data) {
    addActivity("<strong>inspect</strong> " + escapeHtml((data && data.error) || "error"), "fail");
  });

  socket.on("error", function (data) {
    addActivity("<strong>error</strong> " + escapeHtml(data.text || "unknown"), "fail");
    if (current) {
      const content = current.querySelector(".content");
      content.classList.remove("cursor");
      if (!currentText) {
        content.innerHTML = renderMarkdown("**Error:** " + (data.text || "unknown"));
        addActionButtons(current, "assistant", data.text || "error");
      } else {
        finalizeAssistant(currentText);
      }
    }
    current = null;
    setPending(false);
    phasePill.textContent = "idle";
  });

  function loadStatus() {
    fetch("/status.json", {
      headers: authToken ? { Authorization: "Bearer " + authToken } : {},
    })
      .then(function (res) {
        if (!res.ok) {
          if (res.status === 401) showTokenPrompt();
          return null;
        }
        return res.json();
      })
      .then(function (status) {
        if (!status) return;
        document.getElementById("model").textContent = status.model || "unknown";
        document.getElementById("provider").textContent = status.provider || "unknown";
        document.getElementById("workspace").textContent = (status.profile && status.profile.name) || "local";
        const n = (status.sessions && status.sessions.sessions) || 0;
        document.getElementById("session").textContent = n + " active session" + (n === 1 ? "" : "s");
      })
      .catch(function () {});
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (paletteOpen || !helpOverlay.hidden) return;
    if (suggestItems.length && !suggestPop.hidden) {
      acceptSuggest(suggestIndex);
      return;
    }
    if (pending) stop();
    else submit();
  });
  input.addEventListener("input", function () {
    autosize();
    updateSuggest();
  });
  Array.prototype.forEach.call(document.querySelectorAll(".prompt"), function (button) {
    button.addEventListener("click", function () {
      submit(button.textContent);
    });
  });
  document.getElementById("new-chat").addEventListener("click", function () {
    newChat();
  });
  document.getElementById("clear").addEventListener("click", function () {
    if (pending) return;
    socket.emit("clear_chat");
  });
  document.getElementById("theme").addEventListener("click", function () {
    const next = app.dataset.theme === "dark" ? "light" : "dark";
    app.dataset.theme = next;
    localStorage.setItem("ntox_theme", next);
  });
  document.getElementById("menu").addEventListener("click", function () {
    side.classList.toggle("open");
  });
  thread.addEventListener("click", function () {
    side.classList.remove("open");
  });

  const suggestPop = document.getElementById("suggest-pop");
  const paletteOverlay = document.getElementById("palette-overlay");
  const paletteInput = document.getElementById("palette-input");
  const paletteList = document.getElementById("palette-list");
  const paletteModeLabel = document.getElementById("palette-mode-label");
  const helpOverlay = document.getElementById("help-overlay");
  const helpBody = document.getElementById("help-body");

  const SLASH_COMMANDS = [
    { name: "/new", hint: "reset conversation" },
    { name: "/help", hint: "gateway help" },
    { name: "/alive", hint: "host events & wakes" },
    { name: "/cron list", hint: "scheduled jobs" },
    { name: "/cron help", hint: "cron usage" },
  ];

  let suggestItems = [];
  let suggestIndex = 0;
  let suggestKind = null;
  let pathTimer = 0;
  let currentSettings = null;
  let paletteOpen = false;
  let paletteMode = "root";
  let paletteAll = [];
  let paletteFiltered = [];
  let paletteIndex = 0;

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function hideSuggest() {
    suggestPop.hidden = true;
    suggestItems = [];
    suggestIndex = 0;
    suggestKind = null;
  }

  function renderSuggest() {
    if (!suggestItems.length) {
      hideSuggest();
      return;
    }
    suggestPop.innerHTML = "";
    suggestItems.forEach(function (item, i) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggest-item" + (i === suggestIndex ? " active" : "");
      btn.setAttribute("role", "option");
      btn.innerHTML =
        '<span class="s-label"></span><span class="s-hint"></span>';
      btn.querySelector(".s-label").textContent = item.label;
      btn.querySelector(".s-hint").textContent = item.hint || "";
      btn.addEventListener("click", function () {
        acceptSuggest(i);
      });
      suggestPop.appendChild(btn);
    });
    suggestPop.hidden = false;
    const active = suggestPop.children[suggestIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function acceptSuggest(index) {
    const item = suggestItems[index];
    if (!item) return;
    if (suggestKind === "slash") {
      input.value = item.label + " ";
    } else if (suggestKind === "path") {
      const v = input.value;
      const atMatch = v.match(/(?:^|\s)@([\w./\\-]*)$/);
      if (atMatch) {
        const start = v.length - atMatch[0].length + (atMatch[0].startsWith(" ") ? 1 : 0);
        input.value = v.slice(0, start) + "@" + item.label + " ";
      }
    }
    hideSuggest();
    autosize();
    input.focus();
  }

  function updateSuggest() {
    const v = input.value;
    const slashMatch = v.match(/^\/([a-z]*)$/i);
    if (slashMatch) {
      const q = slashMatch[1].toLowerCase();
      suggestKind = "slash";
      suggestItems = SLASH_COMMANDS.filter(function (c) {
        return !q || c.name.slice(1).startsWith(q);
      }).map(function (c) {
        return { label: c.name, hint: c.hint };
      });
      suggestIndex = 0;
      renderSuggest();
      return;
    }
    const atMatch = v.match(/(?:^|\s)@([\w./\\-]*)$/);
    if (atMatch && socket.connected) {
      suggestKind = "path";
      const prefix = atMatch[1];
      if (pathTimer) clearTimeout(pathTimer);
      pathTimer = setTimeout(function () {
        socket.emit("suggest_paths", { prefix: prefix });
      }, 140);
      return;
    }
    hideSuggest();
  }

  socket.on("path_suggestions", function (data) {
    if (suggestKind !== "path") return;
    const paths = (data && data.paths) || [];
    suggestItems = paths.map(function (p) {
      return { label: p, hint: p.endsWith("/") ? "dir" : "file" };
    });
    suggestIndex = 0;
    renderSuggest();
  });

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = isMac ? "⌘" : "Ctrl";

  const HELP_ROWS = [
    [MOD + " K", "Command palette"],
    [MOD + " ⇧ O", "New chat"],
    [MOD + " B", "Toggle sidebar"],
    ["Enter", "Send message"],
    ["⇧ Enter", "New line"],
    ["Esc", "Stop generation / close overlay"],
    ["?", "This help (when not typing)"],
    ["/", "Slash command autocomplete"],
    ["@", "Reference a workspace file"],
  ];

  function openHelp() {
    helpBody.innerHTML = HELP_ROWS.map(function (row) {
      return '<div class="help-row"><kbd>' + escapeHtml(row[0]) + "</kbd><span>" + escapeHtml(row[1]) + "</span></div>";
    }).join("");
    helpOverlay.hidden = false;
    document.getElementById("help-close").focus();
  }

  function closeHelp() {
    helpOverlay.hidden = true;
  }

  document.getElementById("help-close").addEventListener("click", closeHelp);
  helpOverlay.addEventListener("click", function (e) {
    if (e.target === helpOverlay) closeHelp();
  });

  function setPaletteMode(mode) {
    paletteMode = mode;
    paletteInput.value = "";
    paletteIndex = 0;
    if (mode === "root") {
      paletteModeLabel.textContent = "";
      paletteAll = buildRootPaletteItems();
    } else if (mode === "models") {
      paletteModeLabel.textContent = "models";
      socket.emit("get_models");
      paletteAll = [{ label: "← Back", hint: "esc", run: function () { setPaletteMode("root"); } }];
      renderPalette();
      return;
    } else if (mode === "providers") {
      paletteModeLabel.textContent = "providers";
      paletteAll = [{ label: "← Back", hint: "esc", run: function () { setPaletteMode("root"); } }];
      if (currentSettings) {
        currentSettings.providers.forEach(function (p) {
          paletteAll.push({
            label: p.name,
            hint: p.id,
            run: function () {
              socket.emit("set_provider", { provider: p.id });
              closePalette();
            },
          });
        });
      }
    } else if (mode === "chats") {
      paletteModeLabel.textContent = "chats";
      paletteAll = [{ label: "← Back", hint: "esc", run: function () { setPaletteMode("root"); } }];
      chats.forEach(function (conv) {
        paletteAll.push({
          label: conv.title || "New chat",
          hint: timeAgo(conv.updatedAt),
          run: function () {
            if (conv.id === sessionId || pending) return;
            clearThread();
            joinSession(conv.id);
            renderChatList();
            closePalette();
          },
        });
      });
    }
    renderPalette();
  }

  function buildRootPaletteItems() {
    const items = [
      {
        label: "New chat",
        hint: MOD + "⇧O",
        group: "chat",
        run: function () {
          newChat();
          closePalette();
        },
      },
      {
        label: "Clear current chat",
        hint: "",
        group: "chat",
        run: function () {
          if (!pending) socket.emit("clear_chat");
          closePalette();
        },
      },
      {
        label: "Toggle theme",
        hint: "",
        group: "view",
        run: function () {
          const next = app.dataset.theme === "dark" ? "light" : "dark";
          app.dataset.theme = next;
          localStorage.setItem("ntox_theme", next);
          closePalette();
        },
      },
      {
        label: "Keyboard shortcuts",
        hint: "?",
        group: "view",
        run: function () {
          closePalette();
          openHelp();
        },
      },
      { label: "Inspect: Why", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("why"); } },
      { label: "Inspect: Trace", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("trace"); } },
      { label: "Inspect: Files", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("files"); } },
      { label: "Inspect: Memory", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("memory"); } },
      { label: "Inspect: Beliefs", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("beliefs"); } },
      {
        label: "Switch model…",
        hint: currentSettings ? currentSettings.model : "",
        group: "model",
        run: function () {
          setPaletteMode("models");
        },
      },
      {
        label: "Switch provider…",
        hint: currentSettings ? currentSettings.provider : "",
        group: "model",
        run: function () {
          setPaletteMode("providers");
        },
      },
      {
        label: "Refresh model catalog",
        hint: "",
        group: "model",
        run: function () {
          socket.emit("refresh_models");
          addActivity("<strong>catalog</strong> refreshing models…", "");
          closePalette();
        },
      },
      {
        label: "Jump to chat…",
        hint: chats.length + " chats",
        group: "chat",
        run: function () {
          setPaletteMode("chats");
        },
      },
    ];
    SLASH_COMMANDS.forEach(function (c) {
      items.push({
        label: "Send " + c.name,
        hint: c.hint,
        group: "send",
        run: function () {
          closePalette();
          submit(c.name);
        },
      });
    });
    return items;
  }

  function renderPalette() {
    const q = paletteInput.value.trim().toLowerCase();
    paletteFiltered = paletteAll.filter(function (item) {
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        (item.hint || "").toLowerCase().includes(q) ||
        (item.group || "").toLowerCase().includes(q)
      );
    });
    if (paletteIndex >= paletteFiltered.length) paletteIndex = Math.max(0, paletteFiltered.length - 1);
    if (!paletteFiltered.length) {
      paletteList.innerHTML = '<div class="palette-empty">No matches</div>';
      return;
    }
    paletteList.innerHTML = "";
    paletteFiltered.forEach(function (item, i) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-item" + (i === paletteIndex ? " active" : "");
      btn.setAttribute("role", "option");
      btn.innerHTML =
        '<span class="p-label">' +
        (item.group ? '<span class="p-group">' + escapeHtml(item.group) + "</span>" : "") +
        "</span>" +
        '<span class="p-hint"></span>';
      btn.querySelector(".p-label").insertAdjacentText("beforeend", item.label);
      btn.querySelector(".p-hint").textContent = item.hint || "";
      btn.addEventListener("click", function () {
        item.run();
      });
      btn.addEventListener("mousemove", function () {
        paletteIndex = i;
        Array.prototype.forEach.call(paletteList.children, function (node, j) {
          node.classList.toggle("active", j === paletteIndex);
        });
      });
      paletteList.appendChild(btn);
    });
    const active = paletteList.children[paletteIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function openPalette(mode) {
    if (pending) return;
    paletteOpen = true;
    paletteOverlay.hidden = false;
    if (socket.connected) socket.emit("get_settings");
    setPaletteMode(mode || "root");
    paletteInput.focus();
  }

  function closePalette() {
    paletteOpen = false;
    paletteOverlay.hidden = true;
    paletteInput.value = "";
    if (socket.connected && !input.disabled) input.focus();
  }

  function togglePalette() {
    if (paletteOpen) closePalette();
    else openPalette();
  }

  paletteInput.addEventListener("input", function () {
    paletteIndex = 0;
    renderPalette();
  });

  paletteInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (paletteFiltered.length) {
        paletteIndex = (paletteIndex + 1) % paletteFiltered.length;
        renderPalette();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (paletteFiltered.length) {
        paletteIndex = (paletteIndex - 1 + paletteFiltered.length) % paletteFiltered.length;
        renderPalette();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = paletteFiltered[paletteIndex];
      if (item) item.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (paletteMode !== "root") setPaletteMode("root");
      else closePalette();
    }
  });

  paletteOverlay.addEventListener("click", function (e) {
    if (e.target === paletteOverlay) closePalette();
  });

  socket.on("settings", function (data) {
    currentSettings = data || null;
    if (data) {
      document.getElementById("model").textContent = data.model || "unknown";
      document.getElementById("provider").textContent = data.provider || "unknown";
    }
    if (paletteOpen && paletteMode === "root") {
      const scroll = paletteInput.value;
      paletteAll = buildRootPaletteItems();
      paletteInput.value = scroll;
      renderPalette();
    }
  });

  socket.on("models", function (data) {
    if (!paletteOpen || paletteMode !== "models") return;
    const models = (data && data.models) || [];
    paletteAll = [{ label: "← Back", hint: "esc", run: function () { setPaletteMode("root"); } }];
    models.slice(0, 300).forEach(function (m) {
      paletteAll.push({
        label: m.name || m.id,
        hint: m.id,
        run: function () {
          socket.emit("set_model", { model: m.id });
          closePalette();
        },
      });
    });
    if (data && data.refreshed) addActivity("<strong>catalog</strong> " + models.length + " models", "ok");
    if (data && data.error) addActivity("<strong>catalog</strong> " + escapeHtml(data.error), "fail");
    renderPalette();
  });

  socket.on("model_changed", function (data) {
    if (data && data.ok) {
      addActivity("<strong>model</strong> " + escapeHtml(data.model || data.provider || "updated"), "ok");
      loadStatus();
    } else {
      addActivity("<strong>model</strong> update failed", "fail");
    }
  });

  const prevInputKeydown = function (e) {
    if (suggestItems.length && !suggestPop.hidden) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        suggestIndex = (suggestIndex + 1) % suggestItems.length;
        renderSuggest();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length;
        renderSuggest();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggest(suggestIndex);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideSuggest();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (pending) stop();
      else submit();
      return;
    }
    if (e.key === "Escape" && pending) {
      e.preventDefault();
      stop();
    }
  };
  input.removeEventListener("keydown", input._ntoxKeydown || (() => {}));
  input.addEventListener("keydown", prevInputKeydown);
  input._ntoxKeydown = prevInputKeydown;

  document.addEventListener("keydown", function (e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      togglePalette();
      return;
    }
    if (mod && e.shiftKey && (e.key === "o" || e.key === "O")) {
      e.preventDefault();
      newChat();
      return;
    }
    if (mod && !e.shiftKey && (e.key === "b" || e.key === "B") && !isEditable(e.target)) {
      e.preventDefault();
      side.classList.toggle("open");
      return;
    }
    if (e.key === "?" && !isEditable(e.target) && !paletteOpen && helpOverlay.hidden) {
      e.preventDefault();
      openHelp();
      return;
    }
    if (e.key === "Escape") {
      if (!helpOverlay.hidden) {
        closeHelp();
        return;
      }
      if (paletteOpen) {
        if (paletteMode !== "root") setPaletteMode("root");
        else closePalette();
        return;
      }
      if (drawerOpen) {
        closeDrawer();
        return;
      }
      if (pending) stop();
    }
  });

  const themeColorMeta = document.getElementById("theme-color");
  function syncThemeColor() {
    if (!themeColorMeta) return;
    themeColorMeta.content = app.dataset.theme === "dark" ? "#151613" : "#f7f7f4";
  }
  syncThemeColor();
  if (window.MutationObserver) {
    new MutationObserver(syncThemeColor).observe(app, { attributes: true, attributeFilter: ["data-theme"] });
  }

  if ("serviceWorker" in navigator) {
    const registerServiceWorker = function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    };
    if (document.readyState === "complete") registerServiceWorker();
    else window.addEventListener("load", registerServiceWorker);
  }

  setStatus("connecting", "Connecting", "local web gateway");
  renderChatList();
  ensureSessionId();
})();
