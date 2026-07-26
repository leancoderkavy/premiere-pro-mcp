import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { createReadStream, readFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export type DeliveryChecksumAlgorithm = "sha256" | "sha512";

export interface DeliveryFileVerification {
  path: string;
  exists: true;
  regularFile: true;
  sizeBytes: number;
  modifiedAt: string;
  checksum: {
    algorithm: DeliveryChecksumAlgorithm;
    value: string;
  };
  matchesExpectedChecksum?: boolean;
  matchesExpectedSize?: boolean;
  valid: boolean;
}

export async function verifyDeliveryFile(
  outputPath: string,
  options: {
    algorithm?: DeliveryChecksumAlgorithm;
    expectedChecksum?: string;
    expectedSizeBytes?: number;
    minimumSizeBytes?: number;
  } = {},
): Promise<DeliveryFileVerification> {
  const path = resolve(outputPath);
  if (!existsSync(path)) throw new Error(`Delivery file does not exist: ${path}`);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`Delivery path is not a regular file: ${path}`);

  const minimumSizeBytes = options.minimumSizeBytes ?? 1;
  if (!Number.isSafeInteger(minimumSizeBytes) || minimumSizeBytes < 0) {
    throw new Error("minimum_size_bytes must be a non-negative integer");
  }
  if (stats.size < minimumSizeBytes) {
    throw new Error(`Delivery file is ${stats.size} bytes; expected at least ${minimumSizeBytes}`);
  }

  const algorithm = options.algorithm ?? "sha256";
  if (algorithm !== "sha256" && algorithm !== "sha512") {
    throw new Error("checksum_algorithm must be 'sha256' or 'sha512'");
  }
  const hash = createHash(algorithm);
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", resolveHash);
  });
  const checksum = hash.digest("hex");

  const expectedChecksum = options.expectedChecksum?.trim().toLowerCase();
  const expectedLength = algorithm === "sha256" ? 64 : 128;
  if (expectedChecksum !== undefined && !new RegExp(`^[a-f0-9]{${expectedLength}}$`).test(expectedChecksum)) {
    throw new Error(`expected_checksum must be a ${expectedLength}-character hexadecimal ${algorithm} digest`);
  }
  const expectedSize = options.expectedSizeBytes;
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
    throw new Error("expected_size_bytes must be a non-negative integer");
  }
  const matchesExpectedChecksum = expectedChecksum === undefined ? undefined : checksum === expectedChecksum;
  const matchesExpectedSize = expectedSize === undefined ? undefined : stats.size === expectedSize;

  return {
    path,
    exists: true,
    regularFile: true,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    checksum: { algorithm, value: checksum },
    ...(matchesExpectedChecksum === undefined ? {} : { matchesExpectedChecksum }),
    ...(matchesExpectedSize === undefined ? {} : { matchesExpectedSize }),
    valid: matchesExpectedChecksum !== false && matchesExpectedSize !== false,
  };
}

export function inspectExportPresetFile(presetPath: string) {
  const path = resolve(presetPath);
  if (extname(path).toLowerCase() !== ".epr") throw new Error("Export preset must use the .epr extension");
  if (!existsSync(path)) throw new Error(`Export preset does not exist: ${path}`);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`Export preset path is not a regular file: ${path}`);
  if (stats.size === 0) throw new Error(`Export preset is empty: ${path}`);
  return { path, exists: true as const, regularFile: true as const, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
}

