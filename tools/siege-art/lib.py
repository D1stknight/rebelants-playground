# painter helpers for The Siege art — numpy float RGBA images in [0,1], y-down pixel space
import numpy as np
from scipy.ndimage import gaussian_filter, distance_transform_edt
from PIL import Image

rng = np.random.default_rng(7)

def noise(h, w, octaves=((8, 1.0), (16, 0.5), (32, 0.25), (64, 0.12), (128, 0.06)), seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    out = np.zeros((h, w), np.float32); tot = 0
    for cells, amp in octaves:
        gh, gw = max(2, int(h / max(w, h) * cells) + 2), max(2, int(w / max(w, h) * cells) + 2)
        g = r.random((gh, gw)).astype(np.float32)
        img = np.array(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
        out += img * amp; tot += amp
    return out / tot

def grain(h, w, amt=0.05, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    return (r.random((h, w)).astype(np.float32) - 0.5) * 2 * amt

def hex2rgb(c):
    return np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255], np.float32) / 255

def solid(h, w, c, a=1.0):
    img = np.zeros((h, w, 4), np.float32); img[..., :3] = hex2rgb(c); img[..., 3] = a; return img

def over(dst, src, x=0, y=0):
    """alpha-composite src onto dst at (x, y) (top-left), clipped"""
    H, W = dst.shape[:2]; h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0: return dst
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]; d = dst[y0:y1, x0:x1]
    a = s[..., 3:4]; out_a = a + d[..., 3:4] * (1 - a)
    rgb = (s[..., :3] * a + d[..., :3] * d[..., 3:4] * (1 - a)) / np.maximum(out_a, 1e-6)
    d[..., :3] = rgb; d[..., 3:4] = out_a; return dst

def bricks(h, w, bw, bh, base, mortar=0x101319, var=0.09, light=(-0.6, -0.8), bevel=1.6, moss=0.0, grime=0.35, seed=None, joint=None, offset=0.5):
    """painted stone masonry. bw/bh brick size px, base hex colour, light = direction of the key light (dx, dy) in screen space"""
    r = np.random.default_rng(seed) if seed is not None else rng
    joint = joint if joint is not None else max(1.0, min(bw, bh) * 0.07)
    col = np.zeros((h, w, 3), np.float32); col[:] = hex2rgb(base)
    # per-brick colour
    rows = int(np.ceil(h / bh)) + 1; cols = int(np.ceil(w / bw)) + 2
    bc = np.zeros((rows, cols, 3), np.float32)
    for i in range(rows):
        for j in range(cols):
            k = (r.random() - 0.5) * 2 * var; warm = (r.random() - 0.5) * 0.05
            bc[i, j] = np.clip(hex2rgb(base) * (1 + k) + np.array([warm, warm * 0.5, -warm]), 0, 1)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    row = np.floor(yy / bh).astype(int); rowoff = (row % 2) * bw * offset
    colidx = np.floor((xx + rowoff) / bw).astype(int)
    col = bc[np.clip(row, 0, rows - 1), np.clip(colidx, 0, cols - 1)]
    # distance to the brick edge → mortar + bevel
    fx = (xx + rowoff) % bw; fy = yy % bh
    ex = np.minimum(fx, bw - fx); ey = np.minimum(fy, bh - fy); e = np.minimum(ex, ey)
    mort = np.clip(1 - (e - joint * 0.5) / joint, 0, 1)                      # 1 inside the mortar joint
    # bevel: bricks lit from the light direction — top-left edges brighter, bottom-right darker
    lx, ly = light; sx = np.where(fx < bw / 2, 1, -1); sy = np.where(fy < bh / 2, 1, -1)
    bev = np.clip(1 - e / (joint * bevel * 2.2), 0, 1) * (1 - mort)
    shade = bev * (np.where(ex < ey, -sx * lx, 0) + np.where(ey <= ex, -sy * ly, 0)) * 0.22
    col = col * (1 + shade)[..., None]
    # surface noise, cracks & stains
    n = noise(h, w, ((6, 1), (24, 0.5), (96, 0.3)), seed=seed)
    col = col * (0.82 + n * 0.36)[..., None] + grain(h, w, 0.03, seed)[..., None]
    stain = np.clip(noise(h, w, ((3, 1), (10, 0.5)), seed=(seed or 0) + 11) - 0.55, 0, 1) * grime
    col = col * (1 - stain * 0.8)[..., None]
    if moss > 0:
        m = np.clip(noise(h, w, ((5, 1), (20, 0.6), (60, 0.3)), seed=(seed or 0) + 5) - 0.5, 0, 1) * 2
        fall = np.clip((yy / h - (1 - moss)) / max(moss, 1e-3), 0, 1) ** 1.3
        mk = np.clip(m * fall * (0.4 + mort * 0.9), 0, 1)
        col = col * (1 - mk)[..., None] + np.array([0.20, 0.30, 0.14], np.float32) * (n * 0.5 + 0.5)[..., None] * mk[..., None]
    mc = hex2rgb(mortar) * (0.8 + n * 0.4)[..., None]
    col = col * (1 - mort)[..., None] + mc * mort[..., None]
    img = np.zeros((h, w, 4), np.float32); img[..., :3] = np.clip(col, 0, 1); img[..., 3] = 1
    return img

