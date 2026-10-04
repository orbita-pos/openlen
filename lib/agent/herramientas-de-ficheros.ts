/**
 * LEN 2.0 — Read, Edit, Write, Grep y Glob contra el proyecto de verdad
 * (plans/len-2/ficheros-plan.md).
 *
 * Las piezas puras viven en `lib/agent/ficheros/`: el contrato de Claude Code,
 * mensaje a mensaje. Esto es lo único que sabe de OpenLen: de dónde salen los
 * ficheros (`data.html`, `data.pages`) y por dónde se guardan — el MISMO camino
 * que el resto de escrituras (`preparePage` → `persistPage`), con sus
 * invariantes: `data-slot-path` se rechaza, se archiva el «antes» para
 * deshacer, y un guardado que choca no pisa lo del dueño.
 */
import "server-only";

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { detectSlotPath } from "@/lib/html-engine";
import { diagnosticosDeLaEscritura } from "@/lib/agent/diagnosticos-de-la-escritura";
import { persistPage } from "@/lib/page-engine/persist";
import { preparePage } from "@/lib/page-engine/prepare";
import { describeBehaviorIssues } from "@/lib/conductas-heredadas/validate";
import { MAX_SITE_PAGES, validatePageSlug } from "@/lib/projects/site-pages";
import type { ProjectData } from "@/lib/projects/types";
import { ejecutarRead, noExiste, normalizarFinales, type Leidos } from "@/lib/agent/ficheros/read";
import { coercerEntradaEdit, planearEdit, type PlanDeEdit } from "@/lib/agent/ficheros/edit";
import { coercerEntradaWrite, planearWrite } from "@/lib/agent/ficheros/write";
import { ejecutarGrep, type EntradaGrep, type SitioBuscable } from "@/lib/agent/ficheros/grep";
import { ejecutarGlob } from "@/lib/agent/ficheros/glob";
import {
  ficherosDelSitio,
  leerFichero,
  paginaDeRuta,
  resolverRuta,
  rutaDePagina,
  rutaRelativa,
  sinOpIds,
} from "@/lib/agent/ficheros/sitio";
import { CLAVE_TOOL_RESULT, fallo, type Resultado } from "@/lib/agent/ficheros/resultado";
import {
  almacenDeRuta,
  noDeclarado,
  planDelAlmacen,
  rutaDeAlmacen,
  textoDelAlmacen,
  type FilaDeAlmacen,
} from "@/lib/agent/ficheros/datos";
import type { AlmacenDeclarado } from "@/lib/page-data/declaracion";
import { AVISO_VISITANTES, llevaTextoDeVisitantes } from "@/lib/page-data/vista-del-agente";
import { RUTA_MEMORIA_DUENO, RUTA_MEMORIA_PROYECTO, alcanceDeRuta, lineasNuevas } from "@/lib/agent/ficheros/memoria";
import { esDeLaPlataforma, MANUAL_SOLO_LECTURA, RUTA_MANUAL } from "@/lib/agent/ficheros/manual";
import type { CambioDeLaTerminal } from "@/lib/agent/terminal/ficheros";
import { guardarAjustes, RUTA_AJUSTES, textoDeAjustes } from "@/lib/agent/terminal/ajustes";
import { activoDelSitio, codigoNuevo } from "@/lib/agent/terminal/javascript-del-usuario";
import { buildManualDeLaPlataforma, textoDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import { PREFERENCIA_MAX, PREFERENCIA_MIN, guardarPreferencia } from "@/lib/agent/preferencias";
import type { OwnerReason } from "@/lib/agent/owner-reason";

/** Los nombres, como en Claude Code: es lo que el modelo ya sabe usar. */
export const HERRAMIENTAS_DE_FICHEROS = ["Read", "Edit", "Write", "Grep", "Glob"] as const;
export type HerramientaDeFicheros = (typeof HERRAMIENTAS_DE_FICHEROS)[number];

export function esHerramientaDeFicheros(nombre: string): nombre is HerramientaDeFicheros {
  return (HERRAMIENTAS_DE_FICHEROS as readonly string[]).includes(nombre);
}

/** Lo que va al modelo: el `tool_result` tal cual, y `ok`/`error` para el bucle
 *  y la tarjeta. Ver `lib/agent/ficheros/resultado.ts`. */
function respuesta(r: Resultado, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return r.ok
    ? { ok: true, [CLAVE_TOOL_RESULT]: r.texto, ...extra }
    : { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto, ...extra };
}

function leidosDe(session: AgentSession): Leidos {
  session.leidos ??= new Map();
  return session.leidos;
}


/** Un almacén visto como fichero (H3): su texto y lo que hace falta para
 *  guardarlo. */
interface FicheroDeDatos {
  readonly nombre: string;
  readonly declarado: AlmacenDeclarado;
  readonly filas: FilaDeAlmacen[];
  readonly texto: string;
  readonly conVisitantes: boolean;
}
type Almacenes = ReadonlyMap<string, FicheroDeDatos>;

/** Los almacenes del borrador como ficheros de /datos. Fail-soft: si no se
 *  pueden leer, el sitio sigue siendo sus páginas (como `leer_estado`). */
async function almacenesDe(session: AgentSession, deps: AgentDeps): Promise<Almacenes> {
  const out = new Map<string, FicheroDeDatos>();
  if (!deps.almacenesDelProyecto) return out;
  try {
    for (const a of await deps.almacenesDelProyecto(session.projectId)) {
      out.set(rutaDeAlmacen(a.nombre), {
        ...a,
        texto: textoDelAlmacen(a.filas),
        conVisitantes: llevaTextoDeVisitantes(a.declarado, a.filas),
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[agente] no se pudieron leer los almacenes como ficheros", err);
  }
  return out;
}

/** Los ficheros que no son páginas (H3): los almacenes y la memoria. */
interface Virtuales {
  readonly almacenes: Almacenes;
  /** `/memoria/dueno.md` y `/memoria/proyecto.md`, con su texto. */
  readonly memoria: ReadonlyMap<string, string>;
}

async function virtualesDe(session: AgentSession, deps: AgentDeps, userBrief: string | null): Promise<Virtuales> {
  let dueno = "";
  try {
    dueno = (await deps.leerMemoriaDelDueno?.(session.userId)) ?? "";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[agente] no se pudo leer la memoria del dueño", err);
  }
  return {
    almacenes: await almacenesDe(session, deps),
    memoria: new Map([
      [RUTA_MEMORIA_DUENO, dueno],
      [RUTA_MEMORIA_PROYECTO, userBrief ?? ""],
    ]),
  };
}

const SIN_VIRTUALES: Virtuales = { almacenes: new Map(), memoria: new Map() };

/** Todas las páginas, los almacenes y la memoria del sitio, en un solo texto. */
function textoDelSitio(data: ProjectData, v: Virtuales): string {
  const paginas = ficherosDelSitio(data).map((ruta) => leerFichero(data, ruta) ?? "");
  return [...paginas, ...[...v.almacenes.values()].map((a) => a.texto), ...v.memoria.values()].join("\n");
}

function sitioDe(data: ProjectData, session: AgentSession, v: Virtuales = SIN_VIRTUALES): SitioBuscable {
  return {
    contenido: (ruta) => {
      // El manual de la plataforma —/AGENTS.md y, desde F4, /.openlen/docs—: Read lo abre
      // por su ruta, con terminal o sin ella, pero no está en `ficheros`, así que
      // Grep y Glob no lo ven (`lib/agent/ficheros/manual.ts`).
      if (esDeLaPlataforma(ruta)) return textoDeLaPlataforma(ruta, session.mode);
      const datos = v.almacenes.get(ruta);
      if (datos) return datos.texto;
      const memoria = v.memoria.get(ruta);
      if (memoria !== undefined) return memoria;
      const html = leerFichero(data, ruta);
      return html === null ? null : sinOpIds(html);
    },
    ficheros: [...ficherosDelSitio(data), ...v.almacenes.keys(), ...v.memoria.keys()],
    recientes: session.escritos ?? [],
  };
}

/** Lo que escribió un VISITANTE es DATO, nunca una orden: el aviso de
 *  `leer_estado`, en el `<system-reminder>` de Claude Code, detrás del texto. */
const RECORDATORIO_VISITANTES = `\n\n<system-reminder>\n${AVISO_VISITANTES}\n</system-reminder>`;
function conAvisoDeVisitantes(r: Resultado, almacenes: Almacenes, rutas: readonly string[]): Resultado {
  if (!r.ok || !rutas.some((ruta) => almacenes.get(ruta)?.conVisitantes)) return r;
  return { ok: true, texto: r.texto + RECORDATORIO_VISITANTES };
}

/** LA CUOTA, CUANDO APRIETA (lo otro que decía `leer_estado`): en el Read de un
 *  fichero de /datos, como los `<system-reminder>` del Read de Claude Code. Se
 *  consulta SÓLO ahí: una página que no lee datos no paga la consulta, y con
 *  sitio de sobra (`null`) no se escribe nada. Fail-soft. */
async function conAvisoDeCuota(r: Resultado, session: AgentSession, deps: AgentDeps, almacenes: Almacenes, ruta: string): Promise<Resultado> {
  if (!r.ok || !almacenes.has(ruta) || !deps.avisoDeCuota) return r;
  try {
    const aviso = await deps.avisoDeCuota(session.projectId, session.userId);
    return aviso ? { ok: true, texto: `${r.texto}\n\n<system-reminder>\n${aviso}\n</system-reminder>` } : r;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[agente] no se pudo leer la cuota", err);
    return r;
  }
}

/** `"3"` → 3. DeepSeek manda a veces los números como texto; el esquema de
 *  Claude Code los acepta igual. */
function numero(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function booleano(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

export async function toolRead(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: respuesta(fallo("project not found")) };
  const v = await virtualesDe(session, deps, row.userBrief);
  const file_path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "";
  const r = ejecutarRead(
    {
      file_path,
      ...(numero(args.offset) !== undefined ? { offset: numero(args.offset) } : {}),
      ...(numero(args.limit) !== undefined ? { limit: numero(args.limit) } : {}),
    },
    sitioDe(row.data, session, v),
    leidosDe(session),
  );
  const ruta = resolverRuta(file_path);
  return { response: respuesta(await conAvisoDeCuota(conAvisoDeVisitantes(r, v.almacenes, [ruta]), session, deps, v.almacenes, ruta)) };
}

export async function toolGrep(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: respuesta(fallo("project not found")) };
  const texto = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
  const entrada: EntradaGrep = {
    pattern: texto("pattern") ?? "",
    ...(texto("path") !== undefined ? { path: texto("path") } : {}),
    ...(texto("glob") !== undefined ? { glob: texto("glob") } : {}),
    ...(texto("type") !== undefined ? { type: texto("type") } : {}),
    ...(texto("output_mode") !== undefined ? { output_mode: texto("output_mode") as EntradaGrep["output_mode"] } : {}),
    ...Object.fromEntries(
      (["-B", "-A", "-C", "context", "head_limit", "offset"] as const)
        .map((k) => [k, numero(args[k])] as const)
        .filter(([, v]) => v !== undefined),
    ),
    ...Object.fromEntries(
      (["-n", "-i", "-o", "multiline"] as const)
        .map((k) => [k, booleano(args[k])] as const)
        .filter(([, v]) => v !== undefined),
    ),
  };
  const v = await virtualesDe(session, deps, row.userBrief);
  const r = ejecutarGrep(entrada, sitioDe(row.data, session, v));
  // Si en lo encontrado hay un almacén con filas de visitantes, el aviso va detrás.
  const tocados = r.ok ? [...v.almacenes.keys()].filter((ruta) => r.texto.includes(rutaRelativa(ruta))) : [];
  return { response: respuesta(conAvisoDeVisitantes(r, v.almacenes, tocados)) };
}

export async function toolGlob(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: respuesta(fallo("project not found")) };
  const r = ejecutarGlob(
    {
      pattern: typeof args.pattern === "string" ? args.pattern : "",
      ...(typeof args.path === "string" ? { path: args.path } : {}),
    },
    sitioDe(row.data, session, await virtualesDe(session, deps, row.userBrief)),
  );
  return { response: respuesta(r) };
}

export async function toolEdit(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const entrada = coercerEntradaEdit(args);
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: respuesta(fallo("project not found")) };
  const v = await virtualesDe(session, deps, row.userBrief);
  const plan = planearEdit(entrada, sitioDe(row.data, session, v), leidosDe(session));
  const detalle = `${rutaRelativa(plan.ok ? plan.ruta : entrada.file_path)}: «${recorte(entrada.old_string)}» → «${recorte(entrada.new_string)}»`;
  return await aplicarPlan(session, deps, row.data, v, plan, "Edit", detalle, undefined, {
    old_string: entrada.old_string,
    new_string: entrada.new_string,
  });
}

export async function toolWrite(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const { entrada, nota } = coercerEntradaWrite(args);
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: respuesta(fallo("project not found")) };
  const v = await virtualesDe(session, deps, row.userBrief);
  const plan = planearWrite(entrada, sitioDe(row.data, session, v), leidosDe(session));
  const detalle = `${rutaRelativa(plan.ok ? plan.ruta : entrada.file_path)}${plan.ok && plan.crea ? " (página nueva)" : ""}`;
  return await aplicarPlan(session, deps, row.data, v, plan, "Write", detalle, nota);
}

function recorte(s: string): string {
  const una = s.replace(/\s+/g, " ").trim();
  return una.length > 40 ? `${una.slice(0, 40)}…` : una;
}

async function aplicarPlan(
  session: AgentSession,
  deps: AgentDeps,
  data: ProjectData,
  v: Virtuales,
  plan: PlanDeEdit,
  herramienta: "Edit" | "Write" | "bash",
  /** Sobre qué fichero y qué cambio. La tarjeta lo pone detrás de su etiqueta
   *  localizada («Editando la página»), así que no repite la herramienta; la
   *  versión sí la nombra, porque en el panel de Versiones no hay nada delante. */
  detalle: string,
  nota?: string,
  edit?: { old_string: string; new_string: string },
): Promise<ToolOutcome> {
  if (!plan.ok) return { response: respuesta(plan.resultado) };
  if (almacenDeRuta(plan.ruta) !== null) {
    return await guardarDatos(session, deps, v.almacenes, plan, herramienta, detalle);
  }
  if (alcanceDeRuta(plan.ruta) !== null) {
    return await guardarMemoria(session, deps, v.memoria, plan, herramienta, detalle);
  }
  const etiqueta = `${herramienta} ${detalle}`;
  // El sitio de ANTES de la primera escritura del turno: lo que ya decía en
  // cualquier página es de su usuario, y los avisos de procedencia lo cuentan.
  session.sitioAlEmpezar ??= textoDelSitio(data, v);
  const guardado = await guardarFichero(session, deps, data, plan.ruta, plan.contenido, { crea: plan.crea, etiqueta });
  if (!guardado.ok) {
    return { response: respuesta(fallo(guardado.error)), ...(guardado.ownerReason ? { ownerReason: guardado.ownerReason } : {}) };
  }

  // Lo que Len recuerda como leído es lo que SE GUARDÓ, como Claude Code tras su
  // propia escritura: así su siguiente edición no se cree pisada por otro.
  leidosDe(session).set(plan.ruta, {
    instantanea: normalizarFinales(sinOpIds(guardado.html)),
    offset: undefined,
    limit: undefined,
  });
  session.escritos = [plan.ruta, ...(session.escritos ?? []).filter((r) => r !== plan.ruta)];
  const alEmpezar = (session.alEmpezar ??= new Map());
  if (!alEmpezar.has(plan.ruta) && guardado.previo !== null) alEmpezar.set(plan.ruta, sinOpIds(guardado.previo));

  const texto = plan.respuesta({ guardadoIgual: guardado.html === plan.contenido }) + (nota ? `\n\n${nota}` : "");
  return {
    response: respuesta({ ok: true, texto }, { cambio: guardado.cambio }),
    action: { tool: herramienta, ok: true, summary: detalle, cambio: guardado.cambio },
    updatedHtml: guardado.html,
    page: guardado.page,
    // Cómo estaba antes: la línea base de lo que el navegador mida (T9).
    htmlPrevio: guardado.previo === null ? null : sinOpIds(guardado.previo),
    // Lo que esta escritura dejó mal, anclado a línea: vuelve al modelo en el
    // `<new-diagnostics>` hermano, como en Claude Code (T9).
    ...conDiagnosticos(
      diagnosticosDeLaEscritura({
        ruta: plan.ruta,
        antes: guardado.previo === null ? null : sinOpIds(guardado.previo),
        despues: sinOpIds(guardado.html),
        fuentes: [session.userPrompt, session.brief, alEmpezar.get(plan.ruta), session.sitioAlEmpezar],
        ...(edit ? { edit } : {}),
        referenciasRotas: guardado.referenciasRotas,
      }),
    ),
    ...(guardado.versionPrevia ? { versionPrevia: guardado.versionPrevia } : {}),
  };
}

/**
 * GUARDAR UN FICHERO DE /memoria (H3): SÓLO SE AÑADE (`lineasNuevas`). Cada
 * línea nueva pasa por la mecánica de siempre (`guardarPreferencia`); los
 * largos se comprueban TODOS antes de guardar la primera.
 */
async function guardarMemoria(
  session: AgentSession,
  deps: AgentDeps,
  memoria: ReadonlyMap<string, string>,
  plan: Extract<PlanDeEdit, { ok: true }>,
  herramienta: "Edit" | "Write" | "bash",
  detalle: string,
): Promise<ToolOutcome> {
  const alcance = alcanceDeRuta(plan.ruta)!;
  const r = lineasNuevas(memoria.get(plan.ruta) ?? "", plan.contenido, plan.ruta);
  if (!r.ok) return { response: respuesta(fallo(r.error)) };
  const larga = r.nuevas.find((l) => l.length < PREFERENCIA_MIN || l.length > PREFERENCIA_MAX);
  if (larga !== undefined) {
    return { response: respuesta(fallo(`Each line of ${plan.ruta} must be between ${PREFERENCIA_MIN} and ${PREFERENCIA_MAX} characters: «${larga}».`)) };
  }
  for (const preferencia of r.nuevas) {
    const g = await guardarPreferencia(session, deps, { preferencia, alcance });
    if (g.response.ok === false) {
      return {
        response: respuesta(fallo(`${plan.ruta}: «${preferencia}» was not saved: ${String(g.response.error ?? "")}`)),
        // La memoria llena (N41) se le dice al dueño igual que por `guardar_preferencia`.
        ...(g.ownerReason ? { ownerReason: g.ownerReason } : {}),
      };
    }
  }
  // Lo que quedó de VERDAD (el servidor pone el marcador y la viñeta).
  const row = await deps.loadProject(session.projectId, session.userId);
  const ahora = (await virtualesDe(session, deps, row?.userBrief ?? null)).memoria.get(plan.ruta) ?? plan.contenido;
  leidosDe(session).set(plan.ruta, { instantanea: normalizarFinales(ahora), offset: undefined, limit: undefined });
  session.escritos = [plan.ruta, ...(session.escritos ?? []).filter((x) => x !== plan.ruta)];
  const cambio = r.nuevas.length > 0 ? "cambio" : "sin_cambio";
  return {
    response: respuesta({ ok: true, texto: plan.respuesta({ guardadoIgual: ahora === plan.contenido }) }, { cambio }),
    action: { tool: herramienta, ok: true, summary: detalle, cambio },
    ...(r.nuevas.length > 0 ? { mutoDurable: true } : {}),
  };
}

/**
 * GUARDAR UN FICHERO DE /datos (H3): el texto nuevo se convierte en altas,
 * cambios y bajas, validado ENTERO antes de aplicar nada (`planDelAlmacen`), y
 * se aplica con las reglas de siempre (`deps.aplicarAlmacen`). El almacén se
 * declara en la PÁGINA: un fichero de un almacén que no existe no se crea.
 */
async function guardarDatos(
  session: AgentSession,
  deps: AgentDeps,
  almacenes: Almacenes,
  plan: Extract<PlanDeEdit, { ok: true }>,
  herramienta: "Edit" | "Write" | "bash",
  detalle: string,
): Promise<ToolOutcome> {
  const nombre = almacenDeRuta(plan.ruta)!;
  const actual = almacenes.get(plan.ruta);
  if (!actual || !deps.aplicarAlmacen) return { response: respuesta(fallo(noDeclarado(nombre))) };
  const p = planDelAlmacen(actual.filas, plan.contenido, actual.declarado, nombre);
  if (!p.ok) return { response: respuesta(fallo(p.error)) };
  const vacio = p.plan.altas.length + p.plan.cambios.length + p.plan.bajas.length === 0;
  if (!vacio) {
    const r = await deps.aplicarAlmacen({ projectId: session.projectId, userId: session.userId, almacen: nombre, plan: p.plan });
    if (!r.ok) return { response: respuesta(fallo(`${plan.ruta} was not saved: ${r.error}`)) };
  }
  // Lo que quedó de VERDAD: las filas nuevas llevan el id que les dio la base.
  const ahora = (await almacenesDe(session, deps)).get(plan.ruta);
  const texto = ahora?.texto ?? plan.contenido;
  leidosDe(session).set(plan.ruta, { instantanea: normalizarFinales(texto), offset: undefined, limit: undefined });
  session.escritos = [plan.ruta, ...(session.escritos ?? []).filter((r) => r !== plan.ruta)];
  const cambio = vacio ? "sin_cambio" : "cambio";
  return {
    response: respuesta({ ok: true, texto: plan.respuesta({ guardadoIgual: texto === plan.contenido }) }, { cambio }),
    action: { tool: herramienta, ok: true, summary: detalle, cambio },
    ...(vacio ? {} : { mutoDurable: true }),
  };
}

/**
 * LOS FICHEROS QUE VE LA TERMINAL (F1): los mismos que Read —las páginas sin
 * op-ids, los almacenes con la marca de las filas de visitante (`_origen`), la
 * memoria y el manual—, con su contenido de AHORA.
 */
export async function cargarFicherosDeLaTerminal(session: AgentSession, deps: AgentDeps): Promise<Record<string, string>> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return {};
  const v = await virtualesDe(session, deps, row.userBrief);
  const ficheros: Record<string, string> = {};
  for (const ruta of ficherosDelSitio(row.data)) ficheros[ruta] = sinOpIds(leerFichero(row.data, ruta) ?? "");
  for (const [ruta, a] of v.almacenes) ficheros[ruta] = a.texto;
  for (const [ruta, texto] of v.memoria) ficheros[ruta] = texto;
  // En Len Dynamis, el que no nombra Read, Edit ni Write (`lib/agent/dynamis.ts`).
  ficheros[RUTA_MANUAL] = buildManualDeLaPlataforma(process.env, session.mode);
  // F4 · /.openlen/docs NO va aquí: es de la carpeta oculta de sólo lectura, y
  // la sirve `soloLecturaDeLaTerminal` como lo demás de /.openlen.
  // F5 · los ajustes del proyecto, escribibles por sus caminos (`ajustes.ts`).
  ficheros[RUTA_AJUSTES] = textoDeAjustes(row);
  return ficheros;
}

