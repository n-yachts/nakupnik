"""
Vytvoří ikony aplikace do icons/ (nákupní košík).

    pip install pillow
    python tools/icons.py

icon-192/512.png  – běžné ikony (zaoblený čtverec)
maskable-512.png  – ikona pro Android (celoplošné pozadí, motiv v bezpečné zóně)
apple-touch-icon.png (180 px), favicon-32.png
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
BG = (47, 125, 79)        # zelená Nákupníku
WHITE = (255, 255, 255)
DARK = (18, 58, 36)
ORANGE = (244, 163, 64)
RED = (232, 99, 74)
SS = 4                    # převzorkování kvůli hladkým hranám


def draw_icon(size, maskable=False, rounded=True):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, S, S], fill=BG)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)

    # Motiv kreslíme v souřadnicích 0–1; u maskable ikony ho zmenšíme do bezpečné zóny (80 %).
    scale = 0.9 if maskable else 1.0
    off = (1 - scale) / 2

    def P(x, y):
        return (int((off + x * scale) * S), int((off + y * scale) * S))

    def R(x0, y0, x1, y1, r, fill):
        a, b = P(x0, y0), P(x1, y1)
        d.rounded_rectangle([a, b], radius=int(r * scale * S), fill=fill)

    def C(x, y, r, fill):
        cx, cy = P(x, y)
        rr = int(r * scale * S)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill)

    w = int(0.05 * scale * S)
    C(0.47, 0.37, 0.095, ORANGE)                           # nákup v košíku
    C(0.64, 0.35, 0.085, RED)
    d.polygon([P(0.27, 0.40), P(0.82, 0.40), P(0.75, 0.66), P(0.34, 0.66)], fill=WHITE)  # košík
    for x in (0.44, 0.55, 0.66):                           # pruhy košíku
        d.line([P(x, 0.44), P(x - 0.01, 0.62)], fill=(214, 228, 219), width=int(w * 0.45))
    d.line([P(0.14, 0.28), P(0.24, 0.28), P(0.35, 0.72), P(0.76, 0.72)], fill=DARK, width=w, joint='curve')  # rukojeť a rám
    C(0.40, 0.80, 0.055, DARK)                             # kolečka
    C(0.71, 0.80, 0.055, DARK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    draw_icon(192).save(os.path.join(OUT, 'icon-192.png'))
    draw_icon(512).save(os.path.join(OUT, 'icon-512.png'))
    draw_icon(512, maskable=True).save(os.path.join(OUT, 'maskable-512.png'))
    draw_icon(180, rounded=False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
    draw_icon(32).save(os.path.join(OUT, 'favicon-32.png'))
    print('Ikony uloženy do', OUT)


if __name__ == '__main__':
    main()
