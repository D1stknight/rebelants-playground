// pages/api/admin/inventory.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const KEY_MERCH = "ra:inv:merch_v1";
const KEY_APE = "ra:inv:ape_v1";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAuthed(req: NextApiRequest) {
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";

  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  if (!expected) return false;
  return !!provided && provided === expected;
}

function safeJsonParse(raw: any) {
  try {
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method === "GET") {
      const [merchRaw, apeRaw] = await Promise.all([redis.get(KEY_MERCH), redis.get(KEY_APE)]);

      const merch = safeJsonParse(merchRaw) ?? [];
      const ape = safeJsonParse(apeRaw) ?? { dailyMaxApe: 0, usedTodayApe: 0, note: "" };

      const merchArr = Array.isArray(merch) ? merch : [];
      const totalMerchSkus = merchArr.length;
      const totalMerchOnHand = merchArr.reduce((sum, x: any) => sum + Number(x?.onHand || 0), 0);

      return res.status(200).json({
        ok: true,
        merch: merchArr,
        ape,
        summary: {
          merchSkus: totalMerchSkus,
          merchOnHand: totalMerchOnHand,
        },
        keys: { merch: KEY_MERCH, ape: KEY_APE },
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
      const merch = Array.isArray(body?.merch) ? body.merch : [];
      const ape = body?.ape && typeof body.ape === "object" ? body.ape : { dailyMaxApe: 0, usedTodayApe: 0, note: "" };

      // light normalization
      const merchClean = merch.map((x: any) => ({
        sku: String(x?.sku || "").trim().slice(0, 64),
        label: String(x?.label || "").trim().slice(0, 128),
        onHand: Number.isFinite(Number(x?.onHand)) ? Number(x.onHand) : 0,
      })).filter((x: any) => x.sku);

      const apeClean = {
        dailyMaxApe: Number.isFinite(Number(ape?.dailyMaxApe)) ? Number(ape.dailyMaxApe) : 0,
        usedTodayApe: Number.isFinite(Number(ape?.usedTodayApe)) ? Number(ape.usedTodayApe) : 0,
        note: String(ape?.note || "").trim().slice(0, 256),
      };

      await Promise.all([
        redis.set(KEY_MERCH, JSON.stringify(merchClean)),
        redis.set(KEY_APE, JSON.stringify(apeClean)),
      ]);

      return res.status(200).json({ ok: true, merch: merchClean, ape: apeClean });
    }

    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    console.error("admin/inventory error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
