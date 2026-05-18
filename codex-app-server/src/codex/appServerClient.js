import { buildInitializedNotification, buildInitializeRequest, buildThreadResumeRequest, buildThreadSetNameRequest, buildThreadStartRequest, buildTurnInterruptParams, buildTurnStartRequest, readTurnIdFromTurnCompleted, readTurnIdFromTurnStart } from "./protocol.js";
import { CodexUnavailableError } from "./errors.js";
import { buildRecipePrompt } from "../recipe/prompt.js";
import { FileThreadStore } from "./threadStore.js";
import { nullLogger, safeError } from "../logging/logger.js";

const key = (threadId, turnId) => `${threadId}:${turnId}`;
const disallowed = (m) => /approval|command|fileChange|shellCommand|mcpServer\/tool\/call/i.test(m.method || JSON.stringify(m.params?.item || {}));

export class CodexClient {
  constructor({ transport, cwd, timeoutMs = 25000, threadStore = new FileThreadStore(), logger = nullLogger }) {
    this.transport = transport;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.threadStore = threadStore;
    this.logger = logger;
    this.ready = false;
    this.initializing = null;
    this.turns = new Map();
    this.conversationQueues = new Map();
    this.conversationThreads = new Map();
    transport.onNotification((m) => this.onNotification(m));
  }

  withTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CodexUnavailableError()), this.timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  request(method, params) {
    return this.withTimeout(this.transport.sendRequest(method, params));
  }

  async initialize() {
    if (this.ready) return;
    if (!this.initializing) {
      this.initializing = this.withTimeout((async () => {
        void this.logger.info("codex.initialize.started");
        await this.transport.connect();
        await this.transport.sendRequest("initialize", buildInitializeRequest().params);
        this.transport.sendNotification("initialized", {});
        this.ready = true;
        void this.logger.info("codex.initialize.succeeded");
      })()).catch((error) => {
        void this.logger.error("codex.initialize.failed", { error: safeError(error) });
        throw error;
      }).finally(() => { this.initializing = null; });
    }
    await this.initializing;
  }

  async checkAccount() {
    await this.request("account/read", {});
    await this.request("account/rateLimits/read", {});
  }

  async generateRecipe(text, conversation = null) {
    await this.initialize();
    const prompt = buildRecipePrompt(text);
    if (!conversation) return this.generateOnNewThread(prompt, this.cwd);
    return this.enqueueConversation(conversation.key, () => this.generateForConversation(prompt, conversation));
  }

  async enqueueConversation(conversationKey, task) {
    const previous = this.conversationQueues.get(conversationKey) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.conversationQueues.set(conversationKey, next);
    try {
      return await next;
    } finally {
      if (this.conversationQueues.get(conversationKey) === next) this.conversationQueues.delete(conversationKey);
    }
  }

  async generateForConversation(prompt, conversation) {
    const threadId = await this.threadIdFor(conversation);
    return this.startTurn(threadId, prompt, conversation);
  }

  async generateOnNewThread(prompt, cwd) {
    const thread = await this.request("thread/start", buildThreadStartRequest(cwd).params);
    const threadId = thread?.thread?.id;
    if (!threadId) throw new CodexUnavailableError();
    return this.startTurn(threadId, prompt);
  }

  async threadIdFor(conversation) {
    await this.threadStore.prepare?.(conversation);
    if (this.threadStore.withLock) {
      return this.threadStore.withLock(conversation, () => this.threadIdForLocked(conversation));
    }
    return this.threadIdForLocked(conversation);
  }

  async threadIdForLocked(conversation) {
    const meta = { conversationType: conversation.type, conversationSafeId: conversation.safeId };
    const loaded = this.conversationThreads.get(conversation.key);
    if (loaded) {
      void this.logger.info("codex.thread.loaded.reused", { ...meta, threadId: loaded });
      return loaded;
    }

    const saved = await this.threadStore.read(conversation);
    if (saved) {
      try {
        void this.logger.info("codex.thread.resume.started", { ...meta, threadId: saved });
        const resumed = await this.request("thread/resume", buildThreadResumeRequest(saved, conversation.cwd).params);
        const threadId = resumed?.thread?.id || saved;
        this.conversationThreads.set(conversation.key, threadId);
        void this.logger.info("codex.thread.resume.succeeded", { ...meta, threadId });
        return threadId;
      } catch (error) {
        void this.logger.warn("codex.thread.resume.failed", { ...meta, threadId: saved, error: safeError(error) });
      }
    }

    void this.logger.info("codex.thread.start.started", meta);
    const started = await this.request("thread/start", buildThreadStartRequest(conversation.cwd).params);
    const threadId = started?.thread?.id;
    if (!threadId) throw new CodexUnavailableError();
    await this.threadStore.write(conversation, threadId);
    this.conversationThreads.set(conversation.key, threadId);
    void this.logger.info("codex.thread.start.succeeded", { ...meta, threadId });
    if (conversation.name) {
      const nameRequest = buildThreadSetNameRequest(threadId, conversation.name);
      await this.request(nameRequest.method, nameRequest.params).catch(() => {});
    }
    return threadId;
  }

  async startTurn(threadId, prompt, conversation = null) {
    const meta = conversation ? { conversationType: conversation.type, conversationSafeId: conversation.safeId, threadId } : { threadId };
    void this.logger.info("codex.turn.starting", { ...meta, promptLength: [...String(prompt || "")].length });
    const turn = await this.request("turn/start", buildTurnStartRequest(threadId, prompt).params);
    const turnId = readTurnIdFromTurnStart(turn);
    if (!threadId || !turnId) throw new CodexUnavailableError();
    void this.logger.info("codex.turn.started", { ...meta, turnId });
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.transport.sendRequest("turn/interrupt", buildTurnInterruptParams(threadId, turnId)).catch(() => {});
        this.turns.delete(key(threadId, turnId));
        void this.logger.error("codex.turn.timeout", { ...meta, turnId });
        reject(new CodexUnavailableError());
      }, this.timeoutMs);
      this.turns.set(key(threadId, turnId), { ...meta, threadId, turnId, text: "", resolve, reject, timeout });
    });
  }

  onNotification(message) {
    if (disallowed(message)) {
      void this.logger.error("codex.disallowed_operation", { method: message.method });
      return this.abortAll();
    }
    const p = message.params || {};
    const turnId = message.method === "turn/completed" ? readTurnIdFromTurnCompleted(p) : p.turnId;
    const active = this.turns.get(key(p.threadId, turnId));
    if (!active) return;
    if (message.method === "item/agentMessage/delta") active.text += p.delta || "";
    if (message.method === "item/completed" && p.item?.type === "agentMessage" && !active.text) active.text = p.item.text || p.item.content || "";
    if (message.method === "turn/completed") {
      clearTimeout(active.timeout);
      this.turns.delete(key(p.threadId, turnId));
      if (p.turn?.status === "completed") {
        void this.logger.info("codex.turn.completed", {
          conversationType: active.conversationType,
          conversationSafeId: active.conversationSafeId,
          threadId: active.threadId,
          turnId: active.turnId,
          outputLength: [...active.text].length,
        });
        active.resolve(active.text.trim());
      } else {
        void this.logger.error("codex.turn.failed", {
          conversationType: active.conversationType,
          conversationSafeId: active.conversationSafeId,
          threadId: active.threadId,
          turnId: active.turnId,
          status: p.turn?.status,
        });
        active.reject(new CodexUnavailableError());
      }
    }
  }

  abortAll() {
    for (const active of this.turns.values()) {
      clearTimeout(active.timeout);
      this.transport.sendRequest("turn/interrupt", buildTurnInterruptParams(active.threadId, active.turnId)).catch(() => {});
      void this.logger.error("codex.turn.aborted", { threadId: active.threadId, turnId: active.turnId });
      active.reject(new CodexUnavailableError());
    }
    this.turns.clear();
  }

  close() { return this.transport.close(); }
}
