// ReplyMaxxing side panel (Max): sign in, plans, setup, drafts, Radar, Autopilot and account.
// The LinkedIn tab tells the panel what to show; the panel sends your clicks back to that tab.
const CFG = self.AB_CONFIG;
const view = document.getElementById("view");
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls, onClick) => { const b = el("button", cls || "ab-btn", label); b.type = "button"; if (onClick) b.onclick = onClick; return b; };
const bg = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, (res) => r(chrome.runtime.lastError ? { ok: false, error: "Extension was updated. Close and reopen this panel." } : res || { ok: false })));
const store = async (k, d) => { try { const x = await chrome.storage.local.get(k); return x[k] ?? d; } catch { return d; } };
const setStore = async (o) => { try { await chrome.storage.local.set(o); } catch {} };
const nameKey = (n) => (n || "").toLowerCase().replace(/\s+/g, " ").trim();
const autosize = (ta) => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 4 + "px"; };
const taObserver = new ResizeObserver((es) => es.forEach((e) => { if (e.target.dataset.w !== String(e.contentRect.width)) { e.target.dataset.w = String(e.contentRect.width); autosize(e.target); } }));
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return ""; } };

const S = {
  me: null, plans: null, tab: "draft",
  draft: null,          // { sid, name, mode, label, state: "loading"|"error"|"warn"|"result", ... }
  queue: null,          // { msg, live, canStop }
  owner: null,          // { tabId, frameId } of the frame that owns the current draft
  windowId: null, activeTabId: null,
  pageCtx: null,        // { onProfile, name, onMessaging, hasChat }
  radarTab: "todo", pipeFilter: "",
  setupStep: 1, awaitingCheckout: false,
};

// ---------- invite code handed over by replymaxxing.com (see background.js) ----------
async function pendingRef() { try { const p = (await chrome.storage.local.get("pendingRef")).pendingRef; return p && p.code && Date.now() - (p.at || 0) < 30 * 864e5 ? p.code : ""; } catch { return ""; } }
const clearPendingRef = () => chrome.storage.local.remove("pendingRef").catch(() => {});
pendingRef().then((code) => {
  if (!code || S.refCode) return;
  S.refCode = code;
  const inp = document.querySelector(".invite-in input");
  if (inp && !inp.value) { inp.value = code; inp.closest("details").open = true; }
});

// ---------- theme ----------
let themePref = "system";
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() { document.documentElement.classList.toggle("ab-dark", themePref === "dark" || (themePref === "system" && darkMQ.matches)); }
darkMQ.addEventListener("change", applyTheme);

// ---------- talking to the LinkedIn tab ----------
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, windowId: S.windowId });
  S.activeTabId = t ? t.id : null;
  return t || null;
}
const isLinkedIn = (t) => !!(t && t.url && /^https:\/\/www\.linkedin\.com\//.test(t.url));
async function toPage(action, extra = {}) {
  const t = await activeTab();
  if (!isLinkedIn(t)) return { ok: false, notLinkedIn: true };
  try { return (await chrome.tabs.sendMessage(t.id, { type: "act", action, ...extra })) || { ok: false }; }
  catch { return { ok: false, error: "Refresh your LinkedIn tab so Max can connect." }; }
}
// Radar and Autopilot buttons: open someone's chat and draft. Shows why when it can't.
async function openChat(b, extra) {
  const was = b && b.textContent; if (b) { b.disabled = true; b.textContent = "Opening..."; }
  const r = await toPage("goDraft", extra);
  if (b) setTimeout(() => { b.disabled = false; b.textContent = was; }, r && r.ok ? 2500 : 0);
  if (!r || !r.ok) alertIn(document.getElementById("view") || document.body, (r && r.notLinkedIn) ? "Open LinkedIn in this tab first, then try again." : (r && r.error) || "Max couldn't reach LinkedIn. Refresh your LinkedIn tab and try again.");
  return r;
}
// Billing buttons open Stripe in a new tab. Shows "Opening..." and the reason if it can't.
async function billingBtn(b, msg) {
  const was = b.textContent; b.disabled = true; b.textContent = "Opening...";
  const r = await bg(msg);
  b.disabled = false; b.textContent = was;
  if (!r || !r.ok) alertIn(b.parentElement || document.getElementById("view"), (r && r.error) || "Billing didn't open. Try again in a minute.");
  return r;
}
async function toOwner(action, extra = {}) {
  if (!S.owner) return;
  try { await chrome.tabs.sendMessage(S.owner.tabId, { type: "act", action, sid: S.draft && S.draft.sid, ...extra }, { frameId: S.owner.frameId }); } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "ui" || !sender.tab) return;
  if (sender.tab.windowId !== S.windowId || !sender.tab.active) return;
  const v = msg.view || {};
  if (v.kind === "nav") { refreshContext(); return; }
  S.owner = { tabId: sender.tab.id, frameId: sender.frameId || 0 };
  onView(v);
});

function onView(v) {
  if (v.kind === "open") { S.draft = { sid: v.sid, name: v.name, mode: v.mode, label: v.label, batch: v.batch, state: "loading", msg: "Starting..." }; S.queue = null; if (!v.batch) S.tab = "draft"; }
  else if (!S.draft || (v.sid && v.sid !== S.draft.sid)) {
    if (v.kind === "error" && !v.sid) { S.draft = { sid: "", name: "", mode: "", state: "error", msg: v.msg }; S.tab = "draft"; }
    else if (v.kind !== "queue" && v.kind !== "sent") return;
  }
  if (v.kind === "loading") Object.assign(S.draft, { state: "loading", msg: v.msg });
  if (v.kind === "error") Object.assign(S.draft, { state: "error", msg: v.msg, code: v.code, topup: v.topup, upgradeTo: v.upgradeTo, retry: v.retry, trialEndsNow: v.trialEndsNow });
  if (v.kind === "warn") Object.assign(S.draft, { state: "warn", list: v.list });
  if (v.kind === "result") {
    Object.assign(S.draft, { state: "result", parsed: v.parsed, auto: v.auto, tip: v.tip, savedAt: v.savedAt, url: v.url, name: v.name || S.draft.name });
    if (v.usage && S.me && S.me.account) { S.me.account.usage = v.usage; renderFoot(); }
  }
  if (v.kind === "queue") S.queue = v.msg ? { msg: v.msg, live: v.live, canStop: v.canStop } : null;
  if (v.kind === "sent") onSent(v);
  if (S.draft && S.draft.code === "auth") { S.me = null; }
  if (S.draft && S.draft.code === "no_plan") refreshMe();
  render();
}

async function refreshContext() {
  const r = await toPage("context");
  S.pageCtx = r && r.ok ? r : null;
  if (S.tab === "draft" && (!S.draft)) render();
}

// ---------- account ----------
async function refreshMe() {
  const auth = await store("auth", null);
  if (!auth) { S.me = null; return null; }
  const r = await bg({ type: "me" });
  if (r.ok) S.me = r.me;
  else if (r.code === "auth") S.me = null;
  return S.me;
}
const acct = () => (S.me && S.me.account) || null;
const active = () => !!(acct() && acct().status === "active" && acct().plan !== "none");
const feat = (k) => !!(acct() && acct().features && acct().features[k]);
const isOwner = () => !!(S.me && S.me.role === "owner");
const isFree = () => !!(acct() && acct().free);
// ---------- Time saved + review ask ----------
const savedMin = () => { const a = acct(); return (a && ((a.usage && a.usage.minutesSaved) ?? a.minutesSaved)) || 0; };
function fmtSaved(m) {
  const unit = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (m < 60) return unit(m, "minute");
  if (m < 480) return unit(Math.round(m / 6) / 10, "hour");
  return unit(Math.round(m / 48) / 10, "workday");
}
const STORE_ID = "cngnjcgjemhikeeikeheolijcgmdjkej";
const reviewUrl = () => `https://chromewebstore.google.com/detail/${STORE_ID}/reviews`;
// Asks once Max has saved them an hour (a moment of real value), at most twice, 14 days apart. Never blocks anything.
async function reviewCard() {
  const r = await store("abReview", { state: "new", asks: 0, at: 0 });
  const m = savedMin();
  const due = r.state === "new" ? m >= 60 : r.state === "later" ? r.asks < 2 && Date.now() - r.at > 14 * 864e5 && m >= 120 : false;
  if (!due) return null;
  const c = el("div", "card soft review");
  const set = async (state) => { await setStore({ abReview: { state, asks: r.asks + (state === "later" ? 1 : 0), at: Date.now() } }); document.querySelectorAll(".review").forEach((x) => x.remove()); };
  c.append(el("div", "label", `⏱ ${fmtSaved(m)} saved`), el("h3", "", "Is Max earning his keep?"),
    el("p", "small", "A quick rating on the Chrome Web Store helps other coaches and founders find ReplyMaxxing. It takes 20 seconds and means a lot to a small team."));
  const row = el("div", "row");
  row.append(btn("Leave a review", "ab-btn sm", async () => { await set("done"); bg({ type: "openUrl", url: reviewUrl() }); }),
    btn("Not now", "ab-btn ghost sm", () => set("later")), btn("Don't ask again", "link", () => set("never")));
  c.append(row);
  return c;
}
const trialLabel = () => (acct() && acct().trialEligible ? `Start ${acct().trialDays || 5} day free trial` : "See plans");
// Card shown in place of a paid feature on the free plan.
function freeUpsell(title, text) {
  const c = el("div", "card soft");
  c.append(el("div", "label", "Paid plans"), el("h3", "", title), el("p", "muted", text));
  if (isOwner()) c.append(btn(trialLabel(), "ab-btn", () => { S.tab = "plans"; render(); }));
  if (acct() && acct().trialEligible) c.append(el("p", "muted", "Cancel anytime before it ends and you pay nothing."));
  return c;
}

// ---------- top-level render ----------
function render() {
  S.rv = (S.rv || 0) + 1;
  view.innerHTML = "";
  const signedIn = !!S.me;
  document.getElementById("tabs").classList.toggle("hidden", !signedIn || !active());
  const chip = document.getElementById("planChip");
  chip.classList.toggle("hidden", !active());
  if (active()) chip.textContent = (acct().planName || acct().plan) + (acct().trialing ? " · trial" : "");
  const tabIds = syncTabs();
  if (S.tab === "alerts" && !tabIds.includes("alerts")) { S.tab = hasAlerts() ? "radar" : "draft"; S.radarTab = "alerts"; }
  if (["posts", "autopilot", "jobs", "alerts"].includes(S.tab) && !tabIds.includes(S.tab) && !(S.tab === "posts" && isJobSeeker())) S.tab = "draft";
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === S.tab);
    if (b.dataset.tab === "autopilot") b.innerHTML = "Autopilot" + (feat("autopilot") ? "" : '<span class="lock">🔒</span>');
    if (b.dataset.tab === "posts") b.innerHTML = "Posts" + (isFree() ? '<span class="lock">🔒</span>' : "");
  });
  renderFoot();
  setPageHead(signedIn);
  if (!signedIn) return renderSignIn();
  if (S.me.terms && S.me.terms.accepted === false) return renderTermsUpdate();
  if (!active()) return renderPlans();
  // Required onboarding: owners finish "About you" before anything else (team members use the owner's setup).
  if (isOwner() && !profileComplete()) { if (S.tab !== "setup") { S.tab = "setup"; S.setupStep = 1; } S.forcedSetup = true; document.getElementById("tabs").classList.add("hidden"); setPageHead(true); }
  else S.forcedSetup = false;
  if (!isFree() && isOwner() && !acct().hasPlaybook && acct().about && !S.pbKick) { S.pbKick = true; bg({ type: "buildPlaybook", about: acct().about }).then(() => refreshMe()); }
  if (S.tab === "setup") return renderSetup();
  if (S.tab === "plans") return renderPlans(true);
  if (S.tab === "radar") return renderRadar();
  if (S.tab === "autopilot") return renderAutopilot();
  if (S.tab === "account") return renderAccount();
  if (S.tab === "profile") return renderProfileTab();
  if (S.tab === "posts") return renderPostsTab();
  if (S.tab === "jobs") return renderJobsTab();
  if (S.tab === "alerts") return renderAlertsTab();
  return renderDraftTab();
}
document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  S.tab = b.dataset.tab;
  if (S.tab === "draft") refreshContext();
  render();
});


// ---------- page titles (one big, clear heading per tab) ----------
const PAGE_TITLES = { jobs: "Jobs", alerts: "Alerts", draft: "Max", posts: "Posts", radar: "Radar", autopilot: "Autopilot", profile: "Profile", account: "Settings", plans: "Plans", setup: "About you" };
function setPageHead(signedIn) {
  const ph = document.getElementById("pagehead"); if (!ph) return;
  const show = signedIn && active() && !(S.me && S.me.terms && S.me.terms.accepted === false);
  ph.classList.toggle("hidden", !show);
  if (!show) return;
  document.getElementById("pageTitle").textContent = S.tab === "setup" && S.forcedSetup ? "Welcome! Let's set you up" : PAGE_TITLES[S.tab] || "Max";
}
// The 3 required onboarding answers are in: who you are, your goal, who you want to reach.
function profileComplete() {
  const p = acct() && acct().profile;
  if (!p || !p.role || !Array.isArray(p.goals) || !p.goals.length || !p.name || !p.titles) return false;
  return p.role === "job_seeker" ? !!p.targetRole : !!p.offer;
}
function renderFoot() {
  const foot = document.getElementById("foot");
  const a = acct();
  if (!a || !active() || !a.usage) return foot.classList.add("hidden");
  foot.classList.remove("hidden");
  const u = a.usage;
  const sv = document.getElementById("savedText");
  if (sv) { const m = savedMin(); sv.textContent = m ? `⏱ Max has saved you about ${fmtSaved(m)}` : ""; sv.title = "Estimated from how long each opener, reply, post and profile review takes to write by hand."; }
  const managed = feat("managed") && u.conversationLimit;
  const used = managed ? u.conversations : u.drafts;
  const limit = managed ? u.conversationLimit : u.draftLimit;
  const unit = managed ? "conversations" : "credits";
  document.getElementById("meterText").textContent = (a.trialing ? "Trial: " : "") + `${used.toLocaleString()} of ${limit.toLocaleString()} ${unit}` + (a.trialing && a.trialEnd ? ` · ends ${fmtDate(a.trialEnd)}` : a.periodEnd ? ` · resets ${fmtDate(a.periodEnd)}` : "");
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  document.getElementById("meterBar").style.width = pct + "%";
  document.querySelector(".meter").classList.toggle("full", pct >= 90);
  const act = document.getElementById("meterAction");
  const canTop = a.features && a.features.canTopup && isOwner();
  if (a.trialing && isOwner()) { act.textContent = pct >= 70 ? "Start plan now" : ""; act.onclick = endTrial; return; }
  act.textContent = pct >= 80 && canTop ? (managed ? "+50 conversations" : "+250 credits") : "";
  act.onclick = () => bg({ type: "topup", kind: managed ? "conversations" : "drafts" });
}

