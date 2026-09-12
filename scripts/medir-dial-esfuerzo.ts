// ¿SUBE EL DIAL POR ENCIMA DE 100?
//
// La pregunta viene de una medida incómoda del spec del selector de esfuerzo:
// con `deepseek-v4p1-flash`, OMITIR el campo da 164 tokens de razonamiento y
// mandar `100` —nuestro `xhigh`— da 113. O sea que el nivel más alto que le
// ofreceríamos al usuario PIENSA MENOS que no elegir nada, y `xhigh` como «el
// máximo» sería una etiqueta falsa.
//
// Antes de renombrar los niveles o de tratar `auto` como el techo real hay que
// saber una cosa concreta: **¿acepta el proveedor un valor > 100, y sube?**
// Tres respuestas posibles, y las tres son útiles:
//   (a) lo acepta y sube        → `xhigh` puede valer más de 100
//   (b) lo acepta y NO sube     → 100 es el techo real del dial, y `auto` está
//                                 por encima de él por otra vía
//   (c) lo RECHAZA              → la escala es 1-100 de verdad y hay que
//                                 resolverlo renombrando o re-jerarquizando
//
//   npx tsx --env-file=.env.local scripts/medir-dial-esfuerzo.ts [--si]
//
// SIN `--si` no gasta un céntimo: imprime el coste estimado y se para.
//
// NO usa `lib/ai/fireworks-stream-client.ts` a propósito: ese cliente pasa por
// la capa de POSTURA, cuyo tipo `EsfuerzoAgente` no puede expresar `150`. Lo que
// se mide aquí es el PROVEEDOR, no nuestra capa, así que habla con el endpoint
// directamente. Por eso tampoco importa `@/…` y corre sin tsconfig especial.

const ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
const MODELO = "accounts/fireworks/models/deepseek-v4p1-flash";

// $/millón de tokens, de lib/credits.ts (corregidos el 2026-08-28).
const TARIFA = { entrada: 0.22, salida: 0.66 } as const;

// Un aviso CORTO que provoca algo de razonamiento sin generar una página
// entera: lo que se cuenta son los tokens de pensamiento, no la prosa.
const AVISO =
  "Un taller de cerámica en Oaxaca vende piezas a mano y da clases los sábados. " +
  "¿Conviene poner el precio de las clases en el héroe de su landing, o más abajo? Responde en dos frases.";

// Generoso A PROPÓSITO: si el techo de salida fuera bajo, el proveedor podría
// recortar el razonamiento contra él y estaríamos midiendo el TECHO en vez del
// DIAL. Con 4.000 el dial es lo que ata.
const TECHO_SALIDA = 4_000;

/** `null` = el campo NO se manda (el control de `auto`). */
type Valor = number | string | null;

interface Caso {
  readonly valor: Valor;
  readonly n: number;
  readonly porQue: string;
}

const CASOS: readonly Caso[] = [
  // Controles: tienen que reproducir la tabla del spec, o el instrumento no
  // sirve para comparar. 164 y 113 respectivamente.
  { valor: null, n: 3, porQue: "CONTROL — omitido (`auto`). El spec midió 164." },
  { valor: 100, n: 3, porQue: "CONTROL — nuestro `xhigh`. El spec midió 113." },
  // La pregunta.
  { valor: 101, n: 1, porQue: "justo por encima del tope declarado" },
  { valor: 150, n: 1, porQue: "medio escalón" },
  { valor: 200, n: 3, porQue: "el doble del tope" },
  { valor: 500, n: 1, porQue: "cinco veces" },
  { valor: 1000, n: 3, porQue: "diez veces — si aquí no sube, no sube" },
  // Cruce: el spec midió el NOMBRE `max` en 142, por encima de `100`=113.
  { valor: "max", n: 1, porQue: "el NOMBRE que el spec midió en 142" },
];

// RONDA 2 (`--ronda2`). La primera dejó dos cosas abiertas: `500` se honra
// (489) pero `1000` NO (mediana 329, que es nivel de `auto`), así que el techo
// del dial está entre los dos; y el NOMBRE `max` dio 1003 con n=1, siete veces
// lo que el spec le midió (142), que es demasiada diferencia para dejarla en
// una sola llamada.
const CASOS_R2: readonly Caso[] = [
  { valor: 600, n: 2, porQue: "¿sigue honrándose pasado 500?" },
  { valor: 750, n: 2, porQue: "medio camino al que falla" },
  { valor: 900, n: 2, porQue: "justo antes del que falla" },
  { valor: 1000, n: 2, porQue: "RÉPLICA del que no siguió" },
  { valor: 2000, n: 1, porQue: "muy por encima: ¿se ignora o se honra?" },
  { valor: "max", n: 3, porQue: "RÉPLICA del 1003 — el spec le midió 142" },
  { valor: "xhigh", n: 1, porQue: "el NOMBRE de nuestro nivel más alto" },
];


