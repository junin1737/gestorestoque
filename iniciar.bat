@echo off
cd /d "%~dp0"
title Gestor Estoque - Servico MT Automacoes

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
echo Abrindo o APLICATIVO do servico (Electron)...
echo Configure o banco de dados na aba "Banco de dados".
echo O painel mobile acessa pelo IP mostrado + porta 5077.
echo.

call npm run electron
if errorlevel 1 (
  echo.
  echo Falha ao abrir Electron. Tentando apenas o servidor...
  start "" "http://127.0.0.1:5077/servico.html"
  node server/index.js
)
pause
