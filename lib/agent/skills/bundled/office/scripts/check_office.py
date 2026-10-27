#!/usr/bin/env python3
"""Check an Office file's package: the ZIP, every XML part, and every internal relationship.

Usage: python3 check_office.py <file.docx|file.xlsx|file.pptx>
Prints one JSON object: {"ok": bool, "file": str, "parts": int, "errors": [str, ...]}.
Only the standard library. It reports the package's integrity, not how the document renders.
"""
import json
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET

REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def check(path):
    errors = []
    try:
        z = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as e:
        return {"ok": False, "file": path, "parts": 0, "errors": [f"not a readable ZIP package: {e}"]}
    with z:
        names = z.namelist()
        present = set(names)
        if len(names) != len(present):
            errors.append("duplicate part names: the package was appended to instead of rewritten")
        if "[Content_Types].xml" not in present:
            errors.append("missing [Content_Types].xml")
        for info in z.infolist():
            if info.flag_bits & 0x1:
                errors.append(f"{info.filename}: encrypted part")
                continue
            if not (info.filename.endswith(".xml") or info.filename.endswith(".rels")):
                continue
            try:
                data = z.read(info.filename)
                root = ET.fromstring(data)
            except (zipfile.BadZipFile, ET.ParseError, RuntimeError) as e:
                errors.append(f"{info.filename}: invalid XML ({e})")
                continue
            if not info.filename.endswith(".rels"):
                continue
            # word/_rels/document.xml.rels -> targets resolve against word/
            folder = posixpath.dirname(posixpath.dirname(info.filename))
            for rel in root.iter(f"{REL_NS}Relationship"):
                if rel.get("TargetMode") == "External":
                    continue
                target = rel.get("Target") or ""
                resolved = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(folder, target))
                if resolved not in present:
                    errors.append(f"{info.filename}: relationship {rel.get('Id')} points to missing part {resolved}")
    return {"ok": not errors, "file": path, "parts": len(present), "errors": errors}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "errors": ["usage: check_office.py <file>"]}))
        sys.exit(2)
    result = check(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 1)
