import type {NextApiRequest, NextApiResponse} from "next";
import {createPlaygroundRaapHandler} from "../../../lib/server/playground-raap";
import type {PvpMatch} from "../../../lib/types/fwpvp";
export const config={api:{bodyParser:false}};
/** Unset by default. No shared bot/Economy secret is a fallback. */
export default async function handler(req:NextApiRequest,res:NextApiResponse) {
  res.setHeader("Cache-Control","no-store");
  const key=process.env.RAAP_PLAYGROUND_READ_KEY_HEX??"",collection=process.env.RAAP_PLAYGROUND_COLLECTION??"";
  const expiresAt=Number(process.env.RAAP_PLAYGROUND_READ_EXPIRES_AT_MS);
  if(!/^[0-9a-f]{64}$/.test(key) || !/^0x[0-9a-f]{40}$/.test(collection) || !Number.isSafeInteger(expiresAt) || Date.now()>=expiresAt)
    return res.status(503).json({error:"PLAYGROUND_RAAP_UNCONFIGURED"});
  try {
    const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(Array.isArray(v))throw Error("AMBIGUOUS_HEADER");if(v!==undefined)headers.set(k,v);}
    if(req.method!=="POST" || req.url!=="/api/raap/playground" || headers.get("content-type")!=="application/json" || headers.has("cookie") || headers.has("origin") || headers.has("content-encoding"))
      return res.status(403).json({error:"PLAYGROUND_RAAP_UNAVAILABLE"});
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return res.status(413).end();chunks.push(Buffer.from(chunk));}
    const run=createPlaygroundRaapHandler({key:Buffer.from(key,"hex"),collection,expiresAt,now:Date.now,
      match:async id=>{
        // Read the saved JSON directly. getMatch also projects wall-clock spell
        // damage; this endpoint explicitly reports stored rather than projected HP.
        const {redis}=await import("../../../lib/server/redis.js");
        const raw=await redis.get<PvpMatch|string>(`ra:fwpvp:match:${id}`);
        return typeof raw==="string"?JSON.parse(raw):raw;
      }, healConfig: async () => (await import("../../../lib/server/fwpvp.js")).getHealConfig() });
    const reply=await run(new Request("https://playground.invalid/api/raap/playground",{method:"POST",headers,body:Buffer.concat(chunks)}));
    reply.headers.forEach((v,k)=>res.setHeader(k,v));return res.status(reply.status).send(await reply.text());
  }catch{return res.status(403).json({error:"PLAYGROUND_RAAP_UNAVAILABLE"});}
}
