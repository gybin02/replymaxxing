import playbookData from "../data/playbook.json";
import { Env, UserRecord, defaultPlaybookForRole } from "./store";

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

export function buildUserVoiceSystem(user: UserRecord): string {
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
  messages: Array<{ role: string; content: string }>
): Promise<string> {
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

  // Fallback using cached Playbook data
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
