#!/usr/bin/env python3
"""HD car sheets: 16 renders (1024², camera from f1_render.js at hMul 3.1, centred 0.25 H above the ground point) →
one 16-frame strip, each frame 288×149 cut from rows 250…778 (the ground point sits 64.2% down the frame). WebP with alpha."""
import sys, glob
from PIL import Image
CROP = (0, 250, 1024, 778); FW, FH = 288, 149
def sheet(indir, out):
    files = sorted(glob.glob(f"{indir}/a*.png")); assert len(files) == 16, files
    S = Image.new("RGBA", (FW * 16, FH), (0, 0, 0, 0))
    for i, f in enumerate(files):
        S.alpha_composite(Image.open(f).convert("RGBA").crop(CROP).resize((FW, FH), Image.LANCZOS), (i * FW, 0))
    S.save(out, "WEBP", quality=74, method=6, alpha_quality=70)
if __name__ == "__main__":
    sheet(sys.argv[1], sys.argv[2])
