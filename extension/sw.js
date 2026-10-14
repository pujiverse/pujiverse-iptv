// Pujiverse IPTV Bridge — background service worker.
// Runs portal requests for iptv.pujiverse.com from the user's own internet connection.
// Fetch can't set Cookie, User-Agent or Referer, so those are applied with per-host
// declarativeNetRequest session rules that only touch requests made by this extension.

import { runStalker, setFetch } from "./lib/stalker.js";

const VERSION = chrome.runtime.getManifest().version;
const ALLOWED_PAGES = ["https://iptv.pujiverse.com", "http://localhost", "http://127.0.0.1"];
const SPECIAL = new Set(["cookie", "user-agent", "referer"]);
const applied = new Map(); // host -> JSON of headers currently set

function ruleId(host) {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 900000) + 1;
}

async function setHostHeaders(host, headers) {
  const key = JSON.stringify(headers);
  if (applied.get(host) === key) return;
  const id = ruleId(host);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: headers.map(([header, value]) => ({ header, operation: "set", value })) },
      condition: { requestDomains: [host], initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest", "media", "other"] },
    }],
  });
  applied.set(host, key);
}

async function bridgedFetch(url, init = {}) {
  const plain = {}, special = [];
  for (const [k, v] of Object.entries(init.headers || {})) {
    if (SPECIAL.has(k.toLowerCase())) special.push([k, String(v)]);
    else plain[k] = v;
  }
  if (special.length) await setHostHeaders(new URL(url).hostname, special);
  return fetch(url, { ...init, headers: plain, credentials: "omit" });
}
setFetch(bridgedFetch);

const ops = {
  hello: async () => ({ version: VERSION }),
  stalker: async (args) => runStalker(args),
  async text({ url, ua }) {
    const r = await bridgedFetch(url, { headers: ua ? { "User-Agent": ua } : {}, redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Server answered ${r.status}.`);
    return r.text();
  },
  async prepare({ url, ua }) {
    if (ua) await setHostHeaders(new URL(url).hostname, [["User-Agent", ua]]);
    return true;
  },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const from = sender.origin || (sender.url ? new URL(sender.url).origin : "");
  const okPage = ALLOWED_PAGES.some((o) => from === o || from.startsWith(o + ":"));
  if (!okPage || !msg || !ops[msg.op]) { reply({ ok: false, error: "Not allowed." }); return false; }
  ops[msg.op](msg.args || {}).then(
    (data) => reply({ ok: true, data }),
    (e) => reply({ ok: false, error: e?.name === "TimeoutError" ? "The server did not answer in time." : (e?.message || String(e)) })
  );
  return true; // async reply
});
