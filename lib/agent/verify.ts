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
import { programaSuiteJs } from "@/lib/agent/prueba-js";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
// La cifra del umbral viaja desde donde se MIDE. Ver su comentario: el aviso de
// aquí abajo llegó a afirmar un mínimo distinto del que se comprobaba.
import { UMBRAL_CONTRASTE } from "@/lib/ai/contraste";
import { injectModelRuntime } from "@/lib/ai-stream/model-runtime";
import { documentoMedible, type ContextoDeVista } from "@/lib/lienzo/documento";
// Las frases de «lo que la medición no pudo comprobar», en un solo sitio. Import
// de valor y sin coste: `aviso-medido` no importa nada — ni la pasarela, ni las
// herramientas, ni Chromium.
import { defectosConDireccion, limitesDeLaMedicion, TEXTO_DE_LA_PAGINA_ES_DATO } from "@/lib/agent/aviso-medido";
import type { LlamadaADatos } from "@/lib/page-data/sustituto";
import {
  notaSpec,
  leerFallos,
  leerSinCorrer,
  leerVacuas,
  PRELUDIO_CENSO_CLIC,
  type FalloSpec,
  type PasoSpec,
} from "@/lib/agent/behavior-spec";
import {
  migrarSuite,
  pasosAJs,
  repartirFallos,
  type PruebaGuardada,
  type Regresion,
} from "@/lib/agent/pruebas-de-la-pagina";
import { streamWithRetry } from "@/lib/agent/retry";
import {
  fireworksStreamProvider,
  type FlexibleStreamRequest,
} from "@/lib/ai/fireworks-as-stream-provider";

export interface VisualVerdict {
  /** true = la edición dejó rotura visual objetiva. */
  broken: boolean;
  /**
   * Problemas concretos. Lo lee el USUARIO: el bucle lo emite verbatim como
   * `critique` y lo guarda en el texto del turno.
   *
   * 🔴 LA LISTA MEZCLA DOS AUTORES, Y ESO ES UNA DEUDA CONOCIDA, NO UN DESCUIDO.
   * Lo que escribe el crítico con visión viene EN EL IDIOMA DEL USUARIO (se lo
   * pide su prompt, literalmente «in the SAME LANGUAGE as the user request»).
   * Lo que antepone este fichero —el JavaScript que grita, el desborde, el
   * contraste— es español fijo. Un usuario en japonés recibe su lista con
   * renglones en español intercalados.
   *
   * DECIDIDO EL 2026-09-04, y la respuesta NO es traducirlas aquí:
   *
   *   · Ninguna ruta de `app/api/` usa `getTranslations`. El i18n de este repo
   *     (next-intl, `messages/<locale>/`) vive en el cliente; montar traducción
   *     de servidor por tres cadenas sería estrenar un mecanismo entero aquí.
   *   · La regla de la casa ya dice qué hacer y es otra: **el servidor manda
   *     DATOS y el cliente compone la frase en el idioma del usuario**. Está
   *     escrita a pocas líneas de distancia, en el aviso de ventana de
   *     `app/api/agent/route.ts` («Números, no prosa»), y es
   *     [[error-del-servidor-como-dato-no-prosa]]. Traducir la prosa en el
   *     servidor sería resolver el síntoma yendo justo en contra de la regla.
   *
   * LO QUE FALTA, y por qué no entra en este cambio: la forma correcta es que
   * estos tres hechos viajen como `{code, campos}` —`{code:"overflow",
   * selector, ancho, exceso}`— y que el cliente los redacte. Eso obliga a que
   * `issues` deje de ser `string[]`, y esa lista la consumen además el mapeo a
   * `critique`, la tarjeta del turno y el historial que se le manda al modelo:
   * es un cambio de contrato de cuatro superficies, no una reescritura de
   * texto. Aquí se arregla la VOZ (dejaron de ser órdenes para un modelo); el
   * idioma queda pendiente y anotado.
   */
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
  /**
   * LO QUE LA MEDICIÓN NO PUDO COMPROBAR — y que NO se le emite al usuario.
   *
   * 🔴 Separado de `observaciones` a propósito, y la diferencia no es de
   * matiz: `observaciones` lo escribe el modelo con visión EN EL IDIOMA DEL
   * USUARIO, y por eso `loop.ts` lo emite verbatim a la conversación. Esto lo
   * escribe el SERVIDOR, en castellano fijo. Estuvieron mezclados un día y el
   * resultado fue que un creador que pidió cambiar un titular leía «prompt
   * devuelve null, confirm false» — en español, fuera cual fuera su idioma.
   *
   * Al modelo estos hechos le llegan por `redactarLimites`, en el canal de
   * `<limites-de-la-medida>` que sólo lee él; al usuario, por los avisos del
   * lienzo, traducidos a los diez idiomas. Aquí quedan para el registro y para
   * que las pruebas puedan fijarlos: un hecho que el medidor devuelve no se
   * tira en silencio.
   */
  limites: string[];
  /**
   * ¿CORRIÓ LA MEDIDA DETERMINISTA? — o sea: ¿se midieron de verdad el desborde
   * en móvil y el contraste?
   *
   * 🔴 EXISTE PARA NO AFIRMAR UN EJE QUE NADIE MIRÓ, que es la regla que este
   * repo ya escribió en `medicionLimpia` («un campo ausente no es un cero») y
   * que aquí faltaba. Los ojos son DOS renders: el de la foto y el del medidor.
   * Si el segundo se cae, `hechos.contrastes` queda vacío y `desbordaMovil` en
   * false por AUSENCIA, no por medida — y el veredicto sale `broken:false`
   * exactamente igual que uno medido y limpio. Sin este campo, la frase de
   * cobertura de la tarjeta diría «sin desbordes ni textos ilegibles» de una
   * página que nadie midió.
   *
   * Lo que NO depende de esto, y por eso no entra: los errores de JavaScript
   * (los recoge el render de la foto, que si falla ya da `fallback`) y la
   * mirada del modelo a la captura. Ésos están siempre que el veredicto no sea
   * fallback.
   */
  conMedida: boolean;
  /**
   * LAS PROMESAS GUARDADAS QUE HAN DEJADO DE CUMPLIRSE.
   *
   * No es lo mismo que `fallosSpec` y por eso viaja aparte: aquélla es la
   * promesa que el modelo acaba de declarar —el canal que esta casa degradó a
   * observación el 04/09 tras medir que acertaba 0 de 3—, y ésta es una que YA
   * se cumplió sobre una página que funcionaba. Cambia el testigo.
   *
   * Ausente/vacío ⇒ ninguna guardada falló, o el turno no llevaba ninguna.
   * Ver `lib/agent/pruebas-de-la-pagina.ts`.
   */
  regresiones?: readonly Regresion[];
  /**
   * POR QUÉ NO SE COMPROBÓ NINGUNA — cuando no se comprobó.
   *
   * 🔴 «No se miró» y «se miró y están limpias» NO son el mismo dato, y hasta
   * hoy los dos salían como `regresiones` ausente. La conflación se evita con
   * DOS canales, nunca uno: el resultado por un lado y el «no se pudo» por
   * otro, con su motivo dentro en vez de fuera.
   *
   * Lo estrena la ruta JS: cuando corre `programaJs` NO se ejecuta la suite
   * guardada —el programa es lo único que corre—, así que un turno que promete
   * en JavaScript pasa sin que nadie mire si se llevó por delante el carrito de
   * hace seis turnos. Eso ahora se DICE en vez de parecer un cero.
   *
   * Ausente ⇒ sí se comprobaron (y `regresiones` dice el resultado).
   */
  regresionesSinComprobar?: string;
  /** LOS IDS de las guardadas que NO corrieron —formato viejo sin convertir, o
   *  sin tiempo dentro del techo—. Quien cuenta regresiones tiene que sacarlas
   *  de «comprobadas»: si no, una rota que no se miró saldría «arreglada». */
  guardadasSinCorrer?: readonly string[];
  /** Los fallos de la promesa que el modelo declaró ESTE turno. Salen crudos
   *  —además de redactados en `observaciones`— porque de ellos depende que la
   *  promesa entre o no en la suite: sólo entra la que NACE EN VERDE, y eso no
   *  se puede leer de una frase en prosa. Vacío/ausente ⇒ se cumplió. */
  fallosDelTurno?: readonly FalloSpec[];
  /** Expectativas que ya se cumplían antes de actuar. No acusan: ver
   *  `leerVacuas`. Las lee la batería, no el turno del usuario. */
  vacuasDelTurno?: readonly FalloSpec[];
  /** Las promesas guardadas que el navegador dice que ya no señalan a nada:
   *  se RETIRAN, no acusan. Son los ids de `PruebaGuardada`. */
  retirarPruebas?: readonly string[];
  /** true cuando esto es el fallback (render/API/parse/timeout falló) — el
   *  caller lo trata como "no hay nada que arreglar". */
  fallback: boolean;
  /**
   * CUÁNTAS PÁGINAS SE MIRARON DE VERDAD — las que llegaron a tener captura.
   *
   * 🔴 No es «cuántas se pidieron». Una página cuyo render se cae no se mira, y
   * contarla haría que la tarjeta dijera «2 de 2» habiendo visto una: la
   * mentira exacta que el recuento existe para impedir. Claude Code lista
   * SIEMPRE cada captura, incluida la que no salió y con su motivo; aquí el
   * equivalente es que este número baje y que el motivo entre en `limites`.
   *
   * Ausente ⇒ implementaciones que no lo mandan (el arnés de evals); el bucle
   * cae entonces en lo que pidió.
   */
  paginasMiradas?: number;
  /** Tokens de la llamada de visión — para contabilidad (el eval runner los
   *  suma a su costo real). Ausente en fallbacks que nunca llamaron al modelo. */
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number };
}

