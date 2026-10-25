#!/usr/bin/env python3
"""The Queen's voice: every line she says in Egg Shuffle, spoken by Kokoro-82M (Apache-2.0, runs offline) →
public/queen/voice/<slug>.mp3 + lines.json { text: { file, dur, env } } (env = loudness per 1/30 s, drives the lip-sync).
Needs: pip install kokoro-onnx ; the model from npm `kokoro-q8-shards` (6 parts, cat them → kokoro-q8.onnx) ;
voices from npm `kokoro-js` (voices/*.bin). Run with python3 -I.
  VOICE=bf_isabella SPEED=0.92 python3 -I build_voice.py <kokoro-q8.onnx> <voices dir> public/queen/voice
"""
import sys, os, re, json, glob, subprocess, wave
import numpy as np
from kokoro_onnx import Kokoro

LINES = [
  "A Royal Egg… the colony's fortune rides with you today.",
  "Watch closely, little one.", "Eyes on the golden egg.", "The colony remembers the attentive.", "Follow it… if you can.",
  "Choose.",
  "MAGNIFICENT. The colony bows to you.", "Ahh — the colony smiles on you.", "A fine egg. Small, but honest.", "Patience… my favor grows.",
  "Empty. The tunnels are fickle.", "Not this one, little one.", "The colony gives nothing today.",
]
# how she should say it (the text shown on screen stays as written)
SPOKEN = { "MAGNIFICENT. The colony bows to you.": "Magnificent! The colony bows to you.", "Ahh — the colony smiles on you.": "Ahh... the colony smiles on you." }

def slug(t): return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:40]

def main(model, vdir, out):
    voice = os.environ.get("VOICE", "bf_isabella"); speed = float(os.environ.get("SPEED", "0.92"))
    voices = {os.path.basename(f)[:-4]: np.fromfile(f, dtype=np.float32).reshape(510, 1, 256) for f in glob.glob(vdir + "/*.bin")}
    np.savez("/tmp/kokoro_voices.npz", **voices)
    k = Kokoro(model, "/tmp/kokoro_voices.npz"); os.makedirs(out, exist_ok=True); meta = {}
    for line in LINES:
        # trim=False: Kokoro's own trimmer clips the soft last sound of a sentence ("you", "grows"…)
        a, sr = k.create(SPOKEN.get(line, line), voice=voice, speed=speed, lang="en-gb" if voice[0] == "b" else "en-us", trim=False)
        loud = np.where(np.abs(a) > 0.004)[0]
        a = a[max(0, loud[0] - int(0.04 * sr)): loud[-1] + int(0.12 * sr)]   # gentle trim, keep the tail
        a = np.concatenate([a, np.zeros(int(0.45 * sr), np.float32)])           # room for the echo to ring out
        tmp = "/tmp/_q.wav"; w = wave.open(tmp, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes()); w.close()
        f = slug(line) + ".mp3"
        # a touch of throne-room echo, then loudness-normalised
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-af", "aecho=0.8:0.6:35|70:0.12|0.07,loudnorm=I=-16:TP=-1.5", "-ac", "1", "-ar", "24000", "-b:a", "56k", os.path.join(out, f)], check=True)
        hop = sr // 30; env = [float(np.sqrt((a[i:i + hop] ** 2).mean())) for i in range(0, len(a), hop)]
        mx = max(env) or 1; env = [round(min(1.0, e / mx * 1.25), 2) for e in env]
        meta[line] = {"file": f, "dur": round(len(a) / sr, 2), "env": env}
        print(f, meta[line]["dur"])
    json.dump({"voice": voice, "lines": meta}, open(os.path.join(out, "lines.json"), "w"), separators=(",", ":"))

if __name__ == "__main__":
    main(*sys.argv[1:4])
