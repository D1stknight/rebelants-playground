# paints the citadel composite for the side view: world metres → px at PPM, y-up world mapped to y-down canvas (canvas top = WORLD_H)
import sys, numpy as np
from lib import *

PPM = 84; WORLD_H = 22; W_M = 15.6
W, H = int(W_M * PPM), int(WORLD_H * PPM)
C = np.zeros((H, W, 4), np.float32)
def X(m): return int(round(m * PPM))
def Y(m): return int(round((WORLD_H - m) * PPM))       # top of a thing at height m
def put(img, xm, ytop_m): over(C, img, X(xm), Y(ytop_m))

STONE = 0x3b4256; STONE_D = 0x2e3446; STONE_L = 0x4a5268; MORTAR = 0x161a24

# ── 1. gate towers (back), x 12.3–15.2, y 11.0–16.0, battlements to 16.8
gt = bricks(Y(11.0) - Y(16.0), X(15.2) - X(12.3), 34, 20, STONE_D, mortar=MORTAR, seed=1, grime=0.3)
shade_horizontal(gt, 0.95, 0.72); shade_vertical(gt, 1.0, 0.8)
# arrow slits
for yy in (12.6, 14.4):
    for xx in (12.9, 14.3):
        s = solid(int(0.7 * PPM), int(0.14 * PPM), 0x07080c); over(gt, s, X(xx) - X(12.3), Y(yy + 0.7) - Y(16.0))
put(gt, 12.3, 16.0)
put(merlons(X(15.2) - X(12.3), int(0.8 * PPM), int(0.42 * PPM), int(0.3 * PPM), STONE_D, seed=2, mortar=MORTAR), 12.3, 16.8)
# stone cap ledge under the battlements
put(solid(int(0.12 * PPM), X(15.2) - X(12.3), STONE_L), 12.3, 16.0)

# ── 2. keep: main tower x 1.0–6.4 y 9–19.2 + roof; tower2 x 7.4–10.6 y 10–16.6 + roof
kt = bricks(Y(9) - Y(19.2), X(6.4) - X(1.0), 30, 18, STONE, mortar=MORTAR, seed=3, grime=0.25)
cylinder_shade(kt, 0.5, 0.3, 0.3); shade_vertical(kt, 1.0, 0.72)
for yy in (11.2, 14.0, 16.8):
    for xx in (2.4, 4.2):
        s = solid(int(0.9 * PPM), int(0.18 * PPM), 0x07080c); over(kt, s, X(xx) - X(1.0), Y(yy + 0.9) - Y(19.2))
        g = solid(int(0.5 * PPM), int(0.18 * PPM), 0xffb347, 0.9); over(kt, g, X(xx) - X(1.0), Y(yy + 0.7) - Y(19.2))   # lit window
put(kt, 1.0, 19.2)
put(merlons(X(6.4) - X(1.0), int(0.7 * PPM), int(0.4 * PPM), int(0.28 * PPM), STONE, seed=4, mortar=MORTAR), 1.0, 19.9)
put(solid(int(0.12 * PPM), X(6.4) - X(1.0), STONE_L), 1.0, 19.2)
rf = roof(X(6.8) - X(0.8), Y(19.9) - Y(21.9), 0x3a2a4f, 0x6a4a8a, seed=5, shingle=9); put(rf, 0.8, 21.9)
kt2 = bricks(Y(10) - Y(16.6), X(10.6) - X(7.4), 28, 17, STONE, mortar=MORTAR, seed=6, grime=0.3)
cylinder_shade(kt2, 0.5, 0.3, 0.3); shade_vertical(kt2, 1.0, 0.75)
for yy in (12.4, 14.6):
    s = solid(int(0.8 * PPM), int(0.16 * PPM), 0x07080c); over(kt2, s, X(8.9) - X(7.4), Y(yy + 0.8) - Y(16.6))
    g = solid(int(0.45 * PPM), int(0.16 * PPM), 0xffb347, 0.9); over(kt2, g, X(8.9) - X(7.4), Y(yy + 0.62) - Y(16.6))
put(kt2, 7.4, 16.6)
put(merlons(X(10.6) - X(7.4), int(0.65 * PPM), int(0.38 * PPM), int(0.26 * PPM), STONE, seed=7, mortar=MORTAR), 7.4, 17.25)
put(solid(int(0.12 * PPM), X(10.6) - X(7.4), STONE_L), 7.4, 16.6)
rf2 = roof(X(11.0) - X(7.0), Y(17.25) - Y(19.0), 0x4a2030, 0x8a3a4a, seed=8, shingle=8); put(rf2, 7.0, 19.0)

# ── 3. far parapet of the walkway x 0–12.3 y 11.5–13.1 + merlons to 13.75
pp = bricks(Y(11.5) - Y(13.1), X(12.3), 26, 16, STONE_D, mortar=MORTAR, seed=9, grime=0.3); shade_vertical(pp, 0.95, 0.8)
put(pp, 0, 13.1)
put(merlons(X(12.3), int(0.65 * PPM), int(0.4 * PPM), int(0.3 * PPM), STONE_D, seed=10, mortar=MORTAR), 0, 13.75)
put(solid(int(0.1 * PPM), X(12.3), STONE_L), 0, 13.1)

