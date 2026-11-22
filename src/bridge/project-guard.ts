import { AsyncLocalStorage } from "node:async_hooks";

const expectedProject = new AsyncLocalStorage<string | undefined>();
export interface ExpectedHostTarget {
  backend: "cep";
  sequence_id?: string;
  project_document_id?: string;
  source_item?: { node_id: string; media_path?: string };
  clip?: { node_id: string; track_type: "video" | "audio"; track_index: number; project_item_id?: string; start_ticks?: string; end_ticks?: string; in_ticks?: string; out_ticks?: string; effect?: { match_name: string; display_name?: string; parameter_index: number; parameter_name: string } };
}
const expectedTarget = new AsyncLocalStorage<{ target: ExpectedHostTarget; requireUnlinked: boolean } | undefined>();

/** Backend-scoped identities are never inferred from a track/clip index alone. */
export function runWithExpectedHostTarget<T>(value: unknown, operation: () => T, options?: { requireUnlinked: boolean }): T {
  if (value === undefined) return expectedTarget.run(undefined, operation);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected_target must be an object");
  const target = value as ExpectedHostTarget;
  if (Object.keys(target).some((key) => !["backend", "sequence_id", "clip", "project_document_id", "source_item"].includes(key)) || target.backend !== "cep" || (target.sequence_id === undefined ? !target.source_item || !!target.clip : typeof target.sequence_id !== "string" || !target.sequence_id || target.sequence_id.length > 512)) throw new Error("expected_target requires backend=cep and a bounded sequence_id or source_item");
  if (target.project_document_id !== undefined && (typeof target.project_document_id !== "string" || !target.project_document_id || target.project_document_id.length > 512)) throw new Error("expected_target.project_document_id must be a bounded host identity");
  if (target.source_item !== undefined) {
    const source = target.source_item;
    if (!source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).some(key => !["node_id", "media_path"].includes(key)) || typeof source.node_id !== "string" || !source.node_id || source.node_id.length > 512 || (source.media_path !== undefined && (typeof source.media_path !== "string" || !source.media_path || source.media_path.length > 4096 || /[\x00-\x1f]/.test(source.media_path)))) throw new Error("expected_target.source_item requires bounded source identity/path");
  }
  if (target.clip !== undefined) {
    const clip = target.clip;
    if (!clip || typeof clip !== "object" || Array.isArray(clip)) throw new Error("expected_target.clip must be an object");
    if (Object.keys(clip).some((key) => !["node_id", "track_type", "track_index", "project_item_id", "start_ticks", "end_ticks", "in_ticks", "out_ticks", "effect"].includes(key)) || typeof clip.node_id !== "string" || !clip.node_id || clip.node_id.length > 512 || !["video", "audio"].includes(clip.track_type) || !Number.isInteger(clip.track_index) || clip.track_index < 0 || clip.track_index > 255) throw new Error("expected_target.clip requires a stable node_id, media type, and bounded track index");
    if (clip.project_item_id !== undefined && (typeof clip.project_item_id !== "string" || !clip.project_item_id || clip.project_item_id.length > 512)) throw new Error("expected_target.clip.project_item_id must be a bounded stable identity");
    for (const field of ["start_ticks", "end_ticks", "in_ticks", "out_ticks"] as const) if (clip[field] !== undefined && !/^-?\d{1,30}$/.test(clip[field]!)) throw new Error(`expected_target.clip.${field} must be a decimal tick string`);
    if (clip.effect !== undefined) {
      const effect = clip.effect;
      if (!effect || typeof effect !== "object" || Array.isArray(effect) || Object.keys(effect).some(key => !["match_name", "display_name", "parameter_index", "parameter_name"].includes(key)) || typeof effect.match_name !== "string" || !effect.match_name || effect.match_name.length > 512 || typeof effect.parameter_name !== "string" || !effect.parameter_name || effect.parameter_name.length > 512 || (effect.display_name !== undefined && (typeof effect.display_name !== "string" || !effect.display_name || effect.display_name.length > 512)) || !Number.isInteger(effect.parameter_index) || effect.parameter_index < 0 || effect.parameter_index > 255) throw new Error("expected_target.clip.effect requires bounded match identity and exact indexed parameter identity");
    }
  }
  return expectedTarget.run({ target, requireUnlinked: options?.requireUnlinked === true }, operation);
}

export function expectedHostTarget(): ExpectedHostTarget | undefined { return expectedTarget.getStore()?.target; }
export function expectedUnlinkedClip(): boolean { return expectedTarget.getStore()?.requireUnlinked === true; }

/** Scope a project assertion to one MCP request, including its async CEP work. */
export function runWithExpectedProject<T>(value: unknown, operation: () => T): T {
  if (value !== undefined && (typeof value !== "string" || value.length > 4096 ||
      !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value) || /[\x00-\x1f]/.test(value))) {
    throw new Error("expected_project_path must be an absolute saved-project path of at most 4096 characters");
  }
  return expectedProject.run(value as string | undefined, operation);
}

export function expectedProjectPath(): string | undefined {
  return expectedProject.getStore();
}
