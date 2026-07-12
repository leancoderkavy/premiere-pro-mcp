/*
 * Spike server for the UXP probes.
 *
 * Serves HTTP and WebSocket on the same port so the person testing runs one command.
 * Deliberately zero-dependency: a spike that needs `npm install` first is a spike people
 * don't run. The WebSocket bits are a minimal RFC 6455 text-frame implementation — enough
 * to prove a round-trip, and nothing more.
 *
 *   node uxp-spike/server.mjs [port]
 */

import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.argv[2]) || 7777;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"; // RFC 6455

const seen = { http: false, ws: false };

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/probe") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.http = true;
      console.log(`  [http] POST /probe  <- ${body}`);
      report("fetch() over http://127.0.0.1 reached the server");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, echo: safeParse(body) }));
    });
    return;
  }
  res.writeHead(404).end();
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();

  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  console.log(`  [ws]   client connected (Host: ${req.headers.host})`);

  socket.on("data", (buf) => {
    const msg = decodeTextFrame(buf);
    if (msg === null) return; // close/ping/binary — not worth handling in a spike

    seen.ws = true;
    console.log(`  [ws]   <- ${msg}`);
    report(`WebSocket round-trip works from the UXP panel (Host: ${req.headers.host})`);
    socket.write(encodeTextFrame(JSON.stringify({ ok: true, echo: safeParse(msg) })));
  });

  socket.on("error", () => socket.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nUXP spike server listening on 127.0.0.1:${PORT}`);
  console.log("  WebSocket : ws://localhost:%d  and  ws://127.0.0.1:%d", PORT, PORT);
  console.log("  HTTP      : POST http://127.0.0.1:%d/probe", PORT);
  console.log("\nNow hit 'Run all probes' in the MCP UXP Spike panel in Premiere.\n");
});

function report(what) {
  console.log(`\n  *** ${what} ***`);
  console.log(
    `  transports reached so far: ${[seen.ws && "websocket", seen.http && "http"].filter(Boolean).join(", ") || "none"}\n`
  );
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Decode a single masked client text frame. Returns null for anything else. */
function decodeTextFrame(buf) {
  if (buf.length < 2) return null;

  const opcode = buf[0] & 0x0f;
  if (opcode !== 0x1) return null; // text frames only

  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  if (!masked) return buf.subarray(offset, offset + len).toString("utf8");

  const mask = buf.subarray(offset, offset + 4);
  const payload = buf.subarray(offset + 4, offset + 4 + len);
  const out = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
  return out.toString("utf8");
}

/** Encode an unmasked server text frame. */
function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;

  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}
