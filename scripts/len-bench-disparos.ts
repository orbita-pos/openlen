// scripts/len-bench-disparos.ts — LAS PRUEBAS DE DISPARO de Len-Bench: ¿llama
// Len a get_visits, list_form_submissions y list_messages cuando toca, y SÓLO cuando
// toca? El `/plugin eval` de Claude Code, con un turno de verdad en vez de
// preguntarle al modelo si llamaría (lib/len-bench/disparos.ts).
//
//   npm run bench:len:disparos                                    # carga, avisa e imprime el estimado: $0
//   npm run bench:len:disparos -- --solo=get_visits --budget-usd=0.12 --yes
//   npm run bench:len:disparos -- --solo=get_visits/cuanta-gente-ayer.md --yes
//
// ⚠️ CON --yes GASTA DINERO REAL: UN turno de Len por consulta. Las guardas de
// scripts/len-bench.ts: el estimado se imprime, nada corre sin --yes, el tope
// es duro, y el gasto REAL acumulado salta las consultas que quedan (la salida
// es entonces 2: el número no es el de las carpetas enteras).
//
// Por consulta: un proyecto de usar y tirar con la panadería de los casos de
// resultados y LA MISMA SIEMBRA para todas —visitas de hoy y de ayer, un
// formulario sin ver y un chat de Juan—, para que cada herramienta tenga algo
// que contar y ninguna consulta pase o falle por una base vacía. Un turno por
// HTTP, como el del panel; las herramientas, de sus eventos `action`. Después,
// la memoria del dueño devuelta y el proyecto borrado, pase lo que pase.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { historialParaElAgente } from "@/lib/chat/historial-del-agente";
import { arrancarCorredor, TIMEOUT_TURNO_MS } from "@/lib/len-bench/arranque";
import { ErrorDeMontaje, ZONA_POR_DEFECTO } from "@/lib/len-bench/conductor";
import {
  centimosDelEstimado,
  esperarUsdDeProyecto,
  estimadoExcedeTope,
  MARGEN_NO_GRABADO,
  TOPE_POR_DEFECTO_USD,
  USD_POR_TURNO_ESTIMADO,
} from "@/lib/len-bench/coste";
import {
  cargarDisparos,
  cuentas,
  informe,
  lasLlamadas,
  lineaDeTotal,
  salidaDeDisparos,
  veredicto,
  type CarpetaDeDisparos,
  type ConsultaDeDisparo,
  type InformeDeHerramienta,
  type ResultadoDeDisparo,
} from "@/lib/len-bench/disparos";
import { BASE_LEN_BENCH, DIR_CORRIDAS, DIR_GRABACIONES } from "@/lib/len-bench/entorno";
import { filaComoLaDeUnDueno } from "@/lib/len-bench/fila-del-dueno";
import { createThrowawayProject, deleteThrowawayProject, restoreAgentMemory, snapshotAgentMemory } from "@/lib/len-bench/proyecto-de-eval";
import { enviarTurno, herramientasDeLen, textoDeLen } from "@/lib/len-bench/sesion";
import { aLas, haceUnRato, panaderia, plantarChat, plantarFormulario, plantarVistas } from "@/lib/len-bench/casos/resultados/sembrar";
import type { Siembra } from "@/lib/len-bench/tipos";

const RAIZ_DISPAROS = path.join("lib", "len-bench", "disparos");

function arg(n: string): string | undefined {
  const a = process.argv.find((x) => x === n || x.startsWith(`${n}=`));
  return a?.includes("=") ? a.slice(a.indexOf("=") + 1) : a ? "" : undefined;
}

/** La siembra común: algo que contar para cada una de las tres herramientas. */
async function sembrar(s: Siembra): Promise<void> {
  // La marca «para todos» de la identidad de eval, a cero, como en
  // formularios-nuevos: con ella puesta, el formulario de María saldría visto.
  await db.update(schema.users).set({ lastSeenLeadsAt: null }).where(eq(schema.users.id, s.ownerId));
  // PUBLICADA, como la de quien tiene visitas y mensajes. Sin esto el ESTADO
  // DEL PROYECTO dice «publicado: false», y una página sin publicar no tiene a
  // quién contar: «¿cómo va mi página?» se lee entonces, con razón, como «¿cómo
  // va lo que estamos haciendo?» (la llamada del 01/10). Sólo la fila: no hay
  // ficheros publicados detrás, que una consulta de un turno no los mira.
  await db
    .update(schema.projects)
    .set({ status: "published", publishedAt: s.ahora, subdomain: `disparo-${s.projectId.slice(0, 8)}` })
    .where(eq(schema.projects.id, s.projectId));
  await plantarVistas(s.projectId, 3, haceUnRato(s), "hoy");
  await plantarVistas(s.projectId, 5, aLas(s, 1, 12), "ayer");
  await plantarFormulario(
    s.projectId,
    "maria",
    { nombre: "María López", correo: "maria@ejemplo.com", mensaje: "¿Hacen pasteles de tres leches para 20 personas?" },
    haceUnRato(s),
    null,
  );
  await plantarChat(s, "Juan", ["¿Abren el domingo?"]);
}

