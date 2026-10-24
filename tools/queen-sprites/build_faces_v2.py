#!/usr/bin/env python3
"""Queen expressions v2 — painted over the 1024 front render (tools/queen-sprites/shot.js → q_front.png).

v1 erased features with inpainting (dark smears under the eyes) and drew mouths as flat bars. v2 never erases the eyes:
lids, brows and mouths are painted on top at 4x and downsampled, with lips, a shaded mouth interior, teeth, tongue,
lip highlights and soft shadows so they sit in the same light as the render. The only thing removed is the thin smile line
(a narrow inpaint on smooth skin), so other mouths don't show a second smile.

Output: public/queen/sprite/face_<name>.png (same box, web scale) + the face box / names in layers.json.
  python3 build_faces_v2.py q_front.png public/queen/sprite
"""
import json, os, sys, math
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter

src = sys.argv[1] if len(sys.argv) > 1 else "q_front.png"
out = sys.argv[2] if len(sys.argv) > 2 else "public/queen/sprite"
IM = Image.open(src).convert("RGBA")
BOX = (372, 250, 668, 494)                  # face region in the render: eyes, nose and room for an open mouth
S = 4                                       # paint at 4x, then downsample
EYES = [(398, 304, 480, 398), (566, 304, 648, 396)]   # eye ellipses (whites) in the render
MC = (528, 444)                             # mouth centre (the painted smile's lowest point is ~448)

def P(x, y):  # render coords -> 4x canvas coords
    return ((x - BOX[0]) * S, (y - BOX[1]) * S)

arr = np.array(IM).astype(np.float32)
def sample(x0, y0, x1, y1):
    return arr[y0:y1, x0:x1, :3].reshape(-1, 3).mean(0)
SKIN = sample(440, 412, 470, 432) * 0.5 + sample(590, 412, 620, 432) * 0.5     # cheek skin
SKIN_HI = SKIN * 1.12
LIP = np.array([SKIN[0] * 0.70, SKIN[1] * 0.44, SKIN[2] * 0.40])                # darker, redder lip line
LINE = (48, 22, 14)
def rgb(c, a=255): return tuple(int(max(0, min(255, v))) for v in c) + (a,)

# ── base: the render's face, with the painted smile line lifted out (narrow inpaint on smooth skin)
def clean_base():
    face = np.array(IM.crop(BOX))
    m = np.zeros(face.shape[:2], np.uint8)
    pts = []
    for x in range(482, 578, 2):
        t = (x - 528) / 46.0
        y = 448 - 11 * (t * t)   # the smile curve: corners ~437, centre ~448
        pts.append((x - BOX[0], int(round(y - BOX[1]))))
    cv2.polylines(m, [np.array(pts, np.int32)], False, 255, 9)
    bgr = cv2.cvtColor(face[..., :3], cv2.COLOR_RGB2BGR)
    inp = cv2.cvtColor(cv2.inpaint(bgr, m, 9, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)
    soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 3) / 255.0
    soft = np.clip(soft * 1.6, 0, 1)[..., None]
    face[..., :3] = (face[..., :3] * (1 - soft) + inp * soft).astype(np.uint8)
    return Image.fromarray(face)

BASE_RAW = IM.crop(BOX)
BASE_CLEAN = clean_base()

def up(img): return img.resize((img.width * S, img.height * S), Image.LANCZOS)
def layer(): return Image.new("RGBA", ((BOX[2] - BOX[0]) * S, (BOX[3] - BOX[1]) * S), (0, 0, 0, 0))

def bez(p0, p1, p2, n=40):
    p1 = (2 * p1[0] - (p0[0] + p2[0]) / 2, 2 * p1[1] - (p0[1] + p2[1]) / 2)   # the curve passes through p1
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in [i / n for i in range(n + 1)]]

