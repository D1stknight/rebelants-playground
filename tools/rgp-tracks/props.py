#!/usr/bin/env python3
"""Rebel Grand Prix billboard props + item sprites → public/rgp/props.png (64x64 frames, 8 per row).
Frame ids are shared with components/RebelGP/engine.ts (PROP)."""
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bounty-sprites"))
from px import Canvas, shade, sheet
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "rgp", "props.png")
F = 64
def c(): return Canvas(F, F)

def tree(col=(40, 120, 60), trunk=(90, 60, 40)):
    k = c(); k.rect(29, 40, 6, 22, trunk); k.rect(31, 40, 2, 22, shade(trunk, 0.7))
    for (x, y, w, h, s) in ((14, 18, 36, 28, 1.0), (10, 26, 44, 20, 0.85), (20, 8, 24, 22, 1.15)):
        k.ell(x, y, w, h, shade(col, s))
    k.ell(24, 12, 10, 8, shade(col, 1.4)); return k.outline()
def rock(col=(120, 120, 130)):
    k = c(); k.poly([(8, 58), (14, 36), (26, 24), (44, 26), (56, 42), (56, 58)], col); k.poly([(14, 36), (26, 24), (44, 26), (40, 40), (20, 44)], shade(col, 1.3)); k.poly([(40, 40), (56, 42), (56, 58), (30, 58)], shade(col, 0.7)); return k.outline()
def mushroom():
    k = c(); k.rect(26, 36, 12, 24, (230, 220, 200)); k.rect(26, 36, 4, 24, (190, 175, 150)); k.ell(10, 16, 44, 28, (200, 50, 60)); k.ell(10, 16, 44, 16, (230, 80, 80))
    for (x, y) in ((18, 22), (34, 18), (44, 28), (26, 30)): k.ell(x, y, 7, 6, (255, 240, 230))
    return k.outline()
def pipe():
    k = c(); k.rect(18, 8, 28, 52, (90, 100, 110)); k.rect(18, 8, 8, 52, (130, 140, 150)); k.rect(14, 8, 36, 10, (110, 120, 130)); k.rect(14, 8, 36, 3, (150, 160, 170)); k.ell(22, 46, 20, 12, (60, 150, 50)); k.rect(30, 48, 6, 14, (90, 200, 80)); return k.outline()
def barrel():
    k = c(); k.rect(16, 14, 32, 46, (100, 80, 50)); k.rect(16, 14, 8, 46, (130, 105, 65)); k.rect(14, 22, 36, 5, (60, 60, 70)); k.rect(14, 44, 36, 5, (60, 60, 70)); k.ell(16, 8, 32, 12, (120, 95, 60)); k.ell(22, 28, 12, 10, (90, 200, 80)); return k.outline()
def torch():
    k = c(); k.rect(29, 28, 6, 34, (90, 70, 50)); k.rect(25, 24, 14, 8, (60, 60, 70)); k.ell(22, 6, 20, 22, (255, 120, 30)); k.ell(26, 10, 12, 14, (255, 210, 80)); k.ell(29, 14, 6, 8, (255, 255, 220)); return k.outline()
def pillar():
    k = c(); k.rect(22, 6, 20, 56, (130, 120, 110)); k.rect(22, 6, 6, 56, (170, 160, 150)); k.rect(16, 4, 32, 8, (150, 140, 130)); k.rect(16, 54, 32, 8, (110, 100, 90)); k.rect(30, 20, 4, 30, (90, 80, 70)); return k.outline()
def crystal(col=(200, 80, 240)):
    k = c(); k.poly([(32, 4), (46, 30), (40, 60), (24, 60), (18, 30)], col); k.poly([(32, 4), (40, 32), (32, 60), (24, 32)], shade(col, 1.35)); k.poly([(12, 40), (20, 30), (24, 60), (10, 58)], shade(col, 0.8)); k.poly([(52, 44), (46, 32), (40, 60), (54, 60)], shade(col, 0.75)); return k.outline()
def egg():
    k = c(); k.ell(16, 8, 32, 52, (220, 200, 230)); k.ell(20, 12, 16, 22, (245, 235, 250)); k.ell(28, 34, 14, 12, (150, 60, 170)); k.ell(32, 38, 6, 5, (240, 120, 255)); return k.outline()
