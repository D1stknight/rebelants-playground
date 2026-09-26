import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {FACTIONS, TEAM_SIZE} from "../factionWarsCore";
import type {PvpMatch} from "../types/fwpvp";
import { applyPvpTeam, quotePvpHeal, type PvpHealRules } from "./fwpvp-rules";

function deny(): never {throw Error("PLAYGROUND_RAAP_UNAVAILABLE");}
function exact(v: any, keys: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join("|") !== [...keys].sort().join("|")) deny();
}
function canonical(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  return Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
const digest = (v: unknown) => "0x" + createHash("sha256").update(canonical(v)).digest("hex");
const integer = (v: unknown, max=Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > max) deny(); return Number(v);
};
const hash = (v: unknown) => {if(typeof v !== "string" || !/^0x[0-9a-f]{64}$/.test(v)) deny();};
const address = (v: unknown) => {if(typeof v !== "string" || !/^0x[0-9a-f]{40}$/.test(v)) deny();};

/** Dedicated read connection. The RAAP worker verifies owner signature, current
 * controller/epoch and Life before authenticating this exact request. A wallet
 * player is derived from that verified controller, never a caller playerId or
 * the unsigned Discord cookie. No identity linking, economy call or writes.
 * This deliberately exposes no MOVE route until durable effects are wired. */
