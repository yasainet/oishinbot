export class LineClient {
  constructor(token) {
    this.token = token;
  }

  async reply(replyToken, text) {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });
    if (!res.ok) throw new Error(`LINE reply failed: ${res.status}`);
  }
}
