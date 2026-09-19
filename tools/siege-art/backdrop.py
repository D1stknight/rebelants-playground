import sys, numpy as np
from lib import *
from scipy.ndimage import gaussian_filter

W, H = 2048, 900
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32); t = yy / H
# sky gradient: zenith navy → horizon smoky violet-red
top = hex2rgb(0x070b18); mid = hex2rgb(0x1a1c3a); hor = hex2rgb(0x4a2a3c)
sky = np.where((t < 0.55)[..., None], top * (1 - t / 0.55)[..., None] + mid * (t / 0.55)[..., None], mid * (1 - (t - 0.55) / 0.45)[..., None] + hor * ((t - 0.55) / 0.45)[..., None])
sky = sky * (0.9 + 0.2 * noise(H, W, ((2, 1), (6, 0.5)), seed=21))[..., None]
img = np.zeros((H, W, 4), np.float32); img[..., :3] = sky; img[..., 3] = 1
# stars
r = np.random.default_rng(3)
for _ in range(420):
    x, y = int(r.random() * W), int(r.random() * H * 0.62); b = 0.3 + r.random() * 0.7; s = 1 if r.random() < 0.8 else 2
    img[y:y + s, x:x + s, :3] = np.clip(img[y:y + s, x:x + s, :3] + b, 0, 1)
# milky band
band = np.exp(-((yy - (0.18 * H + xx * 0.12)) / 90) ** 2) * 0.10 * noise(H, W, ((3, 1), (12, 0.6)), seed=22)
img[..., :3] = np.clip(img[..., :3] + band[..., None], 0, 1)
# moon + glow at (1640, 190)
mx, my = 1640, 200; d = np.hypot(xx - mx, yy - my)
glow = np.exp(-(d / 260) ** 1.6) * 0.55; img[..., :3] = np.clip(img[..., :3] + glow[..., None] * hex2rgb(0xf2d9a6), 0, 1)
disc = np.clip(1 - (d - 46) / 2.5, 0, 1); craters = 0.85 + 0.15 * noise(H, W, ((40, 1), (120, 0.5)), seed=23)
img[..., :3] = img[..., :3] * (1 - disc)[..., None] + (hex2rgb(0xf6ecd2) * craters[..., None]) * disc[..., None]
# mountains: 3 layers, far → near
def ridge(seed, base, amp, col, fog):
    rr = np.random.default_rng(seed); x = np.arange(W)
    h = base + amp * (0.5 * np.sin(x / 330 + rr.random() * 6) + 0.3 * np.sin(x / 140 + rr.random() * 6) + 0.2 * np.sin(x / 60 + rr.random() * 6) + 0.15 * np.sin(x / 23 + rr.random() * 6))
    m = (yy > (H - h)[None, :]).astype(np.float32)
    c = np.zeros((H, W, 4), np.float32); c[..., :3] = hex2rgb(col); c[..., 3] = m
    # fog toward the ridge line + haze at the bottom
    depth = np.clip((yy - (H - h)[None, :]) / 220, 0, 1)
    c[..., :3] = c[..., :3] * (1 - fog * (1 - depth))[..., None] + hex2rgb(0x3a2a3c) * (fog * (1 - depth))[..., None]
    return c
over(img, ridge(31, 320, 150, 0x232040, 0.5), 0, 0)
over(img, ridge(32, 250, 120, 0x181630, 0.3), 0, 0)
over(img, ridge(33, 190, 80, 0x0f0e1f, 0.15), 0, 0)
# distant burning fields along the horizon — faint orange smudges + smoke
for fx_ in (420, 760, 1180, 1500):
    d = np.hypot((xx - fx_) / 55, (yy - (H - 215)) / 12); f = np.exp(-d ** 2) * 0.32
    img[..., :3] = np.clip(img[..., :3] + f[..., None] * hex2rgb(0xff7a2a), 0, 1)
smoke = np.clip(noise(H, W, ((3, 1), (9, 0.5), (30, 0.3)), seed=24) - 0.45, 0, 1) * np.clip((yy - (H - 320)) / 200, 0, 1) * 0.35
img[..., :3] = img[..., :3] * (1 - smoke)[..., None] + hex2rgb(0x2a2130) * smoke[..., None]
save(img, sys.argv[1] if len(sys.argv) > 1 else "backdrop.png", quant=False)

# ── plain strip: 1024 × 440 (≈ 5.2 m tall at 84 px/m), tiles horizontally
PW, PH = 1024, 440
g = np.zeros((PH, PW, 4), np.float32); g[..., 3] = 1
yy2, xx2 = np.mgrid[0:PH, 0:PW].astype(np.float32)
n1 = noise(PH, PW, ((6, 1), (24, 0.6), (80, 0.4)), seed=41); n2 = noise(PH, PW, ((40, 1), (160, 0.5)), seed=42)
earth = hex2rgb(0x2a2119) * (0.75 + n1 * 0.5)[..., None] + hex2rgb(0x3a3324) * (n2 * 0.35)[..., None]
# make it tile: blend with the horizontally shifted copy
earth = 0.5 * earth + 0.5 * np.roll(earth, PW // 2, axis=1) * (0.9 + 0.2 * np.roll(n2, PW // 2, axis=1))[..., None]
g[..., :3] = earth
# trampled dark path band near the top (where the horde runs), stones scattered
g[..., :3] *= (1 - 0.25 * np.exp(-((yy2 - 40) / 40) ** 2))[..., None]
rr = np.random.default_rng(43)
for _ in range(48):
    x, y, rad = rr.random() * PW, 20 + rr.random() * (PH - 40), 3 + rr.random() * 9
    d = np.hypot(xx2 - x, (yy2 - y) * 1.8); st = np.clip(1 - (d - rad) / 1.5, 0, 1)
    sh = np.clip(1 - (np.hypot(xx2 - x - rad * 0.4, (yy2 - y - rad * 0.4) * 1.8) - rad) / 3, 0, 1) * 0.5
    g[..., :3] = g[..., :3] * (1 - sh)[..., None]
    g[..., :3] = g[..., :3] * (1 - st)[..., None] + hex2rgb(0x4d4a52)[None, None, :] * (0.7 + 0.5 * (yy2 - y + rad) / (2 * rad))[..., None] * st[..., None]
# top edge: a lit rim (the plain's surface catches moonlight) fading down to shadow
g[..., :3] *= (1 + 0.45 * np.exp(-(yy2 / 9) ** 2) - 0.45 * (yy2 / PH))[..., None]
g[..., :3] = np.clip(g[..., :3] + grain(PH, PW, 0.02, 44)[..., None], 0, 1)
save(g, sys.argv[2] if len(sys.argv) > 2 else "plain.png")
print("ok")
