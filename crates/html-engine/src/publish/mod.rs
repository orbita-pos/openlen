// Publish-time DOM mutations migrated from cheerio in F1.5.
//
// Each module here is one of the four non-Motor-HTML consumers F1 S9 left
// behind on cheerio. They run during the publish pipeline (lib/publish/
// filesystem.ts) and operate on the final HTML right before it lands on
// disk. All implementations are kuchikiki-backed — next-sibling checks,
// rel-token tokenisation, and conditional child appends don't fit
// lol-html's single-pass streaming model the way the sanitize / normalize
// passes do.

pub mod logo;

pub use logo::{extract_logo, ExtractedLogo};
