// Gold-standard gate: compile every message in every locale with the same ICU
// parser next-intl uses at runtime (intl-messageformat). Catches malformed ICU
// (unbalanced braces, bad plural/select), unclosed rich-text tags, and bad
// escapes — failures that key-parity and tsc never see but that throw when the
// page renders in that locale. en/es are included as a baseline.
import fs from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

const root = "messages";

function leaves(obj, prefix = "") {
  let out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const kp = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out = out.concat(leaves(v, kp));
    else out.push([kp, String(v)]);
  }
  return out;
}

const locales = fs
  .readdirSync(root)
  .filter((d) => fs.statSync(path.join(root, d)).isDirectory())
  .sort();
const namespaces = fs
  .readdirSync(path.join(root, "en"))
  .filter((f) => f.endsWith(".json"))
  .sort();

let bad = 0;
let total = 0;
for (const loc of locales) {
  let locBad = 0;
  for (const ns of namespaces) {
    const data = JSON.parse(fs.readFileSync(path.join(root, loc, ns), "utf8"));
    for (const [key, val] of leaves(data)) {
      total++;
      try {
        // Construction parses the AST — same step that throws at render time.
        new IntlMessageFormat(val, loc);
      } catch (e) {
        bad++;
        locBad++;
        console.log(`✗ ${loc}/${ns} :: ${key}`);
        console.log(`    ${String(e.message).split("\n")[0]}`);
        console.log(`    value: ${JSON.stringify(val).slice(0, 140)}`);
      }
    }
  }
  if (!locBad) console.log(`✓ ${loc.padEnd(6)} all messages compile`);
}
console.log(
  bad
    ? `\nFAIL: ${bad}/${total} messages failed to compile`
    : `\nALL COMPILE — ${total} messages across ${locales.length} locales`,
);
process.exit(bad ? 1 : 0);
