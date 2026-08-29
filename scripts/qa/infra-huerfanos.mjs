#!/usr/bin/env node
// ¿Sigue nombrando el repo cosas que ya no existen?
//
// POR QUÉ EXISTE. El 2026-08-29 el mismo defecto mordió CINCO veces en un día:
//
//   1. la documentación de infra mandaba a poner una clave de un proveedor que
//      había salido del repo el día anterior;
//   2. once sitios mandaban a ejecutar `infra/scripts/deploy.sh`, que no existe
//      desde el corte a PowerShell;
//   3. dos migraciones listadas cuyos scripts se habían borrado — y esa PARÓ un
//      despliegue, en local, a mitad;
//   4. un timer de systemd para Reservas, retirado el 21/08, FALLANDO cada 15
//      minutos en producción desde entonces;
//   5. ocho variables de entorno en la caja que no lee nadie.
//
// Ninguna era difícil de ver. Todas eran invisibles porque nadie mira: la prosa
// no se compila, una lista dentro de un `.mjs` tampoco, y un timer que falla lo
// dice en un sitio donde no entra nadie.
//
// Lo que de verdad costaba caro era el número 4: `systemctl --failed` llevaba
// ocho días sin estar vacío, así que la SIGUIENTE caída de verdad iba a
// aparecer exactamente igual que la de mentira.
//
// Uso:
//   npm run infra:huerfanos            comprobaciones locales
//   npm run infra:huerfanos -- --box   además, las variables de la caja (necesita ssh)
//
// Sale con código 1 si encuentra deriva, para poder colgarlo de un despliegue.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const conBox = process.argv.includes("--box");
const hallazgos = [];

function drift(area, que, porque) {
  hallazgos.push({ area, que, porque });
}

function leer(p) {
  try {
    return readFileSync(join(RAIZ, p), "utf8");
  } catch {
    return "";
  }
}

// ── 1. Unidades de systemd contra lo que el despliegue empaqueta ───────────
// Una unidad cuyo ExecStart apunta a /opt/openlen-app/cron/X.mjs sólo funciona
// si build-cron.mjs produce ese X.mjs. Éste es el que se le escapó a Reservas.
function unidadesContraCron() {
  const cron = leer("scripts/build-cron.mjs");
  const empaquetados = new Set(
    [...cron.matchAll(/cron\/([\w-]+)\.mjs/g)].map((m) => m[1]),
  );
  const dirUnidades = join(RAIZ, "infra/app");
  if (!existsSync(dirUnidades)) return;
  for (const f of readdirSync(dirUnidades).filter((x) => x.endsWith(".service"))) {
    const texto = readFileSync(join(dirUnidades, f), "utf8");
    const m = texto.match(/ExecStart=.*\/cron\/([\w-]+)\.mjs/);
    if (!m) continue;
    if (!empaquetados.has(m[1])) {
      drift(
        "systemd",
        `infra/app/${f}`,
        `arranca cron/${m[1]}.mjs y build-cron.mjs no lo empaqueta — si el timer` +
          ` está encendido, falla en cada disparo`,
      );
    }
  }
}

// ── 1b. Crates que la caja intenta compilar contra los que existen ────────
// El caso del 2026-08-29: `build-crates-on-box.sh` seguia nombrando
// `ai-gateway`, borrado el dia anterior, y el despliegue murio compilandolo
// DESPUES de 25 minutos de tar y de subir 625 MB. La paridad entre esa lista y
// la de deploy.ps1 la fija una prueba (deploy-native-crates-contract); esto es
// lo otro: que lo que nombren exista de verdad.
function cratesContraDisco() {
  const sh = leer('infra/scripts/build-crates-on-box.sh');
  const m = sh.match(/^CRATES=\(([^)]*)\)/m);
  if (!m) return;
  for (const c of m[1].trim().split(/\s+/).filter(Boolean)) {
    if (!existsSync(join(RAIZ, `crates/${c}/Cargo.toml`))) {
      drift(
        'crates',
        c,
        'build-crates-on-box.sh lo compila en la caja y crates/' + c + ' no existe',
      );
    }
  }
}

// ── 2. Migraciones listadas contra sus scripts ─────────────────────────────
// build-migrations.mjs ya se niega a empaquetar si falta una, pero eso sólo se
// entera en un despliegue. Aquí se ve antes, y gratis.
function migracionesContraScripts() {
  const src = leer("scripts/build-migrations.mjs");
  const bloque = src.match(/const targets = \[([\s\S]*?)\]/);
  if (!bloque) return;
  for (const m of bloque[1].matchAll(/"([\w-]+)"/g)) {
    if (!existsSync(join(RAIZ, `scripts/${m[1]}.ts`))) {
      drift("migraciones", m[1], "listada en build-migrations.mjs y su script no existe");
    }
  }
}

