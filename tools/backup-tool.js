#!/usr/bin/env node
/**
 * tools/backup-tool.js —— 健康打卡数据的 导出 / 比对 / 还原 三合一命令行工具
 *
 * 为什么有这个工具：
 *   A7「批量导入」接口尚未实现，所以「导出备份」和「把备份装回库里」目前只能靠人
 *   一条条 PUT。这个脚本把这套手工流程固化成命令，避免漏行、漏字段、写错日期。
 *
 * 用法（在项目根目录 D:\Projects\Daily-Health-Log 下运行）：
 *   node tools/backup-tool.js export  [--label <标签>] [--out <文件路径>]
 *   node tools/backup-tool.js compare <备份文件>
 *   node tools/backup-tool.js restore <备份文件> [--dry-run]
 *   node tools/backup-tool.js verify  <备份文件>
 *
 * 说明：
 *   - export  从线上接口（A4 + A2）拉全量，写成带元数据的 JSON 备份。
 *   - compare 把备份和「当前库」逐日对比，列出各自独有 / 字段不同的行。
 *   - restore 把备份里的 settings 与 checkins 逐条 PUT 回线上（A3 + A6）。
 *   - verify  只做「备份自身完整性」检查，不联网。
 *   - --dry-run 只打印将要执行的写操作，不真的写。
 *
 * 数据流向：只读走 GET，写入走 PUT，均为本项目公开 HTTP 接口；
 *   由于当前 anon 角色无鉴权，接口地址不可外传（见 BACKUP_AND_ARCHIVE.md 风险章）。
 */

const fs = require("fs");
const path = require("path");

const API_BASE =
  process.env.HEALTH_API_BASE ||
  "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com";

const ENV_ID = "daily-health-log-d3eej7197499a30";
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DRILL_DIR = path.join(REPO_ROOT, ".workbuddy", "drill");

// A6/PUT 认的 11 个内容字段（顺序与契约 3.2 一致）
const CHECKIN_FIELDS = [
  "exerciseType",
  "exerciseMinutes",
  "exerciseCalories",
  "mealBreakfastText",
  "mealBreakfastTag",
  "mealLunchText",
  "mealLunchTag",
  "mealDinnerText",
  "mealDinnerTag",
  "weightKg",
  "waterMl",
];

// ---------------------------------------------------------------- HTTP 小工具

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`请求失败 +${res.status} ${url}\n${JSON.stringify(json)}`);
  }
  return json.data;
}

async function putJson(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`写入失败 +${res.status} ${url}\n${JSON.stringify(json)}`);
  }
  return json.data;
}

// ---------------------------------------------------------------- 拉取线上数据

async function fetchLive() {
  const list = await getJson(`${API_BASE}/api/checkins`);
  const set = await getJson(`${API_BASE}/api/settings`);
  const checkins = (list.items || []).map((it) => ({ date: it.date, ...pickFields(it) }));
  checkins.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { checkins, settings: set.settings || null };
}

function pickFields(obj) {
  const out = {};
  for (const f of CHECKIN_FIELDS) out[f] = obj[f] === undefined || obj[f] === null ? "" : obj[f];
  return out;
}

// ---------------------------------------------------------------- 时间戳 / 路径

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}`
  );
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.flags.dryRun = true;
    else if (a === "--label") args.flags.label = argv[++i];
    else if (a === "--out") args.flags.out = argv[++i];
    else args._.push(a);
  }
  return args;
}

// ---------------------------------------------------------------- export

async function cmdExport(flags) {
  const live = await fetchLive();
  const backup = {
    exportedAt: new Date().toISOString(),
    envId: ENV_ID,
    apiBase: API_BASE,
    source: "GET /api/checkins + GET /api/settings",
    label: flags.label || "full",
    counts: {
      checkins: live.checkins.length,
      settings_rows: live.settings ? 1 : 0,
    },
    settings: live.settings,
    checkins: live.checkins,
    restoreNote:
      "恢复：settings 走 A3 PUT /api/settings；checkins 走 A6 PUT /api/checkins/{date} 逐条重放（A7 批量导入未实现）。",
  };
  const outPath =
    flags.out ||
    path.join(DEFAULT_DRILL_DIR, `backup-${stamp()}-${backup.label}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), "utf8");
  console.log(`[export] 已写出备份：${outPath}`);
  console.log(`         checkins ${backup.counts.checkins} 条，settings ${backup.counts.settings_rows} 行`);
  return outPath;
}

// ---------------------------------------------------------------- compare

function fieldDiff(a, b) {
  const diffs = [];
  for (const f of CHECKIN_FIELDS) {
    const va = a[f] === undefined ? "" : a[f];
    const vb = b[f] === undefined ? "" : b[f];
    if (String(va) !== String(vb)) diffs.push(`${f}: 备份=${JSON.stringify(va)} 库=${JSON.stringify(vb)}`);
  }
  return diffs;
}

