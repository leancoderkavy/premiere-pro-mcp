import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getMetadataTools(bridgeOptions: BridgeOptions) {
  return {
    get_metadata: {
      description: "Get metadata for a project item",
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
          
          var metadata = {};
          try {
            var xmpBlob = item.getProjectMetadata();
            metadata.projectMetadata = xmpBlob;
          } catch(e) {}
          
          try {
            var xmpBlob2 = item.getXMPMetadata();
            metadata.xmpMetadata = xmpBlob2;
          } catch(e) {}
          
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
      description: "Set raw XMP metadata on a project item (provide complete XMP XML string)",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          xmp_xml: {
            type: "string",
            description: "Complete XMP metadata XML string to set",
          },
        },
        required: ["item_id", "xmp_xml"],
      },
      handler: async (args: { item_id: string; xmp_xml: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          item.setXMPMetadata("${escapeForExtendScript(args.xmp_xml)}");
          return __result({ updated: true, item: item.name });
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
