/* JAKHAR service worker. Version badalne par purana cache apne-aap hat jata hai. */
const V = "jk-sw-v1";
const CORE = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(CORE.map(u => fetch(u, { cache: "reload" }).then(r => { if (r.ok) return c.put(u, r); }).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // Supabase etc. seedha network se
  const p = url.pathname;

  // Mukhya app page: pehle network (hamesha taaza), net na ho to cache
  if (req.mode === "navigate" && (p === "/" || p === "/index.html")) {
    e.respondWith(
      fetch("/index.html", { cache: "no-cache" })
        .then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put("/index.html", c)); } return r; })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }
  // Chhoti static files (manifest, icons): cache se, peeche se update
  if (CORE.includes(p)) {
    e.respondWith(
      caches.match(p).then(hit => {
        const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(p, c)); } return r; }).catch(() => hit);
        return hit || net;
      })
    );
  }
  // Baaki sab (admin.html, test pages) jaise pehle the waise
});
