// BossMaxxing 侧边栏主操作台逻辑 (专为 Boss直聘 定制)
const view = document.getElementById("view");
const PB = self.AB_PLAYBOOK;

const S = {
  tab: "draft",
  me: null,
  ctx: null, // { url, isChat, job, chat }
  draft: null, // { mode, messages, parsed, loading, error }
  tailorBusy: false,
  lastTailor: null,
  resumeScore: null,
};

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, cls, onclick) => {
  const b = el("button", cls, label);
  b.type = "button";
  if (onclick) b.onclick = onclick;
  return b;
};
const bg = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false })));
const store = (k, def) => new Promise((res) => chrome.storage.local.get(k, (x) => res(x[k] !== undefined ? x[k] : def)));
const setStore = (obj) => new Promise((res) => chrome.storage.local.set(obj, res));

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

async function pageCmd(cmd, extra = {}) {
  const t = await activeTab();
  if (!t || !t.id || !/zhipin\.com/.test(t.url || "")) {
    return { ok: false, notBoss: true };
  }
  return new Promise((res) => {
    chrome.tabs.sendMessage(t.id, { type: "pageCmd", cmd, ...extra }, (r) => {
      void chrome.runtime.lastError;
      res(r || { ok: false });
    });
  });
}

async function syncPageContext() {
  const r = await pageCmd("getContext");
  if (r && r.ok) S.ctx = r;
  return S.ctx;
}

function parseDraftOutput(raw, mode) {
  const text = String(raw || "").replace(/\r/g, "");
  const header = mode === "reply" ? "REPLY" : "OPENER";
  const re = new RegExp("^\\s*[#*]*\\s*" + header + "\\s*[*:]*\\s*$", "im");
  const parts = text.split(re);
  const notes = parts.length >= 2 ? parts[0].replace(/^\s*NOTE\s*:?\s*$/gim, "").trim() : "";
  const body = parts.length >= 2 ? parts.slice(1).join("\n") : text;

  const field = (k) => {
    const m = notes.match(new RegExp("^\\s*" + k + "\\s*[:：]\\s*(.+)$", "im"));
    return m ? m[1].trim() : "";
  };

  const lines = body
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*>]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);

  return {
    notes,
    lines,
    coach:
      mode === "reply"
        ? {
            stage: field("STAGE") || "发简历与亮优势",
            where: field("WHERE"),
            next: field("NEXT"),
          }
        : null,
  };
}

function renderFoot() {
  const foot = document.getElementById("foot");
  const u = S.me && S.me.account && S.me.account.usage;
  if (!u) {
    foot.classList.add("hidden");
    return;
  }
  foot.classList.remove("hidden");
  const sv = document.getElementById("savedText");
  if (sv) sv.textContent = u.minutesSaved ? `⏱ 已累计为您节省约 ${u.minutesSaved} 分钟求职沟通时间` : "";
  const used = u.drafts || 0;
  const limit = u.draftLimit || 2000;
  document.getElementById("meterText").textContent = `当前套餐：${S.me.account.planName || "Autopilot"} · 已用 ${used} / ${limit} 点数`;
  document.getElementById("meterBar").style.width = Math.min(100, Math.round((used / Math.max(1, limit)) * 100)) + "%";
}

function renderSignIn() {
  view.innerHTML = "";
  const card = el("div", "card");
  card.append(
    el("div", "ab-eye", "BossMaxxing 登录"),
    el("h2", "", "开启 Boss直聘 AI 求职僚机"),
    el("p", "muted small", "本地/自托管模式支持一键免密体验（默认验证码 123456），自动解锁 Autopilot 2,000 点额度。")
  );

  const emailInp = el("input");
  emailInp.type = "email";
  emailInp.placeholder = "输入邮箱（如 user@boss.local）";
  emailInp.value = "geek@bossmaxxing.local";

  const codeInp = el("input");
  codeInp.type = "text";
  codeInp.placeholder = "6 位验证码（默认 123456）";
  codeInp.value = "123456";

  const msg = el("div", "err");
  const quickBtn = btn("✦ 一键登录并进入工作台", "ab-btn", async () => {
    quickBtn.disabled = true;
    msg.textContent = "";
    const email = emailInp.value.trim() || "geek@bossmaxxing.local";
    const code = codeInp.value.trim() || "123456";
    await bg({ type: "authStart", email });
    const r = await bg({ type: "authVerify", email, code });
    quickBtn.disabled = false;
    if (!r.ok) {
      msg.textContent = r.error || "登录失败，请检查本地 Worker 是否已启动 (npm run dev)";
      return;
    }
    S.me = r.me;
    render();
  });

  card.append(
    el("div", "label", "邮箱账号"),
    emailInp,
    el("div", "label", "验证码"),
    codeInp,
    quickBtn,
    msg
  );
  view.append(card);
}

