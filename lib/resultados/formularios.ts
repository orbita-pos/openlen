/**
 * LOS FORMULARIOS QUE LE LLEGARON AL USUARIO (plans/len-resultados/diseno.md §4, §6).
 * «Sin ver» es `condicionSinVer`, la misma regla que el globito. La IP y el
 * navegador (`meta.ip`, `meta.ua`) NUNCA salen de aquí.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { contactoDe, lineaDe, type Contacto } from "./contacto";
import { condicionSinVer, marcarFormularioVisto, ultimaVistaDeFormularios } from "./visto";
import { fechaLocal, restarDias } from "./zona";

export type FiltroDeFormularios = { cuales: "nuevos" } | { cuales: "fecha"; desde?: string; hasta?: string };
export interface FormularioEnLista { id: string; fecha: string; pagina: string | null; de: string | null; linea: string; visto: boolean }
export interface ResumenDeFormularios { zona: string; sinVer: number; hoy: number; ayer: number; total: number; lista: FormularioEnLista[] }
export interface FormularioAbierto { id: string; fecha: string; pagina: string | null; datos: Record<string, string>; contacto: Contacto }

const LIMITE = 50;
const f = schema.formSubmissions;
const diaLocal = (zona: string): SQL => sql`((${f.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${zona})::date`;

/** «AAAA-MM-DD HH:mm» en la zona del usuario. `h23` y no `hour12: false`,
 *  que en algunos motores escribe «24:00» a medianoche. */
function fechaYHora(instante: Date, zona: string): string {
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instante);
  return `${fechaLocal(instante, zona)} ${hora}`;
}

export async function resumirFormularios(
  projectId: string,
  userId: string,
  zona: string,
  filtro: FiltroDeFormularios,
  ahora: Date = new Date(),
): Promise<ResumenDeFormularios> {
  const lastSeen = await ultimaVistaDeFormularios(userId);
  const sinVer = condicionSinVer(lastSeen);
  const hoy = fechaLocal(ahora, zona);
  const ayer = restarDias(hoy, 1);
  const deEste = eq(f.projectId, projectId);

  const [cuentas] = await db
    .select({
      sinVer: sql<number>`COUNT(*) FILTER (WHERE ${sinVer})::int`,
      hoy: sql<number>`COUNT(*) FILTER (WHERE ${diaLocal(zona)} = ${hoy}::date)::int`,
      ayer: sql<number>`COUNT(*) FILTER (WHERE ${diaLocal(zona)} = ${ayer}::date)::int`,
      total: sql<number>`COUNT(*)::int`,
    })
    .from(f)
    .where(deEste);

  const donde =
    filtro.cuales === "nuevos"
      ? and(deEste, sinVer)
      : and(
          deEste,
          sql`${diaLocal(zona)} BETWEEN ${filtro.desde ?? restarDias(hoy, 6)}::date AND ${filtro.hasta ?? hoy}::date`,
        );
  const filas = await db
    .select({ id: f.id, data: f.data, meta: f.meta, createdAt: f.createdAt, visto: sql<boolean>`NOT (${sinVer})` })
    .from(f)
    .where(donde)
    .orderBy(desc(f.createdAt))
    .limit(LIMITE);

  return {
    zona,
    sinVer: Number(cuentas?.sinVer ?? 0),
    hoy: Number(cuentas?.hoy ?? 0),
    ayer: Number(cuentas?.ayer ?? 0),
    total: Number(cuentas?.total ?? 0),
    lista: filas.map((x) => {
      const c = contactoDe(x.data);
      return {
        id: x.id,
        fecha: fechaYHora(x.createdAt, zona),
        pagina: x.meta?.page ?? null,
        de: c.nombre ?? c.correo ?? c.telefono,
        linea: lineaDe(x.data),
        visto: Boolean(x.visto),
      };
    }),
  };
}

export async function abrirFormulario(
  projectId: string,
  zona: string,
  id: string,
  opciones: { marcarVisto: boolean },
): Promise<FormularioAbierto | null> {
  const r = await db
    .select({ id: f.id, data: f.data, meta: f.meta, createdAt: f.createdAt })
    .from(f)
    .where(and(eq(f.id, id), eq(f.projectId, projectId)))
    .limit(1);
  const x = r[0];
  if (!x) return null;
  if (opciones.marcarVisto) await marcarFormularioVisto(projectId, id);
  return { id: x.id, fecha: fechaYHora(x.createdAt, zona), pagina: x.meta?.page ?? null, datos: x.data, contacto: contactoDe(x.data) };
}
