/** Completion is only a trigger. The server verifies the signed learning
 * session, selected player and its own stored game evidence. No score, NFT,
 * XP amount or wallet authority comes from this browser request. */
export async function recordCompletedPlaygroundMatch(input: {
  challengeId: string; playerId: string; signal: AbortSignal; transport?: typeof fetch;
}) {
  if (!/^[a-z0-9]{12}$/.test(input.challengeId) || !input.playerId || input.playerId.length > 64) return;
  const response = await (input.transport ?? fetch)("/api/raap/match-experience", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: input.challengeId, playerId: input.playerId }),
    credentials: "same-origin", cache: "no-store", redirect: "error", signal: input.signal,
  });
  // Optional sharing cannot block the result animation or the game payout.
  // A failure/absent response is not treated as confirmed history, and is never
  // automatically retried by this helper.
  if (!response.ok) return;
  await response.body?.cancel();
}
