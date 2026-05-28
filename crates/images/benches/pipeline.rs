//! Regression-guard bench for the variant pipeline + placeholder
//! extraction. Five synthetic fixtures cover the matrix of input shapes
//! the production /api/upload path sees:
//!
//! - small JPEG (logos / icons that fall under the withoutEnlargement
//!   clamp)
//! - medium PNG (typical card-sized hero on a non-retina screen)
//! - large WebP (the upper-bound case — 1920×1080 input that the
//!   variant pipeline downscales to 800w + emits AVIF for)
//! - portrait JPEG (the orientation-aware path — exercises auto_orient
//!   + the variant resize math when source aspect differs from target)
//! - transparent PNG (the alpha-aware encode path)
//!
//! Each fixture runs the production variant set (uploadResponsiveVariantSet
//! mirror: 200/400/800w × WebP+AVIF + one fallback) plus the placeholder
//! flag, mirroring what /api/upload pushes through `processImage` today.
//! Numbers go in `bench/images/results/` when the human runs the harness;
//! see `bench/images/README.md`.

use std::io::Cursor;

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use image::{codecs::png::PngEncoder, ColorType, ExtendedColorType, ImageEncoder, Rgba, RgbaImage};

use openlen_images::pipeline::{process_image, Format, ProcessRequest, Variant};

// ─── Fixture generators ────────────────────────────────────────────────────

/// Encode an RGBA buffer to PNG (smallest in-memory fixture format we can
/// generate with zero extra deps). Used by all fixtures except small JPEG.
fn rgba_to_png(img: &RgbaImage) -> Vec<u8> {
    let mut bytes = Vec::with_capacity((img.width() * img.height()) as usize);
    PngEncoder::new(&mut bytes)
        .write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            ExtendedColorType::Rgba8,
        )
        .expect("png encode");
    bytes
}

/// Encode an RGB buffer to JPEG via image-rs. Skipping the alpha channel
/// because JPEG can't carry one anyway, and the bench's "small JPEG"
/// fixture is the one we explicitly want as a JPEG.
fn rgba_to_jpeg(img: &RgbaImage, quality: u8) -> Vec<u8> {
    let mut rgb = Vec::with_capacity((img.width() * img.height() * 3) as usize);
    for px in img.pixels() {
        rgb.push(px.0[0]);
        rgb.push(px.0[1]);
        rgb.push(px.0[2]);
    }
    let mut out = Vec::with_capacity(rgb.len() / 4);
    image::codecs::jpeg::JpegEncoder::new_with_quality(Cursor::new(&mut out), quality)
        .encode(&rgb, img.width(), img.height(), ColorType::Rgb8.into())
        .expect("jpeg encode");
    out
}

/// Build a radial-gradient RGBA buffer of the given dimensions. Synthetic
/// but visually nontrivial — the histogram + encoder paths get real work
/// (vs. a solid-color shortcut that compresses to nothing).
fn radial_gradient(w: u32, h: u32) -> RgbaImage {
    let cx = w as f32 / 2.0;
    let cy = h as f32 / 2.0;
    let max_r = (cx * cx + cy * cy).sqrt();
    RgbaImage::from_fn(w, h, |x, y| {
        let dx = x as f32 - cx;
        let dy = y as f32 - cy;
        let r = (dx * dx + dy * dy).sqrt() / max_r;
        // Hue rotates with angle; brightness falls off with radius. Keeps
        // the encoder honest by producing both color and luminance variation.
        let h = (dy.atan2(dx) + std::f32::consts::PI) / (2.0 * std::f32::consts::PI);
        let (r8, g8, b8) = hue_to_rgb(h, 1.0 - r * 0.5);
        Rgba([r8, g8, b8, 255])
    })
}

/// Same as `radial_gradient` but with a soft radial alpha drop-off.
/// Exercises the alpha-aware encode path on a non-trivial alpha mask.
fn radial_gradient_alpha(w: u32, h: u32) -> RgbaImage {
    let cx = w as f32 / 2.0;
    let cy = h as f32 / 2.0;
    let max_r = (cx * cx + cy * cy).sqrt();
    RgbaImage::from_fn(w, h, |x, y| {
        let dx = x as f32 - cx;
        let dy = y as f32 - cy;
        let r = (dx * dx + dy * dy).sqrt() / max_r;
        let h = (dy.atan2(dx) + std::f32::consts::PI) / (2.0 * std::f32::consts::PI);
        let (r8, g8, b8) = hue_to_rgb(h, 1.0);
        // Quadratic falloff so the alpha mask is visible but the centre
        // stays opaque.
        let a = (1.0 - r * r).max(0.0);
        Rgba([r8, g8, b8, (a * 255.0) as u8])
    })
}

