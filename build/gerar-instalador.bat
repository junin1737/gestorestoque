@echo off
cd /d "%~dp0.."
title Build instalador - Gestor Estoque

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado.
  pause
  exit /b 1
)

if not exist "node_modules\electron-builder\" (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo Falha no npm install.
    pause
    exit /b 1
  )
)

if not exist "MTdll\fbclient.dll" (
  echo AVISO: MTdll\fbclient.dll nao encontrado.
)
if not exist "MTdll\fbclient5.dll" (
  echo AVISO: MTdll\fbclient5.dll nao encontrado.
)

echo.
echo Gerando instalador Windows x64...
echo.

call npm run build
if errorlevel 1 (
  echo.
  echo Falha no build.
  pause
  exit /b 1
)

echo.
echo Concluido. Arquivos em: dist\
dir /b dist\*.exe 2>nul
echo.
pause
