import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

const sensitiveKey = /token|secret|authorization|password|rawbody|text|prompt/i;
const sensitiveText = /(bearer\s+[\w.-]+|sk-[\w-]+|token\s+\S+|secret\s+\S+|auth\.json|\/Users\/\S+|\/home\/\S+)/gi;

function sanitize(value) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}...` : value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value instanceof Error) return safeError(value);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sensitiveKey.test(k) ? "[redacted]" : sanitize(v)]),
    );
  }
  return String(value);
}

export function safeError(error) {
  if (!error) return null;
  return {
    name: error.name || "Error",
    message: String(error.message || error).replace(sensitiveText, "[redacted]").slice(0, 300),
  };
}

export class JsonlLogger {
  constructor({ path = "oishinbot-events.jsonl", stderr = true } = {}) {
    this.path = path;
    this.stderr = stderr;
    this.ready = path ? mkdir(dirname(path), { recursive: true }).catch(() => {}) : Promise.resolve();
  }

  info(event, fields = {}) { return this.write("info", event, fields); }
  warn(event, fields = {}) { return this.write("warn", event, fields); }
  error(event, fields = {}) { return this.write("error", event, fields); }

  async write(level, event, fields) {
    const record = { ts: new Date().toISOString(), level, event, ...sanitize(fields) };
    const line = `${JSON.stringify(record)}\n`;
    if (this.stderr) process.stderr.write(line);
    if (!this.path) return;
    try {
      await this.ready;
      await appendFile(this.path, line, "utf8");
    } catch {}
  }
}

export const nullLogger = {
  info: async () => {},
  warn: async () => {},
  error: async () => {},
};
