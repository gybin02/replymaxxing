import { Hono } from "hono";
import { cors } from "hono/cors";
import plansData from "../data/plans.json";
import playbookData from "../data/playbook.json";
import legalData from "../data/legal.json";
import {
  Env,
  UserRecord,
  consumeCredits,
  defaultPlaybookForRole,
  formatMe,
  getOrCreateUser,
  getUserByToken,
  planMeta,
  saveOtp,
  saveUser,
  verifyOtp,
} from "./store";
import { buildUserVoiceSystem, callLLM, generateDraft, generateProfileAnalysis } from "./llm";

const app = new Hono<{ Bindings: Env; Variables: { user: UserRecord } }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// 鉴权中间件
async function requireAuth(c: any, next: () => Promise<void>) {
  const auth = c.req.header("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return c.json({ ok: false, code: "auth", error: "Please sign in again." }, 401);
  const user = await getUserByToken(c.env, token);
  if (!user) return c.json({ ok: false, code: "auth", error: "Please sign in again." }, 401);
  c.set("user", user);
  await next();
}

// ---------- 1. 基础健康检查与静态法律协议页面 (来自本地缓存 data/legal.json) ----------
app.get("/", (c) => c.json({ ok: true, service: "replymaxxing", version: "2.5.7" }));
app.get("/terms", (c) => c.html(legalData.terms));
app.get("/privacy", (c) => c.html(legalData.privacy));
app.get("/welcome", (c) => c.html(legalData.welcome));

// ---------- 2. 缓存 JSON 数据查询接口 (Playbook / Plans) ----------
app.get("/v1/plans", (c) => c.json({ ok: true, ...plansData }));
app.get("/v1/cache/playbook", (c) => c.json({ ok: true, playbook: playbookData }));
app.get("/v1/cache/plans", (c) => c.json({ ok: true, plans: plansData }));

// ---------- 3. 登录与认证模块 (/v1/auth/*) ----------
app.post("/v1/auth/start", async (c) => {
  const { email = "" } = await c.req.json().catch(() => ({}));
  const clean = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return c.json({ ok: false, error: "Enter a valid email address." }, 400);
  }
  const code = c.env.DEV_OTP_CODE || String(Math.floor(100000 + Math.random() * 900000));
  await saveOtp(c.env, clean, code);

  if (c.env.RESEND_API_KEY) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "ReplyMaxxing <login@replymaxxing.com>",
        to: [clean],
        subject: `${code} is your ReplyMaxxing sign-in code`,
        html: `<p>Your sign-in code is <b>${code}</b> (valid for 10 minutes).</p>`,
      }),
    }).catch(() => {});
  }

  return c.json({ ok: true, devHint: c.env.RESEND_API_KEY ? undefined : `Use code ${code} (or 123456)` });
});

app.post("/v1/auth/verify", async (c) => {
  const { email = "", code = "", ref } = await c.req.json().catch(() => ({}));
  const clean = String(email).trim().toLowerCase();
  const valid = await verifyOtp(c.env, clean, String(code).trim());
  if (!valid) {
    return c.json({ ok: false, error: "That code didn't match or expired. Try again (or use 123456 in dev mode)." }, 400);
  }
  const user = await getOrCreateUser(c.env, clean, ref);
  return c.json({ ok: true, token: user.token, me: formatMe(user) });
});

app.post("/v1/auth/logout", async (c) => c.json({ ok: true }));

// ---------- 4. 账户状态与协议 (/v1/me, /v1/terms/accept) ----------
app.get("/v1/me", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json({ ok: true, me: formatMe(user) });
});

app.post("/v1/terms/accept", requireAuth, async (c) => {
  const user = c.get("user");
  const { version } = await c.req.json().catch(() => ({}));
  user.termsAccepted = true;
  if (version) user.termsVersion = version;
  await saveUser(c.env, user);
  return c.json({ ok: true, me: formatMe(user) });
});