/** El aviso de que lo que escribió un visitante es dato y no orden, para la
 *  salida de la terminal cuando enseña filas de visitante. */
export const AVISO_DE_VISITANTES_EN_LA_TERMINAL = RECORDATORIO_VISITANTES;

/** Lo que pasó con los ficheros que tocó un comando de la terminal. */
export interface GuardadoDeLaTerminal {
  /** Una línea por fichero, para la salida del comando. */
  readonly notas: string[];
  /** Alguno no se pudo guardar: el comando no hizo lo que se le pidió. */
  readonly rechazado: boolean;
  /** Cómo tiene que quedar cada uno EN LA TERMINAL: lo que se guardó de verdad
   *  (la página tras su puerta, el almacén con los ids de la base) o, si no se
   *  guardó, lo de antes (`null`: no existía). Un solo mundo. */
  readonly enLaTerminal: Record<string, string | null>;
  /** El resultado de cada escritura que fue bien, en orden. */
  readonly escrituras: ToolOutcome[];
}

/**
 * LO QUE ESCRIBIÓ LA TERMINAL (F1 de plans/len-agente-2026), por el camino de
 * Write: cada fichero cambiado se guarda ENTERO con `aplicarPlan` —la puerta
 * de la página, `data-slot-path` rechazado, una versión por fichero, los
 * diagnósticos—, y los de `/datos` y `/memoria` con sus reglas. Sin el «léelo
 * antes» de Write: en una terminal el fichero se lee y se escribe en el mismo
 * comando (`sed -i`), como en la de DeepSeek. Lo que no se guarda —el manual,
 * borrar un fichero del sitio, lo que su puerta rechaza— vuelve a la terminal
 * como estaba.
 */
