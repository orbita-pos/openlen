#!/usr/bin/env python3
"""The layout of a form without fillable fields (Len's pdf skill, forms.md step 3).

Usage: python3 form_layout.py <in.pdf>

Prints {"pages": [page], "has_text": bool}. A page is
  {"page": int (from 1), "width", "height",
   "labels": [{"text", "x0", "top", "x1", "bottom"}],  words of one line next to each other, joined
   "lines": [{"x0", "x1", "y"}],                       horizontal rules (answers usually sit on one)
   "boxes": [{"x0", "top", "x1", "bottom"}]}           small squares, 6 to 20 pt (usually checkboxes)
in PDF points with the origin at the TOP left of the page as it is shown (also when it is turned with
/Rotate), the coordinates place_text.py takes. "has_text" false means the pages are images (a scan):
look at them instead.

Written for OpenLen (spec local 2026-10-27-len-pdf-skill), with pdfplumber.
"""
import json
import os
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from form_fields import fail, open_pdf  # noqa: E402

JOIN_GAP = 6  # points between two words of the same label
SAME_LINE = 2  # points of difference in `top` within one line


def labels_of(page):
    words = sorted(page.extract_words(), key=lambda w: (round(w["top"]), w["x0"]))
    labels = []
    for w in words:
        last = labels[-1] if labels else None
        if last and abs(w["top"] - last["top"]) <= SAME_LINE and 0 <= w["x0"] - last["x1"] <= JOIN_GAP:
            last["text"] += " " + w["text"]
            last["x1"] = w["x1"]
            last["bottom"] = max(last["bottom"], w["bottom"])
        else:
            labels.append({"text": w["text"], "x0": w["x0"], "top": w["top"], "x1": w["x1"], "bottom": w["bottom"]})
    return [{k: round(v, 1) if isinstance(v, float) else v for k, v in label.items()} for label in labels]


def lines_of(page):
    out = []
    for line in page.lines:
        if abs(line["top"] - line["bottom"]) < 1 and line["x1"] - line["x0"] > 10:
            out.append({"x0": round(line["x0"], 1), "x1": round(line["x1"], 1), "y": round(line["top"], 1)})
    for rect in page.rects:  # a rule drawn as a thin rectangle
        if rect["height"] < 1.5 and rect["width"] > 10:
            out.append({"x0": round(rect["x0"], 1), "x1": round(rect["x1"], 1), "y": round(rect["top"], 1)})
    return sorted(out, key=lambda l: (l["y"], l["x0"]))


def boxes_of(page):
    out = []
    for rect in page.rects:
        w, h = rect["width"], rect["height"]
        if 6 <= w <= 20 and 6 <= h <= 20 and abs(w - h) <= 3:
            out.append({"x0": round(rect["x0"], 1), "top": round(rect["top"], 1), "x1": round(rect["x1"], 1), "bottom": round(rect["bottom"], 1)})
    return out


def main():
    if len(sys.argv) != 2:
        fail(1, "Usage: python3 form_layout.py <in.pdf>")
    path = sys.argv[1]
    reader = open_pdf(path)  # the same answer as the other scripts for a file that cannot be opened
    pages, has_text = [], False
    with pdfplumber.open(path) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            has_text = has_text or bool(page.chars)
            # pdfplumber gives the words and rules of a turned page (/Rotate) as it is shown, but its
            # width and height as stored: a page turned 90° or 270° is shown with them swapped.
            width, height = float(page.width), float(page.height)
            if reader.pages[number - 1].rotation % 180:
                width, height = height, width
            pages.append({
                "page": number,
                "width": round(width, 1),
                "height": round(height, 1),
                "labels": labels_of(page),
                "lines": lines_of(page),
                "boxes": boxes_of(page),
            })
    print(json.dumps({"pages": pages, "has_text": has_text}, ensure_ascii=False))


if __name__ == "__main__":
    main()
