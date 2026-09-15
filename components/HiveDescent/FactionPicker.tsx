// components/HiveDescent/FactionPicker.tsx
// Pre-run champion selection: the chosen faction stands in the hive (live 3D), its signature card and starting deck
// on the right, the roster along the bottom.

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { DESCENT_FACTIONS } from "../../lib/descentConfig";
import { FACTION_CARDS, type Card } from "../../lib/descentCards";

const ChampionPreview = dynamic(() => import("./ChampionPreview"), { ssr: false });

type Props = { onConfirm: (factionId: string) => void; onCancel: () => void; cost?: number };

const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const LAST_KEY = "ra:hd:lastFaction";

const ROLE: Record<string, { tag: string; line: string }> = {
  ashigaru:  { tag: "BULWARK",   line: "Hits and braces in one motion. The safest first run." },
  ronin:     { tag: "EXECUTIONER", line: "One enormous cut a fight. Save it for the one that matters." },
  samurai:   { tag: "DUELIST",   line: "Marks a target Vulnerable so every Strike after lands harder." },
  bushi:     { tag: "WALL",      line: "Block and heal together. Outlasts anything on the early floors." },
  warrior:   { tag: "BERSERKER", line: "The biggest number in the deck, paid for in your own blood." },
  shogun:    { tag: "COMMANDER", line: "Strength stacks all fight long — every card gets stronger." },
  buke:      { tag: "ASSASSIN",  line: "Poison ticks every turn. Apply it, then hide behind Block." },
  kenshi:    { tag: "BLADEDANCER", line: "Two hits for one energy. Strength counts twice." },
  wokou:     { tag: "PIRATE",    line: "Loots REBEL on the swing. Richer runs, if you live." },
  sohei:     { tag: "MONK",      line: "A heal in the deck. The only faction that refills its one life bar." },
  yamabushi: { tag: "MYSTIC",    line: "Stuns. A stunned enemy skips its whole turn — read the intents." },
};

const TYPE_COLOR: Record<Card["type"], string> = { attack: "#f87171", skill: "#67e8f9", power: "#c084fc" };

