// npm run test:flaky — the flaky hunt (DeepSeek's nightly `--repeat --shuffle`, `deterministic-and-stress-
// testing`): the gate's test files (len-replay-files.mjs), N runs, each in a shuffled order with its own seed.
// A test that fails in some runs and passes in others only passed by luck or by order: it is reported with
// the seed that reproduces it (`vitest run --sequence.shuffle --sequence.seed=<seed> <file>`). A test that
// fails every run is a plain failure and is reported apart. No model, no database, $0.
//
//   FLAKY_RUNS=20 (default)   FLAKY_FILES=a.test.ts,b.test.ts   FLAKY_VITEST_CONFIG=../vitest.len31.mts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_FILES } from "./len-replay-files.mjs";

const runs = Number(process.env.FLAKY_RUNS ?? 20);
const files = process.env.FLAKY_FILES ? process.env.FLAKY_FILES.split(",").map((f) => f.trim()).filter(Boolean) : DEFAULT_FILES;
const missing = files.filter((f) => !existsSync(f));
if (missing.length > 0) {
  console.error(`test:flaky — missing test file(s): ${missing.join(", ")}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const config = process.env.FLAKY_VITEST_CONFIG;
const dir = mkdtempSync(join(tmpdir(), "flaky-hunt-"));
/** test → { passed, failed, seeds that failed } */
const seen = new Map();

try {
  for (let i = 1; i <= runs; i++) {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const out = join(dir, `run-${i}.json`);
    spawnSync(
      process.execPath,
      [
        require.resolve("vitest/vitest.mjs"),
        "run",
        ...(config ? ["--config", config] : []),
        "--sequence.shuffle",
        `--sequence.seed=${seed}`,
        "--reporter=json",
        `--outputFile=${out}`,
        ...files,
      ],
      { stdio: "ignore", env: { ...process.env } },
    );
    if (!existsSync(out)) {
      console.error(`test:flaky — run ${i} (seed ${seed}) wrote no report: vitest did not finish`);
      process.exit(1);
    }
    const report = JSON.parse(readFileSync(out, "utf8"));
    for (const file of report.testResults ?? []) {
      for (const t of file.assertionResults ?? []) {
        if (t.status !== "passed" && t.status !== "failed") continue;
        const key = `${file.name.replace(/\\/g, "/").split("/").slice(-3).join("/")} › ${t.fullName}`;
        const s = seen.get(key) ?? { passed: 0, failed: 0, seeds: [] };
        if (t.status === "passed") s.passed++;
        else {
          s.failed++;
          s.seeds.push(seed);
        }
        seen.set(key, s);
      }
    }
    process.stdout.write(`run ${i}/${runs} (seed ${seed}) done\n`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const flaky = [...seen].filter(([, s]) => s.failed > 0 && s.passed > 0);
const broken = [...seen].filter(([, s]) => s.failed > 0 && s.passed === 0);
console.log(`\ntest:flaky — ${seen.size} tests × ${runs} shuffled runs`);
for (const [name, s] of flaky) console.log(`FLAKY  ${name}  (failed ${s.failed}/${s.passed + s.failed}; seeds ${s.seeds.join(", ")})`);
for (const [name] of broken) console.log(`FAILS  ${name}  (every run)`);
if (flaky.length === 0 && broken.length === 0) console.log("no flaky tests, no failures");
process.exit(flaky.length + broken.length > 0 ? 1 : 0);