export function createPlaygroundRaapHandler(input: {
  key: Uint8Array; collection: string; expiresAt: number; now(): number;
  match(id: string): Promise<PvpMatch | null>;
  healConfig?(): Promise<PvpHealRules>;
}) {
  const p = {...input, key: Buffer.from(input.key)};
  if(p.key.length !== 32 || !p.key.some(v => v !== 0)) deny(); address(p.collection); integer(p.expiresAt);
  return async (http: Request): Promise<Response> => {
    const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {status,
      headers:{"content-type":"application/json", "cache-control":"no-store", "x-content-type-options":"nosniff"}});
    try {
      if(http.method !== "POST" || http.headers.get("content-type") !== "application/json" || http.headers.has("cookie") ||
        http.headers.has("origin") || http.headers.has("content-encoding") || new URL(http.url).search || !http.body || p.now() >= p.expiresAt) deny();
      const reader=http.body!.getReader(), chunks:Uint8Array[]=[]; let size=0;
      try {for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096){await reader.cancel();deny();}chunks.push(r.value);}}
      finally{reader.releaseLock();}
      const bytes=Buffer.concat(chunks), signature=http.headers.get("x-raap-auth") ?? "";
      if(!/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature,"hex"),createHmac("sha256",p.key).update(bytes).digest())) deny();
      const r=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
      const quote = r.operation === "QUOTE";
      exact(r,["schema","operation","asset","controller","epoch","account","contextCommitment","challengeId","issuedAt","validUntil",...(quote ? ["action"] : [])]);
      exact(r.asset,["chainId","collection","tokenId"]);
      if(r.schema!=="playground.raap.request.v1" || !["OBSERVE","QUOTE"].includes(r.operation) || r.asset.chainId!==1 || r.asset.collection!==p.collection ||
        typeof r.asset.tokenId!=="string" || !/^(0|[1-9][0-9]{0,77})$/.test(r.asset.tokenId) ||
        typeof r.challengeId!=="string" || !/^[a-z0-9]{12}$/.test(r.challengeId)) deny();
      address(r.controller);address(r.account);hash(r.contextCommitment);integer(r.epoch);integer(r.issuedAt);integer(r.validUntil);
      const now=p.now();if(r.epoch<1 || r.issuedAt>now || now>=r.validUntil || r.validUntil-r.issuedAt>30000 || r.validUntil>p.expiresAt) deny();
      const m=await p.match(r.challengeId), player="wallet:"+r.controller;
      if(!m || m.challengeId!==r.challengeId || Buffer.byteLength(canonical(m))>262144) deny();
      const sides=(["challenger","opponent"] as const).filter(side=>m![side+"PlayerId" as "challengerPlayerId"|"opponentPlayerId"]===player);
      if(sides.length!==1) deny(); const yourSide=sides[0]!;
      if(!["pending","team_selection","active","completed","cancelled"].includes(m!.status)) deny();
      const team=(value:unknown) => {
        if(!Array.isArray(value) || value.length>TEAM_SIZE || new Set(value).size!==value.length || value.some(f=>typeof f!=="string" || !Object.hasOwn(FACTIONS,f))) deny();
        return [...value] as Array<keyof typeof FACTIONS>;
      };
      const challengerTeam=team(m!.challengerTeam), opponentTeam=team(m!.opponentTeam);
      const ownTeam=yourSide==="challenger"?challengerTeam:opponentTeam;
      const ownIndex=integer(yourSide==="challenger"?m!.challengerCurrentFactionIndex:m!.opponentCurrentFactionIndex,5);
      const isYourTurn=m!.status==="active" && m!.currentTurnPlayerId===player && m!.currentTurnSide===yourSide;
      const view={challengeId:r.challengeId,status:m!.status,yourSide,currentTurnSide:m!.currentTurnSide,
        currentTerritory:integer(m!.currentTerritory,5),challengerTeam,opponentTeam,
        challengerHp:integer(m!.challengerHp,100),opponentHp:integer(m!.opponentHp,100),
        challengerCurrentFactionIndex:integer(m!.challengerCurrentFactionIndex,5),opponentCurrentFactionIndex:integer(m!.opponentCurrentFactionIndex,5),
        challengerTerritoriesWon:integer(m!.challengerTerritoriesWon,5),opponentTerritoriesWon:integer(m!.opponentTerritoriesWon,5),
        challengerHealsUsed:integer(m!.challengerHealsUsed??0),opponentHealsUsed:integer(m!.opponentHealsUsed??0),
        activeSpell:!!(m!.spellChallengerActive || m!.spellOpponentActive),updatedAt:integer(m!.updatedAt),
        moves:isYourTurn && ownTeam[ownIndex]?FACTIONS[ownTeam[ownIndex]!].moves.map(move=>({id:move.id,label:move.label,type:move.type})):[],
        factions:Object.values(FACTIONS).map(f=>({id:f.id,name:f.name})),
        canSelectTeam:m!.status==="team_selection" || m!.status==="pending" && yourSide==="challenger"};
      if (quote) {
        const action = r.action;
        exact(action, action?.kind === "SELECT_TEAM" ? ["kind", "team"] : action?.kind === "MOVE" ? ["kind", "moveId"] : ["kind"]);
        let maximumAdditionalPoints = 0, configurationCommitment: string | null = null;
        if (action.kind === "SELECT_TEAM") {
          if (canonical(team(action.team)) !== canonical(action.team)) deny();
          applyPvpTeam(m, player, action.team, now);
        } else if (action.kind === "MOVE") {
          if (!isYourTurn || !view.moves.some(move => move.id === action.moveId)) deny();
        } else if (action.kind === "HEAL" && p.healConfig) {
          const config = await p.healConfig();
          exact(config, ["factionWarsHealCost", "factionWarsHealAmt", "factionWarsHealMax"]);
          for (const amount of Object.values(config)) integer(amount);
          maximumAdditionalPoints = quotePvpHeal(m, player, config).cost;
          configurationCommitment = digest(config);
        } else deny();
        if (p.now() >= r.validUntil || p.now() >= p.expiresAt) deny();
        return response(200, { schema: "playground.raap.action-quote.v1", contextCommitment: r.contextCommitment,
          challengeId: r.challengeId, stateCommitment: digest(m), configurationCommitment, action,
          maximumAdditionalPoints, validUntil: r.validUntil, executionAllowed: false });
      }
      if(p.now()>=r.validUntil || p.now()>=p.expiresAt) deny();
      return response(200,{schema:"playground.raap.observation.v1",contextCommitment:r.contextCommitment,
        stateCommitment:digest(m),stateKind:"PERSISTED_SNAPSHOT",match:view,observedAt:p.now(),actionAllowed:false});
    } catch {return response(403,{error:"PLAYGROUND_RAAP_UNAVAILABLE"});}
  };
}