// ---------- sign in ----------
// Terms of Service checkbox (clickwrap). Links open the full Terms and Privacy Policy.
const legalUrl = (p) => (CFG.API_BASE || "").replace(/\/$/, "") + p;
function termsBox(label) {
  const wrap = el("label", "agree"); const box = el("input"); box.type = "checkbox";
  const t = el("span");
  const link = (txt, path) => { const a = el("a", "", txt); a.href = "#"; a.onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: legalUrl(path) }); }; return a; };
  t.append(document.createTextNode(label || "I agree to the "), link("Terms of Service", "/terms"), document.createTextNode(" and "), link("Privacy Policy", "/privacy"),
    document.createTextNode(". I understand ReplyMaxxing is not affiliated with LinkedIn, I'm responsible for my LinkedIn account, and ReplyMaxxing isn't liable if LinkedIn limits or closes it."));
  wrap.append(box, t);
  return { wrap, box };
}
// Shown when the Terms changed since this user last agreed.
function renderTermsUpdate() {
  view.innerHTML = "";
  const card = el("div", "card");
  const agree = termsBox();
  const msg = el("div", "err");
  const go = btn("Agree and continue", "ab-btn", async () => {
    if (!agree.box.checked) { msg.textContent = "Please tick the box to continue."; return; }
    go.disabled = true;
    const r = await bg({ type: "acceptTerms", version: S.me.terms.version });
    go.disabled = false;
    if (!r.ok) { msg.textContent = r.error || "Couldn't save. Try again."; return; }
    S.me = r.me; render();
  });
  card.append(el("div", "ab-eye", "Terms of Service"), el("h3", "", "We updated our Terms"), el("p", "small", "Please review and agree to keep using ReplyMaxxing."), agree.wrap, go, msg);
  view.append(card);
}
function renderSignIn(stage = "email", email = "") {
  view.innerHTML = "";
  const hero = el("div", "hero");
  hero.append(el("div", "ab-eye", "ReplyMaxxing"), el("h2", "", stage === "email" ? "Meet Max. More replies and booked calls from LinkedIn, in your voice." : "Check your email"),
    el("p", "", stage === "email" ? "Drafts openers, replies, comments and posts, scores LinkedIn profiles and shows who to follow up with. You always press Send." : `We sent a 6 digit code to ${email}.`));
  view.append(hero);
  const card = el("div", "card");
  const msg = el("div", "err");
  if (stage === "email") {
    const f = el("div", "field"); f.append(el("label", "", "Email"));
    const inp = el("input"); inp.type = "email"; inp.placeholder = "you@company.com"; inp.autocomplete = "email"; f.append(inp);
    const agree = termsBox();
    const go = btn("Email me a sign in code", "ab-btn", async () => {
      const em = inp.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(em)) { msg.textContent = "Enter a valid email."; return; }
      if (!agree.box.checked) { msg.textContent = "Please agree to the Terms of Service to continue."; return; }
      S.termsOk = true;
      go.disabled = true; go.textContent = "Sending...";
      const r = await bg({ type: "authStart", email: em });
      go.disabled = false; go.textContent = "Email me a sign in code";
      if (!r.ok) { msg.textContent = r.error || "Couldn't send the code."; return; }
      renderSignIn("code", em);
      if (r.devCode) { const c = view.querySelector("input.code"); if (c) c.value = r.devCode; }
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
    const inv = el("details", "invite-in"); inv.append(el("summary", "", "Have an invite code?"));
    const ri = el("input"); ri.type = "text"; ri.placeholder = "ABC123"; ri.maxLength = 12; ri.value = S.refCode || ""; ri.oninput = () => { S.refCode = ri.value.trim(); };
    inv.append(ri, el("p", "muted", S.refCode ? "Added from your invite link. You get 20 bonus credits after your first draft. Your friend gets 50." : "You get 20 bonus credits after your first draft. Your friend gets 50."));
    if (S.refCode) inv.open = true;
    card.append(f, agree.wrap, inv, go, msg, el("p", "muted", "No password and no API key. Use the email you paid with, or any email to see the plans."));
    view.append(card);
    setTimeout(() => inp.focus(), 50);
  } else {
    const inp = el("input", "code"); inp.type = "text"; inp.inputMode = "numeric"; inp.maxLength = 6; inp.placeholder = "000000"; inp.autocomplete = "one-time-code";
    const go = btn("Sign in", "ab-btn", async () => {
      go.disabled = true; go.textContent = "Checking...";
      const r = await bg({ type: "authVerify", email, code: inp.value.trim(), acceptTerms: !!S.termsOk, ref: S.refCode || "" });
      go.disabled = false; go.textContent = "Sign in";
      if (!r.ok) { msg.textContent = r.error || "That code didn't work."; return; }
      S.me = r.me;
      S.tab = needsSetup() ? "setup" : "draft";
      render(); refreshContext();
      if (r.referral) clearPendingRef();
      if (r.referral) { const n = el("div", r.referral.ok ? "q live" : "err", r.referral.ok ? "Invite code applied. You get 20 bonus credits after your first draft, and your friend gets 50." : r.referral.error); view.prepend(n); setTimeout(() => n.remove(), 9000); S.refCode = ""; }
    });
    inp.addEventListener("input", () => { if (inp.value.trim().length === 6) go.click(); });
    const back = btn("Use a different email", "link", () => renderSignIn("email"));
    card.append(inp, go, msg, back);
    view.append(card);
    setTimeout(() => inp.focus(), 50);
  }
}
const needsSetup = () => active() && isOwner() && !(acct().profile && (acct().profile.role || acct().profile.offer));

// ---------- plans ----------
async function renderPlans(fromAccount) {
  view.innerHTML = "";
  if (!S.plans) {
    view.append(spinner("Loading plans..."));
    const r = await bg({ type: "plans" });
    if (!r.ok) { view.innerHTML = ""; view.append(el("div", "err", r.error || "Couldn't load plans."), btn("Try again", "ab-btn ghost", () => renderPlans(fromAccount))); return; }
    S.plans = r;
    view.innerHTML = "";
  }
  const a = acct();
  const head = el("div", "");
  head.append(el("h2", "", fromAccount && a && a.free ? (a.trialEligible ? `Try any plan free for ${a.trialDays || 5} days` : "Upgrade your plan") : fromAccount ? "Change your plan" : a && a.status === "past_due" ? "Your payment didn't go through" : a && a.status === "canceled" ? "Welcome back" : "Pick a plan to start"),
    el("p", "muted", a && a.status === "past_due" ? "Update your card to keep drafting." : "Cancel anytime. Prices in USD."));
  view.append(head);
  if (a && a.status === "past_due" && isOwner()) { const ub = btn("Update payment method", "ab-btn", () => billingBtn(ub, { type: "portal" })); view.append(ub); }
  if (S.awaitingCheckout) view.append(el("div", "q live", "Finish checkout in the new tab. This panel updates as soon as you're done."));
  for (const p of S.plans.plans) {
    const card = el("div", "plan" + (p.id === "managed" ? " dark" : p.highlight ? " hl" : ""));
    if (p.id === "founding" && !p.soldOut) card.append(el("span", "ribbon", `${S.plans.foundingLeft} founding spots left`));
    if (p.id === "managed") card.append(el("span", "ribbon alt", "Done for you"));
    if (p.id === "autopilot") card.append(el("span", "ribbon", "Clear your inbox in minutes"));
    const tl = el("div", "top-line"); tl.append(el("h3", "", p.name));
    const pr = el("div", "price"); pr.append(document.createTextNode(p.priceLabel ? p.priceLabel.replace(/\/.*$/, "") : "$" + p.price)); pr.append(el("small", "", p.id === "team" ? "/seat/mo" : "/mo")); tl.append(pr);
    card.append(tl);
    const ul = el("ul"); (p.features || []).forEach((f) => ul.append(el("li", "", f))); card.append(ul);
    const isCurrent = a && a.plan === p.id && active();
    if (p.id === "founding" && p.soldOut) card.append(el("p", "muted", "Sold out. Pro has everything Founding had."));
    else if (isCurrent) card.append(el("p", "muted", "Your current plan."));
    else if (p.cta === "demo") card.append(btn("Book a demo", "ab-btn ghost", () => bg({ type: "openUrl", url: S.plans.bookDemoUrl || CFG.BOOK_DEMO_URL })));
    else if (!isOwner() && a) card.append(el("p", "muted", "Ask your account owner to change plans."));
    else card.append(btn(p.id === "managed" ? "Get Managed Inbox" : trialFor(p) ? `Start ${p.trialDays} day free trial` : "Choose " + p.name, p.id === "managed" ? "ab-btn" : "ab-btn" + (p.highlight ? "" : " ghost"), async (ev) => {
      ev.target.disabled = true;
      const r = await bg({ type: "checkout", plan: p.id });
      ev.target.disabled = false;
      if (!r.ok) return alertIn(card, r.error || "Couldn't start checkout.");
      if (r.switched) { S.me = r.me || (await refreshMe()); S.tab = "account"; render(); alertIn(view, `You're on ${acct().planName} now.` + (r.kickoffUrl ? " Book your kickoff call in the new tab." : "")); return; }
      S.awaitingCheckout = !r.demo && !r.portal; if (S.awaitingCheckout) pollForPlan(); renderPlans(fromAccount);
    }));
    if (p.id === "managed") card.append(el("p", "muted", "After checkout you'll book a kickoff call so our team can get set up."));
    else if (trialFor(p) && !isCurrent) card.append(el("p", "muted", `Free for ${p.trialDays} days, then ${p.priceLabel}. Cancel anytime before then and you pay nothing.`));
    view.append(card);
  }
  if (S.plans.topups && S.plans.topups.length) view.append(el("p", "muted", "Need more in a busy month? Add " + S.plans.topups.map((t) => t.label).join(" or ") + " anytime."));
  if (fromAccount) view.append(btn("Back", "ab-btn ghost", () => { S.tab = "account"; render(); }));
  else view.append(btn("Sign out", "link", logout));
}
const trialFor = (p) => !!(p.trialDays && (!acct() || acct().trialEligible !== false) && p.cta === "buy" && p.id !== "managed");
async function endTrial() {
  if (!confirm("Start your plan now? Your card is charged today and your full monthly credits unlock.")) return;
  const r = await bg({ type: "endTrial" });
  if (!r.ok) return alert(r.error || "Couldn't start your plan. Try Manage billing.");
  S.me = r.me || (await refreshMe());
  if (S.draft && S.draft.code === "limit") S.draft = null;
  render();
}
function alertIn(node, msg) { const e = el("div", "err", msg); node.append(e); setTimeout(() => e.remove(), 6000); }
let pollTimer = null;
function pollForPlan() {
  clearInterval(pollTimer);
  let n = 0;
  pollTimer = setInterval(async () => {
    n++;
    const before = acct() && acct().plan;
    await refreshMe();
    if ((active() && acct().plan !== before) || n > 120) {
      clearInterval(pollTimer); S.awaitingCheckout = false;
      S.tab = needsSetup() ? "setup" : "draft";
      render();
    }
  }, 5000);
}

// ---------- setup (onboarding: who you are, your goal, your audience, your style) ----------
const ROLES = [
  ["job_seeker", "Job seeker", "Land interviews and referrals"],
  ["founder", "Founder", "Win customers, investors or hires"],
  ["consultant", "Consultant or coach", "Get clients and book calls"],
  ["freelancer", "Freelancer or agency", "Win projects and retainers"],
  ["sales", "Sales or BD", "Book meetings with prospects"],
  ["recruiter", "Recruiter", "Win clients or source talent"],
  ["other", "Something else", "Grow your network your way"],
];
const GOALS = {
  job_seeker: ["Network with hiring managers", "Reach decision makers", "Get referrals", "Get noticed by recruiters", "Build my personal brand"],
  founder: ["Get more customers", "Book sales calls", "Meet investors", "Hire great people", "Find partners", "Build thought leadership"],
  consultant: ["Get more clients", "Book discovery calls", "Build authority", "Get referrals and partnerships"],
  freelancer: ["Win new clients", "Land retainers", "Get referrals", "Build my portfolio and brand"],
  sales: ["Book meetings with prospects", "Multithread target accounts", "Warm up cold leads", "Build my brand with buyers"],
  recruiter: ["Win hiring clients", "Source candidates", "Build my talent network", "Build my brand"],
  other: ["Grow my network", "Build my brand", "Find opportunities", "Reconnect with people"],
};
const STYLES = [
  ["conversational", "Conversational", "Hi Sam, your post on hiring really landed. Growing a team that fast isn't easy. Curious, what's been the hardest part?"],
  ["casual", "Casual", "hey Sam, loved your post on hiring lol. Curious, how's the team growing?"],
  ["warm", "Warm", "Hi Sam, your post on hiring really stuck with me. Curious, what's been the biggest lesson so far?"],
  ["direct", "Direct", "Sam, great post on hiring. Curious, what's your biggest hiring gap this quarter?"],
  ["polished", "Polished", "Hi Sam, I enjoyed your perspective on hiring. Curious, what are you prioritizing this quarter?"],
  ["playful", "Playful", "Sam, that hiring post was a whole masterclass haha. Curious, who's the lucky next hire?"],
];
const SIZES = ["", "Individuals (not companies)", "Solo founders and freelancers", "1 to 10 people", "11 to 50 people", "51 to 200 people", "201 to 1,000 people", "1,000+ people", "Mixed"];
const isSeller = (r) => ["founder", "consultant", "freelancer", "sales"].includes(r);
const roleLabel = (r) => (r === "other" ? "Professional" : (ROLES.find((x) => x[0] === r) || [, "Not set"])[1]);

// Fields per step, tailored to the role. [key, label, placeholder, kind, optional]
function aboutFields(r) {
  if (r === "job_seeker") return [
    ["name", "Your name", "Jordan Lee"], ["currentRole", "Current or most recent role", "Senior Product Analyst at Lyft"],
    ["targetRole", "Role you want next", "Product Manager, growth or marketplace"], ["level", "Experience level", "", "level"],
    ["proof", "2 or 3 wins you're proud of", "Grew rider retention 8%. Led pricing test across 12 cities.", "ta"],
    ["location", "Location or remote", "SF Bay Area or remote", "", true]];
  if (r === "recruiter") return [
    ["name", "Your name", "Jordan Lee"], ["business", "Agency or company", "Lee Talent Partners"],
    ["offer", "What you recruit for, in one sentence", "Senior engineers and GTM leaders for Series A to C startups.", "ta"],
    ["proof", "Results you can point to", "40+ placements, 92% 1 year retention.", "ta", true]];
  if (r === "other") return [
    ["name", "Your name", "Jordan Lee"], ["offer", "What you do, in one sentence", "Community lead building a network of climate founders.", "ta"],
    ["proof", "Anything you're proud of", "", "ta", true]];
  return [
    ["name", "Your name", "Jordan Lee"], ["business", r === "sales" ? "Company" : "Business name", "Lead With Jordan"],
    ["offer", r === "sales" ? "What you sell, in one sentence" : "What do you offer, in one sentence?", "Coaching that helps first time managers lead with confidence.", "ta"],
    ["price", "Typical price", "$3,000 program", "", true], ["proof", "Results you can point to", "120+ managers coached at Google, Stripe and Notion.", "ta", true]];
}
function audienceFields(r) {
  if (r === "job_seeker") return [
    ["industry", "Target industries or companies", "Marketplaces and fintech: Airbnb, Stripe, Ramp"],
    ["titles", "Who you want to reach", "Hiring managers, Directors of Product, PMs on growth teams"],
    ["size", "Company size or stage", "", "size"],
    ["pains", "What those teams care about right now", "Retention, faster experiments, monetization", "ta", true],
    ["jargon", "Words and acronyms they use", "PRD, north star metric, A/B test, roadmap", "", true]];
  return [
    ["industry", r === "recruiter" ? "Industries you recruit in" : "Your customers' industry or niche", "Tech companies, 50 to 500 people"],
    ["titles", r === "recruiter" ? "Who you want to reach (hiring managers, candidates)" : "Job titles you target", "Engineering Manager, Head of People"],
    ["size", "Company size or stage", "", "size"],
    ["pains", "Their top problems, in their own words", "My new managers are drowning. Promoted the best engineer, lost a great engineer.", "ta"],
    ["wants", "What they want instead", "Managers who run great 1:1s and keep their teams.", "ta", true],
    ["jargon", "Words and acronyms they use", "1:1s, skip levels, IC to manager, perf cycle", "", true],
    ["notfit", "Who is NOT a fit?", "Solo founders, students", "", true]];
}
const SETUP_STEPS = [
  { title: "Who are you?", sub: "One minute. Max tailors every draft to this." },
  { title: "How you write", sub: "Pick the one that sounds most like you. You can change it anytime." },
];
const JS_STEP = { title: "Your job search", sub: "Max aims everything at this: resumes, who to contact, alerts. And he'll help you address any gaps.", kind: "search" };
const stepsFor = (p) => (p && p.role === "job_seeker" ? [SETUP_STEPS[0], JS_STEP, SETUP_STEPS[1]] : SETUP_STEPS);
function composeAbout(p) {
  const L = [];
  if (p.role) L.push("Who they are: " + roleLabel(p.role));
  if (p.goals && p.goals.length) L.push("Main goal on LinkedIn: " + p.goals[0] + (p.goals.length > 1 ? ". Also: " + p.goals.slice(1).join(", ") : ""));
  if (p.name) L.push("Name: " + p.name + (p.business ? " (" + p.business + ")" : ""));
  if (p.currentRole) L.push("Current or most recent role: " + p.currentRole);
  if (p.targetRole) L.push("Role they want next: " + p.targetRole + (p.level ? " (" + p.level + ")" : ""));
  if (p.location) L.push("Location: " + p.location);
  if (p.offer) L.push((p.role === "other" ? "What they do: " : p.role === "recruiter" ? "What they recruit for: " : "What they offer: ") + p.offer + (p.price ? " Typical price: " + p.price + "." : ""));
  if (p.proof) L.push((p.role === "job_seeker" ? "Wins and achievements: " : "Proof and results: ") + p.proof);
  if (p.industry) L.push((p.role === "job_seeker" ? "Target industries or companies: " : "Audience industry: ") + p.industry);
  if (p.titles) L.push("People they want to reach: " + p.titles);
  if (p.size) L.push("Company size or stage: " + p.size);
  if (p.pains) L.push((p.role === "job_seeker" ? "What those teams care about: " : "Audience's top problems (their words): ") + p.pains);
  if (p.wants) L.push("What the audience wants instead: " + p.wants);
  if (p.jargon) L.push("Words and acronyms the audience uses: " + p.jargon);
  if (p.notfit) L.push("Not a fit: " + p.notfit);
  if (p.role === "job_seeker") L.push(...jobAboutLines(p));
  if (p.style) L.push("Writing style: " + p.style + (p.emoji ? ", emojis are fine" : ", no emojis") + (p.length === "medium" ? ", up to 3 short lines" : ", 1 to 2 short lines"));
  if (p.question) L.push("Go-to opening question: " + p.question);
  if (p.avoid) L.push("Never use these words or phrases: " + p.avoid);
  if (p.offerlink) L.push((p.role === "job_seeker" ? "Portfolio or resume link (share when someone asks for it): " : "Offer link (share when someone asks how it works): ") + p.offerlink);
  if (p.booklink) L.push("Booking link (share when someone says yes to a call): " + p.booklink);
  return L.join("\n");
}
let draftProfile = null;
function loadDraftProfile() {
  const p = { ...((acct() && acct().profile) || {}) };
  if (typeof p.goals === "string") { p.wants = p.wants || p.goals; p.goals = []; } // older setups stored customer goals here
  if (!Array.isArray(p.goals)) p.goals = [];
  if (!p.style) p.style = Array.isArray(p.tone) && p.tone.includes("direct") ? "direct" : Array.isArray(p.tone) && p.tone.includes("professional") ? "polished" : "conversational";
  if (p.emoji == null) p.emoji = false;
  if (!p.length) p.length = "short";
  if (!p.role && p.offer) p.role = "consultant";
  return p;
}
function fieldEl(p, [key, label, ph, kind, opt]) {
  const f = el("div", "field"); const lb = el("label", "", label); if (opt) lb.append(el("span", "opt", " optional")); f.append(lb);
  if (kind === "size" || kind === "level") {
    const opts = kind === "size" ? SIZES : ["", "Entry level", "Mid level", "Senior", "Manager", "Director and above", "Career changer"];
    const s = el("select"); opts.forEach((o) => { const op = el("option", "", o || "Choose one"); op.value = o; if (o === p[key]) op.selected = true; s.append(op); });
    s.onchange = () => (p[key] = s.value); f.append(s);
  } else {
    const inp = kind === "ta" ? el("textarea") : el("input"); if (kind === "ta") inp.rows = 2; else inp.type = "text";
    inp.placeholder = ph; inp.value = p[key] || ""; inp.oninput = () => (p[key] = inp.value.trim()); f.append(inp);
  }
  return f;
}
function renderSetup() {
  view.innerHTML = "";
  if (!draftProfile) draftProfile = loadDraftProfile();
  const p = draftProfile;
  const steps = stepsFor(p);
  const n = steps.length;
  if (S.setupStep > n) S.setupStep = n;
  const step = steps[S.setupStep - 1] || steps[0];
  const prog = el("div", "prog"); prog.style.gridTemplateColumns = `repeat(${n}, 1fr)`; for (let i = 1; i <= n; i++) prog.append(el("span", i <= S.setupStep ? "on" : ""));
  view.append(prog, el("div", "label", `Step ${S.setupStep} of ${n}` + (S.forcedSetup ? (S.setupStep === 1 ? " · required, about a minute" : " · almost done") : "")), el("h2", "", step.title), el("p", "muted", step.sub));
  const card = el("div", "card");
  const err = el("div", "err");
  const js = p.role === "job_seeker";
  if (S.setupStep === 1) {
    const grid = el("div", "pick compact");
    ROLES.forEach(([v, t]) => { const b = el("button", "pick-opt" + (p.role === v ? " on" : "")); b.type = "button"; b.append(el("b", "", t)); b.onclick = () => { if (p.role !== v) p.goals = []; p.role = v; renderSetup(); }; grid.append(b); });
    card.append(grid);
    if (p.role) {
      card.append(el("label", "lbl", "Your main goal"));
      const chips = el("div", "chips");
      (GOALS[p.role] || GOALS.other).forEach((g) => chips.append(btn(g, "chip" + (p.goals[0] === g ? " on" : ""), () => { p.goals = [g]; renderSetup(); })));
      card.append(chips);
      const f = (key, label, ph, kind, opt) => card.append(fieldEl(p, [key, label, ph, kind, opt]));
      f("name", "Your name", "Jordan Lee");
      if (js) f("targetRole", "Role you want next", "Product Manager, growth or marketplace");
      else f("offer", p.role === "recruiter" ? "What you recruit for, in one sentence" : p.role === "other" ? "What you do, in one sentence" : p.role === "sales" ? "What you sell, in one sentence" : p.role === "founder" ? "What your company does, in one sentence" : "What you offer, in one sentence", "Coaching that helps first time managers lead with confidence.", "ta");
      f("titles", js ? "Who you want to reach" : "Who you want to reach (job titles or type of person)", js ? "Hiring managers and PMs on growth teams" : "Engineering Managers and Heads of People at tech companies");
      f(js ? "offerlink" : "booklink", js ? "Portfolio or resume link" : "Booking link", "https://...", "", true);
      const more = el("details", "more"); more.append(el("summary", "", "Add more detail (optional, makes drafts sharper)"));
      const add = (key, label, ph, kind) => more.append(fieldEl(p, [key, label, ph, kind, true]));
      add("proof", js ? "2 or 3 wins you're proud of" : "Results you can point to", js ? "Grew retention 8%. Led a pricing test in 12 cities." : "120+ managers coached at Google, Stripe and Notion.", "ta");
      add("industry", js ? "Target industries or companies" : "Their industry or niche", "Tech companies, 50 to 500 people");
      add("pains", js ? "What those teams care about" : "Their top problems, in their words", "My new managers are drowning.", "ta");
      add("jargon", "Words and acronyms they use", "1:1s, skip levels, perf cycle");
      card.append(more);
    }
  } else if (step.kind === "search") {
    jobSearchStep(card, p);
  } else {
    const grid = el("div", "pick");
    STYLES.forEach(([v, t, sample]) => { const b = el("button", "pick-opt style" + (p.style === v ? " on" : "")); b.type = "button"; b.append(el("b", "", t), el("span", "sample", "“" + sample + "”")); b.onclick = () => { p.style = v; renderSetup(); }; grid.append(b); });
    card.append(grid);
    if (S.me && S.me.account && (S.me.account.training || []).length) card.append(el("p", "muted", "Your rules and samples in Voice & training win over this."));
    const row = el("div", "two");
    const segEl = (label, key, opts) => { const w = el("div", "field"); w.append(el("label", "", label)); const sg = el("div", "seg"); opts.forEach(([val, l]) => sg.append(btn(l, p[key] === val ? "on" : "", () => { p[key] = val; renderSetup(); }))); w.append(sg); return w; };
    row.append(segEl("Emojis", "emoji", [[false, "No"], [true, "Yes"]]), segEl("Message length", "length", [["short", "Short"], ["medium", "Medium"]]));
    card.append(row);
    const more = el("details", "more"); more.append(el("summary", "", "Your go-to question and words to avoid (optional)"));
    [["question", "Your go-to opening question", js ? "Curious, what's the team focused on this quarter?" : "Curious, do you have room to take on more clients right now?", "", true],
     ["avoid", "Words or phrases to never use", "synergy, hope this finds you well", "", true]].forEach((f) => more.append(fieldEl(p, f)));
    card.append(more);
  }
  card.append(err);
  view.append(card);
  const valid = () => {
    if (!p.role) return "Pick the one that fits best.";
    if (!p.goals.length) return "Pick your main goal.";
    if (!p.name) return "Add your name.";
    if (js && !p.targetRole) return "Add the role you want next.";
    if (!js && !p.offer) return "Add a sentence about what you do.";
    if (!p.titles) return "Add who you want to reach.";
    return "";
  };
  const nav = el("div", "row");
  if (S.setupStep > 1) nav.append(btn("Back", "ab-btn ghost", () => { S.setupStep--; renderSetup(); }));
  else if (!S.forcedSetup) nav.append(btn("Cancel", "ab-btn ghost", () => { draftProfile = null; S.tab = "account"; S.setSec = S.setupReturn || "about"; S.setupReturn = null; render(); }));
  if (S.setupStep < n) nav.append(btn("Next", "ab-btn", () => { const v = valid(); if (v) { err.textContent = v; return; } S.setupStep++; renderSetup(); }));
  else nav.append(btn("Save and start", "ab-btn", async (ev) => {
    ev.currentTarget.disabled = true;
    const about = composeAbout(p);
    const r = await bg({ type: "saveProfile", profile: p, about });
    if (!r.ok) { ev.target.disabled = false; return alertIn(view, r.error || "Couldn't save. Try again."); }
    // The industry playbook builds in the background; it is ready by the first draft.
    if (!isFree()) bg({ type: "buildPlaybook", about }).then(() => refreshMe());
    const wasForced = S.forcedSetup;
    await refreshMe(); draftProfile = null; S.setupStep = 1; S.forcedSetup = false;
    if (wasForced || !S.setupReturn) { S.tab = p.role === "job_seeker" ? "jobs" : "profile"; S.justOnboarded = p.role !== "job_seeker"; } else { S.tab = "account"; S.setSec = S.setupReturn; }
    S.setupReturn = null; render(); refreshContext();
  }));
  view.append(nav);
}

// ---------- Profile optimizer: score your LinkedIn profile against your goal ----------
const STATUS_LABEL = { strong: "Strong", improve: "Improve", missing: "Missing" };
// Profile tab. S.pv = the report on screen: { key, own }. Own report lives under key "me".
const pkey = (url) => { try { const u = new URL(url); return (u.pathname.match(/^\/in\/[^/]+/) || [u.pathname])[0].toLowerCase(); } catch { return String(url || ""); } };
async function getReports() { const all = await store("abProfileReports", {}); const me = await store("abProfileReport", null); if (me && !all.me) all.me = { ...me, own: true }; return all; }
async function saveReport(key, rep) {
  const all = await store("abProfileReports", {});
  all[key] = rep;
  const keys = Object.keys(all).filter((k) => k !== "me").sort((x, y) => (all[y].at || 0) - (all[x].at || 0));
  for (const k of keys.slice(30)) delete all[k];
  const extra = key === "me" ? { abProfileReport: rep, abProfileHistory: (await store("abProfileHistory", [])).concat([{ score: rep.score, at: Date.now() }]).slice(-20) } : {};
  await setStore({ abProfileReports: all, ...extra });
}
async function renderProfileTab() {
  view.innerHTML = "";
  const all = await getReports();
  const pv = S.pv && all[S.pv.key] ? S.pv : { key: "me", own: true };
  const report = all[pv.key] || null;
  const head = el("div", "");
  if (!pv.own) {
    head.append(btn("← My profile", "link", () => { S.pv = null; renderProfileTab(); }), el("div", "ab-eye", "Profile review"), el("h2", "", report.name || "Their profile"));
    view.append(head);
    renderReport(report, pv.key);
    view.append(el("p", "muted", "Tip: Export PDF and send it with a short note. It includes their profile link and your booking link."));
    view.append(el("div", "", "")); renderBannerMaker(report.name);
    return;
  }
  head.append(el("div", "ab-eye", "Profile optimizer"), el("h2", "", report ? "Your profile score" : "How strong is your LinkedIn profile?"));
  view.append(head);
  if (S.justOnboarded && !report) view.append(el("div", "q live", "You're set up. Last step: let's see how your profile looks to the people you want to reach."));
  if (report) renderReport(report, "me");
  const c = el("div", "card soft");
  const fs = isFree() && acct().freeScores;
  if (fs) c.append(el("div", "label", `${Math.max(0, fs.limit - fs.used)} of ${fs.limit} free profile scores left`));
  c.append(el("h3", "", report ? "Check again" : "Score your profile"),
    el("p", "small", "Open your own LinkedIn profile and click Ask Max, then Score my profile, or click below. To score a prospect, open their profile and click Ask Max."));
  const status = el("div", "muted"); status.id = "pt-status";
  const go = btn(report ? "↻ Re-score my profile" : "✦ Score my profile", "ab-btn", async () => {
    const r = await toPage("readProfile");
    if (r.notLinkedIn || !r.ok || !r.text) { status.className = "err"; status.textContent = "Open your LinkedIn profile in this tab first (click Me, then View profile)."; return; }
    runAnalyze({ text: r.text, name: r.name, url: r.url, images: r.images, subject: "self" }, go, status);
  });
  go.id = "pt-go";
  c.append(go, status);
  const det = el("details"); det.append(el("summary", "", "Or paste your profile text instead"));
  const ta = el("textarea"); ta.rows = 6; ta.placeholder = "Paste your headline, About, Experience and Featured here.";
  det.append(ta, btn("Score pasted text", "ab-btn ghost sm", () => { if (ta.value.trim().length < 200) { status.className = "err"; status.textContent = "Paste a bit more: at least your headline, About and current role."; return; } runAnalyze({ text: ta.value.trim(), name: "", subject: "self" }, go, status); }));
  c.append(det);
  view.append(c);
  const others = Object.entries(all).filter(([k, r]) => k !== "me" && r && r.subject === "other").sort((x, y) => (y[1].at || 0) - (x[1].at || 0)).slice(0, 6);
  if (others.length) {
    const rc = el("div", "card"); rc.append(el("div", "label", "Profiles you reviewed"));
    others.forEach(([k, r]) => { const row = el("div", "rv-row"); row.append(el("b", "", r.name || k), el("span", "muted", `${r.score}/100 · ${agoTime(r.at)}`)); row.onclick = () => { S.pv = { key: k, own: false }; renderProfileTab(); }; rc.append(row); });
    view.append(rc);
  }
  renderBannerMaker();
}
// job = { text, name, url, images, subject, role?, goals?, key? }
async function runAnalyze(job, goBtn, status) {
  goBtn = goBtn || document.getElementById("pt-go") || el("button");
  status = status || document.getElementById("pt-status") || el("div");
  if (!status.isConnected) view.prepend(status);
  status.scrollIntoView({ block: "center" });
  const own = job.subject !== "other";
  const key = job.key || (own ? "me" : pkey(job.url));
  const imgs = job.images && (job.images.banner || job.images.photo);
  goBtn.disabled = true; status.className = "muted"; status.innerHTML = ""; status.append(spinner(`Reading ${own ? "your profile" : job.name || "their profile"} and scoring every section${imgs ? ", banner and photo" : ""}... about 20 seconds.`));
  const r = await bg({ type: "analyze", text: job.text, subject: own ? "self" : "other", name: job.name || "", role: job.role, goals: job.goals, auto: job.auto, images: job.images });
  goBtn.disabled = false; status.innerHTML = "";
  if (!r.ok) {
    status.className = "err"; status.textContent = r.code === "limit" ? r.error || "You've used your credits for this period." : r.error || "Couldn't score it. Try again.";
    if (r.code === "limit" && isFree() && isOwner()) status.after(btn(trialLabel(), "ab-btn", () => { S.tab = "plans"; render(); }));
    return;
  }
  const prev = (await getReports())[key];
  const report = { score: r.score, grade: r.grade, summary: r.summary, sections: r.sections, topFixes: r.topFixes, rubric: r.rubric, role: r.role, goal: r.goal, auto: r.auto, subject: own ? "self" : "other", own,
    name: job.name, url: job.url || "", text: job.text, images: job.images || null, at: Date.now(), prevScore: prev ? prev.score : null };
  await saveReport(key, report);
  syncUsage(r);
  S.justOnboarded = false;
  S.pv = { key, own };
  renderProfileTab();
}
function changeFocus(rep, key, holder) {
  holder.innerHTML = "";
  let role = rep.role && ROLES.some((x) => x[0] === rep.role) ? rep.role : "consultant";
  const def = (r) => (GOALS[r] || [""])[0];
  const goal = el("input"); goal.type = "text"; goal.value = rep.goal || def(role);
  const chips = el("div", "chips");
  ROLES.map((x) => (x[0] === "other" ? ["other", "Professional"] : x)).forEach(([v, label]) => chips.append(btn(label, "chip" + (v === role ? " on" : ""), (e) => { if (!goal.value || goal.value === def(role)) goal.value = def(v); role = v; chips.querySelectorAll(".chip").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); })));
  const status = el("div", "");
  const go = btn("Score again with this", "ab-btn", () => runAnalyze({ text: rep.text, name: rep.name, url: rep.url, images: rep.images, subject: rep.own ? "self" : "other", role, goals: goal.value.trim() ? [goal.value.trim()] : [], key }, go, status));
  holder.append(el("div", "label", rep.own ? "You are a" : "They are a"), chips, el("div", "label", "Main goal"), goal, go, status, btn("Cancel", "link", () => renderProfileTab()));
}
function scoreColor(s) { return s >= 85 ? "var(--ab-ok)" : s >= 70 ? "var(--ab-blue)" : s >= 50 ? "var(--ab-warn)" : "var(--ab-err)"; }
function renderReport(rep, key) {
  const who = rep.own ? "You are a" : `${(rep.name || "They").split(" ")[0]} is a`;
  const fb = el("div", "focus-box");
  const line = el("div", "focus-in"); line.append(el("span", "muted", who), el("span", "tag t", roleLabel(rep.role)), el("span", "muted", "who wants to"), el("span", "tag g", (rep.goal || "grow on LinkedIn").replace(/^./, (c) => c.toLowerCase())));
  const edit = el("div", "editf");
  if (rep.text) line.append(btn("Change", "link chg", () => { fb.remove(); changeFocus(rep, key, edit); }));
  fb.append(line);
  if (rep.auto) fb.append(el("p", "muted small", "Read from the profile. Wrong? Click Change."));
  view.append(fb, edit);
  const top = el("div", "score-card");
  const ring = el("div", "ring"); ring.style.setProperty("--p", rep.score); ring.style.setProperty("--c", scoreColor(rep.score));
  const inner = el("div", "ring-in"); inner.append(el("b", "", String(rep.score)), el("span", "", "/ 100")); ring.append(inner);
  const meta = el("div", "score-meta");
  const gr = el("span", "grade"); gr.textContent = rep.grade; gr.style.color = scoreColor(rep.score);
  meta.append(gr);
  if (rep.prevScore != null) { const d = rep.score - rep.prevScore; meta.append(el("span", "delta " + (d >= 0 ? "up" : "down"), (d >= 0 ? "▲ +" : "▼ ") + d + " since last check")); }
  meta.append(el("p", "small", rep.summary || ""), el("span", "muted", (rep.name ? rep.name + " · " : "") + "checked " + agoTime(rep.at)));
  top.append(ring, meta);
  view.append(top);
  if (rep.topFixes && rep.topFixes.length) {
    const tf = el("div", "card fixes"); tf.append(el("div", "label", "Fix these first"));
    const ol = el("ol"); rep.topFixes.slice(0, 3).forEach((f) => ol.append(el("li", "", f))); tf.append(ol);
    view.append(tf);
  }
  const acts = el("div", "row");
  acts.append(btn("Export PDF", "ab-btn", () => chrome.tabs.create({ url: chrome.runtime.getURL("report.html?key=" + encodeURIComponent(key)) })),
    btn("▭ Make a banner", "ab-btn ghost", () => { const bm = document.getElementById("banner-maker"); if (bm) bm.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  view.append(acts);
  const list = el("div", "card"); list.append(el("div", "label", "Section by section"));
  const order = ["headline", "banner", "photo", "contact", "about", "featured", "activity", "experience", "skills", "proof"]; // top to bottom, like the profile
  [...rep.sections].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).forEach((s) => {
    const det = el("details", "sec"); if (s.status !== "strong" && s.weight >= 20) det.open = true;
    const sum = el("summary");
    const nm = el("div", "sec-top"); nm.append(el("b", "", s.label), el("span", "pill " + s.status, STATUS_LABEL[s.status] || s.status));
    const bar = el("div", "sec-bar"); const fill = el("i"); fill.style.width = s.score * 10 + "%"; fill.style.background = scoreColor(s.score * 10); bar.append(fill);
    const pts = el("span", "muted", `${Math.round((s.weight * s.score) / 10)} of ${s.weight} pts`);
    sum.append(nm, bar, pts); det.append(sum);
    const body = el("div", "sec-body");
    if (s.found) { const r = el("p", "small"); r.append(el("b", "", "Now: "), document.createTextNode(s.found)); body.append(r); }
    if (s.why) { const r = el("p", "small"); r.append(el("b", "", "Why it matters: "), document.createTextNode(s.why)); body.append(r); }
    if (s.fix) { const r = el("p", "small fix"); r.append(el("b", "", "Fix: "), document.createTextNode(s.fix)); body.append(r); }
    if (s.rewrite) {
      const rw = el("div", "rewrite"); rw.append(el("div", "label", s.key === "banner" ? "Text for your banner" : "Try this"), el("p", "", s.rewrite));
      const cp = btn("Copy", "ab-btn ghost sm", async () => { try { await navigator.clipboard.writeText(s.rewrite); cp.textContent = "Copied"; } catch { cp.textContent = "Select and copy"; } setTimeout(() => (cp.textContent = "Copy"), 1400); });
      rw.append(cp); body.append(rw);
    }
    if (s.key === "banner") body.append(btn(rep.own ? "▭ Make a new banner" : "▭ Make a new banner for them", "ab-btn sm", () => { const bm = document.getElementById("banner-maker"); if (bm) bm.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    det.append(body); list.append(det);
  });
  view.append(list);
  if (rep.text) view.append(btn("↻ Re-score", "ab-btn ghost", async () => {
    let job = { text: rep.text, name: rep.name, url: rep.url, images: rep.images, subject: rep.own ? "self" : "other", role: rep.auto ? undefined : rep.role, goals: rep.auto || !rep.goal ? undefined : [rep.goal], auto: rep.auto || undefined, key };
    const r = await toPage("readProfile");
    if (r && r.ok && r.text && (rep.own ? true : pkey(r.url) === key)) job = { ...job, text: r.text, images: r.images, name: r.name || rep.name };
    runAnalyze(job);
  }));
}

// ---------- draft tab ----------
function spinner(msg) { const s = el("div", "spin"); s.append(el("i"), el("span", "", msg)); return s; }
const STAGES = ["Opener", "Rapport", "Intent", "Offer", "Booked"];
function renderCoach(c) {
  const box = el("div", "card soft");
  const st = (c.stage || "").toLowerCase();
  const idx = STAGES.findIndex((x) => st.startsWith(x.toLowerCase()));
  const special = /not a fit/.test(st) ? "Not a fit: close it warmly" : /needs/.test(st) ? "Needs you: handle this one personally" : "";
  box.append(el("div", "label", "Where this chat is"));
  if (special) box.append(el("div", "special", special));
  else { const bar = el("div", "stepper"); STAGES.forEach((n, k) => bar.append(el("div", k < idx ? "done" : k === idx ? "now" : "", n))); box.append(bar); }
  if (c.where) { const w = el("div", "cbox"); w.append(el("small", "", "Where it stands"), el("div", "", c.where)); box.append(w); }
  if (c.next) { const n = el("div", "cbox next"); n.append(el("small", "", "Your next move"), el("div", "", c.next)); box.append(n); }
  return box;
}
function renderDraftCard(container) {
  const d = S.draft;
  const head = el("div", "who"); head.append(el("b", "", d.name || "Draft"), el("span", "muted", d.label || ""));
  container.append(head);
  if (d.state === "loading") { container.append(spinner(d.msg || "Working...")); return; }
  if (d.state === "error") return renderError(container, d);
  if (d.state === "warn") {
    const c = el("div", "card soft"); d.list.forEach((w) => c.append(el("div", "", w)));
    const row = el("div", "row"); row.append(btn("Draft anyway", "ab-btn", () => toOwner("proceed")), btn("Skip", "ab-btn ghost", () => { toOwner("close"); S.draft = null; render(); }));
    container.append(c, row); return;
  }
  const { parsed } = d;
  if (parsed.coach && (parsed.coach.stage || parsed.coach.next)) container.append(renderCoach(parsed.coach));
  else if (parsed.needsYou) container.append(el("div", "special", "Needs you: " + parsed.notes.replace(/^NEEDS \w+( \w+)?:\s*/i, "")));
  if (parsed.lines.length) container.append(el("div", "label", d.mode === "reply" ? "Suggested reply" : d.mode === "comment" ? "Suggested comment" : "Opener"));
  const wrap = el("div", "lines");
  parsed.lines.forEach((line, i) => {
    const r = el("div", "ln"); r.append(el("div", "n", String(i + 1)));
    const ta = el("textarea"); ta.value = line; ta.rows = 1; ta.addEventListener("input", () => autosize(ta));
    r.append(ta); wrap.append(r); requestAnimationFrame(() => autosize(ta)); taObserver.observe(ta);
  });
  container.append(wrap);
  const chips = el("div", "chips");
  const tweaks = d.mode === "reply" ? [["Shorter", "make it shorter"], ["Warmer", "make it warmer"], ["Funnier", "add a bit more humor"], ["Move to offer", "move the conversation one step toward the offer, without being pushy"]]
    : [["Shorter", "make it shorter"], ["Funnier", "add a bit more humor"], ["More casual", "make it more casual, like a quick text"], ["New angle", "use a different hook or angle"]];
  tweaks.forEach(([label, ask]) => chips.append(btn(label, "chip", () => toOwner("tweak", { ask }))));
  container.append(chips);
  const tw = el("div", "row"); const inp = el("input"); inp.type = "text"; inp.placeholder = "Or say what to change...";
  const redo = btn("Redo", "ab-btn ghost sm", () => toOwner("tweak", { ask: inp.value.trim() || "try a different angle" }));
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") redo.click(); });
  tw.append(inp, redo); container.append(tw);
  const current = () => [...wrap.querySelectorAll("textarea")].map((t) => t.value.trim()).filter(Boolean);
  const label = d.mode === "reply" ? "Put in reply box" : d.mode === "comment" ? "Put in comment box" : "Put in message box";
  const row = el("div", "row");
  row.append(btn(d.auto ? label.replace("Put in", "Replace in") : label, "ab-btn", () => toOwner("place", { lines: current() })));
  const cp = btn("Copy", "ab-btn ghost sm", async () => { try { await navigator.clipboard.writeText(current().join("\n")); cp.textContent = "Copied"; } catch { cp.textContent = "Select and copy"; } setTimeout(() => (cp.textContent = "Copy"), 1400); });
  row.append(cp); container.append(row);
  if (S.queue) {
    const q = el("div", "q" + (S.queue.live ? " live" : "")); q.append(el("span", "", S.queue.msg));
    if (S.queue.canStop) q.append(btn("Stop", "link", () => toOwner("stop")));
    container.append(q);
  }
  if (d.savedAt) container.append(el("p", "muted", "Saved " + new Date(d.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ". Open their chat or post, then click Put in box."));
  if (d.tip) container.append(el("p", "muted", d.tip));
  if (parsed.notes && !parsed.needsYou && !parsed.coach) {
    const det = el("details"); det.append(el("summary", "", d.mode === "comment" ? "Why this comment" : "Why this opener"), el("div", "why", parsed.notes)); container.append(det);
  }
  container.append(el("p", "muted", d.mode === "comment" ? "You review and click Comment. Nothing is posted for you." : "You review and hit Send. Nothing is sent for you."));
}
function renderError(container, d) {
  if (d.code === "limit" && isFree()) {
    const c = el("div", "card soft");
    c.append(el("div", "label", "Free plan"), el("h3", "", acct().trialEligible ? "Unlock everything with a free trial" : "Pick a plan to keep going"), el("p", "muted", d.msg));
    if (isOwner()) c.append(btn(trialLabel(), "ab-btn", () => { S.tab = "plans"; render(); }));
    c.append(btn("Or invite a friend for 50 free credits", "ab-btn ghost", () => { S.tab = "account"; S.showInvite = true; render(); }));
    container.append(c); return;
  }
  if (d.code === "limit") {
    const c = el("div", "card soft");
    c.append(el("div", "label", "Monthly limit reached"), el("h3", "", "You've used everything in your plan this month"), el("p", "muted", acct() && acct().periodEnd ? `It resets on ${fmtDate(acct().periodEnd)}.` : ""));
    if (d.trialEndsNow && isOwner()) { c.children[1].textContent = "You've used your free trial credits"; c.append(el("p", "muted", d.msg), btn("Start my plan now", "ab-btn", endTrial)); }
    if (d.topup && isOwner()) c.append(btn(d.topup.label ? "Add " + d.topup.label : "Buy a top up", "ab-btn", () => bg({ type: "topup", kind: d.topup.kind })));
    if (d.upgradeTo && isOwner()) c.append(btn("Upgrade plan", "ab-btn ghost", () => { S.tab = "plans"; render(); }));
    if (!isOwner()) c.append(el("p", "muted", "Ask your account owner to add more."));
    container.append(c); return;
  }
  if (d.code === "feature") { container.append(el("div", "err", d.msg), btn("See Autopilot", "ab-btn", () => { S.tab = "autopilot"; render(); })); return; }
  container.append(el("div", "err", d.msg || "Something went wrong."));
  if (d.retry) container.append(btn("Try again", "ab-btn ghost", () => toOwner("retry")));
}
async function renderDraftTab() {
  if (S.draft) {
    const c = el("div", "card"); renderDraftCard(c); view.append(c);
    view.append(btn("Clear", "link", () => { toOwner("close"); S.draft = null; S.queue = null; render(); }));
  }
  if (!S.draft) { const rv = S.rv; const rc = await reviewCard(); if (rc && rv === S.rv && S.tab === "draft" && !view.querySelector(".review")) view.append(rc); }
  await renderMax();
  if (needsSetup() && !S.draft) view.append(btn("Finish your 1 minute setup", "ab-btn ghost", () => { S.tab = "setup"; render(); }));
}

// ---------- Ask Max ----------
// Max is the assistant: chat for advice, and he runs the tools (opener, reply, score, post, ideas, trends, banner, Radar).
const MX = { msgs: null, busy: false };
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";
async function maxMsgs() { if (!MX.msgs) MX.msgs = await store("abMaxChat", []); return MX.msgs; }
async function saveMax() { if (MX.msgs.length > 30) MX.msgs.splice(0, MX.msgs.length - 30); await setStore({ abMaxChat: MX.msgs }); }
function maxAvatar(cls, thinking) { const a = el("span", "max-av" + (cls ? " " + cls : "")); const i = el("img"); i.src = thinking ? "max/max-thinking.svg" : "max/max-animated.svg"; i.alt = ""; a.append(i); a.setAttribute("aria-hidden", "true"); return a; }
function setTab(t) { S.tab = t; document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t)); }
async function maxContext() {
  const t = await activeTab();
  const ctx = S.pageCtx || {};
  const out = { linkedIn: isLinkedIn(t), onProfile: !!ctx.onProfile, own: !!ctx.own, hasChat: !!ctx.hasChat, onFeed: !!ctx.onFeed, name: ctx.name || "", onJob: !!ctx.onJob, jobTitle: (ctx.job && ctx.job.title) || "", company: (ctx.job && ctx.job.company) || "" };
  try { const { waiting, nudge } = await radarLists(); out.radar = { waiting: waiting.length, nudge: nudge.length }; } catch {}
  return out;
}
function maxChips(ctx) {
  const lin = ctx && ctx.linkedIn !== false;
  if (isJobSeeker()) {
    if (ctx && ctx.onJob) return ["Tailor my resume to this job", "Who should I contact about this job?", "Am I a good fit for this role?"];
    if (ctx && ctx.onProfile && !ctx.own) { const f = firstName(ctx.name); return [`Draft an opener for ${f}`, `How should I approach ${f} about a role?`, "Score my resume"]; }
    if (ctx && ctx.onProfile && ctx.own) return ["Score my profile", "Make my headline land interviews", "Score my resume"];
    if (ctx && ctx.hasChat) return ["Suggest a reply", "How do I ask for a referral here?", "Who else should I follow up with?"];
    return ["Who's hiring for my role today?", "Score my resume", "What should I do today to get interviews?"];
  }
  if (ctx && ctx.onProfile && !ctx.own) { const f = firstName(ctx.name); return [`Draft an opener for ${f}`, `Score ${f}'s profile`, `How should I approach ${f}?`]; }
  if (ctx && ctx.onProfile && ctx.own) return ["Score my profile", "How can I make my headline better?", "Make me a new banner"];
  if (ctx && ctx.hasChat) return ["Suggest a reply", "How do I move this toward a call?", "Who else should I follow up with?"];
  const role = acct() && acct().profile && acct().profile.role;
  const ROLE_CHIPS = {
    founder: ["Who should I reach out to today?", "Write a post about what we're building", "Who should I follow up with?"],
    consultant: ["Who should I reach out to today?", "Write a post that attracts clients", "Who should I follow up with?"],
    freelancer: ["Who should I reach out to today?", "Write a post about a recent project", "Who should I follow up with?"],
    sales: ["Who should I reach out to today?", "How do I warm up a cold lead?", "Who should I follow up with?"],
    recruiter: ["Who's hiring in my space today?", "Write a post about an open role", "Who should I follow up with?"],
  };
  if (ROLE_CHIPS[role]) return ROLE_CHIPS[role];
  return [lin ? "What's trending in my field this week?" : "Give me 6 post ideas", "Write a post about a lesson from this week", "Who should I follow up with?"];
}
async function renderMax(focus) {
  const rv = S.rv;
  const msgs = await maxMsgs();
  const card = el("div", "card max"); card.id = "max";
  const hd = el("div", "max-hd"); const who = el("div", "");
  who.append(el("b", "", "Max"), el("div", "muted", "Your LinkedIn wingman. Ask anything, or tell me what to do."));
  hd.append(maxAvatar(), who);
  if (msgs.length) hd.append(btn("New chat", "link", async () => { MX.msgs = []; await saveMax(); render(); }));
  card.append(hd);
  const list = el("div", "max-list");
  if (!msgs.length) list.append(el("div", "max-b max-a", S.draft ? "I'm on it. Your draft is above. Want me to tweak anything, or do something else?" : (isJobSeeker() ? "Hey! I tailor your resume to any LinkedIn job, tell you who to contact and what to say, score your resume and profile, and flag who's hiring for your role. What are we working on?" : (hasAlerts() ? "Hey! I write openers, replies and posts in your voice, flag the right people to reach each morning, and tell you who to follow up with. What are we working on?" : "Hey! I write openers, replies and posts in your voice, score profiles, make banners and tell you who to follow up with. What are we working on?"))));
  msgs.forEach((m) => {
    const b = el("div", "max-b " + (m.role === "user" ? "max-u" : m.error ? "max-err" : "max-a"), m.text);
    list.append(b);
    if (m.action === "save_voice") { list.append(voiceSaveCard(m)); return; }
    if (m.action && m.action !== "none") { const run = btn("↻ " + (m.label || "Do it"), "link max-run", () => runMaxAction(m.action, m.args || {}, m.ask)); list.append(run); }
  });
  if (MX.busy) { const row = el("div", "max-thinking"); row.append(maxAvatar("sm", true)); const t = el("div", "max-b max-a max-typing"); t.append(el("i"), el("i"), el("i")); row.append(t); list.append(row); }
  card.append(list);
  const t = await activeTab();
  const pre = { ...(S.pageCtx || {}), linkedIn: isLinkedIn(t) };
  if (!MX.busy && msgs.length < 2) {
    const chips = el("div", "chips");
    maxChips(pre).forEach((q) => { const c = btn(q, "chip", () => askMax(q)); chips.append(c); });
    card.append(chips);
  }
  const box = el("div", "max-in");
  const ta = el("textarea"); ta.rows = 1; ta.placeholder = "Ask Max..."; ta.id = "max-ta"; ta.disabled = MX.busy;
  ta.addEventListener("input", () => autosize(ta));
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  const go = btn("↑", "ab-btn max-send", () => send()); go.title = "Send to Max"; go.disabled = MX.busy;
  const send = () => { const q = ta.value.trim(); if (q) askMax(q); };
  box.append(ta, go);
  card.append(box, el("div", "muted max-note", "1 credit per message. Max never sends anything on LinkedIn; you press Send."));
  if (rv !== S.rv || S.tab !== "draft") return;
  view.append(card);
  if (MX.busy || S.maxScroll) { S.maxScroll = false; setTimeout(() => { const last = list.lastElementChild; if (last) last.scrollIntoView({ block: "nearest" }); box.scrollIntoView({ block: "nearest" }); }, 30); }
  if (focus || S.focusMax) { S.focusMax = false; setTimeout(() => ta.focus(), 50); }
}
async function askMax(q) {
  if (MX.busy) return;
  const msgs = await maxMsgs();
  msgs.push({ role: "user", text: q });
  MX.busy = true; await saveMax();
  if (S.tab === "draft") render();
  const ctx = await maxContext();
  const history = msgs.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, text: m.text }));
  const r = await bg({ type: "ask", messages: history, context: ctx });
  MX.busy = false; syncUsage(r);
  if (!r.ok) {
    if (r.code === "auth") { S.me = null; render(); return; }
    if (r.code === "terms") { await refreshMe(); }
    msgs.push({ role: "assistant", error: true, text: r.code === "limit" ? limitMsg(r) : r.error || "Max couldn't answer. Try again." });
    await saveMax(); if (S.tab === "draft") render(); return;
  }
  msgs.push({ role: "assistant", text: r.reply, action: r.action, label: r.label, args: r.args, ask: q });
  await saveMax();
  S.maxScroll = true;
  if (S.tab === "draft") render();
  if (r.action && r.action !== "none" && r.action !== "save_voice") setTimeout(() => runMaxAction(r.action, r.args || {}, q), 900);
}
// Max offers to save how you want to sound. Nothing saves until you tap Save.
function voiceSaveCard(m) {
  const a = m.args || {}, c = el("div", "vs-card");
  const rules = (a.rules || "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (rules.length) { const ul = el("ul", ""); rules.forEach((x) => ul.append(el("li", "", x))); c.append(el("div", "label", "Rules for every draft"), ul); }
  if (a.framework) c.append(el("div", "label", "Framework"), el("p", "small", a.framework));
  if (m.saved) { c.append(el("div", "q live", "✓ Saved to your voice. Your next draft uses it.")); return c; }
  const row = el("div", "row");
  const save = btn("Save to my voice", "ab-btn sm", async () => {
    save.disabled = true;
    const r = await addVoice({ rules: a.rules || "", framework: a.framework || "", source: "chat" });
    if (!r || !r.ok) { save.disabled = false; return alertIn(c, (r && r.error) || "Couldn't save. Try again."); }
    if (r.me) S.me = r.me;
    m.saved = true; await saveMax(); render();
  });
  row.append(save, btn("Edit in Voice", "link", () => { S.tab = "account"; S.setSec = "voice"; render(); }));
  c.append(row);
  return c;
}
async function runMaxAction(action, args, ask) {
  const note = async (text) => { const msgs = await maxMsgs(); msgs.push({ role: "assistant", error: true, text }); await saveMax(); setTab("draft"); render(); };
  if (action === "draft_opener") { const r = await toPage("startOpener"); if (!r.ok) return note("Open their LinkedIn profile in this tab and ask me again."); return; }
  if (action === "suggest_reply") { const r = await toPage("startReply"); if (!r.ok) return note("Open the LinkedIn chat in this tab and ask me again."); return; }
  if (action === "score_profile") {
    const r = await toPage("readProfile");
    if (!r.ok || !r.text) return note("Open the LinkedIn profile you want scored in this tab, then ask me again.");
    S.tab = "profile"; S.pv = null; render();
    return runAnalyze({ text: r.text, name: r.name, url: r.url, images: r.images, subject: r.own ? "self" : "other" });
  }
  if (action === "write_post") { setTab("posts"); P.sub = "write"; return genPost({ topic: args.idea || ask || "", type: "auto", stage: "auto" }); }
  if (action === "post_ideas") { P.sub = "ideas"; P.autoIdeas = args.topic || ""; S.tab = "posts"; return render(); }
  if (action === "trends") { P.sub = "trends"; P.autoTrends = args.focus || ""; S.tab = "posts"; return render(); }
  if (action === "banner") { S.tab = "profile"; S.pv = null; render(); return setTimeout(() => { const bm = document.getElementById("banner-maker"); if (bm) bm.scrollIntoView({ block: "start" }); }, 500); }
  if (action === "follow_ups") { S.tab = "radar"; return render(); }
  if (action === "autopilot") { S.tab = "autopilot"; return render(); }
  if (action === "setup") { S.setupStep = 1; S.tab = "setup"; return render(); }
  if (action === "tailor_resume" || action === "find_contacts") {
    const r = await toPage("readJob");
    if (!r.ok || !r.job || !r.job.title) return note("Open the LinkedIn job posting in this tab, then ask me again.");
    return action === "tailor_resume" ? runTailor(r.job) : runContacts(r.job);
  }
  if (action === "score_resume") { if (!(await getResume())) { S.tab = "jobs"; return render(); } return runResumeScore(); }
  if (action === "open_jobs") { S.tab = "jobs"; return render(); }
  if (action === "job_alerts") { if (isJobSeeker()) S.tab = "alerts"; else { S.tab = "radar"; S.radarTab = "alerts"; } return render(); }
}

// ---------- Radar ----------
async function radarLists() {
  const [convos, pipe, settings] = await Promise.all([store("abConvos", {}), store("abPipeline", {}), store("settings", {})]);
  const skipList = (settings.skipList || "").split("\n").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const onSkip = (n) => { const k = nameKey(n); return skipList.some((x) => k === x || k.includes(x)); };
  const now = Date.now(), day = 86400000;
  const waiting = [], nudge = [];
  for (const [k, c] of Object.entries(convos)) {
    if (c.group || onSkip(c.name)) continue;
    const p = pipe[k];
    if (p && /booked|not a fit/i.test(p.stage || "")) continue;
    const age = c.lastAt ? Math.floor((now - c.lastAt) / day) : null;
    const row = { ...c, key: k, stage: p ? p.stage : "", next: p ? p.next : "", age };
    if (!c.fromYou && (age === null || age <= 21)) waiting.push(row);
    else if (c.fromYou && age !== null && age >= 3 && age <= 21) nudge.push(row);
  }
  const rank = (r) => ({ Offer: 0, Intent: 1, Rapport: 2, Opener: 3 }[r.stage] ?? 4);
  waiting.sort((a, b) => (b.unread - a.unread) || rank(a) - rank(b) || (b.lastAt || 0) - (a.lastAt || 0));
  nudge.sort((a, b) => rank(a) - rank(b) || (a.lastAt || 0) - (b.lastAt || 0));
  return { waiting, nudge, pipe };
}
async function scanNow(statusEl) {
  const r = await toPage("scan");
  if (r.notLinkedIn) { statusEl.textContent = "Open LinkedIn Messaging first."; return false; }
  if (!r.ok || !r.n) { statusEl.innerHTML = ""; statusEl.append(document.createTextNode("Open LinkedIn Messaging so your inbox list is on screen, then check again. ")); statusEl.append(btn("Open Messaging", "link", () => toPage("goto", { url: "https://www.linkedin.com/messaging/" }))); return false; }
  return true;
}
const ago = (a) => (a === null || a === undefined ? "" : a === 0 ? "today" : a + "d ago");
async function renderRadar() {
  view.innerHTML = "";
  const { waiting, nudge, pipe } = await radarLists();
  const sessions = await store("abSessions", []);
  const scanAt = await store("abScanAt", 0);
  const seg = el("div", "seg");
  const al = hasAlerts() && !isJobSeeker() ? await store("abAlerts", null) : null;
  const alN = al && al.day === todayKey() ? al.feed.length + al.web.length : 0;
  const cnt = (l, n) => (n ? `${l} ${n}` : l);
  [["todo", cnt("To do", waiting.length + nudge.length)], ["pipe", cnt("Pipeline", Object.keys(pipe).length)], ...(hasAlerts() && !isJobSeeker() ? [["alerts", cnt("Alerts", alN)]] : []), ["recent", cnt("Recent", sessions.length)]].forEach(([k, l]) => seg.append(btn(l, S.radarTab === k ? "on" : "", () => { S.radarTab = k; renderRadar(); })));
  view.append(seg);
  if (S.radarTab === "alerts") return renderAlertsTab(true);
  if (S.radarTab !== "recent") {
    const status = el("div", "muted");
    const check = btn("↻ Check my inbox", "ab-btn ghost", async () => { check.disabled = true; check.textContent = "Checking..."; const ok = await scanNow(status); check.disabled = false; if (ok) renderRadar(); else check.textContent = "↻ Check my inbox"; });
    view.append(check, status);
    if (scanAt) status.textContent = "Last checked " + agoTime(scanAt) + ". Reads the inbox list on screen, once, when you click.";
  }
  const row = (r, label, nudgeIt) => {
    const line = el("div", "rrow"); const main = el("div", "rmain");
    const nm = el("div", "rname"); if (r.unread) nm.append(el("i", "dot")); nm.append(el("span", "", r.name)); if (r.stage) nm.append(el("span", "tag w", r.stage));
    main.append(nm, el("div", "rsub", (r.next && label !== "Reply" ? r.next : r.snippet) + (r.age !== null && r.age !== undefined ? " · " + ago(r.age) : "")));
    const go = btn(label, "act", () => openChat(go, { name: r.name, nudge: nudgeIt ? { days: r.age } : null })); line.append(main, go);
    return line;
  };
  if (S.radarTab === "todo") {
    view.append(el("div", "sect", "Waiting on you"));
    const w = el("div", ""); waiting.slice(0, 15).forEach((r) => w.append(row(r, "Reply"))); if (!waiting.length) w.append(el("div", "empty", "Nobody's waiting on you. Nice.")); view.append(w);
    view.append(el("div", "sect", "Nudge due (3+ days quiet)"));
    const n = el("div", ""); nudge.slice(0, 15).forEach((r) => n.append(row(r, "Nudge", true))); if (!nudge.length) n.append(el("div", "empty", "No nudges due.")); view.append(n);
    if (feat("autopilot") && waiting.length + nudge.length > 1) view.append(btn(`✦ Run Autopilot on all ${waiting.length + nudge.length}`, "ab-btn", () => { S.tab = "autopilot"; render(); }));
  } else if (S.radarTab === "pipe") {
    const arr = Object.values(pipe);
    const cols = el("div", "pcols");
    STAGES.forEach((st) => { const c = el("div", "pcol" + (S.pipeFilter === st ? " on" : "")); c.append(el("b", "", String(arr.filter((p) => p.stage === st).length)), el("span", "", st)); c.onclick = () => { S.pipeFilter = S.pipeFilter === st ? "" : st; renderRadar(); }; cols.append(c); });
    view.append(cols);
    const order = ["Offer", "Intent", "Rapport", "Opener", "Needs you", "Booked", "Not a fit"];
    const list = arr.filter((p) => !S.pipeFilter || p.stage === S.pipeFilter).sort((a, c) => order.indexOf(a.stage) - order.indexOf(c.stage) || (c.at || 0) - (a.at || 0));
    const wrap = el("div", "");
    list.slice(0, 50).forEach((p) => {
      const line = el("div", "rrow"); const main = el("div", "rmain");
      main.append(el("div", "rname", p.name), el("div", "rsub", (p.next || "") + " · " + Math.floor((Date.now() - (p.at || Date.now())) / 86400000) + "d"));
      const sel = el("select", "stg"); ["Opener", "Rapport", "Intent", "Offer", "Booked", "Needs you", "Not a fit"].forEach((st) => { const o = el("option", "", st); o.value = st; if (st === p.stage) o.selected = true; sel.append(o); });
      sel.onchange = async () => { const pp = await store("abPipeline", {}); const k = nameKey(p.name); pp[k] = { ...(pp[k] || {}), stage: sel.value, at: Date.now() }; await setStore({ abPipeline: pp }); renderRadar(); };
      const op = btn("Open", "act ghost", () => openChat(op, { name: p.name, draft: false })); line.append(main, sel, op);
      wrap.append(line);
    });
    if (!list.length) wrap.append(el("div", "empty", arr.length ? "Nobody in this stage." : "Your pipeline fills in as you use Suggest reply. Each chat gets a stage."));
    view.append(wrap);
  } else {
    const wrap = el("div", "");
    sessions.forEach((x) => {
      const line = el("div", "rrow"); const main = el("div", "rmain");
      const nm = el("div", "rname"); nm.append(el("span", "", x.name || "Draft"), el("span", "tag w", x.mode === "reply" ? "Reply" : x.mode === "comment" ? "Comment" : "Opener"));
      main.append(nm, el("div", "rsub", ((x.parsed && x.parsed.lines && x.parsed.lines[0]) || "") + " · " + agoTime(x.at)));
      line.append(main, btn("Reopen", "act", async () => { const r = await toPage("reopen", { sid: x.sid }); if (r.notLinkedIn) alertIn(view, "Open a LinkedIn tab first."); }));
      wrap.append(line);
    });
    if (!sessions.length) wrap.append(el("div", "empty", "No saved drafts yet. Every draft you make is saved here."));
    view.append(wrap, el("p", "muted", "Your last 30 credits are saved in this browser."));
  }
}
const agoTime = (t) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago"; };

// ---------- Autopilot: go down your inbox, one tap each ----------
async function renderAutopilot() {
  view.innerHTML = "";
  if (!feat("autopilot")) {
    const h = el("div", "hero");
    h.append(el("div", "ab-eye", "Autopilot"), el("h2", "", "Clear your whole inbox in minutes"),
      el("p", "", "Max lines up everyone waiting on you and everyone due a nudge. Open each chat, the reply is already written. Approve, send, next."));
    view.append(h);
    const c = el("div", "card");
    ["A queue of every reply and nudge due", "Drafts land in the box as each chat opens", "Booking handoff when they're ready for a call", "2,000 credits a month"].forEach((x) => c.append(el("p", "small", "✓ " + x)));
    if (isOwner()) c.append(btn(acct() && acct().trialEligible ? "Try Autopilot free for 5 days" : "Upgrade to Autopilot · $59/mo", "ab-btn", () => bg({ type: "checkout", plan: "autopilot" }).then(async (r) => { if (!r.ok) return alertIn(view, r.error || "Couldn't start checkout."); if (r.switched) { S.me = r.me || (await refreshMe()); render(); return; } S.awaitingCheckout = true; pollForPlan(); })));
    c.append(el("p", "muted", "Want it fully done for you? Managed Inbox: our team runs your inbox for $397/mo."));
    if (isOwner()) c.append(btn("See Managed Inbox", "ab-btn ghost", () => { S.tab = "plans"; render(); }));
    view.append(c);
    return;
  }
  const ap = await store("abAutopilot", null);
  if (!ap || ap.i >= ap.items.length) {
    const h = el("div", "hero");
    h.append(el("div", "ab-eye", "Autopilot"), el("h2", "", ap ? "Inbox cleared ✓" : "Ready when you are"),
      el("p", "", ap ? `You worked through ${ap.items.length} conversation${ap.items.length === 1 ? "" : "s"}. Nice.` : "Start a session and Max lines up every reply and nudge that's due, in priority order."));
    view.append(h);
    const status = el("div", "muted");
    const go = btn("✦ Start a session", "ab-btn", async () => {
      go.disabled = true; go.textContent = "Checking your inbox...";
      await scanNow(status);
      const { waiting, nudge } = await radarLists();
      const items = [...waiting.map((r) => ({ name: r.name, kind: "reply", snippet: r.snippet, age: r.age })), ...nudge.map((r) => ({ name: r.name, kind: "nudge", snippet: r.snippet, age: r.age }))].slice(0, 30);
      go.disabled = false; go.textContent = "✦ Start a session";
      if (!items.length) { status.textContent = status.textContent || "Nothing due right now. Check back later."; return; }
      await setStore({ abAutopilot: { items, i: 0, startedAt: Date.now(), done: 0 } });
      renderAutopilot();
    });
    view.append(go, status, el("span", "safe", "✓ You open each chat and press Send. Nothing is sent for you."));
    return;
  }
  const it = ap.items[ap.i];
  const prog = el("div", "ap-progress"); prog.append(el("span", "", `${ap.i + 1} of ${ap.items.length}`), btn("End session", "link", async () => { await setStore({ abAutopilot: null }); renderAutopilot(); }));
  const bar = el("div", "meter"); const fill = el("i"); fill.style.width = Math.round((ap.i / ap.items.length) * 100) + "%"; bar.append(fill);
  view.append(prog, bar);
  const card = el("div", "ap-card");
  const nm = el("div", "rname"); nm.append(el("span", "", it.name), el("span", "tag " + (it.kind === "nudge" ? "n" : "w"), it.kind === "nudge" ? "Nudge · " + ago(it.age) : "Waiting on you"));
  card.append(nm, el("div", "rsub", it.snippet || ""));
  const mine = S.draft && S.draft.batch && nameKey(S.draft.name).startsWith(nameKey(it.name).split(" ")[0]);
  if (!mine) { const oc = btn("Open chat and draft", "ab-btn", () => openChat(oc, { name: it.name, batch: true, nudge: it.kind === "nudge" ? { days: it.age } : null })); card.append(oc); }
  view.append(card);
  if (mine) { const c = el("div", "card"); renderDraftCard(c); view.append(c); }
  const nav = el("div", "row");
  nav.append(btn("Skip", "ab-btn ghost", () => advance()), btn(mine ? "Sent. Next →" : "Next →", mine ? "ab-btn" : "ab-btn ghost", () => advance(true)));
  view.append(nav);
}
async function advance(done) {
  const ap = await store("abAutopilot", null);
  if (!ap) return;
  ap.i += 1; if (done) ap.done = (ap.done || 0) + 1;
  await setStore({ abAutopilot: ap });
  if (S.draft && S.draft.batch) { S.draft = null; S.queue = null; }
  renderAutopilot();
}
function onSent(v) {
  // When every line of an Autopilot reply is sent, move to the next person.
  if (S.tab === "autopilot" && S.draft && S.draft.batch && v.sid === S.draft.sid) setTimeout(() => advance(true), 900);
}

// ---------- account ----------
const SET_SECS = [["account", "Account"], ["about", "About", "About you"], ["voice", "Voice", "Voice & training"], ["invite", "Invite", "Invite friends"], ["prefs", "Display", "Display and preferences"]];
async function renderAccount() {
  view.innerHTML = "";
  if (S.showInvite) S.setSec = "invite";
  if (!SET_SECS.some(([k]) => k === S.setSec)) S.setSec = "account";
  const nav = el("nav", "setnav"); nav.setAttribute("aria-label", "Settings sections");
  SET_SECS.forEach(([k, l]) => { const b = btn(l, "setnav-b" + (S.setSec === k ? " on" : ""), () => { S.setSec = k; renderAccount(); view.scrollTop = 0; }); if (S.setSec === k) b.setAttribute("aria-current", "page"); nav.append(b); });
  view.append(nav);
  const sec = SET_SECS.find(([k]) => k === S.setSec); const title = sec[2] || sec[1];
  view.append(el("h2", "set-h", title));
  if (S.setSec === "about") return renderAboutSec();
  if (S.setSec === "voice") return renderVoiceSec();
  if (S.setSec === "invite") { const invite = el("div", "card invite"); invite.id = "invite"; view.append(invite); return renderInvite(invite); }
  if (S.setSec === "prefs") return renderPrefsSec();
  const a = acct();
  const c = el("div", "card");
  c.append(el("div", "label", "Signed in as"), el("p", "", S.me.email));
  c.append(el("div", "label", "Plan"), el("p", "", `${a.planName}` + (a.free ? (a.periodEnd ? ` · credits reset ${fmtDate(a.periodEnd)}` : "") : a.trialing ? " · free trial" : a.periodEnd ? ` · renews ${fmtDate(a.periodEnd)}` : "") + (S.me.role === "member" ? " · team member" : "")));
  const u = a.usage;
  if (u) c.append(el("p", "muted", `${u.drafts.toLocaleString()} of ${u.draftLimit.toLocaleString()} credits used` + (u.conversationLimit ? ` · ${u.conversations} of ${u.conversationLimit} conversations` : "") + (a.free && a.freeScores ? ` · ${a.freeScores.used} of ${a.freeScores.limit} profile scores used` : "")));
  if (u && u.bonusCredits) c.append(el("p", "small", `🎁 ${u.bonusCredits.toLocaleString()} bonus credits from invites (never expire)`));
  if (savedMin()) c.append(el("p", "small", `⏱ Max has saved you about ${fmtSaved(savedMin())} so far.`));
  if (a.free && isOwner()) c.append(freeUpsell("Get 50x the credits and every feature", "Posts, comments, trends, banners, unlimited profile scores and Autopilot. Plans start at $15 a month."));
  if (a.trialing) {
    const t = el("div", "card soft");
    const plan = (S.plans && S.plans.plans.find((x) => x.id === a.plan)) || null;
    t.append(el("div", "label", "Free trial"), el("p", "small", `Your trial ends ${fmtDate(a.trialEnd)}. ` + (plan ? `Then ${plan.priceLabel}. ` : "") + "Cancel anytime before then in Billing and cancel and you pay nothing."));
    if (isOwner()) t.append(btn("Start plan now", "ab-btn ghost sm", endTrial));
    c.append(t);
  }
  if (isOwner()) {
    const row = el("div", "row");
    if (a.hasBilling) { const bb = btn("Billing and cancel", "ab-btn ghost sm", () => billingBtn(bb, { type: "portal" })); row.append(bb); }
    if (!a.free) row.append(btn("Change plan", "ab-btn ghost sm", () => { S.tab = "plans"; render(); }));
    c.append(row);
    if (a.features && a.features.canTopup) { const tb = btn(feat("managed") ? "Add 50 conversations · $197" : "Add 250 credits · $10", "ab-btn ghost sm", () => billingBtn(tb, { type: "topup", kind: feat("managed") ? "conversations" : "drafts" })); c.append(tb); }
  }
  view.append(c);
  const help = el("div", "card soft");
  help.append(el("p", "small", "Running a team? We'll set up seats, a shared playbook and one invoice."), btn("Book a demo for Teams", "ab-btn ghost sm", () => bg({ type: "openUrl", url: CFG.BOOK_DEMO_URL })),
    el("p", "muted", "Questions? " + CFG.SUPPORT_EMAIL));
  view.append(help, btn("Sign out", "link", logout));
}
function renderAboutSec() {
  const a = acct(), p = (a && a.profile) || {};
  const c = el("div", "card");
  c.append(el("p", "muted", "Max uses this in every draft so it sounds like you and fits your goal."));
  const roleName = (ROLES.find(([v]) => v === p.role) || [])[1];
  const rows = [["I am", roleName], ["Main goal", (p.goals || [])[0]], ["Name", p.name], [p.role === "job_seeker" ? "Role I want next" : "What I offer", p.role === "job_seeker" ? p.targetRole : p.offer], ["Who I want to reach", p.titles], ["Writing style", p.style ? p.style[0].toUpperCase() + p.style.slice(1) : ""]];
  const dl = el("dl", "about-dl");
  rows.forEach(([k, v]) => { if (!v) return; dl.append(el("dt", "", k), el("dd", "", v)); });
  c.append(dl);
  if (isOwner()) c.append(btn("Edit About you", "ab-btn ghost sm", () => { S.setupStep = 1; S.setupReturn = "about"; S.tab = "setup"; render(); }));
  else c.append(el("p", "small", "Your team owner manages this."));
  view.append(c);
  const v = el("div", "card soft");
  v.append(el("p", "small", "Want drafts to sound even more like you? Add writing samples and frameworks in Voice & training."), btn("Go to Voice & training", "ab-btn ghost sm", () => { S.setSec = "voice"; renderAccount(); }));
  view.append(v);
}
async function renderPrefsSec() {
  const settings = await store("settings", {});
  const sk = el("div", "card");
  sk.append(el("div", "label", "Skip list"), el("p", "muted", "One name per line. You'll get a heads up before drafting to them (friends, clients, people you've parked)."));
  const ta = el("textarea"); ta.rows = 4; ta.value = settings.skipList || "";
  ta.onchange = async () => { const s = await store("settings", {}); await setStore({ settings: { ...s, skipList: ta.value } }); };
  sk.append(ta); view.append(sk);
  const ap = el("div", "card"); ap.append(el("div", "label", "Appearance"));
  const seg = el("div", "seg"); [["system", "System"], ["light", "Light"], ["dark", "Dark"]].forEach(([v, l]) => seg.append(btn(l, themePref === v ? "on" : "", async () => { const s = await store("settings", {}); await setStore({ settings: { ...s, theme: v } }); themePref = v; applyTheme(); renderAccount(); })));
  ap.append(seg); view.append(ap);
}
// ---------- Voice & training: writing samples, frameworks and rules Max uses in every draft ----------
const TRAIN_KINDS = [["samples", "Writing sample", "Sample"], ["framework", "Framework or script", "Framework"], ["rules", "Rules", "Rules"]];
const TRAIN_LIMIT = 20000;
async function readTrainingFile(file) {
  const name = file.name || "";
  if (/\.(txt|md|markdown|csv)$/i.test(name) || /^text\//.test(file.type)) return await file.text();
  if (/\.docx$/i.test(name)) return await docxText(await file.arrayBuffer());
  throw new Error("Use a .txt, .md or .docx file. For a PDF, copy the text and paste it below.");
}
// Minimal .docx reader: finds word/document.xml in the zip and pulls the paragraph text.
async function docxText(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That .docx file looks damaged.");
  let off = dv.getUint32(eocd + 16, true); const n = dv.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), loff = dv.getUint32(off + 42, true);
    const fname = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
    if (fname === "word/document.xml") {
      const lnl = dv.getUint16(loff + 26, true), lxl = dv.getUint16(loff + 28, true), start = loff + 30 + lnl + lxl;
      let data = u8.subarray(start, start + csize);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      const xml = new TextDecoder().decode(data);
      return xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
    }
    off += 46 + nlen + xlen + clen;
  }
  throw new Error("Couldn't find text in that .docx file.");
}
// Add rules (and a framework) to Voice & training, merging into one item per source so it stays tidy.
async function addVoice({ rules = "", framework = "", samples = "", source = "Max" }) {
  const r = await bg({ type: "getTraining" });
  if (!r.ok) return r;
  const items = (r.training || []).slice();
  const upsert = (kind, name, text, merge) => {
    text = (text || "").trim(); if (!text) return;
    const i = items.findIndex((t) => t.kind === kind && t.name === name);
    if (i < 0) { items.push({ kind, name, text, at: Math.floor(Date.now() / 1000) }); return; }
    if (merge) { const have = items[i].text.split("\n").map((x) => x.trim()); const add = text.split("\n").map((x) => x.trim()).filter((x) => x && !have.includes(x)); text = have.concat(add).join("\n"); }
    items[i] = { ...items[i], text, at: Math.floor(Date.now() / 1000) };
  };
  upsert("rules", source === "chat" ? "Rules from chat with Max" : "My voice (built with Max)", rules, source === "chat");
  upsert("framework", source === "chat" ? "Framework from chat with Max" : "My framework (built with Max)", framework, false);
  upsert("samples", "Samples from the voice builder", samples, false);
  const total = items.reduce((n, t) => n + (t.text || "").length, 0);
  if (total > TRAIN_LIMIT) return { ok: false, error: `That would go over ${TRAIN_LIMIT.toLocaleString()} characters. Remove something in Voice & training first.` };
  return bg({ type: "saveTraining", items });
}
const VOICE_PICKS = ["Casual", "Professional", "Short and punchy", "Warm and empathetic", "A little humor", "No emojis", "Always end with a question", "Never pitch in the first message", "Sign off with my name"];
function voiceBuilder(onSaved) {
  const card = el("div", "card vb");
  card.append(el("div", "label", "✦ Build your voice with Max"), el("p", "small", "Tell Max how you write in your own words. Pick a few, paste a message or two if you like, and Max turns it into rules. Free, and you review before anything saves."));
  const desc = el("textarea"); desc.rows = 3; desc.placeholder = "Example: Casual and short, a little humor. Lead with something specific about them. Never pitch in the first message. Sign off with Brian.";
  const picked = new Set();
  const chips = el("div", "chips vb-chips");
  VOICE_PICKS.forEach((t) => { const c = btn(t, "chip", () => { picked.has(t) ? picked.delete(t) : picked.add(t); c.classList.toggle("on", picked.has(t)); }); chips.append(c); });
  const more = el("details", "vb-more"); more.append(el("summary", "", "Add a few of your messages (optional)"));
  const samp = el("textarea"); samp.rows = 4; samp.placeholder = "Paste 2 or 3 messages or posts you wrote. Max matches the voice, never copies them.";
  more.append(samp);
  const out = el("div", "");
  const go = btn("✦ Build my voice", "ab-btn", async () => {
    go.disabled = true; go.textContent = "Max is reading..."; out.innerHTML = "";
    const r = await bg({ type: "voiceBuild", describe: desc.value, picks: [...picked], samples: samp.value });
    go.disabled = false; go.textContent = "✦ Build again";
    if (!r || !r.ok) { out.append(el("p", "err", (r && r.error) || "Couldn't build that. Try again.")); return; }
    if (r.summary) out.append(el("p", "small vb-sum", r.summary));
    out.append(el("div", "label", "Your rules (edit anything)"));
    const rt = el("textarea"); rt.rows = Math.min(10, (r.rules || []).length + 1); rt.value = (r.rules || []).join("\n"); out.append(rt);
    let ft = null;
    if (r.framework) { out.append(el("div", "label", "Your framework")); ft = el("textarea"); ft.rows = 4; ft.value = r.framework; out.append(ft); }
    const save = btn("Save to my voice", "ab-btn", async () => {
      save.disabled = true;
      const res = await addVoice({ rules: rt.value, framework: ft ? ft.value : "", samples: samp.value, source: "builder" });
      save.disabled = false;
      if (!res || !res.ok) return alertIn(out, (res && res.error) || "Couldn't save. Try again.");
      if (res.me) S.me = res.me;
      onSaved && onSaved();
    });
    out.append(save);
  });
  card.append(desc, chips, more, go, out, el("p", "muted", "Tip: you can also just tell Max in chat, like \"always sign off with Brian\"."));
  return card;
}
async function renderVoiceSec() {
  const intro = el("div", "card soft");
  intro.append(el("p", "small", "Teach Max how you write. Add your best messages and posts, your outreach framework, script or prompt, and any rules. They win over Max's default style in every opener, reply, comment and post, starting with your next draft."));
  view.append(intro);
  if (isOwner()) view.append(voiceBuilder(async () => { S.setSec = "voice"; render(); setTimeout(() => { const pv = document.querySelector(".tr-prev"); if (pv) { pv.scrollIntoView({ behavior: "smooth", block: "center" }); pv.classList.add("flash"); setTimeout(() => pv.classList.remove("flash"), 1600); } }, 400); }));
  const box = el("div", "card"); box.append(spinner("Loading your training...")); view.append(box);
  const r = await bg({ type: "getTraining" });
  box.innerHTML = "";
  if (!r.ok) { box.append(el("p", "err", r.error || "Couldn't load your training. Try again.")); return; }
  let items = r.training || [];
  const total = () => items.reduce((n, t) => n + (t.text || "").length, 0);
  const meter = el("div", "tr-meter"); const bar = el("i"); const lbl = el("span", "small");
  const updMeter = () => { const t = total(); bar.style.width = Math.min(100, (t / TRAIN_LIMIT) * 100) + "%"; lbl.textContent = `${t.toLocaleString()} of ${TRAIN_LIMIT.toLocaleString()} characters`; meter.classList.toggle("full", t > TRAIN_LIMIT * 0.9); };
  const mb = el("div", "meter"); mb.append(bar); meter.append(lbl, mb); box.append(meter); updMeter();
  const list = el("div", "tr-list"); box.append(list);
  const owner = isOwner();
  const save = async (next, msgOk) => {
    const res = await bg({ type: "saveTraining", items: next });
    if (!res.ok) { alertIn(box, res.error || "Couldn't save. Try again."); return false; }
    if (res.me) S.me = res.me;
    items = next; drawList(); updMeter(); if (msgOk) { const ok = el("div", "q live", msgOk); box.prepend(ok); setTimeout(() => ok.remove(), 4000); }
    return true;
  };
  const drawList = () => {
    list.innerHTML = "";
    if (!items.length) { list.append(el("p", "muted", "Nothing yet. Add your first one below.")); return; }
    items.forEach((t) => {
      const row = el("div", "tr-item");
      const kind = (TRAIN_KINDS.find(([k]) => k === t.kind) || TRAIN_KINDS[0])[1];
      const meta = el("div"); meta.append(el("span", "tr-kind tr-" + t.kind, kind), el("b", "", t.name), el("span", "muted", ` · ${(t.text || "").length.toLocaleString()} characters`));
      row.append(meta);
      if (owner) { const acts = el("div", "tr-acts"); acts.append(btn("Edit", "link", () => startEdit(t)), btn("Remove", "link", () => save(items.filter((x) => x !== t), "Removed. Your next draft won't use it."))); row.append(acts); }
      list.append(row);
    });
  };
  drawList();
  // Preview: one sample opener with the current voice, so a change shows up right away.
  const pv = el("div", "card soft tr-prev");
  const pvOut = el("div", "");
  const pvBtn = btn("✦ Preview my voice", "ab-btn ghost sm", async () => {
    pvBtn.disabled = true; pvBtn.textContent = "Writing a sample..."; pvOut.innerHTML = "";
    const r = await bg({ type: "voicePreview" });
    pvBtn.disabled = false; pvBtn.textContent = "✦ Preview again";
    if (!r || !r.ok) { pvOut.append(el("p", "err", (r && r.error) || "Couldn't write a sample. Try again.")); return; }
    pvOut.append(el("div", "label", "Sample opener to " + (r.prospect || "a sample prospect")));
    const q = el("div", "tr-sample"); (r.lines || []).forEach((l) => q.append(el("p", "", l))); pvOut.append(q);
    pvOut.append(el("p", "muted", "Not quite you? Add a rule or a sample above, then preview again."));
  });
  pv.append(el("div", "label", "See it in action"), el("p", "small", "Max writes a sample opener with your voice and rules as they are right now. Uses 1 credit."), pvBtn, pvOut);
  view.append(pv);
  if (!owner) { box.append(el("p", "small", "Your team owner manages training.")); return; }
  const add = el("div", "card"); const addLabel = el("div", "label", "Add your own: samples, a framework, prompt or rules"); add.append(addLabel);
  let kind = "samples";
  const seg = el("div", "seg tr-seg");
  const drawSeg = () => { seg.innerHTML = ""; TRAIN_KINDS.forEach(([k, , l]) => seg.append(btn(l, kind === k ? "on" : "", () => { kind = k; drawSeg(); ta.placeholder = PH[k]; }))); };
  const PH = { samples: "Paste 3 to 5 of your best messages or posts. Max will match the voice.", framework: "Paste your outreach framework, script or prompt. For example: compliment their work, ask one curious question, offer value before pitching.", rules: "One rule per line. For example: never use the word synergy. Always end with a question." };
  const name = el("input"); name.type = "text"; name.placeholder = "Name it, like 'My best DMs'"; name.maxLength = 80;
  const ta = el("textarea"); ta.rows = 6; ta.placeholder = PH.samples;
  drawSeg();
  const file = el("input"); file.type = "file"; file.accept = ".txt,.md,.markdown,.csv,.docx,text/plain"; file.className = "hidden";
  const up = btn("Upload a file", "ab-btn ghost sm", () => file.click());
  const fileMsg = el("span", "muted", ".txt, .md or .docx");
  file.onchange = async () => {
    const f = file.files && file.files[0]; if (!f) return;
    try { const txt = (await readTrainingFile(f)).trim(); if (!txt) throw new Error("That file has no text in it."); ta.value = txt; if (!name.value) name.value = f.name.replace(/\.[^.]+$/, "").slice(0, 80); fileMsg.textContent = `${f.name} · ${txt.length.toLocaleString()} characters`; }
    catch (e) { fileMsg.textContent = e.message || "Couldn't read that file."; }
    file.value = "";
  };
  const upRow = el("div", "row"); upRow.append(up, fileMsg);
  let editing = null;
  const cancel = btn("Cancel", "link hidden", () => endEdit());
  const go = btn("Save to Max", "ab-btn", async () => {
    const text = ta.value.trim();
    if (!text) return alertIn(add, "Paste some text or upload a file first.");
    const others = items.filter((x) => x !== editing);
    if (others.reduce((n, t) => n + (t.text || "").length, 0) + text.length > TRAIN_LIMIT) return alertIn(add, `That would go over ${TRAIN_LIMIT.toLocaleString()} characters. Shorten it or remove something first.`);
    go.disabled = true;
    const entry = { kind, name: name.value.trim() || "Untitled", text, at: Math.floor(Date.now() / 1000) };
    const next = editing ? items.map((x) => (x === editing ? entry : x)) : items.concat([entry]);
    const ok = await save(next, editing ? "Updated. Your next draft uses the new version." : "Saved. Your next draft uses it.");
    go.disabled = false;
    if (ok) { endEdit(); pvBtn.textContent = "✦ Preview my voice"; pv.scrollIntoView({ behavior: "smooth", block: "nearest" }); pv.classList.add("flash"); setTimeout(() => pv.classList.remove("flash"), 1600); }
  });
  function startEdit(t) {
    editing = t; kind = TRAIN_KINDS.some(([k]) => k === t.kind) ? t.kind : "samples"; drawSeg();
    name.value = t.name || ""; ta.value = t.text || ""; addLabel.textContent = "Edit " + (t.name || "item");
    go.textContent = "Save changes"; cancel.classList.remove("hidden"); add.scrollIntoView({ behavior: "smooth", block: "start" }); ta.focus();
  }
  function endEdit() {
    editing = null; ta.value = ""; name.value = ""; fileMsg.textContent = ".txt, .md or .docx"; addLabel.textContent = "Add your own: samples, a framework, prompt or rules";
    go.textContent = "Save to Max"; cancel.classList.add("hidden");
  }
  const goRow = el("div", "row"); goRow.append(go, cancel);
  add.append(seg, name, upRow, file, ta, goRow, el("p", "muted", "Only use your own writing or material you have the right to use. Don't include passwords or private client data."));
  view.append(add);
}
// Invite friends: share link, stats, and enter a friend's code (new accounts only).
async function renderInvite(box) {
  box.innerHTML = ""; box.append(el("div", "label", "Invite friends, earn credits"), spinner("Loading your invite link..."));
  const r = await bg({ type: "referral" });
  box.innerHTML = "";
  if (!r.ok || !r.referral) { box.append(el("div", "label", "Invite friends"), el("p", "muted", r.error || "Couldn't load your invite link. Try again in a minute.")); return; }
  const f = r.referral, rw = f.rewards || {};
  box.append(el("div", "label", "Invite friends, earn credits"),
    el("p", "small", `Give ${rw.fresh || 20}, get ${rw.signup || 50}. When a friend signs up with your link and uses Max, you get ${rw.signup || 50} bonus credits and they get ${rw.fresh || 20}. If they subscribe and stay ${rw.paidDays || 30} days, you get a free month of your plan.`));
  const row = el("div", "row");
  const link = el("input"); link.type = "text"; link.readOnly = true; link.value = f.link; link.onclick = () => link.select();
  const copy = btn("Copy link", "ab-btn sm", async () => { try { await navigator.clipboard.writeText(f.link); } catch { link.select(); document.execCommand && document.execCommand("copy"); } copy.textContent = "Copied ✓"; setTimeout(() => (copy.textContent = "Copy link"), 1800); });
  row.append(link, copy); box.append(row);
  box.append(el("p", "muted", `Your code: ${f.code} · they can enter it when they sign in.`));
  const stats = el("div", "inv-stats");
  [[f.joined, "joined"], [f.active, "using Max"], [f.paying, "paying"], [f.creditsEarned, "credits earned"], [f.freeMonths, "free months"]].forEach(([n, l]) => { const s = el("div"); s.append(el("b", "", String(n || 0)), el("span", "", l)); stats.append(s); });
  box.append(stats);
  if (f.canClaim) {
    const d = el("details"); d.append(el("summary", "", "Got an invite code from a friend?"));
    const ci = el("input"); ci.type = "text"; ci.placeholder = "ABC123"; ci.maxLength = 12; pendingRef().then((c) => { if (c && !ci.value) { ci.value = c; d.open = true; } });
    const st = el("div", "muted");
    d.append(ci, btn("Apply code", "ab-btn ghost sm", async () => { const x = await bg({ type: "claimReferral", code: ci.value }); clearPendingRef(); if (!x.ok) { st.className = "err"; st.textContent = x.error || "Couldn't apply that code."; return; } st.className = "q live"; st.textContent = "Applied. Your bonus credits arrive after your first draft."; setTimeout(() => renderInvite(box), 2500); }), st);
    box.append(d);
  }
  if (S.showInvite) S.showInvite = false;
}
async function logout() { await bg({ type: "logout" }); S.me = null; S.draft = null; render(); }

// ---------- boot ----------
// ---------- Banner maker (Profile tab): 3 text options from the server, drawn on brand templates here ----------
const BN = self.AB_BANNER;
const BM = { opt: 0, tpl: "paper", pal: "violet", edits: null };
async function renderBannerMaker(forName) {
  if (isFree()) { const u = freeUpsell("Banner maker", "Answer three questions and get three clean banner designs sized for LinkedIn."); u.id = "banner-maker"; view.append(u); return; }
  const wrap = el("div", "card"); wrap.id = "banner-maker";
  const forOther = !!forName;
  const saved = forOther ? null : await store("abBanner", null);
  const settings = await store("settings", {});
  const inp = forOther ? {} : (saved && saved.inputs) || settings.bannerInputs || {};
  const cost = 3;
  wrap.append(el("div", "ab-eye", "Banner maker"), el("h3", "", forOther ? `A banner for ${forName.split(" ")[0]}` : saved ? "Your banner" : "Make a banner that says what you do"),
    el("p", "small muted", `Answer three questions and get 3 banner options on clean templates. Change the style and colors as much as you like. Each new set of options uses ${cost} credits.`));
  const f = (label, key, ph) => { const i = el("input"); i.type = "text"; i.value = inp[key] || ""; i.placeholder = ph; wrap.append(el("div", "label", label), i); return i; };
  const who = f(forOther ? "Who they are" : "Who you are", "who", "e.g. Career coach, ex Google recruiter");
  const serve = f(forOther ? "Who they serve" : "Who you serve", "serve", "e.g. New grads trying to break into tech");
  const result = f("The result they can expect", "result", "e.g. Land a tech offer in 90 days");
  const link = f("Link (optional)", "link", "e.g. mphtechacademy.com");
  const status = el("div", "");
  const go = btn(saved ? `↻ New options (${cost} credits)` : `✦ Write my banner (${cost} credits)`, "ab-btn", async () => {
    const body = { who: who.value.trim(), serve: serve.value.trim(), result: result.value.trim(), link: link.value.trim() };
    if (!body.who || !body.serve || !body.result) { status.className = "err"; status.textContent = "Fill in who you are, who you serve and the result."; return; }
    go.disabled = true; status.className = ""; status.innerHTML = ""; status.append(spinner("Writing 3 banner options..."));
    const r = await bg({ type: "banner", ...body, forOther });
    go.disabled = false; status.innerHTML = ""; syncUsage(r);
    if (!r.ok) { status.className = "err"; status.textContent = limitMsg(r); return; }
    if (!forOther) await setStore({ abBanner: { inputs: body, options: r.options, at: Date.now() }, settings: { ...(await store("settings", {})), bannerInputs: body } });
    BM.opt = 0; BM.edits = null;
    go.textContent = `↻ New options (${cost} credits)`;
    drawStudio(r.options);
  });
  wrap.append(go, status);
  const studio = el("div", "bn-studio"); wrap.append(studio);
  view.append(wrap);
  await BN.ready();
  function drawStudio(options) {
    studio.innerHTML = "";
    if (!options || !options.length) return;
    const copy = () => ({ ...options[BM.opt], ...(BM.edits || {}) });
    const pv = el("div", "bn-pv"); const cv = document.createElement("canvas"); const ph = el("div", "bn-photo", "Your photo");
    pv.append(cv, ph);
    const paint = () => BN.drawBanner(cv, copy(), BM.tpl, BM.pal);
    const row = (items, cur, on) => { const g = el("div", "chips"); items.forEach(([v, l]) => g.append(btn(l, "chip" + (v === cur ? " on" : ""), (e) => { g.querySelectorAll(".chip").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); on(v); }))); return g; };
    studio.append(el("div", "label", "Option"), row(options.map((_, i) => [i, "Option " + (i + 1)]), BM.opt, (v) => { BM.opt = v; BM.edits = null; fill(); paint(); }));
    studio.append(el("div", "label", "Style"), row(Object.entries(BN.TEMPLATES), BM.tpl, (v) => { BM.tpl = v; paint(); }));
    const sw = el("div", "bn-sw");
    Object.entries(BN.PALETTES).forEach(([k, p]) => { const b = btn("", "bn-dot" + (k === BM.pal ? " on" : ""), (e) => { sw.querySelectorAll(".bn-dot").forEach((x) => x.classList.remove("on")); e.currentTarget.classList.add("on"); BM.pal = k; paint(); }); b.title = p.name; b.style.background = `linear-gradient(135deg, ${p.a}, ${p.b})`; sw.append(b); });
    studio.append(el("div", "label", "Colors"), sw, pv);
    studio.append(el("p", "muted", "The circle shows where your profile photo sits. Text stays clear of it."));
    const ed = (label, key) => { const i = el("input"); i.type = "text"; i.dataset.k = key; i.addEventListener("input", () => { BM.edits = { ...(BM.edits || {}), [key]: i.value }; paint(); }); studio.append(el("div", "label", label), i); return i; };
    const eh = ed("Headline", "headline"), es = ed("Second line", "sub"), ec = ed("Button", "cta");
    const fill = () => { const c = copy(); eh.value = c.headline || ""; es.value = c.sub || ""; ec.value = c.cta || ""; };
    fill(); paint();
    studio.append(btn("⬇ Download PNG (1584 x 396)", "ab-btn", () => {
      const out = document.createElement("canvas"); BN.drawBanner(out, copy(), BM.tpl, BM.pal);
      out.toBlob((blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "linkedin-banner.png"; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, "image/png");
    }), el("p", "muted", "On LinkedIn: open your profile, click the pencil on your banner, then Upload photo. Editing the text here is free."));
  }
  if (saved) drawStudio(saved.options);
}

// ---------- Posts tab: write, ideas, trending, remix (viral post playbook on the server) ----------
const PB = self.AB_PLAYBOOK;
const P = { sub: "write", pre: null, remix: null, busy: false };
const typeName = (id) => (PB.typeById(id) || {}).name || "";
const stageName = (id) => (PB.stageById(id) || {}).name || "";
const GOAL_OPTS = [["auto", "Let it pick"], ...PB.STAGES.map((s) => [s.id, `${s.name} · ${s.short}`])];
function chipRow(opts, cur, on) {
  const g = el("div", "chips");
  opts.forEach(([v, l]) => { const c = btn(l, "chip" + (v === cur ? " on" : ""), () => { g.querySelectorAll(".chip").forEach((x) => x.classList.remove("on")); c.classList.add("on"); on(v); }); g.append(c); });
  return g;
}
function typePicker(cur, on) {
  const s = el("select");
  const o0 = el("option", "", "Pick the best type for me"); o0.value = "auto"; s.append(o0);
  PB.STAGES.forEach((st) => {
    const g = document.createElement("optgroup"); g.label = `${st.name} (${st.short.toLowerCase()})`;
    PB.TYPES.filter((t) => t.stage === st.id).forEach((t) => { const o = el("option", "", t.name); o.value = t.id; g.append(o); });
    s.append(g);
  });
  s.value = PB.typeById(cur) ? cur : "auto"; s.onchange = () => on(s.value);
  return s;
}
function tagRow(type, stage) {
  const r = el("div", "tagrow");
  if (typeName(type)) r.append(el("span", "tag t", typeName(type)));
  if (stageName(stage)) r.append(el("span", "tag g", stageName(stage)));
  return r;
}
function postsHead() {
  const h = el("div", "seg");
  [["write", "✎ Write"], ["ideas", "💡 Ideas"], ["trends", "📈 Trending"]].forEach(([id, l]) => h.append(btn(l, "seg-b" + (P.sub === id || (id === "write" && (P.sub === "remix" || P.sub === "result")) ? " on" : ""), () => { P.sub = id; P.pre = null; renderPostsTab(); })));
  view.append(h);
}
function limitMsg(r) { return r.code === "limit" ? r.error || "You've used your credits for this period." : r.error || "Something went wrong. Try again."; }
function syncUsage(r) { if (r && r.usage && S.me && S.me.account) { S.me.account.usage = r.usage; renderFoot(); } }

async function renderPostsTab() {
  view.innerHTML = "";
  if (isFree()) {
    view.append(el("div", "ab-eye", "Posts"), el("h2", "", "Write posts that bring people to you"));
    view.append(freeUpsell("Posts, ideas, trends and Remix", "Turn a rough idea into a full post with 18 proven post types, get weekly post ideas, see what's trending in your field, and Remix any post into your own take."));
    return;
  }
  postsHead();
  if (P.sub === "ideas") return renderIdeas();
  if (P.sub === "trends") return renderTrends();
  if (P.sub === "remix" && P.remix) return renderRemix();
  if (P.sub === "result") { const d = await store("abPostDraft", null); if (d) return renderPostResult(d); }
  const settings = await store("settings", {});
  const pre = P.pre || {};
  let type = pre.type || settings.postType || "auto", stage = pre.stage || settings.postStage || "auto";
  const c = el("div", "card");
  c.append(el("div", "label", "What do you want to post about?"));
  const topic = el("textarea"); topic.rows = 4; topic.value = pre.topic || "";
  topic.placeholder = "Type a prompt or a rough idea. e.g. A client went from 0 to 5 interviews in 3 weeks after we rewrote her headline.";
  c.append(topic, el("div", "label", "Goal"), chipRow(GOAL_OPTS, stage, (v) => (stage = v)), el("div", "label", "Post type"));
  const rule = el("p", "muted");
  const showRule = () => { const t = PB.typeById(type); rule.textContent = t ? t.rules : "We'll pick the type that fits your idea and goal best, and tell you which."; };
  c.append(typePicker(type, (v) => { type = v; showRule(); }), rule); showRule();
  const status = el("div", "");
  const go = btn("✦ Draft post", "ab-btn", async () => {
    if (topic.value.trim().length < 10) { status.className = "err"; status.textContent = "Add a sentence or two about the idea."; return; }
    await setStore({ settings: { ...(await store("settings", {})), postType: type, postStage: stage } });
    genPost({ topic: topic.value.trim(), type, stage });
  });
  c.append(go, status);
  view.append(c);
  const last = await store("abPostDraft", null);
  if (last && last.post) view.append(btn("Reopen your last post draft", "link", () => { P.sub = "result"; renderPostsTab(); }));
  view.append(el("p", "muted", "Built on a proven viral post playbook: a 5 part story arc, the Attract / Engage / Convert formula and 18 post types. You post it yourself."));
}

let postThread = null; // { opts, messages }
async function genPost(opts, tweak) {
  if (P.busy) return;
  P.busy = true;
  view.innerHTML = ""; postsHead();
  view.append(spinner(tweak ? "Rewriting..." : opts.remix ? "Breaking down why it works, then writing yours..." : "Writing your post..."));
  if (!tweak) {
    const head = `Post type: ${opts.type === "auto" ? "pick for me" : typeName(opts.type)}\nGoal: ${opts.stage === "auto" ? "pick for me" : stageName(opts.stage)}`;
    postThread = { opts, messages: [{ role: "user", content: opts.remix
      ? `Remix this LinkedIn post into my own post.\n${head}\nMy angle: ${opts.topic || "(none given, pick the most natural one for me)"}\n\n--- ORIGINAL POST by ${opts.remix.author} (${opts.remix.stats}) ---\n${opts.remix.text}`
      : `Write a LinkedIn post.\n${head}\nWhat it's about:\n${opts.topic}` }] };
  } else postThread.messages.push({ role: "user", content: `Revise it: ${tweak}\nKeep the same output format and all the rules.` });
  const r = await bg({ type: "draft", mode: postThread.opts.remix ? "remix" : "post", messages: postThread.messages });
  P.busy = false;
  syncUsage(r);
  if (!r.ok) {
    if (tweak) postThread.messages.pop();
    view.innerHTML = ""; postsHead(); view.append(el("div", "err", limitMsg(r)), btn("Try again", "ab-btn ghost", () => genPost(opts, tweak)));
    return;
  }
  postThread.messages.push({ role: "assistant", content: r.text });
  const p = parsePost(r.text);
  const prev = tweak ? (await store("abPostDraft", null)) || {} : {};
  const d = { ...p, analysis: p.analysis || prev.analysis || "", topic: postThread.opts.topic, type: p.typeId || postThread.opts.type, stage: p.stageId || postThread.opts.stage, remix: postThread.opts.remix || null, at: Date.now() };
  await setStore({ abPostDraft: d });
  P.sub = "result";
  renderPostResult(d);
}
function parsePost(raw) {
  const t = String(raw).replace(/\r/g, "");
  const heads = ["ANALYSIS", "TYPE", "WHY", "POST", "HOOKS", "NOTE"];
  const pos = {};
  for (const h of heads) { const m = t.match(new RegExp("^\\s*[#*]*\\s*" + h + "\\s*[*:]*\\s*$", "im")); if (m) pos[h] = { start: m.index, end: m.index + m[0].length }; }
  const part = (h) => { if (!pos[h]) return ""; const n = heads.map((x) => pos[x]).filter((q) => q && q.start > pos[h].start).map((q) => q.start); return t.slice(pos[h].end, n.length ? Math.min(...n) : t.length).trim(); };
  const clean = (x) => x.replace(/\s*[—–]\s*/g, ", ").replace(/\*\*/g, "");
  const typeLine = part("TYPE").toLowerCase();
  const tt = PB.TYPES.find((x) => typeLine.includes(x.name.toLowerCase()));
  const st = PB.STAGES.find((x) => typeLine.includes(x.name.toLowerCase()));
  return {
    post: clean(part("POST") || t.trim()),
    hooks: part("HOOKS").split("\n").map((x) => clean(x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())).filter(Boolean).slice(0, 3),
    note: clean(part("NOTE")), why: clean(part("WHY")), analysis: clean(part("ANALYSIS")), typeId: tt ? tt.id : "", stageId: st ? st.id : "",
  };
}
function renderPostResult(d) {
  view.innerHTML = ""; postsHead();
  if (!postThread) postThread = { opts: { topic: d.topic, type: d.type, stage: d.stage, remix: d.remix }, messages: [{ role: "user", content: "Write a LinkedIn post about:\n" + (d.topic || "(see draft)") }, { role: "assistant", content: "POST\n" + d.post }] };
  const top = el("div", "card soft");
  top.append(tagRow(d.type, d.stage)); if (d.why) top.append(el("p", "small", d.why));
  view.append(top);
  if (d.remix && d.analysis) {
    const det = el("details", "card"); det.open = true;
    det.append(el("summary", "", `Why ${String(d.remix.author).split(" ")[0]}'s post works`), el("p", "small pre", d.analysis));
    view.append(det);
  }
  const ta = el("textarea", "post-ta"); ta.value = d.post;
  const count = el("div", "muted");
  const upd = () => { autosize(ta); count.textContent = `${ta.value.length.toLocaleString()} characters · first 2 lines show before "see more"`; };
  ta.addEventListener("input", upd); view.append(ta, count); taObserver.observe(ta); requestAnimationFrame(upd);
  if (/\[[^\]]{3,40}\]/.test(d.post)) view.append(el("div", "q", "Fill in the [brackets] with your real details before posting."));
  if (d.hooks && d.hooks.length) {
    view.append(el("div", "label", "Other hooks · click to swap in"));
    d.hooks.forEach((h) => view.append(btn(h, "hook", () => { const ls = ta.value.split("\n"); const i = ls.findIndex((l) => l.trim()); ls[i < 0 ? 0 : i] = h; ta.value = ls.join("\n"); upd(); })));
  }
  if (d.note) view.append(el("div", "q", "Weakest part: " + d.note));
  const chips = el("div", "chips");
  [["Punchier", "make it punchier and tighter"], ["Shorter", "make it shorter"], ["Stronger hook", "write stronger first two lines"], ["More story", "add more specific story detail, staying true to what I gave you"], ["Stronger takeaway", "make the takeaway line more quotable"], ["Try another type", "rewrite it as a different post type from the list that could work better, and say which in TYPE"]]
    .forEach(([l, ask]) => chips.append(btn(l, "chip", () => genPost(postThread.opts, ask))));
  view.append(chips);
  const tw = el("div", "row"); const inp = el("input"); inp.type = "text"; inp.placeholder = "Or say what to change...";
  const doT = () => genPost(postThread.opts, inp.value.trim() || "try a different angle");
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doT(); });
  const redo = btn("Redo", "ab-btn ghost sm", doT); tw.append(inp, redo); view.append(tw);
  const msg = el("div", "");
  const row = el("div", "row");
  row.append(btn("Put in post box", "ab-btn", async () => {
    const r = await toPage("placePost", { text: ta.value });
    msg.className = r.ok ? "q live" : "q";
    msg.textContent = r.ok ? "It's in the post box. Read it over, then click Post when you're ready." : r.notLinkedIn ? "Open LinkedIn in this tab, click Start a post, then try again." : "Click Start a post on your LinkedIn feed, wait for the box to open, then click Put in post box again.";
  }), btn("Copy", "ab-btn ghost", async (e) => { const b = e.currentTarget; try { await navigator.clipboard.writeText(ta.value); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; } setTimeout(() => (b.textContent = "Copy"), 1300); }));
  view.append(row, msg, btn("← New post", "link", () => { P.sub = "write"; P.pre = null; renderPostsTab(); }));
}

