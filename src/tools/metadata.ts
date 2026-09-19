import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

const CEP_XMP_FIELD_HELPERS = `
          function __loadAdobeXmp() {
            try {
              if (ExternalObject.AdobeXMPScript === undefined) {
                ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
              }
            } catch (eLoad) {
              return "Premiere could not load the Adobe XMP library: " + eLoad.toString();
            }
            if (typeof XMPMeta !== "function") return "Premiere's XMPMeta API is unavailable";
            return "";
          }
          function __xmpNamespace(alias, packet) {
            var aliases = {
              premiere: "http://ns.adobe.com/premierePrivateProjectMetaData/1.0/",
              project: "http://ns.adobe.com/premierePrivateProjectMetaData/1.0/",
              dc: "http://purl.org/dc/elements/1.1/",
              xmp: "http://ns.adobe.com/xap/1.0/",
              xmpDM: "http://ns.adobe.com/xmp/1.0/DynamicMedia/",
              xmpMM: "http://ns.adobe.com/xap/1.0/mm/",
              photoshop: "http://ns.adobe.com/photoshop/1.0/",
              exif: "http://ns.adobe.com/exif/1.0/",
              iptc: "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
            };
            if (!alias) return packet === "project" ? aliases.premiere : "";
            if (aliases[alias]) return aliases[alias];
            return String(alias);
          }
          function __xmpPropertyString(prop) {
            if (prop == null) return "";
            if (typeof prop === "string" || typeof prop === "number" || typeof prop === "boolean") return String(prop);
            if (typeof prop.value !== "undefined" && prop.value != null) return String(prop.value);
            return String(prop);
          }
          function __xmpIsSensitive(ns, name) {
            var compact = (String(ns || "") + String(name || "")).toLowerCase().replace(/[^a-z0-9]/g, "");
            return compact.indexOf("gps") !== -1 || compact.indexOf("serialnumber") !== -1
              || compact.indexOf("lensserial") !== -1 || compact.indexOf("bodyserial") !== -1
              || compact.indexOf("cameraserial") !== -1;
          }
          function __collectXmpFields(packet, packetName, includeSensitive, fields) {
            if (!packet) return 0;
            var omitted = 0;
            try {
              var meta = new XMPMeta(packet);
              var options = 0;
              try {
                if (typeof XMPConst !== "undefined" && XMPConst.ITERATOR_JUST_LEAFNODES) {
                  options = XMPConst.ITERATOR_JUST_LEAFNODES;
                }
              } catch (eOpt) {}
              var iter = meta.iterator(options, "", "");
              var item = iter.next();
              while (item && fields.length < 256) {
                var ns = String(item.namespace || "");
                var name = String(item.path || item.name || "");
                if (name && name !== "rdf:type") {
                  if (__xmpIsSensitive(ns, name) && !includeSensitive) {
                    fields.push({ packet: packetName, namespace: ns, name: name, omitted: "sensitive" });
                    omitted += 1;
                  } else {
                    var value = __xmpPropertyString(item.value);
                    if (value.length > 4096) value = value.substring(0, 4096);
                    fields.push({ packet: packetName, namespace: ns, name: name, value: value });
                  }
                }
                item = iter.next();
              }
            } catch (eCollect) {}
            return omitted;
          }
`;

