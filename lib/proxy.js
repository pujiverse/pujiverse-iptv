// Stream / playlist relay: GET /api/proxy?url=<target>[&ua=<user agent>][&key=<access key>]
// Adds CORS, lets an https page load http:// streams, sends the MAG user agent portals expect,
// and rewrites HLS playlists so every segment also goes through here.

import { CORS, checkAccess, hostAllowed } from "./common.js";

export async function handleProxy(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const denied = checkAccess(req);
  if (denied) return denied;

  const self = new URL(req.url);
  const target = self.searchParams.get("url");
  const ua = self.searchParams.get("ua") || "";
  const key = self.searchParams.get("key") || "";
  const err = (m, s) => new Response(m, { status: s, headers: CORS });
  if (!target) return err("Missing ?url=", 400);

  let t;
  try { t = new URL(target); } catch { return err("Bad url", 400); }
  if (!/^https?:$/.test(t.protocol)) return err("Only http and https", 400);
  if (!hostAllowed(t.hostname)) return err("Host not allowed", 403);

  const h = { "User-Agent": ua || "Mozilla/5.0 (Web IPTV Player)", Accept: "*/*" };
  const range = req.headers.get("range");
  if (range) h.Range = range;

  let up;
  try {
    up = await fetch(t, { headers: h, redirect: "follow", signal: req.signal });
  } catch (e) {
    return err(`Upstream unreachable: ${e.cause?.code || e.message}`, 502);
  }

  const out = new Headers(CORS);
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = up.headers.get(k);
    if (v) out.set(k, v);
  }
  out.set("Cache-Control", "no-store");

  const type = up.headers.get("content-type") || "";
  const finalUrl = up.url || t.href;
  const isPlaylist = /mpegurl/i.test(type) || /\.m3u8?($|\?)/i.test(new URL(finalUrl).pathname);
  if (!isPlaylist || !up.ok) return new Response(up.body, { status: up.status, headers: out });

  const extra = (ua ? `&ua=${encodeURIComponent(ua)}` : "") + (key ? `&key=${encodeURIComponent(key)}` : "");
  const prox = (u) => `${self.origin}${self.pathname}?url=${encodeURIComponent(new URL(u, finalUrl).href)}${extra}`;
  const text = await up.text();
  const body = text.split(/\r?\n/).map((line) => {
    const l = line.trim();
    if (!l) return line;
    if (l.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${prox(u)}"`);
    return prox(l);
  }).join("\n");
  out.delete("content-length");
  out.set("content-type", "application/vnd.apple.mpegurl");
  return new Response(body, { status: up.status, headers: out });
}
