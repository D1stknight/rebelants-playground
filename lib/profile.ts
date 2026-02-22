// lib/profile.ts
export type Profile = {
  id: string;      // stable id
  name: string;    // display name
};

const KEY = "ra_profile_v1";

function randomId() {
  return `guest-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadProfile(): Profile {
  if (typeof window === "undefined") return { id: "guest-ssr", name: "guest" };

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {}

  const p = { id: randomId(), name: "guest" };
  localStorage.setItem(KEY, JSON.stringify(p));
  return p;
}

export function saveProfile(next: Partial<Profile>) {
  if (typeof window === "undefined") return;
  const cur = loadProfile();
  const merged = { ...cur, ...next };
  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}
