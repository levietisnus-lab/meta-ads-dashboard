@echo off
chcp 65001 >nul
title Hahaha - may chu noi bo
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Chua cai Node.js. Hay tai ban LTS tai https://nodejs.org roi chay lai file nay.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Dang cai dat lan dau, vui long doi...
  call npm install
)

echo.
echo  Dang khoi dong Hahaha... Giu cua so nay mo de moi nguoi ket noi duoc.
echo.
node server.js
pause
