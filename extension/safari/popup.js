// Atlas Autofill's popup: confirm the company and role, then fill the page you are on.

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const ago = (iso) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

/** A first guess at the company and role from the tab's title ("AI Engineer - Acme | LinkedIn"). */
function guess(title) {
  const t = String(title || "")
    .replace(/\s*[|·]\s*(linkedin|indeed(\.com)?|glassdoor|greenhouse|lever|ashby|workday|careers?|jobs?).*$/i, "")
    .replace(/^(job application for|apply( now)? (for|to)|application:?)\s*/i, "")
    .trim();
  const at = /^(.+?)\s+at\s+(.+)$/i.exec(t);
  if (at) return { role: at[1].trim(), company: at[2].trim() };
  const parts = t.split(/\s+[-–—|]\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? { role: parts[0], company: parts[1] } : { role: t, company: "" };
}

async function main() {
  const { atlas } = await api.storage.local.get("atlas");
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const g = guess(tab?.title);
  $("company").value = g.company;
  $("role").value = g.role;
  if (!atlas?.fields) {
    $("synced").textContent = "No answers yet. Open Applications in Atlas once, and this extension copies your answer bank.";
    $("go").disabled = true;
    return;
  }
  const count = Object.values(atlas.fields).filter((v) => v).length;
  $("synced").textContent = `${count} answers from Atlas, synced ${ago(atlas.at)}.`;
  $("fill").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("go").disabled = true;
    $("result").className = "";
    $("result").textContent = "Filling…";
    try {
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["fill.js"] });
      const [run] = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: (data, job) => globalThis.__atlasFill(data, job),
        args: [atlas, { company: $("company").value, role: $("role").value }],
      });
      const r = run?.result ?? { filled: 0, left: 0 };
      $("result").textContent = r.filled
        ? `Filled ${r.filled} field${r.filled === 1 ? "" : "s"}.${r.left ? ` ${r.left} required left for you.` : ""} Review, then submit.`
        : "Nothing to fill on this step. On a multi-step form, press Fill on each step.";
    } catch {
      $("result").className = "bad";
      $("result").textContent = "This page could not be filled. Safari may need you to allow Atlas Autofill on this site (click the extension's icon, then Allow).";
    } finally {
      $("go").disabled = false;
    }
  });
}

main();
