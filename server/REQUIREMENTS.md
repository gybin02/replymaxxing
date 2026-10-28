# ReplyMaxxing 后端服务 (Cloudflare Workers) 需求与技术规范文档

> **文档版本**：v1.0.0  
> **服务定位**：ReplyMaxxing Chrome 扩展程序（v2.5.7+）的全托管无服务器云端 API 引擎  
> **运行环境**：Cloudflare Workers (Edge Runtime) + Cloudflare D1 (SQL) + Cloudflare KV  

---

## 1. 架构概览与技术选型

### 1.1 总体架构

```
┌────────────────────────────────────────────────────────┐
│             Chrome Extension (replymaxxing_src)        │
│       (sidepanel.js / background.js / content.js)      │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS (Bearer JWT / JSON)
                            ▼
┌────────────────────────────────────────────────────────┐
│         Cloudflare Workers API Gateway (Hono.js)       │
├───────────────────────────┬────────────────────────────┤
│ 模块路由:                 │ 核心能力集成:              │
│  - /v1/auth/* (OTP认证)   │  - AI Gateway (OpenAI/     │
│  - /v1/draft (核心创作)   │    Claude/Gemini/DeepSeek) │
│  - /v1/analyze (主页诊断) │  - 邮件服务 (Resend API)   │
│  - /v1/resume/* (简历定制)│  - 支付计费 (Stripe API)   │
│  - /v1/voice & playbook   │  - 静态页面 (/terms, /privacy)
└─────────────┬───────────────────────────┬──────────────┘
              │                           │
              ▼                           ▼
┌──────────────────────────┐ ┌───────────────────────────┐
│ Cloudflare KV (临时存储) │ │ Cloudflare D1 (关系型数据库)│
│  - 邮箱 6 位验证码 (TTL) │ │  - users / accounts / usage│
│  - 频率限制计数器 (Rate) │ │  - profiles / playbooks   │
│  - 会话黑名单 (Revoked)  │ │  - referrals / telemetries│
└──────────────────────────┘ └───────────────────────────┘
```

### 1.2 选型明细

| 层次 | 选型 | 说明 |
| :--- | :--- | :--- |
| **运行时** | Cloudflare Workers | 全球边缘低延迟冷启动为零，原生支持 Web API 规范 |
| **Web 框架** | **Hono** (`hono/tiny`) | 专为 Workers 设计的超轻量路由框架，内置 CORS、JWT、Body Validator 中间件 |
| **主数据库** | **Cloudflare D1** (SQLite-compatible) | 边缘原生 Serverless 关系型数据库，管理用户、订阅、使用配额、画像等持久化数据 |
| **缓存/临时凭证** | **Cloudflare KV** | 存储 5~10 分钟 TTL 验证码、Rate Limit 计数器 |
| **大模型接入** | OpenAI API / Gemini 1.5 Pro / Claude 3.5 Sonnet / Workers AI | 统一抽象 `LLMService`，负责 System Prompt 组装、语气微调、结构化 JSON/Markdown 输出 |
| **邮件投递** | **Resend** (REST API) | 无密码登录 6 位验证码发送，到达率高且简单易配 |
| **支付计费** | **Stripe** (Checkout + Customer Portal + Webhooks) | 处理按月订阅（Pro / Autopilot）、加油包（Top-up）与试用期管理 |

---

## 2. 数据库设计 (Cloudflare D1 Schema)

