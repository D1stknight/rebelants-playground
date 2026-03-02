// components/LeaderboardPanel.tsx
import React from "react";

type ZRow = { playerId: string; score: number };
type WinRow = {
  id?: string;
  ts?: number;
  game?: string;
  playerId?: string;
  playerName?: string;
  rarity?: string;
  pointsAwarded?: number;
  prize?: any;
};

type Summary = {
  ok: boolean;
  balance: ZRow[];
  earned: ZRow[];
  wins: ZRow[];
  recentWins: WinRow[];
};

function fmtName(pid: string) {
  if (!pid) return "unknown";
  // Keep it readable for wallet ids
  if (pid.startsWith("wallet:")) {
    const w = pid.replace("wallet:", "");
    return `wallet:${w.slice(0, 6)}…${w.slice(-4)}`;
  }
  return pid;
}

export default function LeaderboardPanel() {
  const [lb, setLb] = React.useState<Summary>({
    ok: true,
    balance: [],
    earned: [],
    wins: [],
    recentWins: [],
  });

  const [loading, setLoading] = React.useState(false);

  async function loadLeaderboards() {
    setLoading(true);
    try {
      const r = await fetch("/api/leaderboard/summary?top=15", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as Summary | null;
      if (r.ok && j?.ok) setLb(j);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  React.useEffect(() => {
    loadLeaderboards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Live refresh when Shuffle records a win
  React.useEffect(() => {
    const onRefresh = () => {
      // small delay so Redis writes finish before we read
      setTimeout(() => {
        loadLeaderboards();
      }, 250);
    };

    window.addEventListener("ra:leaderboards-refresh", onRefresh);
    return () => window.removeEventListener("ra:leaderboards-refresh", onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lb-wrap">
      <div className="lb-title">
        Leaderboards{" "}
        <span className="lb-sub" style={{ opacity: 0.75, fontSize: 12 }}>
          {loading ? "updating…" : ""}
        </span>
      </div>

      <div className="lb-grid">
        {/* Balance */}
        <div className="lb-card">
          <div className="lb-card-title">Top Balance</div>
          <div className="lb-rows">
            {(lb.balance || []).slice(0, 10).map((r, i) => (
              <div key={`${r.playerId}-${i}`} className="lb-row">
                <div className="lb-rank">#{i + 1}</div>
                <div className="lb-name">{fmtName(r.playerId)}</div>
                <div className="lb-score">{Math.floor(r.score || 0)}</div>
              </div>
            ))}
            {!lb.balance?.length && <div className="lb-empty">No balance entries yet.</div>}
          </div>
        </div>

        {/* Earned */}
        <div className="lb-card">
          <div className="lb-card-title">Top Earners</div>
          <div className="lb-rows">
            {(lb.earned || []).slice(0, 10).map((r, i) => (
              <div key={`${r.playerId}-${i}`} className="lb-row">
                <div className="lb-rank">#{i + 1}</div>
                <div className="lb-name">{fmtName(r.playerId)}</div>
                <div className="lb-score">{Math.floor(r.score || 0)}</div>
              </div>
            ))}
            {!lb.earned?.length && <div className="lb-empty">No earned entries yet.</div>}
          </div>
        </div>

        {/* Wins */}
        <div className="lb-card">
          <div className="lb-card-title">Top Wins</div>
          <div className="lb-rows">
            {(lb.wins || []).slice(0, 10).map((r, i) => (
              <div key={`${r.playerId}-${i}`} className="lb-row">
                <div className="lb-rank">#{i + 1}</div>
                <div className="lb-name">{fmtName(r.playerId)}</div>
                <div className="lb-score">{Math.floor(r.score || 0)}</div>
              </div>
            ))}
            {!lb.wins?.length && <div className="lb-empty">No wins entries yet.</div>}
          </div>
        </div>

        {/* Recent Wins */}
        <div className="lb-card">
          <div className="lb-card-title">Recent Wins</div>
          <div className="lb-rows">
            {(lb.recentWins || []).slice(0, 12).map((w, i) => {
              const name = w?.playerName || fmtName(String(w?.playerId || ""));
              const pts = Math.floor(Number(w?.pointsAwarded || 0));
              const rarity = String(w?.rarity || "none");
              const game = String(w?.game || "shuffle");
              return (
                <div key={`${w?.id || i}`} className="lb-win">
                  <span className={`pill pill-${rarity}`}>{rarity}</span>
                  <div className="lb-win-text">
                    <div className="lb-win-name">{name}</div>
                    <div className="lb-win-sub">
                      +{pts} ({game})
                    </div>
                  </div>
                </div>
              );
            })}
            {!lb.recentWins?.length && <div className="lb-empty">No recent wins yet.</div>}
          </div>
        </div>
      </div>

      <style jsx>{`
        .lb-wrap {
          margin-top: 18px;
        }
        .lb-title {
          font-weight: 900;
          font-size: 18px;
          margin-bottom: 10px;
        }
        .lb-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .lb-card {
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 16px;
          background: rgba(0, 0, 0, 0.25);
          padding: 14px;
        }
        .lb-card-title {
          font-weight: 900;
          margin-bottom: 10px;
        }
        .lb-rows {
          display: grid;
          gap: 8px;
        }
        .lb-row {
          display: grid;
          grid-template-columns: 42px 1fr 90px;
          gap: 10px;
          align-items: center;
          padding: 8px 10px;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.35);
        }
        .lb-rank {
          font-weight: 900;
          opacity: 0.9;
        }
        .lb-name {
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lb-score {
          text-align: right;
          font-weight: 900;
        }
        .lb-win {
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 10px;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.35);
        }
        .lb-win-text {
          display: grid;
          gap: 2px;
        }
        .lb-win-name {
          font-weight: 900;
        }
        .lb-win-sub {
          font-size: 12px;
          opacity: 0.85;
        }
        .lb-empty {
          opacity: 0.75;
          font-size: 12px;
          padding: 8px 2px;
        }
        .pill {
          font-size: 11px;
          font-weight: 900;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(0, 0, 0, 0.3);
          text-transform: lowercase;
          min-width: 64px;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
