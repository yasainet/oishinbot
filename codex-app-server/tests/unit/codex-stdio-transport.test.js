import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { StdioTransport } from "../../src/codex/stdioTransport.js";

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit("close", 0);
  return child;
}

test("matches out-of-order stdio responses by id", async () => {
  const child = fakeChild();
  const transport = new StdioTransport(child);
  const a = transport.sendRequest("a", {});
  const b = transport.sendRequest("b", {});
  child.stdout.write('{"id":2,"result":"B"}\n{"id":1,"result":"A"}\n');
  assert.deepEqual(await Promise.all([a, b]), ["A", "B"]);
});

test("dispatches notifications and rejects malformed JSON", async () => {
  const child = fakeChild();
  const transport = new StdioTransport(child);
  let seen;
  transport.onNotification((message) => (seen = message.method));
  child.stdout.write('{"method":"turn/completed","params":{}}\n');
  assert.equal(seen, "turn/completed");

  const pending = transport.sendRequest("slow", {});
  child.stdout.write("{bad json}\n");
  await assert.rejects(pending, /Codex unavailable/);
});

test("times out pending requests and drains stderr", async () => {
  const child = fakeChild();
  const transport = new StdioTransport(child, { requestTimeoutMs: 10 });
  const pending = transport.sendRequest("slow", {});
  child.stderr.write("ignored\n");
  await assert.rejects(pending, /Codex unavailable/);
});
