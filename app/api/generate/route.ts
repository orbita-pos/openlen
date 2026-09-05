import { auth } from "@/auth";
import { createProject } from "@/lib/projects";
import { construirPaginasDeclaradas } from "@/lib/projects/construir-paginas-declaradas";
import { paginasDeclaradas } from "@/lib/projects/paginas-declaradas";
import { userMemoryBlock } from "@/lib/agent/context";
import { getUserMemoryBounded } from "@/lib/agent/user-memory";
import type { SitePage } from "@/lib/projects/types";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState, noCreditsMessage, refundCredits } from "@/lib/credits";
import { generateSystemMessage } from "./system-prompt";
import { randomUUID } from "node:crypto";
import { appendChatMessage } from "@/lib/projects/chat";
import { detectSlotPath } from "@/lib/html-engine";
import { collectDegradations } from "@/lib/ingestion/degradations";
import { directionToBriefBlock, type StyleDirection } from "@/lib/style-match/direction";
import { disableCalcRegions } from "@/lib/expr/repair";
import { credencialDelTurno, faltaCredencial } from "@/lib/ai/turn-credentials";
import { generateHtmlStream, pageWriterUsesDeepSeek } from "@/lib/ai-stream/generate";
import { aceptarReparacion } from "@/lib/page-engine/repair-guard";
import type { InlineImage, Message } from "@/lib/ai-gateway";
import { leerReferenciasAdjuntas } from "@/lib/ai/referencia-adjunta";
import { preparePage } from "@/lib/page-engine/prepare";
import { jsonResponse, sseChannel } from "@/lib/ai/sse";
import { extractDocument } from "@/lib/ai/extract-document";
import { LANGUAGE_RULE } from "@/lib/ai/authoring-rules";
import { todayLine } from "@/lib/ai/today-line";
import {
  PLAN_LIMITS,
  checkAndConsume,
  getUserPlan,
  userLimitKey,
} from "@/lib/limits";
import {
  GENERATION_BRIEF_MAX_LENGTH,
  GENERATION_BRIEF_MIN_LENGTH,
  isGenerationBriefLengthValid,
  trimGenerationBrief,
} from "@/lib/generation/brief-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EL TECHO ABSOLUTO DEL TURNO.
 *
 * Chat y Agente ya lo tienen (los dos, `STREAM_TIMEOUT_MS` sobre su
 * `upstreamAbort`). Crear era la única de las tres SIN él — y es justo la
 * superficie donde el usuario mira una pantalla en blanco esperando.
 *
 * Sin techo, un proveedor que acepta la conexión y deja de mandar bytes deja
 * la generación corriendo indefinidamente. Y el cliente tampoco la corta: el
 * keepalive de más abajo emite `progress` cada 5s A PROPÓSITO —para que el
 * watchdog del navegador no salte durante el «pensar» inicial del modelo—, así
 * que cada ping rearma el único reloj que había.
 *
 * 600s va por DEBAJO del `SILENCE_TIMEOUT_MS` del cliente (780s) para que el
 * usuario reciba un error del servidor en vez de un aborto del navegador, y
 * por encima de lo que tardan tres pasadas reales (60–150s cada una).
 */
const STREAM_TIMEOUT_MS = 600_000;
/** Lo que se reserva del techo del turno para guardar el proyecto.
 *
 *  Las páginas extra se escriben ANTES de `createProject`, así que una que
 *  empiece con el reloj casi agotado se lleva por delante el guardado de la
 *  portada — que es lo que el usuario vino a buscar y ya está terminada. Con
 *  esto, la última que no quepa se queda en armazón y el sitio se guarda. */
const RESERVA_PARA_GUARDAR_MS = 45_000;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate — free-form AI landing-page generation.
//
// Body: { brief: string, model?: "gemini-pro" | "gemini-flash" }
//
// Streams Server-Sent Events as Gemini writes the page:
//   html_chunk    { text }              — sanitized HTML deltas (post-F3 S4)
//   progress      { chars }             — server→client keepalive
//   project_saved { projectId, title }  — terminal success
//   error         { message }
//
// Pipeline (F3 cutover, 2026-05-27):
//   GeminiProvider stream → HtmlStream (sanitize + normalize on end) →
//   SSE wrapper. Credits debit on the upstream `usage` event inside
//   generateHtmlStream; this route only does pre-flight balance gate +
//   post-flight project save. The legacy `reasoning_chunk` + `---HTML---`
//   marker scheme from the Kimi era was dropped — Gemini's
//   instruction-tuning makes raw-HTML output reliable from the first
//   byte.
// ─────────────────────────────────────────────────────────────────────────────



// Sin catálogo de gusto. Aquí viajaba un segundo mensaje `<reference>` con las
// recetas de CSS, cinco fragmentos de HTML de la plantilla Mirror y los
// catálogos de marcas, presentado al modelo como "the design taste catalog".
// El system prompt ya no lo llevaba, pero esto sí — y por eso una guarda que
// sólo miraba el system prompt pasaba en verde.

/** La dirección visual que el cliente adjunta, validada campo a campo.
 *
 *  Nada de confiar en la forma: esto acaba dentro del prompt, y un objeto con
 *  un `character` de 50.000 caracteres o una paleta de mil entradas sería una
 *  forma barata de inflar cada generación. `directionToBriefBlock` recorta al
 *  final, pero recortar es la última red, no la primera. */
