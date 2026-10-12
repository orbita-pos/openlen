// lib/functions/teardown.ts — BORRAR UN PROYECTO SE LLEVA SUS FUNCIONES (spec
// local 2026-10-11, Parte 2): sus dos destinos en el motor (en Cloudflare,
// sus dos scripts). Lo de la base —secretos, lo desplegado, el uso, las
// llamadas— se va en cascada con la fila del proyecto. Nunca lanza: el proyecto
// ya no existe, y lo que quede lo barre el motor (el local, al reiniciar).

import "server-only";

import { functionsEngine } from "./engines";
import type { FunctionsEngine } from "./engines/types";

export async function removeProjectFunctions(ref: string, engine: FunctionsEngine | null = functionsEngine()): Promise<void> {
  if (!engine) return;
  for (const environment of ["draft", "live"] as const) {
    await engine.remove({ ref, environment }).catch((err: unknown) => {
      console.error("[functions] no se pudo quitar el destino", ref, environment, err);
    });
  }
}
