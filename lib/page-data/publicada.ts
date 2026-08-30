// La declaración que rige AHORA MISMO para un proyecto. SON DOS, y el que
// pregunta decide cuál:
//
//   · `declaracionPublicada` — para el VISITANTE. Manda lo que la página
//     servida declara, y eso es lo correcto: si el bloque ya no está en el HTML
//     publicado, sus escrituras tienen que parar.
//   · `declaracionDelBorrador` — para el DUEÑO. Manda lo que está editando.
//
// 🔴 POR QUÉ EXISTE LA SEGUNDA. Hasta el 2026-08-30 sólo había la primera, y el
// dueño pasaba por ella: `lib/page-data/agente.ts` y el panel de Datos. Como
// `data.almacenes` se rellena AL PUBLICAR, un almacén recién declarado no
// existía para nadie hasta la primera publicación — así que el Agente lo
// declaraba con `editar_pagina`, llamaba a `guardar_dato`, y recibía
// `almacen_no_declarado` sobre un almacén que acababa de escribir él mismo.
// MEDIDO en la batería: reintentaba hasta agotar `turn_limit`, 174k tokens de
// entrada por turno, y los tres casos de datos fallaban por esto.
//
// El comentario de `agente.ts` ya decía la arquitectura correcta —«la
// declaración vive en el documento»—; lo que no la cumplía era por dónde se
// leía.
//
// La fuente de verdad es el HTML —no una tabla de configuración—, pero parsear
// el documento en cada escritura de VISITANTE sería absurdo: para ése se
// extrae al publicar (ver lib/projects.ts) y se guarda en `projects.data`.
//
// Eso NO la convierte en configuración: no hay forma de editarla salvo
// escribiéndola en la página. Si el modelo borra el bloque, la siguiente
// publicación deja el almacén sin permisos, y entonces sus documentos se
// CONSERVAN y dejan de aceptar escrituras — el dueño puede exportarlos, pero
// nadie escribe en algo que la página ya no declara.

import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { leerDeclaracion, type Declaracion } from "./declaracion";

export async function declaracionPublicada(projectId: string): Promise<Declaracion> {
  const [fila] = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  // `almacenes` es parte de ProjectData, así que esto va tipado y no casteado.
  // El `?? {}` cubre el caso normal: toda página anterior al 2026-08-29 —y toda
  // la que no declare nada— no tiene el campo.
  return fila?.data?.almacenes ?? {};
}

/**
 * La declaración QUE EL DUEÑO ESTÁ EDITANDO — se lee del documento, no de lo
 * publicado. Es la que rige sus propias escrituras: llenar el menú de una
 * página que todavía no ha publicado tiene que funcionar, y hasta hoy no
 * funcionaba.
 *
 * Se parsea el HTML en cada llamada a propósito. Es el camino del DUEÑO, que
 * son unas pocas escrituras a mano o del Agente por turno — no el del
 * visitante, donde el coste sí importaría y por eso aquel usa el campo
 * pre-extraído.
 *
 * Del documento HOME, igual que hace publicar (`lib/projects.ts` llama a
 * `leerDeclaracion` sobre el html que publica). Si algún día una subpágina
 * declara almacenes propios, las dos mitades tienen que cambiar a la vez o
 * volverán a discrepar — que es exactamente el fallo que esto arregla.
 */
export async function declaracionDelBorrador(projectId: string): Promise<Declaracion> {
  const [fila] = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const html = fila?.data?.html;
  return html ? leerDeclaracion(html) : {};
}
