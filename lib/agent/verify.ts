// Los ojos del agente — verificación visual post-edición (Agente F5).
//
// Tras un turno que MUTÓ el documento, el loop (via el hook verifyTurn del
// route) renderiza la página editada, se la muestra al papel con visión y pregunta
// una sola cosa: ¿la edición dejó rotura visual OBJETIVA? No es el crítico de
// belleza de /api/generate (esa página nace nuestra); esta página ES DEL
// USUARIO y el agente acaba de aplicar lo que pidió — juzgar el gusto sería
// pelearse con el dueño. Solo rotura: texto encimado o cortado, contraste
// ilegible, layout desbordado, sección visiblemente vacía o duplicada,
// imagen rota.
//
// Todo es BEST-EFFORT y fail-open, igual que lib/ai/vision-critique.ts: sin
// Chrome, sin key, timeout, JSON malformado → veredicto "ok" con fallback=true
// y el turno cierra como siempre. La verificación solo puede mejorar un turno
// o dejarlo igual — nunca bloquearlo.

import type { InlineImage, StreamEvent } from "@/lib/ai-gateway";
import { esGritoDeLaPagina, renderHtmlToInlineImage } from "@/lib/ai/inline-image";
import { partirGritos } from "@/lib/generation/rotura-ajena";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { injectModelRuntime } from "@/lib/ai-stream/model-runtime";
import {
  notaSpec,
  leerFallos,
  specProgram,
  type FalloSpec,
  type PasoSpec,
} from "@/lib/agent/behavior-spec";
import { streamWithRetry } from "@/lib/agent/retry";
import {
  fireworksStreamProvider,
  type FlexibleStreamRequest,
} from "@/lib/ai/fireworks-as-stream-provider";

export interface VisualVerdict {
  /** true = la edición dejó rotura visual objetiva. */
  broken: boolean;
  /** Problemas concretos, en el idioma del prompt del usuario cuando se puede. */
  issues: string[];
  /**
   * LO QUE SE VE Y NO SE PUEDE CALIFICAR DESDE LA CAPTURA.
   *
   * 🔴 Existe porque al crítico se le estaba pidiendo un juicio INDECIDIBLE: un
   * rectángulo de color plano es un marcador intencional o una imagen rota
   * según la INTENCIÓN, y la intención vive en el HTML, no en los píxeles.
   *
   * MEDIDO el 2026-09-02 en una landing de inmobiliaria: tres tarjetas
   * conservaron su degradado y el crítico las marcó como rotas. Ocho búsquedas
   * de foto después, seguían sin existir. El crítico no vio mal: contestó lo
   * único que el esquema le dejaba contestar.
   *
   * Y desde el 2026-09-04 una caja pintada ya NO es un hueco a la espera: la
   * biblioteca de fotos es del usuario, el contrato le pide al modelo la página
   * TERMINADA, y el dueño cambia el área por su foto desde el editor. O sea que
   * un rectángulo de color es, por defecto, lo que el modelo quiso poner.
   *
   * Es la misma lección que Crear ya aprendió («el crítico informa; ya no
   * gasta», app/api/generate/route.ts) tras medir que puntuaba bajo por las
   * FOTOS —«Bolillo muestra un océano»— y pedía regenerar sin arreglar nada.
   *
   * Viaja al modelo como CONTEXTO y nunca abre ciclo de arreglo por sí sola
   * (ver `VerifyOutcome` en lib/agent/loop.ts).
   */
  observaciones: string[];
  /** true cuando esto es el fallback (render/API/parse/timeout falló) — el
   *  caller lo trata como "no hay nada que arreglar". */
  fallback: boolean;
  /** Tokens de la llamada de visión — para contabilidad (el eval runner los
   *  suma a su costo real). Ausente en fallbacks que nunca llamaron al modelo. */
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number };
}

export interface VerifyParams {
  /** El documento YA editado (el último updatedHtml del turno). */
  html: string;
  /** El JavaScript del modelo, verificado contra su cápsula.
   *
   *  `html` viene SANEADO —así se persiste— así que sin esto los ojos miran una
   *  página sin scripts y jamás verían reventar el código que el propio modelo
   *  escribió. Se inyecta igual que al publicar: un `<script>` clásico antes de
   *  `</body>`. Ausente ⇒ se renderiza exactamente como antes. */
  runtime?: string | null;
  /** El pedido original del usuario este turno — contexto de intención. */
  userPrompt: string;
  /** LO QUE EL MODELO PROMETIÓ que su código haría, si lo declaró.
   *
   *  Sin esto los ojos sólo responden «¿explotó?». Una ruleta que gira y no
   *  para nunca carga limpia, sale perfecta en la foto y no lanza un error —
   *  y está rota. Ausente ⇒ se pulsa a ciegas como hasta ahora. */
  spec?: readonly PasoSpec[] | null;
  // ⚰️ Aquí vivía `soloDeterminista`, la SEGUNDA pasada: medir sin llamar al
  // modelo con visión, para comprobar si el ciclo de arreglo había arreglado.
  // Retirado en el barrido del 2026-09-04 — no hay ciclo desde `12f6a11e`, y
  // el bucle no podía siquiera alcanzar esa segunda pasada.
  /* Aqui vivian `model` y `apiKey`, los dos nombrando a Gemini y los dos ya
     sin trabajo: quien mira lo decide `operation: "agent_visual_verify"` en la
     politica, y la credencial es la de Fireworks. */
}

