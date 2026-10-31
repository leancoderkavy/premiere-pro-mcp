import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { readScratchDisks } from "./project-file.js";

/**
 * Scratch disks are set with app.setScratchDiskPath(path, ScratchDiskType.X).
 * Live on Premiere 25.2 a plain string type ("videoPreview") is silently ignored
 * and project.setScratchDiskPath(path, 2) throws "Illegal Parameter type", so
 * every write goes through the ScratchDiskType constants. There is no getter:
 * the setting only shows up in the .prproj once the project is saved.
 */
export const SCRATCH_DISK_TYPES: Record<string, string> = {
  capturedVideo: "FirstVideoCaptureFolder",
  capturedAudio: "FirstAudioCaptureFolder",
  videoPreviews: "FirstVideoPreviewFolder",
  audioPreviews: "FirstAudioPreviewFolder",
  autoSave: "FirstAutoSaveFolder",
  ccLibraries: "FirstCClibrariesFolder",
  motionGraphicsTemplateMedia: "FirstCapsuleMediaFolder",
};

export const SAME_AS_PROJECT = "SameAsProject";

export interface ScratchDiskWrite {
  /** Key of SCRATCH_DISK_TYPES (matches get_project_scratch_disks result keys). */
  key: string;
  /** Existing absolute folder, or "SameAsProject". */
  path: string;
}

const normalize = (value: string) => value.replace(/\/+$/, "");

export async function applyScratchDisks(
  bridgeOptions: BridgeOptions,
  writes: ScratchDiskWrite[],
  saveAndVerify: boolean,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (writes.length === 0) return { success: false, error: "Provide at least one scratch disk path." };
  for (const write of writes) {
    if (!SCRATCH_DISK_TYPES[write.key]) return { success: false, error: `Unknown scratch disk type ${write.key}` };
    if (typeof write.path !== "string" || !write.path.trim()) return { success: false, error: `A path is required for ${write.key}` };
    if (write.path !== SAME_AS_PROJECT && !write.path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(write.path)) {
      return { success: false, error: `${write.key} path must be an absolute folder path or "${SAME_AS_PROJECT}"` };
    }
  }
  const steps = writes.map((write) => {
    const path = escapeForExtendScript(write.path);
    return `
      if ("${path}" !== "${SAME_AS_PROJECT}" && !__isDirectory("${path}")) return __error("Scratch disk folder does not exist: ${path}. Nothing further was changed.");
      if (app.setScratchDiskPath("${path}", ScratchDiskType.${SCRATCH_DISK_TYPES[write.key]}) !== true) return __error("Premiere rejected the ${write.key} scratch disk path.");
      applied.push("${write.key}");`;
  });
  const script = buildToolScript(`
    if (typeof ScratchDiskType === "undefined" || typeof app.setScratchDiskPath !== "function") {
      return __refuse("This Premiere host does not expose app.setScratchDiskPath with ScratchDiskType constants.");
    }
    var applied = [];
    ${steps.join("\n")}
    var projectPath = app.project && app.project.path ? String(app.project.path) : "";
    ${saveAndVerify ? `if (!projectPath) return __error("Scratch disks were set but the project has no saved path to verify against."); app.project.save();` : ""}
    return __result({ applied: applied, projectPath: projectPath });
  `);
  const result = await sendCommand(script, bridgeOptions);
  if (!result.success) return result;
  const hostData = result.data as { applied: string[]; projectPath: string };
  const set = Object.fromEntries(writes.map((write) => [write.key, write.path]));
  if (!saveAndVerify) {
    return {
      success: true,
      data: {
        set,
        verified: false,
        note: "Premiere accepted the paths. It has no scratch-disk getter; save the project (or pass save_and_verify) and read get_project_scratch_disks to confirm.",
      },
    };
  }
  let saved: Record<string, { setting: string; path: string }>;
  try {
    saved = await readScratchDisks(hostData.projectPath);
  } catch (error) {
    return { success: false, error: `Scratch disks were set and the project saved, but the saved file could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  const mismatches = writes
    .filter((write) => normalize(saved[write.key]?.setting ?? "") !== normalize(write.path))
    .map((write) => `${write.key}: saved ${saved[write.key]?.setting ?? "nothing"}, wanted ${write.path}`);
  if (mismatches.length) {
    return { success: false, error: `Premiere did not save the requested scratch disks: ${mismatches.join("; ")}`, data: { disks: saved } };
  }
  return { success: true, data: { set, verified: true, projectSaved: true, projectPath: hostData.projectPath, disks: saved } };
}