def flower():
    k = c(); k.rect(30, 34, 4, 28, (60, 140, 60)); k.ell(20, 44, 12, 8, (70, 160, 70)); k.ell(32, 48, 12, 8, (70, 160, 70))
    for a in range(6):
        x = 32 + 12 * math.cos(a * math.pi / 3); y = 22 + 12 * math.sin(a * math.pi / 3); k.ell(x - 8, y - 8, 16, 16, (255, 100, 140))
    k.ell(24, 14, 16, 16, (255, 230, 80)); return k.outline()
def fence():
    k = c()
    for x in (8, 30, 52): k.rect(x, 22, 6, 40, (200, 200, 210)); k.poly([(x, 22), (x + 3, 16), (x + 6, 22)], (200, 200, 210))
    k.rect(4, 30, 58, 5, (230, 230, 240)); k.rect(4, 46, 58, 5, (230, 230, 240)); return k.outline()
def itembox():
    k = c(); col = (255, 200, 60)
    k.poly([(32, 6), (58, 22), (58, 46), (32, 60), (6, 46), (6, 22)], col); k.poly([(32, 6), (58, 22), (32, 34), (6, 22)], shade(col, 1.3)); k.poly([(32, 34), (58, 22), (58, 46), (32, 60)], shade(col, 0.75))
    k.rect(28, 24, 8, 8, (40, 30, 20)); k.rect(30, 36, 4, 12, (40, 30, 20)); return k.outline()
def slick():
    k = c(); k.ell(6, 34, 52, 24, (240, 170, 30)); k.ell(14, 38, 30, 12, (255, 210, 80)); k.ell(38, 42, 14, 8, (255, 230, 120)); k.ell(22, 26, 16, 14, (240, 170, 30)); return k.outline()
def shell():
    k = c(); k.ell(12, 20, 40, 34, (60, 180, 50)); k.ell(18, 24, 20, 14, (120, 230, 90)); k.rect(8, 44, 48, 8, (200, 220, 200)); k.rect(8, 50, 48, 4, (140, 160, 140))
    for x in (16, 30, 44): k.rect(x, 24, 4, 20, (30, 110, 30))
    return k.outline()
def spider():
    k = c(); col = (60, 40, 70)
    for s in (-1, 1):
        for i, (dx, dy) in enumerate(((10, 14), (14, 6), (14, -4), (10, -12))): k.line(32, 36, 32 + s * (dx + 12), 36 + dy + 10, col, 3); k.line(32 + s * (dx + 12), 36 + dy + 10, 32 + s * (dx + 20), 36 + dy + 20, col, 3)
    k.ell(18, 24, 28, 26, (90, 60, 110)); k.ell(24, 14, 16, 16, (70, 45, 85)); k.ell(26, 18, 4, 4, (255, 60, 60)); k.ell(34, 18, 4, 4, (255, 60, 60)); k.ell(24, 30, 16, 12, (200, 60, 90)); return k.outline()
def boulder():
    k = c(); k.ell(6, 8, 52, 52, (120, 110, 100)); k.ell(14, 14, 24, 20, (160, 150, 140)); k.ell(30, 34, 20, 18, (90, 80, 70)); k.ell(20, 40, 10, 8, (100, 90, 80)); return k.outline()
def crusher():
    k = c(); k.rect(8, 4, 48, 8, (70, 70, 80)); k.rect(28, 10, 8, 14, (110, 110, 120)); k.rect(6, 22, 52, 38, (140, 130, 120)); k.rect(6, 22, 52, 8, (180, 170, 160)); k.rect(6, 52, 52, 8, (90, 80, 70))
    for x in (12, 30, 48): k.poly([(x, 60), (x + 4, 64), (x - 4, 64)], (200, 60, 60))
    return k.outline()
def geyser():
    k = c(); k.ell(8, 48, 48, 14, (255, 120, 40)); k.poly([(20, 56), (32, 4), (44, 56)], (255, 150, 50)); k.poly([(26, 56), (32, 14), (38, 56)], (255, 230, 120)); k.ell(14, 20, 10, 14, (255, 160, 60)); k.ell(42, 26, 10, 14, (255, 160, 60)); return k.outline()
