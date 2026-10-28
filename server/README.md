# ReplyMaxxing Cloudflare Worker 服务端

基于 **Cloudflare Workers + Hono + 本地 JSON 缓存 (`data/*.json`) + D1/内存双模存储** 实现的 ReplyMaxxing 完整服务端。

---

## 一、 已拉取并缓存的本地 JSON 数据 (`server/data/`)

所有原服务端公开接口、官网内置方法论及插件核心规则均已拉取并结构化缓存在 [`server/data/`](file:///Users/airbrush/Chrome/server/data) 目录下：

| 缓存文件 | 数据来源 | 内容说明 |
| :--- | :--- | :--- |
| [`data/plans.json`](file:///Users/airbrush/Chrome/server/data/plans.json) | 原接口 `GET /v1/plans` 实时拉取 | 包含 `Founding` ($15)、`Pro` ($29)、`Autopilot` ($59)、`Managed Inbox` ($397)、`Teams` ($25/seat)、`Free` 免费版及加油包 (`topups`) 的完整配置 |
| [`data/playbook.json`](file:///Users/airbrush/Chrome/server/data/playbook.json) | 插件 `playbook.js` + 原官网全量提取 | 包含：<br>1. `postPlaybook`（5 幕故事弧线 + 3 大阶段 + 18 种爆款帖子类型的完整规则）<br>2. `conversationPlaybook`（5 阶段私信推进模型 + 6 种语气风格示例）<br>3. `profileRubric`（10 项 LinkedIn 主页评分权重与诊断标准）<br>4. `resumePlaybook`（Google XYZ 简历公式与 ATS 规则）<br>5. `industryPlaybooks`（7 大角色：`job_seeker`、`founder`、`sales`、`recruiter`、`consultant`、`freelancer`、`other` 的预设行业 Playbook 与破冰范例） |
| [`data/legal.json`](file:///Users/airbrush/Chrome/server/data/legal.json) | 原接口 `/terms`, `/privacy`, `/welcome` | 原站完整的《服务条款》（Version `2026-10-14`）、《隐私政策》及插件安装欢迎页 HTML |

### 重新同步上游数据
如需随时从原官方接口重新拉取最新数据（若持有原接口 Bearer Token 也可一并传入抓取用户级数据快照）：
```bash
cd server
npm run sync-data
# 或传入原站登录 Token 抓取用户级数据：
node scripts/sync-upstream.mjs <YOUR_UPSTREAM_BEARER_TOKEN>
```

---

## 二、 本地启动与调试

1. **安装依赖**：
   ```bash
   cd server
   npm install
   ```
2. **启动本地 Worker 服务**（无需配置数据库即可通过内存模式直接运行，默认解锁 `Autopilot` 2,000 额度）：
   ```bash
   npm run dev
   # 服务运行在 http://127.0.0.1:8787
   ```
3. **登录验证码**：
   - 本地/自托管默认支持通用验证码 **`123456`**（或 `000000`），输入任意邮箱 + `123456` 即可直接登录并获得完整 `Autopilot` 权限与预设 Playbook。
4. **连接 Chrome 插件**：
   - 将 [`replymaxxing_src/config.js`](file:///Users/airbrush/Chrome/replymaxxing_src/config.js) 中的 `API_BASE` 改为 `"http://127.0.0.1:8787"`（或部署后的 Worker 地址）。

---

## 三、 配置大模型与生产部署

在 `server/.dev.vars`（本地）或通过 `wrangler secret put`（生产环境）配置：
```ini
LLM_API_KEY=sk-xxxx
# 可选：自定义兼容 OpenAI 的接口地址与模型（如 DeepSeek / Gemini / OpenRouter）
# LLM_BASE_URL=https://api.deepseek.com/v1
# LLM_MODEL=deepseek-chat
```

一键发布到 Cloudflare Workers：
```bash
npm run deploy
```
