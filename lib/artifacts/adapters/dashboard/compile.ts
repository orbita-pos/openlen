import path from "node:path";
import { parse,TextNode } from "node-html-parser";
import { compilarCarpeta, textoDeDiagnostico } from "../../../apps/compilador";
import { CATALOGO_ACTUAL } from "../../../apps/dependencias";
import { runBundler } from "../../../apps/bundler/bundle-app";
import { ArtifactError, type ArtifactDataset, type SealedArtifactInput } from "../../types";
import { dashboardManifest } from "./manifest";
import {artifactDatasetForDisplay} from "../../dataset-display";
import {artifactCatalog} from "./catalog";
import {artifactCss} from "./styles";
import {d3Runtime} from "./d3";
import {bakeTailwind} from "../../../publish/bake-tailwind";
import {CDN_TAG_RE} from "../../../publish/tw-config";
import {resolveRemoteFonts} from "../fonts";
import {npmForBundle} from "../../../apps/npm/for-bundle";
import {defaultModuleStore} from "../../../apps/npm/store";
import {parseBareSpecifier} from "../../../apps/npm/specifier";

import { ARTIFACT_CSP } from "../../html-policy";
export { ARTIFACT_CSP } from "../../html-policy";
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const scriptText = (s: string) => s.replace(/<\/script/gi, "<\\/script");
export function datasetLabel(d: ArtifactDataset): string { return d.mode === "scenario" ? `Escenario hipotético${d.title ? ` · ${d.title}` : ""}` : `Datos ${d.mode === "live" ? "actualizados" : "capturados"} · ${d.environment ?? d.source} · ${d.capturedAt}`; }
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
export async function compileArtifactHtml(input: SealedArtifactInput, entryHtml: string, datasets: readonly ArtifactDataset[], trustedRuntime = "", catalogId = CATALOGO_ACTUAL, globals = "") {
  let source = input.revision.files[entryHtml]!;
  // Google Fonts: from the renderer when installed, embedded otherwise (fonts.ts). Hints to remote hosts go.
  source = await resolveRemoteFonts(source);
  // An app's shell loads Tailwind from its CDN, and a render has no network: bake it here, as publishing does,
  // from the classes its sources write. The CSS is ours and the render stays offline.
  if (CDN_TAG_RE.test(source)) {
    const fuentes = Object.entries(input.revision.files).filter(([p]) => /\.(tsx?|jsx?|mjs|html)$/.test(p)).map(([p, raw]) => ({ raw, extension: p.split(".").pop()! }));
    const baked = await bakeTailwind(source, fuentes);
    if (!baked.baked) throw new ArtifactError("artifact_resource_missing", `${entryHtml}: the Tailwind CDN script could not be baked (a ?plugins= variant or a config computed at load); write the styles in CSS instead`);
    source = baked.html;
  }
  const tree = parse(source);
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
      if (/^[a-z]+:|^\/\//i.test(src) || src.includes("?") || src.includes("#")) throw new ArtifactError("artifact_resource_missing", `<script src="${src}">: a deliverable renders without network; use a local file or a catalog import`);
      entry = path.posix.resolve("/", path.posix.dirname(entryHtml), src);
      if (!Object.hasOwn(files, entry)) throw new ArtifactError("artifact_resource_missing", `<script src="${src}">: ${entry} is not a file of this piece`);
    } else { entry = `/artifact-inline-${index}.ts`; files[entry] = element.textContent; }
    // A unique synthetic entry also prevents same-basename module collisions.
    const wrapper = `/artifact-entry-${index}.ts`;
    files[wrapper] = `import ${JSON.stringify(entry)};`;
    entryPaths.push(wrapper);
    element.removeAttribute("src"); element.setAttribute("type", "module"); element.setAttribute("data-artifact-entry", String(index));
  }
  for(const [name,css] of Object.entries(files).filter(([p])=>p.endsWith(".css")))files[name]=await artifactCss(css,files);
  const compiled = compilarCarpeta({ carpeta: files, catalogo: catalogId, entorno: {},inlineStyles:true });
  if (compiled.errores.length) throw new ArtifactError("artifact_compile_failed", compiled.errores.slice(0, 8).map(textoDeDiagnostico).join("\n"));
  const catalogLibraries = compiled.paquetes.length ? await artifactCatalog(catalogId) : {catalogFiles:{},vendorRoots:{}};
  // An app's open npm packages: what its lock says, from the module cache (esm.sh by exact URL and hash if the
  // cache lost one), as the canvas and publishing bundle them. The catalog does not serve what esm.sh serves.
  const npm = await npmForBundle(files, { catalogo: catalogId, entrada: entryPaths[0] ?? "" } as never, "production", { store: defaultModuleStore(), fetch });
  if (!npm.ok) throw new ArtifactError("artifact_compile_failed", npm.errores.slice(0, 8).map(textoDeDiagnostico).join("\n"));
  const servedByEsm = new Set(npm.npm?.servedByEsm ?? []);
  const libraries = {...catalogLibraries, catalogFiles: Object.fromEntries(Object.entries(catalogLibraries.catalogFiles).filter(([spec]) => !servedByEsm.has(parseBareSpecifier(spec)?.name ?? "")))};
  const modules=compiled.ficheros;
  if (entryPaths.length) {
    const bundle = await runBundler({ entries: entryPaths, modules, virtual: {}, mocked: [], empty: [], ...libraries, minify: true, nodeEnv: "production", sourcemap: false, ...(npm.npm ? { npm: npm.npm } : {}) }, 30_000);
    if (!bundle || bundle.errors.length) throw new ArtifactError("artifact_compile_failed", bundle?.errors.slice(0, 8).map((e) => `${e.file}:${e.line}: ${e.text}`).join("\n") ?? "Compiler timed out");
    for (const element of tree.querySelectorAll("script[data-artifact-entry]")) {
      const index = Number(element.getAttribute("data-artifact-entry"));
      const js = bundle.outputs[`artifact-entry-${index}.js`];
      if (!js) throw new ArtifactError("artifact_compile_failed");
      element.set_content(new TextNode(scriptText(js))); element.removeAttribute("data-artifact-entry");
    }
  }
  for (const element of tree.querySelectorAll("link[rel=stylesheet]")) {
    const href = element.getAttribute("href") ?? "";
    if (/^[a-z]+:|^\/\//i.test(href)) throw new ArtifactError("artifact_resource_missing", `<link href="${href}">: a deliverable renders without network; put the CSS in a local file`);
    const css = files[path.posix.resolve("/", path.posix.dirname(entryHtml), href)];
    if (css === undefined) throw new ArtifactError("artifact_resource_missing", `<link href="${href}">: not a file of this piece`);
    element.replaceWith(`<style>${css}</style>`);
  }
  for (const element of tree.querySelectorAll("[src]")) {
    const src = element.getAttribute("src")!;
    if (/^data:image\/(png|jpeg|webp|gif|svg\+xml|avif);/i.test(src) && element.tagName === "IMG") continue;
    const asset = src.startsWith("asset:") ? input.assets.find((a) => a.id === src.slice(6)) : undefined;
    if (!asset || !/^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/.test(asset.mime) || element.tagName !== "IMG") throw new ArtifactError("artifact_resource_missing", `<${element.tagName.toLowerCase()} src="${src.slice(0, 200)}">: ${src.startsWith("asset:") ? "not a ready saved image of this revision; check the id with inspect_artifact" : "only <img src=\"asset:<artifactId>@<revision>/<output>\"> or a data: image; there is no network"}`);
    element.setAttribute("src", `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}`);
  }
  head.insertAdjacentHTML("afterbegin", `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">${globals ? `<script>${scriptText(globals)}</script>` : ""}<script>window.lenData=Object.freeze(${safeJson({ datasets:datasets.map(artifactDatasetForDisplay) })});${scriptText(trustedRuntime)}</script>`);
  const labels = datasets.map((d) => datasetLabel(d) + (d.truncated ? " · Datos recortados" : ""));
  // Text escapes through JSON into textContent, never interpolated as HTML. A compact note in a corner (it wraps
  // rather than hiding part of the label): the dashboard stays readable and its source is still always on show.
  if(datasets.length)body.insertAdjacentHTML("beforeend", `<aside id="len-data-provenance" style="position:fixed;right:12px;bottom:12px;max-width:min(520px,calc(100% - 24px));padding:5px 10px;border-radius:8px;background:rgba(17,17,17,.78);color:#fff;font:500 11px/1.45 system-ui,-apple-system,sans-serif;letter-spacing:.01em;z-index:2147483647"></aside><script>document.getElementById('len-data-provenance').textContent=${safeJson(labels.join(" | "))};</script>`);
  return tree.toString();
}
export async function buildDashboard(input: SealedArtifactInput) {
  const manifest=dashboardManifest(input);
  const datasets=manifest.resolved;
  const html=await compileArtifactHtml(input,manifest.entry,datasets,"",manifest.catalogo,await d3Runtime());
  // A file dataset's id is its path: the export is named after the file, without folders or extension.
  return {html,manifest,csv:datasets.map(d=>({id:d.source==="file"?d.id.replace(/\.[a-z]+$/i,"").replace(/[^A-Za-z0-9_-]+/g,"-"):d.id,text:datasetCsv(d)}))};
}