// ideas
async function renderIdeas() {
  const saved = await store("abIdeas", null);
  let stage = "auto";
  const c = el("div", "card");
  const th = el("textarea"); th.rows = 3; th.placeholder = "Optional. e.g. getting ghosted after interviews, pricing your coaching. Leave blank for a mix.";
  c.append(el("div", "label", "Theme or prompt"), th, el("div", "label", "Goal"), chipRow([["auto", "Mix"], ...GOAL_OPTS.slice(1)], stage, (v) => (stage = v)));
  const status = el("div", "");
  const list = el("div", "list");
  const go = btn("✦ Get 6 ideas", "ab-btn", async () => {
    go.disabled = true; status.className = ""; status.innerHTML = ""; status.append(spinner("Thinking up ideas..."));
    const r = await bg({ type: "ideas", prompt: `Give me 6 LinkedIn post ideas.\nGoal: ${stage === "auto" ? "mix of Attract, Engage and Convert" : stageName(stage)}\nTheme: ${th.value.trim() || "anything that fits me and my audience right now"}` });
    go.disabled = false; status.innerHTML = ""; syncUsage(r);
    if (!r.ok) { status.className = "err"; status.textContent = limitMsg(r); return; }
    const s = { ideas: r.ideas, prompt: th.value.trim(), at: Date.now() };
    await setStore({ abIdeas: s }); showIdeas(s);
  });
  c.append(go, status); view.append(c, list);
  if (P.autoIdeas != null) { th.value = P.autoIdeas; P.autoIdeas = null; setTimeout(() => go.click(), 50); }
  const showIdeas = (s) => {
    list.innerHTML = ""; if (!s) return;
    list.append(el("div", "label", s.prompt ? "Ideas · " + s.prompt : "Your latest ideas"));
    s.ideas.forEach((x) => {
      const k = el("div", "card idea"); k.append(tagRow(x.type, x.stage), el("b", "", x.hook), el("p", "small", x.angle));
      if (x.needs) k.append(el("p", "muted", "You add: " + x.needs));
      k.append(btn("Write this →", "ab-btn ghost sm", () => genPost({ topic: `${x.hook}\n${x.angle}${x.needs ? "\nI'll fill in: " + x.needs : ""}`, type: PB.typeById(x.type) ? x.type : "auto", stage: PB.stageById(x.stage) ? x.stage : "auto" })));
      list.append(k);
    });
  };
  showIdeas(saved);
}

