// ¿VE EL PAPEL CON VISIÓN, O SÓLO ACEPTA LA IMAGEN?
//
// POR QUÉ EXISTE. El 2026-09-12 se descubrió que el modelo del papel
// `visualCritic` —`qwen3p7-plus`— devuelve 404 NOT_FOUND en producción, con la
// clave real y desde la caja. Se lleva por delante CUATRO operaciones:
// `agent_visual_verify` (los ojos de Len), `page_write_with_reference` (crear
// mirando una referencia), `candidate_scouting` y `final_scoring`. Falla
// BLANDO —`verify.ts` es fail-open— así que lleva roto desde el 2026-08-27 sin
// que nada se pusiera rojo.
//
// El candidato es `deepseek-v4p1-flash`: ya es el modelo del Agente, cuesta
// 0.22/0.66 contra 0.4/1.6, y su ficha declara `supportsImageInput`. Un sondeo
// con un PNG de 2×2 devolvió 200 — pero eso prueba que ACEPTA la imagen, no que
// la VEA. Un modelo sin ojos que traga el bloque y contesta prosa plausible es
// exactamente el fallo que no se nota.
//
// QUÉ MIDE ESTE FICHERO, y por qué así:
//
//   ARM 1 — `observarPagina({tipo:"describir"})`. En esa rama el modelo recibe
//   LA IMAGEN Y NADA MÁS: el prompt lleva la pregunta y las reglas, nunca el
//   HTML. Así que una respuesta correcta no se puede haber adivinado del
//   documento — o miró los píxeles, o no. Las preguntas se contestan desde la
//   captura, que este script GUARDA en disco para que quien lo corra la mire
//   con sus propios ojos antes de creerse la respuesta.
//
//   ARM 2 — `verifyEditedPage` sobre la MISMA página con un defecto plantado:
//   el h1 en blanco sobre fondo blanco. Es la ruta de producción entera
//   (captura + mapa de contenido + medición determinista). Texto invisible es
//   el peor caso posible para unos ojos: en la foto no se ve «roto», se ve
//   NADA. Si el papel con visión sirve, aquí lo dice.
//
// Correr:
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/medir-ojos.ts [--si]
//
// SIN `--si` no gasta un céntimo: imprime el modelo que va a usar, el coste
// estimado, y se para.
//
// EL MODELO NO SE ELIGE AQUÍ. Sale de `MODEL_POLICY.visualCritic` como en
// producción: para comparar dos candidatos se cambia esa línea y se vuelve a
// correr, y el script imprime cuál corrió para que el log se etiquete solo.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderHtmlToInlineImage } from "@/lib/ai/inline-image";
import { observarPagina, verifyEditedPage } from "@/lib/agent/verify";
import { MODEL_POLICY } from "@/lib/generation/model-policy";

const SI = process.argv.includes("--si");
const SALIDA = process.argv.find((a) => a.startsWith("--salida="))?.slice(9) ?? ".";

/** La página de prueba es una plantilla REAL del repo, no un HTML de juguete:
 *  lo que se quiere saber es si ve una landing, que es lo que va a mirar. */
const PLANTILLA = join(process.cwd(), "templates", "starter", "mirror.html");

/**
 * Preguntas que SÓLO se contestan mirando. Cada una lleva su comprobación
 * automática, pero la comprobación es una AYUDA, no el veredicto: el veredicto
 * lo da quien mira el PNG que este script deja en disco. Un regex sobre prosa
 * libre acierta poco ([[el-comprobador-que-acierta-cero-de-tres]]).
 */
const PREGUNTAS: readonly { pregunta: string; esperado: string }[] = [
  {
    pregunta:
      "¿La página es de fondo claro o de fondo oscuro, y qué ocupa la mitad superior de la captura?",
    esperado: "claro/oscuro + qué hay arriba",
  },
  {
    pregunta:
      "Lee en voz alta el texto más grande que aparece en la captura, palabra por palabra, sin interpretarlo.",
    esperado: "el titular literal",
  },
  {
    pregunta:
      "¿Cuántos bloques o tarjetas separadas se distinguen en la mitad inferior, y están en fila o en columna?",
    esperado: "un número + una disposición",
  },
];

