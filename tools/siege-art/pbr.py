# tools/siege-art/pbr.py — tileable PBR sets for The Siege (albedo / normal / roughness), warm "ashen gate" sandstone look.
# python3 pbr.py <outdir>  → ashlar_*, flag_*, dirt_*, wood_*, rock_* (.jpg)
import sys, os, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
R = np.random.default_rng(11)

def pnoise(n, beta=2.0, seed=0):
    """periodic 1/f^beta noise in [0,1] (tiles perfectly)"""
    r = np.random.default_rng(seed); fx = np.fft.fftfreq(n)[:, None]; fy = np.fft.rfftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    spec = (r.normal(size=f.shape) + 1j * r.normal(size=f.shape)) / f ** (beta / 2); spec[0, 0] = 0
    a = np.fft.irfft2(spec, s=(n, n)); a -= a.min(); return (a / a.max()).astype(np.float32)

def pblur(a, s):  # periodic gaussian
    return gaussian_filter(a, s, mode="wrap")

def normal_from(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength; dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.dstack([-dx, dy, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)

def save(name, alb, h, rough, strength=6.0):
    Image.fromarray((np.clip(alb, 0, 1) * 255).astype(np.uint8)).save(f"{OUT}/{name}_a.jpg", quality=88, optimize=True)
    Image.fromarray(normal_from(h, strength)).save(f"{OUT}/{name}_n.jpg", quality=90, optimize=True)
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8)).convert("RGB").save(f"{OUT}/{name}_r.jpg", quality=80, optimize=True)
    print(name, alb.shape)

def hexc(c): return np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255], np.float32) / 255

def split(total, lo, hi, r):
    out = []; s = 0
    while total - s > hi: w = int(r.integers(lo, hi)); out.append(w); s += w
    rest = total - s
    if rest < lo and out: out[-1] += rest
    else: out.append(rest)
    return out

def blocks(n, row_lo, row_hi, w_lo, w_hi, seed, split_p=0.0):
    """tileable running-bond layout → block id map + distance-to-edge (px)"""
    r = np.random.default_rng(seed); ids = np.zeros((n, n), np.int32); ex = np.zeros((n, n), np.float32); ey = np.zeros((n, n), np.float32)
    y = 0; bid = 0; xs = np.arange(n)
    for hgt in split(n, row_lo, row_hi, r):
        widths = split(n, w_lo, w_hi, r); off = int(r.integers(0, n)); edges = np.cumsum([0] + widths)
        col = np.searchsorted(edges, (xs - off) % n, side="right") - 1; loc = (xs - off) % n - edges[col]; wcol = np.array(widths)[col]
        dx = np.minimum(loc, wcol - loc).astype(np.float32)
        for yy in range(hgt):
            ids[y + yy] = bid + col; ex[y + yy] = dx; ey[y + yy] = min(yy, hgt - yy)
        bid += len(widths); y += hgt
    return ids, ex, ey

# ── sandstone ashlar (wall): 1024px ≈ 4 m
def ashlar(name="ashlar", n=1024, seed=1, pal=(0xdcc39a, 0xcfb286, 0xc4a67c, 0xd6b98e, 0xbfa074), mortar=0x9c8a70):
    ids, ex, ey = blocks(n, 120, 200, 180, 400, seed)
    e = np.minimum(ex, ey); r = np.random.default_rng(seed)
    nb = ids.max() + 1; tone = r.random(nb); pick = r.integers(0, len(pal), nb); tx = r.normal(0, 0.12, nb); ty = r.normal(0, 0.12, nb)
    base = np.stack([hexc(pal[i]) for i in range(len(pal))])[pick[ids]] * (0.9 + 0.18 * tone[ids])[..., None]
    n1 = pnoise(n, 2.2, seed + 1); n2 = pnoise(n, 1.4, seed + 2); n3 = pnoise(n, 2.8, seed + 3); pit = pnoise(n, 0.6, seed + 5)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    warp = pnoise(n, 2.4, seed + 6); strata = np.sin(yy * 0.05 + warp * 14 + ids * 1.7) * 0.5 + 0.5          # soft sediment bands, per block
    chip = np.clip((n2 - 0.58) * 4, 0, 1) * np.clip(1 - e / 30, 0, 1)                                        # chipped arrises
    bevel = np.clip(e / 20, 0, 1) ** 0.55; gap = e < 3.0
    tilt = (tx[ids] * (xx % 256) / 256 + ty[ids] * (yy % 256) / 256) * 0.3
    h = bevel * (0.72 + 0.28 * n1) + tilt - chip * 0.6 + (pit - 0.5) * 0.10 + (n3 - 0.5) * 0.08; h[gap] = 0.04
    alb = base * (0.9 + 0.1 * strata[..., None]) * (0.9 + 0.18 * n3[..., None]) * (0.96 + 0.08 * pit[..., None])
    grime = np.clip((pnoise(n, 2.0, seed + 4) - 0.55) * 2, 0, 1) * 0.3 + np.clip(1 - e / 18, 0, 1) * 0.12
    alb = alb * (1 - grime[..., None]) - chip[..., None] * 0.05
    alb[gap] = hexc(mortar) * (0.75 + 0.3 * n2[gap])[..., None]
    ao = np.clip(1 - (pblur(h, 7) - h) * 2.0, 0.6, 1); alb *= ao[..., None]
    rough = 0.84 + 0.1 * n2 - chip * 0.05; save(name, alb, h, rough, 9.0)

