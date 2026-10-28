# ReplyMaxxing - 插件源码分析与技术文档

> **ReplyMaxxing**：专为 LinkedIn 打造的 AI 智能僚机（AI Wingman for LinkedIn）。帮助求职者、创始人、招聘顾问及销售撰写破冰开场白、回复消息、创作爆款帖子、审计并打分个人主页、按个性语气定制简历。核心遵循 **“You press Send（最终由你发送）”** 的安全机制，彻底规避平台封号风险。

---

## 目录
- [一、 项目基本信息](#一-项目基本信息)
- [二、 目录结构与模块说明](#二-目录结构与模块说明)
- [三、 核心功能与技术实现](#三-核心功能与技术实现)
- [四、 认证系统与计费架构](#四-认证系统与计费架构)
- [五、 本地安装与开发调试](#五-本地安装与开发调试)
- [六、 二次开发与私有化改造指南](#六-二次开发与私有化改造指南)

---

## 一、 项目基本信息

* **扩展名称**：ReplyMaxxing
* **版本号**：`2.5.7`（Chrome Manifest V3 规范）
* **Chrome 网上应用店 ID**：[`cngnjcgjemhikeeikeheolijcgmdjkej`](https://chromewebstore.google.com/detail/replymaxxing/cngnjcgjemhikeeikeheolijcgmdjkej)
* **创建者/团队**：Brian Kwa（前 Google、YouTube、Uber 资深技术招聘官，MPH Tech Academy 创始人）
* **后端架构**：部署于 Cloudflare Workers (`https://replymaxxing-api.replymaxxing.workers.dev`)
* **技术栈**：纯原生 JavaScript (ES2022 Vanilla JS) + CSS3（Geist 字体设计风格），零构建依赖、零混淆

---

## 二、 目录结构与模块说明

```text
replymaxxing_src/
├── manifest.json       # MV3 配置文件：声明 sidePanel, storage, notifications 权限与域名匹配
├── config.js           # 客户端服务端配置（API_BASE, SITE_URL, 支持邮箱等）
├── background.js       # Service Worker：管理身份凭证、网络请求、晨间职位雷达、数据缓存
├── content.js          # LinkedIn 页面注入脚本：DOM 嗅探识别、UI 按钮注入、防封号安全插入
├── sidepanel.html/js   # Chrome 侧边栏主操作台（Max 对话、发帖、雷达、自动化与设置）
├── jobs-panel.js       # 求职者专用模块：职位卡片解析、简历上传管理、招聘联系人挖掘
├── resume.html/js      # 独立简历定制与 WYSIWYG 在线编辑器（支持纯本地导出 PDF 和 Word .docx）
├── resume.css          # 简历排版样式，专门适配打印与 A4 纸张排版
├── report.html/js      # LinkedIn 个人主页诊断打分报告生成器（支持导出 PDF）
├── report.css          # 主页诊断报告卡片与排版样式
├── banner.js           # HTML5 Canvas 纯前端实现的 1584x396 高清 LinkedIn 封面横幅生成器
├── playbook.js         # 内置爆款文案方法论（Attract / Engage / Convert 三阶段创作模板）
└── brand.css / sidepanel.css # 侧边栏与 UI 样式库
```

---

## 三、 核心功能与技术实现

### 1. 安全至上机制 (Human-in-the-Loop)
* 避免被 LinkedIn 官方风控封号，完全摒弃自动点击发信、自动批量发好友申请的黑产脚本设计。
* **DOM 文本注入**：在 [`content.js`](content.js) 中，通过 `document.execCommand("insertText")` 或原生 `InputEvent` 模拟真实输入，将文本填入输入框，绝不自动触发发送按钮。

### 2. 双重模式灵活切换
* **求职者模式 (Job Seeker)**：侧边栏自动展示 `Max`、`Jobs`、`Alerts`、`Radar`、`Profile`。
  * 自动识别招聘岗位中的硬性技能与痛点要求。
  * 一键改写简历，重构 Bullet Points 匹配 ATS 筛选标准。
  * 挖掘招聘经理 (Hiring Manager) 与 Recruiter，生成定制破冰私信。
* **商业拓展与获客模式 (Founder / Sales / Consultant)**：
  * 侧边栏展示 `Max`、`Posts`、`Radar`、`Autopilot`、`Profile`。
  * 依据爆款内容框架，快速创作高质量专业动态。
  * 监控客户动态，提供高转化率回复建议。

### 3. 本地化生产力工具集
* **LinkedIn 个人主页打分报告 (`report.html`)**：
  * 读取个人头像与背景图（经 `background.js` 转为 Base64）、标题 (Headline)、关于 (About) 和工作经历，给出 0~100 分综合得分及诊断建议，支持导出带水印/去水印的 PDF 报告。
* **Canvas 横幅设计器 (`banner.js`)**：
  * 无需 Photoshop 或 Figma，纯前端通过 HTML5 `<canvas>` 自动计算字体排版避让左下角头像区域，一键导出 1584x396 规格的高清横幅。
* **富文本简历编辑器 (`resume.html`)**：
  * 采用 `contenteditable="plaintext-only"` 实现所见即所得修改，数据保存在浏览器的 `chrome.storage.local`，保护隐私。

---

## 四、 认证系统与计费架构

### 1. 无密码邮箱体系 (`/v1/auth/*`)
* **发送验证码**：`POST /v1/auth/start` 接收 `{ email }`，服务端下发 6 位随机验证码至邮箱。
* **凭据换取**：`POST /v1/auth/verify` 校验验证码与用户协议状态，换取 JWT 授权令牌及用户资料对象 `me`。
* **本地持有**：Token 持久化在 `chrome.storage.local` 的 `auth` 键中，请求拦截器自动附加 `Authorization: Bearer <token>`。

### 2. Stripe 计费与订阅机制 (`/v1/checkout` & `/v1/portal`)
* **Stripe Hosted Checkout**：前端无需处理敏感支付凭证。发起支付时获取 Stripe Checkout 链接，在独立标签页打开。
* **智能状态轮询 (`pollForPlan`)**：侧边栏开启 5 秒定时器轮询 `/v1/me`。Stripe Webhook 处理完后，扩展自动感知套餐升级，立即解锁权限。
* **混合计费模式**：
  * **按月订阅**：Free Trial (5天试用)、Pro、Autopilot、Founding、Managed 等。
  * **加油包 (Top-up)**：点数用尽时支持一次性增购（如 250 点数 / $10）。

---

## 五、 本地安装与开发调试

1. **解压源码**：
   已提取至本地目录：`/Users/airbrush/Downloads/Chrome/replymaxxing_src`
2. **在 Chrome 中加载**：
   1. 浏览器访问：`chrome://extensions/`
   2. 打开右上角的 **「开发者模式」(Developer mode)**
   3. 点击左上角的 **「加载已解压的扩展程序」(Load unpacked)**
   4. 选择 `replymaxxing_src` 文件夹
3. **打开使用**：
   * 点击扩展栏图标或快捷键 `Alt+Shift+A`，即可在右侧展开侧边栏控制台。

---

## 六、 二次开发与私有化改造指南

由于源码 100% 为清晰的原生 JS，开发者可以非常轻松地进行维护或改造成自己的产品：

### 1. 修改后端接口地址
打开 [`config.js`](config.js)，将 `API_BASE` 修改为自己的后端服务地址：
```javascript
self.AB_CONFIG = {
  API_BASE: "https://your-custom-api.example.com",
  SITE_URL: "https://your-site.com",
  SUPPORT_EMAIL: "support@your-site.com",
};
```

### 2. 直连第三方大模型（免自建后端）
在 [`background.js`](background.js) 中，直接重写 `draft(msg)` 方法，调用 OpenAI、Anthropic Claude 或 Google Gemini 的官方接口：
```javascript
async function draft(msg) {
  // 直接读取本地设置的 API Key
  const { settings = {} } = await chrome.storage.local.get("settings");
  const apiKey = settings.customApiKey;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: msg.messages
    })
  });
  const data = await resp.json();
  return { ok: true, text: data.choices[0].message.content };
}
```
