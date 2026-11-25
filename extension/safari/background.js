// Atlas Autofill's background: the only part that talks to Atlas. It runs the form reader in
// the tab you are on, asks Atlas (the Apply Agent) to answer the questions, shows the panel,
// and fills what you approve there. It never submits anything.
//
// Atlas is reached with the key you connected in Atlas Settings, kept in this extension's own
// storage on your Mac. The key can only ask Atlas to answer a form, fetch your resume, and save
// an answer you corrected.

const api = globalThis.browser ?? globalThis.chrome;
const ATLAS = "https://atlas-optim.vercel.app";

async function base() {
  const { atlasBase } = await api.storage.local.get("atlasBase");
  // A developer's local Atlas only; anything else is Atlas itself.
  return typeof atlasBase === "string" && /^http:\/\/localhost:\d{2,5}$/.test(atlasBase) ? atlasBase : ATLAS;
}

async function atlas(path, init = {}) {
  const { atlasKey } = await api.storage.local.get("atlasKey");
  if (!atlasKey) throw new Error("Connect the extension to Atlas first: Atlas Settings, then Connect Atlas Autofill.");
  const res = await fetch(`${await base()}${path}`, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${atlasKey}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  if (!res.ok) {
    let why = `Atlas answered ${res.status}.`;
    try {
      why = (await res.json()).error || why;
    } catch {
      /* not JSON */
    }
    throw new Error(why);
  }
  return res;
}

/** Runs a function in every frame of the tab the extension may reach. Frames it may not reach are skipped. */
async function everyFrame(tabId, func, args = [], world) {
  const out = await api.scripting.executeScript({ target: { tabId, allFrames: true }, func, args, ...(world ? { world } : {}) });
  return (out || []).filter((r) => r && r.result !== undefined);
}

async function inject(tabId) {
  // The page helper runs inside the page (for dropdown libraries); a browser without that option skips it.
  try {
    await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["page.js"], world: "MAIN" });
  } catch {
    /* older browser: the reader falls back to clicking and typing */
  }
  await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["form.js"] });
}

const fid = (frameId, id) => `f${frameId}_${id}`;
const unfid = (id) => {
  const m = /^f(\d+)_(q\d+)$/.exec(id);
  return m ? { frameId: Number(m[1]), id: m[2] } : null;
};

/** The job in your Apply Queue that this page is for, if any. */
function queueJob(queue, page) {
  const jobs = Array.isArray(queue && queue.jobs) ? queue.jobs : [];
  const strip = (u) => {
    try {
      const x = new URL(u);
      return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/(application|apply)\/?$/, "").replace(/\/$/, "")}`;
    } catch {
      return "";
    }
  };
  const here = strip(page.url);
  // A company given as its domain ("fridayharbor.ai", on Gem) matches "Friday Harbor" in the queue.
  const key = (s) => String(s || "").toLowerCase().replace(/^([a-z0-9-]+)\.[a-z]{2,6}$/, "$1").replace(/[^a-z0-9]+/g, "");
  return jobs.find((j) => strip(j.url) && here.startsWith(strip(j.url))) || jobs.find((j) => key(j.company) && key(j.company) === key(page.company)) || null;
}

/** Reads the form, asks Atlas, and shows the panel. */
async function assist(tabId) {
  await inject(tabId);
  const reads = await everyFrame(tabId, async () => {
    const f = globalThis.__atlasForm;
    return { top: window === window.top, questions: await f.read(), job: window === window.top ? f.job() : null, step: f.steps() };
  });
  const top = reads.find((r) => r.result.top) || reads[0];
  const page = (top && top.result.job) || { title: "", company: "", posting: "", url: "", restricted: false };
  const questions = reads.flatMap((r) => r.result.questions.map((q) => ({ ...q, id: fid(r.frameId, q.id) })));
  const step = (reads.find((r) => r.result.step) || { result: {} }).result.step || null;
  const { queue, current } = await api.storage.local.get(["queue", "current"]);
  const fromQueue = queueJob(queue, page) || (queue && Array.isArray(queue.jobs) ? queue.jobs.find((j) => current && j.id === current.id) : null) || null;
  const job = {
    title: (fromQueue && fromQueue.title) || page.title,
    company: (fromQueue && fromQueue.company) || page.company,
    role: (fromQueue && fromQueue.role) || page.title,
    resume: (fromQueue && fromQueue.resume) || "",
    source: fromQueue ? "your Apply Queue" : page.source,
    kit: fromQueue ? fromQueue.id : "",
    perfect: Boolean(fromQueue && fromQueue.perfect),
    url: page.url,
    restricted: Boolean(page.restricted),
  };
  let answers = [];
  let notes = [];
  if (questions.length === 0) notes.push(step ? `No questions on this page yet. ${step.kind === "open" ? "Open the application" : "Go to the next step"} first.` : "No application questions found on this page.");
  else {
    try {
      const res = await atlas("/api/extension/answers", {
        method: "POST",
        body: JSON.stringify({ url: page.url || "https://unknown.invalid/", title: job.title, posting: page.posting || "", company: job.company, role: job.role, resume: job.resume, questions: questions.slice(0, 80).map(({ id, label, required, kind, options }) => ({ id, label, required, kind, options })) }),
      });
      const body = await res.json();
      answers = Array.isArray(body.answers) ? body.answers : [];
      notes = Array.isArray(body.notes) ? body.notes : [];
    } catch (err) {
      notes.push(String(err.message || err));
    }
  }
  await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["panel.js"] });
  await api.tabs.sendMessage(tabId, { type: "atlas:show", job, questions, answers, notes, step }, { frameId: 0 });
  await api.storage.local.set({ lastAssist: { tabId, at: new Date().toISOString(), kit: job.kit } });
  return { ok: true, questions: questions.length };
}

async function resumeFile(role) {
  const res = await atlas(`/api/extension/resume${role ? `?role=${encodeURIComponent(role)}` : ""}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { name: decodeURIComponent(res.headers.get("x-resume-name") || "Resume.pdf"), base64: btoa(bin) };
}

