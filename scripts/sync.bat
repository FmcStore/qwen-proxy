@echo off
chcp 65001 >nul
setlocal

REM Move para a raiz do projeto (pasta pai de scripts\)
cd /d "%~dp0.."

REM Titulo da janela do console
title QwenProxy - Sincronizacao de Clientes

call npm run sync -- %*
if errorlevel 1 (
  echo.
  echo ❌ Sincronizacao finalizada com erro. Pressione qualquer tecla...
  pause >nul
)
endlocal