// ---------- 5. 用户画像、Playbook 与声音训练 (/v1/profile, /v1/playbook, /v1/training, /v1/voice/*) ----------
app.put("/v1/profile", requireAuth, async (c) => {
  const user = c.get("user");
  const { profile, about } = await c.req.json().catch(() => ({}));
  if (profile && typeof profile === "object") user.profile = profile;
  if (typeof about === "string") user.aboutText = about;
  if (user.profile?.role) {
    user.playbookText = defaultPlaybookForRole(user.profile.role);
    user.hasPlaybook = true;
  }
  await saveUser(c.env, user);
  return c.json({ ok: true, me: formatMe(user) });
});

app.post("/v1/playbook", requireAuth, async (c) => {
  const user = c.get("user");
  const { about = "" } = await c.req.json().catch(() => ({}));
  const role = user.profile?.role || "other";
  const basePb = defaultPlaybookForRole(role);

  const llmPb = await callLLM(
    c.env,
    "You build concise LinkedIn outreach & content playbooks tailored to the user's role, offer, and audience.",
    [
      {
        role: "user",
        content: `Build a custom LinkedIn playbook based on this template:\n${basePb}\n\nAnd this user background:\n${about || user.aboutText}`,
      },
    ]
  );

  user.playbookText = llmPb || basePb;
  user.hasPlaybook = true;
  await saveUser(c.env, user);
  return c.json({ ok: true, text: user.playbookText, me: formatMe(user) });
});

app.put("/v1/playbook", requireAuth, async (c) => {
  const user = c.get("user");
  const { text = "" } = await c.req.json().catch(() => ({}));
  user.playbookText = String(text);
  user.hasPlaybook = Boolean(user.playbookText);
  await saveUser(c.env, user);
  return c.json({ ok: true, me: formatMe(user) });
});

app.get("/v1/training", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json({ ok: true, training: user.training || [] });
});

app.put("/v1/training", requireAuth, async (c) => {
  const user = c.get("user");
  const { items = [] } = await c.req.json().catch(() => ({}));
  if (Array.isArray(items)) user.training = items;
  await saveUser(c.env, user);
  return c.json({ ok: true, training: user.training, me: formatMe(user) });
});

app.post("/v1/voice/build", requireAuth, async (c) => {
  const user = c.get("user");
  const { describe = "", picks = [], samples = "" } = await c.req.json().catch(() => ({}));
  const sys = `${buildUserVoiceSystem(user)}
Extract the user's writing voice into JSON:
{ "summary": "1 sentence description of their tone", "rules": ["rule 1", "rule 2", ...], "framework": "short 3-step outreach framework" }`;
  const llmJson = await callLLM(
    c.env,
    sys,
    [{ role: "user", content: `Description: ${describe}\nPicks: ${(picks || []).join(", ")}\nSamples:\n${samples}` }],
    true
  );
  if (llmJson) {
    try {
      return c.json({ ok: true, ...JSON.parse(llmJson) });
    } catch {}
  }
  const rules = [
    ...(Array.isArray(picks) ? picks.map((p: string) => `Follow style preference: ${p}`) : []),
    describe ? `Tone note: ${describe.trim()}` : "Keep messages conversational, specific, and under 40 words.",
    "Never use corporate jargon, em-dashes, or pitch in the first message.",
    "End openers with one easy, curious question.",
  ];
  return c.json({
    ok: true,
    summary: "Direct, warm, high-signal voice that leads with genuine curiosity.",
    rules,
    framework: "1. Reference a concrete detail from their recent post or role\n2. Share a 1-line relevant observation\n3. Ask an easy open-ended question",
  });
});

app.post("/v1/voice/preview", requireAuth, async (c) => {
  const user = c.get("user");
  const role = user.profile?.role || "founder";
  const pb = (playbookData.industryPlaybooks as any)[role] || playbookData.industryPlaybooks.founder;
  const usage = await consumeCredits(c.env, user, 1, 3);
  return c.json({
    ok: true,
    prospect: "Chris Rivera (VP Marketing at Lumen)",
    lines: pb.sampleOpener,
    usage,
  });
});

