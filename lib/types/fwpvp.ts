// PvP Faction Wars — match types
// V1 of async, turn-based, link-shareable PvP. AI mode is unaffected.
//
// IMPORTANT: This module is intentionally separate from the AI-mode types in
// components/FactionWars.tsx. We duplicate the small type surface here on
// purpose so that PvP can evolve without risking the existing single-player
// game. Once both modes are stable we can deduplicate.

import type { FactionId } from "../factionWarsCore";

export type PvpStatus =
  | "pending"          // challenger created, opponent has not accepted
  | "team_selection"   // opponent accepted, both players are picking teams
  | "active"            // both teams locked, match in progress
  | "completed"         // match finished, has winner
  | "cancelled";       // challenger cancelled before opponent accepted

export type PvpSide = "challenger" | "opponent";

export type PvpMoveType = "attack" | "defend" | "magic" | "trick";

export interface PvpRound {
  // Index of the territory (0..4)
  territory: number;
  // 1-based round counter within this territory
  roundInTerritory: number;
  // Who attacked this round
  attackerSide: PvpSide;
  // Faction id of the attacker
  attackerFaction: FactionId;
  // Faction id of the defender (the side that did NOT submit a move this round)
  defenderFaction: FactionId;
  // Move id (e.g. "katana_strike")
  moveId: string;
  // Move type (denormalized for easy display in history)
  moveType: PvpMoveType;
  // Damage dealt to the defender after all calculations
  damageDealt: number;
  // Defender HP after damage applied
  defenderHpAfter: number;
  // Player ID who submitted the move
  byPlayerId: string;
  // Timestamp
  at: number;
}

export interface PvpTerritoryResult {
  territory: number;
  challengerFaction: FactionId;
  opponentFaction: FactionId;
  // Who won this territory
  winnerSide: PvpSide;
  // Final HPs at territory end
  challengerHpFinal: number;
  opponentHpFinal: number;
  // Number of rounds the territory took
  rounds: number;
}

export interface PvpMatch {
  // Unique 12-char id used in shareable URL
  challengeId: string;
  status: PvpStatus;

  // ── Identities ─────────────────────────────────────────────────────────
  challengerPlayerId: string;     // stable id (discord:..., wallet:..., or commander:name)
  challengerDisplayName: string;
  opponentPlayerId: string | null;     // null until accepted
  opponentDisplayName: string | null;

  // ── Teams (fixed faction order, locked at team selection) ──────────────
  challengerTeam: FactionId[];   // length 5 once locked
  opponentTeam: FactionId[];     // length 5 once locked

  // ── Match state ────────────────────────────────────────────────────────
  // Whose turn it is right now (player id). Null when status !== "active".
  currentTurnPlayerId: string | null;
  // Side of the player whose turn it is. Null when not active.
  currentTurnSide: PvpSide | null;
  // Index into team arrays — which fighter is currently up for each side
  challengerCurrentFactionIndex: number;
  opponentCurrentFactionIndex: number;
  // HP of the current fighter on each side (resets to MAX when fighter rotates)
  challengerHp: number;
  opponentHp: number;
  // Which territory is being fought (0..4)
  currentTerritory: number;

  // ── History ────────────────────────────────────────────────────────────
  roundHistory: PvpRound[];
  territoryResults: PvpTerritoryResult[];

  // ── End state ──────────────────────────────────────────────────────────
  // Number of territories each side won
  challengerTerritoriesWon: number;
  opponentTerritoriesWon: number;
  winnerPlayerId: string | null;
  loserPlayerId: string | null;
  // Crate rarity (only meaningful for the winner; loser gets nothing)
  // Determined by territories the WINNER won: 3=common, 4=rare, 5=ultra
  winnerCrateRarity: "common" | "rare" | "ultra" | null;

  // ── PvP Economy (Commit C) ──────────────────────────────────────────────
  // REBEL ante per side, snapshotted at match creation so admin config changes
  // mid-match don't break refund / payout math. 0 means PvP was free at the
  // time the match was created.
  pvpCost: number;
  // Payout mode. V1 only supports "pot" (winner takes both antes); future
  // values could include "split", "house_fee", etc.
  pvpPayoutMode: "pot";
  // Running total of REBEL on the table. challenger pays `pvpCost` on create
  // (=> pvpPotPaid = pvpCost), opponent pays on accept (=> pvpPotPaid = 2 * pvpCost).
  // The winner gets credited this amount when the match completes.
  pvpPotPaid: number;
  challengerPaid: boolean;
  opponentPaid: boolean;

  // ── Heal counters (Commit E) ───────────────────────────────────────────
  // Tracks how many heals each side has used. Capped at factionWarsHealMax
  // (default 2 from admin config). Each heal costs factionWarsHealCost REBEL
  // and restores factionWarsHealAmt HP. Decoupled per side so each player has
  // their own independent budget.
  challengerHealsUsed: number;
  opponentHealsUsed: number;

