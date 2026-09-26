@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM 凭据文件：本地服务(Node) 与 连接服务(MCP) 共用项目内这一份（不入库）
if not defined XHS_COOKIE_FILE set "XHS_COOKIE_FILE=%~dp0data\cookies.json"
if not exist "%~dp0data" mkdir "%~dp0data"

echo ============================================
echo   绮点 AI 小红书运营平台
echo ============================================
echo.

echo [0/3] 连接服务（小红书 MCP，端口 18060）...
netstat -ano | findstr ":18060" | findstr LISTENING >nul
if errorlevel 1 (
  echo       未运行，正在拉起（需要 Clash 等代理在 7890 端口）...
  start "xhs-mcp" /min cmd /c "%~dp0scripts\start-mcp-local.bat"
  timeout /t 8 >nul
) else (
  echo       已在运行，跳过
)

echo [1/3] 启动本地服务（主地址 8787）...
start "xhs-ops" /min cmd /c "cd /d %~dp0server && node --no-warnings src/index.js"
timeout /t 3 >nul

echo [2/3] 启动兼容地址转发（5199 -^> 8787）...
start "xhs-ops-alias" /min cmd /c "cd /d %~dp0server && node --no-warnings src/alias-port.js"
timeout /t 3 >nul

echo.
echo   主地址:   http://127.0.0.1:8787
echo   兼容址:   http://127.0.0.1:5199
echo   凭据文件: %XHS_COOKIE_FILE%
echo.
echo   关闭本窗口不会停服务；要停止请关掉 xhs-mcp / xhs-ops / xhs-ops-alias 三个小窗口。
echo.
start "" http://127.0.0.1:8787
pause
