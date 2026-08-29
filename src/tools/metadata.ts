import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getMetadataTools(bridgeOptions: BridgeOptions) {
  return {
    get_metadata: {
      description: "Get metadata for a project item. Disable either XML payload when a bounded identity/path response is sufficient.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          include_project_metadata: {
            type: "boolean",
            description: "Include the potentially large Project Metadata XML payload (default: true). Set false for a bounded identity/path response.",
          },
          include_xmp_metadata: {
            type: "boolean",
            description: "Include the potentially large XMP XML payload (default: true). Set false for a bounded identity/path response.",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; include_project_metadata?: boolean; include_xmp_metadata?: boolean }) => {
        const includeProjectMetadata = args.include_project_metadata !== false;
        const includeXmpMetadata = args.include_xmp_metadata !== false;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var metadata = {};
          ${includeProjectMetadata ? `try {
            var xmpBlob = item.getProjectMetadata();
            metadata.projectMetadata = xmpBlob;
          } catch(e) {}` : ""}
          
          ${includeXmpMetadata ? `try {
            var xmpBlob2 = item.getXMPMetadata();
            metadata.xmpMetadata = xmpBlob2;
          } catch(e) {}` : ""}
          
          metadata.name = item.name;
          metadata.nodeId = item.nodeId;
          
          try {
            metadata.mediaPath = item.getMediaPath();
          } catch(e) {}
          
          return __result(metadata);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_metadata: {
      description:
        "Replace project metadata XML on a project item and verify the exact readback. Partial field/value writes are intentionally rejected because Premiere requires a complete Project Metadata XML payload.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          field_name: {
            type: "string",
            description:
              "Legacy partial-write argument. It is no longer executed because it cannot form a valid Project Metadata XML payload; use metadata_xml and updated_fields instead.",
          },
          value: {
            type: "string",
            description:
              "Legacy partial-write argument. It is no longer executed; read projectMetadata first, update the complete XML, then supply metadata_xml and updated_fields.",
          },
          metadata_xml: {
            type: "string",
            description:
              "Complete Project Metadata XML previously read from get_metadata, with the intended field values applied.",
          },
          updated_fields: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description:
              "Exact Project Metadata field paths changed in metadata_xml (for example, Column.Intrinsic.Description).",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        field_name?: string;
        value?: string;
        metadata_xml?: string;
        updated_fields?: string[];
      }) => {
        if (!args.metadata_xml || !args.metadata_xml.trim()) {
          return {
            success: false,
            error:
              "set_metadata no longer accepts partial field_name/value writes because Premiere does not persist that form reliably. Call get_metadata, modify its complete projectMetadata XML, then pass metadata_xml with updated_fields; or use manage_metadata_uxp when the authenticated UXP bridge is connected.",
          };
        }
        if (!Array.isArray(args.updated_fields) || args.updated_fields.length === 0 ||
          args.updated_fields.some((field) => typeof field !== "string" || !field.trim())) {
          return {
            success: false,
            error: "updated_fields must contain one or more non-empty Project Metadata field paths.",
          };
        }
        const updatedFields = JSON.stringify(args.updated_fields);
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var requestedMetadata = "${escapeForExtendScript(args.metadata_xml)}";
          var updatedFields = ${updatedFields};
          var accepted = item.setProjectMetadata(requestedMetadata, updatedFields);
          if (accepted === false) return __error("Premiere rejected the project metadata update");

          var readback = item.getProjectMetadata();
          if (String(readback) !== requestedMetadata) {
            return __error(
              "Premiere did not return the requested Project Metadata XML after the write. " +
              "The update is not reported as successful; inspect get_metadata before retrying."
            );
          }

          return __result({ updated: true, verified: true, item: item.name, updatedFields: updatedFields });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_color_label: {
      description: "Set the color label on a project item or clip",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          color_index: {
            type: "number",
            description: "Label color index (0=Violet, 1=Iris, 2=Caribbean, 3=Lavender, 4=Cerulean, 5=Forest, 6=Rose, 7=Mango, 8=Purple, 9=Blue, 10=Teal, 11=Magenta, 12=Tan, 13=Green, 14=Brown, 15=Yellow)",
          },
        },
        required: ["item_id", "color_index"],
      },
      handler: async (args: { item_id: string; color_index: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          item.setColorLabel(${args.color_index});
          return __result({ updated: true, item: item.name, colorIndex: ${args.color_index} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_color_label: {
      description: "Get the color label of a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var colorIndex = item.getColorLabel();
          return __result({ item: item.name, colorIndex: colorIndex });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_footage_interpretation: {
      description: "Get footage interpretation settings for a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var interp = item.getFootageInterpretation();
          if (!interp) return __error("No footage interpretation available");
          
          return __result({
            item: item.name,
            alphaUsage: interp.alphaUsage,
            fieldType: interp.fieldType,
            frameRate: interp.frameRate,
            ignoreAlpha: interp.ignoreAlpha,
            invertAlpha: interp.invertAlpha,
            pixelAspectRatio: interp.pixelAspectRatio
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_footage_interpretation: {
      description: "Set footage interpretation settings for a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          frame_rate: {
            type: "number",
            description: "Override frame rate",
          },
          pixel_aspect_ratio: {
            type: "number",
            description: "Pixel aspect ratio (1.0 = square pixels)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; frame_rate?: number; pixel_aspect_ratio?: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var interp = item.getFootageInterpretation();
          if (!interp) return __error("No footage interpretation available");
          
          ${args.frame_rate !== undefined ? `interp.frameRate = ${args.frame_rate};` : ""}
          ${args.pixel_aspect_ratio !== undefined ? `interp.pixelAspectRatio = ${args.pixel_aspect_ratio};` : ""}
          
          item.setFootageInterpretation(interp);
          return __result({ updated: true, item: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
    get_xmp_metadata: {
      description: "Get the raw XMP metadata for a project item (includes EXIF, IPTC, Dublin Core, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var xmp = item.getXMPMetadata();
          return __result({ item: item.name, xmpMetadata: xmp });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_xmp_metadata: {
      description:
        "Merge a raw XMP XML patch into a project item's existing XMP metadata without removing unrelated fields.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          xmp_xml: {
            type: "string",
            description: "Well-formed XMP XML containing only the fields to add or replace",
          },
        },
        required: ["item_id", "xmp_xml"],
      },
      handler: async (args: { item_id: string; xmp_xml: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          try {
            if (ExternalObject.AdobeXMPScript === undefined) {
              ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
            }
          } catch (e) {
            return __error("Premiere could not load the Adobe XMP library; no metadata was changed: " + e.toString());
          }
          if (typeof XMPMeta !== "function" || typeof XMPUtils === "undefined" || typeof XMPUtils.appendProperties !== "function") {
            return __error("Premiere's XMP merge APIs are unavailable; no metadata was changed.");
          }

          try {
            var existingPacket = String(item.getXMPMetadata() || "");
            if (!existingPacket) return __error("The project item has no readable XMP packet; no metadata was changed.");
            var existingXmp = new XMPMeta(existingPacket);
            var patchXmp = new XMPMeta("${escapeForExtendScript(args.xmp_xml)}");
            // Copy every supplied top-level field into the existing packet, replacing
            // only fields named by the patch and retaining unrelated metadata.
            XMPUtils.appendProperties(patchXmp, existingXmp, true, true, false);
            item.setXMPMetadata(existingXmp.serialize());

            // Reparse the host readback so a malformed or rejected packet never
            // reports success. Exact serialized XML formatting is host-dependent.
            var writtenPacket = String(item.getXMPMetadata() || "");
            if (!writtenPacket) return __error("Premiere wrote no readable XMP packet; inspect the item before retrying.");
            new XMPMeta(writtenPacket);
            return __result({
              updated: true,
              merged: true,
              item: item.name,
              verification: "readback_xmp_packet_reparsed"
            });
          } catch (e) {
            return __error("Premiere could not merge XMP metadata; no success is reported: " + e.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_color_space: {
      description: "Get the color space information for a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var info = { item: item.name };
          try { info.colorSpace = item.getColorSpace(); } catch(e) { info.colorSpace = "unknown"; }
          try { info.originalColorSpace = item.getOriginalColorSpace(); } catch(e) {}
          try { info.embeddedLUT = item.getEmbeddedLUTID(); } catch(e) {}
          try { info.inputLUT = item.getInputLUTID(); } catch(e) {}
          
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
