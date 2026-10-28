// ReplyMaxxing: background worker.
// Talks to the ReplyMaxxing server (which holds the AI key, your plan and your playbook),
// opens the side panel, and keeps a small local history. Never touches LinkedIn directly.
importScripts("config.js");

const HISTORY_LIMIT = 200;
const cfg = () => self.AB_CONFIG;

async function apiBase() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return (settings.apiBase || cfg().API_BASE).replace(/\/$/, ""); // apiBase: test hook, not shown in the UI
}
async function getAuth() { const { auth = null } = await chrome.storage.local.get("auth"); return auth; }

// One place for every server call. Returns the JSON body plus ok:false with a friendly error on failure.
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    const a = await getAuth();
    if (!a || !a.token) return { ok: false, code: "auth", error: "Sign in to start drafting." };
    headers.authorization = "Bearer " + a.token;
  }
  let resp, data;
  try {
    resp = await fetch((await apiBase()) + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    data = await resp.json().catch(() => ({}));
  } catch {
    return { ok: false, code: "network", error: "Couldn't reach ReplyMaxxing. Check your internet and try again." };
  }
  if (resp.status === 401) {
    await chrome.storage.local.remove(["auth", "me"]);
    return { ok: false, code: "auth", error: "Your session ended. Sign in again." };
  }
  if (!resp.ok || data.ok === false) return { ok: false, status: resp.status, code: data.code || "error", error: data.error || "Error " + resp.status, ...data, ok: false };
  return { ok: true, ...data };
}

async function refreshMe() {
  const r = await api("/v1/me");
  if (r.ok && r.me) await chrome.storage.local.set({ me: r.me });
  return r;
}

async function draft(msg) {
  const r = await api("/v1/draft", { method: "POST", body: { mode: msg.mode, messages: msg.messages, threadKey: msg.threadKey || undefined, batch: !!msg.batch } });
  if (r.usage) {
    const { me } = await chrome.storage.local.get("me");
    if (me && me.account) { me.account.usage = r.usage; await chrome.storage.local.set({ me }); }
  }
  if (!r.ok && r.code === "no_plan") r.error = r.error || "Choose a plan to start drafting.";
  return r;
}

// Banner and photo for the profile score. URL null = none on the profile ("missing"); a failed fetch is left out (not scored).
async function fetchImage(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !/(^|\.)licdn\.com$/.test(u.hostname)) return null;
    const r = await fetch(u.href, { credentials: "omit" });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > 2e6) return null;
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { media_type: type, data: btoa(bin) };
  } catch { return null; }
}
async function loadImages(images) {
  if (!images || typeof images !== "object") return undefined;
  const out = {};
  for (const k of ["banner", "photo"]) {
    if (!(k in images)) continue;
    if (!images[k]) { out[k] = "missing"; continue; }
    const img = await fetchImage(images[k]);
    if (img) out[k] = img;
  }
  return out;
}

// Layout breakage reports: each event at most once per day per install, sent in small batches. No page content.
let tq = [], tTimer = null;
async function telemetry(event, lang) {
  const day = new Date().toISOString().slice(0, 10);
  const { abTel = {} } = await chrome.storage.local.get("abTel");
  const sent = abTel.day === day ? abTel.events || [] : [];
  if (sent.includes(event)) return { ok: true, skipped: true };
  await chrome.storage.local.set({ abTel: { day, events: sent.concat([event]) } });
  tq.push({ event, lang: lang || "", version: chrome.runtime.getManifest().version });
  clearTimeout(tTimer);
  tTimer = setTimeout(async () => { const events = tq.splice(0, 20); if (events.length) await api("/v1/telemetry", { method: "POST", body: { events } }).catch(() => {}); }, 4000);
  return { ok: true };
}

async function keepUsage(r) {
  if (!r || !r.usage) return;
  const { me } = await chrome.storage.local.get("me");
  if (me && me.account) { me.account.usage = r.usage; await chrome.storage.local.set({ me }); }
}

