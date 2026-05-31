// Validates that every messages/<locale>/<ns>.json matches the English
// reference (messages/en) — same set of namespace files and identical leaf
// key-paths — and that all files parse as JSON. Auto-discovers locales, so
// adding a messages/<locale>/ dir is enough; no edit here needed.
import fs from "node:fs";
import path from "node:path";

const root = "messages";
const ref = "en";

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

const locales = fs
  .readdirSync(root)
  .filter((d) => fs.statSync(path.join(root, d)).isDirectory())
  .sort();
const namespaces = fs
  .readdirSync(path.join(root, ref))
  .filter((f) => f.endsWith(".json"))
  .sort();

// Build the reference key-set per namespace from English.
let bad = 0;
const refKeys = {};
for (const ns of namespaces) {
  const r = load(path.join(root, ref, ns));
  if (!r.ok) {
    console.log(`✗ EN PARSE FAIL ${ns}: ${r.err}`);
    bad++;
    continue;
  }
  refKeys[ns] = leafKeys(r.data).sort();
}

for (const loc of locales) {
  if (loc === ref) continue;
  let locBad = 0;
  let locKeys = 0;
  for (const ns of namespaces) {
    if (!refKeys[ns]) continue;
    const f = path.join(root, loc, ns);
    if (!fs.existsSync(f)) {
      console.log(`✗ ${loc}/${ns} MISSING`);
      bad++;
      locBad++;
      continue;
    }
    const r = load(f);
    if (!r.ok) {
      console.log(`✗ ${loc}/${ns} PARSE FAIL: ${r.err}`);
      bad++;
      locBad++;
      continue;
    }
    const k = leafKeys(r.data).sort();
    const missing = refKeys[ns].filter((x) => !k.includes(x));
    const extra = k.filter((x) => !refKeys[ns].includes(x));
    if (missing.length || extra.length) {
      bad++;
      locBad++;
      console.log(`✗ MISMATCH ${loc}/${ns}`);
      if (missing.length) console.log(`    missing in ${loc}: ${missing.join(", ")}`);
      if (extra.length) console.log(`    extra in ${loc}:   ${extra.join(", ")}`);
    } else {
      locKeys += k.length;
    }
  }
  if (!locBad) console.log(`✓ ${loc.padEnd(6)} all ${namespaces.length} namespaces match (${locKeys} keys)`);
}

const others = locales.filter((l) => l !== ref).length;
console.log(
  bad
    ? `\nFAIL: ${bad} problem(s)`
    : `\nALL MATCH — ${others} locale(s) vs ${ref} × ${namespaces.length} namespaces`,
);
process.exit(bad ? 1 : 0);
