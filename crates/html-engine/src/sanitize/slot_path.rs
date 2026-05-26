// Single gate for the reserved editor-mode marker `data-slot-path=`. Today
// the same literal-substring check (`html.includes("data-slot-path=")`) lives
// in six places across the TS code (publish, from-html, from-template, html
// PATCH, ai-design, admin/templates). This is the consolidated Rust port,
// strengthened with case-insensitivity, whitespace-around-`=`, and entity
// decoding so a model that wraps the bytes can't sneak the marker past.
//
// Threat model: editor markers must never be persisted to the DB or written
// to disk. Sites that produce HTML from external sources (LLM output, raw
// paste, template upload) MUST run this check before storage. The marker has
// no functional payload — it's a string sentinel — so a substring scan over
// the entity-decoded byte stream is sufficient. We do NOT need a full HTML
// parse for this gate.

use std::fmt;

/// Position where a slot-path occurrence was detected. Reported in the error
/// message so callers can point at exactly which evasion path tripped the
/// gate during incident review.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotPathPosition {
    /// Plain literal `data-slot-path=` in the raw bytes — the same case the
    /// six TS sites catch today.
    Literal,
    /// Found only after HTML entity decoding (e.g. `&#100;ata-slot-path=`).
    EntityEncoded,
    /// Same name but with mixed case (e.g. `Data-Slot-Path=`). HTML attribute
    /// names are case-insensitive, so browsers/editor would treat this as the
    /// real marker.
    MixedCase,
    /// `data-slot-path` with whitespace around the `=` (`data-slot-path =`).
    /// HTML attribute syntax permits this. Caught even without the strict `=`
    /// suffix matching the literal check.
    WhitespaceAroundEquals,
}

impl fmt::Display for SlotPathPosition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Literal => "literal",
            Self::EntityEncoded => "entity-encoded",
            Self::MixedCase => "mixed-case",
            Self::WhitespaceAroundEquals => "whitespace-around-equals",
        })
    }
}

#[derive(Debug, Clone)]
pub struct SlotPathDetection {
    pub position: SlotPathPosition,
    /// Byte offset of the first matched character in the (decoded, where
    /// applicable) input. Useful for diagnostic messages, not for slicing
    /// the original string back.
    pub offset: usize,
}

const TARGET: &[u8] = b"data-slot-path";
const TARGET_LEN: usize = TARGET.len();

/// Scan `html` for any occurrence of the `data-slot-path=` marker, in any
/// of four positions (literal, entity-encoded, mixed case, whitespace around
/// `=`). Returns the first hit (consistent ordering: literal → mixed-case →
/// whitespace → entity-encoded), or None if the input is clean.
///
/// Cost: two linear byte scans over the input (one ASCII-case-insensitive
/// raw scan, one entity-decoded scan that's only allocated when the raw
/// pass clears). Both are O(n).
pub fn detect_slot_path(html: &str) -> Option<SlotPathDetection> {
    if let Some(hit) = scan_raw(html.as_bytes()) {
        return Some(hit);
    }
    let decoded = decode_numeric_entities(html);
    if decoded.len() != html.len() {
        if let Some(d) = scan_raw(decoded.as_bytes()) {
            return Some(SlotPathDetection {
                position: SlotPathPosition::EntityEncoded,
                offset: d.offset,
            });
        }
    }
    None
}

/// Case-insensitive substring search for `data-slot-path` followed by `\s*=`.
/// Returns the most-specific position label that fits the match. Pure ASCII
/// case-folding — `data-slot-path` is all ASCII letters, hyphens, and an
/// equals sign, so we never need full Unicode case folding.
fn scan_raw(bytes: &[u8]) -> Option<SlotPathDetection> {
    let n = bytes.len();
    if n < TARGET_LEN + 1 {
        return None;
    }
    let limit = n - TARGET_LEN;
    let mut i = 0;
    while i <= limit {
        if ascii_eq_ignore_case(&bytes[i..i + TARGET_LEN], TARGET) {
            let mut mixed = false;
            for k in 0..TARGET_LEN {
                if bytes[i + k] != TARGET[k] {
                    mixed = true;
                    break;
                }
            }
            // Skip ASCII whitespace, then require `=` to count as a marker.
            let mut j = i + TARGET_LEN;
            let mut had_ws = false;
            while j < n && is_ascii_html_ws(bytes[j]) {
                had_ws = true;
                j += 1;
            }
            if j < n && bytes[j] == b'=' {
                let position = if mixed {
                    SlotPathPosition::MixedCase
                } else if had_ws {
                    SlotPathPosition::WhitespaceAroundEquals
                } else {
                    SlotPathPosition::Literal
                };
                return Some(SlotPathDetection {
                    position,
                    offset: i,
                });
            }
            // No `=` after the candidate — keep scanning; the bytes are not a
            // marker (could be e.g. `data-slot-path-foo` or stray text).
        }
        i += 1;
    }
    None
}

