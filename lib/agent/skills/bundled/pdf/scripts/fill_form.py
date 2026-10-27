#!/usr/bin/env python3
"""Fill the fields of a PDF form (Len's pdf skill, forms.md step 2).

Usage: python3 fill_form.py <in.pdf> <values.json> <out.pdf>

values.json is {"<field id>": value}, with the ids form_fields.py prints. A text field takes a
string; a checkbox takes true or false (or its "on" value, or "Off"); a radio group or a choice
takes one of its "options". Every id and value is checked before anything is written: on a wrong
one it exits 1, says which and what is valid, and writes nothing.

Written for OpenLen (spec local 2026-10-27-len-pdf-skill), with pypdf.
"""
import json
import os
import sys

from pypdf import PdfWriter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from form_fields import collect_fields, fail, open_pdf  # noqa: E402


def _state(value):
    return value[1:] if isinstance(value, str) and value.startswith("/") else value


def resolve(fields, values):
    """The value each field gets, as pypdf writes it, or the list of what is wrong."""
    by_id = {f["id"]: f for f in fields}
    errors, out = [], {}
    for key, value in values.items():
        field = by_id.get(key)
        if field is None:
            errors.append(f"unknown field {key!r}; the fields are: {', '.join(by_id) or 'none'}")
            continue
        kind = field["type"]
        if kind == "text":
            if not isinstance(value, str):
                errors.append(f"{key!r} is a text field: give it a string")
                continue
            out[key] = value
        elif kind == "checkbox":
            on = field["on"]
            if value is True or _state(value) == on:
                out[key] = "/" + on
            elif value is False or _state(value) == "Off":
                out[key] = "/Off"
            else:
                errors.append(f"{key!r} is a checkbox: give it true, false, {on!r} or 'Off'")
        else:
            options = field["options"]
            if _state(value) not in options:
                errors.append(f"{key!r} takes one of {options}, not {value!r}")
                continue
            out[key] = "/" + _state(value) if kind == "radio" else _state(value)
    return out, errors


def main():
    if len(sys.argv) != 4:
        fail(1, "Usage: python3 fill_form.py <in.pdf> <values.json> <out.pdf>")
    source, values_path, target = sys.argv[1:]
    if os.path.abspath(source) == os.path.abspath(target):
        fail(1, "Write the filled form to a new file, not over the original.")
    reader = open_pdf(source)
    try:
        with open(values_path, encoding="utf-8") as f:
            values = json.load(f)
    except (OSError, ValueError) as e:
        fail(1, f"Cannot read {values_path}: {e}")
    if not isinstance(values, dict) or not values:
        fail(1, f"{values_path} must be an object of field ids and values.")
    fields = collect_fields(reader)
    if not fields:
        fail(1, f"{source} has no fillable fields: use form_layout.py and place_text.py.")
    resolved, errors = resolve(fields, values)
    if errors:
        fail(1, "\n".join(errors))
    writer = PdfWriter(clone_from=reader)
    for page in writer.pages:
        writer.update_page_form_field_values(page, resolved, auto_regenerate=True)
    try:
        with open(target, "wb") as f:
            writer.write(f)
    except Exception:
        if os.path.exists(target):
            os.remove(target)
        raise
    print(f"filled {len(resolved)} fields -> {target}")


if __name__ == "__main__":
    main()
