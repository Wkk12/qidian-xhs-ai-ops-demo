@echo off
chcp 65001 >nul
REM ============================================================
REM  Windows 版本地 MCP 启动（对应 Wkk 给 Mac 写的 scripts/start-mcp-local.sh）
REM  作用：用同一个凭据文件（项目内 data\cookies.json）启动小红书连接服务
REM  前提：Clash 等代理在 7890 端口运行（MCP 访问小红书需要）
REM ============================================================
setlocal
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"

if not defined XHS_COOKIE_FILE set "XHS_COOKIE_FILE=%PROJECT_ROOT%\data\cookies.json"
set "COOKIES_PATH=%XHS_COOKIE_FILE%"
if not exist "%PROJECT_ROOT%\data" mkdir "%PROJECT_ROOT%\data"

if not defined HTTPS_PROXY set "HTTPS_PROXY=http://127.0.0.1:7890"
if not defined XHS_PROXY set "XHS_PROXY=http://127.0.0.1:7890"

REM 优先用本机编译的修复版；没有再退回仓库里/用户目录里的现成版本
set "BIN=%PROJECT_ROOT%\.runtime\xiaohongshu-mcp-windows-amd64.exe"
if not exist "%BIN%" set "BIN=%PROJECT_ROOT%\mcp\xiaohongshu-mcp-windows-amd64.exe"
if not exist "%BIN%" set "BIN=%USERPROFILE%\xiaohongshu-mcp-go\bin\xiaohongshu-mcp-new.exe"
if not exist "%BIN%" set "BIN=%USERPROFILE%\xiaohongshu-mcp-go\bin\xiaohongshu-mcp-windows-amd64.exe"
if not exist "%BIN%" (
  echo [错误] 没找到 MCP 可执行文件，请先在项目里编译或用 mcp\ 目录里的版本。
  pause
  exit /b 1
)

echo 连接服务: %BIN%
echo 凭据文件: %COOKIES_PATH%
echo 代理:     %HTTPS_PROXY%
echo.
"%BIN%" -headless=true
