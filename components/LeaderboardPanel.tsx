// components/LeaderboardPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getLeaderboard, getRecentWins, WinEvent } from "../lib/winsStore";

export default function LeaderboardPanel() {
  const [recent, setRecent] = useState<WinEvent[]>([]);
  const [leaders, setLeaders] = useState<Array<{ playerId: string; total: number }>>([]);

  useEffect(() => {
    setRecent(getRecentWins(8));
    setLeaders(getLeaderboard(8));

    const onStorage = () => {
      setRecent(getRecentWins(8));
      setLeaders(getLeaderboard(8));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of recent) m.set(e.playerId, e.playerName);
    return m;
  }, [recent]);

  return (
    <div className="lb-wrap">
      <div className="lb-title">Leaderboards</div>

      <div className="lb-grid">
        <div className="lb-card">
          <div className="lb-card-title">Top Earners</div>
          <ol className="lb-list">
            {leaders.length === 0 ? (
              <li className="lb-empty">No data yet</li>
            ) : (
              leaders.map((x, idx) => (
                <li key={x.playerId} className="lb-row">
                  <span className="lb-rank">#{idx + 1}</span>
                  <span className="lb-name">{nameMap.get(x.playerId) || x.playerId}</span>
                  <span className="lb-score">{x.total}</span>
                </li>
              ))
            )}
          </ol>
        </div>

        <div className="lb-card">
          <div className="lb-card-title">Recent Wins</div>
          <ul className="lb-feed">
            {recent.length === 0 ? (
              <li className="lb-empty">No wins yet</li>
            ) : (
              recent.map((e) => (
                <li key={e.id} className="lb-feed-row">
                  <span className={`pill p-${e.rarity}`}>{e.rarity}</span>
                  <span className="feed-text">
                    <b>{e.playerName}</b> +{e.pointsAwarded} ({e.game})
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <style jsx>{`
        .lb-wrap { margin-top: 14px; }
        .lb-title { font-size: 16px; font-weight: 800; margin-bottom: 10px; }
        .lb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 900px) { .lb-grid { grid-template-columns: 1fr; } }

        .lb-card {
          background: rgba(15,23,42,.55);
          border: 1px solid rgba(148,163,184,.18);
          border-radius: 12px;
          padding: 12px;
          backdrop-filter: blur(6px);
        }
        .lb-card-title { font-size: 13px; opacity: .9; margin-bottom: 10px; font-weight: 700; }

        .lb-list { margin: 0; padding-left: 18px; }
        .lb-row { display: grid; grid-template-columns: 50px 1fr 70px; gap: 10px; padding: 6px 0; }
        .lb-rank { opacity: .8; }
        .lb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lb-score { text-align: right; font-weight: 800; }

        .lb-feed { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .lb-feed-row { display: flex; align-items: center; gap: 10px; }
        .feed-text { opacity: .95; }

        .pill { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); }
        .p-common { background: rgba(147,197,253,.12); }
        .p-rare { background: rgba(59,130,246,.12); }
        .p-ultra { background: rgba(244,63,94,.12); }
        .p-none { background: rgba(148,163,184,.10); }

        .lb-empty { opacity: .6; padding: 6px 0; }
      `}</style>
    </div>
  );
}
