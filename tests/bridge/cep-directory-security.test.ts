import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { WINDOWS_BRIDGE_ACL_SCRIPT } from "../../src/bridge/file-bridge.js";

const require = createRequire(import.meta.url);
const root = process.cwd();
const pluginDirectories = ["cep-plugin", "after-effects-cep-plugin"] as const;

type FileStatus = {
  uid: number;
  mode: number;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
};

function status(overrides: Partial<FileStatus> = {}): FileStatus {
  return {
    uid: 1000,
    mode: 0o700,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  };
}

function loadSecurity(pluginDirectory: typeof pluginDirectories[number]) {
  const modulePath = join(root, pluginDirectory, "bridge-directory-security.cjs");
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath) as {
    windowsAclScript: string;
    createBridgeDirectorySecurity: (runtime: Record<string, unknown>) => {
      ensurePrivateBridgeDirectory: (directory: string) => string;
    };
  };
}

it("keeps the Premiere, After Effects, and server Windows ACL policy in sync", () => {
  expect(loadSecurity("cep-plugin").windowsAclScript).toBe(WINDOWS_BRIDGE_ACL_SCRIPT);
  expect(loadSecurity("after-effects-cep-plugin").windowsAclScript).toBe(WINDOWS_BRIDGE_ACL_SCRIPT);
  expect(WINDOWS_BRIDGE_ACL_SCRIPT).toContain("FileAttributes]::ReparsePoint");
  expect(WINDOWS_BRIDGE_ACL_SCRIPT.indexOf("$unsafeAncestors.Count -ne 0"))
    .toBeLessThan(WINDOWS_BRIDGE_ACL_SCRIPT.indexOf("SetAccessControl($path"));
});

it("skips only Windows capability SIDs in the ancestor and directory ACL scans", () => {
  const lines = WINDOWS_BRIDGE_ACL_SCRIPT.split("\n");
  const capabilityFilter = '$_.IdentityReference.Value -notlike "S-1-15-*"';
  const ancestorFilter = lines.find((line) => line.includes("-band $replacement) -ne 0)"));
  const directoryFilter = lines.find((line) => line.includes("-notin $trusted "));
  expect(ancestorFilter).toContain(`-notin $trustedAncestors -and ${capabilityFilter}`);
  expect(directoryFilter).toContain(`-notin $trusted -and ${capabilityFilter}`);
  expect(WINDOWS_BRIDGE_ACL_SCRIPT.split(capabilityFilter)).toHaveLength(3);
  // Owner checks and the SIDs granted on initialize stay unchanged.
  expect(WINDOWS_BRIDGE_ACL_SCRIPT).toContain("if ($ancestorOwner -notin $trustedAncestors)");
  expect(WINDOWS_BRIDGE_ACL_SCRIPT).toContain('foreach ($sid in @($current, "S-1-5-18", "S-1-5-32-544"))');
});

it("reports each unsafe ancestor path, reason, and SID from the ACL script", () => {
  const throwLine = WINDOWS_BRIDGE_ACL_SCRIPT.split("\n")
    .find((line) => line.includes("Bridge directory ancestry is unsafe"));
  expect(throwLine).toContain('"Bridge directory ancestry is unsafe: "');
  expect(throwLine).toContain('"{0} ({1}: {2})" -f $_.path, $_.reason, $_.sid');
  expect(throwLine).toContain('-join "; "');
});

