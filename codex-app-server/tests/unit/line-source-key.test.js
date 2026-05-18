import test from "node:test";
import assert from "node:assert/strict";
import { conversationFromSource } from "../../src/line/sourceKey.js";

test("builds isolated hashed conversations for LINE user group and room sources", () => {
  const root = "/tmp/oishinbot";
  const user = conversationFromSource({ type: "user", userId: "Uraw-user" }, root);
  const group = conversationFromSource({ type: "group", groupId: "Graw-group", userId: "Uraw-user" }, root);
  const room = conversationFromSource({ type: "room", roomId: "Rraw-room", userId: "Uraw-user" }, root);

  assert.equal(user.type, "user");
  assert.equal(group.type, "group");
  assert.equal(room.type, "room");
  assert.notEqual(user.key, group.key);
  assert.notEqual(group.key, room.key);
  assert.match(group.cwd, /\/line\/group\/[a-f0-9]{32}$/);
  assert.equal(group.cwd.includes("Graw-group"), false);
  assert.equal(room.cwd.includes("Rraw-room"), false);
  assert.equal(user.cwd.includes("Uraw-user"), false);
});

test("rejects LINE sources that cannot identify a conversation", () => {
  assert.throws(() => conversationFromSource({ type: "group" }, "/tmp/oishinbot"), /groupId/);
  assert.throws(() => conversationFromSource({ type: "room" }, "/tmp/oishinbot"), /roomId/);
  assert.throws(() => conversationFromSource({ type: "user" }, "/tmp/oishinbot"), /userId/);
});