```sql
-- 1. 用户核心表
CREATE TABLE users (
    id TEXT PRIMARY KEY,                       -- 用户 UUID
    email TEXT UNIQUE NOT NULL,                -- 用户邮箱
    role TEXT NOT NULL DEFAULT 'owner',        -- 'owner' | 'member'
    stripe_customer_id TEXT,                  -- Stripe 客户 ID
    referral_code TEXT UNIQUE NOT NULL,        -- 该用户的专属邀请码 (如 MAX88X)
    referred_by TEXT,                          -- 推荐人邀请码
    terms_version TEXT DEFAULT '2026-01-01',   -- 用户已签署的协议版本
    terms_accepted_at INTEGER,                 -- 签署时间戳
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. 账户与订阅状态表 (一对一绑定或团队共享)
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,                       -- 账户 ID (默认等于 owner user_id)
    owner_id TEXT NOT NULL,                    -- 所有者 user_id
    plan TEXT NOT NULL DEFAULT 'free',         -- 'free' | 'pro' | 'autopilot' | 'founding' | 'managed'
    plan_name TEXT NOT NULL DEFAULT 'Free',
    status TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'past_due' | 'canceled' | 'trialing'
    trial_eligible INTEGER NOT NULL DEFAULT 1, -- 1 是，0 否
    trial_days INTEGER NOT NULL DEFAULT 5,     -- 试用天数
    trial_end INTEGER,                         -- 试用结束时间戳
    period_end INTEGER,                        -- 当前计费周期结束/重置时间戳
    is_free INTEGER NOT NULL DEFAULT 1,        -- 是否免费版
    has_playbook INTEGER NOT NULL DEFAULT 0,   -- 是否已构建个性化 Playbook
    features_json TEXT,                        -- JSON: {"canTopup": true, "autopilot": false, ...}
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 3. 使用配额与额度表 (usage)
CREATE TABLE usage (
    account_id TEXT PRIMARY KEY,
    drafts_used INTEGER NOT NULL DEFAULT 0,    -- 已消耗的 credit 数量
    draft_limit INTEGER NOT NULL DEFAULT 15,   -- 当前周期总额度 (免费版默认 15，Pro 默认 300)
    conversations_used INTEGER DEFAULT 0,      -- 托管模式对话数
    conversation_limit INTEGER DEFAULT 0,
    minutes_saved INTEGER NOT NULL DEFAULT 0,  -- 累计为用户节省的预估分钟数
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- 4. 用户 LinkedIn 画像与偏好 (profile & about)
CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'other',        -- 'job_seeker' | 'founder' | 'sales' | 'recruiter' | 'consultant' | 'other'
    name TEXT,                                 -- 用户 LinkedIn 姓名
    titles TEXT,                               -- 当前头衔 / 关注职位
    target_role TEXT,                          -- 求职者目标岗位
    offer TEXT,                                -- 创始人/销售的服务与产品方案
    goals_json TEXT,                           -- JSON 数组: ["Find a job", "Build network"]
    about_text TEXT,                           -- 结构化生成的 About 摘要
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 5. 语气微调与知识库规则 (voice & training)
CREATE TABLE user_training (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,                        -- 'rule' | 'sample' | 'playbook'
    content TEXT NOT NULL,                     -- 规则文本或示例文本
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 6. 埋点与客户端崩溃告警 (telemetry)
CREATE TABLE telemetries (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    lang TEXT,
    version TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
);
```

---

## 3. API 接口详细规格与契约

所有 API 前缀为 `/v1`。  
请求响应均为 `application/json`。  
私有接口必须在 Header 携带：`Authorization: Bearer <JWT_TOKEN>`。

### 3.1 认证与会话模块 (Auth)

#### 1. 发送邮箱验证码
* **接口**：`POST /v1/auth/start`
* **鉴权**：公开
* **请求体**：
  ```json
  { "email": "user@example.com" }
  ```
* **逻辑**：
  1. 校验邮箱合法性。
  2. 生成 6 位随机数字验证码。
  3. 写入 Cloudflare KV (`key: "otp:" + email`, `value: code`, `ttl: 600` 秒)。
  4. 调用 Resend 邮件 API 向目标邮箱下发验证邮件。
* **响应**：
  ```json
  { "ok": true }
  ```

#### 2. 核验验证码并登录/注册
* **接口**：`POST /v1/auth/verify`
* **鉴权**：公开
* **请求体**：
  ```json
  {
    "email": "user@example.com",
    "code": "123456",
    "acceptTerms": true,
    "ref": "FRIEND88" // 可选邀请码
  }
  ```
