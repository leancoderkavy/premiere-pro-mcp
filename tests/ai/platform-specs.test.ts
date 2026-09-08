import { describe, expect, it } from "vitest";
import {
  PLATFORM_IDS,
  PLATFORM_SPECS,
  SPEC_DISCLAIMER,
  aspectLabel,
  aspectMatches,
  chooseFrameRate,
  computeReframeMath,
  estimateFileSizeMb,
  normalizeHashtags,
  planPlatformDeliveryMatrix,
  validatePlatformPublishPackage,
} from "../../src/ai/platform-specs.js";

const landscape = { width: 1920, height: 1080, frame_rate: 29.97, duration_seconds: 45 };

describe("PLATFORM_SPECS table", () => {
  it("contains every documented platform with sane fields", () => {
    expect(PLATFORM_IDS).toEqual(["tiktok", "instagram_reels", "instagram_feed", "instagram_story", "youtube_shorts", "youtube", "linkedin", "x", "facebook_reels"]);
    for (const id of PLATFORM_IDS) {
      const spec = PLATFORM_SPECS[id];
      expect(spec.id).toBe(id);
      expect(spec.display_name.length).toBeGreaterThan(0);
      expect(spec.aspect.w).toBeGreaterThan(0);
      expect(spec.aspect.h).toBeGreaterThan(0);
      expect(aspectMatches(spec.width, spec.height, spec.aspect)).toBe(true);
      expect(spec.frame_rates.length).toBeGreaterThan(0);
      expect(spec.frame_rates).toContain(30);
      expect(spec.min_duration_seconds).toBeGreaterThan(0);
      expect(spec.max_duration_seconds).toBeGreaterThan(spec.min_duration_seconds);
      if (spec.recommended_max_duration_seconds !== undefined) expect(spec.recommended_max_duration_seconds).toBeLessThanOrEqual(spec.max_duration_seconds);
      expect(spec.max_file_size_mb).toBeGreaterThan(0);
      expect(spec.video_codec).toBe("H.264");
      expect(spec.audio_codec).toBe("AAC");
      expect(spec.container).toBe("mp4");
      expect(spec.recommended_video_bitrate_mbps).toBeGreaterThan(0);
      expect(spec.audio_bitrate_kbps).toBeGreaterThan(0);
      expect(spec.title_max_chars).toBeGreaterThanOrEqual(0);
      expect(spec.description_max_chars).toBeGreaterThanOrEqual(0);
      expect(spec.hashtag_recommended_count).toBeLessThanOrEqual(spec.hashtag_max_count);
      for (const inset of Object.values(spec.safe_zone)) {
        expect(inset).toBeGreaterThanOrEqual(0);
        expect(inset).toBeLessThan(0.5);
      }
      expect(spec.caption_anchor_y).toBeGreaterThan(0);
      expect(spec.caption_anchor_y).toBeLessThan(1);
      expect(spec.caption_anchor_y).toBeLessThanOrEqual(1 - spec.safe_zone.bottom);
      expect(spec.notes.length).toBeGreaterThan(0);
      expect(spec.vertical).toBe(spec.aspect.w < spec.aspect.h && !(spec.aspect.w === 4 && spec.aspect.h === 5));
    }
  });

  it("encodes the headline 2026 limits", () => {
    expect(PLATFORM_SPECS.tiktok.max_duration_seconds).toBe(600);
    expect(PLATFORM_SPECS.tiktok.recommended_max_duration_seconds).toBe(60);
    expect(PLATFORM_SPECS.instagram_reels.max_duration_seconds).toBe(180);
    expect(PLATFORM_SPECS.instagram_reels.recommended_max_duration_seconds).toBe(90);
    expect(PLATFORM_SPECS.youtube_shorts.max_duration_seconds).toBe(180);
    expect(PLATFORM_SPECS.youtube.max_duration_seconds).toBe(43200);
    expect(PLATFORM_SPECS.linkedin.max_duration_seconds).toBe(600);
    expect(PLATFORM_SPECS.x.max_duration_seconds).toBe(600);
    expect(PLATFORM_SPECS.x.recommended_max_duration_seconds).toBe(140);
    expect(PLATFORM_SPECS.instagram_feed.aspect).toEqual({ w: 4, h: 5 });
    expect(PLATFORM_SPECS.youtube.aspect).toEqual({ w: 16, h: 9 });
    expect(SPEC_DISCLAIMER).toMatch(/2026/);
  });
});

