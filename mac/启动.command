#!/bin/bash
# ============================================================
#  绮点 AI 小红书运营平台 · macOS 启动器（Intel / Apple Silicon 通用）
#
#  用法：双击本文件即可。
#  首次运行会自动安装依赖，之后每次运行约 5 秒启动。
#  若双击没反应：右键 → 打开；或在「终端」里执行
#      chmod +x 启动.command && ./启动.command
# ============================================================
set -u

cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/启动.log"

say() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"
}

say "============================================"
say " 绮点 AI 小红书运营平台 正在启动"
say "============================================"

# ---------- 1. 检查 Node ----------
if ! command -v node >/dev/null 2>&1; then
  say "❌ 没有检测到 Node.js"
  say ""
  say "请先安装 Node.js 22（免费）："
  say "  1) 打开 https://nodejs.org/zh-cn"
  say "  2) 下载 LTS 版本（.pkg），双击安装"
  say "  3) 安装完再双击本文件"
  open "https://nodejs.org/zh-cn" 2>/dev/null
  read -n 1 -s -r -p "按任意键退出…"
  exit 1
fi
NODE_VER="$(node -v)"
NODE_MAJOR="$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')"
say "Node.js 版本：$NODE_VER"
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "⚠️  当前 Node 版本偏低（建议 20 或 22）。继续尝试启动…"
fi

# ---------- 2. 首次运行装依赖 ----------
if [ ! -d "server/node_modules" ]; then
  say "首次运行：正在安装依赖（约 1–3 分钟，只需一次）…"
  (cd server && npm install --no-audit --no-fund) >>"$LOG" 2>&1
  if [ $? -ne 0 ]; then
    say "❌ 依赖安装失败，详见 $LOG"
    read -n 1 -s -r -p "按任意键退出…"
    exit 1
  fi
  say "✅ 依赖安装完成"
else
  say "✅ 依赖已就绪"
fi

# ---------- 3. 起小红书连接服务（MCP）----------
MCP_BIN=""
for f in mcp/xiaohongshu-mcp-darwin-arm64 mcp/xiaohongshu-mcp-darwin-amd64 mcp/xiaohongshu-mcp; do
  [ -f "$f" ] && MCP_BIN="$f" && break
done

if [ -n "$MCP_BIN" ]; then
  chmod +x "$MCP_BIN" 2>/dev/null
  if ! (exec 3<>/dev/tcp/127.0.0.1/18060) 2>/dev/null; then
    say "正在启动小红书连接服务…"
    "$MCP_BIN" >>"$LOG_DIR/mcp.log" 2>&1 &
    echo $! > "$LOG_DIR/mcp.pid"
    sleep 3
    say "✅ 小红书连接服务已启动（端口 18060）"
  else
    say "✅ 小红书连接服务已在运行"
  fi
else
  say "⚠️  未找到小红书连接服务程序（mcp/ 目录为空）"
  say "   发布与数据采集功能将不可用，其余功能正常。"
fi

# ---------- 4. 起主服务 ----------
say "正在启动主服务…"
(cd server && node src/index.js) >>"$LOG_DIR/server.log" 2>&1 &
echo $! > "$LOG_DIR/server.pid"

# 等端口就绪（最多 30 秒）
for i in $(seq 1 30); do
  if (exec 3<>/dev/tcp/127.0.0.1/8787) 2>/dev/null; then
    say "✅ 主服务已就绪"
    break
  fi
  sleep 1
done

# ---------- 5. 打开界面 ----------
say "正在打开操作界面…"
open "http://127.0.0.1:8787"
say ""
say "============================================"
say " 已启动完成！界面在浏览器里打开了"
say " 关闭：按 Ctrl+C，或直接关掉这个终端窗口"
say " 日志：$LOG_DIR/"
say "============================================"
say ""
say "提示：这个窗口要保持开着（可以最小化）。"

wait
