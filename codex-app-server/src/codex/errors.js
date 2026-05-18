export class CodexUnavailableError extends Error {
  constructor(message = "Codex unavailable") {
    super(message);
    this.name = "CodexUnavailableError";
  }
}

export const publicCodexError = "Codex unavailable. Run npm run codex:check.";
