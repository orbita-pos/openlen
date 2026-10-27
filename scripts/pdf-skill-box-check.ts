// scripts/pdf-skill-box-check.ts
// Checks that a REAL box of SANDBOX_TEMPLATE has what Len's pdf skill needs (spec local
// 2026-10-27-len-pdf-skill, §4.4 and §4.7): the PDF Python packages, qpdf, tesseract in Len's ten
// languages, fonts reportlab embeds for every script Len writes in, and AES passwords. Says OK/FAIL per
// check and kills the box. No Python on the machine that runs it: everything runs in the box.
//
// Needs E2B_API_KEY and the template built (npm run sandbox:template). Costs cents of E2B.
//
// Run: npm run pdf-skill:box-check

import { SANDBOX_TEMPLATE } from "../lib/agent/sandbox/config";
import { PDF_FONT_FILES } from "../lib/agent/sandbox/template-files";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FAIL "} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

type Run = { exitCode: number; stdout: string; stderr: string };
type Box = {
  commands: { run(cmd: string, o?: { timeoutMs?: number }): Promise<Run> };
  files: { write(path: string, data: string | ArrayBuffer): Promise<unknown> };
  kill(): Promise<unknown>;
};

/** A command's answer, also when it exits non-zero (E2B throws it with its exit code and output). */
async function run(box: Box, cmd: string, timeoutMs = 120_000): Promise<Run> {
  try {
    return await box.commands.run(cmd, { timeoutMs });
  } catch (e) {
    const x = e as Partial<Run>;
    if (typeof x?.exitCode !== "number") throw e;
    return { exitCode: x.exitCode, stdout: String(x.stdout ?? ""), stderr: String(x.stderr ?? "") };
  }
}

const short = (r: Run) => `exit ${r.exitCode}: ${(r.stderr || r.stdout).trim().slice(-300)}`;

const LANGS = ["eng", "spa", "por", "fra", "deu", "ita", "jpn", "kor", "chi_sim", "nld"];
const SCRIPTS_SAMPLES = { latin: "Añoño €", ja: "日本語", ko: "한국어", zh: "中文" } as const;

const FONTS_PY = `
import json, sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
fonts = json.loads(sys.argv[1]); samples = json.loads(sys.argv[2])
c = canvas.Canvas("/tmp/pdf-check/fonts.pdf")
y = 780
for key, path in fonts.items():
    name = "F_" + key
    pdfmetrics.registerFont(TTFont(name, path, subfontIndex=0) if path.endswith(".ttc") else TTFont(name, path))
    c.setFont(name, 14)
    c.drawString(72, y, samples[key])
    y -= 30
c.save()
`;

const AES_PY = `
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
c = canvas.Canvas("/tmp/pdf-check/plain.pdf"); c.drawString(72, 720, "secret page"); c.save()
w = PdfWriter(clone_from="/tmp/pdf-check/plain.pdf")
w.encrypt("pw-123", algorithm="AES-256")
w.write("/tmp/pdf-check/locked.pdf")
r = PdfReader("/tmp/pdf-check/locked.pdf")
assert r.is_encrypted
r.decrypt("pw-123")
print(r.pages[0].extract_text())
`;

async function environment(box: Box) {
  const imports = await run(box, `python3 -c "import pypdf, pdfplumber, reportlab, cryptography; print('ok')"`);
  check("python imports pypdf, pdfplumber, reportlab and cryptography", imports.exitCode === 0, short(imports));

  const qpdf = await run(box, "qpdf --version");
  check("qpdf runs", qpdf.exitCode === 0, short(qpdf));

  const langs = await run(box, "tesseract --list-langs");
  const listed = new Set((langs.stdout + langs.stderr).split(/\s+/));
  const missing = LANGS.filter((l) => !listed.has(l));
  check("tesseract has Len's ten languages", langs.exitCode === 0 && missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : short(langs));

  for (const [key, path] of Object.entries(PDF_FONT_FILES)) {
    const there = await run(box, `test -f '${path}'`);
    check(`font file for ${key} exists (${path})`, there.exitCode === 0, short(there));
  }

  await box.files.write("/tmp/pdf-check/fonts.py", FONTS_PY);
  const fonts = await run(box, `python3 /tmp/pdf-check/fonts.py '${JSON.stringify(PDF_FONT_FILES)}' '${JSON.stringify(SCRIPTS_SAMPLES)}' && pdftotext /tmp/pdf-check/fonts.pdf -`);
  const lost = Object.values(SCRIPTS_SAMPLES).filter((s) => !fonts.stdout.includes(s));
  check("reportlab embeds every font and pdftotext gives the letters back", fonts.exitCode === 0 && lost.length === 0, lost.length ? `lost ${lost.join(" ")}; ${short(fonts)}` : short(fonts));

  await box.files.write("/tmp/pdf-check/aes.py", AES_PY);
  const aes = await run(box, "python3 /tmp/pdf-check/aes.py");
  check("pypdf sets and removes an AES-256 password", aes.exitCode === 0 && aes.stdout.includes("secret page"), short(aes));
}

async function main() {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error("E2B_API_KEY is not set");
  const { Sandbox } = await import("e2b");
  console.log(`box from ${SANDBOX_TEMPLATE}…`);
  const box = (await Sandbox.create(SANDBOX_TEMPLATE, { apiKey, timeoutMs: 15 * 60_000 })) as unknown as Box;
  try {
    await run(box, "mkdir -p /tmp/pdf-check");
    await environment(box);
  } finally {
    await box.kill().catch(() => undefined);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} OK`);
  if (failed.length > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  },
);
