#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Generate the PWA icons (Schulte blue field, white document mark).

    python scripts/make_icons.py

Writes app/icons/icon-192.png, icon-512.png and apple-touch-icon.png.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "icons"
BLUE = (31, 31, 175, 255)
WHITE = (255, 255, 255, 255)


def draw(size: int) -> Image.Image:
    im = Image.new("RGBA", (size, size), BLUE)
    d = ImageDraw.Draw(im)
    s = size / 100.0

    # document sheet
    x0, y0, x1, y1 = 28 * s, 20 * s, 72 * s, 80 * s
    d.rounded_rectangle([x0, y0, x1, y1], radius=5 * s, fill=WHITE)

    # folded corner
    d.polygon([(x1 - 14 * s, y0), (x1, y0 + 14 * s), (x1 - 14 * s, y0 + 14 * s)], fill=(216, 220, 245, 255))

    # text lines
    for i, w in enumerate((30, 30, 22)):
        yy = 34 * s + i * 9 * s
        d.rounded_rectangle([34 * s, yy, (34 + w) * s, yy + 3.2 * s], radius=1.6 * s, fill=BLUE)

    # magnifier - "inspection"
    cx, cy, r = 66 * s, 64 * s, 11 * s
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=max(2, int(3 * s)))
    d.line([cx + r * 0.72, cy + r * 0.72, cx + r * 1.75, cy + r * 1.75], fill=WHITE, width=max(2, int(4 * s)))
    return im


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
        im = draw(size)
        if name == "apple-touch-icon.png":
            im = im.convert("RGB")
        im.save(OUT / name, "PNG")
        print("wrote", OUT / name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
