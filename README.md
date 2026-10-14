# Pujiverse IPTV — web player with StbEmu-style profiles

Watch your IPTV subscription in a web browser. Like the StbEmu Android app, you create **profiles**, and each profile has four settings sections:

| Section | Settings |
|---|---|
| **Portal settings** | Portal URL *(required)*, Portal language *(required)*; or server/username/password for Xtream, or a playlist URL for M3U |
| **STB configuration** | STB model (MAG200 … MAG524, AuraHD), firmware, user agent, screen resolution, **MAC address** *(required)*, serial number, device ID, device ID 2, signature (with Generate buttons) |
| **Media player settings** | Player engine, buffer size, aspect ratio, start volume, auto-reconnect, resume last channel |
| **Advanced settings** | Time zone, backend server URL, backend access key, play streams through backend, connection timeout, show Movies |

Profiles can be added, edited, duplicated, deleted, exported to a JSON file and imported back. They are saved in the browser.

The player has **Live TV** (groups, numbered channels, favorites, now/next EPG) and **Movies** (VOD categories), plus remote-style keys: ↑/↓ change channel, type a number to jump, F fullscreen, M mute, I info, Esc back to profiles.

## Why there is a server

MAG/Stalker portals identify the box by a `mac=` cookie, a MAG user agent and an `X-User-Agent` header. Browsers are not allowed to send those, so `server.js` does the portal login (handshake → get_profile) and relays the streams. The same server also fixes CORS and lets an https page play `http://` streams.

## IPTV Bridge extension (recommended for everyone)

Most MAG portals (glotv.me included) block web servers like Vercel. The **IPTV Bridge** browser extension fixes this for every visitor: iptv.pujiverse.com sends portal requests to the extension, and the extension makes them from the visitor's own internet connection, with the MAC cookie and MAG user agent the portal expects. Streams also play from the visitor's connection, inside a small player frame that belongs to the extension.

- Each user's MAC address and video never pass through your server, and you pay no video bandwidth.
- Install today: the Profiles page has a **Download IPTV Bridge** button (`iptv-bridge.zip`). Unzip it, open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click Load unpacked, pick the `iptv-bridge` folder, reload the site.
- For the general public, publish the `extension/` folder to the Chrome Web Store (one-time $5 developer fee) and Edge Add-ons (free). Then installing is one click.
- Each profile's *Advanced settings → Connect through* chooses Automatic (extension if installed), the extension only, or the backend server.
- The extension only works on `https://iptv.pujiverse.com`, `http://localhost` and `http://127.0.0.1`. To use another domain, add it in `extension/manifest.json` (content_scripts and web_accessible_resources) and in the `ALLOWED` lists in `extension/sw.js` and `extension/frame.js`.
- `extension/lib/` is a copy of `lib/stalker.js` and `lib/common.js`. After changing those, copy them again and rebuild `iptv-bridge.zip`:

```bash
cp lib/stalker.js lib/common.js extension/lib/
mkdir -p /tmp/pack && rm -rf /tmp/pack/iptv-bridge && cp -r extension /tmp/pack/iptv-bridge
(cd /tmp/pack && zip -qr - iptv-bridge) > iptv-bridge.zip
```

## Run it at home (only if you don't use the extension)

Many IPTV portals, including ones behind Cloudflare, block data-center addresses such as Vercel, AWS and Google Cloud. If the player says the portal's firewall blocked the backend, run the backend on a computer on the same home internet as your TV:

1. Install Node.js 18 or newer from nodejs.org.
2. In this folder run `npm start`.
3. Either open **http://localhost:8080** on that computer, or keep using https://iptv.pujiverse.com and set each profile's *Advanced settings → Backend server URL* to `http://localhost:8080`.

The computer must stay on while you watch. To watch away from home, expose the home server with a tunnel such as Cloudflare Tunnel or Tailscale and use that address as the Backend server URL.

## Run it

**On your own computer or a VPS (recommended for live TV):**

```bash
npm start            # Node 18+, no dependencies
# open http://localhost:8080
```

Free hosts that run a Node server (Render, Railway, Fly.io) work the same way: start command `npm start`.

**On Vercel:** import the folder as a project. `api/stalker.js` and `api/proxy.js` become the backend. Vercel ends a function after a few minutes, so continuous `.ts` live streams will cut out; HLS (`.m3u8`) channels and movies work better there. A normal server has no such limit.

**Front page on GitHub Pages, backend elsewhere:** host `index.html` anywhere and put the backend address in each profile's *Advanced settings → Backend server URL*.

## Lock the backend down

If you deploy publicly, set environment variables so strangers can't use your server:

- `ACCESS_KEY=some-long-secret` — then enter the same key in *Advanced settings → Backend access key*
- `ALLOWED_HOSTS=8k.example.cc,cdn.example.cc` — only these portals and stream hosts can be contacted

## Notes

- Use the MAC address (and serial/device ID if required) that **your provider activated for your subscription**; the portal rejects anything else.
- Many IPTV portals tie a session to the IP address, so the portal login and the streams both go through the same backend.
- Some channels use codecs browsers can't decode (certain HEVC/H.265 or AC-3 audio). Those won't play in a browser even when the login works.
