import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "../../src/server.js";

function signature(body) {
  return createHmac("sha256", "secret").update(body).digest("base64");
}

async function request(app, body, sig = signature(body)) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    return await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": sig },
      body,
    });
  } finally {
    server.close();
  }
}

function memoryLogger() {
  const records = [];
  return {
    records,
    info: async (event, fields) => records.push({ level: "info", event, ...fields }),
    warn: async (event, fields) => records.push({ level: "warn", event, ...fields }),
    error: async (event, fields) => records.push({ level: "error", event, ...fields }),
  };
}

test("rejects invalid LINE signatures before Codex or LINE reply", async () => {
  let called = false;
  const app = createServer({
    config: { lineSecret: "secret", lineToken: "token" },
    recipe: { generateRecipe: async () => (called = true) },
    line: { reply: async () => (called = true) },
  });
  const res = await request(app, '{"events":[]}', "bad");
  assert.equal(res.status, 401);
  assert.equal(called, false);
});

test("replies to valid text events with a generated recipe", async () => {
  let replyText = "";
  let conversation;
  const body = JSON.stringify({ events: [{ type: "message", replyToken: "r", source: { type: "group", groupId: "Gsecret" }, message: { type: "text", text: "カレー" } }] });
  const app = createServer({
    config: { lineSecret: "secret", lineToken: "token", codexWorkdir: "/tmp/oishinbot" },
    recipe: { generateRecipe: async (_text, c) => { conversation = c; return "カレーのレシピ"; } },
    line: { reply: async (_token, text) => (replyText = text) },
  });
  const res = await request(app, body);
  assert.equal(res.status, 200);
  assert.equal(replyText, "カレーのレシピ");
  assert.equal(conversation.type, "group");
  assert.match(conversation.cwd, /\/line\/group\/[a-f0-9]{32}$/);
  assert.equal(conversation.cwd.includes("Gsecret"), false);
});

test("processes multiple text events without serial waiting", async () => {
  const replies = [];
  const body = JSON.stringify({ events: [
    { type: "message", replyToken: "a", source: { type: "user", userId: "U-a" }, message: { type: "text", text: "カレー" } },
    { type: "message", replyToken: "b", source: { type: "user", userId: "U-b" }, message: { type: "text", text: "味噌汁" } },
  ] });
  const app = createServer({
    config: { lineSecret: "secret", maxConcurrentTurns: 2 },
    recipe: { generateRecipe: async (text) => new Promise((resolve) => setTimeout(() => resolve(`${text}のレシピ`), 50)) },
    line: { reply: async (token, text) => replies.push([token, text, Date.now()]) },
  });
  const started = Date.now();
  const res = await request(app, body);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(res.status, 200);
  assert.deepEqual(replies.map(([token]) => token).sort(), ["a", "b"]);
  assert.ok(Math.max(...replies.map(([, , t]) => t - started)) < 100);
});

