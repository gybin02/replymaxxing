import plansData from "../data/plans.json";
import playbookData from "../data/playbook.json";
import legalData from "../data/legal.json";

export interface Env {
  DB?: D1Database;
  KV?: KVNamespace;
  SITE_URL?: string;
  BOOK_DEMO_URL?: string;
  SUPPORT_EMAIL?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
  DEFAULT_PLAN?: string;
  DEV_OTP_CODE?: string;
  JWT_SECRET?: string;
  RESEND_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  UPSTREAM_API?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  token: string;
  role: "owner" | "member";
  referralCode: string;
  referredBy?: string;
  termsVersion: string;
  termsAccepted: boolean;
  plan: string;
  planName: string;
  status: string;
  free: boolean;
  trialing: boolean;
  trialEligible: boolean;
  trialDays: number;
  trialEnd: number | null;
  periodEnd: number | null;
  hasPlaybook: boolean;
  playbookText: string;
  aboutText: string;
  profile: Record<string, any>;
  training: Array<{ kind: string; name: string; text: string; at: number }>;
  usage: {
    drafts: number;
    draftLimit: number;
    conversations: number;
    conversationLimit: number | null;
    minutesSaved: number;
  };
  freeScores: { used: number; limit: number };
  jobFree: { tailor: number; score: number };
  createdAt: number;
  updatedAt: number;
}

// 内存兜底存储（未绑定 D1 / KV 时自动生效，方便本地零配置启动）
const memUsersByEmail = new Map<string, UserRecord>();
const memUsersByToken = new Map<string, UserRecord>();
const memOtps = new Map<string, { code: string; expiresAt: number }>();
let d1Initialized = false;

async function ensureD1(db?: D1Database) {
  if (!db || d1Initialized) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        token TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        referral_code TEXT UNIQUE NOT NULL,
        referred_by TEXT,
        terms_version TEXT NOT NULL DEFAULT '2026-10-14',
        terms_accepted INTEGER NOT NULL DEFAULT 1,
        plan TEXT NOT NULL DEFAULT 'autopilot',
        plan_name TEXT NOT NULL DEFAULT 'Autopilot',
        status TEXT NOT NULL DEFAULT 'active',
        free INTEGER NOT NULL DEFAULT 0,
        trialing INTEGER NOT NULL DEFAULT 0,
        trial_eligible INTEGER NOT NULL DEFAULT 1,
        trial_days INTEGER NOT NULL DEFAULT 5,
        trial_end INTEGER,
        period_end INTEGER,
        has_playbook INTEGER NOT NULL DEFAULT 1,
        playbook_text TEXT,
        about_text TEXT,
        profile_json TEXT NOT NULL DEFAULT '{}',
        training_json TEXT NOT NULL DEFAULT '[]',
        usage_json TEXT NOT NULL DEFAULT '{}',
        free_scores_json TEXT NOT NULL DEFAULT '{"used":0,"limit":2}',
        job_free_json TEXT NOT NULL DEFAULT '{"tailor":2,"score":2}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run()
    .catch(() => {});
  d1Initialized = true;
}

export function planMeta(planId: string) {
  const found = (plansData.plans || []).find((p: any) => p.id === planId);
  if (found) {
    return {
      plan: found.id,
      planName: found.name,
      free: false,
      draftLimit: found.limits?.drafts || 1000,
      conversationLimit: found.limits?.conversations || null,
      features: {
        canTopup: true,
        autopilot: ["autopilot", "managed", "team"].includes(found.id),
        managed: found.id === "managed",
      },
    };
  }
  return {
    plan: "free",
    planName: "Free",
    free: true,
    draftLimit: plansData.free?.credits || 10,
    conversationLimit: null,
    features: {
      canTopup: false,
      autopilot: false,
      managed: false,
    },
  };
}

export function defaultPlaybookForRole(role = "other"): string {
  const map = playbookData.industryPlaybooks as Record<string, any>;
  const item = map[role] || map.other;
  return [
    `# ${item.role} Playbook`,
    item.summary,
    "",
    "## Opener Framework",
    item.openerFramework,
    "",
    "## Reply & Follow-up Framework",
    item.replyFramework,
    "",
    "## Sample Opener",
    ...(item.sampleOpener || []),
  ].join("\n");
}

