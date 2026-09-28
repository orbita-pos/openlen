// scripts/len-bench-ver.ts — sirve una publicada conservada para enseñársela a Jesús.
//   npm run bench:len:ver -- --sub=lb-taqueria-menu-whatsapp-a1b2c3
// (El repo no es ESM: nada de `await` de primer nivel en scripts; todo va en main.)
import fs from "node:fs";
import path from "node:path";
import { BASE_LEN_BENCH, DIR_PUBLICADAS } from "@/lib/len-bench/entorno";
import { servirPublicada } from "@/lib/len-bench/servidor-publicada";
import { publishedHost } from "@/lib/publish/base-host";

async function main(): Promise<void> {
  const raiz = path.resolve(DIR_PUBLICADAS);
  const sub = process.argv.find((a) => a.startsWith("--sub="))?.slice(6);
  const hay = fs.existsSync(raiz) ? fs.readdirSync(raiz).filter((d) => !d.startsWith(".")) : [];
  if (!sub || !hay.includes(sub)) {
    throw new Error(
      `${sub ? `«${sub}» no está en ${raiz}` : "falta --sub=<subdominio>"}. ` +
        `Conservadas: ${hay.length > 0 ? hay.join(", ") : "ninguna (corre con --conservar)"}`,
    );
  }
  const s = await servirPublicada({ raiz, sub, next: BASE_LEN_BENCH, hostPublicado: publishedHost(sub) });
  console.log(`Abierta en ${s.url}/ (Ctrl+C para cerrar)`);
}

void main().catch((e: unknown) => {
  console.error(`len-bench-ver: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
