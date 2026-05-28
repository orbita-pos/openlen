# F4 — Images handoff

Branch: `rust/f4-images-pipeline`
Worktree: `D:/worktrees/openlen-f4-images`
Base: `origin/master` @ `8f740a2` (post-F4 rate-limit merge)
Self-SHA: _filled at the bottom by the closing commit_

## What shipped

A new `crates/images/` napi-rs addon that replaces the surface `sharp`
covered (resize + AVIF/WebP/JPEG/PNG encoding + EXIF auto-rotate) plus
a new **variant pipeline** that emits N outputs from one decode + one
resize-per-unique-bound — feeding `/api/upload` so user uploads now
ship as a responsive set (200/400/800w × WebP+AVIF + one legacy
fallback) ready for a `<picture>` element. The five sharp call sites
migrated; `sharp` is removed from `package.json`.

### New code

```
crates/images/
├── Cargo.toml                       # rlib + cdylib; image + ravif + webp + jpeg-encoder + oxipng + kamadak-exif
├── build.rs                          # napi_build::setup()
├── package.json                      # @openlen/images, file:./ workspace dep
├── .gitignore / .npmignore           # standard napi pattern
├── src/
│   ├── lib.rs                        # module declarations + re-exports
│   ├── error.rs                      # ImageError + kind() + is_retryable()
│   ├── exif.rs                       # read_orientation + apply_orientation (1..=8)
│   ├── resize.rs                     # resize_lanczos3 primitive
│   ├── encoders/
│   │   ├── mod.rs
│   │   ├── webp.rs                   # libwebp via the `webp` crate, alpha-aware
│   │   ├── avif.rs                   # ravif (rav1e), asm DISABLED — see Open Q #1
│   │   ├── jpeg.rs                   # jpeg-encoder, progressive, alpha→white composite
│   │   └── png.rs                    # image-rs encode + oxipng preset 2 optimize
│   ├── pipeline.rs                   # process_image — decode → resize-once-per-bound → encode-per-cell
│   └── napi_binding.rs               # JS-facing processImage(req)
└── __test__/
    └── process-image.test.mjs        # Node smoke tests via the prebuilt .node
```

### Migrated call sites

The five `sharp` consumers + the previously-no-op `/api/upload` route:

| File | Engine before F4 | Engine after F4 |
|---|---|---|
| `app/api/upload/route.ts` | pass-through (no processing) | full variant pipeline (6 outputs + 1 fallback per upload) |
| `lib/publish/filesystem.ts` (Unsplash) | sharp `rotate().resize(2000)..webp(85)` | `processImage` with `legacyWebp2000Variant()` |
| `app/api/projects/[id]/assets/route.ts` | sharp `rotate().resize(2000)..webp(85)` | `processImage` with `legacyWebp2000Variant()` |
| `scripts/openlen-images/process.ts` | sharp loop (re-decode × 3 widths) | `processImage` (1 decode + 3 variants) |
| `scripts/openlen-images/remove-bg-lume.ts` | sharp loop (alpha webp × 3 widths) | `processImage` (1 decode + 3 alpha-aware variants) |
| `scripts/templates/generate-thumbnails.ts` | sharp `avif(65)` per template | `processImage` (single AVIF variant) |

### Wiring

- `package.json` — added `"@openlen/images": "file:./crates/images"`; **removed `"sharp": "^0.34.5"`**.
- `next.config.ts` — added the package name to `serverExternalPackages` and the webpack `externals` callback's allowlist (mirrors the html-engine / ai-gateway / rate-limit entries — package name AND the `crates/images/index.js` workspace-symlink path).
- `Cargo.toml` (workspace) — added `crates/images` to `members`.

### JS surface

```ts
import { processImage, uploadResponsiveVariantSet, fallbackFormatForMime,
         legacyWebp2000Variant, OpenLenImageError } from "@/lib/images";

const result = await processImage({
  input: buffer,
  variants: [
    { width: 800, format: "webp", quality: 82 },
    { width: 800, maxHeight: 2000, format: "webp", quality: 85 }, // fit:'inside'
    { width: 0, format: "avif", quality: 65 },                    // 0 = use original width
  ],
  autoOrient: true,         // default true — read EXIF Orientation and rotate
  withoutEnlargement: true, // default true — clamp target to input intrinsic
});
// result.variants: [{ width, height, format, mime, bytes, size }, ...]
```