export interface VerifyParams {
  /** El documento YA editado (el último updatedHtml del turno). */
  html: string;
  /** QUÉ página es ésta (null = la Home). Sólo se usa para ROTULAR: cuando el
   *  turno tocó varias, cada captura va con su dirección y cada issue con ella
   *  delante. Ausente ⇒ se rotula como "/", que es lo que era antes de que
   *  hubiera más de una. */
  page?: string | null;
  /** EL GEMELO ETIQUETADO de `html` — el mismo documento con sus
   *  `data-op-id`. Es lo que se MIDE, para que cada sonda lea la dirección del
   *  nodo del que habla en vez de describirlo.
   *
   *  Medido el 2026-09-05 sobre 49 páginas: las medidas salen idénticas con y
   *  sin op-ids (49/49), y las capturas también —las 3 que diferían difieren
   *  igual consigo mismas, el render no es determinista—. El atributo es
   *  inerte: no hay una sola regla CSS del repo que lo seleccione.
   *
   *  Ausente ⇒ se mide `html` y las sondas salen sin dirección, byte a byte
   *  como antes de que esto existiera. */
  taggedHtml?: string;
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
  /**
   * LAS PROMESAS QUE ESTA PÁGINA YA CUMPLIÓ, para volver a comprobarlas.
   *
   * Sin esto los ojos sólo miran la promesa de ESTE turno, y una edición que se
   * lleva por delante el carrito construido hace seis turnos pasa limpia: la
   * foto sale igual, la consola no grita y nadie la comprueba. Ausente ⇒ se
   * comporta exactamente como antes de que la suite existiera.
   */
  guardadas?: readonly PruebaGuardada[] | null;
  /** LA PRUEBA EN JAVASCRIPT del turno — la ranura reservada, con la forma de
   *  `preflight.js`. Cuando viene, es ELLA la que corre.
   *
   *  ⚠️ Las promesas GUARDADAS no viajan con ella: se reparten por índice de
   *  paso (`repartirFallos`) y un programa JS no los tiene, así que mezclarlas
   *  atribuiría un fallo del turno a una promesa vieja. Con `pruebaJs` esta
   *  vuelta NO comprueba regresiones — y eso se dice, no se finge. */
  pruebaJs?: string | null;
  /**
   * EL PROYECTO AL QUE PERTENECE LA PÁGINA, para medir el MISMO documento que
   * el usuario tiene delante en el lienzo.
   *
   * D5 de la spec 2026-09-15: el lienzo sirve `documentoDeVista(html)` —logo,
   * asistente y chat, sello— y hasta hoy los ojos medían el documento pelado.
   * Eran dos páginas distintas: una con la burbuja del chat tapando la esquina
   * inferior y otra sin ella, y la que el visitante recibe es la primera.
   *
   * Ausente ⇒ se mide el documento tal cual, byte a byte como antes de que esto
   * existiera.
   */
  vista?: ContextoDeVista | null;
  /**
   * SÓLO LOS HECHOS: rendir, correr la prueba declarada y medir, SIN la llamada
   * de visión. Ausente ⇒ se comporta exactamente como siempre.
   *
   * 🔴 POR QUÉ (2026-09-21). La prueba declarada se EJECUTA en el render, que
   * es gratis —Chromium, cero créditos—, pero vivía pegada al crítico de pago:
   * el arnés de evals sólo armaba `verifyTurn` con `--visual`, así que una
   * corrida normal **no ejecutaba ni una sola prueba declarada**. Medido ese
   * día: de las 13 reglas de `RUNTIME_MANDA_PRUEBA`, ninguna tenía un caso que
   * pudiera cazarla, y ésta era una de las cuatro causas.
   *
   * No inventa una salida nueva: devuelve `conHechos(fallbackVerdict(), hechos)`,
   * que es LA MISMA forma que ya sale por las cuatro salidas tempranas (sin
   * captura, turno abortado, proveedor caído, JSON ilegible). Todo el que
   * consume un veredicto ya sabe tratarla, y `fallback: true` + `conMedida`
   * dicen con precisión lo que pasó: nadie opinó, pero sí se midió.
   */
  sinVision?: boolean;
  /**
   * LAS OTRAS PÁGINAS QUE EL TURNO TOCÓ — la última versión de cada una.
   *
   * 🔴 MEDIDO el 2026-09-20 en producción: un turno creó `/viajes` y después
   * retocó la Home, y como los ojos miraban sólo la última mutación, el
   * ENTREGABLE no se miró nunca. La tarjeta decía «sin fallos medidos».
   *
   * Cada una se renderiza y se MIDE igual que la principal —hechos propios,
   * `HechosDelNavegador` por página— y su captura viaja en la MISMA llamada
   * con visión, rotulada. La forma es la del informe de `preview` de Claude Code: un
   * `tool_result` con N imágenes dentro, nunca N llamadas; y los `issues`
   * planos, con el objetivo como PREFIJO del propio texto.
   * Por eso aquí no hay hechos multi-página: hay hechos por página y una lista
   * de issues plana, con `/slug: ` delante — que además no es prosa y por
   * tanto no rompe los otros nueve idiomas.
   *
   * Ausente/vacío ⇒ todo se comporta byte a byte como antes.
   */
  otrasPaginas?: readonly {
    html: string;
    page: string | null;
    taggedHtml?: string;
    runtime?: string | null;
  }[];
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
  // ⚰️ Aquí vivía `resolverOpId`: la RUTA del culpable se traducía fuera, sobre
  // el documento etiquetado de la sesión, y había que CORROBORAR porque una
  // ruta posicional resuelta sobre un documento divergido no falla —acierta a
  // OTRO nodo—. Retirado el 2026-09-05: se mide el gemelo, así que la sonda lee
  // el `data-op-id` del nodo que tiene delante y no hay dos documentos que
  // reconciliar. Con ella se fue `culpable-op-id.ts`.
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
      /** La direccion, leida del nodo por la propia sonda. */
      opId?: string;
    }[];
    mobileOverflow?: boolean;
    overflowCulprit?: string;
    overflowCulpritRight?: number;
    /** "caja" (mide de más) o "tinta" (el texto no se puede partir). El arreglo
     *  es distinto, y decirlo evita que el modelo toque anchos ante una palabra
     *  que no se parte. Ver `VisualQualityViewports`. */
    overflowCulpritKind?: "caja" | "tinta";
    /** LA DIRECCION del culpable, leida del nodo. Sustituye a la traduccion
     *  ruta->op-id que se hacia fuera. */
    overflowCulpritOpId?: string;
    /** Lo que la página gritó EN ESE render, y las URLs que el guardia cortó.
     *  Estos dos campos faltaban aquí, y esa ausencia era la firma del defecto:
     *  el contrato de la inyección se había escrito con los cuatro campos que
     *  `runVerify` leía, así que el día que el medidor real empezó a devolver
     *  hechos nuevos no hubo ni un error de tipos que avisara de que se estaban
     *  tirando. */
    runtimeErrors?: readonly string[];
    blockedSubresources?: readonly string[];
    /** Los diálogos que la página abrió y el medidor canceló. Este tipo se
     *  escribió una vez con los campos que `runVerify` leía entonces, y el día
     *  que el medidor devolvió hechos nuevos no hubo ni un error de tipos que
     *  avisara de que se estaban tirando. Que no vuelva a pasar. */
    dialogosNativos?: readonly string[];
    llamadasSoloPublicada?: readonly string[];
    /** Lo que contestó el sustituto de `/api/d` (2026-09-18). Mismo aviso que
     *  arriba: sin esta línea, los rechazos del almacén se tiraban aquí. */
    llamadasADatos?: readonly LlamadaADatos[];
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

