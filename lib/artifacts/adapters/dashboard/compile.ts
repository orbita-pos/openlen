import path from "node:path";
import { parse } from "node-html-parser";
import { compilarCarpeta, textoDeDiagnostico } from "../../../apps/compilador";
import { CATALOGO_ACTUAL } from "../../../apps/dependencias";
import { runBundler } from "../../../apps/bundler/bundle-app";
import { ArtifactError, type ArtifactDataset, type SealedArtifactInput } from "../../types";
import { dashboardManifest } from "./manifest";
import {artifactDatasetForDisplay} from "../../dataset-display";

import { ARTIFACT_CSP } from "../../html-policy";
export { ARTIFACT_CSP } from "../../html-policy";
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const scriptText = (s: string) => s.replace(/<\/script/gi, "<\\/script");
export function datasetLabel(d: ArtifactDataset): string { return d.mode === "scenario" ? "Escenario hipotético" : `Datos ${d.mode === "live" ? "actualizados" : "capturados"} · ${d.environment ?? d.source} · ${d.capturedAt}`; }
function csvCell(v: unknown): string {
  let s = v === null ? "" : String(v);
  // Spreadsheet formulas are not data. Preserve values visibly, without
  // turning a visitor-controlled CSV cell into an executable formula.
  if (/^[\t\r\n =+@-]/.test(s) && typeof v !== "number") s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function datasetCsv(d: ArtifactDataset): string {
  return [`# ${datasetLabel(d)}${d.truncated ? " · Datos recortados" : ""}`, d.columns.map(csvCell).join(","), ...d.rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

/** One compiler and bundler path: only independent in-memory sources. No
 * project env, credential substitution, npm install or network resolution. */
export async function compileArtifactHtml(input: SealedArtifactInput, entryHtml: string, datasets: readonly ArtifactDataset[], trustedRuntime = "") {
  const tree = parse(input.revision.files[entryHtml]!);
  const head = tree.querySelector("head"), body = tree.querySelector("body");
  if (!head || !body || tree.querySelector("base,iframe,object,embed,meta[http-equiv=refresh]")) throw new ArtifactError("invalid_artifact_html");
  const files = Object.fromEntries(Object.entries(input.revision.files).filter(([p])=>!(input.revision.sourceRef?.frozenSourcePrefix&&p.startsWith(input.revision.sourceRef.frozenSourcePrefix))).map(([p, code]) => [`/${p}`, code]));
  const entryPaths: string[] = [];
  for (const [index, element] of tree.querySelectorAll("script").entries()) {
    const type = element.getAttribute("type");
    if (type === "application/json") continue;
    if (type && type !== "module" && type !== "text/javascript") throw new ArtifactError("artifact_script_type_unsupported");
    const src = element.getAttribute("src");
    let entry: string;
    if (src) {
      if (/^[a-z]+:|^\/\//i.test(src) || src.includes("?") || src.includes("#")) throw new ArtifactError("artifact_resource_missing");
      entry = path.posix.resolve("/", path.posix.dirname(entryHtml), src);
      if (!Object.hasOwn(files, entry)) throw new ArtifactError("artifact_resource_missing");
    } else { entry = `/artifact-inline-${index}.ts`; files[entry] = element.textContent; }
    // A unique synthetic entry also prevents same-basename module collisions.
    const wrapper = `/artifact-entry-${index}.ts`;
    files[wrapper] = `import ${JSON.stringify(entry)};`;
    entryPaths.push(wrapper);
    element.removeAttribute("src"); element.setAttribute("type", "module"); element.setAttribute("data-artifact-entry", String(index));
  }
  const compiled = compilarCarpeta({ carpeta: files, catalogo: CATALOGO_ACTUAL, entorno: {} });
  if (compiled.errores.length) throw new ArtifactError("artifact_compile_failed", compiled.errores.slice(0, 8).map(textoDeDiagnostico).join("\n"));
  if (compiled.paquetes.length) throw new ArtifactError("artifact_package_unavailable", "This renderer currently accepts local modules and browser APIs only; external packages must be vendored and verified first.");
  if (entryPaths.length) {
    const bundle = await runBundler({ entries: entryPaths, modules: compiled.ficheros, virtual: {}, mocked: [], empty: [], catalogFiles: {}, vendorRoots: {}, minify: false, nodeEnv: "production", sourcemap: false }, 30_000);
    if (!bundle || bundle.errors.length) throw new ArtifactError("artifact_compile_failed", bundle?.errors.slice(0, 8).map((e) => `${e.file}:${e.line}: ${e.text}`).join("\n") ?? "Compiler timed out");
    for (const element of tree.querySelectorAll("script[data-artifact-entry]")) {
      const index = Number(element.getAttribute("data-artifact-entry"));
      const js = bundle.outputs[`artifact-entry-${index}.js`];
      if (!js) throw new ArtifactError("artifact_compile_failed");
      element.set_content(scriptText(js)); element.removeAttribute("data-artifact-entry");
    }
  }
  for (const element of tree.querySelectorAll("link[rel=stylesheet]")) {
    const href = element.getAttribute("href") ?? "";
    if (/^[a-z]+:|^\/\//i.test(href)) throw new ArtifactError("artifact_resource_missing");
    const css = files[path.posix.resolve("/", path.posix.dirname(entryHtml), href)];
    if (css === undefined || /@import\b|url\s*\(\s*(?!["']?data:)/i.test(css)) throw new ArtifactError("artifact_resource_missing");
    element.replaceWith(`<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
  }
  for (const element of tree.querySelectorAll("[src]")) {
    const src = element.getAttribute("src")!;
    if (/^data:image\/(png|jpeg|webp|gif|svg\+xml|avif);/i.test(src) && element.tagName === "IMG") continue;
    const asset = src.startsWith("asset:") ? input.assets.find((a) => a.id === src.slice(6)) : undefined;
    if (!asset || !/^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/.test(asset.mime) || element.tagName !== "IMG") throw new ArtifactError("artifact_resource_missing");
    element.setAttribute("src", `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}`);
  }
  head.insertAdjacentHTML("afterbegin", `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"><script>window.lenData=Object.freeze(${safeJson({ datasets:datasets.map(artifactDatasetForDisplay) })});${scriptText(trustedRuntime)}</script>`);
  const labels = datasets.map((d) => datasetLabel(d) + (d.truncated ? " · Datos recortados" : ""));
  // Text escapes through JSON into textContent, never interpolated as HTML.
  if(datasets.length)body.insertAdjacentHTML("beforeend", `<aside id="len-data-provenance" style="position:fixed;bottom:0;left:0;right:0;padding:8px 16px;background:#111;color:#fff;font:12px system-ui;z-index:2147483647"></aside><script>document.getElementById('len-data-provenance').textContent=${safeJson(labels.join(" | "))};</script>`);
  return tree.toString();
}
export async function buildDashboard(input: SealedArtifactInput) {
  const manifest=dashboardManifest(input);
  const datasets=manifest.datasetIds.map(id=>input.datasets.find(d=>d.id===id)!);
  const html=await compileArtifactHtml(input,manifest.entry,datasets);
  return {html,manifest,csv:datasets.map(d=>({id:d.id,text:datasetCsv(d)}))};
}
