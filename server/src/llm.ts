import playbookData from "../data/playbook.json";
import bossPlaybookData from "../data/boss_playbook.json";
import { Env, UserRecord } from "./store";

export async function callLLM(
  env: Env,
  system: string,
  messages: Array<{ role: string; content: string }>,
  jsonMode = false
): Promise<string | null> {
  if (!env.LLM_API_KEY) return null;
  const baseUrl = (env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.LLM_MODEL || "gpt-4o-mini";

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...messages],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        temperature: 0.7,
      }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

export function isBossRequest(user: UserRecord, messages?: Array<{ role: string; content: string }>, platform?: string): boolean {
  if (platform === "boss" || user.profile?.platform === "boss") return true;
  const text = (messages || []).map((m) => m.content || "").join(" ") + " " + (user.aboutText || "");
  return /[\u4e00-\u9fa5]{4,}/.test(text);
}

export function buildUserVoiceSystem(user: UserRecord, isBoss = false): string {
  if (isBoss) {
    const parts = [
      "你是 BossMaxxing（Boss直聘 AI 求职与招聘智能助手），精通中国互联网与各行业求职破冰、HR高情商沟通、薪资博弈与STAR/XYZ法则简历定制。",
      "核心原则：",
      ...bossPlaybookData.openerPlaybook.goldenRules,
    ];
    if (user.aboutText) parts.push(`\n【用户个人画像与核心优势】：\n${user.aboutText}`);
    if (user.playbookText) parts.push(`\n【专属打招呼与沟通策略】：\n${user.playbookText}`);
    if (user.training && user.training.length) {
      const tr = user.training.map((t) => `[${t.kind.toUpperCase()}: ${t.name}]\n${t.text}`).join("\n\n");
      parts.push(`\n【用户自定义话术规则与范例（最高优先级）】：\n${tr}`);
    }
    return parts.join("\n");
  }

  const parts = [
    "You are Max, an elite LinkedIn AI wingman built on Brian Kwa's ReplyMaxxing methodology.",
    "Always write like a thoughtful, high-signal human — never use corporate buzzwords, em-dashes, or robotic templates.",
  ];
  if (user.aboutText) parts.push(`\nUSER PROFILE & GOALS:\n${user.aboutText}`);
  if (user.playbookText) parts.push(`\nINDUSTRY PLAYBOOK:\n${user.playbookText}`);
  if (user.training && user.training.length) {
    const tr = user.training.map((t) => `[${t.kind.toUpperCase()}: ${t.name}]\n${t.text}`).join("\n\n");
    parts.push(`\nUSER VOICE & CUSTOM RULES (HIGHEST PRIORITY):\n${tr}`);
  }
  return parts.join("\n");
}

