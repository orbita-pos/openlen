// ¿EXISTEN LOS MODELOS QUE NOMBRA LA POLÍTICA?
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
// papel. Contesta UNA pregunta: ¿responde? Es la diferencia entre «este papel
// funciona mal» y «este papel no existe», y sólo la segunda es la que se
// disfraza de silencio.
//
//   npm run modelos:comprobar
//   npm run modelos:comprobar -- --ademas=accounts/fireworks/models/<candidato>
//
// Cuesta ~3 tokens de salida en total (`max_tokens: 1` por papel). A la tarifa
// de Flash eso es 0,000002 USD: no lleva puerta de gasto porque no hay gasto
// que frenar.
//
// SALE 1 SI ALGUNO NO RESPONDE, para que sirva de puerta en el despliegue.
//
// `--ademas=` comprueba modelos que NO están en la política. Tiene dos usos y
// los dos son reales: sondear un candidato ANTES de escribirlo en la tabla, y
// —el que lo justificó— poder verificar que esta comprobación sabe decir que
// NO. Una puerta que sólo se ha visto en verde no está verificada: está sin
// mirar, que es el mismo defecto que persigue.

import { MODEL_POLICY } from "@/lib/generation/model-policy";

const ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";

/** Los modelos DISTINTOS que nombra la política, con los papeles que los piden.
 *
 *  Se deduplica porque dos papeles pueden compartir modelo —desde el
 *  2026-09-12 `agent` y `visualCritic` lo hacen— y preguntar dos veces por el
 *  mismo no dice nada nuevo. El papel viaja al lado para que el mensaje de
 *  fallo nombre lo que se rompe, no sólo la cadena que falla. */
function modelosDeLaPolitica(): Map<string, string[]> {
  const porModelo = new Map<string, string[]>();
  for (const [papel, cfg] of Object.entries(MODEL_POLICY)) {
    const previos = porModelo.get(cfg.modelId) ?? [];
    porModelo.set(cfg.modelId, [...previos, papel]);
  }
  return porModelo;
}

async function responde(
  modelId: string,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; detalle: string }> {
  let r: Response;
  try {
    r = await fetch(ENDPOINT, {
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

async function main(): Promise<void> {
  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey) {
    // Sin clave NO se pasa en verde. Una comprobación que se salta sola cuando
    // le falta algo es peor que no tenerla: da el visto bueno sin haber mirado,
    // que es exactamente la forma del defecto que este fichero persigue.
    console.error("FIREWORKS_API_KEY no está — no se puede comprobar nada. Esto NO es un pase.");
    process.exit(1);
  }

  const porModelo = modelosDeLaPolitica();
  for (const arg of process.argv.filter((a) => a.startsWith("--ademas="))) {
    const id = arg.slice("--ademas=".length).trim();
    if (id) porModelo.set(id, [...(porModelo.get(id) ?? []), "pedido a mano"]);
  }
  console.log(`comprobando ${porModelo.size} modelos…\n`);

  const muertos: string[] = [];
  for (const [modelId, papeles] of porModelo) {
    const r = await responde(modelId, apiKey);
    const quien = papeles.join(", ");
    if (r.ok) {
      console.log(`  ok    ${modelId}  (${quien})`);
    } else {
      console.log(`  MUERTO ${modelId}  (${quien})`);
      console.log(`         ${r.detalle}`);
      muertos.push(`${modelId} — lo piden: ${quien}`);
    }
  }

  if (muertos.length === 0) {
    console.log("\nlos modelos de la política responden.");
    return;
  }

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
