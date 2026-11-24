FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11 --registry=https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY . .

# Apple 引擎（第三方二进制，仓库不内置）：vendor 里没有就在构建时下载
# 按目标架构选择引擎（amd64 / arm64）
ARG TARGETARCH=amd64
ARG APPLE_ENGINE_URL=https://github.com/zhaarey/apple-music-downloader/releases/latest/download/amdl_linux_${TARGETARCH}
RUN mkdir -p vendor \
    && if [ ! -s vendor/apple-music-dl ]; then \
         echo "vendor/apple-music-dl 缺失，从 $APPLE_ENGINE_URL 下载"; \
         wget -qO vendor/apple-music-dl "$APPLE_ENGINE_URL"; \
       fi \
    && chmod +x vendor/apple-music-dl

RUN pnpm build

FROM node:24-alpine
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache ffmpeg tini gosu \
    && npm install --prefix /opt/netease NeteaseCloudMusicApi@4.32.0 \
       --registry=https://registry.npmmirror.com --no-audit --no-fund --ignore-scripts

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    MUSIC_DIR=/music \
    NETEASE_API_URL=http://127.0.0.1:3000 \
    NETEASE_DIR=/opt/netease/node_modules/NeteaseCloudMusicApi

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/vendor/apple-music-dl /usr/local/bin/apple-music-dl
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/apple-music-dl

VOLUME ["/data", "/music"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
