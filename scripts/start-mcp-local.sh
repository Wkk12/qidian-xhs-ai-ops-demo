#!/bin/bash
# 从当前项目启动修复后的连接服务，账号凭据与 Node 服务共用路径。
set -eu
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
export COOKIES_PATH="${XHS_COOKIE_FILE:-${COOKIES_PATH:-$PROJECT_ROOT/data/cookies.json}}"
mkdir -p "$(dirname "$COOKIES_PATH")"
MCP_ARCH="$(uname -m)"
[ "$MCP_ARCH" != x86_64 ] || MCP_ARCH=amd64
MCP_LOCAL_BIN="$PROJECT_ROOT/.runtime/xiaohongshu-mcp-darwin-$MCP_ARCH"
if [ ! -x "$MCP_LOCAL_BIN" ]; then
  echo '未找到本地修复版连接服务，请按 docs/login-session-fix.md 构建。' >&2
  exit 1
fi
exec "$MCP_LOCAL_BIN" "$@"
