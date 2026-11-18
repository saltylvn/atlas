// Atlas Autofill, the part that runs on Atlas itself: only on your Applications page at
// atlas-optim.vercel.app. It reads the answer bank Atlas puts on that page and keeps a copy
// in this extension's own storage, so Fill works on job sites without asking Atlas again.
// Open Applications after you change an answer and the copy is refreshed.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const node = document.getElementById("atlas-autofill-data");
  if (!node || !api?.storage) return;
  let data;
  try {
    data = JSON.parse(node.textContent || "");
  } catch {
    return;
  }
  // Only a well-formed copy is kept: strings in known places, nothing else.
  if (!data || data.v !== 1 || typeof data.fields !== "object" || data.fields === null) return;
  const fields = {};
  for (const [k, v] of Object.entries(data.fields)) if (/^[a-zA-Z]{2,30}$/.test(k) && typeof v === "string") fields[k] = v.slice(0, 4000);
  api.storage.local.set({ atlas: { v: 1, at: typeof data.at === "string" ? data.at : new Date().toISOString(), fields } }).then(() => {
    const status = document.getElementById("atlas-autofill-status");
    if (status) {
      status.textContent = "Synced with Atlas Autofill in this browser just now.";
      status.setAttribute("data-synced", "true");
    }
  });
})();
