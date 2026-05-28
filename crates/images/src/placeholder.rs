//! Placeholder extraction — BlurHash string + dominant color.
//!
//! Both signals are computed from a small thumbnail (downsampled with the
//! same Lanczos3 primitive used by the variant pipeline) so the work is
//! cheap even on large inputs. BlurHash is opt-in at the `process_image`
//! call site; pages that ship many images want it to render a blurred
//! preview while the real bytes are still in flight.
//!
//! Dominant color uses a 4-bit-per-channel histogram (4096 buckets). It's
//! O(N) over the thumbnail (~1024 pixels at 32×32) so the runtime cost is
//! negligible vs. the resize that fed it. The output is the centroid of
//! the most-populous bucket, formatted as a `#RRGGBB` hex string suitable
//! for inline `style.backgroundColor`.

use crate::error::ImageError;
use crate::resize::resize_lanczos3;
use image::RgbaImage;
use std::borrow::Cow;

/// Compact, sendable summary of an image suitable for `style.backgroundColor`
/// + `<img>` blurhash placeholder rendering on the client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placeholder {
    /// BlurHash string (Woltapp format). Decode client-side with
    /// `blurhash-canvas` (Web) or `react-blurhash`. ~30 chars at 4×3.
    pub blurhash: String,
    /// Hex `#RRGGBB` of the thumbnail's dominant color bucket. The picker
    /// uses this as `style.backgroundColor` for the `<img>` while the
    /// real bytes load, so the layout box is non-white before paint.
    pub dominant_color: String,
    /// Width of the thumbnail the BlurHash + color were computed from.
    /// Exposed so the client can re-render the BlurHash at the same
    /// aspect ratio without re-deriving it from the source image.
    pub width: u32,
    /// Height of the thumbnail (paired with `width`).
    pub height: u32,
}

/// BlurHash components. `4×3` is the standard recommendation for landscape
/// imagery (the Woltapp readme picks the same default); the count drives
/// the encoded string length (~30 chars). Square / portrait inputs still
/// look fine — the components describe spatial-frequency basis functions,
/// not a literal pixel grid.
const BLURHASH_X: u32 = 4;
const BLURHASH_Y: u32 = 3;

/// Target longest edge for the placeholder thumbnail. 32 px keeps BlurHash
/// encoding under ~1 ms and the histogram walk under ~30 µs.
const THUMB_LONGEST_EDGE: u32 = 32;

/// Bucket count per channel for the dominant-color histogram.
/// 4 bits per channel → 16 levels → 16³ = 4096 buckets. Wide enough to
/// separate skin tone from sky on a typical hero image; narrow enough that
/// even a 1024-pixel thumb populates the dominant bucket cleanly.
const HIST_BITS: u8 = 4;

/// Alpha threshold below which a pixel is treated as transparent and
/// skipped from the dominant-color histogram. Matches the BlurHash spec's
/// "alpha is collapsed to RGB" approach without leaking transparent-pixel
/// noise into the color average.
const ALPHA_MIN: u8 = 16;

/// Compute a placeholder for the given image.
///
/// The input is downsampled to a ~32 px longest-edge thumb (Lanczos3) and
/// both signals are derived from the thumb. BlurHash encoding is the
/// dominant cost.
pub fn compute_placeholder(img: &RgbaImage) -> Result<Placeholder, ImageError> {
    let (orig_w, orig_h) = (img.width(), img.height());
    if orig_w == 0 || orig_h == 0 {
        return Err(ImageError::InvalidInput(format!(
            "placeholder source has zero dimensions ({orig_w}×{orig_h})"
        )));
    }

    let (thumb_w, thumb_h) = thumb_dimensions(orig_w, orig_h);
    // Skip the resize when the source is already at or below the thumb
    // budget — avoids a needless allocation + Lanczos pass on icons.
    let thumb: Cow<'_, RgbaImage> = if (thumb_w, thumb_h) == (orig_w, orig_h) {
        Cow::Borrowed(img)
    } else {
        Cow::Owned(resize_lanczos3(img, thumb_w, thumb_h))
    };

    let blurhash = compute_blurhash(&thumb)?;
    let dominant_color = compute_dominant_color(&thumb);

    Ok(Placeholder {
        blurhash,
        dominant_color,
        width: thumb.width(),
        height: thumb.height(),
    })
}