def shade_vertical(img, top=1.0, bottom=0.6, power=1.0):
    h = img.shape[0]; t = (np.linspace(0, 1, h) ** power)[:, None, None]
    img[..., :3] = np.clip(img[..., :3] * (top + (bottom - top) * t), 0, 1); return img

def shade_horizontal(img, left=1.0, right=0.7):
    w = img.shape[1]; t = np.linspace(0, 1, w)[None, :, None]
    img[..., :3] = np.clip(img[..., :3] * (left + (right - left) * t), 0, 1); return img

def cylinder_shade(img, k=0.45, hi=0.35, hx=0.32):
    """round tower: darker at both sides, highlight band near hx (0..1 across the width)"""
    w = img.shape[1]; t = np.linspace(0, 1, w)
    edge = 1 - k * (np.abs(t - 0.5) * 2) ** 2.2; hl = 1 + hi * np.exp(-((t - hx) / 0.16) ** 2)
    img[..., :3] = np.clip(img[..., :3] * (edge * hl)[None, :, None], 0, 1); return img

def mask_alpha(img, mask):
    img[..., 3] = img[..., 3] * mask; return img

def ao_edge(img, px=10, amt=0.45):
    """darken toward the transparent border of a shape"""
    a = img[..., 3] > 0.5
    d = distance_transform_edt(a); k = np.clip(d / px, 0, 1)
    img[..., :3] = img[..., :3] * (1 - amt + amt * k)[..., None]; return img

def merlons(w, h, mw, gap, base, seed=None, **kw):
    """battlement strip: alternating merlon (solid) / crenel (gap)"""
    img = bricks(h, w, max(6, mw * 0.5), max(5, h * 0.5), base, seed=seed, **kw)
    xx = np.arange(w); on = ((xx // (mw + gap)) * (mw + gap) + mw) > xx
    img[..., 3] = on[None, :].astype(np.float32); return img

def roof(w, h, c1, c2, seed=None, shingle=7):
    """conical/peaked roof tile texture inside a triangle mask, w wide, h tall, apex at the top centre"""
    img = solid(h, w, c1); yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    row = np.floor(yy / shingle); col = np.floor((xx + (row % 2) * shingle * 0.5) / shingle)
    r = np.random.default_rng(seed)
    v = r.random((int(row.max()) + 2, int(col.max()) + 2)).astype(np.float32)[row.astype(int), col.astype(int)]
    edge = np.clip(1 - (yy % shingle) / 1.6, 0, 1)
    rgb = hex2rgb(c1) * (1 - v * 0.35)[..., None] + hex2rgb(c2) * (v * 0.35)[..., None]
    rgb = rgb * (1 - edge * 0.45)[..., None]
    t = np.linspace(0, 1, w); side = (1 - 0.55 * np.abs(t - 0.38) * 2)[None, :, None]
    img[..., :3] = np.clip(rgb * side, 0, 1)
    tri = (np.abs(xx - w / 2) <= (yy / h) * w / 2).astype(np.float32)
    img[..., 3] = tri; return img

def to_pil(img):
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA")

def save(img, path, quant=True):
    im = to_pil(img)
    if quant: im = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).convert("RGBA")
    im.save(path, optimize=True)
