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
 *     meta que anuncia un dato muerto, una regla CSS que no aplica nunca—: se
 *     miden antes y después, y sólo sale lo que no estaba (la línea base).
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
import { reglasQueNuncaAplican } from "@/lib/document/css-wiring";
import { todoElJsDelDocumento } from "@/lib/page-engine/conservar-scripts";

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
        `El script busca #${id} y la página ya no tiene ningún elemento con ese id: la excepción corta el script entero y la página se queda sin su interactividad.`,
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
        `El enlace a ${x.red} «${x.handle}» no sale de la página ni de lo que dijo el usuario: si lo dedujiste del nombre del negocio, es una cuenta inventada que manda al visitante al perfil de otra persona. Déjalo en href="#" y pregúntale cuál es la suya.`,
      ),
    );
  }
  for (const x of prefijosInventados(fuentes)) {
    deEstaEscritura.push(
      diag(
        posicionDelHref(e.despues, x.href),
        "Warning",
        "prefijo-inventado",
        `${x.href} lleva +${x.prefijo} delante de ${x.dictado}, y ese país no lo dio nadie: si lo adivinas, sus clientes llaman a otro país. En un tel: deja las cifras que te dieron; si es un wa.me, pregúntale de qué país es el número.`,
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
          ? `El precio ${x.texto} no sale de lo que dijo el usuario ni de su sitio: puesto por ti, aparenta ser el suyo. Si no te lo dio, pregúntaselo; si lo calculaste, dilo al cerrar.`
          : x.tipo === "cifra"
            ? `«${x.texto}» afirma algo de su negocio que nadie dio: el visitante lo lee como cierto. Quítalo o pregúntale el dato real.`
            : `La reseña «${x.texto}» no sale de lo que dio el usuario ni de su sitio: presentada como de un cliente, es inventada, y cambiar las palabras de una reseña real también lo es. Quítala, o pídele las suyas.`,
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
          `Esta escritura quitó ${h.tipo === "imagen" ? "la imagen" : h.tipo === "enlace" ? "el enlace" : "el teléfono"} ${h.valor}, que la página tenía: es un dato real del usuario. Si no te lo pidieron, repónlo con el valor exacto; si sí, díselo al usuario.`,
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
          `Este Edit dejó ${p.elementosDespues} de ${p.elementosAntes} elementos y ${p.textoDespues} de ${p.textoAntes} caracteres de texto de lo que reemplazaba. Si no querías borrarlo, repón lo que falta; si sí, díselo al usuario.`,
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
          `El enlace dice «${x.texto}» y lleva a ${x.href}: la página enseña un dato y el botón marca otro. Cambiar el texto de un enlace no cambia su href.`,
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
          `La <meta name="description"> sigue anunciando ${viejos.join(" y ")}, que ya no está en la página: es el texto que enseña Google. Actualízala.`,
        ),
      );
    }
    for (const x of jsQueNoCompila(html)) {
      fuera.push(
        diag(
          x,
          "Error",
          "js-no-compila",
          `El navegador no puede leer este <script> (${x.mensaje}): no corre NINGUNA línea de él, y la página se queda sin todo lo que hacía.`,
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
            ? `El enlace a ${x.href} no lleva a ningún sitio: la página no tiene ningún elemento con id="${x.href.slice(1)}". Al tocarlo no pasa nada. Pon ese id en la sección a la que apunta, o cambia el enlace.`
            : x.tipo === "sin-esquema"
              ? `El enlace «${x.href}» no lleva esquema, así que es una ruta de ESTE sitio: el servidor contesta con la portada y el visitante se queda donde estaba. ${x.sugerido ? `Escríbelo entero: ${x.sugerido}` : "Escribe la dirección completa, con https://."}`
              : `El enlace «${x.href}» cae en la portada: las páginas del sitio se enlazan con su ruta, que es ${x.sugerido}. ${x.tipo === "relativa" ? "Una ruta sin «/» delante sólo funciona desde la portada." : "No existe ningún fichero .html con ese nombre."}`,
        ),
      );
    }
    for (const x of libreriasQueNoCargan(html)) {
      fuera.push(
        x.tipo === "script-ajeno"
          ? diag(
              posicionDe(html, x.src),
              "Error",
              "script-que-se-borra",
              `<script src="${x.src}"> se borra al publicar: sólo sobreviven las librerías de libs.openlen.com y Tailwind. En el lienzo funciona; en la página publicada, lo que dependa de él se queda muerto.${x.sustituta ? ` Usa la nuestra: ${etiquetasDe(x.sustituta)}` : " Escribe eso en tu propio <script> o quítalo."}`,
            )
          : x.tipo === "con-integrity"
            ? diag(
                posicionDe(html, x.url),
                "Error",
                "libreria-bloqueada",
                `${x.url} lleva integrity o crossorigin, y libs.openlen.com no manda CORS: el navegador BLOQUEA la librería y tu código falla con «no está definido». Quita los dos atributos.`,
              )
            : x.tipo === "fuera-del-catalogo"
              ? diag(
                  posicionDe(html, x.url),
                  "Warning",
                  "libreria-que-no-existe",
                  `${x.url} no es ninguna ruta del catálogo, y lo más probable es que dé 404. Copia la etiqueta exacta: ${LIBRERIAS.map((l) => `${l.nombre} ${l.version}`).join(", ")}.`,
                )
              : x.tipo === "sin-cargar"
                ? diag(
                    posicionDe(html, x.global),
                    "Error",
                    "libreria-sin-cargar",
                    `Tu script usa ${x.global} y la página no carga ${x.libreria.nombre}: en cuanto corra falla con «${x.global} is not defined» y se para entero. Añade en el <head>: ${etiquetasDe(x.libreria, x.faltan)}`,
                  )
                : diag(
                    posicionDe(html, "new Swiper"),
                    "Warning",
                    "libreria-sin-hoja",
                    `Usas ${x.libreria.nombre} sin su hoja de estilos: el carrusel se apila en vertical y la página parece rota. Añade en el <head>: <link rel="stylesheet" href="${x.css}">`,
                  ),
      );
    }
    for (const r of reglasQueNuncaAplican(html, todoElJsDelDocumento(html))) {
      fuera.push(
        diag(
          posicionDe(html, r.selector),
          "Warning",
          "regla-muerta",
          `La regla \`${r.selector}\` no puede aplicar nunca: pide ${r.ausentes.map((c) => `.${c}`).join(", ")} y ninguna etiqueta lo lleva (sí existe ${r.presentes.map((c) => `.${c}`).join(", ")}). El estilo está escrito y el elemento también, pero no se tocan.`,
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
