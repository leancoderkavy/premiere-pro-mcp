/*
 * MCP UXP Spike
 *
 * Two questions, answered empirically against a running Premiere Pro:
 *
 *   1. Does UXP fix frame capture?
 *      Documented ExtendScript has NO frame-export method at all — Sequence only exposes
 *      exportAsMediaDirect / exportAsProject / exportAsFinalCutProXML. That is why our
 *      capture_frame reaches into the undocumented QE DOM, and why it returns false and
 *      writes nothing on both PPro 2025 and 2026 (issue #9). UXP has a supported
 *      Exporter.exportSequenceFrame(). Probe A finds out whether it actually works.
 *
 *   2. Can a UXP panel talk to a local MCP server directly?
 *      Today we shuttle commands through temp files and a 200ms poller. UXP has WebSocket
 *      and fetch, which would be a strict upgrade — but Adobe's docs never once mention
 *      localhost or 127.0.0.1 in network.domains, macOS is documented to restrict http://,
 *      and wss:// with a self-signed cert is explicitly broken on macOS. So loopback sits
 *      in undocumented-or-blocked territory. Probes B-E find out what actually connects.
 *
 * Every probe reports rather than throws. A failure is a result, not an error.
 */

const { entrypoints } = require("uxp");
const ppro = require("premierepro");

const PROBES = [
  { id: "frame-export", name: "A. Exporter.exportSequenceFrame()", run: probeFrameExport },
  { id: "ws-localhost", name: "B. WebSocket ws://localhost", run: (c) => probeWebSocket(c, "localhost") },
  { id: "ws-loopback-ip", name: "C. WebSocket ws://127.0.0.1", run: (c) => probeWebSocket(c, "127.0.0.1") },
  { id: "fetch-http", name: "D. fetch() http://127.0.0.1", run: probeFetch },
  { id: "fs-write", name: "E. Filesystem write (bridge fallback)", run: probeFileSystem },
];

const results = {};

entrypoints.setup({
  plugin: { create() {}, destroy() {} },
  panels: {
    spikePanel: {
      create() {},
      show() {},
      // Adobe's docs warn that hide()/destroy() "are not working as expected yet" in
      // Premiere, so nothing important is torn down here.
    },
  },
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("run").addEventListener("click", runAll);
});

async function runAll() {
  const ctx = {
    port: Number(document.getElementById("port").value) || 7777,
    outDir: document.getElementById("outdir").value || "/tmp/",
  };

  document.getElementById("results").innerHTML = "";
  document.getElementById("summary").textContent = "Running...";

  for (const probe of PROBES) {
    render(probe.id, probe.name, { state: "run", detail: "running..." });
    let outcome;
    try {
      outcome = await probe.run(ctx);
    } catch (e) {
      // A probe that throws is still a result — record it, don't abort the run.
      outcome = { ok: false, detail: "threw: " + errText(e) };
    }
    results[probe.id] = outcome;
    render(probe.id, probe.name, { state: outcome.ok ? "pass" : "fail", detail: outcome.detail });
  }

  summarize(ctx);
}

// --- Probe A: does UXP actually fix issue #9? ---------------------------------

async function probeFrameExport(ctx) {
  const project = await ppro.Project.getActiveProject();
  if (!project) return { ok: false, detail: "No active project — open one and re-run." };

  const sequence = await project.getActiveSequence();
  if (!sequence) return { ok: false, detail: "No active sequence — open one and re-run." };

  // getPlayerPosition() -> TickTime; getFrameSize() -> RectF, which despite the name has
  // only width/height (no x/y).
  const time = await sequence.getPlayerPosition();
  const rect = await sequence.getFrameSize();

  const filename = "mcp-uxp-spike-frame.png";
  const returned = await ppro.Exporter.exportSequenceFrame(
    sequence,
    time,
    filename,
    ctx.outDir,
    rect.width,
    rect.height
  );

  // The QE DOM lies about this — it returns false on builds where it works and true on
  // builds where it doesn't. So the return value is recorded but never trusted; the
  // filesystem is the only thing that decides.
  const fullPath = joinPath(ctx.outDir, filename);
  const onDisk = await fileExists(fullPath);

  return {
    ok: onDisk,
    detail:
      "returned " + JSON.stringify(returned) +
      "\nfile on disk: " + (onDisk ? "YES — " + fullPath : "NO (" + fullPath + ")") +
      "\nsequence: " + rect.width + "x" + rect.height +
      " @ " + time.seconds + "s" +
      (onDisk
        ? "\n=> UXP fixes issue #9. This is the supported frame-capture path."
        : "\n=> No file written. Check the out dir exists and is writable."),
  };
}

// --- Probes B/C: can the panel open a socket to a local MCP server? -----------