async function cmdCompare(file) {
  const backup = loadBackup(file);
  const live = await fetchLive();
  const bakMap = new Map(backup.checkins.map((c) => [c.date, c]));
  const liveMap = new Map(live.checkins.map((c) => [c.date, c]));

  const onlyInBackup = [...bakMap.keys()].filter((d) => !liveMap.has(d)).sort();
  const onlyInLive = [...liveMap.keys()].filter((d) => !bakMap.has(d)).sort();
  const both = [...bakMap.keys()].filter((d) => liveMap.has(d)).sort();

  console.log(`[compare] 备份 ${file}`);
  console.log(`          备份 ${backup.checkins.length} 条 / 库 ${live.checkins.length} 条；共同 ${both.length} 天`);

  if (onlyInBackup.length) {
    console.log(`\n  ✗ 仅备份有（库里缺，需重放）${onlyInBackup.length} 天：`);
    onlyInBackup.forEach((d) => console.log(`      - ${d}`));
  }
  if (onlyInLive.length) {
    console.log(`\n  + 仅库里有（备份之外的新记录，建议补进新备份）${onlyInLive.length} 天：`);
    onlyInLive.forEach((d) => console.log(`      + ${d}`));
  }

  let changed = 0;
  for (const d of both) {
    const diffs = fieldDiff(bakMap.get(d), liveMap.get(d));
    if (diffs.length) {
      changed++;
      console.log(`\n  ~ ${d} 有 ${diffs.length} 处字段不同：`);
      diffs.forEach((x) => console.log(`      ${x}`));
    }
  }
  if (!changed) console.log("\n  ✓ 共同日期的内容完全一致。");

  // settings 对比
  const bs = backup.settings;
  const ls = live.settings;
  const sameSettings = JSON.stringify(bs) === JSON.stringify(ls);
  console.log(`\n  settings：${sameSettings ? "一致" : "不同"}`);
  if (!sameSettings) {
    console.log(`      备份 = ${JSON.stringify(bs)}`);
    console.log(`      库   = ${JSON.stringify(ls)}`);
  }

  const ok = onlyInBackup.length === 0 && changed === 0 && sameSettings;
  console.log(`\n[compare] 结论：${ok ? "库里内容与备份一致 ✓" : "存在差异 ✗（见上）"}`);
  return ok;
}

// ---------------------------------------------------------------- restore

async function cmdRestore(file, flags) {
  const backup = loadBackup(file);
  const dry = !!flags.dryRun;
  console.log(`[restore] 备份 ${file}${dry ? "（dry-run，不写入）" : ""}`);

  let n = 0;

  // 1) settings
  if (backup.settings) {
    const body = {
      goalExerciseMinutes: backup.settings.goalExerciseMinutes,
      goalWaterMl: backup.settings.goalWaterMl,
    };
    console.log(`  PUT /api/settings  ${JSON.stringify(body)}`);
    if (!dry) {
      await putJson(`${API_BASE}/api/settings`, body);
      n++;
    }
  } else {
    console.log("  （备份无 settings，跳过）");
  }

  // 2) checkins 逐条
  for (const c of backup.checkins) {
    const body = pickFields(c);
    console.log(`  PUT /api/checkins/${c.date}  ${JSON.stringify(body)}`);
    if (!dry) {
      await putJson(`${API_BASE}/api/checkins/${c.date}`, body);
      n++;
    }
  }

  console.log(
    `[restore] 完成：${dry ? "将写入" : "已写入"} ${n} 条。\n` +
      "          建议紧接着跑：node tools/backup-tool.js compare " + file
  );
}

// ---------------------------------------------------------------- verify

function loadBackup(file) {
  if (!fs.existsSync(file)) throw new Error(`备份文件不存在：${file}`);
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(backup.checkins)) throw new Error("备份格式不对：缺少 checkins 数组");
  return backup;
}

function cmdVerify(file) {
  const backup = loadBackup(file);
  const dates = backup.checkins.map((c) => c.date);
  const dup = dates.filter((d, i) => dates.indexOf(d) !== i);
  console.log(`[verify] ${file}`);
  console.log(`         exportedAt : ${backup.exportedAt || "(缺)"}`);
  console.log(`         checkins   : ${backup.checkins.length} 条`);
  console.log(`         settings   : ${backup.settings ? "有" : "无"}`);
  console.log(`         日期范围   : ${dates[0] || "-"} ~ ${dates[dates.length - 1] || "-"}`);
  console.log(`         重复日期   : ${dup.length ? dup.join(", ") : "无"}`);
  const missing = backup.checkins.filter(
    (c) => !c.date || CHECKIN_FIELDS.some((f) => c[f] === undefined)
  );
  console.log(`         字段完整   : ${missing.length ? `${missing.length} 条缺字段` : "全部完整"}`);
  const ok = dup.length === 0 && missing.length === 0;
  console.log(`\n[verify] 结论：${ok ? "备份结构完整 ✓" : "备份有问题 ✗"}`);
  return ok;
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const file = args._[1];

  if (cmd === "export") return void (await cmdExport(args.flags));
  if (cmd === "compare") return void (await cmdCompare(file));
  if (cmd === "restore") return void (await cmdRestore(file, args.flags));
  if (cmd === "verify") return void cmdVerify(file);

  console.log(
    [
      "用法：",
      "  node tools/backup-tool.js export [--label <标签>] [--out <文件>]",
      "  node tools/backup-tool.js compare <备份文件>",
      "  node tools/backup-tool.js restore <备份文件> [--dry-run]",
      "  node tools/backup-tool.js verify  <备份文件>",
      "",
      "环境变量 HEALTH_API_BASE 可覆盖接口地址（默认走线上）。",
    ].join("\n")
  );
}

main().catch((e) => {
  console.error(`[错误] ${e.message}`);
  process.exit(1);
});
