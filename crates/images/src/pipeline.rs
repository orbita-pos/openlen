//! Variant pipeline.
//!
//! One decode + one resize-per-unique-width + N encodes. The pipeline is
//! the only `pub` entry point most callers need (napi exposes only this);
//! the per-format encoders + resize primitive are exported for the few
//! callers that want raw access.

use crate::encoders;
use crate::error::ImageError;
use crate::exif;
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
}

/// Effective target width given the input dims and the request flags.
fn effective_width(requested: u32, orig_w: u32, without_enlargement: bool) -> u32 {
    if requested == 0 {
        return orig_w;
    }
    if without_enlargement && requested >= orig_w {
        return orig_w;
    }
    requested
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

    // 3. Collect the unique set of target widths that need a resize.
    //    BTreeSet keeps iteration deterministic — handy for tests.
    let mut widths: BTreeSet<u32> = BTreeSet::new();
    for v in &req.variants {
        let w = effective_width(v.width, orig_w, req.without_enlargement);
        if w != orig_w {
            widths.insert(w);
        }
    }

    // 4. Materialise each non-original width once.
    let mut cache: HashMap<u32, RgbaImage> = HashMap::with_capacity(widths.len());
    for w in widths {
        let h = ((orig_h as u64 * w as u64) / orig_w.max(1) as u64).max(1) as u32;
        let resized = resize::resize_lanczos3(&base, w, h);
        cache.insert(w, resized);
    }

    // 5. Encode every variant. Sharp parity: even if two variants share
    //    the same (width, format, quality), they're encoded separately —
    //    the caller asked for N outputs, they get N. Encoding is the
    //    cheapest step here (resize dominates), so duplication is rare
    //    and the dedup logic isn't worth its complexity cost.
    let mut outputs = Vec::with_capacity(req.variants.len());
    for v in &req.variants {
        let w = effective_width(v.width, orig_w, req.without_enlargement);
        let resized: &RgbaImage = if w == orig_w {
            &base
        } else {
            cache.get(&w).expect("pre-computed in step 4")
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

    Ok(ProcessResult { variants: outputs })
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
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: true,
            without_enlargement: true,
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
        });
        assert!(matches!(r, Err(ImageError::InvalidInput(_))));
    }

    #[test]
    fn corrupt_input_errors_decode() {
        let r = process_image(ProcessRequest {
            input: b"not actually an image".to_vec(),
            variants: vec![Variant {
                width: 100,
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: true,
            without_enlargement: true,
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
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
        })
        .unwrap();
        assert_eq!(r.variants.len(), 1);
        assert_eq!(r.variants[0].width, 100);
        // 200×100 scaled to width 100 → height 50.
        assert_eq!(r.variants[0].height, 50);
        assert!(r.variants[0].bytes.len() > 0);
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
                    format: Format::Webp,
                    quality: 80,
                },
                Variant {
                    width: 100,
                    format: Format::Avif,
                    quality: 65,
                },
                Variant {
                    width: 100,
                    format: Format::Jpeg,
                    quality: 85,
                },
            ],
            auto_orient: false,
            without_enlargement: true,
        })
        .unwrap();
        assert_eq!(r.variants.len(), 3);
        for v in &r.variants {
            assert_eq!(v.width, 100);
            assert_eq!(v.height, 50);
            assert!(v.bytes.len() > 0);
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
                format: Format::Webp,
                quality: 80,
            }],
            auto_orient: false,
            without_enlargement: true,
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
                format: Format::Png,
                quality: 0,
            }],
            auto_orient: false,
            without_enlargement: false,
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
                    format: Format::Webp,
                    quality: 80,
                },
                Variant {
                    width: 100,
                    format: Format::Webp,
                    quality: 80,
                },
                Variant {
                    width: 50,
                    format: Format::Webp,
                    quality: 80,
                },
            ],
            auto_orient: false,
            without_enlargement: true,
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
}
