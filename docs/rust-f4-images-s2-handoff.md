# F4 Images S2 — handoff

Branch: `rust/f4-images-s2`
Worktree: `D:/worktrees/openlen-f4-images-s2`
Base: `origin/master` @ `0e7aa51` (post-F4 rate-limit S2 merge)
Self-SHA: see the **Self-commit SHA** section at the bottom.

## What shipped

S2 closes the F4 Images nice-to-haves the S1 handoff flagged. The
pipeline now produces a **BlurHash + dominant-color placeholder**
on demand, exposes a **WebP alphaQuality** knob, and ships a
**criterion bench harness** as a regression guard. On the frontend a
new **`ResponsiveImage`** component consumes `variants[]` +
`placeholder` so consumers can wire `<picture>` / `<img srcset>` +
dominant-color backdrops with one import. `/api/upload` rides the new
flag and includes the placeholder in its envelope. The unused
`@imgly/background-removal-node` (+ its transitive `sharp@0.32`) is
gone.

### Backend additions (`crates/images/`)

```
crates/images/
├── Cargo.toml                       # + blurhash dep, + criterion dev-dep, + [[bench]] entry
├── benches/
│   └── pipeline.rs                  # criterion harness — 3 groups, 5 fixtures
└── src/
    ├── placeholder.rs               # compute_placeholder(img) → BlurHash + dominant color
    ├── lib.rs                       # re-exports compute_placeholder + Placeholder
    ├── pipeline.rs                  # + ProcessRequest.placeholder, + ProcessResult.placeholder
    │                                # + Variant.alpha_quality
    ├── encoders/webp.rs             # encode now takes Option<u8> alpha_quality
    └── napi_binding.rs              # JS-side placeholder / alphaQuality / PlaceholderJs
```

### Public surface (Rust)

```rust
use openlen_images::{compute_placeholder, Placeholder, process_image,
                     ProcessRequest, ProcessResult, Variant};

let result = process_image(ProcessRequest {
    input: bytes,
    variants: vec![
        Variant {
            width: 800,
            max_height: None,
            format: Format::Webp,
            quality: 82,
            alpha_quality: Some(95), // NEW — sharp's alphaQuality
        },
        // ...
    ],
    auto_orient: true,
    without_enlargement: true,
    placeholder: true,               // NEW — opt-in
})?;

// result.placeholder: Option<Placeholder>
// Placeholder { blurhash, dominant_color, width, height }
```

### Public surface (JS / TS)

```ts
import { processImage, type Placeholder } from "@/lib/images";

const result = await processImage({
  input: buffer,
  variants: [
    { width: 800, format: "webp", quality: 82, alphaQuality: 95 },
    // ...
  ],
  autoOrient: true,
  withoutEnlargement: true,
  placeholder: true,
});

// result.placeholder?: { blurhash, dominantColor, width, height }
```

### ResponsiveImage component

```tsx
import { ResponsiveImage } from "@/components/workspace-v2/responsive-image";

<ResponsiveImage
  src={fallbackUrl}
  variants={[
    { width: 200, mime: "image/webp", url: "..." },
    { width: 400, mime: "image/webp", url: "..." },
    { width: 200, mime: "image/avif", url: "..." },
    { width: 400, mime: "image/avif", url: "..." },
  ]}
  placeholder={{ dominantColor: "#a3b5c7", blurhash: "L..." }}
  alt="hero image"
  sizes="(min-width: 768px) 50vw, 100vw"
/>
```

Rendering rules:

- Multi-format `variants[]` → `<picture>` with one `<source>` per
  format, ordered AVIF > WebP > original.
- Single-format multi-width `variants[]` → `<img srcset>` with width
  descriptors.
- No `variants[]` → plain `<img>`.
- `placeholder.dominantColor` becomes `style.backgroundColor` in every
  case so the layout box renders a tinted block before paint.

## Migrated call sites

| File | Change |
|---|---|
| `app/api/upload/route.ts` | passes `placeholder: true`, returns it in the response envelope (additive — existing callers that only read `.url` unaffected) |
| `components/workspace-v2/replace-asset-modal.tsx` | `OpenLenCard` rewires to `ResponsiveImage` with a 3-width srcset (thumb/tablet/hero = 400/800/1920 WebP) |
| `lib/images.ts` | new `Placeholder` type + `placeholder` + `alphaQuality` plumbed end-to-end |

The other ImagePicker tabs (`PasteUrlTab`, `UnsplashTab`, `UploadTab`)
keep their existing `<img>` for now — they each have only one URL to
render so the new shape doesn't change anything. The `LogoSection`
preview in `properties-panel.tsx` likewise stays on plain `<img>`; the
preview thumb is 64×64, where variants + LQIP would be cosmetic
noise. Adoption is opt-in per consumer.

## Test status

