/* Chat UI for the in-panel Premiere agent (ported from the InventorAgent panel). */
(function () {
"use strict";
if (!window.MCPAgentHost) return; // headless engine instance: no chat

const $ = (id) => document.getElementById(id);
// In the CEP panel the agent host is agent-host.cjs (Node), loaded just before this script.
const host = window.MCPAgentHost || null;
const post = (msg) => host ? host.postMessage(msg) : console.log("→ host", msg);

let state = null;
let running = false;
let currentLog = null;
let workingEl = null, workingTimer = null, workingStart = 0;
let conversation = { id: null, title: "New chat", pinned: false };
let references = [], pendingSend = false, switchingChat = false, draftTimer = null, toastTimer = null;
let followLatest = true;
let historyOpen = false;

const LEVEL_LABELS = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const levelLabel = (l) => LEVEL_LABELS[l] || (l.charAt(0).toUpperCase() + l.slice(1));

const icons = {
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
};
$("sendBtn").innerHTML = icons.send;

// ---------------------------------------------------------------- tabs
document.querySelectorAll(".tab").forEach(t => t.onclick = () => showTab(t.dataset.tab));
function showTab(name) {
  hideQuoteOption();
  if (name === "history") { openHistory(); return; }
  closeHistory(false);
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $("chatView").hidden = name !== "chat";
  $("settingsView").hidden = name !== "settings";
  if (name === "settings") post({ type: "refresh" });
  else input.focus();
}

function openHistory() {
  hideQuoteOption();
  saveDraft(); closeMentions();
  document.querySelectorAll(".picker.open").forEach(p => p.classList.remove("open"));
  historyOpen = true;
  $("historyView").inert = false;
  $("historyView").setAttribute("aria-hidden", "false");
  $("historyView").classList.add("open");
  $("historyBackdrop").classList.add("open");
  $("historyToggle").setAttribute("aria-expanded", "true");
  $("historyToggle").setAttribute("aria-label", "Close chat history");
  $("historySearch").focus();
  $("mainContent").inert = true;
  post({ type: "history" });
}
function closeHistory(restoreFocus = true) {
  if (!historyOpen) return;
  historyOpen = false;
  $("mainContent").inert = false;
  if (restoreFocus || $("historyView").contains(document.activeElement)) $("historyToggle").focus();
  $("historyView").inert = true;
  $("historyView").setAttribute("aria-hidden", "true");
  $("historyView").classList.remove("open");
  $("historyBackdrop").classList.remove("open");
  $("historyToggle").setAttribute("aria-expanded", "false");
  $("historyToggle").setAttribute("aria-label", "Open chat history");
}
$("historyToggle").onclick = () => historyOpen ? closeHistory() : openHistory();
$("historyClose").onclick = () => closeHistory();
$("historyBackdrop").onclick = () => closeHistory();

// ---------------------------------------------------------------- markdown (HTML is escaped first)
function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}
function markdown(src) {
  const out = [];
  esc(src).split(/```/).forEach((block, i) => {
    if (i % 2 === 1) { out.push(`<pre><code>${block.replace(/^[a-zA-Z0-9_-]*\n/, "")}</code></pre>`); return; }
    let list = null, para = [], table = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(x => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`); list = null; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).map(r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim())));
      out.push(`<table>${rows.map((r, ri) => `<tr>${r.map(c => ri === 0 ? `<th>${c}</th>` : `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);
      table = [];
    };
    for (const line of block.split("\n")) {
      let m;
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); table.push(line); continue; } else flushTable();
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
      else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); }
      else if (line.trim() === "") { flushPara(); flushList(); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList(); flushTable();
  });
  return out.join("");
}

// ---------------------------------------------------------------- timeline
function div(cls, html) { const d = document.createElement("div"); d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }
function showTimeline() { $("empty").hidden = true; $("timeline").hidden = false; }
function scrollDown(force = false) { const t = $("timeline"); if (force || followLatest) t.scrollTop = t.scrollHeight; }
function add(el) { showTimeline(); $("timeline").insertBefore(el, workingEl && workingEl.parentNode ? workingEl : null); scrollDown(); return el; }

function actionButton(label, title, action, cls = "") {
  const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.className = cls;
  b.onclick = action; return b;
}
function copyButton(text, label = "Copy message") {
  const button = actionButton("", label, () => copyText(text), "copy-btn");
  button.innerHTML = icons.copy; button.setAttribute("aria-label", label);
  button.onmousedown = e => e.preventDefault();
  return button;
}
function messageActions(message, text) {
  const actions = div("message-actions"); actions.appendChild(copyButton(text)); message.appendChild(actions);
}
// The agent's text between steps is narration, not the answer. It shows as a full
// message until the next step arrives, then folds into the reply's single step group:
// a one-line update above the steps, with the full text kept inside the group.
let pendingNarration = null; // { el, text } - the latest assistant message of this reply
function shortUpdate(text) {
  const line = String(text).replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>|]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/\n+/).map(s => s.trim()).filter(Boolean)[0] || "";
  const sentence = (line.match(/^.*?[.!?](\s|$)/) || [line])[0].trim();
  return sentence.length > 140 ? sentence.slice(0, 137).trimEnd() + "…" : sentence;
}
function foldNarration() {
  const p = pendingNarration; pendingNarration = null;
  if (!p) return;
  const summary = shortUpdate(p.text);
  let log = currentLog;
  if (!log) { log = makeLog(); p.el.replaceWith(log); currentLog = log; } else p.el.remove();
  if (summary) { const u = log.querySelector(".wl-update"); u.textContent = summary; u.title = p.text; u.hidden = false; }
  const note = div("tool-note message-text", markdown(p.text));
  log.querySelector(".worklog-body").appendChild(note);
}

function addUser(text, refs = []) {
  currentLog = null; pendingNarration = null;
  const m = div("msg user"), b = div("bubble"), content = div("message-text"); content.textContent = text; b.appendChild(content);
  refs.forEach(ref => b.appendChild(actionButton("@ " + ref.title, "Open referenced chat", () => openChat(ref.id), "reference-link")));
  m.appendChild(b); messageActions(m, text); add(m);
}
function addAssistant(text) {
  const m = div("msg assistant"), content = div("message-text", markdown(text)); m.appendChild(content);
  content.querySelectorAll("pre").forEach(pre => {
    const code = pre.querySelector("code");
    const block = div("code-block"); pre.replaceWith(block); block.append(pre, copyButton(code.textContent, "Copy code"));
  });
  messageActions(m, text); add(m);
  pendingNarration = { el: m, text };
}
function addNotice(text) { add(div("msg notice")).textContent = text; }
function addError(text) { currentLog = null; pendingNarration = null; add(div("msg error")).textContent = text; }

function makeLog() {
  const log = div("worklog", `<div class="wl-update" hidden></div><div class="worklog-head">${icons.chev}<span class="wl-title"></span></div><div class="worklog-body"></div>`);
  log.querySelector(".worklog-head").onclick = () => log.classList.toggle("open");
  log.count = 0; log.errors = 0;
  updateLogTitle(log);
  return log;
}
// One step group per reply: every step of the reply is counted together.
function ensureLog() {
  if (pendingNarration) foldNarration();
  if (currentLog) return currentLog;
  currentLog = add(makeLog());
  return currentLog;
}
function updateLogTitle(log) {
  const runningTool = log.querySelector(".tool.running");
  let t = `${log.count} step${log.count === 1 ? "" : "s"}`;
  if (log.errors) t += ` · ${log.errors} failed`;
  if (runningTool) t = `${pretty(runningTool.dataset.name)}…`;
  log.querySelector(".wl-title").textContent = t;
}
function pretty(name) { const s = name.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }
function summarize(inputJson) {
  try { return Object.entries(JSON.parse(inputJson || "{}")).slice(0, 4).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("  "); }
  catch { return inputJson; }
}
function prettyJson(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s || ""; } }
const toolEls = new Map();
function addToolCall(id, name, inputJson) {
  const log = ensureLog();
  const t = div("tool running", `<div class="tool-row"><span class="dot"></span><span class="tool-name">${esc(name)}</span><span class="tool-sum">${esc(summarize(inputJson))}</span></div>
    <div class="tool-detail"><span class="label-faint">input</span>\n${esc(prettyJson(inputJson))}</div>`);
  t.dataset.name = name;
  t.querySelector(".tool-row").onclick = () => t.classList.toggle("expanded");
  toolEls.set(String(id), t);
  log.querySelector(".worklog-body").appendChild(t);
  log.count++;
  updateLogTitle(log);
  scrollDown();
}
function addToolResult(id, ok, text) {
  const t = toolEls.get(String(id)); if (!t) return;
  t.classList.remove("running"); t.classList.add(ok ? "ok" : "err");
  t.querySelector(".tool-detail").insertAdjacentHTML("beforeend", `\n\n<span class="label-faint">${ok ? "result" : "error"}</span>\n${esc(text)}`);
  const log = t.closest(".worklog");
  // Failures show in the group title; the group stays however the user left it.
  if (!ok) { t.classList.add("expanded"); log.errors++; log.classList.add("has-errors"); }
  updateLogTitle(log);
}

function setRunning(value) {
  running = value;
  const b = $("sendBtn");
  b.classList.toggle("stop", value);
  b.title = value ? "Stop" : "Send (Enter)";
  b.innerHTML = value ? icons.stop : icons.send;
  updateSendEnabled();
  $("newBtn").disabled = value || switchingChat;
  $("modelBtn").disabled = value;
  if (value) {
    clearInterval(workingTimer); if (workingEl) workingEl.remove();
    workingStart = Date.now();
    workingEl = div("working", '<span class="spinner"></span><span class="wtext">Thinking…</span>');
    showTimeline(); $("timeline").appendChild(workingEl); scrollDown();
    workingTimer = setInterval(() => { workingEl.querySelector(".wtext").textContent = `Working · ${Math.round((Date.now() - workingStart) / 1000)}s`; }, 1000);
  } else {
    clearInterval(workingTimer);
    if (workingEl) workingEl.remove();
    workingEl = null; currentLog = null; pendingNarration = null;
    document.querySelectorAll(".tool.running").forEach(t => t.classList.remove("running"));
    document.querySelectorAll(".worklog").forEach(updateLogTitle);
  }
}

$("timeline").addEventListener("scroll", () => {
  const t = $("timeline"); followLatest = t.scrollHeight - t.scrollTop - t.clientHeight < 70;
  $("latestBtn").hidden = followLatest;
});
$("latestBtn").onclick = () => { followLatest = true; scrollDown(true); $("latestBtn").hidden = true; };

// ---------------------------------------------------------------- composer
const input = $("input");
// The panel can lay out at near-zero width while it opens, which made scrollHeight huge;
// an empty box is always one line, and the size is recomputed when the panel resizes.
function autosize() {
  input.style.height = "auto";
  if (!input.value || input.clientWidth < 40) { input.style.height = ""; return; }
  const max = Math.max(64, Math.min(200, Math.round(window.innerHeight * 0.3)));
  input.style.height = Math.min(input.scrollHeight, max) + "px";
}
window.addEventListener("resize", () => autosize());
input.addEventListener("focus", () => autosize());
setTimeout(autosize, 300);
function updateSendEnabled() { $("sendBtn").disabled = !running && (pendingSend || switchingChat || input.value.trim() === ""); }
function draftKey() { return conversation.id || "new"; }
function saveDraft() {
  clearTimeout(draftTimer);
  if (switchingChat) return;
  post({ type: "draft", key: draftKey(), text: input.value, references: references.map(r => r.id) });
}
input.addEventListener("input", () => {
  autosize(); updateSendEnabled(); clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 200);
  const before = input.value.slice(0, input.selectionStart);
  if (/(^|\s)@$/.test(before)) openMentions(input.selectionStart - 1);
});
input.addEventListener("blur", () => { if (!pendingSend) saveDraft(); });
input.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!running) submit(); }
  if (e.key === "ArrowUp" && !input.value) {
    const last = Array.from($("timeline").querySelectorAll(".msg.user .message-text")).pop();
    if (last) { e.preventDefault(); insertText(last.textContent); }
  }
});
function submit() {
  if (running || pendingSend || switchingChat) return;
  const text = input.value.trim(); if (!text) return;
  saveDraft(); closeMentions(); pendingSend = true; input.readOnly = true; updateSendEnabled();
  followLatest = true;
  post({ type: "send", text, references: references.map(r => r.id) });
}
$("sendBtn").onclick = () => running ? post({ type: "stop" }) : submit();
function startSwitch() { hideQuoteOption(); saveDraft(); closeMentions(); switchingChat = true; input.readOnly = true; $("newBtn").disabled = true; updateSendEnabled(); }
function finishSwitch() { switchingChat = false; input.readOnly = pendingSend; $("newBtn").disabled = running; updateSendEnabled(); }
$("newBtn").onclick = () => { if (running || pendingSend || switchingChat) return; startSwitch(); post({ type: "new" }); showTab("chat"); };

function openChat(id) {
  if (running || pendingSend || switchingChat) { toast("Wait for the current reply or chat to finish opening."); return; }
  startSwitch(); post({ type: "openChat", id });
}
function insertText(text) {
  if (pendingSend || switchingChat) return;
  showTab("chat");
  input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
  input.focus(); autosize(); updateSendEnabled(); saveDraft();
}
let selectedQuote = null, selectingMessageText = false, quoteFrame = 0;
function hideQuoteOption() { selectedQuote = null; $("quoteSelectionBtn").hidden = true; }
function showQuoteOption() {
  const button = $("quoteSelectionBtn");
  if (pendingSend || switchingChat || historyOpen || $("chatView").hidden || $("actionDialog").open ||
      document.activeElement?.matches("input, textarea")) { hideQuoteOption(); return; }
  const selection = window.getSelection();
  const elementFor = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!selection || selection.isCollapsed ||
      !elementFor(selection.anchorNode)?.closest("#timeline .message-text") ||
      !elementFor(selection.focusNode)?.closest("#timeline .message-text")) { hideQuoteOption(); return; }
  const text = selection.toString(); if (!text.trim()) { hideQuoteOption(); return; }
  const timeline = $("timeline").getBoundingClientRect();
  const rect = Array.from(selection.getRangeAt(0).getClientRects()).find(r => r.width > 0 && r.bottom > timeline.top && r.top < timeline.bottom);
  if (!rect) { hideQuoteOption(); return; }
  selectedQuote = { text, key: draftKey() };
  button.hidden = false;
  const width = button.offsetWidth, height = button.offsetHeight;
  const top = rect.top - height - 7 >= timeline.top ? rect.top - height - 7 : rect.bottom + 7;
  button.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)) + "px";
  button.style.top = Math.max(timeline.top + 3, Math.min(timeline.bottom - height - 3, top)) + "px";
}
function scheduleQuoteOption() {
  cancelAnimationFrame(quoteFrame);
  quoteFrame = requestAnimationFrame(() => { if (!selectingMessageText) showQuoteOption(); });
}
$("quoteSelectionBtn").onmousedown = e => e.preventDefault();
$("quoteSelectionBtn").onclick = () => {
  const quote = selectedQuote;
  hideQuoteOption();
  if (!quote || quote.key !== draftKey() || pendingSend || switchingChat || historyOpen) return;
  const prefix = !input.value || input.value.endsWith("\n\n") ? "" : input.value.endsWith("\n") ? "\n" : "\n\n";
  input.setSelectionRange(input.value.length, input.value.length);
  window.getSelection()?.removeAllRanges();
  insertText(prefix + quote.text.replace(/\r\n?/g, "\n").split("\n").map(line => "> " + line).join("\n") + "\n\n");
};
document.addEventListener("pointerdown", e => {
  if (e.target.closest("#quoteSelectionBtn")) return;
  selectingMessageText = e.button === 0 && !!e.target.closest("#timeline .message-text");
  hideQuoteOption();
});
document.addEventListener("pointerup", e => {
  const wasSelecting = selectingMessageText;
  selectingMessageText = false;
  if (wasSelecting && e.button === 0) scheduleQuoteOption();
});
document.addEventListener("selectionchange", () => { if (!selectingMessageText) scheduleQuoteOption(); });
$("timeline").addEventListener("scroll", hideQuoteOption);
window.addEventListener("resize", scheduleQuoteOption);
window.addEventListener("blur", hideQuoteOption);
function copyText(text) {
  if (host) post({ type: "copy", text });
  else navigator.clipboard.writeText(text).then(() => toast("Copied."), () => toast("Select the text and press Ctrl+C."));
}

function toast(text) { clearTimeout(toastTimer); $("toast").textContent = text; $("toast").hidden = false; toastTimer = setTimeout(() => $("toast").hidden = true, 4500); }
function requestAction({ title, value, help = "", apply = "Save", danger = false, cancel = true }) {
  const dialog = $("actionDialog"); if (dialog.open) return Promise.resolve(null);
  $("dialogTitle").textContent = title; $("dialogHelp").textContent = help;
  $("dialogInput").hidden = $("dialogLabel").hidden = value === undefined;
  $("dialogInput").value = value || ""; $("dialogInput").required = value !== undefined;
  $("dialogApply").textContent = apply; $("dialogApply").classList.toggle("danger", danger);
  $("dialogCancel").hidden = !cancel;
  dialog.returnValue = ""; dialog.showModal();
  if (value !== undefined) { $("dialogInput").focus(); $("dialogInput").select(); }
  return new Promise(resolve => {
    $("actionForm").onsubmit = e => { e.preventDefault(); if (value !== undefined && !$("dialogInput").value.trim()) return; dialog.close("apply"); };
    $("dialogCancel").onclick = () => dialog.close();
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "apply" ? (value === undefined ? true : $("dialogInput").value.trim()) : null), { once: true });
  });
}
document.addEventListener("keydown", e => {
  if (e.isComposing || $("actionDialog").open) return;
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (e.key.toLowerCase() === "k") { e.preventDefault(); showTab("history"); $("historySearch").select(); }
    if (e.key.toLowerCase() === "n") { e.preventDefault(); $("newBtn").click(); }
    if (e.key.toLowerCase() === "l") { e.preventDefault(); showTab("chat"); }
  }
  if (e.key === "Escape") {
    if (!$("quoteSelectionBtn").hidden) { e.preventDefault(); hideQuoteOption(); window.getSelection()?.removeAllRanges(); }
    else if (historyOpen) { e.preventDefault(); closeHistory(); }
    else if (!$("mentionMenu").hidden) { e.preventDefault(); closeMentions(); input.focus(); }
    else if (document.querySelector(".picker.open")) document.querySelectorAll(".picker.open").forEach(p => p.classList.remove("open"));
    else if (running) post({ type: "stop" });
  }
});

let mentionAt = null, mentionIndex = 0;
function openMentions(at = null) {
  mentionAt = at; mentionIndex = 0; $("mentionSearch").value = ""; $("mentionMenu").hidden = false;
  post({ type: "history" }); renderMentions(); $("mentionSearch").focus();
}
function closeMentions() { $("mentionMenu").hidden = true; mentionAt = null; }
function addReference(chat) {
  if (references.length >= 3) { toast("You can reference up to three chats per message."); return; }
  if (!references.some(r => r.id === chat.id)) references.push({ id: chat.id, title: chat.title });
  if (mentionAt !== null && input.value[mentionAt] === "@") input.setRangeText("", mentionAt, mentionAt + 1, "end");
  closeMentions(); renderReferences(); autosize(); saveDraft(); input.focus();
}
function renderReferences() {
  const list = $("references"); list.innerHTML = ""; list.hidden = !references.length;
  references.forEach(ref => {
    const chip = div("reference-chip"); const label = document.createElement("span"); label.textContent = "@ " + ref.title; chip.title = ref.title;
    const remove = actionButton("×", "Remove reference to " + ref.title, () => { references = references.filter(r => r.id !== ref.id); renderReferences(); saveDraft(); input.focus(); });
    remove.setAttribute("aria-label", remove.title); chip.append(label, remove); list.appendChild(chip);
  });
}
function renderMentions() {
  const list = $("mentionList"), q = $("mentionSearch").value.trim().toLowerCase(); list.innerHTML = "";
  const items = historyItems.filter(c => c.id !== conversation.id && !references.some(r => r.id === c.id) && (!q || (c.title + " " + c.searchText).toLowerCase().includes(q))).slice(0, 12);
  mentionIndex = Math.max(0, Math.min(mentionIndex, items.length - 1));
  items.forEach((c, i) => {
    const b = actionButton(c.title, "Include this chat's messages as context", () => addReference(c), i === mentionIndex ? "active" : "");
    const small = document.createElement("small"); small.textContent = c.preview || c.label; b.appendChild(small); list.appendChild(b);
  });
  if (!items.length) list.appendChild(div("hint", "No other chats found."));
}
$("mentionSearch").oninput = () => { mentionIndex = 0; renderMentions(); };
$("mentionSearch").onkeydown = e => {
  const buttons = $("mentionList").querySelectorAll("button");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); mentionIndex += e.key === "ArrowDown" ? 1 : -1; renderMentions();
    document.querySelector("#mentionList .active")?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") { e.preventDefault(); buttons[mentionIndex]?.click(); }
};

// ---------------------------------------------------------------- pickers
function bindPicker(pickerId, btnId) {
  $(btnId).onclick = (e) => {
    e.stopPropagation();
    const p = $(pickerId); const open = !p.classList.contains("open");
    document.querySelectorAll(".picker.open").forEach(x => x.classList.remove("open"));
    p.classList.toggle("open", open);
  };
}
bindPicker("modelPicker", "modelBtn");
bindPicker("thinkPicker", "thinkBtn");
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) document.querySelectorAll(".picker.open").forEach(x => x.classList.remove("open")); });

function menuItem(label, onClick, cls = "", active = false) {
  const b = document.createElement("button");
  b.className = "item " + cls;
  b.innerHTML = `<span class="check">${active ? "✓" : ""}</span><span>${esc(label)}</span>`;
  b.onclick = (e) => { e.stopPropagation(); document.querySelectorAll(".picker.open").forEach(x => x.classList.remove("open")); onClick && onClick(); };
  return b;
}
function statusText(g) {
  return { SignedIn: g.detail || "signed in", SignedOut: "not signed in", Checking: g.detail || "checking…", NotInstalled: "not installed" }[g.state] || "";
}

function renderPickers() {
  const sel = state.selected;
  $("modelLabel").textContent = sel.label;
  $("modelBtn").classList.toggle("warn", !sel.usable);

  const menu = $("modelMenu");
  menu.innerHTML = "";
  state.groups.forEach((g, gi) => {
    // No provider headings: the model names say whose they are, and the account detail stays private.
    if (gi > 0) menu.appendChild(div("sep"));
    if (g.state === "SignedOut" && g.canSignIn) menu.appendChild(menuItem(`Sign in to ${g.label}…`, () => post({ type: "signIn", backend: g.backend }), "action"));
    else if (g.state === "NotInstalled") menu.appendChild(menuItem(`Install ${g.label}…`, () => post({ type: "install", backend: g.backend }), "action"));
    else g.models.forEach(m =>
      menu.appendChild(menuItem(m.label, () => post({ type: "select", backend: g.backend, model: m.id }), "", sel.backend === g.backend && sel.model === m.id)));
  });
  menu.appendChild(div("sep"));
  menu.appendChild(menuItem("Manage models…", () => showTab("settings"), "muted"));

  $("thinkPicker").hidden = !sel.levels.length;
  $("thinkLabel").textContent = sel.thinking ? levelLabel(sel.thinking) : "";
  const tm = $("thinkMenu");
  tm.innerHTML = '<div class="group"><b>Thinking</b></div>';
  sel.levels.forEach(l => tm.appendChild(menuItem(levelLabel(l), () => post({ type: "setThinking", level: l }), "", l === sel.thinking)));
}

function renderEmpty() {
  $("emptyProject").textContent = state.premiere || "";
  const g = state.groups.find(x => x.backend === state.selected.backend);
  const card = $("signinCard");
  const install = g && g.state === "NotInstalled";
  card.hidden = !(g && ((g.state === "SignedOut" && g.canSignIn) || install));
  if (card.hidden) return;
  $("signinText").textContent = install
    ? `${g.label} isn't set up on this PC yet. Install it, then sign in with your account - no API key needed.`
    : `Sign in with your ${g.label} account to start - no API key needed.`;
  $("signinBtn").textContent = install ? `Install ${g.label}` : `Sign in to ${g.label}`;
  $("signinBtn").onclick = () => post({ type: install ? "install" : "signIn", backend: g.backend });
}

// ---------------------------------------------------------------- settings
// Accounts whose detail the user chose to show; forgotten when the panel reloads, so it's hidden by default.
const revealedAccounts = new Set();
function renderSettings() {
  // accounts
  const ac = $("accountsCard"); ac.innerHTML = "";
  state.accounts.forEach(a => {
    const dot = { SignedIn: "ok", SignedOut: "err", Checking: "warn" }[a.state] || "";
    const r = div("row", `<span class="dot ${dot}"></span><span class="name">${esc(a.label)}</span><span class="meta">${esc(statusText(a))}</span><span class="grow"></span>`);
    // The account detail (usually an email) is hidden until clicked, so it doesn't show on screen shares.
    if (a.detail && a.state !== "SignedOut" && a.state !== "NotInstalled") {
      const meta = r.querySelector(".meta");
      const sync = () => {
        const shown = revealedAccounts.has(a.backend);
        meta.classList.toggle("hidden-detail", !shown);
        meta.title = shown ? "Click to hide" : "Click to show";
      };
      meta.classList.add("secret");
      meta.onclick = () => { revealedAccounts.has(a.backend) ? revealedAccounts.delete(a.backend) : revealedAccounts.add(a.backend); sync(); };
      sync();
    }
    if (a.state === "SignedOut" && a.canSignIn) {
      const b = document.createElement("button"); b.className = "small-btn"; b.textContent = "Sign in";
      b.onclick = () => post({ type: "signIn", backend: a.backend }); r.appendChild(b);
    } else if (a.state === "NotInstalled") {
      const b = document.createElement("button"); b.className = "small-btn"; b.textContent = "Install";
      b.onclick = () => post({ type: "install", backend: a.backend }); r.appendChild(b);
    }
    ac.appendChild(r);
  });

  // models: enable/disable with the switch, delete with the bin, add from the account's catalog
  const mc = $("modelsCard"); mc.innerHTML = "";
  state.modelGroups.forEach((g, gi) => {
    if (gi > 0) mc.appendChild(div("group-sep"));
    mc.appendChild(div("group-label", esc(g.label)));
    g.items.forEach(m => {
      const r = div("row model" + (m.enabled ? "" : " off"), `<span class="name">${esc(m.label)}</span>`);
      const sw = document.createElement("label"); sw.className = "switch"; sw.title = m.enabled ? "Enabled - click to disable" : "Disabled - click to enable";
      sw.innerHTML = `<input type="checkbox" ${m.enabled ? "checked" : ""}><span></span>`;
      sw.querySelector("input").onchange = (e) => post({ type: "toggleModel", backend: g.backend, id: m.id, enabled: e.target.checked });
      const del = document.createElement("button"); del.className = "icon-x"; del.title = "Delete from list"; del.innerHTML = icons.trash;
      del.onclick = () => post({ type: "deleteModel", backend: g.backend, id: m.id });
      r.appendChild(sw); r.appendChild(del);
      mc.appendChild(r);
    });
    if (!g.items.length) mc.appendChild(div("sub", "No models - add one below."));

    const ar = div("add-row");
    const picker = div("picker");
    const b = document.createElement("button"); b.className = "link-btn"; b.textContent = "+ Add model";
    const menu = div("menu down");
    if (g.available.length) g.available.forEach(m => menu.appendChild(menuItem(m.label, () => post({ type: "addModel", backend: g.backend, id: m.id }))));
    else menu.appendChild(div("sub", "All models are already in your list."));
    b.disabled = false;
    b.onclick = (e) => {
      e.stopPropagation();
      const open = !picker.classList.contains("open");
      document.querySelectorAll(".picker.open").forEach(x => x.classList.remove("open"));
      picker.classList.toggle("open", open);
    };
    picker.appendChild(b); picker.appendChild(menu); ar.appendChild(picker); mc.appendChild(ar);
  });
  // api keys
  const kb = $("keysBody"); kb.innerHTML = "";
  state.keys.forEach(k => {
    const r = div("row", `<span class="name" style="width:84px">${esc(k.label)}</span>`);
    if (k.hasKey) {
      r.insertAdjacentHTML("beforeend", '<span class="meta">Saved</span><span class="grow"></span>');
      const b = document.createElement("button"); b.className = "small-btn"; b.textContent = "Remove";
      b.onclick = () => post({ type: "removeKey", backend: k.backend }); r.appendChild(b);
    } else {
      const f = document.createElement("input"); f.className = "field"; f.type = "password"; f.autocomplete = "off";
      f.placeholder = k.envVar ? `Paste key or set ${k.envVar}` : "Paste key";
      const b = document.createElement("button"); b.className = "small-btn"; b.textContent = "Save";
      const save = () => { if (f.value.trim()) post({ type: "saveKey", backend: k.backend, key: f.value.trim() }); };
      b.onclick = save; f.onkeydown = (e) => { if (e.key === "Enter") save(); };
      r.appendChild(f); r.appendChild(b);
    }
    kb.appendChild(r);
  });
}

// ---------------------------------------------------------------- history
let historyItems = [];
async function renameChat(chat) {
  const title = await requestAction({ title: "Rename chat", value: chat.title });
  if (title) post({ type: "renameChat", id: chat.id, title });
}
async function deleteChats(ids) {
  if (!ids.length) return;
  if (running && ids.includes(conversation.id)) { toast("Stop the current reply before deleting this chat."); return; }
  const first = historyItems.find(c => c.id === ids[0]);
  const approved = await requestAction({ title: ids.length === 1 ? "Delete this chat?" : `Delete ${ids.length} chats?`,
    help: (ids.length === 1 ? (first?.title || conversation.title) + ". " : "") + "This removes chat history only. Your Premiere project stays as it is. You can undo this deletion in History.", apply: "Delete", danger: true });
  if (!approved) return;
  saveDraft(); post({ type: "deleteChats", ids });
}
function visibleChats() {
  const q = $("historySearch").value.trim().toLowerCase();
  return historyItems.filter(c => !q || (c.title + " " + c.searchText + " " + c.label).toLowerCase().includes(q));
}
function when(iso) {
  const d = new Date(iso), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
function renderHistory() {
  const items = visibleChats();
  $("historyCount").textContent = `${items.length} chat${items.length === 1 ? "" : "s"}`;
  const list = $("historyList"); list.innerHTML = "";
  if (!items.length) { list.appendChild(div("hint", historyItems.length ? "No chats match." : "No saved chats yet. Chats are saved as you go.")); return; }
  const card = div("card");
  items.forEach(c => {
    const r = div("row chat" + (c.current ? " current" : ""));
    const open = document.createElement("button"); open.className = "chat-open";
    open.innerHTML = `<span class="title">${c.pinned ? "★ " : ""}${esc(c.title || "Untitled")}${c.current ? ' <small class="label-faint">· Open</small>' : ""}</span><span class="preview">${esc(c.preview)}</span><span class="meta">${esc(c.label)} · ${esc(when(c.updated))} · ${c.messages} messages</span>`;
    open.onclick = () => openChat(c.id); open.title = "Continue " + c.title;
    const pin = actionButton(c.pinned ? "★" : "☆", c.pinned ? "Unpin chat" : "Pin chat", () => post({ type: "pinChat", id: c.id }), "icon-x");
    const rename = actionButton("✎", "Rename chat", () => renameChat(c), "icon-x");
    const del = actionButton("", "Delete chat", () => deleteChats([c.id]), "icon-x"); del.innerHTML = icons.trash;
    [pin, rename, del].forEach(b => b.setAttribute("aria-label", b.title + ": " + c.title));
    r.append(open, pin, rename, del);
    card.appendChild(r);
  });
  list.appendChild(card);
}
$("historySearch").addEventListener("input", renderHistory);
$("historySearch").addEventListener("keydown", e => { if (e.key === "Enter") { const first = visibleChats()[0]; if (first) openChat(first.id); } });
$("undoDeleteBtn").onclick = () => post({ type: "undoDelete" });

// ---------------------------------------------------------------- host messages
const handlers = {
  state: (m) => { state = m; renderPickers(); renderEmpty(); renderSettings(); renderMcp(); },
  user: (m) => addUser(m.text, m.references),
  assistant: (m) => addAssistant(m.text),
  tool_call: (m) => addToolCall(m.id, m.name, m.input),
  tool_result: (m) => addToolResult(m.id, m.ok, m.text),
  running: (m) => setRunning(m.value),
  notice: (m) => addNotice(m.text),
  error: (m) => addError(m.text),
  history: (m) => { historyItems = m.items; $("undoDeleteBtn").hidden = !m.canUndo; renderHistory(); if (!$("mentionMenu").hidden) renderMentions(); },
  conversation: (m) => { conversation = m; },
  draft: (m) => {
    if (m.key !== draftKey()) return;
    clearTimeout(draftTimer); input.value = m.text; references = m.references || []; renderReferences(); autosize(); updateSendEnabled();
  },
  sent: () => { clearTimeout(draftTimer); pendingSend = false; input.readOnly = false; input.value = ""; references = []; renderReferences(); autosize(); updateSendEnabled(); },
  sendRejected: () => { pendingSend = false; input.readOnly = false; updateSendEnabled(); input.focus(); },
  navigationRejected: () => finishSwitch(),
  toast: (m) => toast(m.text),
  deleted: (m) => { toast(`${m.count} chat${m.count === 1 ? "" : "s"} deleted. Undo is available in History.`); },
  opened: () => {
    finishSwitch();
    // steps that never got a result (the reply was stopped) shouldn't spin forever
    document.querySelectorAll(".tool.running").forEach(t => t.classList.remove("running"));
    document.querySelectorAll(".worklog").forEach(updateLogTitle);
    currentLog = null; pendingNarration = null; followLatest = true; showTab("chat"); scrollDown(true);
  },
  clear: () => { hideQuoteOption(); clearInterval(workingTimer); workingEl = null; $("timeline").innerHTML = ""; $("timeline").hidden = true; $("empty").hidden = false; $("latestBtn").hidden = true; followLatest = true; currentLog = null; pendingNarration = null; toolEls.clear(); },
};
// ---------------------------------------------------------------- Premiere MCP settings
function renderMcp() {
  if (!state.mcp) return;
  const field = $("mcpServerInput");
  if (document.activeElement !== field) field.value = state.mcp.server || "";
  $("mcpServerHelp").textContent = "Now using: " + state.mcp.description;
  const sel = $("toolPackSelect");
  if (!sel.options.length) state.mcp.toolPacks.forEach(p => { const o = document.createElement("option"); o.value = p; o.textContent = p === "full" ? "Full catalog" : p; sel.appendChild(o); });
  sel.value = state.mcp.toolPack;
}
$("mcpServerSave").onclick = () => post({ type: "setMcpServer", value: $("mcpServerInput").value });
$("mcpServerInput").addEventListener("keydown", e => { if (e.key === "Enter") post({ type: "setMcpServer", value: e.target.value }); });
$("toolPackSelect").onchange = (e) => post({ type: "setToolPack", value: e.target.value });
$("bridgePill").onclick = () => toast($("statusText").textContent + " - " + $("statusDetail").textContent);

// Links open in the default browser, not inside the panel.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[href]");
  if (a && /^https?:/i.test(a.getAttribute("href"))) { e.preventDefault(); post({ type: "openUrl", url: a.getAttribute("href") }); }
});

if (host) host.addEventListener("message", (e) => (handlers[e.data.type] || (() => {}))(e.data));
post({ type: "ready" });
input.focus();

})();
