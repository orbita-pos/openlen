// Validates that every messages/en/<ns>.json has a matching es/<ns>.json
// with an identical set of leaf key-paths (and that both parse as JSON).
import fs from "node:fs";
import path from "node:path";

const enDir = "messages/en";
const esDir = "messages/es";

function leafKeys(obj, prefix = "") {
  let out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const kp = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out = out.concat(leafKeys(v, kp));
    else out.push(kp);
  }
  return out;
}

function load(file) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

let bad = 0;
let totalKeys = 0;
for (const f of fs.readdirSync(enDir).sort()) {
  const en = load(path.join(enDir, f));
  const es = load(path.join(esDir, f));
  if (!en.ok) { console.log(`✗ EN PARSE FAIL ${f}: ${en.err}`); bad++; continue; }
  if (!es.ok) { console.log(`✗ ES PARSE FAIL ${f}: ${es.err}`); bad++; continue; }
  const ek = leafKeys(en.data).sort();
  const sk = leafKeys(es.data).sort();
  const missing = ek.filter((k) => !sk.includes(k));
  const extra = sk.filter((k) => !ek.includes(k));
  if (missing.length || extra.length) {
    bad++;
    console.log(`✗ MISMATCH ${f}`);
    if (missing.length) console.log(`    missing in es: ${missing.join(", ")}`);
    if (extra.length) console.log(`    extra in es:   ${extra.join(", ")}`);
  } else {
    totalKeys += ek.length;
    console.log(`✓ ${f.padEnd(20)} ${ek.length} keys`);
  }
}
console.log(bad ? `\nFAIL: ${bad} file(s) with problems` : `\nALL MATCH — ${totalKeys} keys total across ${fs.readdirSync(enDir).length} namespaces`);
process.exit(bad ? 1 : 0);
