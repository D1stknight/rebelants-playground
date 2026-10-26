import { useCallback, useEffect, useRef, useState } from "react";
import type { SoloCampaign, SoloCommand, SoloConfig } from "./factionWarsSoloCampaign";
import type { FactionId } from "./factionWarsSoloRules";

export interface SoloView { id: string; playerId: string; revision: number; state: SoloCampaign;
  config: SoloConfig; held: boolean; abandoned: boolean; validUntil: number; selectedRebel: string; pointDisplayUnconfirmed?: boolean; raapActionCount?: number }
const enabled = process.env.NEXT_PUBLIC_RAAP_SOLO_ENABLED === "true";
const newId = () => "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
async function campaignId(playerId: string, commandId: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["rebel.playground.solo.v1", playerId, commandId])));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
export async function soloRequest(body: object) {
  const response = await fetch("/api/raap/solo-campaign", { method: "POST", headers: { "content-type": "application/json" },
    credentials: "same-origin", cache: "no-store", redirect: "error", body: JSON.stringify(body), signal: AbortSignal.timeout(55000) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(value.error === "SOLO_PLAYER_SIGN_IN_REQUIRED" ? "Sign in to Playground again before sharing a campaign." :
    value.error === "SOLO_UNCONFIGURED" ? "Rebel sharing is unavailable here. You can still play normally." :
    value.error === "SOLO_PRICE_CHANGED" ? "The point cost changed. Check the saved campaign before continuing." :
    value.error === "SOLO_NO_PLAYS_REMAINING" ? "No plays left today." :
    value.error === "SOLO_INSUFFICIENT_POINTS" ? "Not enough REBEL to start this campaign." :
    "The result could not be confirmed. Check the saved campaign before continuing."), { code: String(value.error || "") });
  return value;
}

export function isMissingSoloStatus(value: any, requestedId: string | undefined): boolean {
  return typeof requestedId === "string" && /^[a-z0-9]{12}$/.test(requestedId) &&
    value?.session === null && value?.lookup?.status === "NO_ACTIVE_CAMPAIGN" &&
    value.lookup.requestedId === requestedId;
}

/** Human actions only. A lost response disables writes until an explicit saved
 * status read. The saved locator survives reload; no stored wallet credential. */
export function useSoloCampaign(playerId: string) {
  const [session, setSession] = useState<SoloView | null>(null);
  const [connected, setConnected] = useState(false), [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false), identity = useRef(playerId), current = useRef<SoloView | null>(null);
  const locator = useRef<string | undefined>(), blocked = useRef(false);
  identity.current = playerId;
  const key = `raap:solo-campaign:${playerId}`;
  const accept = useCallback((value: any, actor: string) => {
    if (identity.current !== actor) return null;
    const s = value.session as SoloView | null;
    if (s && (s.playerId !== actor || !/^[a-z0-9]{12}$/.test(s.id))) throw Error("Saved campaign belongs to a different player.");
    if (!s && locator.current) {
      blocked.current = true; setUncertain(true); setConnected(value.connected === true);
      setMessage("The saved start request is not confirmed. Check its status before starting another campaign.");
      return null;
    }
    current.current = s; setSession(s); setConnected(value.connected === true);
    if (s) { locator.current = s.id; try { localStorage.setItem(`raap:solo-campaign:${actor}`, s.id); } catch { /* The active server record remains readable. */ } }
    blocked.current = !!s?.held; setUncertain(!!s?.held);
    setMessage(s?.held ? "This game step is held because its result is not confirmed. Checking status never sends it again." :
      s?.abandoned ? "This campaign was ended. Its point charges are unchanged." :
      s?.pointDisplayUnconfirmed ? "Your game and point result are saved. The leaderboard display update is not confirmed." :
      s ? "Saved campaign loaded." : value.connected ? "Your Rebel is connected for this campaign." : "Connect your Rebel in RAAP to share a solo campaign.");
    return s;
  }, []);
  const status = useCallback(async () => {
    if (inFlight.current) return;
    const actor = playerId; inFlight.current = true; setBusy(true);
    try {
      const id = locator.current;
      const value = await soloRequest({ operation: "STATUS", playerId: actor, ...(id ? { id } : {}) });
      if (identity.current !== actor) return;
      const missing = locator.current === id && isMissingSoloStatus(value, id);
      // Keep the old browser shortcut intact. Only stop treating it as an active
      // game after the server confirms that neither it nor an active game exists.
      if (missing) locator.current = undefined;
      const result = accept(value, actor);
      if (missing) setMessage("No campaign is active. The older game record is no longer available here. Your saved Rebel history is unchanged.");
      return result;
    } catch (error) {
      if (identity.current !== actor) return;
      setMessage((error as Error).message);
      // A status READ the server refused outright (signed out / sharing off) is not a lost write:
      // it only turns sharing off — normal play stays available. Anything else keeps the safety hold.
      const code = (error as { code?: string }).code;
      if (code === "SOLO_PLAYER_SIGN_IN_REQUIRED" || code === "SOLO_UNCONFIGURED") { setSharing(false); return; }
      setUncertain(true); blocked.current = true;
    }
    finally { inFlight.current = false; if (identity.current === actor) setBusy(false); }
  }, [playerId, accept]);
  useEffect(() => {
    current.current = null; setSession(null); setConnected(false); setSharing(false); blocked.current = false; setUncertain(false);
    try { locator.current = localStorage.getItem(key) || undefined; } catch { locator.current = undefined; }
    if (!enabled) return;
    const actor = playerId;
    void status().then(s => { if (identity.current === actor && s && !s.abandoned) setSharing(true); });
  }, [playerId, key, status]);
  const write = async (body: object) => {
    if (inFlight.current || blocked.current) throw Error("Check the saved campaign before continuing.");
    const actor = playerId; inFlight.current = true; setBusy(true);
    try {
      const result = accept(await soloRequest({ ...body, playerId: actor }), actor);
      if (!result || result.held) throw Error("This game step is held. Check the saved campaign; do not repeat it.");
      return result;
    } catch (error) {
      if (identity.current === actor) { blocked.current = true; setUncertain(true); setMessage((error as Error).message); }
      throw error;
    } finally { inFlight.current = false; if (identity.current === actor) setBusy(false); }
  };
  return { enabled, session, connected, sharing, setSharing, message, busy, uncertain, status,
    requiresSavedCheck: uncertain && !!locator.current,
    async start(team: FactionId[], maximumDebit: number) {
      if (current.current && !current.current.abandoned && current.current.state.phase !== "final_result") throw Error("Finish or end the saved campaign first.");
      if (inFlight.current || blocked.current) throw Error("Check the saved campaign before continuing.");
      inFlight.current = true;
      const actor = playerId;
      let commandId: string;
      try {
        commandId = newId(); const id = await campaignId(playerId, commandId);
        if (identity.current !== actor) throw Error("The player changed. Check the saved campaign before continuing.");
        locator.current = id; try { localStorage.setItem(key, id); } catch { /* Server keeps the active record. */ }
      } finally { inFlight.current = false; }
      return write({ operation: "START", commandId, team, maximumDebit });
    },
    async act(command: SoloCommand, maximumDebit = 0) {
      const s = current.current; if (!s) throw Error("Load the saved campaign first.");
      return write({ operation: "ACT", id: s.id, revision: s.revision, commandId: newId(), command, maximumDebit });
    },
    async abandon() {
      const s = current.current;
      if (s && !s.abandoned && s.state.phase !== "final_result") await write({ operation: "ABANDON", id: s.id, revision: s.revision });
      current.current = null; setSession(null); locator.current = undefined; try { localStorage.removeItem(key); } catch {}
    },
    async reward() {
      const s = current.current; if (!s || s.state.phase !== "final_result") throw Error("Load the finished campaign first.");
      const v = await soloRequest({ operation: "REWARD", playerId, id: s.id });
      if (identity.current !== playerId) throw Error("The player changed. Load that player's saved campaign.");
      if (v.result?.status !== "ACKNOWLEDGED") throw Error("The saved reward is not confirmed. It has not been rolled again.");
      return v.result.value;
    },
    async claimPrize(wallet: string | null) {
      const s = current.current; if (!s) throw Error("Load the finished campaign first.");
      const v = await soloRequest({ operation: "CLAIM_PRIZE", playerId, id: s.id, wallet });
      if (identity.current !== playerId) throw Error("The player changed. Load that player's saved campaign.");
      if (v.result?.status !== "ACKNOWLEDGED") throw Error("The saved prize claim is not confirmed. It has not been sent again.");
      return { ...v.result.value, claimId: v.claimId };
    },
    async recordScore(playerName: string) {
      const s = current.current; if (!s || s.state.phase !== "final_result") return;
      const v = await soloRequest({ operation: "REPORT", playerId, id: s.id, playerName: playerName.slice(0, 64) });
      if (v.result?.status !== "ACKNOWLEDGED") setMessage("Your game is saved; the leaderboard update is not confirmed. It has not been sent again.");
    },
    async shareCompletion() {
      const s = current.current, actor = playerId;
      if (!s || s.held || s.state.phase !== "final_result" || inFlight.current) return;
      inFlight.current = true; setBusy(true);
      setMessage("Saving this completed campaign to your Rebel’s history…");
      try {
        const response = await fetch("/api/raap/match-experience", { method: "POST", headers: { "content-type": "application/json" },
          credentials: "same-origin", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(55000),
          body: JSON.stringify({ challengeId: s.id, playerId: actor, mode: "SOLO" }) });
        const value = await response.json();
        if (identity.current !== actor) return;
        setMessage(response.ok && value.history?.lifeRecorded === true
          ? "Your confirmed solo completion is saved in your Rebel's life."
          : response.ok && value.history?.status === "EXPERIENCE_RECORDED" && value.history?.lifeRecorded === false
          ? "Your shared campaign is saved in your Rebel's history with its approved actions. No additional XP or badge was awarded."
          : "Your campaign is saved. Sharing its completion with your Rebel is not confirmed yet.");
      } catch { if (identity.current === actor) setMessage("Your campaign is saved. Sharing its completion with your Rebel is not confirmed yet."); }
      finally { inFlight.current = false; if (identity.current === actor) setBusy(false); }
    },
  };
}
