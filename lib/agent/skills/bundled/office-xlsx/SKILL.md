---
name: office-xlsx
description: Read, create, edit, and validate Excel workbooks, data, and formulas (.xlsx).
---

# Excel workbooks

Follow an explicit requirement from the user, `/LEN.md`, or `~/.len/LEN.md` for an environment or library. Otherwise run the terminal's `python3`, which has `openpyxl` and `pandas` installed. Do not install packages for the default workflow. If the terminal cannot run Python, report a missing dependency only when it prevents the requested operation.

Keep scripts, working files, and outputs in `/tmp/office`: a file written at the project's root is saved to the project and published with the site. A file the user attached is in `/.openlen/attachments/`, read-only. Save to a new workbook unless the user requests an in-place edit.

Name Python scripts for their task, such as `edit_xlsx.py`; avoid module names such as `inspect.py`, `openpyxl.py`, or `pandas.py` that shadow imported libraries.

## Read and modify

Use `openpyxl` for existing XLSX workbooks and targeted cell or style changes. Load with `data_only=False` when formulas must survive. Inspect sheet names, the affected cell types, formulas, styles, merged ranges, and referenced ranges before editing. Check the saved file by reopening it, including unchanged content that the request requires preserving.

Use pandas for data analysis and transformations. A DataFrame is not the workbook: exporting it over an existing file can lose sheets, formulas, charts, and formatting. Write analysis results back to the intended ranges with openpyxl.

For a new workbook, write editable values, styles, and formulas directly:

```python
from openpyxl import Workbook
from openpyxl.styles import Font

workbook = Workbook()
sheet = workbook.active
sheet.title = "Revenue"
for row in [("Quarter", "Revenue"), ("Q1", 12), ("Q2", 18), ("Total", "=SUM(B2:B3)")]:
    sheet.append(row)
for cell in sheet[1]:
    cell.font = Font(bold=True)
sheet.column_dimensions["A"].width = 18
sheet.column_dimensions["B"].width = 18
workbook.save("/tmp/office/report.xlsx")
```

Preserve numbers, dates, booleans, and identifiers as the intended cell types; formatting is not a type conversion. For modifications, load the existing file with `openpyxl.load_workbook(path, data_only=False)`, change the requested ranges, and save a separate result. Avoid a DataFrame round trip when workbook features must survive.

Writing a formula does not calculate its result. openpyxl does not evaluate formulas; `data_only=True` returns cached values that may be absent or stale. When calculated results must be refreshed, load `office-recalculate`. Do not replace requested formulas with constants or report stale values as newly calculated results.

Do not rename `.xls`, `.xlsb`, encrypted files, or macro-enabled files to `.xlsx`. They need an appropriate supported operation. `keep_vba=True` can preserve VBA package content in an XLSM workflow, but does not execute or edit macros and does not guarantee every advanced workbook feature survives. Preserve the original and verify such requirements explicitly.

## Formulas that LibreOffice can calculate

The workbook is recalculated with LibreOffice (`office-recalculate`), which evaluates fewer functions than Excel. Choose formulas it can calculate:

- Do not use `XLOOKUP`, `XMATCH`, `FILTER`, `UNIQUE`, `SORT`, or `SEQUENCE`. Use `INDEX` with `MATCH` for lookups, and sort, filter, or remove duplicates in Python before writing the cells.
- Write `TEXTJOIN`, `CONCAT`, `IFS`, `SWITCH`, `MAXIFS`, and `MINIFS` with the `_xlfn.` prefix (for example `=_xlfn.TEXTJOIN(", ",TRUE,A2:A9)`): openpyxl writes the formula exactly as given, and Excel files keep these names prefixed.
- Never save a workbook that was loaded with `data_only=True`: it has no formulas left, and saving it replaces every formula with its last value.

## Check and deliver

Reopen the saved workbook with openpyxl and verify the requested sheet names, values, types, formulas, styles, and totals against the source data, including unchanged content that must be preserved. These checks do not calculate formulas or judge workbook appearance.

Load `office-render` for requested images or visual inspection and whenever the user's primary task targets appearance, including cell fill colors, text alignment, spacing, or sizing. These appearance changes require rendering even without a separate visual-check request, unless the user explicitly skips it. New workbooks and data or formula edits do not require rendering solely because they include incidental basic formatting. In particular, bold headers and number formats accompanying data edits do not require loading `office-render` or running its commands.

Load `office-recalculate` when refreshed calculated values are needed and `office-export-pdf` for PDF output. Deliver after the requested data checks pass and the required operations finish.

Call `present({"files":[{"path":"/tmp/office/report.xlsx"}]})` with the actual final workbook path, once it is final: the user gets a copy of the file as it is when you call it. Do not present intermediate scripts and reports unless requested.