export function getMetadataTools(bridgeOptions: BridgeOptions) {
  return {
    get_metadata: {
      description: "Get metadata for a project item. Use parse_fields to return named XMP/project fields instead of raw XML. Project metadata XML and file/clip XMP are separate packets; disable either when identity/path is enough. Prefer inspect_project_panel_metadata_uxp item_columns or manage_metadata_uxp inspect_fields for visible columns. This is not the premiere://project/metadata resource. GPS and serials are omitted from parse_fields unless include_sensitive is true.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          parse_fields: {
            type: "boolean",
            description: "Parse project metadata and XMP into named fields (default false). When true, raw XML is omitted unless include_project_metadata or include_xmp_metadata is explicitly true.",
          },
          include_sensitive: {
            type: "boolean",
            description: "When parse_fields is true, include GPS, serials, and similar EXIF. Default false.",
          },
          include_project_metadata: {
            type: "boolean",
            description: "Include the potentially large Project Metadata XML payload (default: true unless parse_fields is true).",
          },
          include_xmp_metadata: {
            type: "boolean",
            description: "Include the potentially large XMP XML payload (default: true unless parse_fields is true).",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        parse_fields?: boolean;
        include_sensitive?: boolean;
        include_project_metadata?: boolean;
        include_xmp_metadata?: boolean;
      }) => {
        const parseFields = args.parse_fields === true;
        const includeProjectMetadata = parseFields
          ? args.include_project_metadata === true
          : args.include_project_metadata !== false;
        const includeXmpMetadata = parseFields
          ? args.include_xmp_metadata === true
          : args.include_xmp_metadata !== false;
        const includeSensitive = args.include_sensitive === true;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var metadata = {};
          ${parseFields ? `${CEP_XMP_FIELD_HELPERS}
          var loadError = __loadAdobeXmp();
          if (loadError) return __error(loadError);
          var fields = [];
          var omittedSensitiveCount = 0;
          var projectPacket = "";
          var xmpPacket = "";
          try { projectPacket = String(item.getProjectMetadata() || ""); } catch (eProject) {}
          try { xmpPacket = String(item.getXMPMetadata() || ""); } catch (eXmp) {}
          omittedSensitiveCount += __collectXmpFields(projectPacket, "project", ${includeSensitive ? "true" : "false"}, fields);
          omittedSensitiveCount += __collectXmpFields(xmpPacket, "xmp", ${includeSensitive ? "true" : "false"}, fields);
          metadata.parse_fields = true;
          metadata.fields = fields;
          metadata.omittedSensitiveCount = omittedSensitiveCount;
          ${includeProjectMetadata ? "metadata.projectMetadata = projectPacket;" : ""}
          ${includeXmpMetadata ? "metadata.xmpMetadata = xmpPacket;" : ""}` : `
          ${includeProjectMetadata ? `try {
            var xmpBlob = item.getProjectMetadata();
            metadata.projectMetadata = xmpBlob;
          } catch(e) {}` : ""}
          ${includeXmpMetadata ? `try {
            var xmpBlob2 = item.getXMPMetadata();
            metadata.xmpMetadata = xmpBlob2;
          } catch(e) {}` : ""}`}

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
        "Update project metadata on a project item. Supply complete metadata_xml plus updated_fields, or field_name and value to read-modify-write one XMP/project property through AdobeXMPScript with field readback.",
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
              "Named field to update (for example Column.Intrinsic.LogNote). Used with value; cannot be combined with metadata_xml.",
          },
          value: {
            type: "string",
            description: "Replacement value for field_name. Maximum 4096 characters.",
          },
          packet: {
            type: "string",
            enum: ["project", "xmp"],
            description: "Packet for field_name writes. Default project (Premiere-private metadata).",
          },
          field_namespace: {
            type: "string",
            description: "XMP namespace URI or alias (premiere, dc, xmp, exif). Default premiere for project packet; required for xmp.",
          },
          expected_value: {
            type: "string",
            description: "Optional compare-and-set guard for field_name writes.",
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
        packet?: string;
        field_namespace?: string;
        expected_value?: string;
        metadata_xml?: string;
        updated_fields?: string[];
      }) => {
        const hasXml = Boolean(args.metadata_xml && args.metadata_xml.trim());
        const hasField = Boolean(args.field_name && args.field_name.trim());
        const hasValue = args.value !== undefined;
        if (hasXml && (hasField || hasValue)) {
          return {
            success: false,
            error: "set_metadata cannot combine metadata_xml with field_name/value. Use one write form.",
          };
        }
        if (hasField !== hasValue) {
          return {
            success: false,
            error: "field_name and value must be supplied together.",
          };
        }
        if (hasField) {
          if (args.value !== undefined && args.value.length > 4096) {
            return { success: false, error: "value must be at most 4096 characters." };
          }
          const packet = args.packet ?? "project";
          if (packet !== "project" && packet !== "xmp") {
            return { success: false, error: "packet must be project or xmp." };
          }
          if (packet === "xmp" && !(args.field_namespace && args.field_namespace.trim())) {
            return { success: false, error: "field_namespace is required for xmp packet updates." };
          }
          const expectedLiteral = args.expected_value === undefined
            ? "null"
            : `"${escapeForExtendScript(args.expected_value)}"`;
          const namespaceLiteral = args.field_namespace
            ? `"${escapeForExtendScript(args.field_namespace)}"`
            : "\"\"";
          const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          ${CEP_XMP_FIELD_HELPERS}
          var loadError = __loadAdobeXmp();
          if (loadError) return __error(loadError);
          var packet = "${escapeForExtendScript(packet)}";
          var name = "${escapeForExtendScript(args.field_name!)}";
          var requestedValue = "${escapeForExtendScript(args.value ?? "")}";
          var expectedValue = ${expectedLiteral};
          var ns = __xmpNamespace(${namespaceLiteral}, packet);
          if (!ns) return __error("field_namespace is required for xmp packet updates");
          var packetXml = "";
          try {
            packetXml = String(packet === "xmp" ? item.getXMPMetadata() : item.getProjectMetadata() || "");
          } catch (eRead) {
            return __error("The project item has no readable metadata packet: " + eRead.toString());
          }
          var meta = new XMPMeta(packetXml || "");
          var current = __xmpPropertyString(meta.getProperty(ns, name));
          if (expectedValue !== null && current !== expectedValue) {
            return __error("The field value changed before it was updated; inspect and retry.");
          }
          meta.setProperty(ns, name, requestedValue);
          var serialized = String(meta.serialize() || "");
          ${packet === "xmp" ? `item.setXMPMetadata(serialized);` : `var accepted = item.setProjectMetadata(serialized, [name]);
          if (accepted === false) return __error("Premiere rejected the project metadata update");`}
          var writtenXml = "";
          try {
            writtenXml = String(${packet === "xmp" ? "item.getXMPMetadata()" : "item.getProjectMetadata()"} || "");
          } catch (eWritten) {
            return __error("Premiere wrote no readable metadata packet: " + eWritten.toString());
          }
          var readback = __xmpPropertyString(new XMPMeta(writtenXml || "").getProperty(ns, name));
          if (readback !== requestedValue) {
            return __error("Premiere did not return the requested field value after the write. Inspect get_metadata before retrying.");
          }
          return __result({
            updated: true,
            verified: true,
            item: item.name,
            packet: packet,
            fieldName: name,
            value: readback,
            verification: "field_value_readback"
          });
          `);
          return sendCommand(script, bridgeOptions);
        }
        if (!hasXml) {
          return {
            success: false,
            error:
              "set_metadata requires metadata_xml with updated_fields, or field_name and value for a single-field XMP/project write.",
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

          var requestedMetadata = "${escapeForExtendScript(args.metadata_xml!)}";
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
      description: "Get the raw file/clip XMP packet for a project item (Dublin Core, EXIF, IPTC, xmpDM, and other namespaces). Distinct from Premiere-private project metadata. Omit GPS and camera serials from user-facing reports unless requested.",
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
