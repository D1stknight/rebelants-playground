# The Siege — synthesized SFX (numpy) + Kenney CC0 picks → public/audio/siege/*.mp3
import numpy as np, subprocess, os, glob
from scipy.signal import butter, sosfilt, fftconvolve
SR = 44100; OUT = "/home/claude/snd/out"; R = np.random.default_rng(7)
def t(d): return np.arange(int(SR * d)) / SR
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)
def env(n, a, r, curve=3.0):
    e = np.ones(n); ai = int(a * SR); e[:ai] = np.linspace(0, 1, ai) if ai else 1
    rest = n - ai; e[ai:] = np.exp(-curve * np.linspace(0, 1, rest)) * (1 - np.linspace(0, 1, rest) ** 8); return e
def norm(x, peak=0.9): m = np.max(np.abs(x)) or 1; return x / m * peak
def reverb(x, size=1.2, mix=0.25):
    n = int(SR * size); ir = R.normal(0, 1, n) * np.exp(-np.linspace(0, 7, n)); ir = lp(ir, 5000); x2 = np.concatenate([x, np.zeros(n)]); y = fftconvolve(x, ir)[:len(x2)]; y = np.pad(y, (0, len(x2) - len(y))); return norm(x2 * (1 - mix) + norm(y) * mix * np.max(np.abs(x2)))
def save(name, x, stereo=False):
    x = norm(x); wav = f"{OUT}/{name}.wav"; import wave
    d = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(wav, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(d.tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "96k", f"{OUT}/{name}.mp3"], check=True); os.remove(wav)
noise = lambda d: R.normal(0, 1, int(SR * d))

# war horn: detuned saws, formant-ish filter, swell, vibrato, low octave; two-note call
def saw(f, tt): ph = np.cumsum(f / SR); return 2 * (ph % 1) - 1
def horn(notes, name, rev=1.6):
    parts = []
    for f0, d, a in notes:
        tt = t(d); vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * tt) * np.clip(tt / 0.6, 0, 1); f = f0 * vib * (1 + 0.02 * np.exp(-tt * 8))
        x = sum(saw(f * k, tt) * g for k, g in [(1, 1), (1.004, 0.8), (0.996, 0.8), (0.5, 0.6), (2, 0.25)])
        bright = 900 + 1800 * np.clip(tt / 0.5, 0, 1) * np.exp(-tt * 0.3)
        y = np.zeros_like(x); # time-varying lowpass in blocks
        B = 512
        for i in range(0, len(x), B): y[i:i + B] = lp(x[max(0, i - 2048):i + B], float(bright[min(i, len(x) - 1)]), 2)[-len(x[i:i + B]):]
        y = y + bp(noise(d), 300, 1200) * 0.05; e = env(len(y), a, 0, 1.2); parts.append(y * e)
    x = np.concatenate(parts); save(name, reverb(x, rev, 0.35))
horn([(98, 0.9, 0.25), (147, 2.2, 0.15)], "horn")
horn([(73.4, 1.2, 0.35), (65.4, 2.6, 0.3)], "horn_boss", 2.2)

# taiko: pitched body + skin noise
def taiko(f0=70, d=1.4):
    tt = t(d); f = f0 * (1 + 0.7 * np.exp(-tt * 18)); body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 3.2)
    skin = lp(noise(d), 1400) * np.exp(-tt * 28) * 0.6; return body + skin
x = np.concatenate([taiko(72, 0.45), taiko(72, 0.45), taiko(60, 1.4)]); save("taiko", reverb(x, 1.4, 0.3))
save("drum", reverb(taiko(64, 1.2), 1.0, 0.25))

# whooshes: band-passed noise sweep
def whoosh(d, f0, f1, name, sharp=1.0):
    tt = t(d); n = noise(d); f = f0 * (f1 / f0) ** (tt / d); y = np.zeros_like(n); B = 256
    for i in range(0, len(n), B): fc = float(f[i]); y[i:i + B] = bp(n[max(0, i - 1024):i + B], fc * 0.6, min(fc * 1.6, 18000))[-len(n[i:i + B]):]
    e = np.sin(np.pi * np.clip(tt / d, 0, 1)) ** (2 * sharp); save(name, y * e)
whoosh(0.35, 700, 2600, "whoosh_fast", 1.6); whoosh(0.55, 400, 1800, "whoosh"); whoosh(0.9, 180, 900, "whoosh_heavy", 0.8)

