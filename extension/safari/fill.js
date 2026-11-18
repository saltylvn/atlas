// Atlas Autofill, the part that runs on a job application page. It is injected only when
// you press Fill in the extension's popup, into the tab you are looking at.
//
// What it does: finds the form's text fields, works out what each one asks from its label,
// and fills the empty ones it recognizes from your answer bank. It highlights what it
// filled and says how many fields are left for you.
//
// What it never does: submit, click buttons, change a field you already filled, attach a
// file, or answer work authorization, sponsorship, demographic or EEO questions. Nothing
// is sent anywhere: it reads your answers from the extension's own storage.

(() => {
  if (globalThis.__atlasFill) return;

  /** Questions that are yours alone to answer: never filled. */
  const SKIP =
    /password|social security|\bssn\b|date of birth|birth ?date|\bdob\b|gender|\bsex\b|\brace\b|ethnic|hispanic|latin[oa]|veteran|disab|pronoun|sexual orientation|authori[sz]|sponsor|\bvisa\b|citizen|work permit|right to work|criminal|felony|convict|background check|current (salary|compensation|pay|base)|salary history|previous (salary|compensation)|captcha|signature|initials|referral code|promo code|\bage\b/;

  /** Field kinds, most specific first. The first rule whose pattern matches the field's label wins. */
  const RULES = [
    ["firstName", /\bfirst name\b|\bgiven name\b|\bfname\b|\bforename\b/],
    ["lastName", /\blast name\b|\bsurname\b|\bfamily name\b|\blname\b/],
    ["fullName", /\bfull name\b|\blegal name\b|^name$|\byour name\b|^name\b(?! of)/],
    ["email", /e ?mail/],
    ["phone", /phone|mobile|\bcell\b|telephone/],
    ["linkedin", /linked ?in/],
    ["github", /git ?hub/],
    ["portfolio", /portfolio|personal (web ?)?site|\bwebsite\b|\bblog\b|other (link|url|website)|\burl\b/],
    ["rate", /hourly rate|rate per hour|your rate|bill rate/],
    ["salary", /salary|compensation|pay expectation|expected pay|desired pay|pay range/],
    ["startDate", /start date|available to start|availability to start|when (can|could) you start|earliest start|notice period/],
    ["availability", /hours (per|a) week|weekly availability|\bavailability\b/],
    ["yearsExperience", /years of (relevant |professional |total )?experience|how many years/],
    ["whyLooking", /why are you (looking|leaving)|reason for (leaving|looking)|why (do you want to )?leave/],
    ["whyCompany", /why (do you want to |would you like to |are you )?(work|join|apply)|why (are you )?interested|interest(ed)? in (this|our|the)|why us\b|what (excites|attracts|draws|interests) you|motivat/],
    ["project", /project (you are|you're|youre) proud|proudest|describe a project|recent project|project you (built|led)/],
    ["aiExperience", /\b(ai|llms?|machine learning|artificial intelligence|generative)\b.*\bexperience\b|\bexperience\b.*\b(ai|llms?|machine learning|artificial intelligence|generative)\b/],
    ["workHistory", /work history|employment history|work experience|previous (roles|positions|employers)/],
    ["coverLetter", /cover letter/],
    ["intro", /about (yourself|you)\b|tell us about you|introduce yourself|\bsummary\b|\bbio\b|additional information|anything else/],
    ["location", /relocat|\bremote\b|work location|location preference|where (are you|would you like to be) (based|located|working)/],
    ["city", /\bcity\b|\blocation\b|where do you live|current location|\baddress\b/],
  ];

  /** Kinds that are paragraphs: fine in a text area, and in a one-line box only if it has room. */
  const LONG = new Set(["intro", "whyCompany", "whyLooking", "project", "aiExperience", "workHistory", "coverLetter", "location"]);

  const AUTOCOMPLETE = { "given-name": "firstName", "family-name": "lastName", name: "fullName", email: "email", tel: "phone", "tel-national": "phone", "address-level2": "city", url: "portfolio" };

  /** A field's description as words: "firstName" and "first_name" both read "first name". */
  const words = (s) =>
    String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-./:*()?[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  /**
   * What kind of answer a field asks for, or null to leave it alone. `d` describes the field:
   * its tag, type, autocomplete hint and the words around it.
   */
  function classify(d) {
    const type = String(d.type || "").toLowerCase();
    if (["password", "file", "hidden", "checkbox", "radio", "submit", "button", "image", "reset", "date", "datetime-local", "month", "week", "time", "range", "color", "search"].includes(type)) return null;
    const text = words(d.text);
    if (!text && !d.autocomplete) return null;
    if (SKIP.test(text)) return null;
    const hint = String(d.autocomplete || "").toLowerCase().split(/\s+/).pop();
    if (hint && AUTOCOMPLETE[hint]) return AUTOCOMPLETE[hint];
    if (type === "email") return "email";
    if (type === "tel") return "phone";
    for (const [kind, re] of RULES) if (re.test(text)) return kind;
    return null;
  }

  function describe(el) {
    const parts = [];
    for (const l of el.labels || []) parts.push(l.textContent);
    parts.push(el.getAttribute("aria-label"));
    for (const id of (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)) parts.push(el.ownerDocument.getElementById(id)?.textContent);
    parts.push(el.getAttribute("placeholder"), el.getAttribute("name"), el.id, el.getAttribute("title"));
    const legend = el.closest("fieldset")?.querySelector("legend")?.textContent;
    if (legend) parts.push(legend);
    // Forms that put the question in a nearby element rather than a <label>.
    if (!(el.labels && el.labels.length) && !el.getAttribute("aria-label")) {
      const box = el.parentElement;
      const near = box?.textContent && box.textContent.length < 240 ? box.textContent : box?.previousElementSibling?.textContent;
      if (near && near.length < 240) parts.push(near);
    }
    return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || (el.tagName === "TEXTAREA" ? "textarea" : "text"), autocomplete: el.getAttribute("autocomplete") || "", text: parts.filter(Boolean).join(" ").slice(0, 600) };
  }

  /**
   * A field a person can see and type in. Hidden, see-through, pinhole and off-page fields
   * are left alone: a page could use them to collect answers it never showed you a question for.
   */
  function visible(el) {
    if (el.disabled || el.readOnly || el.getClientRects().length === 0) return false;
    const view = (el.ownerDocument && el.ownerDocument.defaultView) || globalThis;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    // Parked left of or above the page, where no amount of scrolling shows it.
    if (r.right + (view.scrollX || 0) <= 0 || r.bottom + (view.scrollY || 0) <= 0) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = view.getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" || Number(s.opacity) < 0.1) return false;
    }
    return true;
  }

  /** Sets a value the way typing would, so React and other frameworks see the change. */
  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function documents(root) {
    const out = [root];
    for (const frame of root.querySelectorAll("iframe")) {
      try {
        // Same-origin frames only: a form embedded from another site cannot be reached.
        if (frame.contentDocument) out.push(frame.contentDocument);
      } catch {
        /* another site's frame */
      }
    }
    return out;
  }

  function toast(doc, text) {
    const old = doc.getElementById("atlas-autofill-toast");
    if (old) old.remove();
    const box = doc.createElement("div");
    box.id = "atlas-autofill-toast";
    box.setAttribute("role", "status");
    box.textContent = text;
    Object.assign(box.style, { position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647", maxWidth: "340px", padding: "12px 14px", borderRadius: "10px", background: "#16181d", color: "#f5f6f7", font: "14px/1.4 -apple-system, system-ui, sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,.35)", border: "1px solid #8b5cf6" });
    doc.body.appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }

  /**
   * Fills the page. `data` is what Atlas synced; `job` is the company and role you confirmed
   * in the popup, for {company} and {role}. Returns the counts the popup shows.
   */
  function fill(data, job) {
    const f = (data && data.fields) || {};
    const company = String(job?.company || "").trim();
    const role = String(job?.role || "").trim();
    const tailor = (s) => String(s || "").replace(/\{company\}/g, company || "your company").replace(/\{role\}/g, role || "this role");
    const answers = { ...f, coverLetter: [f.intro, f.whyCompany].filter(Boolean).join("\n\n") };
    let filled = 0;
    let left = 0;
    for (const doc of documents(document)) {
      for (const el of doc.querySelectorAll("input, textarea")) {
        if (!visible(el)) continue;
        const d = describe(el);
        const kind = classify(d);
        const empty = !String(el.value || "").trim();
        const required = el.required || el.getAttribute("aria-required") === "true";
        const value = kind ? tailor(answers[kind]) : "";
        const fits = !(LONG.has(kind) && el.tagName !== "TEXTAREA" && el.maxLength > 0 && el.maxLength < value.length);
        if (kind && empty && value && fits) {
          setValue(el, value);
          el.style.outline = "2px solid #8b5cf6";
          el.style.outlineOffset = "2px";
          el.setAttribute("data-atlas-filled", kind);
          filled++;
        } else if (empty && required) left++;
      }
    }
    toast(document, filled ? `Atlas filled ${filled} field${filled === 1 ? "" : "s"} (outlined in purple).${left ? ` ${left} required field${left === 1 ? " is" : "s are"} left for you.` : ""} Review everything, then submit yourself.` : "Atlas found no empty field it recognizes on this step. If the form has more steps, press Fill again on each one.");
    return { filled, left };
  }

  globalThis.__atlasClassify = classify;
  globalThis.__atlasVisible = visible;
  globalThis.__atlasFill = fill;
})();
