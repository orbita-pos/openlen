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
    // ⚰️ AQUÍ SE MEDÍAN `font` y `accent`. Las dos pasadas se BORRARON el
    // 2026-08-26 («dejamos de re-decidir el diseño del modelo»): no inyectaban,
    // REESCRIBÍAN. El bench se quedó llamándolas y por eso `cargo clippy
    // --all-targets` no compilaba — `cargo test` no lo caza porque no toca los
    // benches. Eran 7 pasadas y quedan 5; el encadenado sigue el mismo orden.
    group.bench_function("color", |b| {
        b.iter(|| normalize::normalize_color(black_box(&after_type)));
    });
    let after_color = normalize::normalize_color(&after_type);
    group.bench_function("modes", |b| {
        b.iter(|| normalize::normalize_color_modes(black_box(&after_color)));
    });

    group.finish();
}

criterion_group!(benches, bench_chain, bench_passes);
criterion_main!(benches);
