import { expectedProjectPath, expectedHostTarget } from "./project-guard.js";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { assertInvocationNotCancelled, currentInvocation, markHostDispatch, measureStage, measureStageSync, type InvocationContext } from "../workflows/invocation-context.js";
import { getTempDir, withBridgeWorkflow, type BridgeOptions } from "./file-bridge.js";
import { inspectHostRecovery, markHostRecovery } from "./host-lease.js";
import { EventEmitter } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { assertNoSymlinkedPaths, SymlinkPathError } from "../security/path-guard.js";

const LOOPBACK_HOST = "127.0.0.1";
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
  | { status: "stopped" | "listening"; connected: false }
  | {
      status: "connected";
      connected: true;
      protocolVersion: number;
      capabilities: UxpHello;
      connectedAt: string;
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
      if (this.isAuthorizedHandoff(req)) {
        if (this.pending.size > 0 || this.handoffInProgress) {
          res.writeHead(409, { Connection: "close" });
          res.end("busy");
          return;
        }
        this.handoffInProgress = true;
        // Another server process for the same user needs the panel. Release the
        // port; the panel reconnects on its own retry and lands on the claimant.
        res.writeHead(200, { "Content-Type": "text/plain", Connection: "close" });
        res.end("released", () => {
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
      httpServer.once("error", reject);
      httpServer.listen(this.options.port, LOOPBACK_HOST, () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    this.httpServer = httpServer;
    this.wsServer = wsServer;
    this.handoffInProgress = false;
    this.emit("listening", this.address());
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
    if (req.method !== "POST") return false;
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
    } catch {
      return false;
    }
    if (url.pathname !== this.handoffPath()) return false;
    // A DNS-rebinding page cannot present a loopback Host header, and a browser
    // cannot attach the custom token header without a preflight we never answer.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (host !== LOOPBACK_HOST && host !== "localhost") return false;
    const header = req.headers[HANDOFF_TOKEN_HEADER];
    return typeof header === "string" && secureTokenEqual(header, this.options.token);
  }

  /** Ask the server process that holds the loopback port to release it. */
  private requestHandoff(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = httpRequest({
        host: LOOPBACK_HOST,
        port: this.options.port,
        path: this.handoffPath(),
        method: "POST",
        headers: { [HANDOFF_TOKEN_HEADER]: this.options.token, "Content-Length": 0 },
        timeout: 2_000,
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode === 200));
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(false));
      req.end();
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
    if (this.getState().connected) return true;
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

  getState(): UxpConnectionState {
    if (this.socket?.readyState === WebSocket.OPEN && this.hello && this.connectedAt) {
      return {
        status: "connected",
        connected: true,
        protocolVersion: this.hello.protocolVersion,
        capabilities: this.hello,
        connectedAt: this.connectedAt,
      };
    }
    return {
      status: this.httpServer ? "listening" : "stopped",
      connected: false,
    };
  }

  /**
   * Replace the handshake capabilities with the panel's live report. Project, sequence and
   * workspace state change after the panel connects, and the handshake never updates.
   */
  async refreshCapabilities(): Promise<UxpHello | null> {
    const socket = this.socket;
    const live = await this.request("capabilities.get") as Partial<UxpHello> | null;
    const current = this.hello;
    if (
      !current || socket !== this.socket || !live || live.backend !== "uxp" || live.protocolVersion !== current.protocolVersion ||
      !live.commands || typeof live.commands !== "object" || Array.isArray(live.commands)
    ) {
      return null;
    }
    this.hello = live as UxpHello;
    return this.hello;
  }

  async request(
    command: string,
    args: Record<string, unknown> = {},
    requestOptions: UxpRequestOptions = {},
  ): Promise<unknown> {
    if (!this.getState().connected) await this.claim();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.hello) throw new UxpBridgeError("UXP_NOT_CONNECTED", "Premiere UXP bridge is not connected");
    return withBridgeWorkflow(this.hostBridgeOptions, () => measureStage("host_wait", () => this.requestOwned(command, args, requestOptions)));
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
        hello = (await this.refreshCapabilities()) ?? hello;
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
    if (!Number.isInteger(minimumTimeoutMs) || minimumTimeoutMs < 0) {
      throw new Error("UXP minimum request timeout must be a non-negative integer");
    }
    const requestTimeoutMs = Math.max(this.options.requestTimeoutMs, minimumTimeoutMs);
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
