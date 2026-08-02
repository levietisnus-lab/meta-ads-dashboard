#!/usr/bin/env bash
# Khởi động máy chủ Hahaha trong mạng LAN công ty.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Chưa cài Node.js. Hãy cài bản LTS tại https://nodejs.org rồi chạy lại."
  exit 1
fi

[ -d node_modules ] || npm install

echo "Đang khởi động Hahaha... Giữ cửa sổ này mở để mọi người kết nối được."
exec node server.js