/// Pick the thumb's target dimensions given the source aspect ratio. We
/// scale so the LONGEST edge lands at `THUMB_LONGEST_EDGE`, preserving
/// aspect. Both edges are clamped to `>= 1` for the degenerate-input case.
fn thumb_dimensions(orig_w: u32, orig_h: u32) -> (u32, u32) {
    let longest = orig_w.max(orig_h).max(1);
    if longest <= THUMB_LONGEST_EDGE {
        return (orig_w, orig_h);
    }
    let scale = THUMB_LONGEST_EDGE as f64 / longest as f64;
    let w = ((orig_w as f64 * scale).round() as u32).max(1);
    let h = ((orig_h as f64 * scale).round() as u32).max(1);
    (w, h)
}

fn compute_blurhash(img: &RgbaImage) -> Result<String, ImageError> {
    blurhash::encode(BLURHASH_X, BLURHASH_Y, img.width(), img.height(), img.as_raw()).map_err(
        |e| ImageError::Encode {
            format: "blurhash",
            message: e.to_string(),
        },
    )
}

/// Dominant color via 4-bit-per-channel histogram. Walks the thumbnail's
/// RGBA pixels once; ignores fully (or near-fully) transparent ones; finds
/// the most-populous (R, G, B) bucket and returns its centroid as a hex
/// string.
///
/// Why not "average RGB"? Averaging muddies high-contrast inputs (a
/// black-and-white photo averages to gray, hiding the dominant tone the
/// viewer actually perceives). A histogram preserves the modal color even
/// when there's a high-contrast minority.
fn compute_dominant_color(img: &RgbaImage) -> String {
    let buckets_per_channel = 1u32 << HIST_BITS;
    let total_buckets = (buckets_per_channel * buckets_per_channel * buckets_per_channel) as usize;
    let mut hist = vec![0u32; total_buckets];
    let mut counted = 0u32;
    let shift = 8 - HIST_BITS;
    for px in img.pixels() {
        if px.0[3] < ALPHA_MIN {
            continue;
        }
        let r = (px.0[0] >> shift) as u32;
        let g = (px.0[1] >> shift) as u32;
        let b = (px.0[2] >> shift) as u32;
        let idx = ((r << (HIST_BITS * 2)) | (g << HIST_BITS) | b) as usize;
        hist[idx] += 1;
        counted += 1;
    }

    if counted == 0 {
        // Fully-transparent input. Use black as a neutral default — any
        // background-color paint over a transparent loader will compose
        // correctly with the user's page background anyway.
        return "#000000".to_string();
    }

    let (best_idx, _) = hist
        .iter()
        .enumerate()
        .max_by_key(|(_, c)| **c)
        .expect("hist has at least one entry");

    let mask = (1u32 << HIST_BITS) - 1;
    let r4 = ((best_idx as u32) >> (HIST_BITS * 2)) & mask;
    let g4 = ((best_idx as u32) >> HIST_BITS) & mask;
    let b4 = (best_idx as u32) & mask;
    // Re-expand each 4-bit channel to 8-bit. Midpoint of the bucket
    // (left-shift then OR-in 0x8) gives the centroid, matching the
    // "centre of the bucket" semantics.
    let r8 = ((r4 << shift) | (1 << (shift - 1))) as u8;
    let g8 = ((g4 << shift) | (1 << (shift - 1))) as u8;
    let b8 = ((b4 << shift) | (1 << (shift - 1))) as u8;
    format!("#{:02x}{:02x}{:02x}", r8, g8, b8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn solid(w: u32, h: u32, px: [u8; 4]) -> RgbaImage {
        RgbaImage::from_fn(w, h, |_, _| Rgba(px))
    }

    #[test]
    fn thumb_dimensions_passes_through_small_input() {
        assert_eq!(thumb_dimensions(20, 20), (20, 20));
        assert_eq!(thumb_dimensions(32, 32), (32, 32));
        assert_eq!(thumb_dimensions(1, 1), (1, 1));
    }

    #[test]
    fn thumb_dimensions_scales_landscape_to_longest_edge() {
        // 200×100 → longest edge 200 → scale 0.16 → 32×16.
        assert_eq!(thumb_dimensions(200, 100), (32, 16));
    }

    #[test]
    fn thumb_dimensions_scales_portrait_to_longest_edge() {
        // 100×200 → longest 200 → 16×32.
        assert_eq!(thumb_dimensions(100, 200), (16, 32));
    }

    #[test]
    fn thumb_dimensions_clamps_min_one() {
        // 1000×10 → scale 0.032 → 32×~0.32 → clamped to (32, 1).
        let (w, h) = thumb_dimensions(1000, 10);
        assert_eq!(w, 32);
        assert!(h >= 1, "got {h}");
    }

    #[test]
    fn placeholder_for_solid_red_returns_red_dominant() {
        // Solid red input → dominant bucket is the high-red bucket.
        let img = solid(64, 64, [255, 0, 0, 255]);
        let p = compute_placeholder(&img).expect("placeholder");
        // The 4-bit centroid of [240..256) on the high end is 0xF8.
        assert_eq!(p.dominant_color, "#f80808");
        // BlurHash strings are at least 6 chars (single-component encoding);
        // 4×3 components → ~30 chars.
        assert!(p.blurhash.len() >= 20, "got {:?}", p.blurhash);
        assert_eq!(p.width, 32);
        assert_eq!(p.height, 32);
    }

    #[test]
    fn placeholder_for_solid_blue_returns_blue_dominant() {
        let img = solid(64, 64, [0, 0, 200, 255]);
        let p = compute_placeholder(&img).expect("placeholder");
        // 200 → bucket 12 (0xC0..0xD0) → centroid 0xC8.
        assert_eq!(p.dominant_color, "#0808c8");
    }

    #[test]
    fn placeholder_skips_fully_transparent_pixels() {
        // RGBA with alpha 0 — should fall back to "#000000" because no
        // pixel meets ALPHA_MIN.
        let img = solid(8, 8, [200, 100, 50, 0]);
        let p = compute_placeholder(&img).expect("placeholder");
        assert_eq!(p.dominant_color, "#000000");
    }

    #[test]
    fn placeholder_dominant_color_is_deterministic() {
        // Same input → same color, every time. Important for test fixtures
        // and for the regression-bench harness.
        let img = solid(64, 64, [120, 80, 200, 255]);
        let a = compute_placeholder(&img).expect("a").dominant_color;
        let b = compute_placeholder(&img).expect("b").dominant_color;
        assert_eq!(a, b);
    }

    #[test]
    fn placeholder_blurhash_is_deterministic() {
        let img = solid(64, 64, [60, 180, 120, 255]);
        let a = compute_placeholder(&img).expect("a").blurhash;
        let b = compute_placeholder(&img).expect("b").blurhash;
        assert_eq!(a, b);
    }

    #[test]
    fn placeholder_rejects_zero_dim_input() {
        // RgbaImage::from_fn with w=0 produces a zero-sized image.
        let img = RgbaImage::new(0, 0);
        assert!(matches!(
            compute_placeholder(&img),
            Err(ImageError::InvalidInput(_))
        ));
    }

    #[test]
    fn placeholder_preserves_landscape_aspect() {
        // 200×100 → thumb 32×16 → blurhash + color reflect that aspect.
        let img = solid(200, 100, [50, 150, 250, 255]);
        let p = compute_placeholder(&img).expect("placeholder");
        assert_eq!(p.width, 32);
        assert_eq!(p.height, 16);
    }

    #[test]
    fn placeholder_for_two_color_input_picks_majority_color() {
        // 80% red, 20% green. Histogram should pick the red bucket.
        let img = RgbaImage::from_fn(50, 50, |_, y| {
            if y < 40 {
                Rgba([200, 30, 30, 255])
            } else {
                Rgba([30, 200, 30, 255])
            }
        });
        let p = compute_placeholder(&img).expect("placeholder");
        // 200 → bucket 12 (0xC0..0xD0) → centroid 0xC8 for the dominant red.
        assert!(
            p.dominant_color.starts_with("#c8"),
            "expected red-dominant centroid, got {}",
            p.dominant_color
        );
    }
}
