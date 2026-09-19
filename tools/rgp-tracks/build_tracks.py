#!/usr/bin/env python3
"""Rebel Grand Prix track builder.
Each track = closed Catmull-Rom spline (control points in a 1024x1024 world) painted into
  map.png   1024x1024 RGB  what the Mode-7 renderer samples
  surf.png  1024x1024 L    surface id per pixel (see SURF)
  track.json  centerline samples (for AI / progress / respawn), start grid, item boxes, boost pads, hazards, decor
Usage: python3 build_tracks.py [trackId ...]   (defaults to all)  -> public/rgp/tracks/<id>/
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W = 1024
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "rgp", "tracks")
SURF = {"grass": 0, "road": 1, "shoulder": 2, "boost": 3, "wall": 4, "liquid": 5, "sand": 6, "slick": 7}

BIOMES = {
  "jungle":   dict(grass=(38, 92, 52), grass2=(30, 76, 44), road=(74, 66, 60), shoulder=(104, 78, 48), edge=((226, 200, 84), (206, 62, 62)), liquid=(36, 78, 160), liquid2=(60, 110, 200), wall=(70, 60, 50), sand=(160, 140, 90), sky="jungle", decor=["tree", "tree", "rock", "mushroom"]),
  "sewers":   dict(grass=(40, 48, 44), grass2=(34, 40, 38), road=(62, 66, 72), shoulder=(52, 56, 52), edge=((120, 220, 160), (60, 60, 70)), liquid=(60, 150, 50), liquid2=(110, 210, 80), wall=(88, 92, 100), sand=(90, 84, 70), sky="sewers", decor=["pipe", "pipe", "barrel", "rock"]),
  "fortress": dict(grass=(96, 72, 52), grass2=(84, 62, 44), road=(88, 80, 78), shoulder=(120, 96, 70), edge=((240, 170, 60), (80, 30, 20)), liquid=(200, 70, 20), liquid2=(255, 150, 40), wall=(120, 110, 100), sand=(150, 120, 80), sky="fortress", decor=["torch", "pillar", "rock", "torch"]),
  "throne":   dict(grass=(52, 24, 64), grass2=(42, 18, 54), road=(70, 56, 84), shoulder=(96, 60, 120), edge=((255, 100, 220), (120, 40, 140)), liquid=(150, 30, 160), liquid2=(220, 90, 240), wall=(110, 70, 130), sand=(120, 90, 130), sky="throne", decor=["crystal", "crystal", "egg", "pillar"]),
  "garden":   dict(grass=(60, 140, 60), grass2=(50, 122, 50), road=(150, 140, 120), shoulder=(120, 100, 70), edge=((255, 255, 255), (220, 60, 60)), liquid=(60, 140, 220), liquid2=(120, 190, 250), wall=(140, 120, 100), sand=(200, 180, 120), sky="garden", decor=["flower", "flower", "fence", "rock"]),
}

def catmull(pts, n):
  """closed Catmull-Rom, n samples total"""
  P = np.array(pts, dtype=float); m = len(P); out = []
  per = n // m
  for i in range(m):
    p0, p1, p2, p3 = P[(i - 1) % m], P[i], P[(i + 1) % m], P[(i + 2) % m]
    for k in range(per):
      t = k / per; t2 = t * t; t3 = t2 * t
      out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
  return np.array(out)

def resample(pts, step):
  """resample closed polyline to ~equal arc length"""
  P = np.vstack([pts, pts[:1]]); seg = np.linalg.norm(np.diff(P, axis=0), axis=1); L = seg.sum(); n = max(64, int(L / step))
  cum = np.concatenate([[0], np.cumsum(seg)]); ts = np.linspace(0, L, n, endpoint=False); out = []
  for t in ts:
    i = np.searchsorted(cum, t, side="right") - 1; i = min(i, len(seg) - 1); f = (t - cum[i]) / max(1e-6, seg[i]); out.append(P[i] * (1 - f) + P[i + 1] * f)
  return np.array(out), L

def lobes(cx, cy, r, n, wobble, seed, squash=0.85, phase=0.0):
  rng = np.random.default_rng(seed); pts = []
  for i in range(n):
    a = phase + i / n * 2 * math.pi; rr = r * (1 + wobble * rng.uniform(-1, 1))
    pts.append((cx + rr * math.cos(a), cy + rr * squash * math.sin(a)))
  return pts

# ---- the 15 tracks: 5 cups × 3 --------------------------------------------------------------------------
# hazards: spider (patrol between two centerline t's, offset side), crusher (timed stomp zone at t), geyser (timed at t), boulder (rolls across at t)
TRACKS = [
  # Jungle Cup
  dict(id="j1", cup=1, n=1,  name="Canopy Loop",      biome="jungle",   pts=lobes(512, 512, 330, 8, 0.10, 11), width=92, laps=3, boosts=[0.30, 0.72], boxes=[0.15, 0.55, 0.85], hazards=[], pools=[(0.42, 1, 60)], diff=1),
  dict(id="j2", cup=1, n=2,  name="River Bend",       biome="jungle",   pts=lobes(512, 512, 340, 10, 0.18, 12), width=84, laps=3, boosts=[0.25, 0.6], boxes=[0.1, 0.45, 0.8], hazards=[dict(kind="spider", t=0.35, span=0.05), dict(kind="spider", t=0.7, span=0.04)], pools=[(0.5, -1, 70), (0.9, 1, 50)], diff=2),
  dict(id="j3", cup=1, n=3,  name="Grub Hollow GP",   biome="jungle",   pts=lobes(512, 512, 350, 12, 0.24, 13, squash=0.8), width=78, laps=3, boosts=[0.2, 0.5, 0.8], boxes=[0.12, 0.4, 0.66, 0.9], hazards=[dict(kind="spider", t=0.3, span=0.06), dict(kind="boulder", t=0.58), dict(kind="spider", t=0.82, span=0.05)], pools=[(0.25, 1, 60), (0.7, -1, 70)], diff=3),
  # Sewer Cup
  dict(id="s1", cup=2, n=4,  name="Drain Circuit",    biome="sewers",   pts=lobes(512, 512, 340, 9, 0.16, 21), width=80, laps=3, boosts=[0.35, 0.8], boxes=[0.15, 0.5, 0.85], hazards=[dict(kind="crusher", t=0.28), dict(kind="crusher", t=0.62)], pools=[(0.45, 1, 80)], walls=True, diff=4),
  dict(id="s2", cup=2, n=5,  name="Acid Run",         biome="sewers",   pts=lobes(512, 512, 350, 11, 0.22, 22, squash=0.9), width=74, laps=3, boosts=[0.2, 0.55], boxes=[0.1, 0.4, 0.7, 0.9], hazards=[dict(kind="crusher", t=0.2), dict(kind="spider", t=0.5, span=0.06), dict(kind="crusher", t=0.75)], pools=[(0.3, -1, 90), (0.65, 1, 90)], walls=True, diff=5),
  dict(id="s3", cup=2, n=6,  name="The Sump 500",     biome="sewers",   pts=lobes(512, 512, 355, 13, 0.26, 23, squash=0.82), width=70, laps=3, boosts=[0.15, 0.45, 0.75], boxes=[0.08, 0.35, 0.6, 0.88], hazards=[dict(kind="crusher", t=0.18), dict(kind="crusher", t=0.4), dict(kind="boulder", t=0.55), dict(kind="spider", t=0.8, span=0.07)], pools=[(0.28, 1, 100), (0.5, -1, 80), (0.92, 1, 70)], walls=True, diff=6),
  # Fortress Cup
  dict(id="f1", cup=3, n=7,  name="Outer Wall Sprint", biome="fortress", pts=lobes(512, 512, 345, 8, 0.14, 31, squash=0.9), width=82, laps=3, boosts=[0.3, 0.7], boxes=[0.15, 0.5, 0.85], hazards=[dict(kind="geyser", t=0.4), dict(kind="geyser", t=0.75)], pools=[(0.55, 1, 70)], diff=7),
  dict(id="f2", cup=3, n=8,  name="Cannon Gallery",   biome="fortress", pts=lobes(512, 512, 350, 10, 0.2, 32), width=76, laps=3, boosts=[0.25, 0.6, 0.9], boxes=[0.1, 0.4, 0.7], hazards=[dict(kind="boulder", t=0.3), dict(kind="geyser", t=0.5), dict(kind="boulder", t=0.72), dict(kind="spider", t=0.9, span=0.05)], pools=[(0.2, -1, 80), (0.62, 1, 80)], diff=8),
  dict(id="f3", cup=3, n=9,  name="Warden's Keep",    biome="fortress", pts=lobes(512, 512, 360, 12, 0.26, 33, squash=0.8), width=70, laps=3, boosts=[0.2, 0.5, 0.8], boxes=[0.1, 0.35, 0.6, 0.85], hazards=[dict(kind="geyser", t=0.15), dict(kind="crusher", t=0.35), dict(kind="boulder", t=0.55), dict(kind="geyser", t=0.7), dict(kind="spider", t=0.88, span=0.06)], pools=[(0.27, 1, 90), (0.45, -1, 90), (0.78, 1, 80)], walls=True, diff=9),
  # Throne Cup
  dict(id="t1", cup=4, n=10, name="Brood Chambers",   biome="throne",   pts=lobes(512, 512, 350, 9, 0.18, 41), width=78, laps=3, boosts=[0.3, 0.75], boxes=[0.15, 0.5, 0.85], hazards=[dict(kind="spider", t=0.3, span=0.07), dict(kind="crusher", t=0.65)], pools=[(0.45, -1, 90)], walls=True, diff=10),
  dict(id="t2", cup=4, n=11, name="Royal Gauntlet",   biome="throne",   pts=lobes(512, 512, 355, 11, 0.24, 42, squash=0.85), width=72, laps=3, boosts=[0.2, 0.55, 0.85], boxes=[0.1, 0.4, 0.7], hazards=[dict(kind="crusher", t=0.2), dict(kind="boulder", t=0.4), dict(kind="geyser", t=0.6), dict(kind="spider", t=0.8, span=0.07)], pools=[(0.3, 1, 100), (0.68, -1, 90)], walls=True, diff=11),
  dict(id="t3", cup=4, n=12, name="Corrupted Throne", biome="throne",   pts=lobes(512, 512, 365, 13, 0.28, 43, squash=0.8), width=66, laps=3, boosts=[0.15, 0.45, 0.75], boxes=[0.08, 0.3, 0.55, 0.8], hazards=[dict(kind="crusher", t=0.12), dict(kind="spider", t=0.3, span=0.08), dict(kind="boulder", t=0.48), dict(kind="geyser", t=0.62), dict(kind="crusher", t=0.78), dict(kind="spider", t=0.92, span=0.06)], pools=[(0.22, -1, 100), (0.4, 1, 100), (0.7, -1, 90)], walls=True, diff=12),
  # Garden Cup (surface world)
  dict(id="g1", cup=5, n=13, name="Picnic Table",     biome="garden",   pts=lobes(512, 512, 340, 8, 0.12, 51, squash=0.9), width=84, laps=3, boosts=[0.3, 0.7], boxes=[0.15, 0.5, 0.85], hazards=[dict(kind="boulder", t=0.4), dict(kind="boulder", t=0.8)], pools=[(0.55, 1, 80)], diff=13),
  dict(id="g2", cup=5, n=14, name="Lawnmower Alley",  biome="garden",   pts=lobes(512, 512, 350, 10, 0.2, 52), width=74, laps=3, boosts=[0.25, 0.6, 0.9], boxes=[0.1, 0.4, 0.7], hazards=[dict(kind="boulder", t=0.2), dict(kind="spider", t=0.45, span=0.08), dict(kind="boulder", t=0.65), dict(kind="geyser", t=0.85)], pools=[(0.32, -1, 90), (0.75, 1, 90)], diff=14),
  dict(id="g3", cup=5, n=15, name="Rebel Grand Prix", biome="garden",   pts=lobes(512, 512, 365, 13, 0.28, 53, squash=0.82), width=64, laps=3, boosts=[0.15, 0.4, 0.65, 0.9], boxes=[0.08, 0.3, 0.55, 0.8], hazards=[dict(kind="boulder", t=0.1), dict(kind="crusher", t=0.28), dict(kind="spider", t=0.42, span=0.08), dict(kind="geyser", t=0.58), dict(kind="boulder", t=0.72), dict(kind="crusher", t=0.88)], pools=[(0.2, 1, 100), (0.5, -1, 100), (0.8, 1, 90)], walls=True, diff=15),
]

def build(tr):
  b = BIOMES[tr["biome"]]; rng = np.random.default_rng(tr["n"] * 977)
  center, L = resample(catmull(tr["pts"], 1200), 6.0)          # ~6px spacing
  N = len(center)
  tang = np.roll(center, -1, axis=0) - np.roll(center, 1, axis=0); tang /= np.linalg.norm(tang, axis=1)[:, None]
  norm = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
  wid = tr["width"]

  vis = Image.new("RGB", (W, W), b["grass"]); vd = ImageDraw.Draw(vis)
  surf = Image.new("L", (W, W), SURF["grass"]); sd = ImageDraw.Draw(surf)
  # grass noise + patches
  g = np.array(vis).astype(np.int16); noise = np.kron(rng.integers(-7, 8, (W // 8, W // 8, 1)), np.ones((8, 8, 1), dtype=np.int16)); g = np.clip(g + noise, 0, 255)
  vis = Image.fromarray(g.astype(np.uint8)); vd = ImageDraw.Draw(vis)
  for _ in range(90):
    x, y = rng.uniform(0, W, 2); r = rng.uniform(12, 50); vd.ellipse([x - r, y - r, x + r, y + r], fill=b["grass2"])

  def stroke(pts, w, col, img_d, sid=None):
    for i in range(len(pts)):
      a = pts[i]; c = pts[(i + 1) % len(pts)]
      img_d.line([tuple(a), tuple(c)], fill=col, width=w); img_d.ellipse([a[0] - w / 2, a[1] - w / 2, a[0] + w / 2, a[1] + w / 2], fill=col)
  # off-track pools (liquid hazards) beside the road
  for (t, side, r) in tr.get("pools", []):
    i = int(t * N) % N; p = center[i] + norm[i] * side * (wid / 2 + 26 + r * 0.6)
    vd.ellipse([p[0] - r, p[1] - r * 0.7, p[0] + r, p[1] + r * 0.7], fill=b["liquid"]); vd.ellipse([p[0] - r * 0.6, p[1] - r * 0.4, p[0] + r * 0.5, p[1] + r * 0.3], fill=b["liquid2"])
    sd.ellipse([p[0] - r, p[1] - r * 0.7, p[0] + r, p[1] + r * 0.7], fill=SURF["liquid"])
  # shoulder + road
  stroke(center, wid + 26, b["shoulder"], vd); stroke(center, wid + 26, SURF["shoulder"], sd)
  stroke(center, wid, b["road"], vd); stroke(center, wid, SURF["road"], sd)
  # road texture
  a = np.array(vis).astype(np.int16); sm = np.array(surf); road = sm == SURF["road"]
  a = np.where(road[:, :, None], a + np.kron(rng.integers(-5, 6, (W // 4, W // 4, 1)), np.ones((4, 4, 1), dtype=np.int16)), a); vis = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)); vd = ImageDraw.Draw(vis)
  # edge stripes
  for i in range(0, N, 2):
    for s in (1, -1):
      col = b["edge"][0] if (i // 6) % 2 == 0 else b["edge"][1]
      p = center[i] + norm[i] * s * (wid / 2 - 3); q = center[(i + 2) % N] + norm[(i + 2) % N] * s * (wid / 2 - 3)
      vd.line([tuple(p), tuple(q)], fill=col, width=4)
  # walls (sewers/fortress/throne): a thin solid rim outside the shoulder
  if tr.get("walls"):
    for i in range(0, N, 1):
      for s in (1, -1):
        p = center[i] + norm[i] * s * (wid / 2 + 15); q = center[(i + 1) % N] + norm[(i + 1) % N] * s * (wid / 2 + 15)
        vd.line([tuple(p), tuple(q)], fill=b["wall"], width=6); sd.line([tuple(p), tuple(q)], fill=SURF["wall"], width=6)
  # start line at t=0, grid behind it
  i0 = 0; t0 = tang[i0]; n0 = norm[i0]
  for k in range(-int(wid / 2 / 8), int(wid / 2 / 8)):
    for j in range(2):
      col = (240, 240, 240) if (k + j) % 2 == 0 else (24, 24, 24)
      c = center[i0] + n0 * k * 8 + t0 * j * 8; vd.rectangle([c[0] - 4, c[1] - 4, c[0] + 4, c[1] + 4], fill=col)
  # boost pads
  boosts = []
  for t in tr["boosts"]:
    i = int(t * N) % N
    for s in (-0.5, 0.5):
      p = center[i] + norm[i] * s * wid * 0.45
      vd.ellipse([p[0] - 13, p[1] - 13, p[0] + 13, p[1] + 13], fill=(70, 200, 255)); sd.ellipse([p[0] - 13, p[1] - 13, p[0] + 13, p[1] + 13], fill=SURF["boost"])
      tip = p + tang[i] * 9; bl = p - tang[i] * 7 + norm[i] * 7; br = p - tang[i] * 7 - norm[i] * 7; vd.polygon([tuple(tip), tuple(bl), tuple(br)], fill=(255, 255, 255))
      boosts.append([float(p[0]), float(p[1])])
  # item boxes (rows of 3 across the road)
  boxes = []
  for t in tr["boxes"]:
    i = int(t * N) % N
    for s in (-0.6, 0, 0.6):
      p = center[i] + norm[i] * s * wid * 0.4; boxes.append([float(p[0]), float(p[1])])
  # hazards resolved to world coords
  haz = []
  for h in tr["hazards"]:
    i = int(h["t"] * N) % N; p = center[i]
    if h["kind"] == "spider":
      j = int((h["t"] + h.get("span", 0.05)) * N) % N; haz.append(dict(kind="spider", a=[float(p[0] + norm[i][0] * wid * 0.35), float(p[1] + norm[i][1] * wid * 0.35)], b=[float(center[j][0] - norm[j][0] * wid * 0.35), float(center[j][1] - norm[j][1] * wid * 0.35)], period=3.2 + 0.3 * (h["t"] * 10 % 3)))
    elif h["kind"] == "crusher":
      haz.append(dict(kind="crusher", x=float(p[0]), y=float(p[1]), r=wid * 0.34, period=2.4, phase=float(h["t"] * 7 % 1)))
      vd.ellipse([p[0] - wid * 0.34, p[1] - wid * 0.34, p[0] + wid * 0.34, p[1] + wid * 0.34], outline=(200, 60, 60), width=4)
    elif h["kind"] == "geyser":
      haz.append(dict(kind="geyser", x=float(p[0] + norm[i][0] * wid * 0.2), y=float(p[1] + norm[i][1] * wid * 0.2), r=wid * 0.22, period=3.0, phase=float(h["t"] * 5 % 1)))
      q = p + norm[i] * wid * 0.2; vd.ellipse([q[0] - wid * 0.22, q[1] - wid * 0.22, q[0] + wid * 0.22, q[1] + wid * 0.22], fill=(90, 60, 50), outline=(255, 120, 40), width=3)
    elif h["kind"] == "boulder":
      haz.append(dict(kind="boulder", a=[float(p[0] + norm[i][0] * (wid / 2 + 30)), float(p[1] + norm[i][1] * (wid / 2 + 30))], b=[float(p[0] - norm[i][0] * (wid / 2 + 30)), float(p[1] - norm[i][1] * (wid / 2 + 30))], period=3.6))
  # decor along both sides (billboards) — a few per 100px of track, pushed off the shoulder
  decor = []
  for i in range(0, N, 9):
    for s in (1, -1):
      if rng.random() < 0.55:
        d = wid / 2 + 30 + rng.uniform(0, 90); p = center[i] + norm[i] * s * d
        if 20 < p[0] < W - 20 and 20 < p[1] < W - 20 and surf.getpixel((int(p[0]), int(p[1]))) == SURF["grass"]:
          decor.append([float(p[0]), float(p[1]), b["decor"][int(rng.integers(0, len(b["decor"])))]])
  # start grid: 8 slots, 2 wide, behind the line (negative t)
  grid = []
  for k in range(8):
    back = 22 + (k // 2) * 26; side = (-1 if k % 2 == 0 else 1) * wid * 0.22
    j = (i0 - int(back / 6)) % N; p = center[j] + norm[j] * side; grid.append([float(p[0]), float(p[1])])
  heading = float(math.atan2(t0[1], t0[0]))

  outdir = os.path.join(OUT, tr["id"]); os.makedirs(outdir, exist_ok=True)
  vis.convert("RGB").quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(outdir, "map.png"), optimize=True); surf.save(os.path.join(outdir, "surf.png"), optimize=True, bits=4)
  meta = dict(id=tr["id"], name=tr["name"], cup=tr["cup"], n=tr["n"], biome=tr["biome"], sky=b["sky"], laps=tr["laps"], width=wid, length=float(L), diff=tr["diff"],
              center=[[round(float(x), 1), round(float(y), 1)] for x, y in center[::2]], heading=heading, grid=grid, boosts=boosts, boxes=boxes, hazards=haz, decor=decor)
  json.dump(meta, open(os.path.join(outdir, "track.json"), "w"), separators=(",", ":"))
  # thumbnail for the lobby / minimap
  vis.resize((256, 256), Image.BOX).save(os.path.join(outdir, "thumb.png"), optimize=True)
  print(tr["id"], tr["name"], f"len={L:.0f}px samples={N} decor={len(decor)} hazards={len(haz)}", os.path.getsize(os.path.join(outdir, 'map.png')) // 1024, "KB")

if __name__ == "__main__":
  ids = sys.argv[1:]
  for tr in TRACKS:
    if not ids or tr["id"] in ids: build(tr)
