// lib/body.js —— 请求体读取（A6）
//
// 这是「接请求」的一部分：把 HTTP 请求流读成 JSON 对象，交给校验层。
// 只有 A6 用得到，但它是 HTTP 层的事，不属于业务，所以留在 lib/。

const { MAX_BODY_BYTES } = require("./config");

// 读出请求体并解析成 JSON 对象。
// 返回 { value } 或 { bad: "parse" }（体积超限同理当作解析失败，前端只需要知道"体不对"）。
// 空请求体按 {} 处理 —— 交给字段校验去说"什么都没填"，错误信息比"body 是空的"更有用。
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve({ bad: "parse" });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") return resolve({ value: {} });
      try {
        resolve({ value: JSON.parse(raw) });
      } catch (e) {
        resolve({ bad: "parse" });
      }
    });

    req.on("error", () => resolve({ bad: "parse" }));
  });
}

module.exports = { readJsonBody };