# ── flagstone floor: 1024px ≈ 4 m
def flag(name="flag", n=1024, seed=5):
    ids, ex, ey = blocks(n, 90, 170, 120, 300, seed); e = np.minimum(ex, ey); r = np.random.default_rng(seed)
    nb = ids.max() + 1; tone = r.random(nb)
    pal = np.stack([hexc(c) for c in (0xc9b08a, 0xb49c78, 0xbfa682, 0xa89070)]); base = pal[r.integers(0, 4, nb)[ids]] * (0.85 + 0.25 * tone[ids])[..., None]
    n1 = pnoise(n, 2.0, seed + 1); n2 = pnoise(n, 1.3, seed + 2)
    # cracks: edges of a periodic voronoi, only kept on some stones
    pts = r.random((70, 2)) * n; tree = cKDTree(pts, boxsize=n); yy, xx = np.mgrid[0:n, 0:n]; q = np.dstack([yy, xx]).reshape(-1, 2).astype(np.float64)
    d, _ = tree.query(q, k=2); crack = np.clip(1 - (d[:, 1] - d[:, 0]).reshape(n, n) / 2.2, 0, 1) * (r.random(nb)[ids] < 0.35) * (n1 > 0.35)
    dome = np.clip(e / 16, 0, 1) ** 0.5; gap = e < 5
    h = dome * (0.8 + 0.2 * n1) - crack * 0.4 + (n2 - 0.5) * 0.1; h[gap] = 0.02
    alb = base * (0.85 + 0.2 * n2[..., None]); alb *= (1 - crack * 0.5)[..., None]
    wear = np.clip((pnoise(n, 2.2, seed + 3) - 0.55) * 3, 0, 1); alb = alb * (1 - wear[..., None] * 0.18)
    alb[gap] = hexc(0x6a5842) * (0.7 + 0.5 * n2[gap])[..., None]
    ao = np.clip(1 - (pblur(h, 5) - h) * 2.4, 0.5, 1); alb *= ao[..., None]
    save(name, alb, h, 0.8 + 0.15 * n2, 6.0)

# ── cracked dry earth with pebbles: 1024px ≈ 8 m
def dirt(name="dirt", n=1024, seed=9):
    r = np.random.default_rng(seed); n1 = pnoise(n, 2.1, seed); n2 = pnoise(n, 1.2, seed + 1); n3 = pnoise(n, 2.6, seed + 2)
    pts = r.random((220, 2)) * n; tree = cKDTree(pts, boxsize=n); yy, xx = np.mgrid[0:n, 0:n]; q = np.dstack([yy, xx]).reshape(-1, 2).astype(np.float64)
    d, _ = tree.query(q, k=2); cell = (d[:, 1] - d[:, 0]).reshape(n, n); crack = np.clip(1 - cell / 3, 0, 1) * (n3 > 0.45)
    h = n1 * 0.6 + n2 * 0.15 - crack * 0.5
    peb = np.zeros((n, n), np.float32)
    for _ in range(900):
        cy, cx, rr = r.integers(0, n), r.integers(0, n), r.uniform(2, 7); ys = (np.arange(-8, 9) + cy) % n; xs2 = (np.arange(-8, 9) + cx) % n
        g = np.clip(1 - (np.add.outer(np.arange(-8, 9) ** 2, np.arange(-8, 9) ** 2) / (rr * rr)), 0, 1) ** 0.5; peb[np.ix_(ys, xs2)] = np.maximum(peb[np.ix_(ys, xs2)], g)
    h = h + peb * 0.5
    alb = hexc(0x8a6e4e) * (0.7 + 0.45 * n1[..., None]) + hexc(0x3a2c20) * (n3[..., None] * 0.25)
    alb = alb * (1 - crack[..., None] * 0.55); alb = alb * (1 - peb[..., None] * 0.8) + (hexc(0x8a7a66) * (0.75 + 0.35 * n2[..., None])) * peb[..., None] * 0.8
    ao = np.clip(1 - (pblur(h, 4) - h) * 2.0, 0.55, 1); alb *= ao[..., None]
    save(name, alb, h, 0.92 - peb * 0.2, 5.0)

# ── timber planks: 512px
def wood(name="wood", n=512, seed=13):
    r = np.random.default_rng(seed); xs = np.arange(n); plank = xs // 64; loc = xs % 64
    n1 = pnoise(n, 2.0, seed); grain = np.sin((xs[None, :] * 0.9 + np.cumsum(np.ones((n, n)), 0) * 0.0 + n1 * 40) * 0.6) * 0.5 + 0.5
    grain = pblur(grain, (6, 0.6)); tone = r.random(8)[plank][None, :]
    edge = np.clip(np.minimum(loc, 63 - loc) / 3, 0, 1)[None, :].repeat(n, 0)
    h = edge * (0.7 + 0.3 * grain)
    alb = hexc(0x6b4428) * (0.75 + 0.35 * grain[..., None]) * (0.85 + 0.3 * tone[..., None]); alb *= (0.55 + 0.45 * edge)[..., None]
    save(name, alb, h, 0.75 + 0.2 * grain, 5.0)

# ── weathered rock (mesas, boulders): 512px
def rock(name="rock", n=512, seed=17):
    n1 = pnoise(n, 2.0, seed); n2 = pnoise(n, 1.4, seed + 1); w = pnoise(n, 2.3, seed + 2); strata = np.sin(np.arange(n)[:, None] * 0.05 + w * 18) * 0.5 + 0.5
    h = n1 * 0.7 + strata * 0.12 + n2 * 0.15
    alb = hexc(0xc49c70) * (0.8 + 0.12 * strata[..., None]) * (0.78 + 0.3 * n1[..., None]) * (0.9 + 0.15 * n2[..., None])
    save(name, alb, h, 0.9 + 0.08 * n2, 6.0)

ashlar(); ashlar("ashlar2", seed=21, pal=(0xc9a57a, 0xae8a64, 0xbf9870, 0x9f7d58)); flag(); dirt(); wood(); rock()
