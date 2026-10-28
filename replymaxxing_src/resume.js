// Tailored resume editor: edit in place, then download as PDF (Chrome's Save as PDF) or Word (.docx built here).
// Everything stays in this browser. A new version goes through the background worker like every other Max request.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const qs = new URLSearchParams(location.search);
const KEY = qs.get("key") || "";
let JOB = null, V = 0, R = null; // the job entry, version index, resume being edited
const PH = /\[[^\]\n]{1,40}\]/g;

async function load() {
  const { abJobs = {} } = await chrome.storage.local.get("abJobs");
  JOB = abJobs[KEY];
  if (!JOB || !JOB.versions || !JOB.versions.length) { $("doc").append(el("p", "", "No tailored resume found. Open a job on LinkedIn and click ✦ Tailor my resume.")); return; }
  const want = parseInt(qs.get("v") || "", 10);
  V = Number.isFinite(want) && want >= 1 && want <= JOB.versions.length ? want - 1 : JOB.versions.length - 1;
  show();
}
function show() {
  const ver = JOB.versions[V];
  if (!ver.original) ver.original = JSON.parse(JSON.stringify(ver.resume));
  R = ver.resume;
  $("tbTitle").textContent = `${R.name || "Your"} resume${JOB.company ? " for " + JOB.company : ""}`;
  $("tbSub").textContent = `${JOB.title || "Tailored version"} · version ${V + 1} of ${JOB.versions.length} · click any text to edit`;
  renderDoc(); renderSide(); marks();
}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const { abJobs = {} } = await chrome.storage.local.get("abJobs");
    if (!abJobs[KEY]) return;
    abJobs[KEY].versions[V] = JOB.versions[V];
    await chrome.storage.local.set({ abJobs });
  }, 400);
}

// ---------- the resume page ----------
function edit(tag, cls, text, set, ph) {
  const e = el(tag, cls, text || "");
  e.contentEditable = "plaintext-only"; e.spellcheck = true;
  if (ph) e.dataset.ph = ph;
  e.addEventListener("input", () => { set(e.innerText.replace(/\n+/g, " ").trim()); save(); marks(); });
  e.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); e.blur(); } });
  return e;
}
function bulletList(list, onChange) {
  const ul = el("ul");
  list.forEach((b, i) => {
    const li = el("li");
    li.append(edit("span", "", b, (v) => { list[i] = v; }));
    const x = el("button", "x", "✕"); x.title = "Remove this bullet";
    x.onclick = () => { list.splice(i, 1); save(); onChange(); };
    li.append(x); ul.append(li);
  });
  return ul;
}
function renderDoc() {
  const d = $("doc"); d.innerHTML = "";
  d.append(edit("h1", "", R.name, (v) => (R.name = v)));
  d.append(edit("div", "hl", R.headline, (v) => (R.headline = v)));
  const c = R.contact || (R.contact = {});
  const ct = el("div", "ct");
  ["email", "phone", "location", "linkedin", "website"].filter((k) => c[k]).forEach((k, i) => { if (i) ct.append(" | "); ct.append(edit("span", "", c[k], (v) => (c[k] = v))); });
  d.append(ct);
  if (R.summary) { d.append(el("h2", "", "Summary")); d.append(edit("p", "", R.summary, (v) => (R.summary = v))); }
  if (R.skills && R.skills.length) {
    d.append(el("h2", "", "Skills"));
    R.skills.forEach((g) => { const p = el("p", "sk"); if (g.group) p.append(el("b", "", g.group + ": ")); p.append(edit("span", "", g.items.join(", "), (v) => (g.items = v.split(/\s*,\s*/).filter(Boolean)))); d.append(p); });
  }
  if (R.experience && R.experience.length) {
    d.append(el("h2", "", "Experience"));
    R.experience.forEach((e) => {
      const w = el("div", "ent");
      const h = el("div", "eh");
      const left = el("div", "");
      left.append(edit("span", "t", e.title, (v) => (e.title = v)), document.createTextNode(", "), edit("span", "t", e.company, (v) => (e.company = v)));
      const dates = el("div", "d"); dates.append(edit("span", "", e.start, (v) => (e.start = v)), document.createTextNode(" to "), edit("span", "", e.end, (v) => (e.end = v)));
      h.append(left, dates); w.append(h);
      if (e.location) w.append(edit("div", "es", e.location, (v) => (e.location = v)));
      w.append(bulletList(e.bullets, renderDoc));
      const add = el("button", "add", "+ Add a bullet"); add.onclick = () => { e.bullets.push("Accomplished [X] as measured by [Y], by doing [Z]"); save(); renderDoc(); marks(); };
      w.append(add); d.append(w);
    });
  }
  if (R.projects && R.projects.length) {
    d.append(el("h2", "", "Projects"));
    R.projects.forEach((p) => { const w = el("div", "ent"); w.append(edit("div", "t", p.name, (v) => (p.name = v))); w.querySelector(".t").style.fontWeight = "700"; w.append(bulletList(p.bullets, renderDoc)); d.append(w); });
  }
  if (R.education && R.education.length) {
    d.append(el("h2", "", "Education"));
    R.education.forEach((e) => {
      const w = el("div", "ent"); const h = el("div", "eh");
      const left = el("div", ""); left.append(edit("span", "t", e.school, (v) => (e.school = v)));
      const deg = [e.degree, e.field].filter(Boolean).join(", ");
      if (deg) { left.append(document.createTextNode(", ")); left.append(edit("span", "", deg, (v) => { e.degree = v; e.field = ""; })); }
      h.append(left, edit("div", "d", [e.start, e.end].filter(Boolean).join(" to "), (v) => { e.start = ""; e.end = v; }));
      w.append(h); if (e.details) w.append(edit("p", "", e.details, (v) => (e.details = v)));
      d.append(w);
    });
  }
  if (R.certifications && R.certifications.length) { d.append(el("h2", "", "Certifications")); d.append(bulletList(R.certifications, renderDoc)); }
}
// Yellow highlight on every [placeholder] (CSS Custom Highlight API, so the text itself stays clean).
function marks() {
  const doc = $("doc"); const ranges = []; let n = 0;
  const walk = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) { for (const m of t.data.matchAll(PH)) { const r = new Range(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); ranges.push(r); n++; } }
  try { CSS.highlights.set("ph", new Highlight(...ranges)); } catch {}
  const w = $("phWarn");
  w.classList.toggle("hidden", !n);
  w.textContent = n ? `${n} placeholder${n === 1 ? "" : "s"} like [X%] still need your real numbers. Click them to type. If you don't have a number, rewrite the line without it.` : "";
}

