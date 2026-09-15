import math
from px import Canvas, shade, sheet, preview
from hero import ant, dead, FW, FH, OUT, PALS

# ── corrupted ant grunts: same rig, hive palettes ──────────────────────────────
GRUNT_PALS = {
    "grunt":   dict(body=(70, 90, 60, 255),  armor=(60, 140, 70, 255),  light=(170, 230, 150, 255), dark=(24, 30, 22, 255), visor=(255, 80, 80, 255)),
    "elite":   dict(body=(90, 60, 110, 255), armor=(150, 60, 190, 255), light=(230, 170, 255, 255), dark=(30, 18, 40, 255), visor=(255, 60, 120, 255)),
}

def grunt_frames(pal):
    fs = []
    def F(pose, fn=None):
        c = Canvas(FW, FH); (fn or (lambda c: ant(c, pal, pose)))(c); c.outline(OUT); fs.append(c)
    F({"legs": (6, -6)}); F({"legs": (6, -6), "body_dy": 1})                          # 0-1 idle
    for i in range(6):                                                                # 2-7 run
        t = i / 6 * math.pi * 2
        F({"legs": (math.sin(t) * 32, math.sin(t + math.pi) * 32), "body_dy": int(abs(math.cos(t)) * 1.5)})
    F({"legs": (6, -6), "muzzle": True}); F({"legs": (6, -6)})                         # 8-9 shoot
    for k in range(3): F(None, lambda c, k=k: dead(c, pal, k))                        # 10-12 death
    F({"legs": (-8, 12), "body_dy": 1, "aim": 20})                                    # 13 hit
    return fs

# ── wasp: 32×32, 2 wing frames + hit + 2 death ────────────────────────────────
def wasp(c, wing, dead_k=None, hit=False):
    Y = (250, 190, 40, 255); K = (30, 24, 20, 255); W = (220, 235, 255, 160); R = (255, 70, 60, 255)
    dy = 0
    if dead_k is not None: dy = 6 + dead_k * 6
    # abdomen with stripes
    c.ell(2, 14 + dy, 14, 9, Y)
    for sx in (5, 9, 13): c.rect(sx, 14 + dy, 2, 9, K)
    c.poly([(2, 18 + dy), (0, 19 + dy), (2, 20 + dy)], K)  # stinger
    # thorax + head
    c.ell(13, 12 + dy, 9, 9, K); c.ell(20, 11 + dy, 8, 8, shade(K, 1.4))
    c.rect(24, 13 + dy, 3, 2, R if not hit else (255, 255, 255, 255))
    # mandibles
    c.line(27, 16 + dy, 30, 18 + dy, K); c.line(27, 15 + dy, 30, 13 + dy, K)
    # legs
    for i in range(3): c.line(15 + i * 2, 20 + dy, 13 + i * 3, 25 + dy, K)
    # wings
    if dead_k is None:
        if wing == 0: c.ell(10, 3, 12, 8, W); c.ell(6, 5, 10, 7, W)
        else: c.ell(12, 8, 12, 5, W); c.ell(8, 9, 10, 4, W)
    # antennae
    c.line(24, 11 + dy, 26, 6 + dy, K); c.line(22, 11 + dy, 22, 6 + dy, K)

def wasp_frames():
    fs = []
    for args in [dict(wing=0), dict(wing=1), dict(wing=0, hit=True), dict(wing=0, dead_k=0), dict(wing=0, dead_k=1)]:
        c = Canvas(32, 32); wasp(c, **args); c.outline(OUT); fs.append(c)
    return fs

