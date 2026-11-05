#!/usr/bin/env python3
"""Join frames of a page in motion into ONE image Len can Read (Len's verify skill, "When it moves").

Usage: python3 contact_sheet.py --out <sheet.png> [--label "<text>" ...] <frame.png> [<frame.png> ...]
       python3 contact_sheet.py --out <sheet.png> [--label "<text>" ...] <folder>

A folder means its .png files, by name. Up to 12 frames, in up to 4 columns, every cell the size and
shape of the first frame scaled to fit; under each cell a strip with its number (#1, #2, ...) and its
label when one is given: one --label per frame, in the same order (for example the time and the key:
"t=400ms ArrowRight"). The sheet is at most 1708 px wide: the widest edge DeepSeek V4.1 (Len's model)
keeps for a 16:9 image on its token grid, so Read sends it with the detail the model can use.

Prints the sheet's path and size. Exits 1 with the reason on stderr, writing nothing, when there are
no frames or more than 12, a file isn't an image, the labels don't match the frames, or the arguments
are wrong (a missing --out included).

Written for OpenLen (spec local 2026-11-05-ojos-que-ven-el-movimiento, §8.3): Kimi Code reads video;
this model reads images, so the frames go together in one. With Pillow.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

MAX_FRAMES = 12
MAX_COLUMNS = 4
MAX_WIDTH = 1708
STRIP = 22
GAP = 4
FONT_FILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def fail(reason):
    print(reason, file=sys.stderr)
    sys.exit(1)


def frames_of(paths):
    if len(paths) == 1 and os.path.isdir(paths[0]):
        folder = paths[0]
        return [os.path.join(folder, n) for n in sorted(os.listdir(folder)) if n.lower().endswith(".png")]
    return paths


def font():
    try:
        return ImageFont.truetype(FONT_FILE, 13)
    except OSError:
        return ImageFont.load_default()


class Parser(argparse.ArgumentParser):
    """Wrong arguments exit 1 with the reason, like every other refusal of this script (argparse uses 2)."""

    def error(self, message):
        fail(f"{message}. Usage: contact_sheet.py --out <sheet.png> [--label <text> ...] <frame.png> [...] | <folder>")


def main():
    parser = Parser(description="Join frames into one image.")
    parser.add_argument("--out", required=True, help="the sheet to write (.png)")
    parser.add_argument("--label", action="append", default=[], help="one per frame, in order")
    parser.add_argument("frames", nargs="+", help="the frames, or one folder of .png files")
    args = parser.parse_args()

    paths = frames_of(args.frames)
    if not paths:
        fail("No frames: give .png files, or a folder that has some.")
    if len(paths) > MAX_FRAMES:
        fail(f"{len(paths)} frames: at most {MAX_FRAMES} fit in one sheet. Take fewer, or make two sheets.")
    if args.label and len(args.label) != len(paths):
        fail(f"{len(args.label)} labels for {len(paths)} frames: give one --label per frame, or none.")

    images = []
    for p in paths:
        try:
            with Image.open(p) as im:
                images.append(im.convert("RGB"))
        except (OSError, ValueError) as e:
            fail(f"{p} isn't an image Pillow can open: {e}")

    columns = min(MAX_COLUMNS, len(images))
    rows = (len(images) + columns - 1) // columns
    first_w, first_h = images[0].size
    cell_w = (MAX_WIDTH - GAP * (columns - 1)) // columns
    cell_w = min(cell_w, first_w)
    cell_h = max(1, round(first_h * cell_w / first_w))
    sheet_w = cell_w * columns + GAP * (columns - 1)
    sheet_h = (cell_h + STRIP) * rows + GAP * (rows - 1)

    sheet = Image.new("RGB", (sheet_w, sheet_h), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    f = font()
    for i, im in enumerate(images):
        col, row = i % columns, i // columns
        x = col * (cell_w + GAP)
        y = row * (cell_h + STRIP + GAP)
        fitted = im.copy()
        fitted.thumbnail((cell_w, cell_h))
        sheet.paste(fitted, (x + (cell_w - fitted.width) // 2, y + (cell_h - fitted.height) // 2))
        draw.rectangle([x, y + cell_h, x + cell_w - 1, y + cell_h + STRIP - 1], fill=(30, 30, 30))
        text = f"#{i + 1}" + (f"  {args.label[i]}" if args.label else "")
        draw.text((x + 6, y + cell_h + 4), text, fill=(255, 255, 255), font=f)

    sheet.save(args.out, "PNG")
    print(f"{args.out} ({sheet_w}x{sheet_h}, {len(images)} frames)")


if __name__ == "__main__":
    main()
