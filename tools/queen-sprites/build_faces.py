#!/usr/bin/env python3
"""Expression layers for the queen (drawn over her face by components/QueenStage.tsx).
Input: the 1024 front render. Output: public/queen/sprite/face_<name>.png (all the same box) + face box in layers.json."""
import json, sys, os, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
src = sys.argv[1] if len(sys.argv) > 1 else "q_front.png"; out = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/repo/public/queen/sprite"
im = Image.open(src).convert("RGBA")
BOX = (372, 250, 668, 445)                      # face region in the render (eyes + mouth)
EYES = [(380, 283, 496, 388), (552, 283, 652, 388)]  # left / right eye patches (whites + pupil + lashes)
MOUTH = (455, 392, 605, 436)
skin = tuple(int(v) for v in np.array(im.crop((470, 262, 560, 284)).convert("RGB")).reshape(-1, 3).mean(0)) + (255,)
skin_dark = tuple(max(0, int(v * 0.72)) for v in skin[:3]) + (255,)
LINE = (52, 26, 14, 255)

def base(): return im.crop(BOX).copy()
def L(p): return (p[0] - BOX[0], p[1] - BOX[1])
def fill_skin(face, box, feather=6):
    """remove a feature: inpaint the ellipse from the surrounding skin so shading stays continuous"""
    x0, y0, x1, y1 = box; arr = np.array(face.convert("RGB")); m = np.zeros(arr.shape[:2], np.uint8)
    cv2.ellipse(m, (int((x0 + x1) / 2 - BOX[0]), int((y0 + y1) / 2 - BOX[1])), (int((x1 - x0) / 2) + 10, int((y1 - y0) / 2) + 10), 0, 0, 360, 255, -1)
    inp = cv2.inpaint(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), m, 25, cv2.INPAINT_NS); inp = cv2.cvtColor(inp, cv2.COLOR_BGR2RGB)
    out = np.array(face); out[..., :3][m > 0] = inp[m > 0]; face.paste(Image.fromarray(out)); void = feather
def eye_patch(i): return im.crop(EYES[i])
def scale_eyes(face, sy, sx=1.0, dy=0):
    for i, e in enumerate(EYES):
        p = eye_patch(i); w, h = p.size; cx, cy = (e[0] + e[2]) / 2, (e[1] + e[3]) / 2
        fill_skin(face, e)
        nw, nh = max(1, round(w * sx)), max(1, round(h * sy)); q = p.resize((nw, nh), Image.LANCZOS)
        m = Image.new("L", (nw, nh), 0); ImageDraw.Draw(m).ellipse((1, 1, nw - 2, nh - 2), fill=255); m = m.filter(ImageFilter.GaussianBlur(1.5))
        face.paste(q, L((round(cx - nw / 2), round(cy - nh / 2 + dy))), m)
def brows(face, tilt, thick=8, lift=0):
    """tilt > 0: inner ends down (angry / focused) · tilt < 0: outer ends down (sad)"""
    d = ImageDraw.Draw(face)
    for i, e in enumerate(EYES):
        cx = (e[0] + e[2]) / 2; y = e[1] - 16 - lift; x0, x1 = cx - 44, cx + 44
        inner_is_right = i == 0
        yl = y + (tilt if not inner_is_right else -tilt) * 0.0; yr = 0
        y_left = y + (-tilt if inner_is_right else tilt); y_right = y + (tilt if inner_is_right else -tilt)
        d.line([L((x0, y_left)), L((cx, y - 5 + abs(tilt) * 0.2)), L((x1, y_right))], fill=LINE, width=thick, joint="curve")
def closed_eyes(face, happy=False, thick=8):
    d = ImageDraw.Draw(face)
    for e in EYES:
        fill_skin(face, e); cx, cy = (e[0] + e[2]) / 2, (e[1] + e[3]) / 2 + 4; w = 40
        bx = (cx - w, cy - 22, cx + w, cy + 22)
        if happy: d.arc(tuple(L((bx[0], bx[1] + 8)) + L((bx[2], bx[3] + 8))), 200, 340, fill=LINE, width=thick)   # ^ shape (upper arc)
        else: d.arc(tuple(L((bx[0], bx[1] - 6)) + L((bx[2], bx[3] - 6))), 20, 160, fill=LINE, width=thick)         # sleepy lower arc
def lids(face, frac=0.4):
    for e in EYES:
        x0, y0, x1, y1 = e; h = y1 - y0; fill_skin(face, (x0 - 4, y0 - 8, x1 + 4, y0 + int(h * frac)), feather=3)
        ImageDraw.Draw(face).line([L((x0 + 6, y0 + int(h * frac) - 4)), L((x1 - 6, y0 + int(h * frac) - 4))], fill=LINE, width=5)
def mouth(face, kind):
    x0, y0, x1, y1 = MOUTH; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; d = ImageDraw.Draw(face)
    fill_skin(face, MOUTH, feather=5)
    if kind == "smile": d.arc(tuple(L((cx - 44, cy - 26)) + L((cx + 44, cy + 8))), 15, 165, fill=LINE, width=5)
    elif kind == "grin":
        d.chord(tuple(L((cx - 48, cy - 30)) + L((cx + 48, cy + 10))), 10, 170, fill=(70, 25, 25, 255)); d.arc(tuple(L((cx - 48, cy - 30)) + L((cx + 48, cy + 10))), 10, 170, fill=LINE, width=5)
        d.rectangle(tuple(L((cx - 34, cy - 8)) + L((cx + 34, cy - 1))), fill=(245, 240, 225, 255))
    elif kind == "o": d.ellipse(tuple(L((cx - 16, cy - 20)) + L((cx + 16, cy + 8))), fill=(60, 22, 22, 255), outline=LINE, width=3)
    elif kind == "grit": d.line([L((cx - 26, cy - 6)), L((cx + 26, cy - 6))], fill=LINE, width=6)
    elif kind == "frown": d.arc(tuple(L((cx - 36, cy - 8)) + L((cx + 36, cy + 26))), 200, 340, fill=LINE, width=6)

faces = {}
faces["idle"] = base()
f = base(); closed_eyes(f); faces["blink"] = f
f = base(); scale_eyes(f, 0.6); brows(f, 8, 9); faces["focus"] = f
f = base(); scale_eyes(f, 0.42); brows(f, 13, 11, lift=-4); mouth(f, "grit"); faces["intense"] = f
f = base(); scale_eyes(f, 1.18, 1.1, -4); brows(f, -2, 8, lift=10); mouth(f, "o"); faces["shock"] = f
f = base(); closed_eyes(f, happy=True, thick=7); mouth(f, "grin"); faces["happy"] = f
f = base(); lids(f, 0.42); brows(f, -9, 8, lift=-2); mouth(f, "frown"); faces["sad"] = f
f = base(); scale_eyes(f, 0.9, 1.0, 0); brows(f, 4, 8); mouth(f, "smile"); faces["smirk"] = f
meta = json.load(open(f"{out}/layers.json")); k = meta["scale"]
sheet = Image.new("RGBA", (faces["idle"].width * len(faces), faces["idle"].height), (0, 0, 0, 0))
for i, (n, fimg) in enumerate(faces.items()):
    fimg.resize((round(fimg.width * k), round(fimg.height * k)), Image.LANCZOS).save(f"{out}/face_{n}.png", optimize=True); sheet.paste(fimg, (i * fimg.width, 0))
meta["face"] = {"box": list(BOX), "names": list(faces.keys())}; json.dump(meta, open(f"{out}/layers.json", "w"))
sheet.save("/home/claude/queen/faces_preview.png"); print("faces", list(faces.keys()), skin)
