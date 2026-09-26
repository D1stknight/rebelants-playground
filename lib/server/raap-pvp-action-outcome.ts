import { AsyncLocalStorage } from "node:async_hooks";

const outcomes = new AsyncLocalStorage<{ uncertain: boolean }>();
function denied(): never { throw Error("PLAYGROUND_ACTION_OUTCOME_UNCONFIRMED"); }
export function assertPlaygroundActionConfirmed() { if (outcomes.getStore()?.uncertain) denied(); }
/** Original handlers intentionally swallow optional bookkeeping errors. Inside
 * an exact RAAP command those errors must instead retain its pending receipt.
 * The whole durable command precedes this scope; no helper is retried here. */
export async function withPlaygroundActionOutcome<T>(run: () => Promise<T>): Promise<T> {
  if (outcomes.getStore()) denied();
  return outcomes.run({ uncertain: false }, async () => { const result = await run(); assertPlaygroundActionConfirmed(); return result; });
}
/** Only the existing game module's Redis calls are observed. Command/point
 * journals use the original client, avoiding recursive receipt writes. Outside
 * an explicit RAAP action, receiver, arguments and original result are unchanged.
 * Reads are also guarded: a failed bet/tournament read cannot masquerade as empty.
 * The command stays pending if a write's acknowledgement is lost. */
export function playgroundActionStore<T extends object>(store: T): T {
  return new Proxy(store, { get(target, property) {
    const member = Reflect.get(target,property,target);
    if (typeof member !== "function") return member;
    return (...args: unknown[]) => {
      const scope = outcomes.getStore();
      if (!scope) return Reflect.apply(member,target,args);
      assertPlaygroundActionConfirmed();
      try {
        return Promise.resolve(Reflect.apply(member,target,args)).catch(error => { scope.uncertain=true; throw error; });
      } catch (error) { scope.uncertain=true; throw error; }
    };
  } });
}