* **逻辑**：
  1. 核验 KV 中的验证码，匹配则销毁该 KV。
  2. 检查 `users` 表，如果不存在则自动注册：
     - 创建 `user` 记录并生成唯一邀请码。
     - 若携带 `ref` 邀请码且有效，建立邀请绑定关系。
     - 初始化 `accounts` 记录（默认给予 5 天试用或 Free 计划）。
     - 初始化 `usage` 记录（默认赠送额度）。
  3. 签发 JWT Token（有效期 30 天）。
* **响应**：
  ```json
  {
    "ok": true,
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "me": {
      "email": "user@example.com",
      "role": "owner",
      "terms": { "accepted": true, "version": "2026-01-01" },
      "account": {
        "plan": "free",
        "planName": "Free Trial",
        "free": true,
        "trialing": true,
        "trialEligible": true,
        "trialDays": 5,
        "trialEnd": 1793280000000,
        "periodEnd": 1793280000000,
        "hasPlaybook": false,
        "profile": {},
        "features": { "canTopup": true, "autopilot": false },
        "usage": {
          "drafts": 0,
          "draftLimit": 25,
          "minutesSaved": 0
        }
      }
    }
  }
  ```

#### 3. 获取个人信息 (状态同步)
* **接口**：`GET /v1/me`
* **鉴权**：Bearer Token
* **响应**：
  ```json
  {
    "ok": true,
    "me": { /* 同上的完整用户对象 */ }
  }
  ```

#### 4. 退出登录
* **接口**：`POST /v1/auth/logout`
* **鉴权**：Bearer Token
* **响应**：`{ "ok": true }`

#### 5. 同意用户协议变更
* **接口**：`POST /v1/terms/accept`
* **请求体**：`{ "accept": true, "version": "2026-01-01" }`
* **响应**：`{ "ok": true, "me": { ... } }`

---

### 3.2 用户画像与个性化语气 (Profile, Voice & Training)

#### 1. 保存个人主页配置
* **接口**：`PUT /v1/profile`
* **请求体**：
  ```json
  {
    "profile": {
      "role": "job_seeker",
      "name": "Alex Zhang",
      "titles": "Frontend Engineer",
      "targetRole": "Staff Software Engineer",
      "goals": ["Land an interview", "Grow network"]
    },
    "about": "Alex Zhang is a Frontend Engineer specializing in..."
  }
  ```
* **响应**：`{ "ok": true, "me": { ... } }`

#### 2. 生成与构建个性化 Playbook (行业策略文案库)
* **接口**：`POST /v1/playbook`
* **请求体**：`{ "about": "..." }`
* **逻辑**：LLM 分析用户的领域和定位，输出一套定制化的互动钩子、破冰开场白框架和价值主张。
* **响应**：`{ "ok": true, "text": "## Playbook\n..." }`
* **接口**：`PUT /v1/playbook` (保存更新)：`{ "text": "..." }` -> `{ "ok": true }`

#### 3. 个性化语气训练 (Voice Build & Preview)
* **接口**：`POST /v1/voice/build`
* **请求体**：
  ```json
  {
    "describe": "Direct, conversational, witty, concise",
    "picks": ["Clear", "Punchy", "No buzzwords"],
    "samples": "Here is a post I wrote: ..."
  }
  ```
* **响应**：
  ```json
  {
    "ok": true,
    "summary": "Your voice is punchy, high-signal and friendly.",
    "rules": [
      "Keep opening sentences under 10 words.",
      "Never use buzzwords like 'synergy' or 'game-changer'.",
      "End with an open low-friction question."
    ]
  }
  ```
* **接口**：`POST /v1/voice/preview` -> 返回根据当前语气规则生成的示例私信 `{ "ok": true, "prospect": "Sarah (VP Engineering)", "lines": [...] }`。
* **接口**：`GET /v1/training` 与 `PUT /v1/training` -> 查询/批量覆盖语气和样本规则。

