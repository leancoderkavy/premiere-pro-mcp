import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const PROJECT_CONTEXT_SCHEMA_VERSION = 1;
export const MAX_CONTEXT_RECORDS = 10_000;
export const MAX_CONTEXT_TEXT_LENGTH = 20_000;

export type ProjectContextKind =
  | "project"
  | "sequence"
  | "source"
  | "timeline"
  | "transcript"
  | "shot"
  | "audio"
  | "note";

export interface ProjectContextRecord {
  id: string;
  kind: ProjectContextKind;
  name: string;
  text: string;
  keywords: string[];
  sequenceId?: string;
  sourceId?: string;
  timelineItemId?: string;
  startSeconds?: number;
  endSeconds?: number;
  trackType?: "video" | "audio";
  trackIndex?: number;
  sourceRevision?: string;
  timelineRevision?: string;
  mediaPathHash?: string;
  metadata?: Record<string, unknown>;
  indexedAt: string;
}

export interface ProjectContextDocument {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  projectId: string;
  projectName: string;
  projectPathHash?: string;
  revision: string;
  sourceRevision: string;
  timelineRevision: string;
  updatedAt: string;
  records: ProjectContextRecord[];
}

export interface ProjectContextSummary {
  projectId: string;
  projectName: string;
  revision: string;
  sourceRevision: string;
  timelineRevision: string;
  recordCount: number;
  updatedAt: string;
}

export type ContextBackendName = "sqlite" | "json" | "memory";

interface ContextBackend {
  readonly name: ContextBackendName;
  get(projectId: string): Promise<ProjectContextDocument | undefined>;
  put(document: ProjectContextDocument): Promise<void>;
  delete(projectId: string): Promise<boolean>;
  list(): Promise<ProjectContextSummary[]>;
  close?(): void;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function projectFileName(projectId: string): string {
  return `${hash(projectId)}.json`;
}

function toSummary(document: ProjectContextDocument): ProjectContextSummary {
  return {
    projectId: document.projectId,
    projectName: document.projectName,
    revision: document.revision,
    sourceRevision: document.sourceRevision,
    timelineRevision: document.timelineRevision,
    recordCount: document.records.length,
    updatedAt: document.updatedAt,
  };
}

function validateDocument(value: unknown): ProjectContextDocument {
  if (!value || typeof value !== "object") throw new Error("Invalid project context document");
  const document = value as ProjectContextDocument;
  if (document.schemaVersion !== PROJECT_CONTEXT_SCHEMA_VERSION) {
    throw new Error(`Unsupported project context schema version: ${String(document.schemaVersion)}`);
  }
  if (!document.projectId || !document.projectName || !Array.isArray(document.records)) {
    throw new Error("Project context document is missing required fields");
  }
  if (document.records.length > MAX_CONTEXT_RECORDS) {
    throw new Error(`Project context document exceeds ${MAX_CONTEXT_RECORDS} records`);
  }
  return document;
}

export function defaultProjectContextDirectory(): string {
  if (process.env.PREMIERE_CONTEXT_DIR?.trim()) {
    return path.resolve(process.env.PREMIERE_CONTEXT_DIR.trim());
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    return path.join(localAppData || path.join(homedir(), "AppData", "Local"), "premiere-pro-mcp", "context");
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "premiere-pro-mcp", "context");
  }
  const stateRoot = process.env.XDG_STATE_HOME?.trim() || path.join(homedir(), ".local", "state");
  return path.join(stateRoot, "premiere-pro-mcp", "context");
}

class MemoryContextBackend implements ContextBackend {
  readonly name = "memory" as const;
  private readonly documents = new Map<string, ProjectContextDocument>();

  async get(projectId: string): Promise<ProjectContextDocument | undefined> {
    const document = this.documents.get(projectId);
    return document ? structuredClone(document) : undefined;
  }

  async put(document: ProjectContextDocument): Promise<void> {
    this.documents.set(document.projectId, structuredClone(document));
  }

  async delete(projectId: string): Promise<boolean> {
    return this.documents.delete(projectId);
  }

