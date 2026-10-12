# GitHub Pages 部署手册

> 目的：把 Daily-Health-Log 的**网页外壳**（HTML + CSS + JS）自动发布到 GitHub，
> 让你多一个**不依赖云开发额度**的访问入口。
> 写作日期：2026-10-12（Day 27）。所有结论均在当天对仓库实况核对过。

---

## 0. 一分钟结论（先看这个）

| 问题 | 答案 |
|---|---|
| GitHub 能部署这个项目吗 | **只能部署前端那一半**。后端（云函数 + PostgreSQL）搬不走 |
| 换过去能省钱吗 | **不能**。静态托管本周期花 **0 点**，98.7% 的额度烧在 PostgreSQL 上 |
| 那还值得做吗 | 值得，但理由不是省钱，是 **多一个入口**：① 没有腾讯云那个「页面访问提示」中间页 ② 云开发额度耗尽/环境销毁后，页面壳子还能打开 |
| 国内访问快吗 | **不快**。`github.io` 在中国大陆经常慢甚至打不开。所以**别把主站搬过去** |
| 推荐姿势 | **CloudBase 当主站，GitHub Pages 当镜像/演示/备份入口** |

---

## 1. 准备哪些文件与配置

### 1.1 要发布上去的（白名单）

| 文件 / 目录 | 说明 |
|---|---|
| `*.html` | `welcome.html` `index.html` `history.html` `trends.html` `checkin.html` |
| `assets/css/style.css` | 全部样式 |
| `assets/js/*.js` | 全部业务脚本 + `vendor/chart.umd.js` |
| `assets/img/splash-health.png` | 开屏插画 |
| `.nojekyll` | 空文件，关掉 GitHub Pages 的 Jekyll 处理（**必须加，否则可能白屏**） |

### 1.2 绝对不能发布上去的

| 文件 / 目录 | 为什么 |
|---|---|
| `check.html` | **内部检查台**，里面有「写入测试」按钮。自 `-010` 起就不在部署包里了，Pages 也必须排除 |
| `assets/js/check.js` | 只服务 `check.html`，一并排除 |
| `cloudfunctions/**` | 云函数源码、连接逻辑 |
| `db/*.sql`、`cloudbase/**` | 建表脚本与迁移 |
| `*.md`（全部文档） | PRD、契约、备份手册、记忆 —— 没必要变成可浏览网页 |
| `.workbuddy/**` | 已被 `.gitignore` 排除，含全部备份与工作记忆 |
| `.env` / `*.key` / `*.pem` | 任何密钥 |

> 这就是为什么要用 **Actions 白名单** 而不是「直接发布 main 分支根目录」——
> 直接发布会把上面整张表统统暴露成一个可浏览的网站。

### 1.3 已有的、本次新增的文件

| 文件 | 状态 |
|---|---|
| `.github/workflows/deploy-pages.yml` | **本次新增**，白名单发布流程 |
| `.github/workflows/` 目录 | 本次新增（此前仓库里没有 `.github`） |

---

## 2. 推荐托管方式：GitHub Pages（分支发布）

GitHub 上能托管静态站的免费方式有三种，对比如下：

| 方式 | 机制 | 适合你吗 |
|---|---|---|
| **GitHub Pages（分支发布）** | 把静态文件推到 `gh-pages` 分支，Pages 从该分支取内容 | ✅ **推荐**。免费、零配置服务器、和你的 git 流程天然贴合 |
| GitHub Pages（Actions artifact） | workflow 直接上传 artifact 部署 | 也行，但需要在 workflow 里多一步 `actions/deploy-pages`，且 Pages 没启用时该步骤会直接报错 |
| GitHub Releases + CDN | 把文件夹当附件发 Release | ❌ 不适合站点托管 |
| Cloudflare Pages / Netlify / Vercel | 连 GitHub 仓库自动构建 | ✅ 也推荐，**国内访问比 github.io 好**，但要多注册一家服务 |

**本次选择分支发布的理由**：workflow 只负责把文件推到 `gh-pages`，**这一步不需要 Pages 已启用也能跑成功**。你可以在 Actions 绿了之后再慢慢去设置里开启 Pages，中间不会出现「红色失败」的困惑。

