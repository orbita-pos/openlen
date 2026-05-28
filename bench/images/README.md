# Images pipeline bench

Regression-guard harness for `crates/images`'s variant pipeline +
placeholder extraction. Run it locally before/after dep upgrades or
encoder tuning to catch perf regressions.

## Run

```bash
$env:CARGO_TARGET_DIR = "D:/rust/target"  # match your dev setup
cargo bench -p openlen-images
```

Criterion writes HTML reports to `$CARGO_TARGET_DIR/criterion/`. Each
group is a separate page; `report/index.html` is the top-level summary.

## What it covers

Two criterion groups in `crates/images/benches/pipeline.rs`:

1. **`pipeline/upload-variants`** — runs the full
   `uploadResponsiveVariantSet` (200/400/800w × WebP+AVIF + JPEG
   fallback, 7 outputs per call, mirrors `/api/upload`) on five
   synthetic fixtures: small JPEG, medium PNG, large PNG, portrait
   JPEG, transparent PNG. Placeholder OFF.

2. **`pipeline/upload-variants+placeholder`** — same as (1) with
   `placeholder: true`. Diff vs. (1) is the marginal cost of the
   BlurHash + dominant-color path.

3. **`placeholder/isolated`** — just `compute_placeholder()` on three
   pre-decoded RGBA buffers (256², 1024×768, 1920×1080). No
   decode/encode noise — the cleanest measurement of the BlurHash
   encode + histogram walk.

## Saving baseline results

The harness emits to stdout + the Criterion HTML report. There's no
checked-in baseline file (Criterion's own `--save-baseline=name`
option is the right primitive when you want a comparison run). For
ad-hoc tracking, redirect the output:

```bash
cargo bench -p openlen-images > bench/images/results/$(date +%Y%m%d-%H%M).txt
```

(`bench/images/results/` is gitignored — it's a local capture target.)

## Why synthetic fixtures?

Real photos give more representative timing but bloat the repo and
introduce a dep-on-blob the bench would need to fetch. The synthetic
radial-gradient generator produces both color and luminance variation,
which is enough to exercise every encoder path (the AVIF encoder won't
short-circuit on a single-colour input, the WebP alpha path activates
on the transparent fixture, the histogram in `compute_placeholder`
sees a real distribution).

If you want to bench on a known production-sized photo, drop it into
`bench/images/fixtures/<name>.jpg` and add a fixture entry — the
bench module loads fixtures from in-memory generators today but
extending to `fs::read` is a one-line change.

## When to run

- Before/after a `cargo update` that bumps `image`, `ravif`, `webp`,
  `jpeg-encoder`, or `blurhash`.
- Before/after enabling `ravif` `asm` (the F4 S1 open-q #1 deferred
  ~3× AVIF speedup).
- Before/after tweaking the variant set in `uploadResponsiveVariantSet`.
- When debugging an upload-latency regression report.

## Reading the numbers

Criterion reports `time / iter` and bytes/sec throughput. The
`pipeline/upload-variants` group's bottleneck is AVIF encoding (per
F4 S1 numbers: ~600 ms at 800×450 without `asm`); WebP + JPEG combined
add ~100 ms, decode + Lanczos add ~50 ms. The placeholder addition is
~1 ms on the largest fixture — well inside noise for most call sites.
