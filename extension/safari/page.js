// Atlas Autofill's helper inside the page itself. Some sites draw their dropdowns with a library
// (React Select, used by Greenhouse and many others) that ignores clicks a script makes, so the
// extension cannot open them like a person would. This helper reads and picks their options
// through the dropdown component instead, as if you had clicked.
//
// It is asked only by Atlas Autofill's form reader, through events on the page, about one field
// the reader marked (data-atlas-q). It can read a dropdown's options and pick options by their
// exact label. It sends nothing anywhere, reads nothing else, and never submits.

(() => {
  if (window.__atlasPageHelper) return;
  window.__atlasPageHelper = true;

  const fiberOf = (el) => {
    const k = Object.keys(el).find((x) => x.startsWith("__reactFiber") || x.startsWith("__reactInternalInstance"));
    return k ? el[k] : null;
  };

  /** The React Select component that draws this field, if one does. */
  function reactSelect(el) {
    for (let f = fiberOf(el), i = 0; f && i < 50; f = f.return, i++) {
      const s = f.stateNode;
      if (s && typeof s.selectOption === "function" && s.props && Array.isArray(s.props.options)) return s;
    }
    return null;
  }

  const flat = (opts) => opts.flatMap((o) => (o && Array.isArray(o.options) ? o.options : [o]));
  const labelOf = (s, o) => {
    try {
      return String(s.getOptionLabel ? s.getOptionLabel(o) : o.label).replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  };
  const key = (t) => String(t).toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

  document.addEventListener("atlas:req", (e) => {
    let req;
    try {
      req = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (!req || typeof req.q !== "string" || !/^q\d{1,4}$/.test(req.q)) return;
    const el = document.querySelector(`[data-atlas-q="${req.q}"]`);
    const s = el ? reactSelect(el) : null;
    const res = { n: req.n, ok: false, options: [], multi: false };
    if (s) {
      const options = flat(s.props.options).filter(Boolean);
      res.options = options.map((o) => labelOf(s, o)).filter(Boolean).slice(0, 200);
      res.multi = Boolean(s.props.isMulti);
      res.ok = true;
      if (req.op === "pick" && Array.isArray(req.labels)) {
        let picked = 0;
        for (const want of req.labels.slice(0, 20)) {
          const hit = options.find((o) => key(labelOf(s, o)) === key(want)) || options.find((o) => key(labelOf(s, o)).startsWith(key(want)) && key(want).length >= 2);
          if (hit) {
            s.selectOption(hit);
            picked++;
          }
        }
        res.picked = picked;
      }
    }
    document.dispatchEvent(new CustomEvent("atlas:res", { detail: JSON.stringify(res) }));
  });
})();