export interface VerifyProviderLike {
  stream(
    request: FlexibleStreamRequest,
    opts: { signal?: AbortSignal },
  ): AsyncIterableIterator<StreamEvent>;
}

export interface VerifyInternals {
  provider?: VerifyProviderLike;
  render?: (html: string) => Promise<InlineImage | null>;
  /** El medidor DETERMINISTA de contraste. Se inyecta aparte del render de la
   *  foto porque son dos navegadores distintos y sólo uno sabe medir. */
  medir?: (
    html: string,
  ) => Promise<{
    unreadableText?: readonly {
      contrast: number;
      texto?: string;
      etiqueta?: string;
      color?: string;
      background?: string;
    }[];
    mobileOverflow?: boolean;
    overflowCulprit?: string;
    overflowCulpritRight?: number;
    /** "caja" (mide de más) o "tinta" (el texto no se puede partir). El arreglo
     *  es distinto, y decirlo evita que el modelo toque anchos ante una palabra
     *  que no se parte. Ver `VisualQualityViewports`. */
    overflowCulpritKind?: "caja" | "tinta";
    /** Lo que la página gritó EN ESE render, y las URLs que el guardia cortó.
     *  Estos dos campos faltaban aquí, y esa ausencia era la firma del defecto:
     *  el contrato de la inyección se había escrito con los cuatro campos que
     *  `runVerify` leía, así que el día que el medidor real empezó a devolver
     *  hechos nuevos no hubo ni un error de tipos que avisara de que se estaban
     *  tirando. */
    runtimeErrors?: readonly string[];
    blockedSubresources?: readonly string[];
  } | null>;
  /** Override del deadline — solo tests. */
  timeoutMs?: number;
}

// La verificación corre DESPUÉS de que el texto del turno ya streameó — cada
// segundo aquí es espera visible ("Revisando el resultado…"), así que el
// presupuesto es corto: render ~2-4s + Flash vision con salida chica, con
// margen para que streamWithRetry cabalgue un pico 503 (observado en vivo:
// el primer intento 503 y el segundo/tercero pasan). Vencido el plazo,
// fail-open.
export const VERIFY_TIMEOUT_MS = 20_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;
const VERIFY_MAX_OUTPUT_TOKENS = 2_048; // Flash gasta thinking antes del primer token — generoso para no truncar el JSON (mismo racional que vision-critique)
const VERIFY_TEMPERATURE = 0.1;
// Más de esto no es un arreglo quirúrgico sino una re-crítica de toda la
// página — se recortan las primeras N.
const MAX_ISSUES = 4;

const VERDICT_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    broken: { type: "BOOLEAN" },
    issues: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["broken", "issues"],
  propertyOrdering: ["broken", "issues"],
};

function fallbackVerdict(): VisualVerdict {
  return { broken: false, issues: [], observaciones: [], fallback: true };
}

/**
 * LO QUE EL NAVEGADOR MIDIÓ, separado de lo que el crítico OPINÓ.
 *
 * Existe porque estos hechos se recogen ANTES de la llamada de visión y se
 * mezclaban DESPUÉS: entre medias hay cuatro salidas tempranas (sin captura,
 * turno abortado, proveedor caído o JSON ilegible) y cada una
 * devolvía `fallbackVerdict()` — broken:false, issues:[]. Es decir: Chromium
 * veía la excepción que mata el JavaScript de la página y, si el crítico no
 * podía opinar, el Agente recibía «todo bien».
 *
 * Un hecho no depende de que el crítico conteste. Se conserva en los dos
 * caminos; `fallback:true` sigue diciendo la verdad —el crítico no juzgó— y
 * ahora convive con `broken:true` cuando el navegador vio algo objetivo.
 */
interface HechosDelNavegador {
  gritos: string[];
  /** Las URLs que el guardia SSRF cortó: huecos que hicimos NOSOTROS. */
  bloqueadas: string[];
  fallosSpec: FalloSpec[];
  desbordaMovil: boolean;
  culpable: string;
  culpableAncho: number;
  /** Los textos que nadie puede leer, CON SU DIRECCIÓN. Llevaba sólo
   *  `{contrast}` —un número pelado— y eso costó lo que cuesta siempre un
   *  diagnóstico sin dirección: MEDIDO el 2026-08-30 en una sesión real, el
   *  Agente dio CUATRO rondas seguidas oscureciendo el mismo velo sin acertar,
   *  y en la última escribió veinte párrafos razonando en voz alta cuál de los
   *  textos de la página estaría a 1.00:1. Tenía el ratio y ninguna forma de
   *  saber a qué elemento pertenecía.
   *
   *  Es el mismo defecto que `sin_accion` en las pruebas de comportamiento, y
   *  se arregla igual: decir DÓNDE, no sólo QUÉ. */
  contrastes: readonly {
    readonly contrast: number;
    readonly texto?: string;
    readonly etiqueta?: string;
    readonly color?: string;
    readonly background?: string;
  }[];
}

function hechosVacios(): HechosDelNavegador {
  return {
    gritos: [],
    bloqueadas: [],
    fallosSpec: [],
    desbordaMovil: false,
    culpable: "",
    culpableAncho: 0,
    contrastes: [],
  };
}

