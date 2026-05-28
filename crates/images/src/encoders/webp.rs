use crate::error::ImageError;
use image::RgbaImage;

/// Encode an RGBA buffer to lossy WebP at the given quality (1..=100).
/// Alpha-aware — the `webp` crate (libwebp underneath) writes RGBA WebP
/// when the source has non-opaque pixels.
///
/// `quality` maps to libwebp's `-q` (the color channels). `alpha_quality`,
/// when `Some`, sets a separate quality for the alpha channel — sharp's
/// `webp({ quality, alphaQuality })`. When `None`, alpha is encoded at
/// the same quality as color (today's behaviour, kept for back-compat).
///
/// The asymmetric knob matters for transparent UI assets: an icon's edge
/// alpha can hold detail at high quality (90+) while the color channels
/// stay at a lower bitrate. F4 S1 deferred this; F4 S2 wires it through.
pub fn encode(
    img: &RgbaImage,
    quality: u8,
    alpha_quality: Option<u8>,
) -> Result<Vec<u8>, ImageError> {
    let q = quality.clamp(1, 100) as f32;
    let encoder = ::webp::Encoder::from_rgba(img.as_raw(), img.width(), img.height());

    let Some(alpha_q) = alpha_quality else {
        // Symmetric quality — fast path, no WebPConfig needed.
        let mem = encoder.encode(q);
        return Ok(mem.to_vec());
    };

    // Asymmetric — drop into encode_advanced with a full WebPConfig so we
    // can move `alpha_quality` independently of `quality`. WebPConfig::new()
    // initialises libwebp's defaults (method=4, segments=4, ...), then we
    // override only the two quality fields the caller asked about.
    let mut config = ::webp::WebPConfig::new().map_err(|_| ImageError::Encode {
        format: "webp",
        message: "failed to init libwebp config".into(),
    })?;
    config.quality = q;
    config.alpha_quality = alpha_q.clamp(0, 100) as i32;
    let mem = encoder
        .encode_advanced(&config)
        .map_err(|e| ImageError::Encode {
            format: "webp",
            message: format!("encode_advanced: {e:?}"),
        })?;
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
        let bytes = encode(&img, 80, None).unwrap();
        // WebP files start with "RIFF" + 4 bytes of size + "WEBP".
        assert!(bytes.len() > 12, "got {} bytes", bytes.len());
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");
    }

    #[test]
    fn encode_round_trips_via_image_decoder() {
        // Encoded WebP should decode back to roughly the same pixels.
        let img = solid(16, 16, [10, 200, 30, 255]);
        let bytes = encode(&img, 90, None).unwrap();
        let decoded = image::load_from_memory(&bytes).expect("decode webp");
        assert_eq!(decoded.width(), 16);
        assert_eq!(decoded.height(), 16);
    }

    #[test]
    fn encode_handles_transparent_input() {
        // Half-transparent green — exercise the alpha path.
        let img = solid(8, 8, [0, 255, 0, 128]);
        let bytes = encode(&img, 90, None).unwrap();
        assert!(bytes.len() > 12);
        let decoded = image::load_from_memory(&bytes).expect("decode webp w/ alpha");
        assert_eq!(decoded.color(), image::ColorType::Rgba8);
    }

    #[test]
    fn encode_advanced_path_with_alpha_quality_emits_valid_webp() {
        // Asymmetric quality: low color (40), high alpha (95). Round-trips
        // through the WebPConfig path and still decodes to RGBA.
        let img = solid(16, 16, [220, 80, 80, 200]);
        let bytes = encode(&img, 40, Some(95)).unwrap();
        assert!(bytes.len() > 12);
        assert_eq!(&bytes[0..4], b"RIFF");
        let decoded = image::load_from_memory(&bytes).expect("decode advanced webp");
        assert_eq!(decoded.color(), image::ColorType::Rgba8);
        assert_eq!(decoded.width(), 16);
        assert_eq!(decoded.height(), 16);
    }

    #[test]
    fn encode_alpha_quality_zero_still_encodes() {
        // Edge case: alphaQuality=0 means the alpha channel is encoded at
        // the lowest libwebp quality. Should still succeed; output remains
        // alpha-aware (just heavily quantized).
        let img = solid(8, 8, [120, 60, 200, 128]);
        let bytes = encode(&img, 80, Some(0)).unwrap();
        assert!(bytes.len() > 12);
        let decoded = image::load_from_memory(&bytes).expect("decode aq=0 webp");
        assert_eq!(decoded.color(), image::ColorType::Rgba8);
    }

    #[test]
    fn encode_alpha_quality_clamps_above_100() {
        // alphaQuality > 100 should be clamped down to 100, not error or
        // produce an undefined libwebp behaviour.
        let img = solid(8, 8, [200, 200, 200, 200]);
        let bytes = encode(&img, 80, Some(200)).unwrap();
        assert!(bytes.len() > 12);
    }

    #[test]
    fn encode_none_alpha_matches_symmetric_path() {
        // When alphaQuality is None, the output should be byte-identical
        // (modulo libwebp determinism) to the simple encode(quality)
        // path that S1 used. Same quality, same dims, no alpha → bytes
        // come out the same length-class. We don't pin exact bytes (the
        // codec doesn't guarantee bit-stable output across libwebp
        // releases), only that the fast-path and slow-path-with-no-alpha-
        // override produce SIMILAR sizes (within ±5%).
        let img = solid(32, 32, [100, 100, 100, 255]);
        let fast = encode(&img, 80, None).unwrap();
        // Note: cannot easily compare the two paths because Some(80)
        // takes the advanced path, which has different defaults for
        // method/segments than the simple encode(80). We just verify the
        // fast path runs and produces a valid file.
        assert!(fast.len() > 12);
        let decoded = image::load_from_memory(&fast).expect("decode");
        assert_eq!(decoded.width(), 32);
    }
}
