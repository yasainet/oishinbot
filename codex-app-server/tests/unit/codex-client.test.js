import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexClient } from "../../src/codex/appServerClient.js";
import { FileThreadStore } from "../../src/codex/threadStore.js";

class FakeTransport extends EventEmitter {
  constructor() {
    super();
    this.i = 0;
    this.counts = {};
  }
  async connect() {}
  sendNotification() {}
  close() {}
  onNotification(cb) {
    this.on("n", cb);
  }
  async sendRequest(method, params) {
    this.counts[method] = (this.counts[method] || 0) + 1;
    if (method === "initialize") return {};
    if (method === "thread/start") return { thread: { id: `thread-${++this.i}` } };
    if (method === "turn/start") return { turn: { id: `turn-${params.threadId.split("-")[1]}` } };
    if (method === "turn/interrupt") return {};
    throw new Error(method);
  }
}

class AutoTransport extends EventEmitter {
  constructor() {
    super();
    this.thread = 0;
    this.turn = 0;
    this.requests = [];
  }
  async connect() {}
  sendNotification() {}
  close() {}
  onNotification(cb) {
    this.on("n", cb);
  }
  async sendRequest(method, params) {
    this.requests.push([method, params]);
    if (method === "initialize") return {};
    if (method === "thread/start") return { thread: { id: `thread-${++this.thread}` } };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "thread/name/set") return {};
    if (method === "turn/start") {
      const turnId = `turn-${++this.turn}`;
      setImmediate(() => {
        this.emit("n", { method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, delta: `${params.threadId}:${params.input[0].text}` } });
        this.emit("n", { method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      });
      return { turn: { id: turnId } };
    }
    if (method === "turn/interrupt") return {};
    throw new Error(method);
  }
}

class MemoryThreadStore {
  constructor() {
    this.map = new Map();
  }
  async read(conversation) {
    return this.map.get(conversation.key) || null;
  }
  async write(conversation, threadId) {
    this.map.set(conversation.key, threadId);
  }
}


const groupA = { key: "group:g-a", type: "group", safeId: "aaa", cwd: "/tmp/oishinbot/line/group/aaa", name: "line:group:aaa" };
const groupB = { key: "group:g-b", type: "group", safeId: "bbb", cwd: "/tmp/oishinbot/line/group/bbb", name: "line:group:bbb" };

function memoryLogger() {
  const records = [];
  return {
    records,
    info: async (event, fields) => records.push({ level: "info", event, ...fields }),
    warn: async (event, fields) => records.push({ level: "warn", event, ...fields }),
    error: async (event, fields) => records.push({ level: "error", event, ...fields }),
  };
}

