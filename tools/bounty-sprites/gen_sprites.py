import json, math, os, subprocess, sys
from PIL import Image
from pixelize import pixelize
F = 2.9
GUN = [0, 0, 0, 0, 0, 0]
ARM = -1.0
def base(t=0.2, clip="idle"): return {"clip": clip, "t": t, "ry": F, "rot": [], "pos": [], "gun": GUN}
def hunter_poses():
    P = []
    for t in (0.2, 0.9):                                   # 0-1 idle
        p = base(t); p["rot"] = [["RightArm", ARM, 0, 0]]; P.append(p)
    for i in range(6):                                     # 2-7 run
        ph = i / 6 * 2 * math.pi; sn = math.sin(ph)
        p = base(0.2); p["rot"] = [["RightArm", ARM, 0, 0], ["Spine", 0.18, 0, 0], ["LeftUpLeg", -0.8 * sn, 0, 0], ["RightUpLeg", 0.8 * sn, 0, 0], ["LeftLeg", -1.0 * max(0, -sn), 0, 0], ["RightLeg", -1.0 * max(0, sn), 0, 0], ["LeftArm", 0.5 * sn, 0, 0]]
        p["pos"] = [["Hips", 0, -4 * abs(math.cos(ph)), 0]]; P.append(p)
    p = base(0.2); p["rot"] = [["RightArm", ARM, 0, 0], ["LeftUpLeg", -0.6, 0, 0], ["RightUpLeg", -0.3, 0, 0], ["LeftLeg", -1.1, 0, 0], ["RightLeg", -0.9, 0, 0]]; P.append(p)   # 8 jump
    p = base(0.2); p["rot"] = [["RightArm", ARM + 0.15, 0, 0], ["Spine", 0.08, 0, 0]]; P.append(p)                                                      # 9 shoot recoil
    p = base(0.2); p["rot"] = [["RightArm", ARM, 0, 0]]; P.append(p)                                                                                    # 10 shoot end
    p = base(0.2); p["rot"] = [["RightArm", -1.7, 0, 0]]; P.append(p)                                                                                   # 11 aim 45
    p = base(0.2); p["rot"] = [["RightArm", -2.5, 0, 0]]; P.append(p)                                                                                   # 12 aim 90
    p = base(0.2); p["rot"] = [["RightArm", -0.4, 0, 0], ["LeftUpLeg", -0.6, 0, 0], ["RightUpLeg", -0.3, 0, 0], ["LeftLeg", -1.1, 0, 0], ["RightLeg", -0.9, 0, 0]]; P.append(p)  # 13 aim down (air)
    for rec in (0, 0.15):                                                                                                                                # 14-15 crouch / crouch shoot
        p = base(0.2); p["rot"] = [["RightArm", ARM + rec, 0, 0], ["Spine", 0.45, 0, 0], ["LeftUpLeg", -1.1, 0, 0], ["RightUpLeg", -0.9, 0, 0], ["LeftLeg", -1.6, 0, 0], ["RightLeg", -1.5, 0, 0]]; p["pos"] = [["Hips", 0, -24, 0]]; P.append(p)
    # 16-18 death: knocked back, tipping over, flat on the ground (whole-model tilt; the sprite is mirrored later)
    p = base(0.75, "hit"); p["gun"] = None; p["rot"] = [["Spine", -0.5, 0, 0], ["LeftArm", 0, 0, 1.2], ["RightArm", 0, 0, -1.2]]; P.append(p)
    p = base(0.75, "hit"); p["gun"] = None; p["rot"] = [["Spine", -0.3, 0, 0], ["LeftArm", 0, 0, 1.2], ["RightArm", 0, 0, -1.2]]; p["tilt"] = [0, 20, 0]; p["tilt"] = [-0.9, 30, 0]; P.append(p)
    p = base(0.2); p["gun"] = None; p["rot"] = [["LeftArm", 0, 0, 1.0], ["RightArm", 0, 0, -1.0]]; p["tilt"] = [-1.55, 30, 0]; P.append(p)
    p = base(0.75, "hit"); p["rot"] = [["RightArm", ARM, 0, 0]]; P.append(p)                                                                            # 19 hit
    return P

