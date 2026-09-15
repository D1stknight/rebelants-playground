# tiny pixel-art painter for Bounty Hunters sprite sheets
from PIL import Image, ImageDraw
import math

class Canvas:
    def __init__(self, w, h):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0)); self.d = ImageDraw.Draw(self.im); self.w = w; self.h = h
    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h: self.im.putpixel((int(x), int(y)), c)
    def rect(self, x, y, w, h, c):
        self.d.rectangle([x, y, x + w - 1, y + h - 1], fill=c)
    def ell(self, x, y, w, h, c):
        self.d.ellipse([x, y, x + w - 1, y + h - 1], fill=c)
    def line(self, x0, y0, x1, y1, c, wd=1):
        self.d.line([x0, y0, x1, y1], fill=c, width=wd)
    def poly(self, pts, c):
        self.d.polygon(pts, fill=c)
    def outline(self, col=(12, 8, 10, 255)):
        """1px dark outline around every opaque pixel (classic 16-bit look)"""
        src = self.im.copy(); out = self.im
        px = src.load(); w, h = src.size
        for y in range(h):
            for x in range(w):
                if px[x, y][3] == 0:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 0:
                            out.putpixel((x, y), col); break
        return self

def shade(c, k):
    return (max(0, min(255, int(c[0] * k))), max(0, min(255, int(c[1] * k))), max(0, min(255, int(c[2] * k))), 255)

def sheet(frames, fw, fh, cols=None):
    cols = cols or len(frames); rows = math.ceil(len(frames) / cols)
    im = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, f in enumerate(frames): im.paste(f.im, ((i % cols) * fw, (i // cols) * fh))
    return im

def preview(im, scale=4, bg=(40, 30, 50, 255)):
    big = Image.new("RGBA", (im.width * scale, im.height * scale), bg)
    big.alpha_composite(im.resize((im.width * scale, im.height * scale), Image.NEAREST))
    return big