export async function guardarLoDeLaTerminal(
  session: AgentSession,
  deps: AgentDeps,
  cambios: readonly CambioDeLaTerminal[],
  antes: Readonly<Record<string, string>>,
): Promise<GuardadoDeLaTerminal> {
  const notas: string[] = [];
  const enLaTerminal: Record<string, string | null> = {};
  const escrituras: ToolOutcome[] = [];
  let rechazado = false;
  // LA TERMINAL DEL USUARIO no mete código que el sitio no tenía: lo activo de
  // cada página que escribe tiene que estar ya en alguna página guardada.
  const delSitio =
    session.autor === "usuario"
      ? activoDelSitio(Object.entries(antes).filter(([r]) => paginaDeRuta(r) !== null).map(([, html]) => html))
      : null;
  const deshacer = (ruta: string, motivo: string) => {
    rechazado = true;
    const previo = Object.hasOwn(antes, ruta) ? antes[ruta]! : null;
    enLaTerminal[ruta] = previo;
    notas.push(`${rutaRelativa(ruta)}: not saved — ${motivo} ${previo === null ? "It was removed." : "It is back as it was."}`);
  };
  for (const c of cambios) {
    if (c.tipo === "borrado") {
      deshacer(c.ruta, "the terminal cannot delete files of the site (a page is removed by the user, in the editor).");
      continue;
    }
    if (esDeLaPlataforma(c.ruta)) {
      deshacer(c.ruta, MANUAL_SOLO_LECTURA);
      continue;
    }
    if (c.ruta === RUTA_AJUSTES) {
      const g = await guardarAjustes(session, deps, c.contenido);
      if (!g.ok) {
        deshacer(c.ruta, g.motivo);
        continue;
      }
      if (g.incompleto) rechazado = true;
      escrituras.push(...g.escrituras);
      enLaTerminal[c.ruta] = g.texto;
      notas.push([`${rutaRelativa(c.ruta)}: saved.`, ...g.notas.map((n) => `  ${n}`)].join("\n"));
      continue;
    }
    if (delSitio && paginaDeRuta(c.ruta) !== null) {
      const motivo = codigoNuevo(c.contenido, delSitio);
      if (motivo) {
        deshacer(c.ruta, motivo);
        continue;
      }
    }
    // El proyecto de AHORA en cada fichero: el anterior del mismo comando ya cambió el sitio.
    const row = await deps.loadProject(session.projectId, session.userId);
    if (!row) {
      deshacer(c.ruta, "the project was not found.");
      continue;
    }
    const v = await virtualesDe(session, deps, row.userBrief);
    const plan: PlanDeEdit = {
      ok: true,
      ruta: c.ruta,
      contenido: c.contenido,
      crea: c.crea,
      respuesta: () => `Saved ${rutaRelativa(c.ruta)}.`,
    };
    const detalle = `${rutaRelativa(c.ruta)}${c.crea && paginaDeRuta(c.ruta) ? " (página nueva)" : ""}`;
    const o = await aplicarPlan(session, deps, row.data, v, plan, "bash", detalle);
    if (o.response.ok === false) {
      deshacer(c.ruta, `${String(o.response.error ?? "it was rejected").replace(/\.?$/, ".")}`);
      continue;
    }
    escrituras.push(o);
    if (o.updatedHtml !== undefined) {
      enLaTerminal[c.ruta] = sinOpIds(o.updatedHtml);
    } else {
      const ahora = await virtualesDe(session, deps, (await deps.loadProject(session.projectId, session.userId))?.userBrief ?? null);
      enLaTerminal[c.ruta] = ahora.almacenes.get(c.ruta)?.texto ?? ahora.memoria.get(c.ruta) ?? c.contenido;
    }
    notas.push(`${rutaRelativa(c.ruta)}: saved${c.crea && paginaDeRuta(c.ruta) ? " (new page)" : ""}.`);
  }
  return { notas, rechazado, enLaTerminal, escrituras };
}

