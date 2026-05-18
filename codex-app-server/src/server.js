import "dotenv/config";
import express from "express";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { verifyLineSignature } from "./line/signature.js";
import { LineClient } from "./line/client.js";
import { loadCodexOverrides, startCodexAppServer, stopCodexAppServer } from "./codex/serverManager.js";
import { StdioTransport } from "./codex/stdioTransport.js";
import { CodexClient } from "./codex/appServerClient.js";
import { conversationFromSource } from "./line/sourceKey.js";
import { JsonlLogger, safeError, nullLogger } from "./logging/logger.js";

function createLimit(max, maxQueued, { maxEstimatedWaitMs = 55000, estimatedTurnMs = 35000 } = {}) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { task, resolve } = queue.shift();
    resolve(task().finally(() => {
      active -= 1;
      runNext();
    }));
  };
  return (task) => {
    if (active >= max && maxEstimatedWaitMs > 0) {
      const totalSlots = Math.floor(queue.length / max) + 2;
      if (totalSlots * estimatedTurnMs > maxEstimatedWaitMs) return false;
    }
    if (active >= max && queue.length >= maxQueued) return false;
    return new Promise((resolve) => {
      queue.push({ task, resolve });
      runNext();
    });
  };
}

function createSourceLimiter(max = 6, windowMs = 60000) {
  const windows = new Map();
  return (key) => {
    if (!key || max <= 0 || windowMs <= 0) return true;
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= max;
  };
}

function allowedSource(source, config) {
  const configured = [
    config.allowedLineUserIds,
    config.allowedLineGroupIds,
    config.allowedLineRoomIds,
  ].some((ids) => ids?.length);
  if (!configured) return config.allowAllLineSources !== false;
  if (source?.type === "user") return config.allowedLineUserIds?.includes(source.userId);
  if (source?.type === "group") return config.allowedLineGroupIds?.includes(source.groupId);
  if (source?.type === "room") return config.allowedLineRoomIds?.includes(source.roomId);
  return false;
}

export function createServer({ config, recipe, line, logger = null }) {
  const app = express();
  logger = logger || config.logger || nullLogger;
  const limit = createLimit(config.maxConcurrentTurns || 2, config.maxQueuedTurns ?? 10, {
    maxEstimatedWaitMs: config.replyDeadlineMs ?? 55000,
    estimatedTurnMs: config.turnTimeoutMs || 35000,
  });
  const sourceAllowed = createSourceLimiter(config.sourceRateLimitMax ?? 6, config.sourceRateLimitWindowMs ?? 60000);
  const seen = new Set();
  app.use(express.json({
    limit: "32kb",
    verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); },
  }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.post("/webhook", (req, res) => {
    if (!verifyLineSignature(req.rawBody, req.get("x-line-signature"), config.lineSecret)) {
      void logger.warn("line.webhook.rejected", { reason: "invalid_signature" });
      return res.sendStatus(401);
    }
    void logger.info("line.webhook.accepted", { eventCount: req.body?.events?.length || 0 });
    res.sendStatus(200);
    const jobs = [];
    for (const event of req.body?.events || []) {
      const base = {
        webhookEventId: event.webhookEventId,
        eventType: event.type,
        messageType: event.message?.type,
        messageId: event.message?.id,
      };
      if (event.type !== "message" || event.message?.type !== "text" || !event.replyToken) {
        void logger.info("line.event.skipped", { ...base, reason: "unsupported_event" });
        continue;
      }
      if (event.webhookEventId) {
        if (seen.has(event.webhookEventId)) {
          void logger.info("line.event.duplicate", base);
          continue;
        }
        seen.add(event.webhookEventId);
        if (seen.size > 1000) seen.delete(seen.values().next().value);
      }
      let conversation;
      try {
        conversation = conversationFromSource(event.source, resolve(config.codexWorkdir || ".codex-workdir"));
      } catch (error) {
        void logger.error("line.conversation.failed", { ...base, error: safeError(error) });
        jobs.push(line.reply(event.replyToken, "このメッセージは処理できません。別のトークで送ってください。")
          .then(() => logger.warn("line.reply.sent", { ...base, replyKind: "invalid_source" }))
          .catch((replyError) => logger.error("line.reply.failed", { ...base, replyKind: "invalid_source", error: safeError(replyError) })));
        continue;
      }
      const logBase = {
        ...base,
        conversationType: conversation?.type,
        conversationSafeId: conversation?.safeId,
        messageLength: [...String(event.message.text || "")].length,
      };
      if (!allowedSource(event.source, config)) {
        jobs.push(line.reply(event.replyToken, "このトークでは利用できません。管理者に確認してください。")
          .then(() => logger.warn("line.reply.sent", { ...logBase, replyKind: "unauthorized" }))
          .catch((error) => logger.error("line.reply.failed", { ...logBase, replyKind: "unauthorized", error: safeError(error) })));
        continue;
      }
      if (!sourceAllowed(conversation.key)) {
        jobs.push(line.reply(event.replyToken, "短時間にたくさん届いています。少し待ってからもう一度送ってください。")
          .then(() => logger.warn("line.reply.sent", { ...logBase, replyKind: "rate_limited" }))
          .catch((error) => logger.error("line.reply.failed", { ...logBase, replyKind: "rate_limited", error: safeError(error) })));
        continue;
      }
      const job = limit(async () => {
        const fallback = "今は料理サポートを返せません。少し待ってからもう一度送ってください。";
        try {
          void logger.info("line.generation.started", logBase);
          await line.reply(event.replyToken, await recipe.generateRecipe(event.message.text, conversation));
          void logger.info("line.reply.sent", { ...logBase, replyKind: "generated" });
        } catch (error) {
          void logger.error("line.generation.failed", { ...logBase, error: safeError(error) });
          await line.reply(event.replyToken, fallback)
            .then(() => logger.info("line.reply.sent", { ...logBase, replyKind: "fallback" }))
            .catch((replyError) => logger.error("line.reply.failed", { ...logBase, replyKind: "fallback", error: safeError(replyError) }));
        }
      });
      jobs.push(job || line.reply(event.replyToken, "混み合っています。少し待ってからもう一度送ってください。")
        .then(() => logger.warn("line.reply.sent", { ...logBase, replyKind: "busy" }))
        .catch((error) => logger.error("line.reply.failed", { ...logBase, replyKind: "busy", error: safeError(error) })));
    }
    void Promise.allSettled(jobs);
  });
  return app;
}

export async function start() {
  const config = loadConfig();
  mkdirSync(config.codexWorkdir, { recursive: true });
  config.logger = new JsonlLogger({ path: config.logPath });
  void config.logger.info("app.starting", { port: config.port, codexWorkdirConfigured: Boolean(config.codexWorkdir), logPathConfigured: Boolean(config.logPath) });
  const codexOverrides = loadCodexOverrides(config.codexConfigPath);
  const child = startCodexAppServer(config.codexCommand, { overrides: codexOverrides });
  const codex = new CodexClient({
    transport: new StdioTransport(child, { requestTimeoutMs: config.turnTimeoutMs }),
    cwd: resolve(config.codexWorkdir),
    timeoutMs: config.turnTimeoutMs,
    logger: config.logger,
  });
  const app = createServer({ config, recipe: codex, line: new LineClient(config.lineToken) });
  const server = app.listen(config.port, () => {
    console.log(`oishinbot listening on ${config.port}`);
    void config.logger.info("app.listening", { port: config.port });
  });
  const shutdown = async () => {
    server.close();
    await codex.close();
    await stopCodexAppServer(child);
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