fn ascii_eq_ignore_case(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for k in 0..a.len() {
        let mut x = a[k];
        let mut y = b[k];
        if x.is_ascii_uppercase() {
            x += 32;
        }
        if y.is_ascii_uppercase() {
            y += 32;
        }
        if x != y {
            return false;
        }
    }
    true
}

fn is_ascii_html_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0C)
}

/// Decode `&#NNN;` and `&#xHHH;` numeric character references to their
/// resulting bytes. Named entities (`&amp;` etc.) are deliberately NOT
/// decoded — the only attack vector for slot-path evasion is the numeric
/// form, since there are no named entities for the ASCII letters in
/// `data-slot-path`. Keeping the decoder tight avoids dragging in a full
/// entity table for what is fundamentally a security gate.
///
/// Output length differs from input only when at least one numeric entity
/// was present, so the caller can skip the second scan in the common case.
/// Decoded bytes that are non-ASCII are emitted as their UTF-8 encoding;
/// only ASCII characters can participate in the `data-slot-path` match
/// anyway, but we preserve UTF-8 validity so subsequent processing is sane.
pub fn decode_numeric_entities(html: &str) -> String {
    let bytes = html.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while i < n {
        if bytes[i] == b'&' && i + 2 < n && bytes[i + 1] == b'#' {
            let (consumed, decoded) = parse_numeric_entity(&bytes[i..]);
            if consumed > 0 {
                if let Some(ch) = decoded {
                    out.push(ch);
                } else {
                    // Malformed — keep the original bytes so we don't lose
                    // any potential attack payload. The slot-path scanner
                    // will see them as-is.
                    out.push_str(&html[i..i + consumed]);
                }
                i += consumed;
                continue;
            }
        }
        // Fast path: copy one UTF-8 code point worth of bytes.
        let len = utf8_char_len(bytes[i]);
        let end = (i + len).min(n);
        out.push_str(&html[i..end]);
        i = end;
    }
    out
}

fn utf8_char_len(b: u8) -> usize {
    // Lead-byte width table per UTF-8 spec. Continuation bytes (0x80..0xC0)
    // shouldn't normally appear here mid-decode, but if they do we copy a
    // single byte and keep going — safer than panicking on a malformed input.
    if b < 0xC0 {
        1
    } else if b < 0xE0 {
        2
    } else if b < 0xF0 {
        3
    } else {
        4
    }
}

