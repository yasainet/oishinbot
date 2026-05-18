import test from "node:test";
import assert from "node:assert/strict";
import { verifyLineSignature } from "../../src/line/signature.js";

test("accepts a valid LINE signature for the raw body", () => {
  assert.equal(
    verifyLineSignature('{"events":[]}', "pkK1lVPJPiJ+wPLziRD79xIxohl8AImYM8AEeM7IbzQ=", "secret"),
    true,
  );
});

test("rejects an invalid or missing LINE signature", () => {
  assert.equal(verifyLineSignature('{"events":[]}', "bad", "secret"), false);
  assert.equal(verifyLineSignature('{"events":[]}', "", "secret"), false);
});

test("verifies the exact request bytes", () => {
  const body = Buffer.from(JSON.stringify({ events: [{ message: { text: "味噌汁" } }] }));
  const signature = "FibzMf3EBPiTfjvpzJjCtmuXIEw1euZo3H1+v2Rifyc=";
  assert.equal(verifyLineSignature(body, signature, "secret"), true);
});
