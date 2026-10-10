// verify-project/scripts/verify.js —— 发布前自动检查（Daily-Health-Log）
//
// 用途：每次发布前跑一条命令，得到逐项 PASS / FAIL + 证据。
// 设计原则（全部来自本项目真实踩过的坑，见 SKILL.md 的「检查项来源」）：
//   1. 默认只读，不改线上数据；唯一的写测试用「1999-01-01」这个永远不会被真实打卡占用的日期，
//      跑完立刻 DELETE 清理，并在结尾自己验证清理干净。
//   2. 硬失败只给两种情况：接口不可用 / 往返不一致。其余问题（如写权限被收紧、git 不可用）
//      单独标注，不让它们淹没真正致命的信号。
//   3. 每条检查都输出可复现的 curl，PASS/FAIL 判断全部基于「比对了具体字段/具体字符串」，
//      不做「看起来正常」这类主观判断。
//
// 用法：
//   node scripts/verify.js                # 默认：跑全部检查
//   node scripts/verify.js --skip-write   # 线上数据冻结期用，跳过第 2 项的写往返（该项标 SKIP）
//   node scripts/verify.js --json         # 额外输出一段机器可读 JSON 结果

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE =
  process.env.DHL_API_BASE ||
  "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com";
// PROJECT_ROOT = 仓库根目录。
// 本文件位于 <root>/skills/verify-project/scripts/verify.js，
// 往上 3 层才是 <root>（scripts → verify-project → skills → root）。
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const WRITE_DATE = "1999-01-01"; // 专用冒烟日期：非真实打卡日，跑完即删
const EXPECTED_TABLES = ["checkins", "settings"];

const argv = process.argv.slice(2);
const SKIP_WRITE = argv.includes("--skip-write");
const AS_JSON = argv.includes("--json");

// ---------------------------------------------------------------------------
// 结果收集与输出
// ---------------------------------------------------------------------------
const results = [];

function record(id, title, status, evidence, note) {
  results.push({ id, title, status, evidence, note: note || "" });
}

function printResult(r) {
  const tag = r.status.padEnd(5);
  console.log("");
  console.log(`[${tag}] ${r.id} ${r.title}`);
  console.log(`        证据: ${r.evidence}`);
  if (r.note) console.log(`        备注: ${r.note}`);
}

// ---------------------------------------------------------------------------
// 通用请求
// ---------------------------------------------------------------------------
async function req(method, apiPath, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + apiPath, opt);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    /* 保持 null —— 这本身就是证据（说明返回的不是 JSON） */
  }
  return { status: res.status, text, json };
}

// ---------------------------------------------------------------------------
// 检查 1：健康接口（GET /api/health）
// 通过的判据：HTTP 200 且 body.ok === true 且 service 与 time 字段存在。
// 来源：健康接口不碰数据库，是「服务挂了」和「库挂了」的区分器（handlers/health.js 注释）。
// ---------------------------------------------------------------------------
async function check1_health() {
  const cmd = `curl -sS -w '\\n[HTTP %{http_code}]' '${BASE}/api/health'`;
  try {
    const r = await req("GET", "/api/health");
    const b = r.json;
    const ok = r.status === 200 && b && b.ok === true && typeof b.service === "string" && typeof b.time === "string";
    const timeFresh = b && typeof b.time === "string" && b.time.startsWith("20");
    record(
      "1-A1",
      "健康接口 GET /api/health",
      ok ? "PASS" : "FAIL",
      `HTTP ${r.status}，body=${r.text.slice(0, 120)}`,
      ok ? (timeFresh ? `service=${b.service}, time=${b.time}` : `time 可疑: ${b.time}`) : `复现: ${cmd}`
    );
  } catch (e) {
    record("1-A1", "健康接口 GET /api/health", "FAIL", `请求异常: ${e.message}`, `复现: ${cmd}`);
  }
}