/// HSV-to-RGB on the (h, v) axis with s=1. Fast and good enough for
/// fixture generation.
fn hue_to_rgb(h: f32, v: f32) -> (u8, u8, u8) {
    let h6 = h * 6.0;
    let i = h6.floor() as i32;
    let f = h6 - h6.floor();
    let p = 0.0;
    let q = 1.0 - f;
    let t = f;
    let (r, g, b) = match i.rem_euclid(6) {
        0 => (1.0, t, p),
        1 => (q, 1.0, p),
        2 => (p, 1.0, t),
        3 => (p, q, 1.0),
        4 => (t, p, 1.0),
        _ => (1.0, p, q),
    };
    let scale = (v * 255.0).clamp(0.0, 255.0);
    (
        (r * scale) as u8,
        (g * scale) as u8,
        (b * scale) as u8,
    )
}

// ─── Production variant spec (mirrors uploadResponsiveVariantSet) ──────────

/// Seven-variant set matching `/api/upload`'s production pipeline:
/// 200/400/800w × WebP+AVIF (6 variants) + one JPEG fallback at 800w.
/// Hand-rolled here (vs. importing from lib/images.ts) so the bench
/// is a single-crate compile with no JS boundary.
fn upload_variants() -> Vec<Variant> {
    let mut v = Vec::with_capacity(7);
    for w in [200u32, 400, 800] {
        v.push(Variant {
            width: w,
            max_height: None,
            format: Format::Webp,
            quality: 82,
            alpha_quality: None,
        });
        v.push(Variant {
            width: w,
            max_height: None,
            format: Format::Avif,
            quality: 65,
            alpha_quality: None,
        });
    }
    v.push(Variant {
        width: 800,
        max_height: None,
        format: Format::Jpeg,
        quality: 85,
        alpha_quality: None,
    });
    v
}

fn build_request(input: Vec<u8>, placeholder: bool) -> ProcessRequest {
    ProcessRequest {
        input,
        variants: upload_variants(),
        auto_orient: true,
        without_enlargement: true,
        placeholder,
    }
}

// ─── Bench groups ─────────────────────────────────────────────────────────

fn bench_pipeline(c: &mut Criterion) {
    // Lazy-instantiate fixtures so the cost of building them doesn't
    // count toward each iteration's wall time. Criterion's `iter` clones
    // the closure per-iteration, but the bytes Vec is moved-into the
    // request each call; we re-build the request per iteration from a
    // shared bytes Vec via clone.
    let small_jpeg = rgba_to_jpeg(&radial_gradient(200, 200), 85);
    let medium_png = rgba_to_png(&radial_gradient(800, 600));
    let large_png = rgba_to_png(&radial_gradient(1920, 1080)); // re-decoded as PNG
    let portrait_jpeg = rgba_to_jpeg(&radial_gradient(800, 1200), 85);
    let transparent_png = rgba_to_png(&radial_gradient_alpha(800, 800));

    let fixtures: [(&str, &[u8]); 5] = [
        ("small-jpeg-200x200", &small_jpeg),
        ("medium-png-800x600", &medium_png),
        ("large-png-1920x1080", &large_png),
        ("portrait-jpeg-800x1200", &portrait_jpeg),
        ("transparent-png-800x800", &transparent_png),
    ];

    let mut group = c.benchmark_group("pipeline/upload-variants");
    // Output throughput as bytes/sec so the chart axis is comparable
    // between fixtures — small fixtures bench faster per-call but the
    // bytes/sec normalises for input size.
    for (name, bytes) in fixtures {
        group.throughput(criterion::Throughput::Bytes(bytes.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), &bytes, |b, bytes| {
            b.iter(|| {
                let req = build_request(bytes.to_vec(), false);
                process_image(black_box(req)).expect("process_image succeeds")
            });
        });
    }
    group.finish();

    let mut placeholder_group = c.benchmark_group("pipeline/upload-variants+placeholder");
    for (name, bytes) in fixtures {
        placeholder_group.throughput(criterion::Throughput::Bytes(bytes.len() as u64));
        placeholder_group.bench_with_input(
            BenchmarkId::from_parameter(name),
            &bytes,
            |b, bytes| {
                b.iter(|| {
                    let req = build_request(bytes.to_vec(), true);
                    process_image(black_box(req)).expect("process_image succeeds")
                });
            },
        );
    }
    placeholder_group.finish();
}

fn bench_placeholder_isolated(c: &mut Criterion) {
    // Isolate compute_placeholder on top of an already-decoded RgbaImage.
    // This excludes decode + encode overhead so we measure just the
    // BlurHash + histogram work — the marginal cost of the new flag.
    use openlen_images::compute_placeholder;
    let inputs = [
        ("256x256", radial_gradient(256, 256)),
        ("1024x768", radial_gradient(1024, 768)),
        ("1920x1080", radial_gradient(1920, 1080)),
    ];
    let mut group = c.benchmark_group("placeholder/isolated");
    for (name, img) in &inputs {
        group.bench_with_input(BenchmarkId::from_parameter(name), img, |b, img| {
            b.iter(|| compute_placeholder(black_box(img)).expect("placeholder"));
        });
    }
    group.finish();
}

criterion_group!(benches, bench_pipeline, bench_placeholder_isolated);
criterion_main!(benches);
