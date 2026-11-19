import { expectedProjectPath, expectedHostTarget } from "./project-guard.js";
import { randomUUID, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { assertInvocationNotCancelled, currentInvocation, markHostDispatch, measureStage, measureStageSync, type InvocationContext } from "../workflows/invocation-context.js";
import { getTempDir, withBridgeWorkflow, type BridgeOptions } from "./file-bridge.js";
import { inspectHostRecovery, markHostRecovery } from "./host-lease.js";
import { EventEmitter } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { assertNoSymlinkedPaths, SymlinkPathError } from "../security/path-guard.js";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const SUPPORTED_PROTOCOLS = new Set([1, 2]);
/** Must match MAX_COMMAND_BYTES in uxp-plugin/protocol.cjs. */
export const MAX_UXP_COMMAND_BYTES = 64 * 1024;
export const UXP_COMMAND_SCHEMA_VERSION = 1;
export const UXP_RECEIPT_VERSION = 1;

export interface UxpBridgeOptions {
  token: string;
  port?: number;
  path?: string;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  /**
   * How long a server that needs UXP waits for the panel after taking the
   * loopback port over from another server process (default: 6000 ms; the
   * panel retries its connection every 2 s).
   */
  claimTimeoutMs?: number;
  tempDir?: string;
}

/** Header carrying the shared UXP token on a port handoff request. */
const HANDOFF_TOKEN_HEADER = "x-premiere-uxp-token";

export interface UxpCapability {
  supported: boolean;
  [key: string]: unknown;
}

export interface UxpRequestOptions {
  /** Do not let the bridge timeout before a bounded host-side wait can settle. */
  minimumTimeoutMs?: number;
}

export interface UxpHello {
  backend: "uxp";
  protocolVersion: number;
  commands: Record<string, UxpCapability>;
  [key: string]: unknown;
}

export type UxpConnectionState =
  | { status: "stopped" | "listening"; connected: false; route?: "local" | "relay" }
  | {
      status: "connected";
      connected: true;
      protocolVersion: number;
      capabilities: UxpHello;
      connectedAt: string;
      route?: "local" | "relay";
    };

interface PendingRequest {
  command: string;
  mutating?: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  context?: InvocationContext;
}

export class UxpBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UxpBridgeError";
  }
}

function secureTokenEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validPort(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error("UXP bridge port must be an integer between 0 and 65535");
  }
  return value;
}

/**
 * Authenticated loopback WebSocket server used only by the local Premiere UXP
 * panel. It never binds a LAN/WAN interface and does not silently fall back to
 * CEP after a UXP command has been sent.
 */
export class UxpWebSocketBridge extends EventEmitter {
  private readonly options: Required<Omit<UxpBridgeOptions, "tempDir">>;
  private readonly hostBridgeOptions: BridgeOptions;
  private httpServer: Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private hello: UxpHello | null = null;
  private connectedAt: string | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly uncertainOperations = new Map<string, { requestId: string; command: string }>();

  getOperationRecovery() {
    const operations = Array.from(this.uncertainOperations.values());
    return { recoveryRequired: operations.length > 0, operations, recoveryRevision: createHash("sha256").update(JSON.stringify(operations)).digest("hex"), boundary: "server_transport_receipt" };
  }

  private recordUncertain(requestId: string, command: string): void {
    this.uncertainOperations.set(requestId, { requestId, command });
    // The in-memory transport guard remains active if the disk is unavailable.
    // The lease implementation retains ownership when a recovery write fails.
    try { markHostRecovery(getTempDir(this.hostBridgeOptions), "unknown_command_outcome"); } catch { /* retained owner lease prevents another cooperating writer */ }
  }

  acknowledgeOperationRecovery(expectedRevision: string, reviewed: boolean): void {
    if (reviewed !== true || expectedRevision !== this.getOperationRecovery().recoveryRevision) throw new UxpBridgeError("UXP_STALE_RECOVERY", "Transport recovery revision changed; inspect current host state again");
    this.uncertainOperations.clear();
  }