async function getSkip() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return (settings.skipList || "").split("\n").map((x) => x.trim().toLowerCase()).filter(Boolean);
}
async function lookup(key, name) {
  const { history = [] } = await chrome.storage.local.get("history");
  const prior = history.find((h) => h.key === key) || null;
  const n = (name || "").toLowerCase().trim();
  const onSkip = !!n && (await getSkip()).some((x) => n === x || n.startsWith(x + " ") || n.includes(x));
  return { ok: true, prior, onSkip };
}
async function record(entry) {
  const { history = [] } = await chrome.storage.local.get("history");
  const next = [{ ...entry, at: Date.now() }, ...history.filter((h) => h.key !== entry.key)].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ history: next });
  return { ok: true };
}

async function openTab(url) { await chrome.tabs.create({ url }); return { ok: true }; }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type === "ui" || msg.type === "act") return; // panel <-> page traffic, not for us
  if (msg.type === "openPanel") {
    // Must be called synchronously so Chrome keeps the click's user gesture.
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false }); return; }
    chrome.sidePanel.open({ tabId }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  (async () => {
    switch (msg.type) {
      case "draft": return draft(msg);
      case "lookup": return lookup(msg.key, msg.name);
      case "record": return record(msg.entry);
      case "skip": return { ok: true, list: await getSkip() };
      case "plans": return api("/v1/plans", { auth: false });
      case "me": return refreshMe();
      case "referral": return api("/v1/referral");
      case "getTraining": return api("/v1/training");
      case "voiceBuild": return api("/v1/voice/build", { method: "POST", body: { describe: msg.describe || "", picks: msg.picks || [], samples: msg.samples || "" } });
      case "voicePreview": { const r = await api("/v1/voice/preview", { method: "POST", body: {} }); if (r.ok) refreshMe(); return r; }
      case "saveTraining": { const r = await api("/v1/training", { method: "PUT", body: { items: msg.items } }); if (r.ok) { const me = await api("/v1/me"); if (me.ok && me.me) await chrome.storage.local.set({ me: me.me }); r.me = me.me; } return r; }
      case "claimReferral": { const r = await api("/v1/referral/claim", { method: "POST", body: { code: msg.code } }); return r; }
      case "authStart": return api("/v1/auth/start", { method: "POST", auth: false, body: { email: msg.email } });
      case "authVerify": {
        const r = await api("/v1/auth/verify", { method: "POST", auth: false, body: { email: msg.email, code: msg.code, acceptTerms: !!msg.acceptTerms, ref: msg.ref || undefined } });
        if (r.ok && r.token) await chrome.storage.local.set({ auth: { token: r.token, email: msg.email }, me: r.me });
        return r;
      }
      case "logout": { await api("/v1/auth/logout", { method: "POST" }); await chrome.storage.local.remove(["auth", "me"]); return { ok: true }; }
      case "saveProfile": { const r = await api("/v1/profile", { method: "PUT", body: { profile: msg.profile, about: msg.about } }); if (r.ok && r.me) await chrome.storage.local.set({ me: r.me }); return r; }
      case "buildPlaybook": return api("/v1/playbook", { method: "POST", body: { about: msg.about } });
      case "analyze": { const r = await api("/v1/analyze", { method: "POST", body: { text: msg.text, subject: msg.subject, name: msg.name, role: msg.role, goals: msg.goals, auto: msg.auto, images: await loadImages(msg.images) } }); if (r.usage) { const { me } = await chrome.storage.local.get("me"); if (me && me.account) { me.account.usage = r.usage; await chrome.storage.local.set({ me }); } } return r; }
      case "ask": { const r = await api("/v1/ask", { method: "POST", body: { messages: msg.messages, context: msg.context } }); await keepUsage(r); return r; }
      case "ideas": { const r = await api("/v1/ideas", { method: "POST", body: { prompt: msg.prompt } }); await keepUsage(r); return r; }
      case "trends": { const r = await api("/v1/trends", { method: "POST", body: { feed: msg.feed, focus: msg.focus } }); await keepUsage(r); return r; }
      case "banner": { const r = await api("/v1/banner", { method: "POST", body: { who: msg.who, serve: msg.serve, result: msg.result, link: msg.link, forOther: !!msg.forOther } }); await keepUsage(r); return r; }
      case "telemetry": return telemetry(msg.event, msg.lang);
      case "resumeParse": return api("/v1/resume/parse", { method: "POST", body: { file: msg.file } });
      case "resumeTailor": { const r = await api("/v1/resume/tailor", { method: "POST", body: { resume: msg.resume, job: msg.job, jobKey: msg.jobKey, notes: msg.notes || undefined } }); await keepUsage(r); return r; }
      case "resumeScore": { const r = await api("/v1/resume/score", { method: "POST", body: { resume: msg.resume, target: msg.target || undefined } }); await keepUsage(r); return r; }
      case "jobContacts": { const r = await api("/v1/jobs/contacts", { method: "POST", body: { job: msg.job, resume: msg.resume || undefined } }); await keepUsage(r); return r; }
      case "alertsNow": return runWebAlerts(true);
      case "feedAlerts": return mergeFeedAlerts(msg.posts || []);
      case "liOpen": morningCheck().catch(() => {}); return { ok: true };
      case "clearAlertBadge": chrome.action.setBadgeText({ text: "" }).catch(() => {}); return { ok: true };
      case "acceptTerms": { const r = await api("/v1/terms/accept", { method: "POST", body: { accept: true, version: msg.version } }); if (r.ok && r.me) await chrome.storage.local.set({ me: r.me }); return r; }
      case "savePlaybook": return api("/v1/playbook", { method: "PUT", body: { text: msg.text } });
      case "checkout": { const r = await api("/v1/checkout", { method: "POST", body: { plan: msg.plan } }); if (r.ok && r.me) await chrome.storage.local.set({ me: r.me }); if (r.ok && r.kickoffUrl) await openTab(r.kickoffUrl); else if (r.ok && r.url) await openTab(r.url); return r; }
      case "topup": { const r = await api("/v1/topup", { method: "POST", body: { kind: msg.kind } }); if (r.ok && r.url) await openTab(r.url); return r; }
      case "endTrial": { const r = await api("/v1/trial/end", { method: "POST" }); if (r.ok && r.me) await chrome.storage.local.set({ me: r.me }); return r; }
      case "portal": { const r = await api("/v1/portal", { method: "POST" }); if (r.ok && r.url) await openTab(r.url); return r; }
      case "openUrl": return openTab(msg.url);
      default: return { ok: false, error: "unknown message" };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

// Clicking the toolbar icon opens the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});


// ---------- invite codes from replymaxxing.com ----------
// The website (and only the website, see externally_connectable) hands over the friend's invite code it remembered,
// so the sign in screen can apply it without the person typing anything. Kept for 30 days.
const REF_SITES = /^https:\/\/(www\.)?replymaxxing\.com$/;
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!sender || !REF_SITES.test(sender.origin || "")) return;
  if (msg && msg.type === "ping") { sendResponse({ installed: true, version: chrome.runtime.getManifest().version }); return; }
  if (msg && msg.type === "ref") {
    const code = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!code) { sendResponse({ ok: false }); return; }
    chrome.storage.local.get("pendingRef").then((x) => {
      const cur = x.pendingRef;
      if (cur && cur.code === code) return sendResponse({ ok: true, code });
      chrome.storage.local.set({ pendingRef: { code, at: Date.now() } }).then(() => sendResponse({ ok: true, code }));
    });
    return true;
  }
});
// First install: open the welcome page. If they came from an invite link, the site passes the code straight in.
chrome.runtime.onInstalled.addListener((d) => {
  if (d && d.reason === "install") chrome.tabs.create({ url: "https://replymaxxing.com/?installed=1" }).catch(() => {});
});