// ── 3. Scripts de npm contra los ficheros que nombran ──────────────────────
function scriptsContraFicheros() {
  const pkg = JSON.parse(leer("package.json") || "{}");
  for (const [nombre, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const ruta of String(cmd).matchAll(
      /(?:scripts|infra|lib|crates)[\w./@-]*\.(?:ts|mjs|js|cjs|sh|ps1)/g,
    )) {
      if (!existsSync(join(RAIZ, ruta[0]))) {
        drift("npm", nombre, `apunta a ${ruta[0]}, que no existe`);
      }
    }
  }
}

// ── 4. Lo que la documentación de infra manda EJECUTAR ─────────────────────
// El caso `deploy.sh`: once documentos mandaban a correr un script borrado, y
// uno de ellos era el runbook de recuperación ante desastre.
function documentacionContraFicheros() {
  const vistos = new Set();
  const anda = (dir) => {
    for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "nginx") anda(rel); // nginx/ es el legado pre-corte
      } else if (e.name.endsWith(".md")) {
        for (const m of readFileSync(join(RAIZ, rel), "utf8").matchAll(
          /(?:bash|sh|node|npm run [\w:-]+ )?\s(infra\/[\w./-]+\.(?:sh|ps1|mjs))/g,
        )) {
          const ruta = m[1];
          if (!existsSync(join(RAIZ, ruta)) && !vistos.has(ruta + rel)) {
            vistos.add(ruta + rel);
            drift("docs", rel, `manda ejecutar ${ruta}, que no existe`);
          }
        }
      }
    }
  };
  if (existsSync(join(RAIZ, "infra"))) anda("infra");
}

// ── 5. Variables de la caja que no nombra el código ────────────────────────
// A PROPÓSITO es una búsqueda FLOJA, por el nombre pelado en cualquier fichero
// de código. El repo lee muchas por acceso dinámico —`env("POLAR_ACCESS_TOKEN")`,
// destructuring en lib/storage— y una comprobación estricta de `process.env.X`
// marca catorce vivas como muertas. Preferimos no ver una a decirte que borres
// la clave de Polar.
function variablesDeLaCaja() {
  let nombres = [];
  try {
    const salida = execFileSync(
      "ssh",
      [
        "-i", `${process.env.USERPROFILE || process.env.HOME}/.ssh/openlen-admin`,
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "root@178.156.175.171",
        "grep -oE '^[A-Z_][A-Z0-9_]*=' /etc/openlen/openlen.env | tr -d '='",
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    nombres = salida.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.log(`  (caja) no se pudo consultar: ${e.message.split("\n")[0]}`);
    return;
  }

  const codigo = [];
  const anda = (dir) => {
    for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!["node_modules", ".next", ".git", "target"].includes(e.name)) {
          anda(`${dir}/${e.name}`);
        }
      } else if (/\.(ts|tsx|mjs|js|cjs|rs)$/.test(e.name)) {
        codigo.push(readFileSync(join(RAIZ, `${dir}/${e.name}`), "utf8"));
      }
    }
  };
  for (const d of ["app", "lib", "components", "scripts", "crates", "auth.ts"]) {
    if (existsSync(join(RAIZ, d))) {
      if (d.endsWith(".ts")) codigo.push(leer(d));
      else anda(d);
    }
  }
  const todo = codigo.join("\n");
  for (const v of nombres) {
    if (!todo.includes(v)) {
      drift("caja", v, "está en /etc/openlen/openlen.env y no aparece en el código");
    }
  }
}

// ── Y el informe ───────────────────────────────────────────────────────────
unidadesContraCron();
cratesContraDisco();
migracionesContraScripts();
scriptsContraFicheros();
documentacionContraFicheros();
if (conBox) variablesDeLaCaja();
else console.log("  (caja) omitida — pasa --box para comprobarla");

console.log("");
if (hallazgos.length === 0) {
  console.log("  sin deriva: todo lo que el repo nombra existe.");
  process.exit(0);
}
const porArea = {};
for (const h of hallazgos) (porArea[h.area] ??= []).push(h);
for (const [area, lista] of Object.entries(porArea)) {
  console.log(`  ${area}`);
  for (const h of lista) console.log(`    ${h.que}\n      ${h.porque}`);
}
console.log(`\n  ${hallazgos.length} derivas.`);
process.exit(1);
