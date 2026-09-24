#!/usr/bin/env bash
# 把整个项目推到指定 GitHub 仓库（默认 Wkk 的仓库）
#
# 为什么需要你给 token：本机**没有任何 GitHub 凭据**
#   （gh CLI 未安装、无 ~/.git-credentials、无 SSH 私钥、Windows 凭据管理器无 github 条目）
#   —— 推远端是写操作，没凭据就推不了。这不是脚本问题，是权限问题。
#
# 用法：
#   GITHUB_TOKEN=github_pat_xxx bash scripts/push-to-wkk.sh                    # 推到 main
#   GITHUB_TOKEN=github_pat_xxx bash scripts/push-to-wkk.sh <repo_url> <branch> # 指定仓库/分支
#
# token 需要的最小权限：Fine-grained PAT → Repository access 选目标仓库 → Permissions: Contents = Read and write
# 安全：token 只在本次命令行使用，**不写 .git/config、不建 remote**；推完请把它删掉。
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="${GITHUB_TOKEN:-}"
[ -z "$TOKEN" ] && { echo "❌ 缺少 GITHUB_TOKEN。示例：GITHUB_TOKEN=github_pat_xxx bash scripts/push-to-wkk.sh"; exit 1; }

REPO="${1:-https://github.com/Wkk12/qidian-xhs-ai-ops-demo.git}"
BRANCH="${2:-main}"
SLUG="$(echo "$REPO" | sed -E 's#^https?://([^/]+)/##; s#\.git$##')"
PUSH_URL="https://x-access-token:${TOKEN}@${SLUG}.git"

echo "== 推送前体检 =="
[ -z "$(git status --porcelain)" ] && echo "  工作区: 干净 ✓" || { echo "  工作区有未提交改动 ✗"; git status --short | head -5; exit 1; }

F1="s""k-""796"; F2="s""k-""YJh"
N=$(git rev-list --objects --all | awk '{print $1}' \
  | git cat-file --batch-check='%(objecttype) %(objectname)' | awk '$1=="blob"{print $2}' \
  | git cat-file --batch 2>/dev/null | grep -ac -e "${F1}" -e "${F2}" || true)
[ "$N" = "0" ] && echo "  历史密钥片段: 0 ✓" || { echo "  历史密钥片段: $N ✗ 先跑 scripts/purge-secrets.sh"; exit 1; }

echo -n "  敏感文件是否入库: "
git ls-files | grep -icE '\.env$|env-backup|cookie|\.db$|node_modules' | sed 's/^0$/0 ✓（无）/' || true
echo "  文件数: $(git ls-files | wc -l)  提交数: $(git rev-list --all --count)"

echo "== 推送 =="
echo "  目标: $SLUG   分支: $BRANCH"
if git push "$PUSH_URL" "HEAD:refs/heads/${BRANCH}" 2>&1 | sed -E "s/${TOKEN}/***/g"; then
  echo "✅ 推送完成：https://github.com/${SLUG}/tree/${BRANCH}"
else
  echo "❌ 推送被拒。常见原因与对策："
  echo "   · 远端该分支已有别人的提交（non-fast-forward）→ 换分支推："
  echo "       GITHUB_TOKEN=xxx bash scripts/push-to-wkk.sh \"$REPO\" hermes-full-platform"
  echo "     确认要覆盖远端分支时再加 --force（会删掉远端该分支原有内容，谨慎）"
  echo "   · 403/404 → token 没有该仓库的 Contents: Read and write 权限"
  exit 1
fi
echo "（本地未保存任何 remote 或 token：$(git remote -v | wc -l) 个 remote）"
