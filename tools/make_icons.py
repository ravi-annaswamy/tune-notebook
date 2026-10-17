"""Generate the app icons (PNG) with Pillow. Run: python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 4  # supersampling factor for smooth edges


def draw_icon(size, maskable=False):
    s = size * SS
    img = Image.new("RGB", (s, s), (16, 18, 23))
    d = ImageDraw.Draw(img)
    # subtle vertical gradient background
    for y in range(s):
        t = y / s
        d.line([(0, y), (s, y)], fill=(int(22 + 10 * t), int(24 + 6 * t), int(34 + 14 * t)))
    # coral disc (kept inside the maskable safe zone, radius 0.40)
    r = s * (0.34 if maskable else 0.40)
    c = s / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=(255, 77, 85))
    # eighth note in white
    k = r / 0.40 / s  # scale relative to the full-size design
    def P(x, y):
        return (c + (x - 0.5) * s * k, c + (y - 0.5) * s * k)
    w = (255, 255, 255)
    # note head (tilted ellipse approximated by a polygon)
    import math
    hx, hy, ra, rb, ang = 0.45, 0.64, 0.085, 0.060, -0.45
    pts = []
    for i in range(64):
        a = 2 * math.pi * i / 64
        x = ra * math.cos(a)
        y = rb * math.sin(a)
        pts.append(P(hx + x * math.cos(ang) - y * math.sin(ang), hy + x * math.sin(ang) + y * math.cos(ang)))
    d.polygon(pts, fill=w)
    # stem
    d.polygon([P(0.515, 0.62), P(0.545, 0.62), P(0.545, 0.27), P(0.515, 0.27)], fill=w)
    # flag
    flag = [P(0.545, 0.27)]
    for i in range(1, 21):
        t = i / 20
        flag.append(P(0.545 + 0.13 * math.sin(t * math.pi * 0.9), 0.27 + 0.20 * t))
    for i in range(20, -1, -1):
        t = i / 20
        flag.append(P(0.545 + 0.09 * math.sin(t * math.pi * 0.9), 0.34 + 0.12 * t))
    d.polygon(flag, fill=w)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    draw_icon(192).save(OUT / "icon-192.png")
    draw_icon(512).save(OUT / "icon-512.png")
    draw_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    draw_icon(180).save(OUT / "apple-touch-icon.png")
    print("icons written to", OUT)