// ---------- Morning hiring alerts (job seekers) ----------
// Max "wakes up" the first time you open LinkedIn each day (after 5am): he runs a web search for fresh hiring posts
// in your target role (paid plans, ALERTS_COST credits) and keeps the hiring posts he spotted on your feed.
// Nothing runs while LinkedIn is closed, and Max never browses LinkedIn on his own.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
async function alertsState() { const { abAlerts = null } = await chrome.storage.local.get("abAlerts"); return abAlerts && abAlerts.day === today() ? abAlerts : { day: today(), feed: [], web: [], follow: [], tip: "", webAt: 0, seen: false }; }
async function setBadge(st) {
  const n = (st.feed || []).length + (st.web || []).length;
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#6b50f5" });
    await chrome.action.setBadgeText({ text: !st.seen && n ? String(Math.min(n, 99)) : "" });
  } catch {}
}
const ALERT_ROLES = ["job_seeker", "founder", "consultant", "freelancer", "sales", "recruiter", "other"];
async function alertUser() {
  const { me = null, settings = {} } = await chrome.storage.local.get(["me", "settings"]);
  const p = (me && me.account && me.account.profile) || {};
  const seeker = p.role === "job_seeker";
  // Job seekers get the morning web search by default; everyone else turns it on in Alerts (it uses credits daily).
  const web = seeker ? settings.alertsWeb !== false : settings.alertsWeb === true;
  return { yes: ALERT_ROLES.includes(p.role) && settings.alertsOn !== false, seeker, web, free: !!(me && me.account && me.account.free), target: seeker ? p.targetRole : p.offer || p.titles };
}
async function notify(n) {
  try {
    if (!chrome.notifications || !n) return;
    const { seeker } = await alertUser();
    const title = seeker ? `Max found ${n} hiring ${n === 1 ? "post" : "posts"} for you` : `Max found ${n} ${n === 1 ? "opportunity" : "opportunities"} for you`;
    const message = seeker ? "Open ReplyMaxxing and go to Alerts to see who's hiring and what to do today." : "Open ReplyMaxxing and go to Radar, then Alerts, to see who's ready for a conversation today.";
    chrome.notifications.create("rmx-alerts", { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 0 });
  } catch {}
}
async function mergeFeedAlerts(posts) {
  const st = await alertsState();
  const have = new Set(st.feed.map((p) => p.snippet.slice(0, 80)));
  const add = posts.filter((p) => p && p.snippet && !have.has(p.snippet.slice(0, 80))).map((p) => ({ ...p, at: Date.now() }));
  if (!add.length) return { ok: true, added: 0 };
  st.feed = [...add, ...st.feed].slice(0, 20); st.seen = false;
  await chrome.storage.local.set({ abAlerts: st });
  await setBadge(st); notify(add.length);
  return { ok: true, added: add.length };
}
let webRunning = false;
async function runWebAlerts(manual) {
  if (webRunning) return { ok: false, error: "Max is already checking." };
  webRunning = true;
  try {
    const r = await api("/v1/alerts", { method: "POST", body: {} });
    await keepUsage(r);
    const st = await alertsState();
    if (r.ok) {
      st.web = (r.posts || []).map((p) => ({ ...p, at: Date.now() })); st.follow = r.follow || []; st.tip = r.tip || ""; st.webAt = Date.now(); st.seen = false;
      await chrome.storage.local.set({ abAlerts: st });
      await setBadge(st);
      if (!manual) notify(st.web.length);
    } else if (!manual) { st.webAt = Date.now(); st.webError = r.error || ""; await chrome.storage.local.set({ abAlerts: st }); }
    return r;
  } finally { webRunning = false; }
}
async function morningCheck() {
  const who = await alertUser();
  if (!who.yes || !who.web || who.free || !who.target) return;
  if (new Date().getHours() < 5) return;
  const st = await alertsState();
  if (st.webAt) return; // already ran today
  await runWebAlerts(false);
}
try {
  chrome.notifications && chrome.notifications.onClicked.addListener(async (id) => {
    if (id !== "rmx-alerts") return;
    await chrome.storage.local.set({ abOpenTab: { tab: "alerts", at: Date.now() } });
    try { const w = await chrome.windows.getLastFocused(); await chrome.sidePanel.open({ windowId: w.id }); } catch {}
    chrome.notifications.clear(id);
  });
} catch {}
