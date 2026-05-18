import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlLogger, safeError } from "../../src/logging/logger.js";

test("writes redacted JSONL logs for later inspection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oishinbot-log-"));
  const path = join(dir, "events.jsonl");
  const logger = new JsonlLogger({ path, stderr: false });

  await logger.info("line.reply.failed", {
    replyToken: "reply-secret",
    text: "カレー",
    lineToken: "line-secret",
    conversation: { type: "group", safeId: "abc" },
  });

  const line = await readFile(path, "utf8");
  const event = JSON.parse(line);
  assert.equal(event.event, "line.reply.failed");
  assert.equal(event.level, "info");
  assert.equal(event.conversation.type, "group");
  assert.equal(line.includes("reply-secret"), false);
  assert.equal(line.includes("line-secret"), false);
  assert.equal(line.includes("カレー"), false);
});

test("safeError keeps useful type and redacts sensitive message parts", () => {
  const err = safeError(new TypeError("failed with token abc in an auth file"));
  assert.equal(err.name, "TypeError");
  assert.equal(err.message.includes("token abc"), false);
  assert.equal(err.message.includes("auth file"), true);
  assert.equal("stack" in err, false);
});
