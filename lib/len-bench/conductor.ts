// lib/len-bench/conductor.ts — UN encargo, de principio a fin.
//
//   1. Proyecto de usar y tirar con la página de PARTIDA, de la identidad de eval.
//   2. Por cada paso del guion: el dueño manda su mensaje, Len contesta POR
//      HTTP (la ruta de producción), y el cliente simulado decide si contesta
//      o pasa al siguiente paso — hasta MAX_RESPUESTAS_POR_PASO veces.
//      El historial de cada turno se rehace desde las filas que escribió el
//      SERVIDOR, como las ve el taller al recargar: es lo que ve el dueño que
//      vuelve «dos semanas después».
//   3. Se publica con `publishProject` y se sirve como Caddy.
//   4. Se califica, se mide el coste y se limpia TODO pase lo que pase.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNotNull, like, ne, sql } from "drizzle-orm";
import type { Browser } from "puppeteer";
import { db, schema } from "@/lib/db";
import {
  createThrowawayProject,
  deleteThrowawayProject,
  restoreAgentMemory,
  snapshotAgentMemory,
} from "@/lib/len-bench/proyecto-de-eval";
import { getChatMessages } from "@/lib/projects/chat";
import { accionesAlRecargar, historialParaElAgente } from "@/lib/chat/historial-del-agente";
import { publishProject } from "@/lib/projects";
import { getPublishRoot } from "@/lib/publish/filesystem";
import { publishedHost } from "@/lib/publish/base-host";
import { getUserPlan } from "@/lib/limits";
import { subdomainLimitForPlan } from "@/lib/subdomain/limits";
import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits";
import type { ProjectData } from "@/lib/projects/types";
import { capturarPublicada } from "./capturas";
import { usdDeProyecto } from "./coste";
import { rutasPublicadas } from "./graders";
import { decidirComoCliente, MAX_RESPUESTAS_POR_PASO, preguntoLen, respetaLaFicha } from "./cliente-simulado";
import { problemasDelEntorno } from "./entorno";
import { htmlDe } from "./extraer";
import { filaComoLaDeUnDueno } from "./fila-del-dueno";
import { conReintentoPorEperm } from "./reintentar-publicar";
import { cierreHonesto } from "./honestidad";
import { gastoDelJuez } from "./juez";
import { puntuarCorrida } from "./puntuar";
import { enviarTurno, tarjetaDePublicar, textoDeLen, tocarPublicar } from "./sesion";
import { servirPublicada } from "./servidor-publicada";
import type { Desenlace, Encargo, Intercambio, ResultadoDeCorrida, ResultadoDeGrader } from "./tipos";

/** La zona del dueño si el caso no dice otra: la que manda el panel de un
 *  usuario en México (plans/len-resultados/diseno.md §7). */
export const ZONA_POR_DEFECTO = "America/Mexico_City";

export interface OpcionesDelConductor {
  readonly base: string;
  readonly cookie: string;
  readonly owner: { readonly id: string; readonly email: string };
  readonly navegador: Browser;
  readonly dirGrabaciones: string;
  /** Deja el proyecto y la publicada para enseñárselos a Jesús. */
  readonly conservar: boolean;
  /** Carpeta donde se guarda la página final de cada corrida (`capturas.ts`). Sin ella, no se captura. */
  readonly capturasEn?: string;
  readonly timeoutTurnoMs: number;
}

/**
 * Un fallo del MONTAJE, no de Len: sin créditos, el agente apagado, el
 * entorno tocando producción. No se apunta como corrida: para Len-Bench
 * entero, porque todas las que vinieran detrás medirían lo mismo.
 */
export class ErrorDeMontaje extends Error {}

function exigirEntorno(): void {
  const p = problemasDelEntorno(process.env, process.cwd());
  if (p.length > 0) {
    throw new ErrorDeMontaje(
      `el entorno de este proceso no es el de Len-Bench (¿falta apagarEnEsteProceso?):\n  · ${p.join("\n  · ")}`,
    );
  }
}

/**
 * Len tiene que PODER publicar cuando se lo piden. El tope de subdominios del
 * plan cuenta los de todos los proyectos de la identidad de eval, y los
 * conservados con `--conservar` se acumulan: sin hueco, la publicación de Len
 * fallaría y se mediría como un fallo suyo.
 */
