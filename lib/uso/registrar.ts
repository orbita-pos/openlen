// lib/uso/registrar.ts — LOS EVENTOS DE USO, del lado del servidor.
//
// Tres reglas, las tres de Claude Code:
//
//  - SE APAGA POR LA PERSONA Y POR EL OPERADOR. Allí `DO_NOT_TRACK` y
//    `DISABLE_TELEMETRY`; aquí las cabeceras `DNT: 1` y `Sec-GPC: 1`, y
//    `OPENLEN_EVENTOS_DE_USO=0` en la caja.
//  - NUNCA ROMPE LO QUE MIDE. Un evento que no se guarda se cuenta y se avisa
//    con el código del error de la base, nunca con su mensaje, y el turno sigue.
//    Allí, literal: «further failures are counted and summarised».
//  - SÓLO SE GUARDA LO QUE EL CATÁLOGO DEJA PASAR (`catalogo.ts`).

import { db, schema } from "@/lib/db";

import {
  validarDatos,
  type DatosDe,
  type EventoDeServidor,
  type NombreEvento,
} from "./catalogo";

export interface FilaDeUso {
  userId: string;
  nombre: NombreEvento;
  sesion: string | null;
  datos: Record<string, unknown>;
}

/** ¿Se puede registrar esta petición? */
export function puedeRegistrar(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OPENLEN_EVENTOS_DE_USO === "0") return false;
  return headers.get("dnt") !== "1" && headers.get("sec-gpc") !== "1";
}

let perdidos = 0;

/** Guarda filas YA validadas. Nunca lanza. */
export async function guardarEventos(filas: readonly FilaDeUso[]): Promise<void> {
  if (filas.length === 0) return;
  try {
    await db.insert(schema.usageEvents).values(
      filas.map((f) => ({ userId: f.userId, name: f.nombre, sessionId: f.sesion, data: f.datos })),
    );
  } catch (err) {
    perdidos += filas.length;
    const codigo = (err as { code?: unknown } | null)?.code;
    // eslint-disable-next-line no-console
    console.warn(
      `[uso] no se guardaron ${filas.length} evento(s) (código ${typeof codigo === "string" ? codigo : "?"}) — perdidos en este proceso: ${perdidos}`,
    );
  }
}

/** Un evento que sólo puede escribir el servidor. */
export async function registrarEnServidor<N extends EventoDeServidor>(
  nombre: N,
  datos: DatosDe<N>,
  ctx: { userId: string; headers: Headers },
): Promise<void> {
  if (!puedeRegistrar(ctx.headers)) return;
  const limpios = validarDatos(nombre, datos);
  if (!limpios) return;
  await guardarEventos([
    { userId: ctx.userId, nombre, sesion: null, datos: limpios as Record<string, unknown> },
  ]);
}
