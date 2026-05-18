import { resolve } from "node:path";
import { startCodexAppServer, stopCodexAppServer } from "../src/codex/serverManager.js";
import { StdioTransport } from "../src/codex/stdioTransport.js";
import { CodexClient } from "../src/codex/appServerClient.js";
import { runCodexReadinessCheck } from "../src/codex/readinessCheck.js";

const child = startCodexAppServer(process.env.CODEX_COMMAND || "codex");
const client = new CodexClient({
  transport: new StdioTransport(child),
  cwd: resolve(process.env.CODEX_WORKDIR || ".codex-workdir"),
  timeoutMs: 10000,
});

const result = await runCodexReadinessCheck({ client });
await stopCodexAppServer(child);
console.log(result.message);
process.exit(result.code);