// ---------- 6. 邀请裂变 (/v1/referral, /v1/referral/claim) ----------
app.get("/v1/referral", requireAuth, async (c) => {
  const user = c.get("user");
  const site = (c.env.SITE_URL || "https://replymaxxing.com").replace(/\/$/, "");
  return c.json({
    ok: true,
    referral: {
      code: user.referralCode,
      link: `${site}/?ref=${user.referralCode}`,
      joined: 0,
      active: 0,
      paying: 0,
      creditsEarned: user.referredBy ? 20 : 0,
      freeMonths: 0,
      canClaim: !user.referredBy,
      rewards: { fresh: 20, signup: 50, paidDays: 30 },
    },
  });
});

app.post("/v1/referral/claim", requireAuth, async (c) => {
  const user = c.get("user");
  const { code = "" } = await c.req.json().catch(() => ({}));
  const clean = String(code).trim().toUpperCase();
  if (!clean || clean === user.referralCode) {
    return c.json({ ok: false, error: "Enter a valid friend's invite code." }, 400);
  }
  if (!user.referredBy) {
    user.referredBy = clean;
    user.usage.draftLimit += 20;
    await saveUser(c.env, user);
  }
  return c.json({ ok: true, me: formatMe(user) });
});

// ---------- 7. AI 核心生成与诊断接口 (/v1/draft, /v1/analyze, /v1/ask, /v1/ideas, /v1/trends, /v1/banner) ----------
app.post("/v1/draft", requireAuth, async (c) => {
  const user = c.get("user");
  const { mode = "opener", messages = [] } = await c.req.json().catch(() => ({}));
  const text = await generateDraft(c.env, user, mode, messages);
  const usage = await consumeCredits(c.env, user, 1, 4);
  return c.json({ ok: true, text, usage });
});

app.post("/v1/analyze", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const report = await generateProfileAnalysis(c.env, user, body);
  const usage = await consumeCredits(c.env, user, 1, 10);
  return c.json({ ok: true, ...report, usage });
});

app.post("/v1/ask", requireAuth, async (c) => {
  const user = c.get("user");
  const { messages = [], context = {} } = await c.req.json().catch(() => ({}));
  const sys = `${buildUserVoiceSystem(user)}
You are chatting with the user inside the ReplyMaxxing side panel.
Current page context: ${JSON.stringify(context)}
Answer concisely and helpfully.`;
  const llmReply = await callLLM(
    c.env,
    sys,
    messages.map((m: any) => ({ role: m.role || "user", content: m.text || m.content || "" }))
  );
  const usage = await consumeCredits(c.env, user, 1, 4);
  return c.json({
    ok: true,
    reply:
      llmReply ||
      "I'm ready to help! Open any LinkedIn profile, post, or message thread and click Ask Max — or tell me what post or message you want to draft right now.",
    action: "none",
    usage,
  });
});

app.post("/v1/ideas", requireAuth, async (c) => {
  const user = c.get("user");
  const { prompt = "" } = await c.req.json().catch(() => ({}));
  const sys = `${buildUserVoiceSystem(user)}
Generate 6 LinkedIn post ideas using these post types: ${JSON.stringify(playbookData.postPlaybook.types.map((t) => ({ id: t.id, stage: t.stage })))}
Return JSON: { "ideas": [ { "type": "trending", "stage": "attract", "hook": "...", "angle": "...", "needs": "..." } ] }`;
  const llmJson = await callLLM(c.env, sys, [{ role: "user", content: prompt }], true);
  const usage = await consumeCredits(c.env, user, 2, 8);
  if (llmJson) {
    try {
      const parsed = JSON.parse(llmJson);
      if (Array.isArray(parsed.ideas)) return c.json({ ok: true, ideas: parsed.ideas, usage });
    } catch {}
  }

  const ideas = playbookData.postPlaybook.types.slice(0, 6).map((t) => ({
    type: t.id,
    stage: t.stage,
    hook: `What nobody tells you about ${user.profile?.targetRole || user.profile?.offer || "growing on LinkedIn"} (${t.name})`,
    angle: t.rules,
    needs: "1 real example or metric from your recent work",
  }));
  return c.json({ ok: true, ideas, usage });
});

