import { describe, expect, it, vi } from "vitest";
import { capabilitiesForToolInvocation, guardToolHandler, resolveCapabilities } from "../../src/security/capabilities.js";

// Premiere writes XMP changes into the source media file on disk. Live testing
// rewrote a user's MP4 metadata block through set_xmp_metadata, so these calls
// need the filesystem capability, not just edit.
describe("source-file metadata writes need the filesystem capability", () => {
  it("set_xmp_metadata", () => {
    expect(capabilitiesForToolInvocation("set_xmp_metadata", { item_id: "x", xmp_xml: "<x/>" })).toEqual(["edit", "filesystem"]);
  });

  it("set_metadata writing the XMP packet", () => {
    expect(capabilitiesForToolInvocation("set_metadata", { item_id: "x", field_name: "dc:title", value: "v", packet: "xmp" })).toEqual(["edit", "filesystem"]);
  });

  it("set_metadata writing the project packet stays an edit", () => {
    expect(capabilitiesForToolInvocation("set_metadata", { item_id: "x", field_name: "Column.Intrinsic.LogNote", value: "v" })).toEqual(["edit"]);
  });
});

// add_title bakes a .mogrt copy under the user's app-data folder, and the
// scratch-disk setters point Premiere at folders it writes to.
describe("tools that change the project and write files need edit and filesystem", () => {
  it.each(["add_title", "set_project_scratch_disk", "set_scratch_disk_path"])("%s", (name) => {
    expect(capabilitiesForToolInvocation(name, {})).toEqual(["edit", "filesystem"]);
  });
});

// Physical source bounds require reading the media file with ffprobe.
describe("source-range edits require filesystem authority for duration evidence", () => {
  it.each(["trim_clip", "slip_edit"])("%s", name => {
    expect(capabilitiesForToolInvocation(name, {})).toEqual(["edit", "filesystem"]);
  });
  it.each(["trim_clip", "slip_edit"])("%s refuses before file or host reads without filesystem authority", async name => {
    const handler = vi.fn().mockResolvedValue({ success: true });
    const guarded = guardToolHandler(name, handler, resolveCapabilities("edit"));
    await expect(guarded({})).rejects.toThrow(/filesystem/);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("sequence presets and AME queue handoff require filesystem authority", () => {
  it.each([
    ["create_sequence", "edit"],
    ["create_sequence_from_preset", "edit"],
    ["add_to_render_queue", "export"],
  ])("%s", async (name, authority) => {
    expect(capabilitiesForToolInvocation(name, {})).toEqual([authority, "filesystem"]);
    const handler = vi.fn().mockResolvedValue({ success: true });
    const guarded = guardToolHandler(name, handler, resolveCapabilities(authority));
    await expect(guarded({})).rejects.toThrow(/filesystem/);
    expect(handler).not.toHaveBeenCalled();
  });
});

it("AME queue handoff requires export authority even when edit and filesystem are allowed", async () => {
  const handler = vi.fn().mockResolvedValue({ success: true });
  await expect(guardToolHandler("add_to_render_queue", handler, resolveCapabilities("edit,filesystem"))({})).rejects.toThrow(/export/);
  expect(handler).not.toHaveBeenCalled();
});
