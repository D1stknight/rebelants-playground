# usage: python3 retarget.py <faction.glb> <out.json> [Soldier.glb from three.js r160 examples/models/gltf]
# retarget three.js Soldier (Mixamo) Walk/Run onto the Faction Wars rig → quaternion tracks JSON in FW local space
import json, struct, sys, numpy as np
from scipy.spatial.transform import Rotation as Rot, Slerp
def glb(p):
    b = open(p, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l]); bin_ = None
    off = 20 + l
    if off < len(b): bl = struct.unpack('<I', b[off:off + 4])[0]; bin_ = b[off + 8: off + 8 + bl]
    return j, bin_
def acc(j, bin_, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); return np.frombuffer(bin_, np.float32, a['count'] * n, o).reshape(a['count'], n) if n > 1 else np.frombuffer(bin_, np.float32, a['count'], o)
def tree(j):
    par = {}
    for i, n in enumerate(j['nodes']):
        for c in n.get('children', []): par[c] = i
    return par
def mat(n):
    q = n.get('rotation', [0, 0, 0, 1]); t = n.get('translation', [0, 0, 0]); s = n.get('scale', [1, 1, 1]); M = np.eye(4); M[:3, :3] = Rot.from_quat(q).as_matrix() * np.array(s); M[:3, 3] = t; return M
def globals_(j, par, local_rot=None):
    G = {}
    def g(i):
        if i in G: return G[i]
        n = j['nodes'][i]; M = mat(n)
        if local_rot and i in local_rot: M[:3, :3] = Rot.from_quat(local_rot[i]).as_matrix() * np.array(n.get('scale', [1, 1, 1]))
        G[i] = (g(par[i]) @ M) if i in par else M; return G[i]
    for i in range(len(j['nodes'])): g(i)
    return G
def rotof(M): U = M[:3, :3]; U = U / np.linalg.norm(U, axis=0); return Rot.from_matrix(U)

S, Sb = glb(sys.argv[3] if len(sys.argv) > 3 else '/tmp/Soldier.glb'); T, _ = glb(sys.argv[1]); out = sys.argv[2]
sp, tp = tree(S), tree(T)
sidx = {n.get('name', ''): i for i, n in enumerate(S['nodes'])}; tidx = {n.get('name', ''): i for i, n in enumerate(T['nodes'])}
bones = [nm[len('mixamorig_'):] for nm in tidx if nm.startswith('mixamorig_') and ('mixamorig:' + nm[len('mixamorig_'):]) in sidx]
Srest = globals_(S, sp); Trest = globals_(T, tp)
C = Rot.from_euler('y', np.pi)  # soldier faces -z, FW ants face +z
# per-bone T-pose alignment (target bone direction → source bone direction)
def child_of(j, i, idx):
    ch = j['nodes'][i].get('children', []); return ch[0] if ch else None
align = {}
for b in bones:
    ti, si = tidx['mixamorig_' + b], sidx['mixamorig:' + b]; tc, sc = child_of(T, ti, tidx), child_of(S, si, sidx)
    if tc is None or sc is None or b in ('Hips',): align[b] = Rot.identity(); continue
    dt = Trest[tc][:3, 3] - Trest[ti][:3, 3]; ds = C.apply(Srest[sc][:3, 3] - Srest[si][:3, 3])
    if np.linalg.norm(dt) < 1e-6 or np.linalg.norm(ds) < 1e-6: align[b] = Rot.identity(); continue
    dt /= np.linalg.norm(dt); ds /= np.linalg.norm(ds); ax = np.cross(dt, ds); s = np.linalg.norm(ax); c = np.dot(dt, ds)
    align[b] = Rot.identity() if s < 1e-6 else Rot.from_rotvec(ax / s * np.arctan2(s, c))
res = {}
for an in S['animations']:
    if an['name'] not in ('Walk', 'Run'): continue
    samp = {}; dur = 0
    for ch in an['channels']:
        if ch['target']['path'] != 'rotation': continue
        sm = an['samplers'][ch['sampler']]; tt = acc(S, Sb, sm['input']); qq = acc(S, Sb, sm['output']); dur = max(dur, tt[-1])
        samp[ch['target']['node']] = (tt, qq)
    fps = 30; times = np.arange(0, dur + 1e-6, 1 / fps); tracks = {b: [] for b in bones}
    for t in times:
        lr = {}
        for ni, (tt, qq) in samp.items():
            if len(tt) == 1 or t <= tt[0]: lr[ni] = qq[0]; continue
            if t >= tt[-1]: lr[ni] = qq[-1]; continue
            k = np.searchsorted(tt, t) - 1; u = (t - tt[k]) / (tt[k + 1] - tt[k]); lr[ni] = Slerp([0, 1], Rot.from_quat([qq[k], qq[k + 1]]))(u).as_quat()
        Sg = globals_(S, sp, lr); Tg = {}
        # walk target bones in hierarchy order
        def tglob(i):
            if i in Tg: return Tg[i]
            nm = T['nodes'][i].get('name', ''); b = nm[len('mixamorig_'):] if nm.startswith('mixamorig_') else None
            if b in align:
                si = sidx['mixamorig:' + b]; D = rotof(Sg[si]) * rotof(Srest[si]).inv(); Tg[i] = C * D * C.inv() * align[b] * rotof(Trest[i])
            else:
                pr = tglob(tp[i]) if i in tp else Rot.identity(); Tg[i] = pr * Rot.from_quat(T['nodes'][i].get('rotation', [0, 0, 0, 1]))
            return Tg[i]
        for b in bones:
            i = tidx['mixamorig_' + b]; pr = tglob(tp[i]) if i in tp else Rot.identity(); loc = (pr.inv() * tglob(i)).as_quat()
            tracks[b].append(loc)
    # continuity of quaternion signs
    for b in bones:
        a = np.array(tracks[b])
        for k in range(1, len(a)):
            if np.dot(a[k], a[k - 1]) < 0: a[k] = -a[k]
        tracks[b] = [round(float(x), 4) for x in a.flatten()]
    res[an['name'].lower()] = {'dur': float(times[-1]), 'fps': fps, 'n': len(times), 'tracks': tracks}
    # hips bob (y translation, normalised to hip height)
    for ch in an['channels']:
        if ch['target']['path'] == 'translation' and ch['target']['node'] == sidx['mixamorig:Hips']:
            sm = an['samplers'][ch['sampler']]; tt = acc(S, Sb, sm['input']); pp = acc(S, Sb, sm['output'])
            y = np.interp(times, tt, pp[:, 2]); res[an['name'].lower()]['bob'] = [round(float(v), 4) for v in (y - y.mean()) / 106.13]
json.dump(res, open(out, 'w'), separators=(',', ':'))
print({k: (v['n'], v['dur'], len(v['tracks'])) for k, v in res.items()})