function probeWebSocket(ctx, host) {
  const url = "ws://" + host + ":" + ctx.port;

  return new Promise((resolve) => {
    let socket;
    let settled = false;

    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      try { if (socket) socket.close(); } catch (e) { /* already gone */ }
      resolve({ ok, detail });
    };

    // No connection attempt should hang the panel.
    const timer = setTimeout(
      () => finish(false, url + "\ntimed out after 5s — no open, no error. Treat as blocked."),
      5000
    );

    try {
      socket = new WebSocket(url);
    } catch (e) {
      clearTimeout(timer);
      return finish(false, url + "\nconstructor threw: " + errText(e));
    }

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ probe: "hello", host: host }));
      } catch (e) {
        clearTimeout(timer);
        finish(false, url + "\nopened but send() threw: " + errText(e));
      }
    };

    // Only a round-trip proves the transport. An open event alone doesn't.
    socket.onmessage = (event) => {
      clearTimeout(timer);
      finish(
        true,
        url + "\nround-trip OK. Server echoed: " + String(event.data) +
        "\n=> Loopback WebSocket works. The temp-file bridge can go."
      );
    };

    socket.onerror = (err) => {
      clearTimeout(timer);
      finish(
        false,
        url + "\nerror: " + (errText(err) || "(no detail — UXP often gives none)") +
        "\nIs the spike server running? node uxp-spike/server.mjs"
      );
    };

    socket.onclose = (ev) => {
      if (settled) return;
      clearTimeout(timer);
      finish(false, url + "\nclosed before any message (code " + (ev && ev.code) + ")");
    };
  });
}

// --- Probe D: fetch() as a fallback transport ---------------------------------

async function probeFetch(ctx) {
  // macOS is documented to restrict http://. If that restriction extends to loopback,
  // this fails and the answer matters as much as a pass.
  const url = "http://127.0.0.1:" + ctx.port + "/probe";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ probe: "fetch" }),
  });
  const body = await res.text();

  return {
    ok: res.ok,
    detail: url + "\nHTTP " + res.status + "\nbody: " + body,
  };
}

// --- Probe E: the fallback we already know works ------------------------------

async function probeFileSystem(ctx) {
  const fs = require("fs");
  const probePath = joinPath(ctx.outDir, "mcp-uxp-spike-fs.json");
  const payload = JSON.stringify({ probe: "fs", at: new Date().toISOString() });

  await fs.writeFile(probePath, payload, { encoding: "utf-8" });
  const readBack = await fs.readFile(probePath, { encoding: "utf-8" });

  return {
    ok: readBack === payload,
    detail:
      probePath +
      "\nwrite+read round-trip: " + (readBack === payload ? "OK" : "MISMATCH") +
      "\n=> If B/C/D all fail, this is the transport we keep.",
  };
}

// --- helpers ------------------------------------------------------------------

async function fileExists(path) {
  try {
    const fs = require("fs");
    await fs.lstat(path);
    return true;
  } catch (e) {
    return false;
  }
}

function joinPath(dir, name) {
  return dir.charAt(dir.length - 1) === "/" ? dir + name : dir + "/" + name;
}

function errText(e) {
  if (!e) return "";
  return e.message || e.type || String(e);
}

function render(id, name, { state, detail }) {
  let el = document.getElementById("probe-" + id);
  if (!el) {
    el = document.createElement("div");
    el.id = "probe-" + id;
    document.getElementById("results").appendChild(el);
  }
  el.className = "probe " + state;
  el.innerHTML = "";

  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = (state === "pass" ? "PASS  " : state === "fail" ? "FAIL  " : "...   ") + name;

  const detailEl = document.createElement("div");
  detailEl.className = "detail";
  detailEl.textContent = detail;

  el.appendChild(nameEl);
  el.appendChild(detailEl);
}

async function summarize(ctx) {
  const verdict = {
    ranAt: new Date().toISOString(),
    host: "premierepro",
    probes: {},
  };
  for (const p of PROBES) {
    verdict.probes[p.id] = { ok: !!(results[p.id] && results[p.id].ok), detail: results[p.id].detail };
  }

  const frameOk = verdict.probes["frame-export"].ok;
  const socketOk = verdict.probes["ws-localhost"].ok || verdict.probes["ws-loopback-ip"].ok;
  const fetchOk = verdict.probes["fetch-http"].ok;

  verdict.conclusions = {
    fixesIssue9: frameOk,
    canDropFileBridge: socketOk || fetchOk,
    recommendedTransport: socketOk ? "websocket" : fetchOk ? "http-fetch" : "file-bridge",
  };

  const lines = [
    "Issue #9 (frame capture): " + (frameOk ? "FIXED by UXP" : "still broken — see probe A"),
    "Transport: " + verdict.conclusions.recommendedTransport,
    "",
    "Paste this into the spike issue:",
    JSON.stringify(verdict, null, 2),
  ];
  document.getElementById("summary").textContent = lines.join("\n");

  // Best effort — the whole point of probe E is that this still works when nothing else does.
  try {
    const fs = require("fs");
    await fs.writeFile(joinPath(ctx.outDir, "mcp-uxp-spike-report.json"), JSON.stringify(verdict, null, 2), {
      encoding: "utf-8",
    });
  } catch (e) {
    /* the panel already shows it */
  }
}
