/* B.U.D.D.H.I. offline support: keeps the app and every knowledge file it has opened, so it works without internet. */
const VERSION = "20261122134951";
const APP = "buddhi-app-" + VERSION, DATA = "buddhi-data-pack4";
const SHELL = ["./", "index.html", "config.js", "starter.js", "i18n.js", "engine.js", "music.js", "quiz.js", "team.js", "licenses.txt", "webllm-worker.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "pack/manifest.json", "pack/meta.bin", "quiz/index.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("buddhi-") && k !== APP && k !== DATA && !k.startsWith("webllm")).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const path = url.pathname;
  if (/\/(pack|quiz)\//.test(path) && !/manifest\.json$|index\.json$/.test(path)) {
    // knowledge files never change for a pack: cache first
    e.respondWith(caches.open(DATA).then(async c => { const hit = await c.match(req, { ignoreSearch: true }); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  // app files: try the network, fall back to the saved copy when offline
  e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(APP).then(c => c.put(req, copy)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || caches.match("index.html"))));
});
self.addEventListener("message", e => {
  if (!e.data || e.data.type !== "saveAll") return;
  const files = e.data.files, port = e.ports[0];
  (async () => {
    const c = await caches.open(DATA); let done = 0, failed = 0;
    const queue = files.slice();
    async function worker() {
      while (queue.length) {
        const f = queue.shift();
        try { if (!(await c.match(f))) { const r = await fetch(f); if (r.ok) await c.put(f, r); else failed++; } } catch (err) { failed++; }
        done++; if (done % 5 === 0 || done === files.length) port.postMessage({ done, total: files.length, failed });
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    port.postMessage({ done, total: files.length, failed, finished: true });
  })();
});
