// The Playground's day runs on Eastern time (America/New_York), like the Rebel Console (Oct 28, 2026).
// Daily claim, daily play room, game daily caps, PvP crate caps, the Royal Egg and "today" all reset at
// midnight ET. (Before Oct 28 they reset at midnight UTC, 8 pm ET.)
const TZ = "America/New_York";
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const HMS = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });

/** Today's date in Eastern time, "YYYY-MM-DD". */
export const etDay = (t: number = Date.now()): string => DAY.format(new Date(t));

/** The next midnight in Eastern time. */
export function nextEtMidnight(now: number = Date.now()): Date {
  const p = Object.fromEntries(HMS.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const passed = (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 + (now % 1000);
  let t = now - passed + 24 * 3600 * 1000;
  // daylight-saving days are 23 or 25 hours long: step to the real midnight
  for (let i = 0; i < 3 && etDay(t) === etDay(now); i++) t += 3600 * 1000;
  for (let i = 0; i < 3 && etDay(t - 3600 * 1000) !== etDay(now); i++) t -= 3600 * 1000;
  return new Date(t);
}
