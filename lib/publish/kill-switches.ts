// EL predicado único de los kill-switches de runtimes horneados (hallazgo
// Fable, 2026-07-13). Antes, OPENLEN_BEHAVIORS=0 se leía inline SOLO en
// publishToDir — el inyector del preview (client component, no puede leer
// process.env) seguía inyectando, así que la palanca de rollback hacía
// divergir editor y publicado. OPENLEN_CAROUSEL tenía el mismo hueco.
//
// Dos consumidores, un predicado: lib/publish/filesystem.ts (el bake de
// publish) y app/api/flags/route.ts (lo que el preview consulta vía
// use-kill-switches.ts). Si alguna vez cambia la semántica ("0" apaga, todo
// lo demás enciende), cambia aquí y las dos mitades se mueven juntas.
//
// `env` inyectable solo para tests — el call site real nunca pasa argumento.

// Record plano y no NodeJS.ProcessEnv: el ProcessEnv aumentado del repo exige
// NODE_ENV, y los tests pasan objetos mínimos. process.env es asignable.
type EnvLike = Record<string, string | undefined>;

export function behaviorsBakeEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_BEHAVIORS !== "0";
}

export function carouselBakeEnabled(env: EnvLike = process.env): boolean {
  return env.OPENLEN_CAROUSEL !== "0";
}