// RONDA 3 (`--ronda3`). Las dos primeras dejan claro que entre 100 y 500 el
// dial se honra casi 1:1 en TOKENS (100 da 100, 150 da 150, 200 da 213 con
// n=3 muy apretado, 500 da 489) y que por encima de ~500 se ignora y cae a la
// banda de `auto` (600..2000 dan todos 210-390). El numero ACTUABLE es el
// techo de esa rampa, y lo tengo con n=1. Esto lo replica.
const CASOS_R3: readonly Caso[] = [
  { valor: 300, n: 2, porQue: "dentro de la rampa" },
  { valor: 400, n: 2, porQue: "dentro de la rampa" },
  { valor: 500, n: 4, porQue: "EL NUMERO ACTUABLE — replica del 489 (era n=1)" },
  { valor: 550, n: 2, porQue: "el borde: donde la rampa se rompe" },
  { valor: null, n: 2, porQue: "CONTROL de deriva — `auto` en la misma tanda" },
];


// RONDA 4 (`--ronda4`). EL BORDE. Las rondas 1-3 dejan el corte entre `200`
// (rango 1: 212, 213, 213 — la firma de un presupuesto HONRADO) y `300`
// (rango 100: 200, 300 — ya suelto). Esto lo barre de 25 en 25.
//
// DOS CONTROLES DENTRO DE LA MISMA TANDA, que es lo que faltaba antes:
//   - `100`, que sabemos que ATA (rango 13). Si aqui sale suelto, el
//     instrumento no esta midiendo y la tanda entera no vale.
//   - `auto`, que sabemos que NO ata (rango 495). Es la banda contra la que
//     hay que comparar: un valor "honrado" tiene que salir MAS APRETADO.
const CASOS_R4: readonly Caso[] = [
  { valor: 100, n: 3, porQue: "CONTROL APRETADO — tiene que atar (rango 13 en r1)" },
  { valor: 200, n: 5, porQue: "el ultimo que ataba (rango 1 en r1)" },
  { valor: 225, n: 5, porQue: "borde" },
  { valor: 250, n: 5, porQue: "borde" },
  { valor: 275, n: 5, porQue: "borde" },
  { valor: 300, n: 5, porQue: "el primero que se solto (rango 100 en r3)" },
  { valor: null, n: 3, porQue: "CONTROL SUELTO — `auto`, la banda de referencia" },
];

interface Medida {
  readonly valor: Valor;
  readonly razonamiento: number | null;
  readonly salida: number;
  readonly entrada: number;
  readonly ms: number;
  readonly estado: number;
  readonly error?: string;
}

function etiqueta(v: Valor): string {
  return v === null ? "(omitido)" : String(v);
}

async function unaLlamada(valor: Valor, i: number): Promise<Medida> {
  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey) throw new Error("FIREWORKS_API_KEY no está en el entorno. ¿Falta --env-file=.env.local?");

  const cuerpo: Record<string, unknown> = {
    model: MODELO,
    messages: [{ role: "user", content: AVISO }],
    max_tokens: TECHO_SALIDA,
    temperature: 0.3,
    // `user` distinto por llamada: con el mismo, la afinidad de caché de
    // Fireworks manda todas a la misma réplica y el acierto de caché podría
    // cambiar lo que se mide.
    user: `dial.${etiqueta(valor)}.${i}.${Date.now()}`,
  };
  // El campo SÓLO se manda cuando no es el control.
  if (valor !== null) cuerpo.reasoning_effort = valor;

  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(cuerpo),
  });
  const ms = Date.now() - t0;

  if (!res.ok) {
    const texto = await res.text();
    return {
      valor,
      razonamiento: null,
      salida: 0,
      entrada: 0,
      ms,
      estado: res.status,
      error: texto.slice(0, 400),
    };
  }

  const json = (await res.json()) as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const u = json.usage;
  const r = u?.completion_tokens_details?.reasoning_tokens;
  return {
    valor,
    razonamiento: typeof r === "number" ? r : null,
    salida: u?.completion_tokens ?? 0,
    entrada: u?.prompt_tokens ?? 0,
    ms,
    estado: res.status,
  };
}

