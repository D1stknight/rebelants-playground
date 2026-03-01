// lib/profile.ts
export type Profile = {
  id: string;      // stable guest id fallback (guest-xxxxx)
  name: string;    // display name

  // ✅ future identity (optional)
  walletAddress?: string;     // lowercase
  discordUserId?: string;     // stable unique id from Discord
  discordName?: string;       // display name from Discord
};

const KEY = "ra_profile_v1";

function randomId() {
  return `guest-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeWallet(w?: string) {
  const s = String(w || "").trim().toLowerCase();
  // keep it simple: store if it looks like 0x...
  if (!s) return undefined;
  if (!s.startsWith("0x")) return undefined;
  if (s.length < 10) return undefined;
  return s;
}

export function loadProfile(): Profile {
  if (typeof window === "undefined") return { id: "guest-ssr", name: "guest" };

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Profile>;
      // ✅ ensure required fields exist
      const id = String(parsed.id || "").trim() || randomId();
      const name = String(parsed.name || "").trim() || "guest";

      return {
        id,
        name,
        walletAddress: normalizeWallet(parsed.walletAddress),
        discordUserId: parsed.discordUserId ? String(parsed.discordUserId) : undefined,
        discordName: parsed.discordName ? String(parsed.discordName) : undefined,
      };
    }
  } catch {}

  const p: Profile = { id: randomId(), name: "guest" };
  localStorage.setItem(KEY, JSON.stringify(p));
  return p;
}

export function saveProfile(next: Partial<Profile>) {
  if (typeof window === "undefined") return;
  const cur = loadProfile();

  const merged: Profile = {
    ...cur,
    ...next,
    walletAddress: normalizeWallet(next.walletAddress ?? cur.walletAddress),
    discordUserId: next.discordUserId ?? cur.discordUserId,
    discordName: next.discordName ?? cur.discordName,
  };

  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

/**
 * ✅ SINGLE SOURCE OF TRUTH:
 * The app should use this as playerId going forward.
 * Priority: Discord > Wallet > Guest
 */
export function getEffectivePlayerId(p?: Profile) {
  const prof = p || loadProfile();
  const discordId = String(prof.discordUserId || "").trim();
  if (discordId) return `discord:${discordId}`;

  const w = normalizeWallet(prof.walletAddress);
  if (w) return `wallet:${w}`;

  return prof.id || "guest";
}
