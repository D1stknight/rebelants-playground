// dev-only (copy to pages/dev/q3d.tsx): drive components/Queen3D poses and grab frames. window.__set(pose, seconds) → PNG data URL
import React, { useEffect, useRef } from "react";
import { QueenRig as Queen3D, type QueenPose } from "../../components/QueenRig";
export default function Q3D() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { (async () => { try {
    const q = await Queen3D.load("/models/queen/queen_web.glb", ref.current!); q.renderer.setPixelRatio(1); q.renderer.setSize(1024, 1024, false);
    const w = window as any; w.__q = q;
    w.__set = (p: QueenPose, secs: number) => { q.setPose(p); const n = Math.round(secs * 60); for (let i = 0; i < n; i++) q.update(1 / 60); q.render(); return [ref.current!.toDataURL("image/png"), q.gemPx(), q.headPx()]; };
    w.__ready = true;
  } catch (e: any) { console.error('Q3D ' + String(e?.stack).slice(0, 900)); } })(); }, []);
  return <canvas ref={ref} width={1024} height={1024} style={{ width: 1024, height: 1024 }} />;
}
