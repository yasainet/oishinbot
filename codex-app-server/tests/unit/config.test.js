import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.js";

const good = {
  LINE_CHANNEL_SECRET: "s",
  LINE_CHANNEL_ACCESS_TOKEN: "t",
};

test("loads minimal config and defaults to stdio Codex", () => {
  const config = loadConfig(good);
  assert.equal(config.port, 3000);
  assert.equal(config.codexCommand, "codex");
  assert.equal(config.codexConfigPath, "oishinbot.codex.config.json");
  assert.equal(config.turnTimeoutMs, 35000);
  assert.equal(config.maxConcurrentTurns, 2);
  assert.equal(config.maxQueuedTurns, 10);
  assert.equal(config.replyDeadlineMs, 55000);
  assert.equal(config.sourceRateLimitMax, 6);
  assert.equal(config.allowAllLineSources, false);
  assert.deepEqual(config.allowedLineUserIds, []);
});

test("loads optional allowlists and limits", () => {
  const config = loadConfig({
    ...good,
    ALLOWED_LINE_USER_IDS: "U-a, U-b",
    ALLOWED_LINE_GROUP_IDS: "G-a",
    ALLOW_ALL_LINE_SOURCES: "true",
    SOURCE_RATE_LIMIT_MAX: "3",
    SOURCE_RATE_LIMIT_WINDOW_MS: "1000",
    LINE_REPLY_DEADLINE_MS: "5000",
  });
  assert.deepEqual(config.allowedLineUserIds, ["U-a", "U-b"]);
  assert.deepEqual(config.allowedLineGroupIds, ["G-a"]);
  assert.equal(config.allowAllLineSources, true);
  assert.equal(config.sourceRateLimitMax, 3);
  assert.equal(config.sourceRateLimitWindowMs, 1000);
  assert.equal(config.replyDeadlineMs, 5000);
});

test("rejects missing LINE secrets without exposing values", () => {
  assert.throws(() => loadConfig({ LINE_CHANNEL_SECRET: "secret-value" }), /LINE_CHANNEL_ACCESS_TOKEN/);
});

test("rejects network Codex URL config", () => {
  assert.throws(() => loadConfig({ ...good, CODEX_APP_SERVER_URL: "ws://example.com" }), /stdio/);
});
