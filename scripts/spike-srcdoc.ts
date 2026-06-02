// Throwaway: rebuild the EXACT iframe srcDoc the editor composes (the 6 inject
// passes in derive() order) and parse-check every inline <script> with node:vm
// — which catches the runtime SyntaxError that lives INSIDE an injected
// template-literal script string (tsc can't see those). Pinpoints which
// injected editor script is broken + the message.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/spike-srcdoc.ts [page.html]

import { readFileSync, writeFileSync } from "node:fs";
import { Script } from "node:vm";
import { injectImageReplace } from "../components/workspace-v2/use-image-replace";
import { injectSectionReorder } from "../components/workspace-v2/use-section-reorder";
import { injectElementInspect } from "../components/workspace-v2/use-element-inspect";
import { injectInlineEdit } from "../components/workspace-v2/use-inline-edit";
import { injectSectionSelect } from "../components/workspace-v2/use-section-select";
import { injectSectionInsert } from "../components/workspace-v2/use-section-insert";

const src = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "spike/debug.html";
const doc = readFileSync(src, "utf8");

// derive() order from preview-area.tsx
let html = injectImageReplace(doc);
html = injectSectionReorder(html);
html = injectElementInspect(html);
html = injectInlineEdit(html);
html = injectSectionSelect(html);
html = injectSectionInsert(html);
writeFileSync("spike/srcdoc.html", html);
console.log(`srcDoc rebuilt: ${html.length} bytes, ${html.split("\n").length} lines\n`);

const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m: RegExpExecArray | null;
let i = 0;
let broken = 0;
while ((m = re.exec(html)) !== null) {
  const attrs = (m[1] ?? "").trim();
  const code = m[2] ?? "";
  i++;
  if (/\bsrc\s*=/.test(attrs)) continue;
  if (/type\s*=\s*["']application\/(ld\+json|json)["']/i.test(attrs)) continue;
  if (!code.trim()) continue;
  const startLine = html.slice(0, m.index).split("\n").length;
  try {
    new Script(code, { filename: `srcdoc-script-${i}` });
  } catch (e) {
    broken++;
    writeFileSync(`spike/broken-script-${i}.js`, code);
    const err = e as Error;
    console.log(`>>> SYNTAX ERROR — script #${i}  (srcDoc line ~${startLine}, ${code.length}b, attrs="${attrs.slice(0, 50)}")`);
    console.log(`    ${err.message}`);
    console.log(`    head: ${code.slice(0, 140).replace(/\s+/g, " ")}`);
    console.log(`    tail: ${code.slice(-140).replace(/\s+/g, " ")}\n`);
  }
}
console.log(`scanned ${i} inline scripts, ${broken} with syntax errors`);
