#!/usr/bin/env bash
# 把绮点 AI 小红书运营系统推到 GitHub —— 一条命令，带密钥体检
#
# 用法（二选一）：
#   A) 交互式：      bash scripts/push-github.sh
#   B) 带参直接推：  GITHUB_TOKEN=xxx bash scripts/push-github.sh https://github.com/<账号>/<仓库>.git [分支名]
#
# 说明：
#   · token 用「Fine-grained PAT」，权限只需 Contents: Read and write
#   · 默认推到 main 分支；仓库已有 main 不覆盖历史时会提示改用 --force
#   · 推送前会做三道体检：明文密钥 / .env / cookie 数据库
set -u

REPO="${1:-}"
BRANCH="${2:-main}"
cd "$(dirname "$0")/.." || exit 1

echo "=============================================="
echo " 绮点 AI 小红书运营系统 → GitHub 推送工具"
echo "=============================================="
echo

# ---------- 体检 1：仓库里不能有明文密钥 ----------
echo "[1/3] 扫描明文密钥（sk- / ghp_ / github_pat_ / AIza）..."
HITS=$(git ls-files -z | xargs -0 grep -lE "sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}" 2>/dev/null || true)
if [ -n "$HITS" ]; then
  echo "  ❌ 发现明文密钥，已中止："
  echo "$HITS" | sed 's/^/     /'
  echo "  处理：把这些文件里的密钥删掉或替换成占位符，再重跑。"
  exit 1
fi
echo "  ✅ 无明文密钥"

# ---------- 体检 2：.env 与数据库必须被忽略 ----------
echo "[2/3] 检查 .env / 数据库 / node_modules 是否被排除..."
BAD=$(git ls-files | grep -E "(^|/)\.env$|\.db$|cookies\.json|node_modules/" || true)
if [ -n "$BAD" ]; then
  echo "  ❌ 这些不该入库，已中止："
  echo "$BAD" | sed 's/^/     /'
  exit 1
fi
echo "  ✅ .env / 数据库 / node_modules 均未入库"

# ---------- 体检 3：历史里也不能有密钥 ----------
echo "[3/3] 扫描全部 git 历史的 blob..."
# 🔴 本脚本不内置明文密钥：运行前先 export SECRET_TO_PURGE=<要核查的密钥>
HISTKEY="${SECRET_TO_PURGE:?未设置 SECRET_TO_PURGE —— 请先 export SECRET_TO_PURGE=<要核查的密钥> 再运行}"
if git rev-list --objects --all | awk '{print $1}' \
   | git cat-file --batch-check='%(objecttype) %(objectname)' 2>/dev/null \
   | awk '$1=="blob"{print $2}' | git cat-file --batch 2>/dev/null \
   | grep -q "$HISTKEY"; then
  echo "  ❌ 历史里仍存在明文密钥，已中止（需先 git filter-branch 清理）"
  exit 1
fi
echo "  ✅ 历史干净"

echo
# ---------- 取 token 与仓库地址 ----------
if [ -z "$REPO" ]; then
  printf "GitHub 仓库地址（如 https://github.com/Wkk12/qidian-xhs-ai-ops-demo.git）: "
  read -r REPO
fi
[ -z "$REPO" ] && { echo "❌ 没有仓库地址，退出"; exit 1; }

if [ -z "${GITHUB_TOKEN:-}" ]; then
  printf "GitHub Token（输入时不显示）: "
  read -rs GITHUB_TOKEN; echo
fi
[ -z "${GITHUB_TOKEN:-}" ] && { echo "❌ 没有 token，退出"; exit 1; }

# token 只放在本次命令的内存里，不写进 .git/config、不落盘
PUSH_URL=$(printf '%s' "$REPO" | sed -E "s#https://#https://${GITHUB_TOKEN}@#")

echo
echo "即将推送："
echo "  本地分支 : $(git rev-parse --abbrev-ref HEAD)"
echo "  远端仓库 : $REPO"
echo "  远端分支 : $BRANCH"
echo "  提交数   : $(git rev-list --count HEAD) 个    文件数: $(git ls-files | wc -l) 个"
echo "  体积     : $(git count-objects -vH | awk -F': ' '/size-pack/{print $2}')（含 2 个 16MB Mac 二进制 + 1 个 14MB 交付包）"
echo
printf "确认推送？(y/N) "
read -r OK
[ "$OK" = "y" ] || [ "$OK" = "Y" ] || { echo "已取消"; exit 0; }

echo
echo "推送中（大文件较多，可能要 1–3 分钟）..."
if git push "$PUSH_URL" "HEAD:refs/heads/$BRANCH" 2>&1 | sed -E "s#${GITHUB_TOKEN}#***#g"; then
  echo
  echo "✅ 推送完成"
  echo "   仓库无本地 remote 记录（token 未落盘）。以后想免输入推送，可执行："
  echo "   git remote add origin $REPO   # 之后用系统凭据管理器保存的凭据"
else
  echo
  echo "❌ 推送失败。常见原因："
  echo "   · 403 → token 没有该仓库的 Contents: write 权限，或该账号不是仓库 collaborator"
  echo "   · 已有 main 分支且历史不一致 → 换分支名（脚本第 2 个参数）或确认后手动 --force"
  exit 1
fi