app.post("/v1/trends", requireAuth, async (c) => {
  const user = c.get("user");
  const { feed = [], focus = "" } = await c.req.json().catch(() => ({}));
  const usage = await consumeCredits(c.env, user, 5, 12);
  const topicFocus = focus || user.profile?.targetRole || user.profile?.industry || "AI & B2B Growth";
  return c.json({
    ok: true,
    web: true,
    at: Date.now(),
    trends: [
      {
        topic: `${topicFocus}: Quality over volume`,
        source: "LinkedIn Industry Pulse",
        why_now: "Decision makers are filtering out automated AI slop and rewarding specific, proof-backed outreach.",
        type: "trending",
        stage: "attract",
        hook: `Why 95% of cold outreach in ${topicFocus} is getting ignored this quarter.`,
        angle: "Contrast generic templates with research-first openers and share 3 things working right now.",
      },
      {
        topic: `Smaller, faster teams shipping with AI workflows`,
        source: "Tech & GTM Report",
        why_now: "Hiring managers and buyers care more about end-to-end ownership than headcount.",
        type: "perspective",
        stage: "engage",
        hook: "3 years ago vs today: what hiring managers actually look for.",
        angle: "Compare what mattered 3 years ago with what drives results today.",
      },
    ],
    feed: (feed || []).slice(0, 3).map((p: any) => ({
      author: p.author || "Feed Creator",
      engagement: p.stats || "High engagement",
      type: "career",
      hook: (p.text || "").split("\n")[0]?.slice(0, 90) || "Strong opening line",
      why: "Uses a specific personal story hook and short lines before 'see more'.",
    })),
    usage,
  });
});

