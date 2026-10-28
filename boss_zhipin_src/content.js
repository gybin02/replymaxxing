// BossMaxxing Content Script: 专为 Boss直聘 (zhipin.com) 打造的 DOM 嗅探、UI 按钮注入与防封号文本填入器
// 严格遵循 “始终由你点击发送 (You press Send)” 原则，绝不自动点击发送或批量刷接口。
(() => {
  if (window.__BOSS_MAXXING_LOADED__) return;
  window.__BOSS_MAXXING_LOADED__ = true;

  const txt = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const q = (sel, root = document) => {
    for (const s of sel.split(",")) {
      const m = root.querySelector(s.trim());
      if (m) return m;
    }
    return null;
  };
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];

  // 1. 解析当前页面的岗位 JD 详情（兼容独立详情页 /job_detail/ 与左右分栏列表页 /web/geek/job）
  function readJobFromPage() {
    const title = txt(
      q(".info-primary .name h1, .job-header-info .job-name, .job-detail-header .name, .job-detail-box .job-name, .position-head .name, h1")
    );
    const salary = txt(q(".info-primary .salary, .job-header-info .salary, .job-detail-header .salary, .job-detail-box .salary"));
    const company = txt(
      q(".sider-company .company-info a[ka*='company'], .company-info-box .company-name, .job-detail-company .company-name, .boss-info-attr")
    );
    const bossName = txt(q(".job-boss-info .name, .boss-info-top .name, .detail-figure + .name, .boss-name"));
    const bossTitle = txt(q(".job-boss-info .boss-title, .boss-info-attr, .boss-online-tag"));
    const tags = qa(".tag-list li, .job-tags span, .info-primary p span")
      .map((e) => txt(e))
      .filter(Boolean)
      .slice(0, 12);
    const descEl = q(".job-sec-text, .job-detail-section .job-sec-text, .job-detail-body .text, .job-sec .text, .job-detail-content");
    const description = descEl ? (descEl.innerText || "").trim() : "";

    return {
      ok: Boolean(title || description),
      title: title.replace(/\s+/g, " "),
      salary,
      company,
      bossName: bossName.split(/\s+/)[0] || "招聘负责人",
      bossTitle,
      tags,
      description,
      url: location.href,
    };
  }

  // 2. 解析当前聊天沟通窗口（兼容牛人端 /web/geek/chat 与 Boss端 /web/chat）
  function readChatFromPage() {
    const bossName = txt(q(".chat-user .name, .user-info .name, .chat-header .name, .geek-name, .figure-info .name")) || "对方";
    const jobTitle = txt(q(".chat-position .position-name, .position-main .position-name, .chat-header .position-name, .user-info p"));
    const msgNodes = qa(".chat-message .message-item, .message-list li, .im-list li, .chat-conversation .item");
    const messages = [];

    msgNodes.slice(-16).forEach((node) => {
      const isMe =
        node.classList.contains("item-myself") ||
        node.classList.contains("mine") ||
        Boolean(node.querySelector(".item-myself, .message-myself"));
      const body = txt(q(".text, .message-text, .msg-text, p", node));
      if (body) {
        messages.push({
          from: isMe ? "我" : bossName,
          text: body,
        });
      }
    });

    return {
      ok: Boolean(findChatEditor() || messages.length),
      bossName,
      jobTitle,
      messages,
      url: location.href,
    };
  }

  // 3. 定位 Boss直聘聊天输入框
  function findChatEditor() {
    return q(
      "#chat-input, .chat-input[contenteditable='true'], .chat-editor [contenteditable='true'], .chat-controls [contenteditable='true'], .chat-editor textarea, .chat-controls textarea"
    );
  }

  // 4. 安全填入聊天输入框（模拟真实键盘输入，绝不自动点击发送按钮）
  function placeTextInBossInput(text) {
    const ed = findChatEditor();
    if (!ed) {
      return {
        ok: false,
        error: "未找到当前页面的聊天输入框。请先进入 Boss直聘「沟通」聊天窗口，或复制上方话术手动粘贴。",
      };
    }
    ed.focus();
    const clean = String(text || "").trim();

    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(ed, clean);
      else ed.value = clean;
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      ed.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }

    // ContentEditable DIV (Boss直聘 Web 聊天框默认采用 contenteditable div)
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand("insertText", false, clean)) {
        ed.innerText = clean;
      }
    } catch {
      ed.innerText = clean;
    }
    ed.dispatchEvent(new InputEvent("input", { bubbles: true, data: clean, inputType: "insertText" }));
    ed.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  // 5. 注入页面快捷按钮与轻量样式
  function injectStyles() {
    if (document.getElementById("bm-injected-style")) return;
    const st = document.createElement("style");
    st.id = "bm-injected-style";
    st.textContent = `
      .bm-inline-bar {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-left: 10px;
        vertical-align: middle;
      }
      .bm-pill-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 7px 13px;
        border-radius: 8px;
        border: 1px solid rgba(0, 190, 189, 0.35);
        background: linear-gradient(135deg, #00bebd 0%, #009c9b 100%);
        color: #ffffff !important;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 190, 189, 0.28);
        transition: transform 0.15s ease, opacity 0.15s ease;
        text-decoration: none !important;
      }
      .bm-pill-btn:hover {
        transform: translateY(-1px);
        opacity: 0.95;
      }
      .bm-pill-btn.ghost {
        background: #f0fafa;
        color: #008b8a !important;
        box-shadow: none;
      }
      .bm-chat-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: linear-gradient(90deg, #f0fafa 0%, #f5f3ff 100%);
        border-top: 1px solid #e2e8f0;
        border-bottom: 1px solid #e2e8f0;
        font-size: 12px;
      }
      .bm-fab {
        position: fixed;
        right: 18px;
        bottom: 84px;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 15px;
        border-radius: 999px;
        background: linear-gradient(135deg, #00bebd 0%, #4e62f5 100%);
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 190, 189, 0.38);
        border: none;
      }
    `;
    document.head.appendChild(st);
  }

  function triggerAction(action, extra = {}) {
    const job = readJobFromPage();
    const chat = readChatFromPage();
    chrome.storage.local.set({
      bmPendingAction: {
        action,
        job,
        chat,
        ...extra,
        at: Date.now(),
      },
    });
    chrome.runtime.sendMessage({ type: "openPanel" }).catch(() => {});
  }

  function decoratePage() {
    injectStyles();

    // 常驻右下角悬浮按钮
    if (!document.getElementById("bm-fab-btn")) {
      const fab = document.createElement("button");
      fab.id = "bm-fab-btn";
      fab.className = "bm-fab";
      fab.innerHTML = "✦ Boss AI 僚机";
      fab.title = "打开 BossMaxxing 侧边栏 (Alt+Shift+B)";
      fab.onclick = () => triggerAction("sync");
      document.body.appendChild(fab);
    }

    // 岗位详情页 / 分栏详情区「立即沟通」按钮旁注入
    const startChatBtn = q(".btn-startchat, .op-btn-chat");
    if (startChatBtn && startChatBtn.parentElement && !startChatBtn.parentElement.querySelector(".bm-inline-bar")) {
      const bar = document.createElement("span");
      bar.className = "bm-inline-bar";

      const bOpener = document.createElement("button");
      bOpener.type = "button";
      bOpener.className = "bm-pill-btn";
      bOpener.textContent = "✦ AI 定制打招呼";
      bOpener.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerAction("opener");
      };

      const bTailor = document.createElement("button");
      bTailor.type = "button";
      bTailor.className = "bm-pill-btn ghost";
      bTailor.textContent = "✦ 按此JD改简历";
      bTailor.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerAction("tailor");
      };

      bar.append(bOpener, bTailor);
      startChatBtn.after(bar);
    }

    // 聊天窗口输入框上方注入快捷栏
    const chatEditor = findChatEditor();
    if (chatEditor && chatEditor.parentElement && !document.getElementById("bm-chat-bar")) {
      const bar = document.createElement("div");
      bar.id = "bm-chat-bar";
      bar.className = "bm-chat-toolbar";

      const makeBtn = (label, act, ghost = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bm-pill-btn" + (ghost ? " ghost" : "");
        b.style.padding = "4px 10px";
        b.style.fontSize = "12px";
        b.textContent = label;
        b.onclick = (e) => {
          e.preventDefault();
          triggerAction(act);
        };
        return b;
      };

      bar.append(
        makeBtn("✦ AI 帮我回", "reply"),
        makeBtn("✦ 破冰开场白", "opener", true),
        makeBtn("✦ 发简历话术", "reply_resume", true),
        makeBtn("✦ 谈薪/排雷应答", "reply_salary", true)
      );
      chatEditor.parentElement.prepend(bar);
    }
  }

  // 监听来自侧边栏的页面读取与文本填入请求
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "pageCmd") return;
    if (msg.cmd === "getContext") {
      sendResponse({
        ok: true,
        url: location.href,
        isChat: /\/chat/.test(location.pathname),
        job: readJobFromPage(),
        chat: readChatFromPage(),
      });
      return;
    }
    if (msg.cmd === "placeText") {
      sendResponse(placeTextInBossInput(msg.text));
      return;
    }
  });

  // 定时巡检 SPA 路由切换与动态 DOM 渲染
  decoratePage();
  const obs = new MutationObserver(() => decoratePage());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
