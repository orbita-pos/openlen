// Beyond key-parity AND compile: verify that every translated VALUE references
// exactly the same ICU arguments ({count}, {name}, …) and the same markup tags
// (<strong>, <muted>, <br> …) as the English source. Walks the real parser AST
// (no regex false-positives on plural branches) and compares as multisets, since
// word order may change. Catches INVENTED placeholders (valid ICU that the
// component never supplies a value for → render error in one locale only) and
// DROPPED ones — drift that parity, tsc, and even compile-check all miss.
import fs from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

const root = "messages";
const ref = "en";

// formatjs AST node types (icu-messageformat-parser TYPE enum).
const T = { literal: 0, argument: 1, number: 2, date: 3, time: 4, select: 5, plural: 6, pound: 7, tag: 8 };

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

function walk(nodes, args, tags) {
  for (const n of nodes) {
    switch (n.type) {
      case T.argument:
      case T.number:
      case T.date:
      case T.time:
        args.push(n.value);
        break;
      case T.select:
      case T.plural:
        args.push(n.value);
        for (const k of Object.keys(n.options)) walk(n.options[k].value, args, tags);
        break;
      case T.tag:
        tags.push(n.value);
        walk(n.children, args, tags);
        break;
      default:
        break; // literal, pound — no referenced names
    }
  }
}

function shape(val, loc) {
  const args = [], tags = [];
  walk(new IntlMessageFormat(val, loc).getAst(), args, tags);
  return { args: args.sort(), tags: tags.sort() };
}
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const locales = fs
  .readdirSync(root)
  .filter((d) => fs.statSync(path.join(root, d)).isDirectory() && d !== ref)
  .sort();
const namespaces = fs
  .readdirSync(path.join(root, ref))
  .filter((f) => f.endsWith(".json"))
  .sort();

let problems = 0;
for (const loc of locales) {
  let locBad = 0;
  for (const ns of namespaces) {
    const en = Object.fromEntries(leaves(JSON.parse(fs.readFileSync(path.join(root, ref, ns), "utf8"))));
    for (const [key, trVal] of leaves(JSON.parse(fs.readFileSync(path.join(root, loc, ns), "utf8")))) {
      const enVal = en[key];
      if (enVal == null) continue; // key-parity guards this
      const e = shape(enVal, ref), t = shape(trVal, loc);
      if (!eq(e.args, t.args) || !eq(e.tags, t.tags)) {
        problems++;
        locBad++;
        console.log(`✗ ${loc}/${ns} :: ${key}`);
        if (!eq(e.args, t.args)) console.log(`    ARGS en[${e.args.join(" ")}]  ${loc}[${t.args.join(" ")}]`);
        if (!eq(e.tags, t.tags)) console.log(`    TAGS en[${e.tags.join(" ")}]  ${loc}[${t.tags.join(" ")}]`);
      }
    }
  }
  if (!locBad) console.log(`✓ ${loc.padEnd(6)} args + tags match en`);
}
console.log(problems ? `\nFAIL: ${problems} value(s) with arg/tag drift` : `\nALL CLEAN — ${locales.length} locales vs ${ref}`);
process.exit(problems ? 1 : 0);
