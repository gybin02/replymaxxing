-- ReplyMaxxing Cloudflare D1 Database Schema

CREATE TABLE IF NOT EXISTS users (
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
  usage_json TEXT NOT NULL DEFAULT '{"drafts":0,"draftLimit":2000,"conversations":0,"conversationLimit":null,"minutesSaved":0}',
  free_scores_json TEXT NOT NULL DEFAULT '{"used":0,"limit":2}',
  job_free_json TEXT NOT NULL DEFAULT '{"tailor":2,"score":2}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetries (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  lang TEXT,
  version TEXT,
  created_at INTEGER NOT NULL
);
