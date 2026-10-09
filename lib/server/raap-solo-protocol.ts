import { createHash } from "node:crypto";
import type { SoloCommand } from "../factionWarsSoloCampaign";
import type { SoloSession } from "./raap-fwsolo";

export const soloCanonical = (v: any): string => v === null || typeof v !== "object" ? JSON.stringify(v) :
  Array.isArray(v) ? "[" + v.map(soloCanonical).join(",") + "]" :
    "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + soloCanonical(v[k])).join(",") + "}";
export const soloDigest = (v: unknown) => "0x" + createHash("sha256").update(soloCanonical(v)).digest("hex");
export const soloCommandKey = (id: string) => `ra:raap:fwsolo:command:${id}`;
export interface SoloReviewedCommand {
  schema: "playground.raap.solo-action.v1"; operation: "EXECUTE"; commandId: string;
  asset: { chainId: 1; collection: string; tokenId: string };
  controller: string; epoch: number; account: string; contextCommitment: string;
  challengeId: string; revision: number; stateCommitment: string; configurationCommitment: string;
  action: SoloCommand; maximumAdditionalPoints: number; issuedAt: number; validUntil: number;
}
export interface SoloActionReceipt {
  schema: "playground.raap.solo-receipt.v1"; commandId: string; requestCommitment: string;
  challengeId: string; before: string; after: string | null;
  status: "APPLIED" | "DECLINED" | "OUTCOME_UNKNOWN"; additionalPoints: number | null; committedAt: number | null;
}
export interface SoloActionRecord { request: SoloReviewedCommand; receipt: SoloActionReceipt }
export function soloActionRecord(request: SoloReviewedCommand, after?: SoloSession, at?: number): SoloActionRecord {
  return { request: structuredClone(request), receipt: {
    schema: "playground.raap.solo-receipt.v1", commandId: request.commandId, requestCommitment: soloDigest(request),
    challengeId: request.challengeId, before: request.stateCommitment,
    after: after ? soloDigest(after) : null, status: after ? "APPLIED" : "OUTCOME_UNKNOWN",
    additionalPoints: after ? request.maximumAdditionalPoints : null, committedAt: after ? at! : null,
  } };
}
export function parseSoloActionRecord(value: unknown): SoloActionRecord {
  const r = typeof value === "string" ? JSON.parse(value) : value as SoloActionRecord;
  if (!r || r.request?.schema !== "playground.raap.solo-action.v1" || r.receipt?.schema !== "playground.raap.solo-receipt.v1" ||
    r.receipt.commandId !== r.request.commandId || r.receipt.requestCommitment !== soloDigest(r.request) ||
    r.receipt.before !== r.request.stateCommitment || r.receipt.challengeId !== r.request.challengeId ||
    !["APPLIED", "DECLINED", "OUTCOME_UNKNOWN"].includes(r.receipt.status)) throw Error("SOLO_SAVED_STATUS_REQUIRED");
  return r;
}
