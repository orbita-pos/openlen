// lib/uso/catalogo.ts — QUÉ SE PUEDE REGISTRAR, cerrado.
//
// Un catálogo y no un `track(nombre, cualquierCosa)`, porque es la forma que
// tiene Claude Code de impedir que un evento se lleve lo que no
// debe. Allí un error sólo llega a la telemetría si alguien comprobó que no
// lleva código ni rutas, y de un error de validación sólo pasan códigos
// cortos en minúsculas. Aquí,
// igual: cada evento declara sus datos con un esquema ESTRICTO —una clave de más
// y se descarta el evento entero— y ninguno admite texto libre. El brief del
// usuario no cabe en ninguno.
//
// `origen` separa lo que puede mandar el navegador de lo que sólo escribe el
// servidor. Hoy todos son del navegador: el único del servidor, `crear_fallo`
// (un fallo de `/api/generate`), se fue con Crear el 2026-10-06.
//
// El navegador importa de aquí sólo TIPOS (ver `cliente.ts`); zod se queda en
// el servidor.

import { z } from "zod";

/** El `SLUG` de `lib/templates/admin-schemas.ts`, copiado a propósito: aquel
 *  fichero arrastra el sanitizador y esto lo importa una ruta. Que sean el mismo
 *  lo exige `catalogo.test.ts`. */
export const SLUG_DE_PLANTILLA = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const vacio = z.object({}).strict();

export const EVENTOS = {
  /** La pantalla de Crear se montó. */
  crear_vista: { origen: "cliente", datos: vacio },
  /** Entró texto en el brief por primera vez en esta visita. */
  crear_escribio: { origen: "cliente", datos: vacio },
  /** Se pulsó enviar: el primer mensaje a Len (desde el 2026-10-06, crear es
   *  eso). La forma del encargo, nunca su contenido.
   *
   *  ⚰️ Llevaba `escritor`, el papel que iba a escribir en Crear; se fue con
   *  el selector y con Crear. Los eventos guardados antes lo traen. */
  crear_envio: {
    origen: "cliente",
    datos: z
      .object({
        imagenes: z.number().int().min(0).max(20),
        referencia: z.boolean(),
      })
      .strict(),
  },
  // ⚰️ `crear_modelo_abrio` y `crear_modelo_eligio` medían el selector de qué
  // modelo escribía Crear; se fueron con él el 2026-10-06.
  /** Se abrió una plantilla del mosaico. */
  crear_plantilla: {
    origen: "cliente",
    datos: z.object({ plantilla: z.string().regex(SLUG_DE_PLANTILLA) }).strict(),
  },
  // ⚰️ `crear_fallo` (origen servidor): `/api/generate` no entregó página. Se
  // fue con la ruta el 2026-10-06, y con él `registrarEnServidor` y
  // `nombreDeError`, que sólo lo escribían a él.
} as const;

export type NombreEvento = keyof typeof EVENTOS;
export type DatosDe<N extends NombreEvento> = z.infer<(typeof EVENTOS)[N]["datos"]>;
export type EventoDeCliente = {
  [N in NombreEvento]: (typeof EVENTOS)[N]["origen"] extends "cliente" ? N : never;
}[NombreEvento];

const SESION = /^[A-Za-z0-9-]{8,64}$/;

function esNombre(nombre: unknown): nombre is NombreEvento {
  return typeof nombre === "string" && Object.prototype.hasOwnProperty.call(EVENTOS, nombre);
}

/** Los datos, si pasan el esquema de su evento. Si no, `null`: nunca se guarda
 *  una versión «arreglada» de algo que no cumplía. */
export function validarDatos<N extends NombreEvento>(nombre: N, datos: unknown): DatosDe<N> | null {
  const r = EVENTOS[nombre].datos.safeParse(datos);
  return r.success ? (r.data as DatosDe<N>) : null;
}

/** Un evento tal como llega del navegador. Tiene que ser del catálogo, de
 *  origen cliente, con una sesión con forma y datos que pasen su esquema.
 *  Cualquier otra cosa se descarta. */
export function validarEventoDeCliente(
  crudo: unknown,
): { nombre: EventoDeCliente; sesion: string; datos: Record<string, unknown> } | null {
  if (!crudo || typeof crudo !== "object") return null;
  const { nombre, sesion, datos } = crudo as Record<string, unknown>;
  if (!esNombre(nombre) || EVENTOS[nombre].origen !== "cliente") return null;
  if (typeof sesion !== "string" || !SESION.test(sesion)) return null;
  const limpios = validarDatos(nombre, datos);
  if (!limpios) return null;
  return { nombre: nombre as EventoDeCliente, sesion, datos: limpios as Record<string, unknown> };
}
