import test from "node:test";
import assert from "node:assert/strict";
import { runCodexReadinessCheck } from "../../src/codex/readinessCheck.js";

test("returns zero on account and rate-limit success", async () => {
  let closed = false;
  const result = await runCodexReadinessCheck({
    client: { initialize: async () => {}, checkAccount: async () => {}, close: async () => (closed = true) },
  });
  assert.equal(result.code, 0);
  assert.equal(closed, true);
});

test("returns redacted failure and still closes client", async () => {
  let closed = false;
  const result = await runCodexReadinessCheck({
    client: { initialize: async () => {}, checkAccount: async () => { throw new Error("secret-token"); }, close: async () => (closed = true) },
  });
  assert.equal(result.code, 1);
  assert.equal(result.message.includes("secret-token"), false);
  assert.equal(closed, true);
});