describe.each(pluginDirectories)("%s bridge directory security", (pluginDirectory) => {
  it("refuses an existing symbolic-link bridge directory", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: {
        mkdirSync: vi.fn(),
        lstatSync: vi.fn(() => status({ isSymbolicLink: () => true })),
        chmodSync: vi.fn(),
      },
      path: { resolve: (value: string) => value },
      platform: "linux",
      currentUid: 1000,
    });

    expect(() => security.ensurePrivateBridgeDirectory("/tmp/premiere-mcp-bridge"))
      .toThrow(/symbolic link/i);
  });

  it("refuses a POSIX bridge directory owned by another user", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: {
        mkdirSync: vi.fn(),
        lstatSync: vi.fn(() => status({ uid: 1001 })),
        chmodSync: vi.fn(),
      },
      path: { resolve: (value: string) => value },
      platform: "darwin",
      currentUid: 1000,
    });

    expect(() => security.ensurePrivateBridgeDirectory("/private/tmp/premiere-mcp-bridge"))
      .toThrow(/owned by another user/i);
  });

  it("clamps POSIX permissions and verifies that they became owner-only", () => {
    const chmodSync = vi.fn();
    let leafReads = 0;
    const lstatSync = vi.fn((value: string) => {
      if (value === "/tmp/premiere-mcp-bridge") {
        leafReads += 1;
        return status({ mode: leafReads === 1 ? 0o755 : 0o700 });
      }
      return status({ uid: 0, mode: 0o755 });
    });
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync, chmodSync, realpathSync: vi.fn((value: string) => value) },
      path: posix,
      platform: "linux",
      currentUid: 1000,
    });

    expect(security.ensurePrivateBridgeDirectory("/tmp/premiere-mcp-bridge"))
      .toBe("/tmp/premiere-mcp-bridge");
    expect(chmodSync).toHaveBeenCalledWith("/tmp/premiere-mcp-bridge", 0o700);
  });

  it("refuses an existing POSIX directory that another user could have written", () => {
    const chmodSync = vi.fn();
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        lstatSync: vi.fn(() => status({ mode: 0o777 })),
        chmodSync,
      },
      path: { resolve: (value: string) => value },
      platform: "linux",
      currentUid: 1000,
    });

    expect(() => security.ensurePrivateBridgeDirectory("/tmp/premiere-mcp-bridge"))
      .toThrow(/was writable by other users/i);
    expect(chmodSync).not.toHaveBeenCalled();
  });

  it("refuses a Windows directory with broadly writable ACL entries", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: {
        mkdirSync: vi.fn(),
        lstatSync: vi.fn(() => status()),
        chmodSync: vi.fn(),
      },
      path: { resolve: (value: string) => value },
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [{ sid: "S-1-5-21-2000", isInherited: false }],
      })),
    });

    expect(() => security.ensurePrivateBridgeDirectory("C:\\Temp\\premiere-mcp-bridge"))
      .toThrow(/write access to untrusted identities/i);
  });

  it("refuses a Windows path with a replaceable ancestor", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: win32,
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [],
        unsafeAncestorEntries: [{
          sid: "S-1-5-21-2000",
          path: "C:\\shared",
          reason: "replacement_rights",
        }],
      })),
    });

    expect(() => security.ensurePrivateBridgeDirectory("C:\\shared\\premiere-mcp-bridge"))
      .toThrow(/replaceable ancestor.*C:\\shared/i);
  });

  it("lists every unsafe Windows ancestor with its SID", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: win32,
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [],
        unsafeAncestorEntries: [
          { sid: "S-1-5-21-2000", path: "C:\\shared", reason: "replacement_rights" },
          { sid: "", path: "C:\\link", reason: "reparse_point" },
        ],
      })),
    });

    expect(() => security.ensurePrivateBridgeDirectory("C:\\link\\shared\\premiere-mcp-bridge"))
      .toThrow(
        "Bridge path has a replaceable ancestor C:\\shared (replacement_rights: S-1-5-21-2000); " +
          "C:\\link (reparse_point: none)",
      );
  });

  it("ignores Windows capability and app-container SIDs inherited on AppData", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: win32,
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [
          { sid: "S-1-15-3-3557520199-3666692283-3112367039", isInherited: true },
          { sid: "S-1-15-2-1", isInherited: true },
        ],
        unsafeAncestorEntries: [{
          sid: "S-1-15-3-3557520199-3666692283-3112367039",
          path: "C:\\Users\\editor\\AppData",
          reason: "replacement_rights",
        }],
      })),
    });

    expect(security.ensurePrivateBridgeDirectory("C:\\Users\\editor\\AppData\\Local\\Temp\\premiere-mcp-bridge"))
      .toBe("C:\\Users\\editor\\AppData\\Local\\Temp\\premiere-mcp-bridge");
  });

  it("still refuses account SIDs listed beside a capability SID", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: win32,
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [
          { sid: "S-1-15-3-1", isInherited: true },
          { sid: "S-1-5-21-2000", isInherited: true },
        ],
      })),
    });

    expect(() => security.ensurePrivateBridgeDirectory("C:\\Temp\\premiere-mcp-bridge"))
      .toThrow("Bridge directory grants write access to untrusted identities (S-1-5-21-2000): C:\\Temp\\premiere-mcp-bridge");
  });

  it("still refuses an ancestor owned by a capability SID", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: win32,
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [],
        unsafeAncestorEntries: [{ sid: "S-1-15-3-1", path: "C:\\odd", reason: "owner" }],
      })),
    });

    expect(() => security.ensurePrivateBridgeDirectory("C:\\odd\\premiere-mcp-bridge"))
      .toThrow("Bridge path has a replaceable ancestor C:\\odd (owner: S-1-15-3-1)");
  });

  it("accepts a private Windows directory owned by the current user", () => {
    const mkdirSync = vi.fn();
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync, lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: { resolve: (value: string) => value },
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [],
      })),
    });

    expect(security.ensurePrivateBridgeDirectory("C:\\Users\\editor\\AppData\\Local\\Temp\\premiere-mcp-bridge"))
      .toBe("C:\\Users\\editor\\AppData\\Local\\Temp\\premiere-mcp-bridge");
    expect(mkdirSync).toHaveBeenCalledWith(
      "C:\\Users\\editor\\AppData\\Local\\Temp\\premiere-mcp-bridge",
      { recursive: true, mode: 0o700 },
    );
  });

  it("passes a Windows ACL path outside the PowerShell command text", () => {
    const execFileSync = vi.fn(() => JSON.stringify({
      ownerSid: "S-1-5-21-1000",
      currentUserSid: "S-1-5-21-1000",
      unsafeWriteAces: [],
    }));
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: { resolve: (value: string) => value },
      platform: "win32",
      process: { env: { SYSTEMROOT: "C:\\Windows" } },
      childProcess: { execFileSync },
      Buffer,
    });
    const directory = "C:\\Users\\editor & reviewer\\Temp\\premiere-mcp-bridge";

    expect(security.ensurePrivateBridgeDirectory(directory)).toBe(directory);
    const [executable, args, options] = execFileSync.mock.calls[0];
    expect(executable).toBe("powershell.exe");
    expect(args).not.toContain(directory);
    expect(options.env.PREMIERE_MCP_ACL_PATH).toBe(directory);
    expect(options).toMatchObject({ timeout: 5000, maxBuffer: 64 * 1024 });
    expect(options.env.PREMIERE_MCP_ACL_INITIALIZE).toBe("0");
  });

  it("initializes and then verifies a restrictive ACL only for a newly created directory", () => {
    const directory = "C:\\Users\\editor\\Temp\\premiere-mcp-bridge";
    const execFileSync = vi.fn(() => JSON.stringify({
      ownerSid: "S-1-5-21-1000",
      currentUserSid: "S-1-5-21-1000",
      unsafeWriteAces: [],
    }));
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: {
        mkdirSync: vi.fn(() => directory),
        lstatSync: vi.fn(() => status()),
        chmodSync: vi.fn(),
        readdirSync: vi.fn(() => []),
      },
      path: { resolve: (value: string) => value },
      platform: "win32",
      process: { env: {} },
      childProcess: { execFileSync },
      Buffer,
    });

    expect(security.ensurePrivateBridgeDirectory(directory)).toBe(directory);
    expect(execFileSync.mock.calls[0][2].env.PREMIERE_MCP_ACL_INITIALIZE).toBe("1");
  });

  it("refuses files staged during new-directory ACL initialization", () => {
    const directory = "C:\\Users\\editor\\Temp\\premiere-mcp-bridge";
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: {
        mkdirSync: vi.fn(() => directory),
        lstatSync: vi.fn(() => status()),
        chmodSync: vi.fn(),
        readdirSync: vi.fn(() => ["cmd_attacker.jsx"]),
      },
      path: { resolve: (value: string) => value },
      platform: "win32",
      inspectWindowsAcl: vi.fn(() => ({
        ownerSid: "S-1-5-21-1000",
        currentUserSid: "S-1-5-21-1000",
        unsafeWriteAces: [],
      })),
    });

    expect(() => security.ensurePrivateBridgeDirectory(directory))
      .toThrow(/unexpected contents appeared during creation/i);
  });

  it("refuses inherited untrusted writers even under the per-user Windows temp root", () => {
    const inspectWindowsAcl = vi.fn(() => ({
      ownerSid: "S-1-5-21-1000",
      currentUserSid: "S-1-5-21-1000",
      unsafeWriteAces: [{ sid: "S-1-5-21-3000", isInherited: true }],
    }));
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: win32,
      platform: "win32",
      inspectWindowsAcl,
    });

    expect(() => security.ensurePrivateBridgeDirectory(
      "C:\\Users\\editor\\AppData\\Local\\Temp\\premiere-mcp-bridge",
    ))
      .toThrow(/write access to untrusted identities/i);
  });

  it("fails closed when POSIX ownership cannot be determined", () => {
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync: vi.fn(() => status()), chmodSync: vi.fn() },
      path: { resolve: (value: string) => value },
      platform: "linux",
      process: { env: {} },
    });

    expect(() => security.ensurePrivateBridgeDirectory("/tmp/premiere-mcp-bridge"))
      .toThrow(/could not verify bridge directory ownership/i);
  });

  it("refuses a POSIX path beneath an untrusted replaceable parent", () => {
    const lstatSync = vi.fn()
      .mockReturnValueOnce(status({ uid: 1000, mode: 0o700 }))
      .mockReturnValueOnce(status({ uid: 0, mode: 0o777 }));
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync, chmodSync: vi.fn() },
      path: posix,
      platform: "linux",
      currentUid: 1000,
    });

    expect(() => security.ensurePrivateBridgeDirectory("/shared/premiere-mcp-bridge"))
      .toThrow(/replaceable ancestor.*\/shared/i);
  });

  it("refuses an untrusted POSIX symlink ancestor before changing leaf permissions", () => {
    const chmodSync = vi.fn();
    const lstatSync = vi.fn()
      .mockReturnValueOnce(status({ uid: 1000, mode: 0o755 }))
      .mockReturnValueOnce(status({
        uid: 2000,
        mode: 0o777,
        isDirectory: () => false,
        isSymbolicLink: () => true,
      }));
    const security = loadSecurity(pluginDirectory).createBridgeDirectorySecurity({
      fs: { mkdirSync: vi.fn(), lstatSync, chmodSync, realpathSync: vi.fn((value: string) => value) },
      path: posix,
      platform: "linux",
      currentUid: 1000,
    });

    expect(() => security.ensurePrivateBridgeDirectory("/shared/premiere-mcp-bridge"))
      .toThrow(/untrusted replaceable ancestor.*\/shared/i);
    expect(chmodSync).not.toHaveBeenCalled();
  });
});