// trending
async function renderTrends() {
  const saved = await store("abTrends", null);
  const c = el("div", "card");
  c.append(el("p", "small", "We search this week's news in your field and read what's taking off on your LinkedIn feed, then turn each trend into a post idea. Each check uses 5 credits and results are kept for 6 hours."));
  const focus = el("input"); focus.type = "text"; focus.placeholder = "Optional focus, e.g. AI in hiring, pricing, new grads";
  const status = el("div", "");
  const go = btn(saved ? "↻ Check again" : "✦ What's trending now", "ab-btn", async () => {
    go.disabled = true; status.className = ""; status.innerHTML = "";
    const f = await toPage("readFeed");
    const feed = f && f.ok && Array.isArray(f.posts) ? f.posts : [];
    status.append(spinner(`Searching this week's news${feed.length ? ` and reading ${feed.length} posts from your feed` : ""}... about 30 to 60 seconds.`));
    const r = await bg({ type: "trends", feed, focus: focus.value.trim() });
    go.disabled = false; status.innerHTML = ""; syncUsage(r);
    if (!r.ok) { status.className = "err"; status.textContent = limitMsg(r); return; }
    await setStore({ abTrends: { trends: r.trends, feed: r.feed, web: r.web, feedCount: feed.length, at: r.at || Date.now() } });
    renderPostsTab();
  });
  c.append(focus, go, status); view.append(c);
  if (P.autoTrends != null) { focus.value = P.autoTrends; P.autoTrends = null; setTimeout(() => go.click(), 50); }
  if (!saved) { view.append(el("p", "muted", "Tip: open your LinkedIn feed in this tab first so we can read what's working there too.")); return; }
  const mins = Math.round((Date.now() - saved.at) / 60000);
  view.append(el("p", "muted", `Checked ${mins < 1 ? "just now" : mins < 60 ? mins + " min ago" : Math.round(mins / 60) + " h ago"}${saved.feedCount ? ` · read ${saved.feedCount} feed posts` : ""}${saved.web ? "" : " · from your feed only"}`));
  if (saved.trends.length) view.append(el("div", "label", "Trending this week"));
  saved.trends.forEach((x) => {
    const k = el("div", "card idea");
    const hd = el("div", "it"); hd.append(el("b", "", x.topic));
    if (x.source) { const a = el(x.url ? "a" : "span", "src", x.source); if (x.url) { a.href = x.url; a.target = "_blank"; a.rel = "noopener"; } hd.append(a); }
    k.append(hd); if (x.why_now) k.append(el("p", "muted", x.why_now));
    k.append(tagRow(x.type, x.stage), el("b", "", x.hook), el("p", "small", x.angle));
    k.append(btn("Write this →", "ab-btn ghost sm", () => genPost({ topic: `Trending: ${x.topic}${x.why_now ? " (" + x.why_now + ")" : ""}${x.source ? " Source: " + x.source : ""}\nHook idea: ${x.hook}\nAngle: ${x.angle}\nOnly use facts from this trend; don't invent new numbers.`, type: PB.typeById(x.type) ? x.type : "trending", stage: PB.stageById(x.stage) ? x.stage : "attract" })));
    view.append(k);
  });
  if (saved.feed && saved.feed.length) {
    view.append(el("div", "label", "Working on your feed"));
    saved.feed.forEach((f) => {
      const k = el("div", "card idea");
      const hd = el("div", "it"); hd.append(el("b", "", f.author)); if (f.engagement) hd.append(el("span", "src", f.engagement));
      k.append(hd, tagRow(f.type, ""), el("b", "", f.hook), el("p", "small", f.why));
      view.append(k);
    });
    view.append(el("p", "muted", "Want your version of one? Click ✦ Remix under that post on LinkedIn."));
  }
}

