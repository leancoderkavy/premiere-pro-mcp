import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Capability, CapabilityConfig } from "./security/capabilities.js";
import {
  buildToolCapabilityReport,
  type CatalogToolDefinition,
} from "./tool-capability-report.js";
import type { ToolPackReport } from "./workflows/tool-packs.js";

export const SUPPORTED_HOST_PLATFORMS = ["darwin", "win32"] as const;
const ALL_CAPABILITIES: Capability[] = ["inspect", "edit", "export", "filesystem", "unsafe-script"];
const require = createRequire(import.meta.url);
const adobeUxpCoverage: unknown = require("./resources/adobe-uxp-coverage.json");

export type SupportedHostPlatform = (typeof SUPPORTED_HOST_PLATFORMS)[number];
export type AdobeUxpCoverageAvailability = "current" | "planned";
export type AdobeUxpCoverageImplementationStatus = "implemented" | "planned";
export type AdobeUxpCoverageVerificationStatus =
  | "automated_contract_verified"
  | "committed_unverified"
  | "not_started";
export type AdobeUxpCoverageLiveHostVerificationStatus = "not_run" | "verified";

export interface AdobeUxpCoverageEntry {
  id: string;
  adobeApi: string[];
  documentationUrls: string[];
  minimumPremiereVersion: string;
  backend: "uxp";
  uxpCommand: string | null;
  mcpTools: string[];
  availability: AdobeUxpCoverageAvailability;
  implementationStatus: AdobeUxpCoverageImplementationStatus;
  verificationStatus: AdobeUxpCoverageVerificationStatus;
  liveHostVerificationStatus: AdobeUxpCoverageLiveHostVerificationStatus;
  mutatesProject: boolean;
  undoable: boolean;
  idempotency: "operation_id" | "operation_id_when_supported" | "not_applicable";
  verificationBoundary: string;
}

export interface AdobeUxpCoverageManifest {
  schemaVersion: 1;
  source: {
    apiPackage: "@adobe/premierepro";
    apiVersion: string;
    changelogUrl: string;
  };
  entries: AdobeUxpCoverageEntry[];
}

export interface AdobeUxpCoverageReport extends AdobeUxpCoverageManifest {
  summary: {
    total: number;
    current: number;
    planned: number;
    implemented: number;
    committedUnverified: number;
    automatedContractVerified: number;
    liveHostVerified: number;
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function validateDocumentationUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.hostname !== "developer.adobe.com" || !url.pathname.startsWith("/premiere-pro/uxp/")) {
    throw new Error(`${label} must point to the official Premiere Pro UXP documentation`);
  }
}

function validateAdobeUxpCoverageManifest(value: unknown): AdobeUxpCoverageManifest {
  const manifest = asRecord(value, "Adobe UXP coverage manifest");
  if (manifest.schemaVersion !== 1) throw new Error("Adobe UXP coverage manifest schemaVersion must be 1");

  const source = asRecord(manifest.source, "Adobe UXP coverage manifest source");
  if (source.apiPackage !== "@adobe/premierepro") {
    throw new Error("Adobe UXP coverage manifest must identify @adobe/premierepro as its source package");
  }
  const apiVersion = stringValue(source.apiVersion, "Adobe UXP coverage manifest source.apiVersion");
  const changelogUrl = stringValue(source.changelogUrl, "Adobe UXP coverage manifest source.changelogUrl");
  validateDocumentationUrl(changelogUrl, "Adobe UXP coverage manifest source.changelogUrl");

  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("Adobe UXP coverage manifest entries must be a non-empty array");
  }
  const ids = new Set<string>();
  const entries = manifest.entries.map((rawEntry, index): AdobeUxpCoverageEntry => {
    const label = `Adobe UXP coverage manifest entry ${index}`;
    const entry = asRecord(rawEntry, label);
    const id = stringValue(entry.id, `${label}.id`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) {
      throw new Error(`${label}.id must be a unique kebab-case identifier`);
    }
    ids.add(id);
    const documentationUrls = stringArray(entry.documentationUrls, `${label}.documentationUrls`);
    documentationUrls.forEach((url) => validateDocumentationUrl(url, `${label}.documentationUrls`));
    const availability = entry.availability;
    if (availability !== "current" && availability !== "planned") {
      throw new Error(`${label}.availability must be current or planned`);
    }
    const implementationStatus = entry.implementationStatus;
    if (implementationStatus !== "implemented" && implementationStatus !== "planned") {
      throw new Error(`${label}.implementationStatus must be implemented or planned`);
    }
    const verificationStatus = entry.verificationStatus;
    if (
      verificationStatus !== "automated_contract_verified"
      && verificationStatus !== "committed_unverified"
      && verificationStatus !== "not_started"
    ) {
      throw new Error(`${label}.verificationStatus is not supported`);
    }
    const liveHostVerificationStatus = entry.liveHostVerificationStatus;
    if (liveHostVerificationStatus !== "not_run" && liveHostVerificationStatus !== "verified") {
      throw new Error(`${label}.liveHostVerificationStatus is not supported`);
    }
    const idempotency = entry.idempotency;
    if (idempotency !== "operation_id" && idempotency !== "operation_id_when_supported" && idempotency !== "not_applicable") {
      throw new Error(`${label}.idempotency is not supported`);
    }
    if (entry.backend !== "uxp") throw new Error(`${label}.backend must be uxp`);
    if (entry.uxpCommand !== null && typeof entry.uxpCommand !== "string") {
      throw new Error(`${label}.uxpCommand must be a string or null`);
    }
    if (typeof entry.mutatesProject !== "boolean" || typeof entry.undoable !== "boolean") {
      throw new Error(`${label} mutation metadata must be boolean`);
    }
    return {
      id,
      adobeApi: stringArray(entry.adobeApi, `${label}.adobeApi`),
      documentationUrls,
      minimumPremiereVersion: stringValue(entry.minimumPremiereVersion, `${label}.minimumPremiereVersion`),
      backend: "uxp",
      uxpCommand: entry.uxpCommand,
      mcpTools: stringArray(entry.mcpTools, `${label}.mcpTools`),
      availability,
      implementationStatus,
      verificationStatus,
      liveHostVerificationStatus,
      mutatesProject: entry.mutatesProject,
      undoable: entry.undoable,
      idempotency,
      verificationBoundary: stringValue(entry.verificationBoundary, `${label}.verificationBoundary`),
    };
  });

  return {
    schemaVersion: 1,
    source: {
      apiPackage: "@adobe/premierepro",
      apiVersion,
      changelogUrl,
    },
    entries,
  };
}