function panelHarness(
  pluginDirectory: typeof pluginDirectories[number],
  symbolicLink: boolean,
  mode = 0o700,
) {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: "C:\\unsafe-bridge",
        textContent: "",
        className: "",
        style: {},
        disabled: false,
        children: [],
        appendChild() {},
        removeChild() {},
        setAttribute() {},
        getElementsByTagName() { return []; },
        focus() {},
      });
    }
    return elements.get(id);
  };
  const writeFileSync = vi.fn();
  const setInterval = vi.fn();
  const timers: Array<() => void> = [];
  const fs = {
    mkdirSync: vi.fn(),
    lstatSync: vi.fn(() => status({ mode, isSymbolicLink: () => symbolicLink })),
    chmodSync: vi.fn(),
    writeFileSync,
    renameSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    unlinkSync: vi.fn(),
  };
  const modules: Record<string, unknown> = {
    fs,
    path: require("node:path"),
    os: { platform: () => "linux", tmpdir: () => "/tmp" },
    process: { env: {}, getuid: () => 1000 },
    https: {},
    child_process: {},
    crypto: {},
  };
  const context: Record<string, any> = {
    console,
    Buffer,
    CSInterface: function CSInterface() { this.evalScript = vi.fn(); },
    document: {
      getElementById: element,
      createElement: () => element(`created-${elements.size}`),
    },
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    window: { confirm: vi.fn(() => false) },
    require: (name: string) => modules[name],
    setInterval,
    clearInterval: vi.fn(),
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    clearTimeout: vi.fn(),
    MCPBridgeUpdater: { CURRENT_VERSION: "test", normalizeVersion: vi.fn() },
  };
  context.window.cep_node = null;
  const securitySource = readFileSync(
    join(root, pluginDirectory, "bridge-directory-security.cjs"),
    "utf8",
  );
  runInNewContext(securitySource, context, { filename: `${pluginDirectory}/bridge-directory-security.cjs` });
  const mainSource = readFileSync(join(root, pluginDirectory, "main.js"), "utf8");
  runInNewContext(mainSource, context, { filename: `${pluginDirectory}/main.js` });
  return { context, elements, timers, writeFileSync, setInterval };
}

