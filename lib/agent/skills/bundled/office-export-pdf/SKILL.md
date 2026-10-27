---
name: office-export-pdf
description: Convert an Office document to a requested PDF with LibreOffice.
---

# Export an Office document to PDF

Use LibreOffice through the terminal. Do not install a replacement to work around a failed conversion.

Convert the final saved Office file to a new PDF in `/tmp/office`. Preserve the source. Quote each input and output path.

```text
soffice --headless --convert-to pdf --outdir "<output-directory>" "<final-office-file>"
```

The PDF takes the source file's name with `.pdf`. Check the command result, nonempty output, and `%PDF-` file signature (`head -c 5 "<file.pdf>"`), then report that extent of validation. Unless the user requests deeper checks, do not generate images or install tools to validate a conversion. Spreadsheet PDF pages follow workbook print settings; change those settings only when requested. Conversion may differ from the native application's pagination or fonts.

If export fails, preserve the usable source and report the export limitation. Do not repeatedly convert an unchanged source or use conversion to investigate a failed preview. For PDF export alone, stop after these checks. Only a request for images or visual inspection calls for `office-render`; load it before that separate operation. Deliver the requested PDF through `present`.