---

### 3.3 核心 AI 生成引擎 (AI & Drafting)

#### 1. 智能草稿生成 (`/v1/draft`)
* **接口**：`POST /v1/draft`
* **请求体**：
  ```json
  {
    "mode": "opener" | "reply" | "comment" | "post" | "remix",
    "messages": [
      { "role": "user", "content": "..." }
    ],
    "threadKey": "thread:12345:alex",
    "batch": false
  }
  ```
* **后端处理流程**：
  1. 额度校验：检查 `usage.drafts_used < usage.draft_limit`，超出则返回 `{ "ok": false, "code": "limit", "error": "You've used your credits for this period." }`。
  2. 提取当前用户的：`profile`、`about`、`training rules` 与 `playbook`。
  3. 拼接 System Prompt，强制要求大模型按照插件前端指定的格式输出：
     - 若 `mode === 'reply'`：头部包含 `REPLY`，附带 `STAGE: ...`，`WHERE: ...`，`NEXT: ...` 等指导建议；
     - 若 `mode === 'comment'`：头部包含 `COMMENT`；
     - 若 `mode === 'opener'`：头部包含 `OPENER`。
  4. 扣减 1 点额度并增加 `minutes_saved`（每条草稿增加约 3 分钟）。
* **响应**：
  ```json
  {
    "ok": true,
    "text": "STAGE: Engaged\nWHERE: Expressed interest in scaling architecture\nNEXT: Suggest a brief 15 min call\n\nREPLY:\nThanks for sharing the insights on microfrontends! We saw similar patterns...",
    "usage": {
      "drafts": 1,
      "draftLimit": 25,
      "minutesSaved": 3
    }
  }
  ```

#### 2. 主页深度打分诊断 (`/v1/analyze`)
* **接口**：`POST /v1/analyze`
* **请求体**：
  ```json
  {
    "text": "Alex Zhang\nStaff Software Engineer...",
    "subject": "self" | "other",
    "name": "Alex Zhang",
    "role": "job_seeker",
    "goals": ["Find senior roles"],
    "auto": true,
    "images": {
      "banner": { "media_type": "image/jpeg", "data": "base64..." },
      "photo": { "media_type": "image/jpeg", "data": "base64..." }
    }
  }
  ```
* **逻辑**：
  - 调用多模态大模型（如 GPT-4o 或 Gemini 1.5 Pro）综合分析个人资料文字、排版、头像亲和力、Banner 传达力。
  - 消耗 2 点额度。
* **响应**：
  ```json
  {
    "ok": true,
    "score": 82,
    "grade": "B+",
    "summary": "Strong technical depth, but your headline lacks business impact.",
    "role": "job_seeker",
    "goal": "Find senior roles",
    "auto": true,
    "sections": [
      { "name": "Headline", "score": 75, "advice": "Add measurable impact." },
      { "name": "About", "score": 88, "advice": "Great storytelling, add tech keywords." },
      { "name": "Banner & Visuals", "score": 80, "advice": "Banner matches your niche well." }
    ],
    "topFixes": [
      "Incorporate key metrics into your recent job bullets",
      "Clarify your target role in the first 3 lines of your About section"
    ],
    "rubric": { ... },
    "usage": { ... }
  }
  ```

#### 3. Max AI 助手对话 (`/v1/ask`)
* **接口**：`POST /v1/ask`
* **请求体**：`{ "messages": [...], "context": { ... } }`
* **响应**：`{ "ok": true, "reply": "...", "usage": { ... } }`

#### 4. 爆款灵感与动态趋势 (`/v1/ideas` & `/v1/trends`)
* **`POST /v1/ideas`**：接收 Prompt/Theme，生成 6 个具备 Attract/Engage/Convert 策略的帖子创意 `{ "ok": true, "ideas": [...] }`。
* **`POST /v1/trends`**：接收用户 feed 帖子样本与关注领域，提炼当前 3~5 个高互动趋势与切入点 `{ "ok": true, "trends": [...], "feed": [...], "web": [...] }`。