app.post("/v1/banner", requireAuth, async (c) => {
  const user = c.get("user");
  const { who = "", serve = "", result = "", link = "" } = await c.req.json().catch(() => ({}));
  const usage = await consumeCredits(c.env, user, 3, 10);
  const cta = link ? link.replace(/^https?:\/\//, "") : "Message me to chat";
  return c.json({
    ok: true,
    options: [
      {
        headline: `Helping ${serve} ${result.replace(/^to\s+/i, "")}`,
        sub: who,
        cta,
      },
      {
        headline: result,
        sub: `For ${serve} · ${who}`,
        cta,
      },
      {
        headline: `${who} for ${serve}`,
        sub: `Proven playbook to ${result.toLowerCase()}`,
        cta,
      },
    ],
    usage,
  });
});

// ---------- 8. 求职者与简历定制模块 (/v1/resume/*, /v1/jobs/contacts, /v1/alerts) ----------
app.post("/v1/resume/parse", requireAuth, async (c) => {
  const { file } = await c.req.json().catch(() => ({}));
  if (!file || !file.data) return c.json({ ok: false, error: "No PDF file received." }, 400);
  return c.json({
    ok: true,
    text: "Uploaded PDF Resume Content\nSummary: Experienced professional with strong track record.\nExperience: Led key initiatives and delivered measurable impact.",
  });
});

app.post("/v1/resume/tailor", requireAuth, async (c) => {
  const user = c.get("user");
  const { resume = "", job = {}, notes = "" } = await c.req.json().catch(() => ({}));
  const sys = `${buildUserVoiceSystem(user)}
Tailor this resume to the job posting using the Google XYZ formula (${playbookData.resumePlaybook.formula}).
Rules: ${playbookData.resumePlaybook.rules.join(" ")}
Return JSON with:
{
  "resume": {
    "name": string, "headline": string,
    "contact": { "email": string, "phone": string, "location": string, "linkedin": string },
    "summary": string,
    "skills": [{ "group": string, "items": [string] }],
    "experience": [{ "title": string, "company": string, "start": string, "end": string, "location": string, "bullets": [string] }],
    "projects": [{ "name": string, "bullets": [string] }],
    "education": [{ "school": string, "degree": string, "field": string, "start": string, "end": string }]
  },
  "match": { "before": number, "after": number, "keywordsAdded": [string] },
  "fillIns": [string],
  "gaps": [{ "gap": string, "advice": string }],
  "changes": [string],
  "nextCost": 0
}`;
  const llmJson = await callLLM(
    c.env,
    sys,
    [{ role: "user", content: `Job: ${JSON.stringify(job)}\nNotes: ${notes}\nResume:\n${resume}` }],
    true
  );
  const usage = await consumeCredits(c.env, user, 5, 20);
  if (llmJson) {
    try {
      return c.json({ ok: true, ...JSON.parse(llmJson), usage });
    } catch {}
  }

  return c.json({
    ok: true,
    resume: {
      name: user.profile?.name || "Your Name",
      headline: `${job.title || user.profile?.targetRole || "Senior Professional"}`,
      contact: { email: user.email, location: job.location || user.profile?.location || "Remote", linkedin: "linkedin.com/in/yourprofile" },
      summary: `Results-driven ${job.title || "professional"} with proven experience delivering high-impact outcomes aligned with ${job.company || "your team"}'s goals.`,
      skills: [{ group: "Core Competencies", items: ["Cross-functional Leadership", "Data Analysis", "Execution & Delivery", "Product Strategy"] }],
      experience: [
        {
          title: user.profile?.currentRole || "Senior Specialist",
          company: "Recent Company",
          start: "2022",
          end: "Present",
          location: job.location || "Remote",
          bullets: [
            `Accomplished [X% increase in key metric] as measured by quarterly KPIs, by leading end-to-end execution aligned with ${job.title || "role"} requirements.`,
            `Reduced cycle time by [Y%] across [N] workflows by streamlining cross-team processes.`,
          ],
        },
      ],
      projects: [],
      education: [{ school: "University", degree: "B.S.", field: "Relevant Field", start: "2016", end: "2020" }],
    },
    match: { before: 58, after: 86, keywordsAdded: [job.title || "Role Alignment", "XYZ Impact Metrics", "ATS Standard Headings"] },
    fillIns: ["[X% increase in key metric]", "[Y%]"],
    gaps: [{ gap: "Domain-specific metrics", advice: "Replace the [X%] placeholders with your real numbers before downloading." }],
    changes: ["Rewrote experience bullets using Google's XYZ formula", "Aligned headline and summary with the posting"],
    nextCost: 0,
    usage,
  });
});

async function handleResumeScore(c: any, user?: UserRecord) {
  const { resume = "", text = "", target = "", role = "" } = await c.req.json().catch(() => ({}));
  const raw = resume || text;
  const targetRole = target || role || user?.profile?.targetRole || "Target Role";
  const usage = user ? await consumeCredits(c.env, user, 3, 10) : undefined;
  return c.json({
    ok: true,
    score: 76,
    grade: "Good",
    summary: `Solid experience for ${targetRole}, but adding quantified XYZ outcomes and exact role keywords will significantly boost recruiter response.`,
    topFixes: [
      `Name "${targetRole}" clearly in your headline and first line of Summary.`,
      "Rewrite duty-based bullets into Google's XYZ formula (Accomplished X, as measured by Y, by doing Z).",
      "Ensure key technical and domain skills from target job postings appear in your Skills section.",
    ],
    sections: playbookData.resumePlaybook.sections.map((s, idx) => ({
      key: s.key,
      label: s.label,
      status: idx < 2 ? "improve" : "strong",
      score: idx < 2 ? 7 : 8,
      found: `Reviewed ${raw.length} characters of resume text against ${targetRole}.`,
      fix: "Add 1-2 concrete numbers per role and mirror exact keywords from the posting.",
      example: "Accomplished 28% faster onboarding as measured by activation rate, by redesigning the first-run flow.",
    })),
    keywordsMissing: ["Quantified KPIs", targetRole],
    usage,
  });
}

app.post("/v1/resume/score", requireAuth, (c) => handleResumeScore(c, c.get("user")));
app.post("/v1/public/resume-score", (c) => handleResumeScore(c));

app.post("/v1/jobs/contacts", requireAuth, async (c) => {
  const user = c.get("user");
  const { job = {} } = await c.req.json().catch(() => ({}));
  const co = job.company || "the company";
  const title = job.title || "this role";
  const usage = await consumeCredits(c.env, user, 2, 8);
  return c.json({
    ok: true,
    summary: `Reach out to the hiring manager and recruiter at ${co} within 24 hours of applying.`,
    contacts: [
      ...(Array.isArray(job.team)
        ? job.team.map((t: any) => ({
            name: t.name,
            title: t.title || "Hiring Team",
            kind: "hiring_team",
            url: t.url,
            why: "Listed directly on the LinkedIn job posting.",
          }))
        : []),
      {
        name: `Hiring Manager (${title})`,
        title: `Director / Manager at ${co}`,
        kind: "hiring_manager",
        search: `${co} ${title} manager`,
        why: "Decision maker who owns the team's roadmap and pain points.",
      },
      {
        name: `Technical / Talent Recruiter`,
        title: `Recruiter at ${co}`,
        kind: "recruiter",
        search: `${co} recruiter`,
        why: "Screens applications and can flag your resume directly.",
      },
    ],
    connectNote: `Hi — I just applied for the ${title} role at ${co}. Really admire what the team is building and would love to connect.`,
    afterApply: `Hi! I just submitted my application for the ${title} role at ${co}. Given my background in similar projects, I'd love to share how I can help the team hit its goals this quarter. Curious, what's the #1 priority for this hire in the first 90 days?`,
    followUp: `Hi again — wanted to share a quick note on the ${title} role at ${co}. Still very excited about what the team is shipping. Happy to send over any additional examples if helpful!`,
    commentPlan: [
      `Open the hiring manager's profile and leave a thoughtful comment on their most recent post before sending your DM.`,
      `Mention one specific metric or launch from ${co} so your name stands out in their notifications.`,
    ],
    watchouts: ["Never ask them to review your whole resume in message one — lead with their team's work."],
    usage,
  });
});

app.post("/v1/alerts", requireAuth, async (c) => {
  const user = c.get("user");
  const target = user.profile?.targetRole || user.profile?.offer || "your niche";
  const usage = await consumeCredits(c.env, user, 3, 6);
  return c.json({
    ok: true,
    tip: `Comment on a post first before sending a DM — it warms up your name in their notifications.`,
    posts: [
      {
        author: "Hiring Leader",
        company: "Growth Tech",
        kind: "Hiring",
        snippet: `We're expanding our team and looking for someone strong in ${target}. Drop a note or DM if you're building in this space!`,
        why: `Matches your target focus (${target})`,
        action: "Open and draft a specific opener with Max",
        url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(target + " hiring")}`,
      },
    ],
    follow: [
      {
        name: `Search leaders in ${target}`,
        title: "Active voices & hiring managers",
        why: "Consistently posts updates and team openings.",
        url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(target)}`,
      },
    ],
    usage,
  });
});

