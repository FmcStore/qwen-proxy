@echo off
chcp 65001 >nul
setlocal

REM Move para a raiz do projeto (pasta pai de scripts\)
cd /d "%~dp0.."

REM Titulo da janela do console
title QwenProxy - Login

call npm run login -- %*
if errorlevel 1 (
  echo.
  echo ❌ Processo de login finalizado com erro. Pressione qualquer tecla...
  pause >nul
)
endlocal
