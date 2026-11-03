import { closeSync, fstatSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensurePrivateBridgeDirectory } from "../bridge/file-bridge.js";

/**
 * Boundary: private directories owned by the current user, with ancestors protected
 * from other users by the bridge ownership policy. Same-user/admin namespace or ACL
 * mutation is outside that policy. Revalidation is not atomic containment: a trusted
 * actor can move an open inode after validation. Never reopen or unlink by pathname.
 * Failures deliberately leave an empty reservation (or partial file on I/O failure).
 */
export function reserveSnapshotOutput(target: string) {
  const parent = path.dirname(target);
  ensurePrivateBridgeDirectory(parent);
  const canonical = realpathSync(parent);
  const directory = lstatSync(parent);
  const descriptor = openSync(target, "wx", 0o600);
  const same = (a: { dev: number; ino: number }, b: { dev: number; ino: number }) => a.dev === b.dev && a.ino === b.ino;
  try {
    const original = fstatSync(descriptor);
    const validate = () => {
      ensurePrivateBridgeDirectory(parent);
      const current = lstatSync(parent);
      const file = lstatSync(target);
      const opened = fstatSync(descriptor);
      if (realpathSync(parent) !== canonical || !same(directory, current) || current.isSymbolicLink() ||
          !same(original, opened) || !same(opened, file) || !file.isFile() || file.isSymbolicLink() ||
          opened.nlink !== 1 || opened.size !== 0) throw new Error("Snapshot output identity changed; no snapshot bytes written");
    };
    validate();
    return {
      write(content: string) { validate(); writeFileSync(descriptor, content, "utf8"); },
      close() { closeSync(descriptor); },
    };
  } catch (error) { closeSync(descriptor); throw error; }
}
