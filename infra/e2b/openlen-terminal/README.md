# openlen-terminal — the real terminal's E2B template

Spec (local): `docs/superpowers/specs/2026-10-21-real-terminal-e2b-design.md`.

What the box has: Ubuntu 24.04, Node 22, Python 3 with pip, git, ripgrep, jq, sqlite3, curl, unzip,
and OpenLen's scripts in `/opt/openlen/bin` (generated from `lib/agent/sandbox/template-files.ts`):

- `openlen-manifest`: path → sha256 of the project's files, as JSON.
- `openlen-bridge`: the commands OpenLen answers (`git`, `supabase`, `tsc`, `eslint`, `vitest`,
  `npm`, `npx`, `curl`), through the mailbox in `/run/openlen`.
- one wrapper per bridged program. The turn puts `/opt/openlen/bin` first in `PATH`.

Since v3 (spec local `2026-10-26-len-skills-design.md`), for the office skills: LibreOffice (Calc,
Writer, Impress) with its Python bridge (`python3-uno`), poppler-utils, DejaVu fonts, and openpyxl,
pandas, python-docx and python-pptx at the versions in `OFFICE_PYTHON_PACKAGES`.

Since v4 (spec local `2026-10-27-len-pdf-skill-design.md`), for the pdf skill: qpdf, tesseract with
Len's ten languages, TrueType fonts for Japanese, Korean and Chinese (`PDF_FONT_FILES`), and pypdf,
pdfplumber, reportlab and cryptography at the versions in `PDF_PYTHON_PACKAGES`. Check a built
template with `npm run pdf-skill:box-check`.

Size: 2 vCPU and 4 GiB (`lib/agent/sandbox/size.ts`), fixed at build.

Build (needs the `e2b` package and `E2B_API_KEY`; costs E2B build time):

```bash
npm run sandbox:template
```

A changed template gets a NEW name in `SANDBOX_TEMPLATE` (`lib/agent/sandbox/config.ts`): a box born
from the old one is killed and replaced at its project's next turn (`choose.ts`), and the reaper kills
those never used again. More in `infra/SANDBOX_RUNBOOK.md`.
