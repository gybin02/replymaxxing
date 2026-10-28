// ReplyMaxxing (Max): runs on linkedin.com.
// Safe mode: it only reads the page you are on, only when you click. It never sends for you; the only click it makes is opening a chat you picked in the side panel.
// It adds an Ask Max button on profiles (opener, profile score and more), Suggest reply and Suggest comment, and can type a draft into a box you opened.
// Everything else (drafts, Coach, Radar, Autopilot, account) lives in Chrome's side panel.
(() => {
  if (window.__abCopilot) return;
  window.__abCopilot = true;

  const EDITOR_SEL = '.msg-form__contenteditable[contenteditable="true"]';
  const THREAD_CONTAINERS = ".msg-overlay-conversation-bubble, .msg-convo-wrapper, .scaffold-layout__detail, .msg-thread";
  const MESSAGE_ITEM_SEL = ".msg-s-event-listitem, .msg-s-message-list__event";
  const COMMENT_SEL = [
    '[contenteditable="true"][aria-label*="comment" i]',
    '[contenteditable="true"][aria-label*="reply" i]',
    '.comments-comment-box [contenteditable="true"]',
    '.comments-comment-texteditor [contenteditable="true"]',
    '[class*="comments-comment-box"] [contenteditable="true"]',
    '[class*="reply-box"] [contenteditable="true"]',
    '[contenteditable="true"][aria-placeholder*="reply" i]',
    '[contenteditable="true"][data-placeholder*="reply" i]',
  ].join(", ");
  const POST_SEL = '[role="listitem"], .feed-shared-update-v2, [data-urn*="activity"], [data-id*="activity"], article';
  const LIST_ITEM_SEL = ".msg-conversation-listitem, .msg-conversation-card";
  const LIST_NAME_SEL = ".msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names";
  const GRAD = "linear-gradient(135deg,#4078f6 0%,#6b50f5 55%,#a24bf0 100%)"; // Max's gradient, same as the website
  const FONT = '"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

  // ---------- small helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const textOf = (el) => (el ? (el.innerText || "").replace(/​/g, "").trim() : "");
  const isProfile = () => /^\/in\/[^/]+\/?$/.test(location.pathname);
  const cleanName = (s) => (s || "").replace(/^\(\d+\)\s*/, "").replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const nameKey = (n) => (n || "").toLowerCase().replace(/\s+/g, " ").trim();
  // LinkedIn's newer profile layout shows the name as an h2 (older one used h1). Find the person's name heading.
  function nameHeading(root) {
    const main = root || document.querySelector("main");
    if (!main) return null;
    const want = cleanName(document.title).toLowerCase();
    const hs = [...main.querySelectorAll("h1, h2")];
    return hs.find((h) => h.tagName === "H1") || (want && hs.find((h) => (h.innerText || "").trim().toLowerCase() === want)) || hs.find((h) => want && (h.innerText || "").toLowerCase().includes(want.split(" ")[0])) || null;
  }
  const profileKey = () => {
    const m = location.pathname.match(/^\/in\/([^/]+)/);
    return m ? "in/" + decodeURIComponent(m[1]).toLowerCase() : location.pathname;
  };
  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: "Extension was updated. Refresh this page." });
        else resolve(res || { ok: false, error: "No response" });
      });
    } catch {
      resolve({ ok: false, error: "Extension was updated. Refresh this page." });
    }
  });
  async function getStore(k, dflt) { try { const d = await chrome.storage.local.get(k); return d[k] ?? dflt; } catch { return dflt; } }
  async function setStore(obj) { try { await chrome.storage.local.set(obj); } catch {} }

  // ---------- talking to the side panel ----------
  // The panel renders whatever this frame tells it. We keep the last view so a freshly opened panel can catch up.
  let lastView = null;
  function emit(view) {
    lastView = view;
    try { chrome.runtime.sendMessage({ type: "ui", view }).catch(() => {}); } catch {}
  }
  // Ask Chrome to open the panel. Must run inside the click so Chrome sees a user gesture.
  function openPanel() {
    try {
      chrome.runtime.sendMessage({ type: "openPanel" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) toast("Click the ReplyMaxxing icon in your toolbar to see your draft.");
      });
    } catch {}
  }

  // LinkedIn renders chat pop-ups inside a shadow root (#interop-outlet), so we search there too.
  let shadowRoots = [], lastScan = 0;
  function roots() {
    const now = Date.now();
    if (now - lastScan > 2000) {
      lastScan = now;
      shadowRoots = [];
      const io = document.getElementById("interop-outlet");
      if (io && io.shadowRoot) shadowRoots.push(io.shadowRoot);
      if (document.body) for (const el of document.body.children) {
        if (el.shadowRoot && el.id !== "ab-copilot-root" && !shadowRoots.includes(el.shadowRoot)) shadowRoots.push(el.shadowRoot);
      }
    }
    return [document, ...shadowRoots];
  }
  const queryAll = (sel) => roots().flatMap((r) => [...r.querySelectorAll(sel)]);
  const eventTarget = (e) => (e.composedPath ? e.composedPath()[0] : e.target);

  // Track which message box you last clicked into.
  let lastEditor = null;
  document.addEventListener("focusin", (e) => {
    const t = eventTarget(e);
    const ed = t && t.closest && t.closest(EDITOR_SEL);
    if (ed) lastEditor = ed;
  }, true);
  const editors = () => queryAll(EDITOR_SEL).filter(visible);
  const activeEditor = () => {
    if (lastEditor && visible(lastEditor)) return lastEditor;
    const eds = editors();
    return eds[eds.length - 1] || null;
  };
  const commentEditors = () => queryAll(COMMENT_SEL).filter((e) => visible(e) && !e.matches(EDITOR_SEL) && !e.closest(".msg-form"));
  const threadOf = (ed) => (ed && ed.closest(THREAD_CONTAINERS)) || document.querySelector("main") || document.body;

  // ---------- reading LinkedIn (only what's already on screen) ----------
  // LinkedIn's newer layout scrolls inside <main>, not the window, and loads sections as they come into view.
  function scrollerEl() {
    const m = document.querySelector("main");
    if (m) { const oy = getComputedStyle(m).overflowY; if (/(auto|scroll)/.test(oy) && m.scrollHeight > m.clientHeight + 50) return m; }
    return document.scrollingElement || document.documentElement;
  }
  const sectionHeads = () => [...(document.querySelector("main") || document).querySelectorAll("h2, h3")].map((h) => (h.innerText || "").trim().toLowerCase());
  async function readProfile() {
    const sc = scrollerEl();
    const start = sc.scrollTop;
    for (let i = 0; i < 8; i++) {
      sc.scrollTop = Math.min(sc.scrollTop + sc.clientHeight * 0.9, sc.scrollHeight);
      await sleep(350);
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5) break;
    }
    for (let t = 0; t < 10 && !sectionHeads().some((h) => /^experience$/.test(h)); t++) await sleep(300);
    await sleep(300);
    sc.scrollTop = start;
    const main = document.querySelector("main") || document.body;
    let text = main.innerText || "";
    const stops = ["More profiles for you", "People you may know", "Explore Premium profiles", "People also viewed", "You might like", "Pages for you"];
    let cut = text.length;
    for (const m of stops) { const i = text.indexOf(m); if (i > 200 && i < cut) cut = i; }
    text = text.slice(0, cut).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
    const h1 = nameHeading(main);
    return { name: (h1 && h1.innerText.trim()) || cleanName(document.title), url: location.origin + location.pathname, text, images: profileImages() };
  }
  // Banner and photo of the profile owner (null = none on the profile). Picks a mid size from srcset.
  function pickSrc(img, want) {
    const c = (img.srcset || "").split(",").map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).map(([u, w]) => [u, parseInt(w) || 0]).sort((x, y) => x[1] - y[1]);
    const ok = c.filter((x) => x[1] >= want);
    return (ok[0] || c[c.length - 1] || [img.currentSrc || img.src])[0];
  }
  function profileImages() {
    const main = document.querySelector("main") || document.body;
    const imgs = [...main.querySelectorAll("img")].slice(0, 30);
    const src = (i) => i.currentSrc || i.src || "";
    const isCdn = (i) => /licdn\.com/.test(src(i)) && !/static\.licdn\.com/.test(src(i));
    const banner = imgs.find((i) => isCdn(i) && (/^cover photo$/i.test(i.alt || "") || /displaybackgroundimage/.test(src(i))));
    const photo = imgs.find((i) => isCdn(i) && i.getBoundingClientRect().width >= 80 && (/profile-displayphoto/.test(src(i)) || (i.closest('[aria-label="Profile photo"]') && !/ghost/i.test(src(i)))));
    return { banner: banner ? pickSrc(banner, 1400) : null, photo: photo ? pickSrc(photo, 400) : null };
  }

  // The open chat's name. LinkedIn changes its header markup often, so try several spots, then the selected inbox row.
  const THREAD_TITLE_SEL = ".msg-overlay-bubble-header__title, .msg-entity-lockup__entity-title, .msg-thread__link-to-profile, .msg-title-bar [class*=\"title\"], [class*=\"entity-title\"], [class*=\"thread__title\"]";
  function activeListName() {
    const it = queryAll(LIST_ITEM_SEL).find((x) => x.matches('[class*="--active"], [class*="active"], [aria-current="true"], [aria-selected="true"]') || x.querySelector('[class*="--active"], [aria-current="true"], [aria-selected="true"]'));
    const n = it && it.querySelector(LIST_NAME_SEL);
    return n ? n.innerText.split("\n")[0].trim() : "";
  }
  function readThread(ed) {
    const c = threadOf(ed);
    const list = c.querySelector(".msg-s-message-list-content, .msg-s-message-list") || c;
    let name = "";
    const titleEl = c.querySelector(THREAD_TITLE_SEL) || c.querySelector('header a[href*="/in/"], [class*="header"] a[href*="/in/"]') || c.querySelector("h2, h3");
    if (titleEl) name = textOf(titleEl).split("\n")[0].trim();
    if (!name && /\/messaging\//.test(location.pathname)) name = activeListName();
    const text = (list.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(-10000);
    return { name, text };
  }

  // A reply box under someone's comment (not the post's own comment box).
  const COMMENT_ITEM_SEL = '[class*="comments-comment-entity"], [class*="comments-comment-item"], [data-id*="comment"], [data-urn*="comment"]';
  const commentOf = (ed) => { const c = ed.closest(COMMENT_ITEM_SEL); return c && c !== ed ? c : null; };
  function outerPost(ed) {
    let post = ed.closest(POST_SEL);
    for (let k = 0; k < 6 && post && post.parentElement && post.parentElement.closest(POST_SEL); k++) post = post.parentElement.closest(POST_SEL);
    return post;
  }
  function readPost(ed) {
    const cm = commentOf(ed);
    const post = (cm ? outerPost(ed) : ed.closest(POST_SEL)) || ed.parentElement.closest("section, div") || document.body;
    let text = (post.innerText || "").replace(/\n{3,}/g, "\n\n");
    const stops = ["Most relevant", "Most recent", "Add a comment"];
    let cut = text.length;
    for (const m of stops) { const i = text.indexOf(m); if (i > 80 && i < cut) cut = i; }
    const postText = text.slice(0, cut).trim().slice(0, 6000);
    const truncated = /(…|\.\.\.)\s*(see )?more\s*$/im.test(postText);
    const name = postText.split("\n").map((l) => l.trim())
      .find((l) => l && !/^(feed post|promoted|suggested|follow|•|\d+(st|nd|rd|th))$/i.test(l) && l.length < 60) || "this post";
    let replyTo = "";
    if (cm) {
      const box = ed.closest('[class*="comments-comment-box"], form') || ed;
      replyTo = (cm.innerText || "").replace((box.innerText || "").trim(), "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
    } else if (/reply/i.test(ed.getAttribute("aria-label") || "")) {
      let n = ed.parentElement;
      for (let k = 0; k < 12 && n && n !== post; k++, n = n.parentElement) {
        const t = (n.innerText || "").trim();
        if (t.length > 60) { replyTo = t.slice(0, 1500); break; }
      }
    }
    return { name, text: postText, replyTo, truncated };
  }

  function findMessageButton() {
    const main = document.querySelector("main");
    if (!main) return null;
    // Only the profile's own top card counts: the section that holds the person's name (the page's h1).
    // Message buttons elsewhere (People also viewed, suggestions, ads) belong to other people.
    const h1 = nameHeading(main);
    if (!h1) return null;
    let card = h1.closest("section") || h1.parentElement;
    for (let k = 0; k < 8 && card && card !== main; k++) {
      if (card.querySelector('button, a[href*="/messaging/"]') && card.getBoundingClientRect().height > 120) break;
      card = card.parentElement;
    }
    if (!card || card === main) card = h1.closest("section");
    if (!card) return null;
    const cands = [...card.querySelectorAll("button, a")].filter((b) => {
      if (b.dataset.abCopilot) return false;
      const label = (b.getAttribute("aria-label") || "").trim();
      const t = (b.innerText || "").trim();
      return (/^Message\b/i.test(label) || t === "Message") && !b.closest('[role="menu"], [role="dialog"], aside');
    }).filter(visible);
    return cands[0] || null;
  }


  // ---------- placing text into a box you opened ----------
  const selFor = (ed) => { const r = ed.getRootNode(); return (r && r.getSelection && r !== document) ? r.getSelection() : window.getSelection(); };
  function setBoxText(ed, text) {
    ed.focus();
    const sel = selFor(ed);
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand("insertText", false, text);
    if (!ok || !textOf(ed).includes(text.slice(0, 10))) {
      ed.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = text;
      ed.appendChild(p);
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }
  const canWrite = (ed) => {
    const t = textOf(ed);
    return !t || (ctx && ctx.lastPlaced && t === ctx.lastPlaced.trim());
  };

  let queue = null; // { ed, lines, i, timer, hadText }
  function stopQueue(msg) {
    if (queue && queue.timer) clearInterval(queue.timer);
    queue = null;
    emitQueue(msg || "", false);
  }
  function emitQueue(msg, live) { emit({ kind: "queue", msg, live: !!live, canStop: !!queue, sid: ctx && ctx.sid }); }
  function startQueue(ed, lines) {
    if (queue && queue.timer) clearInterval(queue.timer);
    queue = { ed, lines, i: 0, timer: null, hadText: false };
    placeNext();
    queue.timer = setInterval(() => {
      if (!queue) return;
      if (!queue.ed.isConnected) return stopQueue("Message box closed. Reopen it and click Put in box for the rest.");
      const t = textOf(queue.ed);
      if (t) { queue.hadText = true; return; }
      if (queue.hadText) {
        queue.hadText = false;
        queue.i += 1;
        if (queue.i >= queue.lines.length) { stopQueue("All lines sent. Nice."); return emit({ kind: "sent", sid: ctx && ctx.sid, name: ctx && ctx.name }); }
        setTimeout(placeNext, 700);
      }
    }, 400);
  }
  function placeNext() {
    if (!queue) return;
    setBoxText(queue.ed, queue.lines[queue.i]);
    if (ctx) ctx.lastPlaced = queue.lines[queue.i];
    queue.hadText = true;
    const n = queue.lines.length, i = queue.i;
    let msg;
    if (n === 1) msg = "It's in the box. Review it and hit Send.";
    else if (i < n - 1) msg = `Line ${i + 1} of ${n} is in the box. Hit Send and line ${i + 2} drops in.`;
    else msg = `Last line (${n} of ${n}) is in the box. Hit Send.`;
    emitQueue(msg, true);
  }

  // Finds the box for the current draft. Safe mode: we never click Message for you.
  function findTargetBox(c) {
    if (c.mode === "reply") {
      const ed = c.editor && c.editor.isConnected ? c.editor : activeEditor();
      if (!ed) return { error: "Open the conversation's message box first." };
      return { ed, hasHistory: true };
    }
    if (c.mode === "comment") {
      const ed = c.editor && c.editor.isConnected ? c.editor : null;
      if (!ed) return { error: "The comment box closed. Click Comment on the post, then Suggest comment again." };
      return { ed, hasHistory: false };
    }
    // Opener: use a chat box that's already open and empty for this person, if any.
    const first = (c.name || "").split(" ")[0].toLowerCase();
    const ed = editors().find((e) => !textOf(e) && (!first || (threadOf(e).innerText || "").toLowerCase().includes(first)));
    if (!ed) return { waitForBox: true };
    return { ed, hasHistory: !!threadOf(ed).querySelector(MESSAGE_ITEM_SEL) };
  }

  // ---------- drafting ----------
  const scrub = (s) => s.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ");
  function parse(raw, mode) {
    const header = mode === "reply" ? "REPLY" : mode === "comment" ? "COMMENT" : "OPENER";
    const text = raw.replace(/\r/g, "");
    const re = new RegExp("^\\s*[#*]*\\s*" + header + "\\s*[*:]*\\s*$", "im");
    const parts = text.split(re);
    let notes = parts.length >= 2 ? parts[0] : "";
    const body = parts.length >= 2 ? parts.slice(1).join("\n") : text;
    notes = notes.replace(/^\s*[#*]*\s*(RESEARCH|NOTE|ANGLE)\s*[*:]*\s*$/gim, "").replace(/\*\*/g, "").trim();
    const lines = body.split("\n")
      .map((l) => l.replace(/^\s*(?:[-*>]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim())
      .filter((l) => l && !/^line \d/i.test(l))
      .map(scrub);
    const field = (k) => { const m = notes.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.+)$", "im")); return m ? m[1].trim() : ""; };
    const coach = mode === "reply" ? { stage: field("STAGE"), where: field("WHERE"), next: field("NEXT") } : null;
    const needsYou = /NEEDS (BRIAN|YOU|THE USER)/i.test(notes);
    return { notes, lines, needsYou, coach };
  }

  let ctx = null; // { mode, name, key, url, messages, editor, auto, sid, batch, nudge, threadKey }
  const modeLabel = (m) => (m === "reply" ? "Max's read on this chat" : m === "comment" ? "Comment draft" : "Opener draft");
  const threadKeyFor = (name) => "thread:" + (/\/messaging\/thread\/([^/]+)/.exec(location.pathname) || [])[1] + ":" + nameKey(name);

  async function startDraft(mode, opts = {}) {
    if (queue && queue.timer) clearInterval(queue.timer);
    queue = null;
    confirmedHistory = false; confirmedReplace = false;
    const sid = String(Date.now());
    if (mode === "opener") {
      const name = cleanName(document.title) || "this person";
      ctx = { mode, name, key: profileKey(), url: location.href, messages: [], editor: null, sid };
    } else if (mode === "comment") {
      const ed = opts.editor;
      if (!ed || !ed.isConnected) return;
      const { name, text } = readPost(ed);
      ctx = { mode, name, key: "post:" + text.slice(0, 80).toLowerCase(), url: location.href, messages: [], editor: ed, auto: true, sid };
    } else {
      const ed = opts.editor && opts.editor.isConnected ? opts.editor : activeEditor();
      if (!ed) { emit({ kind: "error", msg: "Open a conversation first, then click ✦ Suggest reply in its message box." }); return; }
      const { name } = readThread(ed);
      const nm = name || "this conversation";
      ctx = { mode, name: nm, key: "thread:" + nameKey(nm), threadKey: threadKeyFor(nm), url: location.href, messages: [], editor: ed, auto: !!opts.editor, sid, batch: !!opts.batch, nudge: opts.nudge || null };
    }
    emit({ kind: "open", name: ctx.name, mode: ctx.mode, label: modeLabel(ctx.mode), sid, batch: !!ctx.batch });
    const info = await send({ type: "lookup", key: ctx.key, name: ctx.name });
    const warnings = [];
    if (info && info.onSkip) warnings.push(`${ctx.name} is on your skip list.`);
    if (info && info.prior && mode === "opener") {
      warnings.push(`You drafted an opener for them on ${new Date(info.prior.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`);
    }
    if (warnings.length && !opts.force) { ctx.pendingOpts = opts; return emit({ kind: "warn", list: warnings, sid }); }
    await generate();
  }

  async function generate(tweak) {
    if (!ctx) return;
    const sid = ctx.sid;
    emit({ kind: "loading", msg: tweak ? "Rewriting..." : ctx.mode === "opener" ? "Reading their profile..." : ctx.mode === "comment" ? "Reading the post..." : "Reading the conversation and figuring out your next move...", sid });
    if (!tweak) {
      let content;
      if (ctx.mode === "opener") {
        const p = await readProfile();
        if (!ctx || ctx.sid !== sid) return;
        if (p.text.length < 200) return emit({ kind: "error", msg: "Couldn't read enough of this profile yet. Scroll down once so their About and posts load, then try again.", retry: true, sid });
        ctx.name = p.name || ctx.name;
        content = `draft opener\n\nProfile URL: ${p.url}\n\n--- PROFILE TEXT ---\n${p.text}`;
      } else if (ctx.mode === "comment") {
        const p = readPost(ctx.editor);
        if (p.text.length < 40) return emit({ kind: "error", msg: "Couldn't read this post. Scroll so the whole post is on screen and try again.", retry: true, sid });
        content = `draft comment\n\nPost by: ${p.name}\n\n--- POST ---\n${p.text}` + (p.replyTo ? `\n\n--- REPLYING TO THIS COMMENT ---\n${p.replyTo}` : "");
        if (p.truncated) ctx.tip = "Tip: click \"more\" on the post first so Max reads all of it.";
      } else {
        const t = readThread(ctx.editor && ctx.editor.isConnected ? ctx.editor : activeEditor());
        if (t.text.length < 20) return emit({ kind: "error", msg: "Couldn't read this conversation. Scroll up so the messages load, then try again.", retry: true, sid });
        content = `draft reply\n\nConversation with: ${ctx.name}\n\n--- THREAD (oldest to newest) ---\n${t.text}`;
        if (ctx.nudge) content += `\n\n--- NOTE ---\nThey haven't replied in ${ctx.nudge.days || "a few"} days. Write a short, light, no-pressure nudge that adds something useful or asks one easy question. Never guilt them.`;
      }
      ctx.messages = [{ role: "user", content }];
      emit({ kind: "loading", msg: "Writing...", sid });
    } else {
      ctx.messages.push({ role: "user", content: `Revise it: ${tweak}\nKeep the same output format and all the rules.` });
    }
    const res = await send({ type: "draft", mode: ctx.mode, messages: ctx.messages, threadKey: ctx.threadKey, batch: !!ctx.batch });
    if (!ctx || ctx.sid !== sid) return;
    if (!res.ok) {
      if (tweak) ctx.messages.pop();
      return emit({ kind: "error", msg: res.error || "Something went wrong.", code: res.code, topup: res.topup, upgradeTo: res.upgradeTo, trialEndsNow: !!res.trialEndsNow, retry: !res.code || res.code === "ai" || res.code === "rate", sid });
    }
    ctx.messages.push({ role: "assistant", content: res.text });
    const parsed = parse(res.text, ctx.mode);
    if (ctx.mode === "comment" && parsed.lines.length > 1) parsed.lines = [parsed.lines.join(" ")];
    emit({ kind: "result", parsed, mode: ctx.mode, name: ctx.name, auto: !!ctx.auto, tip: ctx.tip || "", sid, usage: res.usage || null });
    if (ctx.auto && parsed.lines.length) autoPlace(parsed.lines);
    saveSession(parsed);
    if (ctx.mode === "reply" && parsed.coach && parsed.coach.stage) {
      savePipe(ctx.name, {
        stage: normStage(parsed.coach.stage), next: parsed.coach.next || "", where: parsed.coach.where || "",
        ...(/\/messaging\/thread\/[^/]+/.test(location.pathname) && !/\/new\/?$/.test(location.pathname) ? { url: location.origin + location.pathname } : {}),
      });
    }
    send({ type: "record", entry: { key: ctx.key, name: ctx.name, url: ctx.url, mode: ctx.mode, lines: parsed.lines } });
  }

  function autoPlace(lines) {
    const ed = ctx && ctx.editor;
    if (!ed || !ed.isConnected) return emitQueue("The box closed. Reopen it and click Put in box.");
    if (!canWrite(ed)) return emitQueue("You already typed in that box, so I left it alone. Click Replace in box to swap it in.");
    place(ed, lines);
  }
  function place(ed, lines) {
    if (ctx.mode === "comment") {
      if (queue && queue.timer) clearInterval(queue.timer);
      queue = null;
      setBoxText(ed, lines.join(" "));
      ctx.lastPlaced = lines.join(" ");
      return emitQueue("It's in the comment box. Edit it if you want, then click Comment to post.", true);
    }
    startQueue(ed, lines);
  }

  let confirmedHistory = false, confirmedReplace = false;
  async function placeInBox(lines) {
    if (!ctx) return;
    const target = findTargetBox(ctx);
    if (target.waitForBox) {
      await setStore({ abPending: { lines, name: ctx.name, at: Date.now() } });
      savePipe(ctx.name, { stage: "Opener", next: "Wait for their reply, then hit Suggest reply", profileUrl: ctx.url });
      return emitQueue("Now click Message on their profile. The draft drops into the box when it opens.", true);
    }
    if (target.error) return emitQueue(target.error);
    if (ctx.mode === "opener" && target.hasHistory && !confirmedHistory) {
      confirmedHistory = true;
      return emitQueue("Heads up: you already have a conversation with them. Click again to place it anyway.");
    }
    if (!canWrite(target.ed) && !confirmedReplace) {
      confirmedReplace = true;
      return emitQueue("That box already has your own text. Click again to replace it.");
    }
    ctx.editor = target.ed;
    place(target.ed, lines);
    if (ctx.mode === "opener") savePipe(ctx.name, { stage: "Opener", next: "Wait for their reply, then hit Suggest reply", profileUrl: ctx.url });
  }

  // ---------- small in-page layer: floating Suggest buttons and a toast ----------
  const host = document.createElement("div");
  host.id = "ab-copilot-root";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { all: initial; }
    .anchors { position: fixed; inset: 0; pointer-events: none; z-index: 2147482998; }
    .sug { position: fixed; pointer-events: auto; display: inline-flex; align-items: center; gap: 5px; border: none; border-radius: 999px;
      padding: 5px 11px; font: 600 12px/1.2 ${FONT}; cursor: pointer; background: ${GRAD}; color: #fff;
      box-shadow: 0 2px 8px rgba(107,80,245,.25); white-space: nowrap; }
    .sug:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .sug.busy { opacity: .75; cursor: progress; }
    .toast { position: fixed; right: 16px; bottom: 16px; max-width: 320px; background: #0d0e12; color: #fff; border-radius: 12px;
      padding: 10px 14px; font: 500 13px/1.4 ${FONT}; box-shadow: 0 12px 30px rgba(0,0,0,.25); z-index: 2147483000; pointer-events: auto; }
    .toast::before { content: "✦ "; color: #a99cf5; }
    .hidden { display: none; }
    .fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; width: 46px; height: 46px; border-radius: 50%; border: 0; cursor: pointer;
      background: ${GRAD}; color: #fff; font: 600 19px/1 ${FONT}; box-shadow: 0 6px 18px rgba(78,80,245,.45); display: grid; place-items: center; transition: transform .15s; }
    .fab { background: #0d0c14 !important; display: grid; place-items: center; overflow: hidden; padding: 0 !important; width: 52px !important; height: 52px !important; border-radius: 16px !important; box-shadow: 0 8px 24px -6px rgba(91,80,255,.6), 0 0 0 1px rgba(255,255,255,.08) !important; }
    .fab img { width: 46px; height: 46px; pointer-events: none; }
    .fab:hover { transform: translateY(-1px); }
    .menu { position: fixed; right: 18px; bottom: 74px; z-index: 2147483000; min-width: 210px; background: #fff; border: 1px solid #e6e8f2; border-radius: 14px;
      box-shadow: 0 18px 40px -12px rgba(13,14,18,.28); padding: 6px; display: flex; flex-direction: column; font: 500 13.5px/1.3 ${FONT}; color: #0d0e12; }
    .menu button { all: unset; cursor: pointer; padding: 9px 11px; border-radius: 9px; display: flex; gap: 9px; align-items: center; }
    .menu button:hover { background: #f3f1ff; color: #4e3cd8; }
    .pmenu { right: auto; bottom: auto; min-width: 240px; padding: 6px; }
    .pmenu button { align-items: flex-start; padding: 9px 10px; }
    .pmenu .mi { width: 22px; height: 22px; border-radius: 7px; background: #f3f1ff; color: #6b50f5; display: grid; place-items: center; font-size: 13px; flex: none; }
    .pmenu .mt { display: flex; flex-direction: column; gap: 1px; }
    .pmenu .mt b { font-weight: 600; font-size: 14px; color: #14161f; }
    .pmenu .mt span { font-size: 12px; color: #6b7080; }
    .menu .sep { height: 1px; background: #eef0f6; margin: 4px 6px; }
    .menu small { color: #6b7080; font-size: 11px; padding: 4px 11px 2px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
    .hidden { display: none !important; }
  </style><div class="anchors"></div><div class="toast hidden"></div><div class="menu hidden"></div><button class="fab" title="Ask Max (ReplyMaxxing)"><img alt="Max" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiPjxkZWZzPjxmaWx0ZXIgaWQ9ImIiIHg9Ii0yMCUiIHk9Ii0yMCUiIHdpZHRoPSIxNDAlIiBoZWlnaHQ9IjE0MCUiPjxmZUdhdXNzaWFuQmx1ciBzdGREZXZpYXRpb249IjkiLz48L2ZpbHRlcj48aW1hZ2UgaWQ9Im14IiB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgaHJlZj0iZGF0YTppbWFnZS93ZWJwO2Jhc2U2NCxVa2xHUmtJNkFBQlhSVUpRVmxBNFdBb0FBQUFRQUFBQWp3QUFqd0FBUVV4UVNEOGdBQUFOSElGQTB2N2FRMFRFQkJCVnM5YVBiVzNMSk5tMk5jYjdtOE5rWnVZNTlUbExQWXN4UzVINkZLZkU0R0h2RU16YzB4d0tFQkVUNEkyMnRtVnZtMjFiMjM2YzUzVmRrbVZKWnJZVDI0RW1UdXMwVEdWNm1KbVptWm1abVprWmJzWnlVZzR6czVrRjEzVWV4Nzc5a0pKM3ZCMmp6KytJbUFEZXZjei9RNXBpL1A4RU10RUVvQ2JaMy9OTWdKVndwQVB5ZTVnd0JDUXBTNEF6TVA0ZWhYTUd6RFNTSXgwQ0pmYjNvSUZjSkFPQjVXS0RKZk05U0lRRkVFd1lzS1JVU3NiZmV6S1lrdXNDczlFQ0xQOS9zSTlOeWNYUXdOeVFBaHRoVkdqZ3pRUXNIOXhRa0Z5S2dBa25BbElBSlJPRXd3NjVQakpud3hDZ0VibHFaSU5sd0JMWVJJWWE0Z01USTBBdUJ3UUJHOEJtb3dVQ2JJRnNUcDAvTEZkWENHRVVVVVE2d2NnMk1oYUVOeGlZa0hEdGcxR3luVkpRY2p4VTJFNDNaTUFXV0NSRUlndGlzc0ErRW9mV0VreEVkT1owaDlOcFZ6S0ZoVEZZSmd5V0JhYmtBdlJSQ05zUjFxUUJ6bkU2ZWJycm1BMnpadU5tR1NVV0NJUFpYRkxKbGcvUUJGM2RRRmZ6eXR3OVBOeDlxUittNit0RHk3U2RHRm5HSUFzd21BQXBBZTU3R2dOekRVSVNXVVQxbU1kdi9PdzcwL01YcnRaaE5rdVRHQU1Hc0l3c3lDUWtSbHFrOTJBb082VVJZQWdrSU9xYzdyN3hZMWpVeXNvd0hRWW5hWU9NQVdSUzRtcENrZ0xyTzlBTzJvNWs0MWl1QnBJSU9IUC8rTlduY3U3UTB0cVZXYXREMnNZa2dNT1dCUlpaZVRhVlQ3eEREV1FCZVhraTRlVGR3K093b2U3ZzlxdlgyakFkakhHQ1pSa2paR1ZJenhBdzFKc2I0cklyK1Z4Y1hEcW51L3YvN2hpOCs4anMvREFNMVJ1eHdCYUFKVE9USUlBRXFUZG1BSWFRUUNha1pOamdES2N0SUxUcjhKV0xRNnZWTmdrR1M1WVJUQ2JCV2dpR0xyMGhqellrTDBnQ0F3a0RKc2M4N1NMWjRSM0hMMTdKV1IyYWtZMlJpUXdRZ1NXNUV0UUFSbTlGV1M0RlExa2hTVmZYQk0wNVRwOENXVmJkK1lHclo0ZFpUU2RPRU1nQ1VDY3FvZ3dJMHJjREVocWdFaE5RVXhhQWtKN3VUNTNGa1hMUjdrT25WcHFINm9ZeU1DWWNZalJsenhzUUNUUTdzcjBSazBBMXVacEVYRTB5bmNObEJRZUczSC8wekpYMU50Z0dXeklvS0I3RHVFKzdiUUFCZEp5WjVVMktuQlZBVGNhQUlJSUliSEM4ZStyQUdJSEZEYnZldWpKenhUZ0J5WUU0N3U3dmFQLy82ZnhVRUVBQ2RVU3ZKNEVRTXN4b0tFc1VMQmVYenVrTG56SWNwQndaZVh6eDFERFVJVFB3QmtHSjQvN2gvamcvL2Y4L1QxMUNRQVpOdmdsTEVnYm5jSUFJS3FLSWlPTTRIbGxRcEFNTTZrNnNuaHRtWkZxQWthSjBEMS80NmgrKytkZlAvdjYvcC9QdW1pc1F3cDdPdkxZMkxhUU9IRFBqTWJ1NEcrMUNzYVJ6UEJ3MFlXRWdURzc1OEJ0WDI1QTBTeFpFYVBMNDFWL0Q5Ly94dC8vODkra1RyZG1Wbk9JTkdyR3BGSVZSSDRpVXZMRW1hZHVrSENwenpXRUFnWnhDdWYvNDg3T3NGV05RVVl4Rzg3dUh6UEdSdGJWcHBtME1Cb1FOQW5zTkdXR0hoWVBvNXNmelcrZTFQbTFlWDYweXRFeTdtWFNKTXNrV0RneVFrc0Y1b252YlE3V2JwQ0Q2OGZ6TzVwVDJlTVhWRGRKS1FCYW9DcEhkanNCSkpKS1NVdVovMVo0cjY3TnVvaUdIbGJPbnpsd0wxWnJwSklneXhtQTJkMEJHOXZlZVB0dmFZRmxTaVg2OE5PK215SVdsdFZxYm5RWmt3SWl3dkFaMkcwRUNZcU9nWjIwdlJxV01GbmJzM0xzY2I3OXdkcVdsMDNKU09nQkwySklNVU5xZTR5K3QxVVRDRWQxNGNUdTE0R0I3eTJ6WnNBbHZBQk9DbmRpNGxaSEl6VVRtMTQvdFNzbkdvS1dESjQ2c3ZmVGNGWk0xMDNUSWxsRTdzN0Jva2hES0Q5UlRrWmxOb1RLZTdLUDFDYkE0bnJVaDA4SXBZWU1BTTZEbmJpS01uQ0hMRmxLYnZuNzZJMkVEQXJmVTR2Rzdkcnp5MUxsaFZ0Vk5LampBek42NWRteStCV0U3NSs1KysxS2JOZHlOeC8yZUljTUJ6cVZ0VjJlMXltQWxSc0l5MkFSdVk1QlFJaVBqZEIyZVBieS9nUUluRWpYTDhYdTNQL2JrbEc2MHhTa1pYQzdQTGwvODRCaVJwaHV1UC96Y1dqTmROKzYyYmFHRkVuQi80TnFLVFNabW8xS3lMSWhvNmdaQ0tTd2pySFNtKzZ0djNXb1JnMGNGcWtPdXZ2RVRzNitlTDdWZzJTSTQ3L3EyN2t3U2hlUmJyNTRYS3RMY1ByTElXQVR6NDZHNWtkNGdBY2F5VnVBNHh3MGpoUkVZWk1na2h5ZXVQOURFOEkwckMvdjJMT09xWUJoLzlNUGYvdmJxR0JDR2Rtb1V2TFg5U0pOQ3BpMGZmWHZXckRJNWtBNHM1TERMVXJhaHBsQUtRRWFnSmlYdUxSd0FockJCdG5NWXpwNjl6N1NGMlJObjNyNDJkL09KWmMrNmFQWEFwOTU2Y1FaWXNxNmMzektYMCtjL3NETkwycEkvdFA3dTRINjhONXhLU2RpNDM3RSsxQ29RQmlFMldpMHVZTGN3RnNqQ01yalcxcjI4WjNjVnQ3NTI3dks1dDU2N2N1ZERPMTJMYXZkZzF4d3BPY3VGSExzTjU2N2RKVWdwMnNMUk4xekt3aklaRGhzd2lxVzZRbkZhSVlNa0cxbTFLeDM3K1NLYWtZV1JiQ0Rka3ZPbjc3RHFydTc1VU5IYmo3eCt4NmZtSzExNm0yM0psazh2bG1uT3VuZTJIRzlCMk9STlB0ZVh2V1RCWUNGTGRMS3djYWhnRXdVbmJtT0I3R1VLTWlVTEN4TTRiYWxOMTUrNWFWOFROejdUMGtsNzU4ZGUva1VQdGRhUjRTQkZ1WFp1Sjg2R1g3dHBJU054NU9JTmIrUWVIRTZaQUlFOWtWMkpjQ3BLSkpRdVdtdTE1eEtYRnl0SWh5MlFRZUNOWXRiT25iMHJsVGRmZkN0YXE0MjVWLzdyZ1Y4N2FTRmtJT1A4eXNLb2s2ZlRpL1cyNXBCU2VVaXhIV01VR0J2a2ZuRzlWa0lkVUVySjFxU1MwMVAvcDVKZUlpQUZnY0VCQm1Sb0RkZG5idHhXYy82bWIzWTF3WjR2Ly9NN3YvNzZhUTlZbGw0YkxYUkZIbGFIVjQ4Y2FZWWdGM2NYTXF5d1ZkMGhXOW95elVBcVBUbDRibkhMZUx4ajEvTENuejg3UmV4TSt4eklBdGt5Z2NDV1JMVnB2SG5sOWd6dWZub2wzYUMxdHVYWkgva2xSeE1NbEpVM2RzLzN1S211WFRwelQxRUNvWnRtbHNHb1BuZDBJUkZXNzNEcG9qRy92T2ZndnVVNUtuRGhMLzUzQVVMb2lnZ2JNR0VKTEZsQ2xtazFaNC9mTVpmdFdEdzlIc0lXdE1WTFAvcnhiWlVTdFBKeTJXdGtwWWQ0cFh5d2R1QnNFem1NSVo3TEkzT1dCZk45QzAzNy9iZmN1R3cyWnMzdUIvLzRvOHBFNkJsaGpJQVFkcUFDT0pTSnFsNnVOelIzZDM5K2trYkl6T0xDK2RzSTJ5WGYzRjZJQ0tkYnpWZHYycG9TY3JPSXdQSEd1VVByaHlBTTg2T1dDN2Zlc1Exd0JTblV2ZlBtbjg0T0NjUjFHUXNCU0VZaEtZQ1ExR3ByczR2UFBrVHd3RXVuNVFhSjVkRUNzcUZjUGJ0VVJpVnNwd2ZPVDI5cFpDakF0bFhlZlA3R2haVjlJeHM4S1hPMzN3NDVvT2pBRm56MStIY1NqVXRkSUp6QlJra3BoU1FvRWM0Mm11OG5DOFJqVjVkYlBiTDg2R1NRTXh4ZFA1b0RFRHpYN1Iwank0STZIVjY0N2xBcVRaSGxMS2NldlhscGJ0VzdtaEQ5NFpOUWljNG1TTWh5N3VtVHgvMEpCUnJPQUdvcUtVQ0NrRlJFbExDMkh6bThjK3U0SnRCU0dYZCthYjdKb1ZCb0lURnl6RjdhUDQ0QWhkMDh6QzZjdVd1RWNCS3BNanh5ZEJGZHJZZlpHSWRwOUxZS2VXbTJDem0rZW1USEhEUHRBSEZWRG1ORVFDaEtSSlFzKzQ4ZFhXVFRyS2hMRlI1ODVteG5BUXFXN1dJN1h0ZXVXcm9JYjh4YXk5dGJEOVZBdGtWOGVkZE8rcWlyZTd1VXJlWStjNlRacTYrK3k2Y090K3pQUG45UEhpTkN1akFMTGphSU1FWFJLNktNRDV6WUFUUTc1QWdib2J3dW5seTBzSWh1TzdVZzViZDI3SndVQWNhUXM5blZjM2VVeEdHNWZPdkNCeWFURXQzVnVUa0RsdXBZYjMvcHFWMDNITG4xWm9mMUU0ZjNoY2NoWm8wc0NCbHdRRVQwcFhoeTg0a0pOT2hFaFZEQnpoeEdEMzUrdmlFb3BaOG5iSmNYVjQvU0YwU0FNOU90ZTNWeXJDb3Nsek9QM1oybEtMMDZ0N1FCb252OVA3MTF4d083NXN0RDFOS2RmdTVPZFRNQ0UrRXNnREFJU2xIcE8xMTNkOE5WSGM0b2dXaXpwdEZZUFo5NytBS1dTaGRMRFV6VWg0OHZGU0pDWUdPeTFmVTNiaThZOE1PM2RCRk44c3piMmRpdC83ZkhQL2JBd25yemlSMnRUMzd5cGgxMEF6Z3JEQnRZbGpaRUtkMms3THhqbWRhaUpBcTFVKys4OXVycGFWMWJtUzdzUFhEc00zdGZYMElSbmJhMERGeGVYZDFQM3l2QUVqaGJ6dnh1ZDNNVmxHOE5OekF1blNDdjdEU292UGxmOW41cXgwcVdjZmswMWQwYnI5M2JTcUJqMEJIVEFsZ0NsZWpuNHRhYm9YYUFhR2RlZVB6OGFOdWVuWk15NnZQQ1c2OCtmV0hIMWxZazRaMDBvZmJWV3hkUUNDRXMyMm12WG43KzQzT05jdVdabTlwSVhSUThYTm5kSlhIdGgyKzc3ZEl3aW5MaGdhNzE2Zjk5eDU2UVJ4QmhCVUZZUmtLVHljSURIVTJkRGJyeXRUZDJIajgwNlVvT1Z0ZEowVitNU1pXbHJsL0cwRDAvN05lNHMyVEpSbGh0MXZwVGVVT2liK3hiVWduQVpuWExuTkVxVzFjN0hPam5ZM1ZQWHJ5cjloR0ttZWllQVN3TFZNcm9oazlRVzIrUThaYWJaayt1alJQU0NGTFNLRXhDR1czSFlhMTg4ZTVKaVloaU1MSkYyblU2TzMrTHlqT3ZuWnhNdXNCTjFxeWZNNndUd2t4V2Z4WER5TzFIUG1saWt3UmtFM0JnSExLbjkxK2RiZ0duSlJPNzc3ditDOThjeGF4WklpRUNZYVMrMisxYWlPL2ZjMmh1TEFvSXNNd213K1RsWFh0V2Z2U3VmdFIzRXVFc2xZbkZHaVdsYm0zL3ozSnA1WWUyMzVHU0VJdUo1U0NJS29HeHAvLzh0V1A3amh6WVBpY2Fvdm5vTHlyLzVibjVtb0pFTWhBUmhiSWJ1M3YyblFkbVhVU0pESkF4RnMzazdJMTNQdnZJbGlNVVZCU0VQQjBXZ1N1TUlzcm83RytoOW5IbHh6OFg0eEFzQ1pqc3dXSjVReXJiK3BtM1RsOXU0NFdqTit5UVc2aHgvODkrK0Q5c25jemNoTEFzUmFDNkJHWDF4eitXWGErSURJSkVRQ1BTdzlyc3l5OGYvS3hLanlBazZyVzYyK2p0YnN1b2RHc1BIYXQ5ZXY3bi91RDVFWllwTFdTUFR3RENCbWR6MXNicWhZdVgzN2w2Nkk3cng2UTg3UGp0aTMvaHd2elVFcFlsUVhpNXoxTC82OG1EOUhSaENVQkdDUm0xMVhyMTRRL3VHbmRSSkN3NVo4TXk0cDJ0WTFIV2Z5MVp3OTFIUC9JL1htOURSV0RMUmlSQXVJbXduYTR0aDh6bzgveXJiL2pXa3d0TjBkb3YrRVYvNTRzVExGdkkyRjY3bGRuNGZ5L2QxdVpLRVVKaGtOTElKTmtHajliZGJTTEw2VmhkbE9xWkhaUm9XLzVzL3E3bG9URGMrZ3Yvend0Qk5vT05JVklHcFJVcHA1cXoyV291WmJoMDV2WFRkOTZYSW1hM0h2MWY4OEtFalRLcGsyT012dS95VDgxSmxFNjRZTHZZWVNXa2xabE5CU2xDSXRNcWEvT0tDK3Y3MWtQT1MvLzI4Ny8vczAybEh2amxQL0NXYWpZYmc1VmhtUXlweVhMRG1TR25zYUd0SGJXVnBmdXJsL2V1eUJtMVRMTGkxcGIzODhQblA3dldqVHFKQ0FNWVhDd1NOeUl0aUVBNGpLMWhGTHl5dkZ4bE5GcCs3Sy9jOWV2ZHl1eklyLzRmYnltejJSZ3NnVzFGWWhsYnhvSnNsTTd0MTFEN09scjdmWWR1V01IWnJlemFlK1pxTmpOZHZ2QlBaeCtaUkI4bEhFS1lTSUJJVUpJWkpDRUpDNXh0T3QxVzlPalJQbFJFMXVYNEcxZCszeWk3NGRqUC9MNHI2NVY4RDhzZ1I4b0cyZUVrY0ZxVDhTK21qck5jK2hNM25qZ3p0dnJMZHgvLzZwazZ5OGp5eXQrODg0NUJjNkdORnNndXFXZ09LMlU1SlJDa0NaekRNR3diWFg3cFJFYUVFRU9kLzgvUC9jbmlydDUrNHZ0ZG14TU1CZ05ZRmdaaE1CU3B1L2JUYWFPTTliLzJvVHZQVERMNmk3OTQ3NzlvbWxXYk9IdnVvQ0xVeVJJQ0JBNDNCVWJHWUFLUVNNQ3RpSGhtYWJHTXNRSTNyMi83dmhkK1R4TDEwOVBIVlpzVFd4WmdKZUk5ald4RlA4bGJEN1ppNVQvNXlBT254a1IvNW5kdS82OWJSdjJwb1dTclhWdVByb01Rc29RendDZ3RBY0tDbENDZ0tjbjF1bTM5Kys1ZnFqa3FjdHJRZHY2ZjFaOVpROTNQKzhhcHROTVlVbUVSRGIySE1KSzZ5YjZQVXBYZC85eDkvOW9XTVRyOSt3Ky91R2Nodjl6UGUxTXNoUnd5R0FKU0Zva1FSb2JBU29mVWFQVmF2ZjVISnJlWGJldHJrK3JBVGFWTi91dVJPMnVwaCs3NDJteWFtVVNDRVpZUkZtQkVLRlQwYWVxNDlvOWMrQmxydmJyNWM3Lzh6bXU3dHAzL3gvMjhCVTRRbG9RbDI4SmdrSk9TaUkwR1FzYktSbHM2ODk4K0ZKTmQ5ei8rNGtLejFLa08wL2FUbjl5YXlvOWVlalZyMmpZZ3R5UUFtVTJsVXZwMlE5LzY3QzgvK3BIWkpPaFg3djlsdFd3Nzh5ZjZwWlV3QmpBZ1diS3cyZFNBV3hFeWlNMUZwdHkxUDdtMGYybjN6cVhQL1l2VDNhQ2ViSFhvTGozM29HaGI3bnlzRFlsVGxrSENsZ1VnQ05ITkxkMU9sWG44dzVQVjJYakxiUEpIbUM1Yy9KMEx1ODcyQm0wbVRHQ0k5OXJVa2hFWWJVSUMyWDNyaGUzWGRHSnkrY2FmL2R0SG5ZZUZFeDlkSEs2Y2VYWTZjdVJkNnkrN0pTUUd3cEd5TEdSUXFCVHVvbzVhOTNZOXRIWG45amN1NVI5a05qZjg3dVY5NThZV3lBSkVzbEdHeVBlRGhRVVNnR1VnM2VwYzY2Nisrd2xPL1pRai8yRG5UUHRHZTltWXJUaTNmUGpwV2F0TkdCblR3cnhuUU9uR0M0Y2RqdFh6bjdqeDJKN3hmMzd1b1ZIdHkxL2RlZkRjQkJ6S3NDUUROb0FqNWZjaE1rQWdDN0JseUZRNko5LzBMN2xhLy9qRGowdzg2aTZhTUVVWjhnY3ZuVXJiTWlCQlFrbUU1Q2dSY1J1dDJEcXhBSnpaYy9La2MveklLOGZQakN3RUlrQmttRFFiemZ2dGtrUkVXQWdia3lSZzJzNi9jL0xCdGFWZisrOThlWFpQcGhJYm9keHgzWXZUUWJZQUcwQXBBQ25VeC93Uk5rNUt4ZDNGcFovS01MbnlyMjlyQVlRbEJaSVZhWk5wa05wN1NVMGdGS2hnWXptZHdrQjYrRnUvYjB0OXFQdktlSFlnSVNRZ0V6NzQ4bHFwUmxnR3dyYkFRYUMrSEhYckRIYUh1WGI3ZkJiOTIxdHZxd1ZFV0lXaUVpaHJNNWtZNVBkQUdLR0Npa0kycmRrcFk2TzIvU3V2L3R4cC83Ty9PSjZ1UmJ6MlpKdmZ0V05odVJNSExsd2NzMUhlc05FSUpIVXh2ZzR3VmlTaTNNNHdldWM3SjYrTUF3R1NTdW1INkNxbHpwcHNJOTdMZ1VYQlVUckNWZ3hEUW91MFFIWDBUMzdoOXZxaFc3NTg3Y0k4YTQ4T1Z5K3VaTmwyM2NHYmpqeEdFUlpFZ21QRHBpcnQ0Q2lMb2RDeW94N05EUDNvaDdjNUpNc1JJdnJ4eWRzV1RqLytYTmFhU3N6N2xZVlFsRDV1dm5QSDVjY2ZuYm1DbTdCd2krZmYrdXlnbjZXZnZOQjd4L1RLMnVyS3RmTm4zcnkwNWVjZGF5SEpNaHRsWkV0MjBHNmlRc2VGTnkvY2RMQnBhMnY5aGFmdW40VUZoS1JTaHA5N0crdy8rb1V2OUF3TkxMK1hqSkFpdXZxUlQ4RDJZNC84ZU8rYXRwSEJIdi9BSjhhdGZXVDBkdCtXUnFlSDJVQ0o0ZUozZGh3cFJRVXdFazRDWVN4cGNaK0xPUHZrNVIzTFJ4Y1FtZDJYcjd1dWdyVXh1dEh3dWVVYzVOMi82c21IcVhiaTk0ZENaVHc5K1JGbThzNWY5Y3pYTkxRRURDbFBIbzhQREZGdldXOWwzQzdMYm1uS0dIckpnUlUyR3dXWXBPeUQ5dWJyNTNjZFd0N2FJY3RsZVBTTzFna1JTTkdYRzI1M2R0YXcvZWQrNFRTdG1ReS9GeURValhiK05JYUpOV3o3WlY5OGUxcUZEUm0ycmo3eGdJTWNONHF2UlliU21Tb2pTYkl3Wm5PRDVWZzl5Q3ZmdnJwOGZIZnB0bzZ3Y1BlV0QwNURVaEFnOG5PMFBrM1VtdzkrWnpvWU1POVRvQktySDZXTkVrZTk4Y0EzbkFuR01tNzlremROR3JMTS9HeWFwSTBpVUFBRTJpRFNRaloxOXRaUCtNYnI1dnRSWDlCa2c1N2R2NUFxRWlpa2RtU1haV0ZSN254eXFsU0NONU9Sc0xxdHQyRmhCSGM5WFVrYkE4YjltejQwQkJzVjJScFlBZ0locFJMQUlNdVlRZDk1OXVTdVNWRVpoWVk1bWVJWGo3bVRrV1dWZm55Q1dneVI0V09yNTZJbHlON0VVa3BGc3h1NkxDbVU0YVA5NjZvTkxJemh5cmxqNEVneDYyeGtZVWtBU290TlhNQmdPNmxyaWdoS3gzUUxkbmZwNnVFcVdTQlV1dkZCRUFiSTdRZWZTNHlsM0lSSU9kUnhQYldRUW01TFIxNXB6WGFrU05uNXptR28wV1hPQ29YM2xJVWNHZDZBa2tqQW1aa2tKVUQ5NWZtSnJUT1RMU2tDZ2dpWW13TWpXYzZ5OTJ3MEc4SzVTU3VFeGZnd1lNVEdJNmRxRThKR3hwemVFOHpPN3B4YnViVFVkVmlBUUJheWtrME5DTnM0RXhRaDZLKzFSY1BaeFU0SUNZSHFraHcyWXVPT2xlb0dJRzhJV2xpaDJBWkdXRmhMcXcxYmxnRmJsK2JtTTk0OWZTSlhKeDBDTEdUSjJKMjlDWElLNU1SS0J5bkUydm91NE54eUJCdkZobTF1WWNtYmJGK2JPcHp2dzFqUUpndHN0Q3l4TmFmWWlmQ0dzaEp6V1M2OGZQSDZoVzBxSUVzQVZzb1NtNmR3WURDSmpJbHNYbCtXdUxJQUNFQWh4VHdHR1VCTUtrNExTd20wZ2dIbWNwUE5lMWNaWkFDTEZSYWNaOVllZmZQamkzMVJJQUJaeHBHOGR3WUcyUVprZ1JJWEltZWRJMEJnSVFrTEE3SUlEUUtCekVZWm95NW15TWpDQUVhQURKYlYzQkYxdW5wMTV5Z1VnQUJrakt6M3dwSEN3aGEyNURUcXpUQWJoU1F3R0ZQSHNqWTR6RlFkQ29QWkdFMEM1L3FvTTBJR3FQUVdsZ1dHdEFMTmFuWW9oRFlSQm1IZTI1QklCcEd5WkxkMDExdEQ2OEppVTh1eE1oOEdCSWJ6M1VJQWFET0hqVk5EMjJLeHFYV2xtNU1sQXhhSkJLelNSd0lGU1liRjU3UXdzaElacFJVTWpGQkxaY1FtY3RxWEZ1YU5ER0NkVzR3SWdNMGl3YUMxcTdzUkJndk9ML1FDR1ZteU1ncDRxZzdaSVJsTVFuc1pkZ0FHaEJOSGFkbUJaNTBreThKdXFjdnNUb0dSZzljUFNpQ2NHOVFrZ0xaMi9nZ3lJTVBydTBZS0FZUXRNeXFva1VZS3NMalVqYzlyTE1zQ2czQzZ0SUxVQ0N3TEd6Sld6aDYxUUZpeC91NTFMUVNJalVhQU04dHJSNk9KaldWNC9iQTdDU0VMdzFKdDNXby9ucG9pWWJ4Z2o4K0huRUlvd1NHM0RFZm5FWGJhQXNzNFp5L2ZGbzB3T043bzl3NUZDSWNOWUFCVG50MjdQZG5vOHVyc1dDdEN5QUtWdHBoRHVacGJzb0FBZ1lYYzBJRFkzQmJaMXVmN05obXRoRk5nakxQeStPRUR5ZVkvZVdKYklBbXpxUjBZcWwrNmNsK1QyUGo1RDIybENKQ1FJdXBlbXM1cXl5aGt5d0drMnkzSXpzYUVVYk5EWHV2SHJkdHp0aUZzd3liblgzc3dJNFc3YzA5LzJLT1FyTndNMlRoYml5OStzcmVGdTFNdjNUL3JwRUJHRWFZL0FydzdudThEUUd5MHVLMkZSUWJHbVJUVkVSdytOUlRzbEUyU09mK2pIemd5SzNib1B6MjByMmxEaGplencwNjF1YSs5K1F0bmtxWC9mTjl1ZFJKQ0FncmJGeEdudDBFb1pGQllUamRKSkZDQ3lGWlYyZ1FPWHBsU2JRd3B1ODNlL3I1ZmRjQUUvMkx1YmthQXBHVHpGQmpuZXZ1WHQvMDBFUDk2ZkFkemt1UUEwS2djZFJ1dlhqb3dDeFRJV0NEanhqSkFDa2UybkU1M2hmZE56bVNyd2hnNzIxcDU5b2QvMWczbDNmKzlkTWZhcUN2SVlkNWJ4cVlOOGo4NDhKRnQ1Nzl2N3ZaWlh4U1dDSWNpZEF1dHZONE9SRWpHUWdCMm95d1p4c2lXbFczdDNlT2pPbi95cVZvdGJKeDJ1dlhQL3VlclRmZmRVeVZGSVBNK1UwQkQ1dXEvZVNxN2UrOG1SQkFPaUlodWZmdCtGNzU1L2R5b0NFQktURzRzckpRRk9NR3RubDdjWmQ5NTlxMmVabU5Ja21HZDlUUGV2VHp0K2dna0l0K0hFdGwyRGtOLytkSzJwYUV2RWRyVVVuVERnOHpHNTkvNkFOcEVGa0RlQ0dUWmJKcVpMZGZXRHROMjNQQ01zamFNSWQxYURpcWwxYTZVa0VCTjd5TURnOTFhWm5TdGxoS2JRVWhkUFhZb0M5L1pzN2NGaExDc2k3MlJaYkZwaHUxV0hhL2NNRWwvN05JcnRkbTJiS2NUTWxNcUlRbms1TDJsbVlvaDhVYWtDQ0VKb3BUdzhOTVlSbGVlT0JsOUlKbkFnSEZqWVN5VVlKVGswTjVadlNOeng4Y2V1U2pzdExHTjA3YUN3SklzM3FjZFRoa1MzSkJDS0NRckZORmQrNHhycjg5dlA2WmVraEVPcUptOWpaR0ZqTEhBT1Z0YmZlSyszYTErNk9qRDJZWkcydUMwMGdpWllvR2xGRlpnTEl4dEdXTkNFZ2lGd3JIMjRQR2tmK2ZSaitTb0N5RkFGc1h0TGNBZ1NKeDFWaSs4K2lsRis5emlGNmU0cFVtbmFGaVdBQVFLQXhoTDJGZ0dXNEFRRXBLS3VyV1Q5N2lXOW4vdjJFbUprQ3daR2JtOUNXUEoyRGhOcFg5ay9FQWxmclordkpXc05yYU5zYkFpWlFTRUxTeU1BWXNNRzRXRlJCQWxOSDNnYnRmUy9kK3Q5MC83c0lTRXNHcTZHYmFRRWRqR1ZwdldiOXgwUXpVLzkrQ1BudTdhTE5NNExjc2dpd1FCbHN6N0ZoZ1FDdVN1YU9DbkhmYlFkVC8yN2lmS1hJOWtCQ0JMdkdKS0FNWmdsRVB6K2M5LzdJYXErdkY3dnZsRUxablZSazJKTVJEQ0FNb3dZR0dCc0NXalRidFNwOWY5YkxLVzd1dmYrdWhJb3dpa3pleUpWelRJQWl4TUpoNm0wOHRmKzhpTlRjUHhuOWtlZVNrN1piV3hqZGxVQUxJTVdBYUJRU0FJbFVLMnBVK2NvRVpYdnZ6QzU3TDFrYVZZTXFDbWVGV2J3SlpzbVd4a2M1ejZvYnZ1dCt2by9vOWMvdGFMMDFLY3JSbkFXTGFFUVlBRmtFSkNXS0hvR05xZWUwN0MwUFhULy92T3AzZDBIZG5KSWJBdy8zOWhaR1RBR0RkUjE0ZTFIOW54TTdhMHJNc1AzbG1mZS9iTTFGMUhKbW1URWlBd3dvREFnRnc2dVdVL3VmN3VnekI0WHEvOXAwT2ZrVWNsUWlsaHlSRG10VE03c1BBR2thMWx3aGRlK016dHlzRUxIN3g3LzZXWFhqMjE0Z2piU0NSR01oZ1pyRkRZaG1idHZQSG9BY1BndWJMeXBXOS8vSmJzaTZJVEFwUlNXcnk2c1ZES2dPeEVyUTVUdmZud3dxZVBSQTRadTI0NWVTQlB2L242cVdzVkpIV1NJVWdUeW1iajVoalBMZTA1Y1AwT1E4NDByK2xYUG4vZ3AyeGY2N29TZ1pBTUFyNGJzQkd5c0JKd09sdXR6TDd6N2QyZnZLbFFLMW84ZE96b252RnM1ZEw1aTFkV2E2M0RNS0JDdW93bW8zRTN0N2hyNTlJOEJtb3k2am4vdGNlWEh6eVlaVlJVQWl5RUxFemtkd0VaWUFCamxFNlJyUTFsNWFudnpOMXo4eTdSYXFMRm5idDI3TnkxUEZkcWEwcWFrWUxTeVdwc2RFMllFL1hWUjUvZWZjZE5YVlZmUWtnQ0hCWmtTYjRyVThKc21oYTBSRmxuOU90UFBMMSs0S1lidDB0a2JSYUs4WGc4R3ZlakxnQ3hhZGFhS0xwT2NQWE5aNTdSRFhmdW0yVmZpb0lBT1FBSFdOWjNCdzJGTndFYm5DYXoxVFp1cDE5Ni9keldJMGVPN0JpRkFHZmFsZ0VFR0VWMENtRDkwdHR2djNwS1IyODlOQW1LU3BFSVdRaUV6SGV4c1VQWUlMQnhOR05hdHBacTU5OTk5OXpLYVB1dTNkdTJiaG1QQ3hMYXNGSEFzTDU2L3RUYmIxMWdjZnZCWS9zNkQrNzZRa2dTRmtKWTVydmJTZ2ZDbUkwbWpkTTRoeHlKNGNMcDArY3VyVHVpakxjc2pKUXFjbXQybmMxV3JxM2xhTnVlQTN1MnpJL2xkUFFLYlVTQXNFQkdhUlQ0dXdSYXRKREZSbU13M2pSdFduTjBKV2VyMTliWDExZFhhM05yRVNHaTc4dmM0c0xjd3FSTFp4SVJBVUVRSUFzaDdEQTRURFMrYXlQV29XdVhSYlhTYmhsN3pobXFZK1NzMHlZcG5OZmpPQUJGUlFBUkVvdExsN2NjN280UUJvRVhiR1ZUdTFCQk5kTENRVGw2QUtnREtFZ2lBcEpsQ1BTbXJwZVdaQVJXUkJhcndLYXhBMWtxd3FvVElBTUpKa0tDclVJUWI3enB6TEVJa0pTRlFBVVFJU1d1R3BlV05pQW1pU1NnWVJpUzhSNFhjNVpMU3dLSTU4dTRLa0VhcVdDQVRSaVhHbW5rS3NhN2pEaXJCR0FZQVhrUmtsMEpCQkxKSkVOU3JrcG1ZRHZKdTA1MkFzaUVqT2N6d0ZEQ2VLRWhsNnNBaWJtc1p1K01QVll3QXlRZ3d6Q0FrTXVFRUlSMEVab0FrN0RBaUhjZHE0RVlSaHFRQkVLQVhUSFFBSklFa3VkbFY0aDNIK0FtVFlBMWhJc1FLRUJKQ0tTQlpKQmdkckZnZkl6RnVMQ0t4TE1HUWdrUWNqWGt1a0VJNE9MeWNRWVd1SUlHcmpSUWFDVFh2WGlwWlVLcGZLZ0ZFRTAwbUdUUUJEUmRNd0NoaTUyeVJDQStaamM1VDhOMW04SzRhb0FsUUJDWDhaR0hDNFVJQ2F1eGcrMkFzT05tczNydGd3OGd6MTI0S1NsTHpoblFhc2g0dndCV1VEZ2czQmtBQUxCV0FKMEJLcEFBa0FBK01SS0hRcUloREwyRE5oQUJnbHNBTkFQbk1iM3BmNDVmdUIvd1Brc3FMOUQrNy85Yi82WCtlK1BYZS8wajVWUGxYNlAvay83WiswUCt2Ly8vL3krNUgrazlWZjZFOWdQOU8vOC8vWnY4Si92UDc3Ly8rOXo1Zy8xai80MzlpOTREL1ZmNnIvVmU2ais0ZjVEOWV2Z0EvbW45Qi81bnRYZjc3Mk12M0w5Z0QrWmYybjB2LytqL2wvK2wvOXZvMy9yMytvLzkzK1MrQXIrWC8wai9rL24vOGdIL2k5UUQxSFA0QjJMdjljOUJ2U0x3bDhzSHREMjA1THZYZm1qL0svdy8rZC9NWDR0LzJIZ1h3Q1B5UCtpZjVuOHYrSFlBSDlkLzl2NlAvNEhtOTRnSDgyL3BuKzg5Z2YraDRkdjREL3Fld0IvUFA2NS94Zjc5K1hueVcvOG4rZi9NZjI5ZlR2L2wvMDN3Ri96WCswZjhmN2wvblo5alA3Yyt5Wit4N3FCcC9lOHdQSERUL215cEZ6SEF5UFdUT1NDajlVN0xPN0hBczBnaFVDa1JZYnpaU1RTbTdFY0Z4SG1lcXB3TnNLT25ueVZzeDRTcXpBOGR0ekE2UjN5ZmVFTitGSm44TWJLejRsdGpnaHM0engzY2dQNHpvOVhzOUFDQTJzNEVRTktPSDBpa1VvUWNNUGpYcEtlcGdRT0FQdEhkNkxWY0RMMC8zNnVhcVFCeTljcHBKdk5PVDIvZU0vRHhSTjN4V0Z3ZnFtWmhvQm5xRkY4MEVSSk1VK2YzUitJaytxQ0d1TTFNSmxKYWkxTmI4SFhvL0ZXWEJSbWNja0hPblNkYVB3T2c1bWhVSTdLVmF1VWM5TU5ZTFNtQi9IK2RIWi9hMjNLNnk0dVBWWDlSc2hjcHVBMjdRRDJuL2tETEl1ZWo3TU96UUhacCt4ZDQyYVJ5U0p6dkV3SEVIaUpEOC9PWGVaR0lMejhMWGJYWC9xRFNBM1lHT0k3d3ZIVlBIVmdMSmFpWE5YcDJZNDExbWxVNS9hZUFrTklSREpFZU5mYVVLTWdiMnZ1aW1NZDBxaTZEb1VzWjFHd1Q1Y0RycjRiaDFINTRjd1dKT3krZEE0d25ZckxjVnhNeGpGUEhncXVoRFRKRGZGOUlZcngydy9RTUxOZS8xV1p3NlU4TXROcjNlb2Z1aVluN1dOTDlPcCt4dFphcW9PNkNMQjRzQUFEKy80KzhJVFE3bkkwQzZiMFBHb0Yrb1lWdWhwa0t5ZlViYmpYTWJ0REN5Y1dDeXNsRFN1cmxUYW55RUtyOThSRXF1YU52bzR6MlRGSk5WQkNNbmtqZldPa0xWSjdpYnFkenIxajNCWEVpNWVTdTlaOFc3S0VpNE1GN0NTQ25sZHFEOGUxMVFLSDJVWXNRMnF1OHJITjVlK2w5SXFFY013WFczdW9Pc3BVeUtmNGZYeEg5aDREY0pUcldsdytGU0tuVW5LdkQrZXdleS9UY0xXbDJiWGVHQ1pKSzR4TTgwVzV1Z0pubWhKYXVBMTNoVzV5c1JtRDZ6ZXIzNjZteVJuelFqOW9nQVhmdHlPZjhvdXg0MWlFSk50R3JMS01EVnpYcU5OTzY2RTRENDlsNzY3TUNiaXNIcjdmaHpnSGxRc3lPMFFyMzFDUlpzeUpHRWZCWXdxcFFtbDhxSUM1MnhtaHlSQU0rWXYxbi9sbEdWVXh6L2RWZGRReGNUcTVyTks4MEdtWTU5c204KzZFcnNFNHFxWi9xcXpER3BjVHlCcDlpTVBMNUJ1ZE9qbnZFZUJZUUlHZ1QyL203N1d3VEVQY2pzSDV1T1UyelBuQWlmdElkZndqU2tQa1ZKWHhUcjl3L0VqMDlveWVaTkdCZzliVlZaU3pjRVIybGtBRWVpVFR5Y2FodjhBZjBGVDFuWG84ZG5PbDJOMVJSNFpiVS9ZUVhMOTU4UytndmdnaTZtT25tRHlPQTZFaWRIQnplQkRuNncvNFpiaktsNUdqRmxvd0hHSVd3cllTdUxMelFSUVh6MXQyMitrNHIrTHdiUXk1UFZwVnFaa0taYUJISjJPV1JSWGdzdTNvejR6NHVrNjV2NFh6V2ZYSEU1NVorTi9teWNUSEN5SkVVQTA5blZuVStNdUJnMWtTQ1p3bDRSWVBhaDBQT0tjeUpxc0RBYVQwbktDKzJObHZmelNJRUo2MmtqcHd3akt1WXlGYkgvY3AzMVlGNnBubjJpeUF1TEJMT2pDQ0VsUVpZUFZsZ1JDZXZ0cGo5SDJlYmNFUVlMQVo5VVRVaVR3SGsyeFVsOXNKZDlObnQ1Z0M2SG0vWFFLSGFBWCtjTGJadTJFYnc5eFZyNTQ0UGJSU0ROekloa0FvbVJFSHNzOGFWRFI4WXByeCtRdmJEOGRhOCthNTUyUVdablhlUUpTOHd1RG9ZdU5YSC94ODdFdHZsVVZnWXJYNnFQY3BXMFBwV0JTUHhLNE9NQ3N3TVVnamRqRVhFTFVFbFgvR1hzditSY2VBYU9tR1dTNEVNQjV5UXArSzJ4M3hwblRIK3JpK3VGY2NRZXBuWGJvZXlMYzVlTFBLc0VmSy9abHhHTGthczhhaGlML3VURUtSSjBISjNvK1pTZWJkN252OTd5Rmo1V1g5bm9SVG5jRWRGT2F1OU5KdVBaTmZyWjl6OXNpWCtyUVpnaitKU2JMVlQwMHNnMHBPc3l0MXdqWFBFb3EzQjlzNllacnpNUUFrdFVJbDU4R2QzY3ZjQVYvRW1LUWRDK3ZvYWZFYUpzcy81UzF4ZDkvbGJabFdrTlNxN3krV1gxV2R2cVd1bEFLYitUcnlKSWZmVjE1em5FazB1UmwvN1I1RFYreWZtZWVBMXhYMkFQMXRVV0xZYm83Z2ZlS0xGUVRYQ2QwdUc0M0dtcHNBdTczNk1IQ0djZHBTZUtUVWV2V1Q0TnJKVWdHNloxT1E3TEpVZ0VweHpaQzBRaEdydDI5eGR6eTVYVnJZaE5sd29tb0RwRGtvSVRuMXpqV1R5ZGJMWkZ6WFNhbUc0ZVl3cE5LakQ0S1pFc21wNkNncmlDTGtKeVJNS1RIckJMZENKSmJTL2ZxWEplVTI0bVBzd1ZNK2VFUnRXNjJTMUtpSHVreXpPbGpqTm9UVTJ1SEUyMXc5SkU1bkJ4RjRwMXY2dEdvTkJ3T2NPUUx0Rk5iTmxaWjRtSEFaRU9tTHBOVGsvRncrSTBUR09BVXFMRlZQR2lqMHorMmt3ZjFiMVM0aGVQWlp3VHJnUytsZ0JWRGFabmNvamRXOUorbTFxd0JPS3g1eTBVd2w5T2VxNkZxQjlpZWlRSjJ3VlFTQXRJbHhZRVRZb2VlM0R3MWhNZVVaZWpGSmNhb0ltTXE5YWcyVmZ4R3pITnY5aWlDdzFOV3NCbjNXUUMvajhwVXR5TU9JYTlWL3A5dG9UY0RIVE01a3FZRWVpV2lOcGRFbEkrNFdWUnhJbWFUdkl5YmFLZ0tkSnFtK3M0djZKaTNKeVJYV1d1d1JTdGp6YlBreVp6bVdxQjNQbExGeHpCVC9CbjdVMkNYV05JWTJOZW9Bc2t2S1RsdnhHTEZLQXpFZHRKVjljWXlKL0oyT1pkMGs4N2VJK2JVZzNCQ3JPVTF2d0xTVVpyclFEazlQVEF0b21SS1liRkIvV1d2RU9IZHgvN3dlbkVWcFMwWi9ZR091TFRhYk90NnFsUCtraGV4UG44TWZJaFUwWkErd2RPVDROZ3pteS9uSzdDM3l1dmVVMHZmbUNpakVrQWorNjZ3WHZwWjIwQ2FjWldKK3VkNDFjWHhqM3RYSTJ1MWJKMENZeEc3NjUwK0I2cFozcGc2WUFubExUeXRtMDByeW1rV3FlUkMxR3ozMTVJcTB0LzdTbXJmU1d2dFAwNWs2V0NQQUF2bHErWkw1K3BTcFRsOUs2cjg4Z01lK0laU1pzUHR5cDFCU0lpdGZEL0g0QmxXejBiVkNvNmU0RGg4d2FBbUVvZzdHMlBZd2FTcW9yTVhMb3dGdEVPUVZpTEVQV2YzZE5yT1VCWENTeE5JMEJRZm55a1hkMjVFNzJhTlVHYW5XWm9yUi9IZmQzSVNiRGd5enFaaHU3ZHcveHRIZGZEVXQzbDFlVUNuczV3c1U1ZFhjZmxndlhqYlhUWFZnUW15eDc5aHQ4dFVmMzIrRStFQkhTTW5wc0gzRWVRRUdrUDhYVlVYSkRzeXVtL3BiRUxVRVpCdi9jdHlsb2o1LytSS1FseThlQmE0Y24rRHQyT0JadENUTmo2bnlKamZadk9DTXgrN0dibnhadmdKTnBHMnNZcTk5Q2tyejVrTFdiaHpHMUpMV3FUWm9oMXQrbjZIKzAzZG5uQ0sreDF1NzJzRDFwek9GWGFQOG0yRkNyRmw4NXg3M1ZmUDB1cHVwUDR2SC8zUHM0eWpZWHFOeHM1U3A2R0IxblJQazVaUnNwVFRVaUEyc0RadGhyYlcwcHllbUFhbGxYVGJzc1h1NmNRaXpFWUwyMnRvVTdOVDhpZkRBWnV6dmkwdjhXa3RWY0NsOTIrMCsrV0dzQk51dHF1SWpDdEJxenF4aFkvYkFRVHJ6UERVNzRUSlBvUU9GVFE5MWI5TGZ6KzU0Nm8vQy9PbU1lV25obDFzcTdnKzFUWmRNZDBwNXNDMTFtVDY3MytBWVRQOWhZWTNSSTVpa0RtdnNQQnV5b2o0NnBkVWxPRWZ2L3NsUXQ4T1RvSUZoYXovNmt0WjduamJDdUdvOVRQa2YreG92T2gxS1I4NkxYcG1YVlVQclZEcXdtaHAvcUg1TExGRTZoV3hXYWEyQUdYOXVTVFUxaEJwaFprRjdMMldHRFJtMExyYlZDQjNMQ2U3RGlnMlhmZ1pFVGRmL29QcDFjbXpkcy94Q1RLOTA0Q2dzK1U1cDRLSmxBTkpVR2RhZm1DMGdrQSt0UEROZDlTZTVuUjFxdVJIV3FieFRJRmFKN3lXTzh4czNrU1hWQmdNTW9HSHZHL3RIRkZnTzQ5Q2xBbi85dWsvUWZnL2ZLZ2hQNlFIeHo2RGFhRFYwdjkyV0gxcHZtSm4rREdDQ0V4ZFh2UVNWQXBHT2F3RzlGVVRzNmFSVzBLQndlNDM0L3JPbzF3dERPcUg5dW9hb0hPNEx0QjY3NTlMZUtEL0h5UGlwem04cXozNUI2SnBqdkNiWHpXK1BhSXpYWUxLeHA5ZytCZ3pyaHpRY1UrTlcvdTdGdGc5cVZLbVBWT3RnK1dHVFlTNXhETWRpa1B0RnZHSTk5bEpuZktqYm5TRUFXd2lZRDYxNnNpODhldHF3amxQaDVIVG1zbzZ4Q3JMbkZLdmNiZE5rdS9RbEt3TzVFelRveHA5MUIyV0xpakp2K01waTJPLzlJamZEYTIyT0tqRkZIeWt1dzFTdW1ja24zQ2djOGlvalZxS0FzVnd2M2tHQ2VOQ2FvSHVNanBIWjlwNXgxcVNlVEprUmlpdnZtWlhaQ2kwM1gybytHRmZYZHNFMHFZY3hlcFM2NzBsTi9ZaVNvSER5aStlaUkrVlJ2Y1MzenFxWUpUSFV0VHBvaEpGdDhheVhUcHFRa1BrNGZENU4wOVVwdW83bGVYUmowQ0pUWmh4amQvYVRtMC9hMWx5NTZ1TnZnSG1Ya1UxSUlyWVRDTFhTSDBXYW5JUzZFTjdvc3VKNkc2MjZoYlUrYlNrMjBNZGFKcmQ4ZE94NUJYdWttcmR5VjJYSmVMdndvbHdPWlN2cE8xOWhyME5HYWJSSU1HZHVQMnliREQxSnhFNjExTmdOSFhFMDhsV3ZMMFhFblhZN2VBNDhWQXl6cmoydGJRMHVRbFVjL0s0cnJKK3F5TVd3R2MzV3Y0Y1ppZmh5dTR6UzhIaEdjVTBvejdiZ25ESHFnZTdzWEtBYzVtcHdRWGpsQ2k5RkVHZStVQlBCcms3cjY3N011c0lHK25FMlJmSmZtbi8vbzNpeUhDait3YTZ1Q083QkJpMVAvNXZEa05zZjZ1bDV3TWhOcDRBcmUrQW1jTUh4Szd4cnRMZTRSbU5kL0Q5WlRZSDRQY1IrdlRuVTRRSWkxeGxSVXQ0aEVESytZZEVsa3ViNzhTeGVQNThOUE9IeXMvN285ejVTWEUyd01EZkhvelVhaFR4Wkl0YlE3aHZhZWYweE01V2daVjlKaCs4WWMyYkVMd0dmdmRHb1FXSjk0MXFCR2xzVXFnM0hKNEV4N0FMdk94OXU3UFFrOGZNR1poc1g5eTFJS3MwK3BVTmNhaTFraStMN2JneUhnTG9lTjFwaE5GZmtLOWFEMWFERGhXSk5CM1daRjhFN1VETEdEQVZQZjNGZHArd1Zjb0RIRFhTemUxbDFYUHg2WThrN04zTE8zSUZaVDhSTzhtbXFkVkcwRGtxdUFUNW5BYkg1RVhhU0dJdU1oNGdPaWlIcEJkMU83Vm5TSVZ4QXlQYjFYaytPaU10VHJNVHVOTlhvbEZWMUZZRStvZm83eWd2R0dienFRNTNETXJ4VmJSOGpNMmw4T0pubkwzNzliY1FreE55VlU1cWRUclN6aWhJOTFEeW52K1BWV1BMeDFCKzlma2FaQkN6cWtnTndWcy9LanM4MGk1aldBUEdRbC82VW1oekFLcWNOM0p1VmJ2NHg5K2FLL25JaHhZR1o5QVdMK1NHQlIya3lWUVpQNnI0TkIyTko1ZnJzYnZDNjZCZTZET01ZeERRL2RLdTQzY2JpU2xkaUpFVVY4SExpci9YVXRoaCthQXgwZ0x0T2xkcUdlTi9WcHFXMVQvQkJsTzJNeVdVeExoeVJTNm1waEZDVzFvb0UvT2tLbW5BZ0JjSDdRQ3ZqSzQvbmR6cWYxSWhFZEp2YXd4YUxLOStFTTZuZHIraEIvN0Q4L0Q2ZHN2TTFIU2g1di9oNnRhOWJWMHREU08ray9lUWFUTjBiRGU5QTJzcUFnSWRJNHk5ZU8xTytLcDBLN3gyNFJLbzhsN2pBWTBFSC94TGxnQXIzRnlRTU5iR1pmTG1sUU1SY3A3a2RvMmZFUGZFazM3NDZDdUtGcnB2NDFLcWxDS0E2S0hwUk9IS0FzZTR6SGtaT3RyaWhtSEsyNFVrTUdkWUFYWXZ3NWdjRkpzMEJ5c0FpSlRYTEtmc2lNNXJQWUsxT2lnamp4cmh6eXZyZTNVN3Z2WHB3dG1qVTdOM3lwSVZnRWNrVlFxOVhUd01LQzgxNHpmOHBsclQ0MGNYcmM4RmhJSUtjMUJmNjRQN1ZiZUlMOVBuVll3SFBEYlY1RkdQLzlUNHFISW1WZVBSS2tNMEkzcldkZnpUcHdoSEpONFFTMld6YUh1UmpIenVSbFNrS0FtNExjY1VyWXZVcitNNUw1UDdxQm02Wmt4V1NnZkhKNDdGZnViOUQweDY1eC9aQ2V3UlYyOGVzM3N1ZDhPdldBK2pmRlEyR0Z1ekE2R0I3bTZTdWdJdElUVzhsd2JKM2ZNK1dxWTBJVjNQK2RyQmNRRE85eTU0cnFMaFdOdHVDMWNXdU82RDJqcm90WEF5NUN2dUFLUUdnWWUrYjh6Y0czVVFvOHEyc3U4by9sNG1PWmhqeERRMGpleGkwRFZHT211Q0xsU1orYUFPemZJQ2ZsckZCcjB1UE9HZ2UxSU5tcUtCeXo2M2phcE9aemlMS2txUFpscHFVdnpDYVFxYWdaODdEcW9wTEpva2FVVElkTFdVZFBubEVPUHd3YU0xbDQ1bjFzc1pUVkhpSWlaN2VpSXJSdVBENXNQcThaZDR4QXUzc0NvNjdnMFdvMGJKODAveEZleHRIbXhGU0xOVG1CZjBXVlFlN3ZuYVhjQjcvd1VNRVRJVEt0bEJoQmFaNEFJQ3pMcG1YRUJyRE41aFpOSUYyM1pHd0w1dnBGa0NMejhjelgyWGFVbTZVcEU2cWZYZDA5TWt6YWJJbkJ4dUtNV3YzTXZxSnBESGdtUU56QmNOVTlJZ3lzVklERGVQaTJoMVJDdWR5am9MMUd0UzFibE1XRE5BMlhiWXFwMS9XdFJ5Zy9oTFVQR04zbFQwL0FKekszclFBbW1EeGtiNG9jSVR3OXU3eHd0RWc5aGFQQVprdlBUZzJtV3ZuRDZKMmNxclBQL0p2bUdqT2x1UHZtUVdIejhmbU1tZGQyK0thMlpWZ3Nxc1A5TjMzYnpYcEhxdUtMczlJN3N5VXhDRm41YS8yQ3JuQ1pPck5qb1pDMkU4dTZCeDJUYjJtbHQ4Nk9SU2taZXZrVCtXbW5WdGZLdlk0bG5nK01tUzI2b3NPWkNRVnZNV09xNmZNK1JJZ2U0ZXlvYkZiUkxPYzZycXJ1STZ2b0JKOVdFNVNPa2RUOW5ZN2pVQjBkd0RlU3JJSUFuS3ZaZ1lLVWZJTXI1dHc2dzc1NFc0bXlXNkRUcjFIa0NxdjAvRk8yMDJpVVZqdFpWbHBEQy9mUnBscCt1MElQZE5sejVpZlZNQmZjb08wSFFiKy9pUG0zbjJoazNQRHNpbTA0Yit1WHJ5djUzdGpmd1FVM3RzYjdpNGJINXVFNHl6QWhmbWxSTFI1WVl6L0s5RWxrSDBaVFVqQjdFdVVJUjVnSjVsb3pCVjRHbkpQeXJkMHNzd2lEaktha1IrS0NENlBlYi8zbjgwTk04TmdabnpaUnhMelY3aWZhUmlBYVBSRTNxZkZBemFwR3lmMXJ2UTFKQWRkUXdLNW5WRk9vbTRhaE53RTZOTFNxUFhHRlprY2MvdmNOSklZTlZ2OGY0eTZhQW9GSW5qOHBmbTRrcDJhMEd2dUxtRytBbGdzbWVkNVp5MGdWdjVtdWtYWG9vb1dEejRLQkdHZHFJWEUySk1ESU9Lb3NxN2huaWRzUGRNYnpvTkJUeVZhSlBVSzBBNDFXRmhJYStUMklVOTBBNzRWR1YybWZEME1oY01UV1JEYy9YU0Vsbm40TDk1SWxKVHdpWCszNDFVRXkxdXlvZXhDT0dYMS81cE1JMTd1cVpXdGwwaUIrNzZkRzIyUzRWbmhHbnl5VVd3Ym9GOVE0ZkZlRXhmSzNaQnNUK2hZUlUvdlBCZU9oSWY5eXhaRVJHL083Mmtndkw5T3ZCeHRJVzk2cGZUU3VuMDk2STJnZ0NrcTE0Y1A3VHNCa1UxMU1WZXAraXMweFZWNFdJS0d6UDBZMnp5ZDJBQWhlNGx0T0xkMExEM1ZpU0N3NlNIeXNpMmRvR0ZQZVdJdHFRYWZTdVdlaUZjTVZhZEFwRGZMamEyRkw2d0RMalRGaWthR1pOUnVzQUFHU3U3Z1R6Z2JRc09TRlNsbUVvbURRUFh1QVNQaHd5YTU4MmN3TWNNeEQycUhXV1MvaFdCYkVnV0lsc3JRcXFBekIvS080Y215aDBjdjZvTUo0MDlOb2NMdnJtTlhja2xJb3EwTmFua29VaUpnRE95K0g0ZnhmdnlXUnNXVUVyMVFhMk5FK2U0ZzIzMmN6UUlOQ2lOWkdaalY3UkFDU1JIZWJuR3hEOUdQWUVPSjZmSGNZTUw4OUxpQlVXQ3hRRHQ5Wlk4NDArWkw4WWlsd09FazdtVlkzQUxOMklIcDhWMi9FK3BUQVBranlsRWU1VDgwL1VRUjFhQlpzTUFYWG56b3ErNlhLbWJPQWs3QXUweW9iY2RqcytNc0Rmam5WMHFsclNTSmUyUTF5OVFrei9GaWkvSy9RYmI4ZjRoRlNCQzYrd1A5ZUExWlVUOXRwcDhxaC9xZ0p1R3poRnBlMkN3WkdiaUx6N1JhUm9VTVBWYVJrcU0wSHJEN2xtWElmRGMwZzgwbUsrVmdSVC8yNFY5Tm0rM0dRVzloR0d1dHI4VzVlUCttVStJOWRBczdNVFdjS2tzT3B4QzVtQUU2ZmNBUFpOVEJtQmVZL3E2c0wvQzMwYUh2Vnd6ajFzVm9VMERERWRiRGRSSkVDVDcrWU5IVkFUY1VEZkNRQUVSc3BRcitjRWJWNC9ldzJjenNMRVRGMUliUDlDRDNrTDhqa0tWNWYyZ045UWtkb04wTldvZzQ4eTZWUTNHa093MlB0dVJseFZWRS9LK0gzazdhbHB6bjVwdnV3am4wNWpEeGw1Y0lNbm9pOFY2SSt6b1JxblcxS0Z4eHcwQzlTTFU4VVcvTWg1RjRaV1RpRG55cTBRTUpUYTFRZDNRVVVjc1p5TXJuRTNNd2x6L0JhTERQdWN5WWdwU1kxVHlSZ1NTZUJPL3g5eU5ZbUppRVlnY3pKL2NxdjRyVGM4SEh0QlpjeEhSUGlTbEJWOWpBaXBMZ1ZzRW5sV0JMQkNFa3FYMmZPekF4UnJtWVhXOC9SU2t4K2dKek9TMFhObFZGK0JuV285RXMxTzlFcE5OdlA5Vm5MTG5WNWh3bTRKWERtYnR6TjhzSU5Qd1ladWtxZUVIUU04N204Y2VMbEFtdFBaRkoweDZrdWZ2VExiOGI4UWRLcUFOWEhVNW5YU0NrUnhocFVwSWh3OGhOaTR4RTRxcHNSWG9ycG1xam9DQytaVHNRZFBHN1FpMFUxMnhJRU9qRUluYit1ZG9pbDR1bWZrRnBzSFZ6Z3RhYzFPMTNXUU00WGxtTmZiS0tYa2xYa29oK3pvVk1MbnRySU1oNi9aTW01TGtBdEExVjNwcHZkWVdOYXhDMXNkYU5WMy9UMEs4VmhnY2J2MjlIM0hTcGE0cXJ4cUZyVjN2QkdaUXZ0M3B2WlVDYnd2bFVlNjBEVWVHMW40elZvanpnMnpVazlNU21ndkQ2R2IrYjExTCtLNGZQbGlJbUVtVk96akdnRlZ4M0lyaURDRnlCL0dZN0dFQzFSdWMzbEVKSlpnWDRCTkRmNVZ3aG00MDBtTzM0aVQwYmU5bk45QmZOVmc5UHdnUGZ2ZDRNWmliWS9XdUhOelEyUEdmUFpXdXdnZWgwd1R4bUpha3ZsakVSQllsNDFkazZVcDlSZFlTQXVJdFZ5dGE2RVZ0L0gvZUlYN3NHVXlTcTdOWVZzNkVucFJCU1BITkc3b1h6Tm1JSGtEM1BZMFpqREhrUEE0ZkN2alJ0T09rR2lOQXpiYUpvWXppeXBuK0k5WlNYZThIb242UDI2TkpiQmE4U2lCTnJmaXFXZVNWaUNNckQ0bGV1R1dtNG5NbTRXaTBCR3N6MzkyQUpNQ1RBakRRK1JiMkFybWF3QURsbXJIdXlUZ1pZb2NHYlEwb1pZOE5Dc3VjY1FXYXNlN0pPQmxpV1Vjb0xZVFE5cE1FeGwxR2JUeU1PUEJnaGd1eTVsN3F5R2tkZkdjYkdXZDJsWTYwV01La0llelIxcnhNSkc4N1RNWkhJa0t0dmZTR1NxZHcwRkZmL0FJN1FVK0JsVkZyVm1ESW1ONlovaEZBRHVrN2VkRXdnRVdhdXJ5VlJpbkZPRmFpUlhENnNLU0F0SFZZTXo4cVI5TDVpYnU1RTlQaHdIRW1LQzlBOVJRQWU2U0huWGZDNDJUL2dpMGlBZ0VIUXlYblpvQzF1WFVaZkI5OXJHcHh2bmdOUDZxZVlMc2h5SnkyVlY2a2ZvN2FWZVVMVE05VXoxRjNpcGhndmEvYlQxTDlQMmw1OW9lTWhXMWcvaUdMdlpDM2MvTHZmVDBDWXo3K0NzYS94ZzJkbURIN0ZZRkwwM05mYWNTQkkzdUpiL3Nwdi8wZUJwSklkQ0dYTVBybzBMN0czaFlPU3RMRSt2RGpiTStZbjRwT0Z5WjUxb2pTSm5HZlJub0FBQUFBQUEiLz48L2RlZnM+PHN0eWxlPgoubXh7dHJhbnNmb3JtLWJveDpmaWxsLWJveDt0cmFuc2Zvcm0tb3JpZ2luOjUwJSA2MCU7YW5pbWF0aW9uOm14RiAzLjZzIGVhc2UtaW4tb3V0IGluZmluaXRlfQouZ2x7YW5pbWF0aW9uOm14RyAyLjhzIGVhc2UtaW4tb3V0IGluZmluaXRlfQpAa2V5ZnJhbWVzIG14RnswJSwxMDAle3RyYW5zZm9ybTp0cmFuc2xhdGVZKDApfTUwJXt0cmFuc2Zvcm06dHJhbnNsYXRlWSgtMyUpfX0KQGtleWZyYW1lcyBteEd7MCUsMTAwJXtvcGFjaXR5Oi41NX01MCV7b3BhY2l0eToxfX0KQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7Lm14LC5nbHthbmltYXRpb246bm9uZX19PC9zdHlsZT48ZyBjbGFzcz0ibXgiPjxnIGNsYXNzPSJnbCIgZmlsdGVyPSJ1cmwoI2IpIiBvcGFjaXR5PSIuOCI+PHVzZSBocmVmPSIjbXgiLz48L2c+PHVzZSBocmVmPSIjbXgiLz48L2c+PC9zdmc+"></button>`;
  const $ = (s) => root.querySelector(s);
  let toastTimer = null;
  function toast(msg) {
    const t = $(".toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 6000);
  }

  const anchorLayer = $(".anchors");
  const anchors = new Map();
  const inlineSug = new WeakMap();
  function makeSugButton(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.abCopilot = "1";
    btn.textContent = label;
    btn.title = "Max by ReplyMaxxing. Shortcut: Cmd+Shift+S (Ctrl+Shift+S) while typing in the box";
    btn.setAttribute("style", [
      "display:inline-flex", "align-items:center", "gap:4px", "margin:0 6px", "padding:5px 12px", "border-radius:999px",
      "border:none", "background:" + GRAD, "color:#fff", "font-weight:600", "font-size:13px", "font-family:" + FONT.replace(/"/g, "'"),
      "line-height:18px", "cursor:pointer", "white-space:nowrap", "box-shadow:0 2px 8px rgba(107,80,245,.22)",
      "vertical-align:middle", "align-self:center", "flex:none",
    ].join(";"));
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (btn.dataset.busy) return;
      openPanel();
      btn.dataset.busy = "1"; btn.style.opacity = ".75"; btn.textContent = "✦ Writing...";
      try { await onClick(); } finally { delete btn.dataset.busy; btn.style.opacity = ""; btn.textContent = label; }
    });
    return btn;
  }
  function ensureInlineReplyButton(ed) {
    const form = ed.closest(".msg-form");
    const bar = form && (form.querySelector(".msg-form__left-actions") || form.querySelector(".msg-form__footer"));
    if (!bar) return false;
    let btn = inlineSug.get(bar);
    if (!btn || !btn.isConnected || btn.parentElement !== bar) {
      btn = makeSugButton("✦ Suggest reply", () => startDraft("reply", { editor: form.querySelector(EDITOR_SEL) || ed }));
      bar.appendChild(btn);
      inlineSug.set(bar, btn);
    }
    return true;
  }
  // True when another window (a chat bubble, a dialog) covers this box or the spot where its button would float.
  // True when another window (a chat bubble, a dialog) covers this box or the spot where its button would float.
  // "Inside" means the same post or chat as the box, so a comment above a reply box never counts as covering it.
  function coveredBox(box, bx, by) {
    const SEL = POST_SEL + ", " + THREAD_CONTAINERS + ', [role="dialog"]';
    let card = box.closest(SEL);
    for (let k = 0; k < 6 && card && card.parentElement && card.parentElement.closest(SEL); k++) card = card.parentElement.closest(SEL); // the whole post, not one comment
    if (!card) { card = box; for (let k = 0; k < 12 && card.parentElement && card.getBoundingClientRect().height < 400; k++) card = card.parentElement; }
    const r = box.getBoundingClientRect();
    const pts = [[bx, by], [Math.min(r.right - 12, innerWidth - 2), r.top + Math.min(10, r.height / 2)], [r.left + r.width / 2, r.top + r.height / 2]];
    return pts.some(([x, y]) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const topEl = document.elementsFromPoint(x, y).find((e) => e !== host && !host.contains(e));
      return !!topEl && !card.contains(topEl) && !topEl.contains(card);
    });
  }
  function updateAnchors() {
    const targets = [
      ...editors().filter((ed) => !ensureInlineReplyButton(ed)).map((ed) => ({ ed, mode: "reply", label: "✦ Suggest reply" })),
      ...commentEditors().map((ed) => ({ ed, mode: "comment", label: commentOf(ed) ? "✦ Suggest reply" : "✦ Suggest comment" })),
    ];
    const live = new Set(targets.map((t) => t.ed));
    for (const [ed, btn] of anchors) if (!live.has(ed)) { btn.remove(); anchors.delete(ed); }
    for (const t of targets) {
      let btn = anchors.get(t.ed);
      if (!btn) {
        btn = document.createElement("button");
        btn.className = "sug"; btn.type = "button"; btn.textContent = t.label;
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", async () => {
          if (btn.classList.contains("busy")) return;
          openPanel();
          btn.classList.add("busy"); btn.textContent = "✦ Writing...";
          try { await startDraft(t.mode, { editor: t.ed }); }
          finally { btn.classList.remove("busy"); btn.textContent = t.label; }
        });
        anchorLayer.append(btn);
        anchors.set(t.ed, btn);
      }
      const box = (t.mode === "reply" ? t.ed.closest(".msg-form") : t.ed.parentElement) || t.ed;
      const r = box.getBoundingClientRect();
      const bw = btn.offsetWidth || 130;
      const top = r.top - 30;
      const left = Math.min(Math.max(8, r.right - bw), innerWidth - bw - 8);
      const onScreen = r.bottom > 40 && top < innerHeight - 20 && r.width > 0;
      // Hide it when something else sits on top of this box, like a chat window opened over a post.
      const shown = onScreen && !coveredBox(box, left + bw / 2, Math.max(4, top) + 14);
      btn.style.display = shown ? "" : "none";
      btn.style.top = Math.max(4, top) + "px";
      btn.style.left = left + "px";
    }
  }
  let rafPending = false;
  const schedule = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; updateAnchors(); }); };
  addEventListener("scroll", schedule, { passive: true, capture: true });
  addEventListener("resize", schedule);

  // ---------- inline "Draft opener" button next to Message ----------
  const GAUGE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b50f5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/></svg>';
  // On-brand buttons: gradient fill with a soft glow (Draft opener) and gradient outline with glow (Score profile).
  const AB_GRAD = GRAD;
  const AB_LINE = "linear-gradient(90deg,#07b5d5 0%,#4e62f5 35%,#6b50f5 65%,#be28d4 100%)";
  function styleBtn(b, kind) {
    const base = ["display:inline-flex", "align-items:center", "justify-content:center", "gap:6px", "box-sizing:border-box", "height:32px", "padding:0 14px",
      "margin:0 4px", "align-self:center", "border-radius:999px", "font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", "cursor:pointer",
      "white-space:nowrap", "vertical-align:middle", "flex:none", "transition:box-shadow .2s, transform .2s, background-position .4s"];
    const glow = kind === "primary" ? "0 2px 8px rgba(107,80,245,.28)" : "0 0 10px rgba(107,80,245,.18)";
    const glowHi = kind === "primary" ? "0 6px 16px -4px rgba(107,80,245,.45)" : "0 0 14px rgba(107,80,245,.3)";
    const look = kind === "primary"
      ? ["border:0", "color:#fff", "background:" + AB_GRAD, "background-size:160% 100%", "background-position:0 0", "box-shadow:" + glow]
      : ["border:1.5px solid transparent", "color:#6b50f5", "background:linear-gradient(#fff,#fff) padding-box," + AB_LINE + " border-box", "box-shadow:" + glow];
    b.setAttribute("style", base.concat(look).join(";"));
    b.addEventListener("mouseenter", () => { b.style.transform = "translateY(-1px)"; b.style.boxShadow = glowHi; if (kind === "primary") b.style.backgroundPosition = "100% 0"; });
    b.addEventListener("mouseleave", () => { b.style.transform = ""; b.style.boxShadow = glow; if (kind === "primary") b.style.backgroundPosition = "0 0"; });
  }
  // Match LinkedIn's own buttons in the same row: same pill height, centered, same spacing.
  function fitToRow(btn, neighbor) {
    if (!btn || !neighbor || btn.dataset.fitFor === String(neighbor.getBoundingClientRect().height)) return;
    let h = 32;
    for (const e of [neighbor, ...neighbor.querySelectorAll("*")].slice(0, 12)) {
      const r = e.getBoundingClientRect(), rad = parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0;
      if (rad >= 12 && r.height >= 24 && r.height <= 44) { h = Math.round(r.height); break; }
    }
    btn.style.height = h + "px";
    const row = btn.parentElement, cs = row && getComputedStyle(row);
    const gap = cs && /flex|grid/.test(cs.display) ? parseFloat(cs.columnGap) || 0 : 0;
    btn.style.margin = gap > 0 ? "0" : "0 4px";
    btn.dataset.fitFor = String(neighbor.getBoundingClientRect().height);
  }
  // ---------- "Score my profile" button on your own profile ----------
  function profileCard() {
    const main = document.querySelector("main");
    const h1 = main && nameHeading(main);
    if (!h1) return null;
    let card = h1.closest("section") || h1.parentElement;
    for (let k = 0; k < 8 && card && card !== main; k++) {
      if (card.querySelector("button") && card.getBoundingClientRect().height > 120) break;
      card = card.parentElement;
    }
    return card && card !== main ? card : h1.closest("section");
  }
  const OWN_RE = /^(open to|add profile section|add section|enhance profile|resources)\b/i;
  function ownMarker() {
    const card = profileCard();
    if (!card) return null;
    return [...card.querySelectorAll("button, a")].filter(visible).find((b) => !b.dataset.abCopilot && (OWN_RE.test((b.innerText || "").trim()) || /^(open to|add profile section|enhance profile)/i.test(b.getAttribute("aria-label") || ""))) || null;
  }
  let scoring = false;
  async function runScore() {
    if (scoring) return;
    scoring = true; openPanel();
    const own = !!ownMarker();
    try {
      toast(own ? "Reading your profile..." : "Reading their profile...");
      const p = await readProfile();
      setStore({ abRunAnalyze: { at: Date.now(), subject: own ? "self" : "other", name: p.name, url: p.url, text: p.text, images: p.images } });
    } finally { scoring = false; }
  }

  // ---------- one "Ask Max" button on profiles, with a small menu of what Max can do here ----------
  let askBtn = null;
  // Max's face, inlined so LinkedIn pages can't probe the extension's files.
  const MAX_FACE = "data:image/webp;base64,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";
  function makeAskBtn() {
    const b = document.createElement("button");
    b.dataset.abCopilot = "1"; b.type = "button"; b.dataset.abFull = "Ask Max"; b.dataset.abShort = "Max";
    b.innerHTML = (MAX_FACE ? '<img src="' + MAX_FACE + '" alt="" width="22" height="22" style="width:24px;height:24px;flex:none;margin-left:-8px;border-radius:50%;background:#16123a;padding:1px;box-sizing:border-box">' : '<span style="font-size:13px">✦</span>')
      + '<span class="ab-lbl">Ask Max</span><svg class="ab-car" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style="flex:none"><path d="M2 3.5l3 3 3-3" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    b.title = "Max: draft an opener, score this profile and more"; b.setAttribute("aria-label", "Ask Max"); b.setAttribute("aria-haspopup", "menu");
    styleBtn(b, "primary");
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); togglePMenu(b); });
    return b;
  }
  function togglePMenu(b) {
    if (!pmenu.classList.contains("hidden")) { pmenu.classList.add("hidden"); return; }
    menu.classList.add("hidden");
    pmenu.innerHTML = "";
    const own = !!ownMarker();
    const item = (icon, label, sub, fn) => {
      const x = document.createElement("button");
      const i = document.createElement("span"); i.className = "mi"; if (icon.startsWith("<svg")) i.innerHTML = icon; else i.textContent = icon;
      const t = document.createElement("span"); t.className = "mt"; const l = document.createElement("b"); l.textContent = label; t.append(l);
      if (sub) { const s2 = document.createElement("span"); s2.textContent = sub; t.append(s2); }
      x.append(i, t); x.onclick = (ev) => { ev.stopPropagation(); pmenu.classList.add("hidden"); fn(); }; pmenu.append(x);
    };
    const first = (cleanName(document.title) || "").split(" ")[0];
    if (own) {
      item(GAUGE, "Score my profile", "See what to fix first", runScore);
      item("▭", "Make a banner", "On brand, sized for LinkedIn", () => goPanel("profile", { banner: true }));
      item("✎", "Write a post", "In your voice, toward your goal", () => goPanel("posts"));
    } else {
      if (findMessageButton()) item("✦", "Draft an opener", first ? "A first message to " + first : "A first message", () => { openPanel(); startDraft("opener"); });
      item(GAUGE, "Score their profile", "Strengths, gaps, what to ask", runScore);
    }
    const sep = document.createElement("div"); sep.className = "sep"; pmenu.append(sep);
    item("✧", "Open Max", "Chat, Radar and more", () => goPanel("draft"));
    pmenu.classList.remove("hidden");
    const r = b.getBoundingClientRect(), w = Math.max(240, pmenu.offsetWidth), h = pmenu.offsetHeight;
    const card = b.closest("section") || profileCard(), right = Math.min(innerWidth - 8, card ? card.getBoundingClientRect().right - 8 : innerWidth - 8);
    pmenu.style.left = Math.max(8, Math.min(r.left, right - w)) + "px";
    pmenu.style.top = (r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + "px";
  }

  // Crowded rows (Premium profiles add Sales Navigator, Book an appointment and more): shrink the button step by step
  // (full label, short label, icon only) so LinkedIn's own buttons never wrap.
  function setBtnMode(b, mode) {
    if (!b || b.dataset.abMode === mode) return;
    b.dataset.abMode = mode;
    const l = b.querySelector(".ab-lbl"); if (!l) return;
    l.textContent = mode === "short" ? (b.dataset.abShort || b.dataset.abFull) : b.dataset.abFull;
    l.style.display = mode === "icon" ? "none" : "";
    const car = b.querySelector(".ab-car"); if (car) car.style.display = mode === "icon" ? "none" : "";
    b.style.padding = mode === "icon" ? "0" : mode === "short" ? "0 12px" : "0 14px";
    b.style.width = mode === "icon" ? b.style.height || "32px" : "";
  }
  // Crowded = adding our button moved or wrapped one of LinkedIn's buttons, our button dropped to a new line,
  // or it runs past the profile card (or past a row that clips). Compared with our button hidden vs shown,
  // so links elsewhere in the same container (mutual connections, Contact info) never count.
  function rowCrowded(row, ours) {
    const theirs = [...row.querySelectorAll("button, a")].filter((c) => !c.dataset.abCopilot && !c.closest('[role="menu"], .artdeco-dropdown__content'));
    ours.forEach((b) => { b.style.display = "none"; });
    const before = theirs.map((c) => { const r = c.getBoundingClientRect(); return r.width && r.height ? [r.top, r.height] : null; });
    ours.forEach((b) => { b.style.display = "inline-flex"; });
    const moved = theirs.some((c, i) => { if (!before[i]) return false; const r = c.getBoundingClientRect(); return Math.abs(r.top - before[i][0]) > 4 || r.height > before[i][1] + 4; });
    if (moved) return true;
    const cs = getComputedStyle(row), clips = /hidden|clip|auto|scroll/.test(cs.overflowX);
    // The profile's top card (its section), not the button row: LinkedIn's rows often shrink-wrap their buttons.
    const card = ours[0].closest("section") || profileCard(), limit = clips || !card ? row.getBoundingClientRect().right : card.getBoundingClientRect().right - 8;
    return ours.some((b) => {
      const r = b.getBoundingClientRect(), prev = b.previousElementSibling && b.previousElementSibling.getBoundingClientRect();
      return r.right > limit + 2 || (prev && prev.height && r.top > prev.top + prev.height * 0.7);
    });
  }
  const fitKeys = new WeakMap();
  function fitRowSpace() {
    const ours = [askBtn].filter((b) => b && b.isConnected);
    if (!ours.length) return;
    const row = ours[0].parentElement; if (!row) return;
    const key = row.clientWidth + ":" + row.children.length + ":" + Math.round((profileCard() || row).getBoundingClientRect().width);
    const last = fitKeys.get(row);
    // Same layout: keep it, but retry a shrunken button now and then (fonts and LinkedIn's late buttons settle after load).
    if (last && last.key === key && (ours[0].dataset.abMode === "full" || Date.now() - last.at < 2000)) return;
    for (const mode of ["full", "short", "icon"]) {
      ours.forEach((b) => setBtnMode(b, mode));
      if (!rowCrowded(row, ours)) break;
    }
    fitKeys.set(row, { key, at: Date.now() });
  }
  // Where Score goes on someone else's profile: after Draft opener, else after Connect / Follow / Message.
  function otherAnchor() {
    const card = profileCard();
    if (!card) return null;
    const b = [...card.querySelectorAll("button, a")].filter(visible).find((x) => !x.dataset.abCopilot && /^(connect|follow|message|pending|following)$/i.test((x.innerText || "").trim()));
    if (!b) return null;
    return b.parentElement && b.parentElement.children.length === 1 ? b.parentElement : b;
  }

  // ---------- Posts: Remix button under every post, feed reading for trends, placing a post ----------
  const parseNum = (s) => { if (!s) return 0; const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*([KkMm])?/); if (!m) return 0; return Math.round(parseFloat(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1)); };
  function postStats(post) {
    const t = post.innerText || "";
    let reactions = 0;
    const others = t.match(/and ([\d.,]+[KkMm]?) others?/);
    if (others) reactions = parseNum(others[1]) + 1;
    else { const m = t.match(/([\d.,]+[KkMm]?)\s+reactions?/i); if (m) reactions = parseNum(m[1]); }
    const cm = t.match(/([\d.,]+[KkMm]?)\s+comments?/i), rp = t.match(/([\d.,]+[KkMm]?)\s+reposts?/i);
    return { reactions, comments: cm ? parseNum(cm[1]) : 0, reposts: rp ? parseNum(rp[1]) : 0 };
  }
  function postBody(post) {
    let t = (post.innerText || "").replace(/\n{3,}/g, "\n\n");
    const stops = [/\n[^\n]* and [\d.,]+[KkMm]? others?/, /\n[\d.,]+[KkMm]?\s+reactions?\b/i, /\n[\d.,]+[KkMm]?\s+comments?\b/i, /\nLike\n+Comment/];
    let cut = t.length;
    for (const re of stops) { const m = t.slice(60).match(re); if (m && m.index + 60 < cut) cut = m.index + 60; }
    t = t.slice(0, cut).replace(/^Feed post\s*/i, "").replace(/…\s*more\s*$/i, "").trim();
    const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
    const author = lines.find((l) => l.length < 60 && !/^(feed post|promoted|suggested|follow|•.*|\d+(st|nd|rd|th)|.*\b(liked|commented on|reposted|celebrates|loves|finds) this\b.*)$/i.test(l)) || "Someone";
    return { author, text: t.slice(0, 4000) };
  }
  const isRepost = (x) => /^repost$/i.test((x.innerText || "").trim());
  function feedPosts() {
    const seen = new Set(), out = [];
    queryAll("button").filter(isRepost).forEach((rb) => {
      const post = rb.closest(POST_SEL);
      if (!post || seen.has(post) || /\bPromoted\b/.test((post.innerText || "").slice(0, 400))) return;
      seen.add(post);
      const { author, text } = postBody(post);
      if (text.length < 80) return;
      const st = postStats(post);
      out.push({ author, text: text.slice(0, 900), reactions: st.reactions, comments: st.comments });
    });
    return out.slice(0, 25);
  }
  const remixRows = new WeakMap();
  function actionRowOf(rb) {
    let row = rb;
    for (let k = 0; k < 5 && row; k++) {
      row = row.parentElement;
      if (row && [...row.children].some((c) => /^comment$/i.test((c.innerText || "").trim())) && [...row.children].some((c) => /repost/i.test((c.innerText || "").trim()))) return row;
    }
    return null;
  }
  function ensureRemixButtons() {
    queryAll("button").filter((x) => !x.dataset.abCopilot && isRepost(x) && visible(x)).forEach((rb) => {
      const row = actionRowOf(rb);
      if (!row) return;
      const have = remixRows.get(row);
      if (have && have.isConnected && have.parentElement === row) return;
      const b = document.createElement("button");
      b.type = "button"; b.dataset.abCopilot = "1"; b.dataset.abRemix = "1"; b.title = "Write your own version of this post";
      b.textContent = "✦ Remix";
      b.setAttribute("style", ["display:inline-flex", "align-items:center", "flex:none", "align-self:center", "height:32px", "margin-left:4px", "padding:0 12px", "border-radius:999px", "border:none",
        "background:" + GRAD, "color:#fff", "font-weight:600", "font-size:14px", "cursor:pointer", "font-family:" + FONT.replace(/"/g, "'"), "white-space:nowrap", "box-shadow:0 2px 8px rgba(107,80,245,.22)"].join(";"));
      b.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        openPanel();
        const post = rb.closest(POST_SEL) || row.parentElement;
        const more = [...post.querySelectorAll("button, span[role='button']")].find((x) => /^(…|\.\.\.)?\s*(see )?more$/i.test((x.innerText || "").trim()));
        if (more) { more.click(); await new Promise((r) => setTimeout(r, 400)); }
        const { author, text } = postBody(post);
        const st = postStats(post);
        const stats = [st.reactions && `${st.reactions.toLocaleString()} reactions`, st.comments && `${st.comments.toLocaleString()} comments`, st.reposts && `${st.reposts.toLocaleString()} reposts`].filter(Boolean).join(" · ") || "engagement not shown";
        setStore({ abRemix: { at: Date.now(), author, text: text.slice(0, 3500), stats } });
      });
      row.append(b); remixRows.set(row, b);
    });
  }
  function postEditor() {
    return queryAll('[contenteditable="true"]').filter(visible).find((e) => {
      if (e.matches(EDITOR_SEL) || e.closest(".msg-form") || commentEditors().includes(e)) return false;
      const lab = ((e.getAttribute("aria-label") || "") + " " + (e.getAttribute("data-placeholder") || "") + " " + (e.closest(".ql-container, .share-creation-state, [role='dialog']") ? "share" : "")).toLowerCase();
      return /post|share|talk about|create content|thoughts/.test(lab);
    }) || null;
  }
  function placePost(text) {
    const ed = postEditor();
    if (!ed) return false;
    ed.focus();
    const sel = selFor(ed), range = document.createRange();
    range.selectNodeContents(ed); sel.removeAllRanges(); sel.addRange(range);
    document.execCommand("delete");
    const lines = String(text).split("\n");
    lines.forEach((line, i) => { if (line) document.execCommand("insertText", false, line); if (i < lines.length - 1) document.execCommand("insertParagraph"); });
    if (!textOf(ed).includes(lines.find(Boolean) || "")) { ed.innerHTML = lines.map((l) => "<p>" + (l ? l.replace(/&/g, "&amp;").replace(/</g, "&lt;") : "<br>") + "</p>").join(""); ed.dispatchEvent(new InputEvent("input", { bubbles: true })); }
    return true;
  }

  // ---------- layout health: tell the server (counts only) when LinkedIn's page no longer matches ----------
  const reported = new Set();
  function report(event) {
    if (reported.has(event)) return;
    reported.add(event);
    try { chrome.runtime.sendMessage({ type: "telemetry", event, lang: (document.documentElement.lang || navigator.language || "").slice(0, 5) }); } catch {}
  }
  let healthPath = "", healthTimer = null;
  function scheduleHealth() {
    if (location.pathname === healthPath) return;
    healthPath = location.pathname; clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      if (!frameActive() || document.hidden) return;
      const main = document.querySelector("main");
      if (isProfile()) {
        if (!main || !nameHeading(main)) return report("profile_no_name");
        if (!ownMarker() && !findMessageButton() && !otherAnchor()) report("profile_no_actions");
        if (document.querySelector('[aria-label="Profile photo"] img') && !profileImages().photo) report("images_not_found");
      } else if (/^\/feed\/?/.test(location.pathname)) {
        if (document.querySelectorAll('[role="listitem"], .feed-shared-update-v2').length >= 3 && !queryAll("button").some(isRepost)) report("feed_no_action_row");
      } else if (/^\/messaging\/thread\//.test(location.pathname)) {
        if (!editors().length) report("chat_no_editor");
      }
    }, 7000);
  }

  // ---------- one ✦ button: a small menu that opens the side panel where you need it ----------
  const fab = root.querySelector(".fab"), menu = root.querySelector(".menu");
  const pmenu = Object.assign(document.createElement("div"), { className: "menu pmenu hidden" }); pmenu.setAttribute("role", "menu"); root.append(pmenu);
  function goPanel(tab, extra) { openPanel(); setStore({ abOpenTab: { tab, at: Date.now(), ...(extra || {}) } }); menu.classList.add("hidden"); }
  function buildMenu() {
    menu.innerHTML = "";
    const item = (icon, label, fn) => { const b = document.createElement("button"); b.textContent = icon + "  " + label; b.onclick = fn; menu.append(b); };
    const head = (t) => { const x = document.createElement("small"); x.textContent = t; menu.append(x); };
    if (isProfile()) {
      head("This profile");
      if (!ownMarker() && findMessageButton()) item("✦", "Draft an opener", () => { menu.classList.add("hidden"); openPanel(); startDraft("opener"); });
      item("◔", ownMarker() ? "Score my profile" : "Score this profile", () => { menu.classList.add("hidden"); runScore(); });
      menu.append(Object.assign(document.createElement("div"), { className: "sep" }));
    }
    head("Max");
    item("✦", "Ask Max anything", () => goPanel("draft", { ask: true }));
    item("✎", "Write a post", () => goPanel("posts"));
    item("◎", "Radar: who to reply to", () => goPanel("radar"));
    item("◔", "My profile score", () => goPanel("profile"));
    item("▭", "Banner maker", () => goPanel("profile", { banner: true }));
    item("⚙", "Account", () => goPanel("account"));
  }
  fab.addEventListener("click", (e) => { e.stopPropagation(); if (menu.classList.contains("hidden")) { buildMenu(); menu.classList.remove("hidden"); } else menu.classList.add("hidden"); });
  document.addEventListener("click", () => { menu.classList.add("hidden"); pmenu.classList.add("hidden"); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") { menu.classList.add("hidden"); pmenu.classList.add("hidden"); } });
  addEventListener("scroll", () => pmenu.classList.add("hidden"), { passive: true });

  function tick() {
    try { tickInner(); } catch (e) { report("js_error"); }
    fab.classList.toggle("hidden", !frameActive());
  }
  function tickInner() {
    scheduleHealth();
    if (!host.isConnected && document.body) document.body.appendChild(host);
    const onProfile = isProfile();
    if (onProfile) {
      const own = ownMarker();
      const at = own || findMessageButton() || otherAnchor();
      if (at) {
        if (!askBtn) askBtn = makeAskBtn();
        let anchor = at;
        if (anchor.parentElement && anchor.parentElement.children.length === 1) anchor = anchor.parentElement;
        if (askBtn.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", askBtn);
        fitToRow(askBtn, at);
      } else if (askBtn && askBtn.isConnected) askBtn.remove();
    } else if (askBtn && askBtn.isConnected) { askBtn.remove(); pmenu.classList.add("hidden"); }
    if (onProfile) fitRowSpace();
    ensureJobButtons().catch(() => {});
    feedHiringScan().catch(() => {});
    if (frameActive()) ensureRemixButtons();
    updateAnchors();
  }


  // ---------- Job postings: read the job, plus "Tailor my resume" and "Who to contact" buttons ----------
  // Only reads the job you have open, when you click one of the buttons (or the panel asks). Nothing runs in the background.
  const jobIdOf = () => {
    const m = location.pathname.match(/^\/jobs\/view\/(\d+)/);
    if (m) return m[1];
    const q = new URLSearchParams(location.search).get("currentJobId");
    return q && /^\d+$/.test(q) ? q : "";
  };
  const isJobPage = () => /^\/jobs\//.test(location.pathname) && !!jobIdOf();
  function applyButton(root) {
    return [...(root || document).querySelectorAll("button, a")].find((b) => !b.dataset.abCopilot && visible(b) &&
      (/^(easy apply|apply|apply now|applied)$/i.test(textOf(b).split("\n")[0]) || /^(easy apply|apply)( now)? (to|for) /i.test(b.getAttribute("aria-label") || "")));
  }
  function jobDescriptionEl() {
    const byId = document.querySelector("#job-details");
    if (byId && visible(byId)) return byId;
    const h = [...document.querySelectorAll("h2, h3")].find((x) => /^about the job$/i.test(textOf(x)) && visible(x));
    if (h) { let c = h.parentElement; for (let k = 0; k < 4 && c && textOf(c).length < 300; k++) c = c.parentElement; return c; }
    return document.querySelector(".jobs-description__content, .jobs-description-content__text, .jobs-box__html-content");
  }
  function jobTopCard() {
    const ap = applyButton();
    let c = ap;
    for (let k = 0; k < 10 && c && c.parentElement; k++) { c = c.parentElement; if (c.querySelector("h1, h2") && textOf(c).length > 80) break; }
    return c || document.querySelector("main") || document.body;
  }
  function readJob() {
    const top = jobTopCard();
    const h = top.querySelector("h1") || top.querySelector("h2");
    const title = textOf(h).split("\n")[0].trim();
    const coA = [...top.querySelectorAll('a[href*="/company/"]')].find((a) => textOf(a).length > 1);
    let company = coA ? textOf(coA).split("\n")[0].trim() : "";
    const lines = textOf(top).split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 14);
    if (!company) { const i = lines.indexOf(title); company = i >= 0 && lines[i + 1] ? lines[i + 1] : ""; }
    const locLine = lines.find((l) => l !== title && l !== company && /(remote|hybrid|on-site|onsite|, [A-Z]{2}\b|area\b|united states|, [A-Z][a-z]+)/i.test(l)) || "";
    const location = locLine.split("·")[0].trim().slice(0, 120);
    const descEl = jobDescriptionEl();
    let description = textOf(descEl).replace(/^about the job\s*/i, "").replace(/\n{3,}/g, "\n\n").replace(/\s*…\s*(see )?more\s*$/i, "").trim().slice(0, 15000);
    const team = [];
    const head = [...document.querySelectorAll("h2, h3")].find((x) => /meet the hiring team|people you can reach out to/i.test(textOf(x)) && visible(x));
    if (head) {
      let box = head.parentElement; for (let k = 0; k < 4 && box && !box.querySelector('a[href*="/in/"]'); k++) box = box.parentElement;
      const seen = new Set();
      (box ? [...box.querySelectorAll('a[href*="/in/"]')] : []).forEach((a) => {
        const url = (a.href || "").split("?")[0];
        const name = textOf(a).split("\n")[0].replace(/\s*[·•].*$/, "").replace(/\s+(1st|2nd|3rd\+?)\b.*$/i, "").trim();
        if (!url || !name || name.length > 60 || seen.has(url)) return;
        seen.add(url);
        let card = a; for (let k = 0; k < 4 && card.parentElement && card.parentElement !== box && !card.parentElement.querySelector("h2, h3") && textOf(card.parentElement).length < 300; k++) card = card.parentElement;
        const t = textOf(card).split("\n").map((x) => x.trim()).filter((x) => x && !x.startsWith(name) && x !== textOf(head) && !/^(message|connect|follow|\d+(st|nd|rd|th)|·|•|job poster)$/i.test(x) && !/^[·•]/.test(x));
        team.push({ name, title: (t[0] || "").slice(0, 160), url });
      });
    }
    const id = jobIdOf();
    return { id, title, company, location, url: id ? `https://www.linkedin.com/jobs/view/${id}/` : location.href.split("#")[0], description, team: team.slice(0, 5) };
  }
  let jobRow = null, jobRowFor = "";
  async function jobSeekerUser() {
    const me = await getStore("me", null);
    const role = me && me.account && me.account.profile && me.account.profile.role;
    return !role || role === "job_seeker";
  }
  let jsCache = { at: 0, v: true };
  function makeJobRow() {
    const row = document.createElement("div");
    row.dataset.abCopilot = "1";
    row.setAttribute("style", "display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px;align-items:center");
    const go = (action) => (e) => { e.preventDefault(); e.stopPropagation(); openPanel(); const job = readJob(); if (!job.description) report("job_no_description"); setStore({ abJobRun: { at: Date.now(), action, job } }); };
    const t = document.createElement("button"); t.type = "button"; t.dataset.abCopilot = "1";
    t.innerHTML = '<span style="font-size:13px">✦</span><span>Tailor my resume</span>'; styleBtn(t, "primary"); t.title = "Max: rewrite your resume for this job";
    t.addEventListener("click", go("tailor"));
    const c = document.createElement("button"); c.type = "button"; c.dataset.abCopilot = "1";
    c.innerHTML = '<span style="font-size:13px">✦</span><span class="ab-lbl" style="background:' + AB_LINE + ';-webkit-background-clip:text;background-clip:text;color:transparent">Who to contact</span>'; styleBtn(c, "secondary"); c.title = "Max: who to reach out to about this job, and what to say";
    c.addEventListener("click", go("contacts"));
    row.append(t, c);
    return row;
  }
  async function ensureJobButtons() {
    if (!isJobPage() || !frameActive()) { if (jobRow && jobRow.isConnected) jobRow.remove(); return; }
    if (Date.now() - jsCache.at > 5000) jsCache = { at: Date.now(), v: await jobSeekerUser() };
    if (!jsCache.v) { if (jobRow && jobRow.isConnected) jobRow.remove(); return; }
    const ap = applyButton();
    if (!ap) return;
    let anchor = ap;
    for (let k = 0; k < 4 && anchor.parentElement && anchor.parentElement.querySelectorAll("button").length <= 4 && textOf(anchor.parentElement).length < 120; k++) anchor = anchor.parentElement;
    if (!jobRow) jobRow = makeJobRow();
    const id = jobIdOf();
    if (jobRow.previousElementSibling !== anchor || jobRowFor !== id) { anchor.insertAdjacentElement("afterend", jobRow); jobRowFor = id; }
  }

  // ---------- Morning hiring alerts from the feed (job seekers) ----------
  // When you open your feed, Max reads the posts already on your screen once an hour and keeps the ones that
  // mention hiring for your target role. Matching happens here in the browser; no posts are sent anywhere.
  const HIRING_RE = /\b(we('|’)re hiring|we are hiring|i('|’)m hiring|is hiring|are hiring|now hiring|#hiring|hiring for|hiring a\b|hiring an\b|join (my|our) team|open (role|roles|position|positions)|looking for (a|an) [^.\n]{0,60}(engineer|manager|designer|analyst|marketer|lead|director|recruiter|specialist|developer|scientist|writer|consultant|coordinator|associate|pm)\b|dm me if you('|’)re interested|referrals? (welcome|wanted))/i;
  const GENERIC = new Set(["and", "or", "of", "the", "a", "an", "in", "for", "to", "at", "with", "senior", "junior", "sr", "jr", "lead", "principal", "staff", "head", "manager", "associate", "remote", "level", "entry", "mid", "role", "roles", "ii", "iii"]);
  function roleWords(target) {
    const all = (target || "").toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 1);
    const strong = all.filter((w) => !GENERIC.has(w));
    return strong.length ? strong : all;
  }
  let lastFeedAlert = 0;
  // Founders, coaches and consultants, freelancers, sales and recruiters get buying signals instead of hiring posts.
  const SIGNALS = {
    rec: ["Asking for recommendations", /\b(any|anyone|can anyone|who can|does anyone|looking for)\b[^.?!\n]{0,50}\b(recommend|recommendations?|recs|suggestions?|referrals?)\b|\brecommendations? for (a|an)\b|\blooking for (a|an|good|great) [^.\n]{0,40}\b(coach|consultant|agency|freelancer|advisor|tool|vendor|partner|platform|software|service|expert|designer|developer|writer)\b/i],
    pain: ["Talking about the problem", /\b(struggling with|struggle with|frustrated (with|by)|can('|’)t figure out|biggest challenge|how do you (handle|deal with|manage)|any tips (on|for)|burn(ed|t)? out|drowning in|keeps? breaking|waste of time)\b/i],
    role: ["New in their role", /\b(starting a new (position|role)|new role as|excited to (join|announce i('|’)ve joined)|i('|’)ve joined|promoted to|first day as|i('|’)m (happy|excited|thrilled) to share that i('|’)m starting)\b/i],
    money: ["Funding or launch", /\b(raised|closed|announcing) (our|a|an)? ?(\$\s?\d|\d+(\.\d+)?\s?(m|million)|seed|series [a-e]|pre-?seed|funding round)|\bseries [a-e] (round|funding)\b|\bjust launched\b|\bwe('|’)re (now )?live\b/i],
    hiring: ["Hiring", HIRING_RE],
    otw: ["Open to work", /#opentowork|\bopen to (work|new (roles|opportunities))\b|\blooking for my next (role|opportunity|chapter)\b/i],
  };
  const SIGNALS_FOR = { founder: ["rec", "pain", "role", "money"], consultant: ["rec", "pain", "role"], freelancer: ["rec", "pain", "money"], sales: ["role", "money", "hiring", "pain"], recruiter: ["hiring", "otw", "role"], other: ["rec", "role", "money"] };
  const STOP = new Set("about above after again also always among another being below between both cannot could doing during each every from further have having into itself just make many more most much must only other over same should some such than that their them then there these they this those through under until very want what when where which while whom with would your yours help helps helping people teams team company companies business businesses work works working better best great good small large first time like more".split(" "));
  function audienceWords(p) {
    const txt = [p.titles, p.industry, p.pains, p.offer, p.jargon].filter(Boolean).join(" ").toLowerCase();
    return [...new Set(txt.split(/[^a-z0-9+#]+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => (w.length > 4 ? w.replace(/(ies|s)$/, (m) => (m === "ies" ? "y" : "")) : w)))].slice(0, 40);
  }
  const urnUrl = (post) => {
    const urnEl = post.closest("[data-urn]") || post.querySelector("[data-urn]") || post;
    const urn = (urnEl.getAttribute && (urnEl.getAttribute("data-urn") || urnEl.getAttribute("data-id"))) || "";
    return /^urn:li:activity:\d+$/.test(urn) ? `https://www.linkedin.com/feed/update/${urn}/` : "";
  };
  const snippetOf = (author, text) => {
    const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
    const start = lines.findIndex((l) => l.length > 40 && l !== author);
    return (start >= 0 ? lines.slice(start) : lines).join(" ").replace(/\s+/g, " ").slice(0, 280);
  };
  async function feedHiringScan() {
    if (!/^\/feed\/?/.test(location.pathname) || !frameActive() || window.top !== window) return;
    if (Date.now() - lastFeedAlert < 3600e3) return;
    const me = await getStore("me", null);
    const prof = me && me.account && me.account.profile;
    const seeker = !!prof && prof.role === "job_seeker";
    if (!prof || (!seeker && !SIGNALS_FOR[prof.role])) return;
    const settings = await getStore("settings", {});
    if (settings.alertsOn === false) return;
    const prev = await getStore("abFeedScanAt", 0);
    if (Date.now() - prev < 3600e3) { lastFeedAlert = prev; return; }
    lastFeedAlert = Date.now();
    await sleep(3500);
    const words = seeker ? roleWords(prof.targetRole) : audienceWords(prof);
    const kinds = seeker ? [] : SIGNALS_FOR[prof.role];
    const out = [], seenTxt = new Set();
    queryAll(POST_SEL).slice(0, 40).forEach((post) => {
      if (!visible(post) || /\bPromoted\b/.test(textOf(post).slice(0, 400))) return;
      const { author, text } = postBody(post);
      if (!text || seenTxt.has(text.slice(0, 80))) return;
      const kind = seeker ? (HIRING_RE.test(text) ? "hiring" : "") : kinds.find((k) => SIGNALS[k][1].test(text)) || "";
      if (!kind) return;
      const low = text.toLowerCase();
      const hits = words.filter((w) => low.includes(w));
      if (words.length && !hits.length) return;
      seenTxt.add(text.slice(0, 80));
      out.push({ author, snippet: snippetOf(author, text), url: urnUrl(post), match: hits.slice(0, 3), kind: seeker ? "Hiring" : SIGNALS[kind][0], source: "feed" });
    });
    await setStore({ abFeedScanAt: Date.now() });
    send({ type: "feedAlerts", posts: out.slice(0, 10) });
  }
  if (window.top === window) setTimeout(() => send({ type: "liOpen" }), 1500);

  // ---------- which frame is the one you're looking at ----------
  function frameActive() {
    try {
      if (window.top !== window) {
        // Inside an iframe. Cross-origin frames (ads, promos, embeds) hide frameElement: never show UI there.
        const fe = window.frameElement;
        if (!fe) return false;
        const cs = getComputedStyle(fe), r = fe.getBoundingClientRect();
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.5) return false;
        // Only a frame that fills most of the LinkedIn window counts (LinkedIn's full-page preload frame).
        return r.width >= window.top.innerWidth * 0.6 && r.height >= window.top.innerHeight * 0.6;
      }
      // Top frame: step aside when LinkedIn shows a full-size preload frame on top.
      for (const f of document.querySelectorAll('iframe[src*="/preload"]')) {
        const cs = getComputedStyle(f), r = f.getBoundingClientRect();
        if (cs.display !== "none" && parseFloat(cs.opacity) >= 0.5 && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) return false;
      }
    } catch { return window.top === window; }
    return true;
  }


  // ---------- pipeline ----------
  const STAGES = ["Opener", "Rapport", "Intent", "Offer", "Booked"];
  function normStage(st) {
    const s2 = (st || "").toLowerCase();
    if (/not a fit/.test(s2)) return "Not a fit";
    if (/needs/.test(s2)) return "Needs you";
    return STAGES.find((x) => s2.startsWith(x.toLowerCase())) || "Rapport";
  }
  async function savePipe(name, patch) {
    const k = nameKey(name);
    if (!k || k === "this conversation") return;
    const pipe = await getStore("abPipeline", {});
    pipe[k] = { ...(pipe[k] || {}), name, ...patch, at: Date.now() };
    await setStore({ abPipeline: pipe });
  }

  // ---------- Radar: read the inbox list on screen, only when you ask ----------
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const DAYS = ["sun","mon","tue","wed","thu","fri","sat"];
  function whenFrom(text) {
    const t = (text || "").trim().toLowerCase();
    const now = new Date();
    if (!t) return null;
    if (/\d{1,2}:\d{2}\s*(am|pm)?/.test(t) || /now|min|hour|^\d+[mh]$/.test(t)) return now.getTime();
    if (t.startsWith("yesterday")) return now.getTime() - 86400000;
    const wd = DAYS.findIndex((d) => t.startsWith(d));
    if (wd >= 0) { let diff = (now.getDay() - wd + 7) % 7; if (diff === 0) diff = 7; return now.getTime() - diff * 86400000; }
    const m = t.match(/^([a-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?/);
    if (m && MONTHS.includes(m[1])) {
      let y = m[3] ? +m[3] : now.getFullYear();
      let d = new Date(y, MONTHS.indexOf(m[1]), +m[2], 12);
      if (!m[3] && d > now) d = new Date(y - 1, MONTHS.indexOf(m[1]), +m[2], 12);
      return d.getTime();
    }
    return null;
  }
  const itemHref = (it) => {
    const a = it.querySelector('a[href*="/messaging/thread/"]') || it.querySelector('a[href*="/messaging/"]') || it.querySelector("a.msg-conversation-listitem__link") || it.closest("a[href]");
    const h = a && a.getAttribute("href");
    return h && h !== "#" ? new URL(h, location.origin).href : "";
  };
  const firstName = (k) => (k || "").split(" ")[0];
  // The inbox row for someone, matched on the full name, then first name.
  function listItemFor(name) {
    const k = nameKey(name);
    const rows = queryAll(LIST_ITEM_SEL).map((it) => { const n = it.querySelector(LIST_NAME_SEL); return { it, k: n ? nameKey(n.innerText.split("\n")[0]) : "" }; }).filter((x) => x.k);
    const hit = rows.find((x) => x.k === k) || rows.find((x) => x.k.startsWith(k) || k.startsWith(x.k)) || rows.filter((x) => firstName(x.k) === firstName(k)).find((_, i, a) => a.length === 1);
    return hit ? hit.it : null;
  }
  // LinkedIn's newer inbox rows are clickable divs with no link, so open the chat with a real click.
  function openListItem(it) {
    const target = it.querySelector(".msg-conversation-listitem__link, a, [role=\"button\"], [tabindex=\"0\"]") || it;
    target.scrollIntoView({ block: "center" });
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    target.click();
  }
  async function scanInbox() {
    if (!frameActive()) return 0;
    const list = queryAll(LIST_ITEM_SEL);
    const rows = [];
    for (const it of list) {
      const nameEl = it.querySelector(LIST_NAME_SEL);
      const snipEl = it.querySelector(".msg-conversation-card__message-snippet, .msg-conversation-card__message-snippet-body");
      const timeEl = it.querySelector(".msg-conversation-listitem__time-stamp, .msg-conversation-card__time-stamp, time");
      const name = nameEl ? nameEl.innerText.split("\n")[0].trim() : "";
      const snippet = snipEl ? snipEl.innerText.replace(/\s+/g, " ").trim() : "";
      if (!name || !snippet) continue;
      rows.push({
        name, snippet, href: itemHref(it),
        fromYou: /^you:/i.test(snippet),
        group: /,| and \d+ other/i.test(name),
        unread: !!it.querySelector('[class*="unread"]'),
        lastAt: whenFrom(timeEl ? timeEl.innerText : ""),
      });
    }
    if (!rows.length) return 0;
    const convos = await getStore("abConvos", {});
    for (const r of rows) convos[nameKey(r.name)] = { ...(convos[nameKey(r.name)] || {}), ...r, href: r.href || (convos[nameKey(r.name)] || {}).href || "", seenAt: Date.now() };
    const keys = Object.keys(convos).sort((a, b) => (convos[b].seenAt || 0) - (convos[a].seenAt || 0));
    for (const k of keys.slice(300)) delete convos[k];
    await setStore({ abConvos: convos, abScanAt: Date.now() });
    return rows.length;
  }

  // Go to someone's chat, then draft when it's open. Order: chat already open, inbox row on screen, saved link, Messaging.
  const edFor = (k) => editors().find((e) => nameKey(readThread(e).name) === k)
    || editors().find((e) => { const n = nameKey(readThread(e).name); return n && (n.startsWith(k) || k.startsWith(n) || firstName(n) === firstName(k)); });
  async function goDraft(name, opts = {}) {
    const k = nameKey(name);
    const draft = opts.draft !== false;
    const pending = { name, at: Date.now(), batch: !!opts.batch, nudge: opts.nudge || null };
    const ed = edFor(k);
    if (ed && draft) { startDraft("reply", { editor: ed, batch: opts.batch, nudge: opts.nudge }); return { ok: true, how: "open" }; }
    const it = /\/messaging\//.test(location.pathname) && listItemFor(name);
    if (it) {
      if (draft) await setStore({ abDraftOnOpen: { ...pending, clicked: true } });
      openListItem(it);
      return { ok: true, how: "click" };
    }
    const [convos, pipe] = await Promise.all([getStore("abConvos", {}), getStore("abPipeline", {})]);
    const href = (convos[k] && convos[k].href) || (pipe[k] && pipe[k].url) || "";
    const nav = (u) => setTimeout(() => { try { (window.top || window).location.href = u; } catch { location.href = u; } }, 60); // after the panel gets its answer
    if (href) {
      if (draft) await setStore({ abDraftOnOpen: pending });
      nav(href);
      return { ok: true, how: "link" };
    }
    // No link saved: open Messaging and click their row once the inbox loads.
    await setStore({ abDraftOnOpen: { ...pending, findRow: true, draft } });
    if (!/\/messaging\//.test(location.pathname)) nav("https://www.linkedin.com/messaging/");
    else return { ok: false, error: "Couldn't find " + name + " in your inbox list. Search for them in Messaging, open the chat, then click Reply again." };
    return { ok: true, how: "messaging" };
  }
  // After a navigation or click you started from the panel, draft once their chat box shows up.
  let checkingOpen = false;
  async function checkDraftOnOpen() {
    if (checkingOpen || queue || !frameActive()) return;
    const p = await getStore("abDraftOnOpen", null);
    if (!p || Date.now() - p.at > 30000) return;
    const k = nameKey(p.name);
    if (p.findRow) {
      const it = /\/messaging\//.test(location.pathname) && listItemFor(p.name);
      if (!it) return;
      checkingOpen = true;
      if (p.draft === false) { try { await chrome.storage.local.remove("abDraftOnOpen"); } catch {} }
      else await setStore({ abDraftOnOpen: { ...p, findRow: false, clicked: true, at: Date.now() } });
      openListItem(it);
      checkingOpen = false;
      return;
    }
    let ed = edFor(k);
    // Right after a click, the only open chat is theirs even when LinkedIn's header has no readable name yet.
    if (!ed && p.clicked && Date.now() - p.at > 1500) { const eds = editors().filter((e) => !e.closest(".msg-overlay-conversation-bubble")); if (eds.length === 1) ed = eds[0]; }
    if (!ed) return;
    if (readThread(ed).text.length < 20 && Date.now() - p.at < 4000) return;
    checkingOpen = true;
    try { await chrome.storage.local.remove("abDraftOnOpen"); } catch {}
    await startDraft("reply", { editor: ed, batch: p.batch, nudge: p.nudge });
    checkingOpen = false;
  }

  // ---------- saved drafts you can reopen ----------
  const SESSION_LIMIT = 30;
  async function saveSession(parsed) {
    if (!ctx || !ctx.sid) return;
    const list = await getStore("abSessions", []);
    const trimmed = ctx.messages.map((m) => ({ role: m.role, content: String(m.content).slice(0, 12000) }));
    const entry = { sid: ctx.sid, mode: ctx.mode, name: ctx.name, key: ctx.key, threadKey: ctx.threadKey || "", url: ctx.url, messages: trimmed, parsed, at: Date.now() };
    const next = [entry, ...list.filter((x) => x.sid !== ctx.sid)].slice(0, SESSION_LIMIT);
    await setStore({ abSessions: next });
  }
  async function reopenSession(sid) {
    const list = await getStore("abSessions", []);
    const sess = list.find((x) => x.sid === sid);
    if (!sess) return;
    if (queue && queue.timer) clearInterval(queue.timer);
    queue = null;
    ctx = { mode: sess.mode, name: sess.name, key: sess.key, threadKey: sess.threadKey, url: sess.url, messages: sess.messages || [], editor: null, auto: false, sid: sess.sid };
    emit({ kind: "open", name: ctx.name, mode: ctx.mode, label: modeLabel(ctx.mode), sid: ctx.sid });
    emit({ kind: "result", parsed: sess.parsed || { notes: "", lines: [], coach: null }, mode: ctx.mode, name: ctx.name, auto: false, sid: ctx.sid, savedAt: sess.at, url: sess.url });
  }

  // ---------- actions from the side panel ----------
  // Frames that shouldn't act stay silent, so the panel gets the answer from the frame you're looking at.
  const BROADCAST = new Set(["hello", "context", "readJob", "readProfile", "scan", "startOpener", "startReply", "goDraft", "goto", "reopen", "readFeed", "placePost"]);
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "act") return;
    const a = msg.action;
    if (BROADCAST.has(a)) {
      if (!frameActive()) return;
      if (a === "hello" && !lastView) return;
      if (a === "startOpener" && !isProfile()) return;
      if (a === "readProfile" && !isProfile()) return;
      if (a === "readJob" && !isJobPage()) return;
      if (a === "placePost" && !postEditor()) { if (document.querySelector('[role="dialog"] [contenteditable="true"]')) report("composer_not_found"); return; }
      if (a === "startReply" && !activeEditor()) return;
    } else if (!ctx || (msg.sid && msg.sid !== ctx.sid)) return;
    (async () => {
      if (a === "hello") { emit(lastView); return { ok: true }; }
      if (a === "readJob") return { ok: true, job: readJob() };
      if (a === "context") return { ok: true, onJob: isJobPage(), job: isJobPage() ? (() => { const j = readJob(); return { title: j.title, company: j.company, id: j.id }; })() : null, onProfile: isProfile(), own: isProfile() && !!ownMarker(), onFeed: /^\/feed\/?/.test(location.pathname), name: isProfile() ? cleanName(document.title) : "", onMessaging: /\/messaging\//.test(location.pathname), hasChat: !!activeEditor() };
      if (a === "readProfile") { const p = await readProfile(); return { ok: true, own: !!ownMarker(), name: p.name, url: p.url, text: p.text, images: p.images }; }
      if (a === "readFeed") return { ok: true, posts: /^\/feed\/?/.test(location.pathname) ? feedPosts() : [] };
      if (a === "placePost") return { ok: placePost(msg.text || "") };
      if (a === "scan") { const n = await scanInbox(); return { ok: true, n }; }
      if (a === "startOpener") { startDraft("opener"); return { ok: true }; }
      if (a === "startReply") { startDraft("reply", { editor: activeEditor() }); return { ok: true }; }
      if (a === "goDraft") return await goDraft(msg.name, { batch: msg.batch, nudge: msg.nudge, draft: msg.draft });
      if (a === "goto") { location.href = msg.url; return { ok: true }; }
      if (a === "reopen") { reopenSession(msg.sid); return { ok: true }; }
      if (a === "tweak") generate(msg.ask || "try a different angle");
      else if (a === "retry") generate();
      else if (a === "proceed") startDraft(ctx.mode, { ...(ctx.pendingOpts || {}), force: true });
      else if (a === "place") placeInBox(msg.lines || []);
      else if (a === "stop") stopQueue("Stopped.");
      else if (a === "close") { if (queue && queue.timer) clearInterval(queue.timer); queue = null; ctx = null; lastView = null; }
      return { ok: true };
    })().then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  });

  // ---------- keyboard shortcut: Cmd/Ctrl + Shift + S in any message or comment box ----------
  document.addEventListener("keydown", (e) => {
    if (!(e.shiftKey && (e.metaKey || e.ctrlKey) && (e.key || "").toLowerCase() === "s")) return;
    const t = eventTarget(e);
    if (!t || !t.closest) return;
    const msg = t.closest(EDITOR_SEL);
    const com = !msg && t.closest('[contenteditable="true"]');
    const isComment = com && (com.matches(COMMENT_SEL) || commentEditors().includes(com));
    if (!msg && !isComment) return;
    e.preventDefault(); e.stopPropagation();
    openPanel();
    startDraft(msg ? "reply" : "comment", { editor: msg || com });
  }, true);

  // Drop an opener into the chat box you opened (it may open in another frame).
  let pickingUp = false;
  async function checkPending() {
    if (pickingUp || queue) return;
    const p = await getStore("abPending", null);
    if (!p || Date.now() - p.at > 120000) return;
    if (!frameActive()) return;
    try {
      const fe = window.frameElement;
      if (fe) {
        const cs = getComputedStyle(fe), r = fe.getBoundingClientRect();
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.5 || r.width < 50 || r.height < 50) return;
      }
    } catch {}
    const ed = editors().find((e) => !textOf(e));
    if (!ed) return;
    const first = (p.name || "").split(" ")[0].toLowerCase();
    const near = (threadOf(ed).innerText || document.body.innerText || "").toLowerCase();
    if (first && !near.includes(first)) return;
    pickingUp = true;
    try { await chrome.storage.local.remove("abPending"); } catch {}
    ctx = { mode: "opener", name: p.name, key: "", url: location.href, messages: [], editor: ed, auto: false, sid: String(Date.now()) };
    emit({ kind: "open", name: ctx.name, mode: "opener", label: modeLabel("opener"), sid: ctx.sid });
    emit({ kind: "result", parsed: { notes: "", lines: p.lines, needsYou: false, coach: null }, mode: "opener", name: p.name, auto: false, sid: ctx.sid });
    startQueue(ed, p.lines);
    pickingUp = false;
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (ctx && ctx.mode === "opener" && !queue) { ctx = null; }
      if (frameActive()) { try { chrome.runtime.sendMessage({ type: "ui", view: { kind: "nav" } }).catch(() => {}); } catch {} }
    }
    tick();
    checkPending();
    checkDraftOnOpen();
  }, 700);
  tick();
})();