export const ADOBE_UXP_COVERAGE_MANIFEST = validateAdobeUxpCoverageManifest(adobeUxpCoverage);

export function buildAdobeUxpCoverageReport(): AdobeUxpCoverageReport {
  const entries = ADOBE_UXP_COVERAGE_MANIFEST.entries.map((entry) => ({
    ...entry,
    adobeApi: [...entry.adobeApi],
    documentationUrls: [...entry.documentationUrls],
    mcpTools: [...entry.mcpTools],
  }));
  return {
    schemaVersion: ADOBE_UXP_COVERAGE_MANIFEST.schemaVersion,
    source: { ...ADOBE_UXP_COVERAGE_MANIFEST.source },
    entries,
    summary: {
      total: entries.length,
      current: entries.filter((entry) => entry.availability === "current").length,
      planned: entries.filter((entry) => entry.availability === "planned").length,
      implemented: entries.filter((entry) => entry.implementationStatus === "implemented").length,
      committedUnverified: entries.filter((entry) => entry.verificationStatus === "committed_unverified").length,
      automatedContractVerified: entries.filter((entry) => entry.verificationStatus === "automated_contract_verified").length,
      liveHostVerified: entries.filter((entry) => entry.liveHostVerificationStatus === "verified").length,
    },
  };
}

export function platformName(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  return platform;
}

