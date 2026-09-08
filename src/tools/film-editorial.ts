import { z } from "zod";
import { buildFilmEditorialPacket, filmEditorialSchema } from "../ai/film-editorial.js";
import { ProjectContextRepository } from "../context/project-context-store.js";

export function getFilmEditorialTools(dependencies: { repository?: ProjectContextRepository } = {}) {
  const repository = dependencies.repository ?? new ProjectContextRepository();
  return {
    inspect_film_editorial_workflow: {
      description: "Validate a revision-bound film editorial manifest against captured source and timeline identities. Build complete declared coverage review groups, independent picture/audio preferences, screening-note exceptions, story dependencies, VFX state, change impact and a department turnover manifest. Local inspection only: no host edits, exports, automatic creative decisions or verified host claims.",
      parameters: z.toJSONSchema(filmEditorialSchema),
      operationalCapability: {
        backend: "local" as const, backends: ["local" as const], status: "supported" as const,
        minimumPremiereVersion: null, authority: "inspect" as const,
        verificationBoundary: "static_metadata_only" as const, hostVerificationRequired: false,
        notes: ["Checks captured identities and revisions; technical ranges and editorial choices are caller declarations.", "Creates review artifacts only. Host assembly, VFX replacement, exports and round-trip verification remain separate."],
      },
      handler: async (args: unknown) => {
        try {
          const input = filmEditorialSchema.parse(args);
          const document = await repository.get(input.project_id);
          if (!document) throw new Error("Project context not found; capture it before inspecting film editorial workflows");
          return { success: true, data: buildFilmEditorialPacket(document, input) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
