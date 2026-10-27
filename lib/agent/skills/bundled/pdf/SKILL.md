---
name: pdf
description: Create PDF files and work on existing ones in the terminal (extract text or tables, merge, split, rotate, crop, watermark, add or remove a password, fill forms, OCR scanned pages). To just look at a PDF's pages, use Read with pages; to turn an Office file into a PDF, use office-export-pdf.
---

# PDF files

Two things need no skill:
- To see a PDF's pages, call `Read` with `pages` (an attached PDF or one in the terminal): the pages come back as images.
- To turn a Word, Excel, or PowerPoint file into a PDF, use `office-export-pdf`. When the user also wants the editable Word file, write it with `office-docx` and export it.

Work in `/tmp/office` (create it with `mkdir -p /tmp/office`): a file written at the project's root is saved to the project and published with the site, and `/tmp` never is. A file the user attached is in `/.openlen/attachments/`, read-only; save every result as a new file in `/tmp/office`. Quote every path: file names often have spaces.

Run the terminal's `python3`, which has `pypdf`, `pdfplumber`, and `reportlab` installed, next to `qpdf`, poppler (`pdftotext`, `pdftoppm`, `pdfimages`, `pdfinfo`), and `tesseract`. Do not install packages for the default workflow. If the terminal cannot run Python, report a missing dependency only when it prevents the requested operation.

## Which tool

- A new document of several pages (a report, an invoice, a letter, a menu): `reportlab` with `SimpleDocTemplate` and its flowables (`Paragraph`, `Table`, `Spacer`, `PageBreak`). For text at exact positions on a page, its `canvas`.
- Text: `pdftotext -layout "<file.pdf>" -` for the whole text; `pdfplumber` when the position of each word matters. To find something in a long PDF, search its text first and then `Read` only the pages that matter.
- Tables: `pdfplumber` (`page.extract_tables()`), then `pandas`. For an Excel file, load `office-xlsx` and follow it.
- Merge, split, take a range, rotate, crop, watermark, metadata: `pypdf` (`PdfReader`, `PdfWriter`, `add_page`, `page.rotate`, `page.cropbox`, `page.merge_page`, `add_metadata`). `qpdf` does the same in one line (`qpdf --empty --pages "a.pdf" "b.pdf" -- "out.pdf"`) and repairs a damaged file when it rewrites it.
- The images inside a PDF: `pdfimages -png "<file.pdf>" /tmp/office/img`.
- To set a password, `PdfWriter.encrypt("<password>", algorithm="AES-256")`; to remove one, `PdfReader.decrypt("<password>")`, or `qpdf --decrypt` with its `--password` option. Use the password the user gave only in the command: never write it to a file, to `/LEN.md`, or to memory, and do not repeat it in your reply.

## Fonts

reportlab's built-in fonts (Helvetica, Times, Courier) only cover Latin-1, and any other letter comes out as a box. Register a TrueType font of the terminal for all text, and set it in every style (`fontName`) and on the canvas (`setFont`):

| Text | Font file |
|---|---|
| Latin, Greek, Cyrillic (á, ñ, €…) | `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` |
| Japanese | `/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf` |
| Korean | `/usr/share/fonts/truetype/nanum/NanumGothic.ttf` |
| Chinese | `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc` |

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont("Body", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
# A .ttc holds several fonts: TTFont("Body", "<file>.ttc", subfontIndex=0)
```

Write subscripts and superscripts with `<sub>` and `<super>` inside a `Paragraph`, never with characters such as ₂ or ²: the font may not have them.

## Scanned pages

Try `pdftotext` first. When it gives nothing, or `(cid:` codes, the pages are images: render only the pages you need with `pdftoppm -r 300 -png -f <n> -l <n> "<file.pdf>" /tmp/office/page` and read each one with `tesseract <page.png> - -l <language>` (`eng`, `spa`, `por`, `fra`, `deu`, `ita`, `jpn`, `kor`, `chi_sim`, `nld`; join several with `+`). Each page takes seconds: say so before a long scan.

## Forms

Read `forms.md` (relative to this skill's base directory) before filling a form.

## Check, then deliver

Before delivering a PDF you made:
- `head -c 5 "<file.pdf>"` is `%PDF-`, and `pdfinfo` shows the pages you expect;
- `pdftotext "<file.pdf>" -` gives the text back, which proves its letters are letters;
- look at the pages that matter with `Read` and `pages`: the first, the last, and the ones you changed, unless the user asks for a full review.

For populated content, a blank or uniformly white page image is a render failure: check once, do not read the same image again, and say in one sentence that visual inspection was not completed. Deliver the files with `present`. Do not deliver inspection images or JSON unless requested.
