@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM 新版本会去读「项目内 data\cookies.json」；本机 MCP 的凭据在用户目录，这里显式指过去（只在本机生效）
if not defined XHS_COOKIE_FILE set "XHS_COOKIE_FILE=%USERPROFILE%\xiaohongshu-mcp-go\cookies.json"

echo ============================================
echo   绮点 AI 小红书运营平台
echo ============================================
echo.

echo [1/2] 启动本地服务（主地址 8787）...
start "xhs-ops" /min cmd /c "cd /d %~dp0server && node --no-warnings src/index.js"
timeout /t 3 >nul

echo [2/2] 启动旧地址转发（5199 -> 8787）...
start "xhs-ops-alias" /min cmd /c "cd /d %~dp0server && node --no-warnings src/alias-port.js"
timeout /t 3 >nul

echo.
echo   主地址:  http://127.0.0.1:8787
echo   兼容址:  http://127.0.0.1:5199
echo   健康检查: http://127.0.0.1:8787/api/health
echo.
echo 正在打开浏览器...
start "" http://127.0.0.1:8787

echo.
echo 启动完成（关闭那两个最小化窗口即停止服务）
timeout /t 6 >nul
