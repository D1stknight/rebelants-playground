import math, random
from PIL import Image, ImageDraw
from px import Canvas, shade, sheet, preview

BIOMES = {
    # name: sky top, sky bottom, far, mid, near, ground top, ground fill, accent
    "jungle":   dict(sky=((8, 10, 30), (30, 60, 70)), far=(150, 160, 170), mid=(22, 60, 40), near=(12, 36, 26), gtop=(96, 200, 60), gfill=(128, 104, 52), accent=(255, 220, 90), hazard=((40, 90, 210), (120, 190, 255))),
    "sewers":   dict(sky=((14, 22, 40), (30, 60, 80)), far=(30, 55, 80), mid=(22, 40, 60), near=(12, 26, 40), gtop=(70, 130, 120), gfill=(70, 76, 92), accent=(90, 255, 180), hazard=((40, 150, 60), (150, 255, 120))),
    "fortress": dict(sky=((60, 20, 10), (200, 90, 40)), far=(120, 50, 30), mid=(80, 32, 24), near=(40, 16, 14), gtop=(160, 120, 80), gfill=(96, 70, 58), accent=(255, 160, 60), hazard=((200, 60, 10), (255, 200, 60))),
    "throne":   dict(sky=((20, 4, 30), (90, 20, 90)), far=(70, 20, 90), mid=(50, 12, 66), near=(26, 6, 36), gtop=(170, 70, 160), gfill=(74, 40, 80), accent=(255, 80, 200), hazard=((150, 20, 120), (255, 120, 230))),
}
W, H = 480, 225

def rgba(c): return (c[0], c[1], c[2], 255)

