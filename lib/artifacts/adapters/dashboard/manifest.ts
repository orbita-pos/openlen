import { ArtifactError, type SealedArtifactInput } from "../../types";
import { safeArtifactPath } from "../../state";
import { validateRenderPacket, type RenderProbe } from "../../render-protocol";
import {CATALOGO_ACTUAL,catalogo} from "../../../apps/dependencias";
export interface DashboardManifest { readonly entry: string; readonly datasetIds: readonly string[]; readonly width: number; readonly height: number; readonly probes: readonly RenderProbe[]; readonly catalogo?:string }
export function dashboardManifest(input: SealedArtifactInput): DashboardManifest {
  let m: DashboardManifest;
  try { m = JSON.parse(input.revision.files["dashboard.json"] ?? ""); } catch { throw new ArtifactError("invalid_dashboard_manifest"); }
  if (!m || typeof m.entry !== "string" || !safeArtifactPath(m.entry) || !m.entry.endsWith(".html") || !Object.hasOwn(input.revision.files, m.entry)
    || !Array.isArray(m.datasetIds) || !m.datasetIds.length || m.datasetIds.length > 20 || new Set(m.datasetIds).size !== m.datasetIds.length
    || m.datasetIds.some((id) => typeof id !== "string" || !input.datasets.some((d) => d.id === id))) throw new ArtifactError("dashboard_dataset_missing");
  validateRenderPacket({ version: 1, kind: "dashboard", html: "", width: m.width, height: m.height, probes: m.probes ?? [] });
  if(m.catalogo!==undefined&&(typeof m.catalogo!=="string"||!catalogo(m.catalogo)))throw new ArtifactError("artifact_catalog_unavailable");
  return { ...m,catalogo:m.catalogo??CATALOGO_ACTUAL, probes: m.probes ?? [] };
}