def wasp():
    k = c(); k.ell(14, 8, 18, 24, (220, 230, 240)); k.ell(32, 8, 18, 24, (220, 230, 240)); k.ell(18, 28, 28, 24, (240, 200, 40)); k.rect(18, 34, 28, 4, (40, 30, 20)); k.rect(18, 42, 28, 4, (40, 30, 20)); k.ell(22, 18, 20, 16, (60, 50, 40)); k.ell(24, 22, 5, 5, (255, 60, 60)); k.ell(35, 22, 5, 5, (255, 60, 60)); k.poly([(28, 52), (36, 52), (32, 62)], (40, 30, 20)); return k.outline()
def wrath():
    k = c(); k.poly([(10, 34), (18, 12), (26, 26), (32, 6), (38, 26), (46, 12), (54, 34)], (255, 200, 40)); k.rect(10, 34, 44, 8, (255, 220, 80)); k.ell(18, 36, 28, 26, (240, 240, 250)); k.rect(24, 46, 6, 8, (20, 10, 30)); k.rect(34, 46, 6, 8, (20, 10, 30)); k.rect(28, 56, 8, 4, (20, 10, 30))
    for (x, y) in ((16, 38), (32, 34), (48, 38)): k.ell(x - 3, y - 3, 6, 6, (255, 60, 200))
    return k.outline()
def spore():
    k = c()
    for (x, y, r, s) in ((10, 26, 26, 0.8), (26, 14, 30, 1.0), (32, 30, 28, 0.9), (14, 38, 22, 0.75)): k.ell(x, y, r, r, shade((150, 90, 200), s))
    for (x, y) in ((20, 30), (36, 24), (30, 42)): k.ell(x, y, 8, 8, (210, 160, 255))
    return k.outline()
def shield():
    k = c(); k.ell(6, 6, 52, 52, (90, 180, 255)); k.ell(12, 12, 40, 40, (150, 210, 255)); k.ell(18, 14, 14, 10, (240, 250, 255)); return k.outline((60, 120, 200, 255))
def star():
    k = c(); pts = []
    for i in range(10): a = -math.pi / 2 + i * math.pi / 5; r = 28 if i % 2 == 0 else 12; pts.append((32 + r * math.cos(a), 32 + r * math.sin(a)))
    k.poly(pts, (255, 230, 80)); k.ell(24, 24, 16, 16, (255, 255, 220)); return k.outline()
def puff():
    k = c(); k.ell(8, 20, 30, 30, (200, 200, 210)); k.ell(26, 14, 30, 30, (230, 230, 240)); k.ell(20, 32, 26, 24, (180, 180, 190)); return k.outline((120, 120, 130, 255))
def lawnmower():
    k = c(); k.rect(8, 30, 44, 20, (200, 40, 40)); k.rect(8, 30, 44, 6, (240, 80, 80)); k.rect(46, 14, 6, 20, (60, 60, 70)); k.rect(40, 12, 14, 5, (60, 60, 70)); k.ell(6, 44, 18, 18, (30, 30, 34)); k.ell(38, 44, 18, 18, (30, 30, 34)); k.ell(11, 49, 8, 8, (130, 130, 140)); k.ell(43, 49, 8, 8, (130, 130, 140)); k.rect(4, 48, 50, 4, (90, 90, 100)); return k.outline()

FRAMES = [tree(), rock(), mushroom(), pipe(), barrel(), torch(), pillar(), crystal(), egg(), flower(), fence(), itembox(),
          slick(), shell(), spider(), boulder(), crusher(), geyser(), wasp(), wrath(), spore(), shield(), star(), puff(),
          tree((70, 140, 60), (110, 80, 50)), rock((90, 70, 60)), lawnmower(), crystal((80, 220, 200))]
if __name__ == "__main__":
    im = sheet(FRAMES, F, F, cols=8); im.save(OUT, optimize=True)
    prev = im.resize((im.width * 2, im.height * 2), Image.NEAREST); bg = Image.new("RGBA", prev.size, (40, 40, 60, 255)); bg.alpha_composite(prev); bg.save("/home/claude/kart/props_prev.png")
    print(im.size, os.path.getsize(OUT) // 1024, "KB", len(FRAMES), "frames")
