import { CodexUnavailableError } from "./errors.js";

export class StdioTransport {
  constructor(child, { requestTimeoutMs = 35000 } = {}) {
    this.child = child;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = "";
    child.stdout.on("data", (data) => this.read(data));
    child.stderr?.on("data", () => {});
    child.on?.("close", () => this.failAll());
    child.on?.("error", () => this.failAll());
  }

  async connect() {}
  onNotification(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  sendNotification(method, params = {}) { this.child.stdin.write(`${JSON.stringify({ method, params })}\n`); }

  sendRequest(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexUnavailableError());
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  read(data) {
    this.buffer += data;
    for (;;) {
      const i = this.buffer.indexOf("\n");
      if (i < 0) return;
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { return this.failAll(); }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error ? p.reject(new CodexUnavailableError()) : p.resolve(msg.result);
      } else {
        for (const cb of this.listeners) cb(msg);
      }
    }
  }

  failAll() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new CodexUnavailableError());
    }
    this.pending.clear();
  }

  async close() {
    this.failAll();
    this.listeners.clear();
    this.child.stdin.destroy?.();
  }
}