test("dedupes repeated LINE webhook event ids", async () => {
  let replies = 0;
  const event = { type: "message", webhookEventId: "same", replyToken: "r", source: { type: "user", userId: "U-a" }, message: { type: "text", text: "カレー" } };
  const app = createServer({
    config: { lineSecret: "secret", maxConcurrentTurns: 1 },
    recipe: { generateRecipe: async () => "カレーのレシピ" },
    line: { reply: async () => { replies += 1; } },
  });
  await request(app, JSON.stringify({ events: [event] }));
  await request(app, JSON.stringify({ events: [event] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replies, 1);
});

test("uses a generic retry fallback when Codex generation fails", async () => {
  let replyText = "";
  const logger = memoryLogger();
  const body = JSON.stringify({ events: [
    { type: "message", webhookEventId: "event-a", replyToken: "reply-token-a", source: { type: "user", userId: "U-a" }, message: { id: "message-a", type: "text", text: "カレー" } },
  ] });
  const app = createServer({
    config: { lineSecret: "secret", maxConcurrentTurns: 1, codexWorkdir: "/tmp/oishinbot" },
    recipe: { generateRecipe: async () => { throw new Error("codex failed"); } },
    line: { reply: async (_token, text) => { replyText = text; } },
    logger,
  });

  const res = await request(app, body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.status, 200);
  assert.match(replyText, /少し待って/);
  assert.equal(replyText.includes("ログイン"), false);
  assert.ok(logger.records.some((r) => r.event === "line.generation.failed" && r.webhookEventId === "event-a"));
  assert.ok(logger.records.some((r) => r.event === "line.reply.sent" && r.replyKind === "fallback"));
  assert.equal(JSON.stringify(logger.records).includes("カレー"), false);
  assert.equal(JSON.stringify(logger.records).includes("reply-token-a"), false);
});

test("does not call Codex when LINE source cannot be isolated", async () => {
  let called = false;
  let replyText = "";
  const body = JSON.stringify({ events: [
    { type: "message", replyToken: "reply-token-a", source: { type: "group" }, message: { type: "text", text: "カレー" } },
  ] });
  const app = createServer({
    config: { lineSecret: "secret", codexWorkdir: "/tmp/oishinbot" },
    recipe: { generateRecipe: async () => { called = true; } },
    line: { reply: async (_token, text) => { replyText = text; } },
  });

  const res = await request(app, body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.status, 200);
  assert.equal(called, false);
  assert.match(replyText, /処理できません/);
});

test("rejects unauthorized LINE sources before Codex", async () => {
  let called = false;
  let replyText = "";
  const body = JSON.stringify({ events: [
    { type: "message", replyToken: "reply-token-a", source: { type: "user", userId: "U-other" }, message: { type: "text", text: "カレー" } },
  ] });
  const app = createServer({
    config: { lineSecret: "secret", allowedLineUserIds: ["U-allowed"], codexWorkdir: "/tmp/oishinbot" },
    recipe: { generateRecipe: async () => { called = true; } },
    line: { reply: async (_token, text) => { replyText = text; } },
  });

  const res = await request(app, body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.status, 200);
  assert.equal(called, false);
  assert.match(replyText, /利用できません/);
});

test("rate limits one LINE source before Codex", async () => {
  let calls = 0;
  const replies = [];
  const body = JSON.stringify({ events: [
    { type: "message", replyToken: "a", source: { type: "user", userId: "U-a" }, message: { type: "text", text: "カレー" } },
    { type: "message", replyToken: "b", source: { type: "user", userId: "U-a" }, message: { type: "text", text: "味噌汁" } },
  ] });
  const app = createServer({
    config: { lineSecret: "secret", sourceRateLimitMax: 1, sourceRateLimitWindowMs: 60000, maxConcurrentTurns: 2 },
    recipe: { generateRecipe: async () => { calls += 1; return "ok"; } },
    line: { reply: async (token, text) => replies.push([token, text]) },
  });

  const res = await request(app, body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.status, 200);
  assert.equal(calls, 1);
  assert.equal(replies.length, 2);
  assert.match(replies.find(([token]) => token === "b")[1], /短時間/);
});

test("drops excess queued events with a busy reply", async () => {
  const replies = [];
  const body = JSON.stringify({ events: [
    { type: "message", replyToken: "a", source: { type: "user", userId: "U-a" }, message: { type: "text", text: "カレー" } },
    { type: "message", replyToken: "b", source: { type: "user", userId: "U-b" }, message: { type: "text", text: "味噌汁" } },
  ] });
  const app = createServer({
    config: { lineSecret: "secret", maxConcurrentTurns: 1, maxQueuedTurns: 0 },
    recipe: { generateRecipe: async () => new Promise(() => {}) },
    line: { reply: async (token, text) => replies.push([token, text]) },
  });
  const res = await request(app, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.status, 200);
  assert.deepEqual(replies, [["b", "混み合っています。少し待ってからもう一度送ってください。"]]);
});

test("drops queued work that would exceed the reply deadline", async () => {
  const replies = [];
  const body = JSON.stringify({ events: [
    { type: "message", replyToken: "a", source: { type: "user", userId: "U-a" }, message: { type: "text", text: "カレー" } },
    { type: "message", replyToken: "b", source: { type: "user", userId: "U-b" }, message: { type: "text", text: "味噌汁" } },
    { type: "message", replyToken: "c", source: { type: "user", userId: "U-c" }, message: { type: "text", text: "副菜" } },
  ] });
  const app = createServer({
    config: { lineSecret: "secret", maxConcurrentTurns: 1, maxQueuedTurns: 10, turnTimeoutMs: 35000, replyDeadlineMs: 55000 },
    recipe: { generateRecipe: async () => new Promise(() => {}) },
    line: { reply: async (token, text) => replies.push([token, text]) },
  });
  const res = await request(app, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.status, 200);
  assert.deepEqual(replies, [
    ["b", "混み合っています。少し待ってからもう一度送ってください。"],
    ["c", "混み合っています。少し待ってからもう一度送ってください。"],
  ]);
});
