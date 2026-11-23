// ¿EXISTEN LOS MODELOS QUE NOMBRA LA POLÍTICA, Y CUESTAN LO QUE DECIMOS?
//
// DOS PREGUNTAS, y las dos sólo las puede contestar el proveedor. La segunda se
// añadió el 2026-09-20 y tiene su propia explicación más abajo, junto al código
// que la hace; lo que sigue es la historia de la primera.
//
// POR QUÉ EXISTE. El 2026-08-27 el papel `visualCritic` quedó apuntando a
// `qwen3p7-plus`, que devuelve **404 NOT_FOUND** con la clave real. Se llevaba
// cuatro operaciones —los ojos de Len, crear mirando una referencia,
// `candidate_scouting` y `final_scoring`— y se descubrió **quince días después**,
// de rebote, porque un brazo de evals murió en el caso 49.
//
// NINGUNA PUERTA PODÍA HABERLO CAZADO, y eso es el hallazgo:
//
//   · `tsc` ve una cadena. Una cadena bien escrita que no existe compila igual.
//   · Las pruebas afirman QUÉ cadena hay, no que responda. La de
//     `model-policy.test.ts` estaba verde con el modelo muerto.
//   · El smoke del despliegue es `curl -sI http://127.0.0.1:3000/`. Un modelo
//     muerto no mueve ese 200 ni un poco: la home no habla con ningún modelo.
//   · Y el fallo en ejecución es BLANDO a propósito (`verify.ts` es fail-open,
//     y debe serlo — una caída del proveedor no puede tumbarle el turno a
//     nadie). Sale como un aviso amarillo entre otros avisos amarillos.
//
// O sea: cuatro capas de red y el agujero pasaba por las cuatro. La única
// comprobación posible es la que este fichero hace — PREGUNTARLE AL PROVEEDOR—,
// y no puede vivir en una prueba unitaria porque necesita red y credencial.
//
// LO QUE NO ES. No mide calidad, ni latencia, ni si el modelo sirve para su
// papel. Contesta si RESPONDE. Es la diferencia entre «este papel funciona mal»
// y «este papel no existe», y sólo la segunda es la que se disfraza de silencio.
//
//   npm run modelos:comprobar
//   npm run modelos:comprobar -- --ademas=accounts/fireworks/models/<candidato>
//
// Cuesta ~3 tokens de salida en total (`max_tokens: 1` por papel). A la tarifa
// de Flash eso es 0,000002 USD: no lleva puerta de gasto porque no hay gasto
// que frenar. El cotejo de tarifas es UNA descarga de una página pública: ni
// gasta tokens ni necesita credencial.
//
// ─── Y CADA PROVEEDOR DE CADA PAPEL (15/11) ──────────────────────────────────
//
// Hasta aquí este fichero sólo preguntaba a Fireworks, y desde el 17/10 el
// papel `agent` corría PRIMERO en DeepInfra con un id que nadie comprobaba. El
// 15/11 el razonador y el papel con visión se fueron también allí, así que se
// pregunta a los DOS proveedores de cada papel (`providers` en la política),
// cada uno con su clave: sin `DEEPINFRA_API_KEY` no se pasa en verde.
//
// Y una vez por proveedor, EL CABLE DE VERDAD de esos dos papeles: el cliente
// de producción (`createRoleStreamClient`) con lo que manda el papel con visión
// —una imagen (`public/icon-192.png`), `response_format: json_object` y
// `reasoning_effort: "none"`— y se exige que vea la imagen, que conteste JSON y
// que no piense. Son las tres cosas que este papel da por hechas y que un
// proveedor puede no hacer sin dar error. ~500 tokens de entrada y ~10 de
// salida por proveedor: menos de 0,0003 USD la pasada entera.
//
// SALE 1 SI ALGUNO NO RESPONDE O ALGUNA TARIFA NO CUADRA, para que sirva de
// puerta en el despliegue.
//
// `--ademas=` comprueba modelos que NO están en la política. Tiene dos usos y
// los dos son reales: sondear un candidato ANTES de escribirlo en la tabla, y
// —el que lo justificó— poder verificar que esta comprobación sabe decir que
// NO. Una puerta que sólo se ha visto en verde no está verificada: está sin
// mirar, que es el mismo defecto que persigue.