def tapered(points, w0, w1, wmid):
    """polygon for a stroke along points, width tapering w0 → wmid → w1 (canvas px)"""
    n = len(points); left, right = [], []
    for i, (x, y) in enumerate(points):
        a = points[max(0, i - 1)]; b = points[min(n - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
        t = i / (n - 1); w = (w0 + (wmid - w0) * (t / 0.5)) if t < 0.5 else (wmid + (w1 - wmid) * ((t - 0.5) / 0.5))
        left.append((x + nx * w / 2, y + ny * w / 2)); right.append((x - nx * w / 2, y - ny * w / 2))
    return left + right[::-1]

def blur(img, r): return img.filter(ImageFilter.GaussianBlur(r))

def soft_shape(poly, color, r):
    L = layer(); ImageDraw.Draw(L).polygon(poly, fill=color); return blur(L, r)

def grad_fill(poly, top, bottom, y0, y1):
    """polygon filled with a vertical gradient (canvas coords)"""
    L = layer(); W, H = L.size
    g = np.zeros((H, W, 4), np.uint8)
    ys = np.clip((np.arange(H) - y0) / max(1, (y1 - y0)), 0, 1)[:, None]
    for c in range(3): g[..., c] = (top[c] * (1 - ys) + bottom[c] * ys).astype(np.uint8)
    g[..., 3] = 255
    mask = Image.new("L", (W, H), 0); ImageDraw.Draw(mask).polygon(poly, fill=255)
    L.paste(Image.fromarray(g), (0, 0), mask); return L, mask

def clip(img, mask):
    a = np.array(img); m = np.array(mask).astype(np.float32) / 255
    a[..., 3] = (a[..., 3] * m).astype(np.uint8); return Image.fromarray(a)

# ── mouths ─────────────────────────────────────────────────────────────────────────────────
def mouth_open(c, w, top, bot, teeth=0.32, tongue=0.45, lower_teeth=0.0, skew=0.0, corner_up=0.0):
    """open mouth: top/bottom are how far the lips curve above/below the corners (render px)"""
    cx, cy = c; l = (cx - w / 2, cy - corner_up + skew); r = (cx + w / 2, cy - corner_up - skew)
    upper = bez(P(*l), P(cx, cy - top), P(*r)); lower = bez(P(*r), P(cx, cy + bot), P(*l))
    poly = upper + lower
    L = layer()
    # shadow around + under the lower lip, then the lips ring
    L.alpha_composite(soft_shape(poly, rgb(SKIN * 0.55, 150), S * 3.0))
    lip = tapered(bez(P(l[0] - 1, l[1]), P(cx, cy + bot + 3.2), P(r[0] + 1, r[1])), S * 2, S * 2, S * 5.2)
    L.alpha_composite(blur(Image.new("RGBA", L.size, (0, 0, 0, 0)), 0))
    lipL = layer(); ImageDraw.Draw(lipL).polygon(lip, fill=rgb(LIP * 1.15)); L.alpha_composite(blur(lipL, S * 0.6))
    ys = [p[1] for p in poly]
    inner, mask = grad_fill(poly, (70, 18, 22), (40, 8, 12), min(ys), max(ys))
    # tongue
    if tongue > 0:
        tw = w * 0.62; th = (top + bot) * tongue
        t = layer(); ImageDraw.Draw(t).ellipse([P(cx - tw / 2, cy + bot - th)[0], P(cx, cy + bot - th)[1], P(cx + tw / 2, 0)[0], P(0, cy + bot + th * 0.6)[1]], fill=(196, 92, 98, 255))
        hl = layer(); ImageDraw.Draw(hl).ellipse([P(cx - tw * 0.22, 0)[0], P(0, cy + bot - th * 0.75)[1], P(cx + tw * 0.08, 0)[0], P(0, cy + bot - th * 0.35)[1]], fill=(236, 150, 150, 160))
        inner.alpha_composite(clip(t, mask)); inner.alpha_composite(clip(blur(hl, S * 0.8), mask))
    # upper teeth: a band under the top lip, with a soft shadow line
    if teeth > 0:
        tb = layer(); d = ImageDraw.Draw(tb)
        band = bez(P(l[0] + w * 0.08, l[1] + 0.5), P(cx, cy - top + (top + bot) * teeth * 1.7), P(r[0] - w * 0.08, r[1] + 0.5))
        d.polygon(upper + band[::-1], fill=(246, 240, 230, 255))
        sh = layer(); ImageDraw.Draw(sh).line(band, fill=(150, 120, 110, 255), width=S * 2); tb.alpha_composite(blur(sh, S * 0.7))
        inner.alpha_composite(clip(tb, mask))
    if lower_teeth > 0:
        lb = layer(); d = ImageDraw.Draw(lb)
        band = bez(P(r[0] - w * 0.12, r[1] - 0.5), P(cx, cy + bot - (top + bot) * lower_teeth * 1.6), P(l[0] + w * 0.12, l[1] - 0.5))
        d.polygon(lower + band[::-1], fill=(236, 228, 218, 255))
        inner.alpha_composite(clip(lb, mask))
    # inner shadow under the top lip
    ish = layer(); ImageDraw.Draw(ish).line(upper, fill=(20, 4, 6, 255), width=S * 4); inner.alpha_composite(clip(blur(ish, S * 1.2), mask))
    L.alpha_composite(inner)
    # lip edge
    edge = layer(); ImageDraw.Draw(edge).line(poly + [poly[0]], fill=rgb(LIP * 0.75), width=int(S * 1.6), joint="curve"); L.alpha_composite(blur(edge, S * 0.35))
    # lower-lip highlight + corner creases
    hl = layer(); ImageDraw.Draw(hl).line(bez(P(cx - w * 0.22, cy + bot + 3.4), P(cx, cy + bot + 5.2), P(cx + w * 0.22, cy + bot + 3.4)), fill=rgb(SKIN_HI * 1.25, 150), width=S * 2); L.alpha_composite(blur(hl, S * 1.0))
    for (x, y), sgn in ((l, -1), (r, 1)):
        cr = layer(); ImageDraw.Draw(cr).line(bez(P(x + sgn * 1, y - 2), P(x + sgn * 4, y + 1), P(x + sgn * 2.5, y + 5)), fill=rgb(SKIN * 0.45, 170), width=S * 2); L.alpha_composite(blur(cr, S * 0.8))
    return L

def mouth_line(c, w, curve, skew=0.0, thick=2.6, dimples=True, pout=0.0):
    """closed mouth: curve > 0 smile, < 0 frown; skew lifts the right corner (smirk)"""
    cx, cy = c; l = (cx - w / 2, cy - curve * 0.15 + skew * 0.3); r = (cx + w / 2, cy - curve * 0.15 - skew)
    pts = bez(P(*l), P(cx + skew * 1.5, cy + curve), P(*r))
    L = layer()
    sh = layer(); ImageDraw.Draw(sh).line([(x, y + S * 3) for x, y in pts], fill=rgb(SKIN_HI * 1.15, 120), width=S * 3); L.alpha_composite(blur(sh, S * 1.4))
    ln = layer(); ImageDraw.Draw(ln).polygon(tapered(pts, S * 0.8, S * 0.8, S * thick), fill=rgb(LIP * 0.30 + np.array(LINE) * 0.45)); L.alpha_composite(blur(ln, S * 0.4))
    if pout > 0:   # a little lower lip under the line
        lp = layer(); ImageDraw.Draw(lp).polygon(tapered(bez(P(cx - w * 0.28, cy + curve * 0.6 + 2.2), P(cx, cy + curve + 2.2 + pout * 4), P(cx + w * 0.28, cy + curve * 0.6 + 2.2)), S * 0.5, S * 0.5, S * (1.6 + pout * 2.5)), fill=rgb(LIP * 1.2, 230)); L.alpha_composite(blur(lp, S * 0.9))
    if dimples:
        for (x, y), sgn in ((l, -1), (r, 1)):
            cr = layer(); ImageDraw.Draw(cr).line(bez(P(x + sgn * 0.5, y - 2.4), P(x + sgn * 2.6, y - 0.2), P(x + sgn * 1.2, y + 2.4)), fill=rgb(SKIN * 0.5, 160), width=int(S * 1.6)); L.alpha_composite(blur(cr, S * 0.7))
    return L

def mouth_o(c, w, h):
    cx, cy = c
    L = layer()
    ring = [P(cx - w / 2, cy - h / 2 + 2), P(cx + w / 2, cy + h / 2 + 2)]
    sh = layer(); ImageDraw.Draw(sh).ellipse([ring[0][0] - S * 3, ring[0][1] - S * 2, ring[1][0] + S * 3, ring[1][1] + S * 4], fill=rgb(SKIN * 0.55, 150)); L.alpha_composite(blur(sh, S * 3))
    lip = layer(); ImageDraw.Draw(lip).ellipse([ring[0][0] - S * 2.2, ring[0][1] - S * 2.2, ring[1][0] + S * 2.2, ring[1][1] + S * 3.2], fill=rgb(LIP * 1.15)); L.alpha_composite(blur(lip, S * 0.6))
    poly = [P(cx + math.cos(a) * w / 2, cy + 2 + math.sin(a) * h / 2) for a in np.linspace(0, 2 * math.pi, 60)]
    ys = [p[1] for p in poly]; inner, mask = grad_fill(poly, (60, 14, 18), (34, 6, 10), min(ys), max(ys))
    t = layer(); ImageDraw.Draw(t).ellipse([P(cx - w * 0.3, 0)[0], P(0, cy + h * 0.18)[1], P(cx + w * 0.3, 0)[0], P(0, cy + h * 0.75)[1]], fill=(190, 88, 96, 255)); inner.alpha_composite(clip(t, mask))
    ish = layer(); ImageDraw.Draw(ish).arc([ring[0][0], ring[0][1], ring[1][0], ring[1][1]], 190, 350, fill=(18, 3, 5, 255), width=S * 4); inner.alpha_composite(clip(blur(ish, S * 1.4), mask))
    L.alpha_composite(inner)
    hl = layer(); ImageDraw.Draw(hl).arc([ring[0][0] - S, ring[0][1], ring[1][0] + S, ring[1][1] + S * 4], 50, 130, fill=rgb(SKIN_HI * 1.3, 150), width=S * 2); L.alpha_composite(blur(hl, S))
    return L

def dome(x0, y0, x1, y1, pad=5):
    """a shaded skin eyelid the size of the eye: lit from the upper left like the render, with a soft rim"""
    L = layer(); W, H = L.size
    cx, cy = P((x0 + x1) / 2, (y0 + y1) / 2); rx, ry = (x1 - x0 + 2 * pad) / 2 * S, (y1 - y0 + 2 * pad) / 2 * S
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
    nx, ny = (X - cx) / rx, (Y - cy) / ry; r2 = nx * nx + ny * ny
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    lx, ly, lz = -0.35, -0.55, 0.76
    d = np.clip(nx * lx + ny * ly + z * lz, 0, 1)
    shade = 0.74 + 0.42 * d
    spec = np.clip(d, 0, 1) ** 18 * 0.10
    col = np.clip(SKIN[None, None, :] * shade[..., None] + 255 * spec[..., None], 0, 255)
    a = np.clip((1.0 - r2) * 6.0, 0, 1) * 255
    L = Image.fromarray(np.dstack([col, a]).astype(np.uint8), "RGBA")
    return blur(L, S * 0.5)

# ── eyes + brows ───────────────────────────────────────────────────────────────────────────
def lids(cover, tilt=0.0, happy=False, closed=False, lower=0.0):
    """upper lids come down over the existing eyes (never erased). cover 0..1 of the eye height.
    tilt > 0 drops the inner corners (angry/focused); < 0 drops the outer corners (sad)."""
    L = layer()
    for i, (x0, y0, x1, y1) in enumerate(EYES):
        inner_right = i == 0      # left eye's inner corner is on its right
        h = y1 - y0; cx = (x0 + x1) / 2
        pad = 4
        if closed:
            # the whole eye under skin, then a lash line: ⌣ asleep / ⌒ happy squint
            L.alpha_composite(dome(x0, y0, x1, y1, pad + 2))
            ym = (y0 + y1) / 2 + (8 if not happy else 4)
            if happy: pts = bez(P(x0 + 8, ym + 8), P(cx, ym - 8), P(x1 - 8, ym + 8))
            else: pts = bez(P(x0 + 4, ym - 2), P(cx, ym + 6), P(x1 - 4, ym - 2))
            ln = layer(); ImageDraw.Draw(ln).polygon(tapered(pts, S * 1.2, S * 1.2, S * 4.2), fill=rgb(LINE)); L.alpha_composite(blur(ln, S * 0.5))
            # little lashes at the outer corner
            ox = x0 if inner_right else x1; sgn = -1 if inner_right else 1; oy = pts[0][1] / S + BOX[1] if inner_right else pts[-1][1] / S + BOX[1]
            la = layer(); ImageDraw.Draw(la).line([P(ox + sgn * 2, oy - 1), P(ox + sgn * 8, oy - (6 if happy else 2))], fill=rgb(LINE), width=S * 2); L.alpha_composite(blur(la, S * 0.4))
            continue
        if cover <= 0: continue
        e = y0 - pad + (h + 2 * pad) * cover
        di = tilt * h * 0.28; yi = e + di; yo = e - di          # inner / outer edge heights
        xi, xo = (x1 + pad, x0 - pad) if inner_right else (x0 - pad, x1 + pad)
        edge = bez(P(xo, yo), P(cx, (yi + yo) / 2 + h * 0.06), P(xi, yi))
        top = y0 - pad - 10
        poly = [P(xo, top)] + edge + [P(xi, top)]
        em = layer(); ImageDraw.Draw(em).ellipse([*P(x0 - pad, y0 - pad - 6), *P(x1 + pad, y1 + pad)], fill=(255, 255, 255, 255))
        lm = Image.new("L", L.size, 0); ImageDraw.Draw(lm).polygon(poly, fill=255)
        L.alpha_composite(clip(dome(x0, y0, x1, y1, pad + 2), blur(lm, S * 0.4)))
        # crease shadow just under the lid edge on the eye, then the lash line
        sh = layer(); ImageDraw.Draw(sh).line([(x, y + S * 3) for x, y in edge], fill=(0, 0, 0, 110), width=S * 4); shb = blur(sh, S * 1.6)
        L.alpha_composite(clip(shb, blur(em.getchannel(3), S)))
        ln = layer(); ImageDraw.Draw(ln).polygon(tapered(edge, S * 2.2, S * 1.2, S * 4.6), fill=rgb(LINE)); L.alpha_composite(blur(ln, S * 0.45))
    if lower > 0:   # cheeks push up under the eyes (smile / squint)
        for (x0, y0, x1, y1) in EYES:
            cx = (x0 + x1) / 2; e = y1 + 2 - (y1 - y0) * lower
            poly = bez(P(x0 - 4, y1 + 8), P(cx, e - 6), P(x1 + 4, y1 + 8)) + [P(x1 + 6, y1 + 12), P(x0 - 6, y1 + 12)]
            ch, cm = grad_fill(poly, rgb(SKIN_HI * 1.06), rgb(SKIN), P(0, e)[1], P(0, y1 + 10)[1])
            em = layer(); ImageDraw.Draw(em).ellipse([*P(x0 - 6, y0), *P(x1 + 6, y1 + 12)], fill=(255, 255, 255, 255))
            ch.putalpha(Image.fromarray(np.minimum(np.array(cm), np.array(blur(em.getchannel(3), S))).astype(np.uint8))); L.alpha_composite(blur(ch, S * 0.6))
    return L

def brows(tilt=0.0, lift=0.0, raise_one=0.0, thick=4.2):
    """tapered brows above the eyes; tilt > 0 inner ends down (angry), < 0 inner ends up (sad/worried)"""
    L = layer()
    for i, (x0, y0, x1, y1) in enumerate(EYES):
        inner_right = i == 0
        cx = (x0 + x1) / 2; y = y0 - 12 - lift - (raise_one if i == 1 else 0)
        xi, xo = (x1 - 2, x0 + 2) if inner_right else (x0 + 2, x1 - 2)
        yi = y + tilt * 9; yo = y - tilt * 4 + 4
        pts = bez(P(xi, yi), P(cx, y - 4 - abs(tilt) * 1.0), P(xo, yo))
        sh = layer(); ImageDraw.Draw(sh).polygon(tapered([(x, yy + S * 2) for x, yy in pts], S * thick * 0.9, S * 1.2, S * thick), fill=rgb(SKIN * 0.55, 110)); L.alpha_composite(blur(sh, S * 1.2))
        ln = layer(); ImageDraw.Draw(ln).polygon(tapered(pts, S * thick, S * 0.9, S * thick * 0.95), fill=rgb((70, 36, 22))); L.alpha_composite(blur(ln, S * 0.5))
    return L

def blush(a=0.32):
    L = layer()
    for cx in (436, 612):
        b = layer(); ImageDraw.Draw(b).ellipse([*P(cx - 26, 414), *P(cx + 26, 440)], fill=(232, 96, 110, int(255 * a))); L.alpha_composite(blur(b, S * 5))
    return L

def bigger_eyes(k=1.12):
    """shock: the eyes grow (pasted over themselves, so nothing is erased)"""
    L = layer()
    for (x0, y0, x1, y1) in EYES:
        pad = 6; patch = BASE_RAW.crop((x0 - pad - BOX[0], y0 - pad - BOX[1], x1 + pad - BOX[0], y1 + pad - BOX[1]))
        pw, ph = patch.size; nw, nh = int(pw * k * S), int(ph * k * S)
        q = patch.resize((nw, nh), Image.LANCZOS)
        m = Image.new("L", (nw, nh), 0); ImageDraw.Draw(m).ellipse([pad * k * S * 0.5, pad * k * S * 0.5, nw - pad * k * S * 0.5, nh - pad * k * S * 0.5], fill=255); m = m.filter(ImageFilter.GaussianBlur(S * 2))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 - 1
        L.paste(q, (int(P(cx, 0)[0] - nw / 2), int(P(0, cy)[1] - nh / 2)), m)
    return L

# ── expressions ────────────────────────────────────────────────────────────────────────────
def face(parts, clean=True):
    base = up(BASE_CLEAN if clean else BASE_RAW)
    for p in parts:
        if p is not None: base.alpha_composite(p)
    return base

EXPR = {
    "blink":   lambda: face([lids(0, closed=True)], clean=False),
    "happy":   lambda: face([blush(0.34), lids(0, closed=True, happy=True), mouth_open((MC[0], MC[1] - 2), 84, 8, 24, teeth=0.26, tongue=0.42, corner_up=6)]),
    "smirk":   lambda: face([lids(0.30, tilt=0.15), brows(tilt=-0.1, lift=-2, raise_one=7, thick=5), mouth_line((MC[0] + 4, MC[1] - 1), 62, 4.5, skew=8, thick=3.8)]),
    "focus":   lambda: face([lids(0.36, tilt=0.35), brows(tilt=0.55, lift=-4, thick=5.5), mouth_line((MC[0] + 3, MC[1] - 1), 34, -0.5, thick=3.6, dimples=False, pout=0.5)]),
    "intense": lambda: face([lids(0.42, tilt=0.8), brows(tilt=1.0, lift=-6, thick=6.5), mouth_open((MC[0], MC[1] + 2), 70, 7, 13, teeth=0.30, tongue=0, lower_teeth=0.26)]),
    "shock":   lambda: face([bigger_eyes(1.13), brows(tilt=-0.35, lift=8, thick=5), mouth_o((MC[0], MC[1] + 8), 34, 40)]),
    "sad":     lambda: face([lids(0.34, tilt=-0.9), brows(tilt=-0.9, lift=2, thick=5), mouth_line((MC[0], MC[1] + 4), 46, -8, thick=3.4, dimples=False, pout=0.8)]),
    # talking (QueenStage cycles these while a line is on screen)
    "talk_a":  lambda: face([mouth_open(MC, 66, 6, 26, teeth=0.22, tongue=0.42)]),
    "talk_o":  lambda: face([mouth_o((MC[0], MC[1] + 6), 34, 36)]),
    "talk_e":  lambda: face([mouth_open(MC, 74, 4, 12, teeth=0.40, tongue=0.25, corner_up=3)]),
    "talk_m":  lambda: face([mouth_line(MC, 50, 3.5, thick=3.8, pout=0.4)]),
}

if __name__ == "__main__":
    os.makedirs(out, exist_ok=True)
    meta_path = f"{out}/layers.json"; meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    k = float(meta.get("scale", 0.7048458149779736))
    W, H = BOX[2] - BOX[0], BOX[3] - BOX[1]
    tw, th = round(W * k), round(H * k)
    # idle stays the render itself (QueenStage draws no layer for idle) but is written for previews
    up(BASE_RAW).resize((tw, th), Image.LANCZOS).save(f"{out}/face_idle.png", optimize=True)
    names = ["idle"]
    for n, fn in EXPR.items():
        img = fn().resize((tw, th), Image.LANCZOS)
        # only the face oval: fade the layer out at the box edges so it never shows a seam on the head
        m = Image.new("L", (tw, th), 0); ImageDraw.Draw(m).rounded_rectangle([3, 2, tw - 4, th - 3], radius=int(th * 0.32), fill=255)
        a = np.minimum(np.array(img.getchannel("A")), np.array(m.filter(ImageFilter.GaussianBlur(3))))
        img.putalpha(Image.fromarray(a.astype(np.uint8)))
        img.save(f"{out}/face_{n}.png", optimize=True); names.append(n)
    meta.setdefault("face", {}); meta["face"]["box"] = list(BOX); meta["face"]["names"] = names; meta["face"]["v"] = 2; meta["face"]["mouth"] = [528, 452, 54, 32]   # talk visemes are drawn clipped to this ellipse (render coords)
    json.dump(meta, open(meta_path, "w"))
    print("faces", names, (tw, th))
