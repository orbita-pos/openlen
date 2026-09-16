// Load .env.local before any workers are forked so process.env.DATABASE_URL
// is available when lib/db/index.ts is evaluated inside test workers.
import { config } from "dotenv";
import { resolve } from "node:path";

import { barrerPerfilesHuerfanos } from "./lib/ai/perfiles-huerfanos";

export async function setup() {
  config({ path: resolve(process.cwd(), ".env.local") });
  // LOS PERFILES DE CHROMIUM QUE NADIE BORRA. La suite lanza ~60 navegadores;
  // los que mueren por un timeout no ejecutan ningun `finally`, asi que dejan
  // su perfil en el temporal para siempre. Medido el 2026-09-16: 242
  // directorios, 876 MB. Se barre ANTES de la suite y no despues, para que una
  // corrida interrumpida a la mitad tambien quede limpia en la siguiente.
  const n = await barrerPerfilesHuerfanos();
  if (n > 0) {
    // eslint-disable-next-line no-console
    console.info(`[vitest] ${n} perfil(es) huerfano(s) de Chromium barrido(s)`);
  }
}
