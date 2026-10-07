FROM node:24-bookworm-slim AS provider-build

ARG BGUTIL_VERSION=2.0.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${BGUTIL_VERSION}" \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci \
    && npx tsc \
    && npm prune --omit=dev

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    BGUTIL_PORT=4416 \
    YTDLP_PATH=/opt/ytdlp/bin/yt-dlp

ARG YTDLP_VERSION=2026.8.19
ARG BGUTIL_VERSION=2.0.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
      libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/ytdlp \
    && /opt/ytdlp/bin/pip install --no-cache-dir \
      "yt-dlp[default]==${YTDLP_VERSION}" \
      "bgutil-ytdlp-pot-provider==${BGUTIL_VERSION}"

COPY --from=provider-build /opt/bgutil/server/build /opt/bgutil/server/build
COPY --from=provider-build /opt/bgutil/server/node_modules /opt/bgutil/server/node_modules
COPY --from=provider-build /opt/bgutil/server/package.json /opt/bgutil/server/package.json

WORKDIR /app
COPY package.json ./package.json
COPY src ./src

RUN mkdir -p /tmp/subtitle-service \
    && chown -R node:node /app /tmp/subtitle-service

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
