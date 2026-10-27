# Where Len's own skills come from

Not served to Len: only the files inside each skill's folder are (`lib/agent/skills/bundled.ts`).

The seven office skills (`office`, `office-xlsx`, `office-docx`, `office-pptx`, `office-recalculate`,
`office-render`, `office-export-pdf`) are adapted from DeepSeek Harness,
`packages/skill/skill-office/assets/*/SKILL.md` (github.com/deepseek-ai/deepseek-harness, read on
2026-10-26), MIT License, Copyright (c) 2026 DeepSeek. The full license is in
`LICENSES/deepseek-harness.MIT.txt`.

What changed for Len (spec local 2026-10-26-len-skills, §4.7):
- Their `load_workspace_dependencies` Python is the terminal's `python3`, with the packages installed in
  the E2B template (`infra/e2b/openlen-terminal/template.ts`).
- Their LibreOffice Kit sidecar is `soffice --headless`, in the same template.
- Their task workspace is `/tmp/office`: a file Len writes at the project's root is saved to the project
  and published with the site, and `/tmp` never syncs.
- Their visual inspection reads the rendered PDF with `Read` and `pages`, which returns its pages as images.
- Their `present` is Len's `present`, which copies each file.
- The section on LibreOffice's limits in `office-xlsx` is ours. It is not taken from any other skill.

`office/scripts/check_office.py` and `office-recalculate/scripts/recalc.py` are ours. DeepSeek's
note `2026-09-15-bundled-office-skills.md` describes a structural checker that is not in its public
repository.

`skill-creator` is ours, after DeepSeek's idea of shipping "creator skills" for what the agent authors
(`.agents/notes/archived/architecture/2026-09-21-creator-skills-progressive-disclosure.md`): added on
2026-10-26 when a real turn showed Len did not know where a user's skill goes.
