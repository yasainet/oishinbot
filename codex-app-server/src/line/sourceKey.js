import { createHash } from "node:crypto";
import { resolve } from "node:path";

function requireValue(value, name) {
  if (!value) throw new Error(`Missing LINE ${name}`);
  return value;
}

export function conversationFromSource(source = {}, rootCwd = ".codex-workdir") {
  const type = source.type;
  const id = type === "user"
    ? requireValue(source.userId, "userId")
    : type === "group"
      ? requireValue(source.groupId, "groupId")
      : type === "room"
        ? requireValue(source.roomId, "roomId")
        : null;
  if (!id) throw new Error("Unsupported LINE source");

  const key = `${type}:${id}`;
  const safeId = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return {
    key,
    type,
    safeId,
    cwd: resolve(rootCwd, "line", type, safeId),
    name: `line:${type}:${safeId}`,
  };
}
