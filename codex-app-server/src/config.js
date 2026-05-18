export function loadConfig(env = process.env) {
  for (const key of ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  if (env.CODEX_APP_SERVER_URL) {
    throw new Error("Use Codex App Server over stdio, not CODEX_APP_SERVER_URL");
  }
  return {
    port: Number(env.PORT || 3000),
    lineSecret: env.LINE_CHANNEL_SECRET,
    lineToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    allowAllLineSources: env.ALLOW_ALL_LINE_SOURCES === "true",
    allowedLineUserIds: list(env.ALLOWED_LINE_USER_IDS),
    allowedLineGroupIds: list(env.ALLOWED_LINE_GROUP_IDS),
    allowedLineRoomIds: list(env.ALLOWED_LINE_ROOM_IDS),
    codexCommand: env.CODEX_COMMAND || "codex",
    codexConfigPath: env.OISHINBOT_CODEX_CONFIG || "oishinbot.codex.config.json",
    codexWorkdir: env.CODEX_WORKDIR || ".codex-workdir",
    logPath: env.OISHINBOT_LOG_PATH || "oishinbot-events.jsonl",
    turnTimeoutMs: Number(env.CODEX_TURN_TIMEOUT_MS || 35000),
    maxConcurrentTurns: Number(env.CODEX_MAX_CONCURRENT_TURNS || 2),
    maxQueuedTurns: Number(env.CODEX_MAX_QUEUED_TURNS || 10),
    replyDeadlineMs: Number(env.LINE_REPLY_DEADLINE_MS || 55000),
    sourceRateLimitMax: Number(env.SOURCE_RATE_LIMIT_MAX || 6),
    sourceRateLimitWindowMs: Number(env.SOURCE_RATE_LIMIT_WINDOW_MS || 60000),
  };
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