/**
 * Quién mira. Qwen es el papel con visión de la política —al razonador nunca se
 * le manda una imagen— y llega por el mismo transporte de streaming que el
 * resto, así que `verifyEditedPage` no cambia una línea de su cuerpo.
 *
 * No se le impone un esquema al modelo: el modo estricto de Fireworks rechaza
 * esquemas válidos (medido), y `parseVisualVerdict` ya tolera vallas de
 * markdown, texto alrededor y campos de más. Se pide un objeto JSON y se valida
 * aquí, que es donde siempre se validó.
 *
 * Aqui vivia `OPENLEN_AGENT_EYES=gemini`, retirado el 2026-08-28 con el resto
 * del proveedor. Y como todo en este
 * archivo, cualquier fallo cae al veredicto de reserva: la verificación sólo
 * puede mejorar un turno, jamás bloquearlo.
 */
function defaultVerifyProvider(): VerifyProviderLike {
  // Qwen por Fireworks, con su propia credencial. Elige por `operation`.
  return fireworksStreamProvider({
    requestId: "agent-verify",
    operation: "agent_visual_verify",
    maxOutputTokens: 2_048,
    jsonObject: true,
  });
}

/** Verifica visualmente la página editada. Siempre resuelve — nunca lanza;
 *  cualquier fallo devuelve el fallback (broken=false). */
export async function verifyEditedPage(
  params: VerifyParams,
  internals: VerifyInternals = {},
): Promise<VisualVerdict> {
  // Los hechos del navegador se recogen DENTRO de runVerify pero se poseen
  // AQUÍ: el catch y el timeout de abajo son salidas suyas, y sin esto ambas
  // devolvían broken:false sobre una página que Chromium ya había visto morir.
  const hechos = hechosVacios();
  const timeoutMs = internals.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      deadline.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race<VisualVerdict | "timeout">([
      runVerify(params, internals, deadline.signal, hechos).catch((err) => {
        logFallback(`error: ${err instanceof Error ? err.message : String(err)}`);
        return conHechos(fallbackVerdict(), hechos);
      }),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      logFallback(`timeout (>${timeoutMs}ms)`);
      return conHechos(fallbackVerdict(), hechos);
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    deadline.abort();
  }
}

// Mapa de contenido: el texto que el HTML DICE tener, para cruzarlo contra lo
// que la captura MUESTRA. Sin esto el crítico es ciego al peor fallo posible:
// texto invisible (blanco sobre blanco) no se ve "roto" en un screenshot — se
// ve como nada. Verificado en vivo: sin el mapa, una página con el H1
// invisible y una lista de precios ilegible pasó como sana.
export function contentMap(html: string): string {
  const bodyAt = html.search(/<body[^>]*>/i);
  const body = bodyAt === -1 ? html : html.slice(bodyAt);
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out: string[] = [];
  const re = /<(h1|h2|h3|p|li|a|button|figcaption|blockquote)\b[^>]*>([^<]{4,})</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null && out.length < 30) {
    const text = m[2].replace(/\s+/g, " ").trim();
    if (text.length >= 4) out.push(`<${m[1].toLowerCase()}> ${text.slice(0, 90)}`);
  }
  return out.length ? out.join("\n") : "(no text content found)";
}

