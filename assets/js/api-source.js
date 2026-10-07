/* ============================================
   api-source.js —— 前端取数层（Day 17 新增，Day 18 加写接口）
   ------------------------------------------------------------
   干什么：
   1. 读：页面打开时去云端的两个读接口取一次真实数据，取到后
      交给 storage.js 的「云端覆盖层」，页面照旧从 dhlStorage 读数；
   2. 写：打卡页保存时调 saveCheckin()，把这一天的记录 PUT 到云端
      （A6 PUT /api/checkins/{date}，upsert 全量覆盖）；
   3. 改 / 删（2026-10-07 新增，目前只有检查台 check.html 在用）：
      patchCheckin()  只改指定的那几个字段（A8 PATCH），其余列原样保留；
      deleteCheckin() 删掉某天的整条记录（A9 DELETE，**删了不可恢复**）。

   为什么要单独一层（而不是各页面各写一遍 fetch）：
   1. storage.js 是全项目唯一的数据出入口（它自己的文件头就是这么写的），
      把云端数据放在它底下，**所有页面自动都读到了真实数据**；
   2. 两个接口并发只要发一次（load() 复用同一个 Promise）；
   3. 取不到时**不白屏**：只打一条控制台警告，页面继续用本地数据渲染
      （沿用 PRD E2「数据异常也不报错不白屏」的思路）。

   接口契约：api-contract.md 4.3（A2 /api/settings）、4.5（A4 /api/checkins）、
   4.7（A6 PUT /api/checkins/{date}）、4.9（A8 PATCH /api/checkins/{date}）、
   4.10（A9 DELETE /api/checkins/{date}）。
   字段已经是 camelCase，与页面直接对接，不需要再转换。

   写入策略（Day 18 拍板，方案 A「云端优先 + 本地兜底」）：
   先 PUT 云端，成功 → 只更新内存覆盖层（不碰 localStorage）；
   失败 → 由 checkin.js 回落写本地，页面提示「已存本机」。
   ============================================ */