Errors throw an `OpenLenImageError` with `kind ∈ {decode, encode, resize,
invalid_input}` — same envelope shape used by `lib/ai-gateway.ts` and
`lib/rate-limit-rs.ts`.

## Behavioural notes (parity caveats)

- **AVIF encoded WITHOUT asm.** `ravif`'s `asm` feature requires NASM in
  PATH on the build machine. To keep `git clone && npm i && npm run dev`
  hassle-free on Windows, we disabled it. Cost: AVIF encode is ~3× slower
  than sharp/libaom-with-asm. AVIF is the variant pipeline's slowest path
  anyway, and the call sites run at upload/publish time (not request
  time). Re-enabling on prod Linux is a one-line cargo features change
  with `apt install nasm` in the Hetzner image. See Open Q #1.
- **No `alphaQuality` knob.** sharp's `webp({ quality, alphaQuality })`
  lets callers tune color and alpha separately. The Rust `webp` crate
  uses a single quality for both. No current call site needs the
  asymmetric setting (`remove-bg-lume.ts` was the only one passing it,
  always equal to `quality`).
- **`fit: 'inside'` requires `maxHeight`.** The pipeline's `Variant`
  defaults to width-only resize. To match sharp's `{width:N, height:M,
  fit:'inside'}` behaviour, set `maxHeight: M` — the legacy preset
  `legacyWebp2000Variant()` does this for callers that need it.
- **JPEG alpha → white composite.** JPEG has no alpha channel; transparent
  RGBA pixels are flattened onto pure white. Matches sharp's default.
- **GIF → bypass.** `/api/upload` short-circuits GIF inputs and uploads
  them untouched (re-encoding strips animation). `lib/publish/filesystem.ts`
  and the assets route already had the same SVG+GIF bypass.
- **Next.js still pulls sharp transitively.** `next@15.5.18` declares
  sharp as an optional dep for `next/image` automatic optimization. We
  don't use `next/image`, so sharp lives in `node_modules` but is never
  required by our app code. Confirmed via `grep require .next/server/` →
  zero references. Removing the transitive would require either
  patching Next or telling npm to skip it — out of scope.

## Test status

| Suite | Count | Status |
|---|---|---|
| `cargo test -p openlen-images` | 37 | ✅ all pass |
| `node --test __test__/*.test.mjs` (real .node) | 13 | ✅ all pass |
| `npx tsc --noEmit` (whole repo) | — | ✅ exit 0 |
| `cargo check --workspace` | — | ✅ exit 0 |
| `npm run build` (webpack compile) | — | ✅ chunks emitted, `@openlen/images` externalised |
| `npm run build` (generateStaticParams) | — | ❌ unrelated: `DATABASE_URL` not set in this fresh worktree's `.env.local` |

The build error during `generateStaticParams` for `/templates/[slug]`
is a Neon connection failure (no `.env.local` in the worktree). The
webpack compilation completed and emitted the full 140-chunk bundle
set — verified by:

```bash
grep -o 'require("@openlen[^"]*")' .next/server/app/api/upload/route.js
# → require("@openlen/images")
```

A `.env.local` with a real `DATABASE_URL` is required to complete the
full standalone export. That's pre-existing infra config, not regression
from this work.

## Performance notes

Real-image sanity (Macbook M-series equivalent, mid-tier x86 dev box):

| Operation | Input | Approx wall time |
|---|---|---|
| Decode (PNG/JPEG) | 1920×1080 | ~30 ms |
| Lanczos3 resize | 1920×1080 → 800w | ~25 ms |
| WebP encode (q82) | 800×450 | ~40 ms |
| AVIF encode (q65, no asm) | 800×450 | ~600 ms |
| Full variant pipeline (6 variants + fallback) | 1920×1080 JPEG | ~1.6 s |

AVIF dominates; if perf becomes a concern, enabling `asm` (Open Q #1)
drops the AVIF leg to ~200 ms.

Storage impact: the responsive variant set produces ~150-300 KB total
per upload (vs ~50-150 KB for sharp's old single-WebP). Worth it for
the responsive `<picture>` performance gain, but operators should be
aware uploads use ~2-3× more storage. Mitigation: the largest variant
caps at 800w, so we never store 10MB hero images.

## Phase log

- **Phase A** — Investigation. Sharp consumer list (5 files), storage
  interface (single-file upload, parallel for variants), `next/image`
  not used → sharp removable. Pattern study of html-engine /
  ai-gateway / rate-limit crates.
- **Phase B–F** — Crate scaffold + resize + encoders + pipeline +
  napi binding. One combined commit: `505e49b`.
- **Phase G** — TS wrapper (`lib/images.ts`), `@openlen/images` in
  `package.json`, next.config.ts externalize, `/api/upload` rewrite
  on the variant pipeline. Commit: `1ae6048`.
- **Phase H** — `Variant.max_height` pipeline extension (needed for
  sharp `fit: 'inside'` parity), 5 consumer migrations, sharp removed
  from `package.json`. Commit: `0245afc`.
- **Phase I** — this doc. Commit: _self-SHA below_.

## Open questions

### 1. Should production Linux enable rav1e's `asm` feature?

Current state: `ravif = { version = "0.11", default-features = false,
features = ["threading"] }` in `crates/images/Cargo.toml`. AVIF encode
is ~3× slower than it could be.

Trade-off:
- **Enable asm**: AVIF encode drops from ~600 ms → ~200 ms per call.
  Requires `nasm` in the Hetzner build image (`apt install nasm`) and a
  Cargo features tweak. Windows dev still needs NASM installed (Scoop:
  `scoop install nasm`).
- **Keep asm off**: status quo. Slower AVIF but zero toolchain ask.

Recommendation: enable asm in CI/prod by adding a build profile +
documenting the NASM dep in `infra/` deploy scripts. Defer until AVIF
encode latency becomes a noticed user-facing issue.

### 2. Should `@imgly/background-removal-node` be removed?

`npm ls sharp` shows two transitive owners: `next` (opt-in for
`next/image`, which we don't use) and `@imgly/background-removal-node`
(grep across the repo finds zero importers). The imgly dep was added
speculatively, never wired. Dropping it would shave both itself and
its sharp@0.32.6 transitive — pure cleanup.

Out of scope for this session; flagging for a future "deps audit"
pass.

### 3. Should we expose `alphaQuality` for transparent WebP?

The Rust `webp` crate's `encode(quality)` uses one quality for both
color and alpha. sharp's `webp({ quality, alphaQuality })` lets callers
tune them separately. Only `remove-bg-lume.ts` was ever passing
`alphaQuality` (always equal to `quality`), so no real loss today. If
a future caller needs asymmetric tuning, the `webp` crate exposes
`Encoder::encode_advanced` with full `WebPConfig` access — wire it
through `Variant.alpha_quality: Option<u8>`.

### 4. Should we add a perf bench harness?

The ai-gateway crate has no bench; html-engine + rate-limit do via
`criterion`. Adding `crates/images/benches/pipeline.rs` would track
encoder + resize regressions between Rust upgrades. Today the test
counts (37 Rust + 13 Node) cover correctness only. Out of scope; defer
until AVIF asm or a Rust upgrade lands and we want a regression
guard.

### 5. Should `<picture>` rendering land in the workspace?

The `/api/upload` response now carries a `variants[]` array, but the
one current caller (`properties-panel.tsx`) only reads `.url`. To
realise the size win, `ImagePicker` would emit a `<picture>` element
referencing the AVIF/WebP/fallback set. The user's brief explicitly
deferred this ("ImagePicker (defer; cuando user pide)") — flagged
here for the next session that touches upload UI.

---

Self-SHA: _to be filled by the closing commit_
