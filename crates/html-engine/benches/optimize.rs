// Criterion bench for optimize_for_publish over each starter template.
// Sem 8 acceptance: publish p95 target is <200ms — this is the dominant
// cost at publish time once Sem 10 wires the engine, so we measure it
// in isolation here.

use std::fs;
use std::path::PathBuf;

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

use openlen_html_engine::minify;

fn starter_path(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../../templates/starter");
    p.push(name);
    p
}

fn read_starter(name: &str) -> String {
    fs::read_to_string(starter_path(name)).expect("starter template readable")
}

fn bench_optimize_chain(c: &mut Criterion) {
    let templates = [
        ("mirror", read_starter("mirror.html")),
        ("counter", read_starter("counter.html")),
        ("manuscript", read_starter("manuscript.html")),
    ];

    let mut group = c.benchmark_group("optimize/for_publish");
    for (name, html) in &templates {
        group.throughput(criterion::Throughput::Bytes(html.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), html, |b, html| {
            b.iter(|| minify::optimize_for_publish(black_box(html)));
        });
    }
    group.finish();
}

// Idempotent path: measure the cost of a second pass on an already-
// optimized document. Should be roughly the same wall-clock as pass 1
// minus the bytes-saved difference — published HTML on disk gets
// re-optimized if a user re-publishes, so the cost matters.
fn bench_optimize_second_pass(c: &mut Criterion) {
    let templates = [
        (
            "mirror",
            minify::optimize_for_publish(&read_starter("mirror.html"))
                .html
                .unwrap(),
        ),
        (
            "counter",
            minify::optimize_for_publish(&read_starter("counter.html"))
                .html
                .unwrap(),
        ),
        (
            "manuscript",
            minify::optimize_for_publish(&read_starter("manuscript.html"))
                .html
                .unwrap(),
        ),
    ];

    let mut group = c.benchmark_group("optimize/second_pass");
    for (name, html) in &templates {
        group.throughput(criterion::Throughput::Bytes(html.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(name), html, |b, html| {
            b.iter(|| minify::optimize_for_publish(black_box(html)));
        });
    }
    group.finish();
}

criterion_group!(benches, bench_optimize_chain, bench_optimize_second_pass);
criterion_main!(benches);