  async list(): Promise<ProjectContextSummary[]> {
    return [...this.documents.values()].map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

class JsonContextBackend implements ContextBackend {
  readonly name = "json" as const;

  constructor(private readonly directory: string) {}

  private filePath(projectId: string): string {
    return path.join(this.directory, projectFileName(projectId));
  }

  async get(projectId: string): Promise<ProjectContextDocument | undefined> {
    try {
      return validateDocument(JSON.parse(await readFile(this.filePath(projectId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async put(document: ProjectContextDocument): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.filePath(document.projectId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  async delete(projectId: string): Promise<boolean> {
    try {
      await rm(this.filePath(projectId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async list(): Promise<ProjectContextSummary[]> {
    try {
      const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).slice(0, 1_000);
      const summaries: ProjectContextSummary[] = [];
      for (const name of names) {
        try {
          summaries.push(toSummary(validateDocument(JSON.parse(await readFile(path.join(this.directory, name), "utf8")))));
        } catch {
          // One corrupt or incompatible file must not hide the remaining projects.
        }
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

interface SqliteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

class SqliteContextBackend implements ContextBackend {
  readonly name = "sqlite" as const;

  constructor(private readonly database: SqliteDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS project_context (
        project_id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        revision TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        timeline_revision TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      )
    `);
  }

  async get(projectId: string): Promise<ProjectContextDocument | undefined> {
    const row = this.database.prepare("SELECT payload_json FROM project_context WHERE project_id = ?").get(projectId) as
      | { payload_json?: unknown }
      | undefined;
    return typeof row?.payload_json === "string" ? validateDocument(JSON.parse(row.payload_json)) : undefined;
  }

  async put(document: ProjectContextDocument): Promise<void> {
    this.database.prepare(`
      INSERT INTO project_context (
        project_id, project_name, revision, source_revision, timeline_revision, updated_at, record_count, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        project_name = excluded.project_name,
        revision = excluded.revision,
        source_revision = excluded.source_revision,
        timeline_revision = excluded.timeline_revision,
        updated_at = excluded.updated_at,
        record_count = excluded.record_count,
        payload_json = excluded.payload_json
    `).run(
      document.projectId,
      document.projectName,
      document.revision,
      document.sourceRevision,
      document.timelineRevision,
      document.updatedAt,
      document.records.length,
      JSON.stringify(document),
    );
  }

  async delete(projectId: string): Promise<boolean> {
    const result = this.database.prepare("DELETE FROM project_context WHERE project_id = ?").run(projectId) as
      | { changes?: unknown }
      | undefined;
    return typeof result?.changes === "number" && result.changes > 0;
  }

  async list(): Promise<ProjectContextSummary[]> {
    const rows = this.database.prepare(`
      SELECT project_id, project_name, revision, source_revision, timeline_revision, updated_at, record_count
      FROM project_context ORDER BY updated_at DESC LIMIT 1000
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      projectId: String(row.project_id),
      projectName: String(row.project_name),
      revision: String(row.revision),
      sourceRevision: String(row.source_revision),
      timelineRevision: String(row.timeline_revision),
      updatedAt: String(row.updated_at),
      recordCount: Number(row.record_count),
    }));
  }

  close(): void {
    this.database.close();
  }
}

export interface ProjectContextRepositoryOptions {
  backend?: "auto" | ContextBackendName;
  directory?: string;
}

export class ProjectContextRepository {
  private backendPromise?: Promise<ContextBackend>;

  constructor(private readonly options: ProjectContextRepositoryOptions = {}) {}

  private async createBackend(): Promise<ContextBackend> {
    const requested = this.options.backend ??
      (process.env.PREMIERE_CONTEXT_BACKEND as ProjectContextRepositoryOptions["backend"] | undefined) ??
      "auto";
    if (!new Set(["auto", "sqlite", "json", "memory"]).has(requested)) {
      throw new Error("PREMIERE_CONTEXT_BACKEND must be auto, sqlite, json, or memory");
    }
    if (requested === "memory") return new MemoryContextBackend();

    const directory = path.resolve(this.options.directory ?? defaultProjectContextDirectory());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (requested === "sqlite" || requested === "auto") {
      try {
        // Keep Node 20 compatibility: node:sqlite exists on newer runtimes only.
        const moduleName = "node:sqlite";
        const sqlite = await import(moduleName) as unknown as {
          DatabaseSync: new (fileName: string) => SqliteDatabase;
        };
        const databasePath = path.join(directory, "project-context.sqlite");
        const database = new sqlite.DatabaseSync(databasePath);
        return new SqliteContextBackend(database);
      } catch (error) {
        if (requested === "sqlite") {
          throw new Error(`SQLite context storage is unavailable on this Node runtime: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return new JsonContextBackend(directory);
  }

  private backend(): Promise<ContextBackend> {
    this.backendPromise ??= this.createBackend();
    return this.backendPromise;
  }

  async backendName(): Promise<ContextBackendName> {
    return (await this.backend()).name;
  }

  async get(projectId: string): Promise<ProjectContextDocument | undefined> {
    return (await this.backend()).get(projectId);
  }

  async put(document: ProjectContextDocument): Promise<void> {
    if (document.records.length > MAX_CONTEXT_RECORDS) {
      throw new Error(`Project context is limited to ${MAX_CONTEXT_RECORDS} records`);
    }
    await (await this.backend()).put(document);
  }

  async delete(projectId: string): Promise<boolean> {
    return (await this.backend()).delete(projectId);
  }

  async list(): Promise<ProjectContextSummary[]> {
    return (await this.backend()).list();
  }

  async close(): Promise<void> {
    if (!this.backendPromise) return;
    (await this.backendPromise).close?.();
    this.backendPromise = undefined;
  }
}

function tokens(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].slice(0, 128);
}

export interface ProjectContextSearchOptions {
  query: string;
  sequenceId?: string;
  kinds?: ProjectContextKind[];
  limit?: number;
}

export interface ProjectContextSearchResult {
  score: number;
  record: ProjectContextRecord;
  matchedTerms: string[];
}

function matchingTerms(record: ProjectContextRecord, queryTerms: readonly string[]): string[] {
  const name = record.name.toLocaleLowerCase();
  const text = record.text.toLocaleLowerCase();
  const keywordSet = new Set(record.keywords.flatMap(tokens));
  return queryTerms.filter((term) => name.includes(term) || text.includes(term) || keywordSet.has(term));
}

/** Counts exact keyword-relevant records without materializing their evidence. */
export function countProjectContextMatches(
  document: ProjectContextDocument,
  options: Omit<ProjectContextSearchOptions, "limit">,
): number {
  const query = options.query.trim().slice(0, 1_000);
  if (!query) throw new Error("query must not be empty");
  const queryTerms = tokens(query);
  const kindFilter = options.kinds?.length ? new Set(options.kinds) : undefined;
  return document.records
    .filter((record) => !options.sequenceId || record.sequenceId === options.sequenceId)
    .filter((record) => !kindFilter || kindFilter.has(record.kind))
    .filter((record) => matchingTerms(record, queryTerms).length > 0)
    .length;
}

export function searchProjectContext(
  document: ProjectContextDocument,
  options: ProjectContextSearchOptions,
): ProjectContextSearchResult[] {
  const query = options.query.trim().slice(0, 1_000);
  if (!query) throw new Error("query must not be empty");
  const queryTerms = tokens(query);
  const kindFilter = options.kinds?.length ? new Set(options.kinds) : undefined;
  const limit = Math.max(1, Math.min(MAX_CONTEXT_RECORDS, Math.trunc(options.limit ?? 12)));

  return document.records
    .filter((record) => !options.sequenceId || record.sequenceId === options.sequenceId)
    .filter((record) => !kindFilter || kindFilter.has(record.kind))
    .map((record) => {
      const matchedTerms = matchingTerms(record, queryTerms);
      let score = matchedTerms.length * 2;
      const name = record.name.toLocaleLowerCase();
      const text = record.text.toLocaleLowerCase();
      const keywordSet = new Set(record.keywords.flatMap(tokens));
      if (name.includes(query.toLocaleLowerCase())) score += 8;
      if (text.includes(query.toLocaleLowerCase())) score += 5;
      score += matchedTerms.filter((term) => keywordSet.has(term)).length * 2;
      if (record.kind === "transcript" || record.kind === "shot" || record.kind === "audio") score += 0.5;
      return { score, record, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
    .slice(0, limit);
}

export function contextRevision(
  sourceRevision: string,
  timelineRevision: string,
  records: ProjectContextRecord[],
): string {
  const enrichment = records
    .filter((record) => !new Set<ProjectContextKind>(["project", "sequence", "source", "timeline"]).has(record.kind))
    .map((record) => [record.id, record.sourceRevision, record.timelineRevision, record.text])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return hash(JSON.stringify({ sourceRevision, timelineRevision, enrichment })).slice(0, 24);
}

export function stableContextId(...parts: unknown[]): string {
  return hash(JSON.stringify(parts)).slice(0, 24);
}

export function normalizeContextText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT_TEXT_LENGTH);
}

export function normalizeContextKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeContextText).filter(Boolean))].slice(0, 64);
}
