import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import { loadProfile, saveProfile, getEffectivePlayerId, type Profile } from "../../../lib/profile";
import type { PvpMatch, PvpRound } from "../../../lib/types/fwpvp";
import { ChatDrawer, useChatState } from "../../../components/PvpChatPanel";
import { FACTIONS, FACTION_IDS, TEAM_SIZE, TERRITORY_COUNT, MAX_HP, type FactionId, type Move, type RoundResult, type TerritoryResult, type Rarity } from "../../../lib/factionWarsCore";
import FactionWarsBattleScene, { type BattleSceneState, type BattleSceneActions } from "../../../components/FactionWarsBattleScene";
import { useFWAudio } from "../../../lib/useFWAudio";

const JP = `'Noto Serif JP', 'Hiragino Mincho ProN', serif`;

// ── Identity helper (same as lobby) ──────────────────────────────────────────
function deriveIdentity(p: Profile | null): { playerId: string; displayName: string } | null {
  if (!p) return null;
  if (p.primaryId) return { playerId: p.primaryId, displayName: p.discordName || p.name || "Anonymous" };
  if (p.name && p.name !== "guest" && p.name.trim().length > 0) {
    return { playerId: `commander:${p.name}`, displayName: p.name };
  }
  return null;
}

function factionImgPath(fid: string, type: "symbol" | "char"): string {
  const jpgFactions: Record<string, boolean> = { "bushi-symbol": true, "bushi-char": true };
  const jpgCharFactions: Record<string, boolean> = { "shogun-char": true };
  const key = `${fid}-${type}`;
  const ext = jpgFactions[key] ? "jpg" : jpgCharFactions[key] ? "JPG" : "PNG";
  return `/factions/${fid}-${type}.${ext}`;
}

