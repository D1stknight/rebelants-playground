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

  // ── Timestamps ─────────────────────────────────────────────────────────
  createdAt: number;
  updatedAt: number;
  lastActionAt: number;
}

// Body for POST /api/faction-wars/pvp/create
export interface CreateChallengeRequest {
  challengerPlayerId: string;
  challengerDisplayName: string;
  challengerTeam?: FactionId[];   // optional — challenger may pick at create time or after accept
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
