// CLI for the OpenLen Design Contract linter (lib/contract/lint.ts). Lints one
// or more ingredient HTML files against the HARD-LOCKED tier; exits non-zero if
// any file has errors. Build-time gate — run before registering an ingredient.
//
//   npm run contract:lint -- templates/starter/mirror.html
//   npm run contract:lint -- path/to/section.html path/to/template.html
//
// Kind (document vs fragment) is inferred from the file (a <!doctype>/<html> is
// a document; otherwise a fragment). No DB or network — pure file check.

import { readFileSync } from "node:fs";
import { lintContract } from "../lib/contract/lint";

function main(): void {
  const argv = process.argv.slice(2);
  const files = argv.filter((a) => !a.startsWith("--"));
  const kindArg = argv
    .find((a) => a.startsWith("--kind="))
    ?.slice("--kind=".length);
  const kind =
    kindArg === "document" || kindArg === "section" || kindArg === "fragment"
      ? kindArg
      : undefined;
  if (files.length === 0) {
    console.error(
      "usage: npm run contract:lint -- [--kind=document|section|fragment] <file.html> [more.html ...]",
    );
    process.exit(2);
  }

  let totalErrors = 0;
  for (const file of files) {
    let html: string;
    try {
      html = readFileSync(file, "utf8");
    } catch (e) {
      console.error(`[skip] ${file} — ${(e as Error).message}`);
      continue;
    }
    const res = lintContract(html, kind ? { kind } : {});
    const errs = res.violations.filter((v) => v.level === "error");
    const warns = res.violations.filter((v) => v.level === "warning");
    totalErrors += errs.length;
    console.log(
      `\n${res.ok ? "PASS" : "FAIL"}  ${file}  [${res.kind}]  ` +
        `(${errs.length} errors, ${warns.length} warnings)`,
    );
    for (const v of res.violations) {
      console.log(`  ${v.level === "error" ? "x" : "!"} [${v.rule}] ${v.detail}`);
    }
  }

  console.log(`\n${totalErrors === 0 ? "OK — contract clean" : `${totalErrors} error(s)`}`);
  process.exit(totalErrors === 0 ? 0 : 1);
}

main();
