// scripts/pdf-skill-box-check.ts
// Checks that a REAL box of SANDBOX_TEMPLATE has what Len's pdf skill needs (spec local
// 2026-10-27-len-pdf-skill, §4.4 and §4.7): the PDF Python packages, qpdf, tesseract in Len's ten
// languages, fonts reportlab embeds for every script Len writes in, and AES passwords. Says OK/FAIL per
// check and kills the box. No Python on the machine that runs it: everything runs in the box.
//
// Then the skill's four form scripts (lib/agent/skills/bundled/pdf/scripts/), against PDFs it makes in
// the box with reportlab: a fillable form, one without fields (its name has a space and an ñ), a
// scan of it, an encrypted copy, and a two-page bank statement for the real turns.
//
// Needs E2B_API_KEY and the template built (npm run sandbox:template). Costs cents of E2B.
//
// Run: npm run pdf-skill:box-check [-- --save-fixtures <folder>]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  files: {
    write(path: string, data: string | ArrayBuffer): Promise<unknown>;
    read(path: string, o: { format: "bytes" }): Promise<Uint8Array>;
  };
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

// The test PDFs, made with reportlab on a US Letter page (612 × 792 pt), so a 72 dpi render maps a
// point to a pixel. The form without fields: "Name:" over a line at y=716, "Notes:" over one at y=636,
// and a 12 pt square for "Agree".
const FIXTURES_PY = `
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Table
from PIL import Image
import subprocess, shutil
D = "/tmp/pdf-check/"
c = canvas.Canvas(D + "form-fillable.pdf", pagesize=letter)
f = c.acroForm
c.drawString(72, 720, "Name:"); f.textfield(name="name", x=130, y=712, width=200, height=20)
c.drawString(72, 680, "I agree:"); f.checkbox(name="agree", x=130, y=676, size=14)
c.drawString(72, 640, "Size:")
for i, v in enumerate(["S", "M", "L"]):
    f.radio(name="size", value=v, selected=False, x=130 + i * 40, y=636, size=14)
c.drawString(72, 600, "Country:"); f.choice(name="country", value="Spain", options=["Spain", "Mexico", "Peru"], x=130, y=592, width=150, height=20)
c.save()
c = canvas.Canvas(D + "Formulario sin campos ñ.pdf", pagesize=letter)
c.drawString(72, 720, "Name:"); c.line(110, 716, 320, 716)
c.rect(72, 680, 12, 12); c.drawString(90, 682, "Agree")
c.drawString(72, 640, "Notes:"); c.line(110, 636, 520, 636)
c.save()
subprocess.run(["pdftoppm", "-r", "150", "-png", "-singlefile", D + "Formulario sin campos ñ.pdf", D + "scan"], check=True)
Image.open(D + "scan.png").convert("RGB").save(D + "scan.pdf", resolution=150)
pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
rows = [["Fecha", "Concepto", "Importe"]] + [[f"2026-03-{d:02d}", f"Venta mostrador nº {d}", f"{d * 12.5:.2f} €"] for d in range(1, 61)]
t = Table(rows, repeatRows=1); t.setStyle([("FONTNAME", (0, 0), (-1, -1), "DejaVu"), ("GRID", (0, 0), (-1, -1), 0.5, "#888888")])
SimpleDocTemplate(D + "extracto.pdf", pagesize=letter).build([t])
# Stored landscape and turned 90° to be shown portrait (as a phone scan often is): drawn in the shown
# page's coordinates, so it reads like the form without fields.
c = canvas.Canvas(D + "rotated.pdf", pagesize=(792, 612))
c.setPageRotation(90)
c.transform(0, 1, -1, 0, 792, 0)
c.drawString(72, 720, "Name:"); c.line(110, 716, 320, 716)
c.drawString(72, 640, "Notes:"); c.line(110, 636, 520, 636)
c.save()
`;

/** The fillable form with "agree" checked through an INDIRECT /V, as some producers write it. */
const INDIRECT_V_PY = `
from pypdf import PdfWriter
from pypdf.generic import NameObject
w = PdfWriter(clone_from="/tmp/pdf-check/form-fillable.pdf")
for ref in w.pages[0]["/Annots"]:
    a = ref.get_object()
    if a.get("/T") == "agree":
        a[NameObject("/V")] = w._add_object(NameObject("/Yes"))
w.write("/tmp/pdf-check/indirect-v.pdf")
`;

