#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
docker compose up -d --build
docker compose ps
echo "KMusic: http://<NAS-IP>:8090"