async function exigirHuecoDeSubdominio(userId: string): Promise<void> {
  const cap = subdomainLimitForPlan(await getUserPlan(userId));
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), isNotNull(schema.projects.subdomain)));
  const n = r[0]?.n ?? 0;
  if (n >= cap) {
    throw new ErrorDeMontaje(
      `la identidad de eval ya tiene ${n} subdominios y su plan permite ${cap}: Len no podría publicar. ` +
        `Borra los proyectos conservados de corridas anteriores.`,
    );
  }
}

async function creditos(userId: string): Promise<number> {
  const r = await db.select({ c: schema.users.credits }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return r[0]?.c ?? 0;
}

async function filaDelProyecto(projectId: string): Promise<{ data: ProjectData; subdomain: string | null }> {
  const r = await db
    .select({ data: schema.projects.data, subdomain: schema.projects.subdomain })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!r[0]) throw new Error(`el proyecto ${projectId} desapareció a media corrida`);
  return { data: r[0].data as ProjectData, subdomain: r[0].subdomain };
}

function subdominioDePrueba(id: string): string {
  const base = id.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40).replace(/-+$/, "");
  return `lb-${base}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Publica un proyecto, lo sirve como Caddy y corre los graders. Lo usan la corrida y el validador. */
export async function calificarDatos(
  e: Encargo,
  projectId: string,
  o: Pick<OpcionesDelConductor, "base" | "owner" | "navegador" | "conservar">,
  extra: {
    conversacion: readonly Intercambio[];
    /** Sólo el validador: no hay Len que publique (`publicadaAlValidar`). */
    publicadaPorLen?: boolean;
    /** Ver `OpcionesDelConductor.capturasEn`. */
    capturasEn?: string;
    /** Casos de resultados: lo que Len llamó y las tarjetas que dejó. */
    herramientas?: readonly string[];
    tarjetas?: readonly Record<string, unknown>[];
    zona?: string;
    /** Por qué NO se corren los graders de pago (el juez): el validador va a
     *  $0. Se reportan saltados y sin voto, como su «skipped: cost ceiling». */
    saltarPagados?: string;
  },
): Promise<{ graders: ResultadoDeGrader[]; sub: string }> {
  exigirEntorno();
  // El limitador de /api/f/ cuenta 20 envíos por hora y por IP, y en Len-Bench
  // todos los «visitantes» salen de 127.0.0.1: tras 20 envíos, cada formulario
  // siguiente contestaba 429 y se le cargaba a Len (visto el 23/09 validando
  // dev: la solución de reservas-sin-motor suspendió detrás de la calculadora).
  // En producción cada visitante trae su IP; como el saldo de créditos de la
  // identidad de eval, se repone antes de calificar. Sólo en la base local.
  await db.delete(schema.rateLimitEvents).where(like(schema.rateLimitEvents.key, "ip:%:form-submit"));
  const fila = await filaDelProyecto(projectId);
  const publicadaPorLen = extra.publicadaPorLen ?? fila.subdomain !== null;
  const sub = fila.subdomain ?? subdominioDePrueba(e.id);
  // Se publica SIEMPRE, también si Len ya publicó: lo que se califica es la
  // página final, y su última edición pudo llegar después de su publicación.
  // Sin Lighthouse: tarda, escribe en la base y no lo mira ningún grader.
  // En Windows, el rename de la release de un sitio de varias páginas falla a
  // veces con EPERM un instante (ver `reintentar-publicar.ts`).
  await conReintentoPorEperm(() => publishProject({ projectId, userId: o.owner.id, subdomain: sub, languages: [], skipFlightCheck: true }));
  const final = await filaDelProyecto(projectId);
  const servidor = await servirPublicada({ raiz: getPublishRoot(), sub, next: o.base, hostPublicado: publishedHost(sub) });
  try {
    const ctx = {
      url: servidor.url,
      next: o.base,
      sub,
      projectId,
      ficha: e.ficha,
      datos: final.data,
      inicio: e.inicio,
      publicadaPorLen,
      conversacion: extra.conversacion,
      herramientas: extra.herramientas ?? [],
      tarjetas: extra.tarjetas ?? [],
      zona: extra.zona ?? ZONA_POR_DEFECTO,
      navegador: o.navegador,
      leerEnvios: async () =>
        (
          await db
            .select({ data: schema.formSubmissions.data })
            .from(schema.formSubmissions)
            .where(eq(schema.formSubmissions.projectId, projectId))
        ).map((x) => x.data),
    };
    // La foto va ANTES de los graders, que pulsan y dejan estado (`capturas.ts`).
    // Si no sale, la corrida se califica igual: una captura no es una medida.
    if (extra.capturasEn) {
      await capturarPublicada({
        navegador: o.navegador,
        url: servidor.url,
        next: o.base,
        sub,
        rutas: rutasPublicadas(ctx),
        destino: extra.capturasEn,
      }).catch((err: unknown) =>
        console.log(`      ⚠ ${e.id}: no se pudo capturar la página (${err instanceof Error ? err.message : String(err)})`),
      );
    }
    const graders: ResultadoDeGrader[] = [];
    for (const g of e.graders) {
      if (g.pago && extra.saltarPagados) {
        graders.push({ nombre: g.nombre, peso: g.peso, puntua: false, paso: false, explicacion: `saltado: ${extra.saltarPagados}` });
        continue;
      }
      try {
        const r = await g.calificar(ctx);
        graders.push({ nombre: g.nombre, peso: g.peso, puntua: g.puntua !== false, ...r });
      } catch (err) {
        // Un grader que revienta es un fallo NUESTRO, y se dice con esas palabras.
        graders.push({
          nombre: g.nombre,
          peso: g.peso,
          puntua: g.puntua !== false,
          paso: false,
          explicacion: `EL GRADER REVENTÓ (fallo de Len-Bench, no de Len): ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    graders.push(cierreHonesto(graders, extra.conversacion));
    return { graders, sub };
  } finally {
    await servidor.cerrar();
    if (!o.conservar) fs.rmSync(path.join(getPublishRoot(), sub), { recursive: true, force: true });
  }
}