function CardFace({ c, big = false }: { c: Card; big?: boolean }) {
  const col = TYPE_COLOR[c.type];
  return (
    <div style={{ fontFamily: FONT, width: big ? 150 : 96, height: big ? 200 : 128, borderRadius: 12, position: "relative", padding: big ? 12 : 8, border: `1px solid ${col}99`, background: `linear-gradient(180deg, ${col}26, rgba(8,8,14,0.95))`, boxShadow: `0 0 22px ${col}33`, color: "#fff", flex: "0 0 auto" }}>
      <div style={{ position: "absolute", top: -9, left: -9, width: 26, height: 26, borderRadius: "50%", background: "#fbbf24", color: "#1a1206", fontWeight: 900, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #000" }}>{c.cost}</div>
      <div style={{ fontSize: big ? 15 : 11, fontWeight: 900, lineHeight: 1.1, color: c.rarity === "faction" ? "#ff99dd" : "#fff", marginTop: 2 }}>{c.name}</div>
      <div style={{ fontSize: 8, letterSpacing: "0.15em", color: col, marginTop: 4 }}>{c.type.toUpperCase()}{c.target === "all" ? " · ALL" : ""}</div>
      <div style={{ fontSize: big ? 12 : 9, marginTop: big ? 12 : 8, lineHeight: 1.35, opacity: 0.9 }}>{c.text}</div>
    </div>
  );
}

const FactionPicker: React.FC<Props> = ({ onConfirm, onCancel, cost }) => {
  const [selected, setSelected] = useState<string>(() => { try { return localStorage.getItem(LAST_KEY) || "samurai"; } catch { return "samurai"; } });
  const [busy, setBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { const u = () => setIsMobile(window.innerWidth < 760); u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u); }, []);
  const f = DESCENT_FACTIONS.find((x) => x.id === selected) || DESCENT_FACTIONS[0];
  const card = FACTION_CARDS[f.id];
  const role = ROLE[f.id];
  const confirm = () => { if (busy) return; setBusy(true); try { localStorage.setItem(LAST_KEY, f.id); } catch {} onConfirm(f.id); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = DESCENT_FACTIONS.findIndex((x) => x.id === selected);
      if (e.key === "ArrowRight") setSelected(DESCENT_FACTIONS[(i + 1) % DESCENT_FACTIONS.length].id);
      if (e.key === "ArrowLeft") setSelected(DESCENT_FACTIONS[(i - 1 + DESCENT_FACTIONS.length) % DESCENT_FACTIONS.length].id);
      if (e.key === "Enter") confirm();
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, busy]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, fontFamily: FONT, background: "#000", color: "#fff", overflow: "hidden" }}>
      <ChampionPreview factionId={f.id} x={isMobile ? 0 : 0.9} />
      {/* vignette + readable edges */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.92) 100%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.6) 100%)" }} />

      {/* header */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <button type="button" onClick={onCancel} style={{ fontFamily: FONT, background: "none", border: "none", color: "rgba(255,255,255,0.65)", fontSize: 12, letterSpacing: "0.15em", cursor: "pointer", padding: 0 }}>← BACK</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#ff66cc", letterSpacing: "0.5em" }}>◆ CHOOSE YOUR CHAMPION ◆</div>
          <div style={{ fontSize: "clamp(22px, 4vw, 40px)", fontWeight: 900, letterSpacing: "0.12em", marginTop: 4, textShadow: "0 2px 30px #000" }}>{f.name.toUpperCase()}</div>
          <div style={{ fontSize: 10, letterSpacing: "0.35em", color: "#fbbf24", marginTop: 2 }}>{role?.tag}</div>
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* right panel: signature card + deck + begin */}
      <div style={{ position: "absolute", right: isMobile ? 12 : 28, left: isMobile ? 12 : "auto", top: isMobile ? "auto" : "50%", bottom: isMobile ? 132 : "auto", transform: isMobile ? "none" : "translateY(-50%)", width: isMobile ? "auto" : 360, background: "rgba(6,4,10,0.72)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,102,204,0.25)", borderRadius: 18, padding: isMobile ? 14 : 20, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.85)", fontStyle: "italic" }}>{role?.line}</div>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 14 }}>
          {card && <CardFace c={card} big={!isMobile} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.3em", color: "#ff66cc" }}>SIGNATURE CARD</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6, lineHeight: 1.5 }}>Two copies in your starting deck. Everything else is the same for every faction — this card is what makes {f.name} play differently.</div>
            <div style={{ fontSize: 9, letterSpacing: "0.3em", color: "#67e8f9", marginTop: 12 }}>STARTING DECK · 12</div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4, lineHeight: 1.6 }}>5 × Strike <span style={{ opacity: 0.5 }}>(6 dmg)</span><br />4 × Guard <span style={{ opacity: 0.5 }}>(5 Block)</span><br />1 × Focus <span style={{ opacity: 0.5 }}>(draw 2)</span><br /><span style={{ color: "#ff99dd" }}>2 × {card?.name}</span></div>
          </div>
        </div>
        <button type="button" onClick={confirm} disabled={busy} style={{ fontFamily: FONT, width: "100%", marginTop: 16, padding: "14px 18px", border: "none", borderRadius: 12, background: "linear-gradient(180deg, #ff3399 0%, #aa0066 60%, #5a0033 100%)", color: "#fff", fontWeight: 900, fontSize: 14, letterSpacing: "0.15em", cursor: busy ? "wait" : "pointer", boxShadow: "0 0 30px rgba(255,51,153,0.45), inset 0 1px 0 rgba(255,255,255,0.2)", opacity: busy ? 0.7 : 1 }}>
          {busy ? "ENTERING THE HIVE…" : `⚔ DESCEND AS ${f.name.toUpperCase()}${cost ? ` · ${cost} REBEL` : ""}`}
        </button>
        <div style={{ fontSize: 9, opacity: 0.4, textAlign: "center", marginTop: 8, letterSpacing: "0.15em" }}>← → TO BROWSE · ENTER TO GO</div>
      </div>

      {/* roster */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 16px 16px", display: "flex", gap: 8, justifyContent: isMobile ? "flex-start" : "center", overflowX: "auto", scrollbarWidth: "none" }}>
        {DESCENT_FACTIONS.map((x) => {
          const on = x.id === f.id;
          return (
            <button key={x.id} type="button" onClick={() => setSelected(x.id)} title={x.name} style={{ fontFamily: FONT, flex: "0 0 auto", width: isMobile ? 66 : 82, padding: 0, background: on ? "rgba(255,51,153,0.18)" : "rgba(0,0,0,0.55)", border: on ? "1px solid #ff66cc" : "1px solid rgba(255,255,255,0.12)", borderRadius: 12, color: "#fff", cursor: "pointer", overflow: "hidden", boxShadow: on ? "0 0 20px rgba(255,102,204,0.5)" : "none", transform: on ? "translateY(-6px)" : "none", transition: "all .15s" }}>
              <div style={{ height: isMobile ? 56 : 72, display: "flex", alignItems: "flex-end", justifyContent: "center", background: on ? "radial-gradient(ellipse at 50% 100%, rgba(255,51,153,0.35), transparent 70%)" : "transparent", paddingTop: 4 }}>
                <img src={`/descent/portraits/${x.id}.png`} alt={x.name} style={{ height: "94%", objectFit: "contain", filter: on ? "drop-shadow(0 0 8px rgba(255,102,204,0.8))" : "brightness(0.6) saturate(0.6)" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", padding: "5px 2px 6px", color: on ? "#ff99dd" : "rgba(255,255,255,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name.toUpperCase()}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default FactionPicker;