/// Try to parse a numeric character reference starting at the `&`. Returns
/// `(consumed_bytes, decoded_char)`. consumed_bytes == 0 means the bytes did
/// not form an entity at all (caller should fall through to literal copy).
/// A returned consumed_bytes > 0 with decoded_char == None means the bytes
/// were entity-shaped but decoded to an invalid code point — caller should
/// emit the original bytes unchanged.
fn parse_numeric_entity(bytes: &[u8]) -> (usize, Option<char>) {
    // Layout: &#NNNN;  or  &#xHHHH;  (terminator is `;`, but HTML5 also
    // accepts the entity without `;` when the next char would otherwise
    // disambiguate. For sanitizer purposes we accept both forms.)
    if bytes.len() < 3 || bytes[0] != b'&' || bytes[1] != b'#' {
        return (0, None);
    }
    let hex = bytes[2] == b'x' || bytes[2] == b'X';
    let digits_start = if hex { 3 } else { 2 };
    let mut digits_end = digits_start;
    // No length cap — a leading-zero attack like `&#000000100;ata-slot-path=`
    // can pad arbitrarily many zeros, and a fixed limit lets the attacker hide
    // the real digit. Input HTML is already size-bounded upstream (8 MB on the
    // from-html path) so O(N) scanning over a long digit run is safe.
    while digits_end < bytes.len() {
        let b = bytes[digits_end];
        let is_digit = if hex {
            b.is_ascii_hexdigit()
        } else {
            b.is_ascii_digit()
        };
        if !is_digit {
            break;
        }
        digits_end += 1;
    }
    if digits_end == digits_start {
        return (0, None);
    }
    let digits = &bytes[digits_start..digits_end];
    let radix = if hex { 16 } else { 10 };
    let s = std::str::from_utf8(digits).unwrap_or("");
    // u64 so a long digit run doesn't overflow the parse; out-of-range values
    // (> U+10FFFF) fail char::from_u32 and propagate as None.
    let code = u64::from_str_radix(s, radix)
        .ok()
        .and_then(|v| u32::try_from(v).ok());
    let mut consumed = digits_end;
    if consumed < bytes.len() && bytes[consumed] == b';' {
        consumed += 1;
    }
    let decoded = code.and_then(char::from_u32);
    (consumed, decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_html_returns_none() {
        assert!(detect_slot_path("<div class=\"foo\">hello</div>").is_none());
    }

    #[test]
    fn empty_input_returns_none() {
        assert!(detect_slot_path("").is_none());
    }

    #[test]
    fn plain_attribute_caught() {
        let hit = detect_slot_path("<div data-slot-path=\"hero.title\">x</div>").unwrap();
        assert_eq!(hit.position, SlotPathPosition::Literal);
    }

    #[test]
    fn mixed_case_caught() {
        let hit = detect_slot_path("<div Data-Slot-Path=\"x\">y</div>").unwrap();
        assert_eq!(hit.position, SlotPathPosition::MixedCase);
    }

    #[test]
    fn upper_case_caught() {
        let hit = detect_slot_path("<DIV DATA-SLOT-PATH=\"\">").unwrap();
        assert_eq!(hit.position, SlotPathPosition::MixedCase);
    }

    #[test]
    fn whitespace_around_equals_caught() {
        let hit = detect_slot_path("<div data-slot-path =\"x\">").unwrap();
        assert_eq!(hit.position, SlotPathPosition::WhitespaceAroundEquals);
    }

    #[test]
    fn newline_around_equals_caught() {
        let hit = detect_slot_path("<div data-slot-path\n=\"x\">").unwrap();
        assert_eq!(hit.position, SlotPathPosition::WhitespaceAroundEquals);
    }

    #[test]
    fn entity_encoded_first_char_caught() {
        // &#100; = 'd'
        let hit = detect_slot_path("<div &#100;ata-slot-path=\"x\">").unwrap();
        assert_eq!(hit.position, SlotPathPosition::EntityEncoded);
    }

    #[test]
    fn entity_encoded_hex_caught() {
        // &#x64; = 'd'
        let hit = detect_slot_path("<div &#x64;ata-slot-path=\"x\">").unwrap();
        assert_eq!(hit.position, SlotPathPosition::EntityEncoded);
    }

    #[test]
    fn entity_encoded_full_marker_caught() {
        // Every letter encoded.
        let encoded = "&#100;&#97;&#116;&#97;-&#115;&#108;&#111;&#116;-&#112;&#97;&#116;&#104;=";
        let hit = detect_slot_path(encoded).unwrap();
        assert_eq!(hit.position, SlotPathPosition::EntityEncoded);
    }

    #[test]
    fn entity_without_terminator_caught() {
        // HTML5 accepts numeric refs without trailing semicolon when the next
        // char disambiguates (e.g. `&#100;ata` could collide; `&#100ata` is
        // ambiguous). We accept both forms in the decoder.
        let hit = detect_slot_path("<div &#100ata-slot-path=\"x\">").unwrap();
        assert_eq!(hit.position, SlotPathPosition::EntityEncoded);
    }

    #[test]
    fn slot_path_in_text_content_caught() {
        let hit = detect_slot_path("<p>The string data-slot-path= is reserved.</p>").unwrap();
        assert_eq!(hit.position, SlotPathPosition::Literal);
    }

    #[test]
    fn slot_path_in_html_comment_caught() {
        let hit = detect_slot_path("<!-- data-slot-path=foo --><div>x</div>").unwrap();
        assert_eq!(hit.position, SlotPathPosition::Literal);
    }

    #[test]
    fn slot_path_in_cdata_caught() {
        let hit = detect_slot_path("<![CDATA[data-slot-path=]]>").unwrap();
        assert_eq!(hit.position, SlotPathPosition::Literal);
    }

    #[test]
    fn slot_path_without_equals_not_caught() {
        // `data-slot-path-foo` — different attribute name, not a marker.
        assert!(detect_slot_path("<div data-slot-path-foo=\"x\">").is_none());
    }

    #[test]
    fn data_slot_path_at_eof_no_equals() {
        // Truncated input that ends with the literal string but no `=` —
        // should not trip the gate (we require the `=` per spec).
        assert!(detect_slot_path("data-slot-path").is_none());
    }

    #[test]
    fn ampersand_not_an_entity_passes() {
        // `&foo` is not a numeric entity, must not crash the decoder.
        assert!(detect_slot_path("<a href=\"?a=1&b=2\">x</a>").is_none());
    }

    #[test]
    fn double_entity_encoding_first_char() {
        // `&#x44;` = 'D' — uppercase D via hex entity. Decodes to D, which is
        // case-insensitively `d`, so the marker is caught.
        let hit = detect_slot_path("<div &#x44;ata-slot-path=\"x\">").unwrap();
        assert_eq!(hit.position, SlotPathPosition::EntityEncoded);
    }

    #[test]
    fn offset_is_reported() {
        let hit = detect_slot_path("<html><body><div data-slot-path=\"x\">y</div></body></html>")
            .unwrap();
        assert!(hit.offset > 0);
    }

    #[test]
    fn malformed_entity_passes_through() {
        // `&#` with nothing after — must not panic.
        assert!(detect_slot_path("&#").is_none());
        assert!(detect_slot_path("&#;").is_none());
        assert!(detect_slot_path("&#x;").is_none());
    }

    #[test]
    fn very_long_numeric_entity_does_not_overflow() {
        let hit = detect_slot_path("&#000000100;ata-slot-path=").unwrap();
        assert_eq!(hit.position, SlotPathPosition::EntityEncoded);
    }
}
