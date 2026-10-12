// lib/functions/engines/types.ts — LO QUE ES UN MOTOR DE EDGE FUNCTIONS (spec
// local 2026-10-11, Parte 2): desplegar el paquete de un proyecto en un
// entorno, decir qué hay desplegado, invocarlo con marcos y quitarlo. Hay dos:
// `local` (desarrollo, pruebas, autohospedaje de UN dueño) y `lambda` (fase 3).

import type { Frame, InvokeEvent } from "@/lib/functions/runtime/runtime.mjs";

export type { Frame, InvokeEvent };

export type FunctionsEnvironment = "draft" | "live";

/** Un proyecto en un entorno. `ref` es el ref PRINCIPAL del proyecto. */
export interface Destination {
  readonly ref: string;
  readonly environment: FunctionsEnvironment;
}

export interface EngineBundle {
  readonly hash: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface EngineLimits {
  readonly timeoutSec: number;
  readonly memoryMb: number;
}

export interface FunctionsEngine {
  readonly name: "local" | "lambda";
  deploy(dest: Destination, bundle: EngineBundle, env: Readonly<Record<string, string>>, limits: EngineLimits): Promise<void>;
  /** El hash de lo desplegado ahí, o null. */
  deployedHash(dest: Destination): Promise<string | null>;
  invoke(dest: Destination, event: InvokeEvent, o: { readonly timeoutMs: number }): AsyncIterable<Frame>;
  remove(dest: Destination): Promise<void>;
}

/** El nombre de la Lambda (fase 3) y de la carpeta del motor local. Nunca lo ve Len. */
export function destinationName(dest: Destination): string {
  return `openlen-${dest.ref}-${dest.environment}`;
}