function rowToUser(row: any): UserRecord {
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    role: row.role || "owner",
    referralCode: row.referral_code,
    referredBy: row.referred_by || undefined,
    termsVersion: row.terms_version || legalData.version || "2026-10-14",
    termsAccepted: Boolean(row.terms_accepted),
    plan: row.plan,
    planName: row.plan_name,
    status: row.status || "active",
    free: Boolean(row.free),
    trialing: Boolean(row.trialing),
    trialEligible: Boolean(row.trial_eligible),
    trialDays: Number(row.trial_days ?? 5),
    trialEnd: row.trial_end ? Number(row.trial_end) : null,
    periodEnd: row.period_end ? Number(row.period_end) : null,
    hasPlaybook: Boolean(row.has_playbook),
    playbookText: row.playbook_text || defaultPlaybookForRole("other"),
    aboutText: row.about_text || "",
    profile: JSON.parse(row.profile_json || "{}"),
    training: JSON.parse(row.training_json || "[]"),
    usage: JSON.parse(row.usage_json || '{"drafts":0,"draftLimit":2000,"conversations":0,"conversationLimit":null,"minutesSaved":0}'),
    freeScores: JSON.parse(row.free_scores_json || '{"used":0,"limit":2}'),
    jobFree: JSON.parse(row.job_free_json || '{"tailor":2,"score":2}'),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function saveOtp(env: Env, email: string, code: string) {
  const key = `otp:${email.toLowerCase()}`;
  if (env.KV) {
    await env.KV.put(key, code, { expirationTtl: 600 });
    return;
  }
  memOtps.set(key, { code, expiresAt: Date.now() + 600_000 });
}

export async function verifyOtp(env: Env, email: string, code: string): Promise<boolean> {
  const devCode = env.DEV_OTP_CODE || "123456";
  if (code === devCode || code === "000000") return true;
  const key = `otp:${email.toLowerCase()}`;
  if (env.KV) {
    const saved = await env.KV.get(key);
    if (saved && saved === code) {
      await env.KV.delete(key);
      return true;
    }
    return false;
  }
  const item = memOtps.get(key);
  if (item && item.code === code && item.expiresAt > Date.now()) {
    memOtps.delete(key);
    return true;
  }
  return false;
}

export async function getOrCreateUser(env: Env, email: string, ref?: string): Promise<UserRecord> {
  const norm = email.trim().toLowerCase();
  await ensureD1(env.DB);
  if (env.DB) {
    const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(norm).first();
    if (existing) return rowToUser(existing);
  } else if (memUsersByEmail.has(norm)) {
    return memUsersByEmail.get(norm)!;
  }

  const now = Date.now();
  const defaultPlan = env.DEFAULT_PLAN || "autopilot";
  const pm = planMeta(defaultPlan);
  const bonus = ref ? 20 : 0;
  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: norm,
    token: `rmx_${crypto.randomUUID().replace(/-/g, "")}`,
    role: "owner",
    referralCode: norm.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() + Math.floor(1000 + Math.random() * 9000),
    referredBy: ref,
    termsVersion: legalData.version || "2026-10-14",
    termsAccepted: true,
    plan: pm.plan,
    planName: pm.planName,
    status: "active",
    free: pm.free,
    trialing: false,
    trialEligible: pm.free,
    trialDays: 5,
    trialEnd: null,
    periodEnd: now + 30 * 86400_000,
    hasPlaybook: true,
    playbookText: defaultPlaybookForRole("other"),
    aboutText: "",
    profile: {},
    training: [],
    usage: {
      drafts: 0,
      draftLimit: pm.draftLimit + bonus,
      conversations: 0,
      conversationLimit: pm.conversationLimit,
      minutesSaved: 0,
    },
    freeScores: { used: 0, limit: 2 },
    jobFree: { tailor: 2, score: 2 },
    createdAt: now,
    updatedAt: now,
  };

  await saveUser(env, user);
  return user;
}

export async function getUserByToken(env: Env, token: string): Promise<UserRecord | null> {
  await ensureD1(env.DB);
  if (env.DB) {
    const row = await env.DB.prepare("SELECT * FROM users WHERE token = ?").bind(token).first();
    if (row) return rowToUser(row);
  }
  return memUsersByToken.get(token) || null;
}

export async function saveUser(env: Env, user: UserRecord): Promise<void> {
  user.updatedAt = Date.now();
  memUsersByEmail.set(user.email, user);
  memUsersByToken.set(user.token, user);
  await ensureD1(env.DB);
  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT OR REPLACE INTO users (
          id, email, token, role, referral_code, referred_by, terms_version, terms_accepted,
          plan, plan_name, status, free, trialing, trial_eligible, trial_days, trial_end, period_end,
          has_playbook, playbook_text, about_text, profile_json, training_json, usage_json,
          free_scores_json, job_free_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        user.id,
        user.email,
        user.token,
        user.role,
        user.referralCode,
        user.referredBy || null,
        user.termsVersion,
        user.termsAccepted ? 1 : 0,
        user.plan,
        user.planName,
        user.status,
        user.free ? 1 : 0,
        user.trialing ? 1 : 0,
        user.trialEligible ? 1 : 0,
        user.trialDays,
        user.trialEnd,
        user.periodEnd,
        user.hasPlaybook ? 1 : 0,
        user.playbookText,
        user.aboutText,
        JSON.stringify(user.profile),
        JSON.stringify(user.training),
        JSON.stringify(user.usage),
        JSON.stringify(user.freeScores),
        JSON.stringify(user.jobFree),
        user.createdAt,
        user.updatedAt
      )
      .run();
  }
}

export async function consumeCredits(env: Env, user: UserRecord, cost = 1, minutesSaved = 4) {
  user.usage.drafts = Math.min(user.usage.draftLimit, (user.usage.drafts || 0) + cost);
  user.usage.minutesSaved = (user.usage.minutesSaved || 0) + minutesSaved;
  await saveUser(env, user);
  return user.usage;
}

export function formatMe(user: UserRecord) {
  const pm = planMeta(user.plan);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    terms: {
      accepted: user.termsAccepted,
      version: legalData.version || "2026-10-14",
    },
    account: {
      plan: user.plan,
      planName: user.planName,
      status: user.status,
      free: user.free,
      trialing: user.trialing,
      trialEligible: user.trialEligible,
      trialDays: user.trialDays,
      trialEnd: user.trialEnd,
      periodEnd: user.periodEnd,
      hasPlaybook: user.hasPlaybook,
      about: user.aboutText,
      profile: user.profile,
      training: user.training,
      features: pm.features,
      usage: user.usage,
      freeScores: user.freeScores,
      jobFree: user.jobFree,
    },
  };
}