import { readFileSync } from "node:fs";
import path from "node:path";

import { deepinfraListPrice, deepinfraServesItself, policyModels, tariffedProvider, type PolicyModel } from "@/lib/ai/policy-models";
import { PROVIDER_DIALECTS, type ProviderId } from "@/lib/ai/providers";
import { createRoleStreamClient } from "@/lib/ai/role-stream-client";
import { TARIFAS_POR_MILLON, type TarifaPorMillon } from "@/lib/ai/tarifas";
import { MODEL_POLICY } from "@/lib/generation/model-policy";

// LOS MODELOS DISTINTOS QUE NOMBRA LA POLÍTICA, POR PROVEEDOR (lib/ai/policy-models.ts). Hasta el 2026-11-15
// todos eran de Fireworks y esto sólo hablaba con Fireworks; el juez de Len-Bench es de DeepInfra, y el papel
// `agent` corre primero en DeepInfra: se pregunta a cada proveedor por lo suyo. Se deduplica porque dos papeles
// pueden compartir modelo y preguntar dos veces no dice nada nuevo; el papel viaja al lado para que el fallo
// nombre lo que se rompe.

async function responde(
  provider: ProviderId,
  modelId: string,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; detalle: string }> {
  let r: Response;
  try {
    r = await fetch(PROVIDER_DIALECTS[provider].endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      // El aviso más corto que el proveedor acepta. No se lee la respuesta: lo
      // que se comprueba es que el modelo EXISTA y sea alcanzable con esta
      // clave, y eso ya lo contesta el código HTTP.
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });
  } catch (e) {
    // Un fallo de red no es un modelo muerto. Se dice distinto a propósito:
    // confundirlos mandaría a alguien a cambiar la política por un wifi caído.
    return { ok: false, detalle: `sin red: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (r.ok) return { ok: true };
  let cuerpo = "";
  try {
    cuerpo = (await r.text()).slice(0, 200);
  } catch {
    /* sin cuerpo */
  }
  return { ok: false, detalle: `http_${r.status}${cuerpo ? `: ${cuerpo}` : ""}` };
}

/** El cable del papel con visión en UN proveedor, por el cliente de producción. `null` = todo bien. */
async function cableDelPapelQueMira(provider: ProviderId): Promise<string | null> {
  const imagen = readFileSync(path.join(process.cwd(), "public", "icon-192.png")).toString("base64");
  // El proveedor que se prueba y ningún otro: la palanca del operador no lo desvía y no hay respaldo.
  const client = createRoleStreamClient({ env: { ...process.env, OPENLEN_AGENT_PROVIDERS: provider }, providers: [provider] });
  let texto = "";
  let pensado = 0;
  let servido: string | undefined;
  let fin = "sin final";
  try {
    for await (const ev of client.stream({
      messages: [
        { role: "system", content: "You check whether an image reached you. Answer with JSON only." },
        { role: "user", content: 'Is there an image attached to this message? Answer {"image": true} or {"image": false}.' },
      ],
      images: [{ mimeType: "image/png", dataBase64: imagen }],
      jsonObject: true,
      maxOutputTokens: 24,
      temperature: 0,
      requestId: "modelos-comprobar",
      operation: "candidate_scouting",
    })) {
      if (ev.type === "text_delta") texto += ev.text;
      else if (ev.type === "reasoning_delta") pensado += ev.text.length;
      else if (ev.type === "usage") {
        servido = ev.provider;
        pensado += ev.thinkingTokens;
      } else if (ev.type === "done") {
        fin = ev.stopReason.kind === "error" ? `error: ${ev.stopReason.error.slice(0, 200)}` : ev.stopReason.kind;
      }
    }
  } catch (e) {
    return `sin red: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (fin !== "end_turn") return `no terminó limpio (${fin})`;
  if (servido !== provider) return `lo sirvió «${servido ?? "nadie"}», no ${provider}`;
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return `«response_format: json_object» no dio JSON: ${JSON.stringify(texto.slice(0, 120))}`;
  }
  if ((json as { image?: unknown } | null)?.image !== true) return `no vio la imagen: contestó ${JSON.stringify(json)}`;
  if (pensado > 0) return `pensó con «reasoning_effort: none» (${pensado}): cada llamada del papel pagaría ese pensamiento`;
  return null;
}