// ---------------------------------------------------------------------------
// 检查 2：读接口一次（GET /api/checkins?limit=3）
// 通过的判据（三条全满足才算 PASS）：
//   a) HTTP 200 且 ok===true
//   b) items 是数组
//   c) 每条记录里「空值」是 "" 而不是 null —— 契约 2.6，返 null 前端会渲染出 "null kg"
// 来源：契约 2.6 空值约定；history.js 用 === '' 判断。
// ---------------------------------------------------------------------------
async function check2_read() {
  const cmd = `curl -sS '${BASE}/api/checkins?limit=3'`;
  try {
    const r = await req("GET", "/api/checkins?limit=3");
    const b = r.json;
    const items = b && b.data && Array.isArray(b.data.items) ? b.data.items : null;
    if (!(r.status === 200 && b && b.ok === true && items)) {
      record("2-A4", "读接口 GET /api/checkins?limit=3", "FAIL",
        `HTTP ${r.status}，body=${r.text.slice(0, 160)}`, `复现: ${cmd}`);
      return;
    }
    // 空值必须是 ""，不能是 null
    const staticFields = ["exerciseType", "mealBreakfastText", "mealBreakfastTag", "mealLunchText",
      "mealLunchTag", "mealDinnerText", "mealDinnerTag"];
    const nullHits = [];
    items.forEach((it) => {
      staticFields.forEach((f) => {
        if (it[f] === null) nullHits.push(`${it.date}.${f}`);
      });
    });
    const dates = items.map((i) => i.date);
    const asc = dates.every((d, i) => i === 0 || dates[i - 1] <= d);
    const ok = nullHits.length === 0 && asc;
    record("2-A4", "读接口 GET /api/checkins?limit=3", ok ? "PASS" : "FAIL",
      `HTTP ${r.status}，items=${items.length} 条，date 升序=${asc}，空值为 null 的字段=${nullHits.length}`,
      nullHits.length ? `这些字段返了 null（违反契约 2.6）: ${nullHits.join(", ")}` : `样例 dates=${JSON.stringify(dates)}`);
  } catch (e) {
    record("2-A4", "读接口 GET /api/checkins?limit=3", "FAIL", `请求异常: ${e.message}`, `复现: ${cmd}`);
  }
}

// ---------------------------------------------------------------------------
// 检查 3：写接口一次往返（PUT → GET 回读 → DELETE 清理）
// 通过的判据（三条全满足才算 PASS）：
//   a) PUT 返回 200 且 data.saved===true
//   b) GET 回读的 record 与写入内容**逐字段一致**（字段数 0 处不一致）
//   c) DELETE 后 GET 回读 record===null（证明写进去的确实清掉了）
// 为什么必须往返而不能只看 PUT 返回：Day 23 的真实事故就是「PUT 报 500 / 或写了没生效」，
// 只有回读才发现；且「写完不清理」会往真实库里塞脏数据。
// ---------------------------------------------------------------------------
const SAMPLE = {
  exerciseType: "慢跑", exerciseMinutes: 30, exerciseCalories: 300,
  mealBreakfastText: "", mealBreakfastTag: "",
  mealLunchText: "verify-project 冒烟", mealLunchTag: "普通",
  mealDinnerText: "", mealDinnerTag: "",
  weightKg: 64.5, waterMl: 1500,
};

