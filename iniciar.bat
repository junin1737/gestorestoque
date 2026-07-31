@echo off
cd /d "%~dp0"
title Gestor Estoque - MT Automacoes

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js e tente novamente.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Instalando dependencias...
  call npm install
)

echo.
echo Iniciando servico em http://127.0.0.1:5077
echo Mantenha esta janela aberta enquanto usar o painel.
echo.

start "" "http://127.0.0.1:5077"
node server/index.js
pause