// ─── ¿Y CUESTA LO QUE CREEMOS? ───────────────────────────────────────────────
//
// LA SEGUNDA PREGUNTA QUE SÓLO CONTESTA EL PROVEEDOR, añadida el 2026-09-20.
//
// Este fichero decía de sí mismo «contesta UNA pregunta: ¿responde?». Ocho días
// antes, el 2026-09-12, los papeles `agent` y `visualCritic` habían pasado a
// `deepseek-v4p1-flash` con la tarifa de V4 Flash escrita al lado y un
// comentario afirmando que costaban lo mismo. No cuestan lo mismo: la salida de
// V4.1 es 1,82x. Se cobró y se midió mal ocho días.
//
// NINGUNA PUERTA PODÍA CAZARLO, por la misma razón que la de arriba:
//
//   · `tsc` ve un número. Un número bien escrito que es falso compila igual.
//   · La prueba que existía comparaba la tarjeta de presupuesto contra
//     `lib/credits.ts` — dos COPIAS del mismo número equivocado. Verde.
//   · El modelo respondía perfectamente: esta misma comprobación lo daba por
//     bueno, porque un precio mal escrito no es un 404.
//
// ⚰️ EL PRIMER INTENTO FUE POR API Y NO SIRVE. La doc anuncia el precio en
// `serverlessModes[].skuInfos[]` del catálogo («sourced live from Orb on
// read»), así que se escribió contra eso. MEDIDO el 2026-09-20 con la clave
// real: el campo existe y viene **vacío** (`serverlessModes: []`) aun con
// `supportsServerless: true`, en los dos modelos, con y sin `readMask`. Y
// `/inference/v1/models` no trae nada de precio. O sea que el precio no se
// expone a esta cuenta — la doc describe un campo que a nosotros nos llega en
// blanco. Se deja escrito para que nadie vuelva a gastar la tarde.
//
// LA FUENTE ES LA PÁGINA PUBLICADA, en su versión markdown:
// `docs.fireworks.ai/serverless/pricing.md` — 8 KB de tabla limpia, sin SPA ni
// credencial. Es LA MISMA fuente que los comentarios del repo llevan citando
// desde el 2026-08-28; la diferencia es que ahora la lee un programa.
//
// ⚠️ OJO A LAS FILAS REGIONALES. Cada modelo puede tener una fila «(US)» con el
// MISMO enlace y otro precio —V4.1 Flash (US) está a $0.45/$1.80, un 50% más—,
// así que emparejar por id da dos filas. Se rechazan explícitamente y se exige
// que quede UNA. Desde 2026-11-03 también está la fila Ultra-fast (Preview),
// otro modo que este cliente no solicita, y desde el 2026-11-23 la fila Flex
// (mitad de precio, se pide por petición; nuestro cliente sólo manda estándar o
// Priority). Se excluyen esos sufijos documentados; cualquier otra variante
// desconocida sigue poniendo la puerta en rojo.
//
// LO QUE NO ES. No mide gasto real ni factura; lee el PRECIO DE LISTA que
// publica el proveedor. Si algún día hay tarifa contratada, esto dejará de ser
// la autoridad y habrá que decirlo aquí.
//
// SALE 1 SI ALGUNA TARIFA NO CUADRA, igual que con los modelos muertos.

const PAGINA_PRECIOS = "https://docs.fireworks.ai/serverless/pricing.md";

