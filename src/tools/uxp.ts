import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";
import { planTranscriptRoughCut, previewTranscriptEdit, transcriptRevision } from "./transcript-edits.js";
import { getUxpAdvancedWorkflowTools } from "./uxp-advanced-workflows.js";
import { getUxpNextWorkflowTools } from "./uxp-next-workflows.js";
import { getUxpWorkflowTools } from "./uxp-workflows.js";

function invoke(
  bridge: UxpWebSocketBridge,
  command: string,
  args: Record<string, unknown> = {},
) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

export function getUxpTools(bridge: UxpWebSocketBridge) {
  const operationId = {
    type: "string" as const,
    description: "Optional idempotency key (1-128 letters, numbers, dot, underscore, colon, or dash).",
  };
  return {
    ...getUxpNextWorkflowTools(bridge),
    ...getUxpAdvancedWorkflowTools(bridge),
    ...getUxpWorkflowTools(bridge),
    get_uxp_capabilities: {
      description: "Report the authenticated local UXP bridge connection and the capabilities advertised by the connected Premiere host.",
      parameters: {},
      handler: async () => ({ success: true, data: bridge.getState() }),
    },
    get_uxp_state: {
      description: "Read the active project, sequence, and playhead state through the connected Premiere UXP bridge.",
      parameters: {},
      handler: async () => invoke(bridge, "state.get"),
    },
    inspect_project_uxp: {
      description: "Read a compact, revisioned project and sequence snapshot through documented Premiere UXP APIs.",
      parameters: {},
      handler: async () => invoke(bridge, "project.snapshot"),
    },
    inspect_caption_tracks_uxp: {
      description: "Inventory native caption tracks on the active sequence through documented Premiere UXP APIs. Returns track identity, name, mute state, and item count only; it does not inspect cue text, timing, rendered appearance, or caption correctness.",
      parameters: {},
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "25.6",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: ["Available only through an authenticated UXP bridge whose runtime capability handshake advertises captions.inspect."],
      },
      handler: async () => invoke(bridge, "captions.inspect"),
    },
    save_project_uxp: {
      description: "Save the active project through UXP and require Premiere to confirm success.",
      parameters: {
        type: "object" as const,
        properties: { operation_id: operationId },
      },
      handler: async (args: { operation_id?: string }) => invoke(bridge, "project.save", {
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    create_sequence_with_preset_uxp: {
      description: "Create and verify a sequence from a preset path using the documented Premiere 26.3+ UXP API.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "New sequence name." },
          preset_path: { type: "string", description: "Local Premiere sequence preset path." },
          operation_id: operationId,
        },
        required: ["name", "preset_path"],
      },
      handler: async (args: { name: string; preset_path: string; operation_id?: string }) => invoke(bridge, "sequence.createPreset", {
        name: args.name, presetPath: args.preset_path,
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    export_interchange_uxp: {
      description: "Export the active sequence as OpenTimelineIO or Final Cut Pro XML with explicit verification.",
      parameters: {
        type: "object" as const,
        properties: {
          format: { type: "string", enum: ["otio", "fcpxml"], description: "Interchange format." },
          output_file_path: { type: "string", description: "Absolute output file path." },
          suppress_ui: { type: "boolean", description: "Suppress Premiere export UI; defaults to true." },
          operation_id: operationId,
        },
        required: ["format", "output_file_path"],
      },
      handler: async (args: { format: "otio" | "fcpxml"; output_file_path: string; suppress_ui?: boolean; operation_id?: string }) =>
        invoke(bridge, "interchange.export", {
          format: args.format, outputFilePath: args.output_file_path,
          ...(args.suppress_ui === undefined ? {} : { suppressUI: args.suppress_ui }),
          ...(args.operation_id ? { operationId: args.operation_id } : {}),
        }),
    },
    get_transcript_languages_uxp: {
      description: "List transcription languages supported by the connected Premiere 26.3+ host.",
      parameters: {},
      handler: async () => invoke(bridge, "transcript.languages"),
    },
    get_clip_transcript_uxp: {
      description: "Export Premiere's native transcript JSON for one source media clip. Returns a revision hash that must be used when previewing transcript edits. This is read-only and does not run Speech-to-Text.",
      parameters: {
        type: "object" as const,
        properties: {
          project_item_id: { type: "string", maxLength: 512, description: "Source project-item ID. Omit with project_item_name to use exactly one Project panel selection." },
          project_item_name: { type: "string", maxLength: 255, description: "Unique source media-clip name. Not allowed together with project_item_id." },
        },
      },
      handler: async (args: { project_item_id?: string; project_item_name?: string }) => {
        try {
          const result = await bridge.request("transcript.export", {
            ...(args.project_item_id ? { projectItemId: args.project_item_id } : {}),
            ...(args.project_item_name ? { projectItemName: args.project_item_name } : {}),
          }) as { json?: unknown };
          if (typeof result?.json !== "string" || !result.json) throw new Error("Premiere returned an empty transcript");
          return { success: true, data: { backend: "uxp", result: { ...result, transcriptRevision: transcriptRevision(result.json) } } };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    search_clip_transcript_uxp: {
      description: "Search Premiere's native transcript JSON without modifying the clip or timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          project_item_id: { type: "string", maxLength: 512, description: "Source project-item ID." },
          project_item_name: { type: "string", maxLength: 255, description: "Unique source media-clip name." },
          query: { type: "string", minLength: 1, maxLength: 1000, description: "Transcript text to find." },
          case_sensitive: { type: "boolean", description: "Use case-sensitive matching; defaults to false." },
          max_results: { type: "integer", minimum: 1, maximum: 500, description: "Maximum matches; defaults to 50." },
        },
        required: ["query"],
      },
      handler: async (args: { project_item_id?: string; project_item_name?: string; query: string; case_sensitive?: boolean; max_results?: number }) =>
        invoke(bridge, "transcript.search", {
          ...(args.project_item_id ? { projectItemId: args.project_item_id } : {}),
          ...(args.project_item_name ? { projectItemName: args.project_item_name } : {}),
          query: args.query,
          ...(args.case_sensitive === undefined ? {} : { caseSensitive: args.case_sensitive }),
          ...(args.max_results === undefined ? {} : { maxResults: args.max_results }),
        }),
    },
    preview_transcript_edit_uxp: {
      description: "Validate and merge source-time ranges selected from Premiere's native transcript. Returns a confirmation token and never changes the timeline. Automatic timeline application remains withheld until the source-to-sequence mapping is live-host verified.",
      parameters: {
        type: "object" as const,
        properties: {
          project_item_id: { type: "string", maxLength: 512, description: "Source project-item ID used for the transcript export." },
          project_item_name: { type: "string", maxLength: 255, description: "Unique source media-clip name." },
          transcript_revision: { type: "string", pattern: "^sha256:[a-f0-9]{64}$", description: "Revision returned by get_clip_transcript_uxp." },
          deletions: {
            type: "array", minItems: 1, maxItems: 100,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                start_seconds: { type: "number", minimum: 0 },
                end_seconds: { type: "number", exclusiveMinimum: 0 },
              },
              required: ["start_seconds", "end_seconds"],
            },
            description: "Source-media time ranges corresponding to transcript words or segments to remove.",
          },
          handle_seconds: { type: "number", minimum: 0, maximum: 10, description: "Optional context added to both sides before overlapping ranges are merged." },
        },
        required: ["transcript_revision", "deletions"],
      },
      handler: async (args: { project_item_id?: string; project_item_name?: string; transcript_revision: string; deletions: unknown; handle_seconds?: number }) => {
        try {
          const exported = await bridge.request("transcript.export", {
            ...(args.project_item_id ? { projectItemId: args.project_item_id } : {}),
            ...(args.project_item_name ? { projectItemName: args.project_item_name } : {}),
          }) as { json?: unknown; projectItemId?: unknown; projectItemName?: unknown };
          if (typeof exported?.json !== "string") throw new Error("Premiere returned an empty transcript");
          const preview = previewTranscriptEdit(exported.json, args.transcript_revision, args.deletions, args.handle_seconds);
          return { success: true, data: { backend: "uxp", result: {
            projectItemId: exported.projectItemId,
            projectItemName: exported.projectItemName,
            ...preview,
          } } };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    plan_transcript_rough_cut_uxp: {
      description: "Build a revision-locked, non-mutating rough-cut plan from Premiere's native transcript and verified 1x sequence placements. The plan orders cuts from the end of the timeline, requires a duplicate sequence, and requires re-query after every mutation.",
      parameters: {
        type: "object" as const,
        properties: {
          project_item_id: { type: "string", maxLength: 512 },
          project_item_name: { type: "string", maxLength: 255 },
          transcript_revision: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          deletions: {
            type: "array", minItems: 1, maxItems: 100,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                start_seconds: { type: "number", minimum: 0 },
                end_seconds: { type: "number", exclusiveMinimum: 0 },
              },
              required: ["start_seconds", "end_seconds"],
            },
          },
          placements: {
            type: "array", minItems: 1, maxItems: 256,
            description: "Verified 1x placements of this source in the target duplicate sequence.",
            items: {
              type: "object", additionalProperties: false,
              properties: {
                placement_id: { type: "string", minLength: 1, maxLength: 512 },
                track_type: { type: "string", enum: ["video", "audio"] },
                track_index: { type: "integer", minimum: 0 },
                source_in_seconds: { type: "number", minimum: 0 },
                source_out_seconds: { type: "number", exclusiveMinimum: 0 },
                timeline_start_seconds: { type: "number", minimum: 0 },
                timeline_end_seconds: { type: "number", exclusiveMinimum: 0 },
              },
              required: ["placement_id", "track_type", "track_index", "source_in_seconds", "source_out_seconds", "timeline_start_seconds", "timeline_end_seconds"],
            },
          },
          handle_seconds: { type: "number", minimum: 0, maximum: 10 },
          ripple: { type: "boolean", description: "Whether the resulting instructions should ripple removals; defaults to true." },
        },
        required: ["transcript_revision", "deletions", "placements"],
      },
      handler: async (args: { project_item_id?: string; project_item_name?: string; transcript_revision: string; deletions: unknown; placements: unknown; handle_seconds?: number; ripple?: boolean }) => {
        try {
          const exported = await bridge.request("transcript.export", {
            ...(args.project_item_id ? { projectItemId: args.project_item_id } : {}),
            ...(args.project_item_name ? { projectItemName: args.project_item_name } : {}),
          }) as { json?: unknown; projectItemId?: unknown; projectItemName?: unknown };
          if (typeof exported?.json !== "string") throw new Error("Premiere returned an empty transcript");
          const preview = previewTranscriptEdit(exported.json, args.transcript_revision, args.deletions, args.handle_seconds);
          return { success: true, data: { backend: "uxp", result: {
            projectItemId: exported.projectItemId,
            projectItemName: exported.projectItemName,
            ...planTranscriptRoughCut(preview, args.placements, args.ripple ?? true),
          } } };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    detect_object_masks_uxp: {
      description: "Detect whether the active project or sequence contains an Object Mask using Premiere 26.3+.",
      parameters: {
        type: "object" as const,
        properties: { scope: { type: "string", enum: ["sequence", "project"], description: "Inspection scope; defaults to sequence." } },
      },
      handler: async (args: { scope?: "sequence" | "project" }) => invoke(bridge, "objectMask.has", args.scope ? { scope: args.scope } : {}),
    },
    configure_encoder_uxp: {
      description: "Launch or configure Adobe Media Encoder and optionally start its queued batch using Premiere 26.3+.",
      parameters: {
        type: "object" as const,
        properties: {
          launch: { type: "boolean", description: "Launch AME if needed." },
          embedded_xmp: { type: "boolean", description: "Enable or disable embedded XMP." },
          sidecar_xmp: { type: "boolean", description: "Enable or disable sidecar XMP." },
          start_batch: { type: "boolean", description: "Start queued AME encodes." },
          operation_id: operationId,
        },
      },
      handler: async (args: { launch?: boolean; embedded_xmp?: boolean; sidecar_xmp?: boolean; start_batch?: boolean; operation_id?: string }) =>
        invoke(bridge, "encoder.configure", {
          ...(args.launch === undefined ? {} : { launch: args.launch }),
          ...(args.embedded_xmp === undefined ? {} : { embeddedXmp: args.embedded_xmp }),
          ...(args.sidecar_xmp === undefined ? {} : { sidecarXmp: args.sidecar_xmp }),
          ...(args.start_batch === undefined ? {} : { startBatch: args.start_batch }),
          ...(args.operation_id ? { operationId: args.operation_id } : {}),
        }),
    },
    rename_track_uxp: {
      description: "Rename an audio, video, or caption track through Premiere 26.3+ UXP in an undoable transaction with name readback verification.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: { type: "string", enum: ["audio", "video", "caption"], description: "Track family to rename." },
          track_index: { type: "integer", minimum: 0, description: "Zero-based index within the selected track family." },
          name: { type: "string", minLength: 1, maxLength: 255, description: "New track name." },
          operation_id: operationId,
        },
        required: ["track_type", "track_index", "name"],
      },
      handler: async (args: { track_type: "audio" | "video" | "caption"; track_index: number; name: string; operation_id?: string }) =>
        invoke(bridge, "track.rename", {
          trackType: args.track_type, trackIndex: args.track_index, name: args.name,
          ...(args.operation_id ? { operationId: args.operation_id } : {}),
        }),
    },
    create_subclip_uxp: {
      description: "Create and verify a Premiere 26.3+ subclip in an undoable transaction. Prefer project_item_id; a name must resolve to exactly one media clip.",
      parameters: {
        type: "object" as const,
        properties: {
          project_item_id: { type: "string", maxLength: 512, description: "Stable source project-item ID. Omit with project_item_name to use exactly one Project panel selection." },
          project_item_name: { type: "string", maxLength: 255, description: "Unique source media-clip name. Not allowed together with project_item_id." },
          name: { type: "string", minLength: 1, maxLength: 255, description: "New subclip name." },
          start_seconds: { type: "number", minimum: 0, description: "Subclip in-point in seconds." },
          end_seconds: { type: "number", exclusiveMinimum: 0, description: "Subclip out-point in seconds; must be greater than start_seconds." },
          hard_boundaries: { type: "boolean", description: "Prevent trimming beyond the subclip boundaries; defaults to false." },
          take_video: { type: "boolean", description: "Include video; defaults to true." },
          take_audio: { type: "boolean", description: "Include audio; defaults to true." },
          operation_id: operationId,
        },
        required: ["name", "start_seconds", "end_seconds"],
      },
      handler: async (args: {
        project_item_id?: string;
        project_item_name?: string;
        name: string;
        start_seconds: number;
        end_seconds: number;
        hard_boundaries?: boolean;
        take_video?: boolean;
        take_audio?: boolean;
        operation_id?: string;
      }) => invoke(bridge, "subclip.create", {
        ...(args.project_item_id ? { projectItemId: args.project_item_id } : {}),
        ...(args.project_item_name ? { projectItemName: args.project_item_name } : {}),
        name: args.name, startSeconds: args.start_seconds, endSeconds: args.end_seconds,
        ...(args.hard_boundaries === undefined ? {} : { hasHardBoundaries: args.hard_boundaries }),
        ...(args.take_video === undefined ? {} : { takeVideo: args.take_video }),
        ...(args.take_audio === undefined ? {} : { takeAudio: args.take_audio }),
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    list_markers_uxp: {
      description: "List Premiere markers with stable 26.3+ GUIDs from the active sequence or one source media clip.",
      parameters: {
        type: "object" as const,
        properties: {
          scope: { type: "string", enum: ["sequence", "project_item"], description: "Marker owner; defaults to sequence." },
          project_item_id: { type: "string", maxLength: 512, description: "Source project-item ID when scope is project_item." },
          project_item_name: { type: "string", maxLength: 255, description: "Unique source clip name when scope is project_item." },
          filters: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 64 }, description: "Optional documented marker-type filters." },
        },
      },
      handler: async (args: { scope?: "sequence" | "project_item"; project_item_id?: string; project_item_name?: string; filters?: string[] }) =>
        invoke(bridge, "marker.list", {
          ...(args.scope ? { scope: args.scope === "project_item" ? "projectItem" : "sequence" } : {}),
          ...(args.project_item_id ? { projectItemId: args.project_item_id } : {}),
          ...(args.project_item_name ? { projectItemName: args.project_item_name } : {}),
          ...(args.filters ? { filters: args.filters } : {}),
        }),
    },
    set_source_monitor_position_uxp: {
      description: "Set and read back the Source Monitor position using Premiere 26.3+ UXP.",
      parameters: {
        type: "object" as const,
        properties: {
          seconds: { type: "number", minimum: 0, description: "Source Monitor position in seconds." },
          operation_id: operationId,
        },
        required: ["seconds"],
      },
      handler: async (args: { seconds: number; operation_id?: string }) => invoke(bridge, "sourceMonitor.position.set", {
        seconds: args.seconds,
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    has_transcript_uxp: {
      description: "Check whether a source media clip has a transcript, preferring Premiere 26.3's documented native API when available.",
      parameters: {
        type: "object" as const,
        properties: {
          project_item_id: { type: "string", maxLength: 512, description: "Source project-item ID. Omit with project_item_name to use exactly one Project panel selection." },
          project_item_name: { type: "string", maxLength: 255, description: "Unique source media-clip name. Not allowed together with project_item_id." },
        },
      },
      handler: async (args: { project_item_id?: string; project_item_name?: string }) => invoke(bridge, "transcript.has", {
        ...(args.project_item_id ? { projectItemId: args.project_item_id } : {}),
        ...(args.project_item_name ? { projectItemName: args.project_item_name } : {}),
      }),
    },
    export_aaf_uxp: {
      description: "Export the active sequence as AAF through Premiere 26.3+ UXP with bounded, typed AAF options. Premiere confirms the request, but arbitrary native output paths cannot be statted by the panel.",
      parameters: {
        type: "object" as const,
        properties: {
          output_file_path: { type: "string", minLength: 1, maxLength: 4096, description: "Absolute AAF output path." },
          options: {
            type: "object",
            additionalProperties: false,
            properties: {
              mixdown_video: { type: "boolean" },
              explode_to_mono: { type: "boolean" },
              sample_rate: { type: "integer", enum: [32000, 44100, 48000, 88200, 96000] },
              bits_per_sample: { type: "integer", enum: [16, 24, 32] },
              embed_audio: { type: "boolean" },
              audio_file_format: { type: "string", enum: ["aiff", "wav"] },
              trim_sources: { type: "boolean" },
              handle_frames: { type: "integer", minimum: 0, maximum: 10000 },
              video_mixdown_preset_path: { type: "string", minLength: 1, maxLength: 4096 },
              render_audio_effects: { type: "boolean" },
              interleave_without_effects: { type: "boolean" },
              preserve_parent_folder: { type: "boolean" },
            },
          },
          operation_id: operationId,
        },
        required: ["output_file_path"],
      },
      handler: async (args: {
        output_file_path: string;
        options?: {
          mixdown_video?: boolean;
          explode_to_mono?: boolean;
          sample_rate?: 32000 | 44100 | 48000 | 88200 | 96000;
          bits_per_sample?: 16 | 24 | 32;
          embed_audio?: boolean;
          audio_file_format?: "aiff" | "wav";
          trim_sources?: boolean;
          handle_frames?: number;
          video_mixdown_preset_path?: string;
          render_audio_effects?: boolean;
          interleave_without_effects?: boolean;
          preserve_parent_folder?: boolean;
        };
        operation_id?: string;
      }) => invoke(bridge, "interchange.aaf.export", {
        outputFilePath: args.output_file_path,
        ...(args.options ? { options: {
          ...(args.options.mixdown_video === undefined ? {} : { mixdownVideo: args.options.mixdown_video }),
          ...(args.options.explode_to_mono === undefined ? {} : { explodeToMono: args.options.explode_to_mono }),
          ...(args.options.sample_rate === undefined ? {} : { sampleRate: args.options.sample_rate }),
          ...(args.options.bits_per_sample === undefined ? {} : { bitsPerSample: args.options.bits_per_sample }),
          ...(args.options.embed_audio === undefined ? {} : { embedAudio: args.options.embed_audio }),
          ...(args.options.audio_file_format === undefined ? {} : { audioFileFormat: args.options.audio_file_format }),
          ...(args.options.trim_sources === undefined ? {} : { trimSources: args.options.trim_sources }),
          ...(args.options.handle_frames === undefined ? {} : { handleFrames: args.options.handle_frames }),
          ...(args.options.video_mixdown_preset_path === undefined ? {} : { videoMixdownPresetPath: args.options.video_mixdown_preset_path }),
          ...(args.options.render_audio_effects === undefined ? {} : { renderAudioEffects: args.options.render_audio_effects }),
          ...(args.options.interleave_without_effects === undefined ? {} : { interleaveWithoutEffects: args.options.interleave_without_effects }),
          ...(args.options.preserve_parent_folder === undefined ? {} : { preserveParentFolder: args.options.preserve_parent_folder }),
        } } : {}),
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    export_frame_uxp: {
      description: "Export a sequence frame through Premiere's supported UXP Exporter and verify the output file in the host panel.",
      parameters: {
        type: "object" as const,
        properties: {
          output_directory: {
            type: "string",
            description: "Existing local directory available to the Premiere UXP plugin.",
          },
          filename: {
            type: "string",
            description: "Simple PNG filename without directory components.",
          },
          seconds: {
            type: "number",
            description: "Sequence time in seconds; omit to use the playhead.",
          },
          width: { type: "number", description: "Optional positive output width." },
          height: { type: "number", description: "Optional positive output height." },
        },
        required: ["output_directory", "filename"],
      },
      handler: async (args: {
        output_directory: string;
        filename: string;
        seconds?: number;
        width?: number;
        height?: number;
      }) => invoke(bridge, "frame.export", {
        outputDirectory: args.output_directory,
        filename: args.filename,
        ...(args.seconds === undefined ? {} : { seconds: args.seconds }),
        ...(args.width === undefined ? {} : { width: args.width }),
        ...(args.height === undefined ? {} : { height: args.height }),
      }),
    },
    lift_selection_uxp: {
      description: "Lift the current timeline selection through Premiere's documented UXP SequenceEditor. This removes selected items without ripple in one undoable transaction; transaction acceptance is not a timeline readback.",
      parameters: {
        type: "object" as const,
        properties: {
          expected_sequence_guid: {
            type: "string",
            maxLength: 512,
            description: "Optional active-sequence GUID from inspect_project_uxp; rejects a stale target before mutation.",
          },
          operation_id: operationId,
        },
      },
      handler: async (args: { expected_sequence_guid?: string; operation_id?: string }) =>
        invoke(bridge, "timeline.selection.lift", {
          ...(args.expected_sequence_guid ? { expectedSequenceGuid: args.expected_sequence_guid } : {}),
          ...(args.operation_id ? { operationId: args.operation_id } : {}),
        }),
    },
    list_video_transitions_uxp: {
      description: "List the installed native video-transition match names from the connected Premiere UXP host.",
      parameters: {},
      handler: async () => invoke(bridge, "transition.video.list"),
    },
    add_video_transition_uxp: {
      description: "Add an installed native video transition to one video clip through an undoable UXP transaction. List match names first; transaction acceptance is not a visual timeline readback.",
      parameters: {
        type: "object" as const,
        properties: {
          video_track_index: { type: "integer", minimum: 0, description: "Zero-based target video track index." },
          clip_index: { type: "integer", minimum: 0, description: "Zero-based clip index on the target video track." },
          match_name: { type: "string", minLength: 1, maxLength: 256, description: "Installed match name returned by list_video_transitions_uxp." },
          position: { type: "string", enum: ["start", "end"], description: "Transition side; defaults to start." },
          duration_seconds: { type: "number", exclusiveMinimum: 0, description: "Optional positive transition duration in seconds." },
          force_single_sided: { type: "boolean", description: "Optional Premiere single-sided transition setting." },
          transition_alignment: { type: "integer", description: "Optional Premiere transition alignment constant." },
          operation_id: operationId,
        },
        required: ["video_track_index", "clip_index", "match_name"],
      },
      handler: async (args: {
        video_track_index: number;
        clip_index: number;
        match_name: string;
        position?: "start" | "end";
        duration_seconds?: number;
        force_single_sided?: boolean;
        transition_alignment?: number;
        operation_id?: string;
      }) => invoke(bridge, "transition.video.add", {
        videoTrackIndex: args.video_track_index,
        clipIndex: args.clip_index,
        matchName: args.match_name,
        ...(args.position === undefined ? {} : { position: args.position }),
        ...(args.duration_seconds === undefined ? {} : { durationSeconds: args.duration_seconds }),
        ...(args.force_single_sided === undefined ? {} : { forceSingleSided: args.force_single_sided }),
        ...(args.transition_alignment === undefined ? {} : { transitionAlignment: args.transition_alignment }),
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    remove_video_transition_uxp: {
      description: "Remove the selected side of a native video transition through an undoable UXP transaction; transaction acceptance is not a visual timeline readback.",
      parameters: {
        type: "object" as const,
        properties: {
          video_track_index: { type: "integer", minimum: 0, description: "Zero-based target video track index." },
          clip_index: { type: "integer", minimum: 0, description: "Zero-based clip index on the target video track." },
          position: { type: "string", enum: ["start", "end"], description: "Transition side; defaults to start." },
          operation_id: operationId,
        },
        required: ["video_track_index", "clip_index"],
      },
      handler: async (args: {
        video_track_index: number;
        clip_index: number;
        position?: "start" | "end";
        operation_id?: string;
      }) => invoke(bridge, "transition.video.remove", {
        videoTrackIndex: args.video_track_index,
        clipIndex: args.clip_index,
        ...(args.position === undefined ? {} : { position: args.position }),
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
  };
}