function renderContextBanner() {
  const b = el("div", "ctx-banner");
  const left = el("div", "");
  const job = S.ctx && S.ctx.job && S.ctx.job.ok ? S.ctx.job : null;
  const chat = S.ctx && S.ctx.chat && S.ctx.chat.ok ? S.ctx.chat : null;

  if (S.ctx && S.ctx.isChat && chat) {
    left.append(
      el("b", "", `💬 正在沟通：${chat.bossName}${chat.jobTitle ? " · " + chat.jobTitle : ""}`),
      el("span", "muted", `已读取最近 ${chat.messages.length} 条对话消息`)
    );
  } else if (job) {
    left.append(
      el("b", "", `📌 当前岗位：${job.title || "未命名岗位"} ${job.salary ? "(" + job.salary + ")" : ""}`),
      el("span", "muted", `${job.company || "目标公司"} · ${job.bossName || "招聘负责人"}`)
    );
  } else {
    left.append(
      el("b", "", "💡 尚未检测到 Boss直聘岗位或聊天窗"),
      el("span", "muted", "请打开 zhipin.com 任意岗位或聊天页，或在下方手动粘贴 JD")
    );
  }

  b.append(left);
  return b;
}

async function runGenerateDraft(mode, customPrompt = "", tweak = "") {
  const p = (S.me && S.me.account && S.me.account.profile) || {};
  const job = (S.ctx && S.ctx.job) || {};
  const chat = (S.ctx && S.ctx.chat) || {};

  if (!tweak || !S.draft || !S.draft.messages) {
    let content = customPrompt;
    if (!content) {
      if (mode === "reply") {
        const hist = (chat.messages || []).map((m) => `${m.from}: ${m.text}`).join("\n");
        content = [
          `请帮我回复 Boss直聘 上的「${chat.bossName || job.bossName || "招聘方"}」（沟通岗位：${chat.jobTitle || job.title || p.targetRole || "目标岗位"}）。`,
          hist ? `【近期聊天记录】：\n${hist}` : "对方刚刚发起沟通或查看了我的简历，请写一段高情商推进回复。",
          p.targetRole ? `【我的求职方向】：${p.targetRole}` : "",
          p.proof ? `【我的核心量化成果】：${p.proof}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      } else {
        content = [
          `请为我在 Boss直聘 上给「${job.company || ""} ${job.bossName || "Boss"}」写一段黄金前30字破冰打招呼语（Opener）。`,
          `【应聘岗位】：${job.title || p.targetRole || "目标岗位"} ${job.salary || ""}`,
          job.description ? `【岗位职责 JD】：\n${job.description.slice(0, 1200)}` : "",
          p.targetRole ? `【我的目标岗位】：${p.targetRole}` : "",
          p.proof ? `【我的核心量化成果】：${p.proof}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      }
    }
    S.draft = { mode, messages: [{ role: "user", content }], loading: true, error: "" };
  } else {
    S.draft.messages.push({
      role: "user",
      content: `请按以下要求修改上一版话术，并严格保持相同的输出格式（包含 ${mode === "reply" ? "STAGE/WHERE/NEXT 和 REPLY" : "NOTE 和 OPENER"}）：${tweak}`,
    });
    S.draft.loading = true;
    S.draft.error = "";
  }

  render();
  const r = await bg({ type: "draft", mode: S.draft.mode, messages: S.draft.messages });
  S.draft.loading = false;

  if (!r.ok) {
    S.draft.error = r.error || "生成失败，请重试";
    render();
    return;
  }

  S.draft.messages.push({ role: "assistant", content: r.text });
  S.draft.parsed = parseDraftOutput(r.text, S.draft.mode);
  if (r.usage && S.me && S.me.account) S.me.account.usage = r.usage;

  // 记录到跟进雷达
  const targetTitle = (job && job.title) || (chat && chat.jobTitle) || p.targetRole || "Boss直聘岗位";
  const targetBoss = (chat && chat.bossName) || (job && job.bossName) || "Boss";
  await bg({
    type: "record",
    entry: {
      key: `${targetBoss}:${targetTitle}`,
      bossName: targetBoss,
      company: (job && job.company) || "",
      jobTitle: targetTitle,
      mode: S.draft.mode,
      lines: S.draft.parsed.lines,
      stage: (S.draft.parsed.coach && S.draft.parsed.coach.stage) || (S.draft.mode === "opener" ? "破冰打招呼" : "沟通推进"),
      url: (S.ctx && S.ctx.url) || "https://www.zhipin.com/web/geek/chat",
    },
  });

  render();
}

function renderDraftTab() {
  view.append(renderContextBanner());

  const actCard = el("div", "card");
  actCard.append(el("div", "label", "✦ 一键 AI 助写（始终由你点击发送）"));

  const row = el("div", "row");
  row.append(
    btn("✦ 生成破冰打招呼语", "ab-btn", () => runGenerateDraft("opener")),
    btn("💬 帮我高情商回复", "ab-btn ghost", () => runGenerateDraft("reply"))
  );
  actCard.append(row);

  const manual = el("details", "more");
  manual.append(el("summary", "", "或者手动粘贴岗位 JD / 聊天记录生成"));
  const ta = el("textarea");
  ta.rows = 3;
  ta.placeholder = "粘贴 Boss直聘岗位职责 JD 或对方发来的消息（如：你为什么从上一家离职？目前薪资多少？）";
  const mRow = el("div", "row");
  mRow.append(
    btn("生成破冰语", "ab-btn sm", () => {
      if (ta.value.trim()) runGenerateDraft("opener", `根据以下岗位信息写一段Boss直聘破冰打招呼语：\n${ta.value.trim()}`);
    }),
    btn("生成回复话术", "ab-btn ghost sm", () => {
      if (ta.value.trim()) runGenerateDraft("reply", `对方在Boss直聘发来以下消息，请帮我高情商回复：\n${ta.value.trim()}`);
    })
  );
  manual.append(ta, mRow);
  actCard.append(manual);
  view.append(actCard);

  if (!S.draft) return;

  const resCard = el("div", "card");
  if (S.draft.loading) {
    const sp = el("div", "spin");
    sp.append(el("i"), el("span", "", "Max 正在结合岗位痛点与你的个人优势撰写话术..."));
    resCard.append(sp);
    view.append(resCard);
    return;
  }
  if (S.draft.error) {
    resCard.append(el("div", "err", S.draft.error));
    view.append(resCard);
    return;
  }

  const parsed = S.draft.parsed;
  if (!parsed) return;

  // 如果是回复模式，展示 5 阶段进度条与下一步建议
  if (parsed.coach) {
    const cBox = el("div", "card soft");
    cBox.append(el("div", "label", `当前沟通阶段：${parsed.coach.stage}`));
    if (parsed.coach.where) {
      const w = el("div", "cbox");
      w.append(el("small", "", "对方意图诊断"), el("div", "", parsed.coach.where));
      cBox.append(w);
    }
    if (parsed.coach.next) {
      const n = el("div", "cbox next");
      n.append(el("small", "", "建议下一步动作"), el("div", "", parsed.coach.next));
      cBox.append(n);
    }
    resCard.append(cBox);
  } else if (parsed.notes) {
    resCard.append(el("p", "muted small", "💡 策略解析：" + parsed.notes));
  }

  resCard.append(el("div", "label", S.draft.mode === "reply" ? "建议回复话术（可直接编辑）" : "定制破冰打招呼语（可直接编辑）"));
  const linesWrap = el("div", "lines");
  parsed.lines.forEach((line, i) => {
    const r = el("div", "ln");
    r.append(el("div", "n", String(i + 1)));
    const lta = el("textarea");
    lta.rows = 3;
    lta.value = line;
    r.append(lta);
    linesWrap.append(r);
  });
  resCard.append(linesWrap);

  const currentText = () =>
    [...linesWrap.querySelectorAll("textarea")]
      .map((t) => t.value.trim())
      .filter(Boolean)
      .join("\n");

  const statusMsg = el("div", "small");
  const actionRow = el("div", "row");
  actionRow.append(
    btn("填入 Boss 聊天框", "ab-btn", async () => {
      const r = await pageCmd("placeText", { text: currentText() });
      statusMsg.className = r.ok ? "q live" : "err";
      statusMsg.textContent = r.ok
        ? "✓ 已安全填入 Boss直聘聊天输入框！请核对后由您亲自点击「发送」。"
        : r.error || "当前页面没有聊天输入框，已为您复制到剪贴板，请直接粘贴。";
      if (!r.ok) {
        try {
          await navigator.clipboard.writeText(currentText());
        } catch {}
      }
    }),
    btn("复制全文", "ab-btn ghost", async (e) => {
      try {
        await navigator.clipboard.writeText(currentText());
        e.currentTarget.textContent = "已复制 ✓";
        setTimeout(() => (e.currentTarget.textContent = "复制全文"), 1500);
      } catch {}
    })
  );
  resCard.append(actionRow, statusMsg);

  // 快捷微调芯片
  resCard.append(el("div", "label", "一键微调语气与侧重点"));
  const chips = el("div", "chips");
  const tweaks = S.draft.mode === "reply" ? PB.QUICK_TWEAKS.reply : PB.QUICK_TWEAKS.opener;
  tweaks.forEach(([label, ask]) => {
    chips.append(btn(label, "chip", () => runGenerateDraft(S.draft.mode, "", ask)));
  });
  resCard.append(chips);

  view.append(resCard);
}

async function renderResumeTab() {
  view.append(renderContextBanner());

  const savedResume = await store("bmBaseResume", "");
  const card = el("div", "card");
  card.append(
    el("div", "label", "📄 我的基础简历文本"),
    el("p", "muted small", "保存在您的浏览器本地，用于针对不同 Boss直聘岗位 JD 自动计算匹配度与定制改写。")
  );
  const rTa = el("textarea");
  rTa.rows = 6;
  rTa.placeholder = "在此粘贴您的完整简历内容（个人优势、工作经历、项目经历、教育背景）...";
  rTa.value = savedResume;

  const saveMsg = el("span", "muted small");
  const rRow = el("div", "row");
  rRow.append(
    btn("保存基础简历", "ab-btn ghost sm", async () => {
      await setStore({ bmBaseResume: rTa.value.trim() });
      saveMsg.textContent = "✓ 已保存在本地";
      setTimeout(() => (saveMsg.textContent = ""), 2000);
    }),
    btn("✦ AI 简历诊断打分", "ab-btn ghost sm", async (e) => {
      const text = rTa.value.trim();
      if (text.length < 30) {
        saveMsg.textContent = "请先粘贴至少 30 字的简历内容";
        return;
      }
      await setStore({ bmBaseResume: text });
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = "诊断中...";
      const target = (S.ctx && S.ctx.job && S.ctx.job.title) || (S.me && S.me.account && S.me.account.profile && S.me.account.profile.targetRole) || "目标岗位";
      const r = await bg({ type: "resumeScore", resume: text, target });
      e.currentTarget.disabled = false;
      e.currentTarget.textContent = "✦ AI 简历诊断打分";
      if (r.ok) {
        S.resumeScore = r;
        render();
      }
    }),
    saveMsg
  );
  card.append(rTa, rRow);
  view.append(card);

  // 针对当前岗位 JD 一键定制改写简历
  const tailorCard = el("div", "card hi");
  const curJob = (S.ctx && S.ctx.job && S.ctx.job.ok && S.ctx.job) || null;
  tailorCard.append(
    el("div", "label", "✦ 按 Boss直聘岗位 JD 一键定制简历 (STAR + XYZ 法则)"),
    el(
      "p",
      "small",
      curJob
        ? `当前目标岗位：【${curJob.company || "目标公司"} · ${curJob.title}】`
        : "可在下方粘贴目标岗位 JD，一键重构个人优势与项目经历 Bullet，导出单栏 PDF 或 Word 简历。"
    )
  );

  const jdTa = el("textarea");
  jdTa.rows = 4;
  jdTa.placeholder = "自动读取当前页面岗位 JD，也可在此手动粘贴岗位职责与要求...";
  jdTa.value = (curJob && curJob.description) || "";

  const goTailor = btn(S.tailorBusy ? "正在按 STAR/XYZ 法则重构简历..." : "✦ 立即按此 JD 定制简历", "ab-btn", async () => {
    const resumeText = rTa.value.trim() || "资深专业人士，具备核心业务研发与落地经验。";
    const jdText = jdTa.value.trim() || (curJob && curJob.description) || "核心岗位职责与高并发/业务增长要求";
    await setStore({ bmBaseResume: resumeText });
    S.tailorBusy = true;
    render();

    const jobObj = {
      title: (curJob && curJob.title) || (S.me?.account?.profile?.targetRole) || "目标岗位",
      company: (curJob && curJob.company) || "目标公司",
      location: (curJob && curJob.tags && curJob.tags[0]) || "一线城市",
      description: jdText,
    };
    const key = "bossjob:" + (jobObj.company + ":" + jobObj.title).toLowerCase();
    const r = await bg({ type: "resumeTailor", resume: resumeText, job: jobObj, jobKey: key });
    S.tailorBusy = false;

    if (r.ok) {
      const all = await store("abJobs", {});
      const entry = all[key] || {
        key,
        title: jobObj.title,
        company: jobObj.company,
        location: jobObj.location,
        description: jdText,
        versions: [],
      };
      entry.at = Date.now();
      entry.versions.push({
        at: Date.now(),
        resume: r.resume,
        match: r.match,
        fillIns: r.fillIns,
        gaps: r.gaps,
        changes: r.changes,
      });
      all[key] = entry;
      await setStore({ abJobs: all });
      S.lastTailor = { key, job: jobObj, out: r };
    }
    render();
  });
  goTailor.disabled = S.tailorBusy;
  tailorCard.append(jdTa, goTailor);
  view.append(tailorCard);

  if (S.lastTailor) {
    const { key, job, out } = S.lastTailor;
    const res = el("div", "card");
    res.append(el("div", "label", `✓ 已完成「${job.company} · ${job.title}」简历定制`));
    if (out.match) {
      res.append(el("p", "", `📊 JD 匹配度提升：${out.match.before}% → ${out.match.after}%`));
      if (out.match.keywordsAdded && out.match.keywordsAdded.length) {
        res.append(el("p", "small muted", "已植入核心关键词：" + out.match.keywordsAdded.join("、")));
      }
    }
    if (out.fillIns && out.fillIns.length) {
      res.append(el("p", "warnline small", `⚠️ 有 ${out.fillIns.length} 处量化占位符（如 ${out.fillIns.join("、")}）待填入您的真实业务数字。`));
    }
    res.append(
      btn("打开在线简历编辑器（导出 PDF / Word） →", "ab-btn", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("resume.html?key=" + encodeURIComponent(key)) });
      })
    );
    view.append(res);
  }

  if (S.resumeScore) {
    const sc = S.resumeScore;
    const scCard = el("div", "card");
    scCard.append(
      el("div", "label", `简历竞争力评分：${sc.score} / 100 · ${sc.grade}`),
      el("p", "small", sc.summary || "")
    );
    if (sc.topFixes && sc.topFixes.length) {
      const ol = el("ol", "small");
      sc.topFixes.forEach((f) => ol.append(el("li", "", f)));
      scCard.append(el("div", "label", "优先改进项"), ol);
    }
    view.append(scCard);
  }
}

