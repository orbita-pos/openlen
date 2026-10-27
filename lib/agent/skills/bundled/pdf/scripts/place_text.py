#!/usr/bin/env python3
"""Write answers onto a form without fillable fields (Len's pdf skill, forms.md step 3).

Usage: python3 place_text.py <in.pdf> <fields.json> <out.pdf>

fields.json is
  {"fields": [{"page": int (from 1), "box": [x0, top, x1, bottom], "text": str, "size": 10}],
   "images": [{"page": int, "width": int, "height": int}]}
with each box in PDF points, origin at the top left (what form_layout.py prints). A page listed in
"images" has its boxes in pixels of a render of that size instead. Each text is stamped into its
page, left-aligned and centered in its box, so it prints and its text can be extracted.

Refuses (exit 1, nothing written) two boxes that overlap on a page, and a text that does not fit its
box at its size. Picks the font by the text: Japanese, Korean, Chinese, or the Latin one.

Written for OpenLen (spec local 2026-10-27-len-pdf-skill), with pypdf and reportlab.
"""
import io
import json
import os
import re
import sys

from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from form_fields import fail, open_pdf  # noqa: E402

# The box's TrueType fonts (lib/agent/sandbox/template-files.ts, PDF_FONT_FILES).
FONT_FILES = {
    "latin": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "ja": "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "ko": "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "zh": "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
}
KANA = re.compile("[぀-ヿ]")
HANGUL = re.compile("[ᄀ-ᇿ㄰-㆏가-힯]")
HAN = re.compile("[㐀-䶿一-鿿]")


def font_for(text):
    key = "ja" if KANA.search(text) else "ko" if HANGUL.search(text) else "zh" if HAN.search(text) else "latin"
    name = "Place_" + key
    if name not in pdfmetrics.getRegisteredFontNames():
        path = FONT_FILES[key]
        pdfmetrics.registerFont(TTFont(name, path, subfontIndex=0) if path.endswith(".ttc") else TTFont(name, path))
    return name


def read_fields(path, reader):
    try:
        with open(path, encoding="utf-8") as f:
            spec = json.load(f)
    except (OSError, ValueError) as e:
        fail(1, f"Cannot read {path}: {e}")
    if not isinstance(spec, dict) or not isinstance(spec.get("fields"), list) or not spec["fields"]:
        fail(1, f'{path} must be {{"fields": [{{"page", "box", "text"}}]}}.')
    images = {}
    for image in spec.get("images") or []:
        try:
            images[int(image["page"])] = (float(image["width"]), float(image["height"]))
        except (KeyError, TypeError, ValueError):
            fail(1, f'Each entry of "images" needs "page", "width" and "height": {image!r}')
    fields, errors = [], []
    for n, field in enumerate(spec["fields"], start=1):
        try:
            page = int(field["page"])
            box = [float(v) for v in field["box"]]
            text = str(field["text"])
            size = float(field.get("size", 10))
        except (KeyError, TypeError, ValueError):
            errors.append(f'field {n} needs "page", "box" ([x0, top, x1, bottom]) and "text": {field!r}')
            continue
        if not 1 <= page <= len(reader.pages):
            errors.append(f"field {n}: page {page} does not exist (the PDF has {len(reader.pages)})")
            continue
        if len(box) != 4 or box[0] >= box[2] or box[1] >= box[3] or not text or size <= 0:
            errors.append(f"field {n}: box must be [x0, top, x1, bottom] with x0 < x1 and top < bottom, and text not empty")
            continue
        media = reader.pages[page - 1].mediabox
        if page in images:
            sx, sy = float(media.width) / images[page][0], float(media.height) / images[page][1]
            box = [box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy]
        fields.append({"n": n, "page": page, "box": box, "text": text, "size": size})
    return fields, errors


def check(fields):
    errors = []
    for i, a in enumerate(fields):
        width, height = a["box"][2] - a["box"][0], a["box"][3] - a["box"][1]
        needed = pdfmetrics.stringWidth(a["text"], font_for(a["text"]), a["size"])
        if a["size"] > height or needed > width:
            errors.append(f"field {a['n']}: {a['text']!r} at size {a['size']:g} needs {needed:.0f} x {a['size']:g} pt and its box is {width:.0f} x {height:.0f}: make the box bigger or the size smaller")
        for b in fields[i + 1:]:
            if a["page"] == b["page"] and a["box"][0] < b["box"][2] and b["box"][0] < a["box"][2] and a["box"][1] < b["box"][3] and b["box"][1] < a["box"][3]:
                errors.append(f"fields {a['n']} and {b['n']} overlap on page {a['page']}")
    return errors


def stamp(reader, fields):
    writer = PdfWriter(clone_from=reader)
    for number in sorted({f["page"] for f in fields}):
        media = reader.pages[number - 1].mediabox
        left, bottom_edge = float(media.left), float(media.bottom)
        height = float(media.height)
        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=(float(media.width), height))
        for f in (f for f in fields if f["page"] == number):
            x0, top, _x1, bottom = f["box"]
            c.setFont(font_for(f["text"]), f["size"])
            baseline = height - bottom + (bottom - top - f["size"]) / 2 + f["size"] * 0.2
            c.drawString(x0 + 1, baseline, f["text"])
        c.save()
        overlay = PdfReader(io.BytesIO(buffer.getvalue())).pages[0]
        if left or bottom_edge:
            overlay.add_transformation([1, 0, 0, 1, left, bottom_edge])
        writer.pages[number - 1].merge_page(overlay)
    return writer


def main():
    if len(sys.argv) != 4:
        fail(1, "Usage: python3 place_text.py <in.pdf> <fields.json> <out.pdf>")
    source, fields_path, target = sys.argv[1:]
    if os.path.abspath(source) == os.path.abspath(target):
        fail(1, "Write the filled form to a new file, not over the original.")
    reader = open_pdf(source)
    fields, errors = read_fields(fields_path, reader)
    errors += check(fields)
    if errors:
        fail(1, "\n".join(errors))
    writer = stamp(reader, fields)
    try:
        with open(target, "wb") as f:
            writer.write(f)
    except Exception:
        if os.path.exists(target):
            os.remove(target)
        raise
    print(f"placed {len(fields)} texts -> {target}")


if __name__ == "__main__":
    main()
