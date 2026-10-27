---
name: office-docx
description: Create, read, edit, and validate Word documents (.docx).
---

# Word documents

Use `python-docx` for DOCX creation and ordinary edits. Follow an explicit requirement from the user, `/LEN.md`, or `~/.len/LEN.md` for an environment or another library. Otherwise run the terminal's `python3`, which has `python-docx` installed. Do not install packages for the default workflow. If the terminal cannot run Python, report a missing dependency only when it prevents the requested operation.

Keep source scripts, intermediate files, and final documents in `/tmp/office`: a file written at the project's root is saved to the project and published with the site. A file the user attached is in `/.openlen/attachments/`, read-only. Use the user's requested language and preserve an existing document's design unless a redesign is requested.

Name Python scripts for their task, such as `edit_docx.py`; avoid module names such as `inspect.py`, `docx.py`, or `zipfile.py` that shadow imported libraries.

## Create and edit

For text edits, locate the target by its text or position and inspect only its runs and formatting. A title can be an ordinary paragraph without a Title style or document-property title. Update the relevant runs; assigning paragraph `.text` destroys run formatting. Save a new file unless an in-place edit is requested. For ordinary text edits, do not unzip the document, enumerate ZIP members, dump raw XML, or inspect core properties, headers, or footers unrelated to the target. Investigate these only for a concrete failure, an ambiguous target, an unsupported feature, or an explicit user requirement. Rebuilding a document can lose unsupported features.

Use paragraph styles for headings and body text. Size tables for the section that contains them, and account for merged cells and nested tables. Chinese, Japanese, and Korean text may need an explicit `w:eastAsia` font assignment in addition to `run.font.name`; font names alone do not establish glyph availability or rendered appearance.

For a new document:

```python
from docx import Document

document = Document()
document.add_heading("Project report", level=0)
document.add_paragraph("Summary", style="Heading 1")
document.add_paragraph("The requested findings go here.")
document.save("/tmp/office/report.docx")
```

python-docx does not paginate or render documents. Do not represent ordinary replacement, colored text, or comments as tracked changes. When real revisions or unsupported OOXML features matter, preserve their package parts and verify the requested operation rather than silently discarding them. When writing package parts directly, create a new ZIP and copy each unchanged member once; appending a replacement member duplicates its name and corrupts the package.

## Check and deliver

Reopen the saved document with python-docx and verify the requested content, related formatting, and unchanged content that must be preserved. When these checks pass, stop validation and deliver the file. Do not add ZIP integrity checks, package inventories, or metadata inspection as routine final verification.

Creating a file or changing content with incidental basic formatting does not require additional operations. Load `office-render` for requested images or visual inspection. When styling, font color, spacing, sizing, or text alignment is the requested edit, load `office-render` and inspect the changed page even without a separate visual-check request, unless the user explicitly skips rendering. For PDF output load `office-export-pdf`.

Call `present({"files":[{"path":"/tmp/office/report.docx"}]})` with the actual final DOCX path, once it is final: the user gets a copy of the file as it is when you call it. Do not present temporary QA reports unless requested.