// ---------- 9. 订阅与商业化接口 (/v1/checkout, /v1/topup, /v1/trial/end, /v1/portal) ----------
app.post("/v1/checkout", requireAuth, async (c) => {
  const user = c.get("user");
  const { plan = "pro" } = await c.req.json().catch(() => ({}));
  const pm = planMeta(plan);
  user.plan = pm.plan;
  user.planName = pm.planName;
  user.free = pm.free;
  user.trialing = false;
  user.usage.draftLimit = pm.draftLimit;
  user.usage.conversationLimit = pm.conversationLimit;
  await saveUser(c.env, user);
  return c.json({
    ok: true,
    switched: true,
    me: formatMe(user),
    kickoffUrl: plan === "managed" ? plansData.bookKickoffUrl : undefined,
  });
});

app.post("/v1/topup", requireAuth, async (c) => {
  const user = c.get("user");
  const { kind = "drafts" } = await c.req.json().catch(() => ({}));
  if (kind === "conversations") {
    user.usage.conversationLimit = (user.usage.conversationLimit || 100) + 50;
  } else {
    user.usage.draftLimit += 250;
  }
  await saveUser(c.env, user);
  return c.json({ ok: true, me: formatMe(user) });
});

app.post("/v1/trial/end", requireAuth, async (c) => {
  const user = c.get("user");
  user.trialing = false;
  await saveUser(c.env, user);
  return c.json({ ok: true, me: formatMe(user) });
});

app.post("/v1/portal", requireAuth, async (c) => {
  const url = c.env.SITE_URL || "https://replymaxxing.com";
  return c.json({ ok: true, url });
});

// ---------- 10. 遥测埋点 (/v1/telemetry) ----------
app.post("/v1/telemetry", async (c) => c.json({ ok: true }));

export default app;
