import path from "node:path";

export const CLIENT_CONFIG_TARGETS = ["claude", "cursor", "vscode", "codex"] as const;
export type ClientConfigTarget = typeof CLIENT_CONFIG_TARGETS[number];

const usage = "Usage: premiere-pro-mcp --print-client-config <claude|cursor|vscode|codex>. Use this action alone.";

/** Resolve this action before any installer, update, or server startup branch. */
export function parseClientConfigAction(args: string[]): ClientConfigTarget | undefined {
  if (!args.some((arg) => arg === "--print-client-config" || arg.startsWith("--print-client-config="))) return undefined;
  if (args.length !== 2 || args[0] !== "--print-client-config" ||
      !CLIENT_CONFIG_TARGETS.includes(args[1] as ClientConfigTarget)) {
    throw new Error(usage);
  }
  return args[1] as ClientConfigTarget;
}

/**
 * Print a mergeable entry for this installed copy, bypassing the shared global
 * command name. No file/config inspection, environment copying, or host contact.
 * Paths are intentionally local and must not be included in public diagnostics.
 */
export function renderClientConfig(
  target: ClientConfigTarget,
  nodeExecutable: string,
  serverEntrypoint: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!CLIENT_CONFIG_TARGETS.includes(target)) throw new Error(usage);
  const paths = platform === "win32" ? path.win32 : path.posix;
  for (const value of [nodeExecutable, serverEntrypoint]) {
    if (!paths.isAbsolute(value) || /[\u0000-\u001f\u007f]/u.test(value) || value.includes("${")) {
      throw new Error("Client configuration requires absolute paths without control characters or client variable expressions.");
    }
  }
  const entry = { command: nodeExecutable, args: [serverEntrypoint] };
  if (target === "codex") {
    return `[mcp_servers.premiere-pro-leancoderkavy]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n`;
  }
  const config = target === "vscode"
    ? { servers: { "premiere-pro-leancoderkavy": { type: "stdio", ...entry } } }
    : { mcpServers: { "premiere-pro-leancoderkavy": entry } };
  return `${JSON.stringify(config, null, 2)}\n`;
}
