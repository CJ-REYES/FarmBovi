"""Regenerate the PWA PNG icons from FarmBovi's geometric cow mark.

Optional development tool: python3 -m pip install Pillow
Run from any directory: python3 scripts/generate-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parents[1] / "FrontEnd" / "public"


def make_icon(size: int, maskable: bool = False) -> Image.Image:
    scale = 4
    image = Image.new("RGB", (size * scale, size * scale), "#245c45")
    draw = ImageDraw.Draw(image)
    # All meaningful strokes remain inside the maskable central safe circle.
    factor = size * scale / 128 * (0.78 if maskable else 1)
    offset = size * scale * (0.11 if maskable else 0)

    def points(values):
        return [(round(x * factor + offset), round(y * factor + offset)) for x, y in values]

    def line(values):
        draw.line(points(values), fill="white", width=round(7 * factor), joint="curve")
        for x, y in points([values[0], values[-1]]):
            r = 3.5 * factor
            draw.ellipse((x-r, y-r, x+r, y+r), fill="white")

    line([(47, 43), (36, 40), (28, 33), (26, 25)])
    line([(81, 43), (92, 40), (100, 33), (102, 25)])
    line([(44, 48), (25, 43), (30, 63), (47, 66)])
    line([(81, 48), (103, 43), (98, 63), (81, 66)])
    line([(46, 43), (82, 43), (86, 80), (76, 102), (52, 102), (42, 80), (46, 43)])
    draw.rounded_rectangle([points([(48, 78)])[0], points([(80, 98)])[0]], radius=round(8 * factor), fill="#e8b24d")
    for x, y, radius in [(54, 63, 3), (74, 63, 3), (57, 87, 2), (71, 87, 2)]:
        cx, cy = points([(x, y)])[0]
        r = radius * factor
        draw.ellipse((cx-r, cy-r, cx+r, cy+r), fill="#245c45")
    return image.resize((size, size), Image.Resampling.LANCZOS)


(PUBLIC / "icons").mkdir(parents=True, exist_ok=True)
for name, size, maskable in [
    ("icons/pwa-192.png", 192, False),
    ("icons/pwa-512.png", 512, False),
    ("icons/pwa-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, False),
]:
    make_icon(size, maskable).save(PUBLIC / name)
    print(f"Created {name} ({size}x{size})")
