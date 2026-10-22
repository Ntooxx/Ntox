(() => {
  "use strict";

  const app = document.getElementById("app");
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  const storedToken = sessionStorage.getItem("ntox_token");
  let authToken = urlToken || storedToken || "";
  if (urlToken) sessionStorage.setItem("ntox_token", urlToken);

  const socket = io({ transports: ["websocket", "polling"], auth: { token: authToken } });

  const sidebar = document.getElementById("sidebar");
  const chatList = document.getElementById("chatList");
  const chatSearch = document.getElementById("chatSearch");
  const chat = document.getElementById("chat");
  const messages = document.getElementById("messages");
  const empty = document.getElementById("empty");
  const input = document.getElementById("input");
  const form = document.getElementById("form");
  const send = document.getElementById("send");
  const mic = document.getElementById("mic");
  const suggestPop = document.getElementById("suggestPop");
  const hintLeft = document.getElementById("hintLeft");
  const sessionEl = document.getElementById("session");
  const phasePill = document.getElementById("phase-pill");
  const memoryPill = document.getElementById("memory-pill");
  const usagePill = document.getElementById("usage-pill");
  const statusDot = document.getElementById("status-dot");
  const statusTitle = document.getElementById("status-title");
  const modelLabel = document.getElementById("modelLabel");
  const modelWrap = document.getElementById("modelWrap");
  const modelBtn = document.getElementById("modelBtn");
  const modelMenu = document.getElementById("modelMenu");
  const modelEl = document.getElementById("model");
  const providerEl = document.getElementById("provider");
  const drawer = document.getElementById("drawer");
  const drawerBody = document.getElementById("drawerBody");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const drawerTabs = document.getElementById("drawerTabs");
  const paletteOverlay = document.getElementById("paletteOverlay");
  const paletteInput = document.getElementById("paletteInput");
  const paletteList = document.getElementById("paletteList");
  const paletteModeLabel = document.getElementById("paletteModeLabel");
  const helpOverlay = document.getElementById("helpOverlay");
  const helpBody = document.getElementById("helpBody");
  const tokenOverlay = document.getElementById("tokenOverlay");
  const tokenInput = document.getElementById("tokenInput");
  const tokenError = document.getElementById("tokenError");

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
  let currentSettings = null;
  let availableModels = [];
  const openToolCards = new Map();
  const CODE_MARK = "";

  const savedTheme = localStorage.getItem("ntox_theme");
  if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
  else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.dataset.theme = "dark";

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
    rust: "fn let mut return if else for while match struct enum impl trait pub use mod const static move ref loop break continue in as",
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
        "|(" + commentRe + ")" +
        "|(" + kwRe + ")" +
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
    return (
      '<div class="codeblock">' +
      '<div class="codehead"><span>' + label + "</span>" +
      '<span><button type="button" data-expand-code>Expand</button>' +
      '<button type="button" data-copy-code>Copy</button></span></div>' +
      "<pre><code>" + highlightCode(code, lang) + "</code></pre></div>"
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
        const lvl = Math.min(heading[1].length, 3);
        out.push("<h" + lvl + ">" + renderInline(heading[2]) + "</h" + lvl + ">");
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
          return row.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
        }
        const header = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) {
          rows.push(cells(lines[i]));
          i++;
        }
        let table = "<table><thead><tr>";
        header.forEach(function (h) { table += "<th>" + renderInline(h) + "</th>"; });
        table += "</tr></thead><tbody>";
        rows.forEach(function (r) {
          table += "<tr>";
          r.forEach(function (c) { table += "<td>" + renderInline(c) + "</td>"; });
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

  /* ============================================================
     STATUS / SIDEBAR
     ============================================================ */
  function setStatus(kind, title) {
    statusDot.className = "status-dot " + kind;
    statusTitle.textContent = title;
  }

  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function setSidebar(open) {
    app.classList.toggle("collapsed", !open);
  }

  document.getElementById("toggleSidebar").addEventListener("click", function () {
    app.classList.toggle("collapsed");
  });
  document.getElementById("collapseBtn").addEventListener("click", function () {
    setSidebar(false);
  });
  document.getElementById("backdrop").addEventListener("click", function () {
    setSidebar(false);
  });
  if (isMobile()) app.classList.add("collapsed");

  document.getElementById("themeBtn").addEventListener("click", function () {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ntox_theme", next);
  });

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  function pct(n) {
    return Math.round((Number(n) || 0) * 100) + "%";
  }

  function timeAgo(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  /* ============================================================
     CHAT LIST
     ============================================================ */
  function groupLabel(ts) {
    const now = new Date();
    const d = new Date(ts);
    const day = 86400000;
    if (now - d < day && d.getDate() === now.getDate()) return "Today";
    const y = new Date(now.getTime() - day);
    if (d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear())
      return "Yesterday";
    return "Previous 7 days";
  }

  function renderChatList() {
    const q = (chatSearch.value || "").trim().toLowerCase();
    const list = q
      ? chats.filter(function (c) { return (c.title || "New chat").toLowerCase().includes(q); })
      : chats;

    chatList.innerHTML = "";
    if (!list.length) {
      const note = document.createElement("div");
      note.className = "sb-empty";
      note.textContent = q ? "No matching chats" : "No chats yet";
      chatList.appendChild(note);
      return;
    }

    let lastGroup = "";
    list.forEach(function (conv) {
      const group = groupLabel(conv.updatedAt || Date.now());
      if (group !== lastGroup) {
        lastGroup = group;
        const label = document.createElement("div");
        label.className = "sb-label";
        label.textContent = group;
        chatList.appendChild(label);
      }

      const item = document.createElement("button");
      item.type = "button";
      item.className = "sb-item" + (conv.id === sessionId ? " active" : "");
      item.innerHTML =
        '<span class="chat-title"></span>' +
        '<span class="chat-mini rename" title="Rename" role="button" tabindex="0">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>' +
        '<span class="chat-mini danger delete" title="Delete" role="button" tabindex="0">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>';
      item.querySelector(".chat-title").textContent = conv.title || "New chat";
      item.title = (conv.title || "New chat") + " · " + timeAgo(conv.updatedAt || Date.now());

      item.addEventListener("click", function (e) {
        if (e.target.closest(".chat-mini")) return;
        if (conv.id === sessionId || pending) return;
        clearThread();
        joinSession(conv.id);
        renderChatList();
        if (isMobile()) setSidebar(false);
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
      if (next && next !== conv.title) socket.emit("rename_chat", { sessionId: conv.id, title: next });
      else renderChatList();
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

  chatSearch.addEventListener("input", renderChatList);

  /* ============================================================
     MESSAGES
     ============================================================ */
  function nearBottom() {
    return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 150;
  }

  function scrollDown(force) {
    if (force || nearBottom()) chat.scrollTop = chat.scrollHeight;
  }

  function hideEmpty() {
    if (empty) empty.hidden = true;
  }

  function showEmpty() {
    if (!empty) return;
    if (!empty.parentNode) document.getElementById("chatInner").insertBefore(empty, messages);
    empty.hidden = false;
  }

  const ICON_COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16"/></svg>';
  const ICON_CHECK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';
  const ICON_UP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10.5V20H5a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2h2Z"/><path d="M7 10.5 11.4 3.3a1.5 1.5 0 0 1 2.6.5L15 9h4.2a1.8 1.8 0 0 1 1.8 2.2l-1.2 6A2 2 0 0 1 17.8 19H7"/></svg>';
  const ICON_DOWN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(180 12 12)"><path d="M7 10.5V20H5a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2h2Z"/><path d="M7 10.5 11.4 3.3a1.5 1.5 0 0 1 2.6.5L15 9h4.2a1.8 1.8 0 0 1 1.8 2.2l-1.2 6A2 2 0 0 1 17.8 19H7"/></g></svg>';
  const ICON_REFRESH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  const ICON_SPEAK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const ICON_EDIT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const ICON_WHY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.9 1 .9 1.7V16h5.4v-.5c0-.7.4-1.3.9-1.7A6 6 0 0 0 12 3Z"/></svg>';
  const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2Q13.2 10.8 22 12Q13.2 13.2 12 22Q10.8 13.2 2 12Q10.8 10.8 12 2Z"/></svg>';

  function makeAct(icon, title, handler) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "act";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = icon;
    btn.addEventListener("click", handler);
    return btn;
  }

  function addActionButtons(article, role, text) {
    const body = article.querySelector(".a-body") || article.querySelector(".bubble");
    const existing = body.querySelector(".msg-actions");
    if (existing) existing.remove();
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copyBtn = makeAct(ICON_COPY, "Copy", function () {
      navigator.clipboard.writeText(text).then(function () {
        const old = copyBtn.innerHTML;
        copyBtn.innerHTML = ICON_CHECK;
        setTimeout(function () { copyBtn.innerHTML = old; }, 1200);
      });
    });
    actions.appendChild(copyBtn);

    if (role === "assistant") {
      const like = makeAct(ICON_UP, "Good response", function () {
        actions.querySelector('[data-act="dislike"]').classList.remove("on");
        like.classList.toggle("on");
      });
      like.setAttribute("data-act", "like");
      const dislike = makeAct(ICON_DOWN, "Bad response", function () {
        actions.querySelector('[data-act="like"]').classList.remove("on");
        dislike.classList.toggle("on");
      });
      dislike.setAttribute("data-act", "dislike");
      actions.appendChild(like);
      actions.appendChild(dislike);

      actions.appendChild(makeAct(ICON_REFRESH, "Regenerate", function () {
        if (pending) return;
        article.remove();
        scrollDown(true);
        regenerate();
      }));

      const speak = makeAct(ICON_SPEAK, "Read aloud", function () {
        if (speakButton || !text.trim()) return;
        speakButton = speak;
        socket.emit("tts", { text: text });
      });
      actions.appendChild(speak);

      actions.appendChild(makeAct(ICON_WHY, "Why this answer", function () {
        socket.emit("get_trace");
        openDrawer("why");
      }));
    }

    if (role === "user") {
      actions.appendChild(makeAct(ICON_EDIT, "Edit & resend", function () {
        startEditUser(article, text);
      }));
    }

    body.appendChild(actions);
  }

  function addMessage(role, text, opts) {
    const options = opts || {};
    if (!options.keepEmpty) hideEmpty();
    const wrap = document.createElement("article");
    wrap.className = "msg " + role;
    if (role === "user") {
      wrap.innerHTML = '<div class="bubble"></div>';
      wrap.querySelector(".bubble").textContent = text || "";
    } else {
      wrap.innerHTML =
        '<div class="a-avatar">' + STAR + '</div><div class="a-body"><div class="prose content"></div></div>';
      wrap.querySelector(".content").innerHTML = renderMarkdown(text || "");
    }
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
    content.innerHTML = '<span class="stream-text"></span><span class="caret"></span>';
    return current;
  }

  function scheduleAssistantRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      if (!current) return;
      const streamEl = current.querySelector(".stream-text");
      if (streamEl) streamEl.textContent = currentText;
      scrollDown();
    });
  }

  function finalizeAssistant(fullText) {
    if (!current) {
      if (fullText) current = ensureAssistantBubble();
      else {
        setPending(false);
        phasePill.textContent = "idle";
        return;
      }
    }
    currentText = fullText || currentText;
    const content = current.querySelector(".content");
    content.innerHTML = currentText ? renderMarkdown(currentText) : '<p class="stopped">No response.</p>';
    addActionButtons(current, "assistant", currentText);
    current.classList.add("done");
    current = null;
    setPending(false);
    phasePill.textContent = "idle";
    scrollDown();
  }

  /* ---------- tool cards ---------- */
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
      '<span class="dot"></span><span class="tool-name"></span>' +
      '<span class="tool-summary"></span><span class="tool-status">running</span></button>' +
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

    messages.appendChild(card);
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

  /* ---------- approval card ---------- */
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
      Array.prototype.forEach.call(card.querySelectorAll("button"), function (b) { b.disabled = true; });
      btn.textContent = scope === "deny" ? "Denied" : "Approved";
    });
    messages.appendChild(card);
    scrollDown();
  }

  /* ============================================================
     PENDING / SEND / STOP
     ============================================================ */
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 208) + "px";
  }

  function setReady(ready) {
    if (mic) mic.disabled = !ready;
    if (pending) {
      input.disabled = true;
      send.disabled = false;
      send.classList.add("stop");
      send.setAttribute("aria-label", "Stop generating");
      return;
    }
    input.disabled = !ready;
    send.disabled = !ready || !input.value.trim();
    send.classList.remove("stop");
    send.setAttribute("aria-label", "Send message");
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
    Array.prototype.forEach.call(
      messages.querySelectorAll(".msg, .tool-card, .approval-card"),
      function (n) { n.remove(); },
    );
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
    showEmpty();
    renderChatList();
    if (isMobile()) setSidebar(false);
    input.focus();
  }

  function applyHistory(data) {
    clearThread();
    const msgs = (data && data.messages) || [];
    if (!msgs.length) {
      showEmpty();
      return;
    }
    hideEmpty();
    msgs.forEach(function (m) {
      addMessage(m.role, m.content, { noScroll: true });
    });
    Array.prototype.forEach.call(messages.querySelectorAll(".msg"), function (n) {
      n.classList.add("done");
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
    Array.prototype.forEach.call(
      messages.querySelectorAll(".msg.assistant, .tool-card, .approval-card"),
      function (n) { n.remove(); },
    );
    current = null;
    currentText = "";
    hintLeft.textContent = "";
    retryAfterApprove = false;
    socket.emit("regenerate");
  }

  function startEditUser(article, originalText) {
    if (pending) return;
    const bubble = article.querySelector(".bubble");
    const actions = article.querySelector(".msg-actions");
    if (actions) actions.style.display = "none";
    const prev = originalText;
    bubble.textContent = "";
    const ta = document.createElement("textarea");
    ta.className = "user-edit";
    ta.value = originalText;
    const row = document.createElement("div");
    row.className = "user-edit-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Send edit";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    row.appendChild(save);
    row.appendChild(cancel);
    bubble.appendChild(ta);
    bubble.appendChild(row);
    ta.focus();

    const restore = function () {
      bubble.textContent = prev;
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
      bubble.textContent = next;
      setPending(true);
      Array.prototype.forEach.call(
        messages.querySelectorAll(".msg.assistant, .tool-card, .approval-card"),
        function (n) { n.remove(); },
      );
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

  /* ============================================================
     VOICE
     ============================================================ */
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
    hintLeft.textContent = message;
    setTimeout(function () { hintLeft.textContent = ""; }, 4000);
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
          stream.getTracks().forEach(function (track) { track.stop(); });
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

  /* ============================================================
     INSPECT DRAWER
     ============================================================ */
  function openDrawer(tab) {
    if (tab) drawerTab = tab;
    drawerOpen = true;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    if (isMobile()) drawerBackdrop.hidden = false;
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
      '<div class="drow"><span>' + escapeHtml(label) + "</span><span>" +
      escapeHtml(value == null || value === "" ? "—" : String(value)) + "</span></div>"
    );
  }

  function renderWhyTab() {
    const w = lastWhy;
    if (!w) return '<p class="empty-note">No turn inspected yet. Send a message, then open Why.</p>';
    let html = section(
      "Decision",
      row("Mode", w.responseMode) + row("Strategy", w.strategy) +
        row("Duration", w.durationMs != null ? w.durationMs + " ms" : null) +
        row("Retries", w.retries) + row("Search", w.searchUsed ? "used" : "not used"),
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
        '<div class="chips">' + w.droppedContextSections.map(function (s) {
          return '<span class="chip warn">' + escapeHtml(s) + "</span>";
        }).join("") + "</div>",
      );
    }
    if (w.contextBudget) {
      const b = w.contextBudget;
      html += section(
        "Context budget (tokens)",
        row("System", b.system) + row("Mode", b.mode) + row("User", b.user) +
          row("Skills", b.skills) + row("Memory", b.memory) + row("Cognition", b.cognition) +
          row("Theory", b.theory) + row("Mistakes", b.mistakes) +
          row("Tool results", b.toolResults) + row("Total", b.total),
      );
    }
    return html;
  }

  function renderTraceTab() {
    const t = lastTrace;
    if (!t) return '<p class="empty-note">No trace yet. Complete a turn, then reopen Trace.</p>';
    let html = section(
      "Turn",
      row("Mode", t.responseMode) + row("Strategy", t.strategy) + row("Started", fmtDate(t.startedAt)) +
        row("Response length", t.finalResponseLength != null ? t.finalResponseLength + " chars" : null) +
        row("Retries", t.retries) + row("Memory recalls", t.memoryRecallCount),
    );
    if (t.workspaceProfile) {
      html += section("Workspace", row("Profile", t.workspaceProfile.name) + row("Root", t.workspaceProfile.workspaceRoot));
    }
    const tools = t.toolCalls || [];
    if (tools.length) {
      const items = tools.map(function (call) {
        const status = call.success === false ? "fail" : call.success ? "ok" : "?";
        return (
          '<div class="drow"><span>' + escapeHtml(call.name) +
          (call.durationMs != null ? " · " + call.durationMs + "ms" : "") +
          '</span><span class="chip ' + (status === "ok" ? "ok" : status === "fail" ? "warn" : "") + '">' +
          status + (call.reason ? " · " + escapeHtml(call.reason) : "") + "</span></div>" +
          (call.error ? '<div class="drow"><span>error</span><span>' + escapeHtml(call.error) + "</span></div>" : "")
        );
      }).join("");
      html += section("Tools (" + tools.length + ")", items);
    } else {
      html += section("Tools", '<p class="empty-note">No tool calls this turn.</p>');
    }
    const policy = t.policyDecisions || [];
    if (policy.length) {
      html += section(
        "Policy (" + policy.length + ")",
        policy.slice(-12).map(function (p) {
          return (
            '<div class="drow"><span>' + escapeHtml(p.tool) +
            (p.path ? " · " + escapeHtml(p.path.split(/[\\/]/).pop() || p.path) : "") +
            '</span><span class="chip ' + (p.allowed ? "ok" : "warn") + '">' +
            (p.allowed ? "allow" : "deny") + "</span></div>"
          );
        }).join(""),
      );
    }
    if (t.checkpointIds && t.checkpointIds.length) {
      html += section(
        "Checkpoints",
        '<div class="chips">' + t.checkpointIds.map(function (id) {
          return '<span class="chip">' + escapeHtml(id) + "</span>";
        }).join("") + "</div>",
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
    return lastChanges.map(function (change) {
      const base = change.path.split(/[\\/]/).pop() || change.path;
      const lines = (change.lines || []).map(function (l) {
        const prefix = l.type === "del" ? "-" : l.type === "add" ? "+" : " ";
        return '<div class="diff-line ' + escapeHtml(l.type) + '">' + escapeHtml(prefix + l.text) + "</div>";
      }).join("");
      const cp = checkpointByPath[change.path];
      return (
        '<div class="diff"><div class="diff-head"><span title="' + escapeHtml(change.path) + '">' +
        escapeHtml(base) + " · " + escapeHtml(change.action) + "</span>" +
        (cp ? '<button type="button" class="mini-btn danger" data-rollback="' + escapeHtml(cp) + '">Rollback</button>' : "") +
        '</div><div class="diff-body">' + lines + "</div></div>"
      );
    }).join("");
  }

  function renderMemoryTab() {
    if (!lastMemory) return '<p class="empty-note">Loading memory…</p>';
    const stats = lastMemory.stats || {};
    let html = section(
      "Stats",
      row("Episodes", stats.totalEpisodes) + row("Sessions", stats.totalSessions) +
        row("Durable", (lastMemory.durable || []).length),
    );
    const durable = lastMemory.durable || [];
    if (!durable.length) {
      html += '<p class="empty-note">No durable memories yet. Use <code>/remember</code> in chat or wait for NTOX to learn one.</p>';
      return html;
    }
    html += durable.map(function (m) {
      const hist = (m.history || []).slice(-3).map(function (h) {
        return "<li>" + escapeHtml(fmtDate(h.timestamp)) + " — " + escapeHtml(h.reason) + ": " + escapeHtml(h.text) + "</li>";
      }).join("");
      return (
        '<div class="mem-item" data-mem="' + escapeHtml(m.id) + '">' +
        '<div class="mem-meta"><span class="chip">' + escapeHtml(m.lane) + "</span><span>" +
        pct(m.confidence) + " conf</span>" +
        (m.contradictionCount ? '<span class="chip warn">' + m.contradictionCount + " contradictions</span>" : "") +
        "</div>" +
        '<p class="mem-text">' + escapeHtml(m.text) + "</p>" +
        (hist ? '<details><summary class="mem-meta">history</summary><ul class="mem-text">' + hist + "</ul></details>" : "") +
        '<div class="belief-actions">' +
        '<button type="button" class="mini-btn" data-mem-edit="' + escapeHtml(m.id) + '">Edit</button>' +
        '<button type="button" class="mini-btn danger" data-mem-del="' + escapeHtml(m.id) + '">Delete</button>' +
        "</div></div>"
      );
    }).join("");
    return html;
  }

  function renderBeliefsTab() {
    if (!lastBeliefs) return '<p class="empty-note">Loading beliefs…</p>';
    let html = "";
    const st = lastBeliefs.stats || {};
    html += section(
      "Theory store",
      row("Observations", st.totalObservations) + row("Patterns", st.totalPatterns) +
        row("Theories", st.totalTheories) + row("Confirmed", st.confirmedTheories) +
        row("Meta-theories", st.totalMetaTheories),
    );
    const theories = lastBeliefs.theories || [];
    if (!theories.length) {
      html += '<p class="empty-note">No theories yet. They emerge from repeated observations across sessions.</p>';
    } else {
      html += theories.map(function (t) {
        return (
          '<div class="belief">' +
          '<div class="belief-top"><span class="belief-name">' + escapeHtml(t.name) +
          '</span><span class="belief-conf">' + pct(t.confidence) + (t.confirmed ? " · confirmed" : "") + "</span></div>" +
          '<div class="bar"><i style="width:' + Math.round((t.confidence || 0) * 100) + '%"></i></div>' +
          '<p class="belief-desc">' + escapeHtml(t.explanation) + "</p>" +
          '<div class="mem-meta">' + t.evidenceCount + " evidence · " + escapeHtml(fmtDate(t.timestamp)) + "</div>" +
          '<div class="belief-actions">' +
          '<button type="button" class="mini-btn ok" data-theory="' + escapeHtml(t.id) + '" data-vote="confirm">Confirm</button>' +
          '<button type="button" class="mini-btn danger" data-theory="' + escapeHtml(t.id) + '" data-vote="reject">Reject</button>' +
          "</div></div>"
        );
      }).join("");
    }
    const patterns = lastBeliefs.patterns || [];
    if (patterns.length) {
      html += section(
        "Cognitive patterns (" + patterns.length + ")",
        patterns.slice(0, 20).map(function (p) {
          return (
            '<div class="belief">' +
            '<div class="belief-top"><span class="belief-name">' + escapeHtml(p.name) +
            (p.compiled ? ' <span class="chip ok">compiled</span>' : "") +
            '</span><span class="belief-conf">' + pct(p.strength) + "</span></div>" +
            '<div class="bar"><i style="width:' + Math.round((p.strength || 0) * 100) + '%"></i></div>' +
            '<div class="mem-meta">' + escapeHtml((p.domains || []).join(", ") || "no domains") +
            " · " + p.hitCount + " hits · " + p.compileCount + "/5 compile</div></div>"
          );
        }).join(""),
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
    else if (drawerTab === "activity") renderActivityTab();
  }

  drawerTabs.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    drawerTab = btn.getAttribute("data-tab");
    requestDrawerData();
    renderDrawer();
  });
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  document.getElementById("inspectBtn").addEventListener("click", function () {
    if (drawerOpen) closeDrawer();
    else openDrawer(drawerTab);
  });
  document.getElementById("userCard").addEventListener("click", function () {
    openDrawer("why");
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
      socket.emit("vote_theory", { id: vote.getAttribute("data-theory"), vote: vote.getAttribute("data-vote") });
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
      const mem = ((lastMemory && lastMemory.durable) || []).find(function (m) {
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

  /* ---------- activity ---------- */
  const activityLog = [];

  function eventLabel(event) {
    if (event.type === "phase") return "<strong>" + escapeHtml(event.phase || "phase") + "</strong>";
    if (event.type === "tool_call") return "<strong>tool</strong> " + escapeHtml(event.name || "");
    if (event.type === "tool_result")
      return "<strong>" + (event.success ? "tool ok" : "tool failed") + "</strong> " + escapeHtml(event.name || "");
    if (event.type === "memory")
      return "<strong>memory</strong> " + escapeHtml(event.action || "") + " " + (event.count || "");
    if (event.type === "strategy") return "<strong>strategy</strong> " + escapeHtml(event.strategy || "");
    if (event.type === "skill") return "<strong>skill</strong> " + escapeHtml(event.skillName || "");
    if (event.type === "correction") return "<strong>correction</strong> " + escapeHtml(event.topicKey || "");
    if (event.type === "alive") return "<strong>alive</strong> " + escapeHtml((event.action && event.action.kind) || "action");
    if (event.type === "usage")
      return "<strong>usage</strong> " + fmtTokens(event.inputTokens || 0) + " in · " + fmtTokens(event.outputTokens || 0) + " out";
    return "<strong>event</strong> " + escapeHtml(event.type || "");
  }

  function addActivity(html, tone) {
    activityLog.unshift({ html: html, tone: tone || "" });
    while (activityLog.length > 40) activityLog.pop();
    if (drawerOpen && drawerTab === "activity") renderActivityTab();
  }

  function renderActivityTab() {
    if (!activityLog.length) {
      drawerBody.innerHTML = '<p class="empty-note">Activity from the last turns appears here.</p>';
      return;
    }
    drawerBody.innerHTML = activityLog.map(function (e) {
      return '<div class="event ' + e.tone + '">' + e.html + "</div>";
    }).join("");
  }

  /* ============================================================
     SLASH / PATH SUGGESTIONS
     ============================================================ */
  const SLASH_COMMANDS = [
    { name: "/new", hint: "reset conversation" },
    { name: "/help", hint: "gateway help" },
    { name: "/alive", hint: "host events & wakes" },
    { name: "/remember", hint: "teach NTOX something" },
    { name: "/cron list", hint: "scheduled jobs" },
    { name: "/cron help", hint: "cron usage" },
  ];

  let suggestItems = [];
  let suggestIndex = 0;
  let suggestKind = null;
  let pathTimer = 0;

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
      btn.innerHTML = '<span class="s-label"></span><span class="s-hint"></span>';
      btn.querySelector(".s-label").textContent = item.label;
      btn.querySelector(".s-hint").textContent = item.hint || "";
      btn.addEventListener("click", function () { acceptSuggest(i); });
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
      }).map(function (c) { return { label: c.name, hint: c.hint }; });
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

  /* ============================================================
     MODEL MENU
     ============================================================ */
  const CHECK_SVG = '<svg class="model-check" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';

  function closeModelMenu() {
    modelWrap.classList.remove("open");
    modelBtn.setAttribute("aria-expanded", "false");
  }

  function renderModelMenu() {
    modelMenu.innerHTML = "";
    const currentModel = currentSettings && currentSettings.model;

    if (currentSettings && currentSettings.providers && currentSettings.providers.length) {
      const plabel = document.createElement("div");
      plabel.className = "model-menu-label";
      plabel.textContent = "Provider";
      modelMenu.appendChild(plabel);
      currentSettings.providers.forEach(function (p) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "model-item" + (currentSettings.provider === p.id ? " sel" : "");
        btn.setAttribute("role", "menuitem");
        btn.innerHTML = "<span><b></b><small></small></span>" + CHECK_SVG;
        btn.querySelector("b").textContent = p.name;
        btn.querySelector("small").textContent = p.id;
        btn.addEventListener("click", function () {
          socket.emit("set_provider", { provider: p.id });
          closeModelMenu();
        });
        modelMenu.appendChild(btn);
      });
    }

    const mlabel = document.createElement("div");
    mlabel.className = "model-menu-label";
    mlabel.textContent = availableModels.length ? "Model" : "Model (loading…)";
    modelMenu.appendChild(mlabel);

    if (!availableModels.length) {
      const note = document.createElement("div");
      note.className = "sb-empty";
      note.textContent = "No catalog yet — try Refresh.";
      modelMenu.appendChild(note);
    }

    availableModels.slice(0, 300).forEach(function (m) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-item" + (currentModel === m.id ? " sel" : "");
      btn.setAttribute("role", "menuitem");
      btn.innerHTML = "<span><b></b><small></small></span>" + CHECK_SVG;
      btn.querySelector("b").textContent = m.name || m.id;
      btn.querySelector("small").textContent = m.id;
      btn.addEventListener("click", function () {
        socket.emit("set_model", { model: m.id });
        closeModelMenu();
      });
      modelMenu.appendChild(btn);
    });

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "model-item";
    refresh.setAttribute("role", "menuitem");
    refresh.innerHTML = "<span><b>Refresh model catalog</b><small>re-fetch available models</small></span>";
    refresh.addEventListener("click", function () {
      socket.emit("refresh_models");
      closeModelMenu();
    });
    modelMenu.appendChild(refresh);
  }

  modelBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    const open = modelWrap.classList.toggle("open");
    modelBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      socket.emit("get_settings");
      socket.emit("get_models");
      renderModelMenu();
    }
  });

  document.addEventListener("click", function (e) {
    if (!modelWrap.contains(e.target)) closeModelMenu();
  });

  /* ============================================================
     COMMAND PALETTE / HELP
     ============================================================ */
  let paletteOpen = false;
  let paletteMode = "root";
  let paletteAll = [];
  let paletteFiltered = [];
  let paletteIndex = 0;

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
    helpBody.innerHTML = HELP_ROWS.map(function (r) {
      return '<div class="help-row"><kbd>' + escapeHtml(r[0]) + "</kbd><span>" + escapeHtml(r[1]) + "</span></div>";
    }).join("");
    helpOverlay.hidden = false;
    document.getElementById("helpClose").focus();
  }

  function closeHelp() {
    helpOverlay.hidden = true;
  }

  document.getElementById("helpClose").addEventListener("click", closeHelp);
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
      if (currentSettings && currentSettings.providers) {
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
      { label: "New chat", hint: MOD + "⇧O", group: "chat", run: function () { newChat(); closePalette(); } },
      { label: "Clear current chat", hint: "", group: "chat", run: function () { if (!pending) socket.emit("clear_chat"); closePalette(); } },
      {
        label: "Toggle theme", hint: "", group: "view",
        run: function () {
          const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
          document.documentElement.dataset.theme = next;
          localStorage.setItem("ntox_theme", next);
          closePalette();
        },
      },
      { label: "Keyboard shortcuts", hint: "?", group: "view", run: function () { closePalette(); openHelp(); } },
      { label: "Inspect: Why", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("why"); } },
      { label: "Inspect: Trace", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("trace"); } },
      { label: "Inspect: Files", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("files"); } },
      { label: "Inspect: Memory", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("memory"); } },
      { label: "Inspect: Beliefs", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("beliefs"); } },
      { label: "Inspect: Activity", hint: "", group: "inspect", run: function () { closePalette(); openDrawer("activity"); } },
      {
        label: "Switch model…", hint: currentSettings ? currentSettings.model : "", group: "model",
        run: function () { setPaletteMode("models"); },
      },
      {
        label: "Switch provider…", hint: currentSettings ? currentSettings.provider : "", group: "model",
        run: function () { setPaletteMode("providers"); },
      },
      {
        label: "Refresh model catalog", hint: "", group: "model",
        run: function () { socket.emit("refresh_models"); closePalette(); },
      },
      { label: "Jump to chat…", hint: chats.length + " chats", group: "chat", run: function () { setPaletteMode("chats"); } },
    ];
    SLASH_COMMANDS.forEach(function (c) {
      items.push({
        label: "Send " + c.name,
        hint: c.hint,
        group: "send",
        run: function () { closePalette(); submit(c.name); },
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
        "</span><span class='p-hint'></span>";
      btn.querySelector(".p-label").insertAdjacentText("beforeend", item.label);
      btn.querySelector(".p-hint").textContent = item.hint || "";
      btn.addEventListener("click", function () { item.run(); });
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

  document.getElementById("paletteBtn").addEventListener("click", function () {
    if (paletteOpen) closePalette();
    else openPalette();
  });

  /* ============================================================
     COMPOSER EVENTS
     ============================================================ */
  input.addEventListener("input", function () {
    autosize();
    updateSuggest();
    if (!pending) send.disabled = !input.value.trim() || socket.disconnected;
  });

  input.addEventListener("keydown", function (e) {
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
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (pending) stop();
      else submit();
      return;
    }
    if (e.key === "Escape" && pending) {
      e.preventDefault();
      stop();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (paletteOpen || !helpOverlay.hidden) return;
    if (suggestItems.length && !suggestPop.hidden) {
      acceptSuggest(suggestIndex);
      return;
    }
    if (pending) stop();
    else submit();
  });

  document.getElementById("newChat").addEventListener("click", newChat);
  document.getElementById("clearBtn").addEventListener("click", function () {
    if (pending) return;
    socket.emit("clear_chat");
  });

  Array.prototype.forEach.call(document.querySelectorAll("#empty .chip"), function (chip) {
    chip.addEventListener("click", function () {
      if (pending) return;
      submit(chip.dataset.prompt || chip.textContent.trim());
      if (isMobile()) setSidebar(false);
    });
  });

  /* ============================================================
     MESSAGE CLICKS (copy code / expand)
     ============================================================ */
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
      setTimeout(function () { btn.textContent = "Copy"; }, 1200);
    });
  });

  /* ============================================================
     KEYBOARD SHORTCUTS
     ============================================================ */
  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  document.addEventListener("keydown", function (e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (paletteOpen) closePalette();
      else openPalette();
      return;
    }
    if (mod && e.shiftKey && (e.key === "o" || e.key === "O")) {
      e.preventDefault();
      newChat();
      return;
    }
    if (mod && !e.shiftKey && (e.key === "b" || e.key === "B") && !isEditable(e.target)) {
      e.preventDefault();
      app.classList.toggle("collapsed");
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
      if (modelWrap.classList.contains("open")) {
        closeModelMenu();
        return;
      }
      if (drawerOpen) {
        closeDrawer();
        return;
      }
      if (pending) stop();
    }
  });

  /* ============================================================
     TOKEN GATE
     ============================================================ */
  function showTokenPrompt() {
    tokenOverlay.hidden = false;
    tokenInput.focus();
  }

  function connectWithToken(token) {
    authToken = token;
    sessionStorage.setItem("ntox_token", token);
    tokenOverlay.hidden = true;
    tokenError.textContent = "";
    socket.auth = { token: token };
    socket.disconnect();
    socket.connect();
  }

  document.getElementById("tokenSubmit").addEventListener("click", function () {
    const value = tokenInput.value.trim() || "";
    if (!value) {
      tokenError.textContent = "Token required";
      return;
    }
    connectWithToken(value);
  });
  tokenInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      const value = tokenInput.value.trim();
      if (value) connectWithToken(value);
    }
  });

  /* ============================================================
     SOCKET
     ============================================================ */
  socket.on("connect", function () {
    setStatus("connected", "Connected");
    ensureSessionId();
    socket.emit("join", { sessionId: sessionId });
    setReady(!pending);
    loadStatus();
  });
  socket.on("disconnect", function () {
    setStatus("disconnected", "Disconnected");
    setReady(false);
  });
  socket.on("connect_error", function (err) {
    setStatus("disconnected", "Connection failed");
    setReady(false);
    if (err && (err.message === "Unauthorized" || (err.data && err.data.message === "Unauthorized"))) {
      showTokenPrompt();
    }
  });

  socket.on("joined", function (data) {
    if (data && data.error) return;
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
        setTimeout(regenerate, 300);
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
    addActivity("<strong>approval</strong> " + escapeHtml(data.scope) + " " + escapeHtml(data.command || ""), "ok");
    const card = messages.querySelector(".approval-card");
    if (card && data.scope === "deny") card.remove();
  });

  socket.on("path_suggestions", function (data) {
    if (suggestKind !== "path") return;
    const paths = (data && data.paths) || [];
    suggestItems = paths.map(function (p) {
      return { label: p, hint: p.endsWith("/") ? "dir" : "file" };
    });
    suggestIndex = 0;
    renderSuggest();
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
    if (btn) btn.classList.remove("busy");
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
    speaking.onended = function () { speaking = null; };
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
      addActivity("<strong>rollback failed</strong> " + escapeHtml((data && data.error) || "unknown"), "fail");
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

  socket.on("settings", function (data) {
    currentSettings = data || null;
    if (data) {
      modelLabel.textContent = data.model || "NTOX";
      modelEl.textContent = data.model || "unknown";
      providerEl.textContent = data.provider || "unknown";
    }
    if (modelWrap.classList.contains("open")) renderModelMenu();
    if (paletteOpen && paletteMode === "root") {
      const scroll = paletteInput.value;
      paletteAll = buildRootPaletteItems();
      paletteInput.value = scroll;
      renderPalette();
    }
  });

  socket.on("models", function (data) {
    availableModels = (data && data.models) || [];
    if (data && data.refreshed) addActivity("<strong>catalog</strong> " + availableModels.length + " models", "ok");
    if (data && data.error) addActivity("<strong>catalog</strong> " + escapeHtml(data.error), "fail");
    if (modelWrap.classList.contains("open")) renderModelMenu();
    if (paletteOpen && paletteMode === "models") {
      paletteAll = [{ label: "← Back", hint: "esc", run: function () { setPaletteMode("root"); } }];
      availableModels.slice(0, 300).forEach(function (m) {
        paletteAll.push({
          label: m.name || m.id,
          hint: m.id,
          run: function () {
            socket.emit("set_model", { model: m.id });
            closePalette();
          },
        });
      });
      renderPalette();
    }
  });

  socket.on("model_changed", function (data) {
    if (data && data.ok) {
      addActivity("<strong>model</strong> " + escapeHtml(data.model || data.provider || "updated"), "ok");
      loadStatus();
      socket.emit("get_settings");
    } else {
      addActivity("<strong>model</strong> update failed", "fail");
    }
  });

  socket.on("error", function (data) {
    addActivity("<strong>error</strong> " + escapeHtml(data.text || "unknown"), "fail");
    if (current) {
      const content = current.querySelector(".content");
      if (!currentText) {
        content.innerHTML = renderMarkdown("**Error:** " + (data.text || "unknown"));
        addActionButtons(current, "assistant", data.text || "error");
        current.classList.add("done");
      } else {
        finalizeAssistant(currentText);
      }
    }
    current = null;
    setPending(false);
    phasePill.textContent = "idle";
  });

  /* ============================================================
     STATUS.JSON
     ============================================================ */
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
        if (status.model) {
          modelLabel.textContent = status.model;
          modelEl.textContent = status.model;
        }
        if (status.provider) providerEl.textContent = status.provider;
        const n = (status.sessions && status.sessions.sessions) || 0;
        sessionEl.textContent = n + " active session" + (n === 1 ? "" : "s");
      })
      .catch(function () {});
  }

  /* ============================================================
     THEME COLOR / SERVICE WORKER / INIT
     ============================================================ */
  const themeColorMeta = document.getElementById("theme-color");
  function syncThemeColor() {
    if (!themeColorMeta) return;
    themeColorMeta.content = document.documentElement.dataset.theme === "dark" ? "#1f1e1c" : "#ffffff";
  }
  syncThemeColor();
  if (window.MutationObserver) {
    new MutationObserver(syncThemeColor).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  if ("serviceWorker" in navigator) {
    const registerServiceWorker = function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    };
    if (document.readyState === "complete") registerServiceWorker();
    else window.addEventListener("load", registerServiceWorker);
  }

  setStatus("connecting", "Connecting");
  renderChatList();
  ensureSessionId();
  autosize();
})();
