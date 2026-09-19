// Publish-time wiring for every <form> on a generated / pasted / templated
// page. Turns the decorative forms a designer (or AI) drops into a hero
// section into working lead-capture forms pointed at OpenLen's /api/f/<sub>
// submit endpoint. The editor HTML stays untouched — only the published
// output carries this.
//
// Per form, in document order:
//   - action = <action> (caller pre-computes the per-subdomain URL)
//   - method = post
//   - data-openlen-form = "" (marker the inline script matches on)
//   - data-openlen-success / data-openlen-redirect from the per-form config
//   - one hidden <input name="_openlen_form" value="<index>"> if absent —
//     the capture route reads it back to map the submission to per-form
//     config (e.g. notify email)
//   - one honeypot <input name="_openlen_hp"> if absent
//
// Once per document, an inline submit-via-fetch script is appended to <body>
// (carrying the data-openlen-form-script marker that gates re-injection on
// re-publish). The script submits inline (no page reload), with the native
// POST as the no-JS fallback.
//
// Password gate — hard invariant: published OpenLen pages can never collect
// passwords. Because every <form> is force-wired to /api/f, a fake login
// page would pipe harvested credentials straight into the attacker's own
// leads inbox + notification email. So before wiring, every
// input[type=password] and every autocomplete="one-time-code" (OTP) input
// in the DOCUMENT is removed — deterministic signals only, no name
// heuristics (zero false positives: OpenLen is design-only, a landing page
// never legitimately needs a password field). Pages without forms keep the
// byte-equal early return: with no submission channel there is nothing to
// harvest into.

use kuchikiki::traits::TendrilSink;
use kuchikiki::{NodeData, NodeRef};

use super::{parse_fragment_children, serialize_doc};

#[derive(Debug, Clone)]
pub struct FormConfig {
    /// Document-order index of the form this config applies to.
    pub index: u32,
    /// Custom success-page text — gets baked into `data-openlen-success`.
    pub success_message: Option<String>,
    /// Optional URL the inline script redirects to on success.
    pub redirect_url: Option<String>,
}

const HONEYPOT: &str = r#"<input type="text" name="_openlen_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">"#;

// The inline submit-via-fetch script. Submits any data-openlen-form inline;
// on success either redirects (data-openlen-redirect) or swaps the form for
// a thank-you whose text comes from data-openlen-success. The
// ?openlen_form=ok branch is the no-JS fallback path (native POST → 303
// redirect back).
const FORM_SCRIPT: &str = r#"(function(){
  // EL TEXTO QUE VE EL VISITANTE, EN SU IDIOMA. La tabla la genera
  // `scripts/forms-i18n.mjs` desde los catalogos (`messages/<loc>/panelsProps.json`
  // -> successMessagePlaceholder, `panelsChat.json` -> errors.generic), para que
  // haya UNA sola verdad por frase; `forms-i18n.test.ts` falla si se separan.
  // Se resuelve EN EL NAVEGADOR contra <html lang>, no al hornear: asi la
  // variante traducida de una pagina publicada (/fr/, /ja/...) acierta sin
  // volver a hornear el guion. Va en escapes Unicode para que este fichero
  // siga siendo ASCII puro.
  var T={"en":{"ok":"\u2713 Thanks \u2014 we got your message.","err":"Something went wrong \u2014 try again."},"es":{"ok":"\u2713 Gracias \u2014 recibimos tu mensaje.","err":"Algo sali\u00f3 mal: int\u00e9ntalo de nuevo."},"pt":{"ok":"\u2713 Obrigado \u2014 recebemos sua mensagem.","err":"Algo deu errado \u2014 tente de novo."},"fr":{"ok":"\u2713 Merci \u2014 nous avons bien re\u00e7u votre message.","err":"Une erreur est survenue \u2014 r\u00e9essayez."},"de":{"ok":"\u2713 Danke \u2013 wir haben deine Nachricht erhalten.","err":"Etwas ist schiefgelaufen \u2014 versuch es noch einmal."},"it":{"ok":"\u2713 Grazie \u2014 abbiamo ricevuto il tuo messaggio.","err":"Qualcosa \u00e8 andato storto \u2014 riprova."},"ja":{"ok":"\u2713 \u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f\u3002","err":"\u554f\u984c\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002"},"ko":{"ok":"\u2713 \uac10\uc0ac\ud569\ub2c8\ub2e4 \u2014 \uba54\uc2dc\uc9c0\ub97c \uc798 \ubc1b\uc558\uc2b5\ub2c8\ub2e4.","err":"\ubb38\uc81c\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4 \u2014 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694."},"zh":{"ok":"\u2713 \u8c22\u8c22\uff0c\u6211\u4eec\u5df2\u6536\u5230\u4f60\u7684\u6d88\u606f\u3002","err":"\u51fa\u4e86\u70b9\u95ee\u9898\u2014\u2014\u8bf7\u91cd\u8bd5\u3002"},"nl":{"ok":"\u2713 Bedankt \u2014 we hebben je bericht ontvangen.","err":"Er ging iets mis \u2014 probeer het opnieuw."}};
  function tr(k){
    var l=(document.documentElement.getAttribute('lang')||'en').slice(0,2).toLowerCase();
    return (T[l]||T.en)[k];
  }
  function thanks(form){
    var msg=form.getAttribute('data-openlen-success')||tr('ok');
    var box=document.createElement('div');
    box.setAttribute('data-openlen-form-thanks','');
    box.style.cssText='padding:16px;border-radius:10px;background:rgba(16,185,129,.12);color:#059669;font:500 14px/1.5 system-ui,-apple-system,sans-serif;text-align:center';
    box.textContent=msg;
    if(form.parentNode)form.parentNode.replaceChild(box,form);
  }
  function succeed(form){
    var to=form.getAttribute('data-openlen-redirect');
    if(to){location.href=to;return;}
    thanks(form);
  }
  if(/[?&]openlen_form=ok/.test(location.search)){
    var done=document.querySelector('form[data-openlen-form]');
    if(done)thanks(done);
  }
  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||!form.matches||!form.matches('form[data-openlen-form]'))return;
    e.preventDefault();
    var btn=form.querySelector('button[type=submit],input[type=submit],button:not([type])');
    if(btn)btn.disabled=true;
    fetch(form.action,{method:'POST',body:new FormData(form),headers:{'Accept':'application/json'}})
      .then(function(r){if(!r.ok)throw 0;succeed(form);})
      .catch(function(){if(btn)btn.disabled=false;alert(tr('err'));});
  },true);
})();"#;

