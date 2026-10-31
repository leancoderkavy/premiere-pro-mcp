import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

/** Read a regular file through one descriptor without blocking on FIFOs or exceeding its budget. */
export function readBoundedRegularFile(path: string, maximumBytes: number): Buffer {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("Invalid file byte limit");
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > maximumBytes) throw new Error(`File must be a regular file of at most ${maximumBytes} bytes`);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximumBytes - total + 1));
      const count = readSync(descriptor, chunk, 0, chunk.length, null);
      if (!count) break;
      total += count;
      if (total > maximumBytes) throw new Error("File grew beyond the byte limit during read");
      chunks.push(chunk.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || total !== before.size) throw new Error("File changed during read");
    return Buffer.concat(chunks, total);
  } finally { closeSync(descriptor); }
}
