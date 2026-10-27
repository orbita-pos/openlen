---
name: office-render
description: Render requested document images or inspect visual layout with LibreOffice.
---

# Document images and visual inspection

Use LibreOffice through the terminal: convert the saved file to PDF, then read the PDF's pages as images with `Read` and its `pages` parameter. Do not install a replacement renderer or build an alternative rendering pipeline to work around a failed render.

## Render the saved deliverable

Keep the saved deliverable in `/tmp/office`. For inspection-only previews, create a new directory for each render (`preview=$(mktemp -d /tmp/office/render.XXXXXXXX)`) and convert into it. Quote each input and output path. Remove only that directory once image inspection finishes, including after a failed render.

```text
soffice --headless --convert-to pdf --outdir "$preview" "<final-file>"
```

The PDF takes the source file's name with `.pdf`. Read it with `Read` and `pages` ("1-3"; at most 20 pages per call): the pages come back as images. For requested image exports, convert the PDF pages to PNG with `pdftoppm -png -r 110 "<file.pdf>" "<output-prefix>"` in the requested directory and keep the images.

For DOCX, PPTX, or PDF, read the requested pages or slides in one call. Inspect all pages only for a requested whole-document review. A worksheet renders by its print settings, so its page numbers are not sheet numbers; change print areas or scaling only when the user requests print layout. Inspect the final saved file, reuse existing images for an unchanged source, and rerender only after requested source changes.

Check clipping, alignment, headings, table widths, contrast, chart labels, and number formats as relevant to the task. A successful command or image read alone does not establish a usable preview; guessed text geometry does not establish overflow.

## Failed or blank previews

For populated content, a fully transparent or uniformly blank image is a renderer failure. Check once and do not reread the same image. Stop visual checks for the task immediately after a blank result: do not render or read images again, even after editing or copying the source, or try another page, sheet, resolution, output format, or print setting. Preserve the usable source and requested outputs and finish applicable content and data checks.

If content and structure checks pass, name the saved file and verified edits as needed, then say in one sentence, in the user's language, that content and structure checks passed and visual inspection was not completed. Do not describe the image or pixels. Report content or structure failures separately; never say all checks passed or claim visual verification.

LibreOffice output can differ from Word, PowerPoint, or Excel. Images do not certify animation or media playback, refresh formula caches in the source workbook, or guarantee native application fidelity. Deliver requested files through `present`. Do not deliver inspection images or reports unless requested.
