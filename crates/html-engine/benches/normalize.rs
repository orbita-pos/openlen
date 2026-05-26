// Criterion bench for the normalize chain on each starter template plus
// each individual pass on mirror.html. The chain target from the F1 plan
// is ≥20× faster than the TS regex chain; the TS-side timing is in
// __test__/perf-normalize-vs-ts.mjs alongside.

use std::fs;
use std::path::PathBuf;

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

use openlen_html_engine::normalize;

fn starter_path(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p.push(name);
    p
}

fn read_starter(name: &str) -> String {
    fs::read_to_string(starter_path(name)).expect("starter template readable")
}

fn bench_chain(c: &mut Criterion) {
    let templates = [
        ("mirror", read_starter("mirror.html")),
        ("counter", read_starter("counter.html")),
        ("manuscript", read_starter("manuscript.html")),
    ];

    let mut group = c.benchmark_group("normalize/chain");
    for (name, html) in &templates {
        group.throughput(criterion::Throughput::Bytes(html.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), html, |b, html| {
            b.iter(|| normalize::normalize_born_canonical(black_box(html)));
        });
    }
    group.finish();
}

fn bench_passes(c: &mut Criterion) {
    let mirror = read_starter("mirror.html");
    let mut group = c.benchmark_group("normalize/passes/mirror");
    group.throughput(criterion::Throughput::Bytes(mirror.len() as u64));

    group.bench_function("radius", |b| {
        b.iter(|| normalize::normalize_radius(black_box(&mirror)));
    });
    let after_radius = normalize::normalize_radius(&mirror);
    group.bench_function("space", |b| {
        b.iter(|| normalize::normalize_space(black_box(&after_radius)));
    });
    let after_space = normalize::normalize_space(&after_radius);
    group.bench_function("type", |b| {
        b.iter(|| normalize::normalize_type(black_box(&after_space)));
    });
    let after_type = normalize::normalize_type(&after_space);
    group.bench_function("font", |b| {
        b.iter(|| normalize::normalize_font(black_box(&after_type)));
    });
    let after_font = normalize::normalize_font(&after_type);
    group.bench_function("accent", |b| {
        b.iter(|| normalize::normalize_accent(black_box(&after_font)));
    });
    let after_accent = normalize::normalize_accent(&after_font);
    group.bench_function("color", |b| {
        b.iter(|| normalize::normalize_color(black_box(&after_accent)));
    });
    let after_color = normalize::normalize_color(&after_accent);
    group.bench_function("modes", |b| {
        b.iter(|| normalize::normalize_color_modes(black_box(&after_color)));
    });

    group.finish();
}

criterion_group!(benches, bench_chain, bench_passes);
criterion_main!(benches);
