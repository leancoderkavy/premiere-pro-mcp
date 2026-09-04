"""Build an owned, synthetic evaluation kit. Requires Python 3, FFmpeg, ffprobe.

No Premiere project is generated or edited. Media validation is not host proof.
The ZIP uses fixed timestamps and contains no local paths or machine metadata.
"""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "landing/public/downloads/premiere-workflow-starter-kit.zip"


def main():
    recipes = json.loads((ROOT / "landing/lib/workflow-kits.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="premiere-workflow-fixture-") as folder:
        staging = pathlib.Path(folder)
        media = []
        for name, color in [("blue", "0x243b70"), ("violet", "0x62439b")]:
            target = staging / f"{name}.mp4"
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
                "-f", "lavfi", "-i", f"color=c={color}:s=1280x720:r=25:d=3",
                "-vf", "drawbox=x=480:y=180:w=320:h=360:color=white@0.8:t=fill",
                "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-threads", "1",
                "-map_metadata", "-1", "-movflags", "+faststart", str(target),
            ], check=True)
            probe = json.loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-show_entries",
                "stream=codec_name,codec_type,width,height,r_frame_rate:format=duration", "-of", "json", str(target),
            ]))
            stream = probe["streams"][0]
            assert stream["codec_name"] == "h264" and stream["width"] == 1280 and stream["height"] == 720
            assert stream["r_frame_rate"] == "25/1" and float(probe["format"]["duration"]) == 3.0
            media.append({"file": target.name, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "width": 1280, "height": 720, "fps": 25, "durationSeconds": 3, "audio": False})
        (staging / "sample-captions.srt").write_text("1\n00:00:00,000 --> 00:00:02,000\nSynthetic blue clip\n\n2\n00:00:04,000 --> 00:00:06,000\nSynthetic violet clip\n", encoding="utf-8")
        manifest = {"schemaVersion": 1, "fixtureVersion": "1", "license": "MIT", "media": media, "mediaValidation": "ffprobe dimensions, codec, rate, duration and SHA-256", "premiereHostValidation": "not_run", "nativePremiereProjectIncluded": False, "notes": "Two silent synthetic clips. The caption sample assumes blue at 0–3 seconds, a one-second gap, and violet at 4–7 seconds; import captions only as a separate reviewed exercise."}
        (staging / "fixture-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        (staging / "evaluation-recipes.json").write_text(json.dumps(recipes, indent=2) + "\n", encoding="utf-8")
        (staging / "LICENSE").write_bytes((ROOT / "LICENSE").read_bytes())
        (staging / "README.md").write_text("""# Premiere workflow evaluation kit

These are synthetic fixtures and human-readable prompts, not a recorded demo,
native Premiere project, or automatically executable workflow manifest.
The two MP4 clips have no audio. No third-party footage is included.

1. Install your AI-client server and the separate Premiere connector:
   https://premiere-pro-mcp.com/#install
2. Create a NEW disposable Premiere project and import blue.mp4 and violet.mp4.
3. Create a sequence from blue.mp4. Put violet.mp4 at 4 seconds on the same track.
   Blue lasts 3 seconds, leaving a one-second gap. Save the disposable project.
4. Run the read-only connection check. Stop if it is not ready.
5. Follow one of the three recipes at https://premiere-pro-mcp.com/workflows/.
   The same prompts and steps are in evaluation-recipes.json.

Expected inspection: compare the reported primary-track gap with 3–4 seconds.
Confirm that no clip moved. A missing/incorrect result is a failed test, not proof
of successful automation. Frame export writes files only after your confirmation.
The product-spot starter ends at preview and requires a separate empty sequence.

The optional caption sample matches the manual 7-second gap fixture; it is not
imported by any starter recipe and does not test generated captions.

Evaluation checklist: package version; connector; client; OS; Premiere build;
connection result; requested recipe; expected versus actual result; manual
timeline/file review; pass, fail, unsupported, or not_run. Do not include client
media, names, paths, transcripts, or tokens in a shared report.

Host validation and screen recordings remain NOT RUN for this kit. The manifest
reports media-file checks only. A downloaded kit is not a completed installation.

Recovery: https://premiere-pro-mcp.com/docs/troubleshooting/
Recipe contributions: https://github.com/leancoderkavy/premiere-pro-mcp/discussions
""", encoding="utf-8")
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for item in sorted(staging.iterdir()):
                info = zipfile.ZipInfo(item.name, date_time=(2026, 9, 4, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, item.read_bytes())
        with zipfile.ZipFile(OUTPUT) as archive:
            assert archive.testzip() is None
            assert len(archive.namelist()) == 7
        print(json.dumps({"archive": str(OUTPUT.relative_to(ROOT)), "bytes": OUTPUT.stat().st_size, "sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), "media": media, "hostValidation": "not_run"}))


if __name__ == "__main__":
    main()