async function check3_write() {
  if (SKIP_WRITE) {
    record("3-A6", "写接口往返 PUT→GET→DELETE", "SKIP",
      "已指定 --skip-write，跳过写测试（未改线上数据）", "冻结期用法；正常发布前请跑完整版");
    return;
  }
  const cmds = [
    `curl -sS -X PUT -H 'Content-Type: application/json' -d '${JSON.stringify(SAMPLE)}' '${BASE}/api/checkins/${WRITE_DATE}'`,
    `curl -sS '${BASE}/api/checkins/${WRITE_DATE}'`,
    `curl -sS -X DELETE '${BASE}/api/checkins/${WRITE_DATE}'`,
  ];
  try {
    const put = await req("PUT", `/api/checkins/${WRITE_DATE}`, SAMPLE);
    const putOk = put.status === 200 && put.json && put.json.ok === true && put.json.data && put.json.data.saved === true;
    if (!putOk) {
      record("3-A6", "写接口往返 PUT→GET→DELETE", "FAIL",
        `PUT HTTP ${put.status}，body=${put.text.slice(0, 200)}`, `复现: ${cmds[0]}`);
      return;
    }

    const get = await req("GET", `/api/checkins/${WRITE_DATE}`);
    const rec = get.json && get.json.data ? get.json.data.record : null;
    const mismatch = rec
      ? Object.keys(SAMPLE).filter((k) => String(rec[k]) !== String(SAMPLE[k]))
      : ["<GET 没回读出来>"];

    const del = await req("DELETE", `/api/checkins/${WRITE_DATE}`);
    const delOk = del.status === 200 && del.json && del.json.ok === true;

    const after = await req("GET", `/api/checkins/${WRITE_DATE}`);
    const cleaned = after.json && after.json.data && after.json.data.record === null;

    const ok = mismatch.length === 0 && delOk && cleaned;
    record("3-A6", "写接口往返 PUT→GET→DELETE", ok ? "PASS" : "FAIL",
      `PUT ${put.status}(saved=${put.json.data.saved}) → GET ${get.status}(不一致字段=${mismatch.length}) → DELETE ${del.status}(ok=${delOk}) → 回读清理=${cleaned ? "record:null" : "未清干净"}`,
      mismatch.length ? `不一致字段: ${mismatch.join(", ")}` : `冒烟日期 ${WRITE_DATE} 已删除，未污染真实数据`);
  } catch (e) {
    record("3-A6", "写接口往返 PUT→GET→DELETE", "FAIL", `请求异常: ${e.message}`, `复现: ${commandsOf(cmds)}`);
  }
}

function commandsOf(cmds) {
  return Array.isArray(cmds) ? cmds.join("  ;  ") : cmds;
}

