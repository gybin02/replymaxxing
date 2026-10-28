// Printable profile review. Opened from the Profile tab ("Export PDF"); Save as PDF uses Chrome's print dialog.
const DEFAULTS = { reportName: "", reportCompany: "", bookingLink: "", reportEmail: "" };
const ROLES = { consultant: "Consultant or coach", founder: "Founder", freelancer: "Freelancer or agency", sales: "Sales or BD", recruiter: "Recruiter", job_seeker: "Job seeker", other: "Professional" };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const color = (n) => (n >= 85 ? "#10935f" : n >= 70 ? "#4e62f5" : n >= 50 ? "#c27a00" : "#b42318");
const statusText = (s) => (s === "strong" ? "Strong" : s === "missing" ? "Missing" : "Needs work");
const $ = (id) => document.getElementById(id);
let FREE = false; // free plan PDFs carry a small "Made with ReplyMaxxing" line

async function load() {
  const key = new URLSearchParams(location.search).get("key") || "";
  const d = await chrome.storage.local.get(["abProfileReports", "abProfileReport", "settings", "me"]);
  FREE = !!(d.me && d.me.account && d.me.account.free);
  const rep = (d.abProfileReports || {})[key] || (key === "me" || !key ? d.abProfileReport : null);
  const me = { ...DEFAULTS, ...(d.settings || {}) };
  for (const k of Object.keys(DEFAULTS)) if (!me[k]) me[k] = DEFAULTS[k];
  if (!me.reportName || !me.bookingLink) document.querySelector("details.me").open = true;
  $("fName").value = me.reportName; $("fCompany").value = me.reportCompany; $("fBook").value = me.bookingLink; $("fEmail").value = me.reportEmail;
  if (!rep) { $("doc").append(el("div", "page", "No report found. Score a profile first, then click Export PDF.")); return; }
  render(rep, me);
}

function render(rep, me) {
  const doc = $("doc"); doc.innerHTML = "";
  const first = (rep.name || "").split(" ")[0] || "you";
  const theirs = rep.own !== false;
  document.title = `LinkedIn Profile Review - ${rep.name || "Profile"}`; // becomes the PDF file name
  const hero = el("section", "hero");
  hero.append(el("div", "eye", "LinkedIn profile review"), el("h1", "", rep.name || "Your profile"));
  if (rep.url) { const a = el("a", "", rep.url.replace(/^https?:\/\/(www\.)?/, "")); a.href = rep.url; hero.append(a); }
  const date = new Date(rep.at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  hero.append(el("div", "by", me.reportName ? `Prepared by ${[me.reportName, me.reportCompany].filter(Boolean).join(", ")} · ${date}` : date));
  doc.append(hero);

  const page = el("section", "page");
  const focus = el("div", "focus");
  focus.append(el("span", "k", theirs ? "Scored as a" : `${first} is a`), el("span", "tag-role", ROLES[rep.role] || "Professional"),
    el("span", "k", "who wants to"), el("span", "tag-goal", (rep.goal || "grow on LinkedIn").replace(/^./, (c) => c.toLowerCase())));
  page.append(focus);

  const top = el("div", "top");
  const ring = el("div", "ring"); ring.style.setProperty("--p", rep.score); ring.style.setProperty("--c", color(rep.score));
  const inner = el("div"); inner.append(el("b", "", String(rep.score)), el("span", "", "out of 100")); ring.append(inner);
  const meta = el("div");
  const g = el("div", "grade", rep.grade); g.style.color = color(rep.score);
  meta.append(g, el("p", "", rep.summary || ""));
  top.append(ring, meta); page.append(top);

  if (rep.topFixes && rep.topFixes.length) {
    const fx = el("div", "fixes"); fx.append(el("div", "lbl", "Fix these first"));
    const ol = el("ol"); rep.topFixes.slice(0, 3).forEach((f) => ol.append(el("li", "", f))); fx.append(ol);
    page.append(fx);
  }

  page.append(el("h2", "", "Section by section"));
  const order = ["headline", "banner", "photo", "contact", "about", "featured", "activity", "experience", "skills", "proof"]; // top to bottom, like the profile
  [...rep.sections].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).forEach((x) => {
    const s = el("div", "sec " + x.status);
    const hd = el("div", "sec-hd"); hd.append(el("b", "", x.label), el("span", "pill " + x.status, statusText(x.status)), el("span", "pts", `${x.score}/10`));
    const bar = el("div", "bar"); const i = el("i"); i.style.width = Math.max(4, x.score * 10) + "%"; i.style.background = color(x.score * 10); bar.append(i);
    s.append(hd, bar);
    const kv = (k, v, cls) => { if (!v) return; const r = el("div", "kv " + (cls || "")); r.append(el("span", "k", k), el("span", "v", v)); s.append(r); };
    kv("Now", x.found || (x.status === "missing" ? "Not on the profile yet." : ""));
    kv(x.status === "strong" ? "Keep" : "Improve", x.fix, "imp");
    kv("Why it matters", x.why);
    if (x.rewrite) { const r = el("div", "rw"); r.append(el("small", "", x.key === "banner" ? "Text for your banner" : "Suggested rewrite"), document.createTextNode(x.rewrite)); s.append(r); }
    page.append(s);
  });

  if (me.bookingLink) {
  const cta = el("div", "cta");
  const left = el("div");
  left.append(el("h3", "", "Want help putting this into action?"),
    el("p", "", `${me.reportCompany || me.reportName || "We"} can help you make these changes and turn your profile into conversations. Grab a free call and we'll map out your next steps.`));
  const link = el("a", "link", me.bookingLink.replace(/^https?:\/\//, "")); link.href = me.bookingLink; left.append(link);
  const go = el("a", "go", "Book a free call →"); go.href = me.bookingLink;
  cta.append(left, go);
  page.append(cta);
  }
  const foot = el("div", "foot");
  foot.append(el("span", "", [me.reportName, me.reportCompany, me.reportEmail].filter(Boolean).join(" · ") || "Made with ReplyMaxxing"), el("span", "", "Scores are based on the public profile."));
  page.append(foot);
  if (FREE) { const mw = el("div", "made"); const a = el("a", "", "Made with ReplyMaxxing"); a.href = "https://replymaxxing.com"; mw.append(a); page.append(mw); }
  doc.append(page);
}

$("print").onclick = () => window.print();
$("saveMe").onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const patch = { reportName: $("fName").value.trim(), reportCompany: $("fCompany").value.trim(), bookingLink: $("fBook").value.trim(), reportEmail: $("fEmail").value.trim() };
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  document.querySelector("details.me").open = false;
  load();
};
load();
