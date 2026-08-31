import "server-only";

// Bake QUIRÚRGICO (spec 2026-07-14, mitad A). Ejecuta la página una vez (vía
// `runPage`, INYECTABLE: el real es run-page.ts con Chrome sin red; los tests
// pasan un fake) y trae de vuelta SOLO el contenido de los objetivos que
// findBakeTargets marcó — jamás el documento entero.
//
// LA TRAMPA que este diseño existe para esquivar: ~150 plantillas ponen
// class="js" en <html> y su CSS hace `.js .reveal{opacity:0}` — capturar el
// DOM completo post-script congela ese estado y produce páginas EN BLANCO.
// Aquí <html>/<body> son intocables por construcción: solo se muta el
// interior de los contenedores etiquetados y el d= de la geometría.
import { parse, type HTMLElement as NHPElement } from "node-html-parser";
import { findBakeTargets } from "./targets";

export interface PageCapture {
  /** índice data-ol-bake-c → innerHTML resultante */
  containers: Record<string, string>;
  /** índice data-ol-bake-g → valor calculado de d=/points= */
  geoms: Record<string, string>;
}

export type RunPage = (taggedHtml: string) => Promise<PageCapture>;

/** Los runtimes de animación dejan `opacity:0` INLINE en los nodos que iban a
 *  revelar — un artefacto del instante de captura, no una decisión de diseño.
 *  Se limpia SOLO esa propiedad y SOLO cuando vale 0; display:none se respeta
 *  (puede ser estado legítimo: un dropdown, un panel colapsado). */
function stripZeroOpacity(el: NHPElement): void {
  for (const n of [el, ...el.querySelectorAll("[style]")]) {
    const style = n.getAttribute("style");
    if (!style) continue;
    const kept = style
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((decl) => {
        const [prop, val] = decl.split(":").map((s) => s?.trim().toLowerCase() ?? "");
        return !(prop === "opacity" && /^0(\.0+)?$/.test(val));
      });
    if (kept.length === 0) n.removeAttribute("style");
    else n.setAttribute("style", kept.join(";"));
  }
}

export async function bakeGeneratedContent(
  html: string,
  runPage: RunPage,
): Promise<{
  html: string;
  bakedContainers: number;
  bakedGeoms: number;
  generadoresQuitados: number;
}> {
  const targets = findBakeTargets(html);
  if (targets.containers === 0 && targets.geoms === 0) {
    return { html, bakedContainers: 0, bakedGeoms: 0, generadoresQuitados: 0 };
  }

  const capture = await runPage(targets.taggedHtml);

  const dom = parse(targets.taggedHtml);
  let bakedContainers = 0;
  /** Los `data-ol-bake-c` que de verdad quedaron llenos. */
  const horneados = new Set<string>();
  for (const el of dom.querySelectorAll("[data-ol-bake-c]")) {
    const idx = el.getAttribute("data-ol-bake-c") ?? "";
    el.removeAttribute("data-ol-bake-c");
    const frag = capture.containers[idx];
    // Captura vacía = el script no llenó nada (o necesitaba red, que va
    // bloqueada): statu quo — el contenedor queda exactamente como hoy.
    if (!frag || frag.trim() === "") continue;
    el.set_content(frag);
    stripZeroOpacity(el);
    horneados.add(idx);
    bakedContainers++;
  }

  let bakedGeoms = 0;
  for (const el of dom.querySelectorAll("[data-ol-bake-g]")) {
    const idx = el.getAttribute("data-ol-bake-g") ?? "";
    el.removeAttribute("data-ol-bake-g");
    const val = capture.geoms[idx];
    if (!val || val.trim() === "") continue;
    el.setAttribute(el.rawTagName?.toLowerCase() === "path" ? "d" : "points", val);
    bakedGeoms++;
  }

  // BARRIDO FINAL (hallazgo publish-safety, 2026-07-14): un fragmento
  // capturado puede CONTENER nuestros marcadores temporales — el script de un
  // desconocido (from-html) los escribe a propósito, y el sanitizer posterior
  // conserva data-*. Los loops de arriba iteran un snapshot pre-inserción,
  // así que lo inyectado por set_content jamás pasó por ellos. Nada con
  // data-ol-bake-* sale de esta función, punto.
  for (const el of dom.querySelectorAll("[data-ol-bake-c],[data-ol-bake-g]")) {
    el.removeAttribute("data-ol-bake-c");
    el.removeAttribute("data-ol-bake-g");
  }

  // FUERA EL GENERADOR, Y SÓLO ÉL. Desde el 2026-08-31 `from-template` conserva
  // los scripts de la plantilla; si además dejáramos vivo al que llena un
  // contenedor YA horneado, su contenido saldría dos veces — los sinks que
  // `findBakeTargets` detecta son en su mayoría de la familia que AÑADE.
  //
  // 🔴 LA REGLA CONSERVADORA: se quita sólo si TODOS sus contenedores se
  // hornearon de verdad. Si alguna captura salió vacía —Chrome sin red, un
  // fetch, un timeout— ese script es lo ÚNICO que puede llenar ese hueco, y
  // quitarlo dejaría la sección permanentemente en blanco. Ante la duda, vive.
  let generadoresQuitados = 0;
  if (targets.generadores.length > 0) {
    const inline = dom
      .querySelectorAll("script")
      .filter((s) => s.getAttribute("src") === undefined);
    for (const gen of targets.generadores) {
      if (gen.contenedores.some((idx) => !horneados.has(idx))) continue;
      const el = inline[gen.indice];
      if (!el) continue;
      el.remove();
      generadoresQuitados++;
    }
  }

  return { html: dom.toString(), bakedContainers, bakedGeoms, generadoresQuitados };
}
