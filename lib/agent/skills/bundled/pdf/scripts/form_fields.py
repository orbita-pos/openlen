#!/usr/bin/env python3
"""The fillable fields of a PDF form, as JSON (Len's pdf skill, forms.md step 1).

Usage: python3 form_fields.py <in.pdf>

Prints {"fillable": bool, "fields": [field]}. A field is
  {"id": str, "page": int (from 1), "rect": [x0, y0, x1, y1], "type": "text"|"checkbox"|"radio"|"choice",
   "value": str|null}
with "rect" in PDF points, origin at the bottom left. A checkbox also has "on" (its checked value);
a radio group and a choice have "options".

Exit codes, shared by the skill's scripts: 0 done; 1 wrong input (the reason on stderr, nothing
written); 2 the PDF cannot be opened (an encrypted one says so).

Written for OpenLen (spec local 2026-10-27-len-pdf-skill), with pypdf.
"""
import json
import sys

from pypdf import PdfReader
from pypdf.generic import ArrayObject, NameObject

PUSHBUTTON = 1 << 16
RADIO = 1 << 15


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def open_pdf(path):
    """A reader for the PDF, or exit 2. An encrypted PDF opens only without a user password."""
    try:
        reader = PdfReader(path)
    except Exception as e:  # noqa: BLE001 - any parser error means "cannot be opened"
        fail(2, f"Cannot open {path}: {e}")
    if reader.is_encrypted:
        try:
            opened = reader.decrypt("")
        except Exception:  # noqa: BLE001
            opened = 0
        if not opened:
            fail(2, f"{path} is encrypted: ask the user for its password and remove it first.")
    return reader


def _text(value):
    if value is None:
        return None
    value = value.get_object()  # a value written through a reference reads like a direct one
    if isinstance(value, NameObject):
        return str(value)[1:]
    if isinstance(value, ArrayObject):
        return ", ".join(_text(v.get_object()) or "" for v in value)
    return str(value)


def _inherited(obj, key):
    while obj is not None:
        if key in obj:
            return obj[key]
        obj = obj["/Parent"].get_object() if "/Parent" in obj else None
    return None


def _name(obj):
    parts = []
    while obj is not None:
        if "/T" in obj:
            parts.insert(0, str(obj["/T"]))
        obj = obj["/Parent"].get_object() if "/Parent" in obj else None
    return ".".join(parts)


def _on_state(widget):
    states = widget.get("/AP", {}).get("/N", {})
    for key in getattr(states, "keys", lambda: [])():
        if key != "/Off":
            return key[1:]
    return None


def _options(field):
    out = []
    for item in field.get("/Opt", []) or []:
        item = item.get_object()
        out.append(str(item[0].get_object()) if isinstance(item, ArrayObject) else str(item))
    return out


def collect_fields(reader):
    """Every field with its widgets, by its full name, in page order."""
    fields = {}
    for page_number, page in enumerate(reader.pages, start=1):
        for ref in page.get("/Annots") or []:
            widget = ref.get_object()
            if widget.get("/Subtype") != "/Widget":
                continue
            field = widget if "/T" in widget else widget["/Parent"].get_object() if "/Parent" in widget else widget
            name = _name(field)
            kind = _inherited(field, "/FT")
            flags = int(_inherited(field, "/Ff") or 0)
            if not name or kind not in ("/Tx", "/Btn", "/Ch") or (kind == "/Btn" and flags & PUSHBUTTON):
                continue
            rect = [round(float(v), 1) for v in widget["/Rect"]]
            if kind == "/Btn" and flags & RADIO:
                entry = fields.setdefault(name, {"id": name, "page": page_number, "rect": rect, "type": "radio", "value": _text(field.get("/V")), "options": []})
                entry["rect"] = [min(entry["rect"][0], rect[0]), min(entry["rect"][1], rect[1]), max(entry["rect"][2], rect[2]), max(entry["rect"][3], rect[3])]
                on = _on_state(widget)
                if on and on not in entry["options"]:
                    entry["options"].append(on)
            elif name not in fields:
                entry = {"id": name, "page": page_number, "rect": rect, "value": _text(field.get("/V"))}
                if kind == "/Tx":
                    entry["type"] = "text"
                elif kind == "/Btn":
                    entry["type"] = "checkbox"
                    entry["on"] = _on_state(widget) or "Yes"
                else:
                    entry["type"] = "choice"
                    entry["options"] = _options(field)
                fields[name] = entry
    return list(fields.values())


def main():
    if len(sys.argv) != 2:
        fail(1, "Usage: python3 form_fields.py <in.pdf>")
    fields = collect_fields(open_pdf(sys.argv[1]))
    print(json.dumps({"fillable": bool(fields), "fields": fields}, ensure_ascii=False))


if __name__ == "__main__":
    main()