  constructor(options: UxpBridgeOptions) {
    super();
    // A token pasted from a clipboard often carries a trailing newline.
    const token = options.token?.trim();
    if (!token || token.length < 16) {
      throw new Error("PREMIERE_UXP_TOKEN must contain at least 16 characters");
    }
    this.hostBridgeOptions = { tempDir: options.tempDir ?? getTempDir() };
    this.options = {
      token,
      port: validPort(options.port ?? 7777),
      path: options.path ?? "/uxp",
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 5_000,
      claimTimeoutMs: options.claimTimeoutMs ?? 6_000,
    };
    if (!this.options.path.startsWith("/")) {
      throw new Error("UXP bridge path must begin with '/'");
    }
  }

  async start(): Promise<void> {
    if (this.httpServer) return;
    const httpServer = createServer((req, res) => {
      if (this.isAuthorizedLoopback(req, this.statusPath()) && (req.method === "GET" || req.method === "POST")) {
        this.endPeerResponse(req, res, 200, JSON.stringify(this.localPeerState()));
        return;
      }
      if (this.isAuthorizedLoopback(req, this.relayPath()) && req.method === "POST") {
        void this.handleRelayRequest(req, res);
        return;
      }
      if (this.isAuthorizedHandoff(req)) {
        if (this.pending.size > 0 || this.handoffInProgress) {
          res.writeHead(409, { Connection: "close" });
          res.end("busy");
          return;
        }
        this.handoffInProgress = true;
        // Another server process for the same user needs the panel. Release the
        // port; the panel reconnects on its own retry and lands on the claimant.
        this.endPeerResponse(req, res, 200, "released", () => {
          void this.stop().then(() => this.emit("handedOff"));
        });
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });
    const wsServer = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });

