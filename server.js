// Standalone server: serves the player and the two backend routes. No dependencies, Node 18+.
//   npm start            → http://localhost:8080
// Env: PORT, ACCESS_KEY, ALLOWED_HOSTS (see README)

import http from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { handleStalker } from "./lib/stalker.js";
import { handleProxy } from "./lib/proxy.js";

const PORT = Number(process.env.PORT) || 8080;
const routes = { "/api/stalker": handleStalker, "/api/proxy": handleProxy };

http.createServer(async (req, res) => {
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const url = new URL(req.url, `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`);
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(new URL("./index.html", import.meta.url));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(html);
    }
    const handler = routes[url.pathname];
    if (!handler) { res.writeHead(404); return res.end("Not found"); }

    const ac = new AbortController();
    res.on("close", () => ac.abort());
    const headers = {};
    for (const k of ["content-type", "range", "x-access-key"]) if (req.headers[k]) headers[k] = req.headers[k];
    let body;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks);
    }
    const wres = await handler(new Request(url, { method: req.method, headers, body, signal: ac.signal }));
    res.writeHead(wres.status, Object.fromEntries(wres.headers));
    if (!wres.body || req.method === "HEAD") return res.end();
    const stream = Readable.fromWeb(wres.body);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(e?.message || e));
  }
}).listen(PORT, () => console.log(`Pujiverse IPTV running at http://localhost:${PORT}`));
