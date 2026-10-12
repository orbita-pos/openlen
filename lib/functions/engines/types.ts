// lib/functions/engines/types.ts — LO QUE ES UN MOTOR DE EDGE FUNCTIONS (spec
// local 2026-10-11, Parte 2): desplegar el paquete de un proyecto en un
// entorno, decir qué hay desplegado, cambiar sus variables, invocarlo con
// marcos y quitarlo. Hay dos: `local` (desarrollo, pruebas, autohospedaje de UN
// dueño) y `cloudflare` (producción, spec local 2026-10-12).

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

/** Los límites de UNA llamada (spec local 2026-10-12, Parte 6): los pone el
 *  despachador de Cloudflare; el motor local los ignora. */
export interface CallLimits {
  readonly cpuMs: number;
  readonly subRequests: number;
}

export interface FunctionsEngine {
  readonly name: "local" | "cloudflare";
  deploy(dest: Destination, bundle: EngineBundle, env: Readonly<Record<string, string>>, limits: EngineLimits): Promise<void>;
  /** Variables nuevas para lo desplegado ahí, con el MISMO código (`supabase
   *  secrets set`: al momento). Sin nada desplegado, nada. En Cloudflare: los
   *  secretos del script, al momento. */
  setEnv(dest: Destination, env: Readonly<Record<string, string>>): Promise<void>;
  /** El hash de lo desplegado ahí, o null. */
  deployedHash(dest: Destination): Promise<string | null>;
  invoke(dest: Destination, event: InvokeEvent, o: { readonly timeoutMs: number; readonly limits: CallLimits }): AsyncIterable<Frame>;
  remove(dest: Destination): Promise<void>;
}

/** El nombre del script de Cloudflare y de la carpeta del motor local. Nunca lo ve Len. */
export function destinationName(dest: Destination): string {
  return `openlen-${dest.ref}-${dest.environment}`;
}
