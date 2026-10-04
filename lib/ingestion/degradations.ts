import type { Degradation } from "@/lib/projects/types";

/**
 * Turns what the gate already measured into the record we keep on the row.
 *
 * Machine codes only. The user-facing sentence is built in the surface from
 * i18n — "12 scripts removed" is our vocabulary, not a creator's, and the one
 * thing this record must never become is a log nobody reads.
 *
 * A loss with no user-facing phrasing is deliberately NOT recorded: if we
 * cannot say what stopped working in the user's language, we are not ready to
 * interrupt them about it. That is why `metaRefresh` is absent — the gate does
 * not report it, and "a meta refresh was stripped" has no honest creator-facing
 * sentence anyway.
 */
/**
 * ⚠️ DESDE EL 2026-10-04 (la entrada como Vercel) pegar y clonar ya no la
 * llaman: pasan sólo `gateReservedMarker`, que no quita nada, así que no hay
 * pérdida que apuntar. Con ellas se fueron `hadScript`, `transformFallback` y
 * el código `dynamic_content` (lo que el transformador de ingestión no llegaba a
 * hornear). El tipo conserva los códigos: hay filas viejas que los llevan.
 */
export function collectDegradations(input: {
  surface: Degradation["surface"];
  removed?: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number };
}): Degradation[] {
  const { surface, removed } = input;
  const out: Degradation[] = [];

  // ⚰️ Aquí nacía `dynamic_content`: el transformador de ingestión no había
  // horneado lo que la página construía con JavaScript, y el saneador iba a
  // borrar ese JavaScript. Retirados los dos el 2026-10-04.

  if (removed) {
    // Two counters, one lived experience — the interactive bits are gone.
    //
    // Not for a curated template: 152 of 172 carry a decorative script
    // (a `js` class toggle, an IntersectionObserver reveal) that lib/transform
    // bakes and the sanitizer then strips, so nothing visibly broke. Saying
    // "your page had parts built with JavaScript" on ~88% of clones is the
    // noise this notice exists to avoid — and it was never the user's page.
    // A template whose dynamic content genuinely went missing still reports:
    // that is the `dynamic_content` code above, which fires when the bake
    // did not happen.
    // EL CERO SIGUE, pero desde el 2026-08-31 por otro motivo — y conviene que
    // conste, porque el de antes ya no es cierto.
    //
    // Decía: 152 de 172 plantillas llevan un script decorativo que
    // `lib/transform` hornea y el saneador luego borra, así que nada visible se
    // rompía y avisar en el ~88% de los clones era ruido. Cierto entonces; hoy
    // `from-template` RESTAURA los scripts tras el saneado
    // (`conservarScripts`), así que contar `removed.scripts` sería contar
    // retiradas que se deshicieron — mentir al revés.
    //
    // 🔴 EN EL CLON, LOS `<script>` VUELVEN Y LOS `on*` NO. Son dos pérdidas
    // distintas y hasta hoy se contaban como una sola — forzada a CERO.
    //
    // Los bloques `<script>` los restaura `conservarScripts` desde el documento
    // curado, así que contarlos sería mentir al revés: avisar de algo que sí
    // llegó. Ésa es la mitad que el cero acertaba.
    //
    // ⚠️ Y sólo lo acertaba PARA LA HOME hasta el 2026-09-01. El empalme estaba
    // en la Home y no en el bucle de subpáginas, así que en una plantilla
    // multi-página este cero tapaba una pérdida real en vez de describir una
    // recuperación — el silencio que este módulo existe para impedir, dentro
    // del módulo mismo. Cerrado en `from-template/route.ts`, donde las dos
    // ramas empalman ya; si alguna vez se quita una de las dos, este cero
    // vuelve a mentir.
    //
    // Los `on*` NO los devuelve nadie: `conservarScripts` trabaja con BLOQUES,
    // no con atributos. Así que una plantilla con `onclick="abrir()"` clona con
    // la función VIVA y el botón MUERTO — el 13% del corpus, medido en
    // `lib/templates/admin-schemas.ts`. Ésa es la mitad que el cero escondía.
    //
    // El argumento que justificaba callarlo era que el aviso «le pide al usuario
    // que actúe sobre un fichero NUESTRO, que él no puede tocar». Ya no se
    // sostiene: quien recibe la página es él, el botón muerto es suyo, y desde
    // que el Agente escribe JavaScript SÍ puede arreglarlo —pidiéndoselo— sin
    // tocar la plantilla curada. Callar una pérdida porque la culpa es nuestra
    // es exactamente la degradación silenciosa que este módulo existe para
    // impedir. Arreglar el corpus sigue siendo lo correcto; mientras tanto, se
    // dice.
    const scripts = surface === "from-template" ? 0 : removed.scripts;
    const js = scripts + (surface === "from-template" ? 0 : removed.eventHandlers);
    if (js > 0) out.push({ surface, stage: "sanitize", code: "scripts", count: js });
    if (surface === "from-template" && removed.eventHandlers > 0) {
      out.push({
        surface,
        stage: "sanitize",
        code: "handlers_lost",
        count: removed.eventHandlers,
      });
    }
    if (removed.iframes > 0) {
      out.push({ surface, stage: "sanitize", code: "embeds", count: removed.iframes });
    }
    if (removed.dangerousUrls > 0) {
      out.push({ surface, stage: "sanitize", code: "unsafe_links", count: removed.dangerousUrls });
    }
  }

  // ⚰️ Aquí nacía `broken_controls` (una conducta `data-ol-*` mal cableada).
  // Las conductas se retiraron el 2026-10-04; el código sigue en el tipo y en
  // el editor porque proyectos viejos pueden tenerlo guardado.

  return out;
}
