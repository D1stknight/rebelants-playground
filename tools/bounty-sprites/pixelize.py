from PIL import Image, ImageFilter
import numpy as np, sys
def pixelize(im, target_h=48, colors=28, outline=(12,8,10,255), boost=1.15, factor=None):
    im = im.convert("RGBA")
    a = np.array(im); alpha = a[:,:,3]
    ys, xs = np.where(alpha > 40)
    if len(ys) == 0: return Image.new("RGBA", (16, target_h))
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max()+1, ys.max()+1
    cx = (x0 + x1) / 2 - im.width / 2; by = y1 - im.height   # offset of the bbox centre from canvas centre / bottom from canvas bottom
    im = im.crop((x0, y0, x1, y1))
    if factor: target_h = max(1, round(im.height / factor))
    # keep thin bits (antennae): dilate alpha before the downscale
    r, g, bl, al = im.split(); al = al.filter(ImageFilter.MaxFilter(5)); im2 = Image.merge("RGBA", (r, g, bl, al))
    # colour dilation too so dilated alpha has colour
    rgbd = im.convert("RGB").filter(ImageFilter.MaxFilter(3)); im2 = Image.merge("RGBA", (*rgbd.split(), al))
    w = max(1, round(im.width * target_h / im.height))
    small = im2.resize((w, target_h), Image.BOX)
    dx = round(cx / (im.height / target_h)); dy = round(by / (im.height / target_h))
    arr = np.array(small).astype(float)
    # contrast/saturation boost for the chunky look
    rgb = arr[:,:,:3]; mean = rgb.mean(axis=2, keepdims=True); rgb = np.clip((rgb - mean) * 1.25 + mean, 0, 255); rgb = np.clip(rgb * boost, 0, 255); arr[:,:,:3] = rgb
    alpha = arr[:,:,3]; arr[:,:,3] = np.where(alpha > 90, 255, 0)
    small = Image.fromarray(arr.astype(np.uint8))
    rgb = small.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    out = np.array(rgb); out[:,:,3] = np.array(small)[:,:,3]
    res = Image.fromarray(out)
    # outline
    px = np.array(res); h, w = px.shape[:2]; o = px.copy()
    for y in range(h):
        for x in range(w):
            if px[y,x,3] == 0:
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and px[ny,nx,3] > 0: o[y,x] = outline; break
    res = Image.fromarray(o); res.dx = dx; res.dy = dy; return res
if __name__ == "__main__":
    im = Image.open(sys.argv[1]); out = pixelize(im, int(sys.argv[3]) if len(sys.argv) > 3 else 48)
    out.save(sys.argv[2]); big = out.resize((out.width*6, out.height*6), Image.NEAREST); bg = Image.new("RGBA", big.size, (40,30,50,255)); bg.alpha_composite(big); bg.save(sys.argv[2].replace('.png','_prev.png')); print(out.size)