interface Montaje {
  readonly base: string;
  readonly cookie: string;
  readonly owner: { readonly id: string; readonly email: string };
  readonly dirGrabaciones: string;
}

async function correrConsulta(c: ConsultaDeDisparo, herramienta: string, o: Montaje): Promise<{ resultado: ResultadoDeDisparo; aviso?: string }> {
  const memoria = await snapshotAgentMemory(o.owner.id);
  const inicio = panaderia();
  const projectId = await createThrowawayProject(o.owner.id, "len-bench-disparo", inicio, filaComoLaDeUnDueno(inicio));
  let enviado = false;

  async function decidir(): Promise<Omit<ResultadoDeDisparo, "usd">> {
    await sembrar({ projectId, ownerId: o.owner.id, zona: ZONA_POR_DEFECTO, ahora: new Date() });
    // Un proyecto recién creado: el historial vacío, con la forma que lo manda el panel.
    const { history, historyTotal, dichoAntes } = historialParaElAgente([], null);
    enviado = true;
    const eventos = await enviarTurno({
      base: o.base,
      cookie: o.cookie,
      // `esfuerzo` y `zonaHoraria`: lo que manda el panel de un usuario nuevo en
      // México (ver `CuerpoDelTurno`).
      cuerpo: { projectId, prompt: c.query, turnId: crypto.randomUUID(), history, historyTotal, dichoAntes, esfuerzo: "auto", zonaHoraria: ZONA_POR_DEFECTO },
      timeoutMs: TIMEOUT_TURNO_MS,
    });
    const llamadas = herramientasDeLen(eventos);
    const texto = textoDeLen(eventos).replace(/\s+/g, " ").trim();
    const err = eventos.find((x) => x.nombre === "error")?.datos as { code?: string; message?: string } | undefined;
    if (err?.code === "no_credits" || err?.code === "agent_off") {
      throw new ErrorDeMontaje(`la ruta rechazó el turno con «${err.code}»: ${err.message ?? ""}`.trim());
    }
    // Sin llamar a nada ni decir nada no hay decisión que juzgar: un «no debía
    // llamar» pasaría por un turno roto. Como el suyo: lo que revienta, falla.
    if (err && llamadas.length === 0 && texto === "") {
      return { consulta: c, llamo: null, veredicto: "falla", motivo: `el turno falló sin llamar a nada ni decir nada (${err.code ?? "error"}: ${err.message ?? ""})` };
    }
    const v = veredicto(c.shouldTrigger, llamadas, herramienta);
    const dicho = texto ? ` · Len: «${texto.slice(0, 160)}${texto.length > 160 ? "…" : ""}»` : "";
    const roto = err ? ` · el turno acabó con error ${err.code ?? ""}`.trimEnd() : "";
    return { consulta: c, ...v, motivo: `${lasLlamadas(llamadas)}${dicho}${roto}` };
  }

  let res: Omit<ResultadoDeDisparo, "usd">;
  let coste: { usd: number; aviso?: string } = { usd: 0 };
  try {
    res = await decidir().catch((e: unknown) => {
      if (e instanceof ErrorDeMontaje) throw e;
      return { consulta: c, llamo: null, veredicto: "falla" as const, motivo: `la consulta reventó: ${e instanceof Error ? e.message : String(e)}` };
    });
  } finally {
    // La grabación llega DESPUÉS de cerrarse el stream (`esperarUsdDeProyecto`):
    // se espera, y así el proyecto tampoco se borra mientras la ruta aún cierra su fila.
    if (enviado) coste = await esperarUsdDeProyecto(o.dirGrabaciones, projectId);
    await restoreAgentMemory(o.owner.id, memoria);
    await deleteThrowawayProject(projectId);
  }
  return { resultado: { ...res, usd: coste.usd }, ...(coste.aviso ? { aviso: coste.aviso } : {}) };
}

/** `--solo=get_visits` (la carpeta) o `--solo=get_visits/cuanta-gente-ayer.md` (una consulta). */
function filtrar(carpetas: CarpetaDeDisparos[], solo: readonly string[] | undefined): CarpetaDeDisparos[] {
  if (!solo) return carpetas;
  return carpetas
    .map((g) => ({ ...g, consultas: g.consultas.filter((c) => solo.includes(g.herramienta) || solo.includes(`${g.herramienta}/${c.fichero}`)) }))
    .filter((g) => g.consultas.length > 0);
}

