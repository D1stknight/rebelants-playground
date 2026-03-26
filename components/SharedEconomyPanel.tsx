import React from "react";

type Props = {
  playerId: string;
  balance: number;
  totalPlaysLeft: number;
  dailyPlaysLeft: number;
  bonusPlayBank: number;
  currency?: string;
  dailyClaimAmount: number;
  onOpenBuyPoints: () => void;
  onRefresh: () => Promise<void> | void;
};

export default function SharedEconomyPanel({
  playerId,
  balance,
  totalPlaysLeft,
  dailyPlaysLeft,
  bonusPlayBank,
  currency = "REBEL",
  dailyClaimAmount,
  onOpenBuyPoints,
  onRefresh,
}: Props) {
  const [dailyClaimed, setDailyClaimed] = React.useState(false);
  const [claimStatus, setClaimStatus] = React.useState("");
  const [claimBusy, setClaimBusy] = React.useState(false);
  const [msUntilNextClaim, setMsUntilNextClaim] = React.useState(0);

  function formatClaimCountdown(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  async function refreshClaimStatus(pid: string) {
    try {
      const r = await fetch(
        `/api/points/claim?playerId=${encodeURIComponent(pid)}`,
        { cache: "no-store" }
      );
      const j = await r.json().catch(() => null);

      if (r.ok && j?.ok) {
        setDailyClaimed(!!j.claimed);
        setMsUntilNextClaim(Number(j.msUntilNextClaim || 0));
      }
    } catch {
      // ignore
    }
  }

  React.useEffect(() => {
    if (!playerId) return;
    refreshClaimStatus(playerId);
  }, [playerId]);

  React.useEffect(() => {
    if (!dailyClaimed || msUntilNextClaim <= 0) return;

    const interval = setInterval(() => {
      setMsUntilNextClaim((prev) => Math.max(0, prev - 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [dailyClaimed, msUntilNextClaim]);

  async function claimDailyNow() {
    if (!playerId) return;
    if (claimBusy) return;

    setClaimBusy(true);
    setClaimStatus("");

    try {
      const r = await fetch("/api/points/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          amount: dailyClaimAmount,
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        setClaimStatus(j?.error || "Claim failed.");
        return;
      }

      if (j?.alreadyClaimed) {
        setClaimStatus("Already claimed today ✅");
      } else {
        setClaimStatus(`Claimed +${j?.added || dailyClaimAmount} ${currency} ✅`);
      }

      setDailyClaimed(true);
      await onRefresh();
      await refreshClaimStatus(playerId);
    } catch (e: any) {
      setClaimStatus(e?.message || "Claim error");
    } finally {
      setClaimBusy(false);
    }
  }

  return (
    <div style={panelStyle}>
      <div style={statsWrapStyle}>
        <span>
          Balance: <b>{Number(balance || 0).toLocaleString()}</b> {currency}
        </span>
        <span style={{ fontWeight: 800, color: "#60a5fa" }}>
          Total plays left: <b>{Number(totalPlaysLeft || 0).toLocaleString()}</b>
        </span>
        <span>
          Daily plays left: <b>{Number(dailyPlaysLeft || 0).toLocaleString()}</b>
        </span>
        <span>
          Bonus play bank: <b>{Number(bonusPlayBank || 0).toLocaleString()}</b>
        </span>
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
        Daily plays reset every 24 hours. Bonus plays are included with point purchases and never expire.
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={claimDailyNow}
          disabled={claimBusy || dailyClaimed}
          style={{
            ...buttonStyle,
            opacity: claimBusy || dailyClaimed ? 0.65 : 1,
            cursor: claimBusy || dailyClaimed ? "not-allowed" : "pointer",
          }}
          title={dailyClaimed ? "Already claimed today" : "Claim daily points"}
        >
          {dailyClaimed
            ? "Claimed Today ✅"
            : `Claim Daily +${dailyClaimAmount} ${currency}`}
        </button>

        <button
          type="button"
          onClick={onOpenBuyPoints}
          style={buttonStyle}
        >
          Buy Points / Connect Ape Wallet
        </button>

        {claimStatus ? (
          <div style={{ fontSize: 12, opacity: 0.92 }}>
            {claimStatus}
          </div>
        ) : null}

        {dailyClaimed && msUntilNextClaim > 0 ? (
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color:
                msUntilNextClaim < 5 * 60 * 1000
                  ? "#ef4444"
                  : msUntilNextClaim < 60 * 60 * 1000
                  ? "#f97316"
                  : "#facc15",
            }}
          >
            Next claim in: {formatClaimCountdown(msUntilNextClaim)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.04)",
  padding: 14,
};

const statsWrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  fontSize: 13,
  opacity: 0.95,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(15,23,42,0.7)",
  color: "white",
  fontWeight: 800,
};
