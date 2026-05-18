import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexAppServerArgs } from "../../src/codex/serverManager.js";

test("starts Codex App Server with repo-local safe and fast overrides", () => {
  const args = buildCodexAppServerArgs({
    "model_reasoning_effort": "low",
    "sandbox_mode": "read-only",
    "web_search": "disabled",
    "features.multi_agent": false,
  });

  assert.deepEqual(args.slice(0, 3), ["app-server", "--listen", "stdio://"]);
  assert.deepEqual(args.slice(3), [
    "-c", "model_reasoning_effort=\"low\"",
    "-c", "sandbox_mode=\"read-only\"",
    "-c", "web_search=\"disabled\"",
    "-c", "features.multi_agent=false",
  ]);
});