// ── Faction picker grid (Step 2: just lets you build a 5-faction team) ──────
function TeamPicker({ team, setTeam, onSubmit, busy }: { team: FactionId[]; setTeam: (t: FactionId[]) => void; onSubmit: () => void; busy: boolean }) {
  const toggle = (fid: FactionId) => {
    if (team.includes(fid)) setTeam(team.filter((f) => f !== fid));
    else if (team.length < TEAM_SIZE) setTeam([...team, fid]);
  };
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 900, color: "#fbbf24", letterSpacing: "0.05em", marginBottom: 12 }}>
        ⚔️ Assemble Your Team ({team.length}/{TEAM_SIZE})
      </div>
      {/* Selected slots */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {Array.from({ length: TEAM_SIZE }, (_, i) => {
          const fid = team[i];
          const f = fid ? FACTIONS[fid] : null;
          return (
            <div
              key={i}
              onClick={() => f && setTeam(team.filter((_, j) => j !== i))}
              style={{
                width: 62, height: 78, borderRadius: 10,
                border: f ? `2px solid ${f.borderColor}` : "1px dashed rgba(255,255,255,0.2)",
                background: f ? f.bgColor : "rgba(255,255,255,0.02)",
                cursor: f ? "pointer" : "default", overflow: "hidden",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}
              title={f ? `Click to remove ${f.name}` : "Empty slot"}
            >
              {f ? (
                <>
                  <img src={factionImgPath(f.id, "char")} alt={f.name} style={{ width: "100%", height: 55, objectFit: "cover", objectPosition: "top" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div style={{ fontSize: 7, color: f.color, fontWeight: 900, padding: "2px 0", letterSpacing: "0.05em" }}>{f.name.toUpperCase()}</div>
                </>
              ) : (
                <div style={{ fontSize: 20, opacity: 0.4 }}>＋</div>
              )}
            </div>
          );
        })}
      </div>
      {/* All factions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8, marginBottom: 16 }}>
        {FACTION_IDS.map((fid) => {
          const f = FACTIONS[fid];
          const selected = team.includes(fid);
          return (
            <div
              key={fid}
              onClick={() => toggle(fid)}
              style={{
                padding: "8px 6px", borderRadius: 10,
                border: `1px solid ${selected ? f.borderColor : "rgba(255,255,255,0.1)"}`,
                background: selected ? f.bgColor : "rgba(255,255,255,0.02)",
                cursor: "pointer", textAlign: "center",
                opacity: !selected && team.length >= TEAM_SIZE ? 0.4 : 1,
                transition: "all 0.2s",
              }}
            >
              <img src={factionImgPath(fid, "char")} alt={f.name} style={{ width: "100%", height: 70, objectFit: "cover", objectPosition: "top", borderRadius: 6, marginBottom: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <div style={{ fontSize: 9, fontWeight: 900, color: f.color, letterSpacing: "0.05em" }}>{f.name.toUpperCase()}</div>
            </div>
          );
        })}
      </div>
      <button
        onClick={onSubmit}
        disabled={team.length !== TEAM_SIZE || busy}
        style={{
          width: "100%", height: 46, fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
          borderRadius: 24, border: "1px solid rgba(251,191,36,0.4)",
          background: team.length === TEAM_SIZE && !busy ? "linear-gradient(135deg,rgba(251,191,36,0.3),rgba(248,113,113,0.3))" : "rgba(255,255,255,0.05)",
          color: team.length === TEAM_SIZE && !busy ? "#fbbf24" : "rgba(255,255,255,0.4)",
          cursor: team.length === TEAM_SIZE && !busy ? "pointer" : "not-allowed",
        }}
      >
        {busy ? "Locking team…" : team.length === TEAM_SIZE ? "Lock in team" : `Pick ${TEAM_SIZE - team.length} more`}
      </button>
    </div>
  );
}

// ── Active match view + completed match view ──────────────────────────────
// ── Animation state type (mirrors private SamuraiAnimState in factionWarsCore) ─
type AnimState = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";

// Maps a Move's type to the animation state used by FactionWars3DCharacter.
// Mirrors getSamuraiAnimForMove() in lib/factionWarsCore.ts.
function moveToAnim(mv: Move | null | undefined): AnimState {
  if (!mv) return "idle";
  if (mv.type === "attack") return "attack";
  if (mv.type === "magic") return "magic";
  if (mv.type === "trick") return "trick";
  if (mv.type === "defend") return "defend";
  return "idle";
}

// Looks up a Move by id within a given faction. Returns null if not found.
function findMove(factionId: FactionId | null | undefined, moveId: string): Move | null {
  if (!factionId) return null;
  const f = FACTIONS[factionId];
  if (!f) return null;
  return f.moves.find(m => m.id === moveId) ?? null;
}

function ActiveMatchView({
  match, mePlayerId, challengeId, onSubmitMove, onHeal, busy, healBusy, healCost, healAmt, healMax, balance, sfx,
}: {
  match: PvpMatch;
  mePlayerId: string;
  challengeId: string;
  onSubmitMove: (moveId: string) => Promise<void>;
  onHeal: () => Promise<void>;
  busy: boolean;
  healBusy: boolean;
  healCost: number;
  healAmt: number;
  healMax: number;
  balance: number | null;
  sfx: ReturnType<typeof useFWAudio>["sfx"];
}) {
  // ── Perspective math ───────────────────────────────────────────────────────
  const isChallenger = match.challengerPlayerId === mePlayerId;
  const mySide: "challenger" | "opponent" = isChallenger ? "challenger" : "opponent";
  const myTeam = isChallenger ? match.challengerTeam : match.opponentTeam;
  const oppTeam = isChallenger ? match.opponentTeam : match.challengerTeam;
  const myIdx = isChallenger ? match.challengerCurrentFactionIndex : match.opponentCurrentFactionIndex;
  const oppIdx = isChallenger ? match.opponentCurrentFactionIndex : match.challengerCurrentFactionIndex;
  const myHp = isChallenger ? match.challengerHp : match.opponentHp;
  const oppHp = isChallenger ? match.opponentHp : match.challengerHp;
  const isMyTurn = match.currentTurnPlayerId === mePlayerId;

  const myFighter = myTeam[myIdx];
  const oppFighter = oppTeam[oppIdx];
  const myF = myFighter ? FACTIONS[myFighter] : null;
  const oppF = oppFighter ? FACTIONS[oppFighter] : null;

  // ── Round and territory mapping ────────────────────────────────────────────
  const roundsThisTerritory = match.roundHistory.filter(r => r.territory === match.currentTerritory);
  const currentRoundNumber = roundsThisTerritory.length === 0 ? 1 : roundsThisTerritory[roundsThisTerritory.length - 1].roundInTerritory + 1;
  const myTerritoriesWon = isChallenger ? match.challengerTerritoriesWon : match.opponentTerritoriesWon;

  // Map PvP rounds → AI-mode roundLog shape
  const roundLog = roundsThisTerritory.slice().reverse().slice(0, 6).map(r => {
    const wasMine = r.attackerSide === mySide;
    return {
      playerMove: wasMine ? r.moveId : "—",
      enemyMove: wasMine ? "—" : r.moveId,
      playerDmg: wasMine ? r.damageDealt : 0,
      enemyDmg: wasMine ? 0 : r.damageDealt,
      effect: undefined,
    };
  });

  // Map PvP territoryResults → AI-mode TerritoryResult[] for territory icons.
  // The BattleScene renders results[i].won as a checkmark/x on each territory icon.
  const mappedResults: TerritoryResult[] = match.territoryResults.map(tr => {
    const myFactionForT = isChallenger ? tr.challengerFaction : tr.opponentFaction;
    const oppFactionForT = isChallenger ? tr.opponentFaction : tr.challengerFaction;
    const won = tr.winnerSide === mySide;
    const myHpFinal = isChallenger ? tr.challengerHpFinal : tr.opponentHpFinal;
    const oppHpFinal = isChallenger ? tr.opponentHpFinal : tr.challengerHpFinal;
    return {
      territory: tr.territory,
      defender: oppFactionForT,
      playerFaction: myFactionForT,
      rounds: [],
      playerHpFinal: myHpFinal,
      enemyHpFinal: oppHpFinal,
      won,
    };
  });

  // ── 3D animation state (per-side, transient) ───────────────────────────────
  const [enemy3DAnim, setEnemy3DAnim] = useState<AnimState>("idle");
  const [player3DAnim, setPlayer3DAnim] = useState<AnimState>("idle");

  // ── 2D card animation state (clash flash + floating dmg numbers) ──────────
  // Mirrors AI mode's BattleScene-driven card shake / overlay flashes.
  const [battleAnim, setBattleAnim] = useState<"idle" | "clash" | "win" | "lose">("idle");
  const [dmgFloats, setDmgFloats] = useState<{ id: number; side: "player" | "enemy" | "plunder"; dmg: number }[]>([]);
  const dmgIdRef = useRef(0);

  // Track previous values to detect changes
  const prevRoundCountRef = useRef(match.roundHistory.length);
  const prevTerritoryCountRef = useRef(match.territoryResults.length);

  // ── Watch for new rounds → fire SFX + 3D anims ────────────────────────────
  useEffect(() => {
    const prevCount = prevRoundCountRef.current;
    const currCount = match.roundHistory.length;
    if (currCount <= prevCount) {
      prevRoundCountRef.current = currCount;
      return;
    }
    // One or more new rounds since last render. Process the most recent one.
    const newest = match.roundHistory[currCount - 1];
    if (newest) {
      const wasMine = newest.attackerSide === mySide;
      const moveObj = findMove(newest.attackerFaction, newest.moveId);
      const animForAction = moveToAnim(moveObj);

      // Animation: the actor performs their move animation; the defender plays "hit"
      if (wasMine) {
        setPlayer3DAnim(animForAction);
        setEnemy3DAnim("hit");
      } else {
        setEnemy3DAnim(animForAction);
        setPlayer3DAnim("hit");
      }

      // SFX cascade: clash → move-type → hit-light/heavy
      try {
        sfx.clash();
        if (moveObj?.type === "attack") sfx.attackHit();
        else if (moveObj?.type === "defend") sfx.defendBlock();
        else if (moveObj?.type === "magic") sfx.magicCast();
        else if (moveObj?.type === "trick") sfx.trickDodge();
        if (newest.damageDealt > 18) sfx.hitHeavy();
        else if (newest.damageDealt > 0 && newest.damageDealt < 10) sfx.hitLight();
      } catch {}

      // 2D card animation: clash flash + floating damage on the defender's side
      setBattleAnim("clash");
      if (newest.damageDealt > 0) {
        const fid = ++dmgIdRef.current;
        // wasMine === attacker is me → opponent takes the damage (enemy float)
        const floatSide: "player" | "enemy" = wasMine ? "enemy" : "player";
        setDmgFloats((prev) => [...prev, { id: fid, side: floatSide, dmg: newest.damageDealt }]);
        setTimeout(() => {
          setDmgFloats((prev) => prev.filter((x) => x.id !== fid));
        }, 1500);
      }

      // After 1.2s, transition to win/lose if this was a killing blow,
      // or idle otherwise. Killing blow = defenderHpAfter <= 0. The win/lose
      // anims play for the remaining ~2.3s of the per-territory hold (handled
      // upstream in handleSubmitMove via a 3.5s setTimeout before applying
      // the rotated match state).
      const wasKillingBlow = newest.defenderHpAfter <= 0;
      const timer = setTimeout(() => {
        if (wasKillingBlow) {
          // Attacker wins this territory; defender loses.
          if (wasMine) {
            setPlayer3DAnim("win");
            setEnemy3DAnim("lose");
            setBattleAnim("win");
          } else {
            setPlayer3DAnim("lose");
            setEnemy3DAnim("win");
            setBattleAnim("lose");
          }
        } else {
          setPlayer3DAnim("idle");
          setEnemy3DAnim("idle");
          setBattleAnim("idle");
        }
      }, 1200);
      prevRoundCountRef.current = currCount;
      return () => clearTimeout(timer);
    }
    prevRoundCountRef.current = currCount;
  }, [match.roundHistory.length, mySide, sfx]);

  // ── Reset 3D anims when fighters rotate ────────────────────────────────
  // After the per-territory animation hold ends, handleSubmitMove applies the
  // rotated match state (currentFactionIndex advances, HPs reset). The win/lose
  // anims set at 1.2s via the round-watcher are now stale — the new fighters
  // should start in idle. Watching myIdx/oppIdx catches both same-territory
  // advances (no-op since AI mode doesn't rotate within a territory) and
  // cross-territory rotations.
  const prevMyIdxRef = useRef(myIdx);
  const prevOppIdxRef = useRef(oppIdx);
  useEffect(() => {
    if (prevMyIdxRef.current !== myIdx || prevOppIdxRef.current !== oppIdx) {
      setPlayer3DAnim("idle");
      setEnemy3DAnim("idle");
      setBattleAnim("idle");
      setDmgFloats([]);
      prevMyIdxRef.current = myIdx;
      prevOppIdxRef.current = oppIdx;
    }
  }, [myIdx, oppIdx]);

  // ── Watch for new territory results → fire territory SFX ──────────────────
  useEffect(() => {
    const prevCount = prevTerritoryCountRef.current;
    const currCount = match.territoryResults.length;
    if (currCount <= prevCount) {
      prevTerritoryCountRef.current = currCount;
      return;
    }
    const newest = match.territoryResults[currCount - 1];
    if (newest) {
      try {
        if (newest.winnerSide === mySide) sfx.territoryWin();
        else sfx.territoryLose();
      } catch {}
    }
    prevTerritoryCountRef.current = currCount;
  }, [match.territoryResults.length, mySide, sfx]);

  // ── Build BattleSceneState ─────────────────────────────────────────────────
  const battleSceneState: BattleSceneState = {
    phase: "battle",
    team: myTeam,
    defenders: oppTeam,
    currentTerritory: match.currentTerritory,
    currentFactionIdx: myIdx,
    currentPlayerFD: myF,
    currentDefenderFD: oppF,
    playerHp: myHp,
    enemyHp: oppHp,
    currentRound: currentRoundNumber,
    roundLog,
    currentTerritoryRounds: [],
    dmgFloats,
    battleAnim,
    enemy3DAnim,
    player3DAnim,
    selectedMove: null,
    usedMoves: {},
    sacrificeBonus: 0,
    powerBuffRounds: 0,
    powerBuffAmt: 0,
    comboBonus: 0,
    commandActive: false,
    berserkerActive: false,
    meditationStacks: 0,
    oneTimeUsed: [],
    results: mappedResults,
    finalRarity: "none",
    territoriesWon: myTerritoriesWon,
    showHowToPlay: false,
    busy: false,
    healBusy: false,
    healUsed: 0,
    cfg: null,
    currency: "REBEL",
    balance: 0,
  };

  const inertActions: BattleSceneActions = {
    setSelectedMove: (() => {}) as any,
    setShowHowToPlay: (() => {}) as any,
    fightTerritory: () => {},
    nextTerritory: () => {},
    resetGame: () => {},
    setHealBusy: (() => {}) as any,
    setHealUsed: (() => {}) as any,
    setPlayerHp: (() => {}) as any,
    spend: async () => null,
    refresh: async () => undefined,
  };

  return (
    <div>
      {/* Turn indicator */}
      <div style={{
        textAlign: "center", padding: "12px 16px", borderRadius: 12, marginBottom: 18,
        background: isMyTurn ? "linear-gradient(135deg,rgba(251,191,36,0.2),rgba(248,113,113,0.2))" : "rgba(255,255,255,0.03)",
        border: `1px solid ${isMyTurn ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.08)"}`,
      }}>
        <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: isMyTurn ? "#fbbf24" : "rgba(255,255,255,0.6)" }}>
          {isMyTurn ? "⚔️ YOUR TURN" : "⏳ Opponent is thinking…"}
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
          Territory {match.currentTerritory + 1} of 5 · Round {currentRoundNumber}
        </div>
      </div>

      <FactionWarsBattleScene
        state={battleSceneState}
        actions={inertActions}
        enableHealing={false}
        showMovePicker={false}
        enableHowToPlay={false}
        leaderboardSlot={null}
      />

      {/* PvP move picker */}
      {(() => {
        if (!myF) return null;
        const myMoves = myF.moves;
        const moveTypeColor: Record<string, string> = {
          attack: "#f87171",
          magic: "#c084fc",
          trick: "#fbbf24",
          defend: "#34d399",
        };
        // ── Heal button state computation ─────────────────────────────────
        // Mirrors AI mode logic: heal eligible if my turn, hp < MAX, healsUsed
        // < max, balance >= cost. healsUsed is read from match per side.
        const myHealsUsed = isChallenger
          ? Number(match.challengerHealsUsed ?? 0)
          : Number(match.opponentHealsUsed ?? 0);
        const atMaxHp = myHp >= MAX_HP;
        const atMaxHeals = myHealsUsed >= healMax;
        const cantAffordHeal = balance !== null && balance < healCost;
        const healDisabled = !isMyTurn || busy || healBusy || atMaxHp || atMaxHeals || cantAffordHeal;

        return (
          <div style={{ marginTop: 18 }}>
            {/* Heal button row (Commit E) — sits above the move grid, mirrors AI mode */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>
                {isMyTurn ? "Choose your move" : "Opponent is thinking…"}
              </div>
              <button
                onClick={() => { if (!healDisabled) { try { sfx.cardSelect(); } catch {} onHeal(); } }}
                disabled={healDisabled}
                title={
                  atMaxHp ? "Already at full HP" :
                  atMaxHeals ? `Heal limit reached (${myHealsUsed}/${healMax})` :
                  cantAffordHeal ? `Need ${healCost} REBEL (you have ${balance ?? "?"})` :
                  !isMyTurn ? "Wait for your turn" :
                  `Spend ${healCost} REBEL to restore ${healAmt} HP`
                }
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 20,
                  border: `1px solid ${healDisabled ? "rgba(255,255,255,0.12)" : "rgba(52,211,153,0.4)"}`,
                  background: healDisabled ? "rgba(255,255,255,0.04)" : "rgba(52,211,153,0.12)",
                  color: healDisabled ? "rgba(255,255,255,0.4)" : "#34d399",
                  fontSize: 11, fontWeight: 800,
                  cursor: healDisabled ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {healBusy ? "Healing…" : `💚 Heal · ${healCost} REBEL · ${myHealsUsed}/${healMax}`}
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 8, marginBottom: 12 }}>
              {myMoves.map((mv) => {
                const tColor = moveTypeColor[mv.type] || "rgba(255,255,255,0.6)";
                const disabled = !isMyTurn || busy;
                return (
                  <button
                    key={mv.id}
                    onClick={() => { try { sfx.cardSelect(); } catch {} onSubmitMove(mv.id); }}
                    disabled={disabled}
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: `1px solid ${tColor}55`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.4 : 1,
                      color: "white",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.4)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 16 }}>{mv.emoji}</span>
                      <span style={{ fontWeight: 900, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mv.label}</span>
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 8, background: `${tColor}22`, color: tColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {mv.type}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}>
                        ⚡{mv.power}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.55, lineHeight: 1.3 }}>{mv.desc}</div>
                  </button>
                );
              })}
            </div>
            {!isMyTurn && (
              <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center", marginTop: 8 }}>
                You'll be notified when it's your turn. This page polls automatically.
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Pending Completion View ──────────────────────────────────────────────────
// Rendered for ~3.5s after match.status flips to "completed", BEFORE the
// CompletedMatchView crate reveal. Shows the final battle state with a
// "Battle complete!" banner so the win/lose moment can sink in instead of
// jumping straight to results.
function PendingCompletionView({ match, mePlayerId }: { match: PvpMatch; mePlayerId: string }) {
  const isChallenger = match.challengerPlayerId === mePlayerId;
  const mySide: "challenger" | "opponent" = isChallenger ? "challenger" : "opponent";
  const myTeam = isChallenger ? match.challengerTeam : match.opponentTeam;
  const oppTeam = isChallenger ? match.opponentTeam : match.challengerTeam;
  const myWon = isChallenger ? match.challengerTerritoriesWon : match.opponentTerritoriesWon;
  const iWon = match.winnerPlayerId === mePlayerId;

  // Map territory results to AI-mode shape so BattleScene shows ✓/✗ badges.
  const mappedResults: TerritoryResult[] = match.territoryResults.map(tr => {
    const myFactionForT = isChallenger ? tr.challengerFaction : tr.opponentFaction;
    const oppFactionForT = isChallenger ? tr.opponentFaction : tr.challengerFaction;
    const won = tr.winnerSide === mySide;
    const myHpFinal = isChallenger ? tr.challengerHpFinal : tr.opponentHpFinal;
    const oppHpFinal = isChallenger ? tr.opponentHpFinal : tr.challengerHpFinal;
    return {
      territory: tr.territory,
      defender: oppFactionForT,
      playerFaction: myFactionForT,
      rounds: [],
      playerHpFinal: myHpFinal,
      enemyHpFinal: oppHpFinal,
      won,
    };
  });

  // Render BattleScene with phase: "battle" so HP bars, fighter cards, and
  // territory progress strip are all visible. Final HPs come from the last
  // territory result. Move picker is suppressed.
  const lastTerritory = match.territoryResults[match.territoryResults.length - 1];
  const finalMyHp = lastTerritory
    ? (isChallenger ? lastTerritory.challengerHpFinal : lastTerritory.opponentHpFinal)
    : (isChallenger ? match.challengerHp : match.opponentHp);
  const finalOppHp = lastTerritory
    ? (isChallenger ? lastTerritory.opponentHpFinal : lastTerritory.challengerHpFinal)
    : (isChallenger ? match.opponentHp : match.challengerHp);

  const myIdx = isChallenger ? match.challengerCurrentFactionIndex : match.opponentCurrentFactionIndex;
  const oppIdx = isChallenger ? match.opponentCurrentFactionIndex : match.challengerCurrentFactionIndex;
  const myFighter = myTeam[Math.min(myIdx, myTeam.length - 1)];
  const oppFighter = oppTeam[Math.min(oppIdx, oppTeam.length - 1)];
  const myF = myFighter ? FACTIONS[myFighter] : null;
  const oppF = oppFighter ? FACTIONS[oppFighter] : null;

  const battleSceneState: BattleSceneState = {
    phase: "battle",
    team: myTeam,
    defenders: oppTeam,
    currentTerritory: Math.max(0, match.currentTerritory - 1),
    currentFactionIdx: myIdx,
    currentPlayerFD: myF,
    currentDefenderFD: oppF,
    playerHp: finalMyHp,
    enemyHp: finalOppHp,
    currentRound: 0,
    roundLog: [],
    currentTerritoryRounds: [],
    dmgFloats: [],
    battleAnim: iWon ? "win" : "lose",
    enemy3DAnim: iWon ? "lose" : "win",
    player3DAnim: iWon ? "win" : "lose",
    selectedMove: null,
    usedMoves: {},
    sacrificeBonus: 0,
    powerBuffRounds: 0,
    powerBuffAmt: 0,
    comboBonus: 0,
    commandActive: false,
    berserkerActive: false,
    meditationStacks: 0,
    oneTimeUsed: [],
    results: mappedResults,
    finalRarity: "none",
    territoriesWon: myWon,
    showHowToPlay: false,
    busy: false,
    healBusy: false,
    healUsed: 0,
    cfg: null,
    currency: "REBEL",
    balance: 0,
  };

  const inertActions: BattleSceneActions = {
    setSelectedMove: (() => {}) as any,
    setShowHowToPlay: (() => {}) as any,
    fightTerritory: () => {},
    nextTerritory: () => {},
    resetGame: () => {},
    setHealBusy: (() => {}) as any,
    setHealUsed: (() => {}) as any,
    setPlayerHp: (() => {}) as any,
    spend: async () => null,
    refresh: async () => undefined,
  };

  return (
    <div>
      {/* "Battle complete!" banner */}
      <div style={{
        textAlign: "center", padding: "14px 18px", borderRadius: 12, marginBottom: 18,
        background: iWon
          ? "linear-gradient(135deg,rgba(251,191,36,0.25),rgba(248,113,113,0.15))"
          : "rgba(255,255,255,0.04)",
        border: `1px solid ${iWon ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.12)"}`,
      }}>
        <div style={{
          fontSize: 14, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase",
          color: iWon ? "#fbbf24" : "rgba(255,255,255,0.7)",
        }}>
          {iWon ? "🏆 Victory! Calculating rewards…" : "💀 Defeat — Tallying the damage…"}
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
          Final: {match.challengerTerritoriesWon}–{match.opponentTerritoriesWon} territories
        </div>
      </div>
      <FactionWarsBattleScene
        state={battleSceneState}
        actions={inertActions}
        enableHealing={false}
        showMovePicker={false}
        enableHowToPlay={false}
        leaderboardSlot={null}
      />

    </div>
  );
}

function CompletedMatchView({ match, mePlayerId, sfx, stopMusic }: { match: PvpMatch; mePlayerId: string; sfx: ReturnType<typeof useFWAudio>["sfx"]; stopMusic: () => void }) {
  const router = useRouter();
  const isChallenger = match.challengerPlayerId === mePlayerId;
  const mySide: "challenger" | "opponent" = isChallenger ? "challenger" : "opponent";
  const myTeam = isChallenger ? match.challengerTeam : match.opponentTeam;
  const oppTeam = isChallenger ? match.opponentTeam : match.challengerTeam;
  const myWon = isChallenger ? match.challengerTerritoriesWon : match.opponentTerritoriesWon;
  const iWon = match.winnerPlayerId === mePlayerId;

  // finalRarity: when I'm the winner, use match.winnerCrateRarity. When I lost, "none".
  const finalRarity: Rarity = iWon && match.winnerCrateRarity ? match.winnerCrateRarity : "none";

  // Map territoryResults → AI-mode TerritoryResult[] from my perspective.
  const mappedResults: TerritoryResult[] = match.territoryResults.map(tr => {
    const myFactionForT = isChallenger ? tr.challengerFaction : tr.opponentFaction;
    const oppFactionForT = isChallenger ? tr.opponentFaction : tr.challengerFaction;
    const won = tr.winnerSide === mySide;
    const myHpFinal = isChallenger ? tr.challengerHpFinal : tr.opponentHpFinal;
    const oppHpFinal = isChallenger ? tr.opponentHpFinal : tr.challengerHpFinal;
    return {
      territory: tr.territory,
      defender: oppFactionForT,
      playerFaction: myFactionForT,
      rounds: [],
      playerHpFinal: myHpFinal,
      enemyHpFinal: oppHpFinal,
      won,
    };
  });

  // Fire end-of-match SFX exactly once
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    try {
      stopMusic();
      if (finalRarity === "ultra") sfx.ultra();
      else if (finalRarity !== "none") sfx.win();
      else sfx.lose();
      // Crate sounds for winners
      if (iWon && finalRarity !== "none") {
        sfx.crateOpen();
        setTimeout(() => { try { sfx.crateReward(); } catch {} }, 1000);
      }
    } catch {}
  }, [finalRarity, iWon, sfx, stopMusic]);

  const battleSceneState: BattleSceneState = {
    phase: "final_result",
    team: myTeam,
    defenders: oppTeam,
    currentTerritory: 0,
    currentFactionIdx: 0,
    currentPlayerFD: null,
    currentDefenderFD: null,
    playerHp: 0,
    enemyHp: 0,
    currentRound: 0,
    roundLog: [],
    currentTerritoryRounds: [],
    dmgFloats: [],
    battleAnim: "idle",
    enemy3DAnim: "idle",
    player3DAnim: "idle",
    selectedMove: null,
    usedMoves: {},
    sacrificeBonus: 0,
    powerBuffRounds: 0,
    powerBuffAmt: 0,
    comboBonus: 0,
    commandActive: false,
    berserkerActive: false,
    meditationStacks: 0,
    oneTimeUsed: [],
    results: mappedResults,
    finalRarity,
    territoriesWon: myWon,
    showHowToPlay: false,
    busy: false,
    healBusy: false,
    healUsed: 0,
    cfg: null,
    currency: "REBEL",
    balance: 0,
  };

  // resetGame in PvP context = navigate back to PvP lobby
  const inertActions: BattleSceneActions = {
    setSelectedMove: (() => {}) as any,
    setShowHowToPlay: (() => {}) as any,
    fightTerritory: () => {},
    nextTerritory: () => {},
    resetGame: () => { router.push("/faction-wars/pvp"); },
    setHealBusy: (() => {}) as any,
    setHealUsed: (() => {}) as any,
    setPlayerHp: (() => {}) as any,
    spend: async () => null,
    refresh: async () => undefined,
  };

  // PvP economy: how much did the winner take? Only show if I'm the winner
  // AND the match had a real cost (free PvP shows nothing).
  const ante = Number(match.pvpCost ?? 0);
  const winnings = ante > 0 ? ante * 2 : 0;

  // ── Crate reward (Commit F) ──────────────────────────────────────────────
  // Server credits the winner cfg.rewards[rarity] REBEL on completion.
  // Snapshot is on match.pvpCrateRewardPaid for display.
  const crateReward = Number(match.pvpCrateRewardPaid ?? 0);
  const showCrate = iWon && finalRarity !== "none" && crateReward > 0;

  // Modal toggles open on mount for winners and stays until they dismiss.
  // We use a ref-driven init pattern so the value of `showCrate` at first
  // render is what seeds the state (matches AI mode's prize modal flow).
  const [crateModalOpen, setCrateModalOpen] = useState<boolean>(false);
  useEffect(() => {
    if (showCrate) setCrateModalOpen(true);
    // Only run on mount; dismissal is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sparkle data — generated once and reused across re-renders. 24 sparkles
  // with deterministic-but-varied positions, sizes, and animation delays.
  const sparkles = React.useMemo(() => Array.from({ length: 24 }, (_, i) => ({
    left: (8 + (i * 4.1) % 84) + "%",
    top: (10 + (i * 7.3) % 62) + "%",
    size: 10 + (i * 3) % 14,
    delay: (i * 0.18) % 3.2,
  })), []);

  // Crate display copy by rarity
  const crateTitle = finalRarity === "ultra"
    ? "🏆 ULTRA CRATE!"
    : finalRarity === "rare"
    ? "⚔️ Rare Crate!"
    : finalRarity === "common"
    ? "✅ Crate Unlocked"
    : "";
  const crateSubLine = finalRarity === "ultra"
    ? "5 territories — Total domination!"
    : finalRarity === "rare"
    ? "4 territories — Dominant performance!"
    : finalRarity === "common"
    ? "3 territories — Hard-fought victory!"
    : "";
  const crateTitleColor = finalRarity === "ultra"
    ? "#fbbf24"
    : finalRarity === "rare"
    ? "#60a5fa"
    : "#34d399";

  return (
    <div>
      {iWon && winnings > 0 && (
        <div style={{
          padding: "16px 20px",
          marginBottom: 16,
          borderRadius: 14,
          border: "1px solid rgba(251,191,36,0.5)",
          background: "linear-gradient(135deg,rgba(251,191,36,0.15),rgba(248,113,113,0.1))",
          textAlign: "center",
          boxShadow: "0 0 24px rgba(251,191,36,0.2)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>
            Pot won
          </div>
          <div style={{
            fontSize: 32,
            fontWeight: 900,
            background: "linear-gradient(135deg,#fbbf24,#f87171)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>
            +{winnings} REBEL
          </div>
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
            {crateReward > 0
              ? `Credited: ${winnings} pot + ${crateReward} ${finalRarity} crate bonus`
              : `Credited to your wallet · Both antes (${ante} × 2) won`}
          </div>
        </div>
      )}
      {!iWon && ante > 0 && (
        <div style={{
          padding: "10px 16px",
          marginBottom: 16,
          borderRadius: 10,
          border: "1px solid rgba(248,113,113,0.25)",
          background: "rgba(248,113,113,0.05)",
          textAlign: "center",
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
        }}>
          Lost {ante} REBEL ante to the winner
        </div>
      )}
      <FactionWarsBattleScene
        state={battleSceneState}
        actions={inertActions}
        enableHealing={false}
        showMovePicker={false}
        enableHowToPlay={false}
        leaderboardSlot={null}
      />
      {/* ── Crate Reveal Modal (Commit F) ──────────────────────────────────
          Modeled on AI mode's prize modal. Pops up on mount for winners
          (rarity != "none"). Sparkles + aura + crate art + REBEL bonus +
          dismiss button. Uses inline <style> for keyframes since this is
          self-contained. */}
      {crateModalOpen && showCrate && (
        <>
          <style>{`
            @keyframes fwpvp-pop { 0% { transform: scale(0.7); opacity: 0; } 60% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(1); } }
            @keyframes fwpvp-sparkle { 0%,100% { opacity: 0; transform: scale(0.4) rotate(0deg); } 50% { opacity: 1; transform: scale(1.2) rotate(180deg); } }
            @keyframes fwpvp-aura-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            @keyframes fwpvp-crate-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
            .fwpvp-modal { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,0.75); z-index: 2147483647; padding: 16px; backdrop-filter: blur(4px); }
            .fwpvp-card { position: relative; min-width: 300px; max-width: 420px; width: 90vw; padding: 24px 24px 20px; border-radius: 18px; text-align: center; background: linear-gradient(180deg, rgba(20,15,30,0.95), rgba(8,4,16,0.98)); border: 1px solid rgba(251,191,36,0.3); box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(251,191,36,0.15); animation: fwpvp-pop 0.5s ease-out; overflow: hidden; }
            .fwpvp-aura { position: absolute; inset: -20%; background: radial-gradient(circle, rgba(251,191,36,0.25), transparent 60%); animation: fwpvp-aura-spin 8s linear infinite; pointer-events: none; }
            .fwpvp-aura[data-rarity="rare"] { background: radial-gradient(circle, rgba(96,165,250,0.25), transparent 60%); }
            .fwpvp-aura[data-rarity="common"] { background: radial-gradient(circle, rgba(52,211,153,0.22), transparent 60%); }
            .fwpvp-sparkle { position: absolute; pointer-events: none; background: radial-gradient(circle, #fff8e0, transparent 70%); border-radius: 50%; opacity: 0; animation: fwpvp-sparkle 2.4s ease-in-out infinite; }
            .fwpvp-sparkle.rare { background: radial-gradient(circle, #c7e3ff, transparent 70%); }
            .fwpvp-sparkle.common { background: radial-gradient(circle, #c7ffe3, transparent 70%); }
            .fwpvp-crate { width: 140px; height: 140px; object-fit: contain; margin: 8px auto 14px; animation: fwpvp-crate-bob 2.4s ease-in-out infinite; filter: drop-shadow(0 8px 20px rgba(0,0,0,0.6)); position: relative; z-index: 1; }
          `}</style>
          <div className="fwpvp-modal" role="dialog" aria-modal="true">
            <div className="fwpvp-card">
              <div className="fwpvp-aura" data-rarity={finalRarity} />
              {sparkles.map((sp, i) => (
                <span
                  key={i}
                  className={"fwpvp-sparkle " + finalRarity}
                  style={{ left: sp.left, top: sp.top, width: sp.size + "px", height: sp.size + "px", animationDelay: sp.delay + "s" }}
                />
              ))}
              <div style={{ position: "relative", fontSize: 22, fontWeight: 900, color: crateTitleColor, marginBottom: 4, zIndex: 1, letterSpacing: "0.02em" }}>
                {crateTitle}
              </div>
              <div style={{ position: "relative", fontSize: 12, opacity: 0.6, marginBottom: 4, zIndex: 1 }}>
                {crateSubLine}
              </div>
              <img className="fwpvp-crate" src={"/crates/" + finalRarity + ".png"} alt={finalRarity + " crate"} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              <div style={{ position: "relative", fontSize: 13, opacity: 0.85, marginBottom: 4, zIndex: 1 }}>
                You won
              </div>
              <div style={{
                position: "relative", zIndex: 1,
                fontSize: 36, fontWeight: 900,
                background: `linear-gradient(135deg, ${crateTitleColor}, #fbbf24)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                marginBottom: 6,
              }}>
                +{crateReward} REBEL
              </div>
              <div style={{ position: "relative", fontSize: 10, opacity: 0.55, marginBottom: 18, zIndex: 1 }}>
                Crate bonus credited to your wallet
              </div>
              <button
                onClick={() => setCrateModalOpen(false)}
                style={{
                  position: "relative", zIndex: 1,
                  padding: "10px 28px", borderRadius: 22,
                  border: "1px solid rgba(251,191,36,0.5)",
                  background: "linear-gradient(135deg, rgba(251,191,36,0.25), rgba(248,113,113,0.2))",
                  color: "#fbbf24",
                  fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ChallengePage() {
  const router = useRouter();
  const challengeId = typeof router.query.challengeId === "string" ? router.query.challengeId : "";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<{ playerId: string; displayName: string } | null>(null);
  const [match, setMatch] = useState<PvpMatch | null>(null);

  // ── Chat (Layer 2D) ──────────────────────────────────────────────────────
  // Same per-match chat as the spectate page. Players type → spectators see it.
  // Spectators talk back → players see it. Single Redis key per challengeId.
  // The drawer collapses by default to keep battle UI clean; unread badge
  // pings when new messages arrive while collapsed.
  const chat = useChatState({ challengeId, identity });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState<FactionId[]>([]);
  const [copied, setCopied] = useState(false);
  // Spectator link copy button (Layer 2C) — separate flag from `copied` so
  // both buttons can show their own ✓ feedback independently.
  const [copiedSpectate, setCopiedSpectate] = useState(false);

  // ── Heal config + balance (Commit E) ───────────────────────────────────
  // Pulled from /api/config + /api/points/balance on identity load. Used to:
  //  - render heal button label/cost
  //  - decide if heal is affordable (greys out the button)
  //  - clamp healsUsed UI display
  const [healCost, setHealCost] = useState<number>(25);
  const [healAmt, setHealAmt] = useState<number>(30);
  const [healMax, setHealMax] = useState<number>(2);
  const [balance, setBalance] = useState<number | null>(null);
  const [healBusy, setHealBusy] = useState(false);

  // Audio hook (provides muted/toggleMute/SFX/music control). Lives on the
  // page (not ActiveMatchView) so music persists across status transitions.
  const audio = useFWAudio();

  // ── Completion delay ──────────────────────────────────────────────────────
  // When match.status flips active→completed, we hold on the active view for a
  // few seconds so the final hit's animation, SFX, and music finish before the
  // CompletedMatchView crate reveal takes over. Without this delay, the screen
  // jumps instantly and players miss the moment.
  const [completionPending, setCompletionPending] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  // Detect active→completed transition; hold on completion-pending state.
  // The 3.5s window covers: the final round's animation reset (~1.2s),
  // the territoryWin/Lose SFX cascade, and breathing room before crate reveal.
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = match?.status ?? null;
    prevStatusRef.current = curr;
    if (prev === "active" && curr === "completed") {
      setCompletionPending(true);
      const timer = setTimeout(() => setCompletionPending(false), 3500);
      return () => clearTimeout(timer);
    }
    // If we land on a completed match from a fresh page load (no prior "active"
    // state seen by this client), skip the delay — the player wasn't watching
    // when it ended, so going straight to results is correct.
    if (prev === null && curr === "completed") {
      setCompletionPending(false);
    }
  }, [match?.status]);

  // Start/stop battle music based on match status. Use epic music for
  // territory 4-5 to mirror AI mode's "final push" feel.
  useEffect(() => {
    if (!match) return;
    if (match.status === "active") {
      if (match.currentTerritory >= 3) audio.startEpic();
      else audio.startMusic();
    } else if (match.status === "completed" || match.status === "cancelled") {
      audio.stopMusic();
    }
    // We intentionally don't depend on audio.* refs (they'd cause re-runs and
    // restart music). The hook's internal refs handle idempotency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status, match?.currentTerritory]);

  // ── Inline sign-in state (Commit G + H) ─────────────────────────────────
  // Commit G: inline name claim + Discord OAuth so challenge URL users never leave.
  // Commit H: third path — sign in to an EXISTING claimed name with PIN.
  const [nameInput, setNameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [nameClaiming, setNameClaiming] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  // Existing-name sign-in (separate inputs so users don't confuse claim vs sign-in)
  const [signInName, setSignInName] = useState("");
  const [signInPin, setSignInPin] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInExistingError, setSignInExistingError] = useState<string | null>(null);

  // Load profile + identity. Re-runs whenever the "ra:identity-changed" event
  // fires (after a successful name claim or Discord link), so the inline
  // sign-in widget can swap to the match without a page reload.
  useEffect(() => {
    const load = () => {
      const p = loadProfile();
      setProfile(p);
      setIdentity(deriveIdentity(p));
    };
    load();
    window.addEventListener("ra:identity-changed", load);
    return () => window.removeEventListener("ra:identity-changed", load);
  }, []);

  // ── Discord auto-link on return from OAuth (Commit G) ────────────────────
  // Mirrors the pattern in pages/index.tsx. After Discord OAuth completes the
  // callback redirects back to this URL with ?discord=1. We then poll the
  // session endpoint, link the account if needed, and dispatch the identity
  // event so the gate flips to the match view.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const gate = loadProfile();
      if (gate?.discordSkipLink) return;
      try {
        const sr = await fetch("/api/auth/discord/session", { cache: "no-store" });
        const sj = await sr.json().catch(() => null);
        if (cancelled || !sr.ok || !sj?.ok || !sj?.discordUserId) return;
        const prof = loadProfile();
        const fromId = getEffectivePlayerId(prof);
        const toId = `discord:${sj.discordUserId}`;
        if (String(prof.primaryId || "") === toId) {
          // Already linked — just refresh local profile in case discordName changed.
          saveProfile({ discordUserId: sj.discordUserId, discordName: sj.discordName });
          window.dispatchEvent(new Event("ra:identity-changed"));
          return;
        }
        // First-time link: server-side merges any guest balance/wins into the
        // discord identity. The /api/identity/link-discord endpoint is the
        // canonical place this happens (also used by /).
        await fetch("/api/identity/link-discord", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromId, toId }),
        }).catch(() => undefined);
        if (cancelled) return;
        saveProfile({
          discordUserId: sj.discordUserId,
          discordName: sj.discordName,
          primaryId: toId,
          name: sj.discordName || prof.name,
          discordSkipLink: false,
        });
        window.dispatchEvent(new Event("ra:identity-changed"));
      } catch {
        // Silent — user can manually click Connect Discord again.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Inline name claim handler (Commit G) ─────────────────────────────────
  // Same backend as pages/index.tsx. Allows letters/numbers/underscores, 3+
  // chars. On success: save profile, dispatch identity event, gate flips.
  const handleClaimName = useCallback(async () => {
    const clean = nameInput.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!clean || clean.length < 3) {
      setSignInError("Name must be 3+ characters (letters, numbers, _)");
      return;
    }
    setNameClaiming(true);
    setSignInError(null);
    try {
      const r = await fetch("/api/commander/claim-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: clean,
          displayName: nameInput.trim(),
          pin: pinInput.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSignInError(j.error || "Failed — try another name");
        return;
      }
      saveProfile({
        primaryId: `name:${clean}`,
        name: j.displayName || clean,
        discordSkipLink: false,
      });
      window.dispatchEvent(new Event("ra:identity-changed"));
      // Identity will refresh via the listener; no other action needed.
    } catch (e: any) {
      setSignInError(e?.message || "Network error");
    } finally {
      setNameClaiming(false);
    }
  }, [nameInput, pinInput]);

  // ── Inline existing-name sign-in handler (Commit H) ───────────────────────
  // Mirrors handleClaimName but POSTs to /api/commander/sign-in. Returns the
  // existing playerId on success so the user can resume the challenge from any
  // device where they remember their name + PIN.
  const handleSignIn = useCallback(async () => {
    const clean = signInName.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!clean || clean.length < 3) {
      setSignInExistingError("Enter your commander name (3+ chars)");
      return;
    }
    if (!signInPin.trim()) {
      setSignInExistingError("PIN required to sign in");
      return;
    }
    setSignInBusy(true);
    setSignInExistingError(null);
    try {
      const r = await fetch("/api/commander/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clean, pin: signInPin.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSignInExistingError(j.error || "Sign in failed");
        return;
      }
      saveProfile({
        primaryId: j.playerId || `name:${clean}`,
        name: j.displayName || clean,
        discordSkipLink: false,
      });
      window.dispatchEvent(new Event("ra:identity-changed"));
    } catch (e: any) {
      setSignInExistingError(e?.message || "Network error");
    } finally {
      setSignInBusy(false);
    }
  }, [signInName, signInPin]);

  // ── Inline Discord OAuth (Commit G) ──────────────────────────────────────
  // Sends the user to Discord login with the current challenge URL as
  // returnTo. After OAuth, callback redirects back here with ?discord=1 and
  // the autoLink effect picks up the session.
  const handleConnectDiscord = useCallback(() => {
    if (typeof window === "undefined") return;
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/api/auth/discord/login?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  // Fetch match (poll while not completed/cancelled)
  const refreshMatch = useCallback(async () => {
    if (!challengeId) return;
    try {
      const r = await fetch(`/api/faction-wars/pvp/get?id=${encodeURIComponent(challengeId)}`);
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Match not found");
        setMatch(null);
      } else {
        setMatch(j.match as PvpMatch);
        setError(null);
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    if (!challengeId) return;
    refreshMatch();
  }, [challengeId, refreshMatch]);

  useEffect(() => {
    if (!match) return;
    if (match.status === "completed" || match.status === "cancelled") return;
    const t = setInterval(refreshMatch, 5000);
    return () => clearInterval(t);
  }, [match, refreshMatch]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleAccept = async () => {
    if (!identity || !match) return;
    // Kick audio under the gesture (iOS) so the upcoming match has music.
    try { audio.startMusic(); } catch {}
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, opponentPlayerId: identity.playerId, opponentDisplayName: identity.displayName }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Accept failed");
      else setMatch(j.match);
    } catch (e: any) { setError(e?.message || "Network error"); } finally { setBusy(false); }
  };

  const handleSubmitTeam = async () => {
    if (!identity || !match || team.length !== TEAM_SIZE) return;
    try { audio.startMusic(); } catch {}
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/select-team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, playerId: identity.playerId, team }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Team submission failed");
      else setMatch(j.match);
    } catch (e: any) { setError(e?.message || "Network error"); } finally { setBusy(false); }
  };

  const handleCancel = async () => {
    if (!identity || !match) return;
    if (!confirm("Cancel this challenge? It cannot be undone.")) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, playerId: identity.playerId }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Cancel failed");
      else setMatch(j.match);
    } catch (e: any) { setError(e?.message || "Network error"); } finally { setBusy(false); }
  };

  const handleDecline = async () => {
    if (!identity || !match) return;
    if (!confirm("Decline this challenge? The challenger will be refunded.")) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/decline", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, playerId: identity.playerId }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Decline failed");
      else setMatch(j.match);
    } catch (e: any) { setError(e?.message || "Network error"); } finally { setBusy(false); }
  };

  // ── Fetch heal config + balance ──────────────────────────────────────
  // Refetch balance after every action that spends/credits REBEL (heal,
  // submit-move, ante deduction at create/accept) so the heal button reflects
  // current balance immediately.
  const refreshBalance = useCallback(async () => {
    if (!identity) return;
    try {
      const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(identity.playerId)}`);
      const j = await r.json();
      if (j && typeof j.balance === "number") setBalance(j.balance);
    } catch {}
  }, [identity]);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/config");
        const j = await r.json();
        if (cancelled) return;
        if (j?.ok && j.pointsConfig) {
          const c = j.pointsConfig;
          const cost = Number(c.factionWarsHealCost);
          const amt = Number(c.factionWarsHealAmt);
          const max = Number(c.factionWarsHealMax);
          if (Number.isFinite(cost) && cost >= 0) setHealCost(cost);
          if (Number.isFinite(amt) && amt > 0) setHealAmt(amt);
          if (Number.isFinite(max) && max >= 0) setHealMax(max);
        }
      } catch {}
      await refreshBalance();
    })();
    return () => { cancelled = true; };
  }, [identity, refreshBalance]);

  const handleHeal = async () => {
    if (!identity || !match) return;
    setHealBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/heal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, playerId: identity.playerId }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Heal failed");
      } else {
        setMatch(j.match);
        if (typeof j.balance === "number") setBalance(j.balance);
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setHealBusy(false);
    }
  };

  const handleSubmitMove = async (moveId: string) => {
    if (!identity || !match) return;
    // iOS / Safari requires a user gesture to start audio. Music start in
    // useEffect doesn't qualify, so we kick here too — switchMusic is now
    // idempotent (lib/useFWAudio.ts) so this is safe to call every move.
    try {
      if (match.status === "active") {
        if (match.currentTerritory >= 3) audio.startEpic();
        else audio.startMusic();
      }
    } catch {}
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/submit-move", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, playerId: identity.playerId, moveId }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Move submission failed");
        setBusy(false);
        return;
      }

      const newMatch = j.match;
      const territoryEnded: boolean = j.territoryEnded === true;
      const matchStillActive: boolean = newMatch?.status === "active";

      // ── Per-territory animation hold ────────────────────────────────────
      // When a territory ends but the match continues, the server has already
      // rotated to the next fighter and reset HPs. If we apply that immediately,
      // the killing-blow animation gets cut off and the user misses the win/lose
      // beat. Hold for 3.5s on a "stage" view that shows the previous fighters
      // at their final HPs (loser at 0, winner at whatever they had), then
      // apply the rotation. Match-completion delays are handled separately by
      // <PendingCompletionView> via the completionPending effect.
      if (territoryEnded && matchStillActive && match) {
        const lastResult = newMatch.territoryResults[newMatch.territoryResults.length - 1];
        if (lastResult) {
          // Build the "stage" match: same as newMatch (so the killing-blow round
          // is visible in roundHistory and animation effects fire), but with
          // pre-rotation positions/HPs/territory.
          const stageMatch = {
            ...newMatch,
            challengerCurrentFactionIndex: match.challengerCurrentFactionIndex,
            opponentCurrentFactionIndex: match.opponentCurrentFactionIndex,
            challengerHp: lastResult.challengerHpFinal,
            opponentHp: lastResult.opponentHpFinal,
            currentTerritory: match.currentTerritory,
          };
          setMatch(stageMatch);
          // Hold the stage view, then apply the real (rotated) match.
          setTimeout(() => {
            setMatch(newMatch);
            setBusy(false);
          }, 3500);
          return;
        }
      }

      // Default path: apply immediately.
      setMatch(newMatch);
      // If this move ended the match, the server credited the winner
      // (and possibly any tie refund). Refresh balance so the user sees it.
      if (newMatch?.status === "completed") {
        refreshBalance();
      }
      setBusy(false);
    } catch (e: any) {
      setError(e?.message || "Network error");
      setBusy(false);
    }
  };

  const copyShareLink = () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/faction-wars/challenge/${challengeId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Spectator-only link — non-participants land on the read-only spectate page.
  // Useful for tournament shows or sharing in Discord while a match is live.
  const copySpectateLink = () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/faction-wars/spectate/${challengeId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedSpectate(true);
      setTimeout(() => setCopiedSpectate(false), 2000);
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const isChallenger = match && identity && match.challengerPlayerId === identity.playerId;
  const isOpponent = match && identity && match.opponentPlayerId === identity.playerId;
  const isParticipant = isChallenger || isOpponent;
  const myTeamLocked = match && identity && (
    (isChallenger && match.challengerTeam.length === TEAM_SIZE) ||
    (isOpponent && match.opponentTeam.length === TEAM_SIZE)
  );

  return (
    <>
      <Head>
        <title>{match ? `vs ${isChallenger ? match.opponentDisplayName || "?" : match.challengerDisplayName} · Faction Wars PvP` : "Faction Wars PvP"}</title>
      </Head>
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0a14 0%,#1a0f1f 100%)", color: "white", paddingBottom: 60 }}>
        {/* Header */}
        <header style={{ position: "relative", zIndex: 20, maxWidth: 980, margin: "0 auto", padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: JP }}>
          <Link href="/faction-wars/pvp" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "white" }}>
            <span style={{ fontSize: 20, filter: "drop-shadow(0 0 8px rgba(251,191,36,0.6))" }}>←</span>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>PvP Lobby</span>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {balance !== null && (
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", color: "#fbbf24", filter: "drop-shadow(0 0 8px rgba(251,191,36,0.5))" }}>
                ⚡ {balance.toLocaleString()} <span style={{ fontSize: 10, color: "rgba(251,191,36,0.6)" }}>REBEL</span>
              </div>
            )}
          {/* Mute toggle — lives in header so it never overlaps title text */}
          <button
            onClick={audio.toggleMute}
            aria-label={audio.muted ? "Unmute" : "Mute"}
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8, padding: "6px 10px",
              cursor: "pointer", color: "rgba(255,255,255,0.8)",
              fontSize: 14, lineHeight: 1,
            }}
          >
            {audio.muted ? "🔇" : "🔊"}
          </button>
          </div>
        </header>

        <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 16px 40px", fontFamily: JP }}>
          {/* Title */}
          <div style={{ textAlign: "center", marginBottom: 24, marginTop: 14 }}>
            <div style={{
              fontSize: "clamp(20px,3.5vw,32px)", fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase",
              background: "linear-gradient(135deg,#fbbf24,#f87171,#c084fc)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              {match ? `${match.challengerDisplayName} vs ${match.opponentDisplayName || "?"}` : "Loading match…"}
            </div>
          </div>

          {error && (
            <div style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)", color: "#f87171", fontSize: 12, marginBottom: 16 }}>
              ⚠️ {error}
            </div>
          )}

          {/* Identity gate — inline sign-in (Commit G) */}
          {!identity && (
            <div style={{ padding: "24px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.04)" }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#fbbf24", marginBottom: 8, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "center" }}>
                🔒 Sign in to accept this challenge
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 18, lineHeight: 1.6, textAlign: "center" }}>
                Pick a commander name or connect Discord. You'll continue to the match automatically once signed in.
              </div>

              {/* Commander name claim */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
                  Claim a commander name
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => { setNameInput(e.target.value); setSignInError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleClaimName(); }}
                    placeholder="commander_name"
                    maxLength={20}
                    disabled={nameClaiming}
                    style={{
                      flex: "1 1 180px", minWidth: 0,
                      padding: "10px 12px", borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(0,0,0,0.4)",
                      color: "rgba(255,255,255,0.95)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <input
                    type="password"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleClaimName(); }}
                    placeholder="PIN (optional)"
                    maxLength={20}
                    disabled={nameClaiming}
                    style={{
                      width: 130,
                      padding: "10px 12px", borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(0,0,0,0.4)",
                      color: "rgba(255,255,255,0.95)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={handleClaimName}
                    disabled={nameClaiming || nameInput.trim().length < 3}
                    style={{
                      padding: "10px 18px", borderRadius: 8,
                      border: "1px solid rgba(251,191,36,0.4)",
                      background: nameClaiming || nameInput.trim().length < 3 ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(251,191,36,0.25),rgba(248,113,113,0.25))",
                      color: nameClaiming || nameInput.trim().length < 3 ? "rgba(255,255,255,0.4)" : "#fbbf24",
                      fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                      cursor: nameClaiming || nameInput.trim().length < 3 ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {nameClaiming ? "Claiming…" : "Claim"}
                  </button>
                </div>
                <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6, lineHeight: 1.4 }}>
                  3+ characters, letters/numbers/underscores. PIN protects the name from being claimed by others on a different device.
                </div>
              </div>

              {/* Divider 1 */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0", opacity: 0.4 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.15)" }} />
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.2em", color: "rgba(255,255,255,0.55)" }}>OR</div>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.15)" }} />
              </div>

              {/* Sign in to existing claimed name (Commit H) */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
                  Sign in to existing name
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={signInName}
                    onChange={(e) => { setSignInName(e.target.value); setSignInExistingError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSignIn(); }}
                    placeholder="commander_name"
                    maxLength={20}
                    disabled={signInBusy}
                    style={{
                      flex: "1 1 180px", minWidth: 0,
                      padding: "10px 12px", borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(0,0,0,0.4)",
                      color: "rgba(255,255,255,0.95)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <input
                    type="password"
                    value={signInPin}
                    onChange={(e) => { setSignInPin(e.target.value); setSignInExistingError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSignIn(); }}
                    placeholder="PIN"
                    maxLength={20}
                    disabled={signInBusy}
                    style={{
                      width: 130,
                      padding: "10px 12px", borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(0,0,0,0.4)",
                      color: "rgba(255,255,255,0.95)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={handleSignIn}
                    disabled={signInBusy || signInName.trim().length < 3 || !signInPin.trim()}
                    style={{
                      padding: "10px 18px", borderRadius: 8,
                      border: "1px solid rgba(96,165,250,0.4)",
                      background: signInBusy || signInName.trim().length < 3 || !signInPin.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(96,165,250,0.25),rgba(167,139,250,0.25))",
                      color: signInBusy || signInName.trim().length < 3 || !signInPin.trim() ? "rgba(255,255,255,0.4)" : "#93c5fd",
                      fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                      cursor: signInBusy || signInName.trim().length < 3 || !signInPin.trim() ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {signInBusy ? "Signing in…" : "Sign In"}
                  </button>
                </div>
                <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6, lineHeight: 1.4 }}>
                  Already have a commander name from another device? Enter it with your PIN to sign back in.
                </div>
                {signInExistingError && (
                  <div style={{
                    marginTop: 8, padding: "6px 10px", borderRadius: 6,
                    background: "rgba(248,113,113,0.1)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    color: "#fca5a5",
                    fontSize: 11, textAlign: "center",
                  }}>
                    {signInExistingError}
                  </div>
                )}
              </div>

              {/* Divider 2 */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0", opacity: 0.4 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.15)" }} />
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.2em", color: "rgba(255,255,255,0.55)" }}>OR</div>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.15)" }} />
              </div>

              {/* Discord OAuth */}
              <button
                onClick={handleConnectDiscord}
                style={{
                  width: "100%",
                  padding: "12px 20px", borderRadius: 10,
                  border: "1px solid rgba(88,101,242,0.5)",
                  background: "linear-gradient(135deg,rgba(88,101,242,0.25),rgba(88,101,242,0.15))",
                  color: "#a5b3ff",
                  fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                <span style={{ fontSize: 16 }}>🎮</span> Connect Discord
              </button>

              {signInError && (
                <div style={{
                  marginTop: 12, padding: "8px 12px", borderRadius: 8,
                  background: "rgba(248,113,113,0.1)",
                  border: "1px solid rgba(248,113,113,0.3)",
                  color: "#fca5a5",
                  fontSize: 12, textAlign: "center",
                }}>
                  {signInError}
                </div>
              )}
            </div>
          )}

          {loading && !match && <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.4)" }}>Loading…</div>}

          {match && identity && (
            <>
              {/* PENDING — challenger sees share link, viewer sees Accept */}
              {match.status === "pending" && (
                <>
                  {isChallenger ? (
                    <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(88,101,242,0.3)", background: "rgba(88,101,242,0.05)" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#a5b4fc", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
                        Share this link with your friend
                      </div>
                      <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.4)", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "rgba(255,255,255,0.8)", wordBreak: "break-all", marginBottom: 12 }}>
                        {typeof window !== "undefined" ? window.location.href : ""}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button onClick={copyShareLink} style={{ padding: "8px 16px", borderRadius: 18, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
                          {copied ? "✓ Copied" : "Copy link"}
                        </button>
                        <button onClick={copySpectateLink} style={{ padding: "8px 16px", borderRadius: 18, border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.04)", color: "#f87171", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }} title="Read-only link for spectators">
                          {copiedSpectate ? "✓ Copied" : "👁 Spectate link"}
                        </button>
                        <button onClick={handleCancel} disabled={busy} style={{ padding: "8px 16px", borderRadius: 18, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.05)", color: "#f87171", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", cursor: busy ? "wait" : "pointer" }}>
                          Cancel challenge
                        </button>
                      </div>
                      <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Waiting for opponent to accept…</div>
                    </div>
                  ) : (
                    <div style={{ padding: "24px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)", textAlign: "center" }}>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        You've been challenged by
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#fbbf24", marginBottom: 18, letterSpacing: "0.05em" }}>
                        {match.challengerDisplayName}
                      </div>
                      {/* Wager display (Layer 2A) */}
                      {Number(match.pvpCost ?? 0) > 0 && (
                        <div style={{ marginBottom: 18, padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(0,0,0,0.3)" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
                            Wager
                          </div>
                          <div style={{ fontSize: 28, fontWeight: 900, color: "#fbbf24", letterSpacing: "0.02em", lineHeight: 1 }}>
                            {Number(match.pvpCost).toLocaleString()} <span style={{ fontSize: 14, color: "rgba(251,191,36,0.7)", fontWeight: 700 }}>REBEL</span>
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 8, lineHeight: 1.5 }}>
                            Match {Number(match.pvpCost).toLocaleString()} REBEL to play. Winner takes the {(Number(match.pvpCost) * 2).toLocaleString()} REBEL pot.
                          </div>
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
                        <button onClick={handleAccept} disabled={busy} style={{ minWidth: 240, height: 50, padding: "0 28px", fontSize: 13, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 25, border: "1px solid rgba(251,191,36,0.5)", background: busy ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(251,191,36,0.3),rgba(248,113,113,0.3))", color: busy ? "rgba(255,255,255,0.4)" : "#fbbf24", cursor: busy ? "wait" : "pointer", filter: busy ? "none" : "drop-shadow(0 0 12px rgba(251,191,36,0.3))" }}>
                          {busy ? "Accepting…" : Number(match.pvpCost ?? 0) > 0 ? `⚔️ Accept — Match ${Number(match.pvpCost).toLocaleString()} REBEL` : "⚔️ Accept Challenge"}
                        </button>
                        <button onClick={handleDecline} disabled={busy} style={{ minWidth: 120, height: 50, padding: "0 22px", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 25, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.05)", color: "#f87171", cursor: busy ? "wait" : "pointer" }}>
                          Decline
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* TEAM_SELECTION — both pick teams */}
              {match.status === "team_selection" && isParticipant && (
                <div>
                  {myTeamLocked ? (
                    <div style={{ padding: "24px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.04)", textAlign: "center" }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "#fbbf24", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
                        ✓ Your team is locked
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>
                        Waiting for opponent to lock their team…
                      </div>
                    </div>
                  ) : (
                    <TeamPicker team={team} setTeam={setTeam} onSubmit={handleSubmitTeam} busy={busy} />
                  )}
                </div>
              )}

              {/* ACTIVE */}
              {match.status === "active" && isParticipant && (
                <ActiveMatchView
                  match={match}
                  mePlayerId={identity.playerId}
                  challengeId={challengeId}
                  onSubmitMove={handleSubmitMove}
                  onHeal={handleHeal}
                  busy={busy}
                  healBusy={healBusy}
                  healCost={healCost}
                  healAmt={healAmt}
                  healMax={healMax}
                  balance={balance}
                  sfx={audio.sfx}
                />
              )}

              {/* COMPLETED — but hold for 3.5s so animations play out */}
              {match.status === "completed" && identity && completionPending && (
                <PendingCompletionView
                  match={match}
                  mePlayerId={identity.playerId}
                />
              )}
              {match.status === "completed" && identity && !completionPending && (
                <CompletedMatchView
                  match={match}
                  mePlayerId={identity.playerId}
                  sfx={audio.sfx}
                  stopMusic={audio.stopMusic}
                />
              )}

              {/* CANCELLED */}
              {match.status === "cancelled" && (
                <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                  This challenge was cancelled.
                </div>
              )}

              {/* Non-participant viewing an in-progress match */}
              {!isParticipant && match.status !== "pending" && match.status !== "completed" && match.status !== "cancelled" && (
                <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                  This match is between {match.challengerDisplayName} and {match.opponentDisplayName}. You can't join an in-progress challenge.
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {/* Floating chat drawer (Layer 2D) — bottom-right, collapsed by default,
          unread badge pings while collapsed. Hidden when chat is disabled
          server-side via factionWarsChatEnabled. */}
      <ChatDrawer match={match} identity={identity} chat={chat} />
    </>
  );
}
