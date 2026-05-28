use image::DynamicImage;
use std::io::Cursor;

/// Read the EXIF Orientation tag (1..=8) from the input bytes. Returns 1
/// (no rotation) when no EXIF is present or parsing fails. Mirrors sharp's
/// implicit handling: cameras tag the JPEG with rotation, viewers apply it.
pub fn read_orientation(bytes: &[u8]) -> u32 {
    let mut cursor = Cursor::new(bytes);
    let reader = exif::Reader::new();
    let exif = match reader.read_from_container(&mut cursor) {
        Ok(e) => e,
        Err(_) => return 1,
    };
    exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1)
}

/// Apply EXIF orientation 1..=8 to an image. Mapping per the JPEG/EXIF
/// spec: 1=identity, 2=mirror-H, 3=180°, 4=mirror-V, 5=90°CW+mirror-H,
/// 6=90°CW, 7=270°CW+mirror-H, 8=270°CW. Unknown values pass through.
pub fn apply_orientation(img: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        1 => img,
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => DynamicImage::ImageRgba8(image::imageops::flip_horizontal(&img.rotate90().to_rgba8())),
        6 => img.rotate90(),
        7 => DynamicImage::ImageRgba8(image::imageops::flip_horizontal(
            &img.rotate270().to_rgba8(),
        )),
        8 => img.rotate270(),
        _ => img,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_exif_returns_one() {
        // 8-byte PNG signature + nothing else — definitely no EXIF.
        let bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert_eq!(read_orientation(&bytes), 1);
    }

    #[test]
    fn empty_bytes_returns_one() {
        assert_eq!(read_orientation(&[]), 1);
    }

    #[test]
    fn apply_orientation_identity_keeps_dimensions() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::new(10, 20));
        let out = apply_orientation(img, 1);
        assert_eq!(out.width(), 10);
        assert_eq!(out.height(), 20);
    }

    #[test]
    fn apply_orientation_rotate_90_swaps_dimensions() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::new(10, 20));
        let out = apply_orientation(img, 6);
        assert_eq!(out.width(), 20);
        assert_eq!(out.height(), 10);
    }

    #[test]
    fn apply_orientation_unknown_passes_through() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::new(10, 20));
        let out = apply_orientation(img, 99);
        assert_eq!(out.width(), 10);
        assert_eq!(out.height(), 20);
    }
}
