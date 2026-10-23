// lib/functions/curl-types.ts — LO QUE VIAJA ENTRE EL `curl` DE LA TERMINAL Y LA
// PUERTA (spec local 2026-10-11, Parte 1). Puro: lo importan la terminal (el
// hilo de la app) y lib/functions/curl.ts.

export interface CurlRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyB64: string | null;
}

export interface CurlResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyB64: string;
}

export interface FunctionsCurl {
  /** Las URLs a las que el `curl` de la terminal puede llamar. */
  readonly prefixes: readonly string[];
  /** What those URLs are, in words, for the refusal of any other ("this project's Edge
   *  Functions (…)"). Absent = the functions' sentence of before. */
  readonly reaches?: string;
  call(req: CurlRequest): Promise<CurlResponse>;
}