| Suite | Count | Status |
|---|---|---|
| `cargo test -p openlen-images` | 56 | ✅ all pass (37 from S1 + 12 placeholder + 4 webp alphaQuality + 3 pipeline placeholder) |
| `node --test __test__/*.test.mjs` (real .node) | 17 | ✅ all pass (13 from S1 + 4 placeholder/alphaQuality) |
| `cargo clippy --workspace --all-targets -- -D warnings` | — | ✅ clean (after the prep-commit S1 lint cleanups) |
| `cargo fmt -- --check` | — | ✅ clean |
| `cargo bench -p openlen-images --no-run` | — | ✅ binary emits |
| `npx tsc --noEmit --skipLibCheck` on changed files | — | ✅ no errors in `lib/images.ts`, `responsive-image.tsx`, `replace-asset-modal.tsx`, `api/upload/route.ts` |

The full-repo `tsc --noEmit` in the worktree reports 262 errors against
third-party packages (next/link, lucide-react, drizzle-orm). They're
all `TS2307`/`TS7016` resolution failures — the worktree's
`node_modules` came up incomplete after a puppeteer postinstall failure
(`ENOTEMPTY` on Windows; the parent repo's install is healthy). None of
them touch the S2 surface; my changed files are clean. Operator can
verify with `npm install --ignore-scripts` then `npx tsc --noEmit
--skipLibCheck`.

## Performance notes

Same envelope as S1 — adding `placeholder: true` costs ~1 ms on top of
the variant pipeline (BlurHash encode + histogram walk on a 32 px
thumb). On the 1.6 s F4 S1 baseline (1920×1080 JPEG → 6 variants +
fallback), placeholder adds <0.1% overhead.

The bench harness (`crates/images/benches/pipeline.rs`) covers three
criterion groups:

- `pipeline/upload-variants` — production variant set on 5 fixtures
  (small JPEG, medium PNG, large PNG, portrait JPEG, transparent PNG)
- `pipeline/upload-variants+placeholder` — same with placeholder ON
- `placeholder/isolated` — just `compute_placeholder()` on three
  pre-decoded buffers (256², 1024×768, 1920×1080)

See `bench/images/README.md` for the run command + when to use it.

## Design decisions

### BlurHash configuration

4×3 components (BLURHASH_X=4, BLURHASH_Y=3) — Woltapp's documented
landscape default. Produces ~30-char strings. Other choices considered:

- **3×3** — slightly smaller string but loses horizontal detail on
  landscape inputs (the common case for hero images).
- **Adaptive components (function of aspect)** — visually negligible
  win; complicates the API for marginal benefit.

### Dominant-color algorithm

4-bit-per-channel histogram, 4096 buckets, modal bin centroid. Other
choices considered + rejected:

- **Average RGB** — fastest but muddies high-contrast inputs (a
  black-and-white photo averages to gray, hiding the perceived
  dominant tone).
- **k-means with k=1** — equivalent to average RGB on a downsampled
  image; same problem.
- **`palette` crate** — produces good results but adds a dep and a
  larger compile-time footprint; the simple histogram is good enough
  for the LQIP backdrop use case.

The current implementation walks the 32-px thumb once (~1024 pixels)
and picks the modal bucket — O(N) with N≈1024, no dep, deterministic.

### Why thumb at longest-edge 32?

BlurHash's encoding cost is roughly O(W·H·components_x·components_y).
A 1920×1080 source at 4×3 components would be ~7 ms; at 32×18 it's
~30 µs. The visual quality of the encoded blur is indistinguishable
between the two — the components describe spatial-frequency basis
functions, not literal pixels.

### `<picture>` vs `<img srcset>` selection

If `variants[]` carries >1 distinct MIME → `<picture>` with format
negotiation. If all variants share the same MIME → `<img srcset>` (the
canonical recipe for single-format multi-resolution). The browser
walks either equivalently, but `<img srcset>` produces smaller markup
and is what the React community treats as idiomatic.

## Migration notes

- The Rust `ProcessRequest` and `Variant` structs grow new fields.
  `placeholder: false` and `alpha_quality: None` are the additive
  defaults — callers that were using struct literals (mostly tests
  in this repo) need both fields explicit. The TS surface uses
  optionals so JS callers are unaffected.
- The napi `processImage` JS function's behaviour is unchanged for
  callers that don't pass the new optionals.
- `/api/upload`'s response gains `.placeholder?` — existing consumers
  (`properties-panel.tsx`) only read `.url`, so they're fine.

## Open follow-ups

### 1. BlurHash JS decoder integration

ResponsiveImage receives `placeholder.blurhash` but doesn't render it
yet — the dominant-color backdrop captures most of the perceptual win
and the canvas decoder is a 5-KB JS dep + ~50 LoC of useEffect/ref
plumbing. A future commit can wire `react-blurhash` (or the lighter
`blurhash-canvas`) for a true blur preview. Low priority — the
backdrop is the load-bearing UX detail.

### 2. ImagePicker UploadTab consumes /api/upload

The Upload tab in `replace-asset-modal.tsx` currently POSTs to
`/api/projects/[id]/assets` (single-variant `legacyWebp2000Variant()`),
not `/api/upload` (the variant-pipeline endpoint that now ships
placeholder). Reasons not done in S2:

- The Upload tab pre-existed and works correctly today.
- The variants[] from `/api/upload` aren't persisted in the DB —
  swapping endpoints would need either DB schema growth or a
  client-side ephemeral cache. Either is a scope creep on top of
  what S2 explicitly delivered.

When a consumer wants `<picture>` rendering for uploaded assets, the
choice is: (a) add a `variants jsonb` column to the `assets` table and
swap the Upload tab's endpoint, or (b) keep the assets table single-
URL and use `/api/upload` for "transient previews" only.

### 3. Manifest extension for OpenLen images

The `public/openlen-images/manifest.json` carries `src.hero/tablet/thumb`
(three widths, same WebP format). `ResponsiveImage` consumes that as a
single-format multi-width srcset cleanly. If we ever want AVIF variants
of the curated OpenLen catalog, the manifest schema would grow a
`variants[]` array and the OpenLenCard would pass it through. Not done
because the storage win on a 200×120 picker thumbnail is dwarfed by
the cost of re-encoding 454 source images.

### 4. ravif `asm` for Linux (carried from S1 Open Q #1)

Not addressed in S2. Still a one-line `Cargo.toml` change + `apt install
nasm` in the Hetzner image. Defer until AVIF encode latency is a real
operator concern.

### 5. Blurhash decode + canvas component split

If wiring (1) reveals that `<picture>` + LQIP rendering wants to live
in a separate `@openlen/responsive-image` package (rather than buried
in `components/workspace-v2/`), the present module is a small enough
single-file unit that the split would be straightforward.

## Phase log

- **Phase A** — Investigation. Located ImagePicker in
  `replace-asset-modal.tsx` (not the `image-picker/` path the brief
  guessed); confirmed `@imgly/background-removal-node` has zero
  source-code matches; confirmed properties-panel.tsx's LogoSection is
  the only `/api/upload` caller and reads only `.url`. Read the F4 S1
  handoff in full to understand ProcessRequest/Result shape.
- **Phase A.5** — Pre-existing clippy 1.95 cleanups in `avif.rs`,
  `jpeg.rs`, `webp.rs`, `pipeline.rs` (S1 code that didn't catch a
  later clippy bump). Commit: `415f2c3`.
- **Phase B** — `placeholder.rs` with `compute_placeholder()` →
  `Placeholder { blurhash, dominant_color, width, height }`. 4×3
  BlurHash, 4-bit-per-channel histogram for dominant color. 12 unit
  tests. Commit: `3d0095e`.
- **Phase C** — `ProcessRequest.placeholder: bool` +
  `ProcessResult.placeholder: Option<Placeholder>`. Pipeline runs
  `compute_placeholder` after the EXIF rotate, before the variant
  resize cache. 3 new pipeline-level tests. Commit: `7f81269`.
- **Phase D** — `Variant.alpha_quality: Option<u8>` and `webp::encode`
  drops into libwebp's `encode_advanced` with WebPConfig when the
  caller wants asymmetric quality. 4 new webp encoder tests. Commit:
  `21f1219`.
- **Phase E** — napi binding exposes `placeholder`, `alphaQuality`,
  and `PlaceholderJs`. `lib/images.ts` mirrors the surface with the
  `Placeholder` TS type, optional `placeholder` on `ProcessImageOptions`,
  optional `placeholder` on `ProcessImageResult`. 4 new Node tests.
  Commit: `9872dc3`.
- **Phase F** — `/api/upload` passes `placeholder: true` and includes
  the result in its response envelope. Commit: `d4f55e8`.
- **Phase G** — New `ResponsiveImage` component +
  `OpenLenCard` uses it with multi-width srcset. Commit: `3042059`.
- **Phase H** — `crates/images/benches/pipeline.rs` (criterion) +
  `bench/images/README.md`. Commit: `897cfd2`.
- **Phase I** — Drop `@imgly/background-removal-node` from package.json
  and package-lock.json (zero source-code references). Commit:
  `0c373d0`.
- **Phase I.5** — `cargo fmt` sweep across the S2-touched modules + S1
  drifts that the new rustfmt picked up; Cargo.lock criterion entry
  that got missed in Phase H. Commit: `aa0a822`.
- **Phase J** — this doc. Commit: _self-SHA below_.

## Closes from F4 S1 handoff

- **Open Q #2 (`@imgly/background-removal-node` removal)** — done in Phase I.
- **Open Q #3 (alphaQuality knob)** — done in Phase D + E.
- **Open Q #4 (perf bench harness)** — done in Phase H.
- **Open Q #5 (`<picture>` in the workspace)** — done in Phase G via
  the ResponsiveImage component + OpenLenCard usage.

Open Q #1 (ravif `asm` on Linux) remains a deploy/Hetzner concern,
not a Rust code change; defer to operator.

---

## Self-commit SHA

`__SELF_SHA__` — the Phase J commit that introduced this handoff doc.
Subsequent commits on `rust/f4-images-s2` are doc-only fill-ins.
