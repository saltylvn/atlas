// Atlas Autofill's popup: connect to Atlas once, then "Help me apply on this page" opens the
// panel beside the form. It also lists your Apply Queue, so you can open the next job,
// and offers "Mark submitted" after a job site says your application went in.

const api = globalThis.browser ?? globalThis.chrome;
const ATLAS = "https://atlas-optim.vercel.app";
const $ = (id) => document.getElementById(id);
const ago = (iso) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
const openTab = (url) => api.tabs.create({ url });

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showJob(job) {
  $("job").hidden = false;
  $("queue").hidden = true;
  $("job-title").textContent = `${job.perfect ? "★ " : ""}${job.title}${job.company ? ` at ${job.company}` : ""}`;
  $("job-resume").textContent = job.resume ? `Atlas attaches your ${job.resume} resume when you fill.` : "";
  $("job-open").onclick = () => openTab(job.url);
  $("job-done").onclick = async () => {
    await api.storage.local.remove(["current", "applied"]);
    openTab(`${ATLAS}/career?kit=${encodeURIComponent(job.id)}#kit-check`);
  };
  $("job-clear").onclick = async () => {
    await api.storage.local.remove("current");
    main();
  };
}

function showQueue(jobs) {
  $("job").hidden = true;
  $("queue").hidden = false;
  $("queue-title").textContent = `Apply Queue (${jobs.length})`;
  $("queue-list").replaceChildren(
    ...jobs.map((job) => {
      const row = el("li");
      const pick = el("button", "", "job");
      pick.type = "button";
      pick.append(el("span", `${job.perfect ? "★ " : ""}${job.title}`), el("span", job.company || "Company not named", "co"));
      pick.addEventListener("click", async () => {
        await api.storage.local.set({ current: { id: job.id, at: new Date().toISOString() } });
        openTab(job.url);
      });
      row.append(pick);
      return row;
    }),
  );
  $("queue-atlas").onclick = () => openTab(`${ATLAS}/career#approvals`);
}

async function main() {
  const { atlasKey, queue, current, applied } = await api.storage.local.get(["atlasKey", "queue", "current", "applied"]);
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const jobs = Array.isArray(queue && queue.jobs) ? queue.jobs : [];
  const job = jobs.find((j) => current && j.id === current.id) || null;

  $("connect").hidden = Boolean(atlasKey);
  $("assist").disabled = !atlasKey || !tab;
  if (job) showJob(job);
  else if (jobs.length) showQueue(jobs);
  else {
    $("job").hidden = true;
    $("queue").hidden = true;
  }
  if (applied && applied.at && Date.now() - Date.parse(applied.at) < 6 * 3_600_000) {
    $("applied").hidden = false;
    $("applied").textContent = job ? "A job site said your application went in. Press Mark submitted to move it to Applied." : "A job site said your application went in. Mark it in Atlas if it was a queued job.";
  }
  $("synced").textContent = queue ? `Queue copied from Atlas ${ago(queue.at)}: ${jobs.length} job${jobs.length === 1 ? "" : "s"}. Open Career > Apply in Atlas to refresh it.` : "Open Career > Apply in Atlas once, and this extension copies your Apply Queue.";

  $("assist").onclick = async () => {
    $("assist").disabled = true;
    $("assist-result").className = "small";
    $("assist-result").textContent = "Reading the form and asking Atlas…";
    const r = await api.runtime.sendMessage({ type: "assist", tabId: tab.id }).catch((e) => ({ error: String(e.message || e) }));
    if (!r || r.error) {
      $("assist-result").className = "small bad";
      $("assist-result").textContent = (r && r.error) || "This page could not be read. Safari may need you to allow Atlas Autofill on this site (click the A, then Allow).";
      $("assist").disabled = false;
      return;
    }
    window.close();
  };

  $("key-save").onclick = async () => {
    $("key-result").className = "small";
    $("key-result").textContent = "Checking with Atlas…";
    const r = await api.runtime.sendMessage({ type: "connect", key: $("key").value }).catch((e) => ({ error: String(e.message || e) }));
    $("key-result").className = r && r.ok ? "small" : "small bad";
    $("key-result").textContent = r && r.ok ? `Connected${r.name ? `, ${r.name}` : ""}.` : (r && r.error) || "Not connected.";
    if (r && r.ok) setTimeout(main, 700);
  };
}

main();
