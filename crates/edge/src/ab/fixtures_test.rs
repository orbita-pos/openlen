//! The shared `evaluate` fixtures: the SAME JSON file (`tests/fixtures/ab/evaluate.json`) is run by
//! `lib/ab/serve.test.ts` against the TypeScript resolver, so a case that passes here and fails
//! there (dotfiles, query decoding, `expiresAt`, a malformed experiment, unreadable headers…) is a
//! split between the edge and the custom-domain fallback that no visitor should ever see.

use std::net::SocketAddr;

use axum::http::{header, HeaderMap, HeaderName, HeaderValue};
use chrono::{DateTime, Utc};
use serde_json::Value;

use super::{evaluate_manifest, facts_from_headers, parse_manifest, AbDecision};

const FIXTURES: &str = include_str!("../../tests/fixtures/ab/evaluate.json");

fn manifest_text(case: &Value) -> String {
    let m = &case["manifest"];
    match m.get("raw").and_then(Value::as_str) {
        Some(raw) => raw.to_owned(),
        None => m.to_string(),
    }
}

/// The request of a case, through the same header decoding the sidecar uses.
fn decide(case: &Value) -> Option<AbDecision> {
    let manifest = parse_manifest(manifest_text(case).as_bytes())?;
    let r = &case["request"];
    let text = |k: &str| r[k].as_str().unwrap_or("");
    let mut headers = HeaderMap::new();
    // A header value may carry any byte (a UTF-8 'ñ' is two of them); `to_str` refuses those.
    let set = |h: &mut HeaderMap, name: HeaderName, v: &str| {
        h.insert(name, HeaderValue::from_bytes(v.as_bytes()).expect("header bytes"));
    };
    set(&mut headers, header::USER_AGENT, text("ua"));
    set(&mut headers, header::ACCEPT_LANGUAGE, text("lang"));
    set(&mut headers, HeaderName::from_static("cf-connecting-ip"), text("ip"));
    if let Some(cookie) = r["cookie"].as_str() {
        set(&mut headers, header::COOKIE, cookie);
    }
    let peer: SocketAddr = "127.0.0.1:1".parse().unwrap();
    let facts = facts_from_headers(&headers, peer);
    let now: DateTime<Utc> =
        DateTime::from_timestamp_millis(r["nowMs"].as_i64().expect("nowMs")).expect("nowMs");
    let query = text("query");
    evaluate_manifest(
        &manifest,
        text("path"),
        (!query.is_empty()).then_some(query),
        facts.cookie.as_deref(),
        &facts.user_agent,
        &facts.accept_language,
        &facts.client_ip,
        r["secure"].as_bool().unwrap_or(true),
        now,
    )
}

fn check(case: &Value, got: Option<AbDecision>) -> Vec<String> {
    let name = case["name"].as_str().unwrap_or("?");
    let expect = &case["expect"];
    let mut problems = Vec::new();
    if expect.is_null() {
        if let Some(d) = got {
            problems.push(format!("{name}: expected no decision, got {d:?}"));
        }
        return problems;
    }
    let Some(d) = got else {
        problems.push(format!("{name}: expected {expect}, got no decision"));
        return problems;
    };
    let mut want = |key: &str, actual: Value| {
        if let Some(e) = expect.get(key) {
            if *e != actual {
                problems.push(format!("{name}: {key}: expected {e}, got {actual}"));
            }
        }
    };
    want("experimentId", Value::from(d.experiment_id.clone()));
    want("variant", Value::from(d.variant.as_str()));
    want("source", Value::from(d.source.as_label()));
    want("variantBPath", d.variant_b_path.clone().map_or(Value::Null, Value::from));
    want("setCookie", d.set_cookie.clone().map_or(Value::Null, Value::from));
    want("isOverride", Value::from(d.is_override));
    want("isPageRoute", Value::from(d.is_page_route));
    problems
}

#[test]
fn the_shared_evaluate_fixtures_pass() {
    let doc: Value = serde_json::from_str(FIXTURES).expect("evaluate.json");
    let cases = doc["cases"].as_array().expect("cases");
    assert!(cases.len() >= 80, "the fixtures shrank to {}", cases.len());
    let problems: Vec<String> = cases
        .iter()
        .flat_map(|case| check(case, decide(case)))
        .collect();
    assert!(
        problems.is_empty(),
        "{} of {} fixture cases differ:\n{}",
        problems.len(),
        cases.len(),
        problems.join("\n")
    );
}
