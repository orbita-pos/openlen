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

`pdf` is ours, written from the technical facts of Anthropic's `pdf` skill (which libraries do what,
what breaks), without its text or its scripts (its license reserves all rights). Its four scripts
(`pdf/scripts/`) are ours too. Added on 2026-10-27 (spec local 2026-10-27-len-pdf-skill); checked in a
real box by `npm run pdf-skill:box-check`.

`schedule` is ours (spec local 2026-10-29-tareas-programadas), from the facts of Claude Code's
`/schedule` skill (binary 2.1.304: the prompt must be self-contained, confirm the user's local time, a
one-hour minimum), which has no open license, and DeepSeek Harness's schedule tools
(`packages/schedule/tool-schedule`, MIT, read at `00d5414`). Added on 2026-10-29.

`deep-research` is ours, written from the method of Anthropic's `deep-research` skill (subtopics,
short queries that never repeat, reading the promising pages, primary sources, a report that answers
first), facts only: it has no open license. Claude coordinates research subagents; Len has none, so one
researcher follows the same loop within Len's search limits (`lib/agent/web/herramientas.ts`). Added
on 2026-10-27 (spec local 2026-10-27-len-five-skills, §4.1).

`dataviz` is ours, from the facts of Claude Code's `dataviz` skill (the procedure with color last, the
four jobs of color, the fixed rules, the color-blindness thresholds: ΔE 8 as the target, 6 as the floor
with a second encoding, under 15 for normal vision a failure), facts only: it has no open license. Its
validator, `dataviz/scripts/validate_palette.mjs`, is our code, written from public definitions: sRGB to
OKLab (Björn Ottosson, 2020), Machado, Oliveira and Fernandes (2009) at severity 1.0, and WCAG 2
contrast. Added on 2026-10-27 (spec local 2026-10-27-len-five-skills, §4.3).

`verify` is ours, from the facts of Claude Code's `verify` skill (checking is watching the change run
through its interface, the destructive rule, a verdict with its evidence), which has no open license,
and, adapted, Anthropic's `webapp-testing` skill (github.com/anthropics/skills,
`skills/webapp-testing/SKILL.md`), Apache License 2.0, full text in
`LICENSES/anthropic-skills.Apache-2.0.txt`. Changes: Len's `use_page` steps instead of a Python script
for looking and acting; Node's Playwright Test in `/tests` (the one in the box) instead of Python's
`sync_playwright` and its server helper; the look-then-act order and waiting for the page to load kept.
Added on 2026-10-27 (spec local 2026-10-27-len-five-skills, §4.4).

`setup-brand` is ours, from the facts of Anthropic's `setup-writing-style` skill (ask before reading,
only what the user wrote shows their voice, a voice that stays and a tone per audience, no personal
data: the pattern and never the value, saved as a skill), which has no open license; and, adapted, the
structure of Anthropic's `brand-guidelines` (colors with their role, type, the brand as a skill) and the
"create your own theme" step of `theme-factory` (github.com/anthropics/skills), Apache License 2.0,
full text in `LICENSES/anthropic-skills.Apache-2.0.txt`. Changes: the brand is the business's, saved as
the project's skill `brand`; it is read from the page, the project's memory and the owner's own texts;
none of theme-factory's ready-made themes. Added on 2026-10-27 (spec local 2026-10-27-len-five-skills,
§4.5).

Generated skills (spec local 2026-10-27-len-five-skills, §4.2), built in `lib/agent/skills/generated.ts`
from the same TypeScript that served `/.openlen/docs`: `artifact-*` (the deliverables manuals),
`convert-to-app` (the app manual) and `frontend-design`. `frontend-design` is OpenLen's design guide
followed by `lib/agent/skills/frontend-design.ts`, adapted from Anthropic's `frontend-design` skill
(github.com/anthropics/skills, `skills/frontend-design/SKILL.md`), Apache License 2.0, full text in
`LICENSES/anthropic-skills.Apache-2.0.txt`. Changes: shortened; only what doesn't contradict OpenLen's
guide, which comes first and wins where they differ; the critique uses Len's `view_page`.

`skill-creator` is ours, after DeepSeek's idea of shipping "creator skills" for what the agent authors
(`.agents/notes/archived/architecture/2026-09-21-creator-skills-progressive-disclosure.md`): added on
2026-10-26 when a real turn showed Len did not know where a user's skill goes.
