use image::{imageops::FilterType, RgbaImage};

/// Lanczos3 resize. Caller passes target dimensions verbatim; aspect-ratio
/// math and clamping live in [`crate::pipeline`]. This is the raw primitive,
/// exposed for callers that already have an `RgbaImage` and want to avoid
/// the pipeline's setup cost.
pub fn resize_lanczos3(img: &RgbaImage, target_w: u32, target_h: u32) -> RgbaImage {
    let w = target_w.max(1);
    let h = target_h.max(1);
    image::imageops::resize(img, w, h, FilterType::Lanczos3)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn solid(w: u32, h: u32, px: [u8; 4]) -> RgbaImage {
        RgbaImage::from_fn(w, h, |_, _| Rgba(px))
    }

    #[test]
    fn resize_halves_dimensions() {
        let img = solid(100, 60, [200, 100, 50, 255]);
        let out = resize_lanczos3(&img, 50, 30);
        assert_eq!(out.dimensions(), (50, 30));
    }

    #[test]
    fn resize_preserves_solid_color() {
        let img = solid(80, 80, [10, 20, 30, 255]);
        let out = resize_lanczos3(&img, 40, 40);
        let p = out.get_pixel(20, 20).0;
        // Lanczos on a solid is exact in steady state, modulo ±1 on edges
        // from kernel rounding.
        assert!(
            (p[0] as i16 - 10).abs() <= 1
                && (p[1] as i16 - 20).abs() <= 1
                && (p[2] as i16 - 30).abs() <= 1,
            "expected ~[10,20,30,255], got {p:?}"
        );
        assert_eq!(p[3], 255);
    }

    #[test]
    fn zero_target_clamps_to_one() {
        let img = solid(10, 10, [0, 0, 0, 255]);
        let out = resize_lanczos3(&img, 0, 0);
        // Lanczos3 needs at least 1×1; the clamp guards against a panic
        // inside image-rs when callers pass `0`.
        assert_eq!(out.dimensions(), (1, 1));
    }
}
