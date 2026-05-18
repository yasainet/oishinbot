FROM node:24.11.1-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.130.0

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p /app/logs /app/.codex-workdir /home/node/.codex \
  && chown -R node:node /app/logs /app/.codex-workdir /home/node/.codex

USER node

ENV NODE_ENV=production \
  PORT=3000 \
  CODEX_HOME=/home/node/.codex \
  CODEX_WORKDIR=/app/.codex-workdir \
  OISHINBOT_LOG_PATH=/app/logs/oishinbot-events.jsonl \
  OISHINBOT_CODEX_CONFIG=/app/oishinbot.codex.config.json

EXPOSE 3000

CMD ["npm", "start"]
