// components/GameBoards.tsx — in-game Hall of Fame: leaderboards, the player's own stats and the latest finishes
// for Hive Descent, Bounty Hunters, Rebel Grand Prix and The Siege (data: /api/boards/[game]).
import React, { useCallback, useEffect, useMemo, useState } from "react";

type Row = { rank: number; playerId: string; playerName: string; value: number };
type Board = { id: string; label: string; unit: string; kind: "best" | "sum"; rows: Row[] };
type Data = { ok: boolean; boards: Board[]; trackBoards: { trackId: string; rows: Row[] }[]; me: null | { stats: Record<string, any>; ranks: Record<string, number | null> }; recent: { ts: number; playerId: string; playerName: string; summary: string }[] };
export type BoardGameId = "descent" | "bounty" | "gp" | "siege";

const ICON: Record<string, string> = { floor: "🕳️", slain: "👑", kills: "☠️", earned: "⚡", board: "🎯", bounties: "💰", wins: "🏆", podiums: "🥇", races: "🏁", score: "⭐", wave: "🌊", held: "🛡️" };
const fmtMs = (ms: number) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), c = Math.floor((ms % 1000) / 10); return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`; };
function fmtValue(game: BoardGameId, id: string, v: number) {
  if (id === "floor") return `FLOOR ${v}`;
  if (id === "wave") return `WAVE ${v}`;
  if (id === "board") return `BOARD ${v}`;
  if (id === "earned") return `${Math.round(v).toLocaleString()} ⚡`;
  return Math.round(v).toLocaleString();
}
const ago = (ts: number) => { const s = Math.max(1, Math.round((Date.now() - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };

// what "your stats" shows, per game
const MINE: Record<BoardGameId, { k: string; l: string }[]> = {
  descent: [{ k: "runs", l: "Runs" }, { k: "floor", l: "Deepest floor" }, { k: "slain", l: "Queen kills" }, { k: "kills", l: "Enemies slain" }, { k: "earned", l: "REBEL banked" }],
  bounty: [{ k: "runs", l: "Hunts" }, { k: "board", l: "Best board" }, { k: "bounties", l: "Bounties" }, { k: "kills", l: "Kills" }, { k: "earned", l: "REBEL earned" }],
  gp: [{ k: "races", l: "Races" }, { k: "wins", l: "Wins" }, { k: "podiums", l: "Podiums" }, { k: "earned", l: "Prize money" }],
  siege: [{ k: "runs", l: "Defences" }, { k: "score", l: "High score" }, { k: "wave", l: "Furthest wave" }, { k: "kills", l: "Spiders slain" }, { k: "held", l: "Gate held" }],
};

export default function GameBoards(props: {
  game: BoardGameId;
  playerId: string;
  accent: string;
  font?: string;
  title?: string;
  tracks?: { id: string; name: string; cup?: number }[];
  compact?: boolean;
  dark?: string;
}) {
  const { game, playerId, accent, font, compact } = props;
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const signedIn = !!playerId && playerId !== "guest" && !/^guest/.test(playerId);
  const trackParam = useMemo(() => (props.tracks || []).map((t) => t.id).join(","), [props.tracks]);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ n: compact ? "5" : "10" });
      if (signedIn) q.set("playerId", playerId);
      if (trackParam) q.set("tracks", trackParam);
      const r = await fetch(`/api/boards/${game}?${q.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) setData(j);
    } catch {}
    setLoading(false);
  }, [game, playerId, signedIn, trackParam, compact]);
  useEffect(() => { void load(); const h = () => { setTimeout(() => void load(), 600); }; window.addEventListener("ra:leaderboards-refresh", h); return () => window.removeEventListener("ra:leaderboards-refresh", h); }, [load]);

  const boards = data?.boards || [];
  const b = boards[Math.min(tab, Math.max(0, boards.length - 1))];
  const panel: React.CSSProperties = { background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.45))", border: `1px solid ${accent}40`, borderRadius: 16, padding: compact ? 12 : 16, backdropFilter: "blur(6px)" };
  const medal = (r: number) => (r === 1 ? "#ffd700" : r === 2 ? "#d8dde6" : r === 3 ? "#e09b5a" : "rgba(255,255,255,0.35)");

  return (
    <div style={{ fontFamily: font, color: "#fff", maxWidth: 1080, margin: compact ? "0 auto" : "38px auto 0", padding: compact ? 0 : "0 20px", position: "relative", zIndex: 2 }}>
      {!compact && <div style={{ fontSize: 11, color: accent, letterSpacing: "0.45em", textAlign: "center", marginBottom: 16, fontWeight: 800 }}>◆ {props.title || "HALL OF FAME"} ◆</div>}
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        {/* leaderboards */}
        <div style={panel}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {boards.map((x, i) => (
              <button key={x.id} type="button" onClick={() => setTab(i)} style={{ fontFamily: font, cursor: "pointer", padding: "6px 10px", borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", border: `1px solid ${i === tab ? accent : "rgba(255,255,255,0.14)"}`, background: i === tab ? `${accent}26` : "rgba(0,0,0,0.3)", color: i === tab ? "#fff" : "rgba(255,255,255,0.7)" }}>
                {ICON[x.id] || "◆"} {x.label.toUpperCase()}
              </button>
            ))}
          </div>
          {loading && !data && <div style={{ fontSize: 12, opacity: 0.6, padding: "18px 4px" }}>Loading the boards…</div>}
          {b && b.rows.length === 0 && <div style={{ fontSize: 12, opacity: 0.65, padding: "18px 4px", lineHeight: 1.6 }}>Nobody on this board yet. Finish a run and the first spot is yours.</div>}
          {b && b.rows.map((r) => {
            const me = signedIn && r.playerId === playerId;
            return (
              <div key={r.playerId} style={{ display: "grid", gridTemplateColumns: "34px 1fr auto", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 10, marginBottom: 3, background: me ? `${accent}22` : r.rank <= 3 ? "rgba(255,255,255,0.04)" : "transparent", border: me ? `1px solid ${accent}66` : "1px solid transparent" }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: r.rank <= 3 ? "#1a1206" : "#fff", background: r.rank <= 3 ? `radial-gradient(circle at 35% 30%, #fff8, ${medal(r.rank)})` : "rgba(255,255,255,0.08)", boxShadow: r.rank === 1 ? `0 0 12px ${medal(1)}88` : "none" }}>{r.rank}</div>
                <div style={{ fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.playerName}{me && <span style={{ fontSize: 9, color: accent, marginLeft: 6, letterSpacing: "0.15em" }}>YOU</span>}</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: r.rank === 1 ? "#ffd700" : accent, fontVariantNumeric: "tabular-nums" }}>{fmtValue(game, b.id, r.value)}</div>
              </div>
            );
          })}
        </div>

        {/* your stats */}
        {!compact && (
          <div style={panel}>
            <div style={{ fontSize: 10, letterSpacing: "0.3em", color: accent, fontWeight: 800, marginBottom: 10 }}>YOUR STATS</div>
            {!signedIn ? (
              <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.6 }}>Sign in on the Playground home page to get your name on the boards and keep your stats.</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 8 }}>
                  {MINE[game].map((m) => {
                    const v = Number(data?.me?.stats?.[m.k] || 0);
                    const rank = data?.me?.ranks?.[m.k];
                    return (
                      <div key={m.k} style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 10px 9px" }}>
                        <div style={{ fontSize: 9, letterSpacing: "0.18em", opacity: 0.6, fontWeight: 800 }}>{m.l.toUpperCase()}</div>
                        <div style={{ fontSize: 20, fontWeight: 900, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{m.k === "earned" ? Math.round(v).toLocaleString() : v || "—"}</div>
                        {rank ? <div style={{ fontSize: 9, color: accent, fontWeight: 800, marginTop: 2 }}>#{rank} ON THE BOARD</div> : null}
                      </div>
                    );
                  })}
                </div>
                {!data?.me?.stats?.runs && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 10 }}>Your first finished run starts your record.</div>}
              </>
            )}
            {(data?.recent?.length || 0) > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.3em", opacity: 0.6, fontWeight: 800, marginBottom: 6 }}>LATEST</div>
                {data!.recent.slice(0, 5).map((r, i) => (
                  <div key={i} style={{ fontSize: 11.5, opacity: 0.85, padding: "3px 0", display: "flex", gap: 8 }}>
                    <span style={{ opacity: 0.5, minWidth: 28 }}>{ago(r.ts)}</span>
                    <span><b>{r.playerName}</b> {r.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grand Prix: fastest race on every track */}
      {!compact && game === "gp" && (props.tracks || []).length > 0 && (
        <div style={{ ...panel, marginTop: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.3em", color: accent, fontWeight: 800, marginBottom: 10 }}>⏱ TRACK RECORDS · FASTEST RACE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
            {(props.tracks || []).map((t) => {
              const rows = data?.trackBoards?.find((x) => x.trackId === t.id)?.rows || [];
              const mine = signedIn ? Number(data?.me?.stats?.[`t:${t.id}`] || 0) : 0;
              return (
                <div key={t.id} style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "9px 10px" }}>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name.toUpperCase()}</div>
                  {rows.length === 0 && <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 5 }}>No time set</div>}
                  {rows.map((r) => (
                    <div key={r.playerId} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3, color: r.rank === 1 ? "#ffd700" : "rgba(255,255,255,0.8)" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{r.rank}. {r.playerName}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{fmtMs(r.value)}</span>
                    </div>
                  ))}
                  {mine > 0 && <div style={{ fontSize: 10, color: accent, marginTop: 4, fontWeight: 800 }}>YOU {fmtMs(mine)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** client helper: put a finished run on the boards (the server checks the run and caps the numbers) */
export async function recordBoardRun(o: { game: BoardGameId; playerId: string; playerName: string; runId?: string | null; session?: string | null; stats: Record<string, any> }) {
  try {
    const r = await fetch("/api/boards/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
    const j = await r.json().catch(() => null);
    window.dispatchEvent(new Event("ra:leaderboards-refresh"));
    return j;
  } catch {
    return null;
  }
}
