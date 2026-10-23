// lib/fwpvpRewards.ts
// What the PvP pages say about crates and side bets. The server decides
// (lib/server/fwpvp.ts matchAccounts): a match pays a crate or a tournament
// pot, settles side bets and counts on the PvP boards only when both sides are
// signed-in players with Rebel Economy accounts of their own.
import type { PvpMatch } from "./types/fwpvp";

// A signed-in player's id (a guest's is guest-...).
export function isSignedPlayerId(id: unknown): boolean {
  return /^(discord|name|wallet):./.test(String(id || ""));
}

// A side of the match is (or may still be) a guest: no crate, no side bets.
export function matchHasGuestSide(match: Pick<PvpMatch, "challengerPlayerId" | "opponentPlayerId">): boolean {
  return !isSignedPlayerId(match.challengerPlayerId) || (!!match.opponentPlayerId && !isSignedPlayerId(match.opponentPlayerId));
}

export function rewardsWithheldText(reason: PvpMatch["pvpRewardsWithheld"]): string {
  if (reason === "same_account") return "Both sides of this match were the same account.";
  if (reason === "unverified") return "The players' accounts could not be checked when the match ended.";
  return "Crates and side bets only come from matches between two signed-in players.";
}