export async function generateDraft(
  env: Env,
  user: UserRecord,
  mode: string,
  messages: Array<{ role: string; content: string }>,
  platform?: string
): Promise<string> {
  const boss = isBossRequest(user, messages, platform);

  if (boss) {
    let formatInstruction = "";
    if (mode === "reply") {
      formatInstruction = [
        "沟通阶段可选值：破冰打招呼 | 发简历与亮优势 | 高频盘问与排雷 | 锁定面试与谈薪 | 已读不回二次激活",
        "高情商应答原则：" + JSON.stringify(bossPlaybookData.highEqScenarios),
        "请严格按照以下格式输出（不要多余解释）：",
        "STAGE: <当前所处沟通阶段>",
        "WHERE: <1句话总结当前Boss/HR的真实意图或卡点>",
        "NEXT: <1句话给出下一步推进建议（如：顺势发附件简历 / 锁定周三下午视频面）>",
        "",
        "REPLY",
        "<第1段回复话术：直接填入Boss直聘聊天框的文本，自然得体、高情商、不卑不亢>",
        "<可选第2段短句：顺势推进下一步动作>",
      ].join("\n");
    } else {
      formatInstruction = [
        "破冰模板参考：" + JSON.stringify(bossPlaybookData.openerPlaybook.templates),
        "请严格按照以下格式输出：",
        "NOTE",
        "<1句话说明本条打招呼语提取了岗位JD的哪个核心痛点及匹配策略>",
        "OPENER",
        "<第1段：开门见山点出核心匹配年限/方向 + 最硬核的1-2个量化成果（控制在60字内，确保手机预览前30字抓人）>",
        "<第2段：贴合该岗位JD的具体业务补充 + 礼貌请求发简历或深聊（控制在40字内）>",
      ].join("\n");
    }

    const sys = `${buildUserVoiceSystem(user, true)}\n\n${formatInstruction}`;
    const llmOut = await callLLM(env, sys, messages);
    if (llmOut) return llmOut;

    // 中文 Boss直聘本地 Playbook 兜底生成
    const lastMsg = messages[messages.length - 1]?.content || "";
    const isRecruiter = user.profile?.role === "recruiter";
    const targetRole = user.profile?.targetRole || "该岗位";
    const proof = user.profile?.proof || "曾主导核心模块重构与业务增长，核心指标提升显著";

    if (mode === "reply") {
      if (/简历/.test(lastMsg)) {
        return [
          "STAGE: 发简历与亮优势",
          "WHERE: 对方对你的初步背景感兴趣，正在索要或查看附件简历。",
          "NEXT: 立即点击发送附件简历，并附上2条核心匹配点摘要。",
          "",
          "REPLY",
          `好的，最新简历已发送，请您查收！结合咱们的岗位要求，我最匹配的两点是：1）深耕${targetRole}相关领域，${proof}；2）熟悉全链路落地，上手极快。`,
          "您看本周哪天方便安排个15分钟电话或视频沟通？",
        ].join("\n");
      }
      if (/薪资|待遇|目前多少|期望/.test(lastMsg)) {
        return [
          "STAGE: 锁定面试与谈薪",
          "WHERE: 对方正在摸底你的薪资预期与性价比。",
          "NEXT: 给出合理区间并把重心拉回岗位匹配度与面试沟通。",
          "",
          "REPLY",
          "我目前更看重咱们团队的业务方向和匹配度，薪资方面结合我过往的产出和市场水平，期望在贵司该岗位的正常定级区间内（具体可视总包结构灵活沟通）。",
          "方便先约个时间跟业务负责人聊聊具体业务挑战吗？",
        ].join("\n");
      }
      if (/离职|空窗|为什么看机会/.test(lastMsg)) {
        return [
          "STAGE: 高频盘问与排雷",
          "WHERE: HR 正在评估你的求职动机与稳定性。",
          "NEXT: 正向回应职业规划，强调对当前岗位的强烈意愿与高稳定性。",
          "",
          "REPLY",
          "前司业务目前进入平稳维护期，我个人更希望能在一个处于成长期、更有技术/业务深度的团队持续产出；看到咱们在招这个方向非常契合我的长板。",
          "目前我状态很好，如果匹配合适可以随时快速到岗投入。",
        ].join("\n");
      }
      return [
        "STAGE: 发简历与亮优势",
        "WHERE: 双方已建立初步沟通，适合进一步展示核心匹配度并推进约面。",
        "NEXT: 简明回应对方问题，主动发简历或询问面试安排。",
        "",
        "REPLY",
        `明白的！在${targetRole}这块我有扎实的落地经验（${proof}），跟咱们团队目前的需求非常契合。`,
        "我先把详细简历发您过目，您看近期方便安排个简短沟通吗？",
      ].join("\n");
    }

    if (isRecruiter) {
      return [
        "NOTE",
        "采用【招聘方走心邀约型】策略：具体点出牛人背景契合度，亮出团队核心吸引力。",
        "OPENER",
        ...bossPlaybookData.rolePlaybooks.recruiter.sampleOpener,
      ].join("\n");
    }

    return [
      "NOTE",
      `采用【成果直击型】破冰公式：黄金前30字直击「${targetRole}」核心痛点与量化成果，告别千篇一律的默认招呼语。`,
      "OPENER",
      `您好！仔细看了咱们「${targetRole}」的岗位要求，我过往深耕同领域业务，${proof}，技术栈与业务场景高度吻合。`,
      "平时持续关注贵司业务方向，非常期待能加入团队即插即用，方便发份详细简历给您看看吗？",
    ].join("\n");
  }

  const postTypesText = playbookData.postPlaybook.types
    .map((t) => `- ${t.id} (${t.name}, stage: ${t.stage}): ${t.rules}`)
    .join("\n");

  let formatInstruction = "";
  if (mode === "post" || mode === "remix") {
    formatInstruction = [
      "Follow the Viral Post Playbook:",
      playbookData.postPlaybook.storyArc.join("\n"),
      "\nAvailable 18 Post Types:\n" + postTypesText,
      "\nOutput strictly with these uppercase section headers on their own lines:",
      mode === "remix" ? "ANALYSIS\n(2-3 sentences explaining why the original post works)\n" : "",
      "TYPE\n<Post Type Name> · <Stage Name>",
      "WHY\n<1 sentence explaining why this type fits>",
      "POST\n<The full LinkedIn post with short punchy lines>",
      "HOOKS\n- <Alternative hook 1>\n- <Alternative hook 2>\n- <Alternative hook 3>",
      "NOTE\n<1 sentence pointing out the weakest part or what [bracket] detail the user should personalize>",
    ].join("\n");
  } else if (mode === "reply") {
    formatInstruction = [
      "Conversation Stages: Opener -> Rapport -> Intent -> Offer -> Booked.",
      "Output strictly in this format:",
      "STAGE: <Opener|Rapport|Intent|Offer|Booked>",
      "WHERE: <1 short sentence on where the conversation stands>",
      "NEXT: <1 short sentence on the recommended next move>",
      "",
      "REPLY",
      "<Line 1 of the reply>",
      "<Optional Line 2 of the reply>",
    ].join("\n");
  } else if (mode === "comment") {
    formatInstruction = [
      "Output strictly in this format:",
      "NOTE",
      "<1 sentence explaining why this comment adds value>",
      "COMMENT",
      "<1-2 natural, specific sentences for the comment box>",
    ].join("\n");
  } else {
    formatInstruction = [
      "Output strictly in this format:",
      "NOTE",
      "<1 sentence explaining the hook chosen from their profile/posts>",
      "OPENER",
      "<Line 1: specific observation or praise>",
      "<Line 2: one easy, curious question>",
    ].join("\n");
  }

  const sys = `${buildUserVoiceSystem(user)}\n\n${formatInstruction}`;
  const llmOut = await callLLM(env, sys, messages);
  if (llmOut) return llmOut;

  const lastMsg = messages[messages.length - 1]?.content || "";
  const role = user.profile?.role || "founder";
  const pb = (playbookData.industryPlaybooks as any)[role] || playbookData.industryPlaybooks.founder;

  if (mode === "post" || mode === "remix") {
    const picked = playbookData.postPlaybook.types[0];
    return [
      mode === "remix"
        ? "ANALYSIS\nStrong scroll-stopping hook backed by a concrete contrast, short single-sentence paragraphs, and a clear takeaway at the bottom.\n"
        : "",
      `TYPE\n${picked.name} · Attract`,
      `WHY\nUses a specific observation and contrast so your target audience immediately relates.`,
      `POST`,
      `Most people overcomplicate LinkedIn outreach.`,
      ``,
      `Here is what actually works right now:`,
      `1. Reference something real they shipped or wrote`,
      `2. Skip the pitch in message one`,
      `3. Ask one question they actually enjoy answering`,
      ``,
      `When we switched to this approach, reply rates jumped from [X%] to [Y%] in 30 days.`,
      ``,
      `People don't hate messages. They hate templates.`,
      `HOOKS`,
      `- 90% of LinkedIn DMs get ignored for one simple reason.`,
      `- I stopped sending pitches on LinkedIn. Here is what happened next.`,
      `- The 2-line message framework that doubled our replies.`,
      `NOTE\nFill in [X%] and [Y%] with your real numbers before posting.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (mode === "reply") {
    return [
      "STAGE: Rapport",
      "WHERE: They engaged warmly and shared what they are currently focused on.",
      "NEXT: Acknowledge their point and ask one question to uncover timing or priority.",
      "",
      "REPLY",
      "That makes complete sense — teams scaling that fast usually hit that exact bottleneck first.",
      "Curious, how are you guys tackling that this quarter?",
    ].join("\n");
  }

  if (mode === "comment") {
    return [
      "NOTE",
      "Highlights their core point and adds a concrete perspective to stand out in the comments.",
      "COMMENT",
      "Spot on breakdown — especially the point on keeping execution simple before scaling. What surprised you most when rolling this out?",
    ].join("\n");
  }

  const lines = pb.sampleOpener || [
    "Really enjoyed your recent post — super clear breakdown.",
    "Curious, what's at the top of your priority list this quarter?",
  ];
  return ["NOTE", `Built using your ${pb.role} opener framework (${lastMsg.slice(0, 50).replace(/\n/g, " ")}...).`, "OPENER", ...lines].join("\n");
}

export async function generateProfileAnalysis(env: Env, user: UserRecord, body: any) {
  const role = body.role || user.profile?.role || "founder";
  const goal = (body.goals && body.goals[0]) || (user.profile?.goals && user.profile.goals[0]) || "Grow on LinkedIn";
  const rubric = playbookData.profileRubric;

  const sys = `${buildUserVoiceSystem(user)}
Score this LinkedIn profile from 0 to 100 against the role "${role}" and goal "${goal}".
Return JSON with:
{
  "score": number,
  "grade": "Strong" | "Good" | "Needs work" | "Weak",
  "summary": string,
  "role": "${role}",
  "goal": "${goal}",
  "auto": boolean,
  "topFixes": [string, string, string],
  "sections": [
    { "key": string, "label": string, "weight": number, "score": number (0-10), "status": "strong"|"improve"|"missing", "found": string, "why": string, "fix": string, "rewrite"?: string }
  ]
}
Use these exact 10 section keys and weights: ${JSON.stringify(rubric)}`;

  const llmJson = await callLLM(
    env,
    sys,
    [{ role: "user", content: `Profile Name: ${body.name || ""}\nProfile Text:\n${body.text || ""}` }],
    true
  );
  if (llmJson) {
    try {
      return JSON.parse(llmJson);
    } catch {}
  }

  const sections = rubric.map((r) => {
    if (r.key === "headline") {
      return {
        ...r,
        score: 6,
        status: "improve",
        found: "Names your title/field, but misses a concrete outcome or who you help.",
        why: "Your headline appears next to every message, comment, and search result.",
        fix: "State who you help (or your target role), how, and 1 quantified result.",
        rewrite: `${body.name ? body.name + " · " : ""}Helping teams achieve measurable growth | [Add 1 key metric/win]`,
      };
    }
    if (r.key === "about") {
      return {
        ...r,
        score: 7,
        status: "improve",
        found: "Good background summary, but the first 3 lines don't hook with outcomes.",
        why: "Only the first 3 lines show before 'see more'.",
        fix: "Open with the core problem you solve, list 3 bulleted wins with numbers, and end with a clear CTA.",
        rewrite: `I focus on solving [core problem] for [target audience].\n• [Win #1 with number]\n• [Win #2 with number]\n• [Win #3 with number]\nReach out via DM if you'd like to swap notes.`,
      };
    }
    if (r.key === "banner") {
      const missing = body.images?.banner === "missing";
      return {
        ...r,
        score: missing ? 2 : 7,
        status: missing ? "missing" : "improve",
        found: missing ? "Default or missing LinkedIn banner." : "Banner is present, can be sharper on value proposition.",
        why: "The banner is the largest visual real estate at the top of your profile.",
        fix: "Use a clean 1584x396 banner stating who you serve and the result.",
        rewrite: "Turn conversations into results · Ask me how →",
      };
    }
    return {
      ...r,
      score: 8,
      status: "strong",
      found: `Solid ${r.label.toLowerCase()} presence on the profile.`,
      why: r.criteria,
      fix: `Keep ${r.label.toLowerCase()} updated with your latest wins and metrics.`,
    };
  });

  const totalScore = Math.round(sections.reduce((acc, s) => acc + (s.weight * s.score) / 10, 0));
  return {
    score: totalScore,
    grade: totalScore >= 85 ? "Strong" : totalScore >= 70 ? "Good" : "Needs work",
    summary: "Strong foundation and experience, but sharpening your Headline, About hook, and Banner will immediately lift reply and conversion rates.",
    role,
    goal,
    auto: Boolean(body.auto),
    topFixes: [
      "Rewrite your Headline to include who you help/target role plus one concrete metric.",
      "Lead the first 3 lines of your About section with quantified outcomes and a clear next step.",
      "Upgrade your 1584x396 Banner so visitors know your value proposition in 3 seconds.",
    ],
    sections,
    rubric,
  };
}