/** Fills what you approved in the panel, frame by frame. */
async function fill(tabId, list, role, needsFile) {
  let file = null;
  let fileNote = "";
  if (needsFile) {
    try {
      file = await resumeFile(role);
    } catch (err) {
      fileNote = String(err.message || err);
    }
  }
  const byFrame = new Map();
  for (const a of list) {
    const at = unfid(a.id);
    if (!at) continue;
    if (!byFrame.has(at.frameId)) byFrame.set(at.frameId, []);
    byFrame.get(at.frameId).push({ ...a, id: at.id });
  }
  const results = {};
  for (const [frameId, items] of byFrame) {
    const out = await api.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: (l, f) => globalThis.__atlasForm.fill(l, f), args: [items, file] });
    const r = (out && out[0] && out[0].result) || {};
    for (const [id, status] of Object.entries(r)) results[fid(frameId, id)] = status;
  }
  return { results, fileNote };
}

async function step(tabId) {
  const out = await everyFrame(tabId, () => {
    const s = globalThis.__atlasForm && globalThis.__atlasForm.steps();
    return s && s.allowed ? globalThis.__atlasForm.step() : false;
  });
  return { moved: out.some((r) => r.result === true) };
}

async function done(tabId) {
  const out = await everyFrame(tabId, () => Boolean(globalThis.__atlasForm && globalThis.__atlasForm.done()));
  return { done: out.some((r) => r.result === true) };
}

api.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = (sender.tab && sender.tab.id) ?? msg.tabId;
  const run = async () => {
    switch (msg && msg.type) {
      case "assist":
        return assist(tabId);
      case "fill":
        return fill(tabId, Array.isArray(msg.answers) ? msg.answers : [], String(msg.role || ""), Boolean(msg.needsFile));
      case "step":
        return step(tabId);
      case "done":
        return done(tabId);
      case "learn": {
        await atlas("/api/extension/learn", { method: "POST", body: JSON.stringify({ id: String(msg.id), value: String(msg.value || "") }) });
        return { ok: true };
      }
      case "connect": {
        const key = String(msg.key || "").trim();
        if (!/^atlas_ext_[A-Za-z0-9_-]{30,100}$/.test(key)) return { error: "That is not an Atlas Autofill key. Make one in Atlas Settings." };
        await api.storage.local.set({ atlasKey: key });
        try {
          const res = await atlas("/api/extension/ping");
          const body = await res.json();
          return { ok: true, name: body.name || "" };
        } catch (err) {
          await api.storage.local.remove("atlasKey");
          return { error: String(err.message || err) };
        }
      }
      case "submitted-page": {
        // From done.js: a job site said the application went in.
        await api.storage.local.set({ applied: { url: String(msg.url || "").slice(0, 600), at: new Date().toISOString() } });
        if (api.action && api.action.setBadgeText) await api.action.setBadgeText({ tabId, text: "✓" });
        return { ok: true };
      }
      default:
        return { error: "unknown request" };
    }
  };
  run().then(reply, (err) => reply({ error: String((err && err.message) || err) }));
  return true;
});
