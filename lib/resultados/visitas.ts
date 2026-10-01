/**
 * LAS VISITAS, CONTADAS EN LA HORA DEL USUARIO (plans/len-resultados/diseno.md §4, §7).
 *
 * `lib/analytics/queries.ts` corta los días en UTC (`DATE_TRUNC('day', ts)`),
 * que para el panel de Resultados es aceptable y para «¿cuántas hoy?» no: a las
 * 19:00 de México el día de UTC ya es mañana. Aquí el día es el del usuario.
 * Los eventos crudos se guardan 90 días (`queries.ts:4`): más atrás no hay
 * detalle, y el rango se recorta diciéndolo.
 */
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fechaLocal, restarDias } from "./zona";

export interface CuentaDeVisitas { vistas: number; personas: number; clics: number }
export interface ResumenDeVisitas {
  zona: string;
  hoy: CuentaDeVisitas;
  ayer: CuentaDeVisitas;
  ultimos7: CuentaDeVisitas;
  ultimos30: CuentaDeVisitas;
  rango: {
    desde: string;
    hasta: string;
    total: CuentaDeVisitas;
    porDia: { dia: string; vistas: number }[];
    paginas: { pagina: string; vistas: number }[];
    deDonde: { origen: string; vistas: number }[];
    dispositivos: { dispositivo: string; vistas: number }[];
  };
  recortadoDesde: string | null;
}

const DIAS_CON_DETALLE = 90;
const TOP = 5;

const e = schema.pageEvents;
const diaLocal = (zona: string): SQL => sql`((${e.ts} AT TIME ZONE 'UTC') AT TIME ZONE ${zona})::date`;

/** Los eventos de [desde, hasta] (días locales, inclusive). El prefiltro por
 *  `ts` deja usar el índice (projectId, ts): ninguna zona pasa de ±14 h. */
function delRango(projectId: string, zona: string, desde: string, hasta: string): SQL {
  const antes = new Date(`${desde}T00:00:00Z`);
  antes.setUTCDate(antes.getUTCDate() - 1);
  const despues = new Date(`${hasta}T00:00:00Z`);
  despues.setUTCDate(despues.getUTCDate() + 2);
  return and(
    eq(e.projectId, projectId),
    gte(e.ts, antes),
    lt(e.ts, despues),
    sql`${diaLocal(zona)} BETWEEN ${desde}::date AND ${hasta}::date`,
  ) as SQL;
}

async function contar(projectId: string, zona: string, desde: string, hasta: string): Promise<CuentaDeVisitas> {
  const r = await db
    .select({
      vistas: sql<number>`COUNT(*) FILTER (WHERE ${e.type} = 'view')::int`,
      personas: sql<number>`COUNT(DISTINCT ${e.uaHash}) FILTER (WHERE ${e.type} = 'view')::int`,
      clics: sql<number>`COUNT(*) FILTER (WHERE ${e.type} = 'click')::int`,
    })
    .from(e)
    .where(delRango(projectId, zona, desde, hasta));
  return { vistas: Number(r[0]?.vistas ?? 0), personas: Number(r[0]?.personas ?? 0), clics: Number(r[0]?.clics ?? 0) };
}

async function agrupar(projectId: string, zona: string, desde: string, hasta: string, clave: SQL, tope = TOP): Promise<{ clave: string; vistas: number }[]> {
  const r = await db
    .select({ clave: sql<string>`${clave}`, vistas: sql<number>`COUNT(*)::int` })
    .from(e)
    .where(and(delRango(projectId, zona, desde, hasta), eq(e.type, "view")))
    // Por POSICIÓN, no por la expresión: si la clave lleva la zona como
    // parámetro, el SELECT la manda como $1 y el GROUP BY como $9, y Postgres
    // no las ve iguales («must appear in the GROUP BY clause»). Medido.
    .groupBy(sql`1`)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(tope);
  return r.map((x) => ({ clave: String(x.clave), vistas: Number(x.vistas) }));
}

export async function resumirVisitas(
  projectId: string,
  zona: string,
  rango: { desde?: string; hasta?: string },
  ahora: Date = new Date(),
): Promise<ResumenDeVisitas> {
  const hoy = fechaLocal(ahora, zona);
  const ayer = restarDias(hoy, 1);
  const limite = restarDias(hoy, DIAS_CON_DETALLE - 1);
  const hasta = rango.hasta && rango.hasta <= hoy ? rango.hasta : hoy;
  const pedido = rango.desde ?? restarDias(hasta, 6);
  const desde = pedido < limite ? limite : pedido;

  const [cHoy, cAyer, c7, c30, total, porDia, paginas, deDonde, dispositivos] = await Promise.all([
    contar(projectId, zona, hoy, hoy),
    contar(projectId, zona, ayer, ayer),
    contar(projectId, zona, restarDias(hoy, 6), hoy),
    contar(projectId, zona, restarDias(hoy, 29), hoy),
    contar(projectId, zona, desde, hasta),
    // Un día por fila: el tope es el del rango entero, no el TOP de los demás.
    agrupar(projectId, zona, desde, hasta, sql`TO_CHAR(${diaLocal(zona)}, 'YYYY-MM-DD')`, DIAS_CON_DETALLE),
    agrupar(projectId, zona, desde, hasta, sql`'/' || COALESCE(${e.page}, '')`),
    agrupar(projectId, zona, desde, hasta, sql`COALESCE(NULLIF(split_part(split_part(${e.referrer}, '://', 2), '/', 1), ''), 'directo')`),
    agrupar(projectId, zona, desde, hasta, sql`COALESCE(${e.device}, 'desconocido')`),
  ]);

  return {
    zona,
    hoy: cHoy,
    ayer: cAyer,
    ultimos7: c7,
    ultimos30: c30,
    rango: {
      desde,
      hasta,
      total,
      porDia: porDia.map((x) => ({ dia: x.clave, vistas: x.vistas })).sort((a, b) => a.dia.localeCompare(b.dia)),
      paginas: paginas.map((x) => ({ pagina: x.clave, vistas: x.vistas })),
      deDonde: deDonde.map((x) => ({ origen: x.clave, vistas: x.vistas })),
      dispositivos: dispositivos.map((x) => ({ dispositivo: x.clave, vistas: x.vistas })),
    },
    recortadoDesde: pedido < limite ? limite : null,
  };
}