// remix (started from the Remix button under a LinkedIn post)
function renderRemix() {
  const x = P.remix;
  const c = el("div", "card soft");
  const hd = el("div", "it"); hd.append(el("b", "", x.author)); hd.append(el("span", "src", x.stats));
  c.append(el("div", "label", "Remixing this post"), hd, el("p", "small pre", x.text.split("\n").filter((l) => l.trim()).slice(1, 6).join("\n")));
  view.append(c);
  const k = el("div", "card");
  const ang = el("textarea"); ang.rows = 3; ang.placeholder = "Your angle (optional). e.g. The same idea, but about my clients and my own story.";
  k.append(el("div", "label", "Your angle"), ang, btn("✦ Remix it", "ab-btn", () => genPost({ topic: ang.value.trim(), type: "auto", stage: "auto", remix: x })),
    el("p", "muted", "It copies the structure and why it works, never the words. You get your own post."));
  view.append(k);
}
// The ✦ menu on LinkedIn asked for a tab.
function takeOpenTab(x) {
  if (!x || Date.now() - x.at > 30000 || !S.me) return;
  chrome.storage.local.remove("abOpenTab");
  if (!active() && x.tab !== "account") return;
  S.tab = x.tab; if (x.tab === "profile") S.pv = null; if (x.tab === "posts") P.sub = "write"; if (x.ask) S.focusMax = true;
  render();
  if (x.banner) setTimeout(() => { const bm = document.getElementById("banner-maker"); if (bm) bm.scrollIntoView({ block: "start" }); }, 500);
}
function takeRemix(x) {
  if (!x || Date.now() - x.at > 60000 || !S.me || !active()) return false;
  chrome.storage.local.remove("abRemix");
  P.remix = { author: x.author, text: x.text, stats: x.stats }; P.sub = "remix"; S.tab = "posts"; render();
  return true;
}

