import { ArtifactError, type AdapterResult, type SealedArtifactInput } from "../../types";
import type { ArtifactRender } from "../../render-protocol";
import { buildDashboard } from "./compile";
import { validateRenderPng } from "./validate";

export async function renderDashboard(input: SealedArtifactInput, render: ArtifactRender, signal: AbortSignal): Promise<AdapterResult> {
  const built = await buildDashboard(input);
  signal.throwIfAborted();
  const rendered = await render({ version: 1, kind: "dashboard", html: built.html, width: built.manifest.width, height: built.manifest.height, probes: built.manifest.probes }, signal);
  validateRenderPng(rendered.png, built.manifest.width, built.manifest.height);
  if (!rendered.checks.includes("runtime:no-errors") || !rendered.checks.includes("resources:complete")) throw new ArtifactError("invalid_render_evidence");
  return { outputs: [ { name: "dashboard.html", format: "html", mime: "text/html", bytes: new TextEncoder().encode(built.html) }, { name: "dashboard.png", format: "png", mime: "image/png", bytes: rendered.png }, ...built.csv.map((csv) => ({ name: `dataset-${csv.id}.csv`, format: "csv", mime: "text/csv", bytes: new TextEncoder().encode(csv.text) })) ], evidence: { valid: true, checkedAt: new Date().toISOString(), checks: ["sources:compiled", "datasets:bound", ...rendered.checks] } };
}