// ---------------------------------------------------------------------------
// 检查 4：代码与 Git 里搜不到硬编码密钥
// 结合的判据（三条都过才算 PASS）：
//   a) 工作区源码文件里搜不到「真实密钥值特征」
//   b) git 全历史里搜不到「带值的赋值」形式（如 CLOUDBASE_APIKEY=xxxxx）
//   c) .env 没被 git 跟踪
// 为什么要分「值特征」和「变量名」：本项目变量名（CLOUDBASE_APIKEY）在注释/文档里到处都是，
// 合法的；只有**赋了值的**才是泄露。2026-10-08 安全审计正是这么区分的。
//
// 实现说明：用「自己遍历 + 正则匹配」而不是 git grep —— git grep 的 --exclude-dir
// 对「以点开头的目录」（如 .workbuddy）不可靠，会扫出技能文档误报。自己控制遍历范围，
// 明确跳过 node_modules / .git / .workbuddy（协作数据，不属于作品），结果才稳定可解释。
// ---------------------------------------------------------------------------
// 注意：SECRET_PATTERNS 的前 4 条是「**值**特征」——命中的是形如真实密钥的串本身，
// 与变量名无关，所以本文件的源码（含下面第 5 条的正则字面量）不会被自己命中。
// 第 5 条是「变量名 + 带值赋值」，比前 4 条宽松，**故意排除注释行**：
//   - `# 说明...`（.env.example / markdown / shell 注释）
//   - `// 说明...`（JS 注释）
//   - `* 说明...`（块注释续行）
// 用等号赋值不会出现在注释里，排除注释能挡掉「文档里写示例」这类误报
// （2026-10-10 自证测试踩到：测试说明文档里举例了一句赋值，被误判成泄露）。
// ⚠️ 重大修正（2026-10-10 自证测试逮到的**漏报**）：
//   最初第 5 条写成「固定变量名列表」(APIKEY|API_KEY|SECRET_KEY|PASSWORD|TOKEN) + 带值，
//   结果注入的 `var DEBUG_KEY = "abcdef...(32位)";` **一条都没报**（工作区命中=0，仍判 PASS）
//   —— 因为变量名 `DEBUG_KEY` 不在列表里。这就是「虚报通过」，比误报危险得多。
//   修法：不再枚举变量名，改成**按「赋值形状 + 值形态」判定**（见下第 5、6 条）。
//
// 精度调优（同一次测试的第二次踩坑）：放宽后立刻冒出 4 个**误报**——
//   `tagKey: 'mealBreakfastTag'`（前端字段映射表，不是密钥）、
//   文档里的 UUID（requestId 证据）。所以第 5、6 条都加了「值必须像密钥」的约束：
//     - 值里必须同时含「字母 + 数字」且长度 ≥ 16（纯单词/纯字段名如 mealBreakfastTag 直接排除）
//     - 排除 UUID / requestId 这类「多段连字符」标识（形如 8-4-4-4-12）
const SECRET_PATTERNS = [
  { name: "密钥值特征", re: /sk-[A-Za-z0-9]{16,}/ },
  { name: "腾讯云 SecretId", re: /AKID[A-Za-z0-9]{16,}/ },
  { name: "PEM 私钥", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "JWT 令牌", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  {
    // 变量名含 KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL + 赋一个「像密钥」的长串
    // 「像密钥」= ≥16 位、同时含字母和数字、不是 UUID 形状
    name: "赋值给密钥类变量（值像密钥）",
    re: /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|APIKEY|PRIVATEKEY)[A-Za-z0-9_$]*\s*[=:]\s*["'](?=[A-Za-z0-9_\-\.]{16,}["'])(?=[^"']*[A-Za-z])(?=[^"']*\d)(?!\s*$)[^"']*["']/i,
    skipComment: true,
    extraFilter: (line) => !looksLikeUuidLiteral(line),
  },
  {
    // 兜底：任何位置赋一个 ≥32 位的「明显随机串」（含字母+数字）——真实密钥的常见形态
    name: "疑似密钥长串赋值",
    re: /[=:]\s*["'](?=[A-Za-z0-9+/_\-]{32,}["'])(?=[^"']*[A-Za-z])(?=[^"']*\d)[^"']*["']/,
    skipComment: true,
    extraFilter: (line) => !looksLikeUuidLiteral(line),
  },
];

// UUID / requestId 形状（8-4-4-4-12）不是密钥，排除掉
function looksLikeUuidLiteral(line) {
  return /["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["']/i.test(line);
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".workbuddy", "vendor", "dist"]);
const SCAN_EXT = new Set([".js", ".html", ".md", ".sql", ".json", ".css", ".yml", ".yaml"]);
const SKIP_FILES = new Set(["package-lock.json"]);

function scanFileForSecrets(absPath, relPath) {
  const hits = [];
  let src;
  try {
    src = fs.readFileSync(absPath, "utf8");
  } catch (_) {
    return hits;
  }
  src.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trimStart();
    const isComment =
      trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*") ||
      trimmed.startsWith("<!--");
    SECRET_PATTERNS.forEach((p) => {
      if (p.skipComment && isComment) return;
      if (!p.re.test(line)) return;
      if (p.extraFilter && !p.extraFilter(line)) return;
      hits.push(`${relPath}:${i + 1} [${p.name}]`);
    });
  });
  return hits;
}

function walkForSecrets(dir, root, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  entries.forEach((e) => {
    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) return;
      walkForSecrets(abs, root, acc);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) return;
      const ext = path.extname(e.name).toLowerCase();
      if (!SCAN_EXT.has(ext) && e.name !== ".env.example") return;
      acc.push(...scanFileForSecrets(abs, rel));
    }
  });
  return acc;
}

