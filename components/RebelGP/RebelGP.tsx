// components/RebelGP/RebelGP.tsx
// Rebel Grand Prix — paddock (pick your ant + kart + track) → race → results. Entry costs REBEL, finishing place pays out.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePoints } from "../../lib/usePoints";
import { loadProfile, getEffectivePlayerId } from "../../lib/profile";
import { pointsConfig as defaultPointsConfig } from "../../lib/pointsConfig";
import { CHASSIS, CUPS, GP_DEFAULT_COST, GP_PAYOUT, GP_PLACE_POINTS, ITEMS, TRACKS, type ChassisId, type TrackMeta } from "../../lib/rgpConfig";
import { DESCENT_FACTIONS } from "../../lib/descentConfig";
import { preloadTrack, ord } from "./engine";

function retryChunk(e: any): never {
  try { const key = "ra:gp:chunkRetry"; const last = Number(sessionStorage.getItem(key) || 0); if (Date.now() - last > 30000) { sessionStorage.setItem(key, String(Date.now())); const u = new URL(location.href); u.searchParams.set("r", String(Date.now())); location.replace(u.toString()); } } catch {}
  throw e;
}
const RaceView = dynamic(() => import("./RaceView").catch(retryChunk), { ssr: false, loading: () => <div style={{ position: "fixed", inset: 0, background: "#000", color: "#ffd166", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Serif JP', serif", letterSpacing: "0.3em", fontSize: 12 }}>ROLLING TO THE GRID…</div> });

type Phase = "lobby" | "race" | "result";
const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const BEST_KEY = "ra:gp:best";
type Best = Record<string, { place: number; time: number }>;
function loadBest(): Best { try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); } catch { return {}; } }
function fmt(t: number) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, "0")}`; }

const RebelGP: React.FC = () => {
  const [pid, setPid] = useState("guest");
  useEffect(() => { const u = () => { try { setPid(getEffectivePlayerId(loadProfile()) || "guest"); } catch { setPid("guest"); } }; u(); window.addEventListener("ra:identity-changed", u); return () => window.removeEventListener("ra:identity-changed", u); }, []);
  const { balance, spend, earn, refresh } = usePoints(pid);
  const [cfg, setCfg] = useState<any>(defaultPointsConfig);
  useEffect(() => { (async () => { try { const r = await fetch("/api/config", { cache: "no-store" }); const j = await r.json().catch(() => null); if (r.ok && j?.pointsConfig) setCfg((p: any) => ({ ...p, ...j.pointsConfig })); } catch {} })(); }, []);
  const cost = Number(cfg?.gpCost ?? GP_DEFAULT_COST);

  const [phase, setPhase] = useState<Phase>("lobby");
  const [cup, setCup] = useState<number>(1);
  const [track, setTrack] = useState<TrackMeta>(TRACKS[0]);
  const [faction, setFaction] = useState<string>(() => { try { return localStorage.getItem("ra:gp:faction") || localStorage.getItem("ra:bh:faction") || "samurai"; } catch { return "samurai"; } });
  const [chassis, setChassis] = useState<ChassisId>(() => { try { return (localStorage.getItem("ra:gp:chassis") as ChassisId) || "soldier"; } catch { return "soldier"; } });
  useEffect(() => { try { localStorage.setItem("ra:gp:faction", faction); localStorage.setItem("ra:gp:chassis", chassis); } catch {} }, [faction, chassis]);
  const [best, setBest] = useState<Best>({});
  useEffect(() => { setBest(loadBest()); }, []);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ place: number; time: number; paid: number; trackId: string } | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 720); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  useEffect(() => { preloadTrack(track.id, [faction], [chassis]); }, [track, faction, chassis]);

  // a cup unlocks when every track of the previous cup has been finished top 3
  const cupUnlocked = useCallback((c: number) => c === 1 || TRACKS.filter((t) => t.cup === c - 1).every((t) => (best[t.id]?.place ?? 99) <= 3), [best]);
  const cupPoints = (c: number) => TRACKS.filter((t) => t.cup === c).reduce((s, t) => s + (best[t.id] ? GP_PLACE_POINTS[best[t.id].place - 1] : 0), 0);
  const canStart = balance >= cost && !starting && cupUnlocked(track.cup);

  async function start() {
    if (!canStart) return; setStarting(true); setErr("");
    try { if ("ontouchstart" in window || navigator.maxTouchPoints > 0) { const el: any = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: "hide" })?.catch?.(() => {}); } } catch {}
    const s = await spend(cost, "gp");
    if (!s?.ok) { setStarting(false); setErr("Couldn't charge the entry fee — check your REBEL balance."); try { (document.exitFullscreen || (document as any).webkitExitFullscreen)?.call(document); } catch {} return; }
    setStarting(false); try { window.scrollTo(0, 0); } catch {} setPhase("race");
  }
  const onEnd = useCallback(async (r: { place: number; time: number }) => {
    const paid = Math.round(cost * (GP_PAYOUT[r.place - 1] ?? 0));
    setResult({ ...r, paid, trackId: track.id }); setPhase("result");
    try { if (document.fullscreenElement || (document as any).webkitFullscreenElement) (document.exitFullscreen || (document as any).webkitExitFullscreen)?.call(document); } catch {}
    const key = Date.now();
    if (paid > 0) { try { await earn(paid); } catch {} }
    try {
      const prof = loadProfile(); const pname = (prof?.discordName || prof?.name || "guest").trim() || "guest";
      await fetch("/api/wins/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: `${key}-${Math.random().toString(36).slice(2, 7)}`, ts: key, game: "gp", playerId: pid, playerName: pname, rarity: r.place === 1 ? (track.cup >= 4 ? "ultra" : "rare") : r.place <= 3 ? "common" : "none", pointsAwarded: paid, survivors: 9 - r.place, prize: null }) });
    } catch {}
    try { const b = loadBest(); const prev = b[track.id]; if (!prev || r.place < prev.place || (r.place === prev.place && r.time < prev.time)) b[track.id] = { place: r.place, time: r.time }; localStorage.setItem(BEST_KEY, JSON.stringify(b)); setBest(b); } catch {}
    window.dispatchEvent(new Event("ra:leaderboards-refresh"));
    await refresh().catch(() => {});
  }, [cost, earn, pid, refresh, track]);

  if (phase === "race") return <RaceView trackId={track.id} faction={faction} chassis={chassis} onEnd={onEnd} onQuit={() => onEnd({ place: 8, time: 0 })} />;

  if (phase === "result" && result) {
    const t = TRACKS.find((x) => x.id === result.trackId) || track; const next = TRACKS.find((x) => x.n === t.n + 1); const podium = result.place <= 3;
    const c = CUPS.find((x) => x.id === t.cup)!;
    return (
      <div style={{ minHeight: "100vh", color: "#fff", fontFamily: FONT, background: `radial-gradient(ellipse at center, ${podium ? "#3a2a00" : "#1a1030"} 0%, #05000a 60%, #000 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: podium ? "#fbbf24" : "#a78bfa", letterSpacing: "0.5em", marginBottom: 14 }}>{podium ? "🏆 PODIUM FINISH" : "🏁 RACE COMPLETE"}</div>
        <h1 style={{ fontSize: "clamp(44px, 10vw, 96px)", margin: 0, fontWeight: 900, letterSpacing: "0.04em", color: result.place === 1 ? "#ffd700" : podium ? "#e0e0e0" : "#c4b5fd", textShadow: `0 0 40px ${podium ? "#ffd70066" : "#a78bfa55"}`, lineHeight: 1 }}>{ord(result.place).toUpperCase()}</h1>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.8)", marginTop: 12, fontStyle: "italic", maxWidth: 520 }}>{t.name} · {c.name}{result.time > 0 ? ` · ${fmt(result.time)}` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 28, width: "100%", maxWidth: 480 }}>
          {[{ l: "PAID OUT", v: `+${result.paid}`, c: "#fbbf24" }, { l: "CUP POINTS", v: `+${GP_PLACE_POINTS[result.place - 1]}`, c: c.accent }, { l: "CUP TOTAL", v: `${cupPoints(t.cup)}/30`, c: "#c4b5fd" }].map((s) => (<div key={s.l} style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${s.c}33`, borderRadius: 12, padding: "12px 8px" }}><div style={{ fontSize: 22, fontWeight: 900, color: s.c }}>{s.v}</div><div style={{ fontSize: 9, letterSpacing: "0.25em", opacity: 0.55, marginTop: 4 }}>{s.l}</div></div>))}
        </div>
        {result.place > 3 && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 14 }}>Top 3 on every track of the cup unlocks the next cup.</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" onClick={() => setPhase("lobby")} style={{ fontFamily: FONT, padding: "14px 28px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, background: "rgba(255,255,255,0.06)", color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer" }}>↻ PADDOCK</button>
          <button type="button" onClick={() => { setPhase("lobby"); setTimeout(() => start(), 50); }} disabled={balance < cost} style={{ fontFamily: FONT, padding: "14px 28px", border: "none", borderRadius: 12, background: "linear-gradient(180deg, #a78bfa 0%, #5b3fb0 100%)", color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer", opacity: balance < cost ? 0.5 : 1 }}>🏁 RACE AGAIN · {cost}</button>
          {next && next.cup === t.cup && <button type="button" onClick={() => { setTrack(next); setPhase("lobby"); }} style={{ fontFamily: FONT, padding: "14px 28px", border: "none", borderRadius: 12, background: "linear-gradient(180deg, #ffd700 0%, #aa6600 100%)", color: "#000", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer" }}>NEXT: {next.name.toUpperCase()} →</button>}
        </div>
      </div>
    );
  }

  // ── paddock
  const cupTracks = TRACKS.filter((t) => t.cup === cup); const cupMeta = CUPS.find((c) => c.id === cup)!;
  return (
    <div style={{ minHeight: "100vh", color: "#fff", overflowX: "hidden", fontFamily: FONT, background: "radial-gradient(ellipse at 50% 0%, #1e1240 0%, #0a0616 50%, #000 100%)", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" }}>
        <a href="/" style={{ color: "rgba(255,255,255,0.65)", textDecoration: "none", fontSize: 12, fontWeight: 700, letterSpacing: "0.15em" }}>← PLAYGROUND</a>
        <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>⚡ {(balance || 0).toLocaleString()} <span style={{ fontSize: 10, opacity: 0.7 }}>REBEL</span></div>
      </div>
      <div style={{ textAlign: "center", padding: "20px 16px 8px" }}>
        <div style={{ fontSize: 11, color: "#ffd166", letterSpacing: "0.45em", fontWeight: 700 }}>◆ KART RACING ◆</div>
        <h1 style={{ fontSize: "clamp(40px, 8vw, 88px)", margin: "8px 0 0", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 0.95, background: "linear-gradient(180deg, #fff 0%, #ffd166 55%, #c0392b 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>REBEL<br />GRAND PRIX</h1>
        <div style={{ fontSize: "clamp(13px, 1.8vw, 16px)", color: "rgba(255,255,255,0.75)", marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>
          Five cups, fifteen tracks, eight karts on the grid. Drift the corners, grab the boxes, and put a Homing Wasp in whoever is ahead of you. Finishing place pays out in REBEL.
        </div>
      </div>

      {/* driver */}
      <div style={{ maxWidth: 1000, margin: "22px auto 0", padding: "0 16px" }}>
        <div style={{ fontSize: 11, color: "#a78bfa", letterSpacing: "0.4em", textAlign: "center", marginBottom: 10 }}>◆ YOUR DRIVER ◆</div>
        <div style={narrow ? { display: "flex", gap: 6, overflowX: "auto", padding: "6px 2px 4px", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" } as React.CSSProperties : { display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
          {DESCENT_FACTIONS.map((f) => { const on = f.id === faction; return (
            <button key={f.id} type="button" onClick={() => setFaction(f.id)} title={f.name} style={{ fontFamily: FONT, width: 68, flex: "0 0 auto", padding: 0, background: on ? "rgba(255,209,102,0.15)" : "rgba(0,0,0,0.5)", border: on ? "1px solid #ffd166" : "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#fff", cursor: "pointer", overflow: "hidden", boxShadow: on ? "0 0 16px rgba(255,209,102,0.4)" : "none", transform: on ? "translateY(-4px)" : "none", transition: "all .15s" }}>
              <div style={{ height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingTop: 4 }}><img src={`/descent/portraits/${f.id}.png`} alt={f.name} style={{ height: "94%", objectFit: "contain", filter: on ? "none" : "brightness(0.6) saturate(0.6)" }} /></div>
              <div style={{ fontSize: 7, fontWeight: 800, letterSpacing: "0.08em", padding: "4px 2px 6px", color: on ? "#ffd166" : "rgba(255,255,255,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name.toUpperCase()}</div>
            </button>); })}
        </div>
      </div>

      {/* kart */}
      <div style={{ maxWidth: 1000, margin: "24px auto 0", padding: "0 16px" }}>
        <div style={{ fontSize: 11, color: "#a78bfa", letterSpacing: "0.4em", textAlign: "center", marginBottom: 10 }}>◆ YOUR KART · 5 CHASSIS ◆</div>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 }}>
          {CHASSIS.map((k) => { const on = k.id === chassis; return (
            <button key={k.id} type="button" onClick={() => setChassis(k.id)} style={{ fontFamily: FONT, textAlign: "left", padding: "10px 12px", borderRadius: 12, border: on ? "2px solid #ffd166" : "1px solid rgba(255,255,255,0.12)", background: on ? "linear-gradient(180deg, rgba(255,209,102,0.15), rgba(10,8,16,0.9))" : "rgba(10,8,16,0.8)", color: "#fff", cursor: "pointer", boxShadow: on ? "0 0 22px rgba(255,209,102,0.3)" : "none", display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 128, height: 64, flex: "0 0 auto", backgroundImage: `url(/rgp/karts/kart_${faction}_${k.id}.png)`, backgroundPosition: `-${4 * 128}px -58px`, backgroundRepeat: "no-repeat", imageRendering: "pixelated", filter: on ? "none" : "brightness(0.7)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.08em", color: on ? "#ffd166" : "#fff" }}>{k.name.toUpperCase()}</div>
                <div style={{ fontSize: 9, opacity: 0.6, fontStyle: "italic", marginTop: 2 }}>{k.blurb}</div>
                <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: "2px 6px", marginTop: 6, fontSize: 8, letterSpacing: "0.15em", alignItems: "center" }}>
                  {[["SPEED", k.top], ["ACCEL", k.accel], ["TURN", k.handling], ["WEIGHT", k.weight]].map(([l, v]) => (<React.Fragment key={l as string}><span style={{ opacity: 0.6 }}>{l}</span><div style={{ height: 5, background: "rgba(255,255,255,0.12)", borderRadius: 3 }}><div style={{ width: `${Math.min(100, ((v as number) / 1.5) * 100)}%`, height: "100%", borderRadius: 3, background: on ? "#ffd166" : "#a78bfa" }} /></div></React.Fragment>))}
                </div>
              </div>
            </button>); })}
        </div>
      </div>

      {/* cups + tracks */}
      <div style={{ maxWidth: 1000, margin: "26px auto 0", padding: "0 16px" }}>
        <div style={{ fontSize: 11, color: "#a78bfa", letterSpacing: "0.4em", textAlign: "center", marginBottom: 12 }}>◆ PICK YOUR RACE · 5 CUPS · 15 TRACKS ◆</div>
        <div style={{ display: "flex", gap: 6, justifyContent: narrow ? "flex-start" : "center", overflowX: "auto", paddingBottom: 6, scrollbarWidth: "none" } as React.CSSProperties}>
          {CUPS.map((c) => { const on = c.id === cup; const locked = !cupUnlocked(c.id); const pts = cupPoints(c.id); return (
            <button key={c.id} type="button" onClick={() => { setCup(c.id); const first = TRACKS.find((t) => t.cup === c.id)!; setTrack(first); }} style={{ fontFamily: FONT, flex: "0 0 auto", padding: "8px 14px", borderRadius: 999, border: on ? `1px solid ${c.accent}` : "1px solid rgba(255,255,255,0.12)", background: on ? `${c.accent}22` : "rgba(0,0,0,0.5)", color: on ? c.accent : locked ? "rgba(255,255,255,0.4)" : "#fff", fontWeight: 800, fontSize: 11, letterSpacing: "0.12em", cursor: "pointer", whiteSpace: "nowrap" }}>{locked ? "🔒 " : pts >= 24 ? "🏆 " : ""}{c.name.toUpperCase()}{pts > 0 ? <span style={{ opacity: 0.6, fontSize: 9 }}> · {pts}/30</span> : null}</button>); })}
        </div>
        {!cupUnlocked(cup) && <div style={{ textAlign: "center", fontSize: 11, color: "#ff99aa", marginTop: 6 }}>🔒 Finish top 3 on all three {CUPS[cup - 2].name} tracks to unlock.</div>}
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
          {cupTracks.map((t) => { const on = track.id === t.id; const bb = best[t.id]; const locked = !cupUnlocked(t.cup); return (
            <button key={t.id} type="button" disabled={locked} onClick={() => setTrack(t)} style={{ fontFamily: FONT, textAlign: "left", padding: 0, borderRadius: 12, border: on ? `2px solid ${cupMeta.accent}` : "1px solid rgba(255,255,255,0.12)", background: "rgba(10,8,16,0.85)", color: "#fff", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.45 : 1, boxShadow: on ? `0 0 22px ${cupMeta.accent}55` : "none", overflow: "hidden", display: "flex", flexDirection: narrow ? "row" : "column" }}>
              <div style={{ width: narrow ? 110 : "100%", height: narrow ? 90 : 120, flex: "0 0 auto", backgroundImage: `url(/rgp/tracks/${t.id}/thumb.png)`, backgroundSize: "cover", backgroundPosition: "center", filter: on ? "none" : "brightness(0.75)" }} />
              <div style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.25em", fontWeight: 800, color: cupMeta.accent }}>RACE {((t.n - 1) % 3) + 1} · {t.diff <= 5 ? "ROOKIE" : t.diff <= 10 ? "VETERAN" : "ELITE"}</div>
                <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.04em", marginTop: 4 }}>{t.name.toUpperCase()}</div>
                <div style={{ fontSize: 9, marginTop: 6, color: "#fbbf24", fontWeight: 800 }}>{bb ? `BEST ${ord(bb.place).toUpperCase()} · ${fmt(bb.time)}` : "NOT RACED YET"}</div>
              </div>
            </button>); })}
        </div>
      </div>

      {/* start */}
      <div style={{ maxWidth: 640, margin: "26px auto 0", padding: "0 16px", textAlign: "center", ...(narrow ? { position: "sticky", bottom: 0, zIndex: 5, background: "linear-gradient(180deg, rgba(5,2,12,0) 0%, rgba(5,2,12,0.96) 30%)", paddingTop: 14, paddingBottom: "max(12px, env(safe-area-inset-bottom))" } : {}) }}>
        <button type="button" onClick={start} disabled={!canStart} style={{ fontFamily: FONT, width: "100%", padding: narrow ? "16px 18px" : "20px 24px", fontSize: "clamp(15px, 3.5vw, 21px)", fontWeight: 900, letterSpacing: "0.15em", color: canStart ? "#000" : "#fff", border: "none", borderRadius: 14, background: canStart ? "linear-gradient(180deg, #ffe08a 0%, #ffb700 55%, #b06a00 100%)" : "linear-gradient(180deg, rgba(60,50,90,0.5) 0%, rgba(30,20,50,0.7) 100%)", cursor: canStart ? "pointer" : "not-allowed", boxShadow: canStart ? "0 0 40px rgba(255,209,102,0.45), inset 0 1px 0 rgba(255,255,255,0.4)" : "none", opacity: canStart ? 1 : 0.6 }}>
          🏁 RACE · {track.name.toUpperCase()} · {cost} REBEL
        </button>
        {!canStart && !starting && balance < cost && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>⚠ Need {cost} REBEL to race. You have {balance}.</div>}
        {err && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>{err}</div>}
        {!narrow && <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          Payout by place: {GP_PAYOUT.slice(0, 4).map((m, i) => `${ord(i + 1)} ×${m}`).join(" · ")} · 5th–7th keep a little · 8th nothing<br />
          Cup points 10/8/6/5/4/3/2/1 · top 3 on all three tracks unlocks the next cup
        </div>}
      </div>

      {/* how to */}
      <div style={{ maxWidth: 1000, margin: "30px auto 0", padding: "0 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        {[
          { t: "CONTROLS", c: "#c4b5fd", d: "↑ gas · ← → steer · ↓ brake · SPACE / Z drift · X / SHIFT item. On phones gas is automatic: steer with the pads, ⤴ drifts, ★ fires your item." },
          { t: "DRIFTING", c: "#7ad4ff", d: "Hold drift while turning to hop into a slide. Hold it through the corner — release after a second for a mini-turbo. Blue boost pads on the road give a free one." },
          { t: "ITEMS", c: "#ffd166", d: Object.values(ITEMS).map((i) => i.name).join(" · ") + ". Leaders get slicks and shields; the back of the pack gets wasps, nectar and the Queen's Wrath." },
          { t: "THE TRACKS", c: "#f87171", d: "Grass is slow, walls hurt, water / acid / lava / corruption drop you back on the road after a dunk. Spiders patrol, crushers stomp, geysers erupt, boulders roll. Learn the rhythm." },
          { t: "THE GRID", c: "#7ad27a", d: "You start last. Seven rival factions race you, and they get faster when you pull ahead. Finish top 3 on all three tracks of a cup to open the next one." },
        ].map((x) => (<div key={x.t} style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${x.c}33`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 10, letterSpacing: "0.25em", color: x.c, fontWeight: 700 }}>{x.t}</div><div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, lineHeight: 1.5 }}>{x.d}</div></div>))}
      </div>
      <div style={{ textAlign: "center", padding: "30px 16px", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em" }}>© 2026 Rebel Ants Playground · Rebel Grand Prix</div>
    </div>
  );
};
export default RebelGP;