function parseStyleDirection(body: unknown): StyleDirection | null {
  const raw = (body as { styleDirection?: unknown })?.styleDirection;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const palette = Array.isArray(d.palette)
    ? d.palette
        .filter(
          (p): p is { role: string; hex: string } =>
            !!p && typeof p === "object" &&
            typeof (p as { hex?: unknown }).hex === "string" &&
            /^#[0-9a-f]{6}$/i.test((p as { hex: string }).hex) &&
            typeof (p as { role?: unknown }).role === "string",
        )
        .slice(0, 6)
        .map((p) => ({ role: p.role.slice(0, 24), hex: p.hex }))
    : [];
  if (palette.length === 0) return null;
  const radius = ["sharp", "soft", "rounded", "pill"].includes(String(d.radius))
    ? (d.radius as StyleDirection["radius"])
    : "soft";
  const character = typeof d.character === "string" && d.character.trim().length >= 10
    ? d.character.trim().slice(0, 320)
    : undefined;
  return {
    hostname: "",
    palette,
    polarity: d.polarity === "dark" ? "dark" : "light",
    fontFamily: typeof d.fontFamily === "string" ? d.fontFamily.slice(0, 60) : "sans-serif",
    radius,
    ...(character ? { character } : {}),
  };
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const brief =
    body &&
    typeof body === "object" &&
    typeof (body as { brief?: unknown }).brief === "string"
      ? trimGenerationBrief((body as { brief: string }).brief)
      : "";
  if (!isGenerationBriefLengthValid(brief)) {
    return json(
      {
        error: `brief must be ${GENERATION_BRIEF_MIN_LENGTH}–${GENERATION_BRIEF_MAX_LENGTH} characters`,
      },
      400,
    );
  }
  // LAS REFERENCIAS ADJUNTAS. Fotos que el visitante sube en el heroe o en el
  // compositor del taller: su logo, su local, un tablero de inspiracion. La
  // pagina nace MIRANDOLAS.
  //
  // SON REFERENCIA, NO ACTIVOS. Viajan al modelo como entrada de vision y no
  // se suben a ningun sitio: no tienen URL, asi que la pagina no las COLOCA,
  // las MIRA. Por eso pasar de una a cuatro no toca nada aguas abajo — ni el
  // horneado de imagenes, ni el saneador, ni la publicacion.
  //
  // Un adjunto malo NO tumba la creacion, y tampoco se lleva por delante a sus
  // companeros — el brief vale por si solo. Se registra el motivo y se sigue
  // con las que si valian: quien escribio "una landing para mi taller" y subio
  // tres fotos y un HEIC merece su pagina con las tres, no un 400.
  //
  // `referenceImages` es lo que manda el cliente nuevo; `referenceImage` lo que
  // mandaba el viejo. Se leen LAS DOS y gana la plural cuando trae algo: en la
  // ventana de un despliegue conviven las dos versiones del cliente, y el nuevo
  // manda ambas a proposito.
  const cuerpoImagenes = body as { referenceImages?: unknown; referenceImage?: unknown } | null;
  const adjuntos = leerReferenciasAdjuntas(
    Array.isArray(cuerpoImagenes?.referenceImages) && cuerpoImagenes.referenceImages.length > 0
      ? cuerpoImagenes.referenceImages
      : cuerpoImagenes?.referenceImage,
  );
  const referencias: readonly InlineImage[] = adjuntos.imagenes;
  for (const motivo of adjuntos.descartadas) {
    // eslint-disable-next-line no-console
    console.warn(`[generate] referencia adjunta descartada: ${motivo}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[generate] request — ${brief.length} chars${referencias.length ? ` + ${referencias.length} referencia(s) (${Math.round(adjuntos.bytes / 1024)} KB)` : ""}`,
  );

  // AQUI SE LEIA `model` DEL CUERPO. Admitia exactamente dos valores,
  // "gemini-pro" y "gemini-flash" —los dos escalones del selector de modelos—,
  // y desde que escribe DeepSeek no lo miraba nadie: por Fireworks el modelo no
  // lo elige el cliente, lo elige la OPERACION en `lib/generation/model-policy.ts`.
  // No habia a que reapuntarlo; ese concepto no existe al otro lado.
  //
  // Se retira el parseo entero, no solo su uso: un campo que se acepta y se
  // ignora se lee como una funcion que existe. El cliente que siga mandandolo
  // no rompe nada — sobra en el cuerpo y ya.

  // El cuerpo puede seguir trayendo `profileId`: no rompe nada, sobra y ya —
  // el mismo trato que el resto de campos que este endpoint ya ignoraba.

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Auth required — anonymous /api/generate would let anyone burn API
  // credits without ever creating an account.
  if (!userId) return json({ error: "unauthorized" }, 401);

  const plan = await getUserPlan(userId);

  // Aquí vivía una puerta PRO. Rechazaba a todo usuario free y lo mandaba al
  // "Quick (curated) flow" — que era /api/curate, la ruta de composición por
  // secciones, borrada con el catálogo entero. El mensaje señalaba a un sitio
  // que ya no existe: un usuario nuevo se encontraba un muro y ninguna salida.
  //
  // Y el presupuesto para dejarlo pasar ya estaba puesto y medido: el plan free
  // trae 20 créditos al mes (lib/credits.ts) y 5 generaciones por hora
  // (PLAN_LIMITS.free). Con el costo real —0.16 MXN por página, medido sobre
  // las doce del cohorte de evals— eso no es una fuga, es lo que se presupuestó.
  //
  // Lo que separa free de pro se queda donde ya estaba: el tope por hora y los
  // créditos, no la puerta.

  // Quota check — hourly + monthly windows defined in lib/limits.ts.
  const decision = await checkAndConsume(
    userLimitKey(userId, "generate"),
    PLAN_LIMITS[plan].generate,
  );
  if (!decision.ok && decision.blocked) {
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        scope: decision.blocked.label,
        plan,
        max: decision.blocked.max,
        windowMs: decision.blocked.windowMs,
        resetAt: decision.resetAt?.toISOString(),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil(
                ((decision.resetAt?.getTime() ?? Date.now() + 60000) -
                  Date.now()) /
                  1000,
              ),
            ),
          ),
        },
      },
    );
  }

  // La credencial es la del papel que ESCRIBE este turno. Ver
  // lib/ai/turn-credentials.ts: con la clave de Gemini agotada y Fireworks sano,
  // esta puerta devolvía 500 sin intentar nada. Aqui tambien se traducia
  // `?model=` a un `AIModel` que solo tenia dos valores, los dos de Gemini; el
  // parametro no elegia nada desde que escribe DeepSeek.
  const faltaKey = faltaCredencial(credencialDelTurno());
  if (faltaKey) {
    return json({ error: faltaKey }, 500);
  }

  // Resolve the saved business profile up front so we can feed its real facts
  // ⚰️ Aquí se resolvía el PERFIL DE NEGOCIO, que alimentaba dos cosas: los
  // hechos que se anteponían al brief y el sembrado del HTML terminado. Las dos
  // se retiraron el 2026-08-31 con el perfil, así que ya no hay nada que
  // resolver. Ver las lápidas de más abajo.

  // SIN PLANTILLA DE REFERENCIA, a propósito. Aquí se elegía una plantilla
  // curada, se le mandaba la captura y se le decía "iguala su calidad,
  // densidad, disciplina de espaciado y pulido" — nuestra página otra vez, por
  // otra puerta.
  //
  // El SEGUNDO motivo que decía esta nota CADUCÓ el 2026-08-28: «una imagen
  // adjunta fija el turno a Gemini, porque el papel que razona en Fireworks no
  // tiene ojos». Hoy la lleva QWEN, que tiene ojos y viaja por el mismo
  // transporte, y Gemini no existe en el repo. Por eso la referencia que SÍ
  // sube el visitante (`referenceImage`, más arriba) puede viajar: lo que no
  // vuelve es que nos mandemos una plantilla nuestra a nosotros mismos.
  let briefBlock = `BRIEF:
${brief}`;

  // ── varias referencias adjuntas ───────────────────────────────────────────
  // SÓLO CUANDO HAY MÁS DE UNA, y a propósito: con una sola el turno sale con
  // el prompt byte a byte igual que antes de que esto fuera plural, así que el
  // camino que ya estaba medido no cambia de comportamiento por un cambio de
  // interfaz.
  //
  // POR QUÉ EXISTE ESTE BLOQUE. Las imágenes llegaban al modelo SIN UNA LÍNEA
  // que dijera qué son. Con una da igual —es LA referencia—; con cuatro, ante
  // imágenes mudas, promediarlas es lo razonable, y promediar es exactamente el
  // fallo que hacía que esto fuera de una sola: el modelo saca una dirección
  // visual que no es ninguna de las que subiste. El riesgo era real; lo que
  // fallaba era tratarlo capando la interfaz en vez de escribiendo la línea.
  //
  // Y DICE QUE NO SE PUEDEN COLOCAR. Viajan como entrada de visión, no tienen
  // URL: un modelo que intente ponerlas en la página sólo puede inventarse un
  // `src`, y un `src` inventado es una imagen rota en una página recién nacida.
  if (referencias.length > 1) {
    briefBlock = `REFERENCIAS ADJUNTAS: ${referencias.length} imágenes que subió el usuario. Van etiquetadas —Imagen 1, Imagen 2…— y en ese orden.

NO son la misma idea partida en trozos y NO se promedian. Lo normal es que cada una aporte algo distinto —un logotipo, el local o el producto, un tablero de inspiración—. Léelas POR SEPARADO, saca de cada una lo que sólo ella te dice (la marca de una, el color y la luz de otra, el ambiente de la tercera) y con eso construye UNA dirección visual coherente. Una media de todas da un resultado que no se parece a ninguna.

Si dos se contradicen, manda el BRIEF. Si el brief no lo aclara, manda la IMAGEN 1.

Son para MIRAR, no para insertar: no tienen dirección web, así que no puedes colocarlas en la página. No inventes un \`src\` para ellas, no las describas en el texto y no hables de ellas.

${briefBlock}`;
  }

  // ── referencia visual ("hazme una como esta") ─────────────────────────────
  // El cliente manda la DIRECCIÓN (el objeto), no el texto ya montado: el
  // bloque se reconstruye AQUÍ con `directionToBriefBlock`, así que su techo de
  // 900 caracteres y su redacción los garantiza el servidor. Aceptar el texto
  // hecho sería dejar que el cliente decidiera cuánto prompt gasta.
  //
  // Y viaja como TEXTO, nunca como imagen — ver el comentario de arriba: una
  // imagen adjunta fija el turno a Gemini y DeepSeek deja de escribir la
  // página. Qwen ya miró la captura en `/api/style-reference`; lo que llega
  // aquí es su conclusión, no la foto.
  const direction = parseStyleDirection(body);
  if (direction) {
    briefBlock = `${directionToBriefBlock(direction)}

${briefBlock}`;
    // eslint-disable-next-line no-console
    console.log(`[generate] referencia visual — ${direction.palette.length} colores${direction.character ? " + carácter" : ""}`);
  }

  // LO QUE SABEMOS DE ESTA PERSONA — hallazgo 15.
  //
  // `recordar_preferencia` le promete al usuario, con estas palabras, que la
  // recordará «aunque cambie de proyecto o pasen semanas», y encima obliga al
  // modelo a CONFIRMÁRSELO en voz alta. Y hasta el 2026-09-01 `getUserMemory`
  // tenía UN solo llamador: la ruta del Agente. O sea que el usuario decía
  // «nunca uses amarillo», Len se lo confirmaba, creaba una página nueva… y
  // salía amarilla. La promesa se hacía a la cara del usuario en la superficie
  // que sí la lee, y se rompía en la que hace las páginas.
  //
  // Va al principio del brief a propósito: es quién es, no qué pide. Y el
  // formateador devuelve "" sin memoria, así que quien nunca guardó nada paga
  // exactamente los mismos tokens que antes y su prefijo cacheado no se
  // invalida.
  //
  // 🔴 CON TECHO, y no por el test. Un `catch` cubre el fallo pero NO el
  // cuelgue, y esto va en la ruta donde el usuario mira una pantalla en blanco
  // — la misma por la que existe `STREAM_TIMEOUT_MS` unas líneas más arriba.
  // Una base de datos lenta no puede retrasar el primer byte de su página por
  // una preferencia que es, como mucho, una mejora.
  //
  // Lo destapó su propia prueba: el test del techo del turno no mockea este
  // módulo, así que la lectura se fue a la base real y colgó el turno entero.
  // Era un aviso, no una molestia.
  const memoriaBlock = userId ? userMemoryBlock(await getUserMemoryBounded(userId)) : "";
  if (memoriaBlock) briefBlock = `${memoriaBlock}${briefBlock}`;

  // ⚰️ Aquí se le anteponían al brief los HECHOS DEL NEGOCIO sacados del perfil
  // —nombre, rubro, contacto, redes— para que el copy los usara en vez de
  // inventarlos. Retirado el 2026-08-31 con el perfil de negocio.
  //
  // Decisión de Jesús: la primera página se escribe con datos de EJEMPLO
  // plausibles, y luego el dueño pone los suyos o se los pide el Agente. Es lo
  // que hace cualquiera a quien le pides una página sin darle su teléfono: la
  // escribe, no te bloquea. Y evita el reverso, que es peor — los datos de un
  // negocio colándose en la página de otro. Palabras suyas: «dos proyectos de
  // un user no se deben de conocer».

  const messages = [
    { role: "system" as const, content: generateSystemMessage(process.env) },
    { role: "user" as const, content: `${todayLine()}${LANGUAGE_RULE}${briefBlock}` },
  ];

  const upstreamAbort = new AbortController();

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const channel = sseChannel(controller);
      const emit = channel.emit;
      let keepalive: ReturnType<typeof setInterval> | null = null;
      const deadline = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.warn(`[generate] techo del turno alcanzado (${STREAM_TIMEOUT_MS}ms) — se corta`);
        upstreamAbort.abort();
      }, STREAM_TIMEOUT_MS);
      const closeStream = () =>
        channel.close(() => {
          clearTimeout(deadline);
          if (keepalive) {
            clearInterval(keepalive);
            keepalive = null;
          }
        });

      const arrancoElTurno = Date.now();
      let totalHtmlChars = 0;
      // Server-to-client keepalive — emit a progress event every 5s so
      // the client watchdog stays reset even if Gemini is silent during
      // its initial "thinking" phase. Cleared in closeStream.
      keepalive = setInterval(() => {
        emit("progress", { chars: totalHtmlChars });
      }, 5000);

      try {
        // Credit gate — one credit is enough to start; the real cost is
        // metered + debited inside generateHtmlStream on the `usage` event.
        const creditState = await getCreditState(userId);
        if (creditState.balance < 1) {
          // `code` + `refillsAt` are what the UI actually reads: the Spanish
          // `message` is the fallback for anything that isn't our own client.
          emit("error", {
            message: noCreditsMessage(creditState, "create"),
            code: "no_credits",
            refillsAt: creditState.refillsAt?.toISOString() ?? null,
          });
          closeStream();
          return;
        }

        // eslint-disable-next-line no-console
        console.log(
          // Quien escribe de verdad. Aqui se leia `PROVIDER.label`, que decia
          // "Gemini 3.5 Flash" mientras DeepSeek escribia la pagina.
          `[generate] auth + quota + credits ok — escribe ${pageWriterUsesDeepSeek() ? "DeepSeek" : "Qwen"}`,
        );

        // One generation pass: stream HTML chunks to the client, await the
        // canonical post-process HTML, then validate it. Returns the validated
        // document or a user-facing error message. Used for both the initial
        // pass and the (optional) critic-driven regen — the regen re-streams
        // so the live preview shows the better version coming together.
        /**
         * LO QUE ESTE TURNO LE HA COBRADO YA AL USUARIO.
         *
         * 🔴 EL COBRO VA POR DELANTE DE LA PUERTA, y ése es el problema. El
         * cargo se hace DENTRO de `generateHtmlStream`, en el evento `usage`;
         * `preparePage` —la puerta que decide si el documento se guarda— corre
         * aquí, después. Una página rechazada por la puerta salía cobrada y sin
         * entregar: el usuario paga y no recibe nada.
         *
         * Se lleva la cuenta para poder DEVOLVERLO. Mover el cargo detrás de la
         * puerta seria la otra mitad de la misma solucion, pero exigiria sacar
         * el debito del stream —donde estan los contadores de tokens— y eso es
         * un rediseno del cobro, no un arreglo de este defecto.
         */
        let creditosDelTurno = 0;

        const runPass = async (
          genMessages: Message[],
          label: string,
          // SILENCIOSO: no manda los trozos al lienzo.
          //
          // Las páginas extra se escriben DESPUÉS de la portada, y el lienzo
          // está enseñando la portada terminada. Si sus trozos viajaran, el
          // usuario vería su portada borrarse y aparecer una página de
          // Servicios a medio hacer justo antes de que la pestaña cambie de
          // sitio. Se cuentan por `progress`, no se pintan.
          silencioso = false,
        ): Promise<
          | {
              ok: true;
              html: string;
              creditos: number;
            }
          | { ok: false; message: string; retryable: boolean }
        > => {
          const { stream, done } = generateHtmlStream({
            messages: genMessages,
            // Con referencia el turno lo escribe QWEN, no el razonador:
            // `writerForTurn(true)` lo decide y se cobra a su tarifa. Al
            // razonador nunca se le manda una imagen.
            //
            // Van TODAS las que pasaron la puerta, no la primera. El transporte
            // ya era plural (`images` es un array en `fireworks-stream-client`);
            // lo que era singular estaba aguas arriba, del selector de ficheros
            // para aca.
            ...(referencias.length ? { images: referencias } : {}),
            userId,
            signal: upstreamAbort.signal,
            // Fresh pages have no need for op-ids; they're a chat-tab
            // protocol marker injected at edit time by tagWithOpIds. Saving
            // them with the project bloats every row and re-tagging on every
            // chat turn would still rewrite them, so leave them off.
            // `sanitize: false` — es NUESTRO generador. El saneo del stream
            // borra chunk a chunk los `<script>`, los `on*` y los iframes que
            // el modelo escribe, y eso es lo que obligaba a inventarse la
            // cápsula y los módulos. La única puerta que queda es
            // `data-slot-path`, y la aplica `gateModelHtml` al cerrar.
            // `normalizeOnEnd: false` va con `sanitize: false`, y por el mismo motivo:
            // lo que sale del modelo sale como el modelo lo escribió. El defecto
            // del crate es `true`, así que sin esta línea la cadena born-canonical
            // le reescribiría la paleta en `HtmlStream.end()`, justo después de que
            // la puerta dejara de hacerlo.
            htmlOpts: { injectOpIds: false, sanitize: false, normalizeOnEnd: false },
            maxOutputTokens: 65_536,
            temperature: 0.8,
          });

          // Pipe per-write HTML chunks to the SSE client as `html_chunk`
          // events. HtmlStream already sanitizes + applies the born-canonical
          // marker pass on end(); the chunks here are the same bytes the
          // final document will contain (sans normalize-time rewrites).
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let loggedFirst = false;
          // LA VALLA DE MARKDOWN. El modelo abre con ```html de vez en cuando
          // pese a que el contrato se lo prohíbe. `extractDocument` la quita
          // del documento FINAL —por eso la página entregada sale bien— pero
          // los trozos del streaming iban crudos al cliente, así que el usuario
          // veía «```html» colgado arriba a la izquierda mientras su página se
          // dibujaba debajo. Cosmético, y aun así es lo primero que ve de su
          // página.
          //
          // La regla es la misma que aplica `extractDocument`, sólo que en
          // vivo: un documento empieza en `<`. Lo que venga antes es prosa o
          // valla, nunca contenido, así que se tira hasta el primer `<` y a
          // partir de ahí se emite tal cual. Sirve igual si la valla llega
          // partida en dos trozos —lo único que se mira es si ya apareció el
          // `<`— y no cuesta nada en el caso normal, donde el primer byte YA
          // es `<`.
          let empezoElDocumento = false;
          while (true) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
              chunk = await reader.read();
            } catch (readErr) {
              // The stream errored — break out and surface via `done`.
              // eslint-disable-next-line no-console
              console.error(`[generate] reader error (${label})`, readErr);
              break;
            }
            if (chunk.done) break;
            let text = decoder.decode(chunk.value, { stream: true });
            if (!empezoElDocumento) {
              const abre = text.indexOf("<");
              if (abre === -1) continue;
              text = text.slice(abre);
              empezoElDocumento = true;
            }
            if (text.length > 0) {
              if (!loggedFirst) {
                loggedFirst = true;
                // eslint-disable-next-line no-console
                console.log(`[generate] streaming started (${label})`);
              }
              totalHtmlChars += text.length;
              // Los caracteres se cuentan igual aunque no se pinten: el
              // vigilante del cliente mira `progress`, y una página extra que
              // tarda un minuto en silencio parecería un turno colgado.
              if (!silencioso) emit("html_chunk", { text });
            }
          }

          const summary = await done;
          // LO COBRADO, ANOTADO EN CUANTO SE COBRA. El cargo ocurre DENTRO del
          // stream (evento `usage`) y la puerta del documento corre después, en
          // esta ruta: sin esta cuenta no habría forma de devolver lo que se
          // cobró por una página que la puerta acaba tirando.
          creditosDelTurno += summary.creditsDebited;

          if (summary.stopKind === "error" || !summary.finalHtml) {
            return {
              ok: false,
              message: summary.error?.message ?? "Generation failed — try again.",
              retryable: true,
            };
          }

          // Gemini occasionally wraps the output in ```html...``` fences
          // despite the system prompt forbidding it. Strip a possible fence
          // pair before validating — same safety net the Kimi-era route had.
          const passHtml = extractDocument(summary.finalHtml);

          if (passHtml.length < 1000 || !/^<!doctype/i.test(passHtml)) {
            return {
              ok: false,
              message:
                "The model didn't return a complete HTML document. Try again.",
              retryable: true,
            };
          }
          if (!/<\/html>\s*$/i.test(passHtml)) {
            return {
              ok: false,
              message:
                summary.stopKind === "max_tokens"
                  ? "The page hit the model's output cap before finishing. Try a shorter, more focused brief."
                  : "The page ended without a closing </html>. Try again.",
              // max_tokens is deterministic — same brief at same cap will hit
              // it again. Truncated streams from upstream congestion ARE
              // retryable.
              retryable: summary.stopKind !== "max_tokens",
            };
          }
          if (detectSlotPath(passHtml)) {
            return {
              ok: false,
              message: "The model emitted editor-mode markers — try again.",
              retryable: false,
            };
          }

          // eslint-disable-next-line no-console
          console.log(
            `[generate] tokens (${label}) — prompt: ${summary.usage?.inputTokens ?? "?"}, output: ${summary.usage?.outputTokens ?? "?"} → ${summary.creditsDebited} credits`,
          );
          // El runtime viaja con SU pasada. Si gana una regeneración, se guarda
          // el script de esa generación y no el de la anterior: un script escrito
          // para un DOM que ya no existe no falla — hace cosas raras en silencio.
          // La PRUEBA viaja con su pasada por la misma razón que el runtime: es
          // la promesa de ESE código sobre ESE DOM.
          return {
            ok: true,
            html: passHtml,
            // Lo que costó ESTA pasada. La portada devuelve el total del turno
            // si la puerta la rechaza (no se entrega nada); una subpágina
            // rechazada devuelve sólo lo suyo, porque el resto sí se entrega.
            creditos: summary.creditsDebited,
          };
        };

        // ── Initial pass ────────────────────────────────────────────────────
        // Auto-retry ONCE on transient failures (truncated streams, garbage
        // output) — el proveedor corta a media respuesta bajo carga y un
        // attempt usually completes. max_tokens / editor-markers are
        // deterministic and surface immediately. The user pays for the
        // tokens of both attempts on a retry, but that's a 1/20 occurrence
        // and the alternative is a hard "Generation failed" wall.
        let first = await runPass(messages, "initial");
        // Si lo que falló fue el techo del turno, reintentar es tirar otra
        // llamada contra una señal ya abortada: falla igual y se registra dos
        // veces el mismo fallo.
        if (!first.ok && first.retryable && !upstreamAbort.signal.aborted) {
          // eslint-disable-next-line no-console
          console.log(
            `[generate] initial pass failed (${first.message}) — auto-retrying`,
          );
          first = await runPass(messages, "initial-retry");
        }
        if (!first.ok) {
          emit("error", { message: first.message });
          closeStream();
          return;
        }
        // ⚰️ AQUÍ CORRÍA «Born With Imagery»: se metían fotos reales del catálogo
        // en los huecos `data-ol-photo` que marcaba el modelo. Retirado el
        // 2026-09-04 (`4feb19d9`), porque el catálogo no cubre rubros enteros y
        // la foto que no pega hace que la página PAREZCA mal hecha. Desde el
        // barrido de ese mismo día el contrato ya no pide el hueco: la
        // biblioteca de fotos es del usuario, y él cambia el área que quiera
        // desde el editor.
        // ⚰️ Aquí se resolvía el perfil de negocio para que el proyecto naciera
        // enlazado a él y con su logo. Retirado el 2026-08-31: los datos del
        // dueño viven en su página, y el logo se pone desde el inspector.

        // El motor: imágenes → legibilidad → medición → invariantes → puerta →
        // módulos. Vive en lib/page-engine y lo comparten crear, editar y el
        // Agente. Esta ruta lo corre una vez por candidato; lo único que se
        // queda aquí es la decisión de regenerar, porque exige volver a llamar
        // al modelo y eso es presupuesto del usuario.
        const title = extractTitle(first.html) ?? brief.slice(0, 60).trim();
        // El runtime viaja con SU pasada, igual que arriba: el candidato que se
        // mide tiene que llevar el script que ESE candidato escribió. Sin él la
        // medición era ciega al modo de fallo que ninguna captura enseña — un
        // script que muere en el arranque deja una foto perfecta.
        // ⚰️ Aquí viajaba la PRUEBA declarada, que el motor ejecutaba dentro del
        // navegador que ya abre para medir. Se retiró con su bloque del prompt
        // (ver la lápida en `system-prompt.ts`): el modelo ya no promete nada,
        // así que no hay nada que ejecutar. El hueco vuelve a ser lo que era —
        // el render pulsa los controles— y la medición sigue entera.
        const engine = (candidate: string) =>
          preparePage(candidate, {
            mode: "create",
            brief,
            title,
          });

        let prepared = await engine(first.html);
        if (!prepared.ok) {
          // eslint-disable-next-line no-console
          console.error(`[generate] gate refused (${prepared.code}) — not saving`);
          // SE DEVUELVE LO COBRADO. No se guarda nada, así que el usuario se
          // queda sin página — cobrarle además es la versión de caja del
          // defecto que este repo persigue: afirmar un resultado que no hubo.
          // Fail-soft: si la devolución falla se registra y se sigue dando el
          // error al usuario, que es lo que estaba esperando.
          await refundCredits(userId, creditosDelTurno).catch((err) => {
            // eslint-disable-next-line no-console
            console.error(
              "[generate] no se pudo devolver el cobro de una página rechazada (user=%s, credits=%d): %o",
              userId,
              creditosDelTurno,
              err,
            );
          });
          emit("error", { message: "The page came out with editor-mode markers — try again." });
          closeStream();
          return;
        }
        let html = prepared.html;
        // ⚰️ Aquí vivía `runtimeCode`, la copia del JavaScript del modelo. No la
        // leía NADIE —se asignaba y ya— y encima venía siempre a null: su
        // captura no podía salir. Retirada el 2026-09-04 con las otras dos; el
        // porqué entero está en `lib/ai-stream/model-runtime.ts`.
        let regenerated = false;
        // ⚰️ `mejoraGastada` — EL PRESUPUESTO DE MEJORA, retirado con el crítico.
        //
        // Contaba las pasadas de mejora para que las dos —rotura medida y
        // crítico— compartieran una sola. Su único lector era la puerta del
        // crítico, y su único escritor la reparación automática, retirada el
        // 2026-09-04. Sin ninguno de los dos no queda presupuesto que contar.
        let breakage = [...prepared.report.breakage];
        // Una fórmula que el reparador NO pudo arreglar sin adivinar entra en
        // el mismo reintento que la rotura medida. No es un reintento nuevo:
        // es que el diagnóstico —que ya era quirúrgico— por fin llega a quien
        // puede actuar sobre él.
        let calcRotas = [...(prepared.report.calcIssues ?? [])];
        // CSS que no puede aplicar nunca. Entra por el MISMO reintento, sin
        // presupuesto nuevo — es el defecto que ninguna otra etapa ve: el render
        // mide lo que se pinta y la puerta valida lo que está cableado, pero un
        // selector que no casa simplemente no ocurre. Medido en una página real
        // el 2026-08-23: `.timer-ring .track-ring` con la clase ausente dejó dos
        // `<circle>` de SVG con su relleno NEGRO por defecto, tapando el reloj.
        const cssMuerto = [...(prepared.report.deadRules ?? [])];
        const diagnostico = [
          ...breakage,
          ...calcRotas.map((i) => `la fórmula ${i.attr}="${i.formula}" ${i.message}`),
          ...cssMuerto.map(
            (r) =>
              `el selector \`${r.selector}\` no aplica NUNCA: falta class="${r.ausentes[0]}" en el documento`,
          ),
        ];

        // ⚰️ LA PROMESA DEL PROPIO MODELO, RETIRADA CON SU BLOQUE DEL PROMPT.
        //
        // Aquí se leían los pasos fallidos de la prueba declarada
        // (`prepared.report.specFailures`) y se juntaban con el diagnóstico.
        // Iban APARTE a propósito, y ese apartado es justo lo que ya no hace
        // falta: una prueba fallida no era rotura observable —la escribió el
        // mismo modelo que escribió el código y podía estar mal (medido el
        // 2026-08-23: esperaba `49:59` donde reiniciar da `50:00`)—, así que
        // había que tratarla con menos autoridad que un hecho del navegador.
        //
        // Sin prueba no hay promesa que ponderar. Lo que queda es `diagnostico`,
        // que es rotura OBSERVABLE y sólo eso: algo gritó, una fórmula no
        // compila, un selector no puede casar. Cierto pase lo que pase.
        const paraReparar = diagnostico;

        // ⚰️ LA REPARACIÓN AUTOMÁTICA, RETIRADA (Jesús, 2026-09-04).
        //
        // Aquí se llamaba al modelo para que reparara su propia página en cuanto
        // el navegador medía un defecto. Era barato y funcionaba —90% de líneas
        // idénticas, ~234 tokens contra los ~8.800 de una reescritura— y aun así
        // se va, porque el problema no era el coste: **nadie la pidió**.
        //
        // La regla es que corrige el USUARIO, no nosotros. Un turno que el
        // usuario no pidió es nuestro aunque lo ejecute el modelo: gasta su
        // tiempo, puede empeorar la página, y decide por él qué defecto merece
        // arreglarse. Es la misma decisión que retiró las dos reescrituras, las
        // fotos, los colores y las cuatro reparaciones del motor.
        //
        // LO QUE SE HACE EN SU LUGAR, y es la otra mitad de la regla: se le DICE.
        // Sin esto la retirada le quitaría también el aviso, y se quedaría con
        // una página que se desborda en móvil y sin manera de saberlo — que es
        // peor que corregirle. La medida viaja al cliente y allí se enseña.
        if (paraReparar.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[generate] rotura medida — ${paraReparar.join(" · ")}`);
          emit("medida", { reason: paraReparar.join("; ") });
        }

        // 🔴 NO SE TIRA LA PÁGINA DEL USUARIO. (decisión de Jesús, 2026-09-04)
        //
        // Aquí vivía una reescritura COMPLETA: si tras el arreglo quirúrgico
        // seguía habiendo rotura medida, se le pedía al modelo la página entera
        // otra vez y se entregaba la que menos rota estuviera.
        //
        // Retirada. En producción tiraba páginas terminadas que el usuario ya
        // estaba viendo —bastaba un desborde a 390px— y escribía otra encima.
        // Tres cosas la hacían indefendible, y las tres se midieron sobre este
        // mismo código:
        //
        //  1. El desborde móvil pesaba lo MISMO que «el JavaScript revienta»
        //     (`objective-breakage.ts`), y autorizaba el mismo castigo.
        //  2. El empate lo ganaba la reescritura (`despues <= antes`), así que
        //     una pasada que no arreglaba NADA sustituía igual la página.
        //  3. La primera página no se guardaba en ninguna parte —`createVersion`
        //     corre una sola vez, al final, con la ganadora— así que no había
        //     nada que restaurar: desaparecía.
        //
        // Lo que queda es el arreglo QUIRÚRGICO de arriba, que corrige SOBRE la
        // página del usuario sin sustituirla, y este aviso. Una página con un
        // defecto medido sigue siendo suya; una página que no pidió, no lo es.
        //
        // El crítico visual de abajo tampoco reescribe: su regeneración lleva
        // apagada por defecto desde antes de esto (`OPENLEN_VISION_CRITIC_REGEN`).
        if (breakage.length > 0) {
          // Guardar-y-avisar: la página se entrega, pero queda dicho qué sigue
          // roto. Un fallo que nadie registra vuelve a pasar.
          // eslint-disable-next-line no-console
          console.warn(`[generate] entregada con rotura — ${breakage.join(" · ")}`);
        }

        // DEGRADAR SIN MENTIR. Si tras reparar y reintentar una fórmula sigue
        // muerta, se le quitan los marcadores a la región: la página queda
        // estática pero íntegra —el valor de nacimiento ya está escrito dentro
        // del elemento— y el visitante no ve un control que invite a teclear y
        // no responda.
        //
        // Es lo que hace un error boundary con un widget roto: esconderlo, no
        // mostrarlo muerto. La otra mitad —decírselo al creador— la lleva
        // `collectDegradations` con el código `broken_controls`, más abajo.
        if (calcRotas.length > 0) {
          const off = disableCalcRegions(html);
          if (off.repaired > 0) {
            html = off.html;
            // eslint-disable-next-line no-console
            console.warn(
              `[generate] cálculo apagado tras ${calcRotas.length} fórmula(s) irreparable(s) — la página se entrega sin él`,
            );
          }
        }

        // ⚰️ EL CRÍTICO CON VISIÓN, RETIRADO (Jesús, 2026-09-05).
        //
        // Aquí se renderizaba la página en Chromium, se le enseñaba la captura
        // al papel `visualCritic` y volvía un veredicto con puntuación e issues.
        //
        // QUÉ HACÍA CON ESE VEREDICTO: `recordCriticRun(...)` y dos
        // `console.log`. Nada más. No salía al cliente, no se guardaba en el
        // proyecto, no entraba en `degradations`. El comentario que había aquí
        // afirmaba que «lo que dice sale en el informe y en el botón
        // "Arréglalo"» — era falso: el texto del veredicto no viajaba a ningún
        // sitio. Su ciclo de regeneración ya se había retirado el 2026-09-04.
        //
        // QUÉ COSTABA, por cada página creada, de cada usuario: una llamada al
        // modelo con visión, un SEGUNDO arranque de Chromium (el motor ya abre
        // uno para medir) y hasta 30 s de espera. Todo eso para una línea de
        // consola que nadie lee.
        //
        // POR QUÉ NO SE DEJA APAGADO. `OPENLEN_VISION_CRITIC=0` existía y nadie
        // lo ponía —no hay ninguna OPENLEN_* en `infra/`—, así que en
        // producción corría siempre. Y una palanca que apaga algo que no sirve
        // se lee como una alternativa que existe: es la lección de
        // [[la-palanca-que-no-vuelve-a-ningun-sitio]]. Se va entero.
        //
        // LO QUE NO SE PIERDE. Lo que de verdad mide un navegador lo mide la
        // etapa 3 del motor, sin modelo y sin crédito: desborde móvil,
        // contraste leído del píxel, errores de JavaScript, fórmulas rotas y
        // CSS que no aplica. Eso sigue entero y sigue viajando en `medida`.
        // Lo que se va es la OPINIÓN, que costaba una llamada y no llegaba a
        // ninguna parte.

        // ── Guardar el documento elegido ────────────────────────────────────
        const gated = {
          removed: prepared.report.removed,
          issues: (prepared.report.behaviorIssues ?? []) as readonly never[],
        };

        // What the page lost on the way in. On the ROW, not in the SSE payload:
        // the client redirects to the workspace on `project_saved`, so a field
        // added there dies on arrival.
        //
        // In practice this is `broken_controls`. Everything else the gate
        // counts was already stripped upstream (the stream sanitizes each
        // write), so the sanitize counters here read zero — which is the
        // honest answer: the model wrote this page, not the user, and telling
        // someone their page "had JavaScript removed" about markup they never
        // typed is the noise this record exists to avoid.
        const degradations = collectDegradations({
          surface: "generate",
          removed: gated.removed,
          behaviorIssues: gated.issues,
        });

        // ⚰️ Aquí se leía `prepared.report.modules` — el puente IA→módulos, que
        // encendía el módulo cuyo marcador traía la página recién generada. Se
        // retiró el 2026-08-29 (lib/projects/module-intent.ts): su único módulo
        // puenteado ya no tiene horneado, así que la lista salía siempre vacía.

        // LAS PÁGINAS QUE LA PORTADA DICE QUE HAY.
        //
        // Pedías «una web con inicio, servicios y contacto» y salía UNA página.
        // No era un fallo del código: el contrato mandaba un documento completo
        // y prohibía las rutas relativas —porque una ruta desconocida sirve la
        // portada con un 200 y el enlace se rompe en silencio—, así que el
        // modelo escribía `#servicios` y hacía bien.
        //
        // Ahora el contrato deja que el menú enlace `/servicios` cuando el
        // sitio necesita páginas de verdad, y eso se lee AQUÍ, del documento
        // que el modelo acaba de escribir. Quién decide cuántas páginas hay es
        // él, sin una llamada de más y sin una regex sobre el brief.
        //
        // Y NO NACEN VACÍAS. Cada una se escribe con la MISMA tubería que la
        // portada —`runPass` para el documento, `preparePage` para las fotos,
        // la legibilidad y la medición del navegador— porque una página del
        // sitio de alguien no es un borrador: es una página. Decisión de Jesús
        // del 2026-08-27 sobre las dos alternativas más baratas, sabiendo lo
        // que cuesta: un crédito y una llamada por página.
        //
        // El armazón vestido sigue siendo la RED: si una página no se puede
        // escribir —sin créditos, el modelo falla, la puerta la rechaza— se
        // guarda su armazón y el sitio se navega igual. Perder la portada por
        // una subpágina sería cambiar un fallo pequeño por uno grande.
        const armazones = construirPaginasDeclaradas(html);
        const paginas: Record<string, SitePage> = {};
        for (const [slug, armazon] of Object.entries(armazones)) {
          paginas[slug] = armazon;
          const nombre = armazon.title ?? slug;

          // EL RELOJ DEL TURNO. Si se agota, el `deadline` aborta el flujo de
          // arriba — y como el proyecto se guarda DESPUÉS de este bucle, seguir
          // aquí sería gastar el techo entero en páginas que ya no pueden salir
          // mientras la portada, que sí está terminada, espera a guardarse. Se
          // corta con margen para que el guardado quepa.
          const queda = STREAM_TIMEOUT_MS - (Date.now() - arrancoElTurno);
          if (upstreamAbort.signal.aborted || queda < RESERVA_PARA_GUARDAR_MS) {
            // eslint-disable-next-line no-console
            console.warn(`[generate] sin tiempo para /${slug} — queda su armazón`);
            continue;
          }

          // El saldo, ANTES de cada una. La puerta de arriba sólo pide un
          // crédito para empezar y el gasto real se mide al vuelo, así que en
          // un sitio de cuatro páginas se puede acabar a mitad. Quedarse con
          // los armazones de las que falten es honesto; encadenar llamadas que
          // van a cobrar sin saldo, no.
          const saldo = await getCreditState(userId);
          if (saldo.balance < 1) {
            // eslint-disable-next-line no-console
            console.warn(`[generate] sin créditos para /${slug} — queda su armazón`);
            continue;
          }

          emit("pagina-escribiendo", { slug, title: nombre });
          const escrita = await runPass(
            [
              { role: "system", content: generateSystemMessage(process.env) },
              {
                role: "user",
                content: `<sitio-existente>
Esta es la PORTADA del sitio, ya escrita y aprobada. Es tu referencia de diseño:

${html}
</sitio-existente>

Escribe ahora la página «${nombre}» de ESTE MISMO sitio, en \`/${slug}\`.

- Mismo <head>: las mismas tipografías, los mismos tokens de :root, el mismo modo.
- La misma cabecera y el mismo pie, con los mismos enlaces. El visitante tiene
  que poder volver a la portada y saltar a las demás páginas.
- El CONTENIDO es nuevo y es sólo de esta página. No repitas las secciones de la
  portada: esta página existe porque ese contenido no cabía ahí.
- No añadas páginas nuevas: los enlaces del menú son los que ya hay.

${briefBlock}`,
              },
            ],
            `page:${slug}`,
            true,
          );
          if (!escrita.ok) {
            // eslint-disable-next-line no-console
            console.warn(`[generate] /${slug} no salió (${escrita.message}) — queda su armazón`);
            continue;
          }

          // La misma tubería que la portada: fotos reales donde el modelo
          // marcó `data-ol-photo`, legibilidad, medición y la puerta. Sin
          // esto la subpágina sería la única superficie del producto que se
          // guarda sin pasar por el motor.
          const listo = await preparePage(escrita.html, {
            mode: "create",
            brief,
            title: nombre,
          });
          if (!listo.ok) {
            // eslint-disable-next-line no-console
            console.warn(`[generate] la puerta rechazó /${slug} (${listo.code}) — queda su armazón`);
            // Y se devuelve lo que costó ESTA subpágina: se cobró una llamada
            // por página declarada, y de ésta el usuario se queda con el
            // armazón que ya tenía. El resto del sitio sí se entrega, así que
            // sólo vuelve lo suyo.
            await refundCredits(userId, escrita.creditos).catch((err) => {
              // eslint-disable-next-line no-console
              console.error(
                "[generate] no se pudo devolver el cobro de /%s (user=%s, credits=%d): %o",
                slug,
                userId,
                escrita.creditos,
                err,
              );
            });
            continue;
          }
          paginas[slug] = { html: listo.html, title: nombre };
        }

        let projectId: string;
        try {
          projectId = await createProject(userId, {
            html,
            brief,
            title,
            settings: undefined,
            degradations: degradations.length > 0 ? degradations : undefined,
            pages: paginas,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[generate] createProject failed", err);
          emit("error", {
            message: "Generated the page but couldn't save it — try again.",
          });
          closeStream();
          return;
        }

        // ── TU PRIMER MENSAJE ES EL TURNO 1 DE LA CONVERSACIÓN ─────────────
        //
        // Lo que escribiste para crear la página se guardaba SÓLO en la columna
        // `brief` y desaparecía: el Chat abría vacío, como si no hubieras dicho
        // nada. Y peor — el Agente lee `userBrief`, que sólo escribe la pestaña
        // Brief a mano, así que en toda página nacida de la IA no sabía lo que
        // le habías pedido. Lo deducía del HTML, que no es lo mismo.
        //
        // Se siembra como TURNO, no como `userBrief`, y la diferencia importa:
        // `userBrief` se le inyecta como «PROJECT BRIEF (persistente — aplica a
        // toda petición)», así que un «ponle una cuenta atrás» seguiría
        // mandando en el turno 40, cuando ya cambiaste de idea tres veces. Un
        // turno de conversación es historia, y la historia envejece bien.
        //
        // Fail-soft: la página ya está guardada. Perder el turno es feo; perder
        // la página por no poder escribirlo sería absurdo.
        try {
          await appendChatMessage(projectId, {
            id: randomUUID(),
            userText: brief,
            // Lo que de verdad pasó, sin adornos: el resumen que el usuario
            // relee dentro de dos semanas para acordarse de qué pidió.
            assistantReasoning: regenerated
              ? "Creé tu página y la repasé: encontré defectos al medirla en un navegador y los corregí antes de entregártela."
              : "Creé tu página.",
            status: "applied",
            page: null,
            noDocChange: false,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[generate] no se pudo sembrar el primer turno del chat", err);
        }

        // Telemetry only — the same `[name] ` + one-line-JSON convention
        // publishToDir uses. This used to be the ONLY answer this route had to
        // a control born dead: validate after the row was written and write a
        // line nobody reads. The user's answer is the `broken_controls` record
        // above, which the workspace shows as "algunos controles quedaron mal
        // conectados — pedile al asistente que los arregle". The log stays
        // because it is how we count how often the model does this; it is no
        // longer how the person who owns the page finds out.
        if (gated.issues && gated.issues.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[generate] behavior issues " +
              JSON.stringify({ projectId, issues: gated.issues }),
          );
        }

        await createVersion({
          projectId,
          html,
          label: regenerated ? `Generated (regen): ${title}` : `Generated: ${title}`,
          source: "initial",
        }).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[generate] initial version snapshot failed", err);
        });

        // `enabledModules` iba en este evento y NO LO LEÍA NADIE en el cliente:
        // sólo una prueba. Sale con el puente.
        emit("project_saved", { projectId, title, regenerated });
        closeStream();
      } catch (err) {
        upstreamAbort.abort();
        // eslint-disable-next-line no-console
        console.error("[generate] stream failed", err);
        emit("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        closeStream();
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(sse, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}



/** El cuerpo vive en lib/ai/sse. */
function json(body: unknown, status: number): Response {
  return jsonResponse(body, status);
}