// git 命令包装：不可用时返回 error，而不是静默当成「无命中」（否则会变漏报）
// 注意：沙盒里 git 可能因 PATH 未修好而不可用（本项目环境已知问题）——
// 此时明确标注「历史侧未真正校验」，不假装通过。
function gitLines(args) {
  const r = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
  if (r.error || typeof r.status !== "number") {
    return { error: (r.error && r.error.message) || "git 未能执行", lines: [] };
  }
  if (r.status > 1) {
    return { error: `git 退出码 ${r.status}`, lines: [] };
  }
  return { error: null, lines: (r.stdout || "").toString().split("\n").map((s) => s.trim()).filter(Boolean) };
}

function check4_secrets() {
  const hits = walkForSecrets(PROJECT_ROOT, PROJECT_ROOT, []);
  const hist = gitLines(["log", "-S", "CLOUDBASE_APIKEY=", "--oneline", "--all"]);
  const envTracked = gitLines(["ls-files", ".env"]);
  const gitUnavailable = Boolean(hist.error || envTracked.error);

  const envExists = fs.existsSync(path.join(PROJECT_ROOT, ".env"));
  const ok = hits.length === 0 && hist.lines.length === 0 && envTracked.lines.length === 0;

  record("4-SEC", "代码与 Git 搜不到硬编码密钥", ok ? "PASS" : "FAIL",
    `工作区命中=${hits.length} 行，git 历史赋值命中=${hist.lines.length} 条，.env 被跟踪=${envTracked.lines.length ? "是" : "否"}`,
    ok
      ? (envExists ? "注意：本机存在 .env（已被 .gitignore 忽略，勿提交）" : "工作区无 .env 文件") +
        (gitUnavailable ? "；⚠️ git 不可用，历史侧未真正校验" : "")
      : `命中详情: ${[...hits, ...hist.lines].slice(0, 5).join(" | ")}`);
}

// ---------------------------------------------------------------------------
// 检查 5：数据库可连接 + 核心表存在
// 思路：A4 能返回真实记录 = 云函数经 PG 网关连上了库。再对 settings 做一次独立探针，
//       证明「能连」不是巧合；两张核心表都取到数据 = 表存在。
// 为什么不用 SQL 直查 information_schema：云函数是用 anon 角色连库的，
//       而 MCP 的 PG 工具默认走 cloudbase_postgres 角色 —— 角色不同，看到的/能连的也可能不同，
//       「MCP 能查到」不等于「线上 anon 能查到」。所以用线上接口本身当探针最可信。
// 补充：SQL 侧对账命令见 SKILL.md（需 MCP 登录态，非必跑）。
// ---------------------------------------------------------------------------
async function check5_db() {
  const cmd = `curl -sS '${BASE}/api/settings' && curl -sS '${BASE}/api/checkins?limit=1'`;
  try {
    const s = await req("GET", "/api/settings");
    const c = await req("GET", "/api/checkins?limit=1");
    const sOk = s.status === 200 && s.json && s.json.ok === true && s.json.data && s.json.data.settings
      && typeof s.json.data.settings.goalExerciseMinutes !== "undefined";
    const cOk = c.status === 200 && c.json && c.json.ok === true && c.json.data
      && Array.isArray(c.json.data.items) && typeof c.json.data.total === "number";
    const ok = sOk && cOk;
    record("5-DB", `数据库可连接 + 核心表存在 (${EXPECTED_TABLES.join(" / ")})`, ok ? "PASS" : "FAIL",
      `settings HTTP ${s.status}(ok=${sOk})，checkins HTTP ${c.status}(ok=${cOk})`,
      ok
        ? "两张表都能取到数据 = 云函数经 PG 网关连通且表存在；total 字段存在说明是真实查询而非空壳"
        : `复现: ${cmd}；若返回 500/DB_ERROR 说明连库失败，查 SKILL.md 排错表`);
  } catch (e) {
    record("5-DB", `数据库可连接 + 核心表存在 (${EXPECTED_TABLES.join(" / ")})`, "FAIL",
      `请求异常: ${e.message}`, `复现: ${cmd}`);
  }
}

