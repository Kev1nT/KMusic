#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
sudo docker compose up -d --build
sudo docker compose ps
echo "KMusic: http://<NAS-IP>:8090"