async function renderRadarTab() {
  const history = await store("bossHistory", []);
  const card = el("div", "card");
  card.append(
    el("div", "label", "📡 Boss 沟通与跟进雷达"),
    el("p", "muted small", "自动记录您生成过破冰语或回复的 Boss。针对「已读不回」或「发完简历没动静」的岗位，可一键生成不尴尬的二次激活话术。")
  );

  if (!history.length) {
    card.append(el("p", "muted", "暂无沟通记录。去「沟通破冰」生成第一条打招呼语吧！"));
    view.append(card);
    return;
  }

  history.forEach((item) => {
    const row = el("div", "rrow");
    const main = el("div", "rmain");
    main.append(
      el("div", "rname", `${item.bossName || "Boss"} · ${item.jobTitle || "目标岗位"}`),
      el("div", "rsub wrap", `[${item.stage || "已破冰"}] ${(item.lines && item.lines[0]) || ""}`)
    );
    row.append(
      main,
      btn("二次跟进", "act", () => {
        S.tab = "draft";
        runGenerateDraft(
          "reply",
          `我在 Boss直聘 投递了「${item.company || ""} ${item.jobTitle}」（负责人：${item.bossName}），之前发了打招呼或简历但对方暂时已读未回。请帮我写一段不卑不亢、补充核心业务亮点的二次跟进话术。`
        );
      })
    );
    card.append(row);
  });

  view.append(card);
}

