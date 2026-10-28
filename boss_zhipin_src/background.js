// BossMaxxing: Background Service Worker (专为 Boss直聘 定制)
importScripts("config.js");

const HISTORY_LIMIT = 200;
const cfg = () => self.AB_CONFIG;

async function apiBase() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return (settings.apiBase || cfg().API_BASE).replace(/\/$/, "");
}
async function getAuth() {
  const { auth = null } = await chrome.storage.local.get("auth");
  return auth;
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    const a = await getAuth();
    if (!a || !a.token) return { ok: false, code: "auth", error: "请先登录（默认体验验证码：123456）" };
    headers.authorization = "Bearer " + a.token;
  }
  let resp, data;
  try {
    resp = await fetch((await apiBase()) + path, {
      method,
      headers,
      body: body ? JSON.stringify({ ...body, platform: "boss" }) : undefined,
    });
    data = await resp.json().catch(() => ({}));
  } catch {
    return {
      ok: false,
      code: "network",
      error: "无法连接到 BossMaxxing 服务端，请确认本地 Worker (http://127.0.0.1:8787) 已启动。",
    };
  }
  if (resp.status === 401) {
    await chrome.storage.local.remove(["auth", "me"]);
    return { ok: false, code: "auth", error: "登录已过期，请重新登录。" };
  }
  if (!resp.ok || data.ok === false) {
    return { ok: false, status: resp.status, code: data.code || "error", error: data.error || "请求异常 " + resp.status, ...data };
  }
  return { ok: true, ...data };
}

async function refreshMe() {
  const r = await api("/v1/me");
  if (r.ok && r.me) await chrome.storage.local.set({ me: r.me });
  return r;
}

async function keepUsage(r) {
  if (!r || !r.usage) return;
  const { me } = await chrome.storage.local.get("me");
  if (me && me.account) {
    me.account.usage = r.usage;
    await chrome.storage.local.set({ me });
  }
}

async function record(entry) {
  const { bossHistory = [] } = await chrome.storage.local.get("bossHistory");
  const next = [{ ...entry, at: Date.now() }, ...bossHistory.filter((h) => h.key !== entry.key)].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ bossHistory: next });
  return { ok: true, list: next };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type === "ui" || msg.type === "act") return;
  if (msg.type === "openPanel") {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }
    chrome.sidePanel.open({ tabId }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }

  (async () => {
    switch (msg.type) {
      case "authStart":
        return api("/v1/auth/start", { method: "POST", auth: false, body: { email: msg.email } });
      case "authVerify": {
        const r = await api("/v1/auth/verify", {
          method: "POST",
          auth: false,
          body: { email: msg.email, code: msg.code, acceptTerms: true },
        });
        if (r.ok && r.token) await chrome.storage.local.set({ auth: { token: r.token, email: msg.email }, me: r.me });
        return r;
      }
      case "logout": {
        await api("/v1/auth/logout", { method: "POST" });
        await chrome.storage.local.remove(["auth", "me"]);
        return { ok: true };
      }
      case "me":
        return refreshMe();
      case "saveProfile": {
        const r = await api("/v1/profile", { method: "PUT", body: { profile: { ...msg.profile, platform: "boss" }, about: msg.about } });
        if (r.ok && r.me) await chrome.storage.local.set({ me: r.me });
        return r;
      }
      case "draft": {
        const r = await api("/v1/draft", {
          method: "POST",
          body: { mode: msg.mode, messages: msg.messages, platform: "boss" },
        });
        await keepUsage(r);
        return r;
      }
      case "ask": {
        const r = await api("/v1/ask", {
          method: "POST",
          body: { messages: msg.messages, context: msg.context, platform: "boss" },
        });
        await keepUsage(r);
        return r;
      }
      case "resumeTailor": {
        const r = await api("/v1/resume/tailor", {
          method: "POST",
          body: { resume: msg.resume, job: msg.job, jobKey: msg.jobKey, notes: msg.notes, platform: "boss" },
        });
        await keepUsage(r);
        return r;
      }
      case "resumeScore": {
        const r = await api("/v1/resume/score", {
          method: "POST",
          body: { resume: msg.resume, target: msg.target, platform: "boss" },
        });
        await keepUsage(r);
        return r;
      }
      case "getTraining":
        return api("/v1/training");
      case "saveTraining":
        return api("/v1/training", { method: "PUT", body: { items: msg.items } });
      case "record":
        return record(msg.entry);
      default:
        return { ok: false, error: "未知请求类型" };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
