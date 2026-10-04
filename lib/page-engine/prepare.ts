import "server-only";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { documentoMedible } from "@/lib/lienzo/documento";
import { todoElJsDelDocumento } from "./conservar-scripts";
import { stampFormIds } from "@/lib/publish/form-identity";
import { leerFallos, programaJs, type FalloSpec } from "@/lib/agent/prueba-js";
import { reglasQueNuncaAplican, type ReglaMuerta } from "@/lib/document/css-wiring";
import { clasesQueNuncaAplican, type ClaseMuerta } from "@/lib/document/clases-muertas";
import { objectiveBreakage, roturaDeRed } from "@/lib/generation/objective-breakage";
import { gateReservedMarker } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";

import type {
  PreparePageOptions,
  PrepareReport,
  PrepareResult,
  StageOutcome,
} from "./contract";

/**
 * EL motor de la página: una tubería ordenada que crear, editar y el Agente
 * comparten, en vez de tres versiones escritas a mano.
 *
 * Medido antes de escribir esto: de las etapas de abajo, la ruta de crear
 * corría todas y el Chat y el Agente NINGUNA salvo la puerta. Se creaba una
 * página verificada y a la primera edición nadie volvía a mirar.
 *
 *   1. imágenes    fotos reales en los huecos que el modelo dejó marcados
 *   2. legibilidad texto que la página pinta y nadie puede leer
 *   3. medición    desborde y geometría, leídos DEL RENDER
 *   4. puerta      el marcador reservado + metadatos
 *   6. módulos     el hueco que el documento pidió
 *
 * CONTRATO — igual que `lib/transform/index.ts`: las etapas 1-4 son fail-soft.
 * Si Chrome se cuelga o una pasada revienta, el documento sigue su camino y el
 * informe dice por qué; el llamador no necesita `try/catch`. La ÚNICA que puede
 * refusar es la puerta (4), y sólo por el marcador reservado `data-slot-path`.
 *
 * NO opina de gusto. Ni color, ni tipografía, ni ritmo, ni densidad. Sólo
 * rechaza lo roto: eso es lo que deja que una página de terror y una de niños
 * sean distintas de raíz.
 */
