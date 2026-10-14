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
