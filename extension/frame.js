// Player that runs inside the extension so it can load http:// streams and reach any stream host.
// The iptv.pujiverse.com page embeds this frame and controls it with postMessage.
(() => {
  const ALLOWED = ["https://iptv.pujiverse.com", "http://localhost", "http://127.0.0.1"];
  const video = document.getElementById("v");
  let parentOrigin = null, hls = null, ts = null, token = 0;

  const send = (m) => { if (parentOrigin) parent.postMessage({ __iptvFrame: true, token, ...m }, parentOrigin); };

  function stop() {
    if (hls) { hls.destroy(); hls = null; }
    if (ts) { try { ts.destroy(); } catch {} ts = null; }
    video.removeAttribute("src");
    try { video.load(); } catch {}
  }

  function play(o) {
    stop();
    token = o.token;
    const my = token;
    const fail = (detail) => { if (my === token) send({ type: "error", detail }); };
    video.style.objectFit = o.aspect || "contain";
    video.volume = Math.max(0, Math.min(1, o.volume ?? 1));
    video.muted = !!o.muted;

    if (o.engine === "hls" && window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, lowLatencyMode: !!o.lowLatency, maxBufferLength: o.hlsBuffer || 30, backBufferLength: 30 });
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        fail(d.details === "manifestLoadError" ? "The stream server refused the request." : `Stream error: ${d.details}.`);
      });
      hls.loadSource(o.url);
      hls.attachMedia(video);
    } else if (o.engine === "mpegts" && window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
      ts = mpegts.createPlayer({ type: "mpegts", isLive: !!o.live, url: o.url },
        { enableStashBuffer: !!o.stash, stashInitialSize: (o.stashKB || 384) * 1024, liveBufferLatencyChasing: !!o.lowLatency });
      ts.attachMediaElement(video);
      ts.load();
      ts.on(mpegts.Events.ERROR, (t, d) => fail(`Stream error: ${d || t}.`));
      video.play().catch(() => {});
    } else {
      video.src = o.url;
      video.play().catch(() => {});
    }
  }

  video.addEventListener("playing", () => send({ type: "playing", w: video.videoWidth, h: video.videoHeight }));
  video.addEventListener("waiting", () => send({ type: "waiting" }));
  video.addEventListener("ended", () => send({ type: "ended" }));
  video.addEventListener("error", () => { if (!hls && !ts && video.getAttribute("src")) send({ type: "error", detail: "The browser can't decode this format, or the server blocked it." }); });

  window.addEventListener("message", (e) => {
    const ok = ALLOWED.some((o) => e.origin === o || e.origin.startsWith(o + ":"));
    if (!ok || e.source !== parent || !e.data || !e.data.__iptvCmd) return;
    parentOrigin = e.origin;
    const m = e.data;
    if (m.type === "play") play(m);
    else if (m.type === "stop") { token = m.token ?? token; stop(); }
    else if (m.type === "mute") video.muted = !video.muted;
    else if (m.type === "aspect") video.style.objectFit = m.value;
    else if (m.type === "hello") send({ type: "ready" });
  });

  // A bare "ready" signal carries no data, so it can go to any parent; real traffic waits for an allowed one.
  parent.postMessage({ __iptvFrame: true, type: "ready" }, "*");
})();