#### 5. 横幅文案生成 (`/v1/banner`)
* **接口**：`POST /v1/banner`
* **请求体**：`{ "who": "...", "serve": "...", "result": "...", "link": "...", "forOther": false }`
* **响应**：`{ "ok": true, "options": [ { "headline": "...", "subhead": "...", "tagline": "..." } ] }`

---

### 3.4 求职者专用模块 (Jobs & Resume)

#### 1. PDF 简历智能解析 (`/v1/resume/parse`)
* **接口**：`POST /v1/resume/parse`
* **请求体**：`{ "file": { "media_type": "application/pdf", "data": "base64..." } }`
* **响应**：`{ "ok": true, "text": "Parsed plain resume text..." }`

#### 2. 简历针对岗位量身定制 (`/v1/resume/tailor`)
* **接口**：`POST /v1/resume/tailor`
* **请求体**：
  ```json
  {
    "resume": "原始简历文本...",
    "job": {
      "title": "Senior Frontend Engineer",
      "company": "Stripe",
      "description": "岗位职责与要求..."
    },
    "jobKey": "job:stripe:123",
    "notes": "Highlight React & Web Performance"
  }
  ```
* **响应**：
  ```json
  {
    "ok": true,
    "resume": "定制后的完整简历文本...",
    "match": {
      "before": 62,
      "after": 89,
      "keywordsAdded": ["TypeScript", "Distributed Systems", "Core Web Vitals"]
    },
    "fillIns": ["Achieved [X%] performance improvement"],
    "gaps": [
      { "gap": "GraphQL experience", "advice": "Mention your work with Apollo or BFF APIs." }
    ],
    "changes": ["Rewrote lead engineer bullet points using XYZ format"],
    "nextCost": 5,
    "usage": { ... }
  }
  ```

#### 3. 简历 ATS 招聘官视角打分 (`/v1/resume/score`)
* **接口**：`POST /v1/resume/score`
* **请求体**：`{ "resume": "...", "target": "Tech Lead" }`
* **响应**：`{ "ok": true, "score": 85, "gaps": [...], "recommendations": [...], "usage": { ... } }`

#### 4. 挖掘 Hiring Manager / Recruiter 联系策略 (`/v1/jobs/contacts`)
* **接口**：`POST /v1/jobs/contacts`
* **请求体**：`{ "job": { "title": "...", "company": "...", "team": [...] }, "resume": "..." }`
* **响应**：输出建议触达的角色、理由以及针对该岗位的定制破冰私信模板。

#### 5. 晨间岗位雷达 (`/v1/alerts`)
* **接口**：`POST /v1/alerts`
* **请求体**：`{}`
* **响应**：根据用户 `targetRole`，通过大模型及网络搜索结果提炼当天最新匹配的招聘动态与建议。

---

### 3.5 商业化与订阅计费 (Stripe Billing)

#### 1. 套餐列表查询 (`GET /v1/plans`)
* **响应**：
  ```json
  {
    "ok": true,
    "plans": [
      {
        "id": "pro",
        "name": "Pro",
        "priceLabel": "$29/mo",
        "trialDays": 5,
        "cta": "buy",
        "highlight": true,
        "features": ["Unlimited drafing assistance", "Profile audit & PDF export", "Resume tailor (ATS standard)"]
      },
      {
        "id": "autopilot",
        "name": "Autopilot",
        "priceLabel": "$59/mo",
        "trialDays": 5,
        "cta": "buy"
      }
    ],
    "topups": [
      { "kind": "drafts", "label": "250 credits · $10" }
    ]
  }
  ```

#### 2. 发起订阅结账 (`POST /v1/checkout`)
* **请求体**：`{ "plan": "pro" }`
* **逻辑**：创建 Stripe Checkout Session，注入 `client_reference_id = user.id`，成功 URL 返回插件欢迎/激活页。
* **响应**：`{ "ok": true, "url": "https://checkout.stripe.com/c/pay/..." }`

