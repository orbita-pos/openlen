// Strip `on*` event-handler attributes from every element. Mirror of step 3
// in lib/style-match/autofill/sanitize.ts. The strict regex from TS is
// `/^on[a-z]+$/i` — `on` followed by 1+ ASCII letters, case insensitive.
// HTML attribute names are themselves case-insensitive, so the lol-html
// `el.attributes()` view normalizes to lowercase on parse and the
// matching becomes a simple `name.starts_with("on") && name[2..].all(letter)`.

use lol_html::{element, rewrite_str, RewriteStrSettings};

use crate::error::EngineError;
use crate::sanitize::RemovedCounts;

fn is_event_handler_attr(name: &str) -> bool {
    let b = name.as_bytes();
    if b.len() < 3 {
        return false;
    }
    if !(b[0].eq_ignore_ascii_case(&b'o') && b[1].eq_ignore_ascii_case(&b'n')) {
        return false;
    }
    b[2..].iter().all(|c| c.is_ascii_alphabetic())
}

pub fn strip_event_handlers(
    html: &str,
    removed: &mut RemovedCounts,
) -> Result<String, EngineError> {
    if html.is_empty() {
        return Ok(String::new());
    }
    let counter = std::cell::Cell::new(0u32);
    let out = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("*", |el| {
                // lol-html: collect names first, then remove. Removing while
                // iterating the borrow would be a runtime error.
                let names: Vec<String> = el
                    .attributes()
                    .iter()
                    .map(|a| a.name())
                    .filter(|n| is_event_handler_attr(n))
                    .collect();
                for n in names {
                    el.remove_attribute(&n);
                    counter.set(counter.get() + 1);
                }
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| EngineError::Rewrite(e.to_string()))?;
    removed.event_handlers += counter.get();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_passes_through() {
        let mut r = RemovedCounts::default();
        assert_eq!(strip_event_handlers("", &mut r).unwrap(), "");
    }

    #[test]
    fn onclick_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_event_handlers("<a onclick=\"x()\" href=\"/y\">z</a>", &mut r).unwrap();
        assert!(!out.contains("onclick"));
        assert!(out.contains("href=\"/y\""));
        assert_eq!(r.event_handlers, 1);
    }

    #[test]
    fn multiple_handlers_on_same_element_all_removed() {
        let mut r = RemovedCounts::default();
        let out = strip_event_handlers(
            "<button onclick=\"a()\" onmouseover=\"b()\" onerror=\"c()\">x</button>",
            &mut r,
        )
        .unwrap();
        assert!(!out.contains("onclick"));
        assert!(!out.contains("onmouseover"));
        assert!(!out.contains("onerror"));
        assert_eq!(r.event_handlers, 3);
    }

    #[test]
    fn uppercase_handler_removed() {
        let mut r = RemovedCounts::default();
        // HTML5 parser will lowercase attribute names, so the regex matches
        // against the normalized form.
        let out = strip_event_handlers("<a OnClick=\"x()\">y</a>", &mut r).unwrap();
        assert!(!out.contains("nclick"));
        assert!(!out.contains("nClick"));
        assert_eq!(r.event_handlers, 1);
    }

    #[test]
    fn non_handler_attrs_preserved() {
        let mut r = RemovedCounts::default();
        let html = "<a class=\"on-track\" data-once=\"yes\" id=\"once\">x</a>";
        // `on-track` doesn't match because it has `-` not a letter at position 2.
        // `once` matches `o` `n` `c` `e` — all letters — IS a handler.
        // We need to be precise: `once` length 4, starts with `o`, `n`, then
        // `ce` is all letters. Yep, that's an attribute name "once" which the
        // is_event_handler_attr function classifies as a handler. THIS IS A
        // FALSE POSITIVE in the regex — but it matches the TS reference, which
        // has the same shape. The TS `/^on[a-z]+$/i` would match "once" too.
        //
        // To avoid breaking real-world attrs named `once`/`only`, the test
        // skips them. The id="once" is not stripped because we check names,
        // not values.
        let out = strip_event_handlers(html, &mut r).unwrap();
        assert!(out.contains("class=\"on-track\""));
        assert!(out.contains("data-once=\"yes\""));
        assert!(out.contains("id=\"once\""));
        assert_eq!(r.event_handlers, 0);
    }

    #[test]
    fn on_alone_not_handler() {
        // Just "on" — only 2 chars, doesn't match `on[a-z]+` (needs ≥1 trailing letter).
        let mut r = RemovedCounts::default();
        let out = strip_event_handlers("<div on=\"x\">y</div>", &mut r).unwrap();
        assert!(out.contains("on=\"x\""));
        assert_eq!(r.event_handlers, 0);
    }

    #[test]
    fn handler_with_digit_in_name_not_stripped() {
        // `on1click` has a digit after `on` — not pure letters, so not matched.
        let mut r = RemovedCounts::default();
        let out = strip_event_handlers("<div on1click=\"x\">y</div>", &mut r).unwrap();
        assert!(out.contains("on1click"));
        assert_eq!(r.event_handlers, 0);
    }

    #[test]
    fn clean_html_byte_equal() {
        let mut r = RemovedCounts::default();
        let html = "<div class=\"foo\"><p>hello</p></div>";
        assert_eq!(strip_event_handlers(html, &mut r).unwrap(), html);
        assert_eq!(r.event_handlers, 0);
    }
}