  // ── Crate reward (Commit F) ─────────────────────────────────────────────
  // REBEL bonus credited to the winner on completion, on TOP of the pot.
  // Comes from cfg.rewards[rarity] (same admin config AI mode uses):
  //   rarity = "common" → cfg.rewards.common (default 50)
  //   rarity = "rare"   → cfg.rewards.rare   (default 100)
  //   rarity = "ultra"  → cfg.rewards.ultra  (default 300)
  //   rarity = "none"   → 0
  // Snapshotted on completion so client can display the exact amount; survives
  // admin tweaks. Not zeroed after payout (pot does that) — kept for display.
  pvpCrateRewardPaid: number;

  // ── Timestamps ─────────────────────────────────────────────────────────
  createdAt: number;
  updatedAt: number;
  lastActionAt: number;

  // ── Spectator visibility (Layer 2C) ─────────────────────────────────────
  // When true, match is hidden from /api/faction-wars/pvp/list-active and
  // therefore from the public "Live Matches" list. The direct spectate URL
  // (/faction-wars/spectate/{challengeId}) still works — sharing is opt-in
  // via link, not via a hard gate. Defaults to false (public).
  isPrivate?: boolean;
}

// ── Spectator side bets (Layer 2B) ─────────────────────────────────────────
//
// Pari-mutuel betting: spectators pick a side, deposit REBEL into a pool.
// On match resolve, loser-side deposits split pro-rata to winner-side
// bettors. Loser bettors get nothing. House takes 0%.
//
// Storage: Redis hash `ra:fwpvp:bets:{challengeId}` with field={playerId}
// value=JSON-stringified PvpBet. Lock flag at `ra:fwpvp:bets:locked:{challengeId}`.
// Bet amounts are debited from the player's REBEL balance immediately at
// place-time and re-credited (with payout share) on resolve.

export interface PvpBet {
  // Player who placed the bet.
  playerId: string;
  displayName: string;
  // Which side they're backing — must match a PvpSide.
  side: PvpSide;
  // Total REBEL committed (sum of all top-ups by this player on this side).
  amount: number;
  // Timestamp of the FIRST bet from this player on this match.
  firstAt: number;
  // Last update timestamp (for "Bob just dropped 1k" feed sorting).
  lastAt: number;
}

// Settlement record stored on the match object so post-resolve clients can
// render the result without hitting a separate endpoint.
export interface PvpBetPayout {
  playerId: string;
  displayName: string;
  side: PvpSide;
  betAmount: number;       // What they put in
  payoutAmount: number;    // What they got back (0 if loser, betAmount + share if winner)
  netDelta: number;        // payoutAmount - betAmount (signed)
}

export interface PvpBetsState {
  // Per-side totals across all bettors. Used for live odds display.
  challengerPool: number;
  opponentPool: number;
  // Per-bettor records. Sorted by lastAt DESC client-side.
  bets: PvpBet[];
  // Bets are locked once the match enters the lock-territory (admin-configurable,
  // default 3 of 5). After lock, no new bets / top-ups accepted.
  locked: boolean;
  // Total bettors per side (length of filtered bets array).
  challengerBettorCount: number;
  opponentBettorCount: number;
}

// Body for POST /api/faction-wars/pvp/bet
export interface PlaceBetRequest {
  challengeId: string;
  playerId: string;
  displayName: string;
  side: PvpSide;
  amount: number;
}

// Body for POST /api/faction-wars/pvp/create
export interface CreateChallengeRequest {
  challengerPlayerId: string;
  challengerDisplayName: string;
  challengerTeam?: FactionId[];   // optional — challenger may pick at create time or after accept
  wagerAmount?: number;           // optional — must be one of factionWarsPvpWagerTiers; defaults to factionWarsPvpCost
  isPrivate?: boolean;            // optional — when true, match is hidden from public Live Matches list (default false)
}

// Body for POST /api/faction-wars/pvp/accept
export interface AcceptChallengeRequest {
  challengeId: string;
  opponentPlayerId: string;
  opponentDisplayName: string;
}

// Body for POST /api/faction-wars/pvp/select-team
export interface SelectTeamRequest {
  challengeId: string;
  playerId: string;
  team: FactionId[];   // exactly 5
}

// Body for POST /api/faction-wars/pvp/submit-move
export interface SubmitMoveRequest {
  challengeId: string;
  playerId: string;
  moveId: string;   // must belong to the player's currently-active faction
}

// Body for POST /api/faction-wars/pvp/cancel
export interface CancelChallengeRequest {
  challengeId: string;
  playerId: string;   // must equal challengerPlayerId, and status must be "pending"
}
