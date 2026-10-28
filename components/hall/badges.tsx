// Hall of Badges panel (the Hall shows it as a tab). The Playground badge case: every Playground badge, the earned ones lit, the rest locked with how
// far along you are. Secret badges stay hidden until found. Badges live on the player's Rebel
// Economy account, so the Badge Wall (every app, shareable) is one tap away.
import { useEffect, useMemo, useState } from "react";
import { COLOR, Medal, playerId } from "../BadgeToast";

type Cat = { id: string; family: string; familyName: string; name: string; tier: string; rule: string; hidden: boolean };
type Earned = { id: string; name: string; tier: string; rule: string; earnedAt: string; percent: number; nft: { tokenId?: string } | null };
type Data = { ok: boolean; userId: string; badges: Earned[]; catalog: Cat[]; toGo: Record<string, [number, number]> };

const LABEL: Record<string, string> = { common: "Bronze", rare: "Silver", epic: "Neon", legendary: "Gold", mythic: "Mythic", secret: "Obsidian" };
const ORDER = ["mythic", "legendary", "secret", "epic", "rare", "common"];
const ECONOMY = "https://economy.rebelants.io";

export function BadgesPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"load" | "signin" | "error" | "ok">("load");
  const [open, setOpen] = useState<Cat | null>(null);
  const [only, setOnly] = useState<"all" | "earned" | "close">("all");

  useEffect(() => {
    const pid = playerId();
    if (!pid || pid.startsWith("guest")) { setState("signin"); return; }
    fetch("/api/badges/me?playerId=" + encodeURIComponent(pid), { cache: "no-store" }).then(async (r) => {
      if (r.status === 401) { setState("signin"); return; }
      const j = await r.json();
      if (!j.ok) { setState("error"); return; }
      setData(j); setState("ok");
    }).catch(() => setState("error"));
  }, []);

  // the economy returns every app's badges; this case shows the Playground's (the wall shows all)
  const mine = useMemo(() => (data?.badges || []).filter((b) => b.id.startsWith("playground:")), [data]);
  const earned = useMemo(() => new Map(mine.map((b) => [b.id, b])), [mine]);
  const families = useMemo(() => {
    const m = new Map<string, { name: string; list: Cat[] }>();
    for (const b of data?.catalog || []) {
      const has = earned.has(b.id);
      const tg = data?.toGo[b.id];
      if (only === "earned" && !has) continue;
      if (only === "close" && (has || !tg || tg[0] / tg[1] < 0.5)) continue;
      if (!m.has(b.family)) m.set(b.family, { name: b.familyName, list: [] });
      m.get(b.family)!.list.push(b);
    }
    return Array.from(m.values());
  }, [data, earned, only]);

  const total = data?.catalog?.length || 0;
  const tiers = ORDER.map((t) => ({ t, n: mine.filter((b) => b.tier === t).length, all: (data?.catalog || []).filter((b) => b.tier === t).length }));
  const e = open ? earned.get(open.id) : null;
  const tg = open ? data?.toGo[open.id] : null;
  const wall = ECONOMY + "/badges" + (data?.userId ? "/" + encodeURIComponent(data.userId) : "") + "?from=playground";

  return (
    <div className="pb hall-panel">
      <style>{CSS}</style>

      {state === "load" && <p className="pb-note">Opening the badge case…</p>}
      {state === "error" && <p className="pb-note">The badge case could not open. Try again in a moment.</p>}
      {state === "signin" && <p className="pb-note">Sign in on the <a href="/">Playground</a> (Discord or name + PIN) to see your badges.</p>}
      {state === "ok" && data && (
        <>
          <div className="pb-count">{mine.length} of {total} Playground badges</div>
          <div className="pb-tiers">
            {tiers.map(({ t, n, all }) => (
              <div key={t} className="pb-tier" style={{ ["--tc" as any]: COLOR[t] }}><b>{n}<small>/{all}</small></b><span>{LABEL[t]}</span></div>
            ))}
          </div>
          <div className="pb-filter" role="tablist" aria-label="Show">
            {([["all", "ALL"], ["earned", "EARNED"], ["close", "ALMOST THERE"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={only === k} className={"pb-f" + (only === k ? " pb-on" : "")} onClick={() => setOnly(k)}>{l}</button>
            ))}
          </div>
          {families.length === 0 && <p className="pb-note">{only === "earned" ? "No badges yet. Every Playground game has them: go play." : "Nothing close yet. Keep playing."}</p>}
          {families.map((f) => (
            <section key={f.name} className="pb-fam">
              <div className="pb-fam-h"><span>{f.name.toUpperCase()}</span><small>{f.list.filter((b) => earned.has(b.id)).length} of {f.list.length}</small></div>
              <div className="pb-grid">
                {f.list.map((b) => {
                  const has = earned.has(b.id);
                  const p = data.toGo[b.id];
                  return (
                    <button key={b.id} type="button" className={"pb-b" + (has ? " pb-b-on" : "")} onClick={() => setOpen(b)} aria-label={(has ? "" : "Locked: ") + b.name}>
                      <Medal b={b} size={56} earned={has} />
                      <span className="pb-b-name">{b.name}</span>
                      {!has && p && p[0] > 0 && <span className="pb-bar" aria-hidden="true"><i style={{ width: Math.round((p[0] / p[1]) * 100) + "%" }} /></span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <a className="pb-wall" href={wall}>See every app on your Badge Wall →</a>
        </>
      )}

      {open && (
        <div className="pb-sheet-wrap" role="dialog" aria-label="Badge">
          <button type="button" className="pb-scrim" aria-label="Close" onClick={() => setOpen(null)} />
          <div className="pb-sheet">
            <Medal b={open} size={130} earned={!!e} />
            <div className="pb-sheet-tier" style={{ color: COLOR[open.tier] }}>{(LABEL[open.tier] || "").toUpperCase()} · THE PLAYGROUND</div>
            <h2>{open.name === "???" ? "A secret badge" : open.name}</h2>
            <p>{open.rule}</p>
            {e ? (
              <p className="pb-meta">
                Earned {new Date(e.earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {e.percent}% of players have it
                {e.nft?.tokenId ? <><br />Carried by Rebel Ant #{e.nft.tokenId}</> : null}
              </p>
            ) : tg ? (
              <div className="pb-prog"><span className="pb-bar pb-bar-big"><i style={{ width: Math.round((tg[0] / tg[1]) * 100) + "%" }} /></span><small>{tg[0].toLocaleString("en-US")} / {tg[1].toLocaleString("en-US")}</small></div>
            ) : <p className="pb-meta">Not earned yet.</p>}
            <button type="button" className="pb-close" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.pb{color:#f1ece4;font-family:'Noto Serif JP',Georgia,serif;box-sizing:border-box}
.pb *{box-sizing:border-box}
.pb a{color:#fbbf24}
.pb-top{max-width:900px;margin:0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}
.pb-top h1{margin:0;font-size:20px;font-weight:900;letter-spacing:.2em;background:linear-gradient(90deg,#ef4444,#f97316,#fbbf24);-webkit-background-clip:text;background-clip:text;color:transparent}
.pb-back{font:700 12px system-ui,sans-serif;text-decoration:none}
.pb-count{justify-self:end;font:800 12px ui-monospace,Menlo,monospace;color:#b9ae96}
.pb-count{margin:14px auto 0;text-align:center;font:800 11px ui-monospace,Menlo,monospace;letter-spacing:.16em;color:#fbbf24}
.pb-note{max-width:640px;margin:18px auto 0;text-align:center;font:500 14px/1.5 system-ui,sans-serif;color:#b9ae96}
.pb-tiers{max-width:900px;margin:16px auto 0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
.pb-tier{display:flex;flex-direction:column;align-items:center;padding:8px 2px;border-radius:12px;background:rgba(0,0,0,.45);border:1px solid color-mix(in srgb,var(--tc) 55%,transparent)}
.pb-tier b{font:900 15px system-ui,sans-serif;color:#fff}.pb-tier b small{font-size:9px;color:#8d8470}
.pb-tier span{font:800 8px ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--tc)}
.pb-filter{max-width:900px;margin:10px auto 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.pb-f{height:40px;border-radius:999px;cursor:pointer;background:rgba(0,0,0,.4);border:1.5px solid rgba(249,115,22,.35);color:#e7d9c4;font:800 10px ui-monospace,Menlo,monospace;letter-spacing:.12em}
.pb-on{border-color:#fbbf24;color:#fbbf24;box-shadow:0 0 14px rgba(249,115,22,.35)}
.pb-fam{max-width:900px;margin:12px auto 0;padding:12px;border-radius:14px;background:rgba(0,0,0,.45);border:1px solid rgba(239,68,68,.28)}
.pb-fam-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
.pb-fam-h span{font-size:12px;font-weight:900;letter-spacing:.18em;color:#f97316}
.pb-fam-h small{font:600 11px system-ui,sans-serif;color:#b9ae96}
.pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:12px 6px}
.pb-b{display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;cursor:pointer;padding:2px;min-width:0;font-family:inherit}
.pb-b-name{font:500 10px/1.2 system-ui,sans-serif;text-align:center;color:#8d8470}
.pb-b-on .pb-b-name{color:#f1ece4;font-weight:700}
.pb-bar{display:block;width:56px;height:4px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}
.pb-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#ef4444,#fbbf24)}
.pb-bar-big{width:220px;height:8px}
.pb-wall{display:block;max-width:900px;margin:18px auto 0;text-align:center;font:800 14px system-ui,sans-serif;text-decoration:none}
.pb-wall2{margin-top:10px}
.pb-foot{max-width:640px;margin:22px auto 0;text-align:center;font:500 11px/1.5 system-ui,sans-serif;color:#8d8470}
.pb-sheet-wrap{position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center}
.pb-scrim{position:absolute;inset:0;background:rgba(0,0,0,.6);border:0;cursor:pointer}
.pb-sheet{position:relative;width:min(480px,100%);display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 18px 26px;text-align:center;border-radius:20px 20px 0 0;background:linear-gradient(180deg,#1a0d0d,#07080d);border:1.5px solid rgba(249,115,22,.5);border-bottom:0}
.pb-sheet h2{margin:0;font-size:22px;font-weight:900}
.pb-sheet p{margin:0;font:500 14px/1.45 system-ui,sans-serif;color:#e2dccc}
.pb-sheet-tier{font:800 11px ui-monospace,Menlo,monospace;letter-spacing:.2em}
.pb-meta{font-size:12px!important;color:#b9ae96!important}
.pb-prog{display:flex;flex-direction:column;align-items:center;gap:4px}.pb-prog small{font:700 12px ui-monospace,Menlo,monospace;color:#d9ceb2}
.pb-close{margin-top:8px;height:44px;padding:0 28px;border-radius:999px;cursor:pointer;background:linear-gradient(135deg,#ef4444,#f97316);border:0;color:#fff;font:900 12px system-ui,sans-serif;letter-spacing:.15em}
`;
