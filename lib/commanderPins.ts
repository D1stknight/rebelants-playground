// lib/commanderPins.ts
// Commander names claimed before PINs existed: the list kept only the name, so nothing proves who claimed
// one. Its first PIN is set by the Rebel Ants team after they check (admin page: Names without a PIN),
// never by whoever asks first (pages/api/commander/set-pin.ts, sign-in.ts).
export const NO_PIN_SUPPORT =
  "This name is from before PINs. To keep it safe, the Rebel Ants team sets its first PIN: ask us on Discord.";

// The home page's PIN button, shown for any name (it does not know whether this one has a PIN).
export const OLD_NAME_PIN_NOTE =
  "A name from before PINs (no PIN yet) gets its first PIN from the Rebel Ants team: ask us on Discord.";
