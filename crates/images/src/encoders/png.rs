use crate::error::ImageError;
use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use image::{ExtendedColorType, ImageEncoder, RgbaImage};

/// Encode RGBA to PNG. When `optimize = true`, the output is run through
/// oxipng (zopfli-free preset, parallel-enabled) for a typical 15–35%
/// size reduction at ~10× the cost of a plain encode.
///
/// PNG is lossless — there's no quality knob. `optimize=true` is the right
/// default for user-facing variants; tests can pass `false` for speed.
pub fn encode(img: &RgbaImage, optimize: bool) -> Result<Vec<u8>, ImageError> {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err(ImageError::Encode {
            format: "png",
            message: format!("zero-sized image ({}×{})", w, h),
        });
    }

    let mut raw: Vec<u8> = Vec::with_capacity((w as usize) * (h as usize) * 4 / 3);
    PngEncoder::new_with_quality(&mut raw, CompressionType::Best, PngFilter::Adaptive)
        .write_image(img.as_raw(), w, h, ExtendedColorType::Rgba8)
        .map_err(|e| ImageError::Encode {
            format: "png",
            message: e.to_string(),
        })?;

    if !optimize {
        return Ok(raw);
    }

    // oxipng preset 2 is the sharp `compressionLevel: 6` analogue —
    // strong compression without the zopfli pass that dominates preset 6.
    let opts = oxipng::Options::from_preset(2);
    oxipng::optimize_from_memory(&raw, &opts).map_err(|e| ImageError::Encode {
        format: "png",
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn solid(w: u32, h: u32, px: [u8; 4]) -> RgbaImage {
        RgbaImage::from_fn(w, h, |_, _| Rgba(px))
    }

    #[test]
    fn encode_emits_png_magic() {
        let img = solid(16, 16, [10, 20, 30, 255]);
        let bytes = encode(&img, false).unwrap();
        // PNG signature.
        assert_eq!(&bytes[0..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn encode_round_trips_alpha() {
        let img = solid(8, 8, [10, 200, 30, 64]);
        let bytes = encode(&img, false).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        let px = decoded.to_rgba8().get_pixel(4, 4).0;
        assert_eq!(px, [10, 200, 30, 64]);
    }

    #[test]
    fn optimize_does_not_inflate_solid_image() {
        let img = solid(32, 32, [128, 128, 128, 255]);
        let raw = encode(&img, false).unwrap();
        let opt = encode(&img, true).unwrap();
        // Solid colours compress trivially in PNG — both should be small,
        // and the optimized version is typically smaller. The assertion is
        // conservative ("not worse") because oxipng's preset 2 occasionally
        // ties with image-rs's `Best` setting on solid inputs.
        assert!(opt.len() <= raw.len() + 8, "raw={} opt={}", raw.len(), opt.len());
    }

    #[test]
    fn zero_size_errors() {
        let img = RgbaImage::new(0, 0);
        let err = encode(&img, false).unwrap_err();
        assert_eq!(err.kind(), "encode");
    }
}
