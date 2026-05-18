let nextId = 1;
const id = () => nextId++;

export function buildInitializeRequest() {
  return { id: id(), method: "initialize", params: { clientInfo: { name: "oishinbot", title: "Oishinbot", version: "0.1.0" } } };
}

export const buildInitializedNotification = () => ({ method: "initialized", params: {} });

const cookingSupportInstructions = [
  "You are a Japanese cooking supporter for LINE chat.",
  "Help with recipes, ingredients, substitutions, cooking order, storage, and practical troubleshooting.",
  "Use the existing thread context when it is relevant, but never assume facts that are not in this chat.",
  "If the request is unclear, ask one or two short clarifying questions instead of inventing details.",
  "For non-cooking requests, briefly say you can help with cooking topics.",
  "Do not run tools or commands.",
].join(" ");

export function buildThreadStartRequest(cwd) {
  return {
    id: id(),
    method: "thread/start",
    params: {
      ephemeral: false,
      approvalPolicy: "never",
      sandbox: "read-only",
      cwd,
      baseInstructions: cookingSupportInstructions,
      experimentalRawEvents: false,
    },
  };
}

export function buildThreadResumeRequest(threadId, cwd) {
  return {
    id: id(),
    method: "thread/resume",
    params: {
      threadId,
      cwd,
      excludeTurns: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: cookingSupportInstructions,
    },
  };
}

export function buildThreadSetNameRequest(threadId, name) {
  return {
    id: id(),
    method: "thread/name/set",
    params: { threadId, name },
  };
}

export function buildTurnStartRequest(threadId, prompt) {
  return {
    id: id(),
    method: "turn/start",
    params: {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      effort: "low",
    },
  };
}

export const readTurnIdFromTurnStart = (result) => result?.turn?.id;
export const readTurnIdFromTurnCompleted = (params) => params?.turn?.id;
export const buildTurnInterruptParams = (threadId, turnId) => ({ threadId, turnId });
