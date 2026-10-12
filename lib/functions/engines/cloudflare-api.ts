// lib/functions/engines/cloudflare-api.ts — CLOUDFLARE PARA LAS EDGE FUNCTIONS
// (spec local 2026-10-12, Partes 1, 4 y 7): lo que comparten el motor, la puesta
// en marcha y las pruebas. Sin dependencias.

/** La misma en miniflare (pruebas) y en Cloudflare: lo probado es lo que corre. */
export const COMPATIBILITY_DATE = "2026-07-30";
export const COMPATIBILITY_FLAGS = ["nodejs_compat"] as const;
/** La entrada del script de un proyecto (la escribe el empaquetador). */
export const WORKER_MAIN_MODULE = "worker.mjs";
/** El Worker despachador: en la cuenta, no en el namespace. */
export const DISPATCHER_SCRIPT = "openlen-dispatch";
