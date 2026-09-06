import "server-only";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { todoElJsDelDocumento } from "./conservar-scripts";
import { stampFormIds } from "@/lib/publish/form-identity";
import { validateBehaviors } from "@/lib/conductas-heredadas/validate";
import { programaJs } from "@/lib/agent/prueba-js";
import { compileCalcRegions, type CalcIssue } from "@/lib/expr/document";
import { reglasQueNuncaAplican, type ReglaMuerta } from "@/lib/document/css-wiring";
import { leerFallos, specProgram, type FalloSpec } from "@/lib/agent/behavior-spec";
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
 *   4. invariantes exactamente un <h1>; el literal que ya vale un token, atado
 *   5. puerta      saneo + normalización + metadatos + conductas
 *   6. módulos     el hueco que el documento pidió
 *
 * CONTRATO — igual que `lib/transform/index.ts`: las etapas 1-4 son fail-soft.
 * Si Chrome se cuelga o una pasada revienta, el documento sigue su camino y el
 * informe dice por qué; el llamador no necesita `try/catch`. La ÚNICA que puede
 * refusar es la puerta (5), y sólo con `mode: "edit"`.
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
    // LAS DOS FORMAS, un solo hueco. El navegador es el mismo, la pasada es la
    // misma y lo que devuelven es la misma lista de fallos: lo único que cambia
    // es quién escribió el programa — nuestro compilador desde su JSON (`spec`)
    // o el modelo directamente sobre los primitivos `ui.*` (`js`).
    const guion = !opts.prueba
      ? undefined
      : opts.prueba.modo === "js"
        ? programaJs(opts.prueba.codigo)
        : opts.prueba.pasos.length > 0
          ? specProgram(opts.prueba.pasos)
          : undefined;
    const medido = await render(current, {}, guion ? { behaviorProgram: guion } : {});
    breakage = objectiveBreakage(medido);
    // `leerFallos` descarta cualquier forma inesperada: no medir no es medir mal.
    //
    // Y desde el 2026-09-04 se separan DOS cosas que antes iban juntas: lo que
    // la página incumplió, y lo que la PRUEBA no pudo aplicar (un selector que
    // no señala a nada, o a varios). Sólo lo primero es un fallo del documento
    // y puede disparar una reparación; lo segundo se oye en el informe y en el
    // log, porque «una prueba que no se pudo correr no acusa a nadie».
    const todos = guion ? leerFallos(medido?.behaviorResult) : [];
    specFailures = todos.filter((f) => !f.deLaPrueba);
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
      ...specFailures.map((f) => `prueba paso ${f.paso}: ${f.mensaje}`),
      ...red.map((g) => `AJENA (red, no del modelo): ${g}`),
    ];
    stages.push({ stage: "measure", status: detalle.length ? "changed" : "skipped", detail: detalle.join(" · ") || undefined });
  } catch (err) {
    // No haber medido no es prueba de que no haya rotura, y por eso se anota
    // como `unavailable` en vez de como "sin roturas".
    stages.push({ stage: "measure", status: "unavailable", detail: reason(err) });
  }

  // ── `beforeMeta`: lo único que queda corriendo aquí ────────────────────
  // Corre después de sanear y normalizar, y antes de `ensurePageMeta`.
  //
  // ⚰️ El orden lo justificaba `bindColorsToTokens` —«cosecha el tema que el
  // normalizador escribe en `<html style>`, medido: 8 de 40 documentos salían
  // distintos»— y el sembrado de marca. Las dos cosas se fueron: la siembra el
  // 2026-08-31, las cuatro reparaciones el 2026-09-04, y sus módulos el
  // 2026-09-05. Lo que queda es `compileCalcRegions`, y a ése el orden le da
  // igual: no cosecha nada del normalizador, ejecuta lo que el modelo marcó.
  let invariants: StageOutcome = { stage: "invariants", status: "skipped" };
  let calcIssues: CalcIssue[] = [];
  let calcRepairs: string[] = [];
  const beforeMeta = (h: string): string => {
    try {
      // ⚰️ Aquí corría `seedBrandIntoHtml` en CADA guardado — el sembrado del
      // perfil de negocio. Retirado el 2026-08-31.
      //
      // ⚰️ Y CON ÉL, LAS CUATRO REPARACIONES (Jesús, 2026-09-04). Se llamaban
      // «invariantes», que es como se llama a una corrección cuando se da por
      // supuesto que el que escribió el documento se equivocó:
      //
      //   `ensureSingleH1`      — le añadía un <h1>. La única que metía
      //                           CONTENIDO VISIBLE que el modelo no escribió.
      //   `ensureScrollPadding` — le metía scroll-padding para las anclas.
      //   `bindColorsToTokens`  — le reescribía sus hex a `var(--su-token)`.
      //                           Ni siquiera cambiaba el color pintado: le
      //                           refactorizaba el CSS a cambio de nada visible.
      //   `repairCalcRegions`   — le movía las regiones de cálculo mal puestas.
      //
      // La decisión es la misma que retiró las fotos, los colores ilegibles, la
      // cadena born-canonical y las dos reescrituras: lo que escribe el modelo
      // ES la página. Un defecto suyo se MIDE y se dice —la etapa de medición
      // sigue entera— pero no se le corrige por detrás.
      //
      // LO QUE SE QUEDA, y por qué no es lo mismo:
      //
      //   `compileCalcRegions` — no le corrige nada: EJECUTA lo que él marcó.
      //     Quitarlo dejaría muertas las regiones que el propio modelo pidió.
      //     Sigue compilando ANTES de `validateBehaviors`, así que la puerta
      //     ve el documento compilado y una fórmula rota se trata como
      //     cualquier control muerto.
      //
      //     Sigue siendo seguro por construcción, no por suerte: lo único que
      //     inyecta es un programa derivado de un AST cerrado, serializado con
      //     los ángulos escapados, y un valor inicial escapado como texto. Ni
      //     un `<script>`, ni un `on*`, ni una URL.
      //
      // Las fórmulas que el modelo dejó rotas ya no se arreglan: salen en
      // `calcIssues` y de ahí al informe y al diario, como el desborde.
      const calc = compileCalcRegions(h);
      calcIssues = [...calc.issues];
      calcRepairs = [];
      invariants = {
        stage: "invariants",
        status: calc.compiled > 0 ? "changed" : "skipped",
        detail:
          `calc=${calc.compiled}/${calc.regions}` +
          (calc.issues.length > 0 ? ` rotas=${calc.issues.length}` : ""),
      };
      return calc.html;
    } catch (err) {
      // Un invariante es una mejora, nunca un peaje: si revienta, pasa el
      // documento tal cual y la puerta sigue su curso.
      invariants = { stage: "invariants", status: "unavailable", detail: reason(err) };
      return h;
    }
  };

  const gated = await gate(
    current,
    // `gateReservedMarker`, no `sanitizeForPublish`: por este motor pasan las TRES
    // superficies del modelo —Crear, el Chat y Len— y ninguna otra. Lo que
    // escribe el modelo no se le recorta; sólo se le aplica la puerta de
    // `data-slot-path`, que no admite excepción por procedencia.
    { sanitize: gateReservedMarker, beforeMeta },
    {
      render: false,
      seal: false,
      // Por este motor pasan las TRES superficies del modelo y ninguna otra,
      // igual que con `gateReservedMarker` arriba: lo que escribe el modelo no
      // se le normaliza. Ver `HtmlGatePolicy.normalize`.
      normalize: false,
      // La asimetría deliberada. Ver el comentario de `PageMode`. Y con
      // `priorHtml` la puerta avisa en vez de bloquear: la comparación de abajo
      // decide, para no cobrarle al usuario un defecto que ya estaba.
      behaviors: opts.mode === "create" || opts.priorHtml !== undefined ? "warn" : "block",
      // ⚰️ Con perfil, aquí se pasaban sus metadatos (logo → og:image). Se fue
      // con él el 2026-08-31; el título y la descripción los sigue poniendo
      // `ensurePageMeta` a partir del propio documento.
    },
  );
  stages.push(invariants);

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
        ...(gated.issues ? { behaviorIssues: [...gated.issues] } : {}),
        ...(calcIssues.length ? { calcIssues } : {}),
        ...(calcRepairs.length ? { calcRepairs } : {}),
      },
    };
  }
  // Sólo lo que ESTA edición rompió. Una conducta que ya venía rota se queda
  // anotada en el informe, no cuesta la edición.
  const issues = [...(gated.issues ?? [])];
  if (opts.mode === "edit" && opts.priorHtml !== undefined && issues.length > 0) {
    const before = new Set(safeBehaviors(opts.priorHtml).map((i) => JSON.stringify(i)));
    const nuevos = issues.filter((i) => !before.has(JSON.stringify(i)));
    if (nuevos.length > 0) {
      stages.push({ stage: "gate", status: "unavailable", detail: "behaviors_invalid" });
      return {
        ok: false,
        code: "behaviors_invalid",
        report: {
          stages,
          breakage,
          ...(gated.removed ? { removed: { ...gated.removed, metaRefresh: 0 } } : {}),
          behaviorIssues: nuevos,
        },
      };
    }
  }

  current = gated.html;
  stages.push({ stage: "gate", status: "changed" });

  // ⚰️ ETAPA 6, «módulos»: RETIRADA el 2026-08-29 con el puente IA→módulos.
  // Encendía el módulo cuyo marcador traía la página. Su único módulo
  // puenteado ya no tiene horneado, así que la etapa devolvía siempre lista
  // vacía — y `report.modules` alimentaba dos ramas, en generate y en
  // ai-design, que por eso nunca se tomaban. El porqué, con sus pruebas, en
  // lib/page-data/sin-puente-ia-modulos.test.ts.

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

  const report: PrepareReport = {
    stages,
    breakage,
    ...(gated.removed ? { removed: { ...gated.removed, metaRefresh: 0 } } : {}),
    ...(gated.issues ? { behaviorIssues: [...gated.issues] } : {}),
    ...(calcIssues.length ? { calcIssues } : {}),
    ...(calcRepairs.length ? { calcRepairs } : {}),
    ...(deadRules.length ? { deadRules } : {}),
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

/** Nunca tira: un validador caído no puede costar una edición. */
function safeBehaviors(html: string): ReturnType<typeof validateBehaviors> {
  try {
    return validateBehaviors(html);
  } catch {
    return [];
  }
}

function reason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 120);
}
