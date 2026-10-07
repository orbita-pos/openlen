/**
 * LO QUE UNA ESCRITURA DEJÓ MAL, como diagnósticos anclados a línea (Len 2.0, T9).
 *
 * Estos analizadores existían y hablaban dentro de la respuesta de las
 * herramientas viejas (`aviso_critico` de `editar_pagina`, `editar_html`…).
 * Al quitar esas herramientas se quedaron sin llamador. Vuelven por el canal
 * de Claude Code: un diagnóstico con fichero, línea y columna, que el modelo
 * puede ir a leer con Read y arreglar con Edit, y que viaja en el
 * `<new-diagnostics>` hermano del resultado (ver `diagnosticos.ts`).
 *
 * Dos familias, y la diferencia importa para no repetir lo que ya venía mal:
 *   · las que hablan DE ESTA ESCRITURA —un dato que se fue, una red social o
 *     un precio, una cifra o una reseña que nadie dio, un Edit que vació lo que
 *     reemplazaba, el script que busca lo que ya no está—: nuevas por
 *     construcción;
 *   · las que hablan DEL FICHERO —un enlace que dice un número y marca otro, la
 *     meta que anuncia un dato muerto, una regla CSS que no aplica nunca, una
 *     clase que el script pone y nada usa—: se miden antes y después, y sólo
 *     sale lo que no estaba (la línea base).
 *
 * La base se compara sin la posición (ver `claveDeDiagnostico`): el mensaje ya
 * nombra lo concreto, y con la posición cualquier línea añadida arriba volvería
 * «nuevo» lo de abajo.
 *
 * Puro: sólo analizadores puros. Lo prueba vitest.
 */
import { contenidoPerdido } from "@/lib/agent/contenido-perdido";
import { datosInventados } from "@/lib/agent/datos-inventados";
import { enlacesDesfasados } from "@/lib/agent/enlaces-desfasados";
import { enlacesInventados } from "@/lib/agent/enlaces-inventados";
import { enlacesQueNoLlegan } from "@/lib/agent/enlaces-que-no-llegan";
import { hechosPerdidosNetos, metaDesfasada } from "@/lib/agent/facts-kept";
import { jsQueNoCompila } from "@/lib/agent/js-que-no-compila";
import { etiquetasDe, libreriasQueNoCargan } from "@/lib/agent/librerias-que-no-cargan";
import { LIBRERIAS } from "@/lib/librerias";
import { prefijosInventados } from "@/lib/agent/prefijo-inventado";
import { claveDeDiagnostico, posicionDe, posicionEnIndice, type Diagnostico } from "@/lib/agent/diagnosticos";
import { clasesQueElScriptPoneSinEstilo, reglasQueNuncaAplican } from "@/lib/document/css-wiring";
import { clasesQueConoceTailwind } from "@/lib/document/clases-de-tailwind";
import { todoElJsDelDocumento } from "@/lib/page-engine/conservar-scripts";
import { extractTwConfig } from "@/lib/publish/tw-config";

export interface Escritura {
  /** El fichero, con su ruta del sitio. */
  readonly ruta: string;
  /** Cómo estaba ANTES de esta escritura, tal como lo ve Read; `null` si es nuevo. */
  readonly antes: string | null;
  /** Cómo quedó guardado, tal como lo ve Read. Las posiciones son de éste. */
  readonly despues: string;
  /** Lo que dijo el dueño (su mensaje, su brief): de dónde puede salir un dato. */
  readonly fuentes: readonly (string | null | undefined)[];
  /** Si fue un Edit, qué trozo cambió por cuál: ancla lo que no tiene sitio
   *  propio (un dato que se fue) y mide si vació lo que reemplazaba. */
  readonly edit?: { readonly old_string: string; readonly new_string: string };
  /** Los ids que el script busca y la página ya no tiene, NUEVOS de esta
   *  escritura (`persistPage`). */
  readonly referenciasRotas?: readonly string[];
}

const FUENTE = "openlen";

type Posicion = { linea: number; columna: number };

