import {
  buildEditorialContextPack,
  DEFAULT_EDITORIAL_CONTEXT_PACK_CHARACTERS,
  DEFAULT_EDITORIAL_CONTEXT_PACK_ENTRIES,
  MAX_EDITORIAL_CONTEXT_PACK_CHARACTERS,
  MAX_EDITORIAL_CONTEXT_PACK_ENTRIES,
  MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS,
} from "../ai/editorial-context-pack.js";
import {
  countProjectContextMatches,
  ProjectContextRepository,
  searchProjectContext,
  type ProjectContextKind,
} from "../context/project-context-store.js";

export interface EditorialContextPackToolDependencies {
  repository?: ProjectContextRepository;
}

function projectId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("project_id is required");
  const normalized = value.trim();
  if (normalized.length > 512) throw new Error("project_id must be a non-empty string of at most 512 characters");
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function optionalKinds(value: unknown): ProjectContextKind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error("kinds must contain between 1 and 8 context kinds");
  }
  const allowed = new Set<ProjectContextKind>(["project", "sequence", "source", "timeline", "transcript", "shot", "audio", "note"]);
  const kinds = value.map((entry, index) => {
    if (typeof entry !== "string" || !allowed.has(entry as ProjectContextKind)) {
      throw new Error(`kinds[${index}] must be a supported project-context kind`);
    }
    return entry as ProjectContextKind;
  });
  if (new Set(kinds).size !== kinds.length) throw new Error("kinds must not contain duplicates");
  return kinds;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

/**
 * A transcript-first reading surface for agents. The tool only compacts local
 * project-context evidence; it does not invoke transcription, a model, a
 * provider, the Premiere bridge, or any timeline mutation.
 */
export function getEditorialContextPackTools(dependencies: EditorialContextPackToolDependencies = {}) {
  const repository = dependencies.repository ?? new ProjectContextRepository();
  return {
    create_editorial_context_pack: {
      description: "Create a compact Markdown reading view from already captured local transcript, shot, audio, note, source, or timeline context. It returns stable evidence IDs and context revisions for review, never calls an AI/provider or Premiere, and cannot change the project.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          project_id: { type: "string", minLength: 1, maxLength: 512, description: "Project context ID returned by manage_project_context capture." },
          intent: { type: "string", minLength: 1, maxLength: 1_000, description: "The editorial question used to retrieve and compact local evidence." },
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional exact sequence ID filter." },
          kinds: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: { type: "string", enum: ["project", "sequence", "source", "timeline", "transcript", "shot", "audio", "note"] },
            description: "Optional context-kind filter. Omit to retrieve all matching local evidence.",
          },
          max_entries: { type: "integer", minimum: 1, maximum: MAX_EDITORIAL_CONTEXT_PACK_ENTRIES, default: DEFAULT_EDITORIAL_CONTEXT_PACK_ENTRIES, description: "Maximum matching evidence entries to include." },
          max_characters: { type: "integer", minimum: MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS, maximum: MAX_EDITORIAL_CONTEXT_PACK_CHARACTERS, default: DEFAULT_EDITORIAL_CONTEXT_PACK_CHARACTERS, description: "Strict maximum length of the Markdown reading view." },
        },
        required: ["project_id", "intent"],
      },
      operationalCapability: {
        backend: "local" as const,
        backends: ["local" as const],
        status: "supported" as const,
        minimumPremiereVersion: null,
        authority: "inspect" as const,
        verificationBoundary: "static_metadata_only" as const,
        hostVerificationRequired: false,
        notes: [
          "Reads only existing local project-context evidence and emits a bounded Markdown view.",
          "Does not parse an undocumented Premiere transcript schema, invoke a provider, or contact the Premiere bridge.",
          "Returned revisions identify the captured context state; they are not licensed-host or editorial-quality verification.",
        ],
      },
      handler: async (args: {
        project_id: string;
        intent: string;
        sequence_id?: string;
        kinds?: ProjectContextKind[];
        max_entries?: number;
        max_characters?: number;
      }) => {
        try {
          const id = projectId(args.project_id);
          const intent = optionalText(args.intent, "intent", 1_000);
          if (!intent) throw new Error("intent is required");
          const sequenceId = optionalText(args.sequence_id, "sequence_id", 512);
          const kinds = optionalKinds(args.kinds);
          const maxEntries = boundedInteger(
            args.max_entries,
            DEFAULT_EDITORIAL_CONTEXT_PACK_ENTRIES,
            1,
            MAX_EDITORIAL_CONTEXT_PACK_ENTRIES,
            "max_entries",
          );
          const maxCharacters = boundedInteger(
            args.max_characters,
            DEFAULT_EDITORIAL_CONTEXT_PACK_CHARACTERS,
            MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS,
            MAX_EDITORIAL_CONTEXT_PACK_CHARACTERS,
            "max_characters",
          );
          const document = await repository.get(id);
          if (!document) return { success: false, error: "Project context not found; capture it before creating an editorial context pack" };
          const searchOptions = {
            query: intent,
            ...(sequenceId ? { sequenceId } : {}),
            ...(kinds ? { kinds } : {}),
          };
          const results = searchProjectContext(document, {
            ...searchOptions,
            limit: maxEntries,
          }).filter((result) => result.matchedTerms.length > 0);
          const totalResultCount = countProjectContextMatches(document, searchOptions);
          return {
            success: true,
            data: buildEditorialContextPack(document, {
              intent,
              results,
              totalResultCount,
              maxEntries,
              maxCharacters,
            }),
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
