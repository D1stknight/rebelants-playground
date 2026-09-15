// components/BountyHunters/BountyHunters.tsx
// Bounty Hunters — lobby → pick a board → run-and-gun → results. Entry costs REBEL; kills + the boss bounty pay out.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePoints } from "../../lib/usePoints";
import { loadProfile, getEffectivePlayerId } from "../../lib/profile";
import { pointsConfig as defaultPointsConfig } from "../../lib/pointsConfig";
import { BOARDS, BOUNTY_DEATH_KEEP, BOUNTY_DEFAULT_COST, BOUNTY_LIVES, KILL_BOUNTY, type Board } from "../../lib/bountyConfig";
import { preloadBoard } from "./game";
import { DESCENT_FACTIONS } from "../../lib/descentConfig";

const BountyGameView = dynamic(() => import("./BountyGame"), { ssr: false });

type Phase = "lobby" | "playing" | "result";
const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const BEST_KEY = "ra:bounty:best";
type Best = Record<number, { cleared: boolean; bounty: number }>;
function loadBest(): Best { try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); } catch { return {}; } }

const BountyHunters: React.FC = () => {
  const [pid, setPid] = useState("guest");
  useEffect(() => { const u = () => { try { setPid(getEffectivePlayerId(loadProfile()) || "guest"); } catch { setPid("guest"); } }; u(); window.addEventListener("ra:identity-changed", u); return () => window.removeEventListener("ra:identity-changed", u); }, []);
  const { balance, spend, earn, refresh } = usePoints(pid);
  const [cfg, setCfg] = useState<any>(defaultPointsConfig);
  useEffect(() => { (async () => { try { const r = await fetch("/api/config", { cache: "no-store" }); const j = await r.json().catch(() => null); if (r.ok && j?.pointsConfig) setCfg((p: any) => ({ ...p, ...j.pointsConfig })); } catch {} })(); }, []);
  const cost = Number(cfg?.bountyCost ?? BOUNTY_DEFAULT_COST);

  const [phase, setPhase] = useState<Phase>("lobby");
  const [board, setBoard] = useState<Board>(BOARDS[0]);
  const [faction, setFaction] = useState<string>(() => { try { return localStorage.getItem("ra:bh:faction") || "samurai"; } catch { return "samurai"; } });
  useEffect(() => { try { localStorage.setItem("ra:bh:faction", faction); } catch {} }, [faction]);
  const [best, setBest] = useState<Best>({});
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ cleared: boolean; bounty: number; kills: number; boardN: number; paid: number } | null>(null);
  useEffect(() => { setBest(loadBest()); }, []);
  useEffect(() => { preloadBoard(board, faction); }, [board, faction]);
  const unlockedN = useMemo(() => { let n = 1; for (const b of BOARDS) if (best[b.n]?.cleared) n = Math.max(n, b.n + 1); return Math.min(n, BOARDS.length); }, [best]);
  const canStart = balance >= cost && !starting && board.n <= unlockedN;

  async function start() {
    if (!canStart) return; setStarting(true); setErr("");
    const s = await spend(cost, "bounty");
    if (!s?.ok) { setStarting(false); setErr("Couldn't charge the entry fee — check your REBEL balance."); return; }
    setStarting(false); setPhase("playing");
  }

  const finishedRef = useRef(0);
  const onEnd = useCallback(async (r: { cleared: boolean; bounty: number; kills: number; boardN: number }) => {
    const paid = Math.max(0, Math.round(r.cleared ? r.bounty : r.bounty * BOUNTY_DEATH_KEEP));
    setResult({ ...r, paid }); setPhase("result");
    const key = Date.now(); finishedRef.current = key;
    if (paid > 0) { try { await earn(paid); } catch {} }
    try {
      const prof = loadProfile(); const pname = (prof?.discordName || prof?.name || "guest").trim() || "guest";
      await fetch("/api/wins/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: `${key}-${Math.random().toString(36).slice(2, 7)}`, ts: key, game: "bounty", playerId: pid, playerName: pname, rarity: r.cleared ? (r.boardN >= 4 ? "ultra" : r.boardN >= 2 ? "rare" : "common") : "none", pointsAwarded: paid, survivors: r.kills, prize: null }) });
    } catch {}
    try { const b = loadBest(); const prev = b[r.boardN]; b[r.boardN] = { cleared: (prev?.cleared || false) || r.cleared, bounty: Math.max(prev?.bounty || 0, paid) }; localStorage.setItem(BEST_KEY, JSON.stringify(b)); setBest(b); } catch {}
    window.dispatchEvent(new Event("ra:leaderboards-refresh"));
    await refresh().catch(() => {});
  }, [earn, pid, refresh]);

  if (phase === "playing") return <BountyGameView board={board} faction={faction} onEnd={onEnd} onQuit={() => onEnd({ cleared: false, bounty: 0, kills: 0, boardN: board.n })} />;

  if (phase === "result" && result) {
    const b = BOARDS.find((x) => x.n === result.boardN) || board; const next = BOARDS.find((x) => x.n === result.boardN + 1);
    return (
      <div style={{ minHeight: "100vh", color: "#fff", fontFamily: FONT, background: `radial-gradient(ellipse at center, ${result.cleared ? "#3a2a00" : "#2a0010"} 0%, #05000a 60%, #000 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: result.cleared ? "#fbbf24" : "#ff3366", letterSpacing: "0.5em", marginBottom: 14 }}>{result.cleared ? "⚑ BOUNTY COLLECTED ⚑" : "☠ HUNT FAILED ☠"}</div>
        <h1 style={{ fontSize: "clamp(30px, 7vw, 72px)", margin: 0, fontWeight: 900, letterSpacing: "0.06em", color: result.cleared ? "#ffd700" : "#ff3366", textShadow: `0 0 40px ${result.cleared ? "#ffd70088" : "#ff336688"}` }}>{result.cleared ? `${b.boss.name} IS DOWN` : "THE HIVE COLLECTS"}</h1>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.8)", marginTop: 12, fontStyle: "italic", maxWidth: 520 }}>{result.cleared ? `${b.name} cleared. The whole bounty is yours.` : `You fell on ${b.name}. Half the tags you collected made it back.`}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 28, width: "100%", maxWidth: 480 }}>
          {[{ l: "PAID OUT", v: `+${result.paid}`, c: "#fbbf24" }, { l: "COLLECTED", v: String(result.bounty), c: "#ff99dd" }, { l: "KILLS", v: String(result.kills), c: "#f87171" }].map((s) => (<div key={s.l} style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${s.c}33`, borderRadius: 12, padding: "12px 8px" }}><div style={{ fontSize: 22, fontWeight: 900, color: s.c }}>{s.v}</div><div style={{ fontSize: 9, letterSpacing: "0.25em", opacity: 0.55, marginTop: 4 }}>{s.l}</div></div>))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" onClick={() => setPhase("lobby")} style={{ fontFamily: FONT, padding: "14px 28px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, background: "rgba(255,255,255,0.06)", color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer" }}>↻ LOBBY</button>
          {result.cleared && next && <button type="button" onClick={() => { setBoard(next); setPhase("lobby"); }} style={{ fontFamily: FONT, padding: "14px 28px", border: "none", borderRadius: 12, background: "linear-gradient(180deg, #ffd700 0%, #aa6600 100%)", color: "#000", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer" }}>NEXT: {next.world}-{next.stage} {next.name.split(": ")[1].toUpperCase()} →</button>}
          {!result.cleared && <button type="button" onClick={() => setPhase("lobby")} style={{ fontFamily: FONT, padding: "14px 28px", border: "none", borderRadius: 12, background: "linear-gradient(180deg, #a78bfa 0%, #5b3fb0 100%)", color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer" }}>⚔ HUNT AGAIN</button>}
        </div>
      </div>
    );
  }

  // ── lobby
  return (
    <div style={{ minHeight: "100vh", color: "#fff", overflowX: "hidden", fontFamily: FONT, background: "radial-gradient(ellipse at 50% 0%, #1e1240 0%, #0a0616 50%, #000 100%)", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" }}>
        <a href="/" style={{ color: "rgba(255,255,255,0.65)", textDecoration: "none", fontSize: 12, fontWeight: 700, letterSpacing: "0.15em" }}>← PLAYGROUND</a>
        <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>⚡ {(balance || 0).toLocaleString()} <span style={{ fontSize: 10, opacity: 0.7 }}>REBEL</span></div>
      </div>
      <div style={{ textAlign: "center", padding: "20px 16px 8px" }}>
        <div style={{ fontSize: 11, color: "#a78bfa", letterSpacing: "0.45em", fontWeight: 700 }}>◆ RUN & GUN ◆</div>
        <h1 style={{ fontSize: "clamp(40px, 8vw, 88px)", margin: "8px 0 0", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 0.95, background: "linear-gradient(180deg, #fff 0%, #c4b5fd 55%, #6d4ec9 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>BOUNTY<br />HUNTERS</h1>
        <div style={{ fontSize: "clamp(13px, 1.8vw, 16px)", color: "rgba(255,255,255,0.75)", marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>
          Four worlds, twelve boards, {BOUNTY_LIVES} lives. Run, jump and shoot your way through the corrupted hive, collect bounty tags off everything you drop, and take the boss's head for the big payout.
        </div>
      </div>

      {/* hunter select */}
      <div style={{ maxWidth: 1000, margin: "22px auto 0", padding: "0 16px" }}>
        <div style={{ fontSize: 11, color: "#a78bfa", letterSpacing: "0.4em", textAlign: "center", marginBottom: 10 }}>◆ YOUR HUNTER ◆</div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
          {DESCENT_FACTIONS.map((f) => {
            const on = f.id === faction;
            return (
              <button key={f.id} type="button" onClick={() => setFaction(f.id)} title={f.name} style={{ fontFamily: FONT, width: 68, padding: 0, background: on ? "rgba(167,139,250,0.2)" : "rgba(0,0,0,0.5)", border: on ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#fff", cursor: "pointer", overflow: "hidden", boxShadow: on ? "0 0 16px rgba(167,139,250,0.5)" : "none", transform: on ? "translateY(-4px)" : "none", transition: "all .15s" }}>
                <div style={{ height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingTop: 4 }}><img src={`/descent/portraits/${f.id}.png`} alt={f.name} style={{ height: "94%", objectFit: "contain", filter: on ? "none" : "brightness(0.6) saturate(0.6)" }} /></div>
                <div style={{ fontSize: 7, fontWeight: 800, letterSpacing: "0.08em", padding: "4px 2px 6px", color: on ? "#c4b5fd" : "rgba(255,255,255,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name.toUpperCase()}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* board select — 4 worlds × 3 stages */}
      <div style={{ maxWidth: 1000, margin: "26px auto 0", padding: "0 16px" }}>
        <div style={{ fontSize: 11, color: "#a78bfa", letterSpacing: "0.4em", textAlign: "center", marginBottom: 12 }}>◆ PICK YOUR HUNT · {BOARDS.length} BOARDS ◆</div>
        {[1, 2, 3, 4].map((w) => {
          const stages = BOARDS.filter((b) => b.world === w); const first = stages[0];
          return (
            <div key={w} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10, alignItems: "stretch", marginBottom: 10 }}>
              <div style={{ borderRadius: 14, overflow: "hidden", position: "relative", minHeight: 96, backgroundImage: `url(/bounty/bg_${first.biome}_far.png)`, backgroundSize: "cover", backgroundPosition: "center 60%" }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: `url(/bounty/bg_${first.biome}_mid.png)`, backgroundSize: "cover", backgroundPosition: "center 100%" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.75))" }} />
                <div style={{ position: "absolute", left: 10, bottom: 8 }}><div style={{ fontSize: 9, letterSpacing: "0.3em", color: first.accent, fontWeight: 800 }}>WORLD {w}</div><div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.06em", textShadow: "0 1px 4px #000" }}>{first.name.split(" ")[0].toUpperCase()}</div></div>
                <img src={`/bounty/boss_${stages[2].boss.id}.png`} alt="" style={{ position: "absolute", right: 2, top: 6, width: 64, height: 64, objectFit: "none", objectPosition: "0 0", imageRendering: "pixelated", filter: stages[2].n > unlockedN ? "brightness(0.25)" : "drop-shadow(0 2px 4px #000)" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                {stages.map((b) => {
                  const locked = b.n > unlockedN; const on = board.n === b.n; const bb = best[b.n];
                  return (
                    <button key={b.id} type="button" disabled={locked} onClick={() => setBoard(b)} style={{ fontFamily: FONT, textAlign: "left", padding: "10px 12px", borderRadius: 12, border: on ? `2px solid ${b.accent}` : "1px solid rgba(255,255,255,0.12)", background: on ? `linear-gradient(180deg, ${b.accent}22, rgba(10,8,16,0.9))` : "rgba(10,8,16,0.8)", color: "#fff", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1, boxShadow: on ? `0 0 22px ${b.accent}55` : "none", transition: "all .15s" }}>
                      <div style={{ fontSize: 9, letterSpacing: "0.25em", fontWeight: 800, color: b.accent }}>{w}-{b.stage}{locked ? " · LOCKED" : bb?.cleared ? " · CLEARED" : ""}</div>
                      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", marginTop: 4 }}>{b.name.split(": ")[1].toUpperCase()}</div>
                      <div style={{ fontSize: 9, opacity: 0.6, fontStyle: "italic", marginTop: 2, minHeight: 12 }}>{b.subtitle}</div>
                      <div style={{ fontSize: 9, marginTop: 6, color: "#fbbf24", fontWeight: 800 }}>{b.boss.captain ? "CAPTAIN" : "☠ BOSS"} · {b.boss.name} · {b.boss.bounty}</div>
                      {bb && <div style={{ fontSize: 8, opacity: 0.5, marginTop: 3 }}>best +{bb.bounty}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* start */}
      <div style={{ maxWidth: 640, margin: "26px auto 0", padding: "0 16px", textAlign: "center" }}>
        <button type="button" onClick={start} disabled={!canStart} style={{ fontFamily: FONT, width: "100%", padding: "20px 24px", fontSize: "clamp(15px, 3.5vw, 21px)", fontWeight: 900, letterSpacing: "0.15em", color: "#fff", border: "none", borderRadius: 14, background: canStart ? "linear-gradient(180deg, #a78bfa 0%, #6d4ec9 55%, #3b2a70 100%)" : "linear-gradient(180deg, rgba(60,50,90,0.5) 0%, rgba(30,20,50,0.7) 100%)", cursor: canStart ? "pointer" : "not-allowed", boxShadow: canStart ? "0 0 40px rgba(167,139,250,0.45), inset 0 1px 0 rgba(255,255,255,0.2)" : "none", opacity: canStart ? 1 : 0.6 }}>
          🏹 HUNT {board.world}-{board.stage} · {board.name.split(": ")[1].toUpperCase()} · {cost} REBEL
        </button>
        {!canStart && !starting && balance < cost && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>⚠ Need {cost} REBEL to hunt. You have {balance}.</div>}
        {err && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>{err}</div>}
        <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          Tags: grunt {KILL_BOUNTY.grunt} · elite {KILL_BOUNTY.elite} · wasp {KILL_BOUNTY.wasp} · turret {KILL_BOUNTY.turret} · crates drop guns and tags<br />
          Clear the board and bank everything · die {BOUNTY_LIVES} times and you keep {Math.round(BOUNTY_DEATH_KEEP * 100)}% · clearing a board unlocks the next
        </div>
      </div>

      {/* how to */}
      <div style={{ maxWidth: 1000, margin: "30px auto 0", padding: "0 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        {[
          { t: "CONTROLS", c: "#c4b5fd", d: "← → run · Z / Space jump · X / Shift fire · ↑ aim up · ↓ crouch, or drop through a platform. Touch pads on phones." },
          { t: "ONE HIT", c: "#f87171", d: "Like the old days: anything that touches you takes a life. Bullets, wasps, spikes, pits. You respawn at the last checkpoint with a plain rifle." },
          { t: "GUNS", c: "#7ad4ff", d: "Crates drop capsules. S = spread (3 shots), L = laser (fast, goes through), F = flame (short, rapid). Dying puts you back on the rifle." },
          { t: "THE TARGET", c: "#fbbf24", d: "Every board ends in a locked arena: a captain on stages 1–2, the world boss on stage 3. Its bounty is the real money — kills on the way are tips." },
          { t: "THE HIVE FIGHTS BACK", c: "#a78bfa", d: "Deeper boards add moving and crumbling platforms, crushers, timed spikes, cannons, springs, brick walls and hopping spiders. Watch the rhythm, then go." },
        ].map((x) => (<div key={x.t} style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${x.c}33`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 10, letterSpacing: "0.25em", color: x.c, fontWeight: 700 }}>{x.t}</div><div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, lineHeight: 1.5 }}>{x.d}</div></div>))}
      </div>
      <div style={{ textAlign: "center", padding: "30px 16px", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em" }}>© 2026 Rebel Ants Playground · Bounty Hunters</div>
    </div>
  );
};

export default BountyHunters;