pub fn wire_published_forms(html: &str, action: &str, configs: &[FormConfig]) -> String {
    let doc = kuchikiki::parse_html().one(html);
    let forms: Vec<_> = match doc.select("form") {
        Ok(it) => it.collect(),
        Err(_) => return html.to_string(),
    };
    // Match the TS contract: an empty-forms doc returns the ORIGINAL string
    // verbatim — not the kuchikiki round-tripped version — so publishes that
    // have nothing to wire stay byte-equal on this leg of the pipeline.
    if forms.is_empty() {
        return html.to_string();
    }

    strip_credential_inputs(&doc);

    for (idx, form) in forms.iter().enumerate() {
        let idx_u32 = idx as u32;
        let form_node = form.as_node().clone();

        // 1. Set attributes. Scope the borrow_mut() to its own block so the
        // subsequent reads / appends don't trip the RefCell.
        if let NodeData::Element(d) = form_node.data() {
            let mut attrs = d.attributes.borrow_mut();
            attrs.insert("action", action.to_string());
            attrs.insert("method", "post".to_string());
            attrs.insert("data-openlen-form", String::new());

            if let Some(cfg) = configs.iter().find(|c| c.index == idx_u32) {
                if let Some(msg) = cfg.success_message.as_ref() {
                    if !msg.is_empty() {
                        attrs.insert("data-openlen-success", msg.clone());
                    }
                }
                if let Some(url) = cfg.redirect_url.as_ref() {
                    if !url.is_empty() {
                        attrs.insert("data-openlen-redirect", url.clone());
                    }
                }
            }
        }

        // 2. Append the form-index hidden input if absent.
        if !form_has_input_named(&form_node, "_openlen_form") {
            let hidden = format!(
                r#"<input type="hidden" name="_openlen_form" value="{}">"#,
                idx_u32
            );
            for n in parse_fragment_children(&hidden) {
                form_node.append(n);
            }
        }
        // 3. Append the honeypot input if absent.
        if !form_has_input_named(&form_node, "_openlen_hp") {
            for n in parse_fragment_children(HONEYPOT) {
                form_node.append(n);
            }
        }
    }

    // 4. Once-per-doc: append the submit-via-fetch script to <body> if absent.
    let has_script = doc
        .select("script[data-openlen-form-script]")
        .map(|mut it| it.next().is_some())
        .unwrap_or(false);
    if !has_script {
        if let Ok(body) = doc.select_first("body") {
            let body_node = body.as_node().clone();
            let script_html = format!(
                r#"<script data-openlen-form-script>{}</script>"#,
                FORM_SCRIPT
            );
            for n in parse_fragment_children(&script_html) {
                body_node.append(n);
            }
        }
    }

    serialize_doc(&doc)
}

