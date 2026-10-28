// ReplyMaxxing side panel: job seeker tools (Jobs and Alerts tabs).
// Your resume lives in this browser (chrome.storage). It goes to the server and the AI only when you tailor, score
// or ask who to contact, and the server never stores it. Loaded before sidepanel.js; uses its helpers at run time.

const J = { busy: "", contacts: null, last: null, pasted: null };
const JOB_TABS = [["draft", "Max"], ["jobs", "Jobs"], ["alerts", "Alerts"], ["radar", "Radar"], ["profile", "Profile"], ["account", "Settings"]];
const SELL_TABS = [["draft", "Max"], ["posts", "Posts"], ["radar", "Radar"], ["autopilot", "Autopilot"], ["profile", "Profile"], ["account", "Settings"]];
const isJobSeeker = () => !!(acct() && acct().profile && acct().profile.role === "job_seeker");
const jobCost = (k, d) => (acct() && acct().jobCosts && acct().jobCosts[k]) || d;
const jobFree = () => (acct() && acct().jobFree) || null;
const jobKeyOf = (job) => job.key || (job.id ? "li:" + job.id : (job.url || "").replace(/[?#].*$/, "") || "paste:" + (job.title + "|" + job.company).toLowerCase());
const credits = (n) => (n === 0 ? "free" : `${n} credit${n === 1 ? "" : "s"}`);

// Tabs follow the mode picked in onboarding: job seekers get Jobs and Alerts in place of Posts and Autopilot.
function syncTabs() {
  const nav = document.getElementById("tabs");
  const want = isJobSeeker() ? JOB_TABS : SELL_TABS;
  const sig = want.map((t) => t[0]).join(",");
  if (nav.dataset.sig !== sig) {
    nav.dataset.sig = sig; nav.innerHTML = "";
    want.forEach(([id, label]) => { const b = el("button", "", label); b.type = "button"; b.dataset.tab = id; nav.append(b); });
  }
  return want.map((t) => t[0]);
}

// ---------- your resume ----------
async function getResume() { return store("abResume", null); }
function b64(buf) { const u8 = new Uint8Array(buf); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
async function readResumeFile(file) {
  const name = file.name || "resume";
  if (file.size > 4e6) throw new Error("That file is over 4 MB. Try a smaller PDF or a Word file.");
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
    const r = await bg({ type: "resumeParse", file: { media_type: "application/pdf", data: b64(await file.arrayBuffer()) } });
    if (!r.ok) throw new Error(r.error || "Couldn't read that PDF.");
    return r.text;
  }
  if (/\.docx$/i.test(name)) return docxText(await file.arrayBuffer());
  if (/\.(txt|md)$/i.test(name) || /^text\//.test(file.type)) return file.text();
  throw new Error("Upload a PDF, Word (.docx) or text file.");
}
async function saveResume(name, text) {
  const clean = String(text || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 30000);
  if (clean.length < 200) throw new Error("That looks too short for a resume. Paste the full text.");
  await setStore({ abResume: { name, text: clean, at: Date.now() } });
}
// Upload or paste box. onDone runs after a save.
function resumeUploader(onDone, compact) {
  const box = el("div", compact ? "" : "card");
  const status = el("div", "muted");
  const file = el("input"); file.type = "file"; file.accept = ".pdf,.docx,.txt,.md"; file.className = "hidden";
  const up = btn("⇪ Upload resume (PDF or Word)", "ab-btn", () => file.click());
  file.onchange = async () => {
    const f = file.files && file.files[0]; if (!f) return;
    up.disabled = true; status.textContent = /\.pdf$/i.test(f.name) ? "Reading your PDF..." : "Reading your file...";
    try { await saveResume(f.name, await readResumeFile(f)); status.textContent = "✓ Saved"; onDone && onDone(); }
    catch (e) { status.textContent = ""; alertIn(box, e.message || "Couldn't read that file."); }
    finally { up.disabled = false; file.value = ""; }
  };
  const paste = el("details", "more"); paste.append(el("summary", "", "Or paste the text"));
  const ta = el("textarea"); ta.rows = 6; ta.placeholder = "Paste your whole resume here"; paste.append(ta, btn("Save resume", "ab-btn sm", async () => {
    try { await saveResume("Pasted resume", ta.value); onDone && onDone(); } catch (e) { alertIn(box, e.message); }
  }));
  box.append(up, file, status, paste, el("p", "muted small", "Your resume stays in this browser. It's only sent to write or score, and never stored on our server."));
  return box;
}

// ---------- Jobs tab ----------
async function renderJobsTab() {
  const rv = S.rv;
  const [resume, jobs, score] = await Promise.all([getResume(), store("abJobs", {}), store("abResumeScore", null)]);
  const t = await activeTab();
  let cur = null;
  if (isLinkedIn(t) && S.pageCtx && S.pageCtx.onJob) { const r = await toPage("readJob"); if (r && r.ok && r.job && r.job.title) cur = r.job; }
  if (rv !== S.rv || S.tab !== "jobs") return;
  view.innerHTML = "";
  if (J.busy) { view.append(spinner(J.busy)); return; }

  // Your resume
  const rc = el("div", "card");
  rc.append(el("div", "label", "Your resume"));
  if (!resume) {
    rc.append(el("h3", "", "Start with your current resume"), el("p", "muted", "Max uses it to tailor a version for every job you apply to."));
    rc.append(resumeUploader(() => render(), true));
  } else {
    const head = el("div", "rname"); head.append(el("span", "", "📄 " + resume.name), el("span", "muted small", `${resume.text.length.toLocaleString()} characters · ${new Date(resume.at).toLocaleDateString()}`));
    rc.append(head);
    const fr = jobFree();
    const scoreCost = fr && fr.resumeScores.used < fr.resumeScores.limit ? 0 : jobCost("resumeScore", 3);
    const row = el("div", "row");
    row.append(btn("Score my resume", "ab-btn sm", () => runResumeScore()), el("span", "cost", scoreCost === 0 ? "Free" : `${scoreCost} credits`));
    const edit = el("details", "more"); edit.append(el("summary", "", "View or fix the text"));
    const ta = el("textarea"); ta.rows = 10; ta.value = resume.text; edit.append(ta, btn("Save changes", "ab-btn sm", async () => { try { await saveResume(resume.name, ta.value); render(); } catch (e) { alertIn(rc, e.message); } }));
    const rep = el("details", "more"); rep.append(el("summary", "", "Replace it")); rep.append(resumeUploader(() => render(), true));
    rc.append(row, edit, rep);
    if (fr) rc.append(el("p", "cost", `Free plan left: ${Math.max(0, fr.resumes.limit - fr.resumes.used)} tailored resumes, ${Math.max(0, fr.resumeScores.limit - fr.resumeScores.used)} scores.`));
    if (score) rc.append(scoreSummary(score));
  }
  view.append(rc);

  // This job
  const jc = el("div", "card");
  jc.append(el("div", "label", "This job"));
  if (cur) {
    const key = jobKeyOf(cur), saved = jobs[key];
    jc.append(el("h3", "", cur.title), el("p", "muted", [cur.company, cur.location].filter(Boolean).join(" · ")));
    const fr = jobFree();
    const tc = saved && saved.versions.length ? (saved.versions.length === 1 ? 0 : jobCost("redo", 5)) : fr && fr.resumes.used < fr.resumes.limit ? 0 : jobCost("resume", 10);
    const row = el("div", "row");
    row.append(btn(saved ? "✦ New version" : "✦ Tailor resume", "ab-btn sm", () => runTailor(cur)), btn("Who to contact", "ab-btn ghost sm", () => runContacts(cur)));
    jc.append(row, el("p", "cost", `${saved ? "New version" : "Tailor"}: ${credits(tc)}${saved ? "" : " (2nd version free)"}. Who to contact: ${credits(jobCost("contacts", 2))}.`));
    if (saved) jc.append(jobLine(saved, true));
  } else {
    jc.append(el("h3", "", "Open a job on LinkedIn"), el("p", "muted", "Open any LinkedIn job posting and click ✦ Tailor my resume or Who to contact, right under Apply."));
    const ps = el("details", "more"); ps.append(el("summary", "", "Job isn't on LinkedIn? Paste it"));
    const ti = el("input"); ti.placeholder = "Job title"; const co = el("input"); co.placeholder = "Company";
    const de = el("textarea"); de.rows = 6; de.placeholder = "Paste the full job description";
    ps.append(ti, co, de, btn("✦ Tailor my resume", "ab-btn sm", () => {
      if (de.value.trim().length < 150) return alertIn(ps, "Paste the full job description (at least a few lines).");
      runTailor({ id: "", title: ti.value.trim() || "Job", company: co.value.trim(), location: "", url: "", description: de.value.trim(), team: [] });
    }));
    jc.append(ps);
  }
  view.append(jc);

  if (J.last) { view.append(tailorSummary(J.last.job, J.last.out)); }
  if (J.contacts) view.append(contactsCard(J.contacts.job, J.contacts.out));

  // Your jobs
  const list = Object.values(jobs).sort((a, b) => b.at - a.at);
  if (list.length) {
    const lc = el("div", "card");
    lc.append(el("div", "label", `Your jobs (${list.length})`));
    list.slice(0, 25).forEach((j) => lc.append(jobLine(j)));
    view.append(lc);
  }
}
function jobLine(j, compact) {
  const line = el("div", "rrow");
  const main = el("div", "rmain");
  const last = j.versions[j.versions.length - 1] || {};
  main.append(el("div", "rname", compact ? `${j.versions.length} version${j.versions.length === 1 ? "" : "s"}` : `${j.title}${j.company ? " · " + j.company : ""}`),
    el("div", "rsub", [last.match && last.match.after != null ? `Match ${last.match.after}%` : "", j.applied ? "✓ Applied" : "", new Date(j.at).toLocaleDateString()].filter(Boolean).join(" · ")));
  line.append(main, btn("Open", "act", () => openResume(j.key)));
  if (!compact) line.append(btn(j.applied ? "Applied ✓" : "Applied?", "act ghost", async () => { const all = await store("abJobs", {}); if (all[j.key]) { all[j.key].applied = !all[j.key].applied; await setStore({ abJobs: all }); render(); } }));
  if (j.contacts && !compact) line.append(btn("Contacts", "act ghost", () => { J.contacts = { job: j, out: j.contacts }; render(); setTimeout(() => { const c = document.getElementById("contacts-card"); if (c) c.scrollIntoView({ block: "start" }); }, 50); }));
  return line;
}
const openResume = (key, v) => chrome.tabs.create({ url: chrome.runtime.getURL("resume.html?key=" + encodeURIComponent(key) + (v ? "&v=" + v : "")) });

function jobErr(r, retry) {
  const c = el("div", "");
  if (r.code === "limit" || r.code === "no_plan") renderError(c, { code: r.code === "no_plan" ? "limit" : r.code, msg: limitMsg(r), topup: r.topup, upgradeTo: r.upgradeTo, trialEndsNow: r.trialEndsNow });
  else { c.append(el("div", "err", r.error || "Something went wrong.")); if (retry) c.append(btn("Try again", "ab-btn ghost", retry)); }
  return c;
}

async function runTailor(job, notes) {
  const resume = await getResume();
  if (!resume) { S.tab = "jobs"; render(); return setTimeout(() => alertIn(view, "Add your resume first, then click Tailor again."), 200); }
  if (!job.description || job.description.length < 150) { S.tab = "jobs"; render(); return setTimeout(() => alertIn(view, "Max couldn't read the job description. Scroll to “About the job” on LinkedIn, then try again, or paste it."), 200); }
  S.tab = "jobs"; J.busy = "Tailoring your resume to this job: matching keywords, rewriting bullets with the XYZ formula..."; J.contacts = null; render();
  const key = jobKeyOf(job);
  const r = await bg({ type: "resumeTailor", resume: resume.text, job, jobKey: key, notes });
  J.busy = ""; syncUsage(r);
  if (!r.ok) { render(); setTimeout(() => view.prepend(jobErr(r, () => runTailor(job, notes))), 120); return; }
  const all = await store("abJobs", {});
  const entry = all[key] || { key, id: job.id || "", title: job.title, company: job.company, location: job.location, url: job.url, team: job.team || [], description: job.description, versions: [], applied: false };
  entry.description = job.description; entry.at = Date.now();
  entry.versions.push({ at: Date.now(), resume: r.resume, match: r.match, fillIns: r.fillIns, gaps: r.gaps, changes: r.changes, notes: notes || "", nextCost: r.nextCost });
  entry.nextCost = r.nextCost;
  all[key] = entry;
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at); keys.slice(40).forEach((k) => delete all[k]); // keep the 40 newest
  await setStore({ abJobs: all });
  if (r.allowances && S.me) S.me.account.jobFree = r.allowances;
  J.last = { job: entry, out: r };
  render();
}
function tailorSummary(job, r) {
  const c = el("div", "card hi");
  c.append(el("div", "label", `✦ Tailored for ${job.title}${job.company ? " at " + job.company : ""}`));
  if (r.match && r.match.after != null) {
    const m = el("div", "match");
    m.append(el("span", "muted", "Match"), el("b", "", `${r.match.before ?? "?"}% → ${r.match.after}%`));
    c.append(m);
  }
  if (r.match && r.match.keywordsAdded && r.match.keywordsAdded.length) c.append(el("p", "small", "Keywords added: " + r.match.keywordsAdded.join(", ")));
  if (r.fillIns && r.fillIns.length) c.append(el("p", "warnline small", `${r.fillIns.length} number${r.fillIns.length === 1 ? "" : "s"} to fill in (marked like [X%]). Max never makes up results.`));
  c.append(btn("Open, edit and download →", "ab-btn", () => openResume(job.key || jobKeyOf(job))));
  if (r.gaps && r.gaps.length) {
    const g = el("details", "more"); g.append(el("summary", "", `Gaps to address (${r.gaps.length})`));
    r.gaps.forEach((x) => { const d = el("div", "gap"); d.append(el("b", "", x.gap), el("p", "small", x.advice)); g.append(d); });
    c.append(g);
  }
  c.append(btn("Who to contact", "ab-btn ghost sm", () => runContacts(job)));
  return c;
}

// ---------- resume score ----------
async function runResumeScore() {
  const resume = await getResume();
  if (!resume) return;
  S.tab = "jobs"; J.busy = "Scoring your resume like a recruiter would..."; render();
  const target = acct() && acct().profile && acct().profile.targetRole;
  const r = await bg({ type: "resumeScore", resume: resume.text, target });
  J.busy = ""; syncUsage(r);
  if (!r.ok) { render(); setTimeout(() => view.prepend(jobErr(r, runResumeScore)), 120); return; }
  if (r.allowances && S.me) S.me.account.jobFree = r.allowances;
  await setStore({ abResumeScore: { ...r, at: Date.now() } });
  S.openScore = true; render();
}
function scoreSummary(sc) {
  const box = el("details", "more"); if (S.openScore) { box.open = true; S.openScore = false; }
  const sum = el("summary", ""); sum.append(el("b", "", `Resume score ${sc.score}/100 · ${sc.grade}`)); sum.style.color = scoreColor(sc.score);
  box.append(sum);
  if (sc.summary) box.append(el("p", "small", sc.summary));
  if (sc.topFixes && sc.topFixes.length) { const ol = el("ol", "small"); sc.topFixes.forEach((f) => ol.append(el("li", "", f))); box.append(el("div", "label", "Fix these first"), ol); }
  sc.sections.forEach((x) => {
    const d = el("div", "sec " + x.status);
    const hd = el("div", "sec-hd"); hd.append(el("b", "", x.label), el("span", "pts", `${x.score}/10`));
    d.append(hd);
    if (x.found) d.append(el("p", "muted small", x.found));
    if (x.fix) d.append(el("p", "small", "Fix: " + x.fix));
    if (x.example) d.append(el("p", "small ex", x.example));
    box.append(d);
  });
  if (sc.keywordsMissing && sc.keywordsMissing.length) box.append(el("p", "small", "Missing keywords for your target: " + sc.keywordsMissing.join(", ")));
  return box;
}

// ---------- who to contact ----------
async function runContacts(job) {
  S.tab = "jobs"; J.busy = "Finding who to reach out to and writing your messages..."; render();
  const resume = await getResume();
  const r = await bg({ type: "jobContacts", job: { title: job.title, company: job.company, location: job.location, url: job.url, description: job.description, team: job.team || [] }, resume: resume ? resume.text : "" });
  J.busy = ""; syncUsage(r);
  if (!r.ok) { render(); setTimeout(() => view.prepend(jobErr(r, () => runContacts(job))), 120); return; }
  const all = await store("abJobs", {});
  const key = jobKeyOf(job);
  if (all[key]) { all[key].contacts = r; all[key].at = Date.now(); await setStore({ abJobs: all }); }
  J.contacts = { job, out: r }; J.last = null;
  render();
  setTimeout(() => { const c = document.getElementById("contacts-card"); if (c) c.scrollIntoView({ block: "start" }); }, 80);
}
function copyBlock(label, text, limit) {
  const w = el("div", "msgblock");
  const hd = el("div", "rname"); hd.append(el("span", "label", label));
  if (limit) hd.append(el("span", "muted small", `${text.length}/${limit}`));
  const t = el("div", "line", text);
  const cp = btn("Copy", "act ghost", async () => { try { await navigator.clipboard.writeText(text); cp.textContent = "Copied ✓"; setTimeout(() => (cp.textContent = "Copy"), 1500); } catch {} });
  hd.append(cp); w.append(hd, t);
  return w;
}
function contactsCard(job, r) {
  const c = el("div", "card hi"); c.id = "contacts-card";
  c.append(el("div", "label", `Who to contact · ${job.title}${job.company ? " at " + job.company : ""}`));
  if (r.summary) c.append(el("p", "", r.summary));
  const KIND = { hiring_team: "On the posting", hiring_manager: "Hiring manager", recruiter: "Recruiter", peer: "On the team" };
  (r.contacts || []).forEach((p) => {
    const row = el("div", "rrow"); const main = el("div", "rmain");
    main.append(el("div", "rname", (p.name ? p.name + " · " : "") + (p.title || "")), el("div", "rsub wrap", `${KIND[p.kind] || ""}${p.why ? " · " + p.why : ""}`));
    row.append(main);
    if (p.url) row.append(btn("Open", "act", () => toPage("goto", { url: p.url })));
    else if (p.search) row.append(btn("Find", "act ghost", () => toPage("goto", { url: "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(p.search) })));
    c.append(row);
  });
  if (r.connectNote) c.append(copyBlock("Connection note", r.connectNote, 300));
  if (r.afterApply) c.append(copyBlock("After you apply (DM)", r.afterApply));
  if (r.followUp) c.append(copyBlock("Follow up in 5 to 7 days", r.followUp));
  if (r.commentPlan && r.commentPlan.length) { c.append(el("div", "label", "Get noticed: what to comment on")); const ul = el("ul", "small"); r.commentPlan.forEach((x) => ul.append(el("li", "", x))); c.append(ul); }
  if (r.watchouts && r.watchouts.length) { const ul = el("ul", "small warnline"); r.watchouts.forEach((x) => ul.append(el("li", "", x))); c.append(ul); }
  c.append(el("p", "muted small", "Tip: open their profile and click Ask Max, then Draft an opener, to write from their latest post. You always press Send."));
  return c;
}

// ---------- Alerts (job seekers: its own tab; everyone else: inside Radar) ----------
const SELL_ALERT_ROLES = ["founder", "consultant", "freelancer", "sales", "recruiter", "other"];
const alertsRole = () => (acct() && acct().profile && acct().profile.role) || "";
const hasAlerts = () => isJobSeeker() || SELL_ALERT_ROLES.includes(alertsRole());
const ALERT_COPY = {
  founder: ["Buying signals", "people describing the problem you solve, asking for recommendations, new leaders and funding at companies that fit"],
  consultant: ["Clients ready to talk", "people asking for a coach or consultant, venting about the problem you solve, or newly promoted into roles you help"],
  freelancer: ["Projects up for grabs", "people asking for a freelancer or agency, needing help with work you do, or launching something new"],
  sales: ["Trigger events", "new leaders in the titles you sell to, funding, hiring sprees and posts about the pain you solve"],
  other: ["Opportunities", "people in your audience starting new roles, launching something or asking for help you can give"],
  recruiter: ["Hiring and talent signals", "companies hiring for roles you recruit for, leaders growing their team and strong people open to work"],
};
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
async function renderAlertsTab(embedded) {
  const rv = S.rv;
  const [st, settings] = await Promise.all([store("abAlerts", null), store("settings", {})]);
  bg({ type: "clearAlertBadge" });
  if (st && !st.seen) { st.seen = true; setStore({ abAlerts: st }); }
  if (rv !== S.rv || (embedded ? S.tab !== "radar" : S.tab !== "alerts")) return;
  if (!embedded) view.innerHTML = "";
  const seeker = isJobSeeker();
  const p = (acct() && acct().profile) || {};
  const on = settings.alertsOn !== false;
  const web = seeker ? settings.alertsWeb !== false : settings.alertsWeb === true;
  const ready = seeker ? !!p.targetRole : !!(p.offer || p.titles);
  const copy = seeker ? ["Who's hiring", "posts that mention hiring for your role"] : ALERT_COPY[alertsRole()] || ALERT_COPY.consultant;
  const head = el("div", "card soft");
  head.append(el("div", "label", "Morning alerts"), el("h3", "", !ready ? (seeker ? "Add your target role first" : "Add your offer and audience first") : seeker ? `Who's hiring: ${p.targetRole}` : copy[0]));
  head.append(el("p", "muted small", `Max flags ${copy[1]} when you open your feed. Free.` + (isFree() ? "" : ` Web search finds more each morning for ${credits(jobCost("alerts", 3))} a day.`)));
  const row = el("div", "row");
  const setS = async (k, v) => { const s2 = await store("settings", {}); s2[k] = v; await setStore({ settings: s2 }); render(); };
  row.append(btn(on ? "Feed alerts ✓" : "Feed alerts off", on ? "ab-btn ghost sm" : "ab-btn sm", () => setS("alertsOn", !on)));
  if (!isFree()) row.append(btn(web ? "Web search ✓" : "Web search off", web ? "ab-btn ghost sm" : "ab-btn sm", () => setS("alertsWeb", !web)));
  head.append(row);
  const row2 = el("div", "row");
  if (!isFree() && ready) row2.append(btn("Check now", "ab-btn sm", async (e) => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = "Searching...";
    const r = await bg({ type: "alertsNow" }); syncUsage(r);
    if (!r.ok) { render(); setTimeout(() => view.prepend(jobErr(r)), 120); return; }
    render();
  }));
  row2.append(btn("Open feed", "ab-btn ghost sm", () => toPage("goto", { url: "https://www.linkedin.com/feed/" })));
  if (!ready) row2.append(btn("Update setup", "ab-btn ghost sm", () => { S.setupStep = 1; S.tab = "setup"; render(); }));
  head.append(row2);
  view.append(head);
  const today = st && st.day === todayKey() ? st : null;
  if (!today || (!today.feed.length && !today.web.length && !today.follow.length)) {
    view.append(el("div", "empty", today && today.webError ? today.webError : "Nothing yet today. Open your feed and Max will check it."));
    return;
  }
  if (today.tip) view.append(el("div", "card soft small", "💡 " + today.tip));
  const post = (x) => {
    const r = el("div", "rrow"); const main = el("div", "rmain");
    main.append(el("div", "rname", `${x.author || "Someone"}${x.company ? " · " + x.company : ""}${x.kind && x.kind !== "Hiring" ? " · " + x.kind : ""}`), el("div", "rsub wrap", x.snippet));
    if (x.why || x.action || (x.match && x.match.length)) main.append(el("div", "small", [x.why, x.action, x.match && x.match.length ? "Mentions: " + x.match.join(", ") : ""].filter(Boolean).join(" · ")));
    r.append(main);
    if (x.url) r.append(btn("Open", "act", () => (/linkedin\.com/.test(x.url) ? toPage("goto", { url: x.url }) : bg({ type: "openUrl", url: x.url }))));
    return r;
  };
  if (today.feed.length) { const c = el("div", "card"); c.append(el("div", "label", `On your feed (${today.feed.length})`)); today.feed.forEach((x) => c.append(post(x))); view.append(c); }
  if (today.web.length) { const c = el("div", "card"); c.append(el("div", "label", `Fresh on the web (${today.web.length})`)); today.web.forEach((x) => c.append(post(x))); view.append(c); }
  if (today.follow.length) {
    const c = el("div", "card"); c.append(el("div", "label", "People to follow"));
    today.follow.forEach((f) => { const r = el("div", "rrow"); const m = el("div", "rmain"); m.append(el("div", "rname", f.name + (f.title ? " · " + f.title : "")), el("div", "rsub wrap", f.why || "")); r.append(m, btn("Open", "act", () => (/linkedin\.com/.test(f.url) ? toPage("goto", { url: f.url }) : bg({ type: "openUrl", url: f.url })))); c.append(r); });
    view.append(c);
  }
  view.append(el("p", "muted small", seeker ? "Comment on a hiring post with something specific before you message the poster. It makes your name familiar." : "Lead with help, not a pitch: a useful comment or a quick congrats first, then Ask Max for an opener on their profile."));
}

// ---------- onboarding: the job search step ----------
const JS_YEARS = ["", "0 to 2 years", "3 to 5 years", "6 to 10 years", "10+ years"];
const JS_WORK = ["Remote", "Hybrid", "On site"];
const JS_GAPS = ["Career change", "Employment gap", "Missing a skill the roles ask for", "No degree", "Returning after a break", "Recently laid off", "First job"];
const JS_TIMELINE = ["ASAP", "1 to 3 months", "3 to 6 months", "Just exploring"];
function jobSearchStep(card, p) {
  p.job = p.job && typeof p.job === "object" ? p.job : {};
  const j = p.job;
  const multi = (label, opts, key) => {
    card.append(el("label", "lbl", label));
    const chips = el("div", "chips");
    opts.forEach((o) => chips.append(btn(o, "chip" + ((j[key] || []).includes(o) ? " on" : ""), () => { const cur = new Set(j[key] || []); cur.has(o) ? cur.delete(o) : cur.add(o); j[key] = [...cur]; renderSetup(); })));
    card.append(chips);
  };
  card.append(fieldEl(p, ["level", "Experience level", "", "level"]));
  const yf = el("div", "field"); yf.append(el("label", "", "Years of experience")); const ys = el("select");
  JS_YEARS.forEach((o) => { const op = el("option", "", o || "Choose one"); op.value = o; if (o === j.years) op.selected = true; ys.append(op); }); ys.onchange = () => (j.years = ys.value); yf.append(ys); card.append(yf);
  card.append(fieldEl(p, ["currentRole", "Current or most recent role", "Senior Product Analyst at Lyft", "", true]));
  card.append(fieldEl(p, ["industry", "Target industries or companies", "Fintech and marketplaces: Stripe, Ramp, Airbnb", "", true]));
  multi("Where you want to work", JS_WORK, "workType");
  card.append(fieldEl(p, ["location", "Location", "SF Bay Area", "", true]));
  const sk = el("div", "field"); sk.append(el("label", "", "Your top skills")); const si = el("input"); si.placeholder = "SQL, A/B testing, roadmaps, stakeholder management"; si.value = j.skills || ""; si.oninput = () => (j.skills = si.value.trim()); sk.append(si); card.append(sk);
  multi("Anything that could hold you back? Max will help you address it", JS_GAPS, "gaps");
  const wf = el("div", "field"); const wl = el("label", "", "Anything you're worried about"); wl.append(el("span", "opt", " optional")); wf.append(wl);
  const wt = el("textarea"); wt.rows = 2; wt.placeholder = "No direct PM title yet, but I've run product work as an analyst."; wt.value = j.worry || ""; wt.oninput = () => (j.worry = wt.value.trim()); wf.append(wt); card.append(wf);
  card.append(el("label", "lbl", "Timeline"));
  const tl = el("div", "chips"); JS_TIMELINE.forEach((o) => tl.append(btn(o, "chip" + (j.timeline === o ? " on" : ""), () => { j.timeline = o; renderSetup(); }))); card.append(tl);
  const rs = el("div", "field"); rs.append(el("label", "", "Your resume"));
  getResume().then((r) => { if (r) rs.append(el("p", "muted small", "✓ " + r.name + " saved. You can replace it in the Jobs tab.")); else rs.append(resumeUploader(() => renderSetup(), true)); });
  card.append(rs);
}
function jobAboutLines(p) {
  const j = p.job || {}; const L = [];
  if (j.years) L.push("Years of experience: " + j.years);
  if (j.workType && j.workType.length) L.push("Wants to work: " + j.workType.join(", "));
  if (j.skills) L.push("Top skills: " + j.skills);
  if (j.gaps && j.gaps.length) L.push("Gaps to address: " + j.gaps.join(", "));
  if (j.worry) L.push("Their concern: " + j.worry);
  if (j.timeline) L.push("Timeline: " + j.timeline);
  return L;
}

// LinkedIn job page buttons ("Tailor my resume", "Who to contact") hand the job over through storage.
function takeJobRun(x) {
  if (!x || Date.now() - x.at > 60000 || !S.me || !active()) return false;
  chrome.storage.local.remove("abJobRun");
  if (x.action === "contacts") runContacts(x.job); else runTailor(x.job);
  return true;
}