function conDiagnosticos(ds: ToolOutcome["diagnosticos"]): Pick<ToolOutcome, "diagnosticos"> {
  return ds && ds.length > 0 ? { diagnosticos: ds } : {};
}

/**
 * LA PÁGINA DE UNA HERRAMIENTA QUE NO EDITA POR RUTA (`mirar_pagina`,
 * `revertir_ultimo_cambio`). Len 2.0 no tiene página activa: la que se dice en
 * `file_path`; si no se dice, la última escrita en este turno cuando eso es lo
 * que tiene sentido (deshacer), y si no, la que el dueño tiene abierta en el
 * editor — el «fichero abierto en el IDE» de Claude Code.
 */
export function paginaPedida(
  session: AgentSession,
  data: ProjectData,
  filePath: unknown,
  opts: { preferirLoEscrito: boolean },
): { ok: true; ruta: string; page: string | null } | { ok: false; error: string } {
  if (typeof filePath === "string" && filePath.trim() !== "") {
    const ruta = resolverRuta(filePath);
    const donde = paginaDeRuta(ruta);
    if (!donde || leerFichero(data, ruta) === null) {
      return { ok: false, error: noExiste(ruta, ficherosDelSitio(data)) };
    }
    return { ok: true, ruta, page: donde.page };
  }
  const escrito = opts.preferirLoEscrito ? session.escritos?.[0] : undefined;
  const donde = escrito ? paginaDeRuta(escrito) : null;
  if (escrito && donde) return { ok: true, ruta: escrito, page: donde.page };
  return { ok: true, ruta: rutaDePagina(session.page), page: session.page };
}

