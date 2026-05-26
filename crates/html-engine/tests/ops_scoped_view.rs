use openlen_html_engine::ops::scoped_view::build_scoped_view;
use openlen_html_engine::ops::tagger::tag_with_op_ids;

fn tag(s: &str) -> String {
    tag_with_op_ids(s).unwrap().tagged_html
}

fn op_id_of(tagged: &str, locator: &str) -> String {
    // Tiny helper — find the byte range of `locator`, grab the data-op-id
    // attribute on the SAME tag that contains it.
    let idx = tagged.find(locator).expect("locator present");
    let prefix = &tagged[..idx];
    let tag_open = prefix.rfind('<').expect("tag start");
    let tag_end = tagged[tag_open..].find('>').unwrap() + tag_open;
    let tag_slice = &tagged[tag_open..=tag_end];
    let key = r#"data-op-id=""#;
    let start = tag_slice.find(key).expect("data-op-id present") + key.len() + tag_open;
    let end = tagged[start..].find('"').unwrap() + start;
    tagged[start..end].to_string()
}

#[test]
fn empty_inputs_return_none() {
    assert!(build_scoped_view("", "a").is_none());
    assert!(build_scoped_view("<html></html>", "").is_none());
}

#[test]
fn missing_pin_returns_none() {
    let tagged = tag("<html><body><main><p>x</p></main></body></html>");
    assert!(build_scoped_view(&tagged, "nonexistent").is_none());
}

#[test]
fn walks_up_to_section_container() {
    let tagged =
        tag("<html><body><main><section><h2>Hero</h2><p>copy</p></section></main></body></html>");
    let p_id = op_id_of(&tagged, "copy");
    let view = build_scoped_view(&tagged, &p_id).expect("view");
    assert!(view.scoped_html.contains("<section"));
    assert!(view.scoped_html.contains("<h2"));
    assert!(view.scoped_html.contains("copy"));
    // Container is the section, not the p — so pin_is_container=false.
    assert!(!view.pin_is_container);
}

#[test]
fn pin_already_a_section_marks_container() {
    let tagged = tag("<html><body><section><h2>Hero</h2></section></body></html>");
    let section_id = op_id_of(&tagged, "<h2");
    // Walk up from h2 to its section — pin is h2, container is its parent
    // section. But if we pin the section directly:
    let section_id = {
        // Locate section's id directly.
        let s_idx = tagged.find("<section").unwrap();
        let attr_start =
            tagged[s_idx..].find("data-op-id=\"").unwrap() + s_idx + "data-op-id=\"".len();
        let attr_end = tagged[attr_start..].find('"').unwrap() + attr_start;
        let _ = section_id; // discard previous
        tagged[attr_start..attr_end].to_string()
    };
    let view = build_scoped_view(&tagged, &section_id).expect("view");
    assert!(view.pin_is_container);
    assert_eq!(view.container_op_id, section_id);
}

#[test]
fn outline_lists_body_direct_children() {
    let tagged = tag(r#"<html><body>
        <header><h1>Top</h1></header>
        <main><section><h2>Body</h2></section></main>
        <footer><p>©</p></footer>
        </body></html>"#);
    let h1_id = op_id_of(&tagged, "Top");
    let view = build_scoped_view(&tagged, &h1_id).expect("view");
    assert!(view.outline.contains("<header>"));
    assert!(view.outline.contains("<main>"));
    assert!(view.outline.contains("<footer>"));
    // Header is the scoped section.
    assert!(view.outline.contains("(SCOPED)"));
}

#[test]
fn outline_truncates_long_text() {
    let long = "x".repeat(200);
    let html = format!(
        "<html><body><section><h2>{}</h2></section></body></html>",
        long
    );
    let tagged = tag(&html);
    // Get h2's id.
    let h2_id = op_id_of(&tagged, "<h2");
    let view = build_scoped_view(&tagged, &h2_id).expect("view");
    // Outline mentions section; hint should be <=60 chars.
    for line in view.outline.lines() {
        if let Some(start) = line.find('"') {
            let rest = &line[start + 1..];
            if let Some(end) = rest.find('"') {
                let hint = &rest[..end];
                assert!(
                    hint.chars().count() <= 60,
                    "hint too long: {} chars",
                    hint.chars().count()
                );
            }
        }
    }
}
