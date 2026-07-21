import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Capability, CapabilityConfig } from "./security/capabilities.js";

export const SUPPORTED_HOST_PLATFORMS = ["darwin", "win32"] as const;
const ALL_CAPABILITIES: Capability[] = ["inspect", "edit", "export", "filesystem", "unsafe-script"];

export type SupportedHostPlatform = (typeof SUPPORTED_HOST_PLATFORMS)[number];

export function platformName(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  return platform;
}

export function buildPlatformCapabilityReport(
  capabilities: CapabilityConfig,
  platform: NodeJS.Platform = process.platform,
  tempDirectory: string = join(tmpdir(), "premiere-mcp-bridge"),
) {
  const supported = SUPPORTED_HOST_PLATFORMS.includes(platform as SupportedHostPlatform);
  return {
    schemaVersion: 1,
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
      },
      uxp: {
        status: "preview",
        platforms: ["macOS", "Windows"],
        premiereVersions: "25.6+",
        transport: "loopback WebSocket",
        commands: ["capabilities.get", "state.get", "frame.export"],
        hostVerificationRequired: true,
      },
    },
    authority: {
      source: capabilities.source,
      enabled: [...capabilities.capabilities].sort(),
      disabled: ALL_CAPABILITIES.filter((capability) => !capabilities.capabilities.has(capability)),
    },
  };
}