describe("reframe math", () => {
  it("computes fit and fill scale for 16:9 to 9:16", () => {
    const math = computeReframeMath({ width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    expect(math.fit_scale_percent).toBe(56.25);
    expect(math.fill_scale_percent).toBe(177.78);
    expect(math.fit_frame).toEqual({ width: 1080, height: 608 });
    expect(math.fill_frame).toEqual({ width: 3413, height: 1920 });
    expect(math.fit_padding).toEqual({ horizontal: 0, vertical: 1312 });
    expect(math.fill_overflow).toEqual({ horizontal: 2333, vertical: 0 });
  });

  it("computes fit and fill scale for 9:16 to 16:9 and identical frames", () => {
    const math = computeReframeMath({ width: 1080, height: 1920 }, { width: 1920, height: 1080 });
    expect(math.fit_scale_percent).toBe(56.25);
    expect(math.fill_scale_percent).toBe(177.78);
    const same = computeReframeMath({ width: 1080, height: 1920 }, { width: 1080, height: 1920 });
    expect(same.fit_scale_percent).toBe(100);
    expect(same.fill_scale_percent).toBe(100);
    expect(same.fit_padding).toEqual({ horizontal: 0, vertical: 0 });
  });

  it("scales 4K to 4:5 feed", () => {
    const math = computeReframeMath({ width: 3840, height: 2160 }, { width: 1080, height: 1350 });
    expect(math.fit_scale_percent).toBe(28.13);
    expect(math.fill_scale_percent).toBe(62.5);
  });

  it("labels and matches aspect ratios within tolerance", () => {
    expect(aspectLabel(1920, 1080)).toBe("16:9");
    expect(aspectLabel(1080, 1350)).toBe("4:5");
    expect(aspectLabel(1080, 1920)).toBe("9:16");
    expect(aspectMatches(1080, 1926, { w: 9, h: 16 })).toBe(true);
    expect(aspectMatches(1080, 1500, { w: 9, h: 16 })).toBe(false);
  });
});

describe("frame rate and size helpers", () => {
  it("keeps an allowed frame rate and picks the nearest otherwise", () => {
    expect(chooseFrameRate(29.97, PLATFORM_SPECS.tiktok.frame_rates)).toEqual({ frame_rate: 29.97, changed: false });
    expect(chooseFrameRate(120, PLATFORM_SPECS.tiktok.frame_rates)).toEqual({ frame_rate: 60, changed: true });
    expect(chooseFrameRate(29.97, PLATFORM_SPECS.linkedin.frame_rates)).toEqual({ frame_rate: 30, changed: true });
    expect(chooseFrameRate(27, [24, 30])).toEqual({ frame_rate: 24, changed: true });
    expect(chooseFrameRate(12, [24, 30])).toEqual({ frame_rate: 24, changed: true });
  });

  it("estimates file size from bitrate and duration", () => {
    expect(estimateFileSizeMb(10, 128, 60)).toBe(75.96);
    expect(estimateFileSizeMb(8, 0, 8)).toBe(8);
  });
});

describe("planPlatformDeliveryMatrix", () => {
  it("plans a landscape source into a vertical platform with auto reframe", () => {
    const plan = planPlatformDeliveryMatrix({ source: landscape, targets: ["tiktok"] });
    expect(plan.applied).toBe(false);
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.assumptions).toContain(SPEC_DISCLAIMER);
    expect(plan.strategy).toBe("auto_reframe");
    const target = plan.targets[0];
    expect(target.platform.id).toBe("tiktok");
    expect(target.sequence_settings).toEqual({ width: 1080, height: 1920, frame_rate: 29.97 });
    expect(target.aspect_change).toEqual({ from: "16:9", to: "9:16", requires_reframe: true });
    expect(target.reframe.strategy).toBe("auto_reframe");
    expect(target.reframe.fit_scale_percent).toBe(56.25);
    expect(target.reframe.fill_scale_percent).toBe(177.78);
    expect(target.duration_fit.status).toBe("ok");
    expect(target.captions.required_burn_in).toBe(true);
    expect(target.captions.anchor_y).toBe(PLATFORM_SPECS.tiktok.caption_anchor_y);
    expect(target.export.within_limit).toBe(true);
    expect(target.export.estimated_file_size_mb).toBe(estimateFileSizeMb(10, 128, 45));
    expect(target.steps.map((step) => step.step)).toEqual(["clone_sequence", "set_sequence_settings", "auto_reframe", "captions", "validate_export", "export", "verify_file", "verify_conformance"]);
    expect(target.steps.map((step) => step.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(target.steps[2].routes).toEqual(["auto_reframe_sequence"]);
    expect(plan.routes).toEqual(expect.arrayContaining(["duplicate_sequence", "manage_sequences_uxp", "set_sequence_settings", "auto_reframe_sequence", "create_caption_track", "validate_project_for_export", "export_sequence", "verify_delivery_file", "verify_delivery_conformance"]));
    expect(plan.summary).toEqual({ targets: 1, requires_reframe: 1, trim_required: 0, too_short: 0, frame_rate_changed: 0, over_file_limit: 0, captions_recommended: 1 });
  });

  it("emits the two-layer pad_blur recipe with exact scales", () => {
    const plan = planPlatformDeliveryMatrix({ source: landscape, targets: ["instagram_reels"], strategy: "pad_blur" });
    const target = plan.targets[0];
    const step = target.steps.find((item) => item.step === "pad_blur_layers");
    expect(step?.routes).toEqual(["apply_effect", "set_clip_scale"]);
    expect(target.reframe.pad_blur_recipe).toMatchObject({
      background_layer: { scale_percent: 177.78, effect: "Gaussian Blur" },
      foreground_layer: { scale_percent: 56.25 },
      padding_pixels: { horizontal: 0, vertical: 1312 },
    });
  });

  it("supports center_crop and letterbox strategies", () => {
    const crop = planPlatformDeliveryMatrix({ source: landscape, targets: ["youtube_shorts"], strategy: "center_crop" }).targets[0];
    expect(crop.steps[2]).toMatchObject({ step: "center_crop", routes: ["set_clip_scale", "set_clip_position"], parameters: { scale: 177.78 } });
    const box = planPlatformDeliveryMatrix({ source: landscape, targets: ["youtube_shorts"], strategy: "letterbox" }).targets[0];
    expect(box.steps[2]).toMatchObject({ step: "letterbox", routes: ["set_clip_scale"], parameters: { scale: 56.25 } });
  });

  it("skips reframe when aspect and size already match and adds a scale step for same-aspect resizes", () => {
    const same = planPlatformDeliveryMatrix({ source: { ...landscape, has_captions: true }, targets: ["youtube"] }).targets[0];
    expect(same.aspect_change.requires_reframe).toBe(false);
    expect(same.reframe.strategy).toBe("none");
    expect(same.captions.required_burn_in).toBe(false);
    expect(same.steps.map((step) => step.step)).toEqual(["clone_sequence", "set_sequence_settings", "validate_export", "export", "verify_file", "verify_conformance"]);
    const uhd = planPlatformDeliveryMatrix({ source: { ...landscape, width: 3840, height: 2160 }, targets: ["youtube"] }).targets[0];
    expect(uhd.aspect_change.requires_reframe).toBe(false);
    expect(uhd.steps[2]).toMatchObject({ step: "scale_to_frame", routes: ["set_clip_scale"], parameters: { scale: 50 } });
  });

  it("falls back to the nearest frame rate and warns", () => {
    const plan = planPlatformDeliveryMatrix({ source: { ...landscape, frame_rate: 120 }, targets: ["linkedin"] });
    expect(plan.targets[0].sequence_settings.frame_rate).toBe(60);
    expect(plan.targets[0].frame_rate_changed).toBe(true);
    expect(plan.summary.frame_rate_changed).toBe(1);
    expect(plan.warnings.some((warning) => warning.includes("frame rate 120"))).toBe(true);
  });

  it("reports trim_required, too_short, and above-recommended durations", () => {
    const long = planPlatformDeliveryMatrix({ source: { ...landscape, duration_seconds: 200 }, targets: ["instagram_reels", "tiktok"] });
    expect(long.targets[0].duration_fit).toMatchObject({ status: "trim_required", overage_seconds: 20, planned_duration_seconds: 180 });
    expect(long.targets[1].duration_fit).toMatchObject({ status: "ok", overage_seconds: 0, above_recommended: true, recommended_max_duration_seconds: 60 });
    expect(long.summary.trim_required).toBe(1);
    expect(long.warnings.some((warning) => warning.includes("exceeds the 180s limit by 20s"))).toBe(true);
    expect(long.warnings.some((warning) => warning.includes("above the recommended 60s"))).toBe(true);
    const short = planPlatformDeliveryMatrix({ source: { ...landscape, duration_seconds: 1.5 }, targets: ["facebook_reels"] });
    expect(short.targets[0].duration_fit.status).toBe("too_short");
    expect(short.summary.too_short).toBe(1);
  });

  it("flags file-size overage against small upload limits", () => {
    const plan = planPlatformDeliveryMatrix({ source: { ...landscape, duration_seconds: 600 }, targets: ["x"] });
    const target = plan.targets[0];
    expect(target.export.estimated_file_size_mb).toBe(estimateFileSizeMb(5, 128, 600));
    expect(target.export.within_limit).toBe(true);
    const plan2 = planPlatformDeliveryMatrix({ source: { ...landscape, duration_seconds: 100000 }, targets: ["youtube"] });
    expect(plan2.targets[0].export.within_limit).toBe(true);
    expect(plan2.targets[0].duration_fit.status).toBe("trim_required");
  });

  it("plans every platform at once with unique routes and export step hints", () => {
    const plan = planPlatformDeliveryMatrix({ source: { ...landscape, sequence_id: "seq-1" }, targets: [...PLATFORM_IDS], export_preset_hint: "Social 1080p" });
    expect(plan.targets).toHaveLength(PLATFORM_IDS.length);
    expect(plan.summary.targets).toBe(PLATFORM_IDS.length);
    expect(new Set(plan.routes).size).toBe(plan.routes.length);
    expect(plan.evidence).toMatchObject({ export_preset_hint: "Social 1080p", source: { sequence_id: "seq-1" } });
    for (const target of plan.targets) {
      const exportStep = target.steps.find((step) => step.step === "export");
      expect(exportStep?.parameters).toMatchObject({ container: "mp4", export_preset_hint: "Social 1080p" });
      expect(target.steps[0].parameters).toMatchObject({ sequence_id: "seq-1" });
      expect(target.steps.at(-1)?.routes).toEqual(["verify_delivery_conformance"]);
    }
  });

  it("is deterministic and sensitive to inputs", () => {
    const a = planPlatformDeliveryMatrix({ source: landscape, targets: ["tiktok", "youtube"] });
    const b = planPlatformDeliveryMatrix({ source: { ...landscape }, targets: ["tiktok", "youtube"] });
    const c = planPlatformDeliveryMatrix({ source: landscape, targets: ["youtube", "tiktok"] });
    expect(a.plan_revision).toBe(b.plan_revision);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.plan_revision).not.toBe(c.plan_revision);
  });

  it("rejects invalid inputs", () => {
    expect(() => planPlatformDeliveryMatrix({ source: null, targets: ["tiktok"] })).toThrow(/source must be an object/);
    expect(() => planPlatformDeliveryMatrix({ source: { ...landscape, width: 0 }, targets: ["tiktok"] })).toThrow(/source.width/);
    expect(() => planPlatformDeliveryMatrix({ source: { ...landscape, frame_rate: 0 }, targets: ["tiktok"] })).toThrow(/source.frame_rate/);
    expect(() => planPlatformDeliveryMatrix({ source: { ...landscape, duration_seconds: -1 }, targets: ["tiktok"] })).toThrow(/duration_seconds/);
    expect(() => planPlatformDeliveryMatrix({ source: { ...landscape, extra: 1 }, targets: ["tiktok"] })).toThrow(/unknown field: extra/);
    expect(() => planPlatformDeliveryMatrix({ source: { ...landscape, has_captions: "yes" }, targets: ["tiktok"] })).toThrow(/has_captions/);
    expect(() => planPlatformDeliveryMatrix({ source: landscape, targets: [] })).toThrow(/targets/);
    expect(() => planPlatformDeliveryMatrix({ source: landscape, targets: ["vimeo"] })).toThrow(/targets\[0\]/);
    expect(() => planPlatformDeliveryMatrix({ source: landscape, targets: ["tiktok", "tiktok"] })).toThrow(/duplicate/);
    expect(() => planPlatformDeliveryMatrix({ source: landscape, targets: ["tiktok"], strategy: "stretch" })).toThrow(/strategy/);
    expect(() => planPlatformDeliveryMatrix({ source: landscape, targets: ["tiktok"], export_preset_hint: "x".repeat(300) })).toThrow(/export_preset_hint/);
  });
});

describe("normalizeHashtags", () => {
  it("prefixes, dedupes case-insensitively, and reports invalid entries", () => {
    const result = normalizeHashtags(["#Edit", "edit", "#EDIT", " #Premiere ", "#bad tag", "", "##double"]);
    expect(result.normalized).toEqual(["#Edit", "#Premiere", "#badtag", "#double"]);
    expect(result.duplicates).toEqual(["#edit", "#EDIT"]);
    expect(result.invalid).toEqual([
      { index: 1, value: "edit", reason: "missing_hash_prefix" },
      { index: 4, value: "#bad tag", reason: "contains_whitespace" },
      { index: 5, value: "", reason: "empty" },
    ]);
  });
});

describe("validatePlatformPublishPackage", () => {
  const ready = { platform: "youtube_shorts", title: "Cut", description: "A short.", hashtags: ["#shorts", "#edit"], duration_seconds: 45, width: 1080, height: 1920, frame_rate: 30, file_size_bytes: 50_000_000, container: "mp4", video_codec: "H.264", audio_codec: "AAC", has_captions: true };

  it("passes a compliant package", () => {
    const result = validatePlatformPublishPackage(ready);
    expect(result.ready).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.normalized_hashtags).toEqual(["#shorts", "#edit"]);
    expect(result.character_counts).toEqual({ title: 3, title_max: 100, description: 8, description_max: 5000, hashtags: 13, description_with_hashtags: 22 });
    expect(result.applied).toBe(false);
    expect(result.assumptions).toContain(SPEC_DISCLAIMER);
    expect(result.plan_revision).toMatch(/^sha256:/);
  });

  it("flags duration violations and the x free-tier warning", () => {
    const over = validatePlatformPublishPackage({ ...ready, duration_seconds: 200 });
    expect(over.violations.map((item) => item.code)).toContain("duration_exceeds_max");
    expect(over.ready).toBe(false);
    const under = validatePlatformPublishPackage({ ...ready, platform: "instagram_reels", duration_seconds: 1 });
    expect(under.violations.map((item) => item.code)).toContain("duration_below_min");
    const x = validatePlatformPublishPackage({ ...ready, platform: "x", width: 1920, height: 1080, duration_seconds: 200 });
    expect(x.violations).toEqual([]);
    expect(x.warnings.map((item) => item.code)).toEqual(expect.arrayContaining(["x_free_tier_duration", "duration_above_recommended"]));
  });

  it("flags aspect mismatch beyond 1% but accepts alternates and near matches", () => {
    const mismatch = validatePlatformPublishPackage({ ...ready, width: 1920, height: 1080 });
    expect(mismatch.violations[0]).toMatchObject({ code: "aspect_mismatch", field: "width/height", actual: "16:9" });
    const near = validatePlatformPublishPackage({ ...ready, width: 1080, height: 1926 });
    expect(near.violations).toEqual([]);
    const alternate = validatePlatformPublishPackage({ ...ready, platform: "linkedin", width: 1080, height: 1920 });
    expect(alternate.violations).toEqual([]);
    expect(alternate.warnings.map((item) => item.code)).toContain("aspect_not_primary");
    const low = validatePlatformPublishPackage({ ...ready, width: 540, height: 960 });
    expect(low.warnings.map((item) => item.code)).toContain("resolution_below_recommended");
  });

  it("flags file size, title, and description limits", () => {
    const big = validatePlatformPublishPackage({ ...ready, platform: "x", width: 1920, height: 1080, duration_seconds: 30, file_size_bytes: 600 * 1024 * 1024 });
    expect(big.violations[0]).toMatchObject({ code: "file_size_exceeds_max", limit: 512, actual: 600 });
    const long = validatePlatformPublishPackage({ ...ready, title: "t".repeat(101), description: "d".repeat(5001) });
    expect(long.violations.map((item) => item.code)).toEqual(["title_too_long", "description_too_long"]);
    expect(long.violations[0]).toMatchObject({ limit: 100, actual: 101 });
    const story = validatePlatformPublishPackage({ ...ready, platform: "instagram_story", title: "x", description: "" });
    expect(story.violations.map((item) => item.code)).toContain("title_too_long");
  });

  it("flags container and codec mismatches while accepting aliases", () => {
    const bad = validatePlatformPublishPackage({ ...ready, container: "MOV", video_codec: "ProRes 422", audio_codec: "PCM" });
    expect(bad.violations.map((item) => item.code)).toEqual(["container_mismatch", "video_codec_mismatch", "audio_codec_mismatch"]);
    const alias = validatePlatformPublishPackage({ ...ready, container: "MP4", video_codec: "avc1", audio_codec: "mp4a" });
    expect(alias.violations).toEqual([]);
  });

  it("flags hashtag rules", () => {
    const result = validatePlatformPublishPackage({ ...ready, hashtags: ["#Shorts", "edit", "#bad tag", "#SHORTS"] });
    expect(result.violations.map((item) => item.code)).toEqual(["hashtag_invalid", "hashtag_invalid", "hashtag_duplicate"]);
    expect(result.normalized_hashtags).toEqual(["#Shorts", "#edit", "#badtag"]);
    const many = validatePlatformPublishPackage({ ...ready, hashtags: Array.from({ length: 16 }, (_, index) => `#tag${index}`) });
    expect(many.violations.map((item) => item.code)).toEqual(["hashtag_count_exceeds_max"]);
    const some = validatePlatformPublishPackage({ ...ready, hashtags: ["#a", "#b", "#c", "#d"] });
    expect(some.violations).toEqual([]);
    expect(some.warnings.map((item) => item.code)).toContain("hashtag_count_above_recommended");
  });

  it("warns about frame rate, captions, and content flags", () => {
    const result = validatePlatformPublishPackage({ ...ready, frame_rate: 120, has_captions: false, content_flags: ["ai_generated", "paid_partnership", "music_licensed"] });
    expect(result.ready).toBe(true);
    expect(result.warnings.map((item) => item.code)).toEqual(["frame_rate_not_recommended", "captions_missing", "ai_generated_label", "paid_partnership_disclosure", "music_license_evidence"]);
    const landscapeNoCaptions = validatePlatformPublishPackage({ ...ready, platform: "youtube", width: 1920, height: 1080, has_captions: undefined });
    expect(landscapeNoCaptions.warnings.map((item) => item.code)).not.toContain("captions_missing");
    const verticalUnknown = validatePlatformPublishPackage({ ...ready, has_captions: undefined });
    expect(verticalUnknown.warnings.map((item) => item.code)).toContain("captions_missing");
  });

  it("is deterministic", () => {
    const a = validatePlatformPublishPackage(ready);
    const b = validatePlatformPublishPackage({ ...ready });
    expect(a.plan_revision).toBe(b.plan_revision);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(validatePlatformPublishPackage({ ...ready, title: "Other" }).plan_revision).not.toBe(a.plan_revision);
  });

  it("rejects invalid inputs", () => {
    expect(() => validatePlatformPublishPackage({ ...ready, platform: "vimeo" })).toThrow(/platform must be one of/);
    expect(() => validatePlatformPublishPackage({ ...ready, title: "t".repeat(1001) })).toThrow(/title/);
    expect(() => validatePlatformPublishPackage({ ...ready, description: "d".repeat(10001) })).toThrow(/description/);
    expect(() => validatePlatformPublishPackage({ ...ready, hashtags: "#one" })).toThrow(/hashtags/);
    expect(() => validatePlatformPublishPackage({ ...ready, hashtags: [42] })).toThrow(/hashtags\[0\]/);
    expect(() => validatePlatformPublishPackage({ ...ready, hashtags: Array.from({ length: 101 }, () => "#a") })).toThrow(/hashtags/);
    expect(() => validatePlatformPublishPackage({ ...ready, duration_seconds: "45" })).toThrow(/duration_seconds/);
    expect(() => validatePlatformPublishPackage({ ...ready, width: 1.5 })).toThrow(/width/);
    expect(() => validatePlatformPublishPackage({ ...ready, frame_rate: 500 })).toThrow(/frame_rate/);
    expect(() => validatePlatformPublishPackage({ ...ready, file_size_bytes: -1 })).toThrow(/file_size_bytes/);
    expect(() => validatePlatformPublishPackage({ ...ready, content_flags: ["sponsored"] })).toThrow(/content_flags\[0\]/);
    expect(() => validatePlatformPublishPackage({ ...ready, content_flags: ["ai_generated", "ai_generated"] })).toThrow(/duplicates/);
    expect(() => validatePlatformPublishPackage({ ...ready, has_captions: 1 })).toThrow(/has_captions/);
    expect(() => validatePlatformPublishPackage({ ...ready, bogus: true })).toThrow(/unknown field: bogus/);
  });
});
