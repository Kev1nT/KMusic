#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
MUSIC_DIR="${MUSIC_DIR:-/music}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
NETEASE_DIR="${NETEASE_DIR:-/opt/netease/node_modules/NeteaseCloudMusicApi}"

mkdir -p "$DATA_DIR" "$MUSIC_DIR"

start_netease() {
  if [ ! -d "$NETEASE_DIR" ]; then
    return 0
  fi
  (
    cd "$NETEASE_DIR"
    while true; do
      gosu "$PUID:$PGID" env PORT=3000 HOST=127.0.0.1 NODE_ENV=production node app.js
      sleep 3
    done
  ) >>"$DATA_DIR/netease-api.log" 2>&1 &
  # 等内部 API 起来，避免启动后的第一批网易云请求失败
  i=0
  while [ "$i" -lt 20 ]; do
    if node -e "fetch('http://127.0.0.1:3000/').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
}

if [ "$(id -u)" = "0" ]; then
  chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true
  chown "$PUID:$PGID" "$MUSIC_DIR" 2>/dev/null || true
  chmod 755 "$MUSIC_DIR" 2>/dev/null || true
  start_netease
  exec gosu "$PUID:$PGID" node server/dist/index.js
fi

start_netease
exec node server/dist/index.js