def render(fid, poses, outdir):
    json.dump(poses, open(f"{outdir}_poses.json", "w"))
    r = subprocess.run(["node", "/home/claude/bh/sprite2.js", fid, f"{outdir}_poses.json", outdir], capture_output=True, text=True, cwd="/home/claude/repo")
    line = [l for l in r.stdout.splitlines() if l.startswith("done")]
    if not line: print(r.stdout[-500:], r.stderr[-800:]); raise SystemExit("render failed")

def assemble(outdir, n, fw=64, fh=64, char_h=40, cols=10, mirror=False, tint=None):
    frames = []
    for i in range(n):
        im = Image.open(f"{outdir}/f{i:02d}.png")
        # fixed world scale: the camera box is 1.25× the standing height, canvas 512 → character 512/1.25 px tall
        factor = (512 / 1.25) / char_h
        px = pixelize(im, factor=factor, colors=24)
        if tint: px = tint(px)
        if mirror: px = px.transpose(Image.FLIP_LEFT_RIGHT)
        frames.append(px)
    sheet = Image.new("RGBA", (cols * fw, math.ceil(n / cols) * fh))
    for i, px in enumerate(frames):
        # feet at the bottom margin 4px, centred horizontally on the frame's box origin (model origin = camera centre)
        ox = (i % cols) * fw + (fw - px.width) // 2 + getattr(px, "dx", 0); oy = (i // cols) * fh + fh - 4 - px.height + getattr(px, "dy", 0)
        sheet.alpha_composite(px, (max(0, ox), max(0, oy)))
    return sheet

ENEMY_IDX = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 16, 17, 18, 19]
def tint(hue_shift, sat=0.9, val=0.85):
    def f(px):
        dx, dy = px.dx, px.dy
        a = px.split()[3]; hsv = px.convert("RGB").convert("HSV"); import numpy as np
        arr = np.array(hsv).astype(int); arr[:, :, 0] = (arr[:, :, 0] + hue_shift) % 256; arr[:, :, 1] = np.clip(arr[:, :, 1] * sat, 0, 255); arr[:, :, 2] = np.clip(arr[:, :, 2] * val, 0, 255)
        out = Image.fromarray(arr.astype("uint8"), "HSV").convert("RGBA"); out.putalpha(a); out.dx = dx; out.dy = dy; return out
    return f

def gen_enemy(fid, name, hue):
    out = f"/home/claude/bh/r_{fid}"
    if not os.path.exists(f"{out}/f19.png"): render(fid, hunter_poses(), out)
    frames = [f"{out}/f{i:02d}.png" for i in ENEMY_IDX]
    tmp = f"/home/claude/bh/r_en_{name}"; os.makedirs(tmp, exist_ok=True)
    for i, f in enumerate(frames): Image.open(f).save(f"{tmp}/f{i:02d}.png")
    sheet = assemble(tmp, len(frames), cols=7, tint=tint(hue))
    sheet.save(f"/home/claude/bh/{name}.png"); return sheet

if __name__ == "__main__":
    if sys.argv[1] == "enemies":
        a = gen_enemy("ashigaru", "grunt", 30); b = gen_enemy("kenshi", "elite", 110)
        both = Image.new("RGBA", (a.width, a.height * 2 + 4)); both.alpha_composite(a, (0, 0)); both.alpha_composite(b, (0, a.height + 4))
        big = both.resize((both.width * 4, both.height * 4), Image.NEAREST); bg = Image.new("RGBA", big.size, (40, 30, 50, 255)); bg.alpha_composite(big); bg.save("/home/claude/bh/enemies_prev2.png"); print("ok enemies")
    else:
        for fid in sys.argv[1:]:
            out = f"/home/claude/bh/r_{fid}"
            render(fid, hunter_poses(), out)
            sheet = assemble(out, 20)
            sheet.save(f"/home/claude/bh/hunter_{fid}.png")
            big = sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST); bg = Image.new("RGBA", big.size, (40, 30, 50, 255)); bg.alpha_composite(big); bg.save(f"/home/claude/bh/hunter_{fid}_prev.png")
            print("ok", fid, sheet.size)