/** El defecto plantado del ARM 2: el titular en blanco sobre fondo blanco. */
function conTitularInvisible(html: string): string {
  return html.replace(
    /<h1([^>]*)>/i,
    '<h1$1 style="color:#ffffff;background:#ffffff">',
  );
}

/**
 * El defecto del ARM 3: el titular DUPLICADO y encimado sobre sí mismo, unos
 * píxeles corrido.
 *
 * 🔴 ESTE ES EL QUE DISCRIMINA, y el ARM 2 no. Medido en este mismo script:
 * blanco-sobre-blanco lo caza la pasada DETERMINISTA —el contraste leído del
 * píxel, sin modelo y sin crédito— y por eso salió `broken:true` idéntico con
 * el papel con visión MUERTO a 404. Un arma que da el mismo resultado con y
 * sin el sujeto no mide al sujeto.
 *
 * Un texto encimado, en cambio, es invisible para las tres sondas
 * deterministas: el contraste de cada capa contra el fondo es correcto, no
 * desborda en móvil, y no lanza ningún error. Sólo se ve MIRANDO. Si el
 * candidato lo señala, el papel con visión está comprando algo que no teníamos.
 */
function conTitularEncimado(html: string): string {
  return html.replace(
    /<h1([^>]*)>([\s\S]*?)<\/h1>/i,
    (_m, attrs: string, dentro: string) =>
      `<h1${attrs} style="position:relative">${dentro}` +
      `<span aria-hidden="true" style="position:absolute;left:9px;top:11px;` +
      `width:100%;color:inherit;opacity:.85">${dentro}</span></h1>`,
  );
}