(function () {
  'use strict';

  // 线上接口地址（api-contract.md 2.1 的 API_BASE）
  var API_BASE = 'https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com';

  var loading = null;  // 复用的 Promise：多个页面脚本同时 ready() 也只发一次请求
  var result = null;   // 最近一次取数的结果，供页面/控制台查看

  /**
   * 取一个接口并剥掉 {ok,data} 外壳。
   * 失败时抛错（由 load() 统一兜底），错误信息优先用契约里的中文 message。
   */
  function fetchJson(path) {
    return fetch(API_BASE + path).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body || body.ok !== true) {
          var msg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
          throw new Error(msg);
        }
        return body.data;
      });
    });
  }

  /**
   * A6 写接口：保存 / 覆盖某天的打卡记录（契约 4.7）。
   *
   * 与 fetchJson 的区别：写接口的失败要**交给页面显示红字**，不能让异常冒到
   * Promise 外面去（页面只想拿到一个明确的结果对象），所以这里不用 fetchJson，
   * 而是自己把成功/失败都收敛成 { ok, ... } 的形状。
   *
   * @param {string} date   日期 YYYY-MM-DD（路径参数，请求体里不带）
   * @param {Object} record 单日记录（camelCase，字段同契约 3.2）
   * @returns {Promise<{ok: true, isNew: boolean, record: Object} | {ok: false, message: string}>}
   *   永远 resolve，调用方不需要写 catch。
   */
  function saveCheckin(date, record) {
    // 契约 4.7：请求体不含 date（日期以路径为准）；带了必须与路径一致，否则 400。
    // 这里直接把 date 剔掉，避免"路径与请求体不一致"这种低级 400。
    var payload = {};
    Object.keys(record || {}).forEach(function (k) {
      if (k !== 'date') payload[k] = record[k];
    });

    return fetch(API_BASE + '/api/checkins/' + encodeURIComponent(date), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || body.ok !== true) {
            var msg = (body && body.error && body.error.message) || ('保存失败（HTTP ' + res.status + '）');
            return { ok: false, message: msg };
          }
          return { ok: true, isNew: body.data.isNew === true, record: body.data.record };
        });
      })
      .catch(function (e) {
        // 网络不通 / 响应不是 JSON —— 都当成"这次没存上"，由页面决定怎么提示
        return { ok: false, message: (e && e.message) || '网络不通，这次没存上' };
      });
  }

  /**
   * A8 局部修改接口：只改请求体里出现的字段（契约 4.9）。
   *
   * 与 saveCheckin 的关键区别（这也是 PATCH 存在的理由）：
   *   saveCheckin 会把整条记录的 11 个字段一起写一遍，没填的会变成空值，
   *   所以「只想改个体重」得先把整条读出来、改一格、再整条发回去；
   *   patchCheckin 只写你给的那几列，数据库里其他列原样不动。
   *   请求体越小越不容易误伤，多端各改各的字段时也不会互相覆盖。
   *
   * @param {string} date   日期 YYYY-MM-DD（路径参数；请求体里不带，带了必须与路径一致）
   * @param {Object} fields 要改的字段（camelCase），至少要有一个，如 { weightKg: 66 }
   * @returns {Promise<{ok: true, record: Object} | {ok: false, message: string}>}
   *   永远 resolve，调用方不需要写 catch（与 saveCheckin 同一约定）。
   */
  function patchCheckin(date, fields) {
    // 契约 4.9：日期以路径为准；顺手把 date 剔掉，避免「路径与请求体不一致」的 400
    var payload = {};
    Object.keys(fields || {}).forEach(function (k) {
      if (k !== 'date') payload[k] = fields[k];
    });

    return fetch(API_BASE + '/api/checkins/' + encodeURIComponent(date), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || body.ok !== true) {
            var msg = (body && body.error && body.error.message) || ('修改失败（HTTP ' + res.status + '）');
            return { ok: false, message: msg };
          }
          return { ok: true, record: body.data.record };
        });
      })
      .catch(function (e) {
        return { ok: false, message: (e && e.message) || '网络不通，这次没改成' };
      });
  }

  /**
   * A9 删除接口：删掉某一天的整条记录（契约 4.10）。
   *
   * **此操作不可恢复。** 接口这一层不替你确认——怎么问、问不问，都是调用方的事，
   * 所以页面里调它之前必须先弹二次确认（检查台的删除按钮就是这么做的）。
   * 成功时接口只回 { date, deleted: true }，不回被删掉的内容（删了就是删了）。
   *
   * @param {string} date 日期 YYYY-MM-DD（路径参数）
   * @returns {Promise<{ok: true, date: string} | {ok: false, message: string}>}
   *   永远 resolve，调用方不需要写 catch（与 saveCheckin 同一约定）。
   */
  function deleteCheckin(date) {
    return fetch(API_BASE + '/api/checkins/' + encodeURIComponent(date), {
      method: 'DELETE'
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || body.ok !== true) {
            var msg = (body && body.error && body.error.message) || ('删除失败（HTTP ' + res.status + '）');
            return { ok: false, message: msg };
          }
          return { ok: true, date: body.data.date };
        });
      })
      .catch(function (e) {
        return { ok: false, message: (e && e.message) || '网络不通，这次没删掉' };
      });
  }

  /**
   * 取云端数据（只取一次）。
   * @returns {Promise<{ok: boolean, count?: number, reason?: string}>}
   *   永远 resolve，不 reject —— 调用方不需要写 catch。
   */
  function load() {
    if (loading) return loading;

    loading = Promise.all([
      fetchJson('/api/settings'),
      fetchJson('/api/checkins?limit=400')  // 契约 4.5：一次最多 400 天，够单人一年
    ])
      .then(function (both) {
        var settings = both[0].settings;   // 可能是 null（没设置过目标）
        var items = both[1].items || [];

        // A4 返回的是数组，而页面要的是「以日期为 key 的对象」（沿用本地存储的形状）
        var records = {};
        items.forEach(function (item) {
          if (item && item.date) records[item.date] = item;
        });

        window.dhlStorage.applyRemote(settings, records);
        result = { ok: true, count: items.length };
        return result;
      })
      .catch(function (e) {
        console.warn('[api-source] 云端数据取不到，本次用本地数据渲染：', e && e.message);
        result = { ok: false, reason: (e && e.message) || 'unknown' };
        return result;
      });

    return loading;
  }

  /**
   * 页面启动入口：数据取完（不管成功失败）再跑 callback。
   * 页面脚本把结尾的 init() 换成 dhlApi.ready(init) 即可，内部逻辑一行不用改。
   */
  function ready(callback) {
    load().then(callback);
  }

  window.dhlApi = {
    API_BASE: API_BASE,
    load: load,
    ready: ready,
    saveCheckin: saveCheckin,
    patchCheckin: patchCheckin,
    deleteCheckin: deleteCheckin,
    getResult: function () { return result; }
  };
})();
