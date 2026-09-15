import math, sys
from px import Canvas, shade, sheet, preview

FW, FH = 40, 44
OUT = (12, 8, 10, 255)

def ant(c, pal, pose):
    """pose: dict(legs=(lf, lb) angles deg from vertical (+ = forward), body_dy, aim = 0|45|90|-45, crouch, arm, dead)"""
    body, armor, light, dark, visor = pal["body"], pal["armor"], pal["light"], pal["dark"], pal["visor"]
    dy = pose.get("body_dy", 0); crouch = pose.get("crouch", False)
    gy = 43  # ground
    hip = (15, (34 if crouch else 29) + dy)
    # ---- legs (ant: thin, jointed) ----
    for i, ang in enumerate(pose.get("legs", (0, 0))):
        hx = hip[0] + (i * 2 - 1)
        L = 8 if crouch else 13
        a = math.radians(ang)
        kx = hx + math.sin(a) * L * 0.55; ky = hip[1] + math.cos(a) * L * 0.55
        fx = hx + math.sin(a) * L + (2 if ang > 10 else 0); fy = min(gy, hip[1] + math.cos(a) * L + abs(math.sin(a)) * 2)
        if pose.get("air"): fy = ky + 5; fx = kx - 2
        col = dark if i == 0 else shade(dark, 1.3)
        c.line(hx, hip[1], kx, ky, col, 2); c.line(kx, ky, fx, fy, col, 2)
        c.rect(int(fx) - 2, int(fy) - 1, 5, 2, shade(armor, 0.55))   # boot
    # ---- abdomen (gaster) behind hips ----
    c.ell(6, hip[1] - 4, 9, 7, dark); c.ell(7, hip[1] - 3, 4, 2, shade(dark, 1.6))
    # ---- torso ----
    ty = hip[1] - 12 + (3 if crouch else 0)
    c.rect(12, ty, 8, 12, body)
    c.rect(12, ty, 8, 7, armor); c.rect(13, ty + 1, 3, 2, light)     # chest plate + highlight
    c.rect(12, ty + 7, 8, 2, shade(armor, 0.5))                       # belt
    # ---- head ----
    hy = ty - 9 + (2 if crouch else 0)
    c.ell(11, hy, 11, 10, dark)
    c.rect(17, hy + 5, 4, 2, visor); c.px(20, hy + 5, (255, 255, 255, 255))   # eye
    c.poly([(11, hy + 4), (11, hy + 1), (14, hy - 1), (19, hy - 1), (22, hy + 2), (22, hy + 4), (20, hy + 3), (13, hy + 3)], armor)  # helmet
    c.rect(14, hy - 2, 5, 1, light)                                   # crest
    # antennae (drawn last so they read over the helmet)
    an = shade(body, 1.1)
    c.line(14, hy - 1, 11, hy - 7, an, 2); c.line(11, hy - 7, 9, hy - 9, an, 2)
    c.line(18, hy - 1, 21, hy - 7, an, 2); c.line(21, hy - 7, 23, hy - 9, an, 2)
    # ---- arms + rifle ----
    aim = pose.get("aim", 0)
    sx, sy = 19, ty + 3
    a = math.radians(-aim)
    gl = 14
    ex, ey = sx + math.cos(a) * gl, sy + math.sin(a) * gl
    # rear arm
    c.line(13, ty + 3, sx - 1 + math.cos(a) * 4, sy + math.sin(a) * 4, body, 2)
    # gun body
    c.line(sx - 3 + math.cos(a) * 2, sy + math.sin(a) * 2, ex, ey, (60, 60, 70, 255), 3)
    c.line(sx + math.cos(a) * 6, sy + math.sin(a) * 6, ex, ey, (95, 95, 110, 255), 1)
    c.px(ex, ey, (255, 170, 60, 255))
    # front arm/hand on grip
    c.line(sx, sy + 1, sx + math.cos(a) * 5, sy + 1 + math.sin(a) * 5, shade(body, 1.15), 2)
    if pose.get("muzzle"):
        mx, my = ex + math.cos(a) * 2, ey + math.sin(a) * 2
        c.ell(mx - 3, my - 3, 7, 7, (255, 200, 60, 255)); c.ell(mx - 2, my - 2, 5, 5, (255, 240, 120, 255)); c.ell(mx - 1, my - 1, 3, 3, (255, 255, 255, 255))