async function main(): Promise<void> {
  const modelo = MODEL_POLICY.visualCritic.modelId;
  const tarifa = MODEL_POLICY.visualCritic.creditRate;

  console.log(`papel visualCritic → ${modelo}  (tarifa: ${tarifa})`);
  console.log(`página            → ${PLANTILLA}`);
  console.log(`llamadas          → ${PREGUNTAS.length} describir + 1 verificar`);
  console.log(
    "coste estimado    → ~4 capturas de entrada + prosa corta; con la tarifa de Flash, por debajo de $0.01",
  );
  if (!SI) {
    console.log("\nSin --si no se llama a nada. Añade --si para correr de verdad.");
    return;
  }

  const html = readFileSync(PLANTILLA, "utf8");

  // ── ARM 1 ────────────────────────────────────────────────────────────────
  // La captura se guarda ANTES de preguntar: si el render falla, se ve aquí y
  // no se confunde con un fallo del modelo.
  const imagen = await renderHtmlToInlineImage(html).catch((e: unknown) => {
    console.error("render falló:", e);
    return null;
  });
  if (!imagen) {
    console.error("\nSIN CAPTURA — no hay nada que medir. ¿Chromium instalado?");
    process.exitCode = 1;
    return;
  }
  const png = join(SALIDA, "ojos-captura.png");
  writeFileSync(png, Buffer.from(imagen.dataBase64, "base64"));
  console.log(`\ncaptura guardada  → ${png}  (${imagen.dataBase64.length} chars b64)`);
  console.log("   MÍRALA antes de creerte lo de abajo.\n");

  console.log("── ARM 1 · describir (sólo la imagen, nunca el HTML) ──");
  for (const { pregunta, esperado } of PREGUNTAS) {
    const t0 = Date.now();
    const r = await observarPagina({ html, tipo: "describir", pregunta });
    const ms = Date.now() - t0;
    console.log(`\nP: ${pregunta}`);
    console.log(`   (se comprueba: ${esperado})`);
    console.log(`R: ${r ? r.respuesta : "«null» — la llamada falló o vino vacía"}   [${ms}ms]`);
  }

  // ── ARM 2 ────────────────────────────────────────────────────────────────
  console.log("\n── ARM 2 · verificar, con el titular BLANCO SOBRE BLANCO ──");
  const roto = conTitularInvisible(html);
  if (roto === html) {
    console.log("   (la plantilla no tiene <h1>: el defecto no se plantó, ARM 2 no dice nada)");
  } else {
    const t0 = Date.now();
    const v = await verifyEditedPage({
      html: roto,
      userPrompt: "Cambia el color del titular.",
    });
    const ms = Date.now() - t0;
    console.log(`broken : ${v.broken}`);
    console.log(`issues : ${v.issues.length ? v.issues.join(" | ") : "(ninguno)"}`);
    console.log(`[${ms}ms]`);
    console.log(
      "\n   OJO: este arma NO discrimina. El contraste lo lee la pasada" +
        "\n   determinista sin modelo, así que sale igual con los ojos muertos.",
    );
  }

  // ── ARM 3 ────────────────────────────────────────────────────────────────
  console.log("\n── ARM 3 · verificar, con el titular ENCIMADO sobre sí mismo ──");
  const encimado = conTitularEncimado(html);
  if (encimado === html) {
    console.log("   (no se pudo plantar el defecto: ARM 3 no dice nada)");
    return;
  }
  const img3 = await renderHtmlToInlineImage(encimado).catch(() => null);
  if (img3) {
    const png3 = join(SALIDA, "ojos-encimado.png");
    writeFileSync(png3, Buffer.from(img3.dataBase64, "base64"));
    console.log(`captura → ${png3}   MÍRALA: el defecto tiene que verse.`);
  }
  // n=3: un `broken:false` suelto es ruido, tres seguidos son una conducta.
  for (let i = 1; i <= 3; i++) {
    const t3 = Date.now();
    const v3 = await verifyEditedPage({
      html: encimado,
      userPrompt: "Deja el titular como estaba.",
    });
    // 🔴 SE IMPRIME `observaciones`, Y NO ESTABA. Es el canal de «lo que VEO y
    // no puedo calificar de defecto desde la captura» — el equivalente exacto
    // del veredicto PLAUSIBLE frente a CONFIRMED. Sin mirarlo, un
    // `broken:false` se lee como «no vio nada», cuando puede ser «lo vio y lo
    // puso donde toca». Esta prueba concluyó lo primero sin haber mirado.
    console.log(
      `  #${i}  broken=${v3.broken}  issues=${
        v3.issues.length ? v3.issues.join(" | ") : "(ninguno)"
      }  observaciones=${
        v3.observaciones.length ? v3.observaciones.join(" | ") : "(ninguna)"
      }  [${Date.now() - t3}ms]`,
    );
  }
  console.log(
    "\n   LO QUE CUENTA: que hable del TEXTO ENCIMADO. Ninguna sonda" +
      "\n   determinista puede verlo — si sale, lo vio el modelo.",
  );

  // ── ARM 4 ────────────────────────────────────────────────────────────────
  // SEPARA PERCEPCIÓN DE PERMISO. Si el ARM 3 dice «no roto», hay dos causas
  // incompatibles y el arreglo es distinto en cada una: (a) el modelo no
  // RESUELVE el defecto en la captura, o (b) lo ve y el prompt de verificación
  // —escrito para ser conservador a propósito— no le deja llamarlo rotura.
  // Aquí se pregunta a pelo, sin ese prompt: la rama `describir` sólo pide
  // describir píxeles.
  console.log("\n── ARM 4 · describir el MISMO defecto, preguntando a pelo ──");
  const r4 = await observarPagina({
    html: encimado,
    tipo: "describir",
    pregunta:
      "Mira el titular grande de la parte de arriba. ¿Se ve limpio, o hay algo raro en cómo están dibujadas las letras?",
    zona: "el titular del hero",
  });
  console.log(`R: ${r4 ? r4.respuesta : "«null» — la llamada falló o vino vacía"}`);
  console.log(
    "\n   Si aquí SÍ describe la duplicación, el modelo ve y el problema es" +
      "\n   el prompt de `verify.ts`. Si tampoco, es que no lo resuelve.",
  );
}

void main();