function mediana(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main(): Promise<void> {
  const adelante = process.argv.includes("--si");
  const casos = process.argv.includes("--ronda4") ? CASOS_R4 : process.argv.includes("--ronda3") ? CASOS_R3 : process.argv.includes("--ronda2") ? CASOS_R2 : CASOS;
  const llamadas = casos.reduce((n, c) => n + c.n, 0);

  // El coste REAL por delante, que es regla dura: el peor caso es que cada
  // llamada agote el techo de salida.
  const peorSalida = (llamadas * TECHO_SALIDA * TARIFA.salida) / 1_000_000;
  const peorEntrada = (llamadas * 120 * TARIFA.entrada) / 1_000_000;
  console.log(`Modelo: ${MODELO}`);
  console.log(`Casos: ${casos.length} · llamadas: ${llamadas} · techo de salida ${TECHO_SALIDA}`);
  console.log(
    `Coste PEOR CASO (cada llamada agota el techo): $${(peorSalida + peorEntrada).toFixed(4)} ` +
      `(salida $${peorSalida.toFixed(4)} + entrada $${peorEntrada.toFixed(4)})`,
  );
  if (!adelante) {
    console.log("\nSin `--si` no se gasta nada. Añade --si para medir de verdad.");
    return;
  }

  // INTERCALADO, no en bloques. La carga de Fireworks cambia con los minutos,
  // asi que corriendo los cinco de un valor seguidos, la diferencia que
  // midieras podria ser la hora y no el valor. Mismo argumento que el A/B/A/B
  // de `medir-service-tier.ts`.
  const plan: ReadonlyArray<{ caso: Caso; i: number }> = (() => {
    const filas: { caso: Caso; i: number }[] = [];
    const maxN = Math.max(...casos.map((c) => c.n));
    for (let i = 0; i < maxN; i++) {
      for (const caso of casos) if (i < caso.n) filas.push({ caso, i });
    }
    return filas;
  })();

  const medidas: Medida[] = [];
  {
    for (const { caso, i } of plan) {
      const m = await unaLlamada(caso.valor, i);
      medidas.push(m);
      const razon = m.razonamiento === null ? "—" : String(m.razonamiento);
      console.log(
        `  ${etiqueta(caso.valor).padStart(10)}  #${i + 1}  estado ${m.estado}  ` +
          `razonamiento ${razon.padStart(5)}  salida ${String(m.salida).padStart(5)}  ${m.ms} ms` +
          (m.error ? `  ERROR ${m.error.replace(/\s+/g, " ").slice(0, 160)}` : ""),
      );
    }
  }

  console.log("\n=== RESUMEN ===");
  console.log("valor      | n | razonamiento (mediana) | crudos               | por qué");
  for (const caso of casos) {
    const mias = medidas.filter((m) => m.valor === caso.valor);
    const oks = mias.filter((m) => m.razonamiento !== null).map((m) => m.razonamiento as number);
    const med = oks.length ? String(mediana(oks)) : "—";
    const fallos = mias.filter((m) => m.error);
    const crudos = oks.length ? oks.join(", ") : fallos.map((f) => `HTTP ${f.estado}`).join(", ");
    console.log(`${etiqueta(caso.valor).padEnd(10)} | ${caso.n} | ${med.padStart(22)} | ${crudos.padEnd(20)} | ${caso.porQue}`);
  }

  const entrada = medidas.reduce((n, m) => n + m.entrada, 0);
  const salida = medidas.reduce((n, m) => n + m.salida, 0);
  const gasto = (entrada * TARIFA.entrada + salida * TARIFA.salida) / 1_000_000;
  console.log(`\nTokens: ${entrada} de entrada, ${salida} de salida. GASTO REAL: $${gasto.toFixed(4)}`);

  // 🔴 Una corrida a $0.00 puede ser una cuenta suspendida disfrazada de otra
  // cosa: si todo falla y el gasto es cero, NO es un hallazgo sobre el dial.
  const conError = medidas.filter((m) => m.error);
  if (conError.length === medidas.length) {
    console.log("\n🔴 TODAS las llamadas fallaron. Antes de concluir nada sobre el dial, mira si es");
    console.log("   facturación (412) o una clave prepago agotada — se disfrazan de otro error.");
  } else if (conError.length) {
    console.log(`\n⚠️ ${conError.length} de ${medidas.length} llamadas fallaron. Estados: ${[...new Set(conError.map((m) => m.estado))].join(", ")}`);
  }
}

void main();

// Sin imports este fichero seria un SCRIPT GLOBAL y su `main` chocaria con el
// de los otros scripts (TS2393). Esto lo hace modulo.
export {};
