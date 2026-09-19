#!/usr/bin/env python3
"""Queen paper-doll layers from the headless front render (tools/queen-sprites/shot.js → q_front.png):
body.png  = queen with the staff removed (inpainted)      staff.png = the staff alone, pivot = her fist
layers.json = pivot + placement so the game can rotate the staff in her hand (point / raise / shrug)."""
import json, sys, cv2, numpy as np
from PIL import Image
src = sys.argv[1] if len(sys.argv) > 1 else "q_front.png"; out = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/repo/public/queen/sprite"
import os; os.makedirs(out, exist_ok=True)
im = np.array(Image.open(src).convert("RGBA")); H, W = im.shape[:2]
r, g, b, a = [im[..., i].astype(int) for i in range(4)]
FIST = (296, 578, 372, 664)            # her fist (x0,y0,x1,y1) in the 1024 render — drawn over the staff so the grip reads right
yy, xx = np.mgrid[0:H, 0:W]
upper = (a > 0) & (xx >= 258) & (xx < 362) & (yy >= 265) & (yy < FIST[1] + 6)          # staff over empty background: take everything
red = (r > 120) & (g < 85) & (b < 85)
goldc = (r > 120) & (g > 85) & (b < 140) & (r > b + 45)
lx0 = 306 + 0.05 * (yy - FIST[3]); lx1 = 356 + 0.07 * (yy - FIST[3])
lower = (a > 0) & (xx >= lx0) & (xx < lx1) & (yy >= FIST[3] - 6) & (yy < 925) & (g > 0.5 * r)   # the rod below the fist: everything not dress-red inside a slanted band    # staff over the dress: gold column, dress excluded
grip = (a > 0) & (xx >= 302) & (xx < 350) & (yy >= FIST[1]) & (yy < FIST[3]) & goldc   # inside the fist: gold pixels only
mask = upper | lower | grip
# staff layer
staff = np.zeros_like(im); staff[mask] = im[mask]
ys, xs = np.where(mask); bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
staff_img = Image.fromarray(staff[by0:by1, bx0:bx1])
# body: inpaint the staff strip where it crosses the body; leave transparent where the background was
rgb = im[..., :3].copy(); alpha = im[..., 3].copy()
bodyish = (alpha > 0) & ~mask
# alpha for the masked pixels: transparent if no body neighbour, else opaque (inpainted)
near_body = cv2.dilate(bodyish.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
fill = mask & near_body
inp = cv2.inpaint(cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2BGR), cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8)) * 255, 7, cv2.INPAINT_TELEA)
inp = cv2.cvtColor(inp, cv2.COLOR_BGR2RGB)
body = im.copy(); body[mask, :3] = inp[mask]; body[mask, 3] = np.where(fill[mask], 255, 0)
# hide the fist hole by keeping the fist (skin) pixels: they were never in mask (skin fails the gold test) — fine
body_img = Image.fromarray(body)
fist_img = Image.fromarray(im[FIST[1]:FIST[3], FIST[0]:FIST[2]].copy())
bb = body_img.getbbox(); body_img = body_img.crop(bb)
fist = ((FIST[0] + FIST[2]) // 2, (FIST[1] + FIST[3]) // 2)   # pivot = centre of her fist
meta = { "render": [W, H], "body": { "box": list(bb) }, "staff": { "box": [int(bx0), int(by0), int(bx1), int(by1)] }, "fist": { "box": list(FIST) }, "pivot": list(fist), "gem": [318, 300], "feet_y": int(bb[3]) }
# 2x web size: 640 px tall body
k = 640 / body_img.height
body_img.resize((round(body_img.width * k), 640), Image.LANCZOS).save(f"{out}/body.png", optimize=True)
staff_img.resize((max(1, round(staff_img.width * k)), max(1, round(staff_img.height * k))), Image.LANCZOS).save(f"{out}/staff.png", optimize=True)
fist_img.resize((round(fist_img.width * k), round(fist_img.height * k)), Image.LANCZOS).save(f"{out}/fist.png", optimize=True)
meta["scale"] = k; json.dump(meta, open(f"{out}/layers.json", "w"))
print(meta, os.path.getsize(f"{out}/body.png") // 1024, "KB", os.path.getsize(f"{out}/staff.png") // 1024, "KB")
