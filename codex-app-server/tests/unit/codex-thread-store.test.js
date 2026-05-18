import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileThreadStore } from "../../src/codex/threadStore.js";

test("writes and reads a Codex thread pointer for one conversation", async () => {
  const root = await mkdtemp(join(tmpdir(), "oishinbot-thread-store-"));
  const conversation = { cwd: join(root, "line", "group", "abc") };
  const store = new FileThreadStore();

  await store.write(conversation, "thread-1");

  assert.equal(await store.read(conversation), "thread-1");
});

test("ignores missing or corrupt Codex thread pointer files", async () => {
  const root = await mkdtemp(join(tmpdir(), "oishinbot-thread-store-"));
  const conversation = { cwd: join(root, "line", "group", "abc") };
  const store = new FileThreadStore();

  assert.equal(await store.read(conversation), null);
  await writeFile(await store.path(conversation), "{bad", "utf8").catch(async () => {
    await store.write(conversation, "thread-1");
    await writeFile(store.path(conversation), "{bad", "utf8");
  });

  assert.equal(await store.read(conversation), null);
});

test("runs one persistent thread store lock at a time", async () => {
  const root = await mkdtemp(join(tmpdir(), "oishinbot-thread-lock-"));
  const conversation = { cwd: join(root, "line", "group", "abc") };
  const store = new FileThreadStore();
  const order = [];
  let releaseFirst;
  const firstHolding = new Promise((resolve) => { releaseFirst = resolve; });

  const first = store.withLock(conversation, async () => {
    order.push("first-start");
    await firstHolding;
    order.push("first-end");
  });
  while (!order.includes("first-start")) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = store.withLock(conversation, async () => {
    order.push("second");
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});