export async function preparePage(
  html: string,
  opts: PreparePageOptions,
  deps: PreparePageDeps = {},
): Promise<PrepareResult> {
  const render = deps.render ?? renderVisualQualityViewports;
  const gate = deps.gate ?? passHtmlGate;
  const stages: StageOutcome[] = [];
  let current = html;

  // ⚰️ ETAPAS 1 y 2 —IMÁGENES y LEGIBILIDAD— RETIRADAS (Jesús, 2026-09-04).
  //
  // Eran las dos últimas cosas que tocaban lo que escribió el modelo. El
  // recorte de código ya se había ido el 2026-08-26 («el código que escribe el
  // modelo ES el código de la página»); esto es la misma decisión, terminada.
  //
  // POR QUÉ. `photograph` corría en las TRES superficies —Crear, el Chat y
  // Len— y cambiaba las fotos: el modelo marca un hueco `data-ol-photo` y un
  // emparejador determinista metía una del catálogo curado, que no cubre
  // rubros enteros (dental, abogados, talleres están a cero). El modelo
  // diseñaba bien, la foto no pegaba, y la página parecía mal hecha. El
  // crítico visual llegó a puntuarla baja POR ESAS FOTOS, que no puso él.
  // `repairUnreadableText` hacía lo propio con los colores que eligió.
  //
  // Y no se dejan apagadas por variable de entorno: una palanca que reescribe
  // el trabajo del modelo sigue siendo la regla de tocárselo, esperando a que
  // alguien la encienda. `OPENLEN_IMAGERY` se va con ellas.
  //
  // Lo que NO cambia: la etapa 3 sigue MIDIENDO (desborde, contraste, JS que
  // grita) y sigue informando. Medir no es tocar. Lo que se hace con la medida
  // es del llamador, y desde hoy no es reescribir la página.

  // Kill-switch: si Chrome se rompe en la caja, la página sigue saliendo sin
  // la etapa que lo necesita.
  const renderChecks =
    opts.renderChecks !== false && process.env.OPENLEN_RENDER_CHECKS !== "0";

  // ── 3. medición ────────────────────────────────────────────────────────
  // Se informa, no se actúa: regenerar exige volver a llamar al modelo y eso es
  // decisión —y presupuesto— del llamador.
  let breakage: string[] = [];
  let specFailures: FalloSpec[] = [];
  if (!renderChecks) {
    stages.push({ stage: "measure", status: "skipped", detail: "no_render" });
  } else try {
    // El documento TAL CUAL, con su JavaScript dentro.
    //
    // Aquí había un injerto: el código del modelo viajaba por un canal aparte
    // (la cápsula) y había que volver a pegarlo para poder medirlo. Desde el
    // 2026-08-26 el `<script>` vive DENTRO de `current`, así que injertarlo
    // sería meterlo DOS VECES — dos `addEventListener` sobre el mismo botón,
    // que es un carrito que suma de dos en dos. Se mide lo que se publica.
    //
    // Y CON SU PRUEBA, si la declaró. Ocupa el hueco donde el render pulsa los
    // controles a ciegas: mismo navegador, misma pasada, cero arranques nuevos.
    // El programa lo escribe el modelo sobre los primitivos `ui.*`; hasta el
    // 2026-09-22 podía ser también el JSON del DSL, que compilábamos nosotros.
    const guion = opts.prueba ? programaJs(opts.prueba.codigo) : undefined;
    // SE MIDE EL DOCUMENTO DE VISTA, no el pelado: con el chat y el asistente
    // horneados, que es la página que el visitante recibe. Y sólo se MIDE —
    // `current` no se toca, porque lo horneado no se guarda jamás (se volvería
    // a hornear al publicar, dos burbujas).
    const medido = await render(
      documentoMedible(current, opts.vista ?? null),
      {},
      guion ? { behaviorProgram: guion } : {},
    );
    breakage = objectiveBreakage(medido);
    // `leerFallos` descarta cualquier forma inesperada: no medir no es medir mal.
    //
    // Y desde el 2026-09-04 se separan DOS cosas que antes iban juntas: lo que
    // la página incumplió, y lo que la PRUEBA no pudo aplicar (un selector que
    // no señala a nada, un clic sin manejador). Sólo lo primero es un fallo
    // del documento; lo segundo «no acusa a nadie».
    //
    // 🔴 PERO SE DICE (2026-09-22). Lo del instrumento sólo iba al log, así que
    // en el Chat el modelo seguía creyendo que su promesa se había comprobado.
    // Ahora viajan las dos en `specFailures`, cada una con su marca
    // (`deLaPrueba`), y quien la cuenta —`notaSpec`— las atribuye por separado,
    // igual que en el Agente.
    const todos = guion ? leerFallos(medido?.behaviorResult) : [];
    specFailures = todos;
    const inaplicables = todos.filter((f) => f.deLaPrueba);
    if (inaplicables.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[page-engine] prueba INAPLICABLE (no es fallo de la página) — ` +
          inaplicables.map((f) => `paso ${f.paso}: ${f.mensaje}`).join(" · "),
      );
    }
    // Lo que se cayó por debajo del modelo NO entra en `breakage` —no se le
    // cobra una reescritura por un fichero que no baja— pero tiene que oírse,
    // y aquí es donde se oye: en el informe de la etapa y en el log del
    // servidor, que es quien puede hacer algo al respecto. Ver `rotura-ajena.ts`.
    const red = roturaDeRed(medido);
    if (red.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[page-engine] rotura AJENA (no es del modelo, no se regenera) — ${red.join(" · ")}`);
    }
    const detalle = [
      ...breakage,
      ...specFailures.map((f) => `prueba${f.deLaPrueba ? " INAPLICABLE" : ""} paso ${f.paso}: ${f.mensaje}`),
      ...red.map((g) => `AJENA (red, no del modelo): ${g}`),
    ];
    stages.push({ stage: "measure", status: detalle.length ? "changed" : "skipped", detail: detalle.join(" · ") || undefined });
  } catch (err) {
    // No haber medido no es prueba de que no haya rotura, y por eso se anota
    // como `unavailable` en vez de como "sin roturas".
    stages.push({ stage: "measure", status: "unavailable", detail: reason(err) });
  }

  // ⚰️ AQUÍ CORRÍA `beforeMeta` (la etapa «invariantes»): lo último que hacía
  // era `compileCalcRegions`, la calculadora de `data-ol-calc`. Se fue el
  // 2026-10-04 con las conductas —su motor no se inyectaba desde agosto, así
  // que compilaba fórmulas que nada ejecutaba— y la etapa se quedó vacía. Antes
  // se habían ido sus otras cuatro reparaciones (2026-09-04): lo que escribe el
  // modelo ES la página.
  const gated = await gate(
    current,
    // `gateReservedMarker`, no `sanitizeForPublish`: por este motor pasan las TRES
    // superficies del modelo —Crear, el Chat y Len— y ninguna otra. Lo que
    // escribe el modelo no se le recorta; sólo se le aplica la puerta de
    // `data-slot-path`, que no admite excepción por procedencia.
    { sanitize: gateReservedMarker },
    {
      render: false,
      seal: false,
      // Por este motor pasan las TRES superficies del modelo y ninguna otra,
      // igual que con `gateReservedMarker` arriba: lo que escribe el modelo no
      // se le normaliza. Ver `HtmlGatePolicy.normalize`.
      normalize: false,
      // ⚰️ Con perfil, aquí se pasaban sus metadatos (logo → og:image). Se fue
      // con él el 2026-08-31; el título y la descripción los sigue poniendo
      // `ensurePageMeta` a partir del propio documento.
    },
  );
  if (!gated.ok) {
    stages.push({ stage: "gate", status: "unavailable", detail: gated.code });
    return {
      ok: false,
      code: gated.code,
      ...(gated.detail ? { detail: gated.detail } : {}),
      report: {
        stages,
        breakage,
        ...(gated.removed ? { removed: { ...gated.removed, metaRefresh: 0 } } : {}),
      },
    };
  }
  current = gated.html;
  stages.push({ stage: "gate", status: "changed" });

  // ⚰️ ETAPA 6, «módulos»: RETIRADA el 2026-08-29 con el puente IA→módulos.
  // Encendía el módulo cuyo marcador traía la página. Su único módulo
  // puenteado ya no tiene horneado, así que la etapa devolvía siempre lista
  // vacía — y `report.modules` alimentaba dos ramas, en generate y en
  // ai-design, que por eso nunca se tomaban. (Su prueba vivía en lib/page-data
  // y se fue con los almacenes el 2026-10-04.)

  // ── 7. identidad de los formularios ────────────────────────────────────
  // Al final, sobre el documento que de verdad se guarda: si el saneo o los
  // módulos añaden o quitan un `<form>`, se estampa el resultado y no un paso
  // intermedio. Ver `lib/publish/form-identity.ts` para el fallo que cierra —
  // el lead del negocio yéndose al correo equivocado, en silencio.
  try {
    const marcados = stampFormIds(current);
    if (marcados.stamped > 0) {
      current = marcados.html;
      stages.push({ stage: "form_identity", status: "changed", detail: `${marcados.stamped}` });
    } else {
      stages.push({ stage: "form_identity", status: "skipped", detail: marcados.ids.length ? "ya_tenian" : "sin_formularios" });
    }
  } catch (err) {
    // Nunca cuesta una edición: sin identificador se cae a la ruta heredada
    // por índice, que es exactamente lo que había antes de esto.
    stages.push({ stage: "form_identity", status: "unavailable", detail: reason(err) });
  }

  // ── 8. el CSS que nunca aplica ─────────────────────────────────────────
  // Sobre el documento FINAL: el saneo, los módulos y el estampado pueden
  // añadir o quitar clases, así que auditar antes mediría un documento que
  // nadie recibe.
  //
  // DETERMINISTA Y SIN NAVEGADOR, y eso es lo que lo hace valioso: corre fuera
  // de la puerta de `renderChecks`, así que también en el turno del Agente, que
  // no puede pagar un arranque de Chrome. Microsegundos.
  //
  // Cierra el punto ciego que ninguna otra etapa ve: el render mide lo que se
  // PINTA y la puerta valida lo que está CABLEADO, pero un selector que no casa
  // no rompe nada — simplemente no ocurre. Ver `lib/document/css-wiring.ts`.
  let deadRules: readonly ReglaMuerta[] = [];
  try {
    // El JS sale del DOCUMENTO. Este detector mira el JavaScript a propósito
    // —una clase que el script añade en caliente (`classList.add("show")`)
    // está AUSENTE del markup inicial y es CORRECTA—, y le llegaba por el
    // canal de la cápsula. Ese canal rechazaba los documentos con más de un
    // `<script>` («varios»), así que en una página corriente el detector se
    // quedaba ciego y denunciaba como muerta una regla perfectamente viva.
    // Medido el 2026-08-26: `.toast.show` contó como defecto y ayudó a tirar
    // una página buena y a cobrar un crédito de más.
    deadRules = reglasQueNuncaAplican(current, todoElJsDelDocumento(current));
  } catch {
    /* nunca puede costar la página: es un diagnóstico, no una puerta */
  }

  // Y el mismo punto ciego por el otro lado: una clase que ninguna regla puede
  // definir. No la ve el render —no baja el contraste, no desborda, no grita—
  // ni la puerta, que valida cableado y no ortografía de Tailwind. Sale de la
  // misma etapa determinista y por el mismo canal.
  let clasesMuertas: readonly ClaseMuerta[] = [];
  try {
    clasesMuertas = clasesQueNuncaAplican(current);
  } catch {
    /* igual: diagnóstico, no puerta */
  }

  const report: PrepareReport = {
    stages,
    breakage,
    ...(gated.removed ? { removed: { ...gated.removed, metaRefresh: 0 } } : {}),
    ...(deadRules.length ? { deadRules } : {}),
    ...(clasesMuertas.length ? { clasesMuertas } : {}),
    ...(specFailures.length ? { specFailures } : {}),
  };
  return { ok: true, html: current, report };
}

export interface PreparePageDeps {
  readonly render?: typeof renderVisualQualityViewports;
  readonly gate?: typeof passHtmlGate;
}

/** El render vive dentro de la petición del usuario: un Chrome colgado no puede
 *  quedarse con la página que el modelo ya escribió. */
const RENDER_DEADLINE_MS = 20_000;

function withDeadline<T>(work: Promise<T>, onTimeout: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(onTimeout), RENDER_DEADLINE_MS).unref?.();
    }),
  ]);
}


function reason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 120);
}
