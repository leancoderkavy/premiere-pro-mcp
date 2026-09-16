import { gzip } from "node:zlib";
import { open } from "node:fs/promises";

export interface LandingDocumentSettings {
  maxConcurrentDocuments: number;
  maxDocumentBytes: number;
  maxCacheBytes: number;
}

export type LandingDocumentResult =
  | { accepted: false }
  | { accepted: true; body: string | Buffer };

type SourceLoader = (filePath: string, maxBytes: number) => Promise<string>;

interface CacheEntry {
  document: string;
  memoryBytes: number;
}

function readBoundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function readLandingDocumentSettings(env: NodeJS.ProcessEnv): LandingDocumentSettings {
  const maxDocumentBytes = readBoundedInteger(env, "MCP_LANDING_MAX_HTML_BYTES", 4 * 1024 * 1024, 1_024, 16 * 1024 * 1024);
  const maxCacheBytes = readBoundedInteger(env, "MCP_LANDING_HTML_CACHE_BYTES", 16 * 1024 * 1024, 1_024, 128 * 1024 * 1024);
  if (maxCacheBytes < maxDocumentBytes) {
    throw new Error("MCP_LANDING_HTML_CACHE_BYTES must be greater than or equal to MCP_LANDING_MAX_HTML_BYTES");
  }
  return {
    maxConcurrentDocuments: readBoundedInteger(env, "MCP_MAX_CONCURRENT_LANDING_DOCUMENTS", 4, 1, 64),
    maxDocumentBytes,
    maxCacheBytes,
  };
}

export class LandingDocumentTooLargeError extends Error {
  constructor() {
    super("Landing document exceeds the configured byte limit");
    this.name = "LandingDocumentTooLargeError";
  }
}

export function assertLandingDocumentSize(fileSize: number | undefined, maxBytes: number): void {
  if (fileSize !== undefined && fileSize > maxBytes) throw new LandingDocumentTooLargeError();
}

function gzipAsync(document: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gzip(document, { level: 6 }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

export async function readBoundedUtf8(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    // Read at most one byte past the limit. This remains bounded even if a
    // trusted deployment artifact changes between its stat and its read.
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new LandingDocumentTooLargeError();
    return buffer.toString("utf8", 0, offset);
  } finally {
    await handle.close();
  }
}

/**
 * Loads immutable build output once, while keeping both cached source and
 * concurrent per-request nonce/compression work within fixed process budgets.
 * The source cache intentionally lives for the process lifetime: static export
 * changes take effect with the deployment restart that installs those files.
 */
export class LandingDocumentRenderer {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pendingLoads = new Map<string, Promise<string>>();
  private cacheBytes = 0;
  private activeDocuments = 0;

  constructor(
    private readonly settings: LandingDocumentSettings,
    private readonly loadSource: SourceLoader,
  ) {}

  async render(
    filePath: string,
    fileSize: number | undefined,
    transform: (source: string) => string,
    compress: boolean,
  ): Promise<LandingDocumentResult> {
    if (this.activeDocuments >= this.settings.maxConcurrentDocuments) return { accepted: false };
    this.activeDocuments += 1;
    try {
      const source = await this.getSource(filePath, fileSize);
      const document = transform(source);
      return { accepted: true, body: compress ? await gzipAsync(document) : document };
    } finally {
      // Release only after read, transform, and worker-pool compression settle.
      // A disconnected response must not let an attacker bypass the work cap.
      this.activeDocuments -= 1;
    }
  }

  private async getSource(filePath: string, fileSize: number | undefined): Promise<string> {
    assertLandingDocumentSize(fileSize, this.settings.maxDocumentBytes);
    const cached = this.cache.get(filePath);
    if (cached) {
      this.cache.delete(filePath);
      this.cache.set(filePath, cached);
      return cached.document;
    }
    const existingLoad = this.pendingLoads.get(filePath);
    if (existingLoad) return existingLoad;

    const pending = this.loadAndCache(filePath);
    this.pendingLoads.set(filePath, pending);
    try {
      return await pending;
    } finally {
      this.pendingLoads.delete(filePath);
    }
  }

  private async loadAndCache(filePath: string): Promise<string> {
    const document = await this.loadSource(filePath, this.settings.maxDocumentBytes);
    if (Buffer.byteLength(document, "utf8") > this.settings.maxDocumentBytes) {
      throw new LandingDocumentTooLargeError();
    }

    // JavaScript strings use up to two bytes per code unit. This deliberately
    // overestimates ASCII build output so the configured cache is a hard bound.
    const memoryBytes = document.length * 2;
    if (memoryBytes > this.settings.maxCacheBytes) return document;
    while (this.cache.size >= 128 || this.cacheBytes + memoryBytes > this.settings.maxCacheBytes) {
      const oldest = this.cache.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cacheBytes -= oldest[1].memoryBytes;
    }
    this.cache.set(filePath, { document, memoryBytes });
    this.cacheBytes += memoryBytes;
    return document;
  }
}
