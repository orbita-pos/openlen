import { ArtifactError, isArtifactError, type ArtifactDataset, type SealedArtifactInput } from "../../types";
import { safeArtifactPath } from "../../state";
import { validateRenderPacket, type RenderProbe } from "../../render-protocol";
import {CATALOGO_ACTUAL,catalogo} from "../../../apps/dependencias";
import { DATASET_FILE, fileDataset } from "./file-datasets";
export interface DashboardManifest { readonly entry: string; readonly datasetIds: readonly string[]; readonly width: number; readonly height: number; readonly probes: readonly RenderProbe[]; readonly catalogo?:string; readonly datasets?: Readonly<Record<string, { title?: string; description?: string }>> }
export const NONE = 'dashboard.json datasetIds needs at least one dataset: an id that query_artifact_data returned, or a CSV, TSV or JSON file of this dashboard (rows you write are a hypothetical scenario; say what they are in "datasets": {"<file>": {"title", "description"}})';
export function dashboardManifest(input: SealedArtifactInput): DashboardManifest & { readonly resolved: readonly ArtifactDataset[] } {
  let m: DashboardManifest;
  try { m = JSON.parse(input.revision.files["dashboard.json"] ?? ""); } catch { throw new ArtifactError("invalid_dashboard_manifest", "dashboard.json is not JSON"); }
  if (!m || typeof m.entry !== "string" || !safeArtifactPath(m.entry) || !m.entry.endsWith(".html") || !Object.hasOwn(input.revision.files, m.entry)) throw new ArtifactError("invalid_dashboard_manifest", 'dashboard.json "entry" names this dashboard\'s .html file');
  if (!Array.isArray(m.datasetIds) || !m.datasetIds.length) throw new ArtifactError("dashboard_dataset_missing", NONE);
  if (m.datasetIds.length > 20 || new Set(m.datasetIds).size !== m.datasetIds.length || m.datasetIds.some((id) => typeof id !== "string")) throw new ArtifactError("dashboard_dataset_missing", "dashboard.json datasetIds: up to 20 distinct ids");
  const capturedAt = input.revision.sealedAt ? new Date(input.revision.sealedAt).toISOString() : new Date(0).toISOString();
  const resolved = m.datasetIds.map((id) => {
    const saved = input.datasets.find((d) => d.id === id);
    if (saved) return saved;
    if (DATASET_FILE.test(id) && safeArtifactPath(id) && Object.hasOwn(input.revision.files, id)) return fileDataset(id, input.revision.files[id]!, m.datasets?.[id], capturedAt);
    throw new ArtifactError("dashboard_dataset_missing", `"${id}" is neither a dataset query_artifact_data saved here nor a CSV, TSV or JSON file of this dashboard`);
  });
  // The packet check names the field ("height" is 1200…); here it is a field of dashboard.json, as in the errors above.
  try { validateRenderPacket({ version: 1, kind: "dashboard", html: "", width: m.width, height: m.height, probes: m.probes ?? [] }); }
  catch (error) { throw isArtifactError(error) && error.code === "invalid_render_packet" ? new ArtifactError(error.code, `dashboard.json ${error.message}`) : error; }
  if(m.catalogo!==undefined&&(typeof m.catalogo!=="string"||!catalogo(m.catalogo)))throw new ArtifactError("artifact_catalog_unavailable");
  return { ...m,catalogo:m.catalogo??CATALOGO_ACTUAL, probes: m.probes ?? [], resolved };
}
