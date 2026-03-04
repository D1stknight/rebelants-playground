// lib/profile.ts
export type Profile = {
  id: string;      // stable guest id fallback (guest-xxxxx)
  name: string;    // display name

  walletAddress?: string;     // lowercase
  discordUserId?: string;
  discordName?: string;

  // ✅ NEW: once linked, this becomes permanent identity
  primaryId?: string;         // "wallet:0x..." or later "discord:123"

  // ✅ NEW: if user clicks Disconnect, block auto-relink on refresh
  discordSkipLink?: boolean;
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
  primaryId: parsed.primaryId ? String(parsed.primaryId) : undefined,
  discordSkipLink: !!(parsed as any).discordSkipLink,
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

    walletAddress: normalizeWallet(
      ("walletAddress" in next ? next.walletAddress : cur.walletAddress) as any
    ),

    // ✅ IMPORTANT: allow clearing by passing undefined
    discordUserId: ("discordUserId" in next) ? (next.discordUserId as any) : cur.discordUserId,
    discordName: ("discordName" in next) ? (next.discordName as any) : cur.discordName,
    primaryId: ("primaryId" in next) ? (next.primaryId as any) : cur.primaryId,
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

  // ✅ If linked, always use primaryId
  const primary = String(prof.primaryId || "").trim();
  if (primary) return primary;

  // Before linking:
  const discordId = String(prof.discordUserId || "").trim();
  if (discordId) return `discord:${discordId}`;

  const w = normalizeWallet(prof.walletAddress);
  if (w) return `wallet:${w}`;

  return prof.id || "guest";
}