def dead(c0, pal, k):
    class Sh:
        def __getattr__(self, n):
            f = getattr(c0, n)
            def g(*a, **kw):
                if n in ("ell", "rect"): return f(a[0] + 4, a[1] + 4, *a[2:], **kw)
                if n == "line": return f(a[0] + 4, a[1] + 4, a[2] + 4, a[3] + 4, *a[4:], **kw)
                return f(*a, **kw)
            return g
    c = Sh()
    """k = 0..2 : knocked back, on the ground"""
    body, armor, dark, visor = pal["body"], pal["armor"], pal["dark"], pal["visor"]
    if k == 0:
        c.ell(6, 20, 10, 8, dark); c.rect(12, 14, 12, 8, body); c.rect(12, 14, 12, 4, armor); c.ell(22, 8, 10, 10, dark); c.rect(25, 12, 4, 2, visor)
        c.line(14, 22, 8, 32, dark, 2); c.line(18, 22, 14, 34, dark, 2); c.line(20, 16, 26, 22, body, 2)
    elif k == 1:
        c.ell(4, 30, 10, 7, dark); c.rect(11, 29, 12, 7, body); c.rect(11, 29, 12, 3, armor); c.ell(22, 26, 10, 10, dark); c.rect(26, 30, 3, 2, visor)
        c.line(12, 35, 5, 38, dark, 2); c.line(16, 35, 12, 39, dark, 2); c.line(20, 30, 27, 36, body, 2)
    else:
        c.ell(3, 33, 10, 6, dark); c.rect(10, 33, 12, 6, body); c.rect(10, 33, 12, 2, armor); c.ell(21, 30, 10, 9, dark); c.rect(25, 34, 3, 2, (90, 30, 30, 255))
        c.line(11, 38, 4, 39, dark, 2); c.line(15, 38, 10, 39, dark, 2); c.line(19, 34, 27, 38, body, 2)

def frames(pal):
    fs = []
    def F(pose, fn=None):
        c = Canvas(FW, FH)
        (fn or (lambda c: ant(c, pal, pose)))(c)
        c.outline(OUT); fs.append(c)
    # 0-1 idle
    F({"legs": (6, -6)}); F({"legs": (6, -6), "body_dy": 1})
    # 2-7 run
    for i in range(6):
        t = i / 6 * math.pi * 2
        F({"legs": (math.sin(t) * 32, math.sin(t + math.pi) * 32), "body_dy": int(abs(math.cos(t)) * 1.5)})
    # 8 jump
    F({"legs": (20, -10), "air": True, "body_dy": -1})
    # 9-10 shoot (stand) + muzzle
    F({"legs": (6, -6), "muzzle": True}); F({"legs": (6, -6)})
    # 11 aim up 45, 12 aim up 90, 13 aim down 45 (in air)
    F({"legs": (6, -6), "aim": 45}); F({"legs": (6, -6), "aim": 90}); F({"legs": (20, -10), "air": True, "aim": -45})
    # 14 crouch, 15 crouch shoot
    F({"legs": (28, -28), "crouch": True}); F({"legs": (28, -28), "crouch": True, "muzzle": True})
    # 16-18 death
    for k in range(3): F(None, lambda c, k=k: dead(c, pal, k))
    # 19 hit flinch
    F({"legs": (-8, 12), "body_dy": 1, "aim": 20})
    return fs

PALS = {
    "hunter": dict(body=(120, 60, 40, 255), armor=(196, 38, 46, 255), light=(255, 150, 120, 255), dark=(38, 22, 24, 255), visor=(255, 220, 60, 255)),
}

if __name__ == "__main__":
    fs = frames(PALS["hunter"])
    im = sheet(fs, FW, FH, cols=10)
    im.save("/home/claude/bh/hunter.png")
    preview(im, 5).save("/home/claude/bh/hunter_prev.png")
    print(im.size, len(fs))
