// The home screen's Hall of Badges button. A dot shows when a badge or a finished mission popped up
// since the player last opened the Hall (browser-only, a convenience).
import { useEffect, useState } from "react";

function hasNew(): boolean {
  try { return Number(localStorage.getItem("hall-new") || 0) > Number(localStorage.getItem("hall-seen") || 0); } catch { return false; }
}

export default function HallButton() {
  const [dot, setDot] = useState(false);
  useEffect(() => { const f = () => setDot(hasNew()); f(); const t = setInterval(f, 15_000); return () => clearInterval(t); }, []);
  return (
    <a
      href="/hall"
      style={{ position: "relative", fontFamily: "inherit", padding: "9px 16px", fontSize: 11, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", background: "linear-gradient(135deg,rgba(239,68,68,.18),rgba(249,115,22,.12))", border: "2px solid rgba(251,191,36,0.75)", borderRadius: 50, color: "#fbbf24", textDecoration: "none", boxShadow: "0 0 16px rgba(249,115,22,0.35)", whiteSpace: "nowrap" }}
    >
      🏅 HALL OF BADGES
      {dot && <span aria-label="Something new" style={{ position: "absolute", top: -3, right: -3, width: 10, height: 10, borderRadius: "50%", background: "#ff3b6b", boxShadow: "0 0 8px #ff3b6b" }} />}
    </a>
  );
}
