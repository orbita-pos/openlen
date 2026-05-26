// Criterion bench harness for the ID-tagged ops pipeline (Sem 5
// comparable; benchmarked on the largest starter template, mirror.html).
// `tag + parse + apply + strip` is the per-Kimi-turn cost — the chat-turn
// HTML overhead the F1 plan targets at p95 < 30 ms.

use std::fs;
use std::path::PathBuf;

use criterion::{black_box, criterion_group, criterion_main, Criterion};

use openlen_html_engine::ops::{apply, parse, stripper, tagger};

fn starter_path(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p.push(name);
    p
}

fn read_starter(name: &str) -> String {
    fs::read_to_string(starter_path(name)).expect("starter template readable")
}

fn ops_envelope(n: usize) -> String {
    let mut s = String::from("<edits>");
    for i in 0..n {
        s.push_str(&format!(
            "<edit op=\"replace\" target=\"{}\"><span>v{}</span></edit>",
            radix36(i),
            i
        ));
    }
    s.push_str("</edits>");
    s
}

fn radix36(mut n: usize) -> String {
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        let d = (n % 36) as u8;
        let c = if d < 10 { b'0' + d } else { b'a' + d - 10 };
        out.push(c);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

fn bench_ops(c: &mut Criterion) {
    let mirror = read_starter("mirror.html");
    let mirror_len = mirror.len();

    let mut group = c.benchmark_group("ops/mirror");
    group.throughput(criterion::Throughput::Bytes(mirror_len as u64));

    group.bench_function("tag", |b| {
        b.iter(|| tagger::tag_with_op_ids(black_box(&mirror)).unwrap());
    });

    let tagged = tagger::tag_with_op_ids(&mirror).unwrap().tagged_html;

    group.bench_function("strip", |b| {
        b.iter(|| stripper::strip_op_ids(black_box(&tagged)));
    });

    let envelope = ops_envelope(20);
    group.bench_function("parse_envelope_20", |b| {
        b.iter(|| parse::parse_ops(black_box(&envelope)));
    });

    let ops_for_apply: Vec<apply::Op> = parse::parse_ops(&ops_envelope(10)).ops;

    group.bench_function("apply_10", |b| {
        b.iter(|| apply::apply_ops(black_box(&tagged), black_box(&ops_for_apply)));
    });

    group.bench_function("tag_parse_apply_strip", |b| {
        b.iter(|| {
            let t = tagger::tag_with_op_ids(black_box(&mirror)).unwrap();
            let p = parse::parse_ops(black_box(&envelope));
            let a = apply::apply_ops(&t.tagged_html, &p.ops);
            stripper::strip_op_ids(a.html.as_deref().unwrap_or(&t.tagged_html))
        });
    });

    group.finish();
}

criterion_group!(benches, bench_ops);
criterion_main!(benches);
