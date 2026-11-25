// Atlas Autofill, the part that runs on Atlas itself: only on atlas-optim.vercel.app, while you
// are signed in. It reads what Atlas puts on its pages for the extension and keeps a copy in the
// extension's own storage, on your Mac:
//   - your Apply Queue (Career > Apply), for the list in the popup;
//   - your answer bank (Career > Setup), for the extension's offline fill;
//   - the key, once, right after you press Connect Atlas Autofill in Settings.
// It reads the page and writes to its own storage. It changes nothing in Atlas, presses nothing,
// and makes no network request of its own.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.storage) return;

  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const read = (id) => {
    const node = document.getElementById(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "");
    } catch {
      return null;
    }
  };
  const say = (id, words) => {
    const status = document.getElementById(id);
    if (!status) return;
    status.textContent = words;
    status.setAttribute("data-synced", "true");
  };

  function syncAnswers() {
    const data = read("atlas-autofill-data");
    if (!data || data.v !== 1 || typeof data.fields !== "object" || data.fields === null) return;
    const fields = {};
    for (const [k, v] of Object.entries(data.fields)) if (/^[a-zA-Z]{2,30}$/.test(k) && typeof v === "string") fields[k] = v.slice(0, 4000);
    api.storage.local.set({ atlas: { v: 1, at: text(data.at, 40) || new Date().toISOString(), fields } }).then(() => say("atlas-autofill-status", "Synced with Atlas Autofill in this browser just now."));
  }

  function syncQueue() {
    const data = read("atlas-extension-queue");
    if (!data || data.v !== 1 || !Array.isArray(data.jobs)) return;
    const jobs = [];
    for (const j of data.jobs.slice(0, 60)) {
      if (!j || typeof j !== "object") continue;
      const id = text(j.id, 64);
      const url = text(j.url, 600);
      // A job is kept only with a plain id and an https link: the popup opens that link.
      if (!/^[A-Za-z0-9-]{1,64}$/.test(id) || !/^https:\/\/[^\s]+$/.test(url)) continue;
      jobs.push({
        id,
        url,
        title: text(j.title, 200),
        company: text(j.company, 160),
        role: text(j.role, 160),
        resume: text(j.resume, 80),
        perfect: j.perfect === true,
        facts: Array.isArray(j.facts) ? j.facts.slice(0, 5).map((f) => text(f, 200)).filter(Boolean) : [],
      });
    }
    api.storage.local
      .set({ queue: { v: 1, at: text(data.at, 40) || new Date().toISOString(), jobs } })
      .then(() => say("atlas-extension-status", `Atlas Autofill copied this queue just now: ${jobs.length} job${jobs.length === 1 ? "" : "s"} to apply to. Open it from the A in Safari's toolbar.`));
  }

  /** The key, shown once in Settings after Connect. Kept only when it looks like an Atlas Autofill key. */
  function syncKey() {
    const box = document.getElementById("atlas-extension-key");
    const key = box && typeof box.value === "string" ? box.value.trim() : "";
    if (!/^atlas_ext_[A-Za-z0-9_-]{30,100}$/.test(key)) return false;
    api.runtime
      .sendMessage({ type: "connect", key })
      .then((r) => say("atlas-extension-key-status", r && r.ok ? "Atlas Autofill picked up this key and is connected. You can leave this page." : `Atlas Autofill could not connect: ${(r && r.error) || "try pasting the key into the extension"}`))
      .catch(() => undefined);
    return true;
  }

  syncAnswers();
  syncQueue();

  // Atlas redraws parts of the page without reloading it: copy the queue again, and catch the key when it appears.
  if (typeof MutationObserver === "function") {
    let timer = 0;
    let keyTaken = false;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        syncQueue();
        if (!keyTaken) keyTaken = syncKey();
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