describe("CEP panel startup validation", () => {
  it("does not start Premiere polling or heartbeat for a symbolic-link directory", () => {
    const harness = panelHarness("cep-plugin", true);

    for (const timer of harness.timers) timer();

    expect(harness.setInterval).not.toHaveBeenCalled();
    expect(harness.writeFileSync).not.toHaveBeenCalled();
    expect(harness.elements.get("statusText").textContent).toMatch(/needs attention/i);
  });

  it("does not start After Effects polling or heartbeat for a symbolic-link directory", () => {
    const harness = panelHarness("after-effects-cep-plugin", true);

    harness.elements.get("toggle").onclick();

    expect(harness.setInterval).not.toHaveBeenCalled();
    expect(harness.writeFileSync).not.toHaveBeenCalled();
    expect(harness.elements.get("status").textContent).toMatch(/needs attention/i);
  });

  it("does not start Premiere polling for a preexisting writable POSIX directory", () => {
    const harness = panelHarness("cep-plugin", false, 0o777);

    for (const timer of harness.timers) timer();

    expect(harness.setInterval).not.toHaveBeenCalled();
    expect(harness.writeFileSync).not.toHaveBeenCalled();
    expect(harness.elements.get("statusText").textContent).toMatch(/needs attention/i);
  });
});
