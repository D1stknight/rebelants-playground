import type { NextApiRequest, NextApiResponse } from "next";
import { createSoloCampaignService, type SoloSession } from "../../../lib/server/raap-fwsolo";
import { createPlaygroundPlayerConnection, inspectPlaygroundLearningSession } from "../../../lib/server/raap-player-connection";
import { readRaapDiscordPlayer, raapDiscordPlayerSettings } from "../../../lib/server/raap-discord-player";
import { soloConfig } from "../../../lib/factionWarsSoloCampaign";
import { pointsConfig as defaults } from "../../../lib/pointsConfig";
import { INTERNAL_CALL } from "../../../lib/server/player-auth";

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const fields = (value: object, expected: string) => Object.keys(value).sort().join() === expected.split(",").sort().join();
const view = (session: SoloSession | null) => session && ({ id: session.id, revision: session.revision,
  playerId: session.playerId, state: session.state, config: session.config, validUntil: session.validUntil,
  held: session.pending !== null, abandoned: session.abandoned, raapActionCount: session.raapActionCount ?? 0,
  pointDisplayUnconfirmed: session.pointDisplayUnconfirmed === true,
  selectedRebel: session.selected.asset.tokenId });

/** Every point/move operation is an explicit authenticated human request.
 * STATUS reads saved data only; no request is retried or recovered here. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
  const settings = raapDiscordPlayerSettings(process.env);
  const now = () => Math.floor(Date.now() / 1000);
  let connection: ReturnType<typeof createPlaygroundPlayerConnection> | undefined;
  try {
    if (!settings || process.env.RAAP_REBEL_SOLO_ENABLED !== "true") return res.status(503).json({ error: "SOLO_UNCONFIGURED" });
    if (req.method !== "POST" || req.url !== "/api/raap/solo-campaign" || req.headers.origin !== settings.origin ||
      req.headers["sec-fetch-site"] !== "same-origin" || req.headers["content-type"] !== "application/json" || req.headers["content-encoding"]) throw Error();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 2048) return res.status(413).end(); chunks.push(Buffer.from(chunk)); }
    const b = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!b || typeof b !== "object" || Array.isArray(b) || typeof b.playerId !== "string") throw Error();
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) { if (Array.isArray(value)) throw Error(); if (value !== undefined) headers.set(key, value); }
    const request = new Request(settings.origin + req.url, { method: "POST", headers });
    let learning: ReturnType<typeof inspectPlaygroundLearningSession> | undefined;
    try { learning = inspectPlaygroundLearningSession(request, { cookieKey: settings.key, validUntil: settings.validUntil, now }); } catch { /* A saved game remains the signed-in player's game. */ }
    const discord = readRaapDiscordPlayer(req.headers.cookie ?? "", settings);
    if (b.playerId !== discord && b.playerId !== (learning && `wallet:${learning.controller}`))
      return res.status(401).json({ error: "SOLO_PLAYER_SIGN_IN_REQUIRED" });
    const { redis } = await import("../../../lib/server/redis");
    const { spendREBEL, creditREBEL, getREBELBalance } = await import("../../../lib/server/fwpvp");
    const service = createSoloCampaignService({ store: redis, validUntil: settings.validUntil, now,
      send: async (effect, playerId, idem) => {
        const balance = effect.direction === "DEBIT"
          ? await spendREBEL(playerId, effect.amount, { idem, reason: effect.reason, metadata: { game: "faction-wars", mode: "SOLO" } })
          : await creditREBEL(playerId, effect.amount, { idem, type: "game_reward", reason: effect.reason, metadata: { game: "faction-wars", mode: "SOLO" } });
        return balance;
      }, afterPoint: async (effect, playerId, balance) => {
        const { addToEarnedTotal, updateBalanceLeaderboard } = await import("../../../lib/server/leaderboards");
        if (effect.direction === "CREDIT") await addToEarnedTotal(playerId, effect.amount);
        await updateBalanceLeaderboard(playerId, balance);
      } });
    if (b.operation === "STATUS") {
      if (!fields(b, b.id === undefined ? "operation,playerId" : "operation,playerId,id")) throw Error();
      return res.json({ connected: !!learning, session: view(await service.read(b.playerId, b.id)) });
    }
    if (b.operation === "REWARD" || b.operation === "CLAIM_PRIZE" || b.operation === "REPORT") {
      if (!fields(b, b.operation === "REWARD" ? "operation,playerId,id" : b.operation === "REPORT" ? "operation,playerId,id,playerName" : "operation,playerId,id,wallet") ||
        b.operation === "REPORT" && (typeof b.playerName !== "string" || b.playerName.length > 64) ||
        b.operation === "CLAIM_PRIZE" && b.wallet !== null && (typeof b.wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(b.wallet))) throw Error();
      const run = async (handler: (req: NextApiRequest, res: NextApiResponse) => unknown, body: object, query: object = {}) => {
        let value: unknown, code = 200;
        const response = { setHeader() {}, status(n: number) { code = n; return this; }, json(v: unknown) { value = v; return this; } };
        await handler({ method: "POST", body, query, headers: { host: new URL(settings.origin).host, "x-forwarded-proto": "https" }, [INTERNAL_CALL]: true } as unknown as NextApiRequest, response as unknown as NextApiResponse);
        if (code !== 200 || !value) throw Error(); return value;
      };
      if (b.operation === "REPORT") {
        const result = await service.resultEffect(b.playerId, b.id, "BOARD", async s => {
          const { default: record } = await import("../faction-wars/record");
          const won = s.state.results.filter(r => r.won).length;
          return run(record, { playerId: s.playerId, playerName: b.playerName, rarity: s.state.rarity,
            pointsAwarded: s.state.reward, territoriesWon: won, team: s.state.team, perfect: won === 5 });
        });
        return res.json({ result });
      }
      if (b.operation === "REWARD") {
        const result = await service.resultEffect(b.playerId, b.id, "REWARD", async s => {
          const { default: roll } = await import("../prizes/roll");
          return run(roll, { playerId: s.playerId, rarity: s.state.rarity, game: "faction-wars" }, { force: s.state.rarity });
        });
        return res.json({ result });
      }
      const reward = await service.resultEffect(b.playerId, b.id, "REWARD");
      if (reward?.status !== "ACKNOWLEDGED" || !["merch", "nft"].includes(reward.value?.prize?.type) ||
        reward.value.prize.type === "nft" && !b.wallet) throw Error();
      const result = await service.resultEffect(b.playerId, b.id, "CLAIM", async s => {
        const { default: claim } = await import("../prizes/claim");
        return run(claim, { claimId: `fwsolo-${s.id}`, playerId: s.playerId, prize: reward.value.prize,
          wallet: b.wallet, shipping: null, game: "faction-wars", rarity: s.state.rarity });
      });
      return res.json({ result, claimId: `fwsolo-${b.id}` });
    }
    if (b.operation === "START") {
      if (!fields(b, "operation,playerId,team,commandId,maximumDebit") || !learning ||
        !Array.isArray(b.team) || !Number.isSafeInteger(b.maximumDebit) || b.maximumDebit < 0) throw Error();
      const existing = await service.read(b.playerId);
      if (existing) return res.json({ connected: true, session: view(existing) });
      const keys = [process.env.RAAP_REBEL_SELECTION_KEY_HEX, process.env.RAAP_REBEL_HANDOFF_KEY_HEX];
      if (keys.some(key => !/^[0-9a-f]{64}$/.test(key ?? "")) || !process.env.RAAP_REBEL_ORIGIN) throw Error();
      connection = createPlaygroundPlayerConnection({ raapOrigin: process.env.RAAP_REBEL_ORIGIN, playgroundOrigin: settings.origin,
        validUntil: settings.validUntil, now, key: Buffer.from(keys[0]!, "hex"), handoffKey: Buffer.from(keys[1]!, "hex"), cookieKey: settings.key });
      const selection = await connection.authenticatePlayer(request, b.playerId);
      const value = await redis.get<string | Record<string, any>>("ra:config:economy");
      const saved = typeof value === "string" ? JSON.parse(value) : value ?? {};
      const configured = { ...defaults, ...saved, rewards: { ...defaults.rewards, ...saved.rewards } };
      const configuredSolo = soloConfig(configured);
      const date = new Date(now() * 1000).toISOString().slice(0, 10);
      const [spent, bank] = await Promise.all([redis.get<number>(`ra:points:spent:${b.playerId}:${date}`), redis.get<number>(`ra:points:capbank:${b.playerId}`)]);
      const room = Math.max(0, Number(configured.dailyEarnCap || 0) - Number(spent || 0)) + Number(bank || 0);
      if (!Number.isFinite(room) || room < configuredSolo.cost) return res.status(409).json({ error: "SOLO_NO_PLAYS_REMAINING" });
      if (await getREBELBalance(b.playerId) < b.maximumDebit) return res.status(409).json({ error: "SOLO_INSUFFICIENT_POINTS" });
      return res.json({ connected: true, session: view(await service.start({ ...b, config: configuredSolo, selection })) });
    }
    if (b.operation === "ABANDON") {
      if (!fields(b, "operation,playerId,id,revision") || !Number.isSafeInteger(b.revision)) throw Error();
      return res.json({ connected: !!learning, session: view(await service.abandon(b.playerId, b.id, b.revision)) });
    }
    if (b.operation === "ACT") {
      if (!fields(b, "operation,playerId,id,revision,commandId,maximumDebit,command") ||
        !Number.isSafeInteger(b.revision) || !Number.isSafeInteger(b.maximumDebit) || b.maximumDebit < 0 ||
        !b.command || typeof b.command !== "object" || Array.isArray(b.command) ||
        !(b.command.kind === "MOVE" && fields(b.command, "kind,moveId") && typeof b.command.moveId === "string" ||
          ["HEAL", "NEXT"].includes(b.command.kind) && fields(b.command, "kind"))) throw Error();
      return res.json({ connected: !!learning, session: view(await service.act(b)) });
    }
    throw Error();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const safe = ["SOLO_PRICE_CHANGED", "SOLO_SAVED_STATUS_REQUIRED", "SOLO_RECORD_LIMIT", "SOLO_COMMAND_UNAVAILABLE"];
    return res.status(409).json({ error: safe.includes(code) ? code : "SOLO_UNAVAILABLE" });
  } finally { connection?.close(); settings?.key.fill(0); }
}
