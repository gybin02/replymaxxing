#!/usr/bin/env node
/**
 * 从原 ReplyMaxxing 官方接口与官网拉取并同步静态配置、套餐、协议与 Playbook 数据到本地 JSON 缓存
 * Usage: node scripts/sync-upstream.mjs [optional_bearer_token]
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const EXT_DIR = path.resolve(__dirname, "../../replymaxxing_src");
const UPSTREAM_API = process.env.UPSTREAM_API || "https://replymaxxing-api.replymaxxing.workers.dev";
const token = process.argv[2] || process.env.UPSTREAM_TOKEN || "";

fs.mkdirSync(DATA_DIR, { recursive: true });

async function main() {
  console.log(`[1/4] Fetching /v1/plans from ${UPSTREAM_API}...`);
  const plansRes = await fetch(`${UPSTREAM_API}/v1/plans`);
  if (plansRes.ok) {
    const plans = await plansRes.json();
    fs.writeFileSync(path.join(DATA_DIR, "plans.json"), JSON.stringify(plans, null, 2));
    console.log("  ✓ Saved data/plans.json");
  }

  console.log(`[2/4] Fetching /terms, /privacy, /welcome from ${UPSTREAM_API}...`);
  const [terms, privacy, welcome] = await Promise.all([
    fetch(`${UPSTREAM_API}/terms`).then((r) => r.text()),
    fetch(`${UPSTREAM_API}/privacy`).then((r) => r.text()),
    fetch(`${UPSTREAM_API}/welcome`).then((r) => r.text()),
  ]);
  fs.writeFileSync(
    path.join(DATA_DIR, "legal.json"),
    JSON.stringify({ fetchedAt: new Date().toISOString(), source: UPSTREAM_API, version: "2026-10-14", terms, privacy, welcome }, null, 2)
  );
  console.log("  ✓ Saved data/legal.json");

  console.log(`[3/4] Extracting AB_PLAYBOOK and building data/playbook.json...`);
  const pbCode = fs.readFileSync(path.join(EXT_DIR, "playbook.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(pbCode, sandbox);
  const abPlaybook = sandbox.AB_PLAYBOOK;

  const playbookData = {
    version: "2.5.7",
    updatedAt: new Date().toISOString(),
    postPlaybook: {
      storyArc: [
        "1. Hook (first 2 lines before 'see more' — must stop the scroll with a specific number, tension, or bold claim)",
        "2. Setup (the real context or status quo the audience immediately recognizes)",
        "3. Rising Action (the obstacle, friction, or turning point with concrete details)",
        "4. Climax / Bold Statement (the core shift or non-obvious insight)",
        "5. Takeaway (a quotable, low-ego closing line or open question people want to reply to)"
      ],
      stages: abPlaybook.STAGES,
      types: abPlaybook.TYPES
    },
    conversationPlaybook: {
      stages: [
        { id: "Opener", goal: "Get a warm first reply by referencing something specific they posted or built, ending with one easy question. Never pitch in line one." },
        { id: "Rapport", goal: "Build mutual context and trust. Share one brief relevant observation and ask about their current priority or bottleneck." },
        { id: "Intent", goal: "Uncover the concrete problem, timeline, or hiring/buying need they mentioned." },
        { id: "Offer", goal: "Connect their stated need to how you help (or your background) and suggest a low-friction next step." },
        { id: "Booked", goal: "Hand off the booking link or resume/portfolio cleanly and confirm the time." }
      ],
      styles: {
        conversational: "Hi Sam, your post on hiring really landed. Growing a team that fast isn't easy. Curious, what's been the hardest part?",
        casual: "hey Sam, loved your post on hiring lol. Curious, how's the team growing?",
        warm: "Hi Sam, your post on hiring really stuck with me. Curious, what's been the biggest lesson so far?",
        direct: "Sam, great post on hiring. Curious, what's your biggest hiring gap this quarter?",
        polished: "Hi Sam, I enjoyed your perspective on hiring. Curious, what are you prioritizing this quarter?",
        playful: "Sam, that hiring post was a whole masterclass haha. Curious, who's the lucky next hire?"
      }
    },
    profileRubric: [
      { key: "headline", label: "Headline", weight: 20, criteria: "Does it say who you help or the role you want, your niche, and one concrete result?" },
      { key: "about", label: "About", weight: 15, criteria: "Does the first 3 lines hook with the problem you solve, prove it with 2-3 quantified wins, and end with a clear next step?" },
      { key: "experience", label: "Experience", weight: 15, criteria: "Do roles show outcomes with numbers (XYZ formula) instead of just listing job duties?" },
      { key: "featured", label: "Featured", weight: 10, criteria: "Is there a case study, portfolio piece, top post, or booking link pinned up front?" },
      { key: "proof", label: "Proof", weight: 10, criteria: "Are there specific numbers, client/company names, recommendations, and credible outcomes?" },
      { key: "banner", label: "Banner", weight: 10, criteria: "Does the 1584x396 cover image clearly communicate what you do and who you serve?" },
      { key: "photo", label: "Photo", weight: 5, criteria: "Is the profile photo clear, close-up, well-lit, and approachable?" },
      { key: "activity", label: "Activity", weight: 5, criteria: "Are you visibly posting or leaving thoughtful comments where your target audience hangs out?" },
      { key: "skills", label: "Skills", weight: 5, criteria: "Are top skills aligned with the keywords recruiters or buyers search for?" },
      { key: "contact", label: "Contact", weight: 5, criteria: "Can someone reach you or book a call in one click?" }
    ],
    resumePlaybook: {
      formula: "Google XYZ Formula: Accomplished [X], as measured by [Y], by doing [Z].",
      rules: [
        "Never invent employers, titles, dates, degrees, or metrics. Use [X%] or [N] placeholders where the user needs to fill in real numbers.",
        "Keep layout strictly one-column and ATS-friendly with standard headings: Summary, Skills, Experience, Projects, Education, Certifications.",
        "Match exact keywords from the job description where the candidate genuinely has the experience."
      ],
      sections: [
        { key: "impact", label: "Impact & XYZ Bullets" },
        { key: "keywords", label: "Keyword & Role Match" },
        { key: "summary", label: "Summary & Positioning" },
        { key: "ats", label: "ATS Structure & Clarity" },
        { key: "proof", label: "Metrics & Credibility" }
      ]
    },
    industryPlaybooks: {
      job_seeker: {
        role: "Job seeker",
        summary: "Get hiring managers and recruiters to reply by leading with their work, tailoring your resume with the XYZ formula, and reaching out within 24 hours of applying.",
        openerFramework: "1. Reference a specific project, launch, or post from the hiring manager or team.\n2. Connect one relevant win from your background in half a sentence.\n3. Ask one thoughtful question about what the team is shipping next (hold the ask for a referral/interview until they reply).",
        replyFramework: "Answer their question directly, share one quantified example of similar work, and offer to send your tailored resume or hop on a 10-minute intro call.",
        sampleOpener: [
          "Dana, 4.1s to 1.6s on checkout is a huge win for a page that busy.",
          "Curious, what's the team shipping next now that it's fast?"
        ]
      },
      founder: {
        role: "Founder",
        summary: "Win customers, investors, and key hires by leading with curiosity about how they operate today before ever mentioning your product.",
        openerFramework: "1. Praise a specific metric, decision, or lesson they shared publicly.\n2. Ask one low-friction question about how they handle that problem today.\n3. Never pitch or drop a link in the first message.",
        replyFramework: "Acknowledge their answer, share one insight from what you're seeing across similar teams, and ask if they're open to swapping notes or seeing how you solved it.",
        sampleOpener: [
          "Chris, rebuilding onboarding in public is a bold move, and half is a number most teams hide.",
          "Curious, what's the first thing a new trial sees right after signup?"
        ]
      },
      sales: {
        role: "Sales or BD",
        summary: "Book more meetings by turning real trigger events (promotions, hiring sprees, funding, posts) into short, insider-level conversations.",
        openerFramework: "1. Congratulate or reference a real trigger event (new role, team growth, recent post).\n2. Ask what sits at the top of their priority list in this phase.\n3. Keep it under 35 words with zero sales jargon.",
        replyFramework: "Mirror their priority, validate the bottleneck, and offer a specific benchmark or 15-minute walkthrough only once intent is clear.",
        sampleOpener: [
          "Congrats on Head of People, Priya. Doubling a team in a year is no small thing.",
          "Curious, what's first on your list in the new role?"
        ]
      },
      recruiter: {
        role: "Recruiter",
        summary: "Get top candidates and hiring leaders to reply by showing you actually read their work and holding the pitch until they show interest.",
        openerFramework: "1. Call out a concrete achievement or launch from their profile/posts.\n2. Ask what kind of scope or challenge they'd want to own next (for candidates) or where their biggest hiring bottleneck is (for clients).",
        replyFramework: "Share the 2-sentence highlight of the role/talent and ask if they're open to a quick 10-minute chat this week.",
        sampleOpener: [
          "Alex, three launches in a year is a serious pace, congrats to you and the team.",
          "Curious, what kind of launch would you want to own next?"
        ]
      },
      consultant: {
        role: "Consultant or coach",
        summary: "Fill your calendar with discovery calls by leading with helpful diagnostics, free profile audits, and problem-first conversations.",
        openerFramework: "1. Spot something specific in their post or profile.\n2. Offer a genuine observation without diagnosing unsolicited problems.\n3. End with an easy question about their current focus.",
        replyFramework: "Share one actionable tip or offer a quick audit/resource, then invite them to book a call when they ask how your program works.",
        sampleOpener: [
          "Maya, your point on first-time managers struggling with 1:1s is spot on.",
          "Curious, are you seeing that more with remote teams or hybrid ones right now?"
        ]
      },
      freelancer: {
        role: "Freelancer or agency",
        summary: "Win projects and retainers by reaching out to teams launching something new and showing relevant proof instead of generic cold pitches.",
        openerFramework: "1. Compliment a recent launch, redesign, or campaign.\n2. Ask one question about what they're building or testing next.",
        replyFramework: "Share 1-2 relevant examples from past clients and offer to send over 2 quick ideas tailored to their page/product.",
        sampleOpener: [
          "Saw the new landing page launch, Jordan — super clean hero section.",
          "Curious, are you guys testing new onboarding flows next or focused on top-of-funnel?"
        ]
      },
      other: {
        role: "Professional",
        summary: "Grow a high-trust LinkedIn network by starting genuine conversations around shared work and insights.",
        openerFramework: "1. Mention a specific takeaway from their post or career path.\n2. Ask an open question they'll enjoy answering.",
        replyFramework: "Keep the exchange natural, share your perspective concisely, and suggest staying in touch or hopping on a quick coffee chat.",
        sampleOpener: [
          "Really enjoyed your breakdown on product velocity this week.",
          "Curious, what changed your mind most on that over the last year?"
        ]
      }
    }
  };

  fs.writeFileSync(path.join(DATA_DIR, "playbook.json"), JSON.stringify(playbookData, null, 2));
  console.log("  ✓ Saved data/playbook.json");

  if (token) {
    console.log(`[4/4] Authenticated token provided! Fetching user-specific data (/v1/me, /v1/training, /v1/referral)...`);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const [me, training, referral] = await Promise.all([
      fetch(`${UPSTREAM_API}/v1/me`, { headers }).then((r) => r.json()).catch(() => null),
      fetch(`${UPSTREAM_API}/v1/training`, { headers }).then((r) => r.json()).catch(() => null),
      fetch(`${UPSTREAM_API}/v1/referral`, { headers }).then((r) => r.json()).catch(() => null),
    ]);
    fs.writeFileSync(path.join(DATA_DIR, "upstream_user_snapshot.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), me, training, referral }, null, 2));
    console.log("  ✓ Saved data/upstream_user_snapshot.json");
  } else {
    console.log(`[4/4] Tip: Pass an auth token (node scripts/sync-upstream.mjs <TOKEN>) to also snapshot authenticated user data.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
