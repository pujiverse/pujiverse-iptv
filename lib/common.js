// Shared helpers for the backend (Node 18+ and Vercel).

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range",
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const env = (k) => (typeof process !== "undefined" && process.env ? process.env[k] || "" : "");
const list = (k) => env(k).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Optional lock-down for public deployments:
//   ACCESS_KEY      — every request must carry ?key=... or an X-Access-Key header
//   ALLOWED_HOSTS   — comma-separated hostnames that may be contacted (portals and stream hosts)
export function checkAccess(req) {
  const key = env("ACCESS_KEY");
  if (!key) return null;
  const u = new URL(req.url);
  const got = req.headers.get("x-access-key") || u.searchParams.get("key") || "";
  return got === key ? null : json({ error: "Wrong or missing backend access key. Set it in Advanced settings." }, 401);
}

export function hostAllowed(hostname) {
  const allowed = list("ALLOWED_HOSTS");
  if (!allowed.length) return true;
  const h = hostname.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith("." + a));
}

export const mag = {
  ua(model = "MAG250") {
    return `Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) ${model} stbapp ver: 2 rev: 250 Safari/533.3`;
  },
};
