// scripts/evals-pages.ts — corre el conjunto fijo de briefs contra el modelo de
// verdad y escribe un marcador comparable con la corrida anterior.
//
// ESTO GASTA DINERO. ⚰️ Aquí ponía «~1-2 MXN por página, 12-24 el conjunto»:
// era el precio de cuando escribía Pro. MEDIDO el 2026-09-12 con los papeles de
// hoy: 48 páginas costaron 8,73 MXN, o sea **~0,18 MXN por página** y ~3 MXN el
// conjunto de 16. Los dos escritores comparten tarifa (`deepseek-flash`), así
// que el número no cambia según quién escriba. Un tope de gasto calculado sobre
// un precio 6x viejo no es un tope. No se corre a diario: antes de un despliegue
// y cuando se toca el prompt o el motor.
//
//   npm run evals:pages                    # el conjunto entero
//   npm run evals:pages -- --tag=regresion # sólo los que nacieron de un fallo
//   npm run evals:pages -- --max-mxn=8     # tope propio
//   npm run evals:pages -- --solo=solar,quiz --repeat=3
//                                          # unos pocos casos, N veces
//   npm run evals:pages -- --escritor=visual_critic --solo=saas,comida
//                                          # fija QUIÉN escribe, para poner los
//                                          # mismos briefs delante de los dos
//
// POR QUÉ `--repeat`. El modelo NO es determinista, así que una sola muestra
// por caso no distingue un defecto REAL de la varianza. Se vio medido: cuatro
// corridas del mismo cohorte dieron 12/12, 14/14, 14/16 y 13/16 sin que el
// código de las conductas cambiara entre las dos últimas. Los chequeos de
// forma/puerta/render son estables; los de ADOPCIÓN (¿usó el modelo la
// conducta?) oscilan, y ahí una corrida sola miente en las dos direcciones.
//
// Con `--repeat` el marcador deja de decir "pasó/falló" y pasa a decir "pasó N
// de M", que es lo único interpretable sobre un modelo no determinista.
//
// Reproduce la ruta de /api/generate: comprobaciones de forma → un reintento →
// el motor → regeneración por rotura medida. Medir un camino más corto que el
// del producto sería medir otra cosa.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { generateHtmlStream, laEscribeElRazonador } from "@/lib/ai-stream/generate";
import { generateSystemMessage } from "@/app/api/generate/system-prompt";
import { LANGUAGE_RULE } from "@/lib/ai/authoring-rules";
import { leerReferenciaAdjunta } from "@/lib/ai/referencia-adjunta";
import { todayLine } from "@/lib/ai/today-line";
import { extractDocument } from "@/lib/ai/extract-document";
import { creditRate, type CreditRate } from "@/lib/credits";
import { creditRateForRole, displayNameForRole } from "@/lib/generation/model-policy";
import { ESFUERZOS, presupuestoDeEsfuerzo, type EsfuerzoAgente } from "@/lib/agent/esfuerzo";
import { ESCRITORES_ELEGIBLES, type TurnWriter } from "@/lib/ai/provider-switch";
import { compileCalcRegions } from "@/lib/expr/document";
import { detectSlotPath } from "@/lib/html-engine";
import { preparePage } from "@/lib/page-engine/prepare";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { PAGE_COHORT, PAGE_COHORT_VERSION, type PageEvalCase } from "@/lib/evals/page-cohort";
import {
  buildScorecard,
  caseClean,
  compareScorecards,
  judgePage,
  worstFailure,
  type BrazoDeCorrida,
  type PageMeasurement,
  type PageVerdict,
  type Scorecard,
  type SubpageVerdict,
} from "@/lib/evals/page-scorecard";
import { guardarMarcador } from "@/lib/evals/guardar-marcador";
import { construirPaginasDeclaradas } from "@/lib/projects/construir-paginas-declaradas";
import { subpaginaPrompt } from "@/lib/generation/subpagina-prompt";
import { repeticionDePortada } from "@/lib/generation/repeticion-de-portada";
import type { InlineImage, Message } from "@/lib/ai-gateway";
const OUT_DIR = join(process.cwd(), "scratch", "evals");
// La línea base se VERSIONA, junto al conjunto que mide. Si viviera en scratch
// cada máquina tendría la suya y "vs la corrida anterior" no significaría nada
// entre dos personas ni tras un clon nuevo. Los artefactos de cada corrida
// —el HTML de cada página— se quedan en scratch.
const BASELINE = join(process.cwd(), "lib", "evals", "baseline.json");
const USD_TO_MXN = 18.5;
// La tarifa sale de `lib/credits.ts` (RATES), la MISMA tabla con la que el
// producto cobra, y la elige QUIEN DE VERDAD CORRE — no el `model` que se le
// pasa a `generateHtmlStream`.
//
// Ese matiz cuesta dinero si se lee mal, y yo lo leí mal: el arnés pasa
// `model: "gemini-flash"`, pero `generateHtmlStream` decide el motor con
// `laEscribeElRazonador()`, que es OPT-OUT — sin `OPENLEN_GENERATE_PROVIDER`
// corre DeepSeek. Ver el interruptor y su regla en `lib/ai/provider-switch.ts`.
// Cobrar estas corridas a tarifa de Gemini las encarecería 9x en el papel, y un
// tope de gasto calculado sobre el precio de otro proveedor no es un tope.
//
// ⚰️ Aquí ponía «con imágenes manda Gemini (Fireworks no tiene ojos), pero este
// cohorte no adjunta ninguna». Las DOS mitades caducaron: Gemini salió el
// 2026-08-28 y desde el 2026-09-07 el cohorte SÍ adjunta una
// (`referencia-calida`).
//
// Ese caso corre a la tarifa del PAPEL CON VISIÓN y el resto a la del
// razonador, así que el costo se acumula CON LA TARIFA DE CADA TURNO — ver
// `pass`. Una constante para toda la corrida volvería a ser el error que esta
// nota describe.
//
// ⚰️ Y aquí estaban las dos tarifas escritas a mano («$0.40/$1.60» contra
// «$0.22/$0.66»). Caducaron el 2026-09-12 con el modelo del papel con visión:
// hoy los dos papeles cuestan lo mismo, y el día que vuelvan a separarse este
// fichero se enteraría el último. Se PREGUNTAN.

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const tag = flag("tag");
  const maxMxn = Number(flag("max-mxn") ?? "26");
  const solo = flag("solo")?.split(",").map((s2) => s2.trim()).filter(Boolean);
  const repeat = Math.max(1, Math.trunc(Number(flag("repeat") ?? "1")));
  // LA POSTURA DE LA CORRIDA. Ausente = como hoy: el esfuerzo lo pone la TABLA
  // de politica (`page_edit` -> "none") y el turno sale byte a byte como antes.
  // Presente = se le pasa a `generateHtmlStream`, que lo manda al cable como
  // NUMERO. Es el brazo con razonamiento del experimento de Crear.
  //
  // Se valida contra `ESFUERZOS` en vez de dejarlo pasar: una errata en la
  // bandera de una corrida DE PAGO no puede convertirse en «sin postura» en
  // silencio, porque entonces el brazo mediria el control creyendo medir el
  // brazo — y los dos numeros se compararian como si fueran distintos.
  const esfuerzoCrudo = flag("esfuerzo")?.trim().toLowerCase();
  if (esfuerzoCrudo !== undefined && !ESFUERZOS.some((e) => e === esfuerzoCrudo)) {
    throw new Error(`--esfuerzo=${esfuerzoCrudo} no existe. Son: ${ESFUERZOS.join(", ")}`);
  }
  const esfuerzo = esfuerzoCrudo as EsfuerzoAgente | undefined;
  // QUIÉN ESCRIBE ESTA CORRIDA. Ausente = como hoy: lo decide la imagen
  // (`writerForTurn`), que es lo que corre producción. Presente = se fija el
  // papel, igual que cuando alguien elige en el selector de Crear.
  //
  // POR QUÉ EXISTE: para poder poner los MISMOS briefs delante de los dos
  // escritores y ENSEÑAR LAS PÁGINAS. Sin esta bandera la pregunta «¿escribe
  // mejor V4.1 sin imagen?» no se podía ni formular — el papel lo decidía la
  // imagen y sin imagen siempre salía el razonador.
  //
  // Se valida contra el MISMO vocabulario que usa el turno, y por la misma razón
  // que `--esfuerzo`: una errata en la bandera de una corrida DE PAGO no puede
  // convertirse en «sin fijar» en silencio, porque entonces los dos brazos
  // medirían lo mismo y se compararían como si fueran distintos.
  const escritorCrudo = flag("escritor")?.trim();
  if (escritorCrudo !== undefined && !ESCRITORES_ELEGIBLES.some((e) => e === escritorCrudo)) {
    throw new Error(
      `--escritor=${escritorCrudo} no existe. Son: ${ESCRITORES_ELEGIBLES.join(", ")}`,
    );
  }
  const escritor = escritorCrudo as TurnWriter | undefined;
  // El brazo, tal como se lanzó. Va al nombre del marcador Y dentro de él: ver
  // `lib/evals/guardar-marcador.ts`.
  const brazo: BrazoDeCorrida = { esfuerzo: esfuerzo ?? null, escritor: escritor ?? null, tag: tag || null, solo: solo ?? null, repeat };
  const base = PAGE_COHORT.filter(
    (c) => (!tag || c.tag === tag) && (!solo || solo.includes(c.id)),
  );
  if (base.length === 0) throw new Error(`no hay casos con tag=${tag ?? "*"} solo=${solo?.join(",") ?? "*"}`);
  // Las repeticiones son casos con id propio (`solar#2`) para que el informe
  // por caso siga funcionando sin tratarlas como un modo aparte.
  const cases: PageEvalCase[] =
    repeat === 1
      ? [...base]
      : base.flatMap((c) => Array.from({ length: repeat }, (_, k) => (k === 0 ? c : { ...c, id: `${c.id}#${k + 1}` })));

  // Aqui se resolvia un proveedor de Gemini para sacarle la clave, y se
  // abortaba con «pon OPENLEN_GENERATE_PROVIDER=gemini o quitalo». Con el
  // proveedor fuera (2026-08-28) no hay eleccion que comprobar: escribe
  // DeepSeek, y su credencial la valida el propio transporte.
  const rateKey: CreditRate = "deepseek-flash";
  const { input: IN_PER_M, output: OUT_PER_M } = creditRate(rateKey);
  const conImagen = cases.filter((c) => c.imagen).length;
  console.log(
    `motor: ${displayNameForRole("reasoner")} (Fireworks)` +
    ` · $${IN_PER_M}/M entrada · $${OUT_PER_M}/M salida`,
  );
  // Que se vea ANTES de gastar cuántos turnos van por el papel caro: el que
  // lee esta línea es quien decide si sigue.
  if (conImagen > 0) {
    const q = creditRate(creditRateForRole("visual_critic"));
    console.log(
      `  · ${conImagen} con referencia → papel con visión` +
      ` · $${q.input}/M entrada · $${q.output}/M salida`,
    );
  }

  // QUE EL LOG SE ETIQUETE SOLO. Dos corridas de este arnés sólo son
  // comparables si se sabe cuál llevaba postura, y un fichero de log sin esa
  // línea es indistinguible del otro brazo tres días después.
  console.log(
    esfuerzo === undefined
      ? "  · esfuerzo: SIN POSTURA — lo pone la tabla (control)"
      : `  · esfuerzo: ${esfuerzo} → ${presupuestoDeEsfuerzo(esfuerzo, 65_536)} al cable`,
  );

  const revision = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  // El costo sale del `usage` que reporta el proveedor en el resumen del
  // stream, no del hook de débito: `DebitFn` recibe `(userId, créditos)`, así
  // que leerle un objeto de uso daba 0 SIEMPRE — y un tope de gasto que no
  // puede dispararse es peor que no tener tope.
  let usd = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  // 🔴 SIN ESTO EL BRAZO NO PUEDE FALLAR. «La postura llego y no cambio nada» y
  // «la postura no llego» se leen igual en el marcador -un numero de fallos
  // parecido-, y sin esta cifra no hay forma de distinguirlas. Es la prueba de
  // que el experimento se ejecuto, separada de su resultado.
  let tokensPensados = 0;
  const noDebit = (async () => {}) as never;

  /**
   * La imagen del caso, leída del repo y pasada por LA PUERTA DE PRODUCCIÓN.
   *
   * `leerReferenciaAdjunta` es la que valida lo que sube un desconocido en el
   * cuerpo de la petición pública —tipo permitido, tope de 4 MB medido en bytes
   * DECODIFICADOS, alfabeto base64—. Usarla aquí en vez de construir el
   * `InlineImage` a mano es la misma regla que ya gobierna este fichero: medir
   * un camino más corto que el del producto sería medir otra cosa. Si algún día
   * la puerta rechaza este fichero, el caso se cae con un motivo, no en
   * silencio.
   */
  function referenciaDelCaso(c: PageEvalCase): readonly InlineImage[] {
    if (!c.imagen) return [];
    const ruta = join(process.cwd(), c.imagen);
    const mime = c.imagen.endsWith(".webp")
      ? "image/webp"
      : c.imagen.endsWith(".png")
        ? "image/png"
        : c.imagen.endsWith(".avif")
          ? "image/avif"
          : "image/jpeg";
    const leida = leerReferenciaAdjunta({
      mimeType: mime,
      dataBase64: readFileSync(ruta).toString("base64"),
    });
    if (!leida?.ok) {
      throw new Error(
        `[${c.id}] la referencia ${c.imagen} no pasó la puerta: ${leida?.motivo ?? "vacia"}`,
      );
    }
    return [leida.imagen];
  }

  /** Una pasada del modelo + las comprobaciones de forma de la ruta. */
  async function pass(
    messages: Message[],
    images: readonly InlineImage[] = [],
  ): Promise<{ html: string; trimmed: number } | null> {
    // 🔴 LAS OPCIONES DE LA RUTA, COPIADAS. Aquí ponía sólo `injectOpIds:
    // false`, así que el resto caía a los defectos del crate —`sanitize: true`
    // y `normalizeOnEnd: true`— y este arnés medía OTRO producto:
    //
    //   · SANEABA. El saneo del stream borra chunk a chunk los `<script>` que
    //     el modelo escribe. O sea que los casos cuya razón de existir es el
    //     JavaScript (`quiz`, `menu-precio`, `sorteo`) se medían con su
    //     JavaScript ya borrado. `quiz` llevaba fallando `calc` desde la línea
    //     base del 2026-08-21 por esto: en el documento quedaban los propios
    //     comentarios del modelo —«JavaScript: lógica del test»— señalando un
    //     bloque que ya no estaba.
    //   · Y NORMALIZABA. `normalizeOnEnd: true` corría la cadena born-canonical
    //     sobre la salida del modelo, que es exactamente lo que se retiró de
    //     producción el 2026-09-04 (`5bfb2272`).
    //
    // La cabecera de este fichero ya decía la regla —«medir un camino más corto
    // que el del producto sería medir otra cosa»— y el camino era más corto.
    const { stream, done } = generateHtmlStream(
      {
        messages,
        // Con referencia el turno lo escribe el PAPEL CON VISIÓN, no el
        // razonador — igual que en la ruta (`app/api/generate/route.ts`):
        // `writerForTurn(true)` lo decide y se cobra a la tarifa de ese papel.
        // Ausente cuando no hay imagen, para que los casos de texto salgan byte
        // a byte como antes.
        ...(images.length ? { images } : {}),
        userId: "evals-pages",
        htmlOpts: { injectOpIds: false, sanitize: false, normalizeOnEnd: false },
        maxOutputTokens: 65_536,
        temperature: 0.8,
        // Se OMITE cuando no hay bandera: ausente y `null` son cosas distintas
        // aqui abajo (`null` es «este papel no piensa»), y el control tiene que
        // salir por el camino de siempre.
        ...(esfuerzo !== undefined ? { esfuerzo } : {}),
        // Igual que arriba: se OMITE sin bandera, para que el control salga por
        // el camino de siempre.
        ...(escritor !== undefined ? { escritor } : {}),
      },
      { debit: noDebit },
    );
    const reader = stream.getReader();
    for (;;) { const { done: d } = await reader.read(); if (d) break; }
    const s = await done;
    if (s.usage) {
      // 🔴 LA TARIFA ES LA DE QUIEN CORRIÓ ESTE TURNO, no una constante del
      // fichero. Un turno CON referencia lo escribe el papel con visión:
      // sumarlo a tarifa del razonador dejaría `--max-mxn` calculado sobre el
      // precio de otro modelo, que es justo lo que la cabecera de este fichero
      // dice que no es un tope. Hoy los dos coinciden; se pregunta igual,
      // porque el día que dejen de coincidir nadie va a venir a esta línea.
      const tarifa = images.length
        ? creditRate(creditRateForRole("visual_critic"))
        : { input: IN_PER_M, output: OUT_PER_M };
      tokensIn += s.usage.inputTokens;
      tokensOut += s.usage.outputTokens;
      tokensPensados += s.usage.thinkingTokens;
      usd += (s.usage.inputTokens * tarifa.input + s.usage.outputTokens * tarifa.output) / 1_000_000;
    }
    if (!s.finalHtml) return null;
    const html = extractDocument(s.finalHtml);
    if (html.length < 1000) return null;
    if (!/^\s*<!doctype/i.test(html)) return null;
    if (!/<\/html>\s*$/i.test(html)) return null;
    if (detectSlotPath(html)) return null;
    // ⚰️ Aquí viajaba la prueba que el modelo declaraba. Se retiró de crear el
    // 2026-09-05 con su bloque del prompt, y el arnés la retira DETRÁS por la
    // misma regla que la trajo: medir un camino que el producto ya no tiene es
    // medir otra cosa.
    return {
      html,
      trimmed: s.finalHtml.length - html.length,
    };
  }

  async function runCase(c: PageEvalCase): Promise<PageVerdict> {
    const started = Date.now();
    const briefBlock = `BRIEF:\n${c.brief}`;
    const messages: Message[] = [
      { role: "system", content: generateSystemMessage(process.env) },
      { role: "user", content: `${todayLine()}${LANGUAGE_RULE}${briefBlock}` },
    ];

    const referencias = referenciaDelCaso(c);

    let attempts = 1;
    let got = await pass(messages, referencias);
    if (!got) { attempts = 2; got = await pass(messages, referencias); }
    if (!got) {
      return judgePage({ id: c.id, attempts: 0, trimmed: 0, ms: Date.now() - started }, c);
    }

    // Misma firma que la de la ruta (`app/api/generate/route.ts`).
    const engine = (h: string) =>
      preparePage(h, {
        mode: "create",
        brief: c.brief,
        title: c.id,
      });
    // Cuál de los dos intentos acabó entregándose. `prepared` puede ser el
    // reintento, y lo que se mida tiene que ser de la página ENTREGADA.
    let entregada = got;
    let prepared = await engine(got.html);
    if (!prepared.ok) {
      return judgePage({ id: c.id, attempts, trimmed: got.trimmed, gateCode: prepared.code, ms: Date.now() - started }, c);
    }

    // Regeneración por rotura MEDIDA, igual que la ruta: se entrega la menos
    // rota, no la más reciente.
    if (prepared.report.breakage.length > 0) {
      const fixed = await pass([
        { role: "system", content: generateSystemMessage(process.env) },
        { role: "user", content: `<measured-breakage>\nEl navegador renderizó tu página anterior y midió esto:\n${prepared.report.breakage.map((r) => `- ${r}`).join("\n")}\n\nEscribe la página de nuevo sin esos defectos. No son opiniones: son medidas del render.\n</measured-breakage>\n\n${briefBlock}` },
      ]);
      if (fixed) {
        const second = await engine(fixed.html);
        if (second.ok && second.report.breakage.length <= prepared.report.breakage.length) {
          prepared = second;
          entregada = fixed;
        }
      }
    }

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${c.id}.html`), prepared.html);

    // Se vuelve a compilar sobre la página YA preparada — es idempotente, y
    // devuelve lo único determinista que se puede afirmar de un cálculo:
    // cuántas fórmulas quedaron vivas y cuántas nacieron muertas.
    // `preparePage` en modo crear AVISA en vez de rechazar, así que una fórmula
    // rota SÍ llega hasta aquí y tiene que contarse.
    // LA MEDIDA DE UNA PÁGINA YA PREPARADA. Sale a una función porque ahora
    // la corren DOS: la portada y cada subpágina que ella declaró. Una
    // subpágina se mide con la MISMA vara — el usuario pagó por ella igual.
    const medir = async (
      html: string,
      id: string,
      attempts: number,
      trimmed: number,
      desde: number,
    ): Promise<PageMeasurement> => {
    const calc = compileCalcRegions(html);
    const rendered = await renderVisualQualityViewports(html).catch(() => null);
    const htmlTag = /<html\b([^>]*)>/i.exec(html)?.[1] ?? "";
    return {
      id,
      attempts,
      trimmed,
      ...(rendered ? {
        mobileOverflow: rendered.mobileOverflow,
        invalidGeometry: rendered.invalidGeometry,
        typographyRule: rendered.weakTypographyHierarchy ? (rendered.typographyHierarchy?.rule ?? "?") : null,
        unreadable: rendered.unreadableText?.length ?? 0,
        // El botón que no hace nada. Se cuentan DESTINOS, no enlaces: seis
        // «Comprar» al mismo `#comprar` inexistente son UN defecto, no seis.
        deadAnchors: rendered.deadAnchors?.length ?? 0,
        ...(rendered.deadAnchors?.length
          ? {
              deadAnchorWorst: [...rendered.deadAnchors].sort((a, b) => b.veces - a.veces)[0]!
                .destino,
            }
          : {}),
      } : {}),
      h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
      lang: /lang="([^"]*)"/i.exec(htmlTag)?.[1] ?? "",
      dir: /dir="([^"]*)"/i.exec(htmlTag)?.[1] ?? "",
      bytes: html.length,
      calcFormulas: calc.compiled,
      calcIssues: calc.issues.length,
      // ⚰️ Aquí se contaban los pasos de la prueba declarada y sus fallos. Se
      // fue con la prueba: sin bloque en el prompt no hay promesa que contar.
      ms: Date.now() - desde,
    };
    };

    // Las páginas que la PORTADA dice que existen, con la misma función que
    // usa la ruta. En los diecisiete casos de una sola página esto es `{}` y
    // nada de lo de abajo llega a correr.
    const armazones = construirPaginasDeclaradas(prepared.html);
    const m: PageMeasurement = {
      ...(await medir(prepared.html, c.id, attempts, got.trimmed, started)),
      declaredPages: Object.keys(armazones).length,
    };

    // EL MISMO BUCLE QUE LA RUTA: una llamada por página declarada, SIN
    // reintento —la ruta tampoco lo tiene: se queda con el armazón— y la misma
    // tubería `preparePage`. Y corre para TODOS los casos, no sólo para el que
    // declara `expectPages`: en producción quien lo dispara es la portada, no
    // el brief, así que capar el bucle al caso que lo espera mediría otra cosa.
    const subpages: SubpageVerdict[] = [];
    for (const [slug, armazon] of Object.entries(armazones)) {
      const nombre = armazon.title ?? slug;
      const arranco = Date.now();
      const sid = `${c.id}/${slug}`;
      const escrita = await pass([
        { role: "system", content: generateSystemMessage(process.env) },
        {
          role: "user",
          content: subpaginaPrompt({ portada: prepared.html, slug, nombre, briefBlock }),
        },
      ]);
      if (!escrita) {
        subpages.push({
          slug,
          failures: ["shape"],
          measurement: { id: sid, attempts: 0, trimmed: 0, ms: Date.now() - arranco },
        });
        continue;
      }
      const listo = await preparePage(escrita.html, { mode: "create", brief: c.brief, title: nombre });
      if (!listo.ok) {
        subpages.push({
          slug,
          failures: ["gate"],
          measurement: { id: sid, attempts: 1, trimmed: escrita.trimmed, gateCode: listo.code, ms: Date.now() - arranco },
        });
        continue;
      }
      writeFileSync(join(OUT_DIR, `${c.id}__${slug}.html`), listo.html);
      // ¿Cuánto de esta página ya estaba en la portada? El prompt se lo
      // prohíbe y nadie lo comprobaba. Se GUARDA, no juzga: ningún
      // `FailureCode` lee esto todavía.
      const rep = repeticionDePortada(prepared.html, listo.html);
      const sm: PageMeasurement = {
        ...(await medir(listo.html, sid, 1, escrita.trimmed, arranco)),
        repeatedFromHome: rep.repetidos,
        repeatedRun: rep.rachaMaxima,
        ...(rep.peor ? { repeatedWorst: rep.peor } : {}),
      };
      // Sin `expectPages`: una subpágina no declara páginas. El idioma y la
      // escritura sí se le exigen igual que a la portada.
      const sv = judgePage(sm, {
        expectLang: c.expectLang,
        ...(c.expectRtl ? { expectRtl: c.expectRtl } : {}),
      });
      subpages.push({ slug, failures: sv.failures, measurement: sm });
    }

    // 🔴 EL RELOJ DE LA FILA CUBRE EL CASO ENTERO, no sólo la portada.
    // `medir` paró el suyo ANTES del bucle, así que la primera corrida con
    // subpáginas imprimió «42s» sobre un caso que tardó 170: las tres páginas
    // —51s, 44s y 32s— caían fuera del número. Un tiempo que se queda corto en
    // la superficie donde se decide si algo va lento miente en la dirección
    // peor.
    const veredicto = judgePage({ ...m, ms: Date.now() - started }, c);
    return subpages.length > 0 ? { ...veredicto, subpages } : veredicto;
  }

  console.log(`${cases.length} casos · ${PAGE_COHORT_VERSION} · tope ${maxMxn} MXN\n`);
  const verdicts: PageVerdict[] = [];
  let aborted = false;
  for (const c of cases) {
    if (usd * USD_TO_MXN > maxMxn) {
      console.log(`ABORTADO antes de ${c.id} — ${(usd * USD_TO_MXN).toFixed(2)} MXN supera el tope`);
      aborted = true;
      break;
    }
    const v = await runCase(c);
    verdicts.push(v);
    // La fila la manda `caseClean`, no `v.failures`: una portada impecable con
    // `/servicios` roto NO es un caso limpio.
    const mark = caseClean(v) ? "ok  " : "FALL";
    // Y lo que se imprime del fallo es EL PEOR, con su sitio — la columna NOTES
    // de `plugin eval`. El resto no se pierde: el marcador JSON los lleva
    // todos, y aquí se dice cuántos más hay para que nadie crea que es uno.
    const otros =
      v.failures.length + (v.subpages ?? []).reduce((a, sp) => a + sp.failures.length, 0) - 1;
    console.log(
      `${mark} ${v.id.padEnd(16)} ${String(Math.round(v.measurement.ms / 1000)).padStart(3)}s` +
      `${v.measurement.attempts > 1 ? " reintento" : ""}` +
      `${v.measurement.trimmed > 0 ? ` recorte:${v.measurement.trimmed}` : ""}` +
      `${v.subpages?.length ? ` +${v.subpages.length} subpags` : ""}` +
      // La repetición se IMPRIME a partir de racha 2: en racha 1 lo medido
      // fueron la dirección y el horario, que repetirlos es correcto. El JSON
      // se los queda todos igualmente — el umbral es de pantalla, no de juicio.
      `${(() => {
        const peor = (v.subpages ?? []).reduce((a, sp) => Math.max(a, sp.measurement.repeatedRun ?? 0), 0);
        return peor >= 2 ? `  · repite portada: racha ${peor}` : "";
      })()}` +
      `${caseClean(v) ? "" : `  → ${worstFailure(v)}${otros > 0 ? ` (+${otros})` : ""}`}`,
    );
  }

  const next = buildScorecard({
    cohortVersion: PAGE_COHORT_VERSION,
    revision,
    at: new Date().toISOString(),
    brazo,
    verdicts,
    costMxn: Number((usd * USD_TO_MXN).toFixed(2)),
    partial: aborted || verdicts.length !== PAGE_COHORT.length,
  });

  if (repeat > 1) {
    console.log("");
    console.log("tasa por caso (lo único interpretable con un modelo no determinista):");
    for (const c of base) {
      const suyos = verdicts.filter((v) => v.id === c.id || v.id.startsWith(`${c.id}#`));
      const limpios = suyos.filter((v) => v.failures.length === 0).length;
      const motivos = [...new Set(suyos.flatMap((v) => v.failures))];
      console.log(
        `  ${c.id.padEnd(16)} ${limpios}/${suyos.length}` +
        (motivos.length ? `   (${motivos.join(", ")})` : ""),
      );
    }
  }

  let prev: Scorecard | null = null;
  try { prev = JSON.parse(readFileSync(BASELINE, "utf8")) as Scorecard; } catch { prev = null; }
  const cmp = compareScorecards(prev, next);

  console.log(`\n${next.clean}/${next.pages} limpias · reintentos ${next.retried} · recortes ${next.trimmed} · ${next.costMxn} MXN`);
  // LA PRUEBA DE QUE EL EXPERIMENTO SE EJECUTÓ, separada de su resultado. Un
  // brazo con postura y `pensados=0` no es «pensar no sirve»: es que la postura
  // no llegó, y sin esta línea las dos conclusiones se escriben igual.
  console.log(
    `tokens: ${tokensIn} entrada · ${tokensOut} salida · ${tokensPensados} PENSADOS` +
      (esfuerzo === undefined
        ? "  (sin postura: 0 es lo correcto)"
        : tokensPensados === 0
          ? "  🔴 CON POSTURA Y CERO PENSADOS — la postura NO llegó al cable"
          : ""),
  );
  if (Object.keys(next.byCode).length) {
    console.log(`fallos: ${Object.entries(next.byCode).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }

  // ⚰️ LA LÍNEA DE LA PRUEBA DECLARADA, retirada con la prueba (2026-09-05).
  //
  // Contaba cuántas páginas se atrevían a prometer algo y cuántas incumplían.
  // Era observación, no veredicto — y sin bloque en el prompt no hay promesa.
  // Lo que la sustituye no es otro contador: es que el prompt pesa 3.041 bytes
  // menos y esta corrida mide eso.
  if (cmp.comparable) {
    console.log(`vs ${prev!.revision.slice(0, 8)}: ${cmp.delta! >= 0 ? "+" : ""}${cmp.delta} limpias`);
    if (cmp.regressed.length) console.log(`  REGRESIÓN: ${cmp.regressed.join(", ")}`);
    if (cmp.fixed.length) console.log(`  arregladas: ${cmp.fixed.join(", ")}`);
  } else {
    console.log(prev ? "el conjunto cambió de versión — no comparable" : "primera corrida — no hay con qué comparar");
  }

  // 🔴 CADA CORRIDA, SU FICHERO. Aquí se escribía `page-scorecard-<revisión>.json`
  // y dos corridas sobre la misma revisión se pisaban: del control 16×3 del
  // experimento de esfuerzo (44/48) no queda fichero, y de `56cc29f1` sólo el
  // brazo con razonamiento. Ahora el nombre lleva brazo e instante, el brazo va
  // dentro del JSON y la escritura no sobrescribe nunca — ver
  // `lib/evals/guardar-marcador.ts`.
  const marcador = guardarMarcador(OUT_DIR, next);
  // Una corrida PARCIAL (--solo/--tag/--repeat) no puede pisar la línea base:
  // mide otro conjunto, y compararlo luego contra el cohorte entero daría un
  // delta inventado. Se guarda el marcador de la corrida y punto.
  //
  // Un brazo con `--esfuerzo` tampoco, por la misma razón con otra cara: mide
  // una postura que producción no corre —sin la bandera el esfuerzo lo pone la
  // tabla—, y la siguiente corrida de control se compararía contra el
  // experimento en vez de contra el producto.
  // Un brazo con `--escritor` tampoco, por la misma razón que `--esfuerzo`:
  // mide un papel FIJADO, y producción sin imagen corre siempre el razonador.
  if (solo || tag || repeat > 1 || esfuerzo !== undefined || escritor !== undefined) {
    const porQue =
      escritor !== undefined
        ? "brazo con --escritor"
        : esfuerzo !== undefined
          ? "brazo con --esfuerzo"
          : "corrida parcial";
    console.log("");
    console.log(`${porQue} — la línea base NO se toca`);
  } else {
    writeFileSync(BASELINE, JSON.stringify(next, null, 2));
    console.log(`
→ línea base actualizada: lib/evals/baseline.json`);
  }
  console.log(`→ marcador: ${relative(process.cwd(), marcador)}`);

  // Una regresión tiene que romper la puerta de quien lo corra en CI.
  if (cmp.regressed.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