export function diagnosticosDeLaEscritura(e: Escritura): Diagnostico[] {
  const antes = e.antes ?? "";
  const inicio: Posicion = { linea: 1, columna: 1 };
  // Donde fue el Edit, para lo que ya no tiene sitio en el fichero: el trozo
  // nuevo en lo GUARDADO (la puerta puede añadir líneas arriba, como las metas
  // og: del primer guardado) y, si el Edit borró, donde estaba el viejo.
  const dondeFueElEdit: Posicion =
    (e.edit && (posicionDe(e.despues, e.edit.new_string) ?? (e.antes !== null ? posicionDe(e.antes, e.edit.old_string) : null))) ||
    inicio;
  const diag = (p: Posicion | null, gravedad: Diagnostico["gravedad"], codigo: string, mensaje: string): Diagnostico => ({
    ruta: e.ruta,
    ...(p ?? inicio),
    gravedad,
    mensaje,
    codigo,
    fuente: FUENTE,
  });

  const deEstaEscritura: Diagnostico[] = [];

  // ── Errores: la página se queda sin hacer algo, y sin que nada falle ──────
  // ⚰️ `handlers-muertos` NO vuelve, y a propósito: su premisa —«el guardado
  // BORRA los `onclick=`»— ya no es verdad para Len. Medido el 2026-09-24 con
  // el guardado real (`herramientas-de-ficheros.test.ts`): un Edit que cablea
  // un `onclick` lo conserva, porque las escrituras del modelo pasan por
  // `gateReservedMarker` y no por el saneador; y la publicación tampoco lo
  // quita (`publishToDir` usa la misma puerta, y la CSP se retiró el
  // 2026-08-26). Un diagnóstico sobre algo que no pasa enseña a ignorarlos.
  for (const id of e.referenciasRotas ?? []) {
    const literal = new RegExp(`(["'\`])#?${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`).exec(e.despues);
    deEstaEscritura.push(
      diag(
        literal ? posicionEnIndice(e.despues, literal.index) : null,
        "Error",
        "referencia-rota",
        `The script looks for #${id} and the page no longer has any element with that id: the exception stops the whole script and the page is left without its interactivity.`,
      ),
    );
  }

  // ── Avisos de esta escritura ─────────────────────────────────────────────
  const fuentes = { antes, despues: e.despues, fuentes: e.fuentes };
  for (const x of enlacesInventados(fuentes)) {
    deEstaEscritura.push(
      diag(
        posicionDelHref(e.despues, x.href),
        "Warning",
        "enlace-inventado",
        `The link to ${x.red} «${x.handle}» doesn't come from the page or from what the user said: if you inferred it from the business name, it is a made-up account that sends the visitor to someone else's profile. Leave it as href="#" and ask them which one is theirs.`,
      ),
    );
  }
  for (const x of prefijosInventados(fuentes)) {
    deEstaEscritura.push(
      diag(
        posicionDelHref(e.despues, x.href),
        "Warning",
        "prefijo-inventado",
        `${x.href} carries +${x.prefijo} in front of ${x.dictado}, and nobody gave that country: if you guess it, their customers call another country. In a tel: leave the digits they gave you; if it is a wa.me, ask them which country the number is from.`,
      ),
    );
  }
  for (const x of datosInventados(fuentes)) {
    const aguja = x.texto.replace(/…$/, "").slice(0, 40);
    deEstaEscritura.push(
      diag(
        posicionDe(e.despues, aguja),
        "Warning",
        x.tipo === "precio" ? "precio-inventado" : x.tipo === "cifra" ? "cifra-inventada" : "resena-inventada",
        x.tipo === "precio"
          ? `The price ${x.texto} doesn't come from what the user said or from their site: put there by you, it passes for theirs. If they didn't give it to you, ask them; if you calculated it, say so when you close.`
          : x.tipo === "cifra"
            ? `«${x.texto}» claims something about their business that nobody gave: the visitor reads it as true. Remove it or ask them for the real figure.`
            : `The review «${x.texto}» doesn't come from what the user gave or from their site: presented as a customer's, it is made up, and changing the words of a real review is too. Remove it, or ask them for theirs.`,
      ),
    );
  }
  if (e.antes !== null) {
    for (const h of hechosPerdidosNetos(e.antes, e.despues)) {
      deEstaEscritura.push(
        diag(
          dondeFueElEdit,
          "Warning",
          "dato-perdido",
          `This write removed ${h.tipo === "imagen" ? "the image" : h.tipo === "enlace" ? "the link" : "the phone number"} ${h.valor}, which the page had: it is real data of the user's. If you weren't asked to, put it back with the exact value; if you were, tell the user.`,
        ),
      );
    }
  }
  if (e.edit) {
    const edit = e.edit;
    for (const p of contenidoPerdido([{ target: "edit", nuevoHtml: edit.new_string }], () => edit.old_string)) {
      deEstaEscritura.push(
        diag(
          dondeFueElEdit,
          "Warning",
          "contenido-vaciado",
          `This edit left ${p.elementosDespues} of ${p.elementosAntes} elements and ${p.textoDespues} of ${p.textoAntes} characters of text of what it replaced. If you didn't mean to delete it, put back what is missing; if you did, tell the user.`,
        ),
      );
    }
  }

  // ── Avisos del fichero, restando lo que ya venía ─────────────────────────
  const delFichero = (html: string): Diagnostico[] => {
    const fuera: Diagnostico[] = [];
    for (const x of enlacesDesfasados(html)) {
      fuera.push(
        diag(
          posicionDelHref(html, x.href),
          "Warning",
          "enlace-desfasado",
          `The link says «${x.texto}» and goes to ${x.href}: the page shows one value and the button dials another. Changing a link's text doesn't change its href.`,
        ),
      );
    }
    const viejos = metaDesfasada(html);
    if (viejos.length > 0) {
      const meta = /<meta[^>]*\bname\s*=\s*["']description["']/i.exec(html);
      fuera.push(
        diag(
          meta ? posicionEnIndice(html, meta.index) : null,
          "Warning",
          "meta-desfasada",
          `The <meta name="description"> still announces ${viejos.join(" and ")}, which is no longer on the page: it is the text Google shows. Update it.`,
        ),
      );
    }
    for (const x of jsQueNoCompila(html)) {
      fuera.push(
        diag(
          x,
          "Error",
          "js-no-compila",
          `The browser can't read this <script> (${x.mensaje}): NOT ONE line of it runs, and the page is left without everything it did.`,
        ),
      );
    }
    for (const x of enlacesQueNoLlegan(html)) {
      fuera.push(
        diag(
          posicionDelHref(html, x.href),
          "Warning",
          x.tipo === "ancla-muerta" ? "ancla-muerta" : "enlace-que-no-llega",
          x.tipo === "ancla-muerta"
            ? `The link to ${x.href} goes nowhere: the page has no element with id="${x.href.slice(1)}". Tapping it does nothing. Put that id on the section it points to, or change the link.`
            : x.tipo === "sin-esquema"
              ? `The link «${x.href}» has no scheme, so it is a path of THIS site: the server answers with the home page and the visitor stays where they were. ${x.sugerido ? `Write it in full: ${x.sugerido}` : "Write the full address, with https://."}`
              : `The link «${x.href}» lands on the home page: the site's pages are linked by their path, which is ${x.sugerido}. ${x.tipo === "relativa" ? "A path without a leading «/» only works from the home page." : "There is no .html file with that name."}`,
        ),
      );
    }
    for (const x of libreriasQueNoCargan(html)) {
      fuera.push(
        x.tipo === "con-integrity"
          ? diag(
              posicionDe(html, x.url),
              "Error",
              "libreria-bloqueada",
              `${x.url} carries integrity or crossorigin, and libs.openlen.com sends no CORS: the browser BLOCKS the library and your code fails with «is not defined». Remove both attributes.`,
            )
          : x.tipo === "fuera-del-catalogo"
            ? diag(
                posicionDe(html, x.url),
                "Warning",
                "libreria-que-no-existe",
                `${x.url} isn't any path in the catalog, and it will most likely give a 404. Copy the exact tag: ${LIBRERIAS.map((l) => `${l.nombre} ${l.version}`).join(", ")}.`,
              )
            : x.tipo === "sin-cargar"
              ? diag(
                  posicionDe(html, x.global),
                  "Error",
                  "libreria-sin-cargar",
                  `Your script uses ${x.global} and the page doesn't load ${x.libreria.nombre}: as soon as it runs it fails with «${x.global} is not defined» and stops entirely. Add in the <head>: ${etiquetasDe(x.libreria, x.faltan)}`,
                )
              : diag(
                  posicionDe(html, "new Swiper"),
                  "Warning",
                  "libreria-sin-hoja",
                  `You use ${x.libreria.nombre} without its stylesheet: the carousel stacks vertically and the page looks broken. Add in the <head>: <link rel="stylesheet" href="${x.css}">`,
                ),
      );
    }
    for (const r of reglasQueNuncaAplican(html, todoElJsDelDocumento(html))) {
      fuera.push(
        diag(
          posicionDe(html, r.selector),
          "Warning",
          "regla-muerta",
          `The rule \`${r.selector}\` can never apply: it asks for ${r.ausentes.map((c) => `.${c}`).join(", ")} and no tag carries it (${r.presentes.map((c) => `.${c}`).join(", ")} does exist). The style is written and so is the element, but they never meet.`,
        ),
      );
    }
    // La otra mitad del mismo fallo: el estado que el script pone y que ningún
    // estilo pinta. Tailwind lo contesta su compilador, con el `theme.extend`
    // de la página (el mismo que se hornea al publicar).
    const conoceTailwind = (clases: readonly string[]) => clasesQueConoceTailwind(clases, extractTwConfig(html).extend);
    for (const x of clasesQueElScriptPoneSinEstilo(html, conoceTailwind)) {
      fuera.push(
        diag(
          posicionEnIndice(html, x.indice),
          "Warning",
          "clase-sin-estilo",
          // Sólo lo comprobado: que PONERLA no cambia nada. «El control está
          // mudo» no se puede afirmar — en la pasada por las plantillas, un
          // botón ponía `amt-on` (inerte) y además se pintaba con estilos en
          // línea, así que funcionaba. Lo que pasa en pantalla lo mira
          // `use_page`, no esto.
          `Your script sets the class «${x.clase}» and nothing uses it: no rule in the page's CSS names it, Tailwind doesn't know it and the script doesn't read it. Setting it changes nothing on screen. If it is the state of a control (open, active, selected…), it is missing its CSS; if it's not needed, remove it.`,
        ),
      );
    }
    return fuera;
  };
  const base = new Set(delFichero(antes).map(claveDeDiagnostico));
  const nuevosDelFichero = delFichero(e.despues).filter((d) => !base.has(claveDeDiagnostico(d)));

  return [...deEstaEscritura, ...nuevosDelFichero];
}

/** El atributo `href` que lleva ese destino, o el destino si no se encuentra. */
function posicionDelHref(html: string, href: string): Posicion | null {
  const i = html.indexOf(href);
  if (i === -1) return null;
  const atributo = html.lastIndexOf("href", i);
  return posicionEnIndice(html, atributo !== -1 && i - atributo <= 8 ? atributo : i);
}
