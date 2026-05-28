//! Variant pipeline.
//!
//! One decode + one resize-per-unique-width + N encodes. The pipeline is
//! the only `pub` entry point most callers need (napi exposes only this);
//! the per-format encoders + resize primitive are exported for the few
//! callers that want raw access.

use crate::encoders;
use crate::error::ImageError;
use crate::exif;
use crate::placeholder::{self, Placeholder};
use crate::resize;
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Format {
    Webp,
    Avif,
    Jpeg,
    Png,
}

impl Format {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Webp => "webp",
            Self::Avif => "avif",
            Self::Jpeg => "jpeg",
            Self::Png => "png",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Self::Webp => "image/webp",
            Self::Avif => "image/avif",
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "webp" => Some(Self::Webp),
            "avif" => Some(Self::Avif),
            "jpeg" | "jpg" => Some(Self::Jpeg),
            "png" => Some(Self::Png),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Variant {
    /// Target max width in pixels. `0` means "use the input's intrinsic
    /// width" (skip resize). Aspect ratio is always preserved.
    pub width: u32,
    /// Optional companion bound on the height. When present, the variant
    /// is scaled by the SMALLER of (width/orig_w) and (max_height/orig_h)
    /// — sharp's `{ width, height, fit: 'inside' }` semantics. Use this
    /// to fit a portrait-oriented input inside a square bounding box.
    /// `None` (the default) leaves the height unbounded.
    pub max_height: Option<u32>,
    pub format: Format,
    /// Encoder quality 1..=100. Ignored for PNG (lossless).
    pub quality: u8,
}

#[derive(Debug, Clone)]
pub struct ProcessRequest {
    pub input: Vec<u8>,
    pub variants: Vec<Variant>,
    /// Read the EXIF Orientation tag and rotate before resizing. Mirrors
    /// sharp's `.rotate()` call without arguments.
    pub auto_orient: bool,
    /// Sharp parity for `withoutEnlargement: true`: a variant whose target
    /// width >= the input's intrinsic width falls back to the original.
    pub without_enlargement: bool,
    /// When `true`, compute a [`Placeholder`] (BlurHash + dominant color)
    /// from the oriented source and attach it to [`ProcessResult::placeholder`].
    /// Opt-in because the BlurHash encode adds ~1 ms even on a small thumb
    /// and not every consumer needs it (server-side optimize jobs that just
    /// rewrite an asset don't care about LQIP).
    pub placeholder: bool,
}

#[derive(Debug, Clone)]
pub struct VariantOutput {
    pub width: u32,
    pub height: u32,
    pub format: Format,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ProcessResult {
    pub variants: Vec<VariantOutput>,
    /// Present when [`ProcessRequest::placeholder`] was `true`. Carries
    /// the BlurHash + dominant color computed from the oriented source,
    /// suitable for `style.backgroundColor` + `<img>` LQIP rendering.
    pub placeholder: Option<Placeholder>,
}

/// Effective output dimensions given the variant's bounds and the input
/// dimensions. Mirrors sharp's `fit: 'inside'` semantics when `max_height`
/// is set: scale by whichever of (width/orig_w, max_height/orig_h) is
/// smaller, so neither bound is exceeded.
fn effective_dimensions(
    v: &Variant,
    orig_w: u32,
    orig_h: u32,
    without_enlargement: bool,
) -> (u32, u32) {
    let width_unset = v.width == 0;
    let target_w = if width_unset { orig_w } else { v.width };

    // Aspect math is done in f64 to avoid overflow on large inputs and to
    // keep rounding error tiny; we round-to-nearest at the end.
    let scale_w = if width_unset {
        1.0
    } else {
        target_w as f64 / orig_w.max(1) as f64
    };
    let scale_h = match v.max_height {
        Some(h) => h as f64 / orig_h.max(1) as f64,
        None => f64::INFINITY,
    };
    // Pick the tighter bound. When max_height is None, scale_h is infinity
    // so scale_w wins as expected.
    let mut scale = scale_w.min(scale_h);

    if without_enlargement && scale > 1.0 {
        scale = 1.0;
    }

    let out_w = ((orig_w as f64 * scale).round() as u32).max(1);
    let out_h = ((orig_h as f64 * scale).round() as u32).max(1);
    (out_w, out_h)
}

pub fn process_image(req: ProcessRequest) -> Result<ProcessResult, ImageError> {
    if req.input.is_empty() {
        return Err(ImageError::InvalidInput("empty input".into()));
    }
    if req.variants.is_empty() {
        return Err(ImageError::InvalidInput(
            "variants must not be empty".into(),
        ));
    }

    // 1. Decode once.
    let decoded =
        image::load_from_memory(&req.input).map_err(|e| ImageError::Decode(e.to_string()))?;

    // 2. EXIF rotate if requested.
    let oriented = if req.auto_orient {
        let orientation = exif::read_orientation(&req.input);
        exif::apply_orientation(decoded, orientation)
    } else {
        decoded
    };

    let base: RgbaImage = oriented.to_rgba8();
    let (orig_w, orig_h) = (base.width(), base.height());
    if orig_w == 0 || orig_h == 0 {
        return Err(ImageError::Decode(format!(
            "decoded image has zero dimensions ({}×{})",
            orig_w, orig_h
        )));
    }

    // Placeholder is opt-in. Computed from the oriented base so the
    // BlurHash + dominant color match what the variants will render.
    // Done before the variant resize cache to keep the work close to the
    // decode (warm CPU cache on the RGBA buffer).
    let placeholder = if req.placeholder {
        Some(placeholder::compute_placeholder(&base)?)
    } else {
        None
    };

    // 3. Collect the unique set of (out_w, out_h) pairs that need a resize.
    //    Cache by both dims — two variants with the same width but different
    //    max_height bounds can legitimately resolve to different sizes.
    //    BTreeSet keeps iteration deterministic — handy for tests.
    let mut dims: BTreeSet<(u32, u32)> = BTreeSet::new();
    for v in &req.variants {
        let (w, h) = effective_dimensions(v, orig_w, orig_h, req.without_enlargement);
        if (w, h) != (orig_w, orig_h) {
            dims.insert((w, h));
        }
    }

    // 4. Materialise each non-original (w, h) once.
    let mut cache: HashMap<(u32, u32), RgbaImage> = HashMap::with_capacity(dims.len());
    for (w, h) in dims {
        let resized = resize::resize_lanczos3(&base, w, h);
        cache.insert((w, h), resized);
    }

    // 5. Encode every variant. Sharp parity: even if two variants share
    //    the same (width, format, quality), they're encoded separately —
    //    the caller asked for N outputs, they get N. Encoding is the
    //    cheapest step here (resize dominates), so duplication is rare
    //    and the dedup logic isn't worth its complexity cost.
    let mut outputs = Vec::with_capacity(req.variants.len());
    for v in &req.variants {
        let (w, h) = effective_dimensions(v, orig_w, orig_h, req.without_enlargement);
        let resized: &RgbaImage = if (w, h) == (orig_w, orig_h) {
            &base
        } else {
            cache.get(&(w, h)).expect("pre-computed in step 4")
        };
        let (rw, rh) = (resized.width(), resized.height());
        let bytes = match v.format {
            Format::Webp => encoders::webp::encode(resized, v.quality)?,
            Format::Avif => encoders::avif::encode(resized, v.quality)?,
            Format::Jpeg => encoders::jpeg::encode(resized, v.quality)?,
            // PNG ignores the quality knob; the variant-level setting
            // wouldn't change the output. Always optimize via oxipng.
            Format::Png => encoders::png::encode(resized, true)?,
        };
        outputs.push(VariantOutput {
            width: rw,
            height: rh,
            format: v.format,
            bytes,
        });
    }

    Ok(ProcessResult {
        variants: outputs,
        placeholder,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_png(w: u32, h: u32, px: [u8; 4]) -> Vec<u8> {
        use image::{ImageEncoder, Rgba, RgbaImage};
        let img = RgbaImage::from_fn(w, h, |_, _| Rgba(px));
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8)
            .unwrap();
        bytes
    }

    #[test]
    fn empty_input_errors() {
        let r = process_image(ProcessRequest {
            input: vec![],
            variants: vec![Variant {
                width: 100,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: true,
            without_enlargement: true,
            placeholder: false,
        });
        assert!(matches!(r, Err(ImageError::InvalidInput(_))));
    }

    #[test]
    fn no_variants_errors() {
        let r = process_image(ProcessRequest {
            input: solid_png(10, 10, [0, 0, 0, 255]),
            variants: vec![],
            auto_orient: true,
            without_enlargement: true,
            placeholder: false,
        });
        assert!(matches!(r, Err(ImageError::InvalidInput(_))));
    }

    #[test]
    fn corrupt_input_errors_decode() {
        let r = process_image(ProcessRequest {
            input: b"not actually an image".to_vec(),
            variants: vec![Variant {
                width: 100,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: true,
            without_enlargement: true,
            placeholder: false,
        });
        assert!(matches!(r, Err(ImageError::Decode(_))));
    }

    #[test]
    fn single_variant_round_trip_preserves_aspect() {
        let input = solid_png(200, 100, [128, 64, 200, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 100,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        assert_eq!(r.variants.len(), 1);
        assert_eq!(r.variants[0].width, 100);
        // 200×100 scaled to width 100 → height 50.
        assert_eq!(r.variants[0].height, 50);
        assert!(!r.variants[0].bytes.is_empty());
        assert_eq!(r.variants[0].format, Format::Webp);
    }

    #[test]
    fn multi_format_same_width_dedups_resize() {
        // Sanity: requesting three formats at the same target width should
        // succeed and produce three outputs. The dedup is internal and
        // not observable; this test is the high-level smoke.
        let input = solid_png(200, 100, [200, 50, 50, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![
                Variant {
                    width: 100,
                    max_height: None,
                    format: Format::Webp,
                    quality: 80,
                },
                Variant {
                    width: 100,
                    max_height: None,
                    format: Format::Avif,
                    quality: 65,
                },
                Variant {
                    width: 100,
                    max_height: None,
                    format: Format::Jpeg,
                    quality: 85,
                },
            ],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        assert_eq!(r.variants.len(), 3);
        for v in &r.variants {
            assert_eq!(v.width, 100);
            assert_eq!(v.height, 50);
            assert!(!v.bytes.is_empty());
        }
        assert_eq!(r.variants[0].format, Format::Webp);
        assert_eq!(r.variants[1].format, Format::Avif);
        assert_eq!(r.variants[2].format, Format::Jpeg);
    }

    #[test]
    fn without_enlargement_clamps_to_original() {
        let input = solid_png(100, 50, [0, 200, 0, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 800,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        // Asked for 800w but input is 100w → withoutEnlargement keeps 100w.
        assert_eq!(r.variants[0].width, 100);
        assert_eq!(r.variants[0].height, 50);
    }

    #[test]
    fn width_zero_uses_original_size() {
        let input = solid_png(80, 40, [50, 50, 50, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 0,
                max_height: None,
                format: Format::Png,
                quality: 0,
            }],
            auto_orient: false,
            without_enlargement: false,
            placeholder: false,
        })
        .unwrap();
        assert_eq!(r.variants[0].width, 80);
        assert_eq!(r.variants[0].height, 40);
    }

    #[test]
    fn multiple_widths_produce_correct_dimensions() {
        let input = solid_png(400, 200, [120, 30, 60, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![
                Variant {
                    width: 200,
                    max_height: None,
                    format: Format::Webp,
                    quality: 80,
                },
                Variant {
                    width: 100,
                    max_height: None,
                    format: Format::Webp,
                    quality: 80,
                },
                Variant {
                    width: 50,
                    max_height: None,
                    format: Format::Webp,
                    quality: 80,
                },
            ],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        assert_eq!(
            r.variants
                .iter()
                .map(|v| (v.width, v.height))
                .collect::<Vec<_>>(),
            vec![(200, 100), (100, 50), (50, 25)]
        );
    }

    #[test]
    fn format_parse_accepts_jpg_alias() {
        assert_eq!(Format::parse("jpg"), Some(Format::Jpeg));
        assert_eq!(Format::parse("JPEG"), Some(Format::Jpeg));
        assert_eq!(Format::parse("png"), Some(Format::Png));
        assert_eq!(Format::parse("bmp"), None);
    }

    #[test]
    fn max_height_constraint_wins_for_tall_input() {
        // 100×400 portrait input with bounds (200, 200, fit: inside).
        // Width bound alone would scale up to 200×800 (clamped by
        // withoutEnlargement back to 100×400). Height bound forces
        // scale = 200/400 = 0.5 → 50×200.
        let input = solid_png(100, 400, [120, 60, 30, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 200,
                max_height: Some(200),
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        assert_eq!(r.variants[0].width, 50);
        assert_eq!(r.variants[0].height, 200);
    }

    #[test]
    fn max_height_constraint_with_landscape_input_keeps_width_bound() {
        // 400×100 landscape, bounds (200, 200). Width bound is tighter
        // (200/400 = 0.5) and gives 200×50; height bound 200/100=2.0 is
        // looser. Output should track the width bound.
        let input = solid_png(400, 100, [60, 120, 30, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 200,
                max_height: Some(200),
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        assert_eq!(r.variants[0].width, 200);
        assert_eq!(r.variants[0].height, 50);
    }

    #[test]
    fn max_height_none_matches_pre_max_height_behaviour() {
        // Sanity: a variant with max_height: None should produce exactly
        // the same dimensions as the legacy width-only API.
        let input = solid_png(400, 200, [10, 20, 30, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 200,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        assert_eq!(r.variants[0].width, 200);
        assert_eq!(r.variants[0].height, 100);
    }

    #[test]
    fn placeholder_flag_off_leaves_result_field_none() {
        let input = solid_png(100, 50, [120, 60, 200, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 50,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
            placeholder: false,
        })
        .unwrap();
        assert!(r.placeholder.is_none(), "expected None, got {:?}", r.placeholder);
    }

    #[test]
    fn placeholder_flag_on_populates_result_field() {
        let input = solid_png(200, 100, [60, 180, 240, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 100,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
            placeholder: true,
        })
        .unwrap();
        let p = r.placeholder.expect("placeholder requested but None");
        // Solid 60/180/240 → blue-cyan bucket. The histogram-centroid hex
        // is deterministic; verifying the prefix is enough to know the
        // dominant-color path ran (vs. defaulting to #000000).
        assert!(p.dominant_color.starts_with('#'));
        assert_eq!(p.dominant_color.len(), 7);
        assert_ne!(p.dominant_color, "#000000");
        assert!(!p.blurhash.is_empty());
        // 200×100 input → 32×16 thumb (longest-edge scaling).
        assert_eq!(p.width, 32);
        assert_eq!(p.height, 16);
    }

    #[test]
    fn placeholder_uses_oriented_base_not_raw_decode() {
        // Smoke: with auto_orient=true, placeholder is computed on the
        // post-rotate image, so a portrait EXIF-tagged input produces
        // a portrait-thumb placeholder. PNG fixture has no EXIF so the
        // base test is a no-op rotation; this guarantees the placeholder
        // dimensions track the variants pipeline's "base" buffer.
        let input = solid_png(400, 100, [200, 80, 80, 255]);
        let r = process_image(ProcessRequest {
            input,
            variants: vec![Variant {
                width: 200,
                max_height: None,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: true,
            without_enlargement: true,
            placeholder: true,
        })
        .unwrap();
        let p = r.placeholder.expect("placeholder requested but None");
        // 400×100 (landscape, longest edge 400) → thumb 32×8.
        assert_eq!(p.width, 32);
        assert_eq!(p.height, 8);
    }
}