type Guardado =
  | {
      ok: true;
      html: string;
      page: string | null;
      cambio: "cambio" | "sin_cambio" | "no_se";
      versionPrevia: string | null;
      /** Cómo estaba el fichero antes de guardar; `null` si no existía. */
      previo: string | null;
      /** Los ids que el script busca y esta escritura dejó sin elemento. */
      referenciasRotas: readonly string[];
    }
  /** `ownerReason` (N41): lo que lee el dueño, cuando el fallo es suyo de entender. */
  | { ok: false; error: string; ownerReason?: OwnerReason };

/**
 * Guarda un fichero por el camino de siempre. Es `persistHtmlChange` sin la
 * sesión de un documento activo: aquí cada escritura dice a qué fichero va.
 * La usan también las herramientas que escriben sin ser Edit/Write
 * (`editar_imagen`, `revertir_ultimo_cambio`).
 */
export async function guardarFichero(
  session: AgentSession,
  deps: AgentDeps,
  data: ProjectData,
  ruta: string,
  contenido: string,
  opts: { crea: boolean; etiqueta: string },
): Promise<Guardado> {
  const donde = paginaDeRuta(ruta);
  if (!donde) return { ok: false, error: `Cannot write ${ruta}: this site only has pages, at /index.html and /<slug>/index.html.` };
  const page = donde.page;

  if (opts.crea && page !== null) {
    const check = validatePageSlug(page);
    if (!check.ok || check.slug !== page) {
      const buena = check.ok ? ` Did you mean /${check.slug}/index.html?` : "";
      return {
        ok: false,
        error: `Cannot create ${ruta}: "${page}" is not a valid page name — use lowercase letters, numbers and hyphens (1-40 characters), and not a reserved name.${buena}`,
      };
    }
    if (Object.keys(data.pages ?? {}).length >= MAX_SITE_PAGES) {
      return {
        ok: false,
        error: `Cannot create ${ruta}: this site already has the maximum of ${MAX_SITE_PAGES} pages.`,
        ownerReason: { code: "site_page_limit", limit: MAX_SITE_PAGES },
      };
    }
  }

  if (detectSlotPath(contenido)) {
    return { ok: false, error: "the HTML contains a reserved marker (data-slot-path)" };
  }
  const antes = leerFichero(data, ruta);
  const preparado = await preparePage(contenido, {
    mode: opts.crea ? "create" : "edit",
    renderChecks: false,
    ...(session.brief ? { brief: session.brief } : {}),
    ...(antes !== null ? { priorHtml: antes } : {}),
  });
  if (!preparado.ok) {
    const conductas = describeBehaviorIssues([...((preparado.report.behaviorIssues ?? []) as never[])]);
    return {
      ok: false,
      error: conductas
        ? `There are badly wired behaviors that would be born DEAD on the page: ${conductas}. NOTHING was saved.`
        : preparado.code === "reserved_marker"
          ? "the HTML contains a reserved marker (data-slot-path)"
          : `the HTML didn't pass the publishing gate (${preparado.code}${preparado.detail ? `: ${preparado.detail}` : ""})`,
    };
  }

  // Lo que escribe la terminal del USUARIO lleva su nombre en Versiones: ni
  // «Before AI edit» ni origen `chat`, que dirían que lo hizo Len.
  const delUsuario = session.autor === "usuario";
  // Y desde dónde: su terminal o el editor de la lente «Código» (la #18).
  const [nombre, previa] = session.desde === "editor" ? ["Code editor", "Before code edit"] : ["Terminal", "Before terminal edit"];
  const guardado = await persistPage(
    {
      projectId: session.projectId,
      userId: session.userId,
      page,
      html: preparado.html,
      label: delUsuario ? `${nombre}: ${opts.etiqueta.replace(/^\S+\s/, "")}` : opts.etiqueta,
      ...(delUsuario ? { etiquetaPrevia: previa, fuente: "manual" as const } : {}),
    },
    deps,
  );
  if (!guardado.ok) return { ok: false, error: guardado.error };
  return {
    ok: true,
    html: guardado.html,
    page,
    cambio: guardado.cambio.estado,
    versionPrevia: guardado.versionPrevia,
    previo: antes,
    referenciasRotas: guardado.referenciasRotas,
  };
}
