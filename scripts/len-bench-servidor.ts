// scripts/len-bench-servidor.ts — el dev de OpenLen, preparado para Len-Bench.
//
//   npm run bench:len:servidor
//
// webpack, NUNCA Turbopack (memoria `turbopack-native-ssr-empty`); grabación
// de turnos encendida; publicación en plans/len-2/publicadas; R2/Cloudflare
// VACÍOS, para que publicar no suba nada al bucket de copias ni purgue la CDN;
// y NEXT_PUBLIC_SITE_URL en este mismo servidor, para que lo que Len publique
// mande sus formularios aquí y no a producción (lib/len-bench/entorno.ts).
// ⚠️ Usa el puerto 3007 y la misma carpeta .next que el dev de siempre (la
// configuración `openlen` de .claude/launch.json): para el otro antes de
// arrancar éste, o se pelearán por el puerto y por .next.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIR_GRABACIONES, DIR_PUBLICADAS, entornoDeLenBench, PUERTO_LEN_BENCH, variablesApagadas } from "@/lib/len-bench/entorno";

function main(): void {
  const raiz = process.cwd();
  fs.mkdirSync(path.join(raiz, DIR_PUBLICADAS), { recursive: true });
  fs.mkdirSync(path.join(raiz, DIR_GRABACIONES), { recursive: true });
  const env = entornoDeLenBench(process.env, raiz);
  console.log(`[len-bench] apagadas: ${variablesApagadas(raiz).join(", ")}`);
  console.log(`[len-bench] PUBLISH_ROOT=${env.PUBLISH_ROOT}`);
  console.log(`[len-bench] OPENLEN_AGENT_RECORD_DIR=${env.OPENLEN_AGENT_RECORD_DIR}`);
  console.log(`[len-bench] NEXT_PUBLIC_SITE_URL=${env.NEXT_PUBLIC_SITE_URL}`);
  // `Entorno` es un registro normal y los tipos de Next hacen obligatorio
  // `NODE_ENV` en `ProcessEnv`; el entorno sale de process.env, así que lo lleva
  // si el padre lo llevaba, y si no Next pone el suyo.
  const hijo = spawn("npx", ["next", "dev", "-p", String(PUERTO_LEN_BENCH)], {
    env: env as NodeJS.ProcessEnv,
    stdio: "inherit",
    shell: true,
  });
  hijo.on("exit", (c) => process.exit(c ?? 0));
}

main();