async function runVerify(
  params: VerifyParams,
  internals: VerifyInternals,
  signal: AbortSignal,
  hechos: HechosDelNavegador,
): Promise<VisualVerdict> {
  const render = internals.render ?? renderHtmlToInlineImage;
  // EL MISMO injerto que hace el publicador, no uno parecido: si los ojos miran
  // un documento armado de otra forma, miran una página que nadie recibe. Aquí
  // NO se persiste nada — es una vista de usar y tirar dentro del navegador.
  //
  // ⚠️ Y HOY EL PUBLICADOR YA NO INJERTA: desde `933acc9d` el <script> vive
  // dentro de `data.html`, así que `params.html` normalmente YA lo trae y esta
  // llamada no añade nada (`injectModelRuntime` es idempotente — ver su
  // comentario, y el bug de producción que lo obligó). Se conserva la llamada
  // porque `runtime` sigue siendo el HECHO de que esta página tiene JavaScript
  // del modelo, y de ahí salen `conGuion` y el pulsado de controles.
  const codigo = params.runtime?.trim();
  const paraRenderizar = codigo ? injectModelRuntime(params.html, codigo) : params.html;
  // El medidor de contraste corre EN PARALELO con la foto: son dos navegadores
  // y encadenarlos gastaría ~2s del presupuesto de 20 para nada. Fail-open como
  // el resto — si no hay medidor o revienta, se sigue exactamente igual.
  //
  // Sólo cuando el llamador inyectó un `render` propio se toma también su
  // `medir`: un doble de prueba que sustituye el navegador de la foto no puede
  // acabar arrancando Chrome de verdad por la puerta de al lado. Con los dos
  // por omisión (producción), corre el medidor real.
  const medir =
    internals.medir ?? (internals.render ? async () => null : renderVisualQualityViewports);
  const medicion = medir(paraRenderizar).catch(() => null);

  // Si el modelo declaró qué debe pasar, se comprueba ESO. Si no, se pulsa a
  // ciegas: sigue viendo el script que muere al primer clic, que es lo que
  // había antes de que existiera el guion.
  const conGuion = codigo && params.spec && params.spec.length > 0;
  const image = await render(paraRenderizar, {
    onErrors: (e) => hechos.gritos.push(...e),
    onBlocked: (u) => hechos.bloqueadas.push(...u),
    ...(conGuion
      ? {
          behaviorProgram: specProgram(params.spec!),
          onBehaviorResult: (b) => { hechos.fallosSpec = leerFallos(b); },
        }
      : codigo
        ? { pressButtons: true }
        : {}),
  });
  if (!image) {
    logFallback("render failed — no screenshot");
    return conHechos(fallbackVerdict(), hechos);
  }
  const medido = await medicion;
  hechos.contrastes = medido?.unreadableText ?? [];
  hechos.desbordaMovil = medido?.mobileOverflow === true;
  hechos.culpable = medido?.overflowCulprit ?? "";
  hechos.culpableAncho = medido?.overflowCulpritRight ?? 0;
  // 🔴 Y SUS GRITOS, que hasta hoy se TIRABAN en esta misma línea.
  //
  // Son DOS navegadores mirando la misma página: el de la foto y el del
  // medidor. De este último se leían cuatro campos y se descartaban
  // `runtimeErrors` y `blockedSubresources` — la mitad de los hechos que
  // Chromium ya había recogido, y por los que ya habíamos pagado el arranque.
  // Un `TypeError` que sólo asomaba en el render del medidor (otro viewport,
  // otro momento del ciclo) no llegaba jamás al modelo: la página se declaraba
  // sana y el fallo se publicaba.
  //
  // Pasan por el MISMO filtro que los de la foto: un recurso que no carga NO es
  // «el JavaScript falla», y esa frase es literal en `conHechos`.
  //
  // Y por `partirGritos` sobre la TANDA ENTERA, no de uno en uno: filtrar el
  // «no bajó el fichero» y dejar pasar el `Chart is not defined` que viene
  // detrás no arregla nada — el segundo tiene toda la pinta de código roto y es
  // el que manda a Len a perseguir un fantasma que no puede alcanzar. La
  // condición colateral necesita saber que en ESTE render hubo un fallo de
  // carga, y eso sólo se sabe mirando la tanda. Ver `lib/generation/rotura-ajena.ts`.
  const crudos = medido?.runtimeErrors ?? [];
  const sinPrefijo = (g: string) =>
    g.startsWith("consola: ") ? g.slice("consola: ".length) : g;
  const partido = partirGritos(crudos.map(sinPrefijo));
  if (partido.ajenos.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[verify] rotura AJENA (no es de la página, no se le acusa) — ${partido.ajenos.join(" · ")}`);
  }
  for (const grito of crudos) {
    const texto = sinPrefijo(grito);
    if (!partido.propios.includes(texto)) continue;
    if (esGritoDeLaPagina(texto) && !hechos.gritos.includes(grito)) hechos.gritos.push(grito);
  }
  // Lo que el guardia cortó en ESE render también cuenta: `conHechos` compara
  // los gritos contra esta lista para no acusar a la página de los huecos que
  // hicimos nosotros. Cuantas más URLs tenga, menos falsos culpables.
  for (const url of medido?.blockedSubresources ?? []) {
    if (!hechos.bloqueadas.includes(url)) hechos.bloqueadas.push(url);
  }
  if (signal.aborted) return conHechos(fallbackVerdict(), hechos);

  // AQUI SE APAGABAN LOS OJOS ENTEROS. Este bloque exigia `GEMINI_API_KEY` y
  // devolvia fallback sin ella — por una credencial que el proveedor por
  // defecto ni tocaba. Con una clave de prepago agotada (que es lo normal),
  // Len seguia editando y NADIE volvia a mirar la pagina. Con el proveedor
  // fuera, la rama que podia devolver `null` desaparece: siempre hay ojos.
  const provider: VerifyProviderLike = internals.provider ?? defaultVerifyProvider();

  let raw = "";
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  // streamWithRetry: los picos 503 del proveedor son transitorios y el resto del
  // agente ya los cabalga — sin esto, cada pico convierte la verificación en
  // fallback (observado en vivo el 2026-07-28).
  for await (const ev of streamWithRetry(
    () =>
      provider.stream(
        {
          messages: [
            {
              role: "user",
              content: buildVerifyPrompt(params.userPrompt, params.html, hechos.bloqueadas),
            },
          ],
          images: [image],
          responseMimeType: "application/json",
          responseSchema: VERDICT_SCHEMA,
          maxOutputTokens: VERIFY_MAX_OUTPUT_TOKENS,
          temperature: VERIFY_TEMPERATURE,
        },
        { signal },
      ),
    { attempts: RETRY_ATTEMPTS, baseMs: RETRY_BASE_MS, signal },
  )) {
    if (ev.type === "text_delta") {
      raw += ev.text;
    } else if (ev.type === "usage") {
      usage.inputTokens += ev.inputTokens;
      usage.outputTokens += ev.outputTokens;
      usage.cachedTokens += ev.cachedTokens;
    } else if (ev.type === "done" && ev.stopReason.kind === "error") {
      logFallback(`error del proveedor: ${ev.stopReason.error}`);
      return conHechos(fallbackVerdict(), hechos);
    }
  }

  const verdict = parseVisualVerdict(raw);
  if (!verdict) {
    logFallback("malformed JSON verdict");
    return conHechos(fallbackVerdict(), hechos);
  }
  conHechos(verdict, hechos);
  verdict.usage = usage;
  // eslint-disable-next-line no-console
  console.log(
    `[agent-verify] broken=${verdict.broken} issues=${JSON.stringify(verdict.issues.join("; "))}`,
  );
  return verdict;
}

/**
 * Mezcla los hechos del navegador en un veredicto y devuelve el MISMO objeto.
 * Es la única puerta por la que un hecho llega al modelo, así que corre sobre
 * el juicio del crítico y sobre el fallback por igual.
 *
 * El orden de la lista se conserva tal cual estaba: cada bloque antepone, así
 * que el último en correr acaba primero. No se toca — el modelo lee la lista
 * de arriba abajo y reordenarla cambia dónde busca el fallo.
 */
/**
 * ¿Este grito lo provocó algo que NOSOTROS bloqueamos?
 *
 * Se mira si el mensaje nombra una de las URLs que el guardia apuntó, o si
 * nombra el motivo con el que el guardia aborta (`ERR_BLOCKED_BY_CLIENT`, que es
 * literalmente el `blockedbyclient` de `req.abort`). Lo segundo cubre el caso
 * normal de Chromium, que en «Failed to load resource» pone el motivo pero no
 * siempre la URL.
 *
 * Conservador a propósito: sólo se calla lo que se puede atribuir a nuestro
 * propio guardia. Un error de verdad se sigue contando.
 */
export function esDeAlgoQueBloqueamos(grito: string, bloqueadas: readonly string[]): boolean {
  if (bloqueadas.length === 0) return false;
  if (/ERR_BLOCKED_BY_CLIENT/i.test(grito)) return true;
  return bloqueadas.some((u) => grito.includes(u));
}

function conHechos(verdict: VisualVerdict, h: HechosDelNavegador): VisualVerdict {
  const { gritos, fallosSpec, desbordaMovil, culpable, culpableAncho, contrastes } = h;
  // LO QUE EL NAVEGADOR GRITÓ. No pasa por el juicio del crítico visual: una
  // excepción es un HECHO, y encima de los que el ojo no puede ver — la captura
  // de una página cuyo JavaScript murió sale idéntica a la de una sana. MEDIDO
  // el 2026-08-22 con tres páginas cuya foto pesaba exactamente lo mismo: una
  // sana, una que revienta al cargar y una que revienta al pulsar.
  //
  // Cuando hubo runtime, además se PULSARON sus controles (dos rondas), así que
  // esto cubre las tres formas de estar muerto: al cargar, al primer clic y a
  // la segunda jugada. Por eso la frase no dice «al cargar» — diría una cosa
  // que a veces es falsa, y el modelo buscaría el bug en el sitio equivocado.
  //
  // Va primero en la lista: es lo más accionable de todo lo que el turno puede
  // decirle al modelo.
  //
  // LO QUE NOSOTROS CORTAMOS NO CUENTA, y se comprueba por URL, no por texto.
  //
  // El guardia SSRF aborta con `blockedbyclient`, y Chromium lo grita por
  // consola como «Failed to load resource: net::ERR_BLOCKED_BY_CLIENT». Ese
  // grito llegaba aquí y forzaba `broken` con la frase de arriba — «el
  // JavaScript falla»— por una IMAGEN que habíamos bloqueado nosotros. El
  // Agente iba a buscar culpable y borraba la foto del dueño (2026-08-27).
  //
  // `inline-image.ts` ya filtra los fallos de recurso, así que este grito no
  // debería llegar. Esto es el cinturón: compara con las URLs que el guardia
  // apuntó, así que sigue en pie el día que Chromium cambie la redacción del
  // mensaje — que es justo lo que un filtro de texto no puede prometer.
  const propios = gritos.filter((g) => !esDeAlgoQueBloqueamos(g, h.bloqueadas));
  if (propios.length > 0) {
    verdict.issues = [
      ...propios.map((g) => `El JavaScript de la página falla (al cargarla o al usar sus controles): ${g}`),
      ...verdict.issues,
    ];
    verdict.broken = true;
  }
  // TEXTO QUE NADIE PUEDE LEER, medido en el render — no juzgado por el ojo del
  // crítico, que es malo justo en esto: un botón amarillo con letras blancas se
  // ve «bonito» en una captura y es ilegible.
  //
  // MEDIDO el 2026-08-22: pidiéndole «pon el botón en #f5e050 con el texto en
  // blanco» el Agente obedece al pie de la letra y entrega 1.34:1 — el usuario
  // pidió los colores, así que `cambiar_tema` (que camina el contraste hasta
  // cumplir WCAG) ni entra en juego. Por el camino determinista el peor caso de
  // 12 fue 4.88:1; escribiendo el CSS a mano, la mitad quedó por debajo de 4.5.
  //
  // El detector ya existía y ya lo cazaba con el número exacto: sólo no llegaba
  // al Agente. Es fail-open como todo lo demás — sin medidor, sin cambios.
  // LA PROMESA DEL MODELO, ejecutada — Y EN EL CANAL QUE NO ACUSA.
  //
  // 🔴 AQUÍ ESTABA EN `issues` CON `broken = true` (hasta el 2026-09-04). Se
  // baja a `observaciones` por lo que se MIDIÓ, no por gusto: de los 3 fallos
  // de `prueba` de la corrida de 16 páginas, CERO eran de la página. Eran un
  // verbo que nos faltaba (`atributo`, para «el botón deja de estar
  // deshabilitado») y dos pruebas que pulsaban «enviar» sin rellenar campos
  // `required`, con lo que el navegador ni disparaba el `submit`. Las tres
  // páginas funcionaban.
  //
  // Un comprobador que acierta 0 de 3 no puede declarar rota la página de
  // nadie. Y las otras cuatro cosas de esta función —el JavaScript que grita,
  // el desborde a 390px, el contraste leído del píxel, la imagen rota— sí
  // pueden: son HECHOS del navegador, no la opinión del mismo modelo que
  // escribió el código. La diferencia entre unas y otra es quién es el testigo.
  //
  // Es exactamente lo que hace el `Edit` de Claude Code, que es de donde sale
  // la regla: cuando la comprobación no casa, FALLA EN SEGURO —no se aplica y
  // no acusa a nadie— en vez de ensuciar el marcador. Ver [[la-jaula-abierta-y-el-cartel-puesto]].
  //
  // NO SE CALLA, que es la otra mitad. `observaciones` sale por la rama
  // `observado` del bucle: se le dice al usuario, va al texto del turno y con
  // él al historial, así que el modelo lo lee en el turno siguiente y el
  // usuario puede pedir el arreglo. Lo que se retira es la ACUSACIÓN, no el
  // dato. Y va con `notaSpec` y no con `avisoSpec` porque ese canal lo lee una
  // persona: `avisoSpec` le habla al modelo y nombra `target="runtime"`.
  if (fallosSpec.length > 0) {
    verdict.observaciones = [notaSpec(fallosSpec), ...verdict.observaciones];
    // eslint-disable-next-line no-console
    console.warn(
      `[agent-verify] la prueba del modelo falló (NO cuenta como rotura) — ` +
        fallosSpec.map((f) => `paso ${f.paso}: ${f.mensaje}`).join(" · "),
    );
  }
  // SE DESBORDA A LO ANCHO EN EL TELEFONO. Es el otro hecho que el ojo del
  // critico no puede juzgar: la captura se toma del documento COMPLETO, asi que
  // una pagina que se sale 48px de la pantalla sale entera y bien compuesta en
  // la foto — y en el telefono del dueno hay una barra horizontal y texto
  // cortado.
  //
  // MEDIDO el 2026-08-22 con los ataques de QA, y es el caso mas doloroso: el
  // usuario dice «en mi telefono se corta la tabla», el modelo aplica una
  // transformacion a tarjetas CORRECTA, se le olvida limpiar un `margin:16px
  // 24px` heredado dentro del media query, y entrega 100%+48px. Dijo «listo».
  //
  // La medicion ya estaba en la misma respuesta del render que el contraste;
  // solo no se miraba. La edicion del Agente corre con renderChecks:false —un
  // turno no puede pagar un arranque de Chrome— pero los ojos YA lo arrancaron.
  if (desbordaMovil) {
    verdict.issues = [
      culpable
        ? `La página se desborda a lo ancho en el teléfono (390px): \`${culpable}\` llega hasta ${culpableAncho}px, o sea ${culpableAncho - 390}px fuera de la pantalla. El visitante ve una barra horizontal con contenido cortado. Mira ese elemento y su regla: lo más común es un \`width:100%\` cuyo \`margin\` heredado suma POR FUERA, un ancho fijo en px, o contenido que no puede partirse. Si es una tabla ancha, la solución correcta es envolverla en un contenedor con \`overflow-x:auto\` — NUNCA \`overflow:hidden\`, que recorta en vez de arreglar. Arréglalo con editar_html.`
        : "La página se desborda a lo ancho en el teléfono (390px): algo se sale de la pantalla y el visitante ve una barra horizontal con contenido cortado. Suele ser un ancho fijo, un `width:100%` con márgenes heredados que suman por fuera, o contenido que no puede partirse. Arréglalo con editar_html.",
      ...verdict.issues,
    ];
    verdict.broken = true;
  }
  if (contrastes.length > 0) {
    const peor = Math.min(...contrastes.map((c) => c.contrast));
    // Se nombran de uno en uno, el peor primero, y con las dos mitades del
    // problema: qué texto y sobre qué. Tres como mucho — más es una lista que
    // nadie lee, y el resto se arregla en la vuelta siguiente.
    const nombrados = [...contrastes]
      .sort((a, b) => a.contrast - b.contrast)
      .slice(0, 3)
      .map((c) => {
        const donde = c.texto ? `«${c.texto}»` : c.etiqueta ? `<${c.etiqueta}>` : "un texto";
        const colores = c.color && c.background ? ` (${c.color} sobre ${c.background})` : "";
        return `${donde}${colores} a ${c.contrast.toFixed(2)}:1`;
      })
      .join("; ");
    verdict.issues = [
      `${contrastes.length} texto(s) que el navegador pinta y nadie puede leer (el mínimo legible es 3:1): ${nombrados}. Arregla ESOS, no otros: busca ese texto en el documento y cambia su color o el de su fondo con editar_html. Si ya lo intentaste y el contraste no mejora, el color que estás cambiando NO es el que se pinta — mira qué otra regla gana. Si el usuario pidió ESOS colores exactos, dile que así no se lee y propón el ajuste mínimo que sí cumple.`,
      ...verdict.issues,
    ];
    verdict.broken = true;
  }
  return verdict;
}

/** Un salto de linea, con nombre: escribirlo dentro del template literal de
 *  abajo obliga a partir la cadena y ya se ha roto una vez asi. */
const SALTO = String.fromCharCode(10);

export function buildVerifyPrompt(
  userPrompt: string,
  html: string,
  bloqueadas: readonly string[] = [],
): string {
  // LO QUE CORTAMOS NOSOTROS NO ES UN DEFECTO DE LA PÁGINA.
  //
  // El guardia SSRF bloquea los recursos que apuntan a loopback o a redes
  // internas, y el hueco que deja en la captura es indistinguible de una imagen
  // rota. Sin esta nota, quien mira la foto dice «imagen rota» y el Agente lo
  // arregla BORRÁNDOLA — que es exactamente lo que le pasó a Jesús el
  // 2026-08-27 con una foto que él mismo había adjuntado.
  //
  // Es el mismo remedio que el bloque <photography> del crítico de creación:
  // decirle qué parte de lo que ve NO es responsabilidad de la página.
  const nota =
    bloqueadas.length === 0
      ? ""
      : `<blocked-by-us>
These subresources were BLOCKED BY OUR OWN renderer before the screenshot was
taken (they point at a local or internal address, which our security guard
refuses to fetch). They are NOT broken on the real page:
${bloqueadas.slice(0, 10).map((u) => `- ${u}`).join(SALTO)}
Any empty frame or missing image caused by one of these is OUR doing, not a
defect. Never set broken=true for it and never list it in issues.
</blocked-by-us>
`;
  return `<role>You are the visual safety check for a page-editing agent. The attached screenshot is the user's OWN landing page, taken right after the agent applied an edit the user asked for.</role>
<user-request>${userPrompt}</user-request>
<content-map>
The page's HTML contains this text content. Cross-check it against the screenshot — content listed here that is NOT visible in the image usually means invisible text (same color as its background), the worst kind of breakage because the owner won't notice it either:
${contentMap(html)}
</content-map>
${nota}<task>Decide ONE thing: did the page end up with OBJECTIVE visual breakage? You are NOT a taste critic — the owner chose this design and the agent did what they asked. Never flag style, density, color taste, copy quality, or anything a reasonable owner could have wanted on purpose.</task>
<flag-only>
- Content from the content-map that is NOT visible anywhere in the screenshot (invisible text).
- Text overlapping other text or images, or clipped mid-word by its container.
- Text barely readable against its background (very low contrast).
- Layout breakage: elements escaping their container, horizontal overflow, a section collapsed to a sliver.
- A large visibly EMPTY region (blank hole with no content) or the same section visibly duplicated back-to-back.
- A broken image: the browser's missing-image icon, or a frame showing a failed image's alt text or broken-image border.
</flag-only>
<observe-only>
A box filled with a FLAT COLOR or a GRADIENT and no image is NOT breakage. Our
generator leaves exactly that on purpose whenever the curated photo library has
no match for a subject, and the page owner may also have chosen it. From pixels
alone you cannot tell a deliberate placeholder from a failure — the difference
lives in the HTML, which your teammate has and you do not.
So do not guess: put it in "observaciones", never in "issues", and never set
broken=true for it.
</observe-only>
<output>Strict JSON per the schema: broken=true ONLY if at least one flag-only problem is clearly present; issues lists each problem in one short sentence, in the SAME LANGUAGE as the user request above, naming WHERE on the page it is (e.g. "en el hero", "en la sección de precios"). "observaciones" lists, in the same language, anything you SEE but cannot call a defect from the screenshot alone (see observe-only); it never makes broken=true and may be present while broken=false. broken=false with issues=[] when the page looks coherent. When in doubt, broken=false.</output>`;
}

// ─── EL DERECHO A PREGUNTAR ──────────────────────────────────────────────────
//
// 🔴 La verificación de cierre de turno es *push*: le llega al Agente quiera o
// no, y él no puede comprobarla —es ciego por política de modelos, «al
// razonador nunca se le manda una imagen»— ni discutirla, porque el mensaje de
// arreglo le ordena «Arregla ESOS, no otros».
//
// MEDIDO el 2026-09-02: con un veredicto de contraste que el medidor se había
// inventado, releyó el documento CINCO veces y teorizó seis sobre el velo del
// hero —Tailwind CDN, apilamiento, la foto que no carga— antes de rendirse y
// pintar media portada de sólido. No es un modelo tonto: es un modelo con una
// pregunta que no puede hacer.
//
// Esto es *pull*, la forma que usan v0/agent-browser, Claude Code y OpenCode:
// el que actúa PIDE, y lo que recibe son DATOS, no una sentencia.

export type TipoDeMirada = "medir" | "describir";

export interface MiradaParams {
  /** El documento tal y como se guardó. */
  readonly html: string;
  /** Qué fuente contesta. EXPLÍCITO, nunca inferido de la pregunta: deducirlo
   *  del texto haría que el coste del turno dependiera de cómo el modelo
   *  redactó la frase — un crédito gastado por una palabra. */
  readonly tipo: TipoDeMirada;
  readonly pregunta: string;
  /** Acota dónde mirar («el hero», «las tarjetas»). Opcional. */
  readonly zona?: string;
}

/** El proveedor de la rama `describir`: mismo papel con visión que los ojos,
 *  pero SIN modo JSON — aquí se pide prosa corta, no un veredicto. */
function describeProvider(): VerifyProviderLike {
  return fireworksStreamProvider({
    requestId: "agent-mirar",
    operation: "agent_visual_verify",
    maxOutputTokens: 512,
  });
}

/**
 * Contesta UNA pregunta sobre la página. Nunca lanza: cualquier fallo devuelve
 * `null` y el llamador lo dice — preguntar no puede tumbar un turno.
 *
 * ⚠️ El bucle de streaming de abajo está duplicado respecto al de `runVerify` a
 * propósito. Aquél va entrelazado con sus propios retornos de veredicto de
 * reserva y con la contabilidad de tokens; un ayudante común tendría que
 * llevarse las dos cosas como parámetros y dejaría de ser más simple que las
 * doce líneas que ahorra, sobre la función más delicada del archivo.
 */
export async function observarPagina(
  params: MiradaParams,
  internals: VerifyInternals = {},
): Promise<{ respuesta: string } | null> {
  const zona = params.zona ? ` (${params.zona})` : "";

  if (params.tipo === "medir") {
    // Chromium. Sin modelo, sin crédito.
    const medir = internals.medir ?? renderVisualQualityViewports;
    const m = await medir(params.html).catch(() => null);
    if (!m) return null;

    const partes: string[] = [];
    const malos = m.unreadableText ?? [];
    if (malos.length === 0) {
      // 🔴 «Ninguno» NO es «todos legibles», y decir lo segundo sería la misma
      // mentira que decía «blanco»: el medidor también se calla cuando NO PUEDE
      // determinar el fondo —hay una foto o un velo debajo—. Que no salga aquí
      // no prueba nada sobre esos textos.
      partes.push(
        "El navegador no encuentra ningún texto ilegible que pueda AFIRMAR. Ojo: donde hay una foto o un velo debajo del texto, la medición no puede determinar el fondo y se calla — que no aparezca aquí NO prueba que se lea bien.",
      );
    } else {
      partes.push(
        `Textos que el navegador mide como ilegibles: ${malos
          .map((c) => {
            const donde = c.texto ? `«${c.texto}»` : c.etiqueta ? `<${c.etiqueta}>` : "un texto";
            const colores = c.color && c.background ? ` (${c.color} sobre ${c.background})` : "";
            return `${donde}${colores} a ${c.contrast.toFixed(2)}:1`;
          })
          .join("; ")}.`,
      );
    }
    partes.push(
      m.mobileOverflow === true
        ? `En el teléfono (390px) algo se sale de la pantalla${
            m.overflowCulprit ? `: \`${m.overflowCulprit}\`` : ""
          }${m.overflowCulpritRight ? `, llega a ${m.overflowCulpritRight}px` : ""}.${
            // QUÉ CLASE DE DESBORDE, porque el arreglo es otro. Sin esto el
            // modelo trata una palabra que no se parte como si fuera una caja
            // ancha y toca anchos, que ahí no mueven nada.
            m.overflowCulpritKind === "tinta"
              ? " Es TEXTO que no se puede partir (una dirección, una URL): se arregla con `overflow-wrap`, no con anchos."
              : ""
          }`
        : "En el teléfono (390px) no se sale nada.",
    );
    const gritos = m.runtimeErrors ?? [];
    if (gritos.length > 0) {
      partes.push(`La página lanzó: ${gritos.slice(0, 3).join("; ")}.`);
    }
    return { respuesta: `Medido en el navegador${zona}. ${partes.join(" ")}` };
  }

  // describir — el papel con visión, y SÓLO para describir.
  const render = internals.render ?? renderHtmlToInlineImage;
  const image = await render(params.html).catch(() => null);
  if (!image) return null;

  const provider = internals.provider ?? describeProvider();
  const prompt = `<role>You are describing a screenshot for a teammate who is editing this page's HTML and cannot see it. They hold the intent; you hold the pixels.</role>
<question>${params.pregunta}</question>${params.zona ? `${SALTO}<area>${params.zona}</area>` : ""}
<rules>
Describe ONLY what you can see: shapes, colours, and whether an area shows a photo, a flat colour, a gradient, text, or nothing at all.
NEVER say whether something is broken, wrong, missing, or a defect. You cannot know that from pixels and your teammate can: a flat box is very often a deliberate placeholder.
Answer in the SAME LANGUAGE as the question, in at most three sentences.
</rules>`;

  try {
    let raw = "";
    for await (const ev of provider.stream(
      { messages: [{ role: "user", content: prompt }], images: [image], maxOutputTokens: 512 },
      {},
    )) {
      if (ev.type === "text_delta") raw += ev.text;
      else if (ev.type === "done" && ev.stopReason.kind === "error") return null;
    }
    const t = raw.trim();
    return t ? { respuesta: t } : null;
  } catch {
    // Fail-open, como todo en este archivo.
    return null;
  }
}

/** Parse + valida el veredicto. null → fallback (lo mapea el caller). */
export function parseVisualVerdict(raw: string): VisualVerdict | null {
  const text = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
  if (!text) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.broken !== "boolean") return null;

  const issues = (Array.isArray(o.issues) ? o.issues : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, MAX_ISSUES);

  // Lo que el crítico VIO sin poder calificarlo. Mismo saneado que `issues` —
  // cadenas no vacías, mismo tope— porque llega por el mismo cable y del mismo
  // sitio: un modelo, no una fuente de confianza.
  const observaciones = (Array.isArray(o.observaciones) ? o.observaciones : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, MAX_ISSUES);

  // broken sin un solo problema nombrado no es accionable — no dispara nada.
  // 🔴 Y las observaciones NO cuentan para eso: son justo lo que no es un
  // defecto, así que un veredicto con observaciones y sin issues es `broken:
  // false` — informa, no gasta.
  return { broken: o.broken && issues.length > 0, issues, observaciones, fallback: false };
}

function logFallback(reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[agent-verify] fallback (${reason}) — sin verificación este turno`);
}
