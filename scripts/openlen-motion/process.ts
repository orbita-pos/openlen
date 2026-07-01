// Transcodes the curated animated hero loops (source .mp4) into web-ready
// webm + mp4 plus a poster WebP stack, uploads everything through the
// openlen-images storage adapter (R2 when R2_* env vars are set, else
// ./public/openlen-images/) under a `motion/` key prefix, and emits
// public/openlen-motion/manifest.json — committed; its URLs point wherever the
// adapter uploaded (absolute R2 URLs in prod). The "By OpenLen Motion" picker
// reads that manifest, same contract as the imagery library.
//
// Source mp4s are read-only — this script never modifies the input directory.
// Requires ffmpeg + ffprobe on PATH.
//
// Run with: npm run openlen-motion:process
// Override input: OPENLEN_MOTION_INPUT=/some/other/dir npm run openlen-motion:process

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { processImage } from "../../lib/images";
import { getOpenLenImageStorage } from "../../lib/storage/openlen-images";

const DEFAULT_INPUT_DIR = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Videos",
);
const INPUT_DIR = process.env.OPENLEN_MOTION_INPUT ?? DEFAULT_INPUT_DIR;
const OUTPUT_DIR = resolve("public", "openlen-motion");

const POSTER_SIZES = [
  { key: "hero", width: 1600 },
  { key: "tablet", width: 800 },
  { key: "thumb", width: 400 },
] as const;

interface ManifestVideo {
  id: string;
  durationMs: number;
  poster: { hero: string; tablet: string; thumb: string };
  video: { webm: string; mp4: string };
}

interface Manifest {
  version: number;
  generated: string;
  count: number;
  videos: ManifestVideo[];
}

function ffprobeDurationMs(input: string): number {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input,
      ],
      { encoding: "utf8" },
    );
    const sec = parseFloat(out.trim());
    return Number.isFinite(sec) ? Math.round(sec * 1000) : 0;
  } catch {
    return 0;
  }
}

// Cap width at 1280 but never upscale a smaller source (the comma in min() is
// escaped so ffmpeg's filtergraph parser doesn't read it as a filter break).
const SCALE = "scale=min(1280\\,iw):-2";

function toWebm(input: string, output: string): void {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", input,
    "-an",
    "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0",
    "-row-mt", "1", "-deadline", "good", "-cpu-used", "3",
    "-vf", SCALE, "-pix_fmt", "yuv420p",
    output,
  ]);
}

function toMp4(input: string, output: string): void {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", input,
    "-an",
    "-c:v", "libx264", "-crf", "30", "-preset", "slow",
    "-vf", SCALE, "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    output,
  ]);
}

function toPoster(input: string, output: string, atSec: number): void {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", atSec.toFixed(2), "-i", input, "-frames:v", "1",
    output,
  ]);
}

async function main() {
  const storage = getOpenLenImageStorage();
  const usingR2 = !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY
  );
  console.log(`Input:   ${INPUT_DIR}`);
  console.log(
    usingR2
      ? `Storage: R2 — ${process.env.R2_IMAGES_BUCKET || "openlen-images"} (motion/ prefix)`
      : `Storage: filesystem — public/openlen-images/motion/\n         (manifest URLs will be local; set R2_* to upload to R2)`,
  );
  console.log("");

  let files: string[];
  try {
    const mp4s = (await readdir(INPUT_DIR)).filter((f) => /\.mp4$/i.test(f));
    // Sort by mtime = generation order, same as the imagery pipeline.
    const stamped = await Promise.all(
      mp4s.map(async (name) => ({
        name,
        mtimeMs: (await stat(join(INPUT_DIR, name))).mtimeMs,
      })),
    );
    stamped.sort((a, b) => a.mtimeMs - b.mtimeMs);
    files = stamped.map((s) => s.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read ${INPUT_DIR}: ${msg}`);
  }

  if (files.length === 0) {
    throw new Error(`No .mp4 files found in ${INPUT_DIR}.`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), "openlen-motion-"));

  const manifest: Manifest = {
    version: 1,
    generated: new Date().toISOString(),
    count: 0,
    videos: [],
  };

  const failures: string[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = `motion-${String(i + 1).padStart(2, "0")}`;
      const inputPath = join(INPUT_DIR, file);
      // One bad input must not abort the batch (and orphan already-uploaded
      // objects) — skip it, keep the rest, report at the end.
      try {
        const srcBytes = await readFile(inputPath);
        // Content hash in the key: R2 objects are cached immutable for a year,
        // so if the source set is edited and this reruns, changed bytes get a
        // NEW url instead of serving stale video from a reused ordinal name.
        const hash = createHash("sha256")
          .update(srcBytes)
          .digest("hex")
          .slice(0, 8);
        const durationMs = ffprobeDurationMs(inputPath);
        // Poster from ~40% in, not frame 0: loops often fade in from black, and
        // this frame is both the LCP element and the reduced-motion fallback.
        const posterAtSec = durationMs > 0 ? (durationMs / 1000) * 0.4 : 0;

        const webmPath = join(tmp, `${id}.webm`);
        const mp4Path = join(tmp, `${id}.mp4`);
        const posterPath = join(tmp, `${id}.png`);
        toWebm(inputPath, webmPath);
        toMp4(inputPath, mp4Path);
        toPoster(inputPath, posterPath, posterAtSec);

        const { variants } = await processImage({
          input: await readFile(posterPath),
          variants: POSTER_SIZES.map((s) => ({
            width: s.width,
            format: "webp" as const,
            quality: 82,
          })),
          autoOrient: false,
          withoutEnlargement: true,
        });

        const poster = {} as ManifestVideo["poster"];
        for (let s = 0; s < POSTER_SIZES.length; s++) {
          const size = POSTER_SIZES[s];
          const { url } = await storage.upload({
            key: `motion/${id}-${hash}-${size.width}.webp`,
            contentType: "image/webp",
            body: variants[s].bytes,
          });
          poster[size.key] = url;
        }

        const { url: webmUrl } = await storage.upload({
          key: `motion/${id}-${hash}.webm`,
          contentType: "video/webm",
          body: await readFile(webmPath),
        });
        const { url: mp4Url } = await storage.upload({
          key: `motion/${id}-${hash}.mp4`,
          contentType: "video/mp4",
          body: await readFile(mp4Path),
        });

        manifest.videos.push({
          id,
          durationMs,
          poster,
          video: { webm: webmUrl, mp4: mp4Url },
        });

        console.log(`  ok  ${id}  (${(durationMs / 1000).toFixed(1)}s)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${id} (${file}): ${msg}`);
        console.warn(`  skip ${id} — ${msg}`);
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.warn(`\n${failures.length} loop(s) skipped:`);
    for (const f of failures) console.warn(`  - ${f}`);
  }

  manifest.count = manifest.videos.length;
  const manifestPath = join(OUTPUT_DIR, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(
    `\nDone. ${manifest.count} loops → webm + mp4 + 3 poster WebP ${usingR2 ? "uploaded to R2" : "written to disk"}.`,
  );
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nFAILED: ${msg}`);
  process.exit(1);
});