#### 3. 加油包增购 (`POST /v1/topup`)
* **请求体**：`{ "kind": "drafts" }`
* **响应**：`{ "ok": true, "url": "https://checkout.stripe.com/c/pay/topup..." }`

#### 4. 客户账单门户 (`POST /v1/portal`)
* **响应**：`{ "ok": true, "url": "https://billing.stripe.com/p/session/..." }`

#### 5. Stripe Webhook 处理器 (`POST /v1/stripe/webhook`)
* **监听事件**：
  - `checkout.session.completed`：为用户开通套餐或增加加油包额度。
  - `customer.subscription.updated`：更新计费周期 `period_end` 或套餐升降级。
  - `customer.subscription.deleted`：降级为 `free` 计划。
  - `invoice.payment_failed`：将状态置为 `past_due`。

---

### 3.6 杂项与法律页面

* `POST /v1/telemetry`：记录前端轻量事件/崩溃日志。
* `GET /terms`：返回 HTML 格式的《服务条款》（包含免责声明：不隶属于 LinkedIn，最终由用户按发送）。
* `GET /privacy`：返回 HTML 格式的《隐私政策》（说明数据保护及不留存敏感密码）。

---

## 4. 安全防护与边缘中间件设计

1. **CORS 严格过滤**：
   - 允许来自 Chrome 扩展特有源的跨域请求：`chrome-extension://<EXTENSION_ID>`。
   - 允许开发模式下的本地起源。
2. **鉴权与 JWT 保护**：
   - 采用标准 HMAC-SHA256 算法，密钥存储于 Cloudflare Secrets (`JWT_SECRET`)。
   - Token 失效返回 HTTP 401，促使扩展自动重置登录态。
3. **配额保护与模型限流 (Quota Limiting)**：
   - 针对免费版用户限制每日/每月最大调用频次。
   - 针对 AI 端点（`/v1/draft`, `/v1/analyze`, `/v1/resume/tailor`）实施分布式防刷限制。
4. **LLM 结构化输出安全注入防御**：
   - 对来自用户输入（如 LinkedIn 评论文本）进行 Prompt 隔离包裹，防止 Prompt 注入越狱。

---

## 5. 项目部署结构规划

```text
server/
├── wrangler.toml              # Cloudflare Workers 部署配置 (D1绑定、KV绑定、路由变量)
├── package.json               # 依赖管理 (hono, stripe, resend)
├── schema.sql                 # D1 数据库初始化与迁移脚本
├── src/
│   ├── index.ts               # Hono 应用入口与全局中间件 (CORS, 错误处理)
│   ├── env.ts                 # 环境变量类型定义
│   ├── db/
│   │   ├── client.ts          # D1 数据库操作封装
│   │   └── queries.ts         # 常用 SQL 查询
│   ├── middleware/
│   │   ├── auth.ts            # Bearer JWT 鉴权中间件
│   │   └── quota.ts           # 额度检查与自动扣减中间件
│   ├── routes/
│   │   ├── auth.ts            # /v1/auth 登录认证
│   │   ├── me.ts              # /v1/me, /v1/terms
│   │   ├── profile.ts         # /v1/profile, /v1/training, /v1/voice
│   │   ├── ai.ts              # /v1/draft, /v1/analyze, /v1/ask, /v1/ideas
│   │   ├── jobs.ts            # /v1/resume/*, /v1/jobs/contacts, /v1/alerts
│   │   ├── billing.ts         # /v1/plans, /v1/checkout, /v1/portal, /v1/webhook
│   │   └── static.ts          # /terms, /privacy
│   └── services/
│       ├── llm.ts             # 大模型抽象服务 (OpenAI/Gemini/Claude)
│       ├── email.ts           # Resend 邮件发送服务
│       └── stripe.ts          # Stripe 支付与客户管理
└── README.md                  # 部署与配置说明
```
