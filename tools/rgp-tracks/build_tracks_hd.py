#!/usr/bin/env python3
"""Rebel Grand Prix — broadcast-quality ground maps (map_hd.webp, 2048²) painted over the same geometry as build_tracks.py.

Physics stay in surf.png / track.json (build_tracks.py); this only repaints what the Mode-7 renderer samples, like a real
F1 circuit seen from the TV helicopter: mown grass, gravel run-off, fine asphalt with a rubbered racing line, white track
limits, red/white kerbs on every corner, a chequered start line with grid boxes, armco / tyre-wall barriers and painted
run-off logos. Painted at 4096 and downsampled for clean anti-aliased edges.
  python3 build_tracks_hd.py [trackId ...]  ->  public/rgp/tracks/<id>/map_hd.webp
"""
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(__file__))
from build_tracks import TRACKS, BIOMES, catmull, resample, OUT, W

HD = 2048            # output texels (2 per world unit)
SS = 4096            # paint resolution
K = SS / W           # world → paint px
FONT = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"

# circuit palette per biome: grass A/B (mowing stripes), gravel, asphalt, barrier, kerb colours
PAL = {
  "jungle":   dict(gA=(52, 116, 58), gB=(44, 102, 50), gravel=(176, 150, 104), asph=(64, 64, 68), barrier=(210, 210, 214), kerb=((214, 36, 40), (244, 244, 244)), logo=(232, 232, 232)),
  "sewers":   dict(gA=(46, 58, 54), gB=(40, 51, 48), gravel=(98, 96, 86), asph=(58, 60, 66), barrier=(150, 156, 166), kerb=((214, 36, 40), (240, 240, 240)), logo=(120, 220, 160)),
  "fortress": dict(gA=(110, 84, 60), gB=(98, 74, 52), gravel=(170, 136, 96), asph=(70, 66, 66), barrier=(190, 180, 170), kerb=((214, 36, 40), (244, 244, 244)), logo=(250, 190, 90)),
  "throne":   dict(gA=(60, 30, 74), gB=(52, 24, 64), gravel=(118, 88, 128), asph=(62, 56, 72), barrier=(170, 130, 190), kerb=((226, 60, 190), (246, 240, 250)), logo=(255, 120, 230)),
  "garden":   dict(gA=(74, 152, 70), gB=(62, 136, 60), gravel=(206, 184, 130), asph=(78, 78, 82), barrier=(230, 230, 230), kerb=((214, 36, 40), (246, 246, 246)), logo=(255, 255, 255)),
}

def P(p): return (float(p[0]) * K, float(p[1]) * K)

