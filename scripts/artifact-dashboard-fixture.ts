import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { buildDashboard } from "../lib/artifacts/adapters/dashboard/compile";
import { dashboardFixture } from "../lib/artifacts/testing/dashboard";
import { stopBundlerWorker } from "../lib/apps/bundler/bundle-app";
async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Pass an explicit output directory for the synthetic fixture");
  try {
    const built = await buildDashboard(dashboardFixture());
    const dir = resolve(target); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "dashboard.html"), built.html);
    await writeFile(join(dir, "dashboard.csv"), built.csv[0]!.text);
    await writeFile(join(dir, "packet.json"), JSON.stringify({ version: 1, kind: "dashboard", html: built.html, width: 1280, height: 720, probes: built.manifest.probes }));
    console.log("Synthetic dashboard fixture compiled; browser/container validation is separate.");
  } finally { stopBundlerWorker(); }
}
main().catch(() => { console.error("Fixture compilation failed"); process.exitCode = 1; });
