// MAG / Stalker middleware client.
// The browser can't send the Cookie (mac=...), User-Agent or X-User-Agent headers these portals
// require, so the player posts the profile here and this code talks to the portal for it.
//
// POST /api/stalker  { profile, session, action, params }
//   profile: { portal, lang, tz, mac, sn, deviceId, deviceId2, signature, model, image, ua, timeout }
//   session: { api, token } returned by an earlier call (optional)
//   action:  login | genres | channels | link | vod_categories | vod_list | epg
// → { session, account, data }

import { CORS, json, checkAccess, hostAllowed, mag } from "./common.js";

class PortalError extends Error {
  constructor(msg, auth = false) { super(msg); this.auth = auth; }
}

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

// The browser extension swaps this for a fetch that can send Cookie / User-Agent / Referer.
let doFetch = (...a) => fetch(...a);
export function setFetch(f) { doFetch = f; }

function normalize(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new PortalError("Portal URL is required.");
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  let u;
  try { u = new URL(s); } catch { throw new PortalError("Portal URL is not a valid address."); }
  let path = u.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(index\.html|portal\.php|server\/load\.php)$/i, "").replace(/\/c$/i, "");
  const base = u.origin + path;
  const cands = [];
  if (/stalker_portal/i.test(path)) cands.push(`${base}/server/load.php`);
  cands.push(
    `${base}/portal.php`, `${base}/server/load.php`,
    `${u.origin}/stalker_portal/server/load.php`, `${u.origin}/portal.php`, `${u.origin}/server/load.php`,
    `${u.origin}/c/portal.php`, `${u.origin}/c/server/load.php`, `${u.origin}/stalker_portal/portal.php`
  );
  return { base, host: u.hostname, candidates: [...new Set(cands)] };
}