export function buildPlatformCapabilityReport(
  capabilities: CapabilityConfig,
  platform: NodeJS.Platform = process.platform,
  tempDirectory: string = join(tmpdir(), "premiere-mcp-bridge"),
  toolCatalog: Record<string, CatalogToolDefinition> = {},
  toolPacks?: ToolPackReport,
) {
  const supported = SUPPORTED_HOST_PLATFORMS.includes(platform as SupportedHostPlatform);
  return {
    schemaVersion: 1,
    mcp: {
      sdk: {
        generation: 2,
        packages: [
          "@modelcontextprotocol/server",
          "@modelcontextprotocol/client",
          "@modelcontextprotocol/node",
        ],
      },
      protocol: {
        modernRevision: "2026-07-28",
        legacyRevisions: "2024-10-07 through 2025-11-25",
        dualEra: true,
      },
      features: {
        statelessRequests: "supported",
        serverDiscovery: "supported",
        requestMetadataEnvelope: "supported",
        headerBasedRouting: "supported",
        deterministicCacheableLists: "supported",
        resultTypeDiscriminator: "supported",
        cancellation: "supported_by_protocol_host_limited",
        progressNotifications: "protocol_supported_not_emitted",
        traceContext: "transport_passthrough",
        jsonSchema202012: "supported",
        cursorPagination: "supported_single_page_catalogs",
        resourceTemplates: "not_exposed_no_parameterized_resource_family",
        completions: "not_exposed_no_bounded_completion_domain",
        embeddedResourcesAndLinks: "supported_selective_use",
        multiRoundTripRequests: "sdk_supported_no_current_workflow",
        subscriptionsListen: "supported",
        extensionCapabilities: "supported",
        tasksExtension: "not_implemented",
        mcpAppsExtension: "not_implemented",
        skillsOverMcp: "experimental_not_advertised",
        serverCard: "experimental_not_advertised",
        oauthClientMetadataDocuments: "external_authorization_boundary",
        deprecatedSamplingRootsLogging: "not_advertised",
      },
      cachePolicy: {
        toolsList: { ttlMs: 30_000, cacheScope: "private" },
        promptsList: { ttlMs: 300_000, cacheScope: "public" },
        resourcesList: { ttlMs: 60_000, cacheScope: "private" },
        resourcesRead: { ttlMs: 0, cacheScope: "private" },
      },
    },
    runtime: {
      platform,
      platformName: platformName(platform),
      supported,
      tempDirectory,
      nodeVersion: process.version,
    },
    premiere: {
      supportedVersions: "2020–2026",
      hostVerificationRequired: true,
      note: supported
        ? "Static compatibility is supported; call ping with Premiere Pro running to verify the current host session."
        : "The MCP server can run here, but the Adobe Premiere Pro bridge and installer are supported only on macOS and Windows.",
    },
    backends: {
      cep: {
        status: "production",
        platforms: ["macOS", "Windows"],
        premiereVersions: "2020–2026",
        transport: "local file bridge",
        capabilities: ALL_CAPABILITIES,
        delivery: {
          interchange: ["FCP XML export", "AAF export", "OMF export"],
          presetValidation: true,
          postExportChecksum: ["sha256", "sha512"],
          unsupported: {
            otio: "No documented Premiere ExtendScript or UXP OTIO import/export API.",
            edl: "No documented Premiere ExtendScript or UXP EDL import/export API.",
            cloudPublish: "No documented Premiere automation API for publishing to cloud destinations.",
            contentCredentials: "No documented Premiere automation API for configuring Content Credentials.",
            renderAndReplace: "No documented Premiere ExtendScript or UXP Render and Replace API.",
          },
        },
      },
      uxp: {
        status: "preview",
        platforms: ["macOS", "Windows"],
        premiereVersions: "25.6+",
        transport: "loopback WebSocket",
        apiCoverage: buildAdobeUxpCoverageReport(),
        commands: [
          "capabilities.get",
          "state.get",
          "operation.cancel",
          "frame.export",
          "sequence.playhead.inspect",
          "sequence.playhead.set",
          "sequence.timing.inspect",
          "timeline.selection.lift",
          "transition.video.list",
          "transition.video.inspect",
          "transition.video.add",
          "transition.video.remove",
          "transcript.export",
          "transcript.search",
          "transcript.has",
          "transcript.import",
          "captions.inspect",
          "effects.catalog",
          "effects.chain.get",
          "trackItem.identity.inspect",
          "effects.chain.add",
          "effects.chain.remove",
          "selection.inspect",
          "selection.fingerprints.inspect",
          "selection.targets.inspect",
          "selection.update",
          "effects.selection.add",
          "effects.selection.remove",
          "sceneEdit.detect",
          "proxy.inspect",
          "proxy.attach",
          "ingest.get",
          "ingest.configure",
          "media.relink",
          "metadata.get",
          "metadata.update",
          "color.preflight",
          "environment.inspect",
          "footage.conform",
          "sourceMonitor.state",
          "sourceMonitor.open",
          "sourceMonitor.play",
          "sourceMonitor.close",
          "storage.preflight",
          "scratch.configure",
          "workspace.status",
          "projectSelection.views",
          "projectSelection.inspect",
          "markers.inspect",
          "markers.add",
          "markers.addBeatGrid",
          "markers.update",
          "markers.remove",
          "markers.removeMany",
          "bins.inspect",
          "bins.create",
          "bins.createSmart",
          "bins.rename",
          "bins.move",
          "bins.color",
          "bins.remove",
          "sequenceSettings.get",
          "sequenceSettings.update",
          "project.import",
          "parameters.inspect",
          "parameters.set",
          "parameters.keyframeAdd",
          "parameters.keyframeRemove",
          "parameters.keyframeRemoveRange",
          "parameters.keyframeInterpolation",
          "trackItem.inspect",
          "trackItem.update",
          "timeline.insert",
          "timeline.overwrite",
          "timeline.cloneSelection",
          "timeline.removeSelection",
          "timeline.mogrtPath",
          "timeline.mogrtLibrary",
          "sequences.inspect",
          "sequences.createFromMedia",
          "silence.deriveSequence",
          "sequences.clone",
          "sequences.subsequence",
          "sequences.activate",
          "sequences.open",
          "sequences.close",
          "sequences.delete",
          "encoder.preflight",
          "encoder.sequence",
          "encoder.projectItem",
          "encoder.file",
        ],
        unsupportedCommands: {
          "captions.create": "No documented Premiere UXP caption creation API.",
          "captions.update": "No documented Premiere UXP caption text/timing mutation API.",
          "captions.delete": "No documented Premiere UXP caption deletion API.",
        },
        events: [
          "premiere.state.changed",
          "premiere.operation.started",
          "premiere.operation.progress",
          "premiere.operation.completed",
          "premiere.operation.failed",
          "premiere.operation.cancelled",
        ],
        operationSemantics: {
          cancellation: "cooperative preflight only",
          atomicRollback: false,
          undo: "only action-based mutations executed through Project.executeTransaction",
        },
        hostVerificationRequired: true,
      },
    },
    authority: {
      source: capabilities.source,
      enabled: [...capabilities.capabilities].sort(),
      disabled: ALL_CAPABILITIES.filter((capability) => !capabilities.capabilities.has(capability)),
    },
    ...(toolPacks === undefined ? {} : { toolPacks }),
    tools: buildToolCapabilityReport(toolCatalog, capabilities),
  };
}
