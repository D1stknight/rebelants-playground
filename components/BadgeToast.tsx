// The badge pop-up: on every Playground page, a new badge slides in once the server hands it out
// (checked every 20 s while the tab is open). Gold and Mythic badges get the big treatment.
// Tap to open the Badge Wall (every app's badges, on the Rebel Economy).
import { useEffect, useRef, useState } from "react";

type NewBadge = { id: string; name: string; tier: string; tierLabel: string };
const COLOR: Record<string, string> = { common: "#c98a4b", rare: "#cfd8e3", epic: "#b77bff", legendary: "#fbbf24", mythic: "#ff3b6b", secret: "#8ff0b8" };
const HEX = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

function playerId(): string {
  try { return JSON.parse(localStorage.getItem("ra_profile_v1") || "{}")?.primaryId || "guest"; } catch { return "guest"; }
}

function Medal({ b, size }: { b: NewBadge; size: number }) {
  const [loaded, setLoaded] = useState(false);
  const col = COLOR[b.tier] || "#fbbf24";
  const [app, rest] = b.id.split(":");
  const art = "https://economy.rebelants.io/badges/" + app + "/" + rest + ".webp";
  if (loaded) return <img src={art} alt="" style={{ width: size, height: size * 1.1, objectFit: "contain", filter: `drop-shadow(0 0 12px ${col}88)` }} />;
  return (
    <>
      <img src={art} alt="" onLoad={() => setLoaded(true)} style={{ display: "none" }} />
      <span style={{ width: size, height: size * 1.08, clipPath: HEX, display: "inline-grid", placeItems: "center", background: b.tier === "mythic" ? "linear-gradient(160deg,#ff3b6b,#fff 50%,#ff3b6b)" : "linear-gradient(160deg,#ef4444,#f97316 50%,#fbbf24)" }}>
        <span style={{ width: size - 8, height: size * 1.08 - 8, clipPath: HEX, display: "grid", placeItems: "center", background: "#120b0b", font: `900 ${Math.round(size / 2.8)}px 'Noto Serif JP', Georgia, serif`, color: col }}>
          {b.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1)}
        </span>
      </span>
    </>
  );
}

export default function BadgeToast() {
  const [queue, setQueue] = useState<NewBadge[]>([]);
  const [shown, setShown] = useState<NewBadge | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      const pid = playerId();
      if (document.hidden || busy.current || pid === "guest" || pid.startsWith("guest")) return;
      busy.current = true;
      try {
        const r = await fetch("/api/badges/new?playerId=" + encodeURIComponent(pid), { cache: "no-store" });
        const j = await r.json();
        if (!stop && Array.isArray(j.badges) && j.badges.length) setQueue((q) => [...q, ...j.badges]);
      } catch { /* next time */ }
      busy.current = false;
    };
    const first = setTimeout(check, 4000);
    const t = setInterval(check, 20_000);
    const onVis = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(first); clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  useEffect(() => {
    if (shown || !queue.length) return;
    const next = queue[0];
    setQueue((q) => q.slice(1));
    setShown(next);
    const big = next.tier === "legendary" || next.tier === "mythic";
    const t = setTimeout(() => setShown(null), big ? 7000 : 4500);
    return () => clearTimeout(t);
  }, [queue, shown]);

  if (!shown) return null;
  const col = COLOR[shown.tier] || "#fbbf24";
  const big = shown.tier === "legendary" || shown.tier === "mythic";
  return (
    <a
      href={"/api/badges/wall?playerId=" + encodeURIComponent(playerId())}
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", left: "50%", bottom: big ? "50%" : 18, transform: big ? "translate(-50%, 50%)" : "translateX(-50%)", zIndex: 9999,
        display: "flex", flexDirection: big ? "column" : "row", alignItems: "center", gap: 12, textAlign: big ? "center" : "left",
        padding: big ? "18px 22px" : "10px 16px 10px 10px", width: big ? "min(360px, 92vw)" : "min(420px, 92vw)",
        borderRadius: 16, textDecoration: "none", color: "#f1ece4", background: "linear-gradient(180deg,#1a0d0d,#07080d)",
        border: "1.5px solid " + col, boxShadow: `0 0 0 4px rgba(0,0,0,.4), 0 0 36px ${col}66, 0 0 60px rgba(239,68,68,.25)`,
        fontFamily: "'Noto Serif JP', Georgia, serif", animation: "pgBadgeIn .55s cubic-bezier(.3,1.6,.5,1) both",
      }}
    >
      <style>{`@keyframes pgBadgeIn{from{opacity:0;transform:${big ? "translate(-50%,50%) scale(.6)" : "translate(-50%,30px)"}}to{opacity:1}}`}</style>
      <Medal b={shown} size={big ? 130 : 56} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".22em", color: col }}>{shown.tier === "secret" ? "SECRET BADGE FOUND" : "NEW BADGE · " + String(shown.tierLabel || "").toUpperCase()}</span>
        <span style={{ fontSize: big ? 22 : 16, fontWeight: 900, color: "#fff" }}>{shown.name}</span>
        <span style={{ fontSize: 11, color: "#b9ae96", fontFamily: "system-ui, sans-serif" }}>Tap to see your Badge Wall</span>
      </span>
    </a>
  );
}
