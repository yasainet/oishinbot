# oishinbot Codex App Server

LINE のメッセージを受け取り、OpenAI Codex App Server に料理相談を投げて返信する Node.js バックエンドです。

Claude API や `ANTHROPIC_API_KEY` は使いません。Codex CLI にログイン済みで、`codex app-server` が利用できるアカウントが必要です。

## できること

- LINE Messaging API の webhook を受け取る
- 署名を検証して、LINE からの正しいリクエストだけ処理する
- Codex App Server を `stdio` の子プロセスとして起動する
- LINE の user / group / room ごとに Codex thread を分ける
- 同じトークルームでは同じ thread を再利用する
- 許可した LINE source だけに利用を絞れる
- 送信元ごとの簡易 rate limit で使いすぎを抑える
- プレーンテキストで読みやすい料理相談の返答を作る
- ログから後で処理状況を追える
- Docker Compose でアプリと公開トンネルを分けて起動できる

## 必要なもの

- Node.js 24 以上
- Codex CLI
- LINE Messaging API チャネル
- ngrok など HTTPS で webhook を公開できる手段

## 環境変数

`.env.example` を `.env` にコピーして設定します。

```sh
cp .env.example .env
```

| 変数 | 説明 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINE Developers Console のチャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API のチャネルアクセストークン |
| `NGROK_AUTHTOKEN` | Docker Compose で ngrok を使う場合のトークン |
| `ALLOW_ALL_LINE_SOURCES` | allowlist なしで全 source を許可する場合だけ `true` |
| `ALLOWED_LINE_USER_IDS` | 許可する 1 対 1 トークの userId。カンマ区切り |
| `ALLOWED_LINE_GROUP_IDS` | 許可するグループの groupId。カンマ区切り |
| `ALLOWED_LINE_ROOM_IDS` | 許可する複数人トークの roomId。カンマ区切り |
| `SOURCE_RATE_LIMIT_MAX` | 送信元ごとの時間内上限 |
| `SOURCE_RATE_LIMIT_WINDOW_MS` | 送信元ごとの上限を数える時間 |
| `LINE_REPLY_DEADLINE_MS` | reply token 期限を超えそうな queued work を避ける目安 |
| `CODEX_WORKDIR` | Codex thread と作業ディレクトリの保存先 |
| `OISHINBOT_LOG_PATH` | JSONL ログの出力先 |
| `OISHINBOT_CODEX_CONFIG` | Codex App Server 起動時の設定ファイル |

`.env`、Codex の認証ファイル、ログ、会話 thread の保存ディレクトリは Git に含めないでください。

既定では、allowlist または `ALLOW_ALL_LINE_SOURCES=true` を設定しない限り、LINE source からのメッセージを Codex に渡しません。
小さく安全に試す場合は、自分の userId や検証用 groupId だけを allowlist に設定してください。

## Codex CLI の準備

```sh
npm install -g @openai/codex@0.130.0
codex login
codex app-server --help
```

`codex login` が完了してから `npm run codex:check` を実行してください。

## ローカル起動

Codex CLI にログインした状態で実行します。

```sh
npm install
npm test
npm run codex:check
npm start
```

別ターミナルで HTTPS の公開 URL を用意します。

```sh
ngrok http 3000
```

LINE Developers Console の Webhook URL には、公開 URL の末尾に `/webhook` を付けて設定します。

```text
https://example.ngrok-free.app/webhook
```

## Docker Compose

公開環境では、ホストに直接 Node.js を立てず、Docker Compose で隔離して動かせます。
Compose では named volume を使うため、Linux ホスト上で bind mount の所有権を調整する必要はありません。

```sh
docker compose run --rm app codex login
docker compose run --rm app npm run codex:check
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/healthz
```

Compose ではアプリのポートをホストの `127.0.0.1:3000` にだけ bind します。
外部公開は同じ Compose 内の ngrok コンテナが `app:3000` に接続します。

Codex の認証情報、thread、ログは Docker の named volume に保存されます。これらは Git 管理しません。
固定 ngrok ドメインを使う場合は、利用している ngrok の設定に合わせて `docker-compose.yml` の ngrok command を調整してください。

## 会話の分離

LINE の `source.type` と ID から、次の単位で会話を分けます。

- 1 対 1: `userId`
- グループ: `groupId`
- 複数人トーク: `roomId`

各会話は `CODEX_WORKDIR/line/<type>/<hash>/thread.json` に紐づきます。
このため、別のユーザー、別のグループ、別のルームの会話は別 thread になります。
source を特定できないイベントは Codex に渡さず、固定文を返します。

LINE の reply token は短時間で失効します。キュー待ちを含めて期限を超えそうな場合は、Codex を呼ばずに混雑時の固定文を返します。

## 安全設定

`oishinbot.codex.config.json` で Codex App Server の起動設定を制限しています。

```json
{
  "model_reasoning_effort": "low",
  "sandbox_mode": "read-only",
  "web_search": "disabled",
  "features.multi_agent": false,
  "features.apps": false,
  "features.plugins": false,
  "features.tool_search": false,
  "features.tool_suggest": false
}
```

また、Codex がコマンド実行やツール呼び出しを始めそうな通知を出した場合は、その turn を中断して fallback を返します。

## ログ

既定では `oishinbot-events.jsonl` に JSONL 形式でログを出します。
ログには会話の安全なハッシュ ID、thread ID、turn ID、処理結果を出します。
LINE の本文、プロンプト、アクセストークン、シークレット、認証ファイルのパスは出さない設計です。

## テスト

```sh
npm test
npm run test:unit
npm run test:integration
npm run codex:check
```

主に次を確認しています。

- LINE 署名検証
- webhook の正常系と fallback
- 会話ごとの Codex thread 分離
- 同じ会話での thread 再利用
- Codex App Server の安全設定
- ログの秘密情報マスク
