pub mod accent;
pub mod color;
pub mod font;
pub mod modes;
pub mod radius;
pub mod space;
pub mod type_pass;

pub use accent::normalize_accent;
pub use color::normalize_color;
pub use font::normalize_font;
pub use modes::normalize_color_modes;
pub use radius::normalize_radius;
pub use space::normalize_space;
pub use type_pass::normalize_type;

/// Born-canonical normalizer — the 7-pass chain. Idempotent end-to-end:
/// re-running on already-canonical HTML is a no-op because each pass
/// short-circuits on its marker.
pub fn normalize_born_canonical(html: &str) -> String {
    let s = normalize_radius(html);
    let s = normalize_space(&s);
    let s = normalize_type(&s);
    let s = normalize_font(&s);
    let s = normalize_accent(&s);
    let s = normalize_color(&s);
    normalize_color_modes(&s)
}
