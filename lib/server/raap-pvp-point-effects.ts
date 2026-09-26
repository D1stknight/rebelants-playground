import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

type Direction = "DEBIT" | "CREDIT";
export interface PlaygroundPointEffect {
  schema: "rebel.playground.point-effect.v1";
  commandId: string;
  index: number;
  direction: Direction;
  playerId: string;
  amount: number;
}
export interface PlaygroundPointReceipt {
  effect: PlaygroundPointEffect;
  status: "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
  /** Balance reported by this particular response, not a current balance read. */
  balance: number | null;
}
interface Store {
  get<T>(key: string): Promise<T | null>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}
const digest = (value: unknown) => "0x" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const effectKey = (command: string, index: number) => `ra:raap:fwpvp:point:${command}:${index}`;
const deny = (): never => { throw Error("PLAYGROUND_POINT_OUTCOME_UNCONFIRMED"); };
function validate(effect: PlaygroundPointEffect) {
  if (effect.schema !== "rebel.playground.point-effect.v1" || !/^0x[0-9a-f]{64}$/.test(effect.commandId) ||
    !Number.isSafeInteger(effect.index) || effect.index < 0 ||
    !["DEBIT", "CREDIT"].includes(effect.direction) || !/^(wallet:0x[0-9a-f]{40}|discord:[0-9]{1,20}|name:[a-z0-9-]{3,32})$/.test(effect.playerId) ||
    !Number.isSafeInteger(effect.amount) || effect.amount <= 0) deny();
}
const CLAIM = `
local old = redis.call('GET', KEYS[1])
if old then return old end
redis.call('SET', KEYS[1], ARGV[1]); return 'CLAIMED'
`;
const ACKNOWLEDGE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2]); return 1
`;

/** A durable intent precedes each point request. A repeated call only reads its
 * record; it never resends, even if the process stopped before the network call.
 * No TTL: expiry of a match/credential cannot erase an unresolved payment.
 * This stores an API acknowledgement, not independent ledger settlement proof.
 * Dedicated game dispatch must supply its already-authorized exact command and
 * point limits. This helper creates neither player authority nor spend approval. */
export function createPlaygroundPointEffects(input: { store: Store; validUntil: number; now(): number }) {
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil <= 0) deny();
  function parse(value: unknown, effect: PlaygroundPointEffect): PlaygroundPointReceipt {
    const receipt = typeof value === "string" ? JSON.parse(value) : value;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
      Object.keys(receipt).sort().join() !== "balance,effect,status" ||
      JSON.stringify(receipt.effect) !== JSON.stringify(effect) ||
      receipt.status !== "ACKNOWLEDGED" && receipt.status !== "OUTCOME_UNKNOWN" ||
      receipt.status === "OUTCOME_UNKNOWN" && receipt.balance !== null ||
      receipt.status === "ACKNOWLEDGED" && (!Number.isSafeInteger(receipt.balance) || receipt.balance < 0)) deny();
    return receipt as PlaygroundPointReceipt;
  }
  return {
    async read(effect: PlaygroundPointEffect): Promise<PlaygroundPointReceipt | null> {
      validate(effect);
      const value = await input.store.get(effectKey(effect.commandId, effect.index));
      return value === null ? null : parse(value, effect);
    },
    async execute(effect: PlaygroundPointEffect, send: (idempotencyKey: string) => Promise<number | null>): Promise<PlaygroundPointReceipt> {
      effect = structuredClone(effect); validate(effect);
      if (input.now() >= input.validUntil) deny();
      const pending: PlaygroundPointReceipt = { effect, status: "OUTCOME_UNKNOWN", balance: null };
      const before = JSON.stringify(pending), key = effectKey(effect.commandId, effect.index);
      const claim = await input.store.eval(CLAIM, [key], [before]);
      if (claim !== "CLAIMED") return parse(claim, effect);
      // A lost claim response cannot authorize dispatch. A late claim remains
      // held, rather than silently becoming eligible for a new payment attempt.
      if (input.now() >= input.validUntil) return pending;
      let balance: number | null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        balance = await Promise.race([
          send("pg:raap:" + digest(effect).slice(2)),
          new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.min(10000, (input.validUntil - input.now()) * 1000)); }),
        ]);
      } catch { return pending; }
      finally { if (timer) clearTimeout(timer); }
      // A timeout does not cancel or prove absence of the external point move.
      // Late responses stay unknown here; never launch a replacement request.
      if (!Number.isSafeInteger(balance) || balance === null || balance < 0) return pending;
      const receipt: PlaygroundPointReceipt = { effect, status: "ACKNOWLEDGED", balance };
      try {
        const saved = await input.store.eval(ACKNOWLEDGE, [key], [before, JSON.stringify(receipt)]);
        if (saved === 1) return receipt;
      } catch { /* Outcome remains held until explicit readback. Never resend. */ }
      return pending;
    },
  };
}

interface Command {
  commandId: string;
  playerId: string;
  maximumDebit: number;
  effects: ReturnType<typeof createPlaygroundPointEffects>;
  beforeSend?: () => void;
  index: number;
  debited: number;
  uncertain: boolean;
}
const commands = new AsyncLocalStorage<Command>();

/** Internal dispatch integration, never called by ordinary human requests.
 * The original game handlers/calculations still run. Their shared payment
 * helpers use the durable effects below only inside this explicit scope. */
export async function withPlaygroundPointCommand<T>(input: Pick<Command, "commandId" | "playerId" | "maximumDebit" | "effects" | "beforeSend">,
  run: () => Promise<T>): Promise<T> {
  if (commands.getStore() || !/^0x[0-9a-f]{64}$/.test(input.commandId) ||
    !/^(wallet:0x[0-9a-f]{40}|discord:[0-9]{1,20})$/.test(input.playerId) ||
    !Number.isSafeInteger(input.maximumDebit) || input.maximumDebit < 0) deny();
  return commands.run({ ...input, index: 0, debited: 0, uncertain: false }, async () => {
    const result = await run();
    assertPlaygroundPointsConfirmed();
    return result;
  });
}

export function assertPlaygroundPointsConfirmed() {
  if (commands.getStore()?.uncertain) deny();
}

/** Undefined means preserve the original helper unchanged. The callback uses
 * its original Economy connection, with an exact stable key instead of time. */
export function scopedPlaygroundPointEffect(direction: Direction, playerId: string, amount: number,
  send: (idempotencyKey: string) => Promise<number | null>): Promise<number | null> | undefined {
  const command = commands.getStore();
  if (!command) return;
  return (async () => {
    try {
      command.beforeSend?.();
      if (command.uncertain) deny();
      if (direction === "DEBIT") {
        if (playerId !== command.playerId || !Number.isSafeInteger(amount) || amount <= 0 ||
          command.debited + amount > command.maximumDebit) deny();
        command.debited += amount;
      }
      const result = await command.effects.execute({ schema: "rebel.playground.point-effect.v1", commandId: command.commandId,
        index: command.index++, direction, playerId, amount }, send);
      if (result.status !== "ACKNOWLEDGED") deny();
      return result.balance;
    } catch {
      command.uncertain = true;
      return null;
    }
  })();
}