function headers(p, token, referer) {
  const model = p.model || "MAG250";
  const h = {
    "User-Agent": p.ua || mag.ua(model),
    "X-User-Agent": `Model: ${model}; Link: WiFi`,
    Cookie: `mac=${encodeURIComponent(p.mac)}; stb_lang=${encodeURIComponent(p.lang || "en")}; timezone=${encodeURIComponent(p.tz || "UTC")}`,
    Referer: referer,
    Accept: "*/*",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function call(api, referer, p, token, query) {
  const qs = new URLSearchParams({ ...query, JsHttpRequest: "1-xml" });
  const ms = Math.max(3, Math.min(60, Number(p.timeout) || 15)) * 1000;
  let r;
  try {
    r = await doFetch(`${api}?${qs}`, { headers: headers(p, token, referer), signal: AbortSignal.timeout(ms), redirect: "follow" });
  } catch (e) {
    throw new PortalError(e.name === "TimeoutError" ? "The portal did not answer in time." : `Could not reach the portal (${e.cause?.code || e.message}).`);
  }
  const text = await r.text();
  if (/Authorization failed/i.test(text)) throw new PortalError("Authorization failed.", true);
  if (/^\s*Unauthorized request/i.test(text)) { const e = new PortalError("The portal didn't accept the session (Unauthorized request).", true); e.unauthorized = true; throw e; }
  if (/cloudflare/i.test(text) && /blocked|Attention Required|challenge/i.test(text)) {
    throw new PortalError("The portal's firewall (Cloudflare) blocked this connection's internet address.");
  }
  if (r.status === 401) throw new PortalError("Portal refused access (401).", true);
  if (r.status === 404) { const e = new PortalError(`Not found (HTTP 404) at ${api}`); e.notFound = true; throw e; }
  if (r.status >= 400) throw new PortalError(`Portal answered HTTP ${r.status}. Its firewall may block this internet address.`);
  const step = query.action || query.type || "request";
  const body = text.replace(/^\uFEFF/, "").trim();
  if (!body) { const e = new PortalError(`Portal sent an empty reply to "${step}".`); e.empty = true; throw e; }
  let j;
  try { j = JSON.parse(body); }
  catch {
    const a = body.indexOf("{"), b = body.lastIndexOf("}");
    try { if (a < 0 || b <= a) throw 0; j = JSON.parse(body.slice(a, b + 1)); }
    catch {
      const peek = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
      const e = new PortalError(`Portal sent an unexpected reply to "${step}" (HTTP ${r.status}): ${peek || "(no text)"}`);
      e.unexpected = true; throw e;
    }
  }
  return j && "js" in j ? j.js : j;
}

async function login(p) {
  if (!MAC_RE.test(p.mac || "")) throw new PortalError("MAC address must look like 00:1A:79:XX:XX:XX.");
  const n = normalize(p.portal);
  if (!hostAllowed(n.host)) throw new PortalError("This portal is not in the backend's allowed hosts.");
  let referer = `${n.base}/c/`;
  let api = null, token = null, lastErr = null, authErr = null;
  const tried = [];
  for (const c of n.candidates) {
    const short = c.replace(/^https?:\/\/[^/]+/, "");
    try {
      const js = await call(c, referer, p, null, { type: "stb", action: "handshake", token: "", prehash: "" });
      if (js && js.token) { api = c; token = js.token; break; }
      tried.push(`${short}: no token`);
    } catch (e) {
      lastErr = e;
      if (e.auth) authErr = e;
      tried.push(`${short}: ${e.notFound ? "404" : e.auth ? "rejected MAC" : e.message}`);
      if (!e.notFound && !e.auth && /firewall|reach the portal|did not answer/.test(e.message)) break; // same result on every path
    }
  }
  if (!token) {
    const detail = ` Tried ${n.base.replace(/^https?:\/\//, "")}: ${tried.join("; ")}.`;
    if (authErr) throw new PortalError("The portal rejected this MAC address. Use the MAC your provider activated, and check the STB model." + detail);
    if (lastErr?.notFound || tried.length) throw new PortalError("Couldn't find the portal at this address. Check the Portal URL against your TV app." + detail);
    throw new PortalError((lastErr ? lastErr.message : "Portal handshake failed. Check the portal URL.") + detail);
  }

  // The portal page sits next to the API (…/stalker_portal/c/ for …/stalker_portal/server/load.php).
  referer = api.replace(/\/(server\/load|portal)\.php$/i, "").replace(/\/server$/i, "") + "/c/";

  const model = p.model || "MAG250";
  const ts = () => Math.floor(Date.now() / 1000);
  const fullProfile = () => ({
    type: "stb", action: "get_profile", hd: 1,
    ver: `ImageDescription: 0.2.18-r23-${model.replace(/^MAG/i, "")}; ImageDate: Wed Aug 29 10:49:53 EEST 2018; PORTAL version: 5.6.2; API Version: JS API version: 343; STB API version: 146; Player Engine version: 0x58c`,
    num_banks: 2, sn: p.sn || "", stb_type: model, client_type: "STB", image_version: p.image || "218",
    video_out: "hdmi", device_id: p.deviceId || "", device_id2: p.deviceId2 || "", signature: p.signature || "",
    auth_second_step: 1, hw_version: "1.7-BD-00", not_valid_token: 0,
    metrics: JSON.stringify({ mac: p.mac, sn: p.sn || "", type: "STB", model, uid: p.deviceId || "", random: "" }),
    hw_version_2: "", timestamp: ts(), api_signature: 262, prehash: "",
  });
  const basicProfile = () => ({
    type: "stb", action: "get_profile", hd: 1,
    ver: "ImageDescription: 0.2.18-r14-pub-250; ImageDate: Fri Jan 15 15:20:44 EET 2016; PORTAL version: 5.1.0; API Version: JS API version: 328; STB API version: 134; Player Engine version: 0x566",
    num_banks: 2, sn: p.sn || "", stb_type: model, image_version: p.image || "218", video_out: "hdmi",
    device_id: p.deviceId || "", device_id2: p.deviceId2 || "", signature: p.signature || "",
    auth_second_step: 0, hw_version: "1.7-BD-00", not_valid_token: 0, timestamp: ts(), api_signature: 262, prehash: "",
  });
  const randToken = () => Array.from({ length: 32 }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join("");
  const handshake = async (mine) => {
    const js = await call(api, referer, p, null, { type: "stb", action: "handshake", token: mine || "", prehash: "" });
    return js?.token || mine || null;
  };
  // A cheap request that only works with an accepted session.
  const verify = async (tok) => {
    const g = await call(api, referer, p, tok, { type: "itv", action: "get_genres" });
    return Array.isArray(g) || (g && typeof g === "object");
  };

  const variants = [
    { name: "standard", tok: async () => token, prof: fullProfile },
    { name: "basic profile", tok: () => handshake(), prof: basicProfile },
    { name: "own token", tok: () => handshake(randToken()), prof: basicProfile },
    { name: "own token, full profile", tok: () => handshake(randToken()), prof: fullProfile },
    { name: "no profile step", tok: () => handshake(), prof: null },
  ];
  const notes = [];
  let ok = false;
  for (const v of variants) {
    let tok, prof = null, profNote = "";
    try { tok = await v.tok(); } catch (e) { notes.push(`${v.name}: handshake ${e.auth ? "rejected" : "failed"}`); continue; }
    if (!tok) { notes.push(`${v.name}: no token`); continue; }
    if (v.prof) {
      try { prof = await call(api, referer, p, tok, v.prof()); }
      catch (e) { if (e.auth && !e.unauthorized) throw e; profNote = e.empty ? "empty profile" : e.unauthorized ? "profile unauthorized" : "profile error"; }
    }
    if (prof && (String(prof.blocked) === "1" || (Number(prof.status) === 1 && prof.msg))) {
      throw new PortalError(prof.msg || "This MAC address is blocked or not active on the portal.", true);
    }
    try {
      if (await verify(tok)) { token = tok; ok = true; break; }
      notes.push(`${v.name}: ${profNote || "profile ok"}, no data`);
    } catch (e) {
      notes.push(`${v.name}: ${profNote || "profile ok"}, ${e.unauthorized ? "unauthorized" : e.message}`);
    }
  }
  if (!ok) {
    throw new PortalError(`The portal gave a session but won't accept it. Check that the MAC, serial number, device ID and STB model match your TV app exactly. Attempts: ${notes.join("; ")}.`);
  }

  let account = null;
  try {
    const info = await call(api, referer, p, token, { type: "account_info", action: "get_main_info" });
    if (info && typeof info === "object") account = { expires: info.end_date || info.phone || "", plan: info.tariff_plan || "" };
  } catch { /* optional */ }
  return { api, referer, token, account };
}

const stripCmd = (c) => String(c || "").replace(/^(ffmpeg|ffrt\d?|auto)\s+/i, "").trim();
const absLogo = (logo, s) => {
  if (!logo) return "";
  if (/^https?:\/\//i.test(logo)) return logo;
  try { return new URL(logo.startsWith("/") ? logo : `/stalker_portal/misc/logos/320/${logo}`, s.api).href; } catch { return ""; }
};

// Fallback for portals that don't allow get_all_channels: walk get_ordered_list page by page.
async function pagedChannels(c) {
  const first = await c({ type: "itv", action: "get_ordered_list", genre: "*", force_ch_link_check: "", fav: 0, sortby: "number", hd: 0, p: 1 });
  const out = [...(first?.data || [])];
  const total = Number(first?.total_items) || out.length;
  const per = Number(first?.max_page_items) || out.length || 14;
  const pages = Math.min(400, Math.ceil(total / per));
  for (let start = 2; start <= pages; start += 6) {
    const batch = [];
    for (let pg = start; pg < start + 6 && pg <= pages; pg++)
      batch.push(c({ type: "itv", action: "get_ordered_list", genre: "*", force_ch_link_check: "", fav: 0, sortby: "number", hd: 0, p: pg }).catch(() => null));
    for (const r of await Promise.all(batch)) if (r?.data) out.push(...r.data);
  }
  if (!out.length) throw new PortalError("The portal returned no channels for this account.");
  const seen = new Set();
  return out.filter((x) => !seen.has(String(x.id)) && seen.add(String(x.id)));
}

async function act(s, p, action, q) {
  const c = (query) => call(s.api, s.referer, p, s.token, query);
  switch (action) {
    case "login":
      return { ok: true };
    case "genres": {
      const g = await c({ type: "itv", action: "get_genres" });
      return (Array.isArray(g) ? g : []).filter((x) => x.id !== "*").map((x) => ({ id: String(x.id), title: x.title }));
    }
    case "channels": {
      let data = null;
      try {
        const r = await c({ type: "itv", action: "get_all_channels" });
        data = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : null;
      } catch (e) { if (e.auth) throw e; }
      if (!data || !data.length) data = await pagedChannels(c);
      return data.map((x) => ({
        id: String(x.id), name: x.name, number: Number(x.number) || null, cmd: x.cmd,
        logo: absLogo(x.logo, s), genre: String(x.tv_genre_id ?? ""), archive: x.tv_archive === "1" || x.tv_archive === 1,
      }));
    }
    case "link": {
      const type = q.type === "vod" ? "vod" : "itv";
      const r = await c({ type, action: "create_link", cmd: q.cmd || "", series: q.series || "", forced_storage: "undefined", disable_ad: 0, download: 0 });
      const url = stripCmd(r?.cmd);
      if (!url) throw new PortalError(r?.error ? `Portal: ${r.error}` : "The portal returned no stream link for this item.");
      return { url };
    }
    case "vod_categories": {
      const g = await c({ type: "vod", action: "get_categories" });
      return (Array.isArray(g) ? g : []).filter((x) => x.id !== "*").map((x) => ({ id: String(x.id), title: x.title }));
    }
    case "vod_list": {
      const r = await c({ type: "vod", action: "get_ordered_list", category: q.category || "*", p: q.page || 1, sortby: "added", search: q.search || "" });
      const data = r?.data || [];
      return {
        total: Number(r?.total_items) || data.length,
        perPage: Number(r?.max_page_items) || 14,
        items: data.map((x) => ({
          id: String(x.id), name: x.name || x.o_name, cmd: x.cmd, year: x.year || "",
          logo: absLogo(x.screenshot_uri, s), series: Array.isArray(x.series) && x.series.length ? x.series : null,
          info: (x.description || "").slice(0, 280),
        })),
      };
    }
    case "epg": {
      const r = await c({ type: "itv", action: "get_short_epg", ch_id: q.id, size: 3 });
      return (Array.isArray(r) ? r : []).map((e) => ({ title: e.name, start: e.t_time, end: e.t_time_to, start_ts: Number(e.start_timestamp) || null, stop_ts: Number(e.stop_timestamp) || null }));
    }
    default:
      throw new PortalError(`Unknown action "${action}".`);
  }
}

// Runs one portal request. Used by the HTTP route below and by the browser extension.
export async function runStalker(body) {
  const { profile: p = {}, action = "login", params = {} } = body || {};
  let s = body?.session && body.session.api && body.session.token ? { ...body.session } : null;
  try {
    let account = null;
    if (s) {
      const n = normalize(p.portal);
      s.referer = `${n.base}/c/`;
      if (!s.api.startsWith(new URL(n.base).origin)) s = null; // portal changed
    }
    if (!s) { s = await login(p); account = s.account; }
    let data;
    try {
      data = await act(s, p, action, params);
    } catch (e) {
      if (!e.auth) throw e;
      s = await login(p); account = s.account; // token expired: log in again once
      data = await act(s, p, action, params);
    }
    return { session: { api: s.api, token: s.token }, account, data };
  } catch (e) {
    return { error: e.message || "Portal error." };
  }
}

export async function handleStalker(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const denied = checkAccess(req);
  if (denied) return denied;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body." }, 400); }
  const out = await runStalker(body);
  return json(out, out.error ? 502 : 200);
}