# ── 4. main wall body x 0–15.2 y 2.2–11.3 — big weathered blocks, moss at the base
wb = bricks(Y(2.2) - Y(11.3), X(15.2), 44, 26, STONE, mortar=MORTAR, seed=11, grime=0.4, moss=0.32, var=0.11)
shade_vertical(wb, 1.02, 0.66, 1.4); shade_horizontal(wb, 0.92, 1.0)
# buttresses
for bx in (2.6, 6.6, 10.4):
    b = bricks(Y(2.2) - Y(11.3), int(0.7 * PPM), 30, 26, STONE_L, mortar=MORTAR, seed=int(bx * 10), grime=0.3, moss=0.3)
    shade_horizontal(b, 1.08, 0.7); shade_vertical(b, 1.0, 0.68, 1.4); over(wb, b, X(bx), 0)
    sh = solid(Y(2.2) - Y(11.3), int(0.16 * PPM), 0x000000, 0.35); over(wb, sh, X(bx) + int(0.7 * PPM), 0)   # cast shadow
# arrow slits on the wall
for xx in (4.6, 8.6, 12.0):
    s = solid(int(1.0 * PPM), int(0.16 * PPM), 0x07080c); over(wb, s, X(xx), Y(9.6) - Y(11.3))
# the gate: arched opening x 13.15–15.05, y 2.2–7.4
gw, gh = X(15.05) - X(13.15), Y(2.2) - Y(7.4)
gate = np.zeros((gh, gw, 4), np.float32)
yy, xx = np.mgrid[0:gh, 0:gw].astype(np.float32); r = gw / 2
arch = ((yy >= r) | ((xx - r) ** 2 + (yy - r) ** 2 <= r * r)).astype(np.float32)
# stone arch ring
ring = bricks(gh, gw, 22, 16, STONE_L, mortar=MORTAR, seed=12, grime=0.2); ring[..., 3] = arch
put_ring = ring
inner = ((yy >= r) | ((xx - r) ** 2 + (yy - r) ** 2 <= (r - 0.22 * PPM) ** 2)) & (xx > 0.22 * PPM) & (xx < gw - 0.22 * PPM)
# wooden door: vertical planks + iron bands
door = solid(gh, gw, 0x2a1a10); pl = ((xx // int(0.24 * PPM)) % 2) * 0.12; door[..., :3] *= (0.85 + pl)[..., None]
door[..., :3] *= (0.55 + 0.45 * noise(gh, gw, ((4, 1), (30, 0.4)), seed=13))[..., None]
door[..., :3] *= (1 - (yy / gh) * 0.35)[..., None]
for by in (0.45, 0.62, 0.8):
    band = solid(int(0.12 * PPM), gw, 0x1c1c22); over(door, band, 0, int(gh * by))
    for bx in np.linspace(0.08, 0.92, 7):
        riv = solid(int(0.06 * PPM), int(0.06 * PPM), 0x6a6a72); over(door, riv, int(gw * bx), int(gh * by) + int(0.03 * PPM))
# portcullis teeth at the top of the door
for gx in np.linspace(0.1, 0.9, 6):
    t = solid(int(1.6 * PPM), int(0.07 * PPM), 0x14141a); over(door, t, int(gw * gx), int(0.2 * PPM))
door[..., 3] = inner.astype(np.float32)
over(gate, put_ring, 0, 0); over(gate, door, 0, 0)
# darkness inside the arch (depth)
dk = solid(gh, gw, 0x000000, 0.0); dk[..., 3] = inner * np.clip(1 - yy / (gh * 0.5), 0, 1) * 0.6; over(gate, dk, 0, 0)
over(wb, gate, X(13.15), Y(7.4) - Y(11.3))
put(wb, 0, 11.3)
# walkway slab (top edge of the wall) x 0–15.2, y 11.3–11.6
slab = bricks(Y(11.3) - Y(11.6), X(15.2), 60, 40, STONE_L, mortar=MORTAR, seed=14, grime=0.2); shade_vertical(slab, 1.15, 0.85)
put(slab, 0, 11.6)
# subtle top highlight line
put(solid(3, X(15.2), 0x8a93a8, 0.6), 0, 11.6)
# the corner of the wall toward the horde: darker edge + AO band along the bottom (ground contact)
ao = np.zeros((Y(2.2) - Y(3.4), X(15.2), 4), np.float32); ao[..., 3] = np.linspace(0, 0.55, ao.shape[0])[:, None]; put(ao, 0, 3.4)

save(C, sys.argv[1] if len(sys.argv) > 1 else "/home/claude/siege/paint/citadel.png")
print("citadel", W, H)