---

## 3. 从提交代码到成功上线（6 步）

### 第 1 步：确认仓库是 public

- 打开 `https://github.com/Panky-pan/Daily-Health-Log`
- `Settings` → 拉到底 `Danger Zone` 上方可见可见性
- **GitHub Pages 免费版只对 public 仓库开放**（本次已核对：仓库为 public ✓）

### 第 2 步：把 workflow 提交并推送

本地已在 `D:\Projects\Daily-Health-Log` 目录下，**在 Git Bash 里执行**：

```
git add .github GITHUB_DEPLOY.md FLUTTER_ROADMAP.md && git commit -m "Day 27｜新增 GitHub Pages 自动发布流程与部署手册" && git push -u origin main
```

> 若报 `Failed to connect to github.com:443`：这是这台机器到 GitHub 的网络抖动，**隔一两分钟重试同一条命令**即可（10-12 实测过）。

### 第 3 步：看 Actions 是否变绿

- 打开 `https://github.com/Panky-pan/Daily-Health-Log/actions`
- 应出现一条名为 **「部署前端到 GitHub Pages」** 的记录
- 点进去 → 展开 `暂存白名单文件` 这一步，能看到 `===== 本次将发布以下文件 =====` 下面列出的清单
- **核对清单里没有 `check.html`**（这是最关键的一次人工检查）

### 第 4 步：开启 Pages（只需做一次）

- `Settings` → 左侧 `Pages`
- `Source` 选 **Deploy from a branch**
- `Branch` 选 **`gh-pages`**，目录选 **`/ (root)`**
- 点 `Save`

> 此时 `gh-pages` 分支已由 Actions 建好，下拉框里能直接选到。

### 第 5 步：等 1 分钟，访问

```
https://panky-pan.github.io/Daily-Health-Log/
```

- 首次生效约需 **1 分钟**，期间可能 404 —— 正常现象，刷新即可
- 若 404 持续超过 5 分钟：回 `Settings → Pages` 页面，那里会直接显示**当前站点的准确网址**，以它为准

### 第 6 步：修跨域（**不做这一步，页面能打开但存不进数据**）

GitHub Pages 的来源是 `https://panky-pan.github.io`，而云函数的白名单里现在**只有** CloudBase 托管域名和 `"null"`：

```js
// cloudfunctions/api-health/lib/config.js 现状
const ALLOWED_ORIGINS = [
  "https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com",
  "null",
];
```

名单外的来源会被 `originAllowed()` 直接挡成 **403**。所以必须加一行并**重新部署云函数**：

```js
const ALLOWED_ORIGINS = [
  "https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com",
  "https://panky-pan.github.io",   // ← 新增：GitHub Pages 来源
  "null",
];
```

改完用云函数部署工具更新 `api-health`（`updateFunctionCode`）。**代码提交不等于云函数已更新**，这一步是独立动作。

---

## 4. 上线后怎么验证

在 Pages 站点上按顺序走一遍：

| # | 动作 | 期望结果 |
|---|---|---|
| 1 | 打开站点根路径 | 直接进入「今日」页（见 §5 关于开屏页的说明） |
| 2 | F12 → Network，刷新 | 所有 `assets/**` 请求都是 **200**，没有 404 |
| 3 | 顶部导航逐页点一遍 | 今日 / 历史 / 趋势 / 首页 都能正常跳、样式不丢 |
| 4 | 打开控制台，看有无红色报错 | 应无 `Failed to fetch`、无 `CORS` 字样 |
| 5 | 试一次「保存目标」 | 请求 `PUT /api/settings` 返回 **200**；若 **403** → 第 6 步白名单没生效或云函数没重新部署 |
| 6 | 试一次「记录今天」 | 请求 `PUT /api/checkins/…` 返回 200 |
| 7 | 刷新页面 | 数据还在（若消失 = 又踩回「只写本地」的坑） |
| 8 | 直接在地址栏访问 `/Daily-Health-Log/check.html` | **应当 404** —— 证明内部检查台确实没被发布 |

---

## 5. 一个必须知道的取舍：开屏页会「变样」