// ⚰️ AQUÍ VIVÍA `VERDICT_SCHEMA`, y se pasaba como `responseSchema` junto a
// `responseMimeType: "application/json"`.
//
// Los dos campos son de la era Gemini: `lib/ai-gateway.ts` los documenta como
// «passed verbatim as generationConfig.responseSchema». Desde que todo corre
// por Fireworks, el puente (`lib/ai/fireworks-as-stream-provider.ts`) NO los
// lee — sólo reenvía `jsonObject` — y su cabecera dice por qué, medido: «el
// modo estricto de Fireworks rechaza esquemas válidos». O sea que el esquema
// no llegaba a ninguna parte.
//
// 🔴 NO ERA INOFENSIVO, y es la lección de `lib/publish/localize.ts`: allí el
// mismo esquema dejó de viajar, nadie puso la forma en el prompt, el modelo
// devolvía `{"type": "object"}` y la función NO tradujo nunca una página en
// producción. Aquí el daño era menor pero de la misma familia: el prompt decía
// «Strict JSON per the schema» —apuntando a esto, que no llegaba— y el esquema
// ni siquiera declaraba `observaciones`, que el prompt pide y el parser lee.
//
// EL CONTRATO DE SALIDA ES AHORA UNO SOLO Y ESTÁ DONDE SE LEE: lo declara el
// prompt (`buildVerifyPrompt`, bloque <output>) y lo hace cumplir
// `parseVisualVerdict`, que ya toleraba vallas de markdown y saneaba las tres
// claves. `jsonObject: true` sigue puesto donde sí se lee (la construcción del
// proveedor), así que el modo JSON no se pierde.

function fallbackVerdict(): VisualVerdict {
  return { broken: false, issues: [], observaciones: [], limites: [], conMedida: false, fallback: true };
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
  /** Los diálogos nativos que la página abrió y el medidor descartó. No son
   *  defecto: son la rama que NO medimos. */
  dialogos: string[];
  /** Rutas que sólo responden publicadas y que la página llamó en la medida. */
  soloPublicada: string[];
  /** Lo que la página mandó a su almacén y le contestó el sustituto de /api/d
   *  con las reglas del servidor real. Los rechazos son HECHOS de la página. */
  datos: LlamadaADatos[];
  fallosSpec: FalloSpec[];
  /** Las expectativas que YA se cumplían antes de actuar — ver `leerVacuas`.
   *  NO son fallos y no acusan a nadie: se miden para poder decidir con el
   *  número delante si algún día deben suspender en la batería. */
  vacuas: FalloSpec[];
  /** Las promesas GUARDADAS que dejaron de cumplirse. Aparte de `fallosSpec`
   *  a propósito: otro testigo, otro peso. */
  regresiones: Regresion[];
  /** Por qué no se comprobó ninguna, si no se comprobaron. Ver
   *  `VisualVerdict.regresionesSinComprobar`. */
  regresionesSinComprobar: string | null;
  /** Ver `VisualVerdict.guardadasSinCorrer`. */
  guardadasSinCorrer: string[];
  /** Ids de promesas guardadas que el navegador dice que ya no señalan a nada:
   *  se retiran, no acusan. */
  retirarPruebas: string[];
  /** ¿Contestó el medidor? Ver `VisualVerdict.conMedida`: sin esto, «no
   *  desborda» y «no desborda porque nadie miró» son el mismo `false`. */
  conMedida: boolean;
  desbordaMovil: boolean;
  culpable: string;
  culpableAncho: number;
  /** El `data-op-id` del culpable, ya corroborado. Vacio = no se pudo. */
  culpableOpId: string;
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
    /** El `data-op-id` del nodo, leido por la sonda del propio elemento que
     *  midio. Vacio si se midio un documento sin etiquetar. */
    readonly opId?: string;
  }[];
}

function hechosVacios(): HechosDelNavegador {
  return {
    gritos: [],
    bloqueadas: [],
    dialogos: [],
    soloPublicada: [],
    datos: [],
    fallosSpec: [],
    vacuas: [],
    regresiones: [],
    regresionesSinComprobar: null,
    guardadasSinCorrer: [],
    retirarPruebas: [],
    // FALSE por defecto: mientras nadie mida, no se ha medido nada.
    conMedida: false,
    desbordaMovil: false,
    culpable: "",
    culpableAncho: 0,
    culpableOpId: "",
    contrastes: [],
  };
}

/**
 * LA DIRECCIÓN DE UNA PÁGINA, para rotular su captura y prefijar sus issues.
 *
 * Un path (`/`, `/viajes`) y NO un nombre traducido, a propósito: un prefijo
 * que no es prosa vale igual en los diez idiomas, y es exactamente lo que hace
 * Claude Code cuando rotula por anchura. Poner «Inicio» aquí sería devolver el problema que
 * `issues` ya arrastra — español fijo delante de un texto localizado.
 */
/**
 * Tope de una captura que se le enseña al crítico, en caracteres de base64.
 * El número es el mismo tope que usa Claude Code (~1 MB), que además sólo
 * adjunta JPEG. Una imagen que no pasa la puerta no viaja — y se
 * DICE, en `limites`.
 */
const TOPE_BASE64_CAPTURA = 1_400_000;

function etiquetaDePagina(page: string | null): string {
  return page ? `/${page}` : "/";
}

/** Una página que los ojos miraron de verdad: su captura, sus hechos y su
 *  dirección. Una por página — ver `otrasPaginas` en `VerifyParams`. */
interface PaginaMirada {
  etiqueta: string;
  html: string;
  hechos: HechosDelNavegador;
  image: NonNullable<Awaited<ReturnType<NonNullable<VerifyInternals["render"]>>>>;
}

/**
 * Quien mira. Lo dice la politica (el papel con vision) —al razonador nunca se
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
  // El papel con vision, por Fireworks. Elige por `operation`.
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
/**
 * Cuántos textos entran en el mapa. Era 30 y se subió a 80 el 2026-09-20: con
 * 30, la página medida (148 textos) sólo cruzaba su quinta parte de arriba.
 * No es gratis —son ~1,2k tokens más en la llamada con visión— y es lo que
 * cuesta que el pie y el contacto existan para el que compara.
 */
const TOPE_MAPA = 80;

export function contentMap(html: string): string {
  const bodyAt = html.search(/<body[^>]*>/i);
  const body = bodyAt === -1 ? html : html.slice(bodyAt);
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const todos: string[] = [];
  const re = /<(h1|h2|h3|p|li|a|button|figcaption|blockquote)\b[^>]*>([^<]{4,})</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const text = m[2].replace(/\s+/g, " ").trim();
    if (text.length >= 4) todos.push(`<${m[1].toLowerCase()}> ${text.slice(0, 90)}`);
  }
  if (todos.length === 0) return "(no text content found)";
  if (todos.length <= TOPE_MAPA) return todos.join(SALTO);
  // MUESTREO DE ARRIBA ABAJO, no los primeros N.
  //
  // 🔴 MEDIDO el 2026-09-20 sobre la página real del turno `proj=2d6cad43`:
  // 148 textos, y el mapa cortaba en los 30 PRIMEROS — el 20% de arriba. El
  // teléfono del dueño estaba en la posición 145 y no llegaba, así que el
  // modelo con visión, al que este prompt le pide «contrasta esto con la
  // captura», leyó el número de los PÍXELES y se comió un dígito: avisó de que
  // el WhatsApp estaba mal cuando el documento lo tenía bien.
  //
  // Coger los primeros N no es un tope, es un SESGO: el contacto, el pie y los
  // formularios viven abajo en todas las páginas, así que esa mitad no se
  // cruzaba nunca — ni para esto ni para el texto invisible, que es el trabajo
  // principal de este mapa.
  //
  // La interpolación va sobre `length - 1` a propósito: así el primero y el
  // ÚLTIMO entran siempre, y el reparto no deja fuera un bloque concreto por
  // redondeo (con un paso fijo, el teléfono de arriba volvía a caerse).
  const muestra: string[] = [];
  let ultimo = -1;
  for (let i = 0; i < TOPE_MAPA; i += 1) {
    const idx = Math.round((i * (todos.length - 1)) / (TOPE_MAPA - 1));
    if (idx === ultimo) continue;
    ultimo = idx;
    const linea = todos[idx];
    if (linea !== undefined) muestra.push(linea);
  }
  // Y SE DICE QUE ES UNA MUESTRA. Es la disciplina del informe de `preview` de
  // Claude Code, que nunca recorta en silencio («… N more not listed»): sin
  // esta línea el modelo puede leer la ausencia como una pista, y la ausencia
  // aquí no dice nada.
  return [
    `(sample of ${muestra.length} of ${todos.length} text runs, spread evenly from the top of the page to the bottom — text missing from this list is NOT evidence of anything)`,
    ...muestra,
  ].join(SALTO);
}