// ---------- side panel: versions, match, fill ins, gaps, new version ----------
function renderSide() {
  const s = $("side"); s.innerHTML = "";
  const ver = JOB.versions[V];
  const vb = el("div", "box"); vb.append(el("h4", "", "Versions"));
  const vs = el("div", "vers");
  JOB.versions.forEach((_, i) => { const b = el("button", i === V ? "on" : "", `v${i + 1}`); b.onclick = () => { V = i; show(); }; vs.append(b); });
  vb.append(vs);
  const reset = el("button", "btn ghost sm", "Undo my edits"); reset.style.marginTop = "8px";
  reset.onclick = () => { if (!ver.original) return; ver.resume = JSON.parse(JSON.stringify(ver.original)); save(); show(); };
  vb.append(reset); s.append(vb);
  if (ver.match && ver.match.after != null) {
    const m = el("div", "box"); m.append(el("h4", "", "Match for this job"));
    const sc = el("div", "score"); sc.append(el("b", "", `${ver.match.before ?? "?"}% → ${ver.match.after}%`)); m.append(sc);
    if (ver.match.keywordsAdded && ver.match.keywordsAdded.length) { m.append(el("p", "", "Keywords now in your resume")); const k = el("div", "kw"); ver.match.keywordsAdded.forEach((x) => k.append(el("span", "", x))); m.append(k); }
    if (ver.match.keywordsMissing && ver.match.keywordsMissing.length) { m.append(el("p", "", "Asked for, but not in your background")); const k = el("div", "kw miss"); ver.match.keywordsMissing.forEach((x) => k.append(el("span", "", x))); m.append(k); }
    s.append(m);
  }
  if (ver.fillIns && ver.fillIns.length) {
    const f = el("div", "box"); f.append(el("h4", "", "Fill in your numbers"));
    ver.fillIns.forEach((x) => { const p = el("p", "fill"); p.append(el("b", "", x.placeholder), document.createTextNode(" " + x.hint)); p.onclick = () => findText(x.placeholder); f.append(p); });
    f.append(el("p", "muted", "Max never makes up results. Use your real numbers, or a careful estimate you can explain in an interview."));
    s.append(f);
  }
  if (ver.gaps && ver.gaps.length) {
    const g = el("div", "box"); g.append(el("h4", "", "Gaps to address"));
    const ul = el("ul"); ver.gaps.forEach((x) => { const li = el("li"); li.append(el("b", "", x.gap + ". "), document.createTextNode(x.advice)); ul.append(li); }); g.append(ul); s.append(g);
  }
  if (ver.changes && ver.changes.length) { const c = el("div", "box"); c.append(el("h4", "", "What Max changed")); const ul = el("ul"); ver.changes.forEach((x) => ul.append(el("li", "", x))); c.append(ul); s.append(c); }
  const nv = el("div", "box"); nv.append(el("h4", "", "Make another version"));
  const ta = el("textarea"); ta.rows = 3; ta.placeholder = "Tell Max what to change: lead with my checkout project, shorter summary, more on leadership..."; nv.append(ta);
  const cost = JOB.versions.length === 1 ? 0 : JOB.nextCost != null && JOB.versions.length > 1 ? JOB.nextCost : 5;
  const go = el("button", "btn sm", `✦ New version · ${cost === 0 ? "free" : cost + " credits"}`); go.style.marginTop = "8px";
  const msg = el("p", "muted", "");
  go.onclick = async () => {
    const { abResume } = await chrome.storage.local.get("abResume");
    if (!abResume) { msg.textContent = "Add your resume in the Jobs tab first."; return; }
    if (!JOB.description) { msg.textContent = "Open the job on LinkedIn and tailor from there to make a new version."; return; }
    go.disabled = true; go.textContent = "Max is rewriting...";
    const r = await chrome.runtime.sendMessage({ type: "resumeTailor", resume: abResume.text, job: { title: JOB.title, company: JOB.company, location: JOB.location || "", url: JOB.url || "", description: JOB.description, team: JOB.team || [] }, jobKey: KEY, notes: ta.value.trim() });
    if (!r || !r.ok) { go.disabled = false; go.textContent = "Try again"; msg.textContent = (r && r.error) || "Something went wrong."; return; }
    const { abJobs = {} } = await chrome.storage.local.get("abJobs");
    const entry = abJobs[KEY] || JOB;
    entry.versions.push({ at: Date.now(), resume: r.resume, match: r.match, fillIns: r.fillIns, gaps: r.gaps, changes: r.changes, notes: ta.value.trim() });
    entry.nextCost = r.nextCost; entry.at = Date.now();
    abJobs[KEY] = entry; await chrome.storage.local.set({ abJobs });
    JOB = entry; V = JOB.versions.length - 1; show();
  };
  nv.append(go, msg); s.append(nv);
}
function findText(t) {
  const walk = document.createTreeWalker($("doc"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const i = n.data.indexOf(t);
    if (i >= 0) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + t.length); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); n.parentElement.scrollIntoView({ block: "center" }); n.parentElement.focus(); return; }
  }
}

