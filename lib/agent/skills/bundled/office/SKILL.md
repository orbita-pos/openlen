---
name: office
description: Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs. Load to choose the relevant workflow.
---

# Office task routing

Call the `skill` tool with the format skill name before creating, reading, or editing Office files. Standalone rendering, PDF export, and recalculation need only their operation skill.

- Create, read, or edit: `office-docx` (Word), `office-pptx` (PowerPoint), or `office-xlsx` (Excel).
- Images, visual inspection, or tasks primarily about layout, spacing, sizing, or alignment: `office-render`, even without an explicit visual-check request.
- Refresh spreadsheet formula results: `office-recalculate`.
- Export an Office file to PDF: `office-export-pdf`.

Honor requests to skip rendering. New files, content edits, formulas, and incidental formatting such as bold headers or number formats need no render unless visual inspection is requested. Do not reload skills.

Office work happens in the terminal. Keep scripts, working files, and outputs in `/tmp/office` (create it with `mkdir -p /tmp/office`): a file written at the project's root is saved to the project and published with the site, and `/tmp` never is. A file the user attached is in `/.openlen/attachments/`, read-only; save results as new files in `/tmp/office`.

When a saved file will not open, `python3 scripts/check_office.py <file>` (relative to this skill's base directory) checks its ZIP, XML, and internal relationships and prints JSON. Do not run it as a routine final check.