async function renderSetupTab() {
  const p = {
    role: "job_seeker",
    name: "",
    targetRole: "",
    proof: "",
    ...((S.me && S.me.account && S.me.account.profile) || {}),
  };

  const card = el("div", "card");
  card.append(el("div", "label", "👤 我的身份与核心竞争力设置"));

  const roleSeg = el("div", "seg");
  [
    ["job_seeker", "求职者（牛人端）"],
    ["recruiter", "招聘方（Boss/HR/猎头）"],
  ].forEach(([val, label]) => {
    roleSeg.append(
      btn(label, p.role === val ? "on" : "", () => {
        p.role = val;
        S.me.account.profile = p;
        render();
      })
    );
  });
  card.append(el("div", "label", "使用身份"), roleSeg);

  const f = (label, key, ph, isTa = false) => {
    card.append(el("div", "label", label));
    const inp = isTa ? el("textarea") : el("input");
    if (isTa) inp.rows = 3;
    else inp.type = "text";
    inp.placeholder = ph;
    inp.value = p[key] || "";
    inp.oninput = () => (p[key] = inp.value.trim());
    card.append(inp);
  };

  f("您的姓名 / 称呼", "name", "例如：张同学 / 李先生");
  f(
    p.role === "recruiter" ? "正在招聘的核心岗位" : "目标应聘岗位",
    "targetRole",
    p.role === "recruiter" ? "例如：高级Golang工程师 / AI Agent研发" : "例如：高级前端工程师 / AI产品经理"
  );
  f(
    p.role === "recruiter" ? "团队亮点与薪资吸引力" : "2~3 个最硬核的量化成果（破冰必用）",
    "proof",
    p.role === "recruiter"
      ? "例如：核心业务高速增长期，16-18薪，技术氛围极佳，不打卡"
      : "例如：5年大厂及B端SaaS经验，曾主导核心交易链路重构使吞吐提升3倍，0-1落地企业级AI工作流",
    true
  );

  const msg = el("div", "small");
  const saveBtn = btn("保存人设配置", "ab-btn", async () => {
    saveBtn.disabled = true;
    const about = `身份: ${p.role === "recruiter" ? "招聘方" : "求职者"}\n姓名: ${p.name}\n岗位: ${p.targetRole}\n核心亮点: ${p.proof}`;
    const r = await bg({ type: "saveProfile", profile: p, about });
    saveBtn.disabled = false;
    if (r.ok) {
      S.me = r.me;
      msg.className = "q live";
      msg.textContent = "✓ 已保存！后续所有打招呼语和回复都会自动植入您的核心亮点。";
    } else {
      msg.className = "err";
      msg.textContent = r.error || "保存失败";
    }
  });

  const logoutBtn = btn("退出登录", "link", async () => {
    await bg({ type: "logout" });
    S.me = null;
    render();
  });

  card.append(saveBtn, msg, logoutBtn);
  view.append(card);
}

