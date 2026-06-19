// pages/api/admin/export-balances.ts
//
// READ-ONLY. Exports the frozen pre-reroute Playground balances
// (ra:points:bal:<playerId>) as migration records for the central economy.
//
// These balances stopped changing when points/spend/earn/PvP were rerouted
// to the economy ledger, so this is a one-time snapshot to backfill into the
// economy via its existing importLegacyBatch (idempotent + audited there).
//
// playerId formats and how the economy will match them:
//   discord:<id>   -> economy User.discordId = <id>
//   name:<slug>    -> economy User.discordId = "name:<slug>" (name-auth synthetic id)
//   wallet:0x...   -> economy Wallet.address = 0x...
//   guest-*        -> skipped (no durable economy identity)
//
// Auth: same admin gate as the other admin routes (x-admin-key / x-admin-token).

import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function headerValue(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

function isAdmin(req: NextApiRequest) {
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";
  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  if (!expected) return false;
  return !!provided && provided === expected;
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

type Kind = "discord" | "name" | "wallet" | "guest" | "unknown";
function classify(playerId: string): Kind {
  if (playerId.startsWith("discord:")) return "discord";
  if (playerId.startsWith("name:")) return "name";
  if (playerId.startsWith("wallet:")) return "wallet";
  if (playerId.startsWith("guest-") || playerId.startsWith("guest:")) return "guest";
  return "unknown";
}

type ExportRecord = {
  playerId: string;
  kind: Kind;
  balance: number;
  // economy-facing identity hints (what importLegacyBatch will match on):
  discordId: string | null; // raw discord id, OR "name:<slug>" for name users
  wallet: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // 1) Collect every known playerId from the two name registries (Redis hashes).
    const ids = new Set<string>();
    for (const regKey of ["ra:player_names_v1", "ra:fw:pvp_player_names"]) {
      try {
        const h = (await redis.hgetall(regKey)) as Record<string, unknown> | null;
        if (h) for (const k of Object.keys(h)) ids.add(k);
      } catch {
        /* registry missing -> skip */
      }
    }

    // 2) Read each balance. Only keep nonzero balances.
    const records: ExportRecord[] = [];
    const counts: Record<Kind, number> = { discord: 0, name: 0, wallet: 0, guest: 0, unknown: 0 };
    const totals: Record<Kind, number> = { discord: 0, name: 0, wallet: 0, guest: 0, unknown: 0 };
    let scanned = 0;
    let withBalance = 0;

    for (const playerId of ids) {
      scanned++;
      let raw: unknown = null;
      try {
        raw = await redis.get<number>(balKey(playerId));
      } catch {
        raw = null;
      }
      const balance = Number(raw || 0);
      const kind = classify(playerId);
      if (balance > 0) {
        withBalance++;
        counts[kind]++;
        totals[kind] += balance;
        const discordId =
          kind === "discord"
            ? playerId.slice("discord:".length)
            : kind === "name"
            ? playerId // keep the full "name:<slug>" as the economy discordId
            : null;
        const wallet = kind === "wallet" ? playerId.slice("wallet:".length) : null;
        records.push({ playerId, kind, balance, discordId, wallet });
      }
    }

    // 3) Migratable = discord + name + wallet (guests/unknown are excluded).
    const migratable = records.filter(
      (r) => r.kind === "discord" || r.kind === "name" || r.kind === "wallet",
    );
    const migratableTotal = migratable.reduce((a, r) => a + r.balance, 0);

    return res.status(200).json({
      ok: true,
      summary: {
        scanned,
        withBalance,
        counts,
        totals,
        migratableCount: migratable.length,
        migratableTotal,
      },
      // Full list for review + feeding the economy import. Guests/unknown are
      // included in `records` for transparency but NOT in `migratable`.
      migratable,
      records,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