// ---------------------------------------------------------------------------
// 附加检查 A：前端引用的接口基地址与线上一致（部署没换域名）
// 来源：manageHosting 曾把域名换掉、静态托管子域名漂移的坑。
// ---------------------------------------------------------------------------
function checkA_baseConsistency() {
  const f = path.join(PROJECT_ROOT, "assets", "js", "api-source.js");
  try {
    const src = fs.readFileSync(f, "utf8");
    const m = src.match(/API_BASE\s*=\s*['"]([^'"]+)['"]/);
    const found = m ? m[1] : "";
    const ok = found === BASE;
    record("A-BASE", "前端接口基地址与线上一致", ok ? "PASS" : "FAIL",
      `api-source.js API_BASE=${found || "<未找到>"}，脚本 BASE=${BASE}`,
      ok ? "" : "两边不一致：可能换了域名，或漏改 api-source.js");
  } catch (e) {
    record("A-BASE", "前端接口基地址与线上一致", "FAIL", `读文件失败: ${e.message}`, f);
  }
}

// ---------------------------------------------------------------------------
// 附加检查 B：前端 / 云函数 JS 语法自检
// 来源：Node vm 沙箱曾在语法错时静默失败、页面白屏但接口全好。
//
// 实现说明（2026-10-10 实测踩坑）：**不用 `node --check` 子进程** ——
//   本机用 spawnSync 再起一个 node 进程会报 EBUSY（Node 自身被占用），
//   退出码恒为 null，会把 5 个完好的文件全判成 FAIL（假失败）。
//   改用 `new Function(src)`：纯进程内编译，不依赖子进程，语法错会 throw SyntaxError。
//   客户端 JS 里有顶层 return 也没关系——new Function 允许（函数体内合法）。
// ---------------------------------------------------------------------------
// 语法检查（编译期）。**本身绝不抛异常** —— 读不到文件也要返回错误串，
// 否则一项检查会把整个脚本带崩（2026-10-10 自证测试踩到：副本里 B-SYNTAX 读不到文件 → 抛 ENOENT → 退出码 2）。
function compileCheck(absPath) {
  let src;
  try {
    src = fs.readFileSync(absPath, "utf8");
  } catch (e) {
    return `${path.basename(absPath)}: 读不到文件（${e.code || "ERR"}）`;
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(src);
    return null;
  } catch (e) {
    return `${path.basename(absPath)}: ${String(e.message).split("\n")[0]}`;
  }
}

function checkB_syntax() {
  const targets = [
    path.join(PROJECT_ROOT, "assets", "js", "api-source.js"),
    path.join(PROJECT_ROOT, "assets", "js", "checkin.js"),
    path.join(PROJECT_ROOT, "assets", "js", "storage.js"),
    path.join(PROJECT_ROOT, "cloudfunctions", "api-health", "index.js"),
    path.join(PROJECT_ROOT, "cloudfunctions", "api-health", "repositories", "checkins.repository.js"),
  ];
  const bad = [];
  targets.forEach((f) => {
    const err = compileCheck(f);
    if (err) bad.push(err);
  });
  const ok = bad.length === 0;
  record("B-SYNTAX", "关键 JS 语法检查（编译期）", ok ? "PASS" : "FAIL",
    `检查 ${targets.length} 个文件，语法错 ${bad.length} 个`,
    ok ? "全部编译通过" : bad.join(" | "));
}

