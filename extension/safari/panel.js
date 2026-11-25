// Atlas Autofill's panel: a small window on the job site's page, beside the form. It lists every
// question the reader found, the answer Atlas proposes and where it comes from (your answer bank,
// your Setup answers, Gemini with its reason, or "yours" when Atlas never answers it). You can
// change any answer before pressing Fill all. You still press the site's own Submit.
//
// Everything in it is plain text built with textContent: nothing from the page or from Atlas is
// ever run as markup. It lives in a closed shadow root, so the page cannot read or restyle it.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (globalThis.__atlasPanel) return;

  const host = document.createElement("div");
  host.setAttribute("data-atlas-panel", "");
  Object.assign(host.style, { position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647" });
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .box { width: 380px; max-height: 72vh; display: flex; flex-direction: column; background: #fff; color: #171717; border: 1px solid #d4d4d4; border-radius: 12px; font: 13px/1.45 -apple-system, system-ui, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.18); overflow: hidden; }
    @media (prefers-color-scheme: dark) { .box { background: #1a1a1a; color: #ededed; border-color: #3a3a3a; } .row, .head, .foot { border-color: #2a2a2a !important; } input, textarea, select { background: #232323 !important; color: #ededed !important; border-color: #3a3a3a !important; } .muted { color: #a1a1a1 !important; } }
    .head { padding: 10px 12px; border-bottom: 1px solid #e6e6e6; display: flex; gap: 8px; align-items: flex-start; }
    .head .t { flex: 1; min-width: 0; }
    .title { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
    .muted { color: #6b6e7d; font-size: 12px; }
    .list { overflow-y: auto; padding: 4px 12px; }
    .row { padding: 8px 0; border-bottom: 1px solid #e6e6e6; }
    .row:last-child { border-bottom: 0; }
    .q { font-weight: 500; overflow-wrap: anywhere; }
    .req { color: #e5484d; }
    .chip { display: inline-block; margin: 4px 6px 0 0; padding: 1px 8px; border-radius: 999px; font-size: 11px; border: 1px solid; }
    .bank { color: #0b6b3a; border-color: #8fd3ad; background: #ecf8f1; }
    .elig { color: #1d4ed8; border-color: #a9c1f5; background: #eef3fe; }
    .ai { color: #6d28d9; border-color: #c9b4f5; background: #f4effe; }
    .yours { color: #b45309; border-color: #f5c48a; background: #fff4e6; }
    .ok { color: #0b6b3a; } .bad { color: #b42318; }
    input[type=text], textarea, select { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px 8px; border: 1px solid #d4d4d4; border-radius: 8px; font: inherit; background: #fff; color: inherit; }
    textarea { min-height: 64px; resize: vertical; }
    label.opt { display: flex; gap: 6px; align-items: flex-start; margin-top: 4px; font-size: 12px; }
    button { font: inherit; font-weight: 500; border-radius: 8px; padding: 7px 10px; border: 1px solid #d4d4d4; background: transparent; color: inherit; cursor: pointer; min-height: 32px; }
    button.primary { background: #6d28d9; border-color: #6d28d9; color: #fff; }
    button:disabled { opacity: .55; cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #8b5cf6; outline-offset: 1px; }
    .foot { padding: 10px 12px; border-top: 1px solid #e6e6e6; display: flex; flex-wrap: wrap; gap: 6px; }
    .note { margin: 6px 12px 0; padding: 6px 8px; border-radius: 8px; background: #fff4e6; color: #8a4b0f; font-size: 12px; }
    .small { font-size: 12px; padding: 4px 8px; min-height: 26px; }
    .mini { width: auto; }
    @media (prefers-reduced-motion: no-preference) { .box { transition: opacity .15s; } }
  `;
  root.appendChild(style);
  const box = document.createElement("div");
  box.className = "box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Atlas Autofill");
  root.appendChild(box);
  document.documentElement.appendChild(host);

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids) if (kid) n.appendChild(kid);
    return n;
  };
  const send = (msg) => api.runtime.sendMessage(msg);

  const SOURCE = {
    bank: ["Your answer bank", "bank"],
    eligibility: ["Your Setup answers", "elig"],
    resume: ["Your resume from Notion", "bank"],
    ai: ["Gemini", "ai"],
    you: ["You", "bank"],
  };

  let state = null;
  let minimized = false;

  function answerFor(q) {
    return (state.answers || []).find((a) => a.id === q.id) || { id: q.id, value: "", source: "none", why: "" };
  }

  /** The editor for one answer: a box, a list of the form's own choices, or ticks. */
  function editor(q, a) {
    if (q.kind === "file") {
      const cb = el("input", { type: "checkbox", "data-file": q.id });
      cb.checked = /resume|\bcv\b|curriculum/i.test(q.label) && !/autofill|parse/i.test(q.label);
      return el("label", { class: "opt" }, cb, el("span", { text: state.job.resume ? `Attach your ${state.job.resume} resume` : "Attach your resume for this role" }));
    }
    if (q.kind === "multiselect") {
      const wrap = el("div");
      const chosen = new Set(a.values || (a.value ? [a.value] : []));
      for (const o of q.options.slice(0, 60)) {
        const cb = el("input", { type: "checkbox", "data-multi": q.id, value: o });
        cb.checked = chosen.has(o);
        wrap.appendChild(el("label", { class: "opt" }, cb, el("span", { text: o })));
      }
      return wrap;
    }
    if (q.kind === "select" || (q.kind === "typeahead" && q.options.length > 1)) {
      const sel = el("select", { "data-answer": q.id, "aria-label": q.label });
      sel.appendChild(el("option", { value: "", text: "Leave for me" }));
      for (const o of q.options.slice(0, 200)) {
        const opt = el("option", { value: o, text: o });
        if (o === a.value) opt.selected = true;
        sel.appendChild(opt);
      }
      return sel;
    }
    if (q.kind === "checkbox") {
      const cb = el("input", { type: "checkbox", "data-answer": q.id });
      cb.checked = /^(yes|true)$/i.test(a.value || "");
      return el("label", { class: "opt" }, cb, el("span", { text: "Tick this box" }));
    }
    const long = q.kind === "textarea" || (a.value || "").length > 90;
    const input = long ? el("textarea", { "data-answer": q.id, "aria-label": q.label }) : el("input", { type: "text", "data-answer": q.id, "aria-label": q.label });
    input.value = a.value || "";
    if (a.bankId) {
      input.addEventListener("input", () => {
        const save = root.querySelector(`[data-save="${q.id}"]`);
        if (save) save.hidden = input.value.trim() === (a.value || "").trim() || !input.value.trim();
      });
    }
    return input;
  }

  function render() {
    box.textContent = "";
    const s = state;
    const answered = s.questions.filter((q) => {
      const a = answerFor(q);
      return a.value || (a.values && a.values.length) || (q.kind === "file" && /resume|cv/i.test(q.label));
    }).length;
    const head = el(
      "div",
      { class: "head" },
      el(
        "div",
        { class: "t" },
        el("div", { class: "title", text: `${s.job.perfect ? "★ " : ""}${s.job.title || "This job"}${s.job.company ? ` at ${s.job.company}` : ""}` }),
        el("div", { class: "muted", text: `From ${s.job.source || "the page"}. ${answered} of ${s.questions.length} questions answered.` }),
      ),
      el("button", { class: "small mini", "aria-label": minimized ? "Show the panel" : "Shrink the panel", text: minimized ? "Show" : "–", onclick: () => ((minimized = !minimized), render()) }),
      el("button", { class: "small mini", "aria-label": "Close the panel", text: "×", onclick: () => host.remove() }),
    );
    box.appendChild(head);
    if (minimized) return;
    for (const n of s.notes || []) box.appendChild(el("div", { class: "note", role: "status", text: n }));
    if (s.job.restricted) box.appendChild(el("div", { class: "note", text: "On LinkedIn, Indeed and Glassdoor, Atlas fills only when you press Fill all, and never moves to the next step for you." }));

    const list = el("div", { class: "list" });
    for (const q of s.questions) {
      const a = answerFor(q);
      const row = el("div", { class: "row" });
      row.appendChild(el("div", { class: "q" }, document.createTextNode(q.label), q.required ? el("span", { class: "req", text: " *" }) : null));
      row.appendChild(editor(q, a));
      const meta = el("div");
      if (a.yours) meta.appendChild(el("span", { class: "chip yours", text: `Yours: ${a.yours}` }));
      else if (SOURCE[a.source]) meta.appendChild(el("span", { class: `chip ${SOURCE[a.source][1]}`, text: SOURCE[a.source][0] }));
      if (a.why && a.source === "ai") meta.appendChild(el("div", { class: "muted", text: a.why }));
      if (a.bankId) {
        const save = el("button", {
          class: "small",
          "data-save": q.id,
          text: "Save to my answers",
          onclick: async (e) => {
            const v = root.querySelector(`[data-answer="${q.id}"]`).value;
            e.target.disabled = true;
            const r = await send({ type: "learn", id: a.bankId, value: v });
            e.target.textContent = r && r.ok ? "Saved to your answer bank" : (r && r.error) || "Not saved";
          },
        });
        save.hidden = true;
        meta.appendChild(save);
      }
      meta.appendChild(el("div", { class: "muted", "data-status": q.id }));
      row.appendChild(meta);
      list.appendChild(row);
    }
    box.appendChild(list);

    const foot = el("div", { class: "foot" });
    const fillBtn = el("button", { class: "primary", text: "Fill all", onclick: () => fillAll(fillBtn) });
    if (!s.questions.length) fillBtn.disabled = true;
    foot.appendChild(fillBtn);
    if (s.step && s.step.allowed) foot.appendChild(el("button", { text: s.step.kind === "open" ? "Open the application" : "Next step", onclick: (e) => goNext(e.target) }));
    foot.appendChild(el("button", { text: "Read again", onclick: () => send({ type: "assist" }) }));
    if (s.job.kit) foot.appendChild(el("button", { text: "Mark submitted", onclick: () => window.open(`https://atlas-optim.vercel.app/career?kit=${encodeURIComponent(s.job.kit)}#kit-check`, "_blank", "noopener") }));
    foot.appendChild(el("div", { class: "muted", style: "width:100%", text: "Atlas never submits. Check every answer, then press the site's own Submit." }));
    box.appendChild(foot);
  }

  /** What you approved in the panel, as fill instructions. */
  function collect() {
    const out = [];
    let needsFile = false;
    for (const q of state.questions) {
      if (q.kind === "file") {
        const cb = root.querySelector(`[data-file="${q.id}"]`);
        if (cb && cb.checked) {
          out.push({ id: q.id, value: "file" });
          needsFile = true;
        }
        continue;
      }
      if (q.kind === "multiselect") {
        const values = [...root.querySelectorAll(`[data-multi="${q.id}"]`)].filter((c) => c.checked).map((c) => c.value);
        if (values.length) out.push({ id: q.id, value: values[0], values });
        continue;
      }
      const field = root.querySelector(`[data-answer="${q.id}"]`);
      if (!field) continue;
      const value = field.type === "checkbox" ? (field.checked ? "Yes" : "") : String(field.value || "").trim();
      if (value) out.push({ id: q.id, value });
    }
    return { out, needsFile };
  }

  async function fillAll(btn) {
    btn.disabled = true;
    btn.textContent = "Filling…";
    const { out, needsFile } = collect();
    const r = await send({ type: "fill", answers: out, role: state.job.resume || "", needsFile });
    btn.disabled = false;
    btn.textContent = "Fill all";
    if (!r || r.error) {
      box.insertBefore(el("div", { class: "note", role: "status", text: (r && r.error) || "Filling did not finish." }), box.children[1] || null);
      return;
    }
    let filled = 0;
    for (const [id, status] of Object.entries(r.results || {})) {
      const line = root.querySelector(`[data-status="${id}"]`);
      if (!line) continue;
      const ok = status === "filled" || status === "already";
      if (ok) filled++;
      line.className = ok ? "muted ok" : "muted bad";
      line.textContent = status === "filled" ? "Filled on the page" : status === "already" ? "Already filled: left as it was" : status;
    }
    if (r.fileNote) box.insertBefore(el("div", { class: "note", text: `Resume not attached: ${r.fileNote}` }), box.children[1] || null);
    box.querySelector(".muted").textContent = `Filled ${filled} of ${out.length}. Check the page, answer what is yours, then press the site's Submit.`;
    watchDone();
  }

  async function goNext(btn) {
    btn.disabled = true;
    const r = await send({ type: "step" });
    if (r && r.moved) setTimeout(() => send({ type: "assist" }), 1500);
    else btn.textContent = "Could not move on: press it on the page";
  }

  let watching = false;
  function watchDone() {
    if (watching) return;
    watching = true;
    let tries = 0;
    const tick = async () => {
      tries++;
      const r = await send({ type: "done" }).catch(() => null);
      if (r && r.done) {
        box.insertBefore(el("div", { class: "note", role: "status", text: state.job.kit ? "The site says your application went in. Press Mark submitted to move it to Applied in Atlas." : "The site says your application went in." }), box.children[1] || null);
        return;
      }
      if (tries < 90) setTimeout(tick, 4000);
    };
    setTimeout(tick, 4000);
  }

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "atlas:show") return;
    state = { job: msg.job || {}, questions: Array.isArray(msg.questions) ? msg.questions : [], answers: Array.isArray(msg.answers) ? msg.answers : [], notes: Array.isArray(msg.notes) ? msg.notes : [], step: msg.step || null };
    minimized = false;
    if (!host.isConnected) document.documentElement.appendChild(host);
    render();
  });

  globalThis.__atlasPanel = true;
})();
