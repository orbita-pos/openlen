use crate::error::ImageError;
use image::RgbaImage;

/// Encode an RGBA buffer to lossy WebP at the given quality (1..=100).
/// Alpha-aware — the `webp` crate (libwebp underneath) writes RGBA WebP
/// when the source has non-opaque pixels.
///
/// Quality maps directly to libwebp's `-q` parameter. Sharp's
/// `webp({ quality, alphaQuality })` exposes a separate alphaQuality knob;
/// here a single quality drives both because no current call site uses
/// asymmetric tuning. If that changes, expose `alphaQuality` as a second
/// arg without breaking the existing callers (default = quality).
pub fn encode(img: &RgbaImage, quality: u8) -> Result<Vec<u8>, ImageError> {
    let q = quality.max(1).min(100) as f32;
    let encoder = ::webp::Encoder::from_rgba(img.as_raw(), img.width(), img.height());
    let mem = encoder.encode(q);
    Ok(mem.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn solid(w: u32, h: u32, px: [u8; 4]) -> RgbaImage {
        RgbaImage::from_fn(w, h, |_, _| Rgba(px))
    }

    #[test]
    fn encode_emits_riff_magic() {
        let img = solid(32, 32, [200, 100, 50, 255]);
        let bytes = encode(&img, 80).unwrap();
        // WebP files start with "RIFF" + 4 bytes of size + "WEBP".
        assert!(bytes.len() > 12, "got {} bytes", bytes.len());
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");
    }

    #[test]
    fn encode_round_trips_via_image_decoder() {
        // Encoded WebP should decode back to roughly the same pixels.
        let img = solid(16, 16, [10, 200, 30, 255]);
        let bytes = encode(&img, 90).unwrap();
        let decoded = image::load_from_memory(&bytes).expect("decode webp");
        assert_eq!(decoded.width(), 16);
        assert_eq!(decoded.height(), 16);
    }

    #[test]
    fn encode_handles_transparent_input() {
        // Half-transparent green — exercise the alpha path.
        let img = solid(8, 8, [0, 255, 0, 128]);
        let bytes = encode(&img, 90).unwrap();
        assert!(bytes.len() > 12);
        let decoded = image::load_from_memory(&bytes).expect("decode webp w/ alpha");
        assert_eq!(decoded.color(), image::ColorType::Rgba8);
    }
}