// ---------------------------------------------------------------------------
// 附加检查 C：写权限是否被收紧（不算发布失败，但要提示）
// 来源：anon 写权限曾被误收，导致页面保存报 42501。
// ---------------------------------------------------------------------------
async function checkC_writePermission() {
  // 用一个**不该存在**的日期做 PATCH：若返回 404 说明「能连上、能进到业务判断」，写通道是开的；
  // 若返回 500 DB_ERROR / 403，则可能是权限或连接问题。
  const date = "1999-12-31";
  try {
    const r = await req("PATCH", `/api/checkins/${date}`, { waterMl: 1000 });
    const permissive = r.status === 404 && r.json && r.json.ok === false;
    const ok = permissive;
    record("C-WRITE", "写权限通道正常（anon 未被误收紧）", ok ? "PASS" : "FAIL",
      `PATCH 不存在日期 HTTP ${r.status}，body=${r.text.slice(0, 140)}`,
      ok
        ? "404 说明请求已进到业务层（那天没记录），写路径可达"
        : "若为 500/DB_ERROR：查 anon 是否还有 INSERT/UPDATE 权限（见 SKILL.md 排错表），这会导致页面保存失败");
  } catch (e) {
    record("C-WRITE", "写权限通道正常（anon 未被误收紧）", "FAIL", `请求异常: ${e.message}`, "");
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  console.log("=========================================================");
  console.log(" verify-project · Daily-Health-Log 发布前检查");
  console.log(" 目标: " + BASE);
  console.log(" 模式: " + (SKIP_WRITE ? "跳过写测试 (--skip-write)" : "完整（含写往返，含自动清理）"));
  console.log(" 时间: " + new Date().toISOString());
  console.log("=========================================================");

  // 逐项跑，每项跑完立刻打印自己的结果（一律 await，见 runAndPrint 的说明）
  await runAndPrint(check1_health);
  await runAndPrint(check2_read);
  await runAndPrint(check3_write);
  await runAndPrint(check4_secrets);
  await runAndPrint(check5_db);
  await runAndPrint(checkA_baseConsistency);
  await runAndPrint(checkB_syntax);
  await runAndPrint(checkC_writePermission);

  console.log("\n---------------------------------------------------------");
  console.log(" 汇总");
  console.log("---------------------------------------------------------");
  let hardFail = 0;
  results.forEach((r) => {
    const tag = r.status.padEnd(5);
    console.log(`  [${tag}] ${r.id}  ${r.title}`);
    if (r.status === "FAIL") {
      console.log(`         → ${r.evidence}`);
      if (r.note) console.log(`         → ${r.note}`);
      hardFail++;
    }
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log("---------------------------------------------------------");
  console.log(` 结论: PASS ${passed} / FAIL ${hardFail} / SKIP ${skipped}`);
  console.log(hardFail === 0 ? " ✅ 全部通过，可以发布" : " ❌ 存在失败项，按上面证据修复后再跑一次");
  console.log("=========================================================");

  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, results }, null, 2));
  }
  process.exit(hardFail === 0 ? 0 : 1);
}

// 跑一项检查、打印它新产生的结果
// ⚠️ 铁律：每个 check 函数必须「同步执行完 record() 才 return」。
//   因此调用时**一律 await** —— 即使函数是同步的，也不能省 await：
//   省掉会让「打印时机」与「record 完成时机」错位，出现某项结果被打印两次、
//   另一项被跳过（2026-10-10 第一次运行就踩到：B-SYNTAX 印了两遍、C-WRITE 差点漏掉）。
async function runAndPrint(fn) {
  const before = results.length;
  await fn();
  const fresh = results.slice(before);
  if (fresh.length === 0) {
    // 防空转：某个检查忘了 record()，会静默少一项 —— 这里挡住它
    record("SELF-CHECK", `${fn.name} 未产生结果`, "FAIL", "该检查函数没有调用 record()，请修脚本", "");
  }
  fresh.forEach((r) => printResult(r));
}

main().catch((e) => {
  console.error("检查脚本自身异常:", e);
  process.exit(2);
});