export async function correrEncargo(e: Encargo, o: OpcionesDelConductor): Promise<ResultadoDeCorrida> {
  exigirEntorno();
  await exigirHuecoDeSubdominio(o.owner.id);
  const t0 = Date.now();
  const memoria = await snapshotAgentMemory(o.owner.id);
  const saldo0 = await creditos(o.owner.id);
  const juez0 = gastoDelJuez();
  const projectId = await createThrowawayProject(o.owner.id, `len-bench-${e.id}`, e.inicio, filaComoLaDeUnDueno(e.inicio));
  // Casos de resultados (plans/len-resultados/): la zona que manda el panel, lo
  // que Len llamó y las tarjetas que dejó, para los graders de la CONVERSACIÓN.
  const zona = e.zona ?? ZONA_POR_DEFECTO;
  const herramientas: string[] = [];
  const tarjetas: Record<string, unknown>[] = [];
  const conversacion: Intercambio[] = [];
  let turnosDeLen = 0;
  let usdCliente = 0;
  let desenlace: Desenlace = "completa";
  let error: string | undefined;
  let sub = "";
  let graders: ResultadoDeGrader[] = [];
  try {
    if (e.sembrar) await e.sembrar({ projectId, ownerId: o.owner.id, zona, ahora: new Date() });
    guion: for (const paso of e.guion) {
      let mensaje = paso.mensaje;
      for (let i = 0; i <= MAX_RESPUESTAS_POR_PASO; i++) {
        // Las filas del servidor, como las restaura el taller al recargar: una
        // acción que murió a medias vuelve como fallida (`accionesAlRecargar`).
        const turnos = (await getChatMessages(projectId)).map((t) => ({ ...t, actions: accionesAlRecargar(t.actions) }));
        const { history, historyTotal, dichoAntes } = historialParaElAgente(turnos, null);
        const eventos = await enviarTurno({
          base: o.base,
          cookie: o.cookie,
          // `esfuerzo: "auto"`: lo que manda el panel de un usuario nuevo.
          // `zonaHoraria`: la del navegador, como la manda el panel.
          cuerpo: { projectId, prompt: mensaje, turnId: crypto.randomUUID(), history, historyTotal, dichoAntes, esfuerzo: "auto", zonaHoraria: zona },
          timeoutMs: o.timeoutTurnoMs,
        });
        turnosDeLen++;
        const texto = textoDeLen(eventos);
        conversacion.push({ quien: "dueno", texto: mensaje }, { quien: "len", texto });
        for (const ev of eventos) {
          const d = ev.datos as { tool?: unknown } | null;
          if (ev.nombre === "action" && typeof d?.tool === "string" && !herramientas.includes(d.tool)) herramientas.push(d.tool);
          if (ev.nombre === "confirm" && ev.datos && typeof ev.datos === "object") tarjetas.push(ev.datos as Record<string, unknown>);
        }
        const err = eventos.find((x) => x.nombre === "error")?.datos as { code?: string; message?: string } | undefined;
        if (err?.code === "no_credits" || err?.code === "agent_off") {
          throw new ErrorDeMontaje(`la ruta rechazó el turno con «${err.code}»: ${err.message ?? ""}`.trim());
        }
        if (err && texto.trim() === "") {
          // Sin una palabra de Len y con error. ⚠️ La ruta manda `upstream`
          // para CUALQUIER excepción del bucle (app/api/agent/route.ts), sea el
          // proveedor o un fallo nuestro: no se puede separar sin grabación.
          // Se trata como del proveedor —se repite, no cuenta contra Len— y el
          // mensaje real va en `error` para que se lea en la tabla.
          desenlace = err.code === "upstream" ? "proveedor" : "error_de_len";
          error = `${err.code ?? "error"}: ${err.message ?? ""}`.trim();
          break guion;
        }
        // El TAP. `publicar` nunca publica: deja una tarjeta y espera al dueño.
        // Un dueño que pidió publicar la toca antes de contestar, como en el
        // taller. Sólo si el encargo lo concede (`publicaLen`), como el
        // `artifactPublishGranted` del corredor de Claude Code.
        const tarjeta = e.publicaLen ? tarjetaDePublicar(eventos) : null;
        if (tarjeta) {
          const tap = await tocarPublicar({ base: o.base, cookie: o.cookie, projectId, tarjeta });
          if (!tap.ok) console.log(`      ⚠ ${e.id}: el dueño tocó «Publicar» y no salió (${tap.motivo})`);
        }
        const d = await decidirComoCliente({ ficha: e.ficha, paso, conversacion, pregunto: preguntoLen(eventos) });
        if (!d.ok) {
          desenlace = "proveedor";
          error = `cliente simulado: ${d.motivo}`;
          break guion;
        }
        usdCliente += d.usd;
        if (d.decision.accion === "siguiente") break;
        const respeta = respetaLaFicha(
          d.decision.mensaje,
          e.ficha,
          htmlDe(e.inicio),
          conversacion.filter((x) => x.quien === "dueno").map((x) => x.texto),
        );
        if (!respeta.ok) {
          desenlace = "cliente_fuera_de_ficha";
          error = `el cliente dijo «${respeta.dato}», que no está en su ficha`;
          break guion;
        }
        mensaje = d.decision.mensaje;
      }
    }
    const cal = await calificarDatos(e, projectId, o, {
      conversacion,
      herramientas,
      tarjetas,
      zona,
      ...(o.capturasEn ? { capturasEn: o.capturasEn } : {}),
    });
    graders = cal.graders;
    sub = cal.sub;
  } catch (err) {
    if (err instanceof ErrorDeMontaje) throw err;
    desenlace = desenlace === "completa" ? "error_de_len" : desenlace;
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await restoreAgentMemory(o.owner.id, memoria);
    if (!o.conservar) await deleteThrowawayProject(projectId);
  }
  const saldo1 = await creditos(o.owner.id);
  const agente = usdDeProyecto(o.dirGrabaciones, projectId);
  const usdJuez = gastoDelJuez() - juez0;
  return {
    graders,
    score: puntuarCorrida(graders),
    desenlace,
    ...(error ? { error } : {}),
    turnosDeLen,
    creditos: (saldo0 - saldo1) / CENTICREDITOS_POR_CREDITO,
    // El juez va DENTRO del total, para que el tope lo cubra, y aparte en
    // `usdJuez` (su `judge_cost_usd`).
    usd: agente.usd + usdCliente + usdJuez,
    ...(usdJuez > 0 ? { usdJuez } : {}),
    segundos: (Date.now() - t0) / 1000,
    sub,
    conversacion,
  };
}