const AES_COPY_PY = `
from pypdf import PdfWriter
w = PdfWriter(clone_from="/tmp/pdf-check/form-fillable.pdf"); w.encrypt("pw-123", algorithm="AES-256"); w.write("/tmp/pdf-check/locked-form.pdf")
`;

const VALUES_PY = `
import json, sys
from pypdf import PdfReader
fields = PdfReader(sys.argv[1]).get_fields() or {}
print(json.dumps({k: str(v.get("/V", "")).lstrip("/") for k, v in fields.items()}))
`;

/** Is there ink (a pixel darker than 200) inside a box of a 72 dpi render, in points from the top? */
const INK_PY = `
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("L")
print(json.dumps([min(im.crop(tuple(b)).getdata()) < 200 for b in json.loads(sys.argv[2])]))
`;

const S = "/tmp/pdf-skill/scripts";
const D = "/tmp/pdf-check";
const NO_FIELDS = `'${D}/Formulario sin campos ñ.pdf'`;
const SMITH: [number, number, number, number] = [112, 62, 318, 75];
const YAMADA: [number, number, number, number] = [112, 142, 400, 155];

async function formScripts(box: Box) {
  const local = "lib/agent/skills/bundled/pdf/scripts";
  for (const name of existsSync(local) ? readdirSync(local).filter((n) => n.endsWith(".py")) : []) {
    await box.files.write(`${S}/${name}`, readFileSync(join(local, name), "utf8"));
  }
  await box.files.write(`${D}/fixtures.py`, FIXTURES_PY);
  await box.files.write(`${D}/aes-copy.py`, AES_COPY_PY);
  await box.files.write(`${D}/indirect-v.py`, INDIRECT_V_PY);
  await box.files.write(`${D}/values.py`, VALUES_PY);
  await box.files.write(`${D}/ink.py`, INK_PY);
  const made = await run(box, `python3 ${D}/fixtures.py && python3 ${D}/aes-copy.py && python3 ${D}/indirect-v.py`);
  check("the test PDFs are made", made.exitCode === 0, short(made));

  const fields = await run(box, `python3 ${S}/form_fields.py ${D}/form-fillable.pdf`);
  let found: { fillable?: boolean; fields?: { id: string; type: string; options?: string[] }[] } = {};
  try {
    found = JSON.parse(fields.stdout);
  } catch {
    /* checked below */
  }
  const types = Object.fromEntries((found.fields ?? []).map((f) => [f.id, f.type]));
  check(
    "form_fields finds the four fields and their types",
    fields.exitCode === 0 && found.fillable === true && types.name === "text" && types.agree === "checkbox" && types.size === "radio" && types.country === "choice",
    `${short(fields)} ${JSON.stringify(types)}`,
  );

  const country = found.fields?.find((f) => f.id === "country")?.options?.[0] ?? "Spain";
  await box.files.write(`${D}/values.json`, JSON.stringify({ name: "Ana Núñez", agree: true, size: "M", country }));
  const fill = await run(box, `python3 ${S}/fill_form.py ${D}/form-fillable.pdf ${D}/values.json ${D}/filled.pdf && python3 ${D}/values.py ${D}/filled.pdf`);
  let back: Record<string, string> = {};
  try {
    back = JSON.parse(fill.stdout.trim().split("\n").pop() ?? "{}");
  } catch {
    /* checked below */
  }
  check(
    "fill_form fills and pypdf reads the values back",
    fill.exitCode === 0 && back.name === "Ana Núñez" && back.agree !== "" && back.agree !== "Off" && back.size === "M" && back.country === country,
    `${short(fill)} ${JSON.stringify(back)}`,
  );

  await box.files.write(`${D}/bad-id.json`, JSON.stringify({ nombre: "Ana" }));
  const unknown = await run(box, `python3 ${S}/fill_form.py ${D}/form-fillable.pdf ${D}/bad-id.json ${D}/bad-id.pdf; echo "exit=$?"; test -e ${D}/bad-id.pdf && echo written`);
  check("fill_form refuses an unknown id and writes nothing", unknown.stdout.includes("exit=1") && /nombre/.test(unknown.stderr + unknown.stdout) && !unknown.stdout.includes("written"), short(unknown));

  await box.files.write(`${D}/bad-radio.json`, JSON.stringify({ size: "XXL" }));
  const radio = await run(box, `python3 ${S}/fill_form.py ${D}/form-fillable.pdf ${D}/bad-radio.json ${D}/bad-radio.pdf; echo "exit=$?"`);
  check("fill_form refuses a radio value that is not an option", radio.stdout.includes("exit=1"), short(radio));

  const notFillable = await run(box, `python3 ${S}/form_fields.py ${NO_FIELDS}`);
  check("form_fields says not fillable", notFillable.exitCode === 0 && /"fillable":\s*false/.test(notFillable.stdout), short(notFillable));

  const layout = await run(box, `python3 ${S}/form_layout.py ${NO_FIELDS}`);
  check("form_layout finds the label Name:", layout.exitCode === 0 && layout.stdout.includes('"Name:"') && /"has_text":\s*true/.test(layout.stdout), short(layout));

  await box.files.write(`${D}/place.json`, JSON.stringify({ fields: [{ page: 1, box: SMITH, text: "Smith" }, { page: 1, box: YAMADA, text: "山田" }] }));
  const placed = await run(
    box,
    `python3 ${S}/place_text.py ${NO_FIELDS} ${D}/place.json ${D}/placed.pdf && pdftoppm -r 72 -png -singlefile ${D}/placed.pdf ${D}/placed && pdftoppm -r 72 -png -singlefile ${NO_FIELDS} ${D}/base && python3 ${D}/ink.py ${D}/base.png '${JSON.stringify([SMITH, YAMADA])}' && python3 ${D}/ink.py ${D}/placed.png '${JSON.stringify([SMITH, YAMADA])}'`,
  );
  const [before, after] = placed.stdout.trim().split("\n").slice(-2);
  check("place_text writes Smith and 山田 where asked", placed.exitCode === 0 && before === "[false, false]" && after === "[true, true]", `${short(placed)} before=${before} after=${after}`);

  await box.files.write(`${D}/overlap.json`, JSON.stringify({ fields: [{ page: 1, box: SMITH, text: "A" }, { page: 1, box: [200, 60, 300, 74], text: "B" }] }));
  const overlap = await run(box, `python3 ${S}/place_text.py ${NO_FIELDS} ${D}/overlap.json ${D}/overlap.pdf; echo "exit=$?"; test -e ${D}/overlap.pdf && echo written`);
  check("place_text refuses overlapping boxes", overlap.stdout.includes("exit=1") && !overlap.stdout.includes("written"), short(overlap));

  await box.files.write(`${D}/too-long.json`, JSON.stringify({ fields: [{ page: 1, box: [112, 62, 142, 75], text: "A name far too long for its box", size: 10 }] }));
  const tooLong = await run(box, `python3 ${S}/place_text.py ${NO_FIELDS} ${D}/too-long.json ${D}/too-long.pdf; echo "exit=$?"; test -e ${D}/too-long.pdf && echo written`);
  check("place_text refuses text that does not fit", tooLong.stdout.includes("exit=1") && !tooLong.stdout.includes("written"), short(tooLong));

  const scan = await run(box, `python3 ${S}/form_layout.py ${D}/scan.pdf`);
  check("form_layout has_text is false on the scan", scan.exitCode === 0 && /"has_text":\s*false/.test(scan.stdout), short(scan));
  const ocr = await run(box, `tesseract ${D}/scan.png - -l eng`);
  check("tesseract reads Name off the scan", ocr.exitCode === 0 && ocr.stdout.includes("Name"), short(ocr));

  // 27/10, the review's minors: a value given through a reference, a number for a text field, and a
  // page turned to be shown.
  const indirect = await run(box, `python3 ${S}/form_fields.py ${D}/indirect-v.pdf`);
  let agreeValue: unknown;
  try {
    agreeValue = (JSON.parse(indirect.stdout).fields as { id: string; value: unknown }[]).find((f) => f.id === "agree")?.value;
  } catch {
    /* checked below */
  }
  check("form_fields gives a value through a reference without its slash", indirect.exitCode === 0 && agreeValue === "Yes", `${short(indirect)} agree=${JSON.stringify(agreeValue)}`);

  await box.files.write(`${D}/number.json`, JSON.stringify({ name: 25 }));
  const number = await run(box, `python3 ${S}/fill_form.py ${D}/form-fillable.pdf ${D}/number.json ${D}/number.pdf && python3 ${D}/values.py ${D}/number.pdf`);
  check("fill_form writes a number in a text field as text", number.exitCode === 0 && number.stdout.includes('"name": "25"'), short(number));

  const turned = await run(box, `python3 ${S}/form_layout.py ${D}/rotated.pdf`);
  let shown: { width?: number; height?: number; labels?: { text: string; top: number }[] } = {};
  try {
    shown = JSON.parse(turned.stdout).pages[0];
  } catch {
    /* checked below */
  }
  const nameTop = shown.labels?.find((l) => l.text === "Name:")?.top ?? -1;
  check(
    "form_layout reads a page turned 90° as it is shown",
    turned.exitCode === 0 && shown.width === 612 && shown.height === 792 && nameTop > 55 && nameTop < 76,
    `${short(turned)} width=${shown.width} height=${shown.height} Name: top=${nameTop}`,
  );
  await box.files.write(`${D}/place-rotated.json`, JSON.stringify({ fields: [{ page: 1, box: SMITH, text: "Smith" }, { page: 1, box: YAMADA, text: "山田" }] }));
  const placedTurned = await run(
    box,
    `python3 ${S}/place_text.py ${D}/rotated.pdf ${D}/place-rotated.json ${D}/placed-rotated.pdf && pdftoppm -r 72 -png -singlefile ${D}/placed-rotated.pdf ${D}/placed-rotated && pdftoppm -r 72 -png -singlefile ${D}/rotated.pdf ${D}/base-rotated && python3 ${D}/ink.py ${D}/base-rotated.png '${JSON.stringify([SMITH, YAMADA])}' && python3 ${D}/ink.py ${D}/placed-rotated.png '${JSON.stringify([SMITH, YAMADA])}' && pdftotext ${D}/placed-rotated.pdf -`,
  );
  const lines = placedTurned.stdout.trim().split("\n");
  const [turnedBefore, turnedAfter] = lines.filter((l) => l.startsWith("["));
  check(
    "place_text writes on a page turned 90° where it is shown",
    placedTurned.exitCode === 0 && turnedBefore === "[false, false]" && turnedAfter === "[true, true]" && placedTurned.stdout.includes("Smith"),
    `${short(placedTurned)} before=${turnedBefore} after=${turnedAfter}`,
  );

  const locked = await run(box, `python3 ${S}/form_fields.py ${D}/locked-form.pdf`);
  check(
    "an encrypted PDF answers encrypted, not a traceback",
    locked.exitCode === 2 && /encrypted/i.test(locked.stderr) && !locked.stderr.includes("Traceback"),
    short(locked),
  );
}

async function saveFixtures(box: Box, dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const name of ["form-fillable.pdf", "Formulario sin campos ñ.pdf", "scan.pdf", "extracto.pdf"]) {
    writeFileSync(join(dir, name), await box.files.read(`${D}/${name}`, { format: "bytes" }));
  }
  console.log(`fixtures saved in ${dir}`);
}

async function main() {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error("E2B_API_KEY is not set");
  const at = process.argv.indexOf("--save-fixtures");
  const fixturesDir = at >= 0 ? process.argv[at + 1] : undefined;
  const { Sandbox } = await import("e2b");
  console.log(`box from ${SANDBOX_TEMPLATE}…`);
  const box = (await Sandbox.create(SANDBOX_TEMPLATE, { apiKey, timeoutMs: 15 * 60_000 })) as unknown as Box;
  try {
    await run(box, `mkdir -p ${D} ${S}`);
    await environment(box);
    await formScripts(box);
    if (fixturesDir) await saveFixtures(box, fixturesDir);
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