function render() {
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === S.tab);
  });
  renderFoot();
  view.innerHTML = "";

  if (!S.me) {
    renderSignIn();
    return;
  }
  if (S.tab === "resume") {
    renderResumeTab();
    return;
  }
  if (S.tab === "radar") {
    renderRadarTab();
    return;
  }
  if (S.tab === "setup") {
    renderSetupTab();
    return;
  }
  renderDraftTab();
}

async function consumePendingAction() {
  const act = await store("bmPendingAction", null);
  if (!act || Date.now() - act.at > 30000) return;
  await chrome.storage.local.remove("bmPendingAction");
  if (act.job || act.chat) {
    S.ctx = { ok: true, isChat: act.action.startsWith("reply"), job: act.job, chat: act.chat };
  }
  if (act.action === "tailor") {
    S.tab = "resume";
    render();
    return;
  }
  S.tab = "draft";
  if (act.action === "opener") {
    runGenerateDraft("opener");
  } else if (act.action === "reply") {
    runGenerateDraft("reply");
  } else if (act.action === "reply_resume") {
    runGenerateDraft("reply", "", "顺势说明已发附件简历，并用2句话总结我与该岗位最契合的核心量化亮点，礼貌约面");
  } else if (act.action === "reply_salary") {
    runGenerateDraft("reply", "", "高情商回应薪资预期、离职原因或空窗期盘问，温和坚定不降价，将话题引向业务沟通");
  } else {
    render();
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  S.tab = b.dataset.tab;
  render();
});

document.getElementById("syncBtn").addEventListener("click", async () => {
  await syncPageContext();
  render();
});

chrome.storage.onChanged.addListener((ch) => {
  if (ch.bmPendingAction && ch.bmPendingAction.newValue) {
    consumePendingAction();
  }
});

(async () => {
  S.me = await store("me", null);
  await syncPageContext();
  render();
  const r = await bg({ type: "me" });
  if (r.ok && r.me) {
    S.me = r.me;
    render();
  }
  await consumePendingAction();
})();
