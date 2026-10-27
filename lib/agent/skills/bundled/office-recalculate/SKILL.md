---
name: office-recalculate
description: Refresh spreadsheet formula caches and verify calculated values with LibreOffice.
---

# Recalculate spreadsheet formulas

Use LibreOffice through the terminal with this skill's script, relative to its base directory. It starts `soffice --headless` with its own profile, recalculates every formula, saves a new workbook, and prints JSON with the number of formulas and every error cell. Do not install a replacement or call another spreadsheet engine to work around a failed recalculation.

Keep the original workbook and write a new file in `/tmp/office`. Quote each input and output path.

```text
python3 <base directory>/scripts/recalc.py "<workbook.xlsx>" "<recalculated.xlsx>"
```

The output is `{"ok": true|false, "formulas": N, "errors": [{"cell": "Sheet!B4", "value": "#REF!"}], "error": "…"}`. `ok` is false when any formula evaluates to an error; `error` is present only when nothing could be recalculated. A clean run shows that the formulas evaluate, not that they compute what was requested.

Verify the saved result with openpyxl. Open it with both `data_only=False` and `data_only=True`. Check that formulas survive and cached results match the requested logic, expected totals, and cell types. Check required unchanged sheets, styles, and data. Recalculation does not validate business logic or guarantee Excel-specific feature compatibility.

If the command fails or prints `error`, preserve the workbook and explain that calculated values could not be refreshed. Do not replace requested formulas with constants or present stale/absent caches as fresh results. Deliver the verified output through `present`.