// ---------- plain text ----------
function plainText(r) {
  const L = [r.name, r.headline, ["email", "phone", "location", "linkedin", "website"].map((k) => r.contact && r.contact[k]).filter(Boolean).join(" | "), ""];
  if (r.summary) L.push("SUMMARY", r.summary, "");
  if (r.skills && r.skills.length) { L.push("SKILLS"); r.skills.forEach((g) => L.push((g.group ? g.group + ": " : "") + g.items.join(", "))); L.push(""); }
  if (r.experience && r.experience.length) { L.push("EXPERIENCE"); r.experience.forEach((e) => { L.push(`${[e.title, e.company].filter(Boolean).join(", ")}${e.location ? ", " + e.location : ""} | ${[e.start, e.end].filter(Boolean).join(" to ")}`); e.bullets.forEach((b) => L.push("• " + b)); L.push(""); }); }
  if (r.projects && r.projects.length) { L.push("PROJECTS"); r.projects.forEach((p) => { L.push(p.name); p.bullets.forEach((b) => L.push("• " + b)); }); L.push(""); }
  if (r.education && r.education.length) { L.push("EDUCATION"); r.education.forEach((e) => L.push([e.school, [e.degree, e.field].filter(Boolean).join(", "), [e.start, e.end].filter(Boolean).join(" to ")].filter(Boolean).join(" | ") + (e.details ? "\n" + e.details : ""))); L.push(""); }
  if (r.certifications && r.certifications.length) { L.push("CERTIFICATIONS"); r.certifications.forEach((c) => L.push("• " + c)); }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- Word (.docx): a tiny zip writer plus WordprocessingML ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const size = central.reduce((t, p) => t + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
const x = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (t, o = {}) => `<w:r><w:rPr>${o.b ? "<w:b/>" : ""}${o.i ? "<w:i/>" : ""}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ""}${o.caps ? "<w:caps/>" : ""}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const para = (runs, o = {}) => `<w:p><w:pPr>${o.center ? '<w:jc w:val="center"/>' : ""}${o.rule ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="222222"/></w:pBdr>' : ""}${o.tab ? '<w:tabs><w:tab w:val="right" w:pos="10800"/></w:tabs>' : ""}<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"/>${o.bullet ? '<w:ind w:left="360" w:hanging="240"/>' : ""}</w:pPr>${runs}</w:p>`;
function docx(r) {
  const P = [];
  P.push(para(run(r.name, { b: true, sz: 36 }), { center: true }));
  if (r.headline) P.push(para(run(r.headline, { sz: 22 }), { center: true }));
  const ct = ["email", "phone", "location", "linkedin", "website"].map((k) => r.contact && r.contact[k]).filter(Boolean).join(" | ");
  if (ct) P.push(para(run(ct, { sz: 19 }), { center: true, after: 80 }));
  const H = (t) => P.push(para(run(t, { b: true, caps: true, sz: 21 }), { rule: true, before: 200, after: 80 }));
  const B = (t) => P.push(para(run("•  " + t), { bullet: true, after: 30 }));
  if (r.summary) { H("Summary"); P.push(para(run(r.summary))); }
  if (r.skills && r.skills.length) { H("Skills"); r.skills.forEach((g) => P.push(para((g.group ? run(g.group + ": ", { b: true }) : "") + run(g.items.join(", ")), { after: 30 }))); }
  if (r.experience && r.experience.length) {
    H("Experience");
    r.experience.forEach((e) => {
      P.push(para(run([e.title, e.company].filter(Boolean).join(", "), { b: true }) + `<w:r><w:tab/></w:r>` + run([e.start, e.end].filter(Boolean).join(" to ")), { tab: true, before: 100 }));
      if (e.location) P.push(para(run(e.location, { i: true, sz: 20 })));
      e.bullets.forEach(B);
    });
  }
  if (r.projects && r.projects.length) { H("Projects"); r.projects.forEach((p) => { P.push(para(run(p.name, { b: true }), { before: 80 })); p.bullets.forEach(B); }); }
  if (r.education && r.education.length) { H("Education"); r.education.forEach((e) => { P.push(para(run([e.school, [e.degree, e.field].filter(Boolean).join(", ")].filter(Boolean).join(", "), { b: true }) + `<w:r><w:tab/></w:r>` + run([e.start, e.end].filter(Boolean).join(" to ")), { tab: true, before: 60 })); if (e.details) P.push(para(run(e.details))); }); }
  if (r.certifications && r.certifications.length) { H("Certifications"); r.certifications.forEach(B); }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${P.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  return zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ["word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ["word/document.xml", doc],
    ["word/styles.xml", styles],
  ]);
}
const fileBase = () => [R.name || "Resume", "Resume", JOB.company].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, "").trim();

$("dlPdf").onclick = () => { const t = document.title; document.title = fileBase(); window.print(); setTimeout(() => (document.title = t), 1000); };
$("dlDocx").onclick = () => { const a = el("a"); a.href = URL.createObjectURL(docx(R)); a.download = fileBase() + ".docx"; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
$("copyTxt").onclick = async () => { try { await navigator.clipboard.writeText(plainText(R)); $("copyTxt").textContent = "Copied ✓"; setTimeout(() => ($("copyTxt").textContent = "Copy text"), 1500); } catch {} };
load();
