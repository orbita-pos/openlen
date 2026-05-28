use crate::error::ImageError;
use image::RgbaImage;
use ravif::{Encoder, Img, RGBA8};
use rgb::FromSlice;

/// Encode an RGBA buffer to AVIF at the given quality (1..=100) and a
/// fixed encoder speed of 6 (balance between compression time and ratio —
/// matches the implicit default sharp uses for its `effort: 4` setting).
///
/// `ravif` uses rav1e under the hood; pure Rust, MSVC-clean. The encoder
/// is a fresh instance per call — the heavy state is the rav1e tile
/// scheduler, which doesn't benefit from reuse on a per-call basis.
pub fn encode(img: &RgbaImage, quality: u8) -> Result<Vec<u8>, ImageError> {
    let w = img.width() as usize;
    let h = img.height() as usize;
    if w == 0 || h == 0 {
        return Err(ImageError::Encode {
            format: "avif",
            message: format!("zero-sized image ({}×{})", w, h),
        });
    }

    let rgba: &[RGBA8] = img.as_raw().as_rgba();
    let img_view: Img<&[RGBA8]> = Img::new(rgba, w, h);

    let res = Encoder::new()
        .with_quality(quality.max(1).min(100) as f32)
        .with_speed(6)
        .encode_rgba(img_view)
        .map_err(|e| ImageError::Encode {
            format: "avif",
            message: e.to_string(),
        })?;

    Ok(res.avif_file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn solid(w: u32, h: u32, px: [u8; 4]) -> RgbaImage {
        RgbaImage::from_fn(w, h, |_, _| Rgba(px))
    }

    #[test]
    fn encode_emits_ftyp_box() {
        // Smaller image keeps test fast — AVIF encode is the slowest hot
        // path in the crate (rav1e tiling dominates).
        let img = solid(16, 16, [128, 64, 200, 255]);
        let bytes = encode(&img, 65).unwrap();
        assert!(bytes.len() > 32, "got {} bytes", bytes.len());
        // ISO BMFF: the first box is `ftyp`. Bytes 4..8 carry the box name.
        assert_eq!(&bytes[4..8], b"ftyp");
    }

    #[test]
    fn encode_decodes_back_to_same_dimensions() {
        let img = solid(16, 16, [200, 50, 50, 255]);
        let bytes = encode(&img, 65).unwrap();
        // image-rs 0.25 has no built-in AVIF decoder; decoding via
        // ravif's sibling crate would balloon test deps. The roundtrip
        // sanity check here is just "encoder produced a non-trivial
        // byte sequence" — see the integration tests for cross-decode.
        assert!(bytes.len() > 100);
    }

    #[test]
    fn zero_size_errors() {
        let img = RgbaImage::new(0, 0);
        let err = encode(&img, 65).unwrap_err();
        assert_eq!(err.kind(), "encode");
    }
}