    httpServer.on("upgrade", (request, socket, head) => {
      let url: URL;
      try {
        url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
      } catch {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        return;
      }
      const authorized =
        url.pathname === this.options.path &&
        secureTokenEqual(url.searchParams.get("token") ?? "", this.options.token);
      if (!authorized) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wsServer.handleUpgrade(request, socket, head, (client) => {
        wsServer.emit("connection", client, request);
      });
    });
    wsServer.on("connection", (client) => this.acceptConnection(client));

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.close();
        reject(error);
      };
      httpServer.once("error", onError);
      httpServer.listen(this.options.port, LOOPBACK_HOST, () => {
        httpServer.off("error", onError);
        resolve();
      });
    });
    this.httpServer = httpServer;
    this.wsServer = wsServer;
    this.handoffInProgress = false;
    this.relayMode = false;
    this.relayState = null;
    this.emit("listening", this.address());
  }

  /**
   * Bind the loopback port, or join the process that already holds it as a
   * relay client. Two long-lived Claude Desktop instances (Chat and
   * Code/Cowork) otherwise fight over port 7777: the loser retried listen()
   * every 3 s and never reached the panel (issue #992 / KAV-388).
   */
  async startOrJoin(): Promise<void> {
    try {
      await this.start();
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EADDRINUSE") throw error;
      if (await this.attachRelay()) return;
      throw error;
    }
  }

  address(): { host: string; port: number; path: string } {
    const address = this.httpServer?.address();
    return {
      host: LOOPBACK_HOST,
      port: typeof address === "object" && address ? address.port : this.options.port,
      path: this.options.path,
    };
  }

  private handoffPath(): string {
    return `${this.options.path.replace(/\/$/, "")}/handoff`;
  }

  private isAuthorizedHandoff(req: import("node:http").IncomingMessage): boolean {
    return req.method === "POST" && this.isAuthorizedLoopback(req, this.handoffPath());
  }

  private isAuthorizedLoopback(req: import("node:http").IncomingMessage, pathname: string): boolean {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
    } catch {
      return false;
    }
    if (url.pathname !== pathname) return false;
    // A DNS-rebinding page cannot present a loopback Host header, and a browser
    // cannot attach the custom token header without a preflight we never answer.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (host !== LOOPBACK_HOST && host !== "localhost") return false;
    const nonce = req.headers["x-uxp-nonce"];
    const timestamp = req.headers["x-uxp-time"];
    const digest = req.headers["x-uxp-body"];
    const proof = req.headers["x-uxp-proof"];
    if (typeof nonce === "string" && /^[a-f0-9-]{36}$/.test(nonce) && typeof timestamp === "string" &&
        /^\d{13}$/.test(timestamp) && Math.abs(Date.now() - Number(timestamp)) <= 30_000 &&
        typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest) && typeof proof === "string") {
      const expected = this.peerProof(["request", req.method ?? "", pathname, nonce, timestamp, digest]);
      if (!secureTokenEqual(proof, expected)) return false;
      // A request is authenticated once; routing may ask about several paths.
      for (const [key, expiry] of this.peerNonces) if (expiry < Date.now()) this.peerNonces.delete(key);
      if (this.peerNonces.has(nonce) || this.peerNonces.size >= 512) return false;
      this.peerNonces.set(nonce, Date.now() + 60_000);
      return true;
    }
    const header = req.headers[HANDOFF_TOKEN_HEADER];
    return typeof header === "string" && secureTokenEqual(header, this.options.token);
  }

  private readonly peerNonces = new Map<string, number>();

  private peerProof(parts: string[]): string {
    return createHmac("sha256", this.options.token).update(JSON.stringify(parts)).digest("hex");
  }

  private endPeerResponse(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse,
    status: number, body: string, done?: () => void): void {
    const nonce = req.headers["x-uxp-nonce"];
    res.writeHead(status, {
      "Content-Type": "application/json", Connection: "close",
      ...(typeof nonce === "string" ? { "x-uxp-proof": this.peerProof(["response", nonce, String(status), body]) } : {}),
    });
    res.end(body, done);
  }

  private statusPath(): string {
    return `${this.options.path.replace(/\/$/, "")}/status`;
  }

  private relayPath(): string {
    return `${this.options.path.replace(/\/$/, "")}/relay`;
  }

  private localPeerState(): UxpConnectionState {
    const state = this.getState();
    if (state.route === "relay") {
      return { status: this.httpServer ? "listening" : "stopped", connected: false, route: "local" };
    }
    return { ...state, route: state.route ?? "local" };
  }

  /** Ask only an authenticated peer to release the panel. */
  private async requestHandoff(): Promise<boolean> {
    return (await this.peerRequest({ method: "POST", path: this.handoffPath() }))?.statusCode === 200;
  }

  /**
   * Become a client of the process that already bound the loopback port.
   * UXP commands are forwarded over an authenticated loopback HTTP relay
   * so this process does not steal the panel or retry listen().
   */
  async attachRelay(): Promise<boolean> {
    if (this.httpServer) return false;
    const state = await this.fetchPeerState();
    if (!state) return false;
    this.relayMode = true;
    this.relayState = state;
    return true;
  }

  private fetchPeerState(): Promise<UxpConnectionState | null> {
    return this.peerRequest({ method: "GET", path: this.statusPath() }).then((res) => {
      if (!res || res.statusCode !== 200 || !res.body) return null;
      try {
        const parsed = JSON.parse(res.body) as UxpConnectionState;
        if (parsed && (parsed.connected === true || parsed.connected === false)) return parsed;
      } catch { /* not a cooperating peer */ }
      return null;
    });
  }

  private peerRequest(options: {
    method: string;
    path: string;
    body?: string;
    timeoutMs?: number;
  }): Promise<{ statusCode: number; body: string } | null> {
    return new Promise((resolve) => {
      const nonce = randomUUID(), timestamp = String(Date.now());
      const body = options.body ?? "";
      const digest = createHash("sha256").update(body).digest("hex");
      let settled = false;
      const finish = (result: { statusCode: number; body: string } | null) => {
        if (settled) return;
        settled = true; clearTimeout(deadline); resolve(result);
      };
      const req = httpRequest({
        host: LOOPBACK_HOST, port: this.options.port, path: options.path, method: options.method,
        headers: {
          "x-uxp-nonce": nonce, "x-uxp-time": timestamp, "x-uxp-body": digest,
          "x-uxp-proof": this.peerProof(["request", options.method, options.path, nonce, timestamp, digest]),
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_UXP_COMMAND_BYTES * 4) { finish(null); res.destroy(); return; }
          chunks.push(chunk);
        });
        res.on("error", () => finish(null));
        res.on("aborted", () => finish(null));
        res.on("end", () => {
          const resultBody = Buffer.concat(chunks).toString("utf8"), statusCode = res.statusCode ?? 0;
          const proof = res.headers["x-uxp-proof"];
          finish(typeof proof === "string" && secureTokenEqual(proof, this.peerProof(["response", nonce, String(statusCode), resultBody]))
            ? { statusCode, body: resultBody } : null);
        });
      });
      const deadline = setTimeout(() => { finish(null); req.destroy(); }, Math.min(MAX_REQUEST_TIMEOUT_MS + 2_000, options.timeoutMs ?? 2_000));
      req.on("error", () => finish(null));
      req.end(body);
    });
  }

  private async handleRelayRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    const fail = (status: number, code: string, message: string) => {
      this.endPeerResponse(req, res, status, JSON.stringify({ ok: false, code, message }));
    };
    if (this.relayMode) {
      fail(503, "UXP_NOT_CONNECTED", "This process is itself a UXP relay client");
      return;
    }
    let raw: string;
    try {
      raw = await this.readRequestBody(req);
      const digest = req.headers["x-uxp-body"];
      if (typeof digest === "string" && digest !== createHash("sha256").update(raw).digest("hex")) {
        fail(400, "UXP_RELAY_INVALID", "Relay body authentication failed"); return;
      }
    } catch {
      fail(413, "UXP_COMMAND_TOO_LARGE", "Relay payload was too large");
      return;
    }
    let command: string;
    let args: Record<string, unknown> = {};
    let minimumTimeoutMs: number | undefined;
    try {
      const body = JSON.parse(raw) as { command?: unknown; args?: unknown; minimumTimeoutMs?: unknown };
      if (typeof body.command !== "string" || !body.command) throw new Error("missing command");
      command = body.command;
      if (body.args !== undefined) {
        if (!body.args || typeof body.args !== "object" || Array.isArray(body.args)) throw new Error("invalid args");
        args = body.args as Record<string, unknown>;
      }
      if (body.minimumTimeoutMs !== undefined) {
        if (!Number.isInteger(body.minimumTimeoutMs) || (body.minimumTimeoutMs as number) < 0 || (body.minimumTimeoutMs as number) > MAX_REQUEST_TIMEOUT_MS) {
          throw new Error("invalid timeout");
        }
        minimumTimeoutMs = body.minimumTimeoutMs as number;
      }
    } catch {
      fail(400, "UXP_RELAY_INVALID", "Relay body must be a JSON command");
      return;
    }
    try {
      const result = await this.requestOwned(command, args, minimumTimeoutMs === undefined ? {} : { minimumTimeoutMs });
      this.endPeerResponse(req, res, 200, JSON.stringify({ ok: true, result }));
    } catch (error) {
      const code = error instanceof UxpBridgeError ? error.code : "UXP_COMMAND_FAILED";
      const message = "UXP relay command failed; inspect local operation recovery before retrying a mutation";
      const status = code === "UXP_NOT_CONNECTED" || code === "UXP_HANDOFF_IN_PROGRESS" ? 503 : 400;
      fail(status, code, message);
    }
  }

  private readRequestBody(req: import("node:http").IncomingMessage, limit = MAX_UXP_COMMAND_BYTES + 4_096): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          req.destroy();
          reject(new Error("payload too large"));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  private waitForConnection(timeoutMs: number): Promise<boolean> {
    if (this.getState().connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onConnected = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { this.off("connected", onConnected); resolve(false); }, timeoutMs);
      timer.unref?.();
      this.once("connected", onConnected);
    });
  }

  /**
   * Make this process the one the panel talks to. Claude Desktop can run more
   * than one copy of this server; only one can bind the loopback port, and the
   * panel connects to whichever does. A copy that receives UXP work while
   * another copy holds the port asks it (with the shared token) to hand the
   * port over, binds it, and waits for the panel's automatic reconnect.
   * Returns true when the panel is connected to this process.
   */
  async claim(timeoutMs = this.options.claimTimeoutMs): Promise<boolean> {
    if (this.httpServer && this.socket?.readyState === WebSocket.OPEN && this.hello) return true;
    // A cached relay connection is not ownership of the local panel socket.
    this.relayMode = false;
    this.relayState = null;
    if (!this.claimInFlight) {
      this.claimInFlight = (async () => {
        if (!this.httpServer) {
          try {
            await this.start();
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== "EADDRINUSE") return;
            if (!(await this.requestHandoff())) return;
            // The owner releases the port right after answering; retry the bind briefly.
            for (let attempt = 0; attempt < 20 && !this.httpServer; attempt++) {
              await new Promise((r) => setTimeout(r, 100));
              try {
                await this.start();
              } catch (retryError) {
                if ((retryError as NodeJS.ErrnoException)?.code !== "EADDRINUSE") return;
              }
            }
            if (!this.httpServer) return;
          }
        }
      })().finally(() => { this.claimInFlight = null; });
    }
    await this.claimInFlight;
    if (!this.httpServer) return false;
    return this.waitForConnection(timeoutMs);
  }

  private claimInFlight: Promise<void> | null = null;
  private handoffInProgress = false;
  private relayMode = false;
  private relayState: UxpConnectionState | null = null;

  getState(): UxpConnectionState {
    if (this.relayMode && !this.httpServer) {
      const cached = this.relayState;
      if (cached?.connected) return { ...cached, route: "relay" };
      return { status: "stopped", connected: false, route: "relay" };
    }
    if (this.socket?.readyState === WebSocket.OPEN && this.hello && this.connectedAt) {
      return {
        status: "connected",
        connected: true,
        protocolVersion: this.hello.protocolVersion,
        capabilities: this.hello,
        connectedAt: this.connectedAt,
        route: "local",
      };
    }
    return {
      status: this.httpServer ? "listening" : "stopped",
      connected: false,
      route: "local",
    };
  }

  /**
   * Replace the handshake capabilities with the panel's live report. Project, sequence and
   * workspace state change after the panel connects, and the handshake never updates.
   */
  async refreshCapabilities(): Promise<UxpHello | null> {
    return this.readCapabilities(() => this.request("capabilities.get"));
  }

  private async readCapabilities(read: () => Promise<unknown>): Promise<UxpHello | null> {
    const socket = this.socket;
    const relaying = this.relayMode && !this.httpServer;
    const live = await read() as Partial<UxpHello> | null;
    const current = relaying
      ? (this.relayState && this.relayState.connected ? this.relayState.capabilities : this.hello)
      : this.hello;
    if (
      !current || (!relaying && socket !== this.socket) || !live || live.backend !== "uxp" || live.protocolVersion !== current.protocolVersion ||
      !live.commands || typeof live.commands !== "object" || Array.isArray(live.commands)
    ) {
      return null;
    }
    this.hello = live as UxpHello;
    if (relaying && this.relayState?.connected) {
      this.relayState = { ...this.relayState, capabilities: this.hello };
    }
    return this.hello;
  }

  async request(
    command: string,
    args: Record<string, unknown> = {},
    requestOptions: UxpRequestOptions = {},
  ): Promise<unknown> {
    assertInvocationNotCancelled();
    if (expectedProjectPath() !== undefined || expectedHostTarget() !== undefined) {
      throw new UxpBridgeError("UXP_PROJECT_GUARD_UNSUPPORTED", "expected_project_path is a CEP-only guard; use the UXP workflow expected_snapshot identity guard instead");
    }
    const minimumTimeoutMs = requestOptions.minimumTimeoutMs ?? 0;
    if (!Number.isInteger(minimumTimeoutMs) || minimumTimeoutMs < 0 || minimumTimeoutMs > MAX_REQUEST_TIMEOUT_MS) {
      throw new Error("UXP minimum request timeout must be a non-negative integer no greater than 600000");
    }
    assertNoSymlinkedPaths(args);
    if (this.relayMode && !this.httpServer) {
      return withBridgeWorkflow(this.hostBridgeOptions, () => measureStage("host_wait", () => this.requestViaRelay(command, args, requestOptions)));
    }
    if (!this.getState().connected) {
      if (!this.httpServer && await this.attachRelay()) {
        return withBridgeWorkflow(this.hostBridgeOptions, () => measureStage("host_wait", () => this.requestViaRelay(command, args, requestOptions)));
      }
      await this.claim();
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.hello) throw new UxpBridgeError("UXP_NOT_CONNECTED", "Premiere UXP bridge is not connected");
    return withBridgeWorkflow(this.hostBridgeOptions, () => measureStage("host_wait", () => this.requestOwned(command, args, requestOptions)));
  }

  private async requestViaRelay(
    command: string,
    args: Record<string, unknown>,
    requestOptions: UxpRequestOptions,
  ): Promise<unknown> {
    const minimumTimeoutMs = requestOptions.minimumTimeoutMs ?? 0;
    const requestTimeoutMs = Math.min(MAX_REQUEST_TIMEOUT_MS, Math.max(this.options.requestTimeoutMs, minimumTimeoutMs));
    const res = await this.peerRequest({
      method: "POST",
      path: this.relayPath(),
      body: JSON.stringify({ command, args, minimumTimeoutMs }),
      timeoutMs: requestTimeoutMs + 2_000,
    });
    if (!res) {
      this.relayMode = false;
      this.relayState = null;
      throw new UxpBridgeError("UXP_NOT_CONNECTED", "The UXP process that holds the loopback port did not answer the relay");
    }
    let parsed: { ok?: boolean; result?: unknown; code?: string; message?: string };
    try {
      parsed = JSON.parse(res.body) as { ok?: boolean; result?: unknown; code?: string; message?: string };
    } catch {
      throw new UxpBridgeError("UXP_NOT_CONNECTED", "The UXP relay returned an invalid response");
    }
    if (res.statusCode === 200 && parsed.ok === true) {
      const state = await this.fetchPeerState();
      if (state) this.relayState = state;
      return parsed.result;
    }
    throw new UxpBridgeError(parsed.code ?? "UXP_COMMAND_FAILED", parsed.message ?? `UXP command '${command}' failed`);
  }

  private async requestOwned(command: string, args: Record<string, unknown>, requestOptions: UxpRequestOptions): Promise<unknown> {
    if (this.handoffInProgress) throw new UxpBridgeError("UXP_HANDOFF_IN_PROGRESS", "UXP bridge is handing the panel to another process; no command was sent");
    if (expectedProjectPath() !== undefined || expectedHostTarget() !== undefined) {
      throw new UxpBridgeError("UXP_PROJECT_GUARD_UNSUPPORTED", "expected_project_path is a CEP-only guard; use the UXP workflow expected_snapshot identity guard instead");
    }
    const socket = this.socket;
    let hello = this.hello;
    if (!socket || socket.readyState !== WebSocket.OPEN || !hello) {
      throw new UxpBridgeError("UXP_NOT_CONNECTED", "Premiere UXP bridge is not connected");
    }
    if (hello.commands[command]?.supported !== true && command !== "capabilities.get") {
      // The handshake is taken when the panel connects, often before a project is open or a
      // workspace folder is approved (on 26.5.2 that hid 25 of 192 commands for the whole
      // session). Re-read the live capabilities once before refusing.
      try {
        // The relay caller already holds the cross-process workflow lease.
        // Refresh on the existing socket; re-entering request() would wait for
        // that same lease in this process and deadlock until the caller times out.
        hello = (await this.readCapabilities(() => this.requestOwned("capabilities.get", {}, {}))) ?? hello;
      } catch {
        // Keep the handshake capabilities; the refusal below still applies.
      }
    }
    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) {
      throw new UxpBridgeError("UXP_NOT_CONNECTED", "Premiere UXP connection changed during capability refresh");
    }
    if (hello.commands[command]?.supported !== true) {
      throw new UxpBridgeError(
        "UXP_COMMAND_UNSUPPORTED",
        `Connected Premiere host does not support UXP command '${command}'`,
      );
    }

    const mutating = hello.commands[command]?.readOnly !== true && !/^(?:capabilities\.get|state\.get|operations\.recovery\.|operation\.cancel)/.test(command);
    if (mutating && inspectHostRecovery(getTempDir(this.hostBridgeOptions)).recoveryRequired) throw new UxpBridgeError("UXP_RECOVERY_REQUIRED", "Shared Premiere execution state is uncertain; inspect operation recovery before another backend writes");
    if (mutating && this.uncertainOperations.size > 0) throw new UxpBridgeError("UXP_RECOVERY_REQUIRED", "An earlier UXP reply was lost; inspect operation recovery and current host state before another mutation");
    if (mutating && (hello.commandSchemaVersion !== UXP_COMMAND_SCHEMA_VERSION || hello.receiptVersion !== UXP_RECEIPT_VERSION)) throw new UxpBridgeError("UXP_SCHEMA_INCOMPATIBLE", "Panel command/receipt schema is absent or incompatible; install the matching panel before editing");
    if (mutating && hello.replayPersistence !== "durable_hashed_tombstones") throw new UxpBridgeError("UXP_REPLAY_UNAVAILABLE", "Panel cannot preserve consumed operation IDs; install the matching panel and restore its persistent storage before editing");

    // The panel cannot see through links on Premiere 26.5 UXP (#640), so refuse
    // symlinked path segments here, before anything reaches the host.
    try {
      assertNoSymlinkedPaths(args);
    } catch (error) {
      if (error instanceof SymlinkPathError) throw new UxpBridgeError(error.code, error.message);
      throw error;
    }

    const minimumTimeoutMs = requestOptions.minimumTimeoutMs ?? 0;
    if (!Number.isInteger(minimumTimeoutMs) || minimumTimeoutMs < 0 || minimumTimeoutMs > MAX_REQUEST_TIMEOUT_MS) {
      throw new Error("UXP minimum request timeout must be a non-negative integer");
    }
    const requestTimeoutMs = Math.min(MAX_REQUEST_TIMEOUT_MS, Math.max(this.options.requestTimeoutMs, minimumTimeoutMs));
    const requestId = randomUUID();
    const frame = JSON.stringify({
      protocolVersion: hello.protocolVersion,
      type: "command",
      ...(hello.commandSchemaVersion === undefined ? {} : { commandSchemaVersion: UXP_COMMAND_SCHEMA_VERSION, receiptVersion: UXP_RECEIPT_VERSION }),
      requestId,
      command,
      args,
    });
    // The panel drops frames over 64 KiB before it can read the requestId, so an
    // oversized command would only surface as a timeout. Refuse it here instead.
    if (Buffer.byteLength(frame, "utf8") > MAX_UXP_COMMAND_BYTES) {
      throw new UxpBridgeError(
        "UXP_COMMAND_TOO_LARGE",
        `UXP command '${command}' is larger than the panel's 64 KiB limit. Send less data (for example a narrower metadata update). No command was sent to Premiere.`,
      );
    }
    assertInvocationNotCancelled();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        if (mutating) this.recordUncertain(requestId, command);
        reject(new UxpBridgeError("UXP_TIMEOUT", `UXP command '${command}' timed out`));
      }, requestTimeoutMs);
      this.pending.set(requestId, { command, mutating, resolve, reject, timer, context: currentInvocation() });
      const sendFailed = (error?: Error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        if (pending.mutating) this.recordUncertain(requestId, command);
        pending.reject(new UxpBridgeError("UXP_SEND_FAILED", error.message));
      };
      try {
        measureStageSync("dispatch", () => {
          if (mutating) markHostDispatch();
          socket.send(frame, sendFailed);
        });
      } catch (error) { sendFailed(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  async stop(): Promise<void> {
    this.clearConnection(new UxpBridgeError("UXP_STOPPED", "UXP bridge stopped"));
    this.relayMode = false;
    this.relayState = null;
    const wsServer = this.wsServer;
    const httpServer = this.httpServer;
    this.wsServer = null;
    this.httpServer = null;
    if (wsServer) {
      for (const client of wsServer.clients) client.terminate();
      wsServer.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  private acceptConnection(client: WebSocket): void {
    if (this.socket) {
      this.clearConnection(
        new UxpBridgeError("UXP_RECONNECTED", "Premiere UXP bridge reconnected"),
      );
    }
    this.socket = client;
    this.hello = null;
    this.connectedAt = null;
    this.handshakeTimer = setTimeout(() => {
      client.close(1008, "Versioned hello required");
    }, this.options.handshakeTimeoutMs);
    client.on("message", (data) => this.handleMessage(client, data.toString()));
    client.on("close", () => {
      if (client !== this.socket) return;
      this.clearConnection(
        new UxpBridgeError("UXP_DISCONNECTED", "Premiere UXP bridge disconnected"),
      );
      this.emit("disconnected");
    });
    client.on("error", (error) => this.emit("clientError", error));
  }

  private handleMessage(client: WebSocket, raw: string): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      client.close(1007, "Invalid JSON");
      return;
    }

    if (!this.hello) {
      const hello = message?.type === "hello" ? message.payload : null;
      if (
        !hello ||
        hello.backend !== "uxp" ||
        !SUPPORTED_PROTOCOLS.has(message.protocolVersion) ||
        hello.protocolVersion !== message.protocolVersion ||
        !hello.commands ||
        typeof hello.commands !== "object" ||
        Array.isArray(hello.commands)
      ) {
        client.close(1008, "Unsupported UXP handshake");
        return;
      }
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.hello = hello as UxpHello;
      this.connectedAt = new Date().toISOString();
      this.emit("connected", this.getState());
      return;
    }

    if (message?.protocolVersion !== this.hello.protocolVersion) {
      client.close(1008, "Protocol version changed");
      return;
    }
    if (message?.type === "event") {
      this.emit("event", message.payload);
      return;
    }
    if (message?.type !== "result" || typeof message.requestId !== "string") return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    measureStageSync("readback", () => {
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.payload?.ok === true) {
      const result = message.payload.result;
      if (pending.mutating && (result?.recoveryRequired === true || result?.outcome === "unknown" || result?.mutationOutcome === "unknown")) this.recordUncertain(message.requestId, pending.command);
      pending.resolve(message.payload.result);
    } else {
      const error = message.payload?.error;
      if (pending.mutating && !(error?.noHostDispatch === true && error?.dispatchEvidence === "panel_pre_dispatch")) this.recordUncertain(message.requestId, pending.command);
      pending.reject(new UxpBridgeError(
        error?.code ?? "UXP_COMMAND_FAILED",
        error?.message ?? `UXP command '${pending.command}' failed`,
      ));
    }
    }, pending.context);
  }

  private clearConnection(error: Error): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.hello = null;
    this.connectedAt = null;
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    for (const [requestId, pending] of this.pending) {
      if (pending.mutating) this.recordUncertain(requestId, pending.command);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
