import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInitializeRequest,
  buildThreadResumeRequest,
  buildThreadStartRequest,
  buildThreadSetNameRequest,
  buildTurnStartRequest,
  readTurnIdFromTurnStart,
  readTurnIdFromTurnCompleted,
} from "../../src/codex/protocol.js";

test("builds JSON-RPC-like requests without jsonrpc", () => {
  const req = buildInitializeRequest();
  assert.equal(req.method, "initialize");
  assert.equal("jsonrpc" in req, false);
});

test("builds the current thread name request shape", () => {
  const req = buildThreadSetNameRequest("thread-1", "line:group:abc");
  assert.equal(req.method, "thread/name/set");
  assert.deepEqual(req.params, { threadId: "thread-1", name: "line:group:abc" });
});

test("adds Codex safety fields to thread and turn requests", () => {
  const thread = buildThreadStartRequest("/tmp/oishinbot");
  assert.equal(thread.params.ephemeral, false);
  assert.equal(thread.params.approvalPolicy, "never");
  assert.equal(thread.params.sandbox, "read-only");

  const turn = buildTurnStartRequest("thread-1", "prompt");
  assert.equal(turn.params.sandboxPolicy.networkAccess, false);
  assert.equal(turn.params.input[0].text, "prompt");
});

test("builds persistent thread resume requests with the same safety fields", () => {
  const req = buildThreadResumeRequest("thread-1", "/tmp/oishinbot/line/group/hash");
  assert.equal(req.method, "thread/resume");
  assert.equal(req.params.threadId, "thread-1");
  assert.equal(req.params.cwd, "/tmp/oishinbot/line/group/hash");
  assert.equal(req.params.excludeTurns, true);
  assert.equal(req.params.approvalPolicy, "never");
  assert.equal(req.params.sandbox, "read-only");
});

test("reads turn ids from the schema shape", () => {
  assert.equal(readTurnIdFromTurnStart({ turn: { id: "turn-1" } }), "turn-1");
  assert.equal(readTurnIdFromTurnCompleted({ threadId: "t", turn: { id: "turn-2" } }), "turn-2");
});
