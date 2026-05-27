//! Token estimation heuristic for pre-flight credit checks.
//!
//! The credit gate (does this request fit in the user's monthly allowance?)
//! needs a *cheap* token count of the input — cheap enough to run on every
//! request without contributing to latency. Loading a real tokenizer adds
//! roughly 10 MB of binary weight plus a ~10 ms warm-up; for a binary
//! decision ("fits / doesn't fit") that overhead is wasteful.
//!
//! `chars / 4` is the industry-standard coarse heuristic. It overestimates
//! token count for natural prose by roughly 10–20% — the safe direction:
//! better to reject a request that would have just fit than to debit a user
//! past their budget. Exact counts (billing-grade) come back from the API
//! itself via [`crate::types::StreamEvent::Usage`].
//!
//! # Upgrade path (F3 S2+)
//!
//! When pre-flight accuracy becomes load-bearing (tight budgets making
//! false-rejects user-visible), swap to the `tokenizers` crate (HF), passing
//! a `tokenizer.json` for the relevant Gemini model:
//!
//! ```ignore
//! use tokenizers::Tokenizer;
//! let tok = Tokenizer::from_file("./gemini-tokenizer.json")?;
//! tok.encode(text, false)?.get_ids().len() as u32
//! ```
//!
//! As of 2026-05 Google doesn't publish an official Gemini `tokenizer.json`;
//! the swap is gated on either an official drop or deriving one from the
//! published SentencePiece model.

/// Coarse character-based estimate of token count.
///
/// Counts Unicode scalar values (`chars()`), not bytes, so a string of N
/// emoji counts as N chars rather than 4N. Returns 0 for the empty string;
/// otherwise rounds *up* (`ceil`) so a 1-char string costs at least 1 token.
pub fn estimate_tokens(text: &str) -> u32 {
    let chars = text.chars().count();
    if chars == 0 {
        return 0;
    }
    ((chars as f32) / 4.0).ceil() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_string_is_zero_tokens() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn single_char_is_one_token() {
        assert_eq!(estimate_tokens("a"), 1);
    }

    #[test]
    fn four_chars_is_one_token() {
        assert_eq!(estimate_tokens("abcd"), 1);
    }

    #[test]
    fn five_chars_is_two_tokens() {
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn twelve_chars_is_three_tokens() {
        assert_eq!(estimate_tokens("hello world!"), 3);
    }

    #[test]
    fn counts_unicode_chars_not_utf8_bytes() {
        // 4 emoji = 4 chars (Unicode scalars) = 1 token, even though each
        // 🦀 takes 4 UTF-8 bytes (16 total).
        assert_eq!("🦀🦀🦀🦀".len(), 16);
        assert_eq!("🦀🦀🦀🦀".chars().count(), 4);
        assert_eq!(estimate_tokens("🦀🦀🦀🦀"), 1);
    }

    #[test]
    fn monotonic_with_increasing_length() {
        let s1 = estimate_tokens("hi");
        let s2 = estimate_tokens("hi there");
        let s3 = estimate_tokens("hi there friend");
        let s4 = estimate_tokens("hi there friend from the test suite");
        assert!(s1 <= s2, "s1={s1} s2={s2}");
        assert!(s2 <= s3, "s2={s2} s3={s3}");
        assert!(s3 <= s4, "s3={s3} s4={s4}");
    }

    #[test]
    fn rounds_up_not_down() {
        // 9 chars / 4 = 2.25 → 3 (not 2)
        assert_eq!(estimate_tokens("123456789"), 3);
    }
}
