#!/usr/bin/env python3
"""Ant Tunnel HD sprite sheets rendered from the faction GLBs (smooth, not pixelised).
Needs `next dev -p 3111` with tools/bounty-sprites/dev-sprite-page.tsx copied to pages/dev/sprite.tsx.
Output: public/tunnel/sheets/<faction>.png — 192×192 frames, 8 per row:
  0 idle · 1–6 run (side, facing right; mirror for left) · 7–10 run back (facing up) · 11–14 run front (facing down)
  15 hit · 16 win · 17 death · 18 dig (swing) · 19 idle breathe
"""
import json, math, os, subprocess, sys
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "public", "tunnel", "sheets")
SIDE = 2.9              # model yaw that faces screen-right (same as Bounty Hunters)
BACK = SIDE + math.pi / 2   # facing away from the camera (up the maze)
FRONT = SIDE - math.pi / 2  # facing the camera (down the maze)
FW = FH = 192; CHAR_H = 150; COLS = 8

def base(ry, clip="idle", t=0.2): return {"clip": clip, "t": t, "ry": ry, "rot": [], "pos": []}
def run_frames(ry, n=6, arms=True):
    P = []
    for i in range(n):
        ph = i / n * 2 * math.pi; sn = math.sin(ph)
        p = base(ry); p["rot"] = [["Spine", 0.14, 0, 0], ["LeftUpLeg", -0.85 * sn, 0, 0], ["RightUpLeg", 0.85 * sn, 0, 0], ["LeftLeg", -1.0 * max(0, -sn), 0, 0], ["RightLeg", -1.0 * max(0, sn), 0, 0]]
        if arms: p["rot"] += [["LeftArm", 0.6 * sn, 0, 0.15], ["RightArm", -0.6 * sn, 0, -0.15], ["LeftForeArm", -0.5, 0, 0], ["RightForeArm", -0.5, 0, 0]]
        p["pos"] = [["Hips", 0, -4 * abs(math.cos(ph)), 0]]; P.append(p)
    return P
def poses():
    P = [base(SIDE, "idle", 0.2)]                                    # 0 idle
    P += run_frames(SIDE, 6)                                          # 1-6 run side
    P += run_frames(BACK, 4)                                          # 7-10 run back
    P += run_frames(FRONT, 4)                                         # 11-14 run front
    p = base(SIDE, "hit", 0.75); p["rot"] = [["Spine", -0.3, 0, 0]]; P.append(p)                        # 15 hit
    P.append(base(SIDE, "win", 0.9) if True else base(SIDE))                                             # 16 win (clip)
    p = base(SIDE, "lose", 1.2); p["tilt"] = [-1.2, 26, 0]; P.append(p)                                  # 17 death: lose clip, tipped over
    p = base(SIDE, "attack", 0.55); p["rot"] = [["Spine", 0.25, 0, 0]]; P.append(p)                     # 18 dig / swing
    P.append(base(SIDE, "idle", 0.9))                                                                    # 19 idle breathe
    return P

def render(fid, P, outdir):
    os.makedirs(outdir, exist_ok=True); json.dump(P, open(f"{outdir}_poses.json", "w"))
    r = subprocess.run(["node", os.path.join(HERE, "..", "bounty-sprites", "sprite2.js"), fid, f"{outdir}_poses.json", outdir], capture_output=True, text=True, cwd=os.path.join(HERE, "..", ".."))
    if not any(l.startswith("done") for l in r.stdout.splitlines()): print(r.stdout[-400:], r.stderr[-800:]); raise SystemExit("render failed " + fid)

def frame(im):
    """trim, keep the model origin (canvas centre / bottom) as the anchor, scale so standing height (512/1.25) → CHAR_H"""
    im = im.convert("RGBA"); bbox = im.getbbox()
    if not bbox: return Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    k = CHAR_H / (512 / 1.25); w, h = im.size
    small = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    # soft dark outline for readability over textured floors
    a = small.split()[3].filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    halo = Image.new("RGBA", small.size, (10, 8, 14, 0)); halo.putalpha(a.point(lambda v: int(v * 0.85)))
    out = Image.alpha_composite(halo, small)
    # canvas centre maps to the frame centre; model feet sit at canvas y = 512*(0.5 + 1/(2*1.25)) → place so feet land at FH-10
    cx, cy = out.width / 2, out.height / 2; feet = cy + (512 / 1.25) / 2 * k
    dst = Image.new("RGBA", (FW, FH), (0, 0, 0, 0)); ox = round(FW / 2 - cx); oy = round(FH - 10 - feet)
    dst.alpha_composite(out, (ox, oy)) if ox >= 0 and oy >= 0 else dst.alpha_composite(out.crop((max(0, -ox), max(0, -oy), out.width, out.height)), (max(0, ox), max(0, oy)))
    return dst

def assemble(outdir, n):
    sheet = Image.new("RGBA", (COLS * FW, math.ceil(n / COLS) * FH), (0, 0, 0, 0))
    for i in range(n): sheet.alpha_composite(frame(Image.open(f"{outdir}/f{i:02d}.png")), ((i % COLS) * FW, (i // COLS) * FH))
    return sheet

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    fids = sys.argv[1:] or ["ashigaru", "ronin", "samurai", "bushi", "warrior", "shogun", "buke", "kenshi", "wokou", "sohei", "yamabushi"]
    for fid in fids:
        outdir = f"/home/claude/kart/tun_r_{fid}"
        if not os.path.exists(f"{outdir}/f19.png"): render(fid, poses(), outdir)
        sh = assemble(outdir, 20); sh.save(os.path.join(OUT, f"{fid}.png"), optimize=True)
        print("ok", fid, sh.size, os.path.getsize(os.path.join(OUT, f"{fid}.png")) // 1024, "KB")
