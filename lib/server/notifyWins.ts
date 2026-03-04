// lib/server/notifyWins.ts
import { redis } from "./redis";

type WinEvent = {
  id: string;
  ts: number;
  game: string;
  playerId: string;
  playerName: string;
  rarity: string;
  pointsAwarded: number;
  prize?: any;
};

const NOTIFY_KEY_PREFIX = "ra:notify:win:";

function shouldNotify(evt: WinEvent) {
  const rarity = String(evt.rarity || "").toLowerCase();
  const isUltra = rarity === "ultra";

  const prizeType = String(evt?.prize?.type || "").toLowerCase();
  const hasRealPrize = prizeType === "merch" || prizeType === "nft" || prizeType === "ape";

  // ✅ Rule Set 1:
  // Notify if ULTRA OR real prize exists.
  // Do NOT notify for normal (non-ultra) points-only wins.
  return isUltra || hasRealPrize;
}

function formatLine(evt: WinEvent) {
  const rarity = String(evt.rarity || "none").toUpperCase();
  const name = String(evt.playerName || "guest");
  const game = String(evt.game || "shuffle");

  const prizeLabel =
    evt?.prize?.label
      ? String(evt.prize.label)
      : evt.pointsAwarded > 0
      ? `+${evt.pointsAwarded} REBEL`
      : "—";

  return { rarity, name, game, prizeLabel };
}

async function notifyDiscord(evt: WinEvent) {
  const url = process.env.DISCORD_WIN_WEBHOOK_URL;
  if (!url) return;

  const { rarity, name, game, prizeLabel } = formatLine(evt);

  const text =
    `🎉 WIN ALERT!\n` +
    `• Player: **${name}**\n` +
    `• Game: **${game}**\n` +
    `• Rarity: **${rarity}**\n` +
    `• Prize: **${prizeLabel}**\n` +
    `• Id: \`${evt.id}\``;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  }).catch(() => {});
}

async function notifyEmail(evt: WinEvent) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.WIN_NOTIFY_EMAIL_TO;
  const from = process.env.WIN_NOTIFY_EMAIL_FROM;

  if (!key || !to || !from) return;

  const { rarity, name, game, prizeLabel } = formatLine(evt);

  const subject = `Rebel Ants WIN: ${rarity} • ${name} • ${prizeLabel}`;

  const html = `
    <div style="font-family: ui-sans-serif, system-ui; line-height: 1.4">
      <h2>🎉 Win Alert</h2>
      <p><b>Player:</b> ${name}</p>
      <p><b>Game:</b> ${game}</p>
      <p><b>Rarity:</b> ${rarity}</p>
      <p><b>Prize:</b> ${prizeLabel}</p>
      <p style="color:#666"><b>Event Id:</b> ${evt.id}</p>
      <p style="color:#666"><b>Player Id:</b> ${evt.playerId}</p>
      <p style="color:#666"><b>Timestamp:</b> ${new Date(evt.ts).toISOString()}</p>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
    }),
  }).catch(() => {});
}

async function markNotifiedOnce(evtId: string) {
  const key = `${NOTIFY_KEY_PREFIX}${evtId}`;
  try {
    // Try to set "only if not exists" with TTL (7 days).
    // If Upstash options differ, we fallback below.
    // @ts-ignore
    const ok = await redis.set(key, "1", { nx: true, ex: 60 * 60 * 24 * 7 });
    if (ok) return true;
  } catch {}

  // Fallback: read-then-set (not perfect, but prevents most duplicates)
  try {
    const exists = await redis.get(key);
    if (exists) return false;
    await redis.set(key, "1");
    return true;
  } catch {
    return true; // if Redis fails, don't block notifying
  }
}

export async function notifyWinIfNeeded(evt: WinEvent) {
  if (!evt?.id) return;
  if (!shouldNotify(evt)) return;

  const firstTime = await markNotifiedOnce(evt.id);
  if (!firstTime) return;

  await Promise.all([notifyDiscord(evt), notifyEmail(evt)]);
}