# ── spider turret: 32×32, idle 2, shoot, dead ─────────────────────────────────
def turret(c, k):
    B = (60, 40, 70, 255); L = (110, 80, 130, 255); E = (255, 60, 90, 255)
    if k == 3:  # dead: flattened
        c.ell(4, 24, 24, 7, shade(B, 0.6)); return
    y = 1 if k == 1 else 0
    for i in range(4):  # legs both sides
        x0 = 16 - 6 + i * 4
        c.line(x0, 20 + y, 2 + i * 2, 29, B, 2); c.line(x0 + 2, 20 + y, 30 - i * 2, 29, B, 2)
    c.ell(6, 12 + y, 20, 13, B); c.ell(9, 13 + y, 8, 5, L)
    c.ell(12, 6 + y, 12, 10, shade(B, 1.2))
    for ex in (14, 18, 22): c.rect(ex, 10 + y, 2, 2, E)
    for ex in (16, 20): c.rect(ex, 8 + y, 1, 1, E)
    if k == 2: c.ell(17, 15, 6, 6, (255, 240, 120, 255))
    # fangs
    c.line(15, 15 + y, 14, 18 + y, (240, 240, 240, 255)); c.line(21, 15 + y, 22, 18 + y, (240, 240, 240, 255))

def turret_frames():
    fs = []
    for k in range(4):
        c = Canvas(32, 32); turret(c, k); c.outline(OUT); fs.append(c)
    return fs

# ── boss: 64×64 armored beetle general with a cannon arm, 4 frames (idle, idle2, fire, hurt) + 2 death ──
def boss(c, k, pal):
    S, S2, K, E, M = pal
    dead_k = k - 4 if k >= 4 else None
    dy = 0 if dead_k is None else 8 + dead_k * 10
    y = 1 if k == 1 else 0
    # legs
    for i, (x0, x1) in enumerate([(14, 4), (24, 18), (40, 44), (50, 60)]):
        c.line(x0, 44 + y + dy, x1, 60 + dy, K, 3)
    # shell / abdomen
    c.ell(4, 18 + y + dy, 40, 30, S); c.ell(8, 20 + y + dy, 20, 12, S2)
    for sx in range(10, 44, 6): c.line(sx, 22 + y + dy, sx + 4, 46 + y + dy, shade(S, 0.7))
    # thorax + head
    c.ell(36, 20 + y + dy, 22, 22, shade(S, 0.85)); c.ell(50, 22 + y + dy, 13, 14, K)
    c.rect(57, 27 + y + dy, 4, 3, (255, 255, 255, 255) if k == 3 else E)
    # horn
    c.poly([(54, 22 + y + dy), (62, 8 + y + dy), (64, 12 + y + dy), (58, 24 + y + dy)], shade(S, 1.1))
    # cannon arm
    c.rect(40, 36 + y + dy, 22, 6, M); c.rect(56, 35 + y + dy, 8, 8, shade(M, 0.8))
    if k == 2: c.ell(60, 33 + dy, 12, 12, (255, 220, 100, 255)); c.ell(63, 36 + dy, 6, 6, (255, 255, 255, 255))
    # antennae
    c.line(52, 22 + dy, 46, 10 + dy, K, 2); c.line(58, 22 + dy, 60, 6 + dy, K, 2)

BOSS_PALS = {
    "grubthorn": ((120, 90, 40, 255), (200, 160, 70, 255), (40, 28, 18, 255), (255, 80, 60, 255), (80, 80, 90, 255)),
    "sludge":    ((50, 110, 90, 255), (120, 200, 150, 255), (20, 40, 36, 255), (255, 240, 80, 255), (70, 90, 100, 255)),
    "warden":    ((150, 70, 40, 255), (240, 150, 60, 255), (50, 24, 16, 255), (255, 255, 120, 255), (90, 70, 70, 255)),
    "queenguard":((110, 40, 120, 255), (220, 110, 240, 255), (40, 14, 46, 255), (255, 70, 200, 255), (90, 60, 100, 255)),
}

def boss_frames(pal):
    fs = []
    for k in range(6):
        c = Canvas(64, 64); boss(c, k, pal); c.outline(OUT); fs.append(c)
    return fs