def far_layer(b, seed):
    r = random.Random(seed)
    im = Image.new("RGBA", (W, H)); d = ImageDraw.Draw(im)
    top, bot = b["sky"]
    for y in range(H):
        k = y / H; d.line([0, y, W, y], fill=rgba(tuple(int(top[i] * (1 - k) + bot[i] * k) for i in range(3))))
    # stars / spores
    for _ in range(40):
        x, y = r.randrange(W), r.randrange(H // 2); d.point((x, y), fill=rgba(tuple(min(255, c + 60) for c in bot)))
    # big mounds / mountains (tileable: mirror positions mod W)
    col = rgba(b["far"])
    for i in range(6):
        cx = i * 80 + r.randrange(40); h = 60 + r.randrange(70); w = 80 + r.randrange(80)
        for off in (-W, 0, W):
            d.polygon([(cx - w // 2 + off, H), (cx + off, H - h), (cx + w // 2 + off, H)], fill=col)
            d.polygon([(cx - w // 4 + off, H), (cx + 6 + off, H - h + 10), (cx + w // 3 + off, H)], fill=rgba(shade(rgba(b["far"]), 1.15)[:3]))
    return im

def mid_layer(b, seed, kind):
    r = random.Random(seed)
    im = Image.new("RGBA", (W, H)); d = ImageDraw.Draw(im)
    col = rgba(b["mid"]); col2 = rgba(shade(col, 1.2)[:3])
    base = H - 40
    d.rectangle([0, base + 20, W, H], fill=col)
    for i in range(14):
        x = i * 34 + r.randrange(20)
        for off in (-W, 0, W):
            if kind == "jungle":      # trees
                h = 60 + r.randrange(60); d.rectangle([x - 3 + off, base + 20 - h, x + 3 + off, base + 20], fill=col)
                for j in range(3): d.ellipse([x - 22 + j * 4 + off, base + 20 - h - 26 + j * 8, x + 22 - j * 4 + off, base + 20 - h + 8 + j * 8], fill=col if j % 2 else col2)
            elif kind == "sewers":    # pipes and pillars
                h = 90 + r.randrange(80); d.rectangle([x - 8 + off, base + 20 - h, x + 8 + off, base + 20], fill=col)
                d.rectangle([x - 12 + off, base + 20 - h, x + 12 + off, base + 24 - h], fill=col2)
                if i % 3 == 0: d.rectangle([x - 40 + off, base - 60, x + 40 + off, base - 52], fill=col2)
            elif kind == "fortress":  # spiked towers
                h = 80 + r.randrange(70); d.rectangle([x - 10 + off, base + 20 - h, x + 10 + off, base + 20], fill=col)
                d.polygon([(x - 14 + off, base + 20 - h), (x + off, base - h), (x + 14 + off, base + 20 - h)], fill=col2)
                for j in range(0, h, 14): d.rectangle([x - 3 + off, base + 20 - h + j + 4, x + 3 + off, base + 20 - h + j + 8], fill=rgba(shade(col, 0.6)[:3]))
            else:                     # throne: organic hive columns with glowing cells
                h = 100 + r.randrange(80); d.ellipse([x - 12 + off, base + 20 - h, x + 12 + off, base + 40], fill=col)
                for j in range(0, h - 20, 16): d.ellipse([x - 4 + off, base + 20 - h + j + 6, x + 4 + off, base + 20 - h + j + 14], fill=rgba(shade(rgba(b["accent"]), 0.5)[:3]))
    return im

def near_layer(b, seed, kind):
    r = random.Random(seed)
    im = Image.new("RGBA", (W, 64)); d = ImageDraw.Draw(im)
    col = rgba(b["near"]); col2 = rgba(shade(col, 1.3)[:3])
    d.rectangle([0, 44, W, 64], fill=col)
    for i in range(30):
        x = i * 17 + r.randrange(10)
        for off in (-W, 0, W):
            if kind == "jungle": d.polygon([(x - 8 + off, 46), (x + off, 20 + r.randrange(14)), (x + 8 + off, 46)], fill=col if i % 2 else col2)
            elif kind == "sewers": d.rectangle([x - 6 + off, 30 + r.randrange(10), x + 6 + off, 46], fill=col if i % 2 else col2)
            elif kind == "fortress": d.polygon([(x - 6 + off, 46), (x + off, 26 + r.randrange(12)), (x + 6 + off, 46)], fill=rgba(shade(col, 1.1)[:3]))
            else: d.ellipse([x - 7 + off, 28 + r.randrange(10), x + 7 + off, 48], fill=col if i % 2 else col2)
    return im

def tiles(b, kind):
    gt, gf, ac = rgba(b["gtop"]), rgba(b["gfill"]), rgba(b["accent"])
    hz0, hz1 = rgba(b["hazard"][0]), rgba(b["hazard"][1])
    fs = []
    def F(fn):
        c = Canvas(16, 16); fn(c); fs.append(c)
    r = random.Random(kind)
    lumps = [(r.randrange(-3, 14), r.randrange(-3, 14), 5 + r.randrange(6), 4 + r.randrange(5)) for _ in range(7)]
    def fill(c, top=False):
        c.rect(0, 0, 16, 16, shade(gf, 0.55))
        # boulders drawn with wrap-around so the tile repeats seamlessly
        for (lx, ly, lw, lh) in lumps:
            for ox in (-16, 0, 16):
                for oy in (-16, 0, 16):
                    c.ell(lx + ox, ly + oy, lw, lh, shade(gf, 0.72)); c.ell(lx + ox, ly + oy, lw - 1, lh - 1, gf); c.ell(lx + ox + 1, ly + oy + 1, max(1, lw - 4), max(1, lh - 4), shade(gf, 1.22))
    def grass(c):
        c.rect(0, 0, 16, 5, gt); c.rect(0, 5, 16, 1, shade(gt, 0.6))
        for x in (1, 4, 7, 10, 13): c.px(x, 0, shade(gt, 1.35)); c.px(x + 1, 1, shade(gt, 0.8))
        for x in (2, 9, 14): c.px(x, 6, shade(gf, 0.5))
    # 0 top (grass over rock)
    F(lambda c: (fill(c), grass(c)))
    # 1 fill
    F(fill)
    # 2 one-way ledge (grass strip with a rock lip)
    F(lambda c: (c.rect(0, 0, 16, 5, gt), c.rect(0, 5, 16, 3, shade(gf, 0.9)), c.rect(0, 8, 16, 1, shade(gf, 0.5)), [c.px(x, 0, shade(gt, 1.35)) for x in (1, 6, 11)], [c.px(x, 6, shade(gf, 1.2)) for x in (3, 9, 14)]))
    # 3 hazard surface (water / acid / lava / corruption) frame A
    def hazard(c, ph):
        c.rect(0, 0, 16, 16, hz0)
        for x in range(16):
            y = 2 + int((math.sin((x + ph * 4) / 2.5) + 1) * 1.2)
            c.px(x, y, hz1); c.px(x, y + 1, shade(hz1, 0.85))
        for x in (3, 11): c.px((x + ph * 3) % 16, 9 + ph, shade(hz1, 0.8))
        c.rect(0, 0, 16, 1, shade(hz1, 1.1))
    F(lambda c: hazard(c, 0))
    # 4 top-left edge 5 top-right edge
    F(lambda c: (fill(c), grass(c), c.rect(0, 0, 2, 16, shade(gf, 0.5))))
    F(lambda c: (fill(c), grass(c), c.rect(14, 0, 2, 16, shade(gf, 0.5))))
    # 6 wall left 7 wall right
    F(lambda c: (fill(c), c.rect(0, 0, 2, 16, shade(gf, 0.45))))
    F(lambda c: (fill(c), c.rect(14, 0, 2, 16, shade(gf, 0.45))))
    # 8 decoration: tuft / glow
    F(lambda c: ([c.line(x, 15, x + (1 if i % 2 else -1), 9 - i, gt if kind == "jungle" else ac) for i, x in enumerate((4, 7, 10, 13))]))
    # 9 ceiling (bottom edge)
    F(lambda c: (fill(c), c.rect(0, 13, 16, 3, shade(gf, 0.45))))
    # 10 wanted flag
    F(lambda c: (c.rect(7, 2, 2, 14, (120, 90, 60, 255)), c.poly([(9, 2), (16, 5), (9, 8)], ac)))
    # 11 / 12 reserved (timed spikes use 14)
    F(lambda c: None); F(lambda c: None)
    # 13 hazard frame B
    F(lambda c: hazard(c, 1))
    # 14 spikes
    F(lambda c: (c.rect(0, 13, 16, 3, shade(gf, 0.8)), [c.poly([(x, 14), (x + 3, 2), (x + 6, 14)], (215, 215, 230, 255)) for x in (0, 5, 10)], [c.px(x + 3, 4, (255, 255, 255, 255)) for x in (0, 5, 10)]))
    # 15 hazard body (below the surface)
    F(lambda c: (c.rect(0, 0, 16, 16, shade(hz0, 0.8)), [c.px(r.randrange(16), r.randrange(16), shade(hz0, 1.15)) for _ in range(5)]))
    return fs

if __name__ == "__main__":
    for i, (name, b) in enumerate(BIOMES.items()):
        far_layer(b, i).save(f"/home/claude/bh/bg_{name}_far.png")
        mid_layer(b, i + 10, name).save(f"/home/claude/bh/bg_{name}_mid.png")
        near_layer(b, i + 20, name).save(f"/home/claude/bh/bg_{name}_near.png")
        sheet(tiles(b, name), 16, 16).save(f"/home/claude/bh/tiles_{name}.png")
    # preview: jungle composite
    for name in BIOMES:
        far = Image.open(f"/home/claude/bh/bg_{name}_far.png"); mid = Image.open(f"/home/claude/bh/bg_{name}_mid.png"); near = Image.open(f"/home/claude/bh/bg_{name}_near.png")
        comp = far.copy(); comp.alpha_composite(mid); comp.alpha_composite(near, (0, H - 64 - 32))
        t = Image.open(f"/home/claude/bh/tiles_{name}.png")
        for x in range(0, W, 16):
            comp.alpha_composite(t.crop((0, 0, 16, 16)), (x, H - 32)); comp.alpha_composite(t.crop((16, 0, 32, 16)), (x, H - 16))
        comp.alpha_composite(t.crop((32, 0, 48, 16)), (100, H - 80)); comp.alpha_composite(t.crop((32, 0, 48, 16)), (116, H - 80)); comp.alpha_composite(t.crop((48, 0, 64, 16)), (200, H - 48))
        comp.alpha_composite(t.crop((128, 0, 144, 16)), (60, H - 48)); [comp.alpha_composite(t.crop((48, 0, 64, 16)), (x, H - 32)) for x in (260, 276, 292)]; [comp.alpha_composite(t.crop((240, 0, 256, 16)), (x, H - 16)) for x in (260, 276, 292)]
        preview(comp, 2).save(f"/home/claude/bh/prev_{name}.png")
    print("ok")