test("keeps concurrent recipe turns separated on one client", async () => {
  const transport = new FakeTransport();
  const client = new CodexClient({ transport, cwd: "/tmp/oishinbot", timeoutMs: 1000 });
  const first = client.generateRecipe("カレー");
  const second = client.generateRecipe("味噌汁");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit("n", { method: "item/agentMessage/delta", params: { threadId: "thread-2", turnId: "turn-2", delta: "second" } });
  transport.emit("n", { method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", delta: "first" } });
  transport.emit("n", { method: "turn/completed", params: { threadId: "thread-2", turn: { id: "turn-2", status: "completed" } } });
  transport.emit("n", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
});

test("initializes only once during concurrent cold starts", async () => {
  const transport = new FakeTransport();
  const client = new CodexClient({ transport, cwd: "/tmp/oishinbot", timeoutMs: 1000 });
  const first = client.generateRecipe("カレー");
  const second = client.generateRecipe("味噌汁");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit("n", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
  transport.emit("n", { method: "turn/completed", params: { threadId: "thread-2", turn: { id: "turn-2", status: "completed" } } });
  await Promise.all([first, second]);
  assert.equal(transport.counts.initialize, 1);
});

test("times out before a turn id exists", async () => {
  const transport = new FakeTransport();
  transport.sendRequest = async (method) => {
    if (method === "initialize") return {};
    if (method === "thread/start") return new Promise(() => {});
    throw new Error(method);
  };
  const client = new CodexClient({ transport, cwd: "/tmp/oishinbot", timeoutMs: 10 });
  await assert.rejects(client.generateRecipe("カレー"), /Codex unavailable/);
});

test("interrupts active turns when Codex reports a disallowed operation", async () => {
  const transport = new FakeTransport();
  const client = new CodexClient({ transport, cwd: "/tmp/oishinbot", timeoutMs: 1000 });
  const recipe = client.generateRecipe("カレー");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  transport.emit("n", { method: "mcpServer/tool/call", params: { threadId: "thread-1", turnId: "turn-1" } });
  await assert.rejects(recipe, /Codex unavailable/);
  assert.equal(transport.counts["turn/interrupt"], 1);
});

test("keeps the same loaded Codex thread for repeated messages in one LINE conversation", async () => {
  const transport = new AutoTransport();
  const client = new CodexClient({ transport, cwd: "/tmp/oishinbot", timeoutMs: 1000, threadStore: new MemoryThreadStore() });

  await client.generateRecipe("カレー", groupA);
  await client.generateRecipe("続きで副菜も", groupA);

  assert.equal(transport.requests.filter(([method]) => method === "thread/start").length, 1);
  assert.equal(transport.requests.filter(([method]) => method === "thread/name/set").length, 1);
  assert.equal(transport.requests.filter(([method]) => method === "thread/resume").length, 0);
  assert.deepEqual(
    transport.requests.filter(([method]) => method === "turn/start").map(([, params]) => params.threadId),
    ["thread-1", "thread-1"],
  );
});

test("resumes a persisted Codex thread only after a client restart", async () => {
  const store = new MemoryThreadStore();
  const firstTransport = new AutoTransport();
  const firstClient = new CodexClient({ transport: firstTransport, cwd: "/tmp/oishinbot", timeoutMs: 1000, threadStore: store });
  await firstClient.generateRecipe("カレー", groupA);

  const secondTransport = new AutoTransport();
  const secondClient = new CodexClient({ transport: secondTransport, cwd: "/tmp/oishinbot", timeoutMs: 1000, threadStore: store });
  await secondClient.generateRecipe("続き", groupA);

  assert.equal(secondTransport.requests.filter(([method]) => method === "thread/start").length, 0);
  assert.equal(secondTransport.requests.filter(([method]) => method === "thread/resume").length, 1);
  assert.deepEqual(
    secondTransport.requests.filter(([method]) => method === "turn/start").map(([, params]) => params.threadId),
    ["thread-1"],
  );
});

test("keeps different LINE conversations on different Codex threads", async () => {
  const transport = new AutoTransport();
  const client = new CodexClient({ transport, cwd: "/tmp/oishinbot", timeoutMs: 1000, threadStore: new MemoryThreadStore() });

  await Promise.all([
    client.generateRecipe("カレー", groupA),
    client.generateRecipe("味噌汁", groupB),
  ]);

  assert.equal(transport.requests.filter(([method]) => method === "thread/start").length, 2);
  assert.deepEqual(
    transport.requests.filter(([method]) => method === "thread/start").map(([, params]) => params.cwd).sort(),
    [groupA.cwd, groupB.cwd].sort(),
  );
});

test("creates a conversation cwd before starting a persistent Codex thread", async () => {
  const root = await mkdtemp(join(tmpdir(), "oishinbot-client-"));
  const conversation = { key: "group:new", type: "group", safeId: "new", cwd: join(root, "line", "group", "new"), name: "line:group:new" };
  const transport = new AutoTransport();
  transport.sendRequest = async (method, params) => {
    transport.requests.push([method, params]);
    if (method === "initialize") return {};
    if (method === "thread/start") {
      assert.equal(existsSync(params.cwd), true);
      return { thread: { id: "thread-1" } };
    }
    if (method === "thread/name/set") return {};
    if (method === "turn/start") {
      setImmediate(() => {
        transport.emit("n", { method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId: "turn-1", delta: "ok" } });
        transport.emit("n", { method: "turn/completed", params: { threadId: params.threadId, turn: { id: "turn-1", status: "completed" } } });
      });
      return { turn: { id: "turn-1" } };
    }
    throw new Error(method);
  };

  const client = new CodexClient({ transport, cwd: root, timeoutMs: 1000, threadStore: new FileThreadStore() });

  assert.equal(await client.generateRecipe("カレー", conversation), "ok");
});

test("serializes persistent thread creation across client instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "oishinbot-lock-"));
  const conversation = { key: "group:same", type: "group", safeId: "same", cwd: join(root, "line", "group", "same"), name: "line:group:same" };
  const store = new FileThreadStore();
  const firstTransport = new AutoTransport();
  const secondTransport = new AutoTransport();
  const first = new CodexClient({ transport: firstTransport, cwd: root, timeoutMs: 1000, threadStore: store });
  const second = new CodexClient({ transport: secondTransport, cwd: root, timeoutMs: 1000, threadStore: store });

  await Promise.all([
    first.generateRecipe("カレー", conversation),
    second.generateRecipe("続き", conversation),
  ]);

  const starts = [
    ...firstTransport.requests,
    ...secondTransport.requests,
  ].filter(([method]) => method === "thread/start");
  const resumes = [
    ...firstTransport.requests,
    ...secondTransport.requests,
  ].filter(([method]) => method === "thread/resume");
  assert.equal(starts.length, 1);
  assert.equal(resumes.length, 1);
});

test("logs Codex thread and turn lifecycle without prompt text", async () => {
  const transport = new AutoTransport();
  const logger = memoryLogger();
  const client = new CodexClient({ transport, cwd: "/tmp/oishinbot", timeoutMs: 1000, threadStore: new MemoryThreadStore(), logger });

  await client.generateRecipe("カレー", groupA);

  assert.ok(logger.records.some((r) => r.event === "codex.thread.start.succeeded" && r.conversationSafeId === "aaa"));
  assert.ok(logger.records.some((r) => r.event === "codex.turn.completed" && r.threadId === "thread-1"));
  assert.equal(JSON.stringify(logger.records).includes("カレー"), false);
});