# ── pickups + bullets + fx: 16×16 ─────────────────────────────────────────────
def items():
    fs = []
    def F(fn):
        c = Canvas(16, 16); fn(c); c.outline(OUT); fs.append(c)
    # 0 bounty tag (coin)
    F(lambda c: (c.ell(3, 3, 10, 10, (255, 200, 60, 255)), c.ell(5, 5, 6, 6, (255, 240, 150, 255)), c.rect(7, 6, 2, 4, (200, 140, 30, 255))))
    # 1 weapon capsule S (spread) 2 L (laser) 3 F (flame) 4 R (rifle)
    for col in [(255, 90, 90, 255), (90, 200, 255, 255), (255, 150, 40, 255), (200, 200, 200, 255)]:
        F(lambda c, col=col: (c.ell(1, 4, 14, 8, (230, 230, 240, 255)), c.rect(5, 5, 6, 6, col)))
    # 5 heart (life)
    F(lambda c: (c.ell(2, 3, 7, 7, (255, 70, 90, 255)), c.ell(7, 3, 7, 7, (255, 70, 90, 255)), c.poly([(2, 7), (14, 7), (8, 14)], (255, 70, 90, 255))))
    # 6 player bullet 7 enemy bullet 8 laser bolt 9 flame blob
    F(lambda c: (c.ell(4, 6, 8, 4, (255, 240, 160, 255)), c.rect(9, 7, 3, 2, (255, 255, 255, 255))))
    F(lambda c: (c.ell(5, 5, 6, 6, (255, 80, 100, 255)), c.ell(7, 7, 2, 2, (255, 220, 220, 255))))
    F(lambda c: (c.rect(1, 7, 14, 2, (120, 220, 255, 255)), c.rect(1, 6, 14, 1, (220, 250, 255, 255))))
    F(lambda c: (c.ell(3, 3, 10, 10, (255, 140, 40, 255)), c.ell(5, 5, 6, 6, (255, 230, 90, 255))))
    # 10-13 explosion
    for r in (3, 5, 7, 8):
        F(lambda c, r=r: (c.ell(8 - r, 8 - r, r * 2, r * 2, (255, 160, 50, 255)), c.ell(8 - r // 2, 8 - r // 2, r, r, (255, 240, 160, 255))))
    # 14 crate
    F(lambda c: (c.rect(1, 2, 14, 13, (150, 100, 50, 255)), c.rect(1, 2, 14, 2, (190, 140, 80, 255)), c.line(1, 2, 14, 14, (110, 70, 30, 255)), c.line(14, 2, 1, 14, (110, 70, 30, 255))))
    # 15 honey drop (heal)
    F(lambda c: (c.poly([(8, 1), (13, 9), (12, 13), (8, 15), (4, 13), (3, 9)], (255, 180, 40, 255)), c.ell(5, 7, 4, 5, (255, 230, 140, 255)), c.px(6, 8, (255, 255, 255, 255))))
    return fs

if __name__ == "__main__":
    for name, pal in GRUNT_PALS.items():
        im = sheet(grunt_frames(pal), FW, FH, cols=7); im.save(f"/home/claude/bh/{name}.png")
    im = sheet(wasp_frames(), 32, 32); im.save("/home/claude/bh/wasp.png")
    im = sheet(turret_frames(), 32, 32); im.save("/home/claude/bh/turret.png")
    for name, pal in BOSS_PALS.items():
        im = sheet(boss_frames(pal), 64, 64); im.save(f"/home/claude/bh/boss_{name}.png")
    im = sheet(items(), 16, 16); im.save("/home/claude/bh/items.png")
    # composite preview
    from PIL import Image
    parts = [Image.open(f"/home/claude/bh/{n}.png") for n in ["grunt", "elite", "wasp", "turret", "boss_grubthorn", "boss_queenguard", "items"]]
    W = max(p.width for p in parts); H = sum(p.height + 4 for p in parts)
    out = Image.new("RGBA", (W, H), (40, 30, 50, 255)); y = 0
    for p in parts: out.alpha_composite(p, (0, y)); y += p.height + 4
    preview(out, 3).save("/home/claude/bh/enemies_prev.png"); print(out.size)