async function main(): Promise<number> {
  const solo = arg("--solo")?.split(",").filter(Boolean);
  const tope = arg("--budget-usd") !== undefined ? Number(arg("--budget-usd")) : TOPE_POR_DEFECTO_USD;
  const base = arg("--base") ?? BASE_LEN_BENCH;
  const etiqueta = arg("--etiqueta") ?? "disparos";

  const todas = cargarDisparos(RAIZ_DISPAROS);
  // Una carpeta que no nombra una herramienta de Len no mediría nada: cada
  // «debía llamar» fallaría y cada «no debía» pasaría, sin que Len decidiera.
  const deLen = new Set(buildFunctionDeclarations().map((d) => String(d.name)));
  const ajenas = todas.map((g) => g.herramienta).filter((h) => !deLen.has(h));
  if (ajenas.length > 0) {
    throw new Error(`en ${RAIZ_DISPAROS} hay carpetas que no son herramientas de Len (lib/agent/catalog.ts): ${ajenas.join(", ")}`);
  }
  const carpetas = filtrar(todas, solo);
  if (carpetas.length === 0) throw new Error(`no hay consultas que correr${solo ? ` con --solo=${solo.join(",")}` : ""}`);
  // Como su cargador: avisa, no para.
  for (const g of carpetas) for (const a of g.avisos) console.log(`! ${g.herramienta}: ${a}`);

  const n = carpetas.reduce((s, g) => s + g.consultas.length, 0);
  if (n === 0) {
    console.log("No hay consultas que correr.");
    return 0;
  }
  const estimado = n * USD_POR_TURNO_ESTIMADO * MARGEN_NO_GRABADO;
  // La MISMA cifra que se compara (ver `estimadoExcedeTope`): declarar lo que se lee siempre pasa.
  const estimadoImpreso = (centimosDelEstimado(estimado) / 100).toFixed(2);
  console.log(`Len-Bench · pruebas de disparo · ${carpetas.map((g) => `${g.herramienta} (${g.consultas.length})`).join(", ")}`);
  console.log(`Estimado PESIMISTA: ~$${estimadoImpreso} (${n} consultas × un turno × $${USD_POR_TURNO_ESTIMADO} × margen ${MARGEN_NO_GRABADO})`);
  console.log(`Tope de gasto: $${tope.toFixed(2)}`);
  if (estimadoExcedeTope(estimado, tope)) throw new Error(`RECHAZADO: el estimado ($${estimadoImpreso}) excede el tope. Decláralo: --budget-usd=${estimadoImpreso}`);
  if (arg("--yes") === undefined) {
    console.log("Esto GASTA dinero real del proveedor. Vuelve a correr con --yes.");
    return 0;
  }

  const { owner, cookie } = await arrancarCorredor(base);
  const montaje: Montaje = { base, cookie, owner, dirGrabaciones: path.resolve(DIR_GRABACIONES) };
  let gastado = 0;
  const informes: InformeDeHerramienta[] = [];
  for (const g of carpetas) {
    const resultados: ResultadoDeDisparo[] = [];
    for (const c of g.consultas) {
      // El tope se mira ANTES de cada consulta; las que salta no se corren.
      if (gastado * MARGEN_NO_GRABADO >= tope) {
        resultados.push({ consulta: c, llamo: null, veredicto: "saltada", motivo: `tope de gasto $${tope.toFixed(2)} alcanzado`, usd: 0 });
        continue;
      }
      const t0 = Date.now();
      const { resultado, aviso } = await correrConsulta(c, g.herramienta, montaje);
      gastado += resultado.usd;
      resultados.push(resultado);
      console.log(
        `  ${g.herramienta}/${c.fichero}: ${resultado.veredicto.toUpperCase()} (${resultado.motivo.split(" · ")[0]}) ` +
          `$${resultado.usd.toFixed(3)} ${((Date.now() - t0) / 1000).toFixed(0)} s${aviso ? `\n      ⚠ ${aviso}` : ""}`,
      );
    }
    informes.push({ ...g, resultados });
  }

  console.log("");
  for (const i of informes) console.log(`${informe(i)}\n`);
  const total = cuentas(informes.flatMap((i) => i.resultados));
  console.log(`EN TOTAL: ${lineaDeTotal(total)}`);
  console.log(`Gasto grabado $${gastado.toFixed(3)} (× ${MARGEN_NO_GRABADO} con lo no grabado ≈ $${(gastado * MARGEN_NO_GRABADO).toFixed(3)})`);

  const dir = path.join(DIR_CORRIDAS, `${new Date().toISOString().slice(0, 10)}-${etiqueta}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "disparos.json"), JSON.stringify({ comando: process.argv.slice(2), informes, total, gastado }, null, 2));
  console.log(`Resultados: ${dir}/disparos.json`);

  const salida = salidaDeDisparos(total);
  if (salida === 2) console.log("\n⚠ a medias: el tope de gasto saltó consultas; el número no es el de las carpetas enteras");
  else if (salida === 1) console.log(`\n✘ fallaron ${total.fallan}`);
  else console.log("\n✔ pasaron todas");
  return salida;
}

// Como su `/plugin eval`: 0 si pasan todas, 1 si falla alguna, 2 si no se pudo
// terminar (aquí también cuando el tope dejó consultas sin correr).
void main().then(
  (codigo) => process.exit(codigo),
  (e: unknown) => {
    console.error(`len-bench-disparos: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  },
);
