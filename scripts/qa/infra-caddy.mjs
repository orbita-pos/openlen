#!/usr/bin/env node
// VALIDA LA SINTAXIS DEL CADDYFILE DE PRODUCCIÓN.
//
// POR QUÉ EXISTE. Caddy es el tier web entero: el apex hace de proxy a Next y
// los dos comodines sirven `/var/www/openlen/<sub>/` de disco. Un Caddyfile que
// no parsea no arranca el servicio, y hasta el 2026-09-16 este fichero NO SE
// VALIDABA NUNCA — no había `caddy` en la máquina de desarrollo, así que el
// primer sitio donde se descubría un error de sintaxis era el despliegue, con
// el servicio ya parado. Era el único pendiente de la rama capaz de tumbar
// producción.
//
// `adapt` Y NO `validate`, a propósito. `validate` sigue hasta provisionar, y
// ahí pide `/etc/letsencrypt/live/openlen.com/fullchain.pem` — una ruta de
// Linux que en la máquina de desarrollo no existe, así que falla por algo que
// no es el config y el resultado deja de ser legible. `adapt` hace exactamente
// la pregunta que importa: ¿esto se convierte en una configuración?
//
// SALIDAS, y son tres porque son tres cosas distintas:
//   0  VÁLIDO — adaptó a JSON.
//   1  INVÁLIDO — no adapta. Esto no se despliega.
//   2  NO COMPROBADO — no hay `caddy` aquí. No es un aprobado: es que no se
//      miró, y decirlo es la mitad de la doctrina que este repo copió del
//      informe de `preview` de Claude Code («the browser could not start, so
//      nothing was rendered» — nunca contar «no pude medir» como «está bien»).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "..");
const CONFIG = join(RAIZ, "infra", "caddy", "Caddyfile");

/** Dónde puede estar `caddy`. En Windows el shim de scoop no es ejecutable
 *  directamente por `spawnSync` sin shell, así que se prefiere el .exe real. */
function buscarCaddy() {
  const candidatos = [
    join(homedir(), "scoop", "apps", "caddy", "current", "caddy.exe"),
    join(homedir(), "scoop", "shims", "caddy.exe"),
    "/usr/bin/caddy",
    "/usr/local/bin/caddy",
  ].filter((p) => existsSync(p));
  if (candidatos.length > 0) return candidatos[0];
  // En el PATH, que es el caso normal en el servidor.
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["caddy"], {
    encoding: "utf8",
  });
  const primera = (r.stdout ?? "").split(/\r?\n/).find((l) => l.trim());
  return r.status === 0 && primera ? primera.trim() : null;
}

const caddy = buscarCaddy();
if (!caddy) {
  console.error("infra:caddy — NO COMPROBADO: no hay `caddy` en esta máquina.");
  console.error("  El Caddyfile NO se ha validado. Esto no es un aprobado.");
  console.error("  Instálalo con:  scoop install caddy   (o apt/brew según el sistema)");
  process.exit(2);
}

const r = spawnSync(caddy, ["adapt", "--config", CONFIG, "--adapter", "caddyfile"], {
  encoding: "utf8",
});

if (r.status !== 0) {
  console.error("infra:caddy — 🔴 INVÁLIDO. Esto NO se despliega:\n");
  console.error((r.stderr || r.stdout || "").trim());
  process.exit(1);
}

// El aviso de formato NO es un error y no se trata como tal. Medido el
// 2026-09-16: lo único que `caddy fmt` quiere es quitar UNA línea en blanco
// entre la cabecera de comentarios y el bloque global, y esa línea es lo que
// separa 35 líneas de explicación del config. Se deja a propósito; queda dicho
// aquí para que nadie lo "arregle" creyendo que es deuda.
const aviso = (r.stderr ?? "").includes("not formatted") ? " (con aviso de formato, deliberado)" : "";
const bytes = (r.stdout ?? "").length;
console.log(`infra:caddy — 🟢 VÁLIDO: adapta a ${bytes} bytes de JSON${aviso}.`);
console.log(`  ${caddy}`);
process.exit(0);
