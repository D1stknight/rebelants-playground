// GET /api/admin/chat — PvP match chat for the Rebel Console (admin only).
//   no id: the rooms with messages (newest activity first) + what the language filter did lately
//   ?id=<challengeId>: that room's messages and who is muted in it
// Deleting, muting, unmuting and clearing use the existing /api/faction-wars/pvp/chat/* admin routes.
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { isAdminRequest } from "../../../lib/server/player-auth";
import { getChatMessages, getMatch, listMutes } from "../../../lib/server/fwpvp";
import { readModLog } from "../../../lib/server/chat-filter";

const ROOM = /^ra:fwpvp:chat:([A-Za-z0-9_-]{4,64})$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAdminRequest(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const id = String(req.query.id || "").trim().slice(0, 64);
    if (id) {
      const [messages, mutes, match] = await Promise.all([getChatMessages(id), listMutes(id), getMatch(id)]);
      return res.status(200).json({ ok: true, id, messages, mutes, match: match ? { status: match.status, challenger: match.challengerDisplayName, opponent: match.opponentDisplayName } : null });
    }
    const ids: string[] = [];
    let cursor = "0";
    let rounds = 0;
    do {
      const page: any = await redis.scan(cursor, { match: "ra:fwpvp:chat:*", count: 500 });
      cursor = String(page[0]);
      for (const k of page[1] as string[]) { const m = ROOM.exec(String(k)); if (m) ids.push(m[1]); }
      rounds++;
    } while (cursor !== "0" && rounds < 20 && ids.length < 200);
    const rooms = await Promise.all(ids.slice(0, 60).map(async (cid) => {
      const [last, n, mutes, match] = await Promise.all([
        getChatMessages(cid, 1),
        redis.llen(`ra:fwpvp:chat:${cid}`).catch(() => 0),
        listMutes(cid),
        getMatch(cid).catch(() => null),
      ]);
      const l = last[last.length - 1];
      return { id: cid, count: Number(n) || 0, lastAt: l?.at || 0, last: l ? { name: l.displayName, text: l.text } : null, muted: mutes.length,
        match: match ? { status: match.status, challenger: match.challengerDisplayName, opponent: match.opponentDisplayName } : null };
    }));
    rooms.sort((a, b) => b.lastAt - a.lastAt);
    return res.status(200).json({ ok: true, rooms, log: await readModLog(100) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
