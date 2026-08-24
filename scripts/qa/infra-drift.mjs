// Compara la configuración del box con la del repo. Sólo lee.
//
// Uso: npm run infra:drift
//
// Los finales de línea se normalizan antes de hashear: una copia de trabajo en
// Windows puede tener CRLF donde el box tiene LF, y eso haría que TODO saliera
// como deriva — un guardián que grita siempre se acaba ignorando, que es peor
// que no tenerlo.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { BOX_FILES } from "../../infra/box-files.mjs";

const SSH = process.env.OPENLEN_SSH_HOST || "openlen";

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);
const normaliza = (s) => Buffer.from(s.toString("utf8").split("\r\n").join("\n"), "utf8");

let remoto;
try {
  const salida = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SSH,
     `for f in ${BOX_FILES.map((f) => `'${f.box}'`).join(" ")}; do if [ -f "$f" ]; then sha256sum "$f"; else echo "AUSENTE $f"; fi; done`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  remoto = new Map(
    salida.trim().split("\n").map((l) => {
      const [a, b] = l.trim().split(/\s+/);
      return a === "AUSENTE" ? [b, null] : [b, a.slice(0, 12)];
    }),
  );
} catch (err) {
  console.error(`  no pude hablar con el box (${SSH}): ${err.message.split("\n")[0]}`);
  console.error("  esto NO es deriva — es que no se pudo comprobar.");
  process.exit(2);
}

let derivados = 0;
let ausentes = 0;
for (const f of BOX_FILES) {
  const local = sha(normaliza(readFileSync(f.repo)));
  const box = remoto.get(f.box);
  if (box === null || box === undefined) {
    ausentes++;
    console.log(`  AUSENTE EN EL BOX  ${f.repo}\n                     -> ${f.box}`);
  } else if (box === local) {
    console.log(`  igual   ${local}  ${f.repo}`);
  } else {
    derivados++;
    console.log(`  DERIVA  repo=${local} box=${box}  ${f.repo}`);
    console.log(`          -> ${f.box}`);
    console.log(`          ver: ssh ${SSH} "cat ${f.box}" | diff ${f.repo} -`);
  }
}

console.log("");
if (derivados === 0 && ausentes === 0) {
  console.log(`  ${BOX_FILES.length} ficheros, ninguna deriva.`);
  process.exit(0);
}
console.log(`  ${derivados} con deriva, ${ausentes} ausentes, de ${BOX_FILES.length}.`);
process.exit(1);