/// Remove every credential-shaped input from the document (see the
/// password-gate note in the module header). Deterministic signals only:
/// `type=password` and an `autocomplete` token list containing
/// `one-time-code`.
fn strip_credential_inputs(doc: &NodeRef) {
    let inputs: Vec<NodeRef> = match doc.select("input") {
        Ok(it) => it.map(|n| n.as_node().clone()).collect(),
        Err(_) => return,
    };
    for input in inputs {
        let is_credential = {
            let NodeData::Element(d) = input.data() else {
                continue;
            };
            let attrs = d.attributes.borrow();
            let is_password = attrs
                .get("type")
                .map(|t| t.trim().eq_ignore_ascii_case("password"))
                .unwrap_or(false);
            let is_otp = attrs
                .get("autocomplete")
                .map(|a| {
                    a.split_whitespace()
                        .any(|t| t.eq_ignore_ascii_case("one-time-code"))
                })
                .unwrap_or(false);
            is_password || is_otp
        };
        if is_credential {
            input.detach();
        }
    }
}

fn form_has_input_named(form: &NodeRef, name: &str) -> bool {
    // The hidden-input names (_openlen_form / _openlen_hp) are fixed
    // identifiers with no CSS-special characters, so this format-and-match
    // is safe.
    let selector = format!(r#"input[name="{}"]"#, name);
    form.select(&selector)
        .map(|mut it| it.next().is_some())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(index: u32, success: Option<&str>, redirect: Option<&str>) -> FormConfig {
        FormConfig {
            index,
            success_message: success.map(String::from),
            redirect_url: redirect.map(String::from),
        }
    }

    const ACTION: &str = "https://openlen.com/api/f/example";

    #[test]
    fn no_forms_returns_original_string() {
        let html = "<html><head></head><body><p>no forms here</p></body></html>";
        let out = wire_published_forms(html, ACTION, &[]);
        // Byte-equal — we didn't even round-trip through kuchikiki.
        assert_eq!(out, html);
    }

    #[test]
    fn single_form_gets_attrs_and_hidden_inputs() {
        let html = r#"<body><form><input name="email"></form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert!(out.contains(&format!(r#"action="{}""#, ACTION)));
        assert!(out.contains(r#"method="post""#));
        assert!(out.contains("data-openlen-form"));
        assert!(out.contains(r#"name="_openlen_form" value="0""#));
        assert!(out.contains(r#"name="_openlen_hp""#));
        assert!(out.contains("data-openlen-form-script"));
    }

    #[test]
    fn multiple_forms_get_sequential_indices() {
        let html = r#"<body><form></form><form></form><form></form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert!(out.contains(r#"name="_openlen_form" value="0""#));
        assert!(out.contains(r#"name="_openlen_form" value="1""#));
        assert!(out.contains(r#"name="_openlen_form" value="2""#));
        // Three forms, three honeypots.
        assert_eq!(out.matches(r#"name="_openlen_hp""#).count(), 3);
        // ONE script — the marker gates against re-injection regardless of
        // form count.
        assert_eq!(out.matches("data-openlen-form-script").count(), 1);
    }

    #[test]
    fn form_config_baked_as_data_attrs() {
        let html = r#"<body><form></form></body>"#;
        let configs = vec![cfg(0, Some("Thanks for signing up!"), Some("/welcome"))];
        let out = wire_published_forms(html, ACTION, &configs);
        assert!(out.contains(r#"data-openlen-success="Thanks for signing up!""#));
        assert!(out.contains(r#"data-openlen-redirect="/welcome""#));
    }

    #[test]
    fn empty_success_or_redirect_skipped() {
        let html = r#"<body><form></form></body>"#;
        let configs = vec![cfg(0, Some(""), Some(""))];
        let out = wire_published_forms(html, ACTION, &configs);
        // Empty strings should not produce empty data-openlen-* attrs — matches
        // the TS truthy-check behaviour. Check for the attribute-pattern
        // (`name="`) rather than the bare name, since the FORM_SCRIPT body
        // also mentions both attr names via getAttribute('...').
        assert!(!out.contains(r#"data-openlen-success=""#));
        assert!(!out.contains(r#"data-openlen-redirect=""#));
    }

    #[test]
    fn partial_configs_only_apply_to_named_index() {
        let html = r#"<body><form></form><form></form></body>"#;
        let configs = vec![cfg(1, Some("Form 2 thanks"), None)];
        let out = wire_published_forms(html, ACTION, &configs);
        assert!(out.contains(r#"data-openlen-success="Form 2 thanks""#));
        // Form 0 has no success attr — one attribute, ignoring script-body mentions.
        assert_eq!(out.matches(r#"data-openlen-success=""#).count(), 1);
    }

    #[test]
    fn out_of_range_config_index_ignored() {
        let html = r#"<body><form></form></body>"#;
        let configs = vec![cfg(99, Some("Never used"), None)];
        let out = wire_published_forms(html, ACTION, &configs);
        assert!(!out.contains(r#"data-openlen-success=""#));
        assert!(!out.contains("Never used"));
    }

    #[test]
    fn existing_openlen_form_input_not_duplicated() {
        let html =
            r#"<body><form><input type="hidden" name="_openlen_form" value="99"></form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        // Only ONE _openlen_form input — the pre-existing one survives.
        assert_eq!(out.matches(r#"name="_openlen_form""#).count(), 1);
        // And its original value="99" is preserved (we didn't overwrite it).
        assert!(out.contains(r#"value="99""#));
    }

    #[test]
    fn existing_honeypot_input_not_duplicated() {
        let html = r#"<body><form><input name="_openlen_hp"></form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert_eq!(out.matches(r#"name="_openlen_hp""#).count(), 1);
    }

    #[test]
    fn existing_script_not_duplicated() {
        let html =
            r#"<body><form></form><script data-openlen-form-script>// prior</script></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert_eq!(out.matches("data-openlen-form-script").count(), 1);
        // The prior script body is preserved.
        assert!(out.contains("// prior"));
    }

    #[test]
    fn idempotent_after_first_application() {
        let html = r#"<body><form></form></body>"#;
        let once = wire_published_forms(html, ACTION, &[]);
        let twice = wire_published_forms(&once, ACTION, &[]);
        // Once-injected hidden inputs + script don't duplicate; attribute
        // re-set with the same value is a no-op at the serializer level.
        assert_eq!(once, twice);
    }

    #[test]
    fn password_inputs_stripped_from_wired_forms() {
        let html = r#"<body><form>
            <input name="email" type="email">
            <input name="pass" type="password">
            <input name="pass2" type=" PASSWORD ">
            <button type="submit">Login</button>
        </form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert!(!out.contains("password"));
        assert!(!out.contains(r#"name="pass""#));
        // The benign fields and the wiring survive.
        assert!(out.contains(r#"name="email""#));
        assert!(out.contains("data-openlen-form"));
        assert!(out.contains(r#"name="_openlen_hp""#));
    }

    #[test]
    fn otp_inputs_stripped() {
        let html = r#"<body><form>
            <input name="email" autocomplete="email">
            <input name="code" inputmode="numeric" autocomplete="one-time-code">
        </form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert!(!out.contains("one-time-code"));
        assert!(!out.contains(r#"name="code""#));
        assert!(out.contains(r#"autocomplete="email""#));
    }

    #[test]
    fn password_inputs_outside_forms_also_stripped_when_wiring() {
        // A fake login box NEXT to a wired form must not survive either —
        // the strip is document-wide whenever the page has forms.
        let html = r#"<body>
            <div class="fake-login"><input type="password" name="pw"></div>
            <form><input name="email"></form>
        </body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert!(!out.contains("password"));
        assert!(out.contains("fake-login")); // only the input goes, not the layout
    }

    #[test]
    fn formless_page_with_password_input_stays_byte_equal() {
        // No <form> = no /api/f submission channel = nothing to harvest
        // into; the early-return byte-equality contract holds.
        let html = r#"<body><input type="password" name="pw"></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        assert_eq!(out, html);
    }

    #[test]
    fn normal_form_fields_untouched_by_the_gate() {
        let html = r#"<body><form>
            <input name="name" type="text">
            <input name="email" type="email">
            <input name="phone" type="tel">
            <textarea name="message"></textarea>
        </form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        for field in [
            "name=\"name\"",
            "name=\"email\"",
            "name=\"phone\"",
            "name=\"message\"",
        ] {
            assert!(out.contains(field), "missing {field}");
        }
    }

    #[test]
    fn form_script_contains_expected_markers() {
        let html = r#"<body><form></form></body>"#;
        let out = wire_published_forms(html, ACTION, &[]);
        // A couple of stable substrings from FORM_SCRIPT — guards against
        // accidental script-string corruption.
        assert!(out.contains("openlen_form=ok"));
        assert!(out.contains("data-openlen-success"));
        assert!(out.contains("form[data-openlen-form]"));
    }
}