export function getExportTools(bridgeOptions: BridgeOptions) {
  return {
    validate_export_preset: {
      description:
        "Validate that an Adobe Media Encoder .epr preset exists and ask the active Premiere sequence which output extension it produces",
      parameters: {
        type: "object" as const,
        properties: {
          preset_path: {
            type: "string",
            description: "Full path to an Adobe Media Encoder export preset (.epr)",
          },
        },
        required: ["preset_path"],
      },
      handler: async (args: { preset_path: string }) => {
        let file;
        try {
          file = inspectExportPresetFile(args.preset_path);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var presetPath = "${escapeForExtendScript(file.path)}";
          var extension = seq.getExportFileExtension(presetPath);
          if (!extension) return __error("Premiere could not resolve an output extension for this preset");
          return __result({ presetPath: presetPath, outputExtension: extension });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;
        return {
          success: true,
          data: {
            ...file,
            ...((result.data ?? {}) as Record<string, unknown>),
            hostValidated: true,
          },
        };
      },
    },

    verify_delivery_file: {
      description:
        "Verify that an exported delivery is a non-empty regular file and calculate a SHA-256 or SHA-512 checksum; optionally compare expected size and checksum",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full path to the exported delivery file",
          },
          checksum_algorithm: {
            type: "string",
            enum: ["sha256", "sha512"],
            description: "Checksum algorithm (default: sha256)",
          },
          expected_checksum: {
            type: "string",
            description: "Optional expected hexadecimal checksum to compare",
          },
          expected_size_bytes: {
            type: "number",
            description: "Optional exact expected file size in bytes",
          },
          minimum_size_bytes: {
            type: "number",
            description: "Minimum acceptable file size in bytes (default: 1)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        checksum_algorithm?: DeliveryChecksumAlgorithm;
        expected_checksum?: string;
        expected_size_bytes?: number;
        minimum_size_bytes?: number;
      }) => {
        try {
          const verification = await verifyDeliveryFile(args.output_path, {
            algorithm: args.checksum_algorithm,
            expectedChecksum: args.expected_checksum,
            expectedSizeBytes: args.expected_size_bytes,
            minimumSizeBytes: args.minimum_size_bytes,
          });
          return verification.valid
            ? { success: true, data: verification }
            : { success: false, error: "Delivery file did not match the expected checksum or size", data: verification };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },

    export_sequence: {
      description: "Export the active sequence using Adobe Media Encoder",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/exports/video.mp4')",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr). Uses default H.264 if omitted.",
          },
          work_area_only: {
            type: "boolean",
            description: "Export only the work area (default: false, exports entire sequence)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; preset_path?: string; work_area_only?: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var outputPath = "${escapeForExtendScript(args.output_path)}";
          
          ${args.preset_path
            ? `var presetPath = "${escapeForExtendScript(args.preset_path)}";`
            : `var presetPath = __findH264Preset();
               if (!presetPath) return __error("Could not locate a default H.264 preset. Pass preset_path explicitly.");`
          }

          var exportResult = seq.exportAsMediaDirect(
            outputPath,
            presetPath,
            ${args.work_area_only ? "app.encoder.ENCODE_WORKAREA" : "app.encoder.ENCODE_ENTIRE"}
          );

          return __result({ exported: true, outputPath: outputPath, presetUsed: presetPath });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 120000 }); // 2 min timeout for exports
      },
    },

    export_frame: {
      description: "Export the current frame as an image file",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/frame.png'). Extension determines format.",
          },
          time_seconds: {
            type: "number",
            description: "Time position in seconds to export. Uses current playhead if omitted.",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; time_seconds?: number }) => {
        const script = buildToolScript(`
          var outputPath = "${escapeForExtendScript(args.output_path)}";
          var ticks = ${args.time_seconds !== undefined
            ? `__secondsToTicks(${args.time_seconds}).toString()`
            : "null"};

          var res = __exportStillFrame(outputPath, ticks);
          if (!res.ok) return __error(res.error + " [" + res.notes.join("; ") + "]");

          return __result({ exported: true, outputPath: res.path, method: res.method });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 60000 });
      },
    },

    export_as_fcp_xml: {
      description: "Export the active sequence as a Final Cut Pro XML file",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.xml')",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          seq.exportAsFinalCutProXML("${escapeForExtendScript(args.output_path)}");
          return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}", format: "FCP XML" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_aaf: {
      description: "Export the active sequence as an AAF file (for Pro Tools, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.aaf')",
          },
          mix_down_video: {
            type: "boolean",
            description: "Mix down video to single track (default: true)",
          },
          explode_to_mono: {
            type: "boolean",
            description: "Explode multichannel audio to mono (default: false)",
          },
          sample_rate: {
            type: "number",
            description: "Audio sample rate (default: 48000)",
          },
          bits_per_sample: {
            type: "number",
            description: "Audio bit depth (default: 16)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        mix_down_video?: boolean;
        explode_to_mono?: boolean;
        sample_rate?: number;
        bits_per_sample?: number;
      }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          seq.exportAsAAF(
            "${escapeForExtendScript(args.output_path)}",
            ${args.mix_down_video !== false ? 1 : 0},
            ${args.explode_to_mono ? 1 : 0},
            ${args.sample_rate ?? 48000},
            ${args.bits_per_sample ?? 16}
          );
          
          return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}", format: "AAF" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_to_render_queue: {
      description: "Add the active sequence to the Adobe Media Encoder render queue",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; preset_path?: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var encoder = app.encoder;
          if (!encoder) return __error("Adobe Media Encoder not available");
          
          encoder.launchEncoder();
          
          var outputPath = "${escapeForExtendScript(args.output_path)}";
          ${args.preset_path
            ? `var presetPath = "${escapeForExtendScript(args.preset_path)}";`
            : `var presetPath = encoder.ENCODE_MATCH_SEQUENCE;`
          }
          
          encoder.encodeSequence(
            seq,
            outputPath,
            presetPath,
            0, // workAreaType
            1  // removeOnCompletion
          );
          
          return __result({ queued: true, outputPath: outputPath });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_render_queue_status: {
      description: "Get the current status of the Adobe Media Encoder render queue",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var encoder = app.encoder;
          if (!encoder) return __error("Adobe Media Encoder not available");
          
          return __result({
            isRunning: encoder.isRunning ? encoder.isRunning() : "unknown",
            info: "Check Adobe Media Encoder application for detailed queue status"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_subclip: {
      description: "Create a subclip from a project item with in/out points",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the source project item",
          },
          name: {
            type: "string",
            description: "Name for the subclip",
          },
          in_seconds: {
            type: "number",
            description: "In-point in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Out-point in seconds",
          },
        },
        required: ["item_id", "name", "in_seconds", "out_seconds"],
      },
      handler: async (args: { item_id: string; name: string; in_seconds: number; out_seconds: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var inTicks = __secondsToTicks(${args.in_seconds}).toString();
          var outTicks = __secondsToTicks(${args.out_seconds}).toString();
          
          var subclip = item.createSubClip(
            "${escapeForExtendScript(args.name)}",
            inTicks,
            outTicks,
            0, // hasHardBoundaries
            1, // takeVideo
            1  // takeAudio
          );
          
          if (!subclip) return __error("Failed to create subclip");
          return __result({ created: true, name: "${escapeForExtendScript(args.name)}", source: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    capture_frame: {
      description: "Capture the current frame and return it as inline image data for the LLM to see. This lets the AI visually inspect the current state of the timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds to capture. Uses current playhead if omitted.",
          },
        },
      },
      handler: async (args: { time_seconds?: number }) => {
        const tempPath = join(tmpdir(), `mcp_frame_capture_${Date.now()}.png`);
        const escapedPath = escapeForExtendScript(tempPath);

        const script = buildToolScript(`
          var outputPath = "${escapedPath}";
          var ticks = ${args.time_seconds !== undefined
            ? `__secondsToTicks(${args.time_seconds}).toString()`
            : "null"};

          var res = __exportStillFrame(outputPath, ticks);
          if (!res.ok) return __error(res.error + " [" + res.notes.join("; ") + "]");

          return __result({ exported: true, outputPath: res.path, method: res.method });
        `);

        const result = await sendCommand(script, { ...bridgeOptions, timeoutMs: 60000 });
        if (!result.success) return result;

        // __exportStillFrame already proved the file exists, but it may have landed at a
        // path other than the one we asked for (Media Encoder appends a frame number to
        // still exports), so read back the path it reports rather than the one we chose.
        const framePath = (result.data as { outputPath?: string } | undefined)?.outputPath ?? tempPath;

        if (!existsSync(framePath)) {
          return { success: false, error: "Frame export reported success but no file exists at: " + framePath };
        }

        try {
          const base64 = readFileSync(framePath).toString("base64");
          try { unlinkSync(framePath); } catch {}
          return {
            success: true,
            data: {
              captured: true,
              mimeType: "image/png",
              base64: base64,
            },
          };
        } catch (e) {
          return { success: false, error: `Failed to read captured frame: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    },

    export_omf: {
      description: "Export the active sequence as an OMF file (Open Media Framework, for audio post-production)",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.omf')",
          },
          sample_rate: {
            type: "number",
            description: "Audio sample rate (default: 48000)",
          },
          bits_per_sample: {
            type: "number",
            description: "Audio bit depth (default: 16)",
          },
          audio_encapsulated: {
            type: "boolean",
            description: "Embed audio in OMF (true) or reference external files (false). Default: true",
          },
          audio_file_format: {
            type: "number",
            description: "Audio format: 0=AIFF, 1=WAV. Default: 1",
          },
          trim_audio_files: {
            type: "boolean",
            description: "Trim audio to used range plus handles (default: true)",
          },
          handle_frames: {
            type: "number",
            description: "Handle length in frames when trimming (default: 1000)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        sample_rate?: number;
        bits_per_sample?: number;
        audio_encapsulated?: boolean;
        audio_file_format?: number;
        trim_audio_files?: boolean;
        handle_frames?: number;
      }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          app.project.exportOMF(
            seq,
            "${escapeForExtendScript(args.output_path)}",
            "OMFTitle",
            ${args.sample_rate ?? 48000},
            ${args.bits_per_sample ?? 16},
            ${args.audio_encapsulated !== false ? 1 : 0},
            ${args.audio_file_format ?? 1},
            ${args.trim_audio_files !== false ? 1 : 0},
            ${args.handle_frames ?? 1000}
          );
          
          return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}", format: "OMF" });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 120000 });
      },
    },

    encode_project_item: {
      description: "Encode a specific project item (not a sequence) using Adobe Media Encoder",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to encode",
          },
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove from queue on completion (default: true)",
          },
        },
        required: ["item_id", "output_path", "preset_path"],
      },
      handler: async (args: {
        item_id: string;
        output_path: string;
        preset_path: string;
        remove_on_completion?: boolean;
      }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          
          app.encoder.launchEncoder();
          app.encoder.encodeProjectItem(
            item,
            "${escapeForExtendScript(args.output_path)}",
            "${escapeForExtendScript(args.preset_path)}",
            app.encoder.ENCODE_IN_TO_OUT,
            ${args.remove_on_completion !== false ? 1 : 0}
          );
          app.encoder.startBatch();
          
          return __result({
            queued: true,
            item: item.name,
            outputPath: "${escapeForExtendScript(args.output_path)}"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    encode_file: {
      description: "Encode an external file (not in project) using Adobe Media Encoder",
      parameters: {
        type: "object" as const,
        properties: {
          input_path: {
            type: "string",
            description: "Full path to the input file",
          },
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
          in_seconds: {
            type: "number",
            description: "Optional start time in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Optional end time in seconds",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove from queue on completion (default: true)",
          },
        },
        required: ["input_path", "output_path", "preset_path"],
      },
      handler: async (args: {
        input_path: string;
        output_path: string;
        preset_path: string;
        in_seconds?: number;
        out_seconds?: number;
        remove_on_completion?: boolean;
      }) => {
        const inPointCode = args.in_seconds !== undefined
          ? `var srcIn = new Time(); srcIn.seconds = ${args.in_seconds};`
          : `var srcIn = undefined;`;
        const outPointCode = args.out_seconds !== undefined
          ? `var srcOut = new Time(); srcOut.seconds = ${args.out_seconds};`
          : `var srcOut = undefined;`;

        const script = buildToolScript(`
          app.encoder.launchEncoder();
          
          ${inPointCode}
          ${outPointCode}
          
          app.encoder.encodeFile(
            "${escapeForExtendScript(args.input_path)}",
            "${escapeForExtendScript(args.output_path)}",
            "${escapeForExtendScript(args.preset_path)}",
            ${args.remove_on_completion !== false ? 1 : 0},
            srcIn,
            srcOut
          );
          app.encoder.startBatch();
          
          return __result({
            queued: true,
            inputPath: "${escapeForExtendScript(args.input_path)}",
            outputPath: "${escapeForExtendScript(args.output_path)}"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    manage_proxies: {
      description:
        "Create, attach, or toggle proxies for a project item. " +
        "Note: 'create' queues a proxy encode in Adobe Media Encoder and returns immediately — " +
        "AME renders in the background. Once it finishes, call this tool again with action 'attach' " +
        "and proxy_path set to the output_path you passed here. There is no single-call create-and-attach " +
        "in Premiere's ExtendScript API.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          action: {
            type: "string",
            enum: ["create", "attach", "toggle"],
            description: "Action to perform on proxies",
          },
          proxy_path: {
            type: "string",
            description: "Path to an existing proxy file (required for 'attach')",
          },
          output_path: {
            type: "string",
            description: "Full output path for the proxy to be rendered to (required for 'create')",
          },
          preset_path: {
            type: "string",
            description:
              "Path to a proxy ingest preset (.epr) for 'create'. " +
              "If omitted, the first preset found in Premiere's IngestPresets/Proxy folder is used.",
          },
        },
        required: ["item_id", "action"],
      },
      handler: async (args: {
        item_id: string;
        action: string;
        proxy_path?: string;
        output_path?: string;
        preset_path?: string;
      }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var action = "${args.action}";

          if (action === "create") {
            ${!args.output_path
              ? `return __error("output_path is required for the 'create' action");`
              : `var outputPath = "${escapeForExtendScript(args.output_path)}";
                 ${args.preset_path
                   ? `var presetPath = "${escapeForExtendScript(args.preset_path)}";`
                   : `var presetPath = __findProxyPreset();
                      if (!presetPath) {
                        return __error("Could not locate a proxy ingest preset. Pass preset_path explicitly (an .epr under Premiere's Settings/IngestPresets/Proxy folder).");
                      }`}

                 // ProjectItem has no createProxy(). Proxy generation must go through
                 // Adobe Media Encoder; the result is attached in a separate step once
                 // AME has finished writing the file.
                 app.encoder.launchEncoder();
                 app.encoder.encodeProjectItem(item, outputPath, presetPath, app.encoder.ENCODE_ENTIRE, 1);
                 app.encoder.startBatch();

                 return __result({
                   action: "create",
                   item: item.name,
                   queued: true,
                   outputPath: outputPath,
                   presetUsed: presetPath,
                   nextStep: "Wait for Adobe Media Encoder to finish, then call manage_proxies with action 'attach' and proxy_path set to outputPath."
                 });`
            }
          } else if (action === "attach") {
            ${args.proxy_path
              ? `var attachPath = "${escapeForExtendScript(args.proxy_path)}";
                 if (!new File(attachPath).exists) return __error("Proxy file does not exist: " + attachPath);
                 var attached = item.attachProxy(attachPath, 0);
                 if (!attached) return __error("attachProxy() failed for: " + attachPath);
                 return __result({ action: "attach", item: item.name, proxyPath: attachPath, attached: true });`
              : `return __error("proxy_path is required for attach action");`
            }
          } else if (action === "toggle") {
            var enabled = !app.project.isProxyEnabled();
            app.project.setProxyEnabled(enabled);
            return __result({ action: "toggle", proxiesEnabled: enabled });
          }

          return __error("Unknown proxy action: " + action);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
