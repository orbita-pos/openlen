// lib/evals/guardar-marcador.ts — dónde cae el marcador de una corrida, y la
// garantía de que no borra el de otra.
//
// 🔴 POR QUÉ EXISTE. El arnés escribía `page-scorecard-<revisión>.json`, y dos
// corridas sobre la misma revisión —el brazo de control y el de
// `--esfuerzo=high`, dos `--solo`, un humo de un caso— compartían nombre: la
// segunda borraba a la primera sin decir nada. Así desapareció el control 16×3
// del experimento de esfuerzo en Crear: su 44/48 quedó citado en
// `INFORME-esfuerzo-del-agente.md` (Apéndice O) y en disco sólo sobrevive
// `page-scorecard-56cc29f1.json`, que es el brazo CON razonamiento.
//
// Dos defensas, porque cada una sola deja un hueco:
//   · el NOMBRE lleva revisión + brazo + instante, así que dos corridas
//     distintas no coinciden y el nombre dice qué es cada una;
//   · la ESCRITURA es exclusiva (`wx`), así que ni dos corridas en el mismo
//     milisegundo ni un nombre mal pensado mañana pueden pisar un fichero.

import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import type { BrazoDeCorrida, Scorecard } from "./page-scorecard";

/** Por encima de esto un `--solo` se nombra por cuántos casos lleva: una ruta
 *  de Windows tiene 260 caracteres, y la lista entera ya va en el JSON. */
const SOLO_MAX = 60;
const MAX_GEMELOS = 100;

/** `2026-09-12T22:51:07.123Z` → `2026-09-12T225107123Z`. Windows no admite `:`
 *  en un nombre, y así el orden alfabético sigue siendo el cronológico. */
export function instanteDeNombre(iso: string): string {
  return iso.replace(/[:.]/g, "");
}

/** Lo que distingue esta corrida de otra sobre la misma revisión, en forma de
 *  nombre. Vacío en el control del conjunto entero, que no lleva bandera. */
export function descriptorDeBrazo(brazo: BrazoDeCorrida): string {
  const partes: string[] = [];
  if (brazo.esfuerzo !== null) partes.push(`esfuerzo-${brazo.esfuerzo}`);
  if (brazo.escritor) partes.push(`escritor-${brazo.escritor.replace(/_/g, "-")}`);
  if (brazo.tag !== null) partes.push(`tag-${brazo.tag}`);
  if (brazo.solo !== null) {
    const lista = `solo-${brazo.solo.join("+")}`;
    partes.push(lista.length <= SOLO_MAX ? lista : `solo-${brazo.solo.length}casos`);
  }
  if (brazo.repeat > 1) partes.push(`repeat-${brazo.repeat}`);
  // `_` separa las partes, así que no puede salir de dentro de un valor.
  return partes.map((p) => p.replace(/[^A-Za-z0-9+-]+/g, "-")).join("_");
}

export function nombreDeMarcador(card: Pick<Scorecard, "revision" | "at" | "brazo">): string {
  const brazo = card.brazo ? descriptorDeBrazo(card.brazo) : "";
  return `page-scorecard-${card.revision.slice(0, 8)}${brazo ? `_${brazo}` : ""}_${instanteDeNombre(card.at)}.json`;
}

/** Escribe `contenido` en `dir/nombre` SIN pisar nada: si el nombre ya existe
 *  prueba `nombre-2`, `nombre-3`… Devuelve la ruta que de verdad escribió. */
export function escribirSinPisar(dir: string, nombre: string, contenido: string): string {
  mkdirSync(dir, { recursive: true });
  const ext = extname(nombre);
  const raiz = nombre.slice(0, nombre.length - ext.length);
  for (let n = 1; n <= MAX_GEMELOS; n += 1) {
    const ruta = join(dir, n === 1 ? nombre : `${raiz}-${n}${ext}`);
    try {
      writeFileSync(ruta, contenido, { encoding: "utf8", flag: "wx" });
      return ruta;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`${join(dir, nombre)}: ya hay ${MAX_GEMELOS} con ese nombre — no se pisa ninguno`);
}

export function guardarMarcador(dir: string, card: Scorecard): string {
  return escribirSinPisar(dir, nombreDeMarcador(card), JSON.stringify(card, null, 2));
}
