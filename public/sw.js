// Atlas service worker. Two jobs, and no storage of personal data on the device:
//   1. Push: show the morning notification and open Atlas when it is tapped.
//   2. Offline: when the network is unreachable, answer navigations with a small
//      static page built in memory.

// It deliberately caches NOTHING. Pages are personal and authenticated, so storing
// them would leave your data on the device after sign-out. Navigations go straight
// to the network; only when the network is unreachable does the worker answer with
// the small static page below, built in memory (no fetch, no Cache Storage).
// Static assets keep using the normal HTTP cache.

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#141414"><title>Offline · Atlas</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
    font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:#fcfcfc;color:#171717;
    padding:env(safe-area-inset-top) 24px env(safe-area-inset-bottom)}
  main{max-width:22rem;text-align:center}
  .mark{width:56px;height:56px;margin:0 auto 20px;border-radius:14px;background:linear-gradient(135deg,#232323,#171717 60%,#121212);box-shadow:inset 0 0 0 1px #3ecf8e4d}
  h1{font-size:1.4rem;margin:0 0 8px}
  p{margin:0 0 24px;color:#525252}
  a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;border-radius:8px;
    background:#2f7d56;color:#fafafa;font-weight:500;text-decoration:none}
  a:focus-visible{outline:2px solid #3ecf8e;outline-offset:2px}
  @media (prefers-color-scheme:dark){body{background:#141414;color:#ededed}p{color:#a1a1a1}a{background:#006239}}
</style></head>
<body><main><div class="mark" aria-hidden="true"></div>
<h1>You're offline</h1><p>Atlas needs a connection to load your brief. Nothing is stored on this device.</p>
<a href="">Try again</a></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Clear any Cache Storage left behind by an older worker, then take control.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate" || req.method !== "GET") return; // everything else: browser default
  event.respondWith(
    fetch(req).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Atlas", body: "Your brief is ready.", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // keep the default text
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon/small",
      badge: "/icon/small",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((w) => (w ?? open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
