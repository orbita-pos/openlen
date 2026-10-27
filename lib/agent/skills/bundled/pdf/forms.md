# Filling a PDF form

Work in `/tmp/office`. The scripts are in `scripts/`, relative to this skill's base directory. Each one prints its result; exits 1 with the reason on stderr when its input is wrong, and then writes nothing; and exits 2 when the PDF cannot be opened. An encrypted PDF says so: ask the user for its password and remove it first (see `SKILL.md`).

## 1. Does it have fields?

```text
python3 <base directory>/scripts/form_fields.py "<form.pdf>"
```

It prints `{"fillable": true|false, "fields": [...]}`. Each field has `id`, `page` (from 1), `rect` (`[x0, y0, x1, y1]` in PDF points, origin at the bottom left), `type` (`text`, `checkbox`, `radio`, or `choice`), and `value`. A checkbox also has `on`, its checked value; a radio group and a choice have `options`.

## 2. With fields

Look at the pages with `Read` and `pages` to know what each field asks for. Write `/tmp/office/values.json`, one entry per field to fill:

```json
{"name": "Ana Núñez", "agree": true, "size": "M"}
```

A checkbox takes `true` or `false` (or its `on` value); a radio group or a choice takes one of its `options`. Then:

```text
python3 <base directory>/scripts/fill_form.py "<form.pdf>" /tmp/office/values.json "/tmp/office/<filled>.pdf"
```

It checks every id and every value before writing anything. Fix what it reports and run it again.

## 3. Without fields

```text
python3 <base directory>/scripts/form_layout.py "<form.pdf>"
```

For each page it prints `width`, `height`, `labels` (text with `x0`, `top`, `x1`, `bottom`), `lines` (horizontal rules with `x0`, `x1`, `y`), and `boxes` (small squares, usually checkboxes), in PDF points with the origin at the top left. `has_text` says whether the PDF has any text at all.

When `has_text` is true, place each answer from that structure: an answer starts a few points after its label (`x0` = the label's `x1` + 4) and sits just above the line under it; a checkbox answer is an `X` inside its box.

When `has_text` is false, the page is an image. Look at it with `Read`. To be precise:
- render the page: `pdftoppm -r 150 -png -f <n> -l <n> -singlefile "<form.pdf>" /tmp/office/page`;
- crop around each answer with Pillow into `/tmp/office/crop-<n>.png` and look at the crop with `Read`;
- add the crop's offset back to what you measure in it.

Coordinates measured on that render are its pixels: say so in `images`, with the render's size.

Write `/tmp/office/fields.json`. `box` is `[x0, top, x1, bottom]`, and `size` is the font size (10 when left out):

```json
{"fields": [{"page": 1, "box": [112, 62, 318, 75], "text": "Smith", "size": 10}],
 "images": [{"page": 1, "width": 1275, "height": 1650}]}
```

Leave `images` out when every box is in PDF points. Then:

```text
python3 <base directory>/scripts/place_text.py "<form.pdf>" /tmp/office/fields.json "/tmp/office/<filled>.pdf"
```

It refuses boxes that overlap and text that does not fit its box at that size: make the box bigger or the size smaller. It picks the font for Japanese, Korean, or Chinese text by itself.

## 4. Check

Read the filled PDF with `Read` and `pages`, and check that every answer is in its place before delivering it with `present`.
