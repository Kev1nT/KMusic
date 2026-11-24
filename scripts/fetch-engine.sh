#!/usr/bin/env bash
# 下载 Apple Music 下载引擎（apple-music-dl / amdl），放到 vendor/
# 仓库不内置该第三方二进制，构建镜像前先执行本脚本。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/vendor/apple-music-dl"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ASSET="amdl_linux_amd64" ;;
  aarch64|arm64) ASSET="amdl_linux_arm64" ;;
  *) echo "不支持的架构: $ARCH" >&2; exit 1 ;;
esac

URL="${APPLE_ENGINE_URL:-https://github.com/zhaarey/apple-music-downloader/releases/latest/download/$ASSET}"

mkdir -p "$(dirname "$DEST")"
echo "下载 Apple 引擎: $URL"
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 3 -o "$DEST" "$URL"
else
  wget -O "$DEST" "$URL"
fi
chmod +x "$DEST"
echo "完成: $DEST"
echo "如需指定版本/镜像源，可设置 APPLE_ENGINE_URL 后重试。"
