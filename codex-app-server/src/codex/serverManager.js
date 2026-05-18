import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

export function loadCodexOverrides(path) {
  if (!path) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function tomlValue(value) {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

export function buildCodexAppServerArgs(overrides = {}) {
  const args = ["app-server", "--listen", "stdio://"];
  for (const [key, value] of Object.entries(overrides)) {
    args.push("-c", `${key}=${tomlValue(value)}`);
  }
  return args;
}

export function startCodexAppServer(command = "codex", { overrides = {} } = {}) {
  return spawn(command, buildCodexAppServerArgs(overrides), {
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

export async function stopCodexAppServer(child, graceMs = 1000) {
  if (!child || child.killed) return;
  const done = new Promise((resolve) => child.once?.("close", resolve));
  try {
    process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill?.("SIGTERM");
  }
  const timer = setTimeout(() => {
    try {
      process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, graceMs);
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, graceMs + 100))]);
  clearTimeout(timer);
}