Pages 的站点根路径 `/Daily-Health-Log/` 默认服务 `index.html`，而你的：

- `welcome.html` = 开屏页（「身体是革命的本钱」+ 主按钮）
- `index.html` = 今日打卡页

所以 **Pages 打开的首页会直接是「今日」页，跳过开屏**。这不是 bug，是入口规则决定的。

三个选项：

| 方案 | 做法 | 成本 |
|---|---|---|
| **A. 接受（本次默认）** | 镜像站直达今日页；想看开屏点导航里的「首页」 | **0** |
| B. 构建时复制 | 在 workflow 里让 `_site/index.html` = `welcome.html` | ❌ **不要这么做**：导航里「今日」链接指向的正是 `index.html`，覆盖后点「今日」会回到开屏，自相矛盾 |
| C. 源码改名 | 把 `welcome.html` 改名 `index.html`，今日页改名 `today.html`，同步改 5 个 html 的导航 + `welcome.js` 的跳转目标 | 中等，会动到 6 个文件 |

> 如果你希望**镜像站和主站体验完全一致**，走 C。但那是一次独立的小改造，建议单开一天做，别混在部署当天。

---

## 6. 常见注意事项与坑

| # | 坑 | 说明与处置 |
|---|---|---|
| 1 | **国内访问慢** | `github.io` 在大陆经常超时。**不要把主站搬过去**；日常打卡继续用 CloudBase 域名 |
| 2 | **更新有延迟** | push 后约 1 分钟才生效，可能看到旧页面。Ctrl+F5 强制刷新 |
| 3 | **别直发仓库根目录** | 会把云函数、SQL、全部文档变成可浏览网页。必须走白名单（本手册 §1.1） |
| 4 | **必须带 `.nojekyll`** | 不带的话 GitHub 会用 Jekyll 处理站点，可能忽略某些文件导致白屏 |
| 5 | **跨域 403** | 现象是页面能开、数据存不进。根因 = 白名单没加 `https://panky-pan.github.io`，或云函数没重新部署 |
| 6 | **目录大小写** | 网址里 `Daily-Health-Log` 的字母大小写要和仓库名严格一致，否则 404 |
| 7 | **免费软限制** | 站点 ≤ 1 GB、带宽 ≤ 100 GB/月、构建 ≤ 10 次/小时。你的站点约几 MB，远未触限 |
| 8 | **额度耗尽时的真相** | Pages 站**只能看静态壳子，记不了数据**（后端已停）。它能救「页面还在」，救不了「还能打卡」 |
| 9 | **安全模型一点没变** | `anon` 全权、RLS 未开、接口地址已公开 —— **换托管一个都解决不了**。这些留到二期登录一起处理 |
| 10 | **推送通道时通时不通** | 这台机器到 `github.com` 的 git 通道会间歇 502 / 443 超时。**失败先重试 1~2 次，隔几分钟再试** |
| 11 | **两个入口要同步** | 只改 CloudBase 忘了 Pages（或反之）会造成两边内容不一致。建议：**代码只改一处，两边都从 main 构建** |
| 12 | **`.workbuddy/` 已在 gitignore** | 备份与记忆不会进仓库，也不要手动加进来 |

---

## 7. 回滚 / 下线

| 想做什么 | 怎么做 |
|---|---|
| 临时停掉站点 | `Settings → Pages → Source` 改成 `None` → Save（`gh-pages` 分支保留，随时能再开） |
| 改回某个旧版本 | 本地 `git revert` 那个 commit → push → Actions 自动重发 |
| 彻底删除 | 删掉 `gh-pages` 分支 + 删掉 `.github/workflows/deploy-pages.yml` |
| 完全不影响主站 | 以上操作**都不影响** CloudBase 主站，两条链路互不干涉 |

---

## 8. 与 Flutter 的关系

GitHub Pages 只能发**网页**。Flutter 打出来的是**原生 App / 桌面程序**，不走这条路 ——
Windows 是 `.exe` 安装包、Android 是 `.apk`、iOS 要从 Mac 上发到 App Store。
两条线唯一的共同点是**共用同一套后端接口**（A1~A10）。详见 `FLUTTER_ROADMAP.md`。