interface FilaDePrecio {
  readonly etiqueta: string;
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

/** `\$0.30 / \$0.006 / \$1.20` → los tres números. La barra invertida es del
 *  markdown (escapa el dólar), no del precio. */
function tresPrecios(celda: string): [number, number, number] | null {
  const n = [...celda.matchAll(/\\?\$\s*([\d.]+)/g)].map((m) => Number(m[1]));
  if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return null;
  return [n[0]!, n[1]!, n[2]!];
}

/** Todas las filas de la tabla, indexadas por el ÚLTIMO segmento del enlace,
 *  que es el id corto del modelo. Un id puede traer varias filas (variantes
 *  regionales), así que el valor es una lista y quien pregunta decide. */
async function tablaPublicada(): Promise<Map<string, FilaDePrecio[]> | string> {
  let r: Response;
  try {
    r = await fetch(PAGINA_PRECIOS, { headers: { accept: "text/plain,text/markdown,*/*" } });
  } catch (e) {
    return `sin red: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!r.ok) return `la página de precios respondió http_${r.status}`;
  const md = await r.text();

  const porId = new Map<string, FilaDePrecio[]>();
  for (const linea of md.split("\n")) {
    if (!linea.startsWith("|")) continue;
    const m = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|([^|]*)\|/.exec(linea);
    if (!m) continue;
    const [, etiqueta, enlace, estandar] = m;
    const id = enlace!.split("/").pop()?.trim();
    if (!id) continue;
    const p = tresPrecios(estandar!);
    if (!p) continue; // filas con «—» en estándar: no hay vía que cotejar
    const previas = porId.get(id) ?? [];
    porId.set(id, [...previas, { etiqueta: etiqueta!.trim(), input: p[0], cached: p[1], output: p[2] }]);
  }
  if (porId.size === 0) return "no se pudo leer NINGUNA fila: ¿cambió el formato de la página?";
  return porId;
}

type Cotejo = { ok: true } | { ok: false; detalle: string };

function cotejaUno(
  modelId: string,
  esperada: TarifaPorMillon,
  tabla: Map<string, FilaDePrecio[]>,
): Cotejo {
  const corto = modelId.split("/").pop() ?? modelId;
  const todas = tabla.get(corto);
  if (!todas || todas.length === 0) return { ok: false, detalle: `no aparece en la página de precios (id corto «${corto}»)` };

  // Mismo enlace, distinta región o modo. Nunca elegir por el precio que coincida.
  const globales = todas.filter((f) => !/\(\s*[A-Z]{2}\s*\)\s*$/.test(f.etiqueta)
    && !/\sUltra-fast\s+\(Preview\)\s*$/i.test(f.etiqueta)
    && !/\sFlex\s*$/i.test(f.etiqueta));
  if (globales.length !== 1) {
    return {
      ok: false,
      detalle:
        `${todas.length} fila(s) con este id y ${globales.length} estándar globales ` +
        `(${todas.map((f) => f.etiqueta).join(" · ")}): no adivino cuál es la nuestra`,
    };
  }
  const suya = globales[0]!;
  return cotejaTarifa(esperada, suya, suya.etiqueta);
}

/** La lista pública de modelos de DeepInfra: el precio de lista de cada uno, sin clave (spec local
 *  2026-11-12-len-3-1-ruta, §7.1). */
const LISTA_DE_DEEPINFRA = "https://api.deepinfra.com/models/list";

/** Eje por eje, la nuestra contra la suya. */
function cotejaTarifa(esperada: TarifaPorMillon, suya: TarifaPorMillon, etiqueta: string): Cotejo {
  const dif: string[] = [];
  const eje = (nombre: string, nuestro: number | undefined, suyo: number): void => {
    if (nuestro === undefined) {
      dif.push(`${nombre}: nosotros no la tenemos, ellos ${suyo}`);
      return;
    }
    // Una millonésima de tolerancia: por debajo es coma flotante, no un cambio
    // de precio.
    if (Math.abs(nuestro - suyo) > 1e-6) dif.push(`${nombre}: nosotros ${nuestro}, ellos ${suyo}`);
  };
  eje("entrada", esperada.input, suya.input);
  eje("cacheada", esperada.cached, suya.cached);
  eje("salida", esperada.output, suya.output);

  return dif.length === 0 ? { ok: true } : { ok: false, detalle: `«${etiqueta}» · ${dif.join(" · ")}` };
}

async function main(): Promise<void> {
  const modelos: PolicyModel[] = policyModels();
  // `--ademas=` es un modelo de Fireworks fuera de la política (un candidato, o probar que esto sabe decir NO).
  for (const arg of process.argv.filter((a) => a.startsWith("--ademas="))) {
    const id = arg.slice("--ademas=".length).trim();
    if (id) modelos.push({ provider: "fireworks", modelId: id, roles: ["pedido a mano"] });
  }
  // Sin la clave de un proveedor que la política nombra NO se pasa en verde. Una comprobación que se salta
  // sola cuando le falta algo es peor que no tenerla: da el visto bueno sin haber mirado, que es exactamente
  // la forma del defecto que este fichero persigue.
  const claves = new Map<ProviderId, string>();
  for (const provider of new Set(modelos.map((m) => m.provider))) {
    const env = PROVIDER_DIALECTS[provider].apiKeyEnv;
    const clave = process.env[env]?.trim();
    if (!clave) {
      console.error(`${env} no está y la política nombra modelos de ${provider} — no se puede comprobar. Esto NO es un pase.`);
      process.exit(1);
    }
    claves.set(provider, clave);
  }
  console.log(`comprobando ${modelos.length} modelos…\n`);

  const muertos: string[] = [];
  for (const m of modelos) {
    const r = await responde(m.provider, m.modelId, claves.get(m.provider)!);
    const quien = m.roles.join(", ");
    if (r.ok) {
      console.log(`  ok    ${m.provider}/${m.modelId}  (${quien})`);
    } else {
      console.log(`  MUERTO ${m.provider}/${m.modelId}  (${quien})`);
      console.log(`         ${r.detalle}`);
      muertos.push(`${m.provider}/${m.modelId} — lo piden: ${quien}`);
    }
  }

  // ── El cable del papel con visión, en cada uno de SUS proveedores ─────────────
  //
  // Arriba se preguntó que cada modelo exista; aquí, que el proveedor haga lo que este papel da por hecho.
  // Sin la clave de alguno ya se salió arriba.
  console.log("\nel cable del papel con visión (imagen + JSON + sin pensar), por el cliente de producción…\n");
  for (const provider of new Set(MODEL_POLICY.visualCritic.providers.map((p) => p.provider))) {
    const fallo = await cableDelPapelQueMira(provider);
    if (fallo === null) {
      console.log(`  ok    ${provider}: ve la imagen, contesta JSON, no piensa`);
    } else {
      console.log(`  ROTO  ${provider}: ${fallo}`);
      muertos.push(`${provider} — el cable del papel con visión: ${fallo}`);
    }
  }

  // ── Las tarifas ────────────────────────────────────────────────────────────
  //
  // Sólo de los papeles: un modelo pedido con `--ademas` no tiene tarifa
  // nuestra que cotejar, y los muertos ya se reportan arriba. Se recorre la
  // POLÍTICA porque es quien empareja modelo con `creditRate` — el mismo
  // emparejamiento que se cobra.
  console.log("\ncotejando tarifas contra la tabla publicada…\n");
  const desviadas: string[] = [];
  // Una sola descarga para todos. Si ni eso se puede, es un fallo de la
  // comprobación entera y se dice así — no se pasa modelo a modelo en verde.
  const tabla = await tablaPublicada();
  if (typeof tabla === "string") {
    console.error(`🔴 no se pudo leer ${PAGINA_PRECIOS}: ${tabla}`);
    console.error("   Esto NO es un pase: no se ha cotejado ninguna tarifa.");
    process.exit(1);
  }
  // La tarifa de un papel se coteja donde sale su `creditRate`: Fireworks (su página de precios) o DeepInfra
  // (la lista pública de su API, una descarga sin clave, sólo si algún papel la necesita).
  let listaDeDeepinfra: unknown = null;
  const ajenos: string[] = [];
  const vistos = new Set<string>();
  for (const [papel, cfg] of Object.entries(MODEL_POLICY)) {
    if (vistos.has(cfg.modelId)) continue;
    vistos.add(cfg.modelId);
    const nuestra: TarifaPorMillon = TARIFAS_POR_MILLON[cfg.creditRate];
    let c: Cotejo;
    if (tariffedProvider(cfg) === "deepinfra") {
      listaDeDeepinfra ??= await fetch(LISTA_DE_DEEPINFRA).then((r) => (r.ok ? r.json() : `http_${r.status}`)).catch((e: unknown) => `sin red: ${e instanceof Error ? e.message : String(e)}`);
      const suya = deepinfraListPrice(listaDeDeepinfra, cfg.modelId);
      c = typeof suya === "string" ? { ok: false, detalle: suya } : cotejaTarifa(nuestra, suya, `${cfg.modelId} en DeepInfra`);
      // Quien lo sirve, además de lo que cuesta: un modelo de socio se lo pasa DeepInfra a otro, y lo que lee
      // (el juez lee pedidos y páginas de clientes) sale hacia él y pasa su moderación (15/11, Qwen3.8-Flash).
      const sirve = deepinfraServesItself(listaDeDeepinfra, cfg.modelId);
      if (sirve !== true) {
        console.log(`  AJENO ${cfg.modelId}  (lo pide ${papel})`);
        console.log(`         ${sirve}`);
        ajenos.push(`${cfg.modelId} — ${sirve}`);
      }
    } else {
      c = cotejaUno(cfg.modelId, nuestra, tabla);
    }
    if (c.ok) {
      console.log(`  ok    ${cfg.modelId}  (${cfg.creditRate})`);
    } else {
      console.log(`  DERIVA ${cfg.modelId}  (${cfg.creditRate}, lo pide ${papel})`);
      console.log(`         ${c.detalle}`);
      desviadas.push(`${cfg.modelId} — ${cfg.creditRate}: ${c.detalle}`);
    }
  }

  if (desviadas.length > 0) {
    // El daño, no sólo el fallo: una tarifa vieja no rompe nada visible, cobra
    // mal en silencio y deja el tope de gasto de las evals midiendo con una
    // regla corta. La última vez fueron ocho días y 1,82x de salida.
    console.error(
      `\n🔴 ${desviadas.length} tarifa(s) NO cuadran con el proveedor:\n` +
        desviadas.map((d) => `   · ${d}`).join("\n") +
        "\n\nEsto NO se nota solo: un precio viejo no rompe ninguna pantalla — cobra" +
        "\nde menos (o de más) y deja el tope de gasto de las evals mintiendo." +
        "\nLa tabla es `lib/ai/tarifas.ts`, y es la única copia: corrígela ahí.",
    );
  }

  if (ajenos.length > 0) {
    console.error(
      `\n🔴 ${ajenos.length} modelo(s) que DeepInfra no sirve: se los pasa a un socio:\n` +
        ajenos.map((d) => `   · ${d}`).join("\n") +
        "\n\nLo que leen sale de DeepInfra hacia ese socio y pasa por su moderación, que" +
        "\npuede negarse a contestar a media corrida. Elige uno que DeepInfra sirva" +
        "\n(`is_partner: false` en su lista) en `lib/generation/model-policy.ts`.",
    );
  }

  if (muertos.length === 0 && desviadas.length === 0 && ajenos.length === 0) {
    console.log("\nlos modelos de la política responden, y cuestan lo que decimos.");
    return;
  }
  if (muertos.length === 0) process.exit(1);

  // El mensaje dice el DAÑO, no sólo el fallo. Quien vea esto por primera vez
  // no tiene por qué saber que un papel muerto no se nota en ejecución.
  // «de la política» sólo si lo es: con `--ademas` el muerto puede ser un
  // candidato que ni siquiera está en la tabla, y mandar a alguien a arreglar
  // `MODEL_POLICY` por eso sería enviarlo al fichero equivocado.
  console.error(
    `\n🔴 ${muertos.length} modelo(s) NO responden:\n` +
      muertos.map((m) => `   · ${m}`).join("\n") +
      "\n\nSi alguno lo pide un PAPEL, esto NO se va a notar solo: las" +
      "\nsuperficies que usan un papel muerto fallan BLANDO —el turno cierra con" +
      "\nun aviso amarillo— y la última vez tardó quince días en salir a la luz." +
      "\nArregla `MODEL_POLICY` antes de desplegar.",
  );
  process.exit(1);
}

void main();
