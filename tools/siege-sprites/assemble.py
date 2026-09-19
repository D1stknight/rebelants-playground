#!/usr/bin/env python3
"""Assemble /home/claude/siege/units/<fid>/<clip>_NN.png (512 px renders) into public/siege/units/<fid>.png (256 px frames, 10 per row)
+ public/siege/units/<fid>.json {frame, cols, clips:{name:[start,count,fps,loop]}}. Feet sit on a shared baseline (from the render's fit)."""
import json, os, sys
from PIL import Image
SRC = "/home/claude/siege/units"; OUT = "/home/claude/repo/public/siege/units"; F = 256; COLS = 10
ORDER = [("idle", 6, True), ("attack", 14, False), ("magic", 12, False), ("special", 12, False), ("hit", 10, False), ("win", 8, False), ("defend", 8, False), ("lose", 6, False)]
def build(fid):
    d = f"{SRC}/{fid}"; meta = json.load(open(f"{d}/meta.json")); frames = []; clips = {}
    for name, fps, loop in ORDER:
        files = meta["frames"][name]; clips[name] = [len(frames), len(files), fps, loop]
        for f in files: frames.append(Image.open(f).convert("RGBA").resize((F, F), Image.LANCZOS))
    rows = (len(frames) + COLS - 1) // COLS; sheet = Image.new("RGBA", (COLS * F, rows * F), (0, 0, 0, 0))
    for i, im in enumerate(frames): sheet.alpha_composite(im, ((i % COLS) * F, (i // COLS) * F))
    os.makedirs(OUT, exist_ok=True)
    q = sheet.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG) if os.environ.get("QUANT") else sheet
    q.save(f"{OUT}/{fid}.png", optimize=True)
    # baseline: the model's feet are at render y ≈ 512·(0.5 + 1/(2·1.35)) → in 256 px frames
    json.dump({"frame": F, "cols": COLS, "clips": clips, "feet": round(256 * (0.5 + 1 / (2 * 1.35)), 1), "height": round(256 / 1.35, 1)}, open(f"{OUT}/{fid}.json", "w"))
    print(fid, len(frames), "frames", os.path.getsize(f"{OUT}/{fid}.png") // 1024, "KB")
for fid in (sys.argv[1:] or ["ronin", "samurai", "ashigaru", "yamabushi"]): build(fid)
