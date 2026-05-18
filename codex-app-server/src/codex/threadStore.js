import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class FileThreadStore {
  path(conversation) {
    return join(conversation.cwd, "thread.json");
  }

  async prepare(conversation) {
    await mkdir(conversation.cwd, { recursive: true });
  }

  async read(conversation) {
    try {
      const data = JSON.parse(await readFile(this.path(conversation), "utf8"));
      return typeof data.threadId === "string" && data.threadId ? data.threadId : null;
    } catch {
      return null;
    }
  }

  async write(conversation, threadId) {
    await this.prepare(conversation);
    const file = this.path(conversation);
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ threadId })}\n`, "utf8");
    await rename(tmp, file);
  }

  async withLock(conversation, fn) {
    await this.prepare(conversation);
    const lock = join(conversation.cwd, ".thread.lock");
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if (error?.code !== "EEXIST" || Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
