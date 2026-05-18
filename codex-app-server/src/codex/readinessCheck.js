export async function runCodexReadinessCheck({ client }) {
  try {
    await client.initialize();
    await client.checkAccount();
    return { code: 0, message: "Codex ready" };
  } catch {
    return { code: 1, message: "Codex unavailable. Check login, account limits, and codex app-server support." };
  } finally {
    await client.close?.();
  }
}