def noise(shape, scale, amp, rng):
    """value noise: random grid upsampled bilinearly"""
    h, w = shape; gh, gw = max(2, h // scale + 2), max(2, w // scale + 2)
    g = rng.uniform(-amp, amp, (gh, gw)).astype(np.float32)
    return np.array(Image.fromarray(g).resize((w + scale, h + scale), Image.BILINEAR))[:h, :w]

def build(tr):
    b = BIOMES[tr["biome"]]; pal = PAL[tr["biome"]]; rng = np.random.default_rng(tr["n"] * 977 + 5)
    center, L = resample(catmull(tr["pts"], 1200), 6.0); N = len(center)
    tang = np.roll(center, -1, axis=0) - np.roll(center, 1, axis=0); tang /= np.linalg.norm(tang, axis=1)[:, None]
    norm = np.stack([-tang[:, 1], tang[:, 0]], axis=1); wid = tr["width"]
    # signed curvature (smoothed): + turns toward +norm
    cross = tang[:, 0] * np.roll(tang, -1, axis=0)[:, 1] - tang[:, 1] * np.roll(tang, -1, axis=0)[:, 0]
    curv = np.convolve(np.concatenate([cross[-8:], cross, cross[:8]]), np.ones(17) / 17, "same")[8:-8] / 6.0

    # ── grass with mowing stripes (diagonal bands in world space) + soft variation
    Y, X = np.mgrid[0:SS, 0:SS].astype(np.float32) / K
    band = (np.floor((X * 0.8 + Y * 0.6) / 22) % 2)[..., None]
    img = np.array(pal["gA"], np.float32)[None, None] * (1 - band) + np.array(pal["gB"], np.float32)[None, None] * band
    img += noise((SS, SS), 96, 6, rng)[..., None] + noise((SS, SS), 6, 3, rng)[..., None]
    del X, Y, band
    vis = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); del img
    vd = ImageDraw.Draw(vis)
    # masks for texturing: gravel (shoulder), asphalt (road)
    mg = Image.new("L", (SS, SS), 0); mgd = ImageDraw.Draw(mg)
    mr = Image.new("L", (SS, SS), 0); mrd = ImageDraw.Draw(mr)

    def stroke(d, w, col):
        for i in range(N):
            a, c = P(center[i]), P(center[(i + 1) % N]); d.line([a, c], fill=col, width=int(w * K)); r = w * K / 2; d.ellipse([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=col)

    # pools (liquid) — same placement as build_tracks
    for (t, side, r) in tr.get("pools", []):
        i = int(t * N) % N; p = center[i] + norm[i] * side * (wid / 2 + 26 + r * 0.6)
        x, y = P(p); R = r * K
        vd.ellipse([x - R - 6 * K, y - R * 0.7 - 6 * K, x + R + 6 * K, y + R * 0.7 + 6 * K], fill=tuple(int(c * 0.6) for c in b["liquid"]))
        vd.ellipse([x - R, y - R * 0.7, x + R, y + R * 0.7], fill=b["liquid"]); vd.ellipse([x - R * 0.6, y - R * 0.4, x + R * 0.5, y + R * 0.3], fill=b["liquid2"])
    stroke(mgd, wid + 26, 255); stroke(mrd, wid, 255)
    # gravel
    gv = np.array(pal["gravel"], np.float32)[None, None] + noise((SS, SS), 3, 14, rng)[..., None] + noise((SS, SS), 40, 8, rng)[..., None]
    vis.paste(Image.fromarray(np.clip(gv, 0, 255).astype(np.uint8)), (0, 0), mg); del gv
    # asphalt: fine aggregate + slow patches
    av = np.array(pal["asph"], np.float32)[None, None] + noise((SS, SS), 2, 5, rng)[..., None] + noise((SS, SS), 64, 4, rng)[..., None]
    vis.paste(Image.fromarray(np.clip(av, 0, 255).astype(np.uint8)), (0, 0), mr); del av
    vd = ImageDraw.Draw(vis)

    # rubbered racing line: hugs the inside of corners
    rl = Image.new("L", (SS, SS), 0); rld = ImageDraw.Draw(rl)
    off = np.clip(-curv * 900, -1, 1)
    off = np.convolve(np.concatenate([off[-20:], off, off[:20]]), np.ones(41) / 41, "same")[20:-20] * wid * 0.30
    line = center + norm * off[:, None]
    for i in range(N):
        rld.line([P(line[i]), P(line[(i + 1) % N])], fill=70, width=int(wid * 0.30 * K))
    rl = rl.filter(ImageFilter.GaussianBlur(5 * K))
    dark = Image.new("RGB", (SS, SS), (30, 30, 33)); vis = Image.composite(dark, vis, Image.fromarray(np.minimum(np.array(rl), np.array(mr) // 255 * 255).astype(np.uint8))); del rl, dark
    vd = ImageDraw.Draw(vis)

    # white track limits (whole lap), just inside the road edge
    for s in (1, -1):
        for i in range(N):
            a = center[i] + norm[i] * s * (wid / 2 - 2.0); c = center[(i + 1) % N] + norm[(i + 1) % N] * s * (wid / 2 - 2.0)
            vd.line([P(a), P(c)], fill=(236, 236, 236), width=int(2.2 * K))
    # kerbs on corners: red/white blocks straddling the edge, wider on the outside of the turn
    corner = np.abs(curv) > max(0.0036, float(np.percentile(np.abs(curv), 62)))
    corner = np.convolve(np.concatenate([corner[-6:], corner, corner[:6]]).astype(float), np.ones(13), "same")[6:-6] > 0
    for i in range(N):
        if not corner[i]: continue
        j = (i + 1) % N; col = pal["kerb"][0] if i % 2 == 0 else pal["kerb"][1]
        for s in (1, -1):
            outside = np.sign(curv[i]) != s
            w0, w1 = (wid / 2 - 6.5, wid / 2 + (5 if outside else 3))
            q = [center[i] + norm[i] * s * w0, center[j] + norm[j] * s * w0, center[j] + norm[j] * s * w1, center[i] + norm[i] * s * w1]
            vd.polygon([P(x) for x in q], fill=col)
            # a thin dark seam on the road side so the kerb reads as raised
            vd.line([P(center[i] + norm[i] * s * (w0 - 0.4)), P(center[j] + norm[j] * s * (w0 - 0.4))], fill=(40, 40, 44), width=int(0.8 * K))

    # barriers (walled tracks): concrete wall with red/white tyre blocks on top
    if tr.get("walls"):
        for i in range(N):
            j = (i + 1) % N
            for s in (1, -1):
                a = center[i] + norm[i] * s * (wid / 2 + 15); c = center[j] + norm[j] * s * (wid / 2 + 15)
                vd.line([P(a), P(c)], fill=pal["barrier"], width=int(6 * K))
                vd.line([P(a), P(c)], fill=pal["kerb"][0] if (i // 3) % 2 == 0 else (30, 30, 34), width=int(3 * K))
    else:  # open tracks: a tyre wall + armco line out on the grass
        for i in range(N):
            j = (i + 1) % N
            for s in (1, -1):
                d = wid / 2 + 13 + 9 + 4 * abs(math.sin(i * 0.05))
                a = center[i] + norm[i] * s * d; c = center[j] + norm[j] * s * d
                vd.line([P(a), P(c)], fill=(200, 200, 206), width=int(1.6 * K))

    # boost pads → DRS-style blue chevron panels
    for t in tr["boosts"]:
        i = int(t * N) % N
        for s in (-0.5, 0.5):
            p = center[i] + norm[i] * s * wid * 0.45; x, y = P(p); r = 13 * K
            vd.rounded_rectangle([x - r, y - r, x + r, y + r], radius=int(4 * K), fill=(20, 120, 230))
            for k in (-1, 0, 1):
                tip = p + tang[i] * (6 + k * 6); bl = p + tang[i] * (k * 6 - 1) + norm[i] * 8; br = p + tang[i] * (k * 6 - 1) - norm[i] * 8
                vd.line([P(bl), P(tip), P(br)], fill=(255, 255, 255), width=int(2.2 * K), joint="curve")

    # start / finish: chequered band + grid boxes
    i0 = 0; t0 = tang[i0]; n0 = norm[i0]; sq = 4.0; ncol = int(wid / sq)
    for k in range(ncol):
        for j in range(3):
            col = (246, 246, 246) if (k + j) % 2 == 0 else (18, 18, 20)
            c = center[i0] + n0 * (-wid / 2 + (k + 0.5) * sq) + t0 * (j - 1) * sq
            q = [c + (-n0 - t0) * sq / 2, c + (n0 - t0) * sq / 2, c + (n0 + t0) * sq / 2, c + (-n0 + t0) * sq / 2]
            vd.polygon([P(x) for x in q], fill=col)
    for k in range(8):
        back = 22 + (k // 2) * 26; side = (-1 if k % 2 == 0 else 1) * wid * 0.22
        j = (i0 - int(back / 6)) % N; p = center[j] + norm[j] * side; tj, nj = tang[j], norm[j]
        front = p + tj * 9
        vd.line([P(front - nj * 9), P(front + nj * 9)], fill=(240, 240, 240), width=int(1.6 * K))
        for sd in (-1, 1): vd.line([P(front + nj * 9 * sd), P(front + nj * 9 * sd - tj * 6)], fill=(240, 240, 240), width=int(1.6 * K))
    # pit-wall line on the start straight
    for j in range(-14, 14):
        a = center[(i0 + j) % N] + norm[(i0 + j) % N] * -(wid / 2 + 9); c = center[(i0 + j + 1) % N] + norm[(i0 + j + 1) % N] * -(wid / 2 + 9)
        vd.line([P(a), P(c)], fill=(236, 236, 236), width=int(3 * K))

    # painted logos on the run-off at three points of the lap (outside of the curve)
    font = ImageFont.truetype(FONT, int(30 * K))
    for t, txt in ((0.06, "REBEL ANTS"), (0.40, "$REBEL"), (0.72, "REBEL GP")):
        i = int(t * N) % N; s = -1 if curv[i] > 0 else 1
        p = center[i] + norm[i] * s * (wid / 2 + 13 + 40)
        if not (60 < p[0] < W - 60 and 60 < p[1] < W - 60): continue
        tw, th = font.getbbox(txt)[2:]; lay = Image.new("L", (tw + 20, th + 20), 0); ImageDraw.Draw(lay).text((10, 0), txt, font=font, fill=210)
        ang = -math.degrees(math.atan2(tang[i][1], tang[i][0])) + (180 if s < 0 else 0)
        lay = lay.rotate(ang, expand=True, resample=Image.BICUBIC)
        x, y = P(p); col = Image.new("RGB", lay.size, pal["logo"])
        # only on grass: keep it off the road/gravel
        hole = Image.new("L", lay.size, 0); hole.paste(mg.crop((int(x - lay.width / 2), int(y - lay.height / 2), int(x + lay.width / 2), int(y + lay.height / 2))).resize(lay.size), (0, 0))
        m = Image.fromarray(np.minimum(np.array(lay), 255 - np.array(hole)).astype(np.uint8))
        vis.paste(col, (int(x - lay.width / 2), int(y - lay.height / 2)), m)
    vd = ImageDraw.Draw(vis)

    # hazards painted on the ground (same as build_tracks)
    for h in tr["hazards"]:
        i = int(h["t"] * N) % N; p = center[i]
        if h["kind"] == "crusher":
            x, y = P(p); r = wid * 0.34 * K
            for k in range(16):  # yellow/black hazard ring
                a0, a1 = k * 22.5, k * 22.5 + 22.5
                vd.arc([x - r, y - r, x + r, y + r], a0, a1, fill=(240, 196, 30) if k % 2 == 0 else (24, 24, 24), width=int(4 * K))
        elif h["kind"] == "geyser":
            q = p + norm[i] * wid * 0.2; x, y = P(q); r = wid * 0.22 * K
            vd.ellipse([x - r, y - r, x + r, y + r], fill=(84, 60, 50), outline=(255, 120, 40), width=int(3 * K))
            vd.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45], fill=(40, 26, 22))

    out = vis.resize((HD, HD), Image.LANCZOS)
    outdir = os.path.join(OUT, tr["id"]); os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "map_hd.webp"); out.save(path, "WEBP", quality=80, method=6)
    out.resize((256, 256), Image.LANCZOS).save(os.path.join(outdir, "thumb.png"), optimize=True)
    print(tr["id"], tr["name"], os.path.getsize(path) // 1024, "KB")

if __name__ == "__main__":
    ids = sys.argv[1:]
    for tr in TRACKS:
        if not ids or tr["id"] in ids: build(tr)
