// Atlas Autofill, the part that reads and fills a job application form. Injected only when you
// ask (the A in your toolbar, then Help me apply), into the tab you are on and the frames of
// the job-application sites the extension is allowed on.
//
// read()   finds every question: its words, whether it is required, its kind (text, a list, a
//          search-and-pick box, Yes/No buttons, radios, checkboxes, a file) and the choices it
//          offers. Labels are found the way a person reads them: the label, or the nearest text
//          above the field that belongs to it alone. Placeholders like "Enter" are ignored.
// fill()   puts in the answers you approved in the panel: types into boxes, picks the matching
//          choice in lists and search boxes, ticks radios and checkboxes, and attaches the resume.
// job()    the job's title and company, from the page's own data, not the tab's title.
// steps()  the button that moves the application forward (Apply now, Next, Continue).
// done()   whether the page says the application went in.
//
// What it never does: click Submit or anything that sends the application, press Enter in a
// form, change a field you already filled, or touch password, payment or CAPTCHA fields. It
// sends nothing anywhere: the extension's background does the talking to Atlas.

(() => {
  if (globalThis.__atlasForm) return;

  const norm = (s) =>
    String(s || "")
      // Invisible characters some forms put in an empty label.
      .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
      .replace(/[\u00a0\s]+/g, " ")
      .replace(/\s*\*\s*$/, "")
      .trim();
  const key = (s) => norm(s).toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Words that are not a question: placeholders and widget chrome. */
  const FILLER = /^(enter|search|select|select\.\.\.|select one|choose|choose\.\.\.|please select|-+.*-+|type to search|start typing.*|no file chosen|attach|upload|browse|or|\*|optional|required|dropbox|google drive|enter manually|paste|drag and drop.*|accepted file types.*|\(file types.*\)|choose file)$/i;
  /** Buttons that send or finish an application: never clicked. */
  const SENDS = /submit|send( my)? application|send$|finish|complete (my )?application|confirm and apply|^apply$|apply (now|for (this )?(job|position|role))|review and submit|^done$|^save$|save and (exit|close)/i;
  /** Buttons that move to the next step of a form. */
  const NEXT = /^(next|continue|next step|save (and|&) continue|continue to (next|step)|proceed)\b/i;
  /** A link or button that opens the application from a job page. */
  const OPEN = /^(apply( now| for this (job|position|role))?|start (your )?application|i'?m interested)$/i;
  /** Sites where Atlas only fills on your click and never moves the form forward for you. */
  const RESTRICTED = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.[a-z.]+)$/i;
  /** Fields no tool fills. */
  const NEVER = /password|passcode|captcha|recaptcha|hcaptcha|card number|cvv|cvc|security code|routing|account number|social security|\bssn\b/i;

  // -------------------------------------------------------------------------
  // Seeing the page

  function view(el) {
    return (el.ownerDocument && el.ownerDocument.defaultView) || globalThis;
  }

  /** A control a person can see. File inputs are often hidden behind a button: those count when their label shows. */
  function visible(el) {
    if (el.disabled) return false;
    if (el.tagName === "INPUT" && (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete"))) {
      // The typing box of a search-and-pick list can be a few pixels wide: judge it by the first box around it with real size.
      let box = el.parentElement;
      for (let i = 0; box && i < 6 && box.getBoundingClientRect().width < 40; i++) box = box.parentElement;
      if (box) return visible(box);
    }
    // Radios and checkboxes are often hidden and drawn by their label: judge them by the label.
    if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox")) {
      const label = (el.labels && el.labels[0]) || el.closest("label");
      if (label && label !== el) {
        const r = label.getBoundingClientRect();
        if (r.width >= 4 && r.height >= 4) {
          for (let n = label; n && n.nodeType === 1; n = n.parentElement) {
            const s = view(n).getComputedStyle(n);
            if (s.display === "none" || s.visibility === "hidden") return false;
          }
          return true;
        }
      }
    }
    const target = el.type === "file" ? el.closest("label, [class*=upload], [class*=Upload], [class*=dropzone], [class*=file]") || el.parentElement || el : el;
    if (!target.getClientRects || target.getClientRects().length === 0) return false;
    const r = target.getBoundingClientRect();
    if (el.type !== "file" && (r.width < 4 || r.height < 4)) return false;
    for (let n = target; n && n.nodeType === 1; n = n.parentElement) {
      const s = view(n).getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.05) return false;
    }
    return true;
  }

  /** Every element under a root, including inside open shadow roots. */
  function everything(root) {
    const out = [];
    const walk = (node) => {
      for (const el of node.querySelectorAll("*")) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  }

  function textOf(el) {
    return norm(el && (el.innerText !== undefined ? el.innerText : el.textContent));
  }

  /** The lines of text inside `box` that are not filler and not one of `skip`. */
  function lines(box, skip) {
    return String(box.innerText || box.textContent || "")
      .split(/\n+/)
      .map(norm)
      .filter((l) => l && l.length <= 400 && !FILLER.test(l) && !skip.has(l.toLowerCase()));
  }

  const isButton = (el) => el.tagName === "BUTTON" || el.getAttribute("role") === "button" || (el.tagName === "INPUT" && /^(button|submit)$/i.test(el.type));
  const buttonText = (el) => norm(el.innerText || el.value || el.getAttribute("aria-label") || "");

  /** True for anything that could send the application. Such an element is never clicked. */
  function sends(el) {
    if (!el) return true;
    const btn = el.closest("button, [role=button], input[type=submit], input[type=button], a");
    if (!btn) return false;
    if (btn.tagName === "INPUT" && btn.type === "submit") return true;
    // A <button> inside a form with no type is a submit button.
    if (btn.tagName === "BUTTON" && (btn.getAttribute("type") || "submit").toLowerCase() === "submit" && btn.closest("form")) return true;
    return SENDS.test(buttonText(btn));
  }

  // -------------------------------------------------------------------------
  // Questions

  /** Words that name a field: its label, then aria, then the nearest text above it that is its own. */
  function questionFor(el, controls, skip) {
    const direct = [];
    for (const l of el.labels || []) direct.push(textOf(l));
    for (const id of (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)) direct.push(textOf(el.ownerDocument.getElementById(id)));
    direct.push(norm(el.getAttribute("aria-label")));
    const legend = el.closest("fieldset") && el.closest("fieldset").querySelector("legend");
    if (legend) direct.push(textOf(legend));
    const good = direct.map((t) => beforeOptions(t, skip)).filter((t) => t && !FILLER.test(t) && !skip.has(t.toLowerCase()));
    if (good.length) return good[0];
    // Walk up through the boxes that hold this question and no other. A label is the text that
    // comes before the field; a hint below it ("Keep in mind...") is used only when nothing comes before.
    let after = "";
    for (let n = el.parentElement, depth = 0; n && depth < 8; n = n.parentElement, depth++) {
      const others = controls.filter((c) => n.contains(c) && !skip.own.has(c)).length;
      if (others > 0) break;
      const before = textBefore(n, el, skip);
      if (before) return before;
      if (!after) after = lines(n, skip)[0] || "";
    }
    if (after) return after;
    return norm(el.getAttribute("placeholder") && !FILLER.test(el.getAttribute("placeholder")) ? el.getAttribute("placeholder") : el.getAttribute("name") || el.id || "");
  }

  /** The first line of text inside `box` that comes before `el`, and is not filler or an option. */
  function textBefore(box, el, skip) {
    const doc = box.ownerDocument;
    const walker = doc.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const parts = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!(t.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      const host = t.parentElement;
      if (!host || !visible(host)) continue;
      const line = norm(t.textContent);
      if (line && !FILLER.test(line) && !skip.has(line.toLowerCase())) parts.push(line);
    }
    // "Email" then "*" in its own span reads as one label.
    return parts.length ? norm(parts.join(" ")).slice(0, 400) : "";
  }

  /** A label that wraps its own list reads "Gender Decline to answer Female Male": keep the words before the first choice. */
  function beforeOptions(t, skip) {
    let cut = t.length;
    for (const o of skip) {
      if (!o || o.length < 2) continue;
      const at = t.toLowerCase().indexOf(o, 1);
      if (at > 0 && at < cut) cut = at;
    }
    return norm(t.slice(0, cut));
  }

  function requiredFor(el, label, box) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    if (/\*\s*$/.test(String(label))) return true;
    const head = norm(label).slice(0, 40).toLowerCase();
    for (let n = box, i = 0; n && i < 5; n = n.parentElement, i++) {
      const raw = String(n.innerText || "").replace(/\s+/g, " ").toLowerCase();
      if (head && raw.includes(head)) return /\*/.test(raw.slice(raw.indexOf(head), raw.indexOf(head) + head.length + label.length + 4)) || Boolean(n.querySelector("[class*=required], abbr[title*=required]"));
    }
    return false;
  }

  const isCombo = (el) =>
    el.getAttribute("role") === "combobox" ||
    el.getAttribute("aria-autocomplete") === "list" ||
    el.getAttribute("aria-haspopup") === "listbox" ||
    Boolean(el.closest("[class*=select__control], [class*=Select-control], [class*=react-select], [data-automation-id*=selectWidget], [class*=multiselect], [class*=MultiSelect]"));

  /** The options a list shows right now: visible [role=option] elements, from the list this control owns when it says which. */
  function shownOptions(el) {
    const doc = el.ownerDocument;
    const owned = (el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean).map((id) => doc.getElementById(id)).filter(Boolean);
    const pool = owned.length ? owned.flatMap((o) => [...o.querySelectorAll("[role=option]")]) : everything(doc).filter((n) => n.getAttribute && n.getAttribute("role") === "option");
    return pool.filter((o) => visible(o) && textOf(o));
  }

  /** Opens a search-and-pick list without choosing anything, reads its options, and closes it. */
  async function peekOptions(el) {
    try {
      el.focus();
      const opener = el.closest("[class*=control], [class*=Control]") || el;
      opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
      await wait(250);
      const options = [...new Set(shownOptions(el).map(textOf))].slice(0, 120);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      el.blur();
      await wait(60);
      return options;
    } catch {
      return [];
    }
  }

  let refs = new Map();

  /**
   * Asks the page helper (page.js, inside the page) about one marked field: its dropdown's
   * options, or to pick options by label. Null when no helper answers, or the field is not a
   * library dropdown.
   */
  let asked = 0;
  function helper(op, el, labels) {
    const q = el.getAttribute("data-atlas-q");
    if (!q) return Promise.resolve(null);
    const n = ++asked;
    return new Promise((resolve) => {
      const done = (e) => {
        let res;
        try {
          res = JSON.parse(e.detail);
        } catch {
          return;
        }
        if (!res || res.n !== n) return;
        document.removeEventListener("atlas:res", done);
        resolve(res.ok ? res : null);
      };
      document.addEventListener("atlas:res", done);
      document.dispatchEvent(new CustomEvent("atlas:req", { detail: JSON.stringify({ op, q, n, labels: labels || [] }) }));
      setTimeout(() => {
        document.removeEventListener("atlas:res", done);
        resolve(null);
      }, 400);
    });
  }

  /**
   * Every question on this frame's form, in page order. Each: { id, label, required, kind, options }.
   * The elements are kept here, by id, for fill().
   */
  async function read() {
    refs = new Map();
    const all = everything(document);
    const raw = all.filter((el) => {
      if (el.tagName === "INPUT") return !/^(hidden|submit|button|image|reset|search|password)$/i.test(el.type) && (el.type === "file" || visible(el));
      // (A radio or checkbox drawn by its label counts as visible: see visible().)
      if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return visible(el);
      const role = el.getAttribute && el.getAttribute("role");
      return (role === "radio" || role === "checkbox" || role === "combobox") && el.tagName !== "INPUT" && visible(el) && !el.querySelector("input");
    });
    // Yes/No style answers drawn as buttons (Ashby and others): a row of short buttons, none of which sends.
    const choiceRows = new Map();
    for (const b of all.filter((el) => el.tagName === "BUTTON" && visible(el))) {
      const row = b.parentElement;
      if (!row || choiceRows.has(row)) continue;
      const btns = [...row.children].filter((c) => c.tagName === "BUTTON" && visible(c));
      if (btns.length < 2 || btns.length > 6) continue;
      // A button with no type sends its form; outside any form it is a plain button (Ashby's Yes/No).
      const plain = (c) => {
        const t = (c.getAttribute("type") || "").toLowerCase();
        return t === "button" || (!t && !c.closest("form"));
      };
      if (btns.some((c) => !plain(c) || sends(c) || NEXT.test(buttonText(c)) || buttonText(c).length > 40)) continue;
      if (row.querySelector("input, select, textarea")) continue;
      choiceRows.set(row, btns);
    }
    const controls = [...raw, ...[...choiceRows.values()].flat()];
    const questions = [];
    const seen = new Set();
    const add = (q, els) => {
      const id = `q${questions.length + 1}`;
      for (const e of els) if (e.el && e.el.setAttribute) e.el.setAttribute("data-atlas-q", id);
      refs.set(id, { ...q, els });
      questions.push({ id, label: q.label.slice(0, 400), required: q.required, kind: q.kind, options: q.options || [] });
    };

    for (const el of controls) {
      if (seen.has(el)) continue;
      const own = new Set([el]);
      const skip = Object.assign(new Set(), { own });
      const role = el.getAttribute("role");
      const type = String(el.type || "").toLowerCase();
      const describe = `${el.getAttribute("name") || ""} ${el.id || ""} ${el.getAttribute("autocomplete") || ""}`;
      if (NEVER.test(describe) || NEVER.test(String(el.getAttribute("aria-label") || ""))) continue;

      // A group of radios (by name, or by their radiogroup).
      if (type === "radio" || role === "radio") {
        const isRadio = (c) => c.type === "radio" || c.getAttribute("role") === "radio";
        // Some forms (Gem) give their radios no name and no group: the smallest box that holds
        // this radio and another, and nothing but radios, is the question's set of choices.
        const box = () => {
          for (let n = el.parentElement, i = 0; n && i < 8; n = n.parentElement, i++) {
            const inside = controls.filter((c) => n.contains(c));
            if (inside.some((c) => !isRadio(c))) return null;
            if (inside.length > 1) return n;
          }
          return null;
        };
        const group = el.closest("[role=radiogroup], fieldset") || (type === "radio" && el.name ? null : box());
        const members = controls.filter((c) => isRadio(c) && (type === "radio" && el.name ? c.name === el.name : group ? group.contains(c) : c === el));
        for (const m of members) {
          seen.add(m);
          own.add(m);
        }
        const opts = members.map((m) => ({ el: m, text: optionLabel(m) }));
        opts.forEach((o) => skip.add(o.text.toLowerCase()));
        const label = (group && group.getAttribute("aria-label")) || questionFor(group || el, controls, skip);
        add({ label, required: requiredFor(el, label, group || el.parentElement), kind: "select", options: opts.map((o) => o.text) }, opts);
        continue;
      }
      // Checkboxes: several in one box are "select all that apply"; one alone is a yes/no box.
      if (type === "checkbox" || role === "checkbox") {
        const box = el.closest("fieldset, [role=group]") || el.parentElement && el.parentElement.parentElement;
        const members = box ? controls.filter((c) => (c.type === "checkbox" || c.getAttribute("role") === "checkbox") && box.contains(c)) : [el];
        if (members.length > 1 && box && box.closest("fieldset, [role=group]")) {
          for (const m of members) {
            seen.add(m);
            own.add(m);
          }
          const opts = members.map((m) => ({ el: m, text: optionLabel(m) }));
          opts.forEach((o) => skip.add(o.text.toLowerCase()));
          const label = questionFor(box, controls, skip);
          add({ label, required: requiredFor(el, label, box), kind: "multiselect", options: opts.map((o) => o.text) }, opts);
        } else {
          seen.add(el);
          const label = optionLabel(el) || questionFor(el, controls, skip);
          add({ label, required: requiredFor(el, label, el.parentElement), kind: "checkbox", options: [] }, [{ el, text: label }]);
        }
        continue;
      }
      // A row of choice buttons.
      const rowEntry = [...choiceRows.entries()].find(([, btns]) => btns.includes(el));
      if (rowEntry) {
        const [row, btns] = rowEntry;
        for (const b of btns) {
          seen.add(b);
          own.add(b);
          skip.add(buttonText(b).toLowerCase());
        }
        const label = questionFor(row, controls, skip);
        add({ label, required: requiredFor(btns[0], label, row.parentElement), kind: "select", options: btns.map(buttonText) }, btns.map((b) => ({ el: b, text: buttonText(b) })));
        continue;
      }
      seen.add(el);
      if (el.tagName === "SELECT") {
        const opts = [...el.options].filter((o) => o.value !== "" && norm(o.text) && !FILLER.test(norm(o.text)));
        // Every option's words, the "-- No answer --" kind included, so a label that wraps the list is cut before them.
        [...el.options].forEach((o) => norm(o.text) && skip.add(norm(o.text).toLowerCase()));
        const label = questionFor(el, controls, skip);
        add({ label, required: requiredFor(el, label, el.parentElement), kind: el.multiple ? "multiselect" : "select", options: opts.map((o) => norm(o.text)) }, [{ el }]);
        continue;
      }
      if (type === "file") {
        const label = questionFor(el, controls, skip) || "File";
        add({ label, required: requiredFor(el, label, el.parentElement), kind: "file", options: [] }, [{ el }]);
        continue;
      }
      if (isCombo(el) || role === "combobox") {
        const label = questionFor(el, controls, skip);
        el.setAttribute("data-atlas-q", `q${questions.length + 1}`);
        let options = await peekOptions(el);
        let multi = Boolean(el.closest("[class*=multi], [class*=Multi]")) || /select all|all that apply|check all/i.test(label);
        let library = false;
        if (options.length < 2) {
          const res = await helper("options", el);
          if (res && res.options.length) {
            options = res.options;
            multi = multi || res.multi;
            library = true;
          }
        }
        add({ label, required: requiredFor(el, label, el.closest("[class*=field], [class*=Field]") || el.parentElement), kind: options.length >= 2 ? (multi ? "multiselect" : "select") : "typeahead", options }, [{ el, combo: true, library }]);
        continue;
      }
      const label = questionFor(el, controls, skip);
      add({ label, required: requiredFor(el, label, el.parentElement), kind: el.tagName === "TEXTAREA" ? "textarea" : "text", options: [] }, [{ el }]);
    }
    return questions.filter((q) => q.label);
  }

  /** The words that go with one radio or checkbox. */
  function optionLabel(el) {
    for (const l of el.labels || []) if (textOf(l)) return textOf(l);
    const aria = norm(el.getAttribute("aria-label"));
    if (aria) return aria;
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return textOf(wrap);
    const next = el.nextElementSibling || (el.parentElement && el.parentElement.nextElementSibling);
    return next ? textOf(next).slice(0, 200) : norm(el.value);
  }

  // -------------------------------------------------------------------------
  // Filling

  /** Sets a value the way typing would, so React, Vue and Angular forms see it. */
  function setValue(el, value) {
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function mark(el) {
    try {
      el.style.outline = "2px solid #8b5cf6";
      el.style.outlineOffset = "2px";
      el.setAttribute("data-atlas-filled", "true");
    } catch {
      /* a field that cannot be styled */
    }
  }

  const same = (a, b) => key(a) === key(b);
  /** The option that matches an answer: the same words, then one that starts with them. */
  function match(options, value) {
    return options.find((o) => same(o.text, value)) || options.find((o) => key(o.text).startsWith(key(value)) && key(value).length >= 2) || null;
  }

  function click(el) {
    if (sends(el)) return false;
    el.click();
    return true;
  }

  async function pickFrom(el, value) {
    // Type to narrow the list, then click the option that matches.
    el.focus();
    const opener = el.closest("[class*=control], [class*=Control]") || el;
    opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    let hit = match(shownOptions(el).map((o) => ({ el: o, text: textOf(o) })), value);
    if (!hit && el.tagName === "INPUT") {
      setValue(el, value.slice(0, 60));
      for (let i = 0; i < 8 && !hit; i++) {
        await wait(150);
        hit = match(shownOptions(el).map((o) => ({ el: o, text: textOf(o) })), value);
      }
      if (!hit) {
        // A place box: the suggestion that starts with the first part of the answer ("Salt Lake City").
        const first = key(value).split(" ")[0];
        const shown = shownOptions(el).map((o) => ({ el: o, text: textOf(o) }));
        hit = first && first.length >= 3 ? shown.find((o) => key(o.text).startsWith(first)) || null : null;
      }
    }
    if (!hit) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      return false;
    }
    hit.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const ok = click(hit.el);
    await wait(80);
    return ok;
  }

  function attach(el, file) {
    if (!file || !file.base64) return false;
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name || "Resume.pdf", { type: "application/pdf" }));
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.files && el.files.length === 1;
  }

  /**
   * Fills the answers you approved: [{ id, value, values? }]. `file` is the resume to attach, as
   * { name, base64 }. Returns, per id, "filled", "already" (you had filled it), or why not.
   */
  async function fill(answers, file) {
    const out = {};
    for (const a of answers) {
      const ref = refs.get(a.id);
      if (!ref) {
        out[a.id] = "The form changed: read it again";
        continue;
      }
      try {
        out[a.id] = await fillOne(ref, a, file);
      } catch {
        out[a.id] = "Could not fill this one: do it yourself";
      }
    }
    return out;
  }

  async function fillOne(ref, a, file) {
    const value = String(a.value || "");
    const values = Array.isArray(a.values) && a.values.length ? a.values : value ? [value] : [];
    const first = ref.els[0];
    if (ref.kind === "file") {
      if (!/resume|\bcv\b|curriculum/i.test(ref.label)) return "Not a resume field: attach it yourself";
      if (first.el.files && first.el.files.length) return "already";
      return attach(first.el, file) ? "filled" : "Could not attach: drag the PDF in yourself";
    }
    if (ref.kind === "text" || ref.kind === "textarea") {
      if (String(first.el.value || "").trim()) return "already";
      if (!value) return "No answer";
      setValue(first.el, value);
      first.el.dispatchEvent(new Event("blur", { bubbles: true }));
      mark(first.el);
      return "filled";
    }
    if (ref.kind === "typeahead" || first.combo) {
      if (!values.length) return "No answer";
      // A library dropdown that ignores scripted clicks: pick through the page helper.
      if (first.library || ref.kind !== "typeahead") {
        const res = await helper("pick", first.el, values);
        if (res && res.picked) {
          mark(first.el.closest("[class*=control], [class*=Control]") || first.el);
          return res.picked === values.length ? "filled" : "Some picked: check the rest";
        }
      }
      let ok = 0;
      for (const v of values) if (await pickFrom(first.el, v)) ok++;
      if (ok) mark(first.el.closest("[class*=control], [class*=Control]") || first.el);
      return ok === values.length ? "filled" : ok ? "Some picked: check the rest" : "No matching choice: pick it yourself";
    }
    if (first.el && first.el.tagName === "SELECT") {
      if (!values.length) return "No answer";
      const opts = [...first.el.options].map((o) => ({ el: o, text: norm(o.text) }));
      const hits = values.map((v) => match(opts, v)).filter(Boolean);
      if (!hits.length) return "No matching choice: pick it yourself";
      if (first.el.multiple) hits.forEach((h) => (h.el.selected = true));
      else first.el.value = hits[0].el.value;
      first.el.dispatchEvent(new Event("input", { bubbles: true }));
      first.el.dispatchEvent(new Event("change", { bubbles: true }));
      mark(first.el);
      return "filled";
    }
    if (ref.kind === "checkbox") {
      if (!/^(yes|true|checked)$/i.test(value)) return "No answer";
      const box = first.el;
      const on = box.checked || box.getAttribute("aria-checked") === "true";
      if (!on && !click(box)) return "Could not tick it: do it yourself";
      mark(box);
      return "filled";
    }
    // Radios, checkboxes in a group, and choice buttons: click the ones that match.
    let ok = 0;
    for (const v of values) {
      const hit = match(ref.els, v);
      if (!hit) continue;
      const on = hit.el.checked || hit.el.getAttribute("aria-checked") === "true" || hit.el.getAttribute("aria-pressed") === "true";
      if (on || click(hit.el)) {
        ok++;
        mark(hit.el.closest("label") || hit.el);
      }
    }
    return ok === values.length && ok > 0 ? "filled" : ok ? "Some picked: check the rest" : "No matching choice: pick it yourself";
  }

  // -------------------------------------------------------------------------
  // The job, the next step, and whether it went in

  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent || "");
        const items = [].concat(data, (data && data["@graph"]) || []);
        for (const it of items) {
          if (!it || !/JobPosting/i.test(String(it["@type"]))) continue;
          const org = it.hiringOrganization;
          // Tags become spaces; entities (&nbsp;, &amp;) become their characters. DOMParser runs no script.
          const description = new DOMParser().parseFromString(String(it.description || "").replace(/<[^>]+>/g, " "), "text/html").body.textContent || "";
          return { title: norm(it.title), company: norm(typeof org === "string" ? org : org && org.name), posting: norm(description).slice(0, 8000) };
        }
      } catch {
        /* not JSON */
      }
    }
    return null;
  }

  const firstText = (selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && textOf(el)) return textOf(el).slice(0, 200);
    }
    return "";
  };

  /** Words a job title usually has. */
  const ROLE_WORDS = /engineer|developer|manager|designer|analyst|specialist|scientist|architect|\blead\b|intern|consultant|representative|associate|director|coordinator|administrator|technician/i;
  /** Words that are a place or a way of working, not a company ("Remote - USA"). */
  const PLACE = /\b(remote|hybrid|on-?site|in office|usa|u\.s\.?a?|united states|canada|uk|europe|emea|latam|anywhere|worldwide)\b|,\s*[A-Z]{2}\b/i;
  /** Words that are a site's section, not a company. */
  const GENERIC = /^(jobs?|careers?|home|apply|application|job board|connect|talent|hiring|work with us|join us|[a-z]+ connect)$/i;

  /** "Role at Company", "Role @ Company", "Company - Role" and the like, from a page or tab title. */
  function fromTitle(t) {
    const s = norm(t)
      .replace(/^(job application for|apply( now)? (for|to)|application( for)?:?|careers? (at|@))\s*/i, "")
      .replace(/\s*[|·–—-]\s*(linkedin|indeed(\.com)?|glassdoor|greenhouse|lever|ashby|workday|careers?|jobs?)\s*$/i, "");
    let m = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(s);
    if (m) return { title: norm(m[1]), company: norm(m[2]) };
    m = /^(.+?)\s+[-–—|]\s+(.+)$/.exec(s);
    if (m) return /engineer|developer|manager|designer|analyst|specialist|scientist|architect|lead|intern|consultant/i.test(m[1]) ? { title: norm(m[1]), company: norm(m[2]) } : { title: norm(m[2]), company: norm(m[1]) };
    return { title: s, company: "" };
  }

  /** The job this page is for: the page's own data first, then the site's own title and company, then the address. */
  function job() {
    const host = location.hostname.replace(/^www\./, "");
    const ld = fromJsonLd();
    let title = (ld && ld.title) || "";
    let company = (ld && ld.company) || "";
    let source = ld && (title || company) ? "the job's own data" : "";
    const site = [
      [/linkedin\.com$/, [".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", "h1.t-24", ".jobs-easy-apply-modal h3"], [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".jobs-easy-apply-modal .t-14"]],
      [/indeed\.com$/, ['[data-testid="jobsearch-JobInfoHeader-title"]', "h1", '[data-testid="job-title"]'], ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '[data-testid="company-name"]']],
      [/glassdoor\./, ['[data-test="job-title"]', "h1"], ['[data-test="employer-name"]', '[data-test="employerName"]']],
      [/greenhouse\.io$/, [".job__title h1", ".app-title", "h1.section-header", "h1"], [".company-name", ".job__header .logo img[alt]"]],
      [/lever\.co$/, [".posting-headline h2", "h2"], []],
      [/ashbyhq\.com$/, ["h1", '[class*="_title"]'], []],
      [/myworkdayjobs\.com$/, ['[data-automation-id="jobPostingHeader"]', "h2"], []],
    ].find(([re]) => re.test(host));
    if (site && !title) {
      title = firstText(site[1]);
      source = title ? "the job page" : source;
    }
    if (site && !company) company = firstText(site[2]);
    const t = fromTitle(document.querySelector('meta[property="og:title"]') ? document.querySelector('meta[property="og:title"]').content : document.title);
    // A heading that names a role beats the tab's title, which is often the site's name.
    const h1 =
      [...document.querySelectorAll("h1, h2, [class*=job-title], [class*=jobTitle], [class*=JobTitle], [data-testid*=title]")].map(textOf).find((h) => h && h.length < 160 && ROLE_WORDS.test(h)) ||
      // No heading: the largest text near the top that names a role.
      [...document.querySelectorAll("p, span, div")]
        .filter((n) => n.childElementCount === 0 && visible(n) && n.getBoundingClientRect().top < 600)
        .map((n) => ({ t: textOf(n), size: parseFloat(view(n).getComputedStyle(n).fontSize) || 0 }))
        .filter((x) => x.t && x.t.length < 160 && x.size >= 20 && ROLE_WORDS.test(x.t))
        .sort((a, b) => b.size - a.size)
        .map((x) => x.t)[0];
    if (!title && h1) {
      const parsed = fromTitle(h1);
      const split = parsed.company && ROLE_WORDS.test(parsed.title) && !ROLE_WORDS.test(parsed.company) && !PLACE.test(parsed.company);
      // "Role - Remote - USA": the role without the place.
      title = split || (parsed.company && PLACE.test(parsed.company) && ROLE_WORDS.test(parsed.title)) ? parsed.title : h1;
      company = company || (split ? parsed.company : "");
      source = source || "the page heading";
    }
    if (!title) {
      title = ROLE_WORDS.test(t.title) ? t.title : "";
      source = source || "the page title";
    }
    const siteName = norm(document.querySelector('meta[property="og:site_name"]') && document.querySelector('meta[property="og:site_name"]').content);
    if (!company) company = [t.company, siteName].find((c) => c && !GENERIC.test(c) && !ROLE_WORDS.test(c) && !PLACE.test(c)) || "";
    // Last: the site's own name from its address (talent.fullstack.com -> Fullstack).
    if (!company && !/linkedin|indeed|glassdoor|greenhouse|lever|ashbyhq|workday|smartrecruiters|jazzhr|applytojob|pinpointhq|bamboohr|workable|icims/.test(host)) {
      const parts = host.split(".");
      const brand = parts.length >= 2 ? parts[parts.length - 2] : "";
      company = brand ? brand[0].toUpperCase() + brand.slice(1) : "";
    }
    // Job boards that put the company in the address: boards.greenhouse.io/<company>, jobs.lever.co/<company>, jobs.ashbyhq.com/<company>.
    if (!company && /greenhouse\.io$|lever\.co$|ashbyhq\.com$/.test(host)) {
      // The board's own name in its title ("Jobs at Arva Intelligence", "Role @ Anrok") beats the address.
      const named = /(?:jobs at|careers at|@|at)\s+([^|–—-]+)$/i.exec(norm(document.title));
      company = named ? norm(named[1]) : (location.pathname.split("/")[1] || "").replace(/[-_]+/g, " ");
    }
    if (!company && /myworkdayjobs\.com$/.test(host)) company = host.split(".")[0];
    const posting = (ld && ld.posting) || norm(textOf(document.querySelector('[class*="description"], [class*="Description"], #content, main, article') || document.body)).slice(0, 8000);
    return { title: title.slice(0, 200), company: company.slice(0, 160), source: source || "the page", posting, host, restricted: RESTRICTED.test(host), url: location.href };
  }

  /** The button or link that moves this application forward, if there is one. Never one that sends it. */
  function steps() {
    const restricted = RESTRICTED.test(location.hostname.replace(/^www\./, ""));
    const items = everything(document).filter((el) => (isButton(el) || el.tagName === "A") && visible(el));
    const hasFields = everything(document).some((el) => (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") && el.type !== "hidden" && visible(el));
    for (const el of items) {
      const t = buttonText(el);
      if (!t) continue;
      // Next, Continue: only on a form, and never where it would send.
      if (NEXT.test(t) && !SENDS.test(t)) return { kind: "next", text: t.slice(0, 60), allowed: !restricted };
      // Apply now: only as a link from a job page with no form yet, so it opens the form and sends nothing.
      if (OPEN.test(t) && el.tagName === "A" && el.getAttribute("href") && !hasFields) return { kind: "open", text: t.slice(0, 60), allowed: !restricted };
    }
    return null;
  }

  /** Presses the step steps() found: Next or Continue, or follows the Apply now link. Refuses anything that sends. */
  function step() {
    const s = steps();
    if (!s || !s.allowed) return false;
    const el = everything(document).find((n) => (isButton(n) || n.tagName === "A") && visible(n) && buttonText(n).slice(0, 60) === s.text);
    if (!el) return false;
    if (s.kind === "open") {
      const href = el.getAttribute("href");
      if (!href || /^javascript:/i.test(href)) return false;
      location.assign(new URL(href, location.href).href);
      return true;
    }
    if (SENDS.test(buttonText(el))) return false;
    // A Next button is often a submit button of a multi-step form: clicked as a person would, never via form.submit().
    el.click();
    return true;
  }

  const DONE = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(submitted|received|sent|complete)|we('ve| have) received your application|your application (is|has been) (in|on its way)|successfully applied|you applied/i;
  function done() {
    return DONE.test(String((document.body && document.body.innerText) || "").slice(0, 20000));
  }

  globalThis.__atlasForm = { read, fill, job, steps, step, done, sends, fromTitle };
})();