/**
 * PLIEGA LO QUE MIDIÓ EL NAVEGADOR sobre los hechos de UNA página.
 *
 * Sale a su propia función porque desde el 2026-09-20 hay más de una página
 * por turno y cada una trae los suyos — `HechosDelNavegador` sigue siendo de
 * UNA página, que es la forma de Claude Code: hechos por objetivo
 * y una lista de issues plana con el objetivo como prefijo del texto.
 *
 * Dos copias de esto se habrían separado al primer hecho nuevo.
 */
function plegarMedicion(
  hechos: HechosDelNavegador,
  medido: Awaited<ReturnType<NonNullable<VerifyInternals["medir"]>>> | null | undefined,
): void {
  hechos.conMedida = medido !== null && medido !== undefined;
  hechos.contrastes = medido?.unreadableText ?? [];
  hechos.desbordaMovil = medido?.mobileOverflow === true;
  hechos.culpable = medido?.overflowCulprit ?? "";
  hechos.culpableAncho = medido?.overflowCulpritRight ?? 0;
  // La direccion viene LEIDA DEL NODO por la propia sonda. Vacia cuando se
  // midio un documento sin etiquetar: el aviso sale entonces como salia antes,
  // que seguia siendo util aunque no fuera accionable.
  hechos.culpableOpId = medido?.overflowCulpritOpId ?? "";
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
  // Y LOS DIÁLOGOS. Van al mismo sitio que el resto de hechos del navegador —
  // se recogen antes de la llamada de visión y sobreviven a las cuatro salidas
  // tempranas, porque un hecho no depende de que el crítico conteste.
  for (const d of medido?.dialogosNativos ?? []) {
    if (!hechos.dialogos.includes(d)) hechos.dialogos.push(d);
  }
  for (const l of medido?.llamadasSoloPublicada ?? []) {
    if (!hechos.soloPublicada.includes(l)) hechos.soloPublicada.push(l);
  }
  hechos.datos.push(...(medido?.llamadasADatos ?? []));
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
  // 🔴 LO QUE SE MIDE ES EL GEMELO, y lo que se FOTOGRAFÍA sigue siendo el
  // guardado. Son el mismo documento —medido el 2026-09-05 sobre 49 páginas:
  // las medidas salen idénticas 49/49, y las capturas también (las 3 que
  // diferían difieren igual consigo mismas: el render no es determinista)—,
  // pero el gemelo lleva los `data-op-id`, y eso es lo que convierte «un bloque
  // se sale» en «ESTE bloque». El atributo es inerte: ni una regla CSS del repo
  // lo selecciona.
  //
  // Se separa de `paraRenderizar` a propósito: la foto no necesita direcciones,
  // así que el cambio no toca lo que ve el modelo con visión.
  const paraMedir = documentoMedible(
    params.taggedHtml
      ? (codigo ? injectModelRuntime(params.taggedHtml, codigo) : params.taggedHtml)
      : paraRenderizar,
    // El horneado va DESPUÉS del injerto del runtime, como en el lienzo: lo que
    // se hornea es el documento terminado, no un intermedio. Y sólo sobre lo
    // que se MIDE — la foto sigue siendo el documento guardado.
    params.vista ?? null,
  );
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
  const medicion = medir(paraMedir).catch(() => null);

  // Si el modelo declaró qué debe pasar, se comprueba ESO. Si no, se pulsa a
  // ciegas: sigue viendo el script que muere al primer clic, que es lo que
  // había antes de que existiera el guion.
  // LA PROMESA DE ESTE TURNO Y LAS QUE LA PÁGINA YA CUMPLIÓ, en un solo
  // programa y en este orden: primero la del turno, detrás las guardadas. Cada
  // fallo vuelve con el índice de SU programa, y `repartirFallos` lo usa para
  // saber a quién acusar — o a quién no (ver ahí).
  //
  // Las guardadas van aunque este turno no declare nada: una edición que se
  // lleva por delante el carrito de hace seis turnos no trae prueba propia, y
  // es justo la que hay que cazar.
  //
  // 🔴 UN SOLO LENGUAJE PARA CORRER. La promesa del turno va como programa JS:
  // la de `prueba_js` tal cual, o la del DSL convertida con el mismo
  // conversor que migra la suite. Así la ruta JS deja de ser la que se saltaba
  // las regresiones — hasta hoy, con ella sólo corría su programa y las
  // guardadas se quedaban sin mirar.
  const delTurno = params.spec ?? [];
  // Migradas también AQUÍ, no sólo en quien llama: la migración corre donde se
  // lee, y un llamador que pase la forma vieja no puede dejarlas sin correr.
  const guardadas = migrarSuite(params.guardadas ?? []).suite;
  const js = params.pruebaJs?.trim() ? params.pruebaJs.trim() : null;
  const turnoJs = js ?? (delTurno.length > 0 ? pasosAJs(delTurno) : null);
  // Una guardada en formato viejo que no se pudo convertir no tiene quien la
  // corra: no se ejecuta, y se dice (ver `migrarSuite`).
  const corribles = guardadas.filter((g) => g.codigo !== undefined);
  const entradas = [
    ...(turnoJs !== null ? [{ codigo: turnoJs, propia: true }] : []),
    ...corribles.map((g) => ({ codigo: g.codigo as string, propia: false })),
  ];
  const conGuion = codigo && entradas.length > 0;
  const image = await render(paraRenderizar, {
    onErrors: (e) => hechos.gritos.push(...e),
    onBlocked: (u) => hechos.bloqueadas.push(...u),
    ...(conGuion
      ? {
          // `propia: false` en las GUARDADAS: a ellas no se les aplica como
          // fallo de la prueba la precondición del clic muerto, porque en ellas
          // un clic sin manejador es la página que perdió el suyo — la
          // regresión, no el instrumento.
          behaviorProgram: programaSuiteJs(entradas),
          // 🔴 VA SEPARADO PORQUE SE INSTALA EN OTRO MOMENTO: el censo tiene
          // que existir ANTES de que corran los scripts de la página, y el
          // programa corre después. Sin esto el programa es fail-open y la
          // precondición del clic muerto no acusa jamás.
          behaviorPrelude: PRELUDIO_CENSO_CLIC,
          onBehaviorResult: (b) => {
            // Por su propio canal: `leerFallos` ya las filtró.
            hechos.vacuas = leerVacuas(b);
            const reparto = repartirFallos(leerFallos(b), corribles, turnoJs !== null);
            hechos.fallosSpec = reparto.delTurno;
            hechos.regresiones = reparto.regresiones;
            hechos.retirarPruebas = reparto.retirar;
            // LAS QUE NO CORRIERON, con su motivo y por su id. «No se miró» y
            // «se miró y está limpia» no son el mismo dato.
            const desfase = turnoJs !== null ? 1 : 0;
            const sinTiempo = leerSinCorrer(b)
              .map((k) => corribles[k - desfase]?.id)
              .filter((id): id is string => typeof id === "string");
            const sinConvertir = guardadas.filter((g) => g.codigo === undefined).map((g) => g.id);
            hechos.guardadasSinCorrer = [...sinConvertir, ...sinTiempo];
            if (hechos.guardadasSinCorrer.length > 0) {
              const motivos = [
                ...(sinConvertir.length ? [`${sinConvertir.length} en el formato viejo que no se pudo convertir`] : []),
                ...(sinTiempo.length ? [`${sinTiempo.length} sin tiempo dentro del techo`] : []),
              ];
              hechos.regresionesSinComprobar = `${hechos.guardadasSinCorrer.length} promesa(s) guardada(s) de esta página no se ejecutaron: ${motivos.join(", ")}`;
            }
          },
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
  // ¿CONTESTÓ EL MEDIDOR? El renderizador SIEMPRE pone `mobileOverflow` y
  // `unreadableText` cuando devuelve algo (los opcionales son los otros:
  // `runtimeErrors`, `deadAnchors`… ausentes-no-vacíos a propósito). Así que un
  // objeto no nulo ya significa que esos dos ejes se midieron de verdad, y las
  // dos líneas de abajo dejan de ser ambiguas: `false` por medida, no por
  // ausencia. Ver `VisualVerdict.conMedida`.
  plegarMedicion(hechos, medido);
  // ─── LAS OTRAS PÁGINAS QUE TOCÓ EL TURNO ──────────────────────────────────
  //
  // Cada una con sus PROPIOS hechos: `HechosDelNavegador` es de UNA página y
  // así se queda. Es la forma de Claude Code —hechos por objetivo,
  // `issues` planos con el objetivo como prefijo del texto— y por eso esto no
  // obliga a reescribir la estructura de hechos ni `conHechos`.
  //
  // SIN programa de comportamiento: la promesa declarada este turno y las
  // guardadas son de la página principal, y `repartirFallos` las reparte por
  // ahí. Lo que estas páginas aportan son los HECHOS del navegador — el
  // JavaScript que grita, el desborde a 390 px, el contraste leído del píxel.
  //
  // Fail-open POR PÁGINA: la que no se pueda mirar no rompe el turno ni acusa a
  // nadie; simplemente no aporta. Lo que el usuario ve de eso es el recuento de
  // la tarjeta, que ya dice cuántas se miraron de cuántas.
  const extras: PaginaMirada[] = [];
  /** Las que se pidieron y NO se pudieron mirar, con su motivo. Van a
   *  `limites` — el canal que lee el modelo, no el usuario. */
  const noMiradas: string[] = [];
  for (const otra of params.otrasPaginas ?? []) {
    if (signal.aborted) break;
    const suCodigo = otra.runtime?.trim();
    const suRender = suCodigo ? injectModelRuntime(otra.html, suCodigo) : otra.html;
    const suMedida = documentoMedible(
      otra.taggedHtml
        ? suCodigo
          ? injectModelRuntime(otra.taggedHtml, suCodigo)
          : otra.taggedHtml
        : suRender,
      params.vista ?? null,
    );
    const susHechos = hechosVacios();
    const suMedicion = medir(suMedida).catch(() => null);
    const suImagen = await render(suRender, {
      onErrors: (e) => susHechos.gritos.push(...e),
      onBlocked: (u) => susHechos.bloqueadas.push(...u),
    }).catch(() => null);
    plegarMedicion(susHechos, await suMedicion);
    const etiqueta = etiquetaDePagina(otra.page);
    // 🔴 LA QUE NO SALE NO SE SALTA EN SILENCIO. Claude Code
    // lista SIEMPRE cada captura, y la que falló dice por qué. Saltarla y
    // seguir contándola es lo que haría que la tarjeta dijera «2 de 2» habiendo
    // mirado una — la mentira exacta que este recuento existe para impedir.
    //
    // La puerta de tamaño también es como la suya: una captura enorme no se
    // manda, y no mandarla sin decirlo sería el mismo silencio con otro disfraz.
    if (!suImagen || suImagen.dataBase64.length > TOPE_BASE64_CAPTURA) {
      noMiradas.push(
        suImagen
          ? `${etiqueta}: la captura pesaba demasiado y no se le pudo enseñar al crítico`
          : `${etiqueta}: no se pudo capturar, así que esa página no se ha mirado`,
      );
      continue;
    }
    extras.push({ etiqueta, html: otra.html, hechos: susHechos, image: suImagen });
  }
  if (signal.aborted) return conHechos(fallbackVerdict(), hechos);

  // LA PUERTA DE «SÓLO HECHOS». Va AQUÍ y no antes: todo lo de arriba —el
  // render, la prueba declarada, las regresiones de la suite, el desborde, el
  // contraste del píxel— es gratis y es justo lo que se viene a buscar. Lo
  // único que se salta es la llamada que cuesta. Ver `sinVision`.
  if (params.sinVision) return conHechos(fallbackVerdict(), hechos);

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
              content: buildVerifyPrompt(
                params.userPrompt,
                params.html,
                hechos.bloqueadas,
                extras.length === 0
                  ? []
                  : [
                      { etiqueta: etiquetaDePagina(params.page ?? null), html: params.html },
                      ...extras,
                    ],
              ),
            },
          ],
          // UNA llamada con N capturas dentro, no N llamadas. Es la forma del
          // informe de `preview` de Claude Code, que arma un solo
          // `tool_result` con el texto y todas las imágenes rotuladas. El
          // transporte ya aceptaba una lista; lo que faltaba era llenarla.
          images: [image, ...extras.map((e) => e.image)],
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
  // Lo que vino del MODELO, antes de que `conHechos` le anteponga los hechos
  // del navegador: es lo único que distingue sus frases (ya rotuladas por él)
  // de las que compone el servidor. Ver `conOtrasPaginas`.
  const delModelo = {
    issues: [...verdict.issues],
    observaciones: [...verdict.observaciones],
  };
  conHechos(verdict, hechos);
  conOtrasPaginas(verdict, etiquetaDePagina(params.page ?? null), extras, delModelo);
  // LO QUE DE VERDAD SE MIRÓ: la principal más las extra que llegaron a tener
  // captura. Las que se cayeron ya dejaron su motivo en `limites`.
  verdict.paginasMiradas = 1 + extras.length;
  verdict.limites.push(...noMiradas);
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

/**
 * ¿Este grito es un fallo de TRANSPORTE de un recurso de terceros, y no el
 * código de la página?
 *
 * 🔴 MEDIDO el 2026-09-15 sobre el corpus de 55 páginas. De las seis que los
 * ojos acusaron, DOS lo fueron por esto — `sorteo.html` y `terror.html`, las dos
 * con el mismo grito de un `<gmp-place-details-compact>` de Google Maps que no
 * alcanza la red en nuestro renderizador headless:
 *
 *     Rpc failed due to xhr error. uri: https://maps.googleapis.com/...
 *
 * Al modelo le llegaba como «El JavaScript de la página falla». Es FALSO: en el
 * navegador de un visitante, con la clave puesta y salida a internet, ese mapa
 * carga. Lo que falló es NUESTRO entorno de medición, no su página.
 *
 * Y la consecuencia no es cosmética. Es la misma avería del 2026-08-27 que ya
 * costó la foto de un dueño: se le dice al Agente que algo suyo está roto, y lo
 * «arregla» quitándolo. Acusar en falso es peor que callar, porque el Agente
 * actúa sobre la acusación.
 *
 * `esDeAlgoQueBloqueamos` no lo cubría y no podía: mira lo que bloqueamos
 * NOSOTROS. Una petición PERMITIDA que falla por la red es otro caso.
 *
 * 🔴 CONSERVADOR A PROPÓSITO, y ésta es la línea que no se puede cruzar. Sólo
 * se calla lo que nombra un fallo de TRANSPORTE. Una excepción del código
 * —`TypeError`, `ReferenceError`, `SyntaxError`, un identificador repetido— se
 * sigue contando aunque mencione la red, porque ésa sí es la página. Un filtro
 * que se traga todo es no tener ojos, y este repositorio ya sabe lo que cuesta:
 * el comprobador que acertó 0 de 3 se retiró por acusar de más, no por callar.
 */
export function esRuidoDeRed(grito: string): boolean {
  // Primero lo que NUNCA se calla: si el grito nombra una excepción de
  // JavaScript, es del código. Va delante para que ningún patrón de abajo
  // pueda tragárselo — «TypeError: Failed to fetch» es de red, pero
  // «TypeError: Cannot read properties of undefined (reading 'fetch')» no.
  if (/\b(Reference|Syntax|Range)Error\b/i.test(grito)) return false;
  if (/has already been declared|is not a function|is not defined|Cannot read propert/i.test(grito)) {
    return false;
  }
  return (
    // Chromium, fallo de transporte: `net::ERR_*` menos el nuestro, que ya lo
    // cubre `esDeAlgoQueBloqueamos`.
    /net::ERR_(?!BLOCKED_BY_CLIENT)[A-Z_]+/.test(grito) ||
    // Un recurso que el servidor rechaza o no sirve.
    /Failed to load resource: the server responded with a status of \d{3}/i.test(grito) ||
    // `fetch` que no sale. La forma de Chromium y la de Firefox.
    /\bFailed to fetch\b/i.test(grito) ||
    /\bNetworkError when attempting to fetch resource\b/i.test(grito) ||
    // La forma en que los componentes de Google Maps cuentan lo suyo, que es el
    // caso MEDIDO y por el que existe esta función.
    /\bnetwork request error\b/i.test(grito) ||
    /\bRpc failed due to xhr error\b/i.test(grito)
  );
}

/**
 * FUNDE LOS HECHOS DE LAS OTRAS PÁGINAS en el veredicto, con su dirección
 * delante.
 *
 * No hay una segunda redacción: se llama al MISMO `conHechos` una vez por
 * página, sobre un veredicto de usar y tirar, y se recogen sus frases tal cual.
 * Dos redactores para el mismo hecho se separan al primer cambio — y aquí eso
 * significaría que un desborde se cuenta distinto según en qué página cayó.
 *
 * Es la forma de Claude Code: hechos POR OBJETIVO, `issues` PLANOS,
 * y el objetivo como PREFIJO del propio texto (`390: light and dark renders are
 * identical`). Por eso `HechosDelNavegador` no necesitó volverse multi-página.
 *
 * La principal se rotula TAMBIÉN: con dos frases sin dirección, el usuario no
 * puede saber cuál habla de qué página, y eso es peor que no decirlo.
 */
function conOtrasPaginas(
  verdict: VisualVerdict,
  principal: string,
  extras: readonly PaginaMirada[],
  /** Lo que escribió el MODELO, tal y como vino — antes de que `conHechos` le
   *  metiera delante los hechos del navegador. */
  delModelo: { issues: readonly string[]; observaciones: readonly string[] },
): VisualVerdict {
  if (extras.length === 0) return verdict;
  const con = (etiqueta: string, lineas: readonly string[]) =>
    lineas.map((l) => `${etiqueta}: ${l}`);
  // 🔴 AL MODELO NO SE LE PREFIJA: YA LO HIZO ÉL.
  //
  // MEDIDO el 2026-09-20 con una llamada real de dos imágenes (~$0.0005): el
  // prompt le pide que empiece cada frase por la dirección de su página, y
  // obedece. Prefijar encima daba «/: /viajes: hay un bloque gris» — doble, y
  // con la página EQUIVOCADA delante, porque sus frases de las DOS páginas
  // vuelven en la misma lista y esta función sólo conoce la principal.
  //
  // Ningún doble podía cazarlo: el proveedor de las pruebas devolvía texto sin
  // prefijo. Hizo falta la llamada de verdad.
  //
  // Lo que SÍ se prefija es lo que compone el SERVIDOR —los hechos del
  // navegador, que sí son de una página conocida— y por eso hay que saber
  // cuáles son: los que no estaban en lo que vino del modelo.
  const delServidor = (l: string, suyas: readonly string[]) => !suyas.includes(l);
  verdict.issues = verdict.issues.map((l) =>
    delServidor(l, delModelo.issues) ? `${principal}: ${l}` : l,
  );
  verdict.observaciones = verdict.observaciones.map((l) =>
    delServidor(l, delModelo.observaciones) ? `${principal}: ${l}` : l,
  );
  // `limites` lo compone entero el servidor.
  verdict.limites = con(principal, verdict.limites);
  for (const p of extras) {
    const suyo = conHechos(
      {
        broken: false,
        issues: [],
        observaciones: [],
        limites: [],
        conMedida: p.hechos.conMedida,
        fallback: false,
      },
      p.hechos,
    );
    verdict.issues.push(...con(p.etiqueta, suyo.issues));
    verdict.observaciones.push(...con(p.etiqueta, suyo.observaciones));
    verdict.limites.push(...con(p.etiqueta, suyo.limites));
    if (suyo.broken) verdict.broken = true;
    // Y SI UNA NO SE MIDIÓ, el turno no midió: la frase de cobertura de la
    // tarjeta promete desborde y contraste, y afirmarlos de una página que
    // nadie midió es justo lo que `conMedida` existe para no hacer.
    if (!p.hechos.conMedida) verdict.conMedida = false;
  }
  return verdict;
}

function conHechos(verdict: VisualVerdict, h: HechosDelNavegador): VisualVerdict {
  const { gritos, fallosSpec, desbordaMovil, culpable, culpableAncho, culpableOpId, contrastes } = h;
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
  // DOS filtros, y cada uno cubre lo que el otro no puede: el primero, lo que
  // cortó nuestro propio guardia; el segundo, un recurso de terceros que no
  // llegó a la red en NUESTRO renderizador. Ninguno de los dos es la página del
  // usuario, y acusarla de ellos hace que el Agente borre lo que funciona.
  const propios = gritos.filter(
    (g) => !esDeAlgoQueBloqueamos(g, h.bloqueadas) && !esRuidoDeRed(g),
  );
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
  // 🔴 REDACTADO PARA QUIEN LO LEE, QUE ES EL DUEÑO DE LA PÁGINA (2026-09-04).
  //
  // Estas frases nacieron cuando `issues` era un canal HACIA EL MODELO: el
  // ciclo de arreglo se las inyectaba y él las obedecía dentro del turno. Ese
  // ciclo se retiró esa misma mañana, y al retirarlo `issues` pasó a ser lo que
  // el bucle EMITE AL USUARIO (`critique`, verbatim). Nadie reescribió el
  // texto, así que el dueño de la página llevaba desde entonces leyendo una
  // orden escrita para un modelo: «Arréglalo con editar_html», más una receta
  // de `overflow-x:auto`. Es el mismo desajuste que ya se corrigió en la prueba
  // declarada partiéndola en `avisoSpec` (modelo) y `notaSpec` (persona).
  //
  // QUÉ SE CONSERVA Y QUÉ NO. Los HECHOS MEDIDOS se quedan enteros —qué
  // elemento, cuántos px, qué texto, qué ratio—: son lo que hace la queja
  // creíble y accionable, y la razón de que este veredicto exista
  // ([[hechos-antes-que-el-juicio]]). Lo que se va es el diagnóstico de CSS y
  // el imperativo. La receta del desborde no se pierde: se mudó a la
  // declaración de `editar_estructura` en `catalog.ts`, que el modelo lee en
  // TODOS los turnos y no sólo cuando ya falló.
  //
  // Y TERMINA OFRECIENDO, no mandando, porque desde el 2026-09-04 quien corrige
  // es el USUARIO: los ojos miden y dicen, y la vuelta siguiente la pide él.
  // LO QUE EL SERVIDOR RECHAZARÍA en el almacén de la página — un HECHO, como
  // el JavaScript que grita: el sustituto de /api/d contesta con las reglas del
  // servidor real (`lib/page-data/sustituto.ts`). Nació del carrito del
  // 2026-09-18, que se veía y se usaba perfecto y no guardaba nada; los ojos
  // le dijeron a Len «esa ruta sólo responde publicada, no es un fallo».
  //
  // Al modelo ya se lo dijo el aviso tras editar (`defectosConDireccion`); si
  // llega hasta aquí es que sigue, y ahora se le dice al DUEÑO, con la misma
  // redacción que el resto de `issues`: el hecho con su ruta, y ofreciendo.
  const rechazos = [
    ...new Set(
      h.datos.filter((l) => l.status >= 400).map((l) => `\`${l.metodo} ${l.ruta}\` → ${l.status}${l.error ? ` ${l.error}` : ""}`),
    ),
  ];
  if (rechazos.length > 0) {
    verdict.issues = [
      `La página intenta guardar datos y el servidor los rechazaría (${rechazos.slice(0, 2).join("; ")}): lo que tus visitantes guarden se perdería sin que nadie lo vea. Dime y lo arreglo.`,
      ...verdict.issues,
    ];
    verdict.broken = true;
  }
  if (desbordaMovil) {
    verdict.issues = [
      culpable
        ? `En un teléfono (390px de ancho) la página se sale de la pantalla: el bloque \`${culpable}\`${culpableOpId ? ` (data-op-id \`${culpableOpId}\`)` : ""} llega a ${culpableAncho}px, ${culpableAncho - 390}px más de los que caben. Quien la abra desde el móvil verá una barra de desplazamiento horizontal y contenido cortado por el borde. Dime y lo ajusto.`
        : "En un teléfono (390px de ancho) algo de la página se sale de la pantalla: quien la abra desde el móvil verá una barra de desplazamiento horizontal y contenido cortado por el borde. Dime y busco qué es y lo ajusto.",
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
        // LA DIRECCION, igual que en el aviso del desborde. Sin ella el modelo
        // tiene el ratio y el texto pero no el nodo, que es justo lo que costo
        // cuatro rondas oscureciendo el velo equivocado el 2026-08-30.
        const direccion = c.opId ? ` (data-op-id \`${c.opId}\`)` : "";
        return `${donde}${direccion}${colores} a ${c.contrast.toFixed(2)}:1`;
      })
      .join("; ");
    // Misma reescritura y mismo reparto que el desborde: los hechos medidos
    // enteros —el texto, sus dos colores y el ratio, que costaron una sesión de
    // cuatro rondas a ciegas conseguir— y fuera el imperativo. Lo que se quita
    // aquí SÍ sobrevive donde el modelo lo lee cada turno: `cambiar_tema` trae
    // el contraste WCAG garantizado, `medir` contesta gratis qué color se pinta
    // de verdad detrás de un texto, y `editar_atributos` ya prohíbe tapar la
    // foto del dueño para arreglar un contraste. Ver `catalog.ts`.
    verdict.issues = [
      // LA CIFRA ES LA QUE SE MIDIÓ, no una redonda que suene a norma. Decía
      // «el mínimo de 3:1 que hace falta» mientras `juzgarContraste` comparaba
      // contra 2: el usuario leía que cualquier texto por encima de 3:1 se
      // había comprobado y estaba bien, y un texto a 2,5:1 ni se le nombraba.
      // El umbral no es de accesibilidad y no se toca — lo que se arregla es la
      // frase, y el número lo trae `UMBRAL_CONTRASTE` para que no haya dos.
      `${contrastes.length} texto(s) que quedan ilegibles sobre su fondo: ${nombrados} — medidos sobre el píxel, por debajo de ${UMBRAL_CONTRASTE}:1, que es donde un texto deja de distinguirse de lo que tiene detrás. Con brillo alto o a plena luz desaparecen. Dime y les cambio el color.`,
      ...verdict.issues,
    ];
    verdict.broken = true;
  }
  // LOS DIÁLOGOS Y LAS RUTAS QUE SÓLO CONTESTAN PUBLICADA — nunca `issues`,
  // nunca `broken`, y desde el 2026-09-16 tampoco `observaciones`.
  //
  // La página hace lo que el modelo escribió; el que no puede seguir es el
  // instrumento. Decir «roto» aquí mandaría a Len a arreglar un `prompt()` que
  // funciona, que es la versión de este fichero del comprobador que acertaba
  // 0 de 3. Eso no ha cambiado.
  //
  // 🔴 LO QUE SÍ CAMBIÓ: estaban en `observaciones`, y `loop.ts` EMITE esa
  // lista verbatim a la conversación. Medido el 2026-09-16 en dos turnos
  // pagados: la respuesta de Len a «cambiame el titular» empezaba «Listo: el
  // titular ahora dice … La página abrió `prompt()` al usar sus controles. La
  // medición los CANCELA (prompt devuelve null, confirm false)». Eso lo lee un
  // creador no técnico. Y la rama que lo emite lo hace sin envolver porque da
  // por hecho que el texto viene del modelo con visión EN EL IDIOMA DEL
  // USUARIO — estas dos frases son castellano fijo del servidor, así que a un
  // usuario japonés le llegaban en español.
  //
  // Ahora van a `limites`, que NO se emite, y al modelo le llegan a mitad de
  // turno por `<limites-de-la-medida>` (lib/agent/aviso-medido.ts), donde
  // además se le dice que lo cuente él y en el idioma del usuario. Al usuario
  // se lo dice el lienzo cuando pulsa, traducido a los diez idiomas
  // (`messages/*/wsPage.json`, `toast.soloPublicada`).
  //
  // Las FRASES salen de `limitesDeLaMedicion` y no se escriben aquí: estaban
  // duplicadas con `observarPagina` y la copia se quedó con la mitad de los
  // hechos.
  verdict.limites = limitesDeLaMedicion({
    ...(h.dialogos.length > 0 ? { dialogosNativos: h.dialogos } : {}),
    ...(h.soloPublicada.length > 0 ? { llamadasSoloPublicada: h.soloPublicada } : {}),
  });
  // Y SI EL MEDIDOR CONTESTÓ. Lo lee la tarjeta para decidir qué puede afirmar
  // que comprobó; ver `VisualVerdict.conMedida`.
  verdict.conMedida = h.conMedida;
  // LAS PROMESAS QUE SE ROMPIERON, y las que hay que retirar. Viajan CRUDAS:
  // aquí no se decide si acusan —hoy NO ponen `broken`, porque esta casa ya
  // degradó una vez este canal tras medir que acertaba 0 de 3, y se promueve
  // con datos, no con ganas—. Quien decide qué se le dice al modelo y qué se
  // pinta es el bucle.
  if (h.regresiones.length > 0) verdict.regresiones = h.regresiones;
  if (h.regresionesSinComprobar) verdict.regresionesSinComprobar = h.regresionesSinComprobar;
  if (h.guardadasSinCorrer.length > 0) verdict.guardadasSinCorrer = h.guardadasSinCorrer;
  if (h.fallosSpec.length > 0) verdict.fallosDelTurno = h.fallosSpec;
  // 🔴 SE MIDE Y SE ENSEÑA, pero NO se le dice al usuario ni al modelo: no es
  // un defecto de su página, es que su prueba no discriminaba. Hoy sólo lo lee
  // la batería (`EvalCumplimiento.vacuas`).
  if (h.vacuas.length > 0) verdict.vacuasDelTurno = h.vacuas;
  if (h.retirarPruebas.length > 0) verdict.retirarPruebas = h.retirarPruebas;
  return verdict;
}

/** Un salto de linea, con nombre: escribirlo dentro del template literal de
 *  abajo obliga a partir la cadena y ya se ha roto una vez asi. */
const SALTO = String.fromCharCode(10);

export function buildVerifyPrompt(
  userPrompt: string,
  html: string,
  bloqueadas: readonly string[] = [],
  /** TODAS las páginas del turno, la principal primero y en el mismo orden que
   *  sus capturas. Vacío ⇒ el turno tocó una sola y el prompt sale byte a byte
   *  como antes. */
  paginas: readonly { etiqueta: string; html: string }[] = [],
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
  // ─── VARIAS PÁGINAS, UNA SOLA LLAMADA ──────────────────────────────────────
  //
  // Las capturas viajan en el MISMO orden que esta lista, y se le pide al
  // modelo que empiece cada frase por la dirección de su página. Rotular es lo
  // que hace el informe de `preview` de Claude Code («Capture 1
  // (390 light):») dentro de una única respuesta; y el prefijo es una
  // DIRECCIÓN, no un nombre, así que no es prosa: la frase que el modelo
  // escribe sigue viniendo entera en el idioma del usuario.
  //
  // Con una sola página no se añade nada y el prompt sale igual que antes.
  const cuerpoDelMapa = (texto: string) =>
    `The page's HTML contains this text content. Cross-check it against the screenshot — content listed here that is NOT visible in the image usually means invisible text (same color as its background), the worst kind of breakage because the owner won't notice it either:
${texto}`;
  const rol =
    paginas.length === 0
      ? "The attached screenshot is the user's OWN landing page, taken right after the agent applied an edit the user asked for."
      : "The attached screenshots are pages of the user's OWN site, taken right after the agent applied an edit the user asked for.";
  const seccionPaginas =
    paginas.length === 0
      ? `<content-map>
${cuerpoDelMapa(contentMap(html))}
</content-map>`
      : `<pages>
This turn changed ${paginas.length} pages of the same site, so ${paginas.length} screenshots are attached, in THIS order. Judge every one of them — a problem on one page says nothing about the others.
${paginas.map((p, i) => `- Screenshot ${i + 1}: the page at ${p.etiqueta}`).join(SALTO)}
Every sentence you put in "issues" or "observaciones" MUST start with that page's address and a colon (for example "${paginas[0]!.etiqueta}: ..."), so the owner knows which page you mean.
</pages>
${paginas
  .map(
    (p, i) => `<content-map page="${p.etiqueta}">
Screenshot ${i + 1}. ${cuerpoDelMapa(contentMap(p.html))}
</content-map>`,
  )
  .join(SALTO)}`;
  return `<role>You are the visual safety check for a page-editing agent. ${rol}</role>
<user-request>${userPrompt}</user-request>
${seccionPaginas}
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
<output>Return ONE JSON object and nothing else, with exactly these three keys: "broken" (boolean), "issues" (array of strings) and "observaciones" (array of strings). broken=true ONLY if at least one flag-only problem is clearly present; issues lists each problem in one short sentence, in the SAME LANGUAGE as the user request above, naming WHERE on the page it is (e.g. "en el hero", "en la sección de precios"). "observaciones" lists, in the same language, anything you SEE but cannot call a defect from the screenshot alone (see observe-only); it never makes broken=true and may be present while broken=false. broken=false with issues=[] when the page looks coherent. When in doubt, broken=false.</output>`;
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
  /**
   * EL PROYECTO AL QUE PERTENECE LA PÁGINA, para medir el MISMO documento que
   * el usuario tiene delante — igual que `VerifyParams.vista`.
   *
   * 🔴 ESTO FALTABA, y es el mismo defecto que arregló `f63b0cb9` en los ojos:
   * `mirar_pagina` medía el documento PELADO mientras el lienzo le enseñaba al
   * usuario el horneado (asistente, chat, sello). Dos páginas distintas, y la
   * herramienta que el modelo llama a mano hasta cuatro veces por turno era la
   * que miraba la que no existe.
   *
   * ⚠️ Por qué la guarda no lo vio: `documento.test.ts` comprobaba las cinco
   * superficies leyendo el FICHERO y buscando `documentoMedible(`. `verify.ts`
   * pasaba porque `runVerify` sí lo usaba — y `observarPagina`, en el mismo
   * fichero, no. La guarda discriminaba por fichero y el defecto vivía por
   * llamada. Ahora hay pruebas de comportamiento para las dos.
   *
   * Ausente ⇒ se mide el documento tal cual, como antes de que esto existiera.
   */
  readonly vista?: ContextoDeVista | null;
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
    //
    // 🔴 SOBRE EL DOCUMENTO HORNEADO, como los ojos. Ver `MiradaParams.vista`:
    // hasta el 2026-09-16 esta rama medía el html pelado, así que el modelo y
    // el usuario miraban páginas distintas. Fallo blando, como allí: si el
    // binding nativo no carga se mide crudo, que ya es útil.
    const medir = internals.medir ?? renderVisualQualityViewports;
    const m = await medir(documentoMedible(params.html, params.vista ?? null)).catch(() => null);
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
    // LO QUE ESTA MEDIDA NO PUDO COMPROBAR — los diálogos que se cancelaron y
    // las rutas que sólo contestan publicada.
    //
    // 🔴 DE LA MISMA FUNCIÓN QUE LOS OJOS, y por eso está escrito así. Antes
    // esta rama tenía su propia frase, a mano, y decía los diálogos y NO las
    // rutas: la asimetría que el mensaje de commit de la Tarea 4 del Plan 2 se
    // comprometía a no cometer («tener el hecho en una y no en la otra es la
    // asimetría que este par de ficheros ya pagó dos veces») y que la Tarea 5
    // cometió una tarea después. Con una sola fuente ya no se puede.
    //
    // De paso deja de viajar el MENSAJE del diálogo: lo escribió la página, y
    // la página la escribe un modelo con lo que le pidió cualquiera.
    partes.push(...limitesDeLaMedicion(m));
    const gritos = m.runtimeErrors ?? [];
    if (gritos.length > 0) {
      partes.push(`La página lanzó: ${gritos.slice(0, 3).join("; ")}.`);
    }
    // LO QUE EL SERVIDOR RECHAZARÍA en el almacén. `/api/d` salió de los
    // límites cuando el sustituto empezó a contestarla (2026-09-18): si no se
    // dijera aquí, esta rama callaría lo que los ojos y el aviso sí dicen —la
    // asimetría de siempre—. Misma frase, de la misma función.
    partes.push(
      ...defectosConDireccion({ llamadasADatos: m.llamadasADatos })
        .filter((d) => d.clase === "datos")
        .map((d) => d.frase),
    );
    // El aviso de DATO va delante de lo citado, como en el informe de Claude
    // Code («lines below…»): detrás ya se ha leído. Ver
    // `TEXTO_DE_LA_PAGINA_ES_DATO`.
    return {
      respuesta: `Medido en el navegador${zona}. ${TEXTO_DE_LA_PAGINA_ES_DATO} ${partes.join(" ")}`,
    };
  }

  // describir — el papel con visión, y SÓLO para describir.
  //
  // ⚠️ ESTA RAMA NO HORNEA, y es la MISMA decisión que la foto de los ojos, no
  // un olvido: el modelo con visión no necesita direcciones, y cambiarle el
  // documento cambiaría lo que ve. Queda dicho aquí porque es una diferencia
  // entre superficies, y en este repo ésas se escriben o se vuelven accidentes.
  //
  // 🔴 MEDIDO EL 2026-09-16, y la decisión es NO HORNEAR. La pregunta abierta
  // era que ninguno de los dos ojos ve la página con la burbuja del asistente
  // como la recibe el visitante. Se midió sobre las 231 plantillas del corpus,
  // en móvil (390) y escritorio (1280), y sale que hornear no compra casi nada
  // y cuesta bastante:
  //
  //   · la pasada DETERMINISTA ya hornea, y aun así no ve el botón en 443 de
  //     462 miradas: la burbuja monta en shadow DOM y el recorrido va por el
  //     documento claro. Hornearla más no la hace verla — eso lo arreglaría
  //     atravesar el shadow root, que es otra cosa. (Una sesión anterior ya lo
  //     había medido por el otro lado: 15 plantillas, `cambiaContraste: 0`,
  //     `cambiaDesborde: 0`.)
  //   · lo que la burbuja llega a TAPAR de verdad es poco: algo interactivo en
  //     7 de 231 en móvil (3,0%) y 3 de 231 en escritorio (1,3%).
  //   · y hornear la FOTO metería un mueble NUESTRO en todas las capturas. Ese
  //     camino ya se pagó una vez —ver la memoria del defecto que era de la
  //     demo—: el crítico con visión reporta lo nuestro como defecto de la
  //     página del usuario. Cambiaría 48,8 KB por página para ganar un 3% y
  //     regalar ruido en el 100%.
  //
  // El defecto que SÍ era común —el icono blanco ilegible sobre un acento
  // claro, de 1,0 a 1,9:1— se arregló donde tocaba, en el origen: el widget
  // calcula su color en vez de asumir blanco (`lib/publish/assistant-widget.ts`).
  // Avisar de un contraste que sabemos calcular es darle trabajo al usuario.
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
    // LA GEMELA. Esta rama no mide: describe una captura. Pero el papel con
    // visión TRANSCRIBE lo que ve, así que devuelve texto de la página igual
    // que la otra — y dejarla fuera sería exactamente la asimetría que
    // `TEXTO_DE_LA_PAGINA_ES_DATO` existe para no repetir.
    return t ? { respuesta: `${TEXTO_DE_LA_PAGINA_ES_DATO} ${t}` } : null;
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

  // 🔴 EL MODELO OBSERVA; ACUSA LO QUE MIDE EL NAVEGADOR.
  //
  // Hasta el 2026-09-15 su `broken` valía por sí solo y sus `issues` salían como
  // defectos afirmados. MEDIDO ese día sobre el corpus de 55 páginas, en DOS
  // corridas: de las razones por las que los ojos decían «rota», el 88% las
  // encontró la mitad determinista —contraste leído en el píxel, desborde
  // medido, errores de JavaScript capturados—. Lo que el modelo aportó por su
  // cuenta fue UN hallazgo, y en la segunda corrida cambió de opinión sobre las
  // mismas páginas. Un juez que no repite no es un juez.
  //
  // Y la vara dice lo mismo: Claude Code no tiene ningún modelo juzgando sus
  // propias ediciones. Entrega DIAGNÓSTICOS —hechos de una herramienta, con
  // fichero y línea— y quien decide es el modelo que edita. La crítica sólo
  // aparece al PLANIFICAR.
  //
  // Así que se retira el VOTO y se conserva el DATO, que es literalmente lo que
  // ya se decidió con la prueba declarada que acusó a 3 páginas y acertó en 0.
  // Lo que el modelo vio no se tira: baja a `observaciones`, que el bucle emite
  // igual al usuario y al texto del turno — pero como lo que es, algo visto y no
  // comprobado, sin tarjeta de aviso y sin llamarlo defecto.
  //
  // `broken` e `issues` salen VACÍOS de aquí a propósito: los rellena
  // `conHechos`, y sólo con lo que el navegador midió de verdad.
  return {
    broken: false,
    issues: [],
    observaciones: [...issues, ...observaciones].slice(0, MAX_ISSUES),
    // Vacío aquí SIEMPRE: los límites no los escribe el modelo, los mide el
    // navegador. Los rellena `conHechos`, como `broken` e `issues`.
    limites: [],
    // Igual: quien sabe si el medidor contestó es `conHechos`, no el parser.
    conMedida: false,
    fallback: false,
  };
}

function logFallback(reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[agent-verify] fallback (${reason}) — sin verificación este turno`);
}
