// Relays messages between the iptv.pujiverse.com page and the extension.
(() => {
  const target = location.origin;
  const version = chrome.runtime.getManifest().version;
  const frame = chrome.runtime.getURL("frame.html");
  const post = (m) => window.postMessage(m, target);
  const hello = () => post({ __iptv: "hello", version, frame });

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__iptv !== "req") return;
    const { id, op, args } = e.data;
    if (op === "ping") return hello();
    try {
      chrome.runtime.sendMessage({ op, args }, (res) => {
        const err = chrome.runtime.lastError;
        post({ __iptv: "res", id, ...(err ? { ok: false, error: "The IPTV Bridge extension was updated or reloaded. Reload this page." } : res) });
      });
    } catch {
      post({ __iptv: "res", id, ok: false, error: "The IPTV Bridge extension was updated or reloaded. Reload this page." });
    }
  });
  hello();
})();
