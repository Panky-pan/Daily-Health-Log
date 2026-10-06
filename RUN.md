# 运行说明（RUN.md）

> Daily-Health-Log 是纯静态网页，没有任何依赖要装。两种打开方式任选。

## 方式一：本地服务器（推荐，地址栏是 localhost 开头）

1. 打开终端（Windows 可用 Git Bash 或 PowerShell），进入项目目录：
   ```bash
   cd D:\Projects\Daily-Health-Log
   ```
2. 启动 Python 自带的静态服务器（本机已装 Python 3.13）：
   ```bash
   python -m http.server 8000
   ```
3. 看到 `Serving HTTP at 0.0.0.0 port 8000` 类似输出后，浏览器打开：
   ```
   http://localhost:8000
   ```
4. 停止服务器：终端里按 `Ctrl + C`。

## 方式二：直接双击打开

双击项目根目录的 `index.html` 即可使用。两种方式读的是**同一份云端数据**（数据存在数据库里，不在本机），所以在哪台电脑打开，看到的都是同一批记录。

差异只有一处：双击打开时浏览器发的来源是 `null`，访问接口靠云端放行名单里对 `file://` 的兼容；如果网络不通，会先存在本机，等下次能连上时再同步。

## 常见问题

- **端口被占**：把 `8000` 换成 `8080` 等其他数字，地址栏同步改。
- **`python` 找不到命令**：试试 `py -m http.server 8000`。
- **换了浏览器数据没了**：不会——数据在云端数据库里，换浏览器、换电脑都一样。只有**断网时**新记的东西会先存在本机（页脚会提示「已存本机」），等能连上时再同步上去。

---

## 方式三：线上部署后的验证清单（2026-10-06）

> **最后更新时间：2026-10-06**
> 最近一次全项验证通过（健康状态 / 真实数据 / 写入 / 跨域白名单均实测）。
> 以后改了任何一端（前端或云函数），请重新跑一遍本节并更新这个日期。

数据现在存在云端（不是只存在本机），改完代码部署完，按下面逐项打勾。**每条命令都单行、含完整 URL，贴到终端执行**。

| 用途 | 地址 |
|---|---|
| 站点（发给别人看的） | `https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com` |
| 接口（页面背后调用的） | `https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com` |

### 第 1 项 · 健康状态（对应 A1）

**贴到浏览器地址栏**：

```
https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/health
```

✅ 应看到：`{"ok":true,"service":"daily-health-log-demo","time":"2026-10-06 10:38:47"}`

### 第 2 项 · 核心表真实数据（对应 A2 / A4）

**贴到浏览器地址栏**（把 checkins 换成 settings 可读目标设置）：

```
https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins?limit=5
```

✅ 应看到：`{"ok":true,"data":{"items":[...]}}`，里面是真实打卡记录（不是假数据）。
✅ 目标设置 `…/api/settings` 应看到 `"goalExerciseMinutes":30,"goalWaterMl":2000`。

**页面里验证**：打开 `history.html` → 点日历上任意有标记的日期 → 显示当天真实内容。
按 F12 → Console → 输入 `dhlApi.getResult()` → 应得 `{ok: true, count: N}`。
❌ 若得 `{ok: false, reason: ...}`，说明云端没连上，页面显示的是本机旧数据。

### 第 3 项 · 一次写入测试（对应 A6）

1. 打开 `checkin.html`
2. 填今天的记录（运动 + 时长、三餐、标签、体重、饮水）→ 点「**保存今日打卡**」
3. ✅ 应出现成功提示（不是红色报错，也不是「已存本机」）
4. 按 F5 刷新，记录还在

**硬核对**（贴到终端，证明真的写进云端而不是只存本机）：

```
curl -sS "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins?limit=400" -o d:/tmp-checkins.json -w "[HTTP %{http_code}]\n"
```

✅ 应回 `[HTTP 200]`，且 `d:/tmp-checkins.json` 里能找到刚存那天的 `date`。
（临时文件用完可删。）

### 第 4 项 · 跨域白名单（今天新增）

**贴到终端**：

```
curl -sS -w "\n[HTTP %{http_code}]\n" -H "Origin: https://evil.example" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/health"
```

✅ 应回 `[HTTP 403]` + 「这个来源不在允许名单里」——说明别的网站调不动这个接口。
去掉 `-H "Origin: ..."` 再跑一次，应回 `[HTTP 200]`（命令行不属名单管辖，便于排查）。

### 第 5 项 · 密钥与配置自查

| 检查什么 | 怎么看 | 合格标准 |
|---|---|---|
| 代码里有无硬编码密钥 | 看 `cloudfunctions/api-health/lib/db.js` | 只有环境 ID，**没有**任何 key/secret；凭证由平台注入的 `CLOUDBASE_APIKEY` 自动读取 |
| 提交里有无 `.env` | 仓库根目录 | 不存在 `.env`、不提交任何连接串 |
| 静态托管上放了什么 | 部署用的 `dist` 目录内容 | 只有网页文件，**不含** `.git/`、文档、云函数源码 |
| 前端有没有把密钥写进 js | `assets/js/api-source.js` | 只有接口地址（公开信息，不是密钥） |

### 第 6 项 · 发给同伴的验证说明

> 可直接复制转发：
>
> 这是我的健康打卡网页，已上线，麻烦帮我点一下看看能不能正常打开：
> **https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com**
>
> 请帮我做三件事：
> 1. 页面能不能打开，看到「每日健康打卡」四个字；
> 2. 点顶部「历史记录」，日历里点一下 10 月 1 号，看能不能翻出当天的记录；
> 3. 告诉我手机上看有没有挤在一起（我主要担心这个）。
>
> **提前说明（重要）**：这个站现在还没做登录，是单人使用阶段，
> 所以你打开会看到**我自己的打卡数据**（饮食、体重那些）。别改就行，改了会影响我。
> 另外提醒：网页本身不该出现「数据库连不上」「Failed to fetch」这类红字，
> 如果看到了，那是我这边的问题，麻烦截个图发我。

### 第 7 项 · 卡点速查（出问题时先查这里）

| 症状 | 最可能的原因 | 怎么办 |
|---|---|---|
| 页面报 `Failed to fetch` | 跨域被拒；或云函数没部署/挂了 | 先跑第 1 项看 health 还在不在；再跑第 4 项看是不是 403 |
| 页面数据是本机旧数据 | 云端取数失败（接口 500 或网络不通） | 看 Console 有没有 `[api-source] 云端数据取不到` 的黄字，再看接口返回什么 |
| 保存后提示「已存本机」 | 写接口失败，程序自动兜底存本地 | 存的数据没丢，但没上云；查接口是否 500；注意 `anon` 写权限是否被收回 |
| 部署报错说未登录 | 登录态过期（约一天） | 重新走设备码授权：设备码有时效，第一个码没生效就换新码重试 |
| 接口第一次请求很慢 | 云函数冷启动 | 正常，等几秒再试一次就快 |
| 改了代码但线上没变 | 忘了重新部署 | 云函数用部署工具更新代码；前端要重新上传到静态托管 |