(async () => {
  const w = await chrome.windows.getCurrent();
  S.windowId = Number(new URLSearchParams(location.search).get("win")) || w.id; // ?win= is a test hook

  const settings = await store("settings", {});
  themePref = settings.theme || "system"; applyTheme();
  chrome.storage.onChanged.addListener((ch) => {
    // "Score my profile" was clicked on LinkedIn: jump to the Profile tab and run it.
    const run = ch.abRunAnalyze && ch.abRunAnalyze.newValue;
    if (run && Date.now() - run.at < 60000 && S.me && active()) {
      chrome.storage.local.remove("abRunAnalyze");
      S.tab = "profile"; render();
      setTimeout(() => runAnalyze(run), 400);
    }
  });
  chrome.storage.onChanged.addListener((ch) => { if (ch.abRemix && ch.abRemix.newValue) takeRemix(ch.abRemix.newValue); });
  chrome.storage.onChanged.addListener((ch) => { if (ch.abJobRun && ch.abJobRun.newValue) takeJobRun(ch.abJobRun.newValue); });
  chrome.storage.onChanged.addListener((ch) => { if (ch.abAlerts && (S.tab === "alerts" || (S.tab === "radar" && S.radarTab === "alerts")) && ch.abAlerts.newValue && !ch.abAlerts.newValue.seen) render(); });
  chrome.storage.onChanged.addListener((ch) => { if (ch.abOpenTab && ch.abOpenTab.newValue) takeOpenTab(ch.abOpenTab.newValue); });
  chrome.storage.onChanged.addListener((ch) => { if (ch.settings && ch.settings.newValue) { themePref = ch.settings.newValue.theme || "system"; applyTheme(); } });
  S.me = await store("me", null);
  render();
  await refreshMe();
  bg({ type: "plans" }).then((r) => { if (r.ok) S.plans = r; });
  if (S.me && needsSetup()) S.tab = "setup";
  render();
  refreshContext();
  toPage("hello");
  takeRemix(await store("abRemix", null));
  takeOpenTab(await store("abOpenTab", null));
  takeJobRun(await store("abJobRun", null));
  const pending = await store("abRunAnalyze", null);
  if (pending && Date.now() - pending.at < 60000 && S.me && active()) { chrome.storage.local.remove("abRunAnalyze"); S.tab = "profile"; render(); setTimeout(() => runAnalyze(pending), 400); }
  chrome.tabs.onActivated.addListener(({ windowId }) => { if (windowId !== S.windowId) return; S.draft = null; S.queue = null; S.owner = null; render(); refreshContext(); toPage("hello"); });
  chrome.tabs.onUpdated.addListener((id, info) => { if (id === S.activeTabId && info.status === "complete") refreshContext(); });
  window.addEventListener("focus", () => { if (!S.me) return; const before = active() + "|" + (acct() && acct().plan); refreshMe().then(() => { if (active() + "|" + (acct() && acct().plan) !== before) render(); else renderFoot(); }); });
})();
