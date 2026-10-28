// THE «SELECTS EVERYTHING» GATE over the whole corpus (spec local 2026-10-27, §9):
// every starter template in the repo, plus what lives in the local, git-ignored
// plans/mentions-gate/corpus/ — gallery templates and Jesús's own projects,
// read-only, never another customer's:
//
//   corpus/pages/<name>.html          one page each
//   corpus/apps/<name>/app.json       { "catalogo": "2026-11", "entrada": "/src/main.jsx" }
//   corpus/apps/<name>/index.html     the shell
//   corpus/apps/<name>/src/...        the app's files
//
// Writes plans/mentions-gate/report.md and exits 1 if any failure is of no
// known class. Run before merging, and whenever the index changes:
//
//   npm run mentions:gate
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import { runMentionsGate, type GateDoc, type GateReport } from "@/lib/mentions/gate";
import type { AppDeProyecto } from "@/lib/projects/types";

const ROOT = process.cwd();
const STARTER = path.join(ROOT, "templates", "starter");
const CORPUS = path.join(ROOT, "plans", "mentions-gate", "corpus");
const REPORT = path.join(ROOT, "plans", "mentions-gate", "report.md");

function filesUnder(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(out, filesUnder(full, base));
    else out[`/${path.relative(base, full).split(path.sep).join("/")}`] = readFileSync(full, "utf8");
  }
  return out;
}

function corpus(): GateDoc[] {
  const docs: GateDoc[] = readdirSync(STARTER)
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({ name: `starter/${f}`, kind: "page" as const, html: readFileSync(path.join(STARTER, f), "utf8") }));
  const skeleton = esqueletoDeApp({ titulo: "Caja" });
  docs.push({ name: "app-skeleton", kind: "app", files: skeleton.ficheros, app: skeleton.app, shell: skeleton.html });
  const pages = path.join(CORPUS, "pages");
  if (existsSync(pages)) {
    for (const f of readdirSync(pages).filter((x) => x.endsWith(".html"))) {
      docs.push({ name: `pages/${f}`, kind: "page", html: readFileSync(path.join(pages, f), "utf8") });
    }
  }
  const apps = path.join(CORPUS, "apps");
  if (existsSync(apps)) {
    for (const name of readdirSync(apps)) {
      const dir = path.join(apps, name);
      const app = JSON.parse(readFileSync(path.join(dir, "app.json"), "utf8")) as AppDeProyecto;
      const shell = readFileSync(path.join(dir, "index.html"), "utf8");
      const files = Object.fromEntries(Object.entries(filesUnder(dir)).filter(([r]) => r !== "/app.json"));
      docs.push({ name: `apps/${name}`, kind: "app", files, app, shell });
    }
  }
  return docs;
}

function markdown(report: GateReport): string {
  const lines = ["# «@» selects-everything gate", "", `Run: ${new Date().toISOString()}`, ""];
  let unknown = 0;
  for (const d of report.docs) {
    const byClass = new Map<string, number>();
    for (const f of d.failures) byClass.set(f.knownClass ?? "UNKNOWN", (byClass.get(f.knownClass ?? "UNKNOWN") ?? 0) + 1);
    unknown += byClass.get("UNKNOWN") ?? 0;
    const summary = [...byClass].map(([k, v]) => `${k} ${v}`).join(", ") || "clean";
    lines.push(`## ${d.name} — ${d.checked} entries — ${summary}`);
    for (const f of d.failures.filter((x) => x.knownClass === null)) lines.push(`- check ${f.check} · \`${f.key}\` · ${f.reason}`);
    lines.push("");
  }
  lines.splice(3, 0, `Unknown-class failures: **${unknown}**`, "");
  return lines.join("\n");
}

async function main() {
  const docs = corpus();
  console.log(`[mentions:gate] ${docs.length} documents`);
  const report = await runMentionsGate(docs);
  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, markdown(report));
  const unknown = report.docs.flatMap((d) => d.failures).filter((f) => f.knownClass === null).length;
  console.log(`[mentions:gate] report: ${REPORT} — unknown-class failures: ${unknown}`);
  await stopBundlerWorker();
  process.exit(unknown > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(2);
});
