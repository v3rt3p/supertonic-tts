FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod=false --frozen-lockfile=false

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=9150
ENV ASSETS_PATH=/app/assets
VOLUME ["/app/assets"]
EXPOSE 9150
CMD ["pnpm", "start"]
