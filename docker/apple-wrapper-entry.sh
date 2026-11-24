#!/bin/sh
# Apple Music FairPlay 解密后端（wrapper-lite）启动脚本。
# 首次无登录态时自动用 Apple ID 登录；2FA 验证码写到挂载目录的 2fa.txt。
set -e
DATA=/app/rootfs/data
mkdir -p "$DATA"
# 让 Android 层用容器的 DNS（compose 的 dns: 已设成公网 DNS），否则 Apple 鉴权解析失败
mkdir -p /app/rootfs/etc
if [ -s /etc/resolv.conf ]; then cp /etc/resolv.conf /app/rootfs/etc/resolv.conf; fi
TOKEN="$DATA/mpl_db/kvs.sqlitedb"

if [ ! -f "$TOKEN" ]; then
  echo "[apple-wrapper] 未发现登录态，开始登录 Apple 账号…"
  if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo "[apple-wrapper] 缺少 USERNAME / PASSWORD（Apple ID）环境变量" >&2
    exit 1
  fi
  ./wrapper-lite-rootless --login "$USERNAME:$PASSWORD" --code-from-file \
    --base-dir /data --host 127.0.0.1 --port 12340 --dns 223.5.5.5,114.114.114.114 "$@" || true
  if [ ! -f "$TOKEN" ]; then
    echo "[apple-wrapper] 登录未完成（可能需要 2FA）：请把验证码写入 $DATA/2fa.txt 后重启容器" >&2
    exit 1
  fi
  echo "[apple-wrapper] Apple 账号登录成功，已缓存 token"
fi

exec ./wrapper-lite-rootless --base-dir /data --host 127.0.0.1 --port 12340 --dns 223.5.5.5,114.114.114.114 "$@"