# booms (boulder impacts): low sine drop + noise body + rumble tail
def boom(d, f0, name, bright=2500, grit=0.5):
    tt = t(d); f = f0 * (1 + 2.5 * np.exp(-tt * 25)); body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 4)
    crack = lp(noise(d), bright) * np.exp(-tt * 22) * 0.9; rumble = lp(noise(d), 180) * np.exp(-tt * 2.2) * 1.4; gravel = bp(noise(d), 1500, 6000) * np.exp(-tt * 9) * grit * (R.random(len(tt)) < 0.08)
    save(name, reverb(body + crack + rumble + gravel, 1.4, 0.22))
boom(1.6, 48, "boom"); boom(2.4, 36, "boom_big", 1800, 0.8); boom(1.0, 70, "boom_small", 3500, 0.3)

# thunder crack: sharp crackle + low roll
def thunder(d=2.6):
    tt = t(d); cr = hp(noise(d), 1500) * np.exp(-tt * 14) * (R.random(len(tt)) < 0.35); roll = lp(noise(d), 260) * (np.exp(-tt * 1.4) * (0.6 + 0.4 * np.sin(2 * np.pi * 2.3 * tt) ** 2)); snap = noise(d) * np.exp(-tt * 70)
    save("thunder", reverb(cr * 0.8 + roll * 1.6 + snap * 0.9, 1.8, 0.3))
thunder()

# wasp buzz loop (2 s, seamless): saw at ~190 Hz with AM + band noise; crossfaded ends
def buzz(d=2.0):
    tt = t(d); f = 188 + 9 * np.sin(2 * np.pi * 3 * tt) + 4 * np.sin(2 * np.pi * 7.5 * tt); x = saw(f, tt) + 0.6 * saw(f * 2.01, tt)
    x = bp(x, 150, 3200) * (0.75 + 0.25 * np.sin(2 * np.pi * 31 * tt)) + bp(noise(d), 800, 4000) * 0.15
    k = int(0.25 * SR); x[:k] = x[:k] * np.linspace(0, 1, k) + x[-k:] * np.linspace(1, 0, k); x = x[:-k]; save("buzz_loop", x)
buzz()

# horde skitter loop (3 s): thousands of tiny chitin clicks
def skitter(d=3.0):
    n = int(SR * d); x = np.zeros(n); click = np.exp(-np.arange(90) / 12) * np.sin(np.arange(90) * 1.9)
    for _ in range(2600):
        i = R.integers(0, n - 100); x[i:i + 90] += click * R.uniform(0.2, 1)
    x = bp(x, 900, 7000) + lp(noise(d), 300) * 0.25
    k = int(0.3 * SR); x[:k] = x[:k] * np.linspace(0, 1, k) + x[-k:] * np.linspace(1, 0, k); x = x[:-k]; save("skitter_loop", x)
skitter()

# squelch / web splat / venom spit / chitin crunch
def squelch(d, name, f=300):
    tt = t(d); x = bp(noise(d), f, f * 6) * np.exp(-tt * 9) * (1 + 0.8 * np.sin(2 * np.pi * 23 * tt)); x += np.sin(2 * np.pi * np.cumsum(f * 0.4 * (1 + np.exp(-tt * 10))) / SR) * np.exp(-tt * 12) * 0.6; save(name, x)
squelch(0.5, "splat", 220); squelch(0.35, "squish", 380)
tt = t(0.6); save("spit", bp(noise(0.6), 1200, 5000) * np.exp(-tt * 7) * np.clip(tt / 0.04, 0, 1) + np.sin(2 * np.pi * np.cumsum(500 * (1 - tt)) / SR) * np.exp(-tt * 6) * 0.4)
tt = t(0.45); cr = np.zeros(len(tt))
for i in range(14): j = int(R.uniform(0, 0.18) * SR); L = 400; cr[j:j + L] += hp(noise(L / SR), 2000) * np.exp(-np.arange(L) / 60) * R.uniform(0.4, 1)
save("crunch", cr + lp(noise(0.45), 400) * np.exp(-tt * 10) * 0.6)
# wind bed for the wall (4 s loop)
d = 6.0; tt = t(d); w = bp(noise(d), 200, 900) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.17 * tt + 1) ** 2) + lp(noise(d), 120) * 0.4
k = int(0.8 * SR); w[:k] = w[:k] * np.linspace(0, 1, k) + w[-k:] * np.linspace(1, 0, k); w = w[:-k]; save("wind_loop", w)
print(sorted(os.listdir(OUT)))
