import React from "react";
import dynamic from "next/dynamic";
const RaceView = dynamic(() => import("../../components/RebelGP/RaceView"), { ssr: false });
export default function Dev() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const t = q?.get("t") || "j1"; const f = q?.get("f") || "samurai"; const k = (q?.get("k") || "soldier") as any;
  if (typeof window !== "undefined" && q?.get("ai")) { const iv = setInterval(() => { const g = (window as any).__gp; if (g) { g.autopilot = true; clearInterval(iv); } }, 300); }
  return <RaceView trackId={t} faction={f} chassis={k} onEnd={(r) => { (window as any).__gpEnd = r; console.log("END", r); }} onQuit={() => console.log("quit")} />;

}
